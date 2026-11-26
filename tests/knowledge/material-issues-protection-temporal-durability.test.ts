import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as queryPost } from "../../src/app/api/v1/knowledge/query/route";
import { GET as answersGet, POST as answersPost } from "../../src/app/api/v1/knowledge/answers/route";
import { GET as answerByIdGet } from "../../src/app/api/v1/knowledge/answers/[id]/route";
import { GET as answerExportGet } from "../../src/app/api/v1/knowledge/answers/[id]/export/route";
import { GET as evidenceByIdGet } from "../../src/app/api/v1/knowledge/evidence/[id]/route";
import { POST as attachmentsPost } from "../../src/app/api/v1/knowledge/attachments/route";
import {
  GET as legalFeedbackGet,
  POST as legalFeedbackPost,
} from "../../src/app/api/v1/knowledge/legal-feedback/route";
import { POST as legalResearchPost } from "../../src/app/api/v1/legal-research/route";
import { POST as reportGeneratePost } from "../../src/app/api/v1/reports/generate/route";
import { POST as legalAnalyzePost } from "../../src/app/api/v1/legal/analyze/route";
import { POST as mcpPost } from "../../src/app/api/mcp/route";
import {
  approveDocumentedAmbiguityWithEvidence,
  reopenSavedTraceableAnswer,
  reopenSavedTraceableAnswerWithPostgres,
  resolveTraceableEvidenceWithPostgres,
  saveOrReviseAnswerServerVerified,
  validateAndBuildTraceableAnswer,
} from "../../src/core/knowledge/claim-traceability-engine";
import {
  setCustomCitationDbTransportForTesting,
  type CitationDbTransport,
} from "../../src/core/knowledge/citation-postgres-store";
import { CHALLENGING_THAI_TAX_SCENARIOS } from "../../src/core/knowledge/challenging-tax-scenarios";
import { resolveServerActor } from "../../src/core/knowledge/http-auth";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  clearProtectedStoreSidecarForTesting,
  onboardOfficialSourceDocument,
} from "../../src/core/knowledge/source-onboarding";
import {
  DurableKnowledgeStore,
  getDefaultKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

const USER_A: Actor = {
  actor_id: "lawyer.alpha@7ladvisory.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const USER_B: Actor = {
  actor_id: "lawyer.bravo@otherfirm.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const LEGAL_REVIEWER: Actor = {
  actor_id: "dodo.reviewer@7ladvisory.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

function cloneCanonicalStoreToTemp(prefix: string): {
  dir: string;
  store: DurableKnowledgeStore;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stagingGz = path.join(
    process.cwd(),
    "data",
    "knowledge-store-b01-rc2-staging",
    "canonical-state.json.gz"
  );
  const fallbackGz = path.join(
    process.cwd(),
    "data",
    "knowledge-store",
    "canonical-state.json.gz"
  );
  fs.copyFileSync(
    fs.existsSync(stagingGz) ? stagingGz : fallbackGz,
    path.join(dir, "canonical-state.json.gz")
  );
  return { dir, store: new DurableKnowledgeStore(dir) };
}

/**
 * Lightweight stateful relational mock for `CitationDbTransport` so unit tests verify
 * cold-start container restart, cross-deployment reads, and PITR snapshot/restore deterministically!
 */
function createInMemoryPostgresSimulator() {
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
    feedback: new Map<string, Record<string, unknown>>(),
  };

  const parseJsonIfStr = (v: unknown) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };

  const transport: CitationDbTransport = async <T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ) => {
    const q = sql.replace(/\s+/g, " ").trim();

    if (q.startsWith("INSERT INTO citation_official_publisher")) {
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_official_document")) {
      tables.documents.set(String(params[0]), {
        doc_id: params[0],
        source_family: params[1],
        issuer_id: params[2],
        source_native_id: params[3],
        reviewed_surrogate_id: params[4],
        is_reviewed_surrogate: params[5],
        original_title_th: params[6],
        language: params[7],
        record_type: params[8],
        access_permission: params[9],
        preservation_permission: params[10],
        access_conditions_th: params[11],
        access_scope: params[12],
        eligible_for_citation: params[13],
        ineligible_reason: params[14],
        canonical_work_id: params[15],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_document_version")) {
      tables.versions.set(String(params[0]), {
        version_id: params[0],
        doc_id: params[1],
        artifact_sha256: params[2],
        captured_at: params[3],
        artifact_ref: params[4],
        mime_type: params[5],
        byte_size: params[6],
        source_metadata: parseJsonIfStr(params[7]),
        publication_date: params[8],
        effective_from: params[9],
        effective_to: params[10],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_official_location")) {
      tables.locations.set(String(params[0]), {
        location_id: params[0],
        doc_id: params[1],
        version_id: params[2],
        exact_official_url: params[3],
        original_observed_url: params[6],
        prior_location_ids: parseJsonIfStr(params[8]),
        last_successful_verified_at: params[11],
        link_health: params[14],
        is_active_primary: params[17],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_extraction_revision")) {
      tables.extractions.set(String(params[0]), {
        extraction_revision_id: params[0],
        version_id: params[1],
        parser_or_ocr_version: params[3],
        is_scanned_material: params[5],
        page_mapping: parseJsonIfStr(params[6]),
        raw_transcription: params[7],
        normalized_search_text: params[8],
        review_status: params[10],
        reviewer_id: params[11],
        reviewed_at: params[12],
        correction_note: params[13],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_evidence_passage")) {
      tables.passages.set(String(params[0]), {
        passage_id: params[0],
        extraction_revision_id: params[1],
        version_id: params[2],
        doc_id: params[3],
        verbatim_text: params[4],
        text_sha256: params[5],
        surrounding_before: params[6],
        surrounding_after: params[7],
        section_paragraph_path: parseJsonIfStr(params[8]),
        statement_role: params[9],
        physical_page_start: params[10],
        physical_page_end: params[11],
        printed_page_start: params[12],
        printed_page_end: params[13],
        anchors: parseJsonIfStr(params[14]),
        human_pinpoint_th: params[15],
        locator_replay_status: params[16],
        quarantine_reason: params[17],
        eligible_for_publication: params[18],
        access_scope: params[19],
        psg_created_at: new Date().toISOString(),
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_published_answer")) {
      const revId = String(params[0]);
      if (tables.answers.has(revId)) {
        throw new Error(`IMMUTABLE_CITATION_RECORD: citation_published_answer ${revId} already exists`);
      }
      const supersedesRev = params[3] != null ? String(params[3]) : null;
      if (supersedesRev !== null && !tables.answers.has(supersedesRev)) {
        throw new Error(
          `NEON_CITATION_SQL_HTTP_400: insert or update on table "citation_published_answer" violates foreign key constraint "citation_published_answer_supersedes_revision_id_fkey" (Key (supersedes_revision_id)=(${supersedesRev}) is not present in table "citation_published_answer")`
        );
      }
      tables.answers.set(revId, {
        answer_revision_id: revId,
        answer_id: params[1],
        revision_number: Number(params[2]),
        supersedes_revision_id: params[3],
        channel: params[4],
        question_text: params[5],
        generated_at: params[6],
        as_of_date: params[7],
        as_of_date_raw: params[8],
        status: params[9],
        rendered_answer_th: params[10],
        ordered_claim_ids: parseJsonIfStr(params[11]),
        unresolved_issues: parseJsonIfStr(params[12]),
        user_supplied_facts: parseJsonIfStr(params[13]),
        assumptions: parseJsonIfStr(params[14]),
        legacy_warning_th: params[15],
        release_id: params[16],
        verifier_version: params[17],
        ruleset_version: params[18],
        owner_actor_id: params[19],
        owner_tenant_id: params[20],
        actor_id: params[21],
        tenant_id: params[22],
        revision_reason: params[23],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_atomic_claim")) {
      const claimPk = String(params[0]);
      if (tables.claims.has(claimPk)) {
        throw new Error(`duplicate key value violates unique constraint "citation_atomic_claim_pkey": ${claimPk}`);
      }
      const decision = String(params[6]);
      const linkCount = Number(params[7]);
      if (decision === "supported" && linkCount <= 0) {
        throw new Error("chk_supported_claim_requires_evidence violated");
      }
      tables.claims.set(claimPk, {
        claim_id: claimPk,
        answer_revision_id: params[1],
        display_order: Number(params[2]),
        displayed_claim_text: params[3],
        claim_type: params[4],
        premise_claim_ids: parseJsonIfStr(params[5]),
        verification_decision: decision,
        evidence_link_count: linkCount,
        published: Boolean(params[8]),
        withheld_reason_th: params[9],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_claim_evidence_link")) {
      tables.links.set(String(params[0]), {
        link_id: params[0],
        answer_revision_id: params[1],
        claim_id: params[2],
        passage_id: params[3],
        version_id: params[4],
        support_role: params[5],
        required_group: params[6],
        citation_label_th: params[7],
        official_url: params[8],
        resolver_url: params[9],
        human_pinpoint_th: params[10],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_audit_event")) {
      tables.audits.push({
        audit_id: params[0],
        actor_or_service: params[1],
        recorded_at: params[2],
        event_type: params[3],
        affected_ids: parseJsonIfStr(params[4]),
        before_status: parseJsonIfStr(params[5]),
        after_status: parseJsonIfStr(params[6]),
        reason: params[7],
        correlation_id: params[8],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_legal_review_feedback")) {
      tables.feedback.set(String(params[0]), {
        feedback_id: params[0],
        scenario_id: params[1],
        question_text: params[2],
        as_of_date: params[3],
        answer_revision_id: params[4],
        answer_status: params[5],
        reviewer_name: params[6],
        reviewer_actor_id: params[7],
        verdict: params[8],
        checked_original_source: Boolean(params[9]),
        comments_th: params[10],
        cited_evidence_ids: parseJsonIfStr(params[11]),
        environment_scope: params[12],
        recorded_at: params[13],
      });
      return { rows: [] as T[], rowCount: 1 };
    }

    // SELECT queries
    if (q.includes("FROM citation_published_answer WHERE answer_id = $1 ORDER BY revision_number DESC")) {
      const aid = String(params[0]);
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_id === aid)
        .sort((a, b) => Number(b.revision_number) - Number(a.revision_number));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (
      q.includes("FROM citation_published_answer WHERE answer_revision_id = $1 OR answer_id = $1") ||
      q.includes("FROM citation_published_answer WHERE answer_revision_id = $1")
    ) {
      const key = String(params[0]);
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_revision_id === key || r.answer_id === key)
        .sort((a, b) => Number(b.revision_number) - Number(a.revision_number))
        .slice(0, 1);
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_published_answer WHERE answer_id = $1 ORDER BY revision_number ASC")) {
      const aid = String(params[0]);
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_id === aid)
        .sort((a, b) => Number(a.revision_number) - Number(b.revision_number));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (
      q.includes("FROM citation_published_answer WHERE owner_tenant_id = 'PUBLIC'") ||
      (q.includes("FROM citation_published_answer") && q.includes("ORDER BY generated_at DESC"))
    ) {
      const rows = Array.from(tables.answers.values()).sort((a, b) =>
        String(b.generated_at).localeCompare(String(a.generated_at))
      );
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_atomic_claim WHERE answer_revision_id = $1")) {
      const revId = String(params[0]);
      const rows = Array.from(tables.claims.values())
        .filter((c) => c.answer_revision_id === revId)
        .sort((a, b) => Number(a.display_order) - Number(b.display_order));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_claim_evidence_link l")) {
      const revId = String(params[0]);
      const rows = Array.from(tables.links.values())
        .filter((l) => l.answer_revision_id === revId)
        .map((l) => {
          const p = tables.passages.get(String(l.passage_id)) || {};
          const d = tables.documents.get(String(p.doc_id)) || {};
          const v = tables.versions.get(String(l.version_id)) || {};
          const loc =
            Array.from(tables.locations.values()).find(
              (lc) => lc.doc_id === p.doc_id && lc.is_active_primary
            ) || {};
          return {
            ...l,
            doc_id: p.doc_id,
            extraction_revision_id: p.extraction_revision_id,
            section_paragraph_path: p.section_paragraph_path,
            physical_page_start: p.physical_page_start,
            physical_page_end: p.physical_page_end,
            printed_page_start: p.printed_page_start,
            printed_page_end: p.printed_page_end,
            anchors: p.anchors,
            access_scope: p.access_scope,
            issuer_id: d.issuer_id,
            source_family: d.source_family,
            record_type: d.record_type,
            access_permission: d.access_permission,
            access_conditions_th: d.access_conditions_th,
            effective_from: v.effective_from,
            publication_date: v.publication_date,
            link_health: loc.link_health || "verified_online",
            last_successful_verified_at: loc.last_successful_verified_at || null,
          };
        });
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_audit_event WHERE correlation_id = ANY")) {
      const ids = new Set((params[0] as string[]) || []);
      const rows = tables.audits.filter((a) => ids.has(String(a.correlation_id)));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.startsWith("SELECT passage_id FROM citation_evidence_passage")) {
      const rows = Array.from(tables.passages.keys()).map((pid) => ({ passage_id: pid }));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_evidence_passage p") && q.includes("WHERE p.passage_id = $1")) {
      const pid = String(params[0]);
      const p = tables.passages.get(pid);
      if (!p) return { rows: [] as T[], rowCount: 0 };
      const d = tables.documents.get(String(p.doc_id)) || {};
      const v = tables.versions.get(String(p.version_id)) || {};
      const ext = tables.extractions.get(String(p.extraction_revision_id)) || {};
      const loc =
        Array.from(tables.locations.values()).find(
          (lc) => lc.doc_id === p.doc_id && lc.is_active_primary
        ) || {};
      return {
        rows: [{ ...d, ...v, ...ext, ...loc, ...p }] as T[],
        rowCount: 1,
      };
    }
    if (q.includes("FROM citation_legal_review_feedback")) {
      const rows = Array.from(tables.feedback.values());
      return { rows: rows as T[], rowCount: rows.length };
    }

    return { rows: [] as T[], rowCount: 0 };
  };

  const snapshot = () => JSON.parse(
    JSON.stringify({
      documents: Array.from(tables.documents.entries()),
      versions: Array.from(tables.versions.entries()),
      locations: Array.from(tables.locations.entries()),
      extractions: Array.from(tables.extractions.entries()),
      passages: Array.from(tables.passages.entries()),
      answers: Array.from(tables.answers.entries()),
      claims: Array.from(tables.claims.entries()),
      links: Array.from(tables.links.entries()),
      audits: tables.audits,
      feedback: Array.from(tables.feedback.entries()),
    })
  );

  const restoreFromSnapshot = (snap: ReturnType<typeof snapshot>) => {
    tables.documents = new Map(snap.documents);
    tables.versions = new Map(snap.versions);
    tables.locations = new Map(snap.locations);
    tables.extractions = new Map(snap.extractions);
    tables.passages = new Map(snap.passages);
    tables.answers = new Map(snap.answers);
    tables.claims = new Map(snap.claims);
    tables.links = new Map(snap.links);
    tables.audits = [...snap.audits];
    tables.feedback = new Map(snap.feedback);
  };

  return { transport, tables, snapshot, restoreFromSnapshot };
}

describe("Batch 1 Material Readiness Gates: Protection, Historical Accuracy Across Paths, Durable Citations & Challenging Tax Suite", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
    process.env.REG24_USE_B01_RC2_PREVIEW_STORE = "1";
    setDefaultKnowledgeStoreForTesting(null);
    clearProtectedStoreSidecarForTesting();
    setCustomCitationDbTransportForTesting(null);
    delete process.env.REG24_ADMIN_ROLE_SECRET;
  });

  afterEach(() => {
    delete process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
    setDefaultKnowledgeStoreForTesting(null);
    clearProtectedStoreSidecarForTesting();
    setCustomCitationDbTransportForTesting(null);
    delete process.env.REG24_ADMIN_ROLE_SECRET;
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignore Windows temp file lock lag
      }
    }
  });

  it("Material Issue 1a: Plausible conclusion without valid evidence CANNOT be labelled or saved as supported; user facts & abstentions are never marked supported/VERIFIED", async () => {
    const { dir, store } = cloneCanonicalStoreToTemp("reg24-mat1a-");
    tempDirs.push(dir);

    // 1. User-supplied facts must carry `user_supplied_unverified`, NEVER `supported`
    const envWithFacts = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "บริษัทมีรายได้ 50 ล้านบาท จะหักรายจ่ายตามมาตราใด",
      as_of_date: "2026-01-15",
      release_id: "rel.B01.rc5",
      actor: USER_A,
      authorized_candidate_ids: new Set(),
      proposed_claims: [
        {
          text: "บริษัทสามารถหักรายจ่ายเหมาได้ร้อยละ 60 โดยไม่ต้องมีหลักฐาน",
          claim_type: "legal_proposition",
          support_groups: [],
        },
      ],
      user_supplied_facts: ["บริษัทมีรายได้ 50 ล้านบาท"],
    });
    expect(envWithFacts.status).toBe("insufficient");
    expect(
      envWithFacts.claims.some((c) => c.verification_decision === "supported")
    ).toBe(false);

    // 2. Forged client POST to `/api/v1/knowledge/answers` claiming `status: "complete"` & `verification_decision: "supported"` without valid server passage -> 422 REJECTED!
    const forgedReq = new Request("http://localhost/api/v1/knowledge/answers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-reg24-actor-id": USER_A.actor_id,
      },
      body: JSON.stringify({
        question_text: "คำถามที่พยายามปลอมสถานะ supported",
        traceable_answer: {
          schema_version: "reg24.citation-traceability.v1",
          answer_id: "ans.forged.plausible",
          answer_revision: "ans.forged.plausible.r1",
          revision_number: 1,
          supersedes_answer_revision: null,
          channel: "saved_answer",
          generated_at: new Date().toISOString(),
          as_of_date: "2026-05-01",
          status: "complete",
          rendered_answer_th: "[1] ข้อสรุปที่ดูสมเหตุสมผลแต่ไม่มีหลักฐานรองรับจริง",
          user_supplied_facts: [],
          assumptions: [],
          claims: [
            {
              claim_id: "clm.forged.1",
              claim_number: 1,
              text: "ข้อสรุปที่ดูสมเหตุสมผลแต่ไม่มีหลักฐานรองรับจริง",
              claim_type: "legal_proposition",
              claim_type_label_th: "ข้อกฎหมาย",
              premise_ids: [],
              verification_decision: "supported",
              published: true,
              withheld_explanation_th: null,
              evidence_references: [
                {
                  link_id: "cel.fake.1",
                  evidence_id: "epsg.nonexistent_999999",
                  doc_id: "odoc.fake",
                  version_id: "over.fake",
                  extraction_revision_id: "erev.fake",
                  support_role: "primary_authority",
                  support_role_label_th: "หลักฐานหลัก",
                  required_group: "g1",
                  citation_label_th: "ปลอม",
                  issuer_name_th: "กรมสรรพากร",
                  source_family: "revenue_department_ruling",
                  source_family_label_th: "หนังสือตอบข้อหารือ",
                  record_type: "full_record",
                  record_type_label_th: "ฉบับเต็ม",
                  date_relied_on: "2026-05-01",
                  official_url: "https://www.rd.go.th/fake.html",
                  official_url_with_anchor: "https://www.rd.go.th/fake.html",
                  resolver_url: "/api/v1/knowledge/evidence/epsg.nonexistent_999999",
                  locator: {
                    human_pinpoint_th: "หน้า 1",
                    section_paragraph_path: [],
                    physical_page_start: 1,
                    physical_page_end: 1,
                    printed_page_start: "1",
                    printed_page_end: "1",
                    anchors: [],
                  },
                  verification_status: "supported",
                  link_health: "verified_online",
                  link_health_notice_th: null,
                  last_successful_verification_at: null,
                  access_permission: "public",
                  access_conditions_th: null,
                },
              ],
            },
          ],
          unresolved_issues: [],
          legacy_warning_th: null,
          verifier_metadata: {
            verifier_version: "forged",
            ruleset_version: "forged",
            release_id: "rel.B01.rc5",
            publication_gate_mode: "enforced",
          },
        },
      }),
    });
    const forgedRes = await answersPost(forgedReq);
    expect(forgedRes.status).toBe(422);

    // 3. Abstention answers in `queryKnowledge` never label `abstention_notice` as `VERIFIED`
    const outOfScope = await queryKnowledge(
      {
        question:
          "ลูกจ้างทำงานครบ 3 ปี นายจ้างเลิกจ้างต้องจ่ายค่าชดเชยตามพระราชบัญญัติคุ้มครองแรงงานเท่าใด",
      },
      USER_A,
      { store }
    );
    expect(outOfScope.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(outOfScope.claims.every((c) => c.verification_result !== "VERIFIED")).toBe(true);

    // 4. Legal Review Feedback API blocks `PASS_SUPPORTED` when plausible conclusion has 0 evidence IDs or source was not checked!
    const badPassNoCheck = await legalFeedbackPost(
      new Request("http://localhost/api/v1/knowledge/legal-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: "คำถามทดสอบ",
          answer_status: "ANSWERED",
          reviewer_name: "Legal Counsel",
          verdict: "PASS_SUPPORTED",
          checked_original_source: false,
          cited_evidence_ids: ["psg.some"],
        }),
      })
    );
    expect(badPassNoCheck.status).toBe(422);

    const badPassZeroEvidence = await legalFeedbackPost(
      new Request("http://localhost/api/v1/knowledge/legal-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: "คำถามที่สรุปโดยไม่มีหลักฐาน",
          answer_status: "ANSWERED",
          reviewer_name: "Legal Counsel",
          verdict: "PASS_SUPPORTED",
          checked_original_source: true,
          cited_evidence_ids: [],
        }),
      })
    );
    expect(badPassZeroEvidence.status).toBe(422);
  });

  it("Material Issue 1b: Prevents overwriting another user's answer (403 FORBIDDEN), blocks unauthenticated role spoofing, and retains an auditable revision history (r1 -> r2 -> r3)", async () => {
    const { dir, store } = cloneCanonicalStoreToTemp("reg24-mat1b-");
    tempDirs.push(dir);

    // Anti-spoofing check when REG24_ADMIN_ROLE_SECRET is active
    process.env.REG24_ADMIN_ROLE_SECRET = "test-admin-secret-xyz";
    const spoofedActor = resolveServerActor(
      new Request("http://localhost/api/v1/knowledge/answers", {
        headers: { "x-reg24-actor-role": "legal_reviewer" },
      })
    );
    expect(spoofedActor.role).toBe("reader");
    const verifiedAdminActor = resolveServerActor(
      new Request("http://localhost/api/v1/knowledge/answers", {
        headers: {
          "x-reg24-actor-role": "legal_reviewer",
          "x-reg24-admin-secret": "test-admin-secret-xyz",
        },
      })
    );
    expect(verifiedAdminActor.role).toBe("legal_reviewer");
    delete process.env.REG24_ADMIN_ROLE_SECRET;

    // User A generates and saves verified answer `r1`
    const ansA = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
        applicable_date: "2026-02-15",
        mode: "exact_lookup",
      },
      USER_A,
      { store }
    );
    const savedR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: ansA.traceable_answer!,
      question_text: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
      revision_reason: "บันทึกคำตอบเริ่มต้นของทนาย A",
      actor: USER_A,
    });
    expect(savedR1.revision_number).toBe(1);
    expect(savedR1.owner_actor_id).toBe(USER_A.actor_id);

    // User B attempts to overwrite/modify User A's `answer_id` -> 403 FORBIDDEN + security audit event!
    await expect(
      saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: {
          ...savedR1,
          as_of_date: "2026-06-01",
        },
        question_text: "พยายามเขียนทับคำตอบของผู้อื่น",
        actor: USER_B,
      })
    ).rejects.toThrow(/ANSWER_OWNERSHIP_FORBIDDEN_403/);

    // Owner User A updates the answer -> creates `r2` WITHOUT overwriting `r1`!
    const savedR2 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: {
        ...savedR1,
        as_of_date: "2026-08-01",
      },
      question_text: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636 (ปรับวันที่อ้างอิง)",
      revision_reason: "ปรับปรุงขอบเขตวันที่อ้างอิงเป็น ส.ค. 2569",
      actor: USER_A,
    });
    expect(savedR2.revision_number).toBe(2);
    expect(savedR2.supersedes_answer_revision).toBe(savedR1.answer_revision);

    // Authorized legal_reviewer appends `r3` while preserving original `owner_actor_id`!
    const primaryEvId = savedR1.claims[0].evidence_references[0].evidence_id;
    const savedR3 = approveDocumentedAmbiguityWithEvidence(store, {
      prior_answer_revision: savedR2.answer_revision,
      claim_text_th:
        "ผู้ประกอบการได้รับสิทธิอัตราร้อยละ 0 ตามเงื่อนไขโครงการความช่วยเหลือใน กค 0702/636",
      claim_type: "interpretation",
      evidence_ids: [primaryEvId],
      reviewer: LEGAL_REVIEWER,
      justification_th: "หัวหน้าทีมกฎหมายตรวจรับรองถ้อยคำตามต้นฉบับ",
    });
    expect(savedR3.revision_number).toBe(3);
    expect(savedR3.owner_actor_id).toBe(USER_A.actor_id);

    // Reopen `r1` -> still preserved verbatim; reopen by `answer_id` -> returns `r3` with full 3-entry `revision_history`!
    const checkR1 = reopenSavedTraceableAnswer(store, savedR1.answer_revision, USER_A);
    expect(checkR1.found).toBe(true);
    expect(checkR1.answer?.as_of_date).toBe("2026-02-15");

    const checkLatest = reopenSavedTraceableAnswer(store, savedR1.answer_id, USER_A);
    expect(checkLatest.answer?.revision_number).toBe(3);
    expect(checkLatest.answer?.revision_history?.map((h) => h.revision_number)).toEqual([1, 2, 3]);
  });

  it("Material Issue 1c: Official law or regulation attachment is accepted when origin, applicable version, and section/page verify, and rejected when any of the three is missing", async () => {
    const validAttachmentText =
      "ราชกิจจานุเบกษา เล่ม ๑๔๐ ตอนที่ ๔๙ ก พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ให้ยกเว้นภาษีเงินได้นิติบุคคลเป็นจำนวนร้อยละหนึ่งร้อยของรายจ่ายเพื่อการลงทุนในระบบอัตโนมัติ ตั้งแต่วันที่ 1 มกราคม พ.ศ. 2566 ถึงวันที่ 31 ธันวาคม พ.ศ. 2568";

    // 1. Rejects third-party / non-official origin URL
    const badOriginRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) มาตรา 4",
          original_title_th: "พระราชกฤษฎีกาฯ (ฉบับที่ 779) พ.ศ. 2566",
          official_origin_url: "https://random-tax-forum.example.com/rd779.pdf",
          effective_from: "2023-08-18",
          section_label: "มาตรา 4",
          physical_page_one_based: 3,
          attachment_text: validAttachmentText,
        }),
      })
    );
    expect(badOriginRes.status).toBe(422);

    // 2. Rejects missing applicable version (`effective_from` & `publication_date` both null)
    const badVersionRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) มาตรา 4",
          original_title_th: "พระราชกฤษฎีกาฯ (ฉบับที่ 779) พ.ศ. 2566",
          official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-779-2566.pdf",
          effective_from: null,
          publication_date: null,
          section_label: "มาตรา 4",
          physical_page_one_based: 3,
          attachment_text: validAttachmentText,
        }),
      })
    );
    expect(badVersionRes.status).toBe(422);

    // 3. Rejects mismatched section locator (`มาตรา 99` not in attachment)
    const badSectionRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) มาตรา 4",
          original_title_th: "พระราชกฤษฎีกาฯ (ฉบับที่ 779) พ.ศ. 2566",
          official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-779-2566.pdf",
          effective_from: "2023-08-18",
          section_label: "มาตรา 99",
          physical_page_one_based: 3,
          attachment_text: validAttachmentText,
        }),
      })
    );
    expect(badSectionRes.status).toBe(422);

    // 4. Accepts valid official law attachment and cites it with `verified_attachment_authority`!
    const okRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4",
          original_title_th:
            "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566",
          official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-779-2566.pdf",
          royal_gazette_ref: "เล่ม ๑๔๐ ตอนที่ ๔๙ ก",
          publication_date: "2023-08-17",
          effective_from: "2023-08-18",
          section_label: "มาตรา 4",
          physical_page_one_based: 3,
          printed_page_label: "๓",
          attachment_text: validAttachmentText,
        }),
      })
    );
    expect(okRes.status).toBe(200);
    const okJson = await okRes.json();
    expect(okJson.verification_checks).toEqual({
      origin_verified: true,
      applicable_version_verified: true,
      section_or_page_verified: true,
    });

    const qRes = await queryPost(
      new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            "สิทธิยกเว้นภาษีเงินได้นิติบุคคลสำหรับระบบอัตโนมัติตามเอกสารแนบกำหนดไว้อย่างไร",
          applicable_date: "2024-06-01",
          attachment_doc_ids: [okJson.doc_id],
        }),
      })
    );
    const qJson = await qRes.json();
    expect(qJson.answer.status).toBe("ANSWERED");
    expect(qJson.traceable_answer.status).toBe("complete");
    expect(qJson.traceable_answer.claims[0].evidence_references[0].support_role).toBe(
      "verified_attachment_authority"
    );
    expect(
      qJson.traceable_answer.claims[0].evidence_references[0].locator.human_pinpoint_th
    ).toContain("มาตรา 4");
  });

  it("Material Issue 2: Applies consistent historical date & legal-version checks across ALL answer paths (Query API, Onboarded Sources, Legal Research, Reports, Legal Analyze, and MCP)", async () => {
    // 2A. Uncertain yearless partial date ("เมื่อวันที่ 15 มิถุนายน") -> NEEDS_CLARIFICATION across ALL paths!
    const partialDateQ =
      "บริษัทจ่ายเงินบริจาคให้สถานศึกษาเมื่อวันที่ 15 มิถุนายน หักรายจ่ายตามประมวลรัษฎากร มาตรา 65 ตรี ได้เท่าไร?";

    const qApi = await (
      await queryPost(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: partialDateQ }),
        })
      )
    ).json();
    expect(qApi.answer.status).toBe("NEEDS_CLARIFICATION");

    const qResearch = await (
      await legalResearchPost(
        new NextRequest("http://localhost/api/v1/legal-research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: partialDateQ }),
        })
      )
    ).json();
    expect(qResearch.grounded_status).toBe("NEEDS_CLARIFICATION");
    expect(qResearch.clarification_questions.length).toBeGreaterThan(0);

    const qReport = await (
      await reportGeneratePost(
        new NextRequest("http://localhost/api/v1/reports/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query_or_topic: partialDateQ }),
        })
      )
    ).json();
    expect(qReport.grounded_status).toBe("NEEDS_CLARIFICATION");

    const qAnalyze = await (
      await legalAnalyzePost(
        new NextRequest("http://localhost/api/v1/legal/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: partialDateQ }),
        })
      )
    ).json();
    expect(qAnalyze.grounded_status).toBe("NEEDS_CLARIFICATION");

    const qMcp = await (
      await mcpPost(
        new NextRequest("http://localhost/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "mcp-mat2",
            method: "tools/call",
            params: {
              name: "reg24.citations.ask_traceable",
              arguments: { question: partialDateQ },
            },
          }),
        })
      )
    ).json();
    expect(qMcp.result.structuredContent.grounded_status).toBe("NEEDS_CLARIFICATION");

    // 2B. Pre-amendment straddling accounting period (`1 กรกฎาคม 2560 ถึง 30 มิถุนายน 2561`, start < `1 มกราคม 2561` cutoff) -> INSUFFICIENT_EVIDENCE across ALL paths!
    const preAmendQ =
      "บริษัทมีรอบระยะเวลาบัญชีเริ่มวันที่ 1 กรกฎาคม 2560 ถึงวันที่ 30 มิถุนายน 2561 บริจาคเงินให้พรรคการเมือง หักรายจ่ายตามประมวลรัษฎากร มาตรา 65 ตรี (3)(ก) ได้หรือไม่?";

    const preQuery = await (
      await queryPost(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: preAmendQ }),
        })
      )
    ).json();
    expect(preQuery.answer.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(preQuery.traceable_answer.claims.length).toBe(0);

    const preResearch = await (
      await legalResearchPost(
        new NextRequest("http://localhost/api/v1/legal-research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: preAmendQ }),
        })
      )
    ).json();
    expect(preResearch.grounded_status).toBe("INSUFFICIENT_EVIDENCE");
    expect(preResearch.traceable_answer.claims.length).toBe(0);

    // 2C. Multi-version onboarded statute (`ป.พ.พ. มาตรา 1097`) without date or with straddling year -> NEEDS_CLARIFICATION instead of guessing latest!
    const { dir, store } = cloneCanonicalStoreToTemp("reg24-mat2c-");
    tempDirs.push(dir);

    const v1 = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ป.พ.พ. มาตรา 1097",
      original_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097",
      observed_url: "https://ratchakitcha.soc.go.th/documents/ccc-1097-v1.pdf",
      mime_type: "application/pdf",
      captured_bytes:
        "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
      effective_from: "2008-07-01",
      effective_to: "2023-02-06",
    });
    onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ป.พ.พ. มาตรา 1097",
      original_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097",
      observed_url: "https://ratchakitcha.soc.go.th/documents/ccc-1097-v2.pdf",
      mime_type: "application/pdf",
      captured_bytes:
        "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
      effective_from: "2023-02-07",
      predecessor_version_id: v1.version.version_id,
      is_verified_amendment: true,
    });

    // Missing date on multi-version statute -> asks for clarification!
    const missingDateOnMultiVer = await queryKnowledge(
      { question: "จำนวนผู้เริ่มก่อการตาม ป.พ.พ. มาตรา 1097 คือเท่าไร" },
      USER_A,
      { store }
    );
    expect(missingDateOnMultiVer.status).toBe("NEEDS_CLARIFICATION");
    expect(missingDateOnMultiVer.traceable_answer?.claims.length).toBe(0);

    // Straddling year ("ในปี 2566" -> 2023-01-01..2023-12-31 straddles 2023-02-07) -> asks for clarification!
    const straddlingYearAns = await queryKnowledge(
      { question: "การจดทะเบียนตั้งบริษัทในปี 2566 ตาม ป.พ.พ. มาตรา 1097 ต้องมีผู้เริ่มก่อการกี่คน" },
      USER_A,
      { store }
    );
    expect(straddlingYearAns.status).toBe("NEEDS_CLARIFICATION");

    // Inline Thai date ("เมื่อวันที่ 15 มิถุนายน 2564" -> 2021-06-15) even without `applicable_date` -> selects v1 ("สามคนขึ้นไป")!
    const inlineThaiDateAns = await queryKnowledge(
      { question: "การตั้งบริษัทเมื่อวันที่ 15 มิถุนายน 2564 ตาม ป.พ.พ. มาตรา 1097 ใช้ผู้เริ่มก่อการกี่คน" },
      USER_A,
      { store }
    );
    expect(inlineThaiDateAns.status).toBe("ANSWERED");
    expect(inlineThaiDateAns.traceable_answer?.claims[0].text).toContain("สามคนขึ้นไป");

    // Date prior to earliest verified version ("เมื่อวันที่ 1 มกราคม 2540" < 2008-07-01) -> INSUFFICIENT_EVIDENCE!
    const priorToEarliestAns = await queryKnowledge(
      { question: "การตั้งบริษัทเมื่อวันที่ 1 มกราคม 2540 ตาม ป.พ.พ. มาตรา 1097 ใช้ผู้เริ่มก่อการกี่คน" },
      USER_A,
      { store }
    );
    expect(priorToEarliestAns.status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("Material Issue 3: Citations, verified attachments, answer revisions (r1 -> r2), ownership locks, and Legal Team feedback survive restarts, separate deployments, and backup/restore", async () => {
    const pgSim = createInMemoryPostgresSimulator();
    setCustomCitationDbTransportForTesting(pgSim.transport);

    // Deployment / Container A: onboard attachment, generate & save `r1` and `r2`, record Legal Team feedback
    const { dir: dirA, store: storeA } = cloneCanonicalStoreToTemp("reg24-depA-");
    tempDirs.push(dirA);

    const attRes = await attachmentsPost(
      new Request("http://deployment-a.vercel.app/api/v1/knowledge/attachments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": USER_A.actor_id,
        },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 780) มาตรา 5",
          original_title_th: "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร (ฉบับที่ 780) พ.ศ. 2566",
          official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-780-2566.pdf",
          publication_date: "2023-09-01",
          effective_from: "2023-09-02",
          section_label: "มาตรา 5",
          physical_page_one_based: 2,
          printed_page_label: "๒",
          attachment_text:
            "ราชกิจจานุเบกษา พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร (ฉบับที่ 780) พ.ศ. 2566 มาตรา 5 ให้ยกเว้นภาษีมูลค่าเพิ่มสำหรับการโอนสินทรัพย์ดิจิทัลเพื่อการลงทุนตามหลักเกณฑ์ที่ประกาศกำหนด",
        }),
      })
    );
    const attJson = await attRes.json();
    expect(attJson.ok).toBe(true);

    // Query using the default store on Container A, then save `r1` and `r2`
    const defaultStore = getDefaultKnowledgeStore();
    const ansOnA = await queryKnowledge(
      {
        question: "สิทธิยกเว้นภาษีมูลค่าเพิ่มตาม พระราชกฤษฎีกา (ฉบับที่ 780) มาตรา 5 คืออะไร",
        applicable_date: "2024-05-01",
        attachment_doc_ids: [attJson.doc_id],
      },
      USER_A,
      { store: defaultStore }
    );
    expect(ansOnA.traceable_answer?.status).toBe("complete");

    const r1 = await saveOrReviseAnswerServerVerified(defaultStore, {
      submitted_envelope: ansOnA.traceable_answer!,
      question_text: "สิทธิยกเว้นภาษีตาม พ.ร.ฎ. 780 มาตรา 5",
      revision_reason: "บันทึกคำตอบ r1 บน Deployment A",
      actor: USER_A,
    });
    const r2 = await saveOrReviseAnswerServerVerified(defaultStore, {
      submitted_envelope: { ...r1, as_of_date: "2025-01-10" },
      question_text: "สิทธิยกเว้นภาษีตาม พ.ร.ฎ. 780 มาตรา 5 (ทบทวนปี 2568)",
      revision_reason: "ทบทวนขอบเขตวันที่เป็น r2 บน Deployment A",
      actor: USER_A,
    });
    expect(r2.revision_number).toBe(2);

    const fbRes = await legalFeedbackPost(
      new Request("http://deployment-a.vercel.app/api/v1/knowledge/legal-feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": LEGAL_REVIEWER.actor_id,
        },
        body: JSON.stringify({
          scenario_id: "LSC-COMPLEX-08",
          question_text: "สิทธิยกเว้นภาษีตาม พ.ร.ฎ. 780 มาตรา 5",
          as_of_date: "2025-01-10",
          answer_revision_id: r2.answer_revision,
          answer_status: "ANSWERED",
          reviewer_name: "Dodo Legal Review",
          verdict: "PASS_SUPPORTED",
          checked_original_source: true,
          comments_th: "ตรวจสอบต้นฉบับหน้า ๒ มาตรา 5 ตรงทุกประการ",
          cited_evidence_ids: [attJson.passage_id],
        }),
      })
    );
    expect(fbRes.status).toBe(200);

    // Take PITR backup snapshot BEFORE simulated disaster!
    const backupSnapshot = pgSim.snapshot();

    // Deployment / Container B: Brand-new empty local overlay store (`storeB` has ZERO local saved answers or attachments!)
    const { dir: dirB, store: storeB } = cloneCanonicalStoreToTemp("reg24-depB-fresh-");
    tempDirs.push(dirB);
    expect(storeB.getState().citation_ledger).toBeUndefined();

    // 1. Reopen `r2` and `r1` on fresh Container B via PostgreSQL!
    const reopenedOnB = await reopenSavedTraceableAnswerWithPostgres(
      storeB,
      r1.answer_id,
      USER_A
    );
    expect(reopenedOnB.found).toBe(true);
    expect(reopenedOnB.answer?.answer_revision).toBe(r2.answer_revision);
    expect(reopenedOnB.answer?.revision_history?.length).toBe(2);
    expect(reopenedOnB.audit_events?.length).toBeGreaterThanOrEqual(2);

    // 2. Resolve pinned attachment evidence `attJson.passage_id` on fresh Container B!
    const resolvedOnB = await resolveTraceableEvidenceWithPostgres(
      storeB,
      attJson.passage_id,
      USER_A
    );
    expect(resolvedOnB.ok).toBe(true);
    expect(resolvedOnB.evidence?.verbatim_quote).toContain("ฉบับที่ 780");

    // 3. Cross-user overwrite from Container B by USER_B is STILL blocked with 403 via PostgreSQL ownership check!
    await expect(
      saveOrReviseAnswerServerVerified(storeB, {
        submitted_envelope: reopenedOnB.answer!,
        question_text: "Cross-deployment overwrite attempt",
        actor: USER_B,
      })
    ).rejects.toThrow(/ANSWER_OWNERSHIP_FORBIDDEN_403/);

    // 4. Simulate catastrophic wipe & PITR Restore into Container C -> verify 100% survival of answers, citations, and feedback!
    pgSim.tables.answers.clear();
    pgSim.tables.claims.clear();
    pgSim.tables.links.clear();
    pgSim.tables.passages.clear();
    pgSim.tables.feedback.clear();

    pgSim.restoreFromSnapshot(backupSnapshot);

    const { dir: dirC, store: storeC } = cloneCanonicalStoreToTemp("reg24-depC-restored-");
    tempDirs.push(dirC);

    const restoredAnswer = await reopenSavedTraceableAnswerWithPostgres(
      storeC,
      r2.answer_revision,
      USER_A
    );
    expect(restoredAnswer.found).toBe(true);
    expect(restoredAnswer.answer?.claims[0].evidence_references[0].evidence_id).toBe(
      attJson.passage_id
    );

    const restoredFbRes = await legalFeedbackGet(
      new Request("http://deployment-c.vercel.app/api/v1/knowledge/legal-feedback")
    );
    const restoredFbJson = await restoredFbRes.json();
    expect(restoredFbJson.storage_backend).toBe("neon_postgres");
    expect(restoredFbJson.feedback.length).toBe(1);
    expect(restoredFbJson.feedback[0].answer_revision_id).toBe(r2.answer_revision);

    // Also verify HTTP routes (`GET /answers`, `GET /answers/[id]`, `GET /answers/[id]/export`, `GET /evidence/[id]`)
    const listRes = await answersGet(
      new Request("http://deployment-c.vercel.app/api/v1/knowledge/answers")
    );
    const listJson = await listRes.json();
    expect(
      listJson.saved_answers.some(
        (s: { answer_revision: string }) => s.answer_revision === r2.answer_revision
      )
    ).toBe(true);

    const byIdRes = await answerByIdGet(
      new Request(`http://deployment-c.vercel.app/api/v1/knowledge/answers/${r2.answer_revision}`),
      { params: Promise.resolve({ id: r2.answer_revision }) }
    );
    const byIdJson = await byIdRes.json();
    expect(byIdJson.revision_history.length).toBe(2);

    const expRes = await answerExportGet(
      new Request(
        `http://deployment-c.vercel.app/api/v1/knowledge/answers/${r2.answer_revision}/export?format=markdown`
      ),
      { params: Promise.resolve({ id: r2.answer_revision }) }
    );
    expect(expRes.status).toBe(200);
    expect(await expRes.text()).toContain(attJson.passage_id);

    const evRes = await evidenceByIdGet(
      new Request(`http://deployment-c.vercel.app/api/v1/knowledge/evidence/${attJson.passage_id}`),
      { params: Promise.resolve({ id: attJson.passage_id }) }
    );
    expect(evRes.status).toBe(200);
  });

  it("Challenging Realistic Thai Tax Suite: Reason through multi-step cases, exceptions, changing facts, missing info, 3-turn follow-ups, and out-of-scope guards", async () => {
    const { dir, store } = cloneCanonicalStoreToTemp("reg24-complex-tax-");
    tempDirs.push(dir);

    expect(CHALLENGING_THAI_TAX_SCENARIOS.length).toBeGreaterThanOrEqual(12);

    // 1. Exceptions (`LSC-COMPLEX-02`): 2545 2-year memo + Section 19 up-to-5-year evasion proviso
    const scException = CHALLENGING_THAI_TAX_SCENARIOS.find(
      (s) => s.scenario_id === "LSC-COMPLEX-02"
    )!;
    const ansException = await queryKnowledge(
      { question: scException.question_th, applicable_date: scException.as_of_date },
      USER_A,
      { store }
    );
    expect(ansException.answer).toContain("2 ปี");
    expect(ansException.answer).toContain("5 ปี");
    expect(ansException.evidence.length).toBeGreaterThanOrEqual(2);

    // 2. Changing facts (`LSC-COMPLEX-03`): branch in Thailand uses exported service -> CONDITIONAL disqualifier!
    const scChanging = CHALLENGING_THAI_TAX_SCENARIOS.find(
      (s) => s.scenario_id === "LSC-COMPLEX-03"
    )!;
    const ansChanging = await queryKnowledge(
      { question: scChanging.question_th, applicable_date: scChanging.as_of_date },
      USER_A,
      { store }
    );
    expect(["CONDITIONAL", "NEEDS_CLARIFICATION"]).toContain(ansChanging.status);
    expect(ansChanging.answer).toContain("ไม่เข้าเงื่อนไขการได้รับสิทธิเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0");

    // 3. Missing decisive information (`LSC-COMPLEX-06`): unknown whether software used in Thailand -> NEEDS_CLARIFICATION!
    const scMissing = CHALLENGING_THAI_TAX_SCENARIOS.find(
      (s) => s.scenario_id === "LSC-COMPLEX-06"
    )!;
    const ansMissing = await queryKnowledge(
      { question: scMissing.question_th, applicable_date: scMissing.as_of_date },
      USER_A,
      { store }
    );
    expect(ansMissing.status).toBe("NEEDS_CLARIFICATION");
    expect(ansMissing.clarification_questions.length).toBeGreaterThan(0);

    // 4. Multi-turn 3-step follow-up reasoning (`LSC-COMPLEX-07`): Turn 1 -> Turn 2 (changing fact) -> Turn 3 (vague historical period)
    const scFollow = CHALLENGING_THAI_TAX_SCENARIOS.find(
      (s) => s.scenario_id === "LSC-COMPLEX-07"
    )!;
    const turn1 = await queryKnowledge(
      { question: scFollow.question_th, applicable_date: scFollow.as_of_date },
      USER_A,
      { store }
    );
    expect(turn1.evidence.length).toBeGreaterThan(0);

    const turn2 = await queryKnowledge(
      {
        question: scFollow.follow_up_turns![0].question_th,
        conversation_history: [
          { role: "user", content: scFollow.question_th, applicable_date: scFollow.as_of_date },
          { role: "assistant", content: turn1.answer },
        ],
      },
      USER_A,
      { store }
    );
    expect(["CONDITIONAL", "NEEDS_CLARIFICATION"]).toContain(turn2.status);
    expect(turn2.assumptions.some((a) => a.includes("วิเคราะห์ต่อเนื่อง"))).toBe(true);

    const turn3 = await queryKnowledge(
      {
        question: scFollow.follow_up_turns![1].question_th,
        conversation_history: [
          { role: "user", content: scFollow.question_th, applicable_date: scFollow.as_of_date },
          { role: "assistant", content: turn1.answer },
          { role: "user", content: scFollow.follow_up_turns![0].question_th },
          { role: "assistant", content: turn2.answer },
        ],
      },
      USER_A,
      { store }
    );
    expect(["NEEDS_CLARIFICATION", "INSUFFICIENT_EVIDENCE"]).toContain(turn3.status);

    // 5. Nonexistent ruling (`LSC-COMPLEX-10`) & Out-of-scope labour law (`LSC-COMPLEX-09`)
    const scNonexist = CHALLENGING_THAI_TAX_SCENARIOS.find(
      (s) => s.scenario_id === "LSC-COMPLEX-10"
    )!;
    const ansNonexist = await queryKnowledge({ question: scNonexist.question_th }, USER_A, {
      store,
    });
    expect(ansNonexist.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(ansNonexist.evidence.length).toBe(0);
  });
});
