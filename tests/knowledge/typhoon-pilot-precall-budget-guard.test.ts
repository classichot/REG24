import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DurablePreCallOcrBudgetGuard,
  compute170PagePilotWorstCaseEstimate,
  computeWorstCaseCallCostUsdInclTax,
} from "../../src/packages/ocr-v2/budget-guard";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore, setDefaultKnowledgeStoreForTesting } from "../../src/core/knowledge/store";
import { GET as getBatchReportRoute } from "../../src/app/api/v1/knowledge/batches/[id]/report/route";
import type { Actor } from "../../src/core/knowledge/contracts";

const LEGAL_TEST_ACTOR: Actor = {
  actor_id: "owner.retest@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Owner Remediation Verification: 0702/5137 & 0702/6847 Retest, Live Git Commit Label & Pre-Call Typhoon Budget Guard", () => {
  it("1. Retests remediated กค 0702/5137 (26676.html) and กค 0702/6847 (26135.html) against original RD conclusions, dates, and URLs", async () => {
    const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
    const store = new DurableKnowledgeStore(previewDir);

    // A. 0702/5137 (2 กรกฎาคม 2561, https://www.rd.go.th/26676.html) — previously truncated at '..DRFT' in facts
    const ans5137 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ 0702/5137",
        release_id: "rel.B01.rc5",
        mode: "exact_lookup",
      },
      LEGAL_TEST_ACTOR,
      { store }
    );
    expect(ans5137.status).toBe("ANSWERED");
    expect(ans5137.answer).toContain("2 กรกฎาคม 2561");
    expect(ans5137.answer).toContain("https://www.rd.go.th/26676.html");
    expect(ans5137.answer).toContain(
      "จึงผ่อนปรนโดยให้ถือว่าการที่บริษัทฯ ได้ยื่นแบบ ค.อ.1"
    );
    expect(ans5137.answer).toContain(
      "ตามกำหนดเวลาตามข้อ 3 ของประกาศอธิบดีกรมสรรพากรฯ ลงวันที่ 19 ตุลาคม พ.ศ. 2555"
    );
    expect(ans5137.evidence[0].locator.origin_uri).toBe("https://www.rd.go.th/26676.html");
    expect(ans5137.evidence[0].raw_date_text).toBe("2 กรกฎาคม 2561");

    // B. 0702/6847 (23 กรกฎาคม 2558, https://www.rd.go.th/26135.html) — previously split falsely on 'ประกอบกับแนววินิจฉัย' in facts
    const ans6847 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ 0702/6847",
        release_id: "rel.B01.rc5",
        mode: "exact_lookup",
      },
      LEGAL_TEST_ACTOR,
      { store }
    );
    expect(ans6847.status).toBe("ANSWERED");
    expect(ans6847.answer).toContain("23 กรกฎาคม 2558");
    expect(ans6847.answer).toContain("https://www.rd.go.th/26135.html");
    expect(ans6847.answer).toContain(
      "บริษัท ก. จึงมีหน้าที่หักภาษีเงินได้ ณ ที่จ่ายตามสัญญาดังกล่าว ตามมาตรา 3 เตรส แห่งประมวลรัษฎากร"
    );
    expect(ans6847.answer).toContain("ท.ป. 4/2528ฯ ลงวันที่ 26 กันยายน พ.ศ. 2528");
    expect(ans6847.evidence[0].locator.origin_uri).toBe("https://www.rd.go.th/26135.html");
    expect(ans6847.evidence[0].raw_date_text).toBe("23 กรกฎาคม 2558");
  });

  it("2. Surfaces live VERCEL_GIT_COMMIT_SHA in /api/v1/knowledge/batches/B01/report instead of stale parent staging commit", async () => {
    const prevSha = process.env.VERCEL_GIT_COMMIT_SHA;
    const prevPreview = process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
    try {
      process.env.VERCEL_GIT_COMMIT_SHA = "abc999888777666555444333222111000fedcba9";
      process.env.REG24_USE_B01_RC2_PREVIEW_STORE = "1";
      setDefaultKnowledgeStoreForTesting(null);

      const res = await getBatchReportRoute(
        new Request("http://localhost/api/v1/knowledge/batches/B01/report"),
        { params: Promise.resolve({ id: "B01" }) }
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deployed_code_commit).toBe("abc999888777666555444333222111000fedcba9");
      expect(json.report.code_commit).toBe("abc999888777666555444333222111000fedcba9");
      expect(json.staged_parent_commit).toBeTruthy();
    } finally {
      if (prevSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = prevSha;
      if (prevPreview === undefined) delete process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
      else process.env.REG24_USE_B01_RC2_PREVIEW_STORE = prevPreview;
      setDefaultKnowledgeStoreForTesting(null);
    }
  });

  it("3. Enforces public-only documents, locked paid dispatch by default, pre-call worst-case reservation incl. 7% VAT, persistence across restarts/retries, and quarantine isolation", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ocr-budget-guard-"));
    try {
      const lockedLedgerPath = path.join(tmpDir, "locked-ledger.json");
      const lockedGuard = new DurablePreCallOcrBudgetGuard({
        ledgerPath: lockedLedgerPath,
        allowPaidDispatch: false,
        ownerApprovedMaxUsdInclTax: 0,
      });

      // Paid run is locked by default until Owner confirms maximum
      expect(() =>
        lockedGuard.reserveBeforeProviderCall({
          document_sha256: "1341f3c4e400c1875264f1be06b56ce70c2e80d2d1eb3643364bdf07d856d1c6",
          page_number: 1,
          attempt_index: 1,
          privacy_class: "public",
          provider_id: "gemini-3.8-flash-ocr",
        })
      ).toThrow(/PAID_RUN_NOT_YET_APPROVED_403/);

      // Non-public documents are strictly rejected even before checking budget
      expect(() =>
        lockedGuard.reserveBeforeProviderCall({
          document_sha256: "deadbeef",
          page_number: 1,
          attempt_index: 1,
          privacy_class: "confidential",
          provider_id: "typhoon-ocr-v2-hosted",
        })
      ).toThrow(/NON_PUBLIC_DOCUMENT_BLOCKED_403/);

      // Unlocked simulation with tight $0.05 cap (enough for 2 worst-case Gemini calls @ ~$0.0223 each, blocking the 3rd BEFORE network I/O!)
      const singleGeminiWorst = computeWorstCaseCallCostUsdInclTax("gemini-3.8-flash-ocr");
      expect(singleGeminiWorst).toBeGreaterThan(0.02);
      expect(singleGeminiWorst).toBeLessThan(0.025);

      const capPath = path.join(tmpDir, "capped-ledger.json");
      const guard1 = new DurablePreCallOcrBudgetGuard({
        ledgerPath: capPath,
        allowPaidDispatch: true,
        ownerApprovedMaxUsdInclTax: 0.05,
        maxAttemptsPerPage: 2,
      });

      const r1 = guard1.reserveBeforeProviderCall({
        document_sha256: "doc1",
        page_number: 1,
        attempt_index: 1,
        privacy_class: "public",
        provider_id: "gemini-3.8-flash-ocr",
      });
      expect(r1.usable_as_legal_evidence).toBe(false);
      expect(r1.quarantine_status).toBe("QUARANTINED_PENDING_HUMAN_LEGAL_CURATION");

      // Simulate network timeout after sending -> retains worst-case charge!
      guard1.markPostSendAmbiguousFailure(r1.reservation_id);

      // Simulate process crash & restart reading persisted state from disk!
      const guardAfterRestart = new DurablePreCallOcrBudgetGuard({
        ledgerPath: capPath,
        allowPaidDispatch: true,
        ownerApprovedMaxUsdInclTax: 0.05,
      });

      // Retry attempt 2 reserves a second worst-case slot (~$0.0446 cumulative <= $0.05)
      const r2 = guardAfterRestart.reserveBeforeProviderCall({
        document_sha256: "doc1",
        page_number: 1,
        attempt_index: 2,
        privacy_class: "public",
        provider_id: "gemini-3.8-flash-ocr",
      });
      expect(r2.attempt_index).toBe(2);

      // A 3rd call (page 2) would bring worst-case total to ~$0.0669 > $0.05 -> BLOCKED BEFORE DISPATCH!
      expect(() =>
        guardAfterRestart.reserveBeforeProviderCall({
          document_sha256: "doc1",
          page_number: 2,
          attempt_index: 1,
          privacy_class: "public",
          provider_id: "gemini-3.8-flash-ocr",
        })
      ).toThrow(/PRECALL_BUDGET_CAP_EXCEEDED_429/);

      // Once attempt 2 settles with small actual token usage (e.g., 3,500 in / 900 out), unused headroom is safely released
      guardAfterRestart.settleCompletedCall(r2.reservation_id, {
        input_tokens: 3500,
        output_and_thinking_tokens: 900,
      });
      expect(guardAfterRestart.readState().total_committed_or_in_flight_usd_incl_tax).toBeLessThan(0.032);

      // Verify 170-page pilot deterministic worst-case ceiling calculation
      const est = compute170PagePilotWorstCaseEstimate({ uniquePages: 170, maxAttemptsPerPage: 2 });
      expect(est.unique_public_pages).toBe(170);
      expect(est.includes_7pct_thai_vat_and_3pct_fx_buffer).toBe(true);
      expect(
        est.scenarios_usd_incl_retries_and_tax.option_2_selfhosted_l4_gpu_plus_gemini_fallback
          .hard_worst_case_max_usd
      ).toBeLessThanOrEqual(10.0);
      expect(
        est.scenarios_usd_incl_retries_and_tax.option_3_commercial_partner_003_page_plus_gemini_fallback
          .hard_worst_case_max_usd
      ).toBeLessThanOrEqual(20.0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
