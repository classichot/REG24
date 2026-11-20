/**
 * REG24 — Hardened Hosted Protected Staging Smoke Runner (Zero Silent Fallback, Start/End Pin Check)
 *
 * Usage:
 *   npx tsx scripts/run-hosted-rc10-smoke.ts \
 *     --url "https://reg24-xxxx-7-l-advisory.vercel.app?_vercel_share=..." \
 *     --commit "<40-char-sha>" \
 *     [--release "rel.B01.rc7"] \
 *     [--out "docs/batch1-rc10.2-evidence/hosted_smoke_receipt.json"]
 *
 * Enforces Section 3 of Owner's RC10 requirements:
 *   1. Verifies pinned commit SHA, release, manifest hash, tokenizer contract hash, lexical index hash,
 *      and read-only Linux tokenizer parity probe (`GET /api/v1/knowledge/environment?probe_tokenizer=1`) at START.
 *   2. Runs ONE fictional staging smoke query (`POST /api/v1/knowledge/query`, `persist_answer: true`,
 *      `answer_generation_mode: "llm_grounded"`, `thinking_level: "low"`) and validates `answer.trace_id`,
 *      `answer.status`, top-level `execution_provenance` (live Gemini 4 Neon @ low, zero fallback), and saved revision.
 *   3. Reopens the exact saved revision via `GET /api/v1/knowledge/answers/:id?require_db=1` (forcing a verified
 *      Neon PostgreSQL read — NEVER local memory!) and checks `ok`, revision ID, answer, claims, citations,
 *      provenance (`provider_interaction_id`), and audit events.
 *   4. Re-verifies `/api/v1/knowledge/environment` at END to prove zero build drift during the smoke test.
 *   5. Exits NONZERO (`process.exit(1)`) on ANY contract violation. Never prints share tokens or cookies.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { inspectReleaseProjectionDiagnostics } from "../src/core/knowledge/projections";
import {
  validateEnvironmentAndLinuxTokenizerParity,
  validateHostedQueryResponse,
  validateHostedReopenResponse,
  type ExpectedHostedPin,
} from "../src/core/knowledge/hosted-smoke-verifier";

function parseArgs(argv: string[]) {
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && argv[i + 1]) {
      map[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else if (!map.url && argv[i].startsWith("http")) {
      map.url = argv[i];
    }
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shareUrl = args.url;
  const expectedCommit = args.commit || process.env.EXPECTED_COMMIT_SHA || "";
  const releaseId = args.release || "rel.B01.rc7";
  const outPath = args.out || "";

  if (!shareUrl || !shareUrl.startsWith("http")) {
    console.error("FATAL: --url <vercel-share-url> is required.");
    process.exit(1);
  }
  if (!expectedCommit || expectedCommit.length < 7) {
    console.error("FATAL: --commit <git-commit-sha> is required to verify pinned deployment identity.");
    process.exit(1);
  }

  // Derive expected manifest & lexical index hashes locally from the pinned repo store
  const store = new DurableKnowledgeStore(
    path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging")
  );
  const localDiag = inspectReleaseProjectionDiagnostics(store, releaseId);
  if (localDiag.lexical.status !== "ready" || !localDiag.manifest_hash || !localDiag.lexical.lexical_index_sha256) {
    console.error("FATAL: Local pinned release projection diagnostics are not ready:", localDiag);
    process.exit(1);
  }

  const pin: ExpectedHostedPin = {
    git_commit_sha: expectedCommit,
    release_id: releaseId,
    manifest_id: localDiag.manifest_id || "mfst.b01.rc7_thai_legal_index",
    manifest_hash: localDiag.manifest_hash,
    tokenizer_engine: localDiag.lexical.tokenizer_engine || "",
    tokenizer_contract_sha256: localDiag.lexical.tokenizer_contract_sha256 || "",
    legal_dictionary_sha256: localDiag.lexical.legal_dictionary_sha256 || "",
    lexical_index_sha256: localDiag.lexical.lexical_index_sha256,
    require_linux_platform: true,
    expected_model: "gemini-4-neon",
    expected_thinking_level: "low",
  };

  const parsed = new URL(shareUrl);
  const origin = parsed.origin; // Strip query string (never log `_vercel_share` token!)

  // Step 0: Unlock protected preview as a signed-out tester (token/cookie kept strictly in memory!)
  const cookieRes = await fetch(shareUrl, { redirect: "manual" });
  const setCookies = cookieRes.headers.getSetCookie ? cookieRes.headers.getSetCookie() : [];
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader && cookieRes.status >= 400) {
    console.error(`FATAL: Protected preview unlock failed with HTTP ${cookieRes.status}`);
    process.exit(1);
  }
  const authHeaders: Record<string, string> = cookieHeader ? { Cookie: cookieHeader } : {};

  // Step 1 (START): Read-only environment pin + Linux tokenizer parity probe
  const tStart0 = performance.now();
  const envStartRes = await fetch(`${origin}/api/v1/knowledge/environment?probe_tokenizer=1`, {
    headers: { ...authHeaders, "Cache-Control": "no-store" },
  });
  const envStartMs = Math.round(performance.now() - tStart0);
  const envStartBody = await envStartRes.json().catch(() => null);
  const startCheck = validateEnvironmentAndLinuxTokenizerParity(
    envStartRes.status,
    envStartBody,
    pin,
    "start"
  );
  if (!startCheck.ok) {
    console.error("FAIL [START PREFLIGHT / LINUX TOKENIZER PARITY]:", startCheck.failures);
    process.exit(1);
  }

  // Step 2: Fictional smoke query -> live Gemini 4 Neon @ low + durable Neon save
  const fictionalQuestion =
    "บริษัทสมมติ อัลฟ่า คอมเมิร์ซ จำกัด ขายสินค้าในประเทศและออกใบกำกับภาษีในวันที่ 30 กันยายน 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด";
  const tQuery0 = performance.now();
  const qRes = await fetch(`${origin}/api/v1/knowledge/query`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      question: fictionalQuestion,
      applicable_date: "2025-09-30",
      mode: "standard",
      answer_generation_mode: "llm_grounded",
      thinking_level: "low",
      persist_answer: true,
    }),
  });
  const queryMs = Math.round(performance.now() - tQuery0);
  const qBody = await qRes.json().catch(() => null);
  const queryCheck = validateHostedQueryResponse(qRes.status, qBody, pin);
  if (!queryCheck.ok) {
    console.error("FAIL [HOSTED QUERY / LIVE MODEL / SAVE]:", queryCheck.failures);
    process.exit(1);
  }

  const savedRevisionId = String(queryCheck.extracted!.saved_revision_id);

  // Step 3: Reopen exact saved revision via GET /api/v1/knowledge/answers/:id?require_db=1 (verified Neon read!)
  const tReopen0 = performance.now();
  const reopenRes = await fetch(
    `${origin}/api/v1/knowledge/answers/${encodeURIComponent(savedRevisionId)}?require_db=1`,
    {
      headers: { ...authHeaders, "Cache-Control": "no-store" },
    }
  );
  const reopenMs = Math.round(performance.now() - tReopen0);
  const reopenBody = await reopenRes.json().catch(() => null);
  const reopenCheck = validateHostedReopenResponse(reopenRes.status, reopenBody, qBody);
  if (!reopenCheck.ok) {
    console.error("FAIL [NEON DB-BACKED REOPEN]:", reopenCheck.failures);
    process.exit(1);
  }

  // Step 4 (END): Re-verify build pin at end of run (zero deployment drift)
  const envEndRes = await fetch(`${origin}/api/v1/knowledge/environment`, {
    headers: { ...authHeaders, "Cache-Control": "no-store" },
  });
  const envEndBody = await envEndRes.json().catch(() => null);
  const endCheck = validateEnvironmentAndLinuxTokenizerParity(
    envEndRes.status,
    envEndBody,
    pin,
    "end"
  );
  if (!endCheck.ok) {
    console.error("FAIL [END BUILD-PIN DRIFT CHECK]:", endCheck.failures);
    process.exit(1);
  }

  const receipt = {
    schema_version: "2.0-hosted-smoke",
    executed_at: new Date().toISOString(),
    preview_origin: origin,
    verified_pin: pin,
    preflight_start: {
      http_status: envStartRes.status,
      elapsed_ms: envStartMs,
      ok: true,
      tokenizer_parity_probe: envStartBody.tokenizer_parity_probe,
    },
    smoke_query_and_save: {
      http_status: qRes.status,
      elapsed_ms: queryMs,
      stage_timing_header: qRes.headers.get("x-reg24-stage-timing-ms"),
      ok: true,
      ...queryCheck.extracted,
      answer_preview_th: String(qBody?.answer?.answer || "").slice(0, 400),
    },
    db_backed_reopen: {
      endpoint: `/api/v1/knowledge/answers/${encodeURIComponent(savedRevisionId)}?require_db=1`,
      http_status: reopenRes.status,
      elapsed_ms: reopenMs,
      ok: true,
      ...reopenCheck.extracted,
    },
    preflight_end: {
      http_status: envEndRes.status,
      ok: true,
      ...endCheck.extracted,
    },
  };

  console.log(JSON.stringify(receipt, null, 2));
  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), "utf8");
  }
}

main().catch((err) => {
  console.error("FATAL SMOKE RUNNER ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
