/**
 * REG24 Batch 1 — Candidate 4 Stop-First & Product Defect Regression Suite
 *
 * Written FIRST (failing-first on frozen Candidate 3 `bb975f9`) to reproduce and lock fixes for:
 *   1. DEF-C3-1 (CRITICAL): Unchanged Save (`POST /api/v1/knowledge/answers` / "บันทึกคำตอบตามรุ่น")
 *      on a reopened older revision (`r1` when `r2` already exists) MUST be 100% idempotent no-op
 *      (`idempotent_replay: true`, returning `r1` with ZERO new revision `r3`, ZERO model/verifier run,
 *      `r2` still latest, and `r1`'s 4-section `grounded_answer_snapshot` + sources + `[conv:...]` intact).
 *      Attempting an edited Save from an older revision (`r1` when `r2` exists) MUST be rejected with
 *      HTTP 409 (`STALE_PARENT_REVISION_409`) by server-side optimistic concurrency.
 *   2. DEF-C3-2 Part A (MATERIAL): Married taxpayer + spouse without income + 2 legitimate children
 *      born before 2561 (TY2568) MUST retrieve `prov.th.rc.47` (`psg.e4ec78f644930e`) as governing
 *      and deterministically ground `180,000 บาท` (`60,000 + 60,000 + 30,000 × 2`) as `ANSWERED`
 *      without waiving numeric verification (wrong sums like `240,000 บาท` for pre-2561 children
 *      remain REJECTED).
 *   3. DEF-C3-2 Part B (MATERIAL): Every outcome status — including `REVIEW_REQUIRED` (both verifier
 *      withheld outcomes and `RC1_REJECTED_CALC`) — MUST persist to Neon PostgreSQL as a real revision
 *      with `conversation_id` and reopen via `GET /api/v1/knowledge/answers/{rev}?require_db=1` (`200 OK`).
 *   4. DEF-C3-3 & DEF-C3-4 (MINOR):
 *      - `SavedRev` header renders on `/legal-review` for `insufficient` envelopes (`CI1`, `VF`, `REVIEW_REQUIRED`);
 *      - `VC` (`needs_vat_date_clarification`) builds a lean statutory/decree packet (`<= 16` passages,
 *        excluding noisy `กค` TaxRuling backfill) and includes a concise single-issue clarification reminder;
 *      - `reopenSavedRevisionById` clears `answerResult` and `traceableEnvelope` immediately before `fetch`
 *        and hides stale previous answers while `reopenBusy` is true.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET as answerByIdGet } from "../../src/app/api/v1/knowledge/answers/[id]/route";
import { POST as answersPost } from "../../src/app/api/v1/knowledge/answers/route";
import { POST as queryPost } from "../../src/app/api/v1/knowledge/query/route";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  setCustomCitationDbTransportForTesting,
  type CitationDbTransport,
} from "../../src/core/knowledge/citation-postgres-store";
import { saveOrReviseAnswerServerVerified } from "../../src/core/knowledge/claim-traceability-engine";
import { buildGroundedLlmUserPrompt } from "../../src/core/knowledge/grounded-llm-drafter";
import { analyzeLegalIssuesAndFacts } from "../../src/core/knowledge/legal-issue-fact-analyzer";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import {
  resetTrialRateLimiterForTesting,
  setCustomTrialAuditSink,
  setCustomTrialDbTransportForTesting,
} from "../../src/core/knowledge/trial-gate";
import type { Actor } from "../../src/core/knowledge/contracts";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

function createWritableTempCloneOfStagingStore(): { store: DurableKnowledgeStore; dir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand4-"));
  fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
  const store = new DurableKnowledgeStore(tmpDir);
  return { store, dir: tmpDir };
}

function createCand4PostgresSimulator() {
  const tables = {
    documents: new Map<string, Record<string, unknown>>(),
    versions: new Map<string, Record<string, unknown>>(),
    locations: new Map<string, Record<string, unknown>>(),
    extractions: new Map<string, Record<string, unknown>>(),
    passages: new Map<string, Record<string, unknown>>(),
    answers: new Map<string, Record<string, unknown>>(),
    claims: new Map<string, Record<string, unknown>>(),
    links: new Map<string, Record<string, unknown>>(),
    audits: [] as Array<Record<string, unknown>>,
    invites: new Map<string, { invite_id: string; token_sha256: string; scope: string }>(),
    rateBuckets: new Map<string, number>(),
  };

  const parseJson = (v: unknown) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };

  const execOne: CitationDbTransport = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ) => {
    const q = sql.replace(/\s+/g, " ").trim();

    if (q.includes("FROM trial_invite_credentials")) {
      const hash = String(params[0]);
      const scope = String(params[1]);
      const hit = Array.from(tables.invites.values()).find(
        (i) => i.token_sha256 === hash && i.scope === scope
      );
      return {
        rows: (hit ? [{ invite_id: hit.invite_id }] : []) as T[],
        rowCount: hit ? 1 : 0,
      };
    }
    if (q.startsWith("INSERT INTO trial_rate_limit_buckets")) {
      const k = `${params[0]}|${params[1]}`;
      const next = (tables.rateBuckets.get(k) || 0) + 1;
      tables.rateBuckets.set(k, next);
      return { rows: [{ request_count: next }] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO trial_audit_events")) {
      return { rows: [{ audit_id: params[0] }] as T[], rowCount: 1 };
    }

    if (q.startsWith("INSERT INTO citation_official_publisher")) {
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_official_document")) {
      const stride = 17;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.documents.set(String(params[off]), {
          doc_id: params[off],
          source_family: params[off + 1],
          issuer_id: params[off + 2],
          source_native_id: params[off + 3],
          reviewed_surrogate_id: params[off + 4],
          is_reviewed_surrogate: params[off + 5],
          original_title_th: params[off + 6],
          language: params[off + 7],
          record_type: params[off + 8],
          access_permission: params[off + 9],
          preservation_permission: params[off + 10],
          access_scope: params[off + 11],
          access_conditions_th: params[off + 12],
          eligible_for_citation: params[off + 13],
          ineligible_reason: params[off + 14],
          canonical_work_id: params[off + 15],
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_document_version")) {
      const stride = 19;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.versions.set(String(params[off]), {
          version_id: params[off],
          doc_id: String(params[off + 1]),
          artifact_sha256: params[off + 2],
          captured_at: params[off + 3],
          artifact_ref: params[off + 4],
          mime_type: params[off + 5],
          byte_size: params[off + 6],
          source_metadata: parseJson(params[off + 7]),
          publication_date: params[off + 8],
          effective_from: params[off + 10],
          effective_to: params[off + 11],
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_official_location")) {
      const stride = 18;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.locations.set(String(params[off]), {
          location_id: params[off],
          doc_id: params[off + 1],
          version_id: params[off + 2],
          exact_official_url: params[off + 3],
          original_observed_url: params[off + 6],
          last_successful_verified_at: params[off + 11],
          link_health: params[off + 14],
          is_active_primary: params[off + 17],
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_extraction_revision")) {
      const stride = 15;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.extractions.set(String(params[off]), {
          extraction_revision_id: params[off],
          version_id: params[off + 1],
          parser_or_ocr_version: params[off + 3],
          is_scanned_material: params[off + 5],
          page_mapping: parseJson(params[off + 6]),
          raw_transcription: params[off + 7],
          normalized_search_text: params[off + 8],
          review_status: params[off + 10],
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_evidence_passage")) {
      const stride = 21;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.passages.set(String(params[off]), {
          passage_id: params[off],
          extraction_revision_id: params[off + 1],
          version_id: params[off + 2],
          doc_id: params[off + 3],
          verbatim_text: params[off + 4],
          text_sha256: params[off + 5],
          surrounding_before: params[off + 6],
          surrounding_after: params[off + 7],
          section_paragraph_path: parseJson(params[off + 8]),
          statement_role: params[off + 9],
          physical_page_start: params[off + 10],
          physical_page_end: params[off + 11],
          printed_page_start: params[off + 12],
          printed_page_end: params[off + 13],
          anchors: parseJson(params[off + 14]),
          human_pinpoint_th: params[off + 15],
          locator_replay_status: params[off + 16],
          quarantine_reason: params[off + 17],
          eligible_for_publication: params[off + 18],
          access_scope: params[off + 19],
          created_at: params[off + 20],
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_published_answer")) {
      const revId = String(params[0]);
      const ansId = String(params[1]);
      const revNo = Number(params[2]);
      const supersedesRev = params[3] != null ? String(params[3]) : null;
      const orderedClaims = parseJson(params[11]) as unknown[];
      const status = String(params[9]);

      if (tables.answers.has(revId)) {
        throw new Error(`23505 duplicate key citation_published_answer_pkey (${revId})`);
      }
      if (supersedesRev !== null && !tables.answers.has(supersedesRev)) {
        throw new Error(`FK violation supersedes_revision_id ${supersedesRev}`);
      }
      if (
        (status === "complete" || status === "partial") &&
        (!Array.isArray(orderedClaims) || orderedClaims.length < 1)
      ) {
        throw new Error("chk_complete_or_partial_has_claims violated");
      }
      tables.answers.set(revId, {
        answer_revision_id: revId,
        answer_id: ansId,
        revision_number: revNo,
        supersedes_revision_id: supersedesRev,
        channel: params[4],
        question_text: params[5],
        generated_at: params[6],
        as_of_date: params[7],
        as_of_date_raw: params[8],
        status,
        rendered_answer_th: params[10],
        ordered_claim_ids: orderedClaims,
        unresolved_issues: parseJson(params[12]),
        user_supplied_facts: parseJson(params[13]),
        assumptions: parseJson(params[14]),
        legacy_warning_th: params[15],
        release_id: params[16],
        verifier_version: params[17],
        ruleset_version: params[18],
        owner_actor_id: params[19],
        owner_tenant_id: params[20],
        actor_id: params[21],
        tenant_id: params[22],
        revision_reason: params[23],
        environment_scope: params[24],
        execution_provenance: parseJson(params[25]),
        save_operation_key: params[26] ?? null,
        save_payload_sha256: params[27] ?? null,
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_atomic_claim")) {
      const stride = 13;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.claims.set(String(params[off]), {
          claim_id: params[off],
          answer_revision_id: String(params[off + 1]),
          display_order: Number(params[off + 2]),
          displayed_claim_text: params[off + 3],
          claim_type: params[off + 4],
          premise_claim_ids: parseJson(params[off + 5]),
          verification_decision: String(params[off + 6]),
          evidence_link_count: Number(params[off + 7]),
          published: Boolean(params[off + 8]),
          withheld_reason_th: params[off + 9],
          bound_calculation: parseJson(params[off + 12]),
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_claim_evidence_link")) {
      const stride = 14;
      for (let off = 0; off + stride <= params.length; off += stride) {
        tables.links.set(String(params[off]), {
          link_id: params[off],
          answer_revision_id: String(params[off + 1]),
          claim_id: String(params[off + 2]),
          passage_id: String(params[off + 3]),
          version_id: String(params[off + 4]),
          support_role: params[off + 5],
          required_group: params[off + 6],
          citation_label_th: params[off + 7],
          official_url: params[off + 8],
          resolver_url: params[off + 9],
          human_pinpoint_th: params[off + 10],
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_audit_event")) {
      tables.audits.push({
        audit_id: params[0],
        actor_or_service: params[1],
        recorded_at: params[2],
        event_type: params[3],
        affected_ids: parseJson(params[4]),
        before_status: parseJson(params[5]),
        after_status: parseJson(params[6]),
        reason: params[7],
        correlation_id: params[8],
      });
      return { rows: [] as T[], rowCount: 1 };
    }

    if (q.includes("FROM citation_official_document d JOIN citation_document_version v")) {
      const joined: Array<Record<string, unknown>> = [];
      for (const psg of tables.passages.values()) {
        const doc = tables.documents.get(String(psg.doc_id));
        const ver = tables.versions.get(String(psg.version_id));
        const ext = tables.extractions.get(String(psg.extraction_revision_id));
        const loc = Array.from(tables.locations.values()).find((l) => l.doc_id === psg.doc_id);
        if (doc && ver && ext) joined.push({ ...doc, ...ver, ...loc, ...ext, ...psg });
      }
      return { rows: joined as T[], rowCount: joined.length };
    }
    if (q.includes("save_operation_key = $4")) {
      const rows = Array.from(tables.answers.values()).filter(
        (r) =>
          r.owner_actor_id === params[0] &&
          r.owner_tenant_id === params[1] &&
          r.answer_id === params[2] &&
          r.save_operation_key === params[3]
      );
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (
      q.includes("FROM citation_published_answer") &&
      q.includes("WHERE answer_revision_id = $1") &&
      q.includes("LIMIT 1")
    ) {
      const row = tables.answers.get(String(params[0]));
      return { rows: (row ? [row] : []) as T[], rowCount: row ? 1 : 0 };
    }
    if (
      q.includes("FROM citation_published_answer") &&
      q.includes("WHERE answer_id = $1") &&
      q.includes("ORDER BY revision_number DESC LIMIT 1")
    ) {
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_id === String(params[0]))
        .sort((a, b) => Number(b.revision_number) - Number(a.revision_number))
        .slice(0, 1);
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (
      q.includes("FROM citation_published_answer") &&
      q.includes("WHERE answer_id = $1") &&
      q.includes("ORDER BY revision_number DESC")
    ) {
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_id === String(params[0]))
        .sort((a, b) => Number(b.revision_number) - Number(a.revision_number));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (
      q.includes("FROM citation_published_answer") &&
      q.includes("WHERE answer_id = $1") &&
      q.includes("ORDER BY revision_number ASC")
    ) {
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_id === String(params[0]))
        .sort((a, b) => Number(a.revision_number) - Number(b.revision_number));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_atomic_claim WHERE answer_revision_id = $1")) {
      const rows = Array.from(tables.claims.values())
        .filter((c) => c.answer_revision_id === String(params[0]))
        .sort((a, b) => Number(a.display_order) - Number(b.display_order));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_claim_evidence_link l JOIN citation_evidence_passage p")) {
      const revId = String(params[0]);
      const rows = Array.from(tables.links.values())
        .filter((l) => l.answer_revision_id === revId)
        .map((l) => {
          const psg = tables.passages.get(String(l.passage_id))!;
          const doc = tables.documents.get(String(psg.doc_id))!;
          const ver = tables.versions.get(String(l.version_id))!;
          const loc = Array.from(tables.locations.values()).find((lc) => lc.doc_id === doc.doc_id);
          return {
            ...l,
            doc_id: psg.doc_id,
            extraction_revision_id: psg.extraction_revision_id,
            section_paragraph_path: psg.section_paragraph_path,
            physical_page_start: psg.physical_page_start,
            physical_page_end: psg.physical_page_end,
            printed_page_start: psg.printed_page_start,
            printed_page_end: psg.printed_page_end,
            anchors: psg.anchors,
            access_scope: psg.access_scope,
            verbatim_text: psg.verbatim_text,
            original_title_th: doc.original_title_th,
            issuer_id: doc.issuer_id,
            source_family: doc.source_family,
            record_type: doc.record_type,
            access_permission: doc.access_permission,
            access_conditions_th: doc.access_conditions_th,
            effective_from: ver.effective_from,
            publication_date: ver.publication_date,
            link_health: loc?.link_health || "unchecked_live",
            last_successful_verified_at: loc?.last_successful_verified_at || null,
          };
        });
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_audit_event WHERE correlation_id = ANY")) {
      const ids = new Set((params[0] as string[]) || []);
      const rows = tables.audits.filter((a) => ids.has(String(a.correlation_id)));
      return { rows: rows as T[], rowCount: rows.length };
    }

    return { rows: [] as T[], rowCount: 0 };
  };

  const batchTx: NonNullable<Parameters<typeof setCustomCitationDbTransportForTesting>[1]> = async (
    statements
  ) => {
    for (const st of statements) {
      await execOne(st.query, st.params || []);
    }
  };

  return { tables, transport: execOne, batchTx };
}

const CAND4_ACTOR: Actor = {
  actor_id: "qa.cand4.reviewer@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const tempDirsToCleanup: string[] = [];

afterEach(() => {
  setCustomCitationDbTransportForTesting(null, null);
  setCustomTrialDbTransportForTesting(null);
  setCustomTrialAuditSink(null);
  resetTrialRateLimiterForTesting();
  setDefaultKnowledgeStoreForTesting(null);
  delete process.env.REG24_PINNED_RELEASE_ID;
  delete process.env.REG24_TRIAL_INVITE_ONLY;
  for (const d of tempDirsToCleanup.splice(0, tempDirsToCleanup.length)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup
    }
  }
});

describe("Candidate 4 Stop-First & Product Defect Remediation Suite (DEF-C3-1 .. DEF-C3-4)", () => {
  it("1. DEF-C3-1 (CRITICAL): Unchanged Save on reopened r1 when r2 already exists is 100% idempotent no-op (no r3, no re-verification, snapshot & 7,200,000 intact); edited Save on older r1 returns 409 STALE_PARENT_REVISION_409", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirsToCleanup.push(dir);
    setDefaultKnowledgeStoreForTesting(store);

    const sim = createCand4PostgresSimulator();
    setCustomCitationDbTransportForTesting(sim.transport, sim.batchTx);
    setCustomTrialDbTransportForTesting(sim.transport);

    const g3Q =
      "นางวิไลวรรณยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย (บุตรชายของน้องสาวนางวิไลวรรณ) โดยเสน่หาไม่มีค่าตอบแทน และจดทะเบียนโอนกรรมสิทธิ์เมื่อวันที่ 18 สิงหาคม 2568 หนังสือสัญญาให้ระบุมูลค่า 6,000,000 บาท แต่ราคาประเมินทุนทรัพย์ของทางราชการที่ใช้ในการจดทะเบียนคือ 7,200,000 บาท การให้ครั้งนี้ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณีใด นายภูมิต้องเสียภาษีเงินได้อย่างไร และต้องหักภาษี ณ ที่จ่ายเท่าใดในวันจดทะเบียน";
    const g3t2Q =
      "ถ้าเปลี่ยนข้อเท็จจริงเฉพาะผู้รับ: นางวิไลวรรณยกห้องชุดห้องเดิมให้นางสาวแพรวา ซึ่งเป็นบุตรสาวชอบด้วยกฎหมายของนางวิไลวรรณเอง (ไม่ใช่บุตรบุญธรรม) แทนนายภูมิ ในวันเดิม และปีนั้นไม่มีการโอนอสังหาริมทรัพย์อื่นให้บุตรสาวคนนี้ ต้องหักภาษี ณ ที่จ่ายในวันจดทะเบียนเท่าใด และบุตรสาวต้องเสียภาษีเงินได้หรือไม่";

    const g3Ans = await queryKnowledge(
      {
        question: g3Q,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      CAND4_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async ({ userPrompt }) => {
          const parsed = JSON.parse(userPrompt.slice(userPrompt.indexOf("{")));
          const pack = parsed.PASSAGE_PACK as Array<{ passage_id: string; work_id: string }>;
          const p41b = pack.find((p) => p.work_id === "prov.th.rc.41_ทวิ")!.passage_id;
          const p42 = pack.find((p) => p.work_id === "prov.th.rc.42")!.passage_id;
          const p49b = pack.find((p) => p.work_id === "prov.th.rc.49_ทวิ")!.passage_id;
          const p50 = pack.find((p) => p.work_id === "prov.th.rc.50")!.passage_id;
          const p54 = pack.find((p) => p.work_id === "prov.th.rc.54")!.passage_id;
          return {
            answer_status: "CONDITIONAL",
            overall_summary_th: "การโอนห้องชุดให้หลานชายใช้ราคาประเมินทุนทรัพย์ 7,200,000 บาท",
            case_facts_used: [
              {
                fact_label_th: "ราคาประเมินทุนทรัพย์ของทางราชการ",
                original_fact_th: "7,200,000 บาท",
                source_turn: 1,
                legal_significance_th: "ฐานตามมาตรา 49 ทวิ",
              },
            ],
            issues: [
              {
                issue_id: "iss.g3.donor",
                issue_title_th: "ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายของผู้โอน",
                party_or_scope_th: "นางวิไลวรรณ (ผู้โอนห้องชุด)",
                conclusion_th:
                  "นางวิไลวรรณถือเป็นผู้มีเงินได้พึงประเมินตามมาตรา 41 ทวิ โดยใช้ราคาประเมินทุนทรัพย์ 7,200,000 บาท ตามมาตรา 49 ทวิ และต้องหักภาษี ณ ที่จ่ายตามมาตรา 50 (5) เนื่องจากนายภูมิไม่ใช่บุตรชอบด้วยกฎหมายตามมาตรา 42 (26)",
                material_facts_relied_on: ["ราคาประเมินทุนทรัพย์ 7,200,000 บาท"],
                governing_passage_ids: [p41b, p42, p49b, p50],
                application_explanation_th:
                  "ตามประมวลรัษฎากร มาตรา 41 ทวิ มาตรา 49 ทวิ มาตรา 42 (26) และมาตรา 50 (5) การโอนห้องชุดโดยไม่มีค่าตอบแทนให้หลานชายใช้ราคาประเมินทุนทรัพย์ 7,200,000 บาท",
                authority_distinction_note_th: "ตัวบทประมวลรัษฎากร",
                proposed_calculation: null,
                missing_facts_or_uncertainties_th: ["วิธีได้มาและจำนวนปีถือครองของนางวิไลวรรณ"],
              },
              {
                issue_id: "iss.g3.s54",
                issue_title_th: "ความรับผิดกรณีหักภาษี ณ ที่จ่ายไม่ครบถ้วนตามมาตรา 54",
                party_or_scope_th: "ผู้จ่ายเงินได้และผู้มีเงินได้",
                conclusion_th:
                  "กรณีไม่หักและนำส่งภาษี ณ ที่จ่ายตามมาตรา 50 (5) ผู้จ่ายเงินได้และผู้มีเงินได้ต้องรับผิดร่วมกันตามมาตรา 54",
                material_facts_relied_on: ["มีหน้าที่หักภาษี ณ ที่จ่ายในวันจดทะเบียน"],
                governing_passage_ids: [p50, p54],
                application_explanation_th: "เป็นไปตามมาตรา 54 แห่งประมวลรัษฎากร",
                authority_distinction_note_th: "ตัวบทประมวลรัษฎากร",
                proposed_calculation: null,
                missing_facts_or_uncertainties_th: [],
              },
            ],
            assumptions_th: [],
            clarification_questions_th: ["นางวิไลวรรณได้ห้องชุดมาโดยทางมรดกหรือซื้อมาเมื่อใด"],
            evidence_gaps_th: [],
          };
        },
      }
    );
    expect(g3Ans.status).toBe("CONDITIONAL");

    const r1Saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: {
        ...g3Ans.traceable_answer!,
        execution_provenance: g3Ans.execution_provenance ?? null,
      },
      grounded_answer_snapshot: g3Ans,
      question_text: g3Q,
      revision_reason: "Persisted initial verified answer from query endpoint",
      actor: CAND4_ACTOR,
      query_persistence_context: {
        conversation_id: "conv.c4.g3",
        trusted_calculation_tokens_by_claim_id: Object.fromEntries(
          g3Ans.traceable_answer!.claims.map((c) => [c.claim_id, ["7200000", "7,200,000"]])
        ),
      },
    });
    expect(r1Saved.answer_revision).toMatch(/\.r1$/);

    // Follow-up G3t2 creates r2 in the same conversation
    const g3t2Ans = await queryKnowledge(
      {
        question: g3t2Q,
        release_id: "rel.B01.rc8",
        conversation_id: "conv.c4.g3",
        prior_saved_answer_revision: r1Saved.answer_revision,
        conversation_history: [
          { role: "user", content: g3Q, conversation_id: "conv.c4.g3" },
          {
            role: "assistant",
            content: g3Ans.answer,
            saved_answer_id: r1Saved.answer_id,
            saved_answer_revision: r1Saved.answer_revision,
            conversation_id: "conv.c4.g3",
          },
        ],
        answer_generation_mode: "llm_grounded",
      },
      CAND4_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async ({ userPrompt }) => {
          const parsed = JSON.parse(userPrompt.slice(userPrompt.indexOf("{")));
          const pack = parsed.PASSAGE_PACK as Array<{ passage_id: string; work_id: string }>;
          const p41b = pack.find((p) => p.work_id === "prov.th.rc.41_ทวิ")!.passage_id;
          const p42 = pack.find((p) => p.work_id === "prov.th.rc.42")!.passage_id;
          const p50 = pack.find((p) => p.work_id === "prov.th.rc.50")!.passage_id;
          return {
            answer_status: "ANSWERED",
            overall_summary_th: "โอนห้องชุดให้บุตรสาวชอบด้วยกฎหมาย ราคาประเมิน 7,200,000 บาท ได้รับยกเว้นทั้งผู้โอนและบุตรสาว",
            case_facts_used: [],
            issues: [
              {
                issue_id: "iss.g3t2.1",
                issue_title_th: "ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่าย",
                party_or_scope_th: "นางวิไลวรรณและนางสาวแพรวา (บุตรสาวชอบด้วยกฎหมาย)",
                conclusion_th:
                  "ได้รับยกเว้นภาษีเงินได้และไม่ต้องหักภาษี ณ ที่จ่ายตามมาตรา 41 ทวิ มาตรา 42 (26) และมาตรา 50 (6) เนื่องจากโอนให้บุตรชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม) ไม่เกิน 20,000,000 บาท และบุตรสาวไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา",
                material_facts_relied_on: ["ราคาประเมิน 7,200,000 บาท โอนให้บุตรสาวชอบด้วยกฎหมาย"],
                governing_passage_ids: [p41b, p42, p50],
                application_explanation_th:
                  "ตามมาตรา 41 ทวิ มาตรา 42 (26) และมาตรา 50 (6) แห่งประมวลรัษฎากร",
                authority_distinction_note_th: "ตัวบทประมวลรัษฎากร",
                proposed_calculation: null,
                missing_facts_or_uncertainties_th: [],
              },
            ],
            assumptions_th: [],
            clarification_questions_th: [],
            evidence_gaps_th: [],
          };
        },
      }
    );
    const r2Saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: {
        ...g3t2Ans.traceable_answer!,
        execution_provenance: g3t2Ans.execution_provenance ?? null,
      },
      grounded_answer_snapshot: g3t2Ans,
      question_text: g3t2Q,
      revision_reason: "Persisted follow-up verified answer from query endpoint",
      actor: CAND4_ACTOR,
      query_persistence_context: {
        conversation_id: "conv.c4.g3",
        prior_saved_answer_revision: r1Saved.answer_revision,
        conversation_history: [
          { role: "user", content: g3Q, conversation_id: "conv.c4.g3" },
          {
            role: "assistant",
            content: g3Ans.answer,
            saved_answer_id: r1Saved.answer_id,
            saved_answer_revision: r1Saved.answer_revision,
            conversation_id: "conv.c4.g3",
          },
        ],
      },
    });
    expect(r2Saved.answer_revision).toBe(`${r1Saved.answer_id}.r2`);

    // Exact QA DEF-C3-1 repro:
    // Step A: Reopen r1 via GET /api/v1/knowledge/answers/{r1}?require_db=1
    const reopenRes = await answerByIdGet(
      new Request(
        `http://localhost/api/v1/knowledge/answers/${encodeURIComponent(r1Saved.answer_revision)}?require_db=1`,
        {
          headers: {
            "x-reg24-actor-id": CAND4_ACTOR.actor_id,
            "x-reg24-actor-role": CAND4_ACTOR.role,
          },
        }
      ),
      { params: Promise.resolve({ id: r1Saved.answer_revision }) }
    );
    expect(reopenRes.status).toBe(200);
    const reopenJson = await reopenRes.json();
    expect(reopenJson.answer.grounded_answer_snapshot).toBeTruthy();
    expect(reopenJson.grounded_answer.answer).toContain("1. ข้อเท็จจริงที่ใช้วิเคราะห์");

    // Step B: Click "บันทึกคำตอบตามรุ่น" ONCE with NO edits on reopened r1 (while r2 already exists!)
    const unchangedSaveRes = await answersPost(
      new Request("http://localhost/api/v1/knowledge/answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": CAND4_ACTOR.actor_id,
          "x-reg24-actor-role": CAND4_ACTOR.role,
        },
        body: JSON.stringify({
          traceable_answer: reopenJson.answer,
          question_text: reopenJson.question_text,
          save_operation_key: `op.ui_save.${r1Saved.answer_id}.${r1Saved.answer_revision}`,
        }),
      })
    );
    expect(unchangedSaveRes.status).toBe(200);
    const unchangedSaveJson = await unchangedSaveRes.json();

    // MUST be an idempotent no-op returning r1 — NEVER creating r3 or superseding r2!
    expect(unchangedSaveJson.idempotent_replay).toBe(true);
    expect(unchangedSaveJson.saved_answer_revision).toBe(r1Saved.answer_revision);
    expect(sim.tables.answers.has(`${r1Saved.answer_id}.r3`)).toBe(false);
    expect(sim.tables.answers.size).toBe(2);
    expect(unchangedSaveJson.answer.unresolved_issues).toHaveLength(0);
    expect(unchangedSaveJson.answer.grounded_answer_snapshot?.answer).toContain(
      "1. ข้อเท็จจริงที่ใช้วิเคราะห์"
    );

    // Step C: Attempting an EDITED Save from older r1 while r2 exists MUST be blocked with HTTP 409!
    const staleEditRes = await answersPost(
      new Request("http://localhost/api/v1/knowledge/answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": CAND4_ACTOR.actor_id,
          "x-reg24-actor-role": CAND4_ACTOR.role,
        },
        body: JSON.stringify({
          traceable_answer: {
            ...reopenJson.answer,
            rendered_answer_th: `${reopenJson.answer.rendered_answer_th}\nหมายเหตุแก้ไขเพิ่มเติม`,
          },
          question_text: reopenJson.question_text,
          revision_reason: "Attempted edit from superseded r1",
          save_operation_key: `op.edit_from_stale_r1.${Date.now()}`,
        }),
      })
    );
    expect(staleEditRes.status).toBe(409);
    const staleEditJson = await staleEditRes.json();
    expect(staleEditJson.error).toContain("STALE_PARENT_REVISION_409");
    expect(sim.tables.answers.has(`${r1Saved.answer_id}.r3`)).toBe(false);
  });

  it("2. DEF-C3-2 Part A (MATERIAL): Married taxpayer + spouse without income + 2 pre-2561 legitimate children (TY2568) grounds 180,000 บาท under psg.e4ec78f644930e (s.47), while wrong 240,000 บาท sum is rejected", async () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const s47Q =
      "นายสมมติ ใจดี มีคู่สมรสที่ไม่มีเงินได้ และมีบุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 ทั้งคู่ ปีภาษี 2568 มีสิทธิหักลดหย่อนตามมาตรา 47 สำหรับตนเอง คู่สมรส และบุตร รวมเท่าใด";

    const analysis = analyzeLegalIssuesAndFacts({
      question: s47Q,
      applicableDate: null,
      explicitRulingIds: [],
      state: store.getState(),
    });
    expect(analysis.controllingWorkIds).toContain("prov.th.rc.47");

    // Positive: 60,000 + 60,000 + (30,000 × 2) = 180,000 บาท passes verification cleanly!
    const posAns = await queryKnowledge(
      {
        question: s47Q,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      CAND4_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async () => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "นายสมมติ ใจดี มีสิทธิหักลดหย่อนรวม 180,000 บาท ตามมาตรา 47 (1) (ก) (ข) และ (ค) (1)",
          case_facts_used: [
            {
              fact_label_th: "สถานะครอบครัวและบุตร",
              original_fact_th: "คู่สมรสไม่มีเงินได้ และบุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 ทั้งคู่ (ปีภาษี 2568)",
              source_turn: 1,
              legal_significance_th: "เข้าเกณฑ์หักลดหย่อนตามมาตรา 47 (1) (ก), (ข) และ (ค) (1)",
            },
          ],
          issues: [
            {
              issue_id: "iss.s47.total",
              issue_title_th: "สิทธิหักลดหย่อนสำหรับผู้มีเงินได้ คู่สมรส และบุตรชอบด้วยกฎหมายตามมาตรา 47",
              party_or_scope_th: "นายสมมติ ใจดี (ปีภาษี 2568)",
              conclusion_th:
                "นายสมมติ ใจดี มีสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47 (1) รวมทั้งสิ้น 180,000 บาท แบ่งเป็น (ก) ผู้มีเงินได้ 60,000 บาท (ข) คู่สมรสของผู้มีเงินได้ซึ่งไม่มีเงินได้ 60,000 บาท และ (ค) (1) บุตรชอบด้วยกฎหมาย 2 คนซึ่งเกิดก่อนปี พ.ศ. 2561 คนละ 30,000 บาท รวมบุตร 60,000 บาท",
              material_facts_relied_on: [
                "คู่สมรสไม่มีเงินได้",
                "บุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 ทั้งคู่",
              ],
              governing_passage_ids: ["psg.e4ec78f644930e"],
              application_explanation_th:
                "ตามมาตรา 47 (1) แห่งประมวลรัษฎากร ให้หักลดหย่อนสำหรับผู้มีเงินได้ 60,000 บาท สามีหรือภริยาของผู้มีเงินได้ 60,000 บาท และบุตรชอบด้วยกฎหมายคนละ 30,000 บาท โดยกรณีบุตรทั้ง 2 คนเกิดก่อนปี พ.ศ. 2561 จึงไม่ได้รับสิทธิลดหย่อนเพิ่มอีกคนละ 30,000 บาทสำหรับบุตรคนที่สองที่เกิดในหรือหลังปี พ.ศ. 2561 เมื่อรวมทั้งสามรายการจึงเท่ากับ 180,000 บาท",
              authority_distinction_note_th: "ตัวบทประมวลรัษฎากร มาตรา 47",
              proposed_calculation: null,
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );

    expect(posAns.status).toBe("ANSWERED");
    expect(posAns.answer).toContain("180,000 บาท");
    expect(posAns.evidence.map((e) => e.passage_id)).toContain("psg.e4ec78f644930e");

    // Negative control: erroneously claiming 240,000 บาท (wrongly applying post-2561 bonus to pre-2561 children) MUST be rejected!
    const negAns = await queryKnowledge(
      {
        question: s47Q,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      CAND4_ACTOR,
      {
        store,
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: async () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "หักลดหย่อนรวม 240,000 บาท",
          case_facts_used: [],
          issues: [
            {
              issue_id: "iss.s47.wrong",
              issue_title_th: "สิทธิหักลดหย่อนตามมาตรา 47",
              party_or_scope_th: "นายสมมติ ใจดี",
              conclusion_th:
                "นายสมมติ ใจดี มีสิทธิหักลดหย่อนตามมาตรา 47 (1) รวมทั้งสิ้น 240,000 บาท",
              material_facts_relied_on: ["บุตรชอบด้วยกฎหมาย 2 คน เกิดก่อนปี 2561 ทั้งคู่"],
              governing_passage_ids: ["psg.e4ec78f644930e"],
              application_explanation_th: "คำนวณรวมเป็น 240,000 บาท ตามมาตรา 47 (1)",
              authority_distinction_note_th: "มาตรา 47",
              proposed_calculation: null,
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(negAns.status).toBe("REVIEW_REQUIRED");
  });

  it("3. DEF-C3-2 Part B (MATERIAL): REVIEW_REQUIRED outcomes (including K3 RC1_REJECTED_CALC) persist to Neon PostgreSQL with conversation_id and reopen 200 OK via ?require_db=1", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirsToCleanup.push(dir);
    setDefaultKnowledgeStoreForTesting(store);

    const sim = createCand4PostgresSimulator();
    setCustomCitationDbTransportForTesting(sim.transport, sim.batchTx);
    setCustomTrialDbTransportForTesting(sim.transport);
    process.env.REG24_PINNED_RELEASE_ID = "rel.B01.rc8";

    const qRes = await queryPost(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": CAND4_ACTOR.actor_id,
          "x-reg24-actor-role": CAND4_ACTOR.role,
        },
        body: JSON.stringify({
          question:
            "บริษัท ขายสินค้าในประเทศ มูลค่า 100,000 บาท ส่งมอบวันที่ 15 พฤศจิกายน 2568 ต้องเสียภาษีมูลค่าเพิ่มเท่าใด",
          persist_answer: true,
          conversation_id: "conv.c4.revreq.k3",
          qa_synthetic_fixture: "RC1_REJECTED_CALC",
          answer_generation_mode: "llm_grounded",
        }),
      })
    );
    // Note: without live GEMINI_API_KEY in unit test, llm_grounded returns REVIEW_REQUIRED (MISSING_CREDENTIALS),
    // which exercises the exact REVIEW_REQUIRED persistence & ?require_db=1 reopen path!
    expect(qRes.status).toBe(200);
    const qJson = await qRes.json();
    expect(qJson.answer.status).toBe("REVIEW_REQUIRED");
    const savedRevId = qJson.traceable_answer?.answer_revision;
    expect(savedRevId).toMatch(/^ans\.trc\.[a-z0-9]+\.r1$/);
    expect(sim.tables.answers.has(savedRevId)).toBe(true);

    const reopenRes = await answerByIdGet(
      new Request(
        `http://localhost/api/v1/knowledge/answers/${encodeURIComponent(savedRevId)}?require_db=1`,
        {
          headers: {
            "x-reg24-actor-id": CAND4_ACTOR.actor_id,
            "x-reg24-actor-role": CAND4_ACTOR.role,
          },
        }
      ),
      { params: Promise.resolve({ id: savedRevId }) }
    );
    expect(reopenRes.status).toBe(200);
    const reopenJson = await reopenRes.json();
    expect(reopenJson.ok).toBe(true);
    expect(reopenJson.grounded_answer.status).toBe("REVIEW_REQUIRED");
    expect(reopenJson.conversation_id).toBe("conv.c4.revreq.k3");
  });

  it("4. DEF-C3-3 & DEF-C3-4 (MINOR): SavedRev renders on insufficient statuses (CI1/REVIEW_REQUIRED), VC missing-tax-point builds a lean <=16-passage packet with concise clarification reminder, and Reopen clears stale answer immediately", async () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const vcQ =
      "ห้างหุ้นส่วนจำกัด ริมน้ำ อินทีเรีย เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม จะรับออกแบบตกแต่งภายในให้โรงแรมแห่งหนึ่งในจังหวัดเชียงใหม่ ซึ่งใช้บริการทั้งหมดในประเทศไทย ค่าบริการ 400,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ยังไม่ได้กำหนดวันรับชำระเงินหรือวันออกใบกำกับภาษี ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด และตามกฎหมายฉบับใด";

    let capturedPacketLen = 999;
    let capturedRulingCount = 999;
    await queryKnowledge(
      {
        question: vcQ,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      CAND4_ACTOR,
      {
        store,
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (cap) => {
          capturedPacketLen = cap.actual_model_packet.length;
          capturedRulingCount = cap.actual_model_packet.filter(
            (p) => p.authority_tier === "CASE_SPECIFIC_TAX_RULING"
          ).length;
        },
      }
    );
    expect(capturedRulingCount).toBe(0);
    expect(capturedPacketLen).toBeLessThanOrEqual(16);

    const ledger = buildStructuredCaseFactLedger({ question: vcQ, applicableDate: null });
    const promptStr = buildGroundedLlmUserPrompt({
      question: vcQ,
      factLedger: ledger,
      passagePack: [],
      specialConstraints: { needs_vat_date_clarification: true },
    });
    expect(promptStr).toContain("needs_vat_date_clarification");
    expect(promptStr).toContain("pack_grounding_reminders_th");

    const pageSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/legal-review/page.tsx"),
      "utf8"
    );
    // DEF-C3-3: SavedRev badge includes `traceableEnvelope.status === "insufficient"`
    expect(pageSrc).toMatch(
      /traceableEnvelope\.status === "complete"\s*\|\|\s*traceableEnvelope\.status === "partial"\s*\|\|\s*traceableEnvelope\.status === "insufficient"[\s\S]{0,160}SavedRev:/
    );
    // DEF-C3-2: runQuery does not exclude REVIEW_REQUIRED from savedRev
    expect(pageSrc).not.toContain('ans.status !== "REVIEW_REQUIRED"');
    // DEF-C3-4: reopenSavedRevisionById clears previous answerResult & traceableEnvelope before fetch
    const reopenFnSlice = pageSrc.slice(
      pageSrc.indexOf("const reopenSavedRevisionById"),
      pageSrc.indexOf("const reopenSavedRevisionById") + 900
    );
    expect(reopenFnSlice.indexOf("setAnswerResult(null)")).toBeGreaterThan(0);
    expect(reopenFnSlice.indexOf("setAnswerResult(null)")).toBeLessThan(
      reopenFnSlice.indexOf("await fetch(")
    );
  });
});
