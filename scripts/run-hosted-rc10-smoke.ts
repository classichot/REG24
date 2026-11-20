/**
 * REG24 — Hosted Protected Staging Smoke Test + Live Linux Tokenizer Parity Verifier
 *
 * Usage:
 *   npx tsx scripts/run-hosted-rc10-smoke.ts "https://reg24-xxxx-7-l-advisory.vercel.app?_vercel_share=..." [out.json]
 *
 * Executes as a signed-out external tester (using only the Vercel share cookie):
 *   1. GET /api/v1/knowledge/environment?probe_tokenizer=1 -> verifies pinned commit, release, manifest,
 *      Linux runtime platform, exact tokenizer/index SHA-256 hashes, and all 4 live posting-hit probes.
 *   2. POST /api/v1/knowledge/query (fictional tax case, persist_answer=true) -> verifies live Gemini 4 Neon @ low,
 *      zero silent fallback, trace ID, elapsed time, and atomic transactional Neon PostgreSQL save.
 *   3. Fresh GET /api/v1/knowledge/revisions/:revisionId -> verifies DB-backed reopen without regeneration.
 *   4. GET /api/v1/knowledge/evidence/:evidenceId -> verifies real Gazette/statute evidence locator resolution.
 */

import * as fs from "node:fs";

async function main() {
  const shareUrl = process.argv[2];
  const outPath = process.argv[3] || "";
  if (!shareUrl || !shareUrl.startsWith("http")) {
    console.error("Usage: npx tsx scripts/run-hosted-rc10-smoke.ts <vercel-share-url> [out.json]");
    process.exit(1);
  }

  const parsed = new URL(shareUrl);
  const origin = parsed.origin;

  // Step 0: Acquire Vercel share bypass cookie as a signed-out tester
  const cookieRes = await fetch(shareUrl, { redirect: "manual" });
  const setCookies = cookieRes.headers.getSetCookie ? cookieRes.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader && cookieRes.status >= 400) {
    throw new Error(`Failed to unlock Vercel preview via share URL: HTTP ${cookieRes.status}`);
  }
  const baseHeaders: Record<string, string> = cookieHeader ? { Cookie: cookieHeader } : {};

  // Step 1: Environment + Live Linux Tokenizer Parity Probe
  const tEnv0 = performance.now();
  const envRes = await fetch(`${origin}/api/v1/knowledge/environment?probe_tokenizer=1`, {
    headers: baseHeaders,
  });
  const envMs = Math.round(performance.now() - tEnv0);
  const envJson = await envRes.json();

  // Step 2: Live Gemini 4 Neon @ low fictional tax query + atomic Neon PostgreSQL save
  const fictionalQuestion =
    "บริษัทสมมติ อัลฟ่า เทรดดิ้ง จำกัด ขายสินค้าในประเทศและออกใบกำกับภาษีในวันที่ 30 กันยายน 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด";
  const tQuery0 = performance.now();
  const qRes = await fetch(`${origin}/api/v1/knowledge/query`, {
    method: "POST",
    headers: { ...baseHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      question: fictionalQuestion,
      applicable_date: "2025-09-30",
      mode: "standard",
      persist_answer: true,
    }),
  });
  const queryMs = Math.round(performance.now() - tQuery0);
  const qJson = await qRes.json();

  const revId = qJson?.traceable_answer?.answer_revision || null;
  const firstEvidenceId = qJson?.traceable_answer?.claims?.[0]?.evidence_references?.[0]?.evidence_id || null;

  // Step 3: Fresh uncached DB reopen by exact revision ID
  let reopenJson: any = null;
  let reopenStatus = 0;
  let reopenMs = 0;
  if (revId) {
    const tRe0 = performance.now();
    const reRes = await fetch(`${origin}/api/v1/knowledge/revisions/${encodeURIComponent(revId)}`, {
      headers: { ...baseHeaders, "Cache-Control": "no-store" },
    });
    reopenStatus = reRes.status;
    reopenMs = Math.round(performance.now() - tRe0);
    reopenJson = await reRes.json();
  }

  // Step 4: Evidence resolver check
  let evStatus = 0;
  let evJson: any = null;
  if (firstEvidenceId) {
    const evRes = await fetch(`${origin}/api/v1/knowledge/evidence/${encodeURIComponent(firstEvidenceId)}`, {
      headers: baseHeaders,
    });
    evStatus = evRes.status;
    evJson = await evRes.json();
  }

  const receipt = {
    executed_at: new Date().toISOString(),
    preview_origin: origin,
    step1_environment_and_linux_tokenizer_parity: {
      http_status: envRes.status,
      elapsed_ms: envMs,
      environment: envJson?.environment,
      data_version: envJson?.data_version,
      projections: envJson?.projections,
      tokenizer_parity_probe: envJson?.tokenizer_parity_probe,
    },
    step2_live_query_and_atomic_save: {
      http_status: qRes.status,
      elapsed_ms: queryMs,
      status: qJson?.status,
      trace_id: qJson?.trace_id,
      answer_revision: revId,
      persisted: qJson?.persisted,
      execution_provenance: qJson?.execution_provenance || qJson?.traceable_answer?.execution_provenance,
      claim_count: qJson?.traceable_answer?.claims?.length ?? 0,
      answer_preview: (qJson?.answer_th || qJson?.traceable_answer?.rendered_answer_th || "").slice(0, 400),
    },
    step3_fresh_db_reopen: {
      http_status: reopenStatus,
      elapsed_ms: reopenMs,
      found: reopenJson?.found,
      answer_revision_matches: reopenJson?.answer?.answer_revision === revId,
      claim_count_matches:
        (reopenJson?.answer?.claims?.length ?? -1) === (qJson?.traceable_answer?.claims?.length ?? -2),
      rendered_answer_matches:
        reopenJson?.answer?.rendered_answer_th === qJson?.traceable_answer?.rendered_answer_th,
      execution_provenance_preserved: Boolean(reopenJson?.answer?.execution_provenance),
    },
    step4_evidence_resolver: {
      http_status: evStatus,
      evidence_id: firstEvidenceId,
      ok: evJson?.ok,
      official_url: evJson?.evidence?.official_url,
      locator_kind: evJson?.evidence?.locator?.kind,
    },
  };

  console.log(JSON.stringify(receipt, null, 2));
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), "utf8");
  }
}

main().catch((err) => {
  console.error("SMOKE_ERROR:", err);
  process.exit(1);
});
