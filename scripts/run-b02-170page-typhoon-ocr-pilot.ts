/**
 * REG24 — Actual 170-Page B02 Public-Document OCR Pilot Runner (`typhoon-ocr` Primary + `gemini-3.8-flash` Secondary)
 *
 * Enforces Owner Approvals & Pre-Start Safety Gates (2026-11-17):
 * 1. One-time budget ceiling hard-locked to `<= US$10.00` (inclusive of 7% Thai VAT + 3% FX buffer).
 * 2. Every single network call — primary `typhoon-ocr` attempt 1, primary retry attempt 2,
 *    secondary `gemini-3.8-flash` attempt 1, and secondary retry attempt 2 — MUST acquire a durable
 *    on-disk worst-case reservation (`DurablePreCallOcrBudgetGuard.reserveBeforeProviderCall`) BEFORE
 *    any HTTP bytes leave the process.
 * 3. Strictly `privacy_class === "public"` documents only (the 33 unique RD statutes/decrees/regulations = 170 pages),
 *    verified by exact SHA-256 against `b02_170page_ocr_pilot_review_list.json` before page rendering.
 * 4. All extracted OCR text, dual-OCR comparisons, and matched citations are written ONLY to the isolated,
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
}

export type PilotHttpTransport = (call: ProviderHttpCallInput) => Promise<ProviderHttpCallResult>;

export interface QuarantinedPilotPageResult {
  review_item_id: string;
  document_sha256: string;
  page_number: number;
  privacy_class: "public";
  primary_provider_id: CallablePilotProviderId;
  primary_attempts_used: number;
  primary_text: string | null;
  secondary_triggered: boolean;
  secondary_trigger_reason: string | null;
  secondary_provider_id: CallablePilotProviderId | null;
  secondary_attempts_used: number;
  secondary_text: string | null;
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
  total_committed_or_in_flight_usd_incl_tax: number;
  remaining_budget_usd_incl_tax: number;
  documents_verified_count: number;
  pages_verified_count: number;
  pages_processed_count: number;
  primary_calls_dispatched: number;
  primary_retries_dispatched: number;
  secondary_calls_dispatched: number;
  secondary_retries_dispatched: number;
  stopped_by_budget_guard: boolean;
  budget_stop_reason: string | null;
  quarantine_output_dir: string;
  all_outputs_quarantined: true;
  usable_as_legal_evidence: false;
  releases_quarantined_citations: false;
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

export function renderPdfPageToPngBase64(pdfAbsPath: string, oneBasedPage: number): string {
  const pyCode = [
    "import sys, base64, pymupdf",
    "doc = pymupdf.open(sys.argv[1])",
    "pno = int(sys.argv[2]) - 1",
    "if pno < 0 or pno >= len(doc): raise RuntimeError(f'Page {pno+1} out of range {len(doc)}')",
    "pix = doc[pno].get_pixmap(dpi=180, alpha=False)",
    "sys.stdout.write(base64.b64encode(pix.tobytes('png')).decode('ascii'))",
  ].join("; ");
  return execFileSync("python", ["-c", pyCode, pdfAbsPath, String(oneBasedPage)], {
    encoding: "utf8",
    maxBuffer: 25 * 1024 * 1024,
  }).trim();
}

export function createLivePilotHttpTransport(params: {
  openTyphoonApiKey: string;
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
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        http_status: resp.status,
        text,
        input_tokens: json.usage?.prompt_tokens ?? 4500,
        output_and_thinking_tokens: json.usage?.completion_tokens ?? 1200,
        raw_model_id: json.model || typhoonModel,
      };
    }

    if (call.provider_id === "gemini-3.8-flash-ocr") {
      if (!params.geminiApiKey) {
        throw new Error("MISSING_GEMINI_API_KEY_FOR_SECONDARY_CROSSCHECK");
      }
      const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": params.geminiApiKey,
          "Content-Type": "application/json",
          "Api-Revision": "2026-05-20",
        },
        body: JSON.stringify({
          model: "gemini-3.8-flash",
          store: false,
          generation_config: {
            max_output_tokens: 4096,
            temperature: 0.0,
          },
          input: [
            {
              type: "text",
              text: "Transcribe the exact verbatim Thai legal text on this page without paraphrasing. Preserve all numerals, tax rates, negations (ไม่, มิใช่, เว้นแต่), and table cells.",
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
        throw new Error(`GEMINI_HTTP_${resp.status}`);
      }
      const json = (await resp.json()) as {
        output_text?: string;
        outputs?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      };
      const text =
        json.output_text ??
        (Array.isArray(json.outputs) ? json.outputs.map((o) => o.text || "").join("\n") : "");
      const inTok = json.usage?.input_tokens ?? 4000;
      const outTok =
        json.usage?.output_tokens ??
        Math.max(500, (json.usage?.total_tokens ?? 5000) - inTok);
      return {
        http_status: resp.status,
        text,
        input_tokens: inTok,
        output_and_thinking_tokens: outTok,
        raw_model_id: "gemini-3.8-flash",
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
  pdfResolver?: (doc: PilotReviewDocumentSpec) => Buffer;
  pageRenderer?: (doc: PilotReviewDocumentSpec, pageNumber: number) => string;
  httpTransport?: PilotHttpTransport;
  enableSecondaryModel?: boolean;
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
  // Default to conservative commercial per-page reservation ($0.03 ex-tax = $0.033063 incl. 7% VAT + 3% FX)
  // so even if OpenTyphoon bills commercially, primary + retries + secondary Gemini calls CANNOT exceed $10.00!
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

  // Load 33 canonical public documents (170 pages)
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

  // Step 1: Pre-flight public-only & SHA-256 verification BEFORE any network call or spend
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
          path.resolve(process.cwd(), "public", doc.accessible_original_pdf.preview_pdf_path.replace(/^\/+/, ""))
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

  if (options.mode === "PREFLIGHT_DRY_RUN") {
    const state = guard.readState();
    const summary: PilotRunSummary = {
      mode: "PREFLIGHT_DRY_RUN",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      owner_approved_max_usd_incl_tax: maxUsd,
      total_committed_or_in_flight_usd_incl_tax: state.total_committed_or_in_flight_usd_incl_tax,
      remaining_budget_usd_incl_tax: Number(
        (maxUsd - state.total_committed_or_in_flight_usd_incl_tax).toFixed(6)
      ),
      documents_verified_count: docs.length,
      pages_verified_count: verifiedPagesTotal,
      pages_processed_count: 0,
      primary_calls_dispatched: 0,
      primary_retries_dispatched: 0,
      secondary_calls_dispatched: 0,
      secondary_retries_dispatched: 0,
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

  let primaryCallsDispatched = 0;
  let primaryRetriesDispatched = 0;
  let secondaryCallsDispatched = 0;
  let secondaryRetriesDispatched = 0;
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
  }): Promise<{ text: string | null; attemptsUsed: number }> => {
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // CRITICAL PRE-CALL BUDGET GATE: Reserves worst-case cost on disk BEFORE any HTTP request or retry!
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
        return { text: resp.text, attemptsUsed };
      } catch (err: unknown) {
        // Retain worst-case charge conservatively on post-send failure so retries can NEVER overshoot the cap!
        guard.markPostSendAmbiguousFailure(reservation.reservation_id);
        if (attempt === maxAttempts) {
          return { text: null, attemptsUsed };
        }
      }
    }
    return { text: null, attemptsUsed };
  };

  outerLoop: for (const doc of docs) {
    const pdfAbsPath = path.resolve(
      process.cwd(),
      "public",
      doc.accessible_original_pdf.preview_pdf_path.replace(/^\/+/, "")
    );

    for (let pageNo = 1; pageNo <= doc.physical_page_count; pageNo++) {
      const pngBase64 = options.pageRenderer
        ? options.pageRenderer(doc, pageNo)
        : renderPdfPageToPngBase64(pdfAbsPath, pageNo);

      const reservationIds: string[] = [];
      let primaryRes: { text: string | null; attemptsUsed: number };
      try {
        primaryRes = await executeBudgetedCallWithRetries({
          doc,
          pageNumber: pageNo,
          pngBase64,
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
      if (secDecision.trigger) {
        try {
          const secRes = await executeBudgetedCallWithRetries({
            doc,
            pageNumber: pageNo,
            pngBase64,
            providerId: secondaryProviderId,
            isSecondary: true,
            reservationIdsOut: reservationIds,
          });
          secondaryText = secRes.text;
          secondaryAttemptsUsed = secRes.attemptsUsed;
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
          imageSha256: crypto.createHash("sha256").update(pngBase64).digest("hex"),
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
        primary_provider_id: primaryProviderId,
        primary_attempts_used: primaryRes.attemptsUsed,
        primary_text: primaryRes.text,
        secondary_triggered: secDecision.trigger,
        secondary_trigger_reason: secDecision.reason,
        secondary_provider_id: secDecision.trigger ? secondaryProviderId : null,
        secondary_attempts_used: secondaryAttemptsUsed,
        secondary_text: secondaryText,
        dual_ocr_disagreement_flags: disagreementFlags,
        reservation_ids: reservationIds,
        usable_as_legal_evidence: false,
        quarantine_status: "QUARANTINED_PENDING_OWNER_LEGAL_TEAM_REVIEW",
        applicability_status: "not_assessed",
        releases_quarantined_citations: false,
      };
      pageResults.push(pageRecord);

      fs.writeFileSync(
        path.join(
          quarantineDir,
          `${doc.review_item_id}_p${String(pageNo).padStart(3, "0")}.quarantined.json`
        ),
        JSON.stringify(pageRecord, null, 2),
        "utf8"
      );
    }
  }

  const finalState = guard.readState();
  const summary: PilotRunSummary = {
    mode: "LIVE_BUDGETED_EXECUTION",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    owner_approved_max_usd_incl_tax: maxUsd,
    total_committed_or_in_flight_usd_incl_tax: finalState.total_committed_or_in_flight_usd_incl_tax,
    remaining_budget_usd_incl_tax: Number(
      Math.max(0, maxUsd - finalState.total_committed_or_in_flight_usd_incl_tax).toFixed(6)
    ),
    documents_verified_count: docs.length,
    pages_verified_count: verifiedPagesTotal,
    pages_processed_count: pageResults.length,
    primary_calls_dispatched: primaryCallsDispatched,
    primary_retries_dispatched: primaryRetriesDispatched,
    secondary_calls_dispatched: secondaryCallsDispatched,
    secondary_retries_dispatched: secondaryRetriesDispatched,
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

  if (!executeLive) {
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
      "MISSING_OPENTYPHOON_API_KEY: Add OPENTYPHOON_API_KEY to .env.local (never paste into chat) before running with --execute-live."
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
    httpTransport: transport,
    enableSecondaryModel: geminiKey.length > 0,
  });

  console.log(JSON.stringify(live.summary, null, 2));
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
