import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type PilotReviewDocumentSpec,
  type ProviderHttpCallInput,
  renderPdfPageToPngInfo,
  runB02PublicOcrPilot,
} from "../../scripts/run-b02-170page-typhoon-ocr-pilot";
import {
  DurablePreCallOcrBudgetGuard,
  computeWorstCaseCallCostUsdInclTax,
} from "../../src/packages/ocr-v2/budget-guard";

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

describe("Actual 170-Page B02 Pilot Runner: Real PDF Rendering, Restart/Retry Reservation Lock & Budget Enforcement", () => {
  it("1. Renders real scanned PDF OCR-REV-01.pdf page 1 to valid PNG bytes with verified IHDR dimensions", () => {
    const realPdf = path.resolve(process.cwd(), "public", "ocr-pilot-review-pdfs", "OCR-REV-01.pdf");
    const info = renderPdfPageToPngInfo(realPdf, 1, 180);
    expect(info.png_byte_length).toBeGreaterThan(20_000);
    expect(info.width_px).toBeGreaterThan(900);
    expect(info.height_px).toBeGreaterThan(1200);
    expect(info.png_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("2. Verifies all 33 real public PDFs (170 pages) in preflight dry-run with earlier $0.024268 Gemini smoke spend included inside the $10.00 ceiling", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-pilot-preflight-"));
    try {
      const res = await runB02PublicOcrPilot({
        mode: "PREFLIGHT_DRY_RUN",
        ownerApprovedMaxUsdInclTax: 10.0,
        quarantineOutputDir: tmpDir,
      });
      expect(res.summary.documents_verified_count).toBe(33);
      expect(res.summary.pages_verified_count).toBe(170);
      expect(res.summary.prior_smoke_spend_included_usd_incl_tax).toBe(0.024268);
      expect(res.summary.total_committed_or_in_flight_usd_incl_tax).toBe(0.024268);
      expect(res.summary.remaining_budget_usd_incl_tax).toBe(9.975732);
      expect(res.summary.primary_calls_dispatched).toBe(0);
      expect(res.summary.secondary_calls_dispatched).toBe(0);
      expect(res.summary.usable_as_legal_evidence).toBe(false);
      expect(res.summary.releases_quarantined_citations).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("2b. Runs 1-page Typhoon check first: stops after Page 1 if gate fails, and continues to Page 2+ when Page 1 passes", async () => {
    const tmpFail = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-p1gate-fail-"));
    const tmpPass = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-p1gate-pass-"));
    try {
      const fake3 = makeFakeDoc("OCR-REV-01", 3, "public");
      let failCalls = 0;
      const failedGate = await runB02PublicOcrPilot({
        mode: "LIVE_BUDGETED_EXECUTION",
        ownerApprovedMaxUsdInclTax: 10.0,
        includePriorSmokeSpend: true,
        enforcePage1GateBeforeContinuing: true,
        enableSecondaryModel: false,
        quarantineOutputDir: tmpFail,
        documentsOverride: [fake3.doc],
        pdfResolver: () => fake3.bytes,
        pageRenderer: (_d, p) => Buffer.from(`PNG-${p}`).toString("base64"),
        httpTransport: async () => {
          failCalls += 1;
          return {
            http_status: 200,
            text: "too short",
            input_tokens: 100,
            output_and_thinking_tokens: 10,
            raw_model_id: "typhoon-ocr",
          };
        },
      });
      expect(failCalls).toBe(1);
      expect(failedGate.summary.page_1_gate_checked).toBe(true);
      expect(failedGate.summary.page_1_gate_passed).toBe(false);
      expect(failedGate.summary.stopped_by_page_1_gate).toBe(true);
      expect(failedGate.pages.length).toBe(1);

      let passCalls = 0;
      const passedGate = await runB02PublicOcrPilot({
        mode: "LIVE_BUDGETED_EXECUTION",
        ownerApprovedMaxUsdInclTax: 10.0,
        includePriorSmokeSpend: true,
        enforcePage1GateBeforeContinuing: true,
        enableSecondaryModel: false,
        quarantineOutputDir: tmpPass,
        documentsOverride: [fake3.doc],
        pdfResolver: () => fake3.bytes,
        pageRenderer: (_d, p) => Buffer.from(`PNG-${p}`).toString("base64"),
        httpTransport: async (c) => {
          passCalls += 1;
          return {
            http_status: 200,
            text: `หน้า ${c.page_number} พระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514 มาตรา 4 ให้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษา`,
            input_tokens: 3200,
            output_and_thinking_tokens: 640,
            raw_model_id: "typhoon-ocr",
          };
        },
      });
      expect(passCalls).toBe(3);
      expect(passedGate.summary.page_1_gate_checked).toBe(true);
      expect(passedGate.summary.page_1_gate_passed).toBe(true);
      expect(passedGate.summary.stopped_by_page_1_gate).toBe(false);
      expect(passedGate.pages.length).toBe(3);
      expect(passedGate.summary.prior_smoke_spend_included_usd_incl_tax).toBe(0.024268);
    } finally {
      fs.rmSync(tmpFail, { recursive: true, force: true });
      fs.rmSync(tmpPass, { recursive: true, force: true });
    }
  });

  it("3. Enforces pre-call budget reservations across primary retries AND secondary gemini-3.8-flash calls/retries, aborting BEFORE the HTTP call that would exceed the cap", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-pilot-runner-cap-"));
    try {
      const fake1 = makeFakeDoc("OCR-REV-01", 3, "public");
      const primaryWorst = computeWorstCaseCallCostUsdInclTax("typhoon-ocr2-2b-partner-page"); // ~$0.033063
      const secondaryWorst = computeWorstCaseCallCostUsdInclTax("gemini-3.8-flash-ocr"); // ~$0.022301

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
      expect(observedTransportCalls.length).toBe(5);
      expect(res.summary.primary_calls_dispatched).toBe(3);
      expect(res.summary.primary_retries_dispatched).toBe(1);
      expect(res.summary.secondary_calls_dispatched).toBe(2);
      expect(res.summary.secondary_retries_dispatched).toBe(1);
      expect(res.summary.stopped_by_budget_guard).toBe(true);
      expect(res.summary.budget_stop_reason).toMatch(/PRECALL_BUDGET_CAP_EXCEEDED_429/);
      expect(res.summary.total_committed_or_in_flight_usd_incl_tax).toBeLessThanOrEqual(tightCapUsd);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("4. Prevents a restart or retry from ever reusing a prior reservation or making an extra paid call without a new budget reservation", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-pilot-restart-"));
    try {
      const ledgerPath = path.join(tmpDir, "pilot-budget-ledger.json");
      const fake1 = makeFakeDoc("OCR-REV-01", 1, "public");

      // Simulate Process 1 reserving attempt 1 ($0.033063) against a $0.050000 cap and crashing mid-flight!
      const crashedGuard = new DurablePreCallOcrBudgetGuard({
        ledgerPath,
        allowPaidDispatch: true,
        ownerApprovedMaxUsdInclTax: 0.05,
        maxAttemptsPerPage: 2,
      });
      const orphanRsv = crashedGuard.reserveBeforeProviderCall({
        document_sha256: fake1.doc.sha256,
        page_number: 1,
        attempt_index: 1,
        privacy_class: "public",
        provider_id: "typhoon-ocr2-2b-partner-page",
      });
      expect(orphanRsv.status).toBe("RESERVED_IN_FLIGHT");

      // Direct guard check: trying to reuse attempt_index=1 after crash is HARD-REJECTED!
      expect(() =>
        crashedGuard.reserveBeforeProviderCall({
          document_sha256: fake1.doc.sha256,
          page_number: 1,
          attempt_index: 1,
          privacy_class: "public",
          provider_id: "typhoon-ocr2-2b-partner-page",
        })
      ).toThrow(/DUPLICATE_ATTEMPT_REQUIRES_NEW_RESERVATION_409/);

      // Now Process 2 restarts `runB02PublicOcrPilot` against the same $0.050000 ledger:
      //  - Reconciles orphaned attempt 1 to FAILED_POST_SEND_CHARGED ($0.033063)
      //  - Advances to attempt 2, which requires a BRAND-NEW $0.033063 reservation ($0.066126 > $0.050000)
      //  - MUST block BEFORE firing 1 single extra HTTP call!
      let postRestartHttpCalls = 0;
      const resumed = await runB02PublicOcrPilot({
        mode: "LIVE_BUDGETED_EXECUTION",
        ownerApprovedMaxUsdInclTax: 0.05,
        maxAttemptsPerPage: 2,
        quarantineOutputDir: tmpDir,
        ledgerPath,
        documentsOverride: [fake1.doc],
        pdfResolver: () => fake1.bytes,
        pageRenderer: () => Buffer.from("PNG-PAGE-1").toString("base64"),
        httpTransport: async () => {
          postRestartHttpCalls += 1;
          throw new Error("MUST_NEVER_FIRE_WITHOUT_NEW_RESERVATION");
        },
      });

      expect(postRestartHttpCalls).toBe(0);
      expect(resumed.summary.orphaned_inflight_reservations_reconciled).toBe(1);
      expect(resumed.summary.stopped_by_budget_guard).toBe(true);
      expect(resumed.summary.total_committed_or_in_flight_usd_incl_tax).toBeLessThanOrEqual(0.05);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
