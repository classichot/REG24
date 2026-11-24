/**
 * REG24 Batch 1 — Candidate 3 Product & Legal Key Alignment Regression Suite
 *
 * Written FIRST (failing-first on frozen Candidate 2 `0f27f09`) to reproduce and lock fixes for:
 *   1. Defect 1 (CRITICAL): Follow-up after Reopen must bind strictly to the reopened revision's
 *      `conversation_id` and revision chain (`G3t2` in `G3`'s conversation, zero `G5` contamination),
 *      and server-side must reject cross-conversation parent/history follow-up writes (`400`).
 *   2. Defect 2 (MATERIAL, systemic): Exact Reopen must rehydrate the full saved `GroundedAnswer`
 *      payload (all 4 sections: facts used, issue hierarchy & missing facts, limitations & assumptions,
 *      verified authorities with URLs/versions/passage IDs, plus original `trace_id` and `latency_ms`).
 *   3. Defect 3 (MATERIAL): Non-`ANSWERED` outcomes (`NEEDS_CLARIFICATION` like `VC`, and
 *      `INSUFFICIENT_EVIDENCE` like `CI1`, `VF`) must persist to Neon PostgreSQL and reopen via
 *      `?require_db=1` identically to `ANSWERED`/`CONDITIONAL` revisions.
 *   4. Defect 4 + Minor 1 (MATERIAL): Parent-to-legitimate-child immovable gifts (`G1`, `M1t1`, `G3t2`)
 *      must state that the legitimate-child recipient is NOT taxed (`ไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา`),
 *      supported by `§ 41 bis` / `§ 42(26)` (and bind/link `กค 0702/3889` `rd.go.th/66517.html` on `G1`),
 *      while non-legitimate-child cases (`G2a`, `G2b`, `G3`, `G4`, `G5`, `M1t2`, `M1t3`) remain unsettled
 *      with NO recipient figure (including zero).
 *   5. Defect 5 (MATERIAL): `VG` (`15 มีนาคม 2561` = `2018-03-15`) must return the approved limited answer
 *      of `7%` under `พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560` (`CONDITIONAL`, `3,500` / `53,500 บาท` on `50,000 บาท`)
 *      with an explicit note that the original unamended `มาตรา 4` text is not separately in the sources,
 *      while `VF` (`15 มิถุนายน 2565` = `2022-06-15`) continues to abstain (`INSUFFICIENT_EVIDENCE`).
 *   6. Reviewer Tab Direct Read (`K1`/`K2`) + Minor 2 (`VAt2`), Minor 3 (`M1t3`), Minor 4 (`G5`):
 *      - Verified reviewer session sets `HttpOnly` cookie on `/environment` so direct browser-tab
 *        `GET /api/v1/knowledge/answers/{rev}?require_db=1` returns `200 OK` (`persistence_source: "neon_postgres"`),
 *        while `POST` mutations still require explicit header auth.
 *      - `VAt2` `"ห้างหุ้นส่วนจำกัด"` never matches `"หุ้น"` under `"ทรัพย์สินที่โอน"`.
 *      - `M1t3` preserves `"ที่ดินพร้อมอาคารพาณิชย์"` across Turn 3 (never collapsing to `"ที่ดิน"`) and links
 *        the `§ 50(5)(ข)` cross-reference to `พ.ร.ฎ. (ฉบับที่ 165) พ.ศ. 2529`.
 *      - `G5` routes `subreg.th.rc.royal_decree.342` + `prov.th.rc.91/2` for inherited land SBT exemption.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET as envGet } from "../../src/app/api/v1/knowledge/environment/route";
import { GET as answerByIdGet } from "../../src/app/api/v1/knowledge/answers/[id]/route";
import { POST as queryPost } from "../../src/app/api/v1/knowledge/query/route";
import { verifyClaimAgainstPassages } from "../../src/core/knowledge/answer-verification";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  setCustomCitationDbTransportForTesting,
  type CitationDbTransport,
} from "../../src/core/knowledge/citation-postgres-store";
import {
  attachTraceableEnvelopeToGroundedAnswer,
  reopenSavedTraceableAnswerWithPostgres,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import { buildGroundedPassagePack } from "../../src/core/knowledge/grounded-llm-drafter";
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
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
import type { Actor, GroundedAnswer, Passage } from "../../src/core/knowledge/contracts";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

function createWritableTempCloneOfStagingStore(): { store: DurableKnowledgeStore; dir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand3-"));
  fs.cpSync(STAGING_STORE_DIR, tmpDir, { recursive: true });
  const store = new DurableKnowledgeStore(tmpDir);
  return { store, dir: tmpDir };
}

function createCand3PostgresSimulator() {
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

    // SELECTs
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

const CAND3_ACTOR: Actor = {
  actor_id: "cand3.qa@7ladvisory.review",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

describe("REG24 Batch 1 — Candidate 3 Product & Legal Key Alignment Gates", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    setCustomCitationDbTransportForTesting(null, null);
    setCustomTrialDbTransportForTesting(null);
    setCustomTrialAuditSink(null);
    resetTrialRateLimiterForTesting();
    setDefaultKnowledgeStoreForTesting(null);
    delete process.env.REG24_TRIAL_INVITE_ONLY;
    delete process.env.REG24_TRIAL_ENV_SCOPE;
    delete process.env.REG24_TRIAL_INVITE_CODES;
    delete process.env.REG24_PINNED_RELEASE_ID;
    for (const d of tempDirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore Windows temp cleanup race
      }
    }
  });

  it("1. Defect 1 (CRITICAL — Cross-Matter Reopen Follow-Up Isolation): Reopen returns exact conversation_id & matter-only turns, rejects G5 cross-matter follow-up writes (400), and saves G3t2 as r2 of G3 with zero G5 fact contamination", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);
    setDefaultKnowledgeStoreForTesting(store);
    process.env.REG24_PINNED_RELEASE_ID = "rel.B01.rc8";
    const pg = createCand3PostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport, pg.batchTx);

    const g3Question =
      "นางวิไลวรรณต้องการโอนกรรมสิทธิ์ห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย (บุตรชายของน้องสาวนางวิไลวรรณ) โดยเสน่หาไม่มีค่าตอบแทน ในวันที่ 18 สิงหาคม 2568 ห้องชุดนี้ราคาประเมินทุนทรัพย์ 7,200,000 บาท นางวิไลวรรณและนายภูมิมีภาระภาษีเงินได้อย่างไร";
    const g5Question =
      "นางบุญเรือนยกที่ดินเปล่าในจังหวัดสุพรรณบุรีให้หลานสาว (บุตรสาวของน้องชาย) โดยเสน่หาเมื่อวันที่ 20 มิถุนายน 2568 ราคาประเมินทุนทรัพย์ 12,000,000 บาท ที่ดินนี้นางบุญเรือนได้รับมรดกมาจากบิดาเมื่อ 10 ปีก่อน ภาระภาษีเป็นอย่างไร";
    const g3t2Question =
      "ถ้าเปลี่ยนข้อเท็จจริงเฉพาะผู้รับ: นางวิไลวรรณยกห้องชุดห้องเดิมให้นางสาวแพรวา ซึ่งเป็นบุตรสาวชอบด้วยกฎหมายของนางวิไลวรรณเอง (ไม่ใช่บุตรบุญธรรม) แทนนายภูมิ ในวันเดิม ราคาประเมิน 7,200,000 บาท บุตรสาวต้องเสียภาษีเงินได้หรือไม่";

    // Seed G3 (conv.mwu0uhke.xggj1n) and G5 (conv.mwu1eb2g.lmqcwi) in Postgres
    const g3Grounded = await queryKnowledge(
      { question: g3Question, release_id: "rel.B01.rc8", applicable_date: "2025-08-18" },
      CAND3_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    const g3Saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: g3Grounded.traceable_answer!,
      grounded_answer_snapshot: g3Grounded,
      question_text: g3Question,
      revision_reason: "Persisted initial verified answer from query endpoint",
      actor: CAND3_ACTOR,
      query_persistence_context: {
        conversation_id: "conv.mwu0uhke.xggj1n",
        prior_saved_answer_revision: null,
        conversation_history: [],
      },
    } as Parameters<typeof saveOrReviseAnswerServerVerified>[1]);

    const g5Grounded = await queryKnowledge(
      { question: g5Question, release_id: "rel.B01.rc8", applicable_date: "2025-06-20" },
      CAND3_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    const g5Saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: g5Grounded.traceable_answer!,
      grounded_answer_snapshot: g5Grounded,
      question_text: g5Question,
      revision_reason: "Persisted initial verified answer from query endpoint",
      actor: CAND3_ACTOR,
      query_persistence_context: {
        conversation_id: "conv.mwu1eb2g.lmqcwi",
        prior_saved_answer_revision: null,
        conversation_history: [],
      },
    } as Parameters<typeof saveOrReviseAnswerServerVerified>[1]);

    // Exact Reopen of G3.r1 MUST return G3's conversation_id ("conv.mwu0uhke.xggj1n") and ONLY G3's turns!
    const reopenRes = await answerByIdGet(
      new Request(
        `https://staging.reg24.th/api/v1/knowledge/answers/${encodeURIComponent(g3Saved.answer_revision)}?require_db=1`,
        {
          method: "GET",
          headers: { "x-reg24-actor-id": CAND3_ACTOR.actor_id, "x-reg24-actor-role": "legal_reviewer" },
        }
      ),
      { params: Promise.resolve({ id: g3Saved.answer_revision }) }
    );
    expect(reopenRes.status).toBe(200);
    const reopenJson = (await reopenRes.json()) as {
      ok: boolean;
      conversation_id?: string;
      conversation_turns?: Array<{ role: string; content: string; conversation_id?: string; saved_answer_revision?: string }>;
    };
    expect(reopenJson.conversation_id).toBe("conv.mwu0uhke.xggj1n");
    expect(Array.isArray(reopenJson.conversation_turns)).toBe(true);
    expect(reopenJson.conversation_turns!.length).toBe(2);
    expect(reopenJson.conversation_turns![0].content).toBe(g3Question);
    expect(reopenJson.conversation_turns![1].saved_answer_revision).toBe(g3Saved.answer_revision);
    expect(JSON.stringify(reopenJson.conversation_turns)).not.toContain("12,000,000");
    expect(JSON.stringify(reopenJson.conversation_turns)).not.toContain("สุพรรณบุรี");

    // Server MUST REJECT (400) any cross-conversation write where reopened parent is G3.r1 but request binds to G5's conversation_id or G5's turns!
    const badCrossMatterRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": CAND3_ACTOR.actor_id,
          "x-reg24-actor-role": "legal_reviewer",
        },
        body: JSON.stringify({
          question: g3t2Question,
          persist_answer: true,
          conversation_id: "conv.mwu1eb2g.lmqcwi",
          prior_saved_answer_revision: g5Saved.answer_revision,
          reopened_from_revision: g3Saved.answer_revision,
          conversation_history: [
            { role: "user", content: g5Question, conversation_id: "conv.mwu1eb2g.lmqcwi" },
            {
              role: "assistant",
              content: g5Grounded.answer,
              saved_answer_id: g5Saved.answer_id,
              saved_answer_revision: g5Saved.answer_revision,
              conversation_id: "conv.mwu1eb2g.lmqcwi",
            },
          ],
        }),
      })
    );
    expect(badCrossMatterRes.status).toBe(400);
    const badCrossJson = await badCrossMatterRes.json();
    expect(String(badCrossJson.error)).toContain("CROSS_CONVERSATION_REVISION_FORBIDDEN_400");

    // Valid follow-up using reopened G3's conversation_id & turns MUST save as G3.r2 (superseding G3.r1) with ZERO G5 facts!
    const validFollowUpRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": CAND3_ACTOR.actor_id,
          "x-reg24-actor-role": "legal_reviewer",
        },
        body: JSON.stringify({
          question: g3t2Question,
          applicable_date: "2025-08-18",
          persist_answer: true,
          conversation_id: reopenJson.conversation_id,
          prior_saved_answer_revision: g3Saved.answer_revision,
          reopened_from_revision: g3Saved.answer_revision,
          conversation_history: reopenJson.conversation_turns,
        }),
      })
    );
    expect(validFollowUpRes.status).toBe(200);
    const validFollowUpJson = await validFollowUpRes.json();
    expect(validFollowUpJson.traceable_answer.answer_id).toBe(g3Saved.answer_id);
    expect(validFollowUpJson.traceable_answer.answer_revision).toBe(`${g3Saved.answer_id}.r2`);
    expect(validFollowUpJson.traceable_answer.supersedes_answer_revision).toBe(g3Saved.answer_revision);
    expect(String(validFollowUpJson.answer.answer)).not.toContain("12,000,000");
    expect(String(validFollowUpJson.answer.answer)).not.toContain("สุพรรณบุรี");
  });

  it("2. Defect 2 (MATERIAL — Exact Reopen Full Payload Fidelity): persists and rehydrates all 4 sections (facts used, issue hierarchy & missing facts, limitations & assumptions, verified sources with URLs/versions/passage IDs) plus original trace_id and latency_ms from Neon", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);
    setDefaultKnowledgeStoreForTesting(store);
    const pg = createCand3PostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport, pg.batchTx);

    const rc8 = store.getPassagesForRelease("rel.B01.rc8");
    const psg41Bis = rc8.find((p) => p.work_id === "prov.th.rc.41_ทวิ")!;
    const psg49Bis = rc8.find((p) => p.work_id === "prov.th.rc.49_ทวิ")!;
    const psg50 = rc8.find((p) => p.work_id === "prov.th.rc.50" && p.exact_text.includes("(6)"))!;
    const psg54 = rc8.find((p) => p.work_id === "prov.th.rc.54")!;

    const qText =
      "นางวิไลวรรณโอนกรรมสิทธิ์ห้องชุดในกรุงเทพมหานครให้นายภูมิ (บุตรชายของน้องสาว) โดยเสน่หาไม่มีค่าตอบแทน วันที่ 18 สิงหาคม 2568 ราคาประเมินทุนทรัพย์ 7,200,000 บาท ไม่ทราบวิธีได้มาและระยะเวลาถือครอง";
    const ledger = buildStructuredCaseFactLedger({ question: qText, applicableDate: "2025-08-18" });
    const pack = buildGroundedPassagePack({
      passages: [psg41Bis, psg49Bis, psg50, psg54],
      state: store.getState(),
      controllingDateIso: "2025-08-18",
      maxPassages: 12,
    });
    const rawMap = new Map<string, Passage>(
      [psg41Bis, psg49Bis, psg50, psg54].map((p) => [p.passage_id, p])
    );

    const verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.orig_g3_fidelity",
      factLedger: ledger,
      passagePack: pack,
      rawPassagesById: rawMap,
      state: store.getState(),
      llmOk: true,
      stagingFlagActive: true,
      invocationAudit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: "gemini-4-neon",
        resolved_model: "gemini-4-neon",
        actual_model_invoked: "gemini-4-neon",
        pinned_settings: {
          thinking_level: "low",
          thinking_level_note: null,
          temperature: 0,
          max_output_tokens: 16384,
          timeout_ms: 240000,
          store: false,
        },
        prompt_version: "reg24-grounded-llm-legal-application-v1.2",
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: "int.fidelity.1",
        provider_response_status: "completed",
        failure_classification: "NONE",
        latency_ms: 58420,
        input_tokens: 4200,
        output_tokens: 2100,
        thought_tokens: 600,
        total_tokens: 6900,
        estimated_cost_usd: 0.026,
        attempts: [],
        error_summary: null,
      },
      draft: {
        answer_status: "CONDITIONAL",
        overall_summary_th: "ผู้โอนมีหน้าที่เสียภาษีตามมาตรา 41 ทวิ และหักภาษี ณ ที่จ่ายตามมาตรา 50 (6)",
        case_facts_used: [],
        issues: [
          {
            issue_id: "iss_donor",
            issue_title_th: "ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายของผู้โอน",
            party_or_scope_th: "นางวิไลวรรณ (ผู้โอนห้องชุด)",
            conclusion_th:
              "นางวิไลวรรณถือเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ โดยใช้ราคาประเมินทุนทรัพย์ 7,200,000 บาท ตามมาตรา 49 ทวิ และต้องหักภาษี ณ ที่จ่ายตามมาตรา 50 (6)",
            material_facts_relied_on: ["ห้องชุดราคาประเมิน 7,200,000 บาท โอนให้หลานชาย"],
            governing_passage_ids: [psg41Bis.passage_id, psg49Bis.passage_id, psg50.passage_id],
            application_explanation_th:
              "การโอนกรรมสิทธิ์ในอสังหาริมทรัพย์โดยไม่มีค่าตอบแทนให้ถือว่าผู้โอนเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ คำนวณจากราคาประเมินตามมาตรา 49 ทวิ และหักภาษี ณ ที่จ่ายตามมาตรา 50 (6)",
            authority_distinction_note_th: "บทบัญญัติประมวลรัษฎากร",
            proposed_calculation: null,
            missing_facts_or_uncertainties_th: ["ยังไม่ทราบวิธีได้มาและจำนวนปีที่ถือครองห้องชุด"],
          },
          {
            issue_id: "iss_s54",
            issue_title_th: "ความรับผิดกรณีหักภาษี ณ ที่จ่ายไม่ครบถ้วนตามมาตรา 54",
            party_or_scope_th: "ความรับผิดร่วมในการนำส่งภาษีหัก ณ ที่จ่าย",
            conclusion_th:
              "หากไม่ได้หักและนำส่งหรือนำส่งไม่ครบถ้วน ต้องรับผิดร่วมตามมาตรา 54 แห่งประมวลรัษฎากร",
            material_facts_relied_on: ["ธุรกรรมมีหน้าที่หักภาษี ณ ที่จ่ายตามมาตรา 50 (6)"],
            governing_passage_ids: [psg54.passage_id, psg50.passage_id],
            application_explanation_th: "มาตรา 54 กำหนดความรับผิดร่วมเมื่อไม่หักหรือนำส่งไม่ครบ",
            authority_distinction_note_th: "",
            proposed_calculation: null,
            missing_facts_or_uncertainties_th: [],
          },
        ],
        assumptions_th: ["สมมติห้องชุดตั้งอยู่ในประเทศไทย"],
        clarification_questions_th: ["นางวิไลวรรณได้ห้องชุดนี้มาโดยวิธีใดและถือครองมากี่ปี"],
        evidence_gaps_th: ["ตัวบทตารางค่าใช้จ่ายเหมาตาม พ.ร.ฎ. 165 ไม่ได้แยกอยู่ในคลัง"],
      },
    });

    const fullGrounded: GroundedAnswer = {
      release_id: "rel.B01.rc8",
      knowledge_snapshot_at: "2026-11-23T00:00:00.000Z",
      status: verified.status,
      answer: verified.rendered_answer_th,
      claims: verified.claims,
      evidence: verified.evidence_cards,
      assumptions: verified.assumptions_th,
      clarification_questions: verified.clarification_questions_th,
      coverage_warnings: verified.coverage_warnings_th,
      applicable_date: "2025-08-18",
      model_policy_version: "reg24-grounded-llm-legal-application-v1.2",
      trace_id: "trc.orig_g3_fidelity",
      latency_ms: 59084,
    };
    const env = attachTraceableEnvelopeToGroundedAnswer(store, fullGrounded, {
      question: qText,
      actor: CAND3_ACTOR,
      channel: "chat",
      persist: false,
    });
    fullGrounded.traceable_answer = env;

    const committed = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: env,
      grounded_answer_snapshot: fullGrounded,
      question_text: qText,
      revision_reason: "Persisted initial verified answer from query endpoint [conv:conv.fidelity.test]",
      actor: CAND3_ACTOR,
    } as Parameters<typeof saveOrReviseAnswerServerVerified>[1]);

    const reopened = await reopenSavedTraceableAnswerWithPostgres(
      store,
      committed.answer_revision,
      CAND3_ACTOR,
      { requireDatabaseRead: true }
    );
    expect(reopened.found).toBe(true);
    expect(reopened.persistence_source).toBe("neon_postgres");
    const rehydrated = (reopened as unknown as { grounded_answer?: GroundedAnswer }).grounded_answer;
    expect(rehydrated).toBeDefined();
    expect(rehydrated!.answer).toContain("**1. ข้อเท็จจริงที่ใช้วิเคราะห์ (Case Facts Used)**");
    expect(rehydrated!.answer).toContain("**2. การวิเคราะห์และปรับใช้กฎหมายแยกตามประเด็น (Grounded Legal Application)**");
    expect(rehydrated!.answer).toContain("**3. ข้อจำกัด ข้อสมมติฐาน และข้อเท็จจริงที่ต้องตรวจสอบเพิ่มเติม**");
    expect(rehydrated!.answer).toContain("**4. แหล่งอ้างอิงที่ตรวจสอบแล้ว (Verified Authorities)**");
    expect(rehydrated!.answer).toBe(fullGrounded.answer);
    expect(rehydrated!.trace_id).toBe("trc.orig_g3_fidelity");
    expect(rehydrated!.latency_ms).toBe(59084);
    expect(rehydrated!.evidence.length).toBe(fullGrounded.evidence.length);
    expect(rehydrated!.evidence.map((e) => e.passage_id).sort()).toEqual(
      fullGrounded.evidence.map((e) => e.passage_id).sort()
    );
    expect(rehydrated!.assumptions).toEqual(["สมมติห้องชุดตั้งอยู่ในประเทศไทย"]);
  });

  it("3. Defect 3 (MATERIAL — Non-ANSWERED Outcomes Persist & Reopen): persists NEEDS_CLARIFICATION (VC) and INSUFFICIENT_EVIDENCE (CI1, VF) to Neon PostgreSQL and reopens via ?require_db=1 while still rejecting spoofed supported claims", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);
    setDefaultKnowledgeStoreForTesting(store);
    process.env.REG24_PINNED_RELEASE_ID = "rel.B01.rc8";
    const pg = createCand3PostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport, pg.batchTx);

    for (const tc of [
      {
        id: "CI1",
        expectedStatus: "INSUFFICIENT_EVIDENCE",
        q: "ตามหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/8826 ลงวันที่ 12 ตุลาคม 2568 ซึ่งวินิจฉัยว่า การยกห้องชุดให้หลานโดยเสน่หา ผู้ให้ไม่ต้องหักภาษีเงินได้ ณ ที่จ่าย ณ สำนักงานที่ดิน ขอให้ยืนยันว่าแนววินิจฉัยนี้ใช้กับกรณีที่นางสาวรัตนายกห้องชุดในกรุงเทพมหานครให้หลานชายเมื่อวันที่ 2 กุมภาพันธ์ 2569 ได้หรือไม่",
      },
      {
        id: "VF",
        expectedStatus: "INSUFFICIENT_EVIDENCE",
        q: "ห้างหุ้นส่วนจำกัด ทองหล่อ คลีนนิ่ง เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการทำความสะอาดอาคารสำนักงานในกรุงเทพมหานคร ค่าบริการ 60,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ได้รับชำระเงินและออกใบกำกับภาษีในวันเดียวกันคือวันที่ 15 มิถุนายน 2565 ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด ตามพระราชกฤษฎีกาฉบับใด และภาษีขายเป็นเงินเท่าใด",
      },
      {
        id: "VC",
        expectedStatus: "NEEDS_CLARIFICATION",
        q: "บริษัทจ่ายเงินบริจาคให้สถานศึกษาของรัฐเมื่อวันที่ 15 มิถุนายน หักรายจ่ายตามประมวลรัษฎากร มาตรา 65 ตรี ได้เท่าไร?",
      },
    ]) {
      const qRes = await queryPost(
        new Request("https://staging.reg24.th/api/v1/knowledge/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-actor-id": CAND3_ACTOR.actor_id,
            "x-reg24-actor-role": "legal_reviewer",
          },
          body: JSON.stringify({
            question: tc.q,
            persist_answer: true,
            conversation_id: `conv.cand3.${tc.id}`,
            conversation_history: [],
          }),
        })
      );
      expect(qRes.status).toBe(200);
      const qJson = await qRes.json();
      expect(qJson.answer.status).toBe(tc.expectedStatus);
      const savedRev = qJson.traceable_answer?.answer_revision as string | undefined;
      expect(savedRev).toBeTruthy();
      expect(pg.tables.answers.has(savedRev!)).toBe(true);

      // Reopen via GET /api/v1/knowledge/answers/{rev}?require_db=1 MUST succeed (200 OK)!
      const reopenRes = await answerByIdGet(
        new Request(
          `https://staging.reg24.th/api/v1/knowledge/answers/${encodeURIComponent(savedRev!)}?require_db=1`,
          {
            method: "GET",
            headers: {
              "x-reg24-actor-id": CAND3_ACTOR.actor_id,
              "x-reg24-actor-role": "legal_reviewer",
            },
          }
        ),
        { params: Promise.resolve({ id: savedRev! }) }
      );
      expect(reopenRes.status).toBe(200);
      const reopenJson = await reopenRes.json();
      expect(reopenJson.persistence_source).toBe("neon_postgres");
      expect(reopenJson.grounded_answer?.status).toBe(tc.expectedStatus);
      expect(reopenJson.grounded_answer?.trace_id).toBe(qJson.answer.trace_id);
    }

    // Security control: spoofed envelope claiming `status: "complete"` with zero valid evidence MUST still fail 422!
    await expect(
      saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: {
          answer_id: "ans.spoof.cand3",
          status: "complete",
          rendered_answer_th: "Spoofed answer",
          claims: [],
        },
        question_text: "Spoof test",
        actor: CAND3_ACTOR,
      })
    ).rejects.toThrow(/UNSUPPORTED_ANSWER_REJECTED_422/);
  });

  it("4. Defect 4 + Minor 1 (Legitimate-Child 'recipient not taxed' + กค 0702/3889 bound/linked vs Non-Child unsettled): approves legitimate-child recipient not-taxed claims (G1, M1t1, G3t2) while rejecting non-child zero/no-tax recipient claims", () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const rc8 = store.getPassagesForRelease("rel.B01.rc8");
    const psg41Bis = rc8.find((p) => p.work_id === "prov.th.rc.41_ทวิ")!;
    const psg42_1 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("มาตรา 42"))!;
    const psg42_26 = rc8.find((p) => p.work_id === "prov.th.rc.42" && p.exact_text.includes("(26)"))!;
    const psg50_6 = rc8.find((p) => p.work_id === "prov.th.rc.50" && p.exact_text.includes("(6)"))!;
    const psg3889 = rc8.find(
      (p) => p.work_id === "work.th.rd.gk_0702_3889_2022_0d0a6d5b" && p.statement_role === "official_conclusion"
    )!;

    // Legitimate-child recipient not taxed (G1 / M1t1 / G3t2) supported by §41 bis & §42(26) MUST PASS!
    for (const stmt of [
      "[ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวพิมพ์ชนก (บุตรสาวชอบด้วยกฎหมาย ผู้รับโอน)] นางสาวพิมพ์ชนกซึ่งเป็นบุตรสาวชอบด้วยกฎหมาย (ไม่ใช่บุตรบุญธรรม) ไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาและไม่ต้องนำมูลค่าที่ดินที่ได้รับโอนโดยไม่มีค่าตอบแทนจากบิดามารดามารวมคำนวณภาษีเงินได้ ตามประมวลรัษฎากร มาตรา 41 ทวิ และมาตรา 42 (26)",
      "[ภาระภาษีเงินได้บุคคลธรรมดาของนายกิตติ (บุตรชายชอบด้วยกฎหมาย ผู้รับโอน)] นายกิตติในฐานะบุตรชายชอบด้วยกฎหมายผู้รับโอนที่ดินพร้อมอาคารพาณิชย์โดยเสน่หาจากบิดาไม่มีภาระภาษีเงินได้บุคคลธรรมดาและไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับโอนดังกล่าว เนื่องจากมาตรา 41 ทวิ กำหนดให้ผู้โอนเป็นผู้มีเงินได้พึงประเมิน และมาตรา 42 (26) บัญญัติหลักเกณฑ์ยกเว้นสำหรับการโอนอสังหาริมทรัพย์ให้แก่บุตรชอบด้วยกฎหมายซึ่งไม่รวมถึงบุตรบุญธรรม",
      "[ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวแพรวา (บุตรสาวชอบด้วยกฎหมาย ผู้รับโอนห้องชุด)] นางสาวแพรวาซึ่งเป็นบุตรสาวชอบด้วยกฎหมายของนางวิไลวรรณไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับโอนกรรมสิทธิ์ห้องชุดโดยไม่มีค่าตอบแทน ตามมาตรา 41 ทวิ และมาตรา 42 (26) แห่งประมวลรัษฎากร",
    ]) {
      const check = verifyClaimAgainstPassages(
        {
          statement: stmt,
          supporting_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
        },
        rc8
      );
      expect(check.allow_confident_answer).toBe(true);
    }

    // Minor 1: G1 marital co-owned gift relying on กค 0702/3889 auto-binds psg.1285e0045e3266 (rd.go.th/66517.html)!
    const g1Q =
      "นายสมชายและนางสุดาเป็นสามีภริยาที่จดทะเบียนสมรส ซื้อที่ดินสองแปลงร่วมกันระหว่างสมรส ต่อมาจดทะเบียนยกที่ดินทั้งสองแปลงให้นางสาวพิมพ์ชนก บุตรสาวชอบด้วยกฎหมาย โดยไม่มีค่าตอบแทน ราคาประเมินรวม 36,000,000 บาท ภาระภาษีเงินได้ของนายสมชาย นางสุดา และนางสาวพิมพ์ชนกเป็นอย่างไร";
    const g1Ledger = buildStructuredCaseFactLedger({ question: g1Q, applicableDate: "2025-07-10" });
    const g1Pack = buildGroundedPassagePack({
      passages: [psg41Bis, psg42_1, psg42_26, psg50_6, psg3889],
      state: store.getState(),
      controllingDateIso: "2025-07-10",
      maxPassages: 12,
    });
    const g1RawMap = new Map<string, Passage>(
      [psg41Bis, psg42_1, psg42_26, psg50_6, psg3889].map((p) => [p.passage_id, p])
    );
    const g1Verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.cand3.g1",
      factLedger: g1Ledger,
      passagePack: g1Pack,
      rawPassagesById: g1RawMap,
      state: store.getState(),
      llmOk: true,
      stagingFlagActive: true,
      invocationAudit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: "gemini-4-neon",
        resolved_model: "gemini-4-neon",
        actual_model_invoked: "gemini-4-neon",
        pinned_settings: { thinking_level: "low", thinking_level_note: null, temperature: 0, max_output_tokens: 16384, timeout_ms: 240000, store: false },
        prompt_version: "test",
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: "completed",
        failure_classification: "NONE",
        latency_ms: 10,
        input_tokens: 10,
        output_tokens: 10,
        thought_tokens: 0,
        total_tokens: 20,
        estimated_cost_usd: 0,
        attempts: [],
        error_summary: null,
      },
      draft: {
        answer_status: "ANSWERED",
        overall_summary_th: "",
        case_facts_used: [],
        issues: [
          {
            issue_id: "g1_donor",
            issue_title_th: "ภาระภาษีเงินได้ของนายสมชายและนางสุดา (ผู้โอนที่ดินสินสมรส)",
            party_or_scope_th: "นายสมชายและนางสุดา",
            conclusion_th:
              "ที่ดินสินสมรสถือว่านายสมชายและนางสุดาได้รับเงินได้คนละกึ่งหนึ่ง (คนละ 18,000,000 บาท) ซึ่งไม่เกินคนละ 20,000,000 บาท จึงได้รับยกเว้นภาษีเงินได้ทั้งจำนวนและไม่ต้องหักภาษี ณ ที่จ่าย ตามมาตรา 41 ทวิ มาตรา 42 (26) และมาตรา 50 (6) สอดคล้องกับแนววินิจฉัย กค 0702/3889",
            material_facts_relied_on: ["ที่ดินสินสมรสราคาประเมินรวม 36,000,000 บาท โอนให้บุตรสาวชอบด้วยกฎหมาย"],
            governing_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id, psg50_6.passage_id],
            application_explanation_th:
              "ตามแนววินิจฉัยหนังสือตอบข้อหารือ กค 0702/3889 สามีภริยาที่ยกที่ดินสินสมรสให้บุตรชอบด้วยกฎหมาย ต่างฝ่ายต่างได้รับสิทธิยกเว้นส่วนที่ไม่เกิน 20,000,000 บาท ตามมาตรา 42 (26)",
            authority_distinction_note_th: "",
            proposed_calculation: null,
            missing_facts_or_uncertainties_th: [],
          },
          {
            issue_id: "g1_recipient",
            issue_title_th: "ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวพิมพ์ชนก (บุตรสาวชอบด้วยกฎหมาย ผู้รับโอน)",
            party_or_scope_th: "นางสาวพิมพ์ชนก",
            conclusion_th:
              "นางสาวพิมพ์ชนกซึ่งเป็นบุตรสาวชอบด้วยกฎหมายไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับโอนที่ดินดังกล่าว ตามมาตรา 41 ทวิ และมาตรา 42 (26)",
            material_facts_relied_on: ["บุตรสาวชอบด้วยกฎหมาย"],
            governing_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
            application_explanation_th: "มาตรา 41 ทวิ กำหนดให้ผู้โอนเป็นผู้มีเงินได้ และมาตรา 42 (26) ยกเว้นการโอนอสังหาริมทรัพย์ให้บุตรชอบด้วยกฎหมาย",
            authority_distinction_note_th: "",
            proposed_calculation: null,
            missing_facts_or_uncertainties_th: [],
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(g1Verified.verified_issues.length).toBe(2);
    expect(g1Verified.evidence_cards.some((e) => e.passage_id === psg3889.passage_id)).toBe(true);
    expect(g1Verified.rendered_answer_th).toContain("https://www.rd.go.th/66517.html");

    // Non-legitimate-child cases (adopted child, niece, nephew, grand-niece) MUST STILL REJECT "ไม่ต้องเสียภาษี" / "0 บาท"!
    for (const nonChildStmt of [
      "[ภาระภาษีเงินได้บุคคลธรรมดาของนายกิตติ (บุตรบุญธรรม ผู้รับโอน)] นายกิตติซึ่งเป็นบุตรบุญธรรมไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับโอนที่ดิน เนื่องจากมาตรา 41 ทวิ กำหนดให้ผู้โอนเป็นผู้มีเงินได้",
      "[ภาระภาษีเงินได้บุคคลธรรมดาของหลานสาว (ผู้รับโอน)] หลานสาวไม่ต้องเสียภาษีเงินได้บุคคลธรรมดาจากการรับโอนที่ดินดังกล่าว ตามมาตรา 41 ทวิ",
      "[ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวปาริชาติ (ผู้รับโอน)] นางสาวปาริชาติซึ่งเป็นบุตรสาวของหลานชายไม่มีภาระภาษีเงินได้บุคคลธรรมดา คิดเป็น 0 บาท",
    ]) {
      const badCheck = verifyClaimAgainstPassages(
        {
          statement: nonChildStmt,
          supporting_passage_ids: [psg41Bis.passage_id, psg42_1.passage_id, psg42_26.passage_id],
        },
        rc8
      );
      expect(badCheck.allow_confident_answer).toBe(false);
    }
  });

  it("5. Defect 5 (VG 2018-03-15 RD 646 7% Limited Answer vs VF 2022-06-15 Abstention): VG routes RD 646 as governing and returns 7% (3,500 / 53,500 THB) with original s.4 limitation note, while VF still abstains", async () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-mock-key-for-vg-vf";
    try {
      const vgQuestion =
        "บริษัท สยามซอฟต์ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการพัฒนาโปรแกรมคอมพิวเตอร์ภายในประเทศไทย มูลค่าบริการ 50,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ได้รับชำระเงินและออกใบกำกับภาษีเมื่อวันที่ 15 มีนาคม 2561 ต้องใช้อัตราภาษีมูลค่าเพิ่มร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด ภาษีขายเป็นเงินเท่าใด และยอดรวมทั้งสิ้นเท่าใด";

      const vgRes = await queryKnowledge(
        {
          question: vgQuestion,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        CAND3_ACTOR,
        {
          store,
          llmMockInvokerForTesting: ({ userPrompt, specialConstraints }) => {
            expect(specialConstraints?.pre_cutoff_vat_coverage_constraint).toBeUndefined();
            const parsed = JSON.parse(userPrompt.slice(userPrompt.indexOf("{"))) as {
              PASSAGE_PACK: Array<{ passage_id: string; work_id: string; evidence_role: string }>;
            };
            const rd646Passages = parsed.PASSAGE_PACK.filter(
              (p) => p.work_id === "subreg.th.rc.royal_decree.646" && p.evidence_role === "governing"
            );
            expect(rd646Passages.length).toBeGreaterThanOrEqual(1);
            const p80 = parsed.PASSAGE_PACK.find((p) => p.work_id === "prov.th.rc.80")!;
            const pGuide = parsed.PASSAGE_PACK.find(
              (p) => p.work_id === "subreg.th.rd.vat_local_tax_guide"
            )!;
            return {
              answer_status: "CONDITIONAL",
              overall_summary_th:
                "ใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 7.0 (ร้อยละ 6.3 ตาม พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 รวมภาษีท้องถิ่นร้อยละ 0.7) ภาษีขาย 3,500 บาท ยอดรวมทั้งสิ้น 53,500 บาท โดยมีข้อจำกัดว่าตัวบทมาตรา 4 ฉบับแรกเริ่มในราชกิจจานุเบกษาไม่ได้แยกอยู่ในคลังหลักฐาน",
              case_facts_used: [],
              issues: [
                {
                  issue_id: "vg_vat_2561",
                  issue_title_th: "อัตราภาษีมูลค่าเพิ่มและการคำนวณภาษีขายสำหรับวันเกิดความรับผิด 15 มีนาคม 2561",
                  party_or_scope_th: "บริษัท สยามซอฟต์ จำกัด",
                  conclusion_th:
                    "ใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 7.0 (ภาษีมูลค่าเพิ่มร้อยละ 6.3 ตามพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 รวมภาษีท้องถิ่นร้อยละ 0.7) คำนวณจากฐานค่าบริการ 50,000 บาท ได้ภาษีขาย 3,500 บาท และยอดรวมทั้งสิ้น 53,500 บาท ทั้งนี้ เอกสาร พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 ในคลังข้อมูลเป็นฉบับประมวลของกรมสรรพากรที่แสดงข้อความมาตรา 4 ซึ่งแก้ไขเพิ่มเติมในภายหลัง ไม่ใช่ตัวบทมาตรา 4 ฉบับแรกเริ่มตามราชกิจจานุเบกษา",
                  material_facts_relied_on: ["ค่าบริการ 50,000 บาท วันเกิดความรับผิด 15 มีนาคม 2561 (2018-03-15)"],
                  governing_passage_ids: [
                    p80.passage_id,
                    ...rd646Passages.map((p) => p.passage_id),
                    pGuide.passage_id,
                  ],
                  application_explanation_th:
                    "พระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 มาตรา 2 ให้ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2560 เป็นต้นไป (ช่วงเดิม 1 ตุลาคม 2560 ถึง 30 กันยายน 2561) ลดอัตราตามมาตรา 80 คงจัดเก็บร้อยละ 6.3 เมื่อรวมภาษีท้องถิ่น 1 ใน 9 (ร้อยละ 0.7) จึงเป็นอัตรารวมร้อยละ 7.0",
                  authority_distinction_note_th:
                    "หมายเหตุข้อจำกัดต้นฉบับ: คลังหลักฐานเก็บไฟล์ประมวลของกรมสรรพากร (dc646.pdf) โดยไม่มีตัวบทมาตรา 4 ฉบับแรกเริ่มที่ยังไม่ได้แก้ไขแยกต่างหาก",
                  proposed_calculation: {
                    is_computable_from_stated_facts: true,
                    tax_base_thb: 50_000,
                    exempt_amount_thb: 0,
                    taxable_amount_thb: 50_000,
                    rate_pct: 7,
                    computed_tax_thb: 3_500,
                    formula_description_th: "50,000 × 7% = 3,500 บาท (ยอดรวมทั้งสิ้น 53,500 บาท)",
                    missing_inputs_th: [],
                    steps_th: ["ภาษีขาย = 50,000 × 7% = 3,500 บาท", "ยอดรวมทั้งสิ้น = 50,000 + 3,500 = 53,500 บาท"],
                  },
                  missing_facts_or_uncertainties_th: [
                    "ตัวบทมาตรา 4 ฉบับแรกเริ่มของ พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560 ในราชกิจจานุเบกษาไม่ได้แยกอยู่ในคลังข้อมูล (มีเฉพาะฉบับประมวลของกรมสรรพากร)",
                  ],
                },
              ],
              assumptions_th: [],
              clarification_questions_th: [],
              evidence_gaps_th: [
                "ตัวบทมาตรา 4 ฉบับแรกเริ่มของพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 ก่อนการแก้ไขเพิ่มเติมไม่ได้รวมแยกต่างหากในคลังหลักฐาน",
              ],
            };
          },
        }
      );
      expect(vgRes.status).toBe("CONDITIONAL");
      expect(vgRes.claims.length).toBe(1);
      expect(vgRes.answer).toContain("3,500");
      expect(vgRes.answer).toContain("53,500");
      expect(vgRes.answer).toContain("646");
      expect(vgRes.answer).toContain("มาตรา 4");

      // Control: VF (15 มิถุนายน 2565 = 2022-06-15) MUST STILL ABSTAIN (INSUFFICIENT_EVIDENCE)!
      const vfRes = await queryKnowledge(
        {
          question:
            "ห้างหุ้นส่วนจำกัด ทองหล่อ คลีนนิ่ง เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการทำความสะอาดอาคารสำนักงานในกรุงเทพมหานคร ค่าบริการ 60,000 บาท ยังไม่รวมภาษีมูลค่าเพิ่ม ได้รับชำระเงินและออกใบกำกับภาษีในวันเดียวกันคือวันที่ 15 มิถุนายน 2565 ต้องใช้อัตราภาษีมูลค่าเพิ่มเท่าใด",
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        CAND3_ACTOR,
        {
          store,
          llmMockInvokerForTesting: ({ specialConstraints }) => {
            expect(specialConstraints?.pre_cutoff_vat_coverage_constraint?.controlling_date_iso).toBe("2022-06-15");
            return {
              answer_status: "INSUFFICIENT_EVIDENCE",
              overall_summary_th: "อยู่นอกช่วงพระราชกฤษฎีกาที่รับรองแล้ว",
              case_facts_used: [],
              issues: [],
              assumptions_th: [],
              clarification_questions_th: [],
              evidence_gaps_th: [],
            };
          },
        }
      );
      expect(vfRes.status).toBe("INSUFFICIENT_EVIDENCE");
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
      else delete process.env.GEMINI_API_KEY;
    }
  });

  it("6. Cookie-Auth Direct Tab Read (K1/K2) + Minor 2 (VAt2), Minor 3 (M1t3), Minor 4 (G5): verifies HttpOnly session cookie GET read, VAt2 asset exclusion, M1t3 shophouse preservation, and G5 RD 342 routing", async () => {
    const { store, dir } = createWritableTempCloneOfStagingStore();
    tempDirs.push(dir);
    setDefaultKnowledgeStoreForTesting(store);
    process.env.REG24_TRIAL_INVITE_ONLY = "1";
    process.env.REG24_TRIAL_ENV_SCOPE = "staging";
    const testInviteToken = "inv_cand3_cookie_test_token_0123456789abcd";
    process.env.REG24_TRIAL_INVITE_CODES = testInviteToken;

    const pg = createCand3PostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport, pg.batchTx);
    setCustomTrialDbTransportForTesting(pg.transport);

    // 6A. Verify on /api/v1/knowledge/environment sets HttpOnly session cookie
    const verifyRes = await envGet(
      new Request("https://staging.reg24.th/api/v1/knowledge/environment", {
        method: "GET",
        headers: { "x-reg24-trial-invite": testInviteToken },
      })
    );
    expect(verifyRes.status).toBe(200);
    const setCookieHeader = verifyRes.headers.get("set-cookie") || "";
    expect(setCookieHeader).toContain("reg24_trial_session=");
    expect(setCookieHeader).toContain("HttpOnly");
    const cookiePair = setCookieHeader.split(";")[0];

    // Save a revision owned by this verified invite's actor/tenant
    const verifyJson = await verifyRes.json();
    const reviewerActor: Actor = {
      actor_id: verifyJson.authenticated_reviewer.actor_id,
      role: "reader",
      tenant_id: verifyJson.authenticated_reviewer.tenant_id,
      authorized_scopes: ["scope.platform.public"],
      csrf_verified: true,
    };
    const k1Ans = await queryKnowledge(
      {
        question:
          "นายธีรวัฒน์โอนเงินสดผ่านธนาคารให้บิดาบังเกิดเกล้าโดยเสน่หา 24,000,000 บาท เมื่อวันที่ 12 พฤษภาคม 2568 บิดาต้องเสียภาษีเงินได้เท่าใด",
        release_id: "rel.B01.rc8",
        applicable_date: "2025-05-12",
      },
      reviewerActor,
      { store, persistAnswerAtomically: false }
    );
    const k1Saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: k1Ans.traceable_answer!,
      grounded_answer_snapshot: k1Ans,
      question_text: "K1 test",
      actor: reviewerActor,
    } as Parameters<typeof saveOrReviseAnswerServerVerified>[1]);

    // Direct browser-tab GET /api/v1/knowledge/answers/{rev}?require_db=1 WITH ONLY COOKIE (no x-reg24-trial-invite header!) MUST return 200 OK!
    const tabGetRes = await answerByIdGet(
      new Request(
        `https://staging.reg24.th/api/v1/knowledge/answers/${encodeURIComponent(k1Saved.answer_revision)}?require_db=1`,
        {
          method: "GET",
          headers: { Cookie: cookiePair },
        }
      ),
      { params: Promise.resolve({ id: k1Saved.answer_revision }) }
    );
    expect(tabGetRes.status).toBe(200);
    const tabGetJson = await tabGetRes.json();
    expect(tabGetJson.ok).toBe(true);
    expect(tabGetJson.persistence_source).toBe("neon_postgres");
    expect(tabGetJson.resolved_actor_id).toBe(reviewerActor.actor_id);
    expect(tabGetJson.answer.claims[0].verification_decision).toBe("supported");

    // POST /api/v1/knowledge/query WITH ONLY COOKIE (no header) MUST STILL FAIL 401 (CSRF protection)!
    const postCookieOnlyRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookiePair },
        body: JSON.stringify({ question: "Test CSRF block" }),
      })
    );
    expect(postCookieOnlyRes.status).toBe(401);

    // 6B. Minor 2 (VAt2): "ห้างหุ้นส่วนจำกัด" MUST NOT put "หุ้นส่วนจำกัด" under "ทรัพย์สินที่โอน"!
    const vat2Ledger = buildStructuredCaseFactLedger({
      question: "ถ้าเปลี่ยนข้อเท็จจริงว่า ห้างหุ้นส่วนจำกัดได้รับชำระค่าบริการเป็นจำนวน 200,000 บาท แทน ภาษีขายเป็นเท่าใด",
      conversationHistory: [
        {
          role: "user",
          content:
            "ห้างหุ้นส่วนจำกัด สยามเทค ให้บริการซ่อมบำรุงระบบในประเทศไทย ค่าบริการ 100,000 บาท รับชำระเงินและออกใบกำกับภาษีวันที่ 10 พฤศจิกายน 2568 ภาษีขายเท่าใด",
        },
        { role: "assistant", content: "ภาษีขาย 7,000 บาท" },
      ],
    });
    expect(vat2Ledger.material_facts.find((f) => f.fact_key === "asset")).toBeUndefined();

    // 6C. Minor 3 (M1t3): "ที่ดินพร้อมอาคารพาณิชย์" preserved across Turn 3 (never collapsed to "ที่ดิน")!
    const m1t1Q =
      "นายพงศ์เทพจดทะเบียนยกที่ดินพร้อมอาคารพาณิชย์ในจังหวัดชลบุรีให้นายกิตติ บุตรชายชอบด้วยกฎหมาย โดยเสน่หาไม่มีค่าตอบแทน เมื่อวันที่ 14 กรกฎาคม 2568 ราคาประเมินทุนทรัพย์ 16,000,000 บาท นายพงศ์เทพซื้ออสังหาริมทรัพย์นี้มาเมื่อวันที่ 10 มกราคม 2562";
    const m1t2Q = "เปลี่ยนเฉพาะว่า นายกิตติเป็นบุตรบุญธรรมของนายพงศ์เทพ ไม่ใช่บุตรชอบด้วยกฎหมาย ข้อเท็จจริงอื่นเหมือนเดิม";
    const m1t3Q =
      "ต่อเนื่องจากเทิร์นที่ 2 (นายกิตติเป็นบุตรบุญธรรม) ถ้าเปลี่ยนเป็นว่านายพงศ์เทพซื้อที่ดินนี้มาเมื่อวันที่ 10 มกราคม 2566 ภาระภาษีเปลี่ยนไปอย่างไร";
    const m1t3Ledger = buildStructuredCaseFactLedger({
      question: m1t3Q,
      conversationHistory: [
        { role: "user", content: m1t1Q },
        { role: "assistant", content: "คำตอบเทิร์น 1" },
        { role: "user", content: m1t2Q },
        { role: "assistant", content: "คำตอบเทิร์น 2" },
      ],
    });
    const m1t3Asset = m1t3Ledger.material_facts.find((f) => f.fact_key === "asset");
    expect(m1t3Asset?.normalized_category).toBe("IMMOVABLE_PROPERTY_BUILDING_AND_LAND");
    expect(m1t3Asset?.original_text_th).toContain("ที่ดินพร้อมอาคารพาณิชย์");

    // 6D. Minor 4 (G5): Inherited land gift routes RD 342 & §91/2 for SBT exemption point!
    const g5Analysis = analyzeLegalIssuesAndFacts({
      question:
        "นางบุญเรือนยกที่ดินเปล่าในจังหวัดสุพรรณบุรีให้หลานสาว (บุตรสาวของน้องชาย) โดยเสน่หาเมื่อวันที่ 20 มิถุนายน 2568 ราคาประเมินทุนทรัพย์ 12,000,000 บาท ที่ดินนี้นางบุญเรือนได้รับมรดกมาจากบิดาเมื่อ 10 ปีก่อน ภาระภาษีเป็นอย่างไร",
      applicableDate: "2025-06-20",
      explicitRulingIds: [],
      state: store.getState(),
    });
    expect(g5Analysis.controllingWorkIds).toContain("subreg.th.rc.royal_decree.342");
    expect(g5Analysis.controllingWorkIds).toContain("prov.th.rc.91/2");
  });
});
