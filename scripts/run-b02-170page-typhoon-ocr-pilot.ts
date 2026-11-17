/**
 * REG24 — Actual 170-Page B02 Public-Document OCR Pilot Runner (`typhoon-ocr` Primary + `gemini-3.8-flash` Secondary)
 *
 * Enforces Owner Approvals & Pre-Start Safety Gates (2026-11-17):
 * 1. One-time budget ceiling hard-locked to `<= US$10.00` (inclusive of 7% Thai VAT + 3% FX buffer).
 * 2. Every single network call — primary `typhoon-ocr` attempt 1, primary retry attempt 2,
 *    secondary `gemini-3.8-flash` attempt 1, secondary retry attempt 2, AND any post-crash/restart
 *    re-attempt — MUST acquire a brand-new durable on-disk worst-case reservation
 *    (`DurablePreCallOcrBudgetGuard.reserveBeforeProviderCall`) BEFORE any HTTP bytes leave the process.
 *    Orphaned `RESERVED_IN_FLIGHT` slots from crashed runs are automatically reconciled to
 *    `FAILED_POST_SEND_CHARGED` on startup and can NEVER be reused for an extra paid call.
 * 3. Deterministic multi-line PyMuPDF PNG renderer (`renderPdfPageToPngBase64`) verified against PNG
 *    magic header (`\x89PNG\r\n\x1a\n`) and `IHDR` pixel dimensions (`width x height`).
 * 4. Strictly `privacy_class === "public"` documents only (the 33 unique RD statutes/decrees/regulations = 170 pages),
 *    verified by exact SHA-256 against `b02_170page_ocr_pilot_review_list.json` before page rendering.
 * 5. All extracted OCR text, dual-OCR comparisons, and matched citations are written ONLY to the isolated,
 *    git-ignored quarantine directory (`data/ocr-pilot-quarantine/b02-170p/`) with:
 *      - `usable_as_legal_evidence: false`
 *      - `quarantine_status: "QUARANTINED_PENDING_OWNER_LEGAL_TEAM_REVIEW"`
 *      - `applicability_status: "not_assessed"`
 *      - `releases_quarantined_citations: false`
 *    Protected `data/knowledge-store/canonical-state.json.gz` and `rel.B01.rc5` are NEVER modified.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { PrivacyClass } from "../src/packages/ocr-v2/contract";
import {
  type BudgetReservationRecord,
  type CallablePilotProviderId,
  DurablePreCallOcrBudgetGuard,
  computeWorstCaseCallCostUsdInclTax,
} from "../src/packages/ocr-v2/budget-guard";
import { compareDualOcrPassages } from "../src/packages/ocr-v2/typhoon-v2-parser";

export interface PilotReviewDocumentSpec {
  review_item_id: string;
  priority_tier: string;
  candidate_id: string;
  physical_corpus_rel_path: string;
  sha256: string;
  physical_page_count: number;
  privacy_class: PrivacyClass;
  accessible_original_pdf: {
    preview_pdf_path: string;
  };
  matched_quarantine_ref_ids: string[];
}

export interface RenderedPngPageInfo {
  png_base64: string;
  png_byte_length: number;
  png_sha256: string;
  width_px: number;
  height_px: number;
}

export interface ProviderHttpCallInput {
  provider_id: CallablePilotProviderId;
  document_sha256: string;
  review_item_id: string;
  page_number: number;
  attempt_index: number;
  png_base64: string;
}

export interface ProviderHttpCallResult {
  http_status: number;
  text: string;
  input_tokens: number;
  output_and_thinking_tokens: number;
  raw_model_id: string;
  raw_usage_metadata?: Record<string, unknown>;
}

export type PilotHttpTransport = (call: ProviderHttpCallInput) => Promise<ProviderHttpCallResult>;

export interface QuarantinedPilotPageResult {
  review_item_id: string;
  document_sha256: string;
  page_number: number;
  privacy_class: "public";
  rendered_png_sha256: string;
  rendered_png_dimensions: { width_px: number; height_px: number; byte_length: number };
  primary_provider_id: CallablePilotProviderId;
  primary_raw_model_id: string | null;
  primary_attempts_used: number;
  primary_text: string | null;
  primary_raw_usage_metadata: Record<string, unknown> | null;
  secondary_triggered: boolean;
  secondary_trigger_reason: string | null;
  secondary_provider_id: CallablePilotProviderId | null;
  secondary_raw_model_id: string | null;
  secondary_attempts_used: number;
  secondary_text: string | null;
  secondary_raw_usage_metadata: Record<string, unknown> | null;
  dual_ocr_disagreement_flags: string[];
  reservation_ids: string[];
  usable_as_legal_evidence: false;
  quarantine_status: "QUARANTINED_PENDING_OWNER_LEGAL_TEAM_REVIEW";
  applicability_status: "not_assessed";
  releases_quarantined_citations: false;
}

export interface PilotRunSummary {
  mode: "PREFLIGHT_DRY_RUN" | "LIVE_BUDGETED_EXECUTION";
  started_at: string;
  completed_at: string;
  owner_approved_max_usd_incl_tax: number;
  prior_smoke_spend_included_usd_incl_tax: number;
  orphaned_inflight_reservations_reconciled: number;
  total_committed_or_in_flight_usd_incl_tax: number;
  remaining_budget_usd_incl_tax: number;
  documents_verified_count: number;
  pages_verified_count: number;
  pages_resumed_from_quarantine_count: number;
  pages_processed_count: number;
  primary_calls_dispatched: number;
  primary_retries_dispatched: number;
  secondary_calls_dispatched: number;
  secondary_retries_dispatched: number;
  page_1_gate_checked: boolean;
  page_1_gate_passed: boolean;
  stopped_by_page_1_gate: boolean;
  page_1_gate_failure_reason: string | null;
  stopped_by_budget_guard: boolean;
  budget_stop_reason: string | null;
  quarantine_output_dir: string;
  all_outputs_quarantined: true;
  usable_as_legal_evidence: false;
  releases_quarantined_citations: false;
}

export function loadPriorSmokeVerificationReservations(): {
  records: BudgetReservationRecord[];
  totalUsdInclTax: number;
} {
  const receiptPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "b02_single_page_live_verification_receipt_20261117.json"
  );
  if (!fs.existsSync(receiptPath)) {
    return { records: [], totalUsdInclTax: 0 };
  }
  const raw = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as {
    settled_ledger?: { reservations?: Record<string, BudgetReservationRecord> };
  };
  const resMap = raw.settled_ledger?.reservations || {};
  const records: BudgetReservationRecord[] = Object.values(resMap).map((r) => ({
    ...r,
    // Prefix document_sha256 with `prior_smoke:` so full-run OCR-REV-01 page 1 gets fresh per-page attempts
    // while keeping 100% of the prior smoke test + retry dollar cost deducted from the shared $10.00 cap.
    document_sha256: r.document_sha256.startsWith("prior_smoke:")
      ? r.document_sha256
      : `prior_smoke:${r.document_sha256}`,
  }));
  const totalUsdInclTax = Number(
    records
      .reduce((acc, r) => acc + (r.status === "RELEASED_PRE_SEND" ? 0 : r.charged_usd_incl_tax), 0)
      .toFixed(6)
  );
  return { records, totalUsdInclTax };
}

const PNG_MAGIC_HEX = "89504e470d0a1a0a";

export function inspectAndValidatePngBuffer(pngBytes: Buffer): {
  width_px: number;
  height_px: number;
  png_sha256: string;
} {
  if (pngBytes.length < 33 || pngBytes.subarray(0, 8).toString("hex") !== PNG_MAGIC_HEX) {
    throw new Error("INVALID_RENDERED_PNG: Output does not start with valid 8-byte PNG signature.");
  }
  const ihdrTag = pngBytes.subarray(12, 16).toString("ascii");
  if (ihdrTag !== "IHDR") {
    throw new Error(`INVALID_RENDERED_PNG_IHDR: Expected IHDR chunk, got '${ihdrTag}'.`);
  }
  const width = pngBytes.readUInt32BE(16);
  const height = pngBytes.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`INVALID_RENDERED_PNG_DIMENSIONS: ${width}x${height}`);
  }
  return {
    width_px: width,
    height_px: height,
    png_sha256: crypto.createHash("sha256").update(pngBytes).digest("hex"),
  };
}

export function renderPdfPageToPngInfo(
  pdfAbsPath: string,
  oneBasedPage: number,
  dpi = 180
): RenderedPngPageInfo {
  // Multi-line Python script (never join compound `if` statements with `;`!)
  const pyScript = [
    "import sys, base64, pymupdf",
    "doc = pymupdf.open(sys.argv[1])",
    "pno = int(sys.argv[2]) - 1",
    "dpi = int(sys.argv[3])",
    "if pno < 0 or pno >= len(doc):",
    "    raise RuntimeError(f'Page {pno+1} out of range (1..{len(doc)})')",
    "pix = doc[pno].get_pixmap(dpi=dpi, alpha=False)",
    "png_bytes = pix.tobytes('png')",
    "sys.stdout.write(base64.b64encode(png_bytes).decode('ascii'))",
  ].join("\n");

  const b64 = execFileSync("python", ["-c", pyScript, pdfAbsPath, String(oneBasedPage), String(dpi)], {
    encoding: "utf8",
    maxBuffer: 35 * 1024 * 1024,
  }).trim();

  const pngBytes = Buffer.from(b64, "base64");
  const meta = inspectAndValidatePngBuffer(pngBytes);
  return {
    png_base64: b64,
    png_byte_length: pngBytes.length,
    png_sha256: meta.png_sha256,
    width_px: meta.width_px,
    height_px: meta.height_px,
  };
}

export function renderPdfPageToPngBase64(pdfAbsPath: string, oneBasedPage: number): string {
  return renderPdfPageToPngInfo(pdfAbsPath, oneBasedPage).png_base64;
}

export function shouldTriggerSecondaryModelCrossCheck(primaryText: string | null): {
  trigger: boolean;
  reason: string | null;
} {
  if (primaryText === null) {
    return { trigger: true, reason: "PRIMARY_PROVIDER_EXHAUSTED_FALLBACK" };
  }
  const trimmed = primaryText.trim();
  if (trimmed.length < 40) {
    return { trigger: true, reason: "LOW_CHARACTER_YIELD_UNDER_40_CHARS" };
  }
  if (/[\uFFFD\uE000-\uF8FF]/.test(trimmed)) {
    return { trigger: true, reason: "CORRUPT_GLYPH_OR_PUA_DETECTED" };
  }
  if (/<table\b/i.test(trimmed)) {
    return { trigger: true, reason: "HTML_TABLE_CRITICAL_CELL_CROSSCHECK" };
  }
  if (/(?:ร้อยละ|%|\bไม่(?:ต้อง|ให้|อยู่ในบังคับ)|มิใช่|เว้นแต่)/.test(trimmed)) {
    return { trigger: true, reason: "CRITICAL_RATE_OR_NEGATION_TOKEN_CROSSCHECK" };
  }
  return { trigger: false, reason: null };
}

export function createLivePilotHttpTransport(params: {
  openTyphoonApiKey?: string;
  geminiApiKey?: string;
  typhoonEndpoint?: string;
  typhoonModel?: string;
  minTyphoonIntervalMs?: number;
}): PilotHttpTransport {
  const typhoonEndpoint =
    params.typhoonEndpoint || "https://api.opentyphoon.ai/v1/chat/completions";
  const typhoonModel = params.typhoonModel || "typhoon-ocr";
  const minInterval = params.minTyphoonIntervalMs ?? 3200; // <= 18.75 req/min (respects OpenTyphoon 20 RPM limit)
  let lastTyphoonCallMs = 0;

  return async (call: ProviderHttpCallInput): Promise<ProviderHttpCallResult> => {
    if (
      call.provider_id === "typhoon-ocr2-2b-partner-page" ||
      call.provider_id === "typhoon-ocr-v2-hosted"
    ) {
      if (!params.openTyphoonApiKey) {
        throw new Error("MISSING_OPENTYPHOON_API_KEY");
      }
      const elapsed = Date.now() - lastTyphoonCallMs;
      if (lastTyphoonCallMs > 0 && elapsed < minInterval) {
        await new Promise((r) => setTimeout(r, minInterval - elapsed));
      }
      lastTyphoonCallMs = Date.now();

      const resp = await fetch(typhoonEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.openTyphoonApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: typhoonModel,
          temperature: 0.1,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract the complete verbatim Thai and English legal text from this page in clean Markdown. Preserve all section numbers (มาตรา/ข้อ), Thai/Arabic digits, negations (ไม่/มิใช่/เว้นแต่), and tables.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${call.png_base64}`,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!resp.ok) {
        throw new Error(`TYPHOON_HTTP_${resp.status}`);
      }
      const json = (await resp.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Record<string, unknown> & {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        http_status: resp.status,
        text,
        input_tokens: Number(json.usage?.prompt_tokens ?? 4500),
        output_and_thinking_tokens: Number(json.usage?.completion_tokens ?? 1200),
        raw_model_id: json.model || typhoonModel,
        raw_usage_metadata: json.usage || {},
      };
    }

    if (call.provider_id === "gemini-3.8-flash-ocr") {
      if (!params.geminiApiKey) {
        throw new Error("MISSING_GEMINI_API_KEY_FOR_SECONDARY_CROSSCHECK");
      }
      // Attempt 1 targets gemini-3.8-flash; if attempt 1 hit transient 503 high-demand,
      // wait 2s backoff and use gemini-3.1-flash-lite on attempt 2 (still conservatively reserved at gemini-3.8-flash rate).
      if (call.attempt_index >= 2) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      const targetGeminiModel =
        call.attempt_index >= 2 ? "gemini-3.1-flash-lite" : "gemini-3.8-flash";

      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": params.geminiApiKey,
          "Content-Type": "application/json",
          "Api-Revision": "2026-05-20",
        },
        body: JSON.stringify({
          model: targetGeminiModel,
          store: false,
          generation_config: {
            max_output_tokens: 4096,
            temperature: 0.0,
            thinking_level: "low",
          },
          input: [
            {
              type: "text",
              text: "Audit the Thai legal instrument page image and return ONLY a compact JSON object with keys: instrument_title_th, gazette_reference_th, buddhist_era_years (array), section_numbers (array), rate_or_amount_expressions (array), negation_or_exception_tokens (array of exact short tokens such as ไม่, มิใช่, เว้นแต่ found on the page). Do not recite full paragraphs.",
            },
            {
              type: "image",
              data: call.png_base64,
              mime_type: "image/png",
            },
          ],
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`GEMINI_HTTP_${resp.status}:${errBody.slice(0, 240)}`);
      }
      const json = (await resp.json()) as {
        id?: string;
        model?: string;
        output_text?: string;
        outputs?: Array<{ type?: string; text?: string }>;
        steps?: Array<{
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>;
        usage?: Record<string, unknown> & {
          total_input_tokens?: number;
          input_tokens?: number;
          total_output_tokens?: number;
          output_tokens?: number;
          total_thought_tokens?: number;
          thought_tokens?: number;
          total_reasoning_tokens?: number;
          total_tokens?: number;
        };
      };

      let extractedText = json.output_text ?? "";
      if (!extractedText && Array.isArray(json.outputs)) {
        extractedText = json.outputs
          .filter((o) => typeof o.text === "string")
          .map((o) => o.text)
          .join("\n");
      }
      if (!extractedText && Array.isArray(json.steps)) {
        const parts: string[] = [];
        for (const st of json.steps) {
          if (st.type === "model_output" && Array.isArray(st.content)) {
            for (const c of st.content) {
              if (c.type === "text" && typeof c.text === "string") {
                parts.push(c.text);
              }
            }
          }
        }
        extractedText = parts.join("\n");
      }

      const u = json.usage || {};
      const inTok = Number(u.total_input_tokens ?? u.input_tokens ?? 0);
      const outOnlyTok = Number(u.total_output_tokens ?? u.output_tokens ?? 0);
      const thoughtTok = Number(
        u.total_thought_tokens ?? u.thought_tokens ?? u.total_reasoning_tokens ?? 0
      );
      const totalTok = Number(u.total_tokens ?? 0);
      const finalInTok = inTok > 0 ? inTok : 4000;
      const finalOutAndThinkingTok =
        outOnlyTok + thoughtTok > 0
          ? outOnlyTok + thoughtTok
          : totalTok > finalInTok
            ? totalTok - finalInTok
            : 1000;

      return {
        http_status: resp.status,
        text: extractedText,
        input_tokens: finalInTok,
        output_and_thinking_tokens: finalOutAndThinkingTok,
        raw_model_id: json.model || targetGeminiModel,
        raw_usage_metadata: u,
      };
    }

    throw new Error(`UNSUPPORTED_PILOT_PROVIDER: ${call.provider_id}`);
  };
}

export async function runB02PublicOcrPilot(options: {
  mode: "PREFLIGHT_DRY_RUN" | "LIVE_BUDGETED_EXECUTION";
  ownerApprovedMaxUsdInclTax?: number;
  maxAttemptsPerPage?: number;
  primaryProviderId?: CallablePilotProviderId;
  secondaryProviderId?: CallablePilotProviderId;
  quarantineOutputDir?: string;
  ledgerPath?: string;
  documentsOverride?: PilotReviewDocumentSpec[];
  maxPagesLimit?: number;
  pdfResolver?: (doc: PilotReviewDocumentSpec) => Buffer;
  pageRenderer?: (doc: PilotReviewDocumentSpec, pageNumber: number) => RenderedPngPageInfo | string;
  httpTransport?: PilotHttpTransport;
  enableSecondaryModel?: boolean;
  includePriorSmokeSpend?: boolean;
  enforcePage1GateBeforeContinuing?: boolean;
}): Promise<{
  summary: PilotRunSummary;
  pages: QuarantinedPilotPageResult[];
}> {
  const startedAt = new Date().toISOString();
  const maxUsd = options.ownerApprovedMaxUsdInclTax ?? 10.0;
  if (maxUsd <= 0 || maxUsd > 10.0) {
    throw new Error(
      `OWNER_BUDGET_CAP_VIOLATION: Approved one-time pilot ceiling must be in (0, 10.00], got $${maxUsd}.`
    );
  }

  const maxAttempts = options.maxAttemptsPerPage ?? 2;
  const primaryProviderId: CallablePilotProviderId =
    options.primaryProviderId ?? "typhoon-ocr2-2b-partner-page";
  const secondaryProviderId: CallablePilotProviderId =
    options.secondaryProviderId ?? "gemini-3.8-flash-ocr";
  const enableSecondary = options.enableSecondaryModel ?? true;

  const quarantineDir = path.resolve(
    options.quarantineOutputDir ||
      path.join(process.cwd(), "data", "ocr-pilot-quarantine", "b02-170p")
  );
  fs.mkdirSync(quarantineDir, { recursive: true });

  const ledgerPath = path.resolve(
    options.ledgerPath || path.join(quarantineDir, "pilot-budget-ledger.json")
  );

  const docs: PilotReviewDocumentSpec[] =
    options.documentsOverride ??
    (
      JSON.parse(
        fs.readFileSync(
          path.resolve(
            process.cwd(),
            "docs",
            "audit",
            "dodo-review-rc2-b02",
            "b02_170page_ocr_pilot_review_list.json"
          ),
          "utf8"
        )
      ) as { documents: PilotReviewDocumentSpec[] }
    ).documents;

  let verifiedPagesTotal = 0;
  for (const doc of docs) {
    if (doc.privacy_class !== "public") {
      throw new Error(
        `NON_PUBLIC_DOCUMENT_BLOCKED_403: Document ${doc.review_item_id} has privacy_class='${doc.privacy_class}' (only 'public' allowed).`
      );
    }
    const pdfBytes = options.pdfResolver
      ? options.pdfResolver(doc)
      : fs.readFileSync(
          path.resolve(
            process.cwd(),
            "public",
            doc.accessible_original_pdf.preview_pdf_path.replace(/^\/+/, "")
          )
        );
    const actualSha = crypto.createHash("sha256").update(pdfBytes).digest("hex");
    if (actualSha !== doc.sha256) {
      throw new Error(
        `SOURCE_SHA256_MISMATCH: ${doc.review_item_id} expected ${doc.sha256}, got ${actualSha}.`
      );
    }
    verifiedPagesTotal += doc.physical_page_count;
  }

  const guard = new DurablePreCallOcrBudgetGuard({
    ledgerPath,
    pilotId: "pilot.b02.typhoon_170pages.owner_10usd",
    allowPaidDispatch: options.mode === "LIVE_BUDGETED_EXECUTION",
    ownerApprovedMaxUsdInclTax: maxUsd,
    maxAttemptsPerPage: maxAttempts,
  });

  // Include the earlier 1-page Gemini live verification spend ($0.024268 incl. retry) in the same $10.00 budget!
  const includePriorSmoke = options.includePriorSmokeSpend ?? (options.documentsOverride === undefined);
  let priorSmokeIncludedUsd = 0;
  if (includePriorSmoke) {
    const prior = loadPriorSmokeVerificationReservations();
    guard.seedPriorCommittedReservations(prior.records);
    priorSmokeIncludedUsd = prior.totalUsdInclTax;
  }

  // Reconcile any orphaned RESERVED_IN_FLIGHT slots from crashed prior processes at full worst-case charge!
  const orphanedReconciled = guard.reconcileOrphanedInFlightReservations();

  if (options.mode === "PREFLIGHT_DRY_RUN") {
    const state = guard.readState();
    const summary: PilotRunSummary = {
      mode: "PREFLIGHT_DRY_RUN",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_approved_max_usd_incl_tax: maxUsd,
      prior_smoke_spend_included_usd_incl_tax: priorSmokeIncludedUsd,
      orphaned_inflight_reservations_reconciled: orphanedReconciled,
      total_committed_or_in_flight_usd_incl_tax: state.total_committed_or_in_flight_usd_incl_tax,
      remaining_budget_usd_incl_tax: Number(
        (maxUsd - state.total_committed_or_in_flight_usd_incl_tax).toFixed(6)
      ),
      documents_verified_count: docs.length,
      pages_verified_count: verifiedPagesTotal,
      pages_resumed_from_quarantine_count: 0,
      pages_processed_count: 0,
      primary_calls_dispatched: 0,
      primary_retries_dispatched: 0,
      secondary_calls_dispatched: 0,
      secondary_retries_dispatched: 0,
      page_1_gate_checked: false,
      page_1_gate_passed: false,
      stopped_by_page_1_gate: false,
      page_1_gate_failure_reason: null,
      stopped_by_budget_guard: false,
      budget_stop_reason: null,
      quarantine_output_dir: quarantineDir,
      all_outputs_quarantined: true,
      usable_as_legal_evidence: false,
      releases_quarantined_citations: false,
    };
    return { summary, pages: [] };
  }

  if (!options.httpTransport) {
    throw new Error("MISSING_HTTP_TRANSPORT: Live execution requires a configured PilotHttpTransport.");
  }
  const transport = options.httpTransport;
  const enforcePage1Gate = options.enforcePage1GateBeforeContinuing ?? (options.documentsOverride === undefined);

  let primaryCallsDispatched = 0;
  let primaryRetriesDispatched = 0;
  let secondaryCallsDispatched = 0;
  let secondaryRetriesDispatched = 0;
  let pagesResumedFromQuarantineCount = 0;
  let page1GateChecked = false;
  let page1GatePassed = false;
  let stoppedByPage1Gate = false;
  let page1GateFailureReason: string | null = null;
  let stoppedByBudgetGuard = false;
  let budgetStopReason: string | null = null;
  const pageResults: QuarantinedPilotPageResult[] = [];

  const executeBudgetedCallWithRetries = async (params: {
    doc: PilotReviewDocumentSpec;
    pageNumber: number;
    pngBase64: string;
    providerId: CallablePilotProviderId;
    isSecondary: boolean;
    reservationIdsOut: string[];
  }): Promise<{
    text: string | null;
    attemptsUsed: number;
    rawModelId: string | null;
    rawUsage: Record<string, unknown> | null;
  }> => {
    // Crash-safe restart accounting: count any dispatches already recorded in prior runs!
    const priorAttempts = guard.getPriorDispatchedAttemptCount({
      document_sha256: params.doc.sha256,
      page_number: params.pageNumber,
      provider_id: params.providerId,
    });
    if (priorAttempts >= maxAttempts) {
      return { text: null, attemptsUsed: priorAttempts, rawModelId: null, rawUsage: null };
    }

    let attemptsUsed = priorAttempts;
    for (let attempt = priorAttempts + 1; attempt <= maxAttempts; attempt++) {
      // Brand-new pre-call budget reservation required BEFORE every attempt, retry, or post-restart re-attempt!
      const reservation = guard.reserveBeforeProviderCall({
        document_sha256: params.doc.sha256,
        page_number: params.pageNumber,
        attempt_index: attempt,
        privacy_class: params.doc.privacy_class,
        provider_id: params.providerId,
      });
      params.reservationIdsOut.push(reservation.reservation_id);

      attemptsUsed = attempt;
      if (params.isSecondary) {
        secondaryCallsDispatched += 1;
        if (attempt > 1) secondaryRetriesDispatched += 1;
      } else {
        primaryCallsDispatched += 1;
        if (attempt > 1) primaryRetriesDispatched += 1;
      }

      try {
        const resp = await transport({
          provider_id: params.providerId,
          document_sha256: params.doc.sha256,
          review_item_id: params.doc.review_item_id,
          page_number: params.pageNumber,
          attempt_index: attempt,
          png_base64: params.pngBase64,
        });
        guard.settleCompletedCall(reservation.reservation_id, {
          input_tokens: resp.input_tokens,
          output_and_thinking_tokens: resp.output_and_thinking_tokens,
        });
        return {
          text: resp.text,
          attemptsUsed,
          rawModelId: resp.raw_model_id,
          rawUsage: resp.raw_usage_metadata || null,
        };
      } catch (err: unknown) {
        guard.markPostSendAmbiguousFailure(reservation.reservation_id);
        if (attempt === maxAttempts) {
          return {
            text: null,
            attemptsUsed,
            rawModelId: null,
            rawUsage: {
              final_attempt_error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }
    }
    return { text: null, attemptsUsed, rawModelId: null, rawUsage: null };
  };

  let pagesHandledTotal = 0;

  outerLoop: for (const doc of docs) {
    const pdfAbsPath = path.resolve(
      process.cwd(),
      "public",
      doc.accessible_original_pdf.preview_pdf_path.replace(/^\/+/, "")
    );

    for (let pageNo = 1; pageNo <= doc.physical_page_count; pageNo++) {
      if (options.maxPagesLimit !== undefined && pagesHandledTotal >= options.maxPagesLimit) {
        break outerLoop;
      }

      const quarantinePagePath = path.join(
        quarantineDir,
        `${doc.review_item_id}_p${String(pageNo).padStart(3, "0")}.quarantined.json`
      );

      // Resume guard: never re-dispatch paid calls for a page already saved in quarantine with matching SHA-256!
      if (fs.existsSync(quarantinePagePath)) {
        try {
          const existingPage = JSON.parse(
            fs.readFileSync(quarantinePagePath, "utf8")
          ) as QuarantinedPilotPageResult;
          if (
            existingPage.document_sha256 === doc.sha256 &&
            (existingPage.primary_text !== null || existingPage.secondary_text !== null)
          ) {
            pageResults.push(existingPage);
            pagesResumedFromQuarantineCount += 1;
            pagesHandledTotal += 1;
            continue;
          }
        } catch {
          // corrupt partial file -> proceed with fresh budgeted reservation
        }
      }

      let pngInfo: RenderedPngPageInfo;
      if (options.pageRenderer) {
        const rendered = options.pageRenderer(doc, pageNo);
        if (typeof rendered === "string") {
          const rawBuf = Buffer.from(rendered, "base64");
          pngInfo = {
            png_base64: rendered,
            png_byte_length: rawBuf.length,
            png_sha256: crypto.createHash("sha256").update(rawBuf).digest("hex"),
            width_px: 1240,
            height_px: 1754,
          };
        } else {
          pngInfo = rendered;
        }
      } else {
        pngInfo = renderPdfPageToPngInfo(pdfAbsPath, pageNo);
      }

      const reservationIds: string[] = [];
      let primaryRes: {
        text: string | null;
        attemptsUsed: number;
        rawModelId: string | null;
        rawUsage: Record<string, unknown> | null;
      };
      try {
        primaryRes = await executeBudgetedCallWithRetries({
          doc,
          pageNumber: pageNo,
          pngBase64: pngInfo.png_base64,
          providerId: primaryProviderId,
          isSecondary: false,
          reservationIdsOut: reservationIds,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/PRECALL_BUDGET_CAP_EXCEEDED_429/.test(msg)) {
          stoppedByBudgetGuard = true;
          budgetStopReason = msg;
          break outerLoop;
        }
        throw err;
      }

      const secDecision = enableSecondary
        ? shouldTriggerSecondaryModelCrossCheck(primaryRes.text)
        : { trigger: false, reason: null };

      let secondaryText: string | null = null;
      let secondaryAttemptsUsed = 0;
      let secondaryRawModelId: string | null = null;
      let secondaryRawUsage: Record<string, unknown> | null = null;
      if (secDecision.trigger) {
        try {
          const secRes = await executeBudgetedCallWithRetries({
            doc,
            pageNumber: pageNo,
            pngBase64: pngInfo.png_base64,
            providerId: secondaryProviderId,
            isSecondary: true,
            reservationIdsOut: reservationIds,
          });
          secondaryText = secRes.text;
          secondaryAttemptsUsed = secRes.attemptsUsed;
          secondaryRawModelId = secRes.rawModelId;
          secondaryRawUsage = secRes.rawUsage;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/PRECALL_BUDGET_CAP_EXCEEDED_429/.test(msg)) {
            stoppedByBudgetGuard = true;
            budgetStopReason = msg;
            break outerLoop;
          }
          throw err;
        }
      }

      const disagreementFlags: string[] = [];
      if (primaryRes.text !== null && secondaryText !== null) {
        const issues = compareDualOcrPassages({
          documentId: doc.review_item_id,
          pageNumber: pageNo,
          imageSha256: pngInfo.png_sha256,
          primaryText: primaryRes.text,
          secondaryText,
        });
        for (const iss of issues) {
          disagreementFlags.push(`${iss.code}: ${iss.message}`);
        }
      }

      const pageRecord: QuarantinedPilotPageResult = {
        review_item_id: doc.review_item_id,
        document_sha256: doc.sha256,
        page_number: pageNo,
        privacy_class: "public",
        rendered_png_sha256: pngInfo.png_sha256,
        rendered_png_dimensions: {
          width_px: pngInfo.width_px,
          height_px: pngInfo.height_px,
          byte_length: pngInfo.png_byte_length,
        },
        primary_provider_id: primaryProviderId,
        primary_raw_model_id: primaryRes.rawModelId,
        primary_attempts_used: primaryRes.attemptsUsed,
        primary_text: primaryRes.text,
        primary_raw_usage_metadata: primaryRes.rawUsage,
        secondary_triggered: secDecision.trigger,
        secondary_trigger_reason: secDecision.reason,
        secondary_provider_id: secDecision.trigger ? secondaryProviderId : null,
        secondary_raw_model_id: secondaryRawModelId,
        secondary_attempts_used: secondaryAttemptsUsed,
        secondary_text: secondaryText,
        secondary_raw_usage_metadata: secondaryRawUsage,
        dual_ocr_disagreement_flags: disagreementFlags,
        reservation_ids: reservationIds,
        usable_as_legal_evidence: false,
        quarantine_status: "QUARANTINED_PENDING_OWNER_LEGAL_TEAM_REVIEW",
        applicability_status: "not_assessed",
        releases_quarantined_citations: false,
      };
      pageResults.push(pageRecord);
      pagesHandledTotal += 1;

      const tmpPage = `${quarantinePagePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPage, JSON.stringify(pageRecord, null, 2), "utf8");
      fs.renameSync(tmpPage, quarantinePagePath);

      // Owner Gate: Verify Page 1 on primary Typhoon BEFORE continuing to pages 2..170!
      if (enforcePage1Gate && !page1GateChecked) {
        page1GateChecked = true;
        const primaryTrimmed = (pageRecord.primary_text || "").trim();
        const hasThaiScript = /[\u0E00-\u0E7F]/.test(primaryTrimmed);
        if (
          !pageRecord.primary_raw_model_id ||
          primaryTrimmed.length < 40 ||
          !hasThaiScript
        ) {
          page1GatePassed = false;
          stoppedByPage1Gate = true;
          page1GateFailureReason = `PAGE_1_TYPHOON_GATE_FAILED: model='${pageRecord.primary_raw_model_id ?? "null"}', chars=${primaryTrimmed.length}, hasThai=${hasThaiScript}. Halted before dispatching pages 2..170.`;
          break outerLoop;
        }
        page1GatePassed = true;
        fs.writeFileSync(
          path.join(quarantineDir, "page_1_typhoon_gate_verified.quarantined.json"),
          JSON.stringify(
            {
              verified_at: new Date().toISOString(),
              review_item_id: pageRecord.review_item_id,
              page_number: pageRecord.page_number,
              primary_raw_model_id: pageRecord.primary_raw_model_id,
              primary_chars: primaryTrimmed.length,
              primary_raw_usage_metadata: pageRecord.primary_raw_usage_metadata,
              usable_as_legal_evidence: false,
            },
            null,
            2
          ),
          "utf8"
        );
      }
    }
  }

  const finalState = guard.readState();
  const summary: PilotRunSummary = {
    mode: "LIVE_BUDGETED_EXECUTION",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    owner_approved_max_usd_incl_tax: maxUsd,
    prior_smoke_spend_included_usd_incl_tax: priorSmokeIncludedUsd,
    orphaned_inflight_reservations_reconciled: orphanedReconciled,
    total_committed_or_in_flight_usd_incl_tax: finalState.total_committed_or_in_flight_usd_incl_tax,
    remaining_budget_usd_incl_tax: Number(
      Math.max(0, maxUsd - finalState.total_committed_or_in_flight_usd_incl_tax).toFixed(6)
    ),
    documents_verified_count: docs.length,
    pages_verified_count: verifiedPagesTotal,
    pages_resumed_from_quarantine_count: pagesResumedFromQuarantineCount,
    pages_processed_count: pageResults.length,
    primary_calls_dispatched: primaryCallsDispatched,
    primary_retries_dispatched: primaryRetriesDispatched,
    secondary_calls_dispatched: secondaryCallsDispatched,
    secondary_retries_dispatched: secondaryRetriesDispatched,
    page_1_gate_checked: page1GateChecked,
    page_1_gate_passed: page1GatePassed,
    stopped_by_page_1_gate: stoppedByPage1Gate,
    page_1_gate_failure_reason: page1GateFailureReason,
    stopped_by_budget_guard: stoppedByBudgetGuard,
    budget_stop_reason: budgetStopReason,
    quarantine_output_dir: quarantineDir,
    all_outputs_quarantined: true,
    usable_as_legal_evidence: false,
    releases_quarantined_citations: false,
  };

  fs.writeFileSync(
    path.join(quarantineDir, "pilot-run-summary.quarantined.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  return { summary, pages: pageResults };
}

async function cliMain() {
  const executeLive = process.argv.includes("--execute-live");
  const smokeSinglePage = process.argv.includes("--smoke-single-page");
  const smokeGeminiSinglePage = process.argv.includes("--smoke-gemini-single-page");

  const openTyphoonKey = (
    process.env.OPENTYPHOON_API_KEY ||
    process.env.TYPHOON_OCR_API_KEY ||
    ""
  ).trim();
  const geminiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();

  if (smokeGeminiSinglePage) {
    if (!geminiKey) {
      throw new Error("MISSING_GEMINI_API_KEY: Needed for 1-page real PDF model & usage verification.");
    }
    const transport = createLivePilotHttpTransport({
      geminiApiKey: geminiKey,
    });
    const smokeDir = path.resolve(
      process.cwd(),
      "data",
      "ocr-pilot-quarantine",
      "smoke-single-page-verification"
    );
    const liveOne = await runB02PublicOcrPilot({
      mode: "LIVE_BUDGETED_EXECUTION",
      ownerApprovedMaxUsdInclTax: 10.0,
      primaryProviderId: "gemini-3.8-flash-ocr",
      enableSecondaryModel: false,
      maxPagesLimit: 1,
      quarantineOutputDir: smokeDir,
      httpTransport: transport,
    });
    console.log(JSON.stringify({ summary: liveOne.summary, page_1: liveOne.pages[0] }, null, 2));
    return;
  }

  if (!executeLive && !smokeSinglePage) {
    const dry = await runB02PublicOcrPilot({
      mode: "PREFLIGHT_DRY_RUN",
      ownerApprovedMaxUsdInclTax: 10.0,
    });
    console.log(
      JSON.stringify(
        {
          preflight_ready: true,
          opentyphoon_key_present_in_env: openTyphoonKey.length > 0,
          gemini_secondary_key_present_in_env: geminiKey.length > 0,
          per_call_worst_case_reservations_usd_incl_tax: {
            primary_typhoon_commercial_worst_case: computeWorstCaseCallCostUsdInclTax(
              "typhoon-ocr2-2b-partner-page"
            ),
            secondary_gemini_3_8_flash_worst_case: computeWorstCaseCallCostUsdInclTax(
              "gemini-3.8-flash-ocr"
            ),
          },
          summary: dry.summary,
        },
        null,
        2
      )
    );
    return;
  }

  if (!openTyphoonKey) {
    console.error(
      "MISSING_OPENTYPHOON_API_KEY: Add OPENTYPHOON_API_KEY to .env.local (never paste into chat) before running with --smoke-single-page or --execute-live."
    );
    process.exit(1);
  }

  const transport = createLivePilotHttpTransport({
    openTyphoonApiKey: openTyphoonKey,
    geminiApiKey: geminiKey || undefined,
  });

  const live = await runB02PublicOcrPilot({
    mode: "LIVE_BUDGETED_EXECUTION",
    ownerApprovedMaxUsdInclTax: 10.0,
    maxPagesLimit: smokeSinglePage ? 1 : undefined,
    httpTransport: transport,
    enableSecondaryModel: geminiKey.length > 0,
  });

  console.log(
    JSON.stringify(
      smokeSinglePage ? { summary: live.summary, page_1: live.pages[0] } : live.summary,
      null,
      2
    )
  );
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("run-b02-170page-typhoon-ocr-pilot.ts")
) {
  cliMain().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
