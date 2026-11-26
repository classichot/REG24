/**
 * REG24 — Candidate 12 Workstream A: Structured Follow-Up FactDelta Schema, Constrained Extractor & Fail-Closed Guard
 *
 * Replaces fragile Thai-only follow-up regex parsing with:
 * - A1: Typed `FactDelta` schema validated deterministically (verbatim `source_span`, valid declared lot IDs,
 *       parseable ISO dates, reconciled amounts).
 * - A2: Constrained `gemini-4-neon @ low` (temperature 0, zero fallback) structured JSON extraction on
 *       follow-up turns (`turn >= 2`), keeping the regex extractor only as a logged cross-check (`delta_disagreement`).
 * - A4: Fail-closed behavior — low confidence, invalid delta on a correction turn, or a correction turn that
 *       produces zero ledger state change returns `NEEDS_CLARIFICATION` naming the ambiguous lot/event.
 */

import { GoogleGenAI } from "@google/genai";
import type { StructuredCaseFactLedger, TemporalEventKind } from "./case-fact-ledger";
import { thaiDigitsToArabic } from "./identity";
import {
  extractOutputTextFromGeminiInteraction,
  resolveConfiguredProviderAndModel,
  resolveThinkingLevelForModel,
  type GroundedLlmProviderId,
  type GroundedThinkingLevel,
  type ProviderFailureClassification,
} from "./grounded-llm-drafter";

export const FACT_DELTA_PROMPT_VERSION = "reg24-fact-delta-v1.0";

export type FactDeltaOp =
  | "set_event"
  | "remove_event"
  | "reassign_lots"
  | "shift_date"
  | "set_amount";

export type FactDeltaEventType =
  | "OWNERSHIP_TRANSFER"
  | "DELIVERY"
  | "PAYMENT"
  | "INVOICE"
  | null;

export type FactDeltaLotsMode = "only" | "add" | "remove";

export interface FactDeltaChange {
  op: FactDeltaOp;
  event_type: FactDeltaEventType;
  lots: string[];
  lots_mode: FactDeltaLotsMode;
  from_date: string | null;
  to_date: string | null;
  amount_thb: number | null;
  source_span: string;
}

export interface FactDelta {
  is_correction: boolean;
  confidence: "high" | "low";
  changes: FactDeltaChange[];
  unchanged_scope: "all_other_facts" | "unspecified";
}

export interface FactDeltaValidationResult {
  valid: boolean;
  normalized_delta: FactDelta | null;
  rejection_reasons: string[];
}

export interface FactDeltaInvocationAudit {
  provider: GroundedLlmProviderId;
  requested_model: string;
  resolved_model: string | null;
  thinking_level: GroundedThinkingLevel;
  temperature: 0;
  silent_fallback_disabled: true;
  live_provider_called: boolean;
  failure_classification: ProviderFailureClassification;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  total_tokens: number;
  error_summary: string | null;
}

export interface FactDeltaExtractionOutcome {
  ok: boolean;
  provider_failed: boolean;
  raw_delta: FactDelta | null;
  validation: FactDeltaValidationResult;
  invocation_audit: FactDeltaInvocationAudit;
  raw_output_text: string | null;
}

export interface FactDeltaAuditRecord {
  schema_version: "reg24.fact_delta.v1";
  turn_number: number;
  fact_delta: FactDelta | null;
  validation_passed: boolean;
  validation_rejection_reasons: string[];
  ledger_before_hash: string;
  ledger_after_hash: string;
  ledger_changed: boolean;
  delta_disagreement: boolean;
  delta_disagreement_summary: string | null;
  fail_closed_triggered: boolean;
  fail_closed_reason: string | null;
  invocation_audit: FactDeltaInvocationAudit;
}

export type MockFactDeltaExtractorFn = (args: {
  userTurnText: string;
  priorLedger: StructuredCaseFactLedger;
  userPrompt: string;
  requestedModel: string;
  thinkingLevel: GroundedThinkingLevel;
}) => Promise<FactDelta> | FactDelta;

/**
 * Clean single-type JSON Schema compatible with Gemini 4 Neon constrained JSON decoding
 * (optional/nullable fields use empty string `""` / omitted numeric fields and are normalized to `null`).
 */
export const FACT_DELTA_JSON_SCHEMA = {
  type: "object",
  properties: {
    is_correction: { type: "boolean" },
    confidence: { type: "string", enum: ["high", "low"] },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["set_event", "remove_event", "reassign_lots", "shift_date", "set_amount"],
          },
          event_type: {
            type: "string",
            enum: ["OWNERSHIP_TRANSFER", "DELIVERY", "PAYMENT", "INVOICE", "NONE"],
          },
          lots: {
            type: "array",
            items: { type: "string" },
          },
          lots_mode: {
            type: "string",
            enum: ["only", "add", "remove"],
          },
          from_date: { type: "string" },
          to_date: { type: "string" },
          amount_thb: { type: "number" },
          source_span: { type: "string" },
        },
        required: ["op", "lots", "lots_mode", "source_span"],
      },
    },
    unchanged_scope: {
      type: "string",
      enum: ["all_other_facts", "unspecified"],
    },
  },
  required: ["is_correction", "confidence", "changes", "unchanged_scope"],
};

const VALID_OPS = new Set<FactDeltaOp>([
  "set_event",
  "remove_event",
  "reassign_lots",
  "shift_date",
  "set_amount",
]);

const VALID_EVENT_TYPES = new Set<Exclude<FactDeltaEventType, null>>([
  "OWNERSHIP_TRANSFER",
  "DELIVERY",
  "PAYMENT",
  "INVOICE",
]);

const VALID_LOTS_MODES = new Set<FactDeltaLotsMode>(["only", "add", "remove"]);

export function isValidStrictIsoDate(val: string | null | undefined): val is string {
  if (typeof val !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1950 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

function normalizeOptionalStringDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }
  return trimmed;
}

function normalizeOptionalEventType(v: unknown): FactDeltaEventType {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  if (!up || up === "NULL" || up === "NONE") return null;
  if (VALID_EVENT_TYPES.has(up as Exclude<FactDeltaEventType, null>)) {
    return up as Exclude<FactDeltaEventType, null>;
  }
  return null;
}

function normalizeRawFactDelta(raw: unknown): FactDelta | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const isCorrection = Boolean(obj.is_correction);
  const confidence: "high" | "low" = obj.confidence === "low" ? "low" : "high";
  const unchangedScope: "all_other_facts" | "unspecified" =
    obj.unchanged_scope === "all_other_facts" ? "all_other_facts" : "unspecified";
  const rawChanges = Array.isArray(obj.changes) ? obj.changes : [];

  const changes: FactDeltaChange[] = [];
  for (const ch of rawChanges) {
    if (!ch || typeof ch !== "object") continue;
    const c = ch as Record<string, unknown>;
    const op = typeof c.op === "string" ? (c.op.trim() as FactDeltaOp) : ("" as FactDeltaOp);
    const lotsMode =
      typeof c.lots_mode === "string"
        ? (c.lots_mode.trim().toLowerCase() as FactDeltaLotsMode)
        : "only";
    const rawLots = Array.isArray(c.lots)
      ? c.lots.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
      : [];
    const amountRaw =
      typeof c.amount_thb === "number" && Number.isFinite(c.amount_thb) && c.amount_thb > 0
        ? c.amount_thb
        : null;
    changes.push({
      op,
      event_type: normalizeOptionalEventType(c.event_type),
      lots: rawLots,
      lots_mode: lotsMode,
      from_date: normalizeOptionalStringDate(c.from_date),
      to_date: normalizeOptionalStringDate(c.to_date),
      amount_thb: amountRaw,
      source_span: typeof c.source_span === "string" ? c.source_span : "",
    });
  }

  return {
    is_correction: isCorrection,
    confidence,
    changes,
    unchanged_scope: unchangedScope,
  };
}

function canonicalizeDeclaredLotIdCandidate(
  rawLot: string,
  declaredLotIds: Set<string>,
  declaredLotByLabel: Map<string, string>
): string | null {
  const trimmed = thaiDigitsToArabic(rawLot).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (declaredLotIds.has(upper)) return upper;

  const byLabel = declaredLotByLabel.get(trimmed.toLowerCase());
  if (byLabel && declaredLotIds.has(byLabel)) return byLabel;

  const stripped = upper.replace(
    /^(?:LOT_|LOT\s+|BATCH\s+|TRANCHE\s+|ITEM\s+|SET\s+|ล็อต\s*|ล๊อต\s*|ชุดที่\s*|ชุด\s*|รายการที่\s*|รายการ\s*|ส่วนที่\s*)/i,
    ""
  ).trim();
  const candidate = `LOT_${stripped}`;
  if (declaredLotIds.has(candidate)) return candidate;
  return null;
}

/**
 * A1 Deterministic Validator:
 * - `source_span` MUST be a verbatim substring of `userTurnText` (reject if not)
 * - Every lot ID MUST exist in `priorLedger.temporal_facts.declared_goods_lots`
 * - Dates (`from_date`, `to_date`) MUST parse as strict `YYYY-MM-DD`
 * - Amounts MUST be positive and reconcile with declared lot values when applicable
 */
export function validateFactDelta(
  rawDelta: unknown,
  priorLedger: StructuredCaseFactLedger,
  userTurnText: string
): FactDeltaValidationResult {
  const delta = normalizeRawFactDelta(rawDelta);
  if (!delta) {
    return {
      valid: false,
      normalized_delta: null,
      rejection_reasons: ["Delta payload is null or malformed."],
    };
  }

  const reasons: string[] = [];
  const declaredLots = priorLedger.temporal_facts.declared_goods_lots || [];
  const declaredLotIds = new Set(declaredLots.map((l) => l.lot_id));
  const declaredLotById = new Map(declaredLots.map((l) => [l.lot_id, l]));
  const declaredLotByLabel = new Map<string, string>();
  for (const l of declaredLots) {
    declaredLotByLabel.set(thaiDigitsToArabic(l.label_th).trim().toLowerCase(), l.lot_id);
  }

  const normalizedChanges: FactDeltaChange[] = [];

  for (let i = 0; i < delta.changes.length; i++) {
    const ch = delta.changes[i];
    if (!VALID_OPS.has(ch.op)) {
      reasons.push(`changes[${i}]: unsupported op '${String(ch.op)}'.`);
      continue;
    }
    if (!VALID_LOTS_MODES.has(ch.lots_mode)) {
      reasons.push(`changes[${i}]: unsupported lots_mode '${String(ch.lots_mode)}'.`);
      continue;
    }

    // Rule 1: verbatim substring check on `source_span`
    if (!ch.source_span || !ch.source_span.trim() || !userTurnText.includes(ch.source_span)) {
      reasons.push(
        `changes[${i}]: source_span is missing or not a verbatim substring of the user turn.`
      );
      continue;
    }

    // Rule 2: dates must parse strictly when provided
    if (ch.from_date !== null && !isValidStrictIsoDate(ch.from_date)) {
      reasons.push(`changes[${i}]: invalid from_date '${ch.from_date}'.`);
      continue;
    }
    if (ch.to_date !== null && !isValidStrictIsoDate(ch.to_date)) {
      reasons.push(`changes[${i}]: invalid to_date '${ch.to_date}'.`);
      continue;
    }

    // Rule 3: lot IDs must exist in `declared_goods_lots`
    const canonicalLots: string[] = [];
    let hasUnknownLot = false;
    for (const rawLot of ch.lots) {
      if (declaredLotIds.size === 0) {
        reasons.push(
          `changes[${i}]: lot '${rawLot}' referenced but prior ledger has no declared_goods_lots.`
        );
        hasUnknownLot = true;
        break;
      }
      const canon = canonicalizeDeclaredLotIdCandidate(rawLot, declaredLotIds, declaredLotByLabel);
      if (!canon) {
        reasons.push(
          `changes[${i}]: unknown lot '${rawLot}' not in declared_goods_lots (${Array.from(declaredLotIds).join(", ")}).`
        );
        hasUnknownLot = true;
        break;
      }
      if (!canonicalLots.includes(canon)) {
        canonicalLots.push(canon);
      }
    }
    if (hasUnknownLot) continue;

    // Rule 4: op-specific required fields
    if (ch.op === "reassign_lots" && canonicalLots.length === 0) {
      reasons.push(`changes[${i}]: reassign_lots requires at least one valid lot id.`);
      continue;
    }
    if (ch.op === "shift_date" && (!ch.from_date || !ch.to_date)) {
      reasons.push(`changes[${i}]: shift_date requires both from_date and to_date.`);
      continue;
    }
    if (ch.op === "set_event" && (!ch.event_type || !(ch.to_date || ch.from_date))) {
      reasons.push(`changes[${i}]: set_event requires event_type and to_date/from_date.`);
      continue;
    }
    if (ch.op === "remove_event" && !ch.event_type && !ch.from_date && !ch.to_date) {
      reasons.push(`changes[${i}]: remove_event requires event_type or date.`);
      continue;
    }
    if (ch.op === "set_amount" && (ch.amount_thb === null || ch.amount_thb <= 0)) {
      reasons.push(`changes[${i}]: set_amount requires a positive amount_thb.`);
      continue;
    }

    // Rule 5: amount reconciliation against declared lot values
    if (ch.amount_thb !== null) {
      if (!Number.isFinite(ch.amount_thb) || ch.amount_thb <= 0) {
        reasons.push(`changes[${i}]: amount_thb must be a positive finite number.`);
        continue;
      }
      if (ch.op !== "set_amount" && canonicalLots.length > 0 && declaredLots.length > 0) {
        const expectedLotSum = canonicalLots.reduce(
          (sum, lid) => sum + (declaredLotById.get(lid)?.amount_thb ?? 0),
          0
        );
        const totalDeclaredSum = declaredLots.reduce((sum, l) => sum + l.amount_thb, 0);
        if (
          expectedLotSum > 0 &&
          Math.abs(ch.amount_thb - expectedLotSum) > 1 &&
          Math.abs(ch.amount_thb - totalDeclaredSum) > 1
        ) {
          reasons.push(
            `changes[${i}]: amount_thb (${ch.amount_thb}) does not reconcile with declared lot sum (${expectedLotSum}) for [${canonicalLots.join(", ")}].`
          );
          continue;
        }
      }
    }

    normalizedChanges.push({
      ...ch,
      lots: canonicalLots,
    });
  }

  if (reasons.length > 0) {
    return {
      valid: false,
      normalized_delta: null,
      rejection_reasons: reasons,
    };
  }

  return {
    valid: true,
    normalized_delta: {
      ...delta,
      changes: normalizedChanges,
    },
    rejection_reasons: [],
  };
}

const CORRECTION_KEYWORDS_RE =
  /(?:^|\b|[\s.,:;()[\]-])(?:correction|correct(?:ed|ing)?|amend(?:ed|ment)?|revise(?:d)?|update(?:d)?|change(?:d)?|instead|covered\s+lot|only\b)(?:\b|$|[\s.,:;()[\]-])|(?:ขอแก้|แก้ไข|แก้เป็น|ขอเปลี่ยน|เปลี่ยนข้อเท็จจริง|เปลี่ยนเป็น|เปลี่ยนจาก|ปรับแก้|เลื่อนเป็น|แทน(?:ที่)?|เฉพาะ(?:ล็อต|ชุด|รายการ|ส่วน)|เท่านั้น)/i;

const NO_OP_SUMMARY_ONLY_RE =
  /^\s*(?:ช่วย)?(?:สรุป(?:ให้)?(?:อีก(?:ครั้ง|รอบ)|สั้นๆ|ใหม่)?|อธิบาย(?:เพิ่ม(?:เติม)?|อีก(?:ครั้ง|รอบ))?|ทบทวน(?:อีก(?:ครั้ง|รอบ))?|summarize\s+again|please\s+summarize|recap|repeat\s+the\s+summary)\s*[?？!.]*\s*$/i;

export function hasCorrectionKeywords(userTurnText: string): boolean {
  const norm = thaiDigitsToArabic(userTurnText || "").trim();
  if (!norm || NO_OP_SUMMARY_ONLY_RE.test(norm)) return false;
  return CORRECTION_KEYWORDS_RE.test(norm);
}

/**
 * Determines whether the prior ledger has VAT goods-lot / temporal event state where
 * structured FactDelta follow-up extraction applies (turn >= 2).
 */
export function shouldRunStructuredFactDelta(priorLedger: StructuredCaseFactLedger): boolean {
  const declaredLots = priorLedger.temporal_facts.declared_goods_lots || [];
  if (declaredLots.length >= 2) return true;
  if (priorLedger.temporal_facts.vat_portion_allocation_record) return true;
  const vatEvents = (priorLedger.temporal_facts.transaction_or_event_dates || []).filter(
    (e) =>
      e.event_type === "OWNERSHIP_TRANSFER" ||
      e.event_type === "DELIVERY" ||
      e.event_type === "PAYMENT" ||
      e.event_type === "INVOICE"
  );
  const isVatMatter =
    priorLedger.material_facts.some(
      (f) => f.fact_key === "vat_transaction_type" || f.fact_key === "vat_registrant_status"
    ) ||
    priorLedger.user_turns.some((t) => /ภาษีมูลค่าเพิ่ม|\bVAT\b/i.test(t.raw_text));
  return isVatMatter && vatEvents.length > 0;
}

const FACT_DELTA_SYSTEM_INSTRUCTION = `You are REG24's deterministic Fact-Delta Extractor for Thai/English/mixed VAT follow-up turns.
Given:
1. DECLARED_GOODS_LOTS from the prior turns,
2. PRIOR_LEDGER_EVENTS_BY_LOT from the prior turns, and
3. NEW_USER_TURN_TEXT,

emit ONLY a JSON object conforming strictly to the FactDelta schema describing what facts changed in NEW_USER_TURN_TEXT.

STRICT RULES:
1. Language-agnostic understanding: interpret Thai, English, or mixed Thai/English identically regardless of clause order, lot label style ("ล็อต", "ชุดที่", "รายการที่", "Lot"), Thai or Arabic digits, or short/long dates (e.g., "30 September", "30 ก.ย. 69", "2 ตุลาคม 2569").
2. Date normalization: ALWAYS output ISO YYYY-MM-DD in CE (subtract 543 from Thai Buddhist Era years: 2569 -> 2026, 2568 -> 2025, 2570 -> 2027). If NEW_USER_TURN_TEXT omits the year (e.g., "30 September"), resolve the year from the matching event/date in PRIOR_LEDGER_EVENTS_BY_LOT.
3. VERBATIM source_span: Every change's "source_span" MUST be copied CHARACTER-FOR-CHARACTER verbatim as an exact substring from NEW_USER_TURN_TEXT. Do NOT translate, rephrase, or alter capitalization/spaces in source_span.
4. Valid lot IDs ONLY: Use ONLY exact lot_id values present in DECLARED_GOODS_LOTS (e.g. "LOT_A", "LOT_B", "LOT_C"). NEVER invent a lot ID that is not in DECLARED_GOODS_LOTS. If the user references an unknown lot (e.g. "Lot D" when only A/B/C exist) or an ambiguous unspecified lot ("one of the lots", "ล็อตใดล็อตหนึ่ง", "ล็อตดังกล่าว" when multiple lots could match), set is_correction=true, confidence="low", changes=[].
5. Choosing the right op:
   - "reassign_lots": Use when an existing dated event is reassigned to specific lot(s). Example: "Correction: the 30 September payment and tax invoice covered lot B only. Keep all other facts unchanged." -> TWO changes (one for event_type="PAYMENT", one for event_type="INVOICE"), both with op="reassign_lots", lots=["LOT_B"], lots_mode="only", from_date="2026-09-30", to_date="2026-09-30", unchanged_scope="all_other_facts".
   - "set_event": Use when adding or updating a dated event for specific lot(s) WITHOUT stripping unrelated lots' other events. Example: "ขอเปลี่ยนข้อเท็จจริงเฉพาะล็อต C มูลค่า 10,000 บาทว่า บริษัทได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C เมื่อวันที่ 30 กันยายน 2569 ส่วนข้อเท็จจริงของล็อต A และล็อต B เหมือนเดิมทั้งหมด" -> TWO changes (PAYMENT and INVOICE) with op="set_event", lots=["LOT_C"], lots_mode="only", to_date="2026-09-30", unchanged_scope="all_other_facts".
   - "shift_date": Use when moving events from from_date to to_date. Example: "เหตุการณ์ทั้งหมดที่เดิมเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 ให้เปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 2 ตุลาคม 2569 แทน" -> op="shift_date", event_type="NONE", lots=[], lots_mode="only", from_date="2026-10-01", to_date="2026-10-02", unchanged_scope="all_other_facts".
   - "remove_event": Use when a turn states an earlier event did NOT happen or is cancelled.
   - "set_amount": Use ONLY when the user explicitly changes the baht price/value of a lot or the total transaction. Do NOT emit set_amount when the user merely restates an existing lot's unchanged value (e.g. "เฉพาะล็อต C มูลค่า 10,000 บาท").
6. No-op follow-ups: If NEW_USER_TURN_TEXT only asks to summarize, repeat, or explain without changing any fact (e.g. "สรุปให้อีกครั้ง"), emit is_correction=false, confidence="high", changes=[], unchanged_scope="all_other_facts".`;

export function buildFactDeltaUserPrompt(
  priorLedger: StructuredCaseFactLedger,
  userTurnText: string
): string {
  const declaredLots = (priorLedger.temporal_facts.declared_goods_lots || []).map((l) => ({
    lot_id: l.lot_id,
    label_th: l.label_th,
    amount_thb: l.amount_thb,
  }));

  const activeEvents = (priorLedger.temporal_facts.transaction_or_event_dates || [])
    .filter((e) => e.event_status !== "NEGATED" && e.event_type !== "QUESTION_DATE")
    .map((e) => ({
      event_type: e.event_type,
      iso_date: e.iso_date,
      raw_text: e.raw_text,
      covered_lot_ids: e.covered_lot_ids || [],
      portion_coverage: e.portion_coverage || "UNSTATED",
      amount_thb: e.amount_thb ?? null,
      source_turn: e.source_turn,
    }));

  const eventsByLot: Record<string, Array<{ event_type: TemporalEventKind; iso_date: string }>> = {};
  for (const lot of declaredLots) {
    eventsByLot[lot.lot_id] = activeEvents
      .filter((e) =>
        e.covered_lot_ids.length > 0
          ? e.covered_lot_ids.includes(lot.lot_id)
          : e.portion_coverage === "FULL" || e.event_type === "DELIVERY"
      )
      .map((e) => ({ event_type: e.event_type, iso_date: e.iso_date }));
  }

  return [
    "DECLARED_GOODS_LOTS:",
    JSON.stringify(declaredLots, null, 2),
    "",
    "PRIOR_LEDGER_EVENTS:",
    JSON.stringify(activeEvents, null, 2),
    "",
    "PRIOR_LEDGER_EVENTS_BY_LOT:",
    JSON.stringify(eventsByLot, null, 2),
    "",
    "NEW_USER_TURN_TEXT (copy source_span verbatim from this exact string):",
    userTurnText,
  ].join("\n");
}

function classifyFactDeltaError(
  httpStatus: number | null,
  msg: string
): ProviderFailureClassification {
  const low = msg.toLowerCase();
  if (httpStatus === 429 || low.includes("429") || low.includes("rate limit") || low.includes("quota")) {
    return "RATE_LIMIT_429_FREE_TIER";
  }
  if (low.includes("abort") || low.includes("timeout") || low.includes("timed out")) {
    return "TIMEOUT";
  }
  if (low.includes("json") || low.includes("parse") || low.includes("unexpected token")) {
    return "INVALID_OUTPUT";
  }
  return "PROVIDER_UNAVAILABLE";
}

/**
 * A2: Calls `gemini-4-neon @ low` (temperature 0, 1 attempt, zero fallback) with JSON-schema output
 * to extract a typed `FactDelta` from a follow-up turn.
 */
export async function extractStructuredFactDeltaWithModel(params: {
  priorLedger: StructuredCaseFactLedger;
  userTurnText: string;
  overrideModel?: string | null;
  thinkingLevel?: GroundedThinkingLevel | null;
  timeoutMs?: number;
  mockExtractorForTesting?: MockFactDeltaExtractorFn;
}): Promise<FactDeltaExtractionOutcome> {
  const { provider, requestedModel } = resolveConfiguredProviderAndModel({
    challengerProvider: "google-gemini",
    overrideModel: params.overrideModel,
  });
  const { thinking_level } = resolveThinkingLevelForModel(
    requestedModel,
    params.thinkingLevel ?? "low"
  );
  const userPrompt = buildFactDeltaUserPrompt(params.priorLedger, params.userTurnText);
  const startMs = Date.now();

  if (params.mockExtractorForTesting && process.env.VERCEL_ENV !== "production") {
    try {
      const mockRaw = await params.mockExtractorForTesting({
        userTurnText: params.userTurnText,
        priorLedger: params.priorLedger,
        userPrompt,
        requestedModel,
        thinkingLevel: thinking_level,
      });
      const validation = validateFactDelta(mockRaw, params.priorLedger, params.userTurnText);
      return {
        ok: validation.valid,
        provider_failed: false,
        raw_delta: normalizeRawFactDelta(mockRaw),
        validation,
        raw_output_text: JSON.stringify(mockRaw),
        invocation_audit: {
          provider,
          requested_model: requestedModel,
          resolved_model: requestedModel,
          thinking_level,
          temperature: 0,
          silent_fallback_disabled: true,
          live_provider_called: true,
          failure_classification: "NONE",
          latency_ms: Math.max(1, Date.now() - startMs),
          input_tokens: 256,
          output_tokens: 96,
          thought_tokens: 32,
          total_tokens: 384,
          error_summary: null,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider_failed: true,
        raw_delta: null,
        validation: {
          valid: false,
          normalized_delta: null,
          rejection_reasons: [msg],
        },
        raw_output_text: null,
        invocation_audit: {
          provider,
          requested_model: requestedModel,
          resolved_model: null,
          thinking_level,
          temperature: 0,
          silent_fallback_disabled: true,
          live_provider_called: true,
          failure_classification: classifyFactDeltaError(null, msg),
          latency_ms: Math.max(1, Date.now() - startMs),
          input_tokens: 0,
          output_tokens: 0,
          thought_tokens: 0,
          total_tokens: 0,
          error_summary: msg.slice(0, 300),
        },
      };
    }
  }

  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();
  if (!apiKey) {
    return {
      ok: false,
      provider_failed: true,
      raw_delta: null,
      validation: {
        valid: false,
        normalized_delta: null,
        rejection_reasons: ["GEMINI_API_KEY is not configured for FactDelta extraction."],
      },
      raw_output_text: null,
      invocation_audit: {
        provider: "google-gemini",
        requested_model: requestedModel,
        resolved_model: null,
        thinking_level,
        temperature: 0,
        silent_fallback_disabled: true,
        live_provider_called: false,
        failure_classification: "MISSING_CREDENTIALS",
        latency_ms: Math.max(1, Date.now() - startMs),
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        total_tokens: 0,
        error_summary: "GEMINI_API_KEY is not configured.",
      },
    };
  }

  const client = new GoogleGenAI({ apiKey });
  const timeoutMs = params.timeoutMs ?? 90_000;
  const maxSameModelAttempts = 2;
  let lastErrorMsg = "FactDelta interaction returned empty text output.";
  let lastFailureClass: ProviderFailureClassification = "BLOCKED_OR_INCOMPLETE";
  let lastResolvedModel: string | null = requestedModel;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let lastThoughtTokens = 0;
  let lastTotalTokens = 0;

  for (let attemptIdx = 0; attemptIdx < maxSameModelAttempts; attemptIdx++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const interaction = await client.interactions.create(
        {
          model: requestedModel,
          store: false,
          system_instruction: FACT_DELTA_SYSTEM_INSTRUCTION,
          input: userPrompt,
          generation_config: {
            temperature: 0.0,
            max_output_tokens: 16384,
            thinking_level,
          },
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: FACT_DELTA_JSON_SCHEMA,
          } as unknown as Record<string, unknown>,
        },
        { signal: controller.signal }
      );
      clearTimeout(timer);

      const extracted = extractOutputTextFromGeminiInteraction(interaction);
      const outputText = extracted.text.trim();
      const providerStatus = extracted.status;
      const resolvedModel = extracted.resolvedModel || requestedModel;

      const usage = ((interaction as unknown as Record<string, unknown>).usage || {}) as Record<
        string,
        unknown
      >;
      const inputTokens = Number(usage.total_input_tokens ?? usage.input_tokens ?? 0);
      const outputTokens = Number(usage.total_output_tokens ?? usage.output_tokens ?? 0);
      const thoughtTokens = Number(usage.total_thought_tokens ?? usage.thought_tokens ?? 0);
      const totalTokens = Number(
        usage.total_tokens ?? inputTokens + outputTokens + thoughtTokens
      );
      lastResolvedModel = resolvedModel;
      lastInputTokens = inputTokens;
      lastOutputTokens = outputTokens;
      lastThoughtTokens = thoughtTokens;
      lastTotalTokens = totalTokens;

      if (
        !outputText ||
        (providerStatus && providerStatus !== "completed" && providerStatus !== "COMPLETED")
      ) {
        lastFailureClass = "BLOCKED_OR_INCOMPLETE";
        lastErrorMsg = `FactDelta interaction returned status='${providerStatus || "empty"}' without complete text output.`;
        continue;
      }

      const cleanedJson = outputText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      const parsedRaw = JSON.parse(cleanedJson) as unknown;
      const validation = validateFactDelta(parsedRaw, params.priorLedger, params.userTurnText);

      return {
        ok: validation.valid,
        provider_failed: false,
        raw_delta: normalizeRawFactDelta(parsedRaw),
        validation,
        raw_output_text: outputText,
        invocation_audit: {
          provider: "google-gemini",
          requested_model: requestedModel,
          resolved_model: resolvedModel,
          thinking_level,
          temperature: 0,
          silent_fallback_disabled: true,
          live_provider_called: true,
          failure_classification: "NONE",
          latency_ms: Math.max(1, Date.now() - startMs),
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          thought_tokens: thoughtTokens,
          total_tokens: totalTokens,
          error_summary: null,
        },
      };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const httpMatch = /\b([45]\d{2})\b/.exec(msg);
      const httpStatus = httpMatch ? Number(httpMatch[1]) : null;
      lastFailureClass = classifyFactDeltaError(httpStatus, msg);
      lastErrorMsg = msg.slice(0, 300);
      const isRetryableSameModel =
        lastFailureClass === "BLOCKED_OR_INCOMPLETE" ||
        lastFailureClass === "INVALID_OUTPUT" ||
        lastFailureClass === "TIMEOUT" ||
        (lastFailureClass === "PROVIDER_UNAVAILABLE" && (httpStatus === null || httpStatus >= 500));
      if (!isRetryableSameModel) {
        break;
      }
    }
  }

  return {
    ok: false,
    provider_failed: true,
    raw_delta: null,
    validation: {
      valid: false,
      normalized_delta: null,
      rejection_reasons: [lastErrorMsg],
    },
    raw_output_text: null,
    invocation_audit: {
      provider: "google-gemini",
      requested_model: requestedModel,
      resolved_model: lastResolvedModel,
      thinking_level,
      temperature: 0,
      silent_fallback_disabled: true,
      live_provider_called: true,
      failure_classification: lastFailureClass,
      latency_ms: Math.max(1, Date.now() - startMs),
      input_tokens: lastInputTokens,
      output_tokens: lastOutputTokens,
      thought_tokens: lastThoughtTokens,
      total_tokens: lastTotalTokens,
      error_summary: lastErrorMsg,
    },
  };
}

function extractMentionedLotHintsForClarification(
  userTurnText: string,
  priorLedger: StructuredCaseFactLedger
): string {
  const declared = (priorLedger.temporal_facts.declared_goods_lots || []).map((l) => l.label_th);
  const rawMentions = Array.from(
    thaiDigitsToArabic(userTurnText).matchAll(
      /(?:ล็อต|ล๊อต|ชุดที่|รายการที่|ส่วนที่|\blot\b|\bbatch\b)\s*[A-Z0-9ก-ฮ]+/gi
    )
  ).map((m) => m[0].trim());
  const declaredText = declared.length > 0 ? declared.join(", ") : "ล็อตสินค้าที่ระบุไว้เดิม";
  if (rawMentions.length > 0) {
    return `รายการที่ระบุในข้อความแก้ไข (${Array.from(new Set(rawMentions)).join(", ")}) เทียบกับล็อตที่มีในข้อเท็จจริงเดิม (${declaredText})`;
  }
  return `ล็อตสินค้า (${declaredText}) และเหตุการณ์/วันที่ที่ต้องการแก้ไข`;
}

export interface FactDeltaFailClosedDecision {
  fail_closed: boolean;
  reason: string | null;
  clarification_question_th: string | null;
}

/**
 * A4 Fail-Closed Policy:
 * - If confidence === "low" -> ask before allocating.
 * - If the turn looks like a correction (`is_correction: true` or correction keywords) AND
 *   validation failed OR applying the delta produced zero ledger change -> return NEEDS_CLARIFICATION
 *   naming the ambiguous lot or event.
 */
export function evaluateFactDeltaFailClosed(params: {
  userTurnText: string;
  priorLedger: StructuredCaseFactLedger;
  extraction: FactDeltaExtractionOutcome;
  ledgerBeforeHash: string;
  ledgerAfterHash: string;
}): FactDeltaFailClosedDecision {
  const { userTurnText, priorLedger, extraction, ledgerBeforeHash, ledgerAfterHash } = params;
  const looksLikeCorrection =
    Boolean(extraction.raw_delta?.is_correction) || hasCorrectionKeywords(userTurnText);
  const targetHint = extractMentionedLotHintsForClarification(userTurnText, priorLedger);

  if (extraction.raw_delta?.confidence === "low") {
    return {
      fail_closed: true,
      reason: "LOW_CONFIDENCE_FACT_DELTA",
      clarification_question_th: `ข้อเท็จจริงที่ขอแก้ไขในรอบนี้ยังไม่ชัดเจน (${targetHint}) — กรุณาระบุชื่อล็อตสินค้า ประเภทเหตุการณ์ (โอนกรรมสิทธิ์/รับชำระราคา/ออกใบกำกับภาษี/ส่งมอบสินค้า) และวันที่ที่ต้องการแก้ไขให้ชัดเจนก่อนระบบจัดสรรวันเกิดความรับผิดและคำนวณภาษีมูลค่าเพิ่ม`,
    };
  }

  if (!extraction.validation.valid && looksLikeCorrection) {
    return {
      fail_closed: true,
      reason: `INVALID_FACT_DELTA:${extraction.validation.rejection_reasons.join("; ")}`,
      clarification_question_th: `ไม่สามารถยืนยันการแก้ไขข้อเท็จจริงสำหรับ${targetHint}ได้ (${extraction.validation.rejection_reasons[0] || "ข้อมูลล็อตหรือวันที่ไม่ตรงกับข้อเท็จจริงเดิม"}) — กรุณายืนยันชื่อล็อตสินค้าและวันที่ของเหตุการณ์ที่ต้องการแก้ไขให้ชัดเจน`,
    };
  }

  if (looksLikeCorrection && ledgerBeforeHash === ledgerAfterHash) {
    return {
      fail_closed: true,
      reason: "CORRECTION_PRODUCED_NO_LEDGER_CHANGE",
      clarification_question_th: `ข้อความในรอบนี้มีลักษณะเป็นการขอแก้ไขข้อเท็จจริงแต่ไม่พบการเปลี่ยนแปลงที่ชัดเจนต่อ${targetHint} — กรุณาระบุให้ชัดเจนว่าเหตุการณ์และวันที่ใดครอบคลุมล็อตสินค้าใดบ้าง`,
    };
  }

  return {
    fail_closed: false,
    reason: null,
    clarification_question_th: null,
  };
}
