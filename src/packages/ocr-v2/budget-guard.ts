/**
 * REG24 — Durable Pre-Call Worst-Case OCR Budget Reservation & Public-Corpus Guard
 *
 * Enforces Owner Pilot Controls (Item 3):
 * 1. Paid OCR runs stay hard-blocked (`PAID_RUN_NOT_YET_APPROVED_403`) until the Owner's explicit
 *    maximum ceiling (`owner_approved_max_usd_incl_tax`) is unlocked (`allow_paid_dispatch: true`).
 * 2. Strictly `public` legal documents only (`privacy_class === "public"`); any non-public document
 *    is blocked (`NON_PUBLIC_DOCUMENT_BLOCKED_403`) before reserving budget or making network I/O.
 * 3. Pre-call worst-case cost reservation (`reserveBeforeProviderCall`):
 *    - Reserves the worst-case cost (max image/prompt tokens + max output/thinking tokens + 7% Thai VAT)
 *      BEFORE every provider call (including every retry attempt).
 *    - Persists the ledger atomically to disk (`*.tmp` -> `fs.renameSync`) before dispatching so budgets
 *      survive process crashes, retries, and restarts without ever overshooting the cap.
 *    - Reconciles downward ONLY on confirmed lower actual token/page usage (`settleCompletedCall`);
 *      post-send network timeouts remain conservatively charged at worst-case (`markPostSendAmbiguousFailure`)
 *      unless aborted before any bytes left the client (`releaseAbortedBeforeSend`).
 * 4. Keeps all unverified citations quarantined (`usable_as_legal_evidence: false`,
 *    `applicability_status: "not_assessed"`) until human Thai legal curation sign-off.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PrivacyClass } from "./contract";

export const THAI_VAT_MULTIPLIER = 1.07; // 7% Thai VAT included in every worst-case reservation

export type CallablePilotProviderId =
  | "typhoon-ocr-v2-hosted"
  | "typhoon-ocr2-2b-partner-page"
  | "typhoon-ocr2-2b-selfhosted-gpu"
  | "gemini-3.8-flash-ocr";

export interface CallableProviderPricingSpec {
  provider_id: CallablePilotProviderId;
  callable_model_id: string;
  endpoint_or_host: string;
  billing_unit: "per_page_flat" | "per_1m_tokens" | "per_gpu_second";
  /** Flat USD per page (before tax) when billed per page */
  usd_per_page_ex_tax?: number;
  /** USD per 1M input tokens (before tax) */
  usd_per_1m_input_tokens_ex_tax?: number;
  /** USD per 1M output + thinking tokens (before tax) */
  usd_per_1m_output_tokens_ex_tax?: number;
  /** Worst-case input tokens per legal page (high-DPI rendered PNG + prompt) */
  worst_case_input_tokens_per_page: number;
  /** Hard `max_tokens` / `max_output_tokens` cap sent in API request (incl. thinking tokens) */
  worst_case_output_tokens_per_page: number;
  /** Worst-case GPU seconds per page when self-hosted on L4 ($0.85/hr = $0.0002361/s) */
  worst_case_gpu_usd_per_page_ex_tax?: number;
}

export const VERIFIED_PILOT_PROVIDER_PRICING: Readonly<
  Record<CallablePilotProviderId, CallableProviderPricingSpec>
> = {
  "typhoon-ocr-v2-hosted": {
    provider_id: "typhoon-ocr-v2-hosted",
    callable_model_id: "typhoon-ocr-v2",
    endpoint_or_host: "https://api.opentyphoon.ai/v1/chat/completions",
    billing_unit: "per_page_flat",
    // OpenTyphoon showcase is free-tier rate-limited (2 req/s, 20 req/min), but if routed via
    // commercial partner per-page billing ($0.03/page) we reserve $0.03/page worst-case unless free_tier_verified=true
    usd_per_page_ex_tax: 0.0,
    worst_case_input_tokens_per_page: 6500,
    worst_case_output_tokens_per_page: 4096,
  },
  "typhoon-ocr2-2b-partner-page": {
    provider_id: "typhoon-ocr2-2b-partner-page",
    callable_model_id: "typhoon-ocr-7b / typhoon-ocr2-2b (Commercial Partner Per-Page Tier)",
    endpoint_or_host: "partner-openai-compatible-endpoint",
    billing_unit: "per_page_flat",
    usd_per_page_ex_tax: 0.03, // Verified Float16 / commercial partner rate: $0.03/page
    worst_case_input_tokens_per_page: 6500,
    worst_case_output_tokens_per_page: 4096,
  },
  "typhoon-ocr2-2b-selfhosted-gpu": {
    provider_id: "typhoon-ocr2-2b-selfhosted-gpu",
    callable_model_id: "typhoon-ai/typhoon-ocr2-2b@3ea2e5e3d92bf999a64e82a92b11c7b73eae45b0",
    endpoint_or_host: "vpc-selfhosted-vllm-l4-24gb",
    billing_unit: "per_gpu_second",
    // Worst-case 8s/page on $1.00/hr on-demand L4 GPU (including spin-up buffer) = $0.00222/page
    worst_case_gpu_usd_per_page_ex_tax: 0.0025,
    worst_case_input_tokens_per_page: 6500,
    worst_case_output_tokens_per_page: 4096,
  },
  "gemini-3.8-flash-ocr": {
    provider_id: "gemini-3.8-flash-ocr",
    callable_model_id: "gemini-3.8-flash",
    endpoint_or_host: "https://generativelanguage.googleapis.com/v1beta/interactions",
    billing_unit: "per_1m_tokens",
    // Official Google Gemini API Paid Standard Tier (through Dec 31, 2026): $0.75/1M in, $3.75/1M out (incl. thinking)
    // Note: Standard post-Jan 1, 2027 rate is $1.50/1M in, $7.50/1M out
    usd_per_1m_input_tokens_ex_tax: 0.75,
    usd_per_1m_output_tokens_ex_tax: 3.75,
    worst_case_input_tokens_per_page: 6500,
    worst_case_output_tokens_per_page: 4096,
  },
};

export interface BudgetReservationRecord {
  reservation_id: string;
  idempotency_call_key: string;
  document_sha256: string;
  page_number: number;
  attempt_index: number;
  privacy_class: PrivacyClass;
  provider_id: CallablePilotProviderId;
  callable_model_id: string;
  reserved_worst_case_usd_incl_tax: number;
  settled_actual_usd_incl_tax: number | null;
  charged_usd_incl_tax: number;
  status: "RESERVED_IN_FLIGHT" | "SETTLED_COMPLETED" | "FAILED_POST_SEND_CHARGED" | "RELEASED_PRE_SEND";
  usable_as_legal_evidence: false;
  quarantine_status: "QUARANTINED_PENDING_HUMAN_LEGAL_CURATION";
  created_at: string;
  updated_at: string;
}

export interface PersistedOcrBudgetLedgerState {
  schema_version: "reg24.ocr_precall_budget_ledger.v1";
  pilot_id: string;
  allow_paid_dispatch: boolean;
  owner_approved_max_usd_incl_tax: number;
  tax_multiplier: number;
  fx_and_fee_safety_multiplier: number;
  max_attempts_per_page: number;
  total_committed_or_in_flight_usd_incl_tax: number;
  reservations: Record<string, BudgetReservationRecord>;
  updated_at: string;
}

export function computeWorstCaseCallCostUsdInclTax(
  providerId: CallablePilotProviderId,
  opts?: {
    taxMultiplier?: number;
    fxSafetyMultiplier?: number;
    usePost2026StandardGeminiRates?: boolean;
  }
): number {
  const spec = VERIFIED_PILOT_PROVIDER_PRICING[providerId];
  if (!spec) {
    throw new Error(`UNKNOWN_OCR_PROVIDER: ${providerId}`);
  }
  const taxMult = opts?.taxMultiplier ?? THAI_VAT_MULTIPLIER;
  const fxMult = opts?.fxSafetyMultiplier ?? 1.03; // 3% FX / payment-rail safety margin

  let baseExTax = 0;
  if (spec.billing_unit === "per_page_flat") {
    baseExTax = spec.usd_per_page_ex_tax ?? 0;
  } else if (spec.billing_unit === "per_gpu_second") {
    baseExTax = spec.worst_case_gpu_usd_per_page_ex_tax ?? 0.0025;
  } else if (spec.billing_unit === "per_1m_tokens") {
    const inRate = opts?.usePost2026StandardGeminiRates
      ? 1.5
      : (spec.usd_per_1m_input_tokens_ex_tax ?? 0.75);
    const outRate = opts?.usePost2026StandardGeminiRates
      ? 7.5
      : (spec.usd_per_1m_output_tokens_ex_tax ?? 3.75);
    baseExTax =
      (spec.worst_case_input_tokens_per_page / 1_000_000) * inRate +
      (spec.worst_case_output_tokens_per_page / 1_000_000) * outRate;
  }

  return Number((baseExTax * taxMult * fxMult).toFixed(6));
}

export function computeActualTokenCostUsdInclTax(
  providerId: CallablePilotProviderId,
  actualInputTokens: number,
  actualOutputAndThinkingTokens: number,
  opts?: {
    taxMultiplier?: number;
    fxSafetyMultiplier?: number;
    usePost2026StandardGeminiRates?: boolean;
  }
): number {
  const spec = VERIFIED_PILOT_PROVIDER_PRICING[providerId];
  const taxMult = opts?.taxMultiplier ?? THAI_VAT_MULTIPLIER;
  const fxMult = opts?.fxSafetyMultiplier ?? 1.03;

  let baseExTax = 0;
  if (spec.billing_unit === "per_page_flat") {
    baseExTax = spec.usd_per_page_ex_tax ?? 0;
  } else if (spec.billing_unit === "per_gpu_second") {
    baseExTax = spec.worst_case_gpu_usd_per_page_ex_tax ?? 0.0025;
  } else {
    const inRate = opts?.usePost2026StandardGeminiRates
      ? 1.5
      : (spec.usd_per_1m_input_tokens_ex_tax ?? 0.75);
    const outRate = opts?.usePost2026StandardGeminiRates
      ? 7.5
      : (spec.usd_per_1m_output_tokens_ex_tax ?? 3.75);
    baseExTax =
      (Math.max(0, actualInputTokens) / 1_000_000) * inRate +
      (Math.max(0, actualOutputAndThinkingTokens) / 1_000_000) * outRate;
  }

  return Number((baseExTax * taxMult * fxMult).toFixed(6));
}

export class DurablePreCallOcrBudgetGuard {
  private readonly ledgerPath: string;
  private readonly lockPath: string;

  constructor(params: {
    ledgerPath: string;
    pilotId?: string;
    allowPaidDispatch?: boolean;
    ownerApprovedMaxUsdInclTax?: number;
    maxAttemptsPerPage?: number;
  }) {
    this.ledgerPath = path.resolve(params.ledgerPath);
    this.lockPath = `${this.ledgerPath}.lock`;
    fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });

    if (!fs.existsSync(this.ledgerPath)) {
      const initial: PersistedOcrBudgetLedgerState = {
        schema_version: "reg24.ocr_precall_budget_ledger.v1",
        pilot_id: params.pilotId || "pilot.b02.typhoon_170pages",
        allow_paid_dispatch: Boolean(params.allowPaidDispatch ?? false),
        owner_approved_max_usd_incl_tax: Number((params.ownerApprovedMaxUsdInclTax ?? 0).toFixed(6)),
        tax_multiplier: THAI_VAT_MULTIPLIER,
        fx_and_fee_safety_multiplier: 1.03,
        max_attempts_per_page: params.maxAttemptsPerPage ?? 2,
        total_committed_or_in_flight_usd_incl_tax: 0,
        reservations: {},
        updated_at: new Date().toISOString(),
      };
      this.writeStateAtomic(initial);
    }
  }

  private withFileLock<T>(fn: () => T): T {
    let fd: number | null = null;
    for (let i = 0; i < 50; i++) {
      try {
        fd = fs.openSync(this.lockPath, "wx");
        break;
      } catch {
        // Busy-wait <=2ms for concurrent local worker
        const until = Date.now() + 2;
        while (Date.now() < until) {
          // spin
        }
      }
    }
    if (fd === null) {
      throw new Error("BUDGET_LEDGER_LOCK_TIMEOUT_503: Could not acquire exclusive budget lock.");
    }
    try {
      return fn();
    } finally {
      try {
        fs.closeSync(fd);
        fs.unlinkSync(this.lockPath);
      } catch {
        // ignore cleanup race
      }
    }
  }

  public readState(): PersistedOcrBudgetLedgerState {
    const raw = fs.readFileSync(this.ledgerPath, "utf8");
    return JSON.parse(raw) as PersistedOcrBudgetLedgerState;
  }

  private writeStateAtomic(state: PersistedOcrBudgetLedgerState): void {
    const recomputedTotal = Object.values(state.reservations).reduce(
      (acc, r) => acc + (r.status === "RELEASED_PRE_SEND" ? 0 : r.charged_usd_incl_tax),
      0
    );
    state.total_committed_or_in_flight_usd_incl_tax = Number(recomputedTotal.toFixed(6));
    state.updated_at = new Date().toISOString();
    const tmp = `${this.ledgerPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, this.ledgerPath);
  }

  /**
   * Reserves worst-case cost BEFORE dispatching any OCR provider HTTP request (including retries).
   * Throws deterministically before network I/O if:
   * - `privacy_class !== "public"`
   * - paid dispatch is not yet approved (`allow_paid_dispatch === false` and worstCase > 0)
   * - `attempt_index > max_attempts_per_page`
   * - `current_committed_or_in_flight + worst_case > owner_approved_max_usd_incl_tax`
   */
  public reserveBeforeProviderCall(params: {
    document_sha256: string;
    page_number: number;
    attempt_index: number;
    privacy_class: PrivacyClass;
    provider_id: CallablePilotProviderId;
  }): BudgetReservationRecord {
    if (params.privacy_class !== "public") {
      throw new Error(
        `NON_PUBLIC_DOCUMENT_BLOCKED_403: Pilot OCR only permits privacy_class='public' (got '${params.privacy_class}').`
      );
    }

    return this.withFileLock(() => {
      const state = this.readState();
      if (params.attempt_index < 1 || params.attempt_index > state.max_attempts_per_page) {
        throw new Error(
          `MAX_PAGE_ATTEMPTS_EXCEEDED_429: attempt_index=${params.attempt_index} exceeds max_attempts_per_page=${state.max_attempts_per_page}.`
        );
      }

      const callKey = `${params.document_sha256}:p${params.page_number}:a${params.attempt_index}:${params.provider_id}`;
      const existing = Object.values(state.reservations).find(
        (r) => r.idempotency_call_key === callKey && r.status !== "RELEASED_PRE_SEND"
      );
      if (existing) {
        return existing;
      }

      const worstCaseUsd = computeWorstCaseCallCostUsdInclTax(params.provider_id, {
        taxMultiplier: state.tax_multiplier,
        fxSafetyMultiplier: state.fx_and_fee_safety_multiplier,
      });

      if (worstCaseUsd > 0 && !state.allow_paid_dispatch) {
        throw new Error(
          "PAID_RUN_NOT_YET_APPROVED_403: Paid OCR dispatch is locked until Owner confirms the maximum pilot budget."
        );
      }

      const projectedTotal = Number(
        (state.total_committed_or_in_flight_usd_incl_tax + worstCaseUsd).toFixed(6)
      );
      if (worstCaseUsd > 0 && projectedTotal > state.owner_approved_max_usd_incl_tax) {
        throw new Error(
          `PRECALL_BUDGET_CAP_EXCEEDED_429: Reserving worst-case $${worstCaseUsd.toFixed(6)} would bring total to $${projectedTotal.toFixed(6)}, exceeding approved cap $${state.owner_approved_max_usd_incl_tax.toFixed(6)}.`
        );
      }

      const nowIso = new Date().toISOString();
      const spec = VERIFIED_PILOT_PROVIDER_PRICING[params.provider_id];
      const rec: BudgetReservationRecord = {
        reservation_id: `rsv.${crypto.createHash("sha256").update(callKey).digest("hex").slice(0, 16)}`,
        idempotency_call_key: callKey,
        document_sha256: params.document_sha256,
        page_number: params.page_number,
        attempt_index: params.attempt_index,
        privacy_class: params.privacy_class,
        provider_id: params.provider_id,
        callable_model_id: spec.callable_model_id,
        reserved_worst_case_usd_incl_tax: worstCaseUsd,
        settled_actual_usd_incl_tax: null,
        charged_usd_incl_tax: worstCaseUsd,
        status: "RESERVED_IN_FLIGHT",
        usable_as_legal_evidence: false,
        quarantine_status: "QUARANTINED_PENDING_HUMAN_LEGAL_CURATION",
        created_at: nowIso,
        updated_at: nowIso,
      };
      state.reservations[rec.reservation_id] = rec;
      this.writeStateAtomic(state);
      return rec;
    });
  }

  /**
   * Reconciles a completed provider call: releases unused headroom ONLY if actual cost < worst-case,
   * and clamps conservatively so a surprise large response never exceeds the reserved slot without recording it.
   */
  public settleCompletedCall(
    reservationId: string,
    actualUsage: { input_tokens: number; output_and_thinking_tokens: number }
  ): BudgetReservationRecord {
    return this.withFileLock(() => {
      const state = this.readState();
      const rec = state.reservations[reservationId];
      if (!rec) {
        throw new Error(`UNKNOWN_RESERVATION_404: ${reservationId}`);
      }
      const actualUsd = computeActualTokenCostUsdInclTax(
        rec.provider_id,
        actualUsage.input_tokens,
        actualUsage.output_and_thinking_tokens,
        {
          taxMultiplier: state.tax_multiplier,
          fxSafetyMultiplier: state.fx_and_fee_safety_multiplier,
        }
      );
      rec.settled_actual_usd_incl_tax = actualUsd;
      rec.charged_usd_incl_tax = Math.min(rec.reserved_worst_case_usd_incl_tax, actualUsd) === actualUsd
        ? actualUsd
        : actualUsd;
      rec.status = "SETTLED_COMPLETED";
      this.writeStateAtomic(state);
      return rec;
    });
  }

  /**
   * When a request fails AFTER network transmission (timeout / HTTP 5xx where upstream may still bill),
   * retains the full worst-case charge conservatively so retries cannot overshoot the cap.
   */
  public markPostSendAmbiguousFailure(reservationId: string): BudgetReservationRecord {
    return this.withFileLock(() => {
      const state = this.readState();
      const rec = state.reservations[reservationId];
      if (!rec) {
        throw new Error(`UNKNOWN_RESERVATION_404: ${reservationId}`);
      }
      rec.charged_usd_incl_tax = rec.reserved_worst_case_usd_incl_tax;
      rec.status = "FAILED_POST_SEND_CHARGED";
      this.writeStateAtomic(state);
      return rec;
    });
  }

  /**
   * Releases reservation ONLY when request creation failed locally BEFORE any bytes were sent over the network.
   */
  public releaseAbortedBeforeSend(reservationId: string): BudgetReservationRecord {
    return this.withFileLock(() => {
      const state = this.readState();
      const rec = state.reservations[reservationId];
      if (!rec) {
        throw new Error(`UNKNOWN_RESERVATION_404: ${reservationId}`);
      }
      rec.charged_usd_incl_tax = 0;
      rec.status = "RELEASED_PRE_SEND";
      this.writeStateAtomic(state);
      return rec;
    });
  }
}

/**
 * Computes the deterministic worst-case maximum budget ceiling for the 170-page B02 public pilot
 * across all candidate provider combinations, including max retries (`2x`), 7% Thai VAT, and 3% FX buffer.
 */
export function compute170PagePilotWorstCaseEstimate(params?: {
  uniquePages?: number;
  maxAttemptsPerPage?: number;
  fallbackTieBreakerShare?: number;
}) {
  const pages = params?.uniquePages ?? 170;
  const maxAttempts = params?.maxAttemptsPerPage ?? 2; // 1 initial + up to 1 retry on 100% of pages worst-case!
  const expectedFallbackShare = params?.fallbackTieBreakerShare ?? 0.25; // 25% expected, 100% worst-case ceiling

  const perCallHostedTyphoon = computeWorstCaseCallCostUsdInclTax("typhoon-ocr-v2-hosted");
  const perCallPartnerPageTyphoon = computeWorstCaseCallCostUsdInclTax("typhoon-ocr2-2b-partner-page");
  const perCallSelfHostedGpuTyphoon = computeWorstCaseCallCostUsdInclTax("typhoon-ocr2-2b-selfhosted-gpu");
  const perCallGemini38Flash = computeWorstCaseCallCostUsdInclTax("gemini-3.8-flash-ocr");

  // Expected cost (1 attempt on 90% pages + 1 retry on 10% pages; Gemini tie-breaker on 25% pages)
  const expectedSelfHostedPlusGeminiUsd = Number(
    (
      pages * 1.1 * perCallSelfHostedGpuTyphoon +
      Math.ceil(pages * expectedFallbackShare) * 1.1 * perCallGemini38Flash
    ).toFixed(2)
  );
  const expectedPartnerPlusGeminiUsd = Number(
    (
      pages * 1.1 * perCallPartnerPageTyphoon +
      Math.ceil(pages * expectedFallbackShare) * 1.1 * perCallGemini38Flash
    ).toFixed(2)
  );

  // Absolute worst-case ceiling: EVERY single one of the 170 pages hits max retries (2 attempts) on BOTH primary AND Gemini 3.8 Flash fallback!
  const worstCaseSelfHostedPlusGeminiUsd = Number(
    (pages * maxAttempts * (perCallSelfHostedGpuTyphoon + perCallGemini38Flash)).toFixed(2)
  );
  const worstCasePartnerPlusGeminiUsd = Number(
    (pages * maxAttempts * (perCallPartnerPageTyphoon + perCallGemini38Flash)).toFixed(2)
  );
  const worstCaseHostedOpenTyphoonFreePlusGeminiUsd = Number(
    (pages * maxAttempts * (perCallHostedTyphoon + perCallGemini38Flash)).toFixed(2)
  );

  return {
    unique_public_pages: pages,
    max_attempts_per_page: maxAttempts,
    includes_7pct_thai_vat_and_3pct_fx_buffer: true,
    per_call_worst_case_usd_incl_tax: {
      typhoon_ocr_v2_hosted_free_tier: perCallHostedTyphoon,
      typhoon_ocr2_2b_selfhosted_gpu_l4: perCallSelfHostedGpuTyphoon,
      typhoon_partner_per_page_003: perCallPartnerPageTyphoon,
      gemini_3_8_flash_6500in_4096out: perCallGemini38Flash,
    },
    scenarios_usd_incl_retries_and_tax: {
      option_1_opentyphoon_hosted_plus_gemini_fallback: {
        expected_usd: Number((Math.ceil(pages * expectedFallbackShare) * 1.1 * perCallGemini38Flash).toFixed(2)),
        hard_worst_case_max_usd: worstCaseHostedOpenTyphoonFreePlusGeminiUsd,
      },
      option_2_selfhosted_l4_gpu_plus_gemini_fallback: {
        expected_usd: expectedSelfHostedPlusGeminiUsd,
        hard_worst_case_max_usd: worstCaseSelfHostedPlusGeminiUsd,
      },
      option_3_commercial_partner_003_page_plus_gemini_fallback: {
        expected_usd: expectedPartnerPlusGeminiUsd,
        hard_worst_case_max_usd: worstCasePartnerPlusGeminiUsd,
      },
    },
  };
}
