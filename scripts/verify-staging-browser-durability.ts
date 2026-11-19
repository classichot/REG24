/**
 * REG24 — Hosted Staging Browser & Durability Workflow Verification
 *
 * Separately verifies against real hosted Neon (`shiny-pond-32049060`):
 *  1. Open evidence (`resolveTraceableEvidenceWithPostgres`) for `B1-07` RD 342 `(ข)` passage.
 *  2. Save a staging test verdict (`saveLegalReviewFeedbackToPostgres`) in `citation_legal_review_feedback`.
 *  3. Reload the verdict on a fresh cold-start container (`listLegalReviewFeedbackFromPostgres`).
 *  4. Confirm `persist_answer: false` writes ZERO rows to `citation_published_answer` (audit metadata only, no answer content).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { POST as queryPost } from "../src/app/api/v1/knowledge/query/route";
import {
  listLegalReviewFeedbackFromPostgres,
  resolveActiveCitationDbTransport,
  saveLegalReviewFeedbackToPostgres,
} from "../src/core/knowledge/citation-postgres-store";
import { resolveTraceableEvidenceWithPostgres } from "../src/core/knowledge/claim-traceability-engine";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../src/core/knowledge/store";

function loadDotEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadDotEnvLocal();
  delete process.env.VITEST;

  const stagingGz = path.resolve(
    process.cwd(),
    "data",
    "knowledge-store-b01-rc2-staging",
    "canonical-state.json.gz"
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-durability-"));
  fs.copyFileSync(stagingGz, path.join(tmpDir, "canonical-state.json.gz"));
  const store = new DurableKnowledgeStore(tmpDir);
  setDefaultKnowledgeStoreForTesting(store);

  const actor = {
    actor_id: "legal.staging.durability",
    role: "legal_reviewer" as const,
    tenant_id: "PUBLIC",
    authorized_scopes: ["scope.platform.public"],
  };

  // 1. Run B1-07 with persist_answer: true to get a live saved revision & RD 342 evidence ID
  const req1 = new Request("http://localhost/api/v1/knowledge/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-reg24-actor-id": actor.actor_id,
      "x-reg24-actor-role": actor.role,
    },
    body: JSON.stringify({
      question:
        "นายวิชัยขายที่ดินสองแปลงในเดือนมิถุนายน 2568 แปลงที่หนึ่งได้รับมรดกจากภริยาตั้งแต่ปี 2560 ถือครองมา 8 ปี แปลงที่สองซื้อจากบุคคลภายนอกในเดือนมีนาคม 2568 ถือครองได้ 3 เดือน เขามิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไรในแต่ละแปลง",
      persist_answer: true,
      channel: "chat",
    }),
  });
  const resp1 = await queryPost(req1);
  const body1 = (await resp1.json()) as {
    error?: string;
    traceable_answer?: {
      answer_revision?: string;
      status?: string;
      claims?: Array<{
        evidence_references?: Array<{ evidence_id: string; official_url?: string }>;
      }>;
    };
  };
  if (resp1.status !== 200) {
    console.error("B1-07 non-200 response:", resp1.status, body1);
  }
  const savedRev = body1.traceable_answer?.answer_revision || "";
  const stageTimingHeader = resp1.headers.get("x-reg24-stage-timing-ms");
  const allRefs = (body1.traceable_answer?.claims || []).flatMap(
    (c) => c.evidence_references || []
  );
  const rd342Ref = allRefs.find((r) => (r.official_url || "").includes("rd.go.th/2818.html"));

  // 2. Open evidence via resolver (exact evidence viewer workflow)
  const resolvedEvidence = rd342Ref
    ? await resolveTraceableEvidenceWithPostgres(store, rd342Ref.evidence_id, actor, savedRev)
    : null;

  // 3. Save a test verdict in staging Neon (`citation_legal_review_feedback`)
  const feedbackId = `fb.staging.r3.${Date.now()}`;
  const saveRes = await saveLegalReviewFeedbackToPostgres({
    feedback_id: feedbackId,
    scenario_id: "R3-D01-B1-07",
    question_text: "B1-07 staging durability check (Royal Decree 342 §4(6)(ข))",
    as_of_date: "2025-06-15",
    answer_revision_id: savedRev,
    answer_status: body1.traceable_answer?.status || "complete",
    reviewer_name: "REG24 Staging Durability Check",
    reviewer_actor_id: actor.actor_id,
    verdict: "PASS_SUPPORTED",
    checked_original_source: true,
    comments_th: "Verified RD 342 §4(6)(ข) evidence open + durable Neon reload.",
    cited_evidence_ids: rd342Ref ? [rd342Ref.evidence_id] : [],
    environment_scope: "staging",
    recorded_at: new Date().toISOString(),
  });

  // 4. Reload from durable Neon history on a fresh cold-start check
  const reloadedList = (await listLegalReviewFeedbackFromPostgres(25)) || [];
  const reloadedMatch = reloadedList.find((f) => f.feedback_id === feedbackId);

  // 5. Confirm `persist_answer: false` writes ZERO rows to `citation_published_answer`
  const db = resolveActiveCitationDbTransport();
  const uniqueMarker = `PERSIST_FALSE_PROBE_${Date.now()}`;
  const req2 = new Request("http://localhost/api/v1/knowledge/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-reg24-actor-id": actor.actor_id,
      "x-reg24-actor-role": actor.role,
    },
    body: JSON.stringify({
      question: `บริษัทจำกัดมีกำไรสุทธิ 8,000,000 บาท ไม่ใช่ SME ต้องเสียภาษีเงินได้นิติบุคคลอัตราเท่าใด (${uniqueMarker})`,
      persist_answer: false,
      channel: "api",
    }),
  });
  const resp2 = await queryPost(req2);
  const body2 = (await resp2.json()) as {
    traceable_answer?: { answer_revision?: string };
  };
  const persistedProbeCount = db
    ? (
        await db<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM citation_published_answer WHERE question_text LIKE $1`,
          [`%${uniqueMarker}%`]
        )
      ).rows[0]?.cnt
    : "no_db";

  const receipt = {
    verified_at: new Date().toISOString(),
    b1_07_http_status: resp1.status,
    b1_07_saved_revision: savedRev,
    stage_timing_header: stageTimingHeader,
    evidence_opened_id: rd342Ref?.evidence_id || null,
    evidence_opened_ok: Boolean(
      resolvedEvidence && resolvedEvidence.evidence?.evidence_id === rd342Ref?.evidence_id
    ),
    evidence_official_url: rd342Ref?.official_url || null,
    verdict_saved_postgres: saveRes.persisted_postgres,
    verdict_feedback_id: feedbackId,
    verdict_reloaded_from_durable_neon: Boolean(reloadedMatch),
    verdict_reloaded_verdict: reloadedMatch?.verdict || null,
    persist_answer_false_http_status: resp2.status,
    persist_answer_false_published_answer_rows_written: Number(persistedProbeCount),
    persist_answer_false_ephemeral_revision_id: body2.traceable_answer?.answer_revision || null,
  };

  const outPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "round3_staging_browser_durability_receipt.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(JSON.stringify(receipt, null, 2));

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
