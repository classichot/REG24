import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type PilotReviewDocumentSpec,
  type ProviderHttpCallInput,
  runB02PublicOcrPilot,
} from "../../scripts/run-b02-170page-typhoon-ocr-pilot";
import { computeWorstCaseCallCostUsdInclTax } from "../../src/packages/ocr-v2/budget-guard";

function makeFakeDoc(
  id: string,
  pageCount: number,
  privacyClass: "public" | "confidential" = "public"
): { doc: PilotReviewDocumentSpec; bytes: Buffer } {
  const bytes = Buffer.from(`%PDF-1.4-FAKE-${id}`, "utf8");
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    doc: {
      review_item_id: id,
      priority_tier: "P0_UNLOCKS_QUARANTINED_CITATIONS",
      candidate_id: `cand.${id}`,
      physical_corpus_rel_path: `RD/CIT/${id}.pdf`,
      sha256: sha,
      physical_page_count: pageCount,
      privacy_class: privacyClass,
      accessible_original_pdf: {
        preview_pdf_path: `/ocr-pilot-review-pdfs/${id}.pdf`,
      },
      matched_quarantine_ref_ids: ["uref.test.01"],
    },
  };
}

describe("Actual 170-Page B02 Pilot Runner End-to-End Budget Enforcement (Primary + Retries + Secondary Model)", () => {
  it("1. Verifies all 33 real public PDFs (170 pages) in preflight dry-run with zero network calls and strict $10.00 ceiling", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-pilot-preflight-"));
    try {
      const res = await runB02PublicOcrPilot({
        mode: "PREFLIGHT_DRY_RUN",
        ownerApprovedMaxUsdInclTax: 10.0,
        quarantineOutputDir: tmpDir,
      });
      expect(res.summary.documents_verified_count).toBe(33);
      expect(res.summary.pages_verified_count).toBe(170);
      expect(res.summary.primary_calls_dispatched).toBe(0);
      expect(res.summary.secondary_calls_dispatched).toBe(0);
      expect(res.summary.usable_as_legal_evidence).toBe(false);
      expect(res.summary.releases_quarantined_citations).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("2. Enforces pre-call budget reservations across primary retries AND secondary gemini-3.8-flash calls/retries, aborting BEFORE the HTTP call that would exceed the cap", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-pilot-runner-cap-"));
    try {
      const fake1 = makeFakeDoc("OCR-REV-01", 3, "public");
      const primaryWorst = computeWorstCaseCallCostUsdInclTax("typhoon-ocr2-2b-partner-page"); // ~$0.033063
      const secondaryWorst = computeWorstCaseCallCostUsdInclTax("gemini-3.8-flash-ocr"); // ~$0.022325

      // Page 1 will execute:
      //  1) Primary attempt 1 -> HTTP 503 failure (retains $0.033063 worst-case charge!)
      //  2) Primary attempt 2 (RETRY) -> HTTP 200 with Thai tax rate 'ร้อยละ 10 เว้นแต่' (settled $0.033063 -> cumulative $0.066126)
      //  3) Secondary gemini-3.8-flash attempt 1 -> HTTP 503 failure (retains $0.022325 worst-case charge -> cumulative $0.088451)
      //  4) Secondary gemini-3.8-flash attempt 2 (SECONDARY RETRY) -> reserves $0.022325 -> cumulative $0.110776 <= $0.130000 cap!
      //     (After settling actual tokens 3000 in / 800 out -> ~$0.005801, cumulative becomes ~$0.094252)
      // Page 2 will then execute:
      //  5) Primary attempt 1 -> reserves $0.033063 -> cumulative ~$0.127315 <= $0.130000 cap, returns 'ร้อยละ 5'
      //  6) Secondary gemini-3.8-flash attempt 1 -> needs $0.022325 -> projected ~$0.149640 > $0.130000 cap ->
      //     MUST ABORT BEFORE CALLING HTTP TRANSPORT!
      const tightCapUsd = 0.13;
      const observedTransportCalls: ProviderHttpCallInput[] = [];

      const res = await runB02PublicOcrPilot({
        mode: "LIVE_BUDGETED_EXECUTION",
        ownerApprovedMaxUsdInclTax: tightCapUsd,
        maxAttemptsPerPage: 2,
        quarantineOutputDir: tmpDir,
        documentsOverride: [fake1.doc],
        pdfResolver: () => fake1.bytes,
        pageRenderer: (_doc, pno) => Buffer.from(`PNG-PAGE-${pno}`).toString("base64"),
        httpTransport: async (call) => {
          observedTransportCalls.push(call);
          if (call.page_number === 1 && call.provider_id === "typhoon-ocr2-2b-partner-page" && call.attempt_index === 1) {
            throw new Error("TYPHOON_HTTP_503_TRANSIENT");
          }
          if (call.page_number === 1 && call.provider_id === "typhoon-ocr2-2b-partner-page" && call.attempt_index === 2) {
            return {
              http_status: 200,
              text: "มาตรา 4 ให้จัดเก็บภาษีในอัตราร้อยละ 10 เว้นแต่กรณีตามวรรคสอง",
              input_tokens: 4200,
              output_and_thinking_tokens: 900,
              raw_model_id: "typhoon-ocr",
            };
          }
          if (call.page_number === 1 && call.provider_id === "gemini-3.8-flash-ocr" && call.attempt_index === 1) {
            throw new Error("GEMINI_HTTP_503_TRANSIENT");
          }
          if (call.page_number === 1 && call.provider_id === "gemini-3.8-flash-ocr" && call.attempt_index === 2) {
            return {
              http_status: 200,
              text: "มาตรา 4 ให้จัดเก็บภาษีในอัตราร้อยละ 10 เว้นแต่กรณีตามวรรคสอง",
              input_tokens: 3000,
              output_and_thinking_tokens: 800,
              raw_model_id: "gemini-3.8-flash",
            };
          }
          // Page 2 primary attempt 1 succeeds and triggers secondary rate check, which MUST be blocked BEFORE HTTP!
          return {
            http_status: 200,
            text: "มาตรา 5 อัตราภาษีร้อยละ 5 ของมูลค่าสินค้าส่งออกทั้งหมดในราชอาณาจักร",
            input_tokens: 4000,
            output_and_thinking_tokens: 850,
            raw_model_id: "typhoon-ocr",
          };
        },
      });

      expect(primaryWorst).toBeGreaterThan(0.033);
      expect(secondaryWorst).toBeGreaterThan(0.022);

      // Exactly 5 HTTP requests were sent; the 6th (Page 2 secondary call) was blocked BEFORE HTTP!
      expect(observedTransportCalls.length).toBe(5);
      expect(res.summary.primary_calls_dispatched).toBe(3);
      expect(res.summary.primary_retries_dispatched).toBe(1);
      expect(res.summary.secondary_calls_dispatched).toBe(2);
      expect(res.summary.secondary_retries_dispatched).toBe(1);
      expect(res.summary.stopped_by_budget_guard).toBe(true);
      expect(res.summary.budget_stop_reason).toMatch(/PRECALL_BUDGET_CAP_EXCEEDED_429/);
      expect(res.summary.total_committed_or_in_flight_usd_incl_tax).toBeLessThanOrEqual(tightCapUsd);

      // Page 1 completed with all 4 reservations recorded and strictly quarantined
      expect(res.pages.length).toBe(1);
      expect(res.pages[0].reservation_ids.length).toBe(4);
      expect(res.pages[0].usable_as_legal_evidence).toBe(false);
      expect(res.pages[0].quarantine_status).toBe("QUARANTINED_PENDING_OWNER_LEGAL_TEAM_REVIEW");
      expect(res.pages[0].releases_quarantined_citations).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("3. Rejects any non-public document or ceiling > $10.00 before dispatching a single HTTP request", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-pilot-nonpub-"));
    try {
      const conf = makeFakeDoc("OCR-CONF-01", 1, "confidential");
      let networkCalls = 0;
      await expect(
        runB02PublicOcrPilot({
          mode: "LIVE_BUDGETED_EXECUTION",
          ownerApprovedMaxUsdInclTax: 10.0,
          quarantineOutputDir: tmpDir,
          documentsOverride: [conf.doc],
          pdfResolver: () => conf.bytes,
          httpTransport: async () => {
            networkCalls += 1;
            throw new Error("SHOULD_NEVER_BE_CALLED");
          },
        })
      ).rejects.toThrow(/NON_PUBLIC_DOCUMENT_BLOCKED_403/);
      expect(networkCalls).toBe(0);

      await expect(
        runB02PublicOcrPilot({
          mode: "PREFLIGHT_DRY_RUN",
          ownerApprovedMaxUsdInclTax: 10.01,
          quarantineOutputDir: tmpDir,
        })
      ).rejects.toThrow(/OWNER_BUDGET_CAP_VIOLATION/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
