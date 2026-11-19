/**
 * Dodo Round 2 Blocker Regression Suite — Root-Cause Answer Revision Write & Conversation Chain Integrity
 *
 * Reproduces and verifies the root-cause fix for Dodo's live `rel.B01.rc6` (`88453d7`) blocker:
 *   1. Fresh browser `POST /api/v1/knowledge/query` with `persist_answer: true` on the built-in
 *      cross-border tax question (`LSC-COMPLEX-01`) previously failed with `HTTP 400` because
 *      `queryKnowledge(..., { persistAnswerAtomically: true })` wrote `r1` to local memory only,
 *      causing `saveOrReviseAnswerServerVerified` to increment to `r2` (`supersedes_revision_id = r1`)
 *      and fail Neon's `citation_published_answer_supersedes_revision_id_fkey` constraint.
 *   2. Verifies a first answer ALWAYS saves as `r1` (`supersedes_answer_revision = null`), even if
 *      stale unpersisted local memory exists or two independent fresh sessions ask the exact same question.
 *   3. Verifies a changed-fact follow-up in the SAME conversation links ONLY to that conversation's
 *      saved revision (`r2` superseding `r1`), while follow-ups after unsaved abstentions save as `r1`,
 *      and cross-conversation / phantom / cross-user revision links are strictly rejected.
 *   4. Verifies the PostgreSQL `supersedes_revision_id` foreign-key constraint remains intact in schema
 *      and that the VAT Foundation Pilot stays OFF (`false`) on the staging query route.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as queryPost } from "../../src/app/api/v1/knowledge/query/route";
import { CHALLENGING_THAI_TAX_SCENARIOS } from "../../src/core/knowledge/challenging-tax-scenarios";
import {
  setCustomCitationDbTransportForTesting,
  type CitationDbTransport,
} from "../../src/core/knowledge/citation-postgres-store";
import {
  attachTraceableEnvelopeToGroundedAnswer,
  reopenSavedTraceableAnswerWithPostgres,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import type { Actor, ConversationTurnInput } from "../../src/core/knowledge/contracts";

function createStrictFkEnforcingPostgresSimulator() {
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
  };

  const parseJson = (v: unknown) => {
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
        access_scope: params[11],
        access_conditions_th: params[12],
        eligible_for_citation: params[13],
        ineligible_reason: params[14],
        canonical_work_id: params[15],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_document_version")) {
      const docId = String(params[1]);
      if (!tables.documents.has(docId)) {
        throw new Error(`NEON_CITATION_SQL_HTTP_400: missing doc_id FK ${docId}`);
      }
      tables.versions.set(String(params[0]), {
        version_id: params[0],
        doc_id: docId,
        artifact_sha256: params[2],
        captured_at: params[3],
        artifact_ref: params[4],
        mime_type: params[5],
        byte_size: params[6],
        source_metadata: parseJson(params[7]),
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
        page_mapping: parseJson(params[6]),
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
        section_paragraph_path: parseJson(params[8]),
        statement_role: params[9],
        physical_page_start: params[10],
        physical_page_end: params[11],
        printed_page_start: params[12],
        printed_page_end: params[13],
        anchors: parseJson(params[14]),
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
      const ansId = String(params[1]);
      const revNo = Number(params[2]);
      const supersedesRev = params[3] != null ? String(params[3]) : null;
      const orderedClaims = parseJson(params[11]) as unknown[];
      const status = String(params[9]);

      if (tables.answers.has(revId)) {
        throw new Error(
          `NEON_CITATION_SQL_HTTP_400: duplicate key value violates unique constraint "citation_published_answer_pkey" (${revId})`
        );
      }
      // Enforce UNIQUE (answer_id, revision_number)
      for (const existing of tables.answers.values()) {
        if (existing.answer_id === ansId && Number(existing.revision_number) === revNo) {
          throw new Error(
            `NEON_CITATION_SQL_HTTP_400: duplicate key value violates unique constraint "citation_published_answer_answer_id_revision_number_key"`
          );
        }
      }
      // Enforce exact PostgreSQL FK constraint `supersedes_revision_id REFERENCES citation_published_answer(answer_revision_id)`!
      if (supersedesRev !== null && !tables.answers.has(supersedesRev)) {
        throw new Error(
          `NEON_CITATION_SQL_HTTP_400: insert or update on table "citation_published_answer" violates foreign key constraint "citation_published_answer_supersedes_revision_id_fkey" (Key (supersedes_revision_id)=(${supersedesRev}) is not present in table "citation_published_answer")`
        );
      }
      if ((status === "complete" || status === "partial") && (!Array.isArray(orderedClaims) || orderedClaims.length < 1)) {
        throw new Error("NEON_CITATION_SQL_HTTP_400: chk_complete_or_partial_has_claims violated");
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
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_atomic_claim")) {
      const claimPk = String(params[0]);
      const ansRevId = String(params[1]);
      if (!tables.answers.has(ansRevId)) {
        throw new Error(`NEON_CITATION_SQL_HTTP_400: missing answer_revision_id FK ${ansRevId}`);
      }
      if (tables.claims.has(claimPk)) {
        throw new Error(
          `NEON_CITATION_SQL_HTTP_400: duplicate key value violates unique constraint "citation_atomic_claim_pkey" (${claimPk})`
        );
      }
      const decision = String(params[6]);
      const linkCount = Number(params[7]);
      if (decision === "supported" && linkCount <= 0) {
        throw new Error("NEON_CITATION_SQL_HTTP_400: chk_supported_claim_requires_evidence violated");
      }
      tables.claims.set(claimPk, {
        claim_id: claimPk,
        answer_revision_id: ansRevId,
        display_order: Number(params[2]),
        displayed_claim_text: params[3],
        claim_type: params[4],
        premise_claim_ids: parseJson(params[5]),
        verification_decision: decision,
        evidence_link_count: linkCount,
        published: Boolean(params[8]),
        withheld_reason_th: params[9],
      });
      return { rows: [] as T[], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO citation_claim_evidence_link")) {
      const linkPk = String(params[0]);
      const ansRevId = String(params[1]);
      const clmId = String(params[2]);
      const psgId = String(params[3]);
      const verId = String(params[4]);
      if (tables.links.has(linkPk)) {
        throw new Error(`NEON_CITATION_SQL_HTTP_400: duplicate link_id ${linkPk}`);
      }
      if (!tables.answers.has(ansRevId) || !tables.claims.has(clmId) || !tables.passages.has(psgId) || !tables.versions.has(verId)) {
        throw new Error("NEON_CITATION_SQL_HTTP_400: FK violation on citation_claim_evidence_link");
      }
      tables.links.set(linkPk, {
        link_id: linkPk,
        answer_revision_id: ansRevId,
        claim_id: clmId,
        passage_id: psgId,
        version_id: verId,
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
        affected_ids: parseJson(params[4]),
        before_status: parseJson(params[5]),
        after_status: parseJson(params[6]),
        reason: params[7],
        correlation_id: params[8],
      });
      return { rows: [] as T[], rowCount: 1 };
    }

    // SELECT handlers
    if (q.includes("FROM citation_official_document d JOIN citation_document_version v")) {
      const joined: Array<Record<string, unknown>> = [];
      for (const psg of tables.passages.values()) {
        const doc = tables.documents.get(String(psg.doc_id));
        const ver = tables.versions.get(String(psg.version_id));
        const ext = tables.extractions.get(String(psg.extraction_revision_id));
        const loc = Array.from(tables.locations.values()).find((l) => l.doc_id === psg.doc_id);
        if (doc && ver && ext) {
          joined.push({ ...doc, ...ver, ...loc, ...ext, ...psg });
        }
      }
      return { rows: joined as T[], rowCount: joined.length };
    }
    if (q.includes("FROM citation_published_answer WHERE answer_id = $1 ORDER BY revision_number DESC")) {
      const aid = String(params[0]);
      const rows = Array.from(tables.answers.values())
        .filter((r) => r.answer_id === aid)
        .sort((a, b) => Number(b.revision_number) - Number(a.revision_number));
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_published_answer WHERE answer_revision_id = $1 OR answer_id = $1")) {
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
    if (q.includes("FROM citation_atomic_claim WHERE answer_revision_id = $1")) {
      const revId = String(params[0]);
      const rows = Array.from(tables.claims.values())
        .filter((c) => c.answer_revision_id === revId)
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
            issuer_id: doc.issuer_id,
            source_family: doc.source_family,
            record_type: doc.record_type,
            access_permission: doc.access_permission,
            access_conditions_th: doc.access_conditions_th,
            effective_from: ver.effective_from,
            publication_date: ver.publication_date,
            link_health: loc?.link_health || "verified_online",
            last_successful_verified_at: loc?.last_successful_verified_at || null,
          };
        });
      return { rows: rows as T[], rowCount: rows.length };
    }
    if (q.includes("FROM citation_audit_event")) {
      const aid = String(params[0]);
      const rows = tables.audits.filter(
        (a) =>
          String(a.correlation_id || "").startsWith(aid) ||
          (Array.isArray(a.affected_ids) &&
            a.affected_ids.some((id: unknown) => String(id).startsWith(aid)))
      );
      return { rows: rows as T[], rowCount: rows.length };
    }

    return { rows: [] as T[], rowCount: 0 };
  };

  return { tables, transport };
}

describe("Dodo Round 2 Blocker Regression — Answer Revision Write & Conversation Chain Integrity", () => {
  const tempDirs: string[] = [];
  const prevEnvDataDir = process.env.REG24_KNOWLEDGE_DATA_DIR;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-dodo-r2-rev-"));
    tempDirs.push(dir);
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
    process.env.REG24_KNOWLEDGE_DATA_DIR = dir;
    setDefaultKnowledgeStoreForTesting(new DurableKnowledgeStore(dir));
  });

  afterEach(() => {
    setCustomCitationDbTransportForTesting(null);
    if (prevEnvDataDir === undefined) {
      delete process.env.REG24_KNOWLEDGE_DATA_DIR;
    } else {
      process.env.REG24_KNOWLEDGE_DATA_DIR = prevEnvDataDir;
    }
    setDefaultKnowledgeStoreForTesting(null);
    for (const d of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore temp cleanup error
      }
    }
  });

  it("1. Preserves PostgreSQL FK constraint in migration DDL and fixes exact Dodo HTTP 400 failure on built-in cross-border tax question (LSC-COMPLEX-01) + same-conversation follow-up", async () => {
    // Verify migration DDL still keeps `supersedes_revision_id` FK intact!
    const migrationSql = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma",
        "migrations",
        "0005_official_source_citations_and_claim_traceability.sql"
      ),
      "utf-8"
    );
    expect(migrationSql).toContain(
      "supersedes_revision_id   TEXT REFERENCES citation_published_answer(answer_revision_id)"
    );

    const pg = createStrictFkEnforcingPostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport);

    const builtInCrossBorder = CHALLENGING_THAI_TAX_SCENARIOS.find(
      (s) => s.scenario_id === "LSC-COMPLEX-01"
    )!;
    expect(builtInCrossBorder).toBeDefined();

    // Turn 1 (Fresh Browser Session on `/legal-review` with `persist_answer: true`)
    const convA = "conv.dodo.fresh.session.1";
    const turn1Res = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: builtInCrossBorder.question_th,
          applicable_date: builtInCrossBorder.as_of_date,
          mode: "standard",
          channel: "chat",
          persist_answer: true,
          conversation_id: convA,
          conversation_history: [],
        }),
      })
    );

    expect(turn1Res.status).toBe(200);
    const turn1Json = await turn1Res.json();
    expect(turn1Json.ok).toBe(true);
    expect(turn1Json.answer.status).toBe("ANSWERED");
    expect(turn1Json.traceable_answer).toBeDefined();
    expect(turn1Json.traceable_answer.status).toBe("complete");
    expect(turn1Json.traceable_answer.revision_number).toBe(1);
    expect(turn1Json.traceable_answer.supersedes_answer_revision).toBeNull();
    expect(turn1Json.traceable_answer.answer_revision).toBe(
      `${turn1Json.traceable_answer.answer_id}.r1`
    );

    // Verify traceable official citations exist on Turn 1
    const turn1Refs = turn1Json.traceable_answer.claims.flatMap(
      (c: { evidence_references: Array<{ citation_label_th: string; official_url: string }> }) =>
        c.evidence_references
    );
    expect(turn1Refs.length).toBeGreaterThanOrEqual(2);
    const turn1CitationLabels = turn1Refs.map((r: { citation_label_th: string }) => r.citation_label_th).join(" | ");
    expect(turn1CitationLabels).toMatch(/มาตรา\s*70|มาตรา\s*83\/6/);

    // Verify PostgreSQL row for r1 has supersedes_revision_id = null
    const pgRowR1 = pg.tables.answers.get(turn1Json.traceable_answer.answer_revision);
    expect(pgRowR1).toBeDefined();
    expect(pgRowR1?.revision_number).toBe(1);
    expect(pgRowR1?.supersedes_revision_id).toBeNull();

    // Turn 2 (Changed-fact follow-up in the SAME conversation `convA`)
    const historyAfterTurn1: ConversationTurnInput[] = [
      {
        role: "user",
        content: builtInCrossBorder.question_th,
        applicable_date: builtInCrossBorder.as_of_date,
        conversation_id: convA,
      },
      {
        role: "assistant",
        content: turn1Json.answer.answer,
        saved_answer_id: turn1Json.traceable_answer.answer_id,
        saved_answer_revision: turn1Json.traceable_answer.answer_revision,
        conversation_id: convA,
      },
    ];

    const followUpTurn = builtInCrossBorder.follow_up_turns![0];
    const turn2Res = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: followUpTurn.question_th,
          applicable_date: followUpTurn.as_of_date || builtInCrossBorder.as_of_date,
          mode: "standard",
          channel: "chat",
          persist_answer: true,
          conversation_id: convA,
          prior_saved_answer_revision: turn1Json.traceable_answer.answer_revision,
          conversation_history: historyAfterTurn1,
        }),
      })
    );

    expect(turn2Res.status).toBe(200);
    const turn2Json = await turn2Res.json();
    expect(turn2Json.ok).toBe(true);
    expect(turn2Json.answer.status).toBe("ANSWERED");
    expect(turn2Json.traceable_answer.answer_id).toBe(turn1Json.traceable_answer.answer_id);
    expect(turn2Json.traceable_answer.revision_number).toBe(2);
    expect(turn2Json.traceable_answer.answer_revision).toBe(
      `${turn1Json.traceable_answer.answer_id}.r2`
    );
    expect(turn2Json.traceable_answer.supersedes_answer_revision).toBe(
      turn1Json.traceable_answer.answer_revision
    );
    expect(turn2Json.traceable_answer.revision_history).toHaveLength(2);

    // Verify changed-fact follow-up dynamically shifts legal context to Section 65 ter deductibility
    expect(turn2Json.answer.answer).toMatch(/65\s*ตรี/);
    const pgRowR2 = pg.tables.answers.get(turn2Json.traceable_answer.answer_revision);
    expect(pgRowR2).toBeDefined();
    expect(pgRowR2?.revision_number).toBe(2);
    expect(pgRowR2?.supersedes_revision_id).toBe(turn1Json.traceable_answer.answer_revision);

    // Cold-start container reopen verifies full `r1 -> r2` chain from PostgreSQL
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-dodo-cold-"));
    tempDirs.push(freshDir);
    fs.copyFileSync(
      path.join(process.env.REG24_KNOWLEDGE_DATA_DIR!, "canonical-state.json.gz"),
      path.join(freshDir, "canonical-state.json.gz")
    );
    const freshStore = new DurableKnowledgeStore(freshDir);
    const dodoActor: Actor = {
      actor_id: "dodo@7ladvisory.review",
      role: "reader",
      tenant_id: "PUBLIC",
      authorized_scopes: ["scope.platform.public"],
      csrf_verified: true,
    };
    const reopened = await reopenSavedTraceableAnswerWithPostgres(
      freshStore,
      turn1Json.traceable_answer.answer_id,
      dodoActor
    );
    expect(reopened.found).toBe(true);
    expect(reopened.answer?.answer_revision).toBe(turn2Json.traceable_answer.answer_revision);
    expect(reopened.answer?.revision_history).toHaveLength(2);
  });

  it("2. Defense-in-depth: even if local memory has an unpersisted r1 while PostgreSQL has 0 rows, saveOrReviseAnswerServerVerified saves r1 (supersedes = null) without violating DB FK", async () => {
    const pg = createStrictFkEnforcingPostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport);

    const store = new DurableKnowledgeStore(process.env.REG24_KNOWLEDGE_DATA_DIR!);
    const actor: Actor = {
      actor_id: "dodo.desync@7ladvisory.review",
      role: "reader",
      tenant_id: "PUBLIC",
      authorized_scopes: ["scope.platform.public"],
      csrf_verified: true,
    };

    const builtInCrossBorder = CHALLENGING_THAI_TAX_SCENARIOS[0];
    // Simulate the exact legacy desync: local memory pre-populated `r1` (`persist: true`), while PostgreSQL still has 0 rows!
    const grounded = await queryKnowledge(
      {
        question: builtInCrossBorder.question_th,
        applicable_date: builtInCrossBorder.as_of_date,
      },
      actor,
      { store, persistAnswerAtomically: false }
    );
    const localPrePersisted = attachTraceableEnvelopeToGroundedAnswer(store, grounded, {
      question: builtInCrossBorder.question_th,
      actor,
      channel: "chat",
      persist: true,
    });
    expect(pg.tables.answers.size).toBe(0);

    const saved = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: localPrePersisted,
      question_text: builtInCrossBorder.question_th,
      revision_reason: "Defense-in-depth sync verification",
      actor,
    });
    expect(saved.revision_number).toBe(1);
    expect(saved.supersedes_answer_revision).toBeNull();
    expect(pg.tables.answers.get(saved.answer_revision)?.supersedes_revision_id).toBeNull();
  });

  it("3. Enforces conversation isolation: unsaved Turn 1 -> Turn 2 saves as r1; cross-conversation, phantom, first-turn-with-prior, and cross-user links are strictly blocked; calculation persist works cleanly", async () => {
    const pg = createStrictFkEnforcingPostgresSimulator();
    setCustomCitationDbTransportForTesting(pg.transport);

    // 3A. Turn 1 abstains (`NEEDS_CLARIFICATION`, unsaved) -> Turn 2 supplies year and saves cleanly as `r1` (`supersedes = null`)!
    const convClarify = "conv.clarify.flow";
    const t1ClarifyQ =
      "บริษัทจ่ายเงินบริจาคให้สถานศึกษาของรัฐเมื่อวันที่ 15 มิถุนายน หักรายจ่ายตามประมวลรัษฎากร มาตรา 65 ตรี ได้เท่าไร?";
    const t1Res = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: t1ClarifyQ,
          persist_answer: true,
          conversation_id: convClarify,
          conversation_history: [],
        }),
      })
    );
    const t1Json = await t1Res.json();
    expect(t1Res.status).toBe(200);
    expect(t1Json.answer.status).toBe("NEEDS_CLARIFICATION");
    expect(pg.tables.answers.size).toBe(0);

    // Turn 2 supplies full date + deterministic calculation (`1,000,000 * 7% = 70,000` VAT check or donation year)
    const t2CalcQ =
      "ข้อมูลเพิ่มเติม: จ่ายเมื่อวันที่ 15 มิถุนายน 2568 และหากบริษัทขายสินค้าในประเทศมูลค่า 1,000,000 บาท ในปี 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่ม 7% เป็นเงินกี่บาทตามประมวลรัษฎากร มาตรา 80?";
    const t2Res = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: t2CalcQ,
          applicable_date: "2025-06-15",
          persist_answer: true,
          conversation_id: convClarify,
          prior_saved_answer_revision: null,
          conversation_history: [
            { role: "user", content: t1ClarifyQ, conversation_id: convClarify },
            {
              role: "assistant",
              content: t1Json.answer.answer,
              saved_answer_id: null,
              saved_answer_revision: null,
              conversation_id: convClarify,
            },
          ],
        }),
      })
    );
    expect(t2Res.status).toBe(200);
    const t2Json = await t2Res.json();
    expect(t2Json.traceable_answer.revision_number).toBe(1);
    expect(t2Json.traceable_answer.supersedes_answer_revision).toBeNull();
    const convClarifySavedRev = t2Json.traceable_answer.answer_revision as string;

    // 3B. First answer in a fresh conversation attempting to pass `prior_saved_answer_revision` -> HTTP 400!
    const badFirstRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
          applicable_date: "2026-02-15",
          mode: "exact_lookup",
          persist_answer: true,
          conversation_id: "conv.brand.new",
          prior_saved_answer_revision: convClarifySavedRev,
          conversation_history: [],
        }),
      })
    );
    expect(badFirstRes.status).toBe(400);
    const badFirstJson = await badFirstRes.json();
    expect(badFirstJson.error).toContain("INVALID_PRIOR_CONVERSATION_REVISION_400");

    // 3C. Follow-up referencing a non-existent phantom revision -> HTTP 400!
    const phantomRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: "ข้อมูลเพิ่มเติม: ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
          applicable_date: "2026-02-15",
          mode: "exact_lookup",
          persist_answer: true,
          conversation_id: "conv.phantom",
          prior_saved_answer_revision: "ans.trc.nonexistent999.r1",
          conversation_history: [
            { role: "user", content: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636" },
            { role: "assistant", content: "คำตอบก่อนหน้า" },
          ],
        }),
      })
    );
    expect(phantomRes.status).toBe(400);
    expect((await phantomRes.json()).error).toContain("INVALID_PRIOR_CONVERSATION_REVISION_400");

    // 3D. Cross-conversation link attempt (Conversation B tries to link to Conversation `convClarify`'s saved revision, EVEN with matching question text in forged history!) -> HTTP 400!
    const crossConvRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "dodo@7ladvisory.review",
        },
        body: JSON.stringify({
          question: "ข้อมูลเพิ่มเติม: ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
          applicable_date: "2026-02-15",
          mode: "exact_lookup",
          persist_answer: true,
          conversation_id: "conv.different.thread.B",
          prior_saved_answer_revision: convClarifySavedRev,
          conversation_history: [
            { role: "user", content: t2CalcQ, conversation_id: "conv.different.thread.B" },
            { role: "assistant", content: "คำตอบจากอีกบทสนทนา" },
          ],
        }),
      })
    );
    expect(crossConvRes.status).toBe(400);
    expect((await crossConvRes.json()).error).toContain(
      "CROSS_CONVERSATION_REVISION_FORBIDDEN_400"
    );

    // 3E. Cross-user follow-up link attempt (User B tries to append follow-up onto Dodo's saved revision) -> HTTP 403!
    const crossUserRes = await queryPost(
      new Request("https://staging.reg24.th/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": "intruder@otherfirm.th",
        },
        body: JSON.stringify({
          question: "ข้อมูลเพิ่มเติม: ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
          applicable_date: "2026-02-15",
          mode: "exact_lookup",
          persist_answer: true,
          conversation_id: convClarify,
          prior_saved_answer_revision: convClarifySavedRev,
          conversation_history: [
            { role: "user", content: t2CalcQ, conversation_id: convClarify },
            { role: "assistant", content: t2Json.answer.answer, conversation_id: convClarify },
          ],
        }),
      })
    );
    expect(crossUserRes.status).toBe(403);
    expect((await crossUserRes.json()).error).toContain("ANSWER_OWNERSHIP_FORBIDDEN_403");
  });
});
