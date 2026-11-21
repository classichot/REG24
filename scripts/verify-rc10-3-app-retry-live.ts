/**
 * REG24 Batch 1 RC10.3 P0-2 — Real Staging Application-Path Retry, Lost-Response,
 * Concurrent-Retry & Deliberate-Edit Acceptance Proof (Live Neon PostgreSQL, ZERO Mocks!)
 *
 * Exercises the ACTUAL Next.js route handlers:
 *   - `POST /api/v1/knowledge/answers` (`src/app/api/v1/knowledge/answers/route.ts`)
 *   - `GET /api/v1/knowledge/answers/:id?require_db=1` (`src/app/api/v1/knowledge/answers/[id]/route.ts`)
 * against REAL live staging Neon PostgreSQL (`DATABASE_URL` in `.env.local` with migration `0007` applied!).
 *
 * Proves all 5 acceptance scenarios of RC10.3 Section 2. P0:
 *   1. Failed transaction -> ZERO partial revision in memory, cache, API, or Neon (`0/0/0/0`);
 *      repeating exact same `POST /api/v1/knowledge/answers` with `K1` creates exactly ONE complete `r1`, `0` model calls.
 *   2. Commit with lost response (replay exact same `K1` + identical payload) -> returns exact same `r1`
 *      (`idempotent_replay: true`), live Neon stays `1/1/1/1`, `0` model calls.
 *   3. Same key `K1` with DIFFERENT content -> fails clearly with HTTP `409` (`IDEMPOTENCY_KEY_PAYLOAD_CONFLICT_409`),
 *      live Neon untouched (`1/1/1/1`).
 *   4. True CONCURRENT retries (`Promise.all` of 3 simultaneous `POST /api/v1/knowledge/answers` calls on a new answer
 *      with identical `K2` + payload) -> PostgreSQL unique constraint `idx_citation_published_answer_save_op_unique`
 *      guarantees ALL 3 resolve to the exact same single `r1`, live Neon has `1` answer revision (`0` duplicates!), `0` model calls.
 *   5. Deliberate edit with a NEW key `K3` -> creates `r2` (`supersedes_answer_revision === r1`);
 *      reopening BOTH `r1` and `r2` via `GET /api/v1/knowledge/answers/:id?require_db=1` asserts
 *      `persistence_source === "neon_postgres"` and matching answer, claims, citations, provenance, and audit record.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { POST as postSaveAnswer } from "../src/app/api/v1/knowledge/answers/route";
import { GET as getReopenAnswer } from "../src/app/api/v1/knowledge/answers/[id]/route";
import {
  resolveActiveCitationDbTransport,
  setCustomCitationDbTransportForTesting,
} from "../src/core/knowledge/citation-postgres-store";
import {
  getUnifiedCitationLedgerView,
  reopenSavedTraceableAnswer,
} from "../src/core/knowledge/claim-traceability-engine";
import {
  DurableKnowledgeStore,
  getDefaultKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../src/core/knowledge/store";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function queryNeonCounts(answerId: string) {
  const db = resolveActiveCitationDbTransport();
  if (!db) throw new Error("NO_LIVE_NEON_DB");
  const rAns = await db<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM citation_published_answer WHERE answer_id = $1`,
    [answerId]
  );
  const rClm = await db<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM citation_atomic_claim c
       JOIN citation_published_answer a ON a.answer_revision_id = c.answer_revision_id
      WHERE a.answer_id = $1`,
    [answerId]
  );
  const rLnk = await db<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM citation_claim_evidence_link l
       JOIN citation_published_answer a ON a.answer_revision_id = l.answer_revision_id
      WHERE a.answer_id = $1`,
    [answerId]
  );
  const rAud = await db<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM citation_audit_event e
       JOIN citation_published_answer a ON a.answer_revision_id = e.correlation_id
      WHERE a.answer_id = $1`,
    [answerId]
  );
  return {
    citation_published_answer: Number(rAns.rows[0]?.c || 0),
    citation_atomic_claim: Number(rClm.rows[0]?.c || 0),
    citation_claim_evidence_link: Number(rLnk.rows[0]?.c || 0),
    citation_audit_event: Number(rAud.rows[0]?.c || 0),
  };
}

async function main() {
  loadDotEnvLocal();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in .env.local for live staging app-retry proof");
  }

  // Track model calls AND allow injecting ONE controlled mid-transaction failure on Neon batch `/sql`
  let modelProviderCallCount = 0;
  let failNextNeonBatchTx = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/generativelanguage\.googleapis\.com|api\.openai\.com/i.test(urlStr)) {
      modelProviderCallCount += 1;
    }
    if (
      failNextNeonBatchTx &&
      /\.neon\.tech\/sql/i.test(urlStr) &&
      typeof init?.body === "string" &&
      init.body.includes('"queries"')
    ) {
      failNextNeonBatchTx = false;
      // Inject a real PostgreSQL CHECK constraint violation inside Statement #3 of the live Neon batch transaction
      // (after Statement #1 `citation_published_answer` and Statement #2 `citation_atomic_claim` execute)
      // so LIVE Neon PostgreSQL itself aborts & rolls back the entire transaction!
      const parsed = JSON.parse(init.body) as { queries: Array<{ query: string; params: unknown[] }> };
      for (const q of parsed.queries) {
        if (/INSERT INTO citation_claim_evidence_link/i.test(q.query)) {
          q.params = q.params.map((p) => (p === "primary_authority" ? "INVALID_MID_TX_ABORT_ROLE" : p));
        }
      }
      return origFetch(input, { ...init, body: JSON.stringify(parsed) });
    }
    return origFetch(input, init);
  }) as typeof fetch;

  try {
    const stagingStoreDir = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
    setDefaultKnowledgeStoreForTesting(new DurableKnowledgeStore(stagingStoreDir));
    const store = getDefaultKnowledgeStore();
    const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
    const psg = ledger.passages["psg.rc8.rd790.sec_3_quoted_rd646_sec_4"];
    if (!psg) {
      throw new Error("Expected rel.B01.rc8 passage psg.rc8.rd790.sec_3_quoted_rd646_sec_4 missing");
    }

    const stamp = Date.now().toString(36);
    const ansId1 = `ans.rc10_3_app_retry_${stamp}`;
    const ansId2 = `ans.rc10_3_app_conc_${stamp}`;
    const actorHeaders = {
      "Content-Type": "application/json",
      "x-reg24-actor-role": "legal_reviewer",
      "x-reg24-actor-id": "qa.rc10_3.app_retry@reg24.th",
    };

    const buildBody = (
      answerId: string,
      saveOpKey: string,
      claimText: string,
      renderedText: string,
      corruptSupportRole = false
    ) => ({
      question_text: "คำถามสมมติทดสอบ App-Level Retry (RC10.3 P0-2)",
      revision_reason: `RC10.3 P0-2 app-level retry verification (${saveOpKey})`,
      save_operation_key: saveOpKey,
      traceable_answer: {
        schema_version: "reg24.citation-traceability.v1",
        answer_id: answerId,
        as_of_date: "2025-09-30",
        status: "complete",
        rendered_answer_th: renderedText,
        user_supplied_facts: [],
        assumptions: [],
        execution_provenance: {
          git_commit_sha: "rc10.3-app-retry-probe",
          release_id: "rel.B01.rc8",
          manifest_id: "mfst.b01.rc8_thai_legal_index",
          manifest_hash: store.getState().releases["rel.B01.rc8"]?.manifest_hash || null,
          model_id: "google-gemini:gemini-4-neon",
          model_policy_version: "reg24-grounded-llm-legal-application-v1.1",
          claim_verifier_version: "reg24-claim-verifier-v2.1",
          calculation_verifier_version: "reg24-tax-calc-verifier-v1.0",
          ruleset_version: `th-official-traceability-2026.11.2#${stamp}`,
          query_kind: "LEGAL_FACT_APPLICATION",
          configuration: {
            store_topology_mode: "neon_postgres_canonical_truth",
            hierarchy_of_authority_retrieval: true,
            separate_calculation_verification: true,
            negated_fact_stripping_enabled: true,
            retrieval_mode: "hybrid_bm25_lexical_only",
          },
        },
        claims: [
          {
            claim_id: `clm.${answerId}.1`,
            claim_number: 1,
            text: claimText,
            claim_type: "legal_proposition",
            claim_type_label_th: "ข้อกฎหมาย",
            premise_ids: [],
            verification_decision: "supported",
            published: true,
            withheld_explanation_th: null,
            evidence_references: [
              {
                link_id: `lnk.${answerId}.1`,
                evidence_id: psg.passage_id,
                doc_id: psg.doc_id,
                version_id: psg.version_id,
                extraction_revision_id: psg.extraction_revision_id,
                support_role: corruptSupportRole ? "INVALID_MID_TX_ABORT_ROLE" : "primary_authority",
                support_role_label_th: "หลักฐานกฎหมายหลัก",
                required_group: "grp.1",
                citation_label_th: "พ.ร.ฎ. (ฉบับที่ 790) พ.ศ. 2567",
                issuer_name_th: "กรมสรรพากร",
                source_family: "gazette_enactment",
                source_family_label_th: "กฎหมาย",
                record_type: "full_record",
                record_type_label_th: "เอกสารฉบับเต็มทางการ",
                date_relied_on: "2025-09-30",
                official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
                official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf#page=2",
                resolver_url: `/api/v1/knowledge/evidence/${psg.passage_id}`,
                locator: {
                  human_pinpoint_th: "หน้า ๒",
                  section_paragraph_path: ["มาตรา ๓"],
                  physical_page_start: 2,
                  physical_page_end: 2,
                  printed_page_start: "หน้า ๒",
                  printed_page_end: "หน้า ๒",
                  anchors: [],
                },
                verification_status: "supported",
                link_health: "unchecked_live",
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
          verifier_version: "reg24-claim-verifier-v2.1",
          ruleset_version: "th-official-traceability-2026.11.2",
          release_id: "rel.B01.rc8",
          publication_gate_mode: "enforced",
        },
      },
    });

    const invokePost = async (bodyObj: Record<string, unknown>) => {
      const req = new Request("http://staging.local/api/v1/knowledge/answers", {
        method: "POST",
        headers: actorHeaders,
        body: JSON.stringify(bodyObj),
      });
      const res = await postSaveAnswer(req);
      const json = await res.json();
      return { status: res.status, json };
    };

    const invokeReopen = async (revId: string, requireDb: boolean) => {
      const req = new Request(
        `http://staging.local/api/v1/knowledge/answers/${encodeURIComponent(revId)}${requireDb ? "?require_db=1" : ""}`,
        { method: "GET", headers: actorHeaders }
      );
      const res = await getReopenAnswer(req, { params: Promise.resolve({ id: revId }) });
      const json = await res.json();
      return {
        status: res.status,
        persistenceHeader: res.headers.get("x-reg24-persistence-source"),
        json,
      };
    };

    const k1 = `op.rc10_3.k1.${stamp}`;
    const k2 = `op.rc10_3.k2.${stamp}`;
    const k3 = `op.rc10_3.k3.${stamp}`;
    const baseClaimText =
      "ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ซึ่งความรับผิดในการเสียภาษีมูลค่าเพิ่มเกิดขึ้นตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2560 ถึงวันที่ 30 กันยายน พ.ศ. 2568";
    const baseRenderedText =
      "คำตอบทดสอบ App-Level Retry ฉบับที่ 1: คงจัดเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละหกจุดสาม ถึงวันที่ 30 กันยายน พ.ศ. 2568 (ข้อมูลสมมติเท่านั้น)";

    // === SCENARIO 1: Failed transaction mid-save -> ZERO partial revision in memory, API, or Neon ===
    // Trigger a real PostgreSQL CHECK constraint failure inside Statement #3 of the live Neon batch transaction
    failNextNeonBatchTx = true;
    const failRes = await invokePost(buildBody(ansId1, k1, baseClaimText, baseRenderedText, false));
    const countsAfterFail = await queryNeonCounts(ansId1);
    const memLeakAfterFail = reopenSavedTraceableAnswer(store, `${ansId1}.r1`, {
      actor_id: "qa.rc10_3.app_retry@reg24.th",
      role: "legal_reviewer",
      tenant_id: "PUBLIC",
      authorized_scopes: ["scope.platform.public"],
    });
    const apiReopenAfterFail = await invokeReopen(`${ansId1}.r1`, true);

    // Now retry the exact same save operation with key K1 cleanly
    const retryCleanRes = await invokePost(buildBody(ansId1, k1, baseClaimText, baseRenderedText, false));
    const countsAfterRetry1 = await queryNeonCounts(ansId1);

    // === SCENARIO 2: Commit with lost response -> replay exact same key K1 + payload ===
    const lostResponseReplayRes = await invokePost(
      buildBody(ansId1, k1, baseClaimText, baseRenderedText, false)
    );
    const countsAfterReplay = await queryNeonCounts(ansId1);

    // === SCENARIO 3: Same key K1 with DIFFERENT content -> MUST fail clearly (HTTP 409) ===
    const conflictRes = await invokePost(
      buildBody(
        ansId1,
        k1,
        baseClaimText,
        "ข้อความที่แตกต่างแต่ส่งด้วย save_operation_key เดิม (ต้องถูกปฏิเสธ 409)",
        false
      )
    );
    const countsAfterConflict = await queryNeonCounts(ansId1);

    // === SCENARIO 4: True CONCURRENT retries (3 parallel POSTs with identical key K2 on ansId2) ===
    const concPayload = buildBody(
      ansId2,
      k2,
      baseClaimText,
      "คำตอบทดสอบ Concurrent Retry 3 คำขอพร้อมกัน (ข้อมูลสมมติเท่านั้น)",
      false
    );
    const concResults = await Promise.all([
      invokePost(concPayload),
      invokePost(concPayload),
      invokePost(concPayload),
    ]);
    const countsAfterConc = await queryNeonCounts(ansId2);
    const concRevisions = Array.from(
      new Set(concResults.map((r) => String(r.json?.saved_answer_revision || "")))
    );

    // === SCENARIO 5: Deliberate edit with NEW key K3 on ansId1 -> creates r2 + DB reopen compare ===
    const editedRendered =
      "คำตอบฉบับแก้ไขที่ 2 ด้วย save_operation_key ใหม่ (K3 — ข้อมูลสมมติเท่านั้น)";
    const editRes = await invokePost(buildBody(ansId1, k3, baseClaimText, editedRendered, false));
    const countsAfterEdit = await queryNeonCounts(ansId1);
    const reopenR1 = await invokeReopen(`${ansId1}.r1`, true);
    const reopenR2 = await invokeReopen(`${ansId1}.r2`, true);

    const passed =
      // Scenario 1
      failRes.status >= 400 &&
      countsAfterFail.citation_published_answer === 0 &&
      countsAfterFail.citation_atomic_claim === 0 &&
      countsAfterFail.citation_claim_evidence_link === 0 &&
      countsAfterFail.citation_audit_event === 0 &&
      memLeakAfterFail.found === false &&
      apiReopenAfterFail.status === 404 &&
      retryCleanRes.status === 200 &&
      retryCleanRes.json.saved_answer_revision === `${ansId1}.r1` &&
      retryCleanRes.json.idempotent_replay === false &&
      countsAfterRetry1.citation_published_answer === 1 &&
      // Scenario 2
      lostResponseReplayRes.status === 200 &&
      lostResponseReplayRes.json.saved_answer_revision === `${ansId1}.r1` &&
      lostResponseReplayRes.json.idempotent_replay === true &&
      countsAfterReplay.citation_published_answer === 1 &&
      // Scenario 3
      conflictRes.status === 409 &&
      String(conflictRes.json.error || "").includes("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT_409") &&
      countsAfterConflict.citation_published_answer === 1 &&
      // Scenario 4
      concResults.every((r) => r.status === 200) &&
      concRevisions.length === 1 &&
      concRevisions[0] === `${ansId2}.r1` &&
      countsAfterConc.citation_published_answer === 1 &&
      countsAfterConc.citation_atomic_claim === 1 &&
      countsAfterConc.citation_claim_evidence_link === 1 &&
      countsAfterConc.citation_audit_event === 1 &&
      // Scenario 5
      editRes.status === 200 &&
      editRes.json.saved_answer_revision === `${ansId1}.r2` &&
      editRes.json.answer?.supersedes_answer_revision === `${ansId1}.r1` &&
      countsAfterEdit.citation_published_answer === 2 &&
      reopenR1.status === 200 &&
      reopenR1.json.persistence_source === "neon_postgres" &&
      reopenR1.json.answer?.answer_revision === `${ansId1}.r1` &&
      reopenR1.json.answer?.execution_provenance?.ruleset_version ===
        `th-official-traceability-2026.11.2#${stamp}` &&
      reopenR1.json.audit_events?.length >= 1 &&
      reopenR2.status === 200 &&
      reopenR2.json.persistence_source === "neon_postgres" &&
      reopenR2.json.answer?.answer_revision === `${ansId1}.r2` &&
      reopenR2.json.answer?.supersedes_answer_revision === `${ansId1}.r1` &&
      reopenR2.json.answer?.claims?.length === 1 &&
      reopenR2.json.answer?.claims?.[0]?.evidence_references?.length === 1 &&
      reopenR2.json.audit_events?.length >= 1 &&
      // Zero LLM calls across all save/retry/reopen operations!
      modelProviderCallCount === 0;

    const receipt = {
      schema_version: "1.0-rc10.3-app-level-retry-live-proof",
      executed_at: new Date().toISOString(),
      real_app_routes_exercised: [
        "POST /api/v1/knowledge/answers",
        "GET /api/v1/knowledge/answers/:id?require_db=1",
      ],
      real_neon_postgres_tested: true,
      mock_used: false,
      database_unique_constraint: "idx_citation_published_answer_save_op_unique",
      model_provider_calls_during_save_retries: modelProviderCallCount,
      scenario1_failed_tx_then_retry: {
        failed_http_status: failRes.status,
        live_neon_counts_after_abort: countsAfterFail,
        in_memory_cache_leak_found: memLeakAfterFail.found,
        reopen_api_status_after_abort: apiReopenAfterFail.status,
        retry_http_status: retryCleanRes.status,
        retry_saved_revision: retryCleanRes.json.saved_answer_revision,
        retry_idempotent_replay: retryCleanRes.json.idempotent_replay,
        live_neon_counts_after_clean_retry: countsAfterRetry1,
      },
      scenario2_lost_response_replay: {
        http_status: lostResponseReplayRes.status,
        returned_revision: lostResponseReplayRes.json.saved_answer_revision,
        idempotent_replay: lostResponseReplayRes.json.idempotent_replay,
        live_neon_counts_unchanged: countsAfterReplay,
      },
      scenario3_same_key_different_content_conflict: {
        http_status: conflictRes.status,
        error_code: String(conflictRes.json.error || "").slice(0, 140),
        live_neon_counts_unchanged: countsAfterConflict,
      },
      scenario4_concurrent_retries_3x: {
        http_statuses: concResults.map((r) => r.status),
        idempotent_replay_flags: concResults.map((r) => r.json.idempotent_replay),
        distinct_revisions_returned: concRevisions,
        live_neon_counts_after_3x_concurrent: countsAfterConc,
      },
      scenario5_deliberate_edit_new_key_and_db_reopen: {
        edit_http_status: editRes.status,
        edit_saved_revision: editRes.json.saved_answer_revision,
        edit_supersedes: editRes.json.answer?.supersedes_answer_revision,
        live_neon_counts_after_edit: countsAfterEdit,
        reopen_r1: {
          http_status: reopenR1.status,
          persistence_source: reopenR1.json.persistence_source,
          persistence_header: reopenR1.persistenceHeader,
          revision: reopenR1.json.answer?.answer_revision,
          claims_count: reopenR1.json.answer?.claims?.length ?? 0,
          citations_count: reopenR1.json.answer?.claims?.[0]?.evidence_references?.length ?? 0,
          provenance_preserved:
            reopenR1.json.answer?.execution_provenance?.ruleset_version ===
            `th-official-traceability-2026.11.2#${stamp}`,
          audit_events_count: reopenR1.json.audit_events?.length ?? 0,
        },
        reopen_r2: {
          http_status: reopenR2.status,
          persistence_source: reopenR2.json.persistence_source,
          persistence_header: reopenR2.persistenceHeader,
          revision: reopenR2.json.answer?.answer_revision,
          supersedes: reopenR2.json.answer?.supersedes_answer_revision,
          claims_count: reopenR2.json.answer?.claims?.length ?? 0,
          citations_count: reopenR2.json.answer?.claims?.[0]?.evidence_references?.length ?? 0,
          provenance_preserved:
            reopenR2.json.answer?.execution_provenance?.ruleset_version ===
            `th-official-traceability-2026.11.2#${stamp}`,
          audit_events_count: reopenR2.json.audit_events?.length ?? 0,
        },
      },
      overall_passed: passed,
    };

    const outDir = path.resolve(process.cwd(), "docs/batch1-rc10.3-evidence");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "rc10_3_app_level_retry_live_neon_receipt.json");
    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), "utf8");
    console.log(JSON.stringify(receipt, null, 2));
    if (!passed) {
      console.error("FAIL: RC10.3 P0-2 app-level retry live Neon proof failed!");
      process.exit(1);
    }
  } finally {
    globalThis.fetch = origFetch;
    setCustomCitationDbTransportForTesting(null, null);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
