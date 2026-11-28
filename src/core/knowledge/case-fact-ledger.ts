/**
 * REG24 — Structured Case Fact Ledger (Requirement 1.1: Preserve Case Facts)
 *
 * Preserves the user's exact original facts alongside normalized legal categories without
 * substituting template nouns (e.g., a condo stays "ห้องชุด" while classified as immovable
 * property; an explicit nephew stays "หลานชาย" and never becomes "หลานสาว").
 *
 * Tracks:
 * - Turn-by-turn fact attribution (`source_turn`) from user turns only (never assistant prose)
 * - Explicit follow-up overrides (`overrides`) when a later turn changes a party, asset, place, or date
 * - Clean slate on a new question (empty `conversation_history` -> zero carried dates or facts)
 * - Three-way date distinction: transaction/event dates vs. legal as-of date vs. controlling tax point
 */

import type { ConversationTurnInput } from "./contracts";
import type { FactDelta, FactDeltaAuditRecord } from "./fact-delta";
import { sha256Bytes, thaiDigitsToArabic } from "./identity";
import { stripNegatedFactualClauses } from "./legal-issue-fact-analyzer";
import { parseFlexibleThaiOrEnglishDateToIso } from "./temporal-versioning";

export type TemporalEventKind =
  | "REGISTRATION"
  | "OWNERSHIP_TRANSFER"
  | "DELIVERY"
  | "TRANSFER"
  | "INVOICE"
  | "PAYMENT"
  | "SERVICE_USE"
  | "ACCOUNTING_PERIOD_START"
  | "QUESTION_DATE"
  | "STATED_TRANSACTION_DATE";

export type EventPortionCoverageScope = "FULL" | "PARTIAL" | "UNSTATED";

export type TemporalEventStatus = "ACTUAL" | "PLANNED" | "NEGATED" | "UNCERTAIN";

export interface DeclaredGoodsLot {
  lot_id: string;
  label_th: string;
  amount_thb: number;
  source_turn: number;
}

export interface NonOccurringTemporalClause {
  raw_date: string;
  iso_date: string;
  status: Exclude<TemporalEventStatus, "ACTUAL">;
  provenance_clause_th: string;
  source_turn: number;
}

export interface PreservedMaterialFact {
  fact_key: string;
  label_th: string;
  original_text_th: string;
  normalized_category: string;
  source_turn: number;
  overridden_from?: {
    previous_text_th: string;
    previous_category: string;
    previous_turn: number;
  } | null;
}

export interface PreservedTemporalEvent {
  event_type: TemporalEventKind;
  raw_text: string;
  iso_date: string;
  source_turn: number;
  /** Distinguishes actual occurring events from planned, negated, or uncertain references. */
  event_status?: TemporalEventStatus;
  /** Verbatim local clause provenance from the user's turn that anchored this event. */
  provenance_clause_th?: string;
  amount_thb?: number | null;
  /** Explicit portion coverage attached to this event (`FULL`, `PARTIAL`, or `UNSTATED`). */
  portion_coverage?: EventPortionCoverageScope;
  /** Identified goods lot(s) covered by this event (e.g. `["LOT_A"]`, `["LOT_A", "LOT_B", "LOT_C"]`). */
  covered_lot_ids?: string[];
  /** Lots explicitly negated/excluded in this clause (e.g. `"(ไม่ใช่ล็อต B)"` -> `["LOT_B"]`). */
  explicitly_excluded_lot_ids?: string[];
  covered_goods_label_th?: string;
  is_explicit_same_goods_repeat?: boolean;
  is_explicit_distinct_goods?: boolean;
  is_settlement_of_prior_invoice?: boolean;
  has_remaining_balance_marker?: boolean;
  /** Candidate 8/9: physical delivery of goods (`ส่งมอบสินค้า` / `ส่งของ`), Revenue Code §78(1). */
  is_goods_delivery?: boolean;
}

export const VAT_RATE_VERIFIED_COVERAGE_START_ISO = "2023-10-01";

export interface GoodsLotAllocationItem {
  lot_id: string;
  label_th: string;
  taxable_base_thb: number;
  controlling_tax_point_iso: string;
  controlling_raw_date_th: string;
  controlling_event_type: TemporalEventKind;
  statutory_subclause_th: string;
  decree_window: string;
  governing_decree_work_id: string | null;
  within_verified_coverage: boolean;
  provenance_clause_th: string;
  verified_rate_pct: number | null;
  verified_vat_thb: number | null;
  verified_gross_thb: number | null;
  subsequent_non_taxable_events: Array<{
    event_type: TemporalEventKind;
    iso_date: string;
    raw_text: string;
    provenance_clause_th: string;
    reason_th: string;
  }>;
}

export interface SplitPaymentTaxPointItem {
  portion_index: number;
  iso_date: string;
  raw_text: string;
  event_type: TemporalEventKind;
  decree_window: string;
  within_verified_coverage: boolean;
  governing_decree_work_id: string | null;
  expired_or_non_governing_work_ids: string[];
  amount_thb?: number | null;
  settled_payment_date_iso?: string | null;
  lot_ids?: string[];
  lot_labels_th?: string[];
  verified_rate_pct?: number | null;
  verified_vat_thb?: number | null;
  verified_gross_thb?: number | null;
  governing_version_id?: string | null;
  official_passage_ids?: string[];
}

export interface VerifiedGoodsVatAllocationRecord {
  transaction_base_thb: number;
  allocation_status: "RESOLVED" | "AMBIGUOUS_OVERLAP" | "AMBIGUOUS_COVERAGE";
  ambiguity_question_th: string | null;
  lot_allocations: GoodsLotAllocationItem[];
  tax_date_buckets: SplitPaymentTaxPointItem[];
  reconciled_total_base_thb: number;
  reconciled_total_vat_thb: number | null;
  reconciled_total_gross_thb: number | null;
  remaining_unallocated_base_thb: number;
  /** C12 B3: Deterministic hash of the ledger state that produced this allocation record. */
  ledger_after_hash?: string | null;
}

export interface StructuredCaseFactLedger {
  turn_count: number;
  is_new_conversation: boolean;
  user_turns: Array<{
    turn_number: number;
    raw_text: string;
    cleaned_active_text: string;
    explicit_applicable_date: string | null;
  }>;
  material_facts: PreservedMaterialFact[];
  overrides: Array<{
    fact_key: string;
    from_text_th: string;
    from_turn: number;
    to_text_th: string;
    to_turn: number;
  }>;
  temporal_facts: {
    transaction_or_event_dates: PreservedTemporalEvent[];
    legal_as_of_date: string | null;
    declared_goods_lots?: DeclaredGoodsLot[];
    non_occurring_or_negated_events?: NonOccurringTemporalClause[];
    vat_portion_allocation_record?: VerifiedGoodsVatAllocationRecord;
    split_payment_tax_points?: SplitPaymentTaxPointItem[];
    controlling_tax_point: {
      iso_date: string | null;
      controlling_event: string | null;
      statutory_rule_hint: string | null;
      is_ambiguous: boolean;
      ambiguity_reason_th: string | null;
      is_split_payment_multi_tax_point?: boolean;
    };
  };
  explicitly_unknown_facts_th: string[];
  questions_asked_th: string[];
  fact_preservation_guards: {
    asset_original_noun_th: string | null;
    forbid_land_substitution: boolean;
    recipient_original_noun_th: string | null;
    forbid_niece_substitution: boolean;
    recipient_kinship_category: string | null;
    is_ambiguous_lan_sao: boolean;
  };
  /** C12 A3/B3: Deterministic hash of canonical ledger state (declared lots, active events, allocation). */
  ledger_state_hash?: string;
  /** C12 A3: Audit record of structured FactDelta applied on follow-up turns (`turn >= 2`). */
  fact_delta_audit?: FactDeltaAuditRecord | null;
}

const THAI_MONTH_REGEX_SRC =
  "(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.)";

function extractNearestClauseAmountThb(clauseText: string): number | null {
  const norm = thaiDigitsToArabic(clauseText);
  const matches: Array<{ idx: number; val: number }> = [];
  for (const m of norm.matchAll(
    /(?:(?:THB|฿)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)|([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท))/gi
  )) {
    const rawNum = (m[1] || m[2] || "").replace(/,/g, "");
    const n = Number(rawNum);
    if (!Number.isFinite(n) || n <= 0) continue;
    const thb = m[3] === "ล้านบาท" ? n * 1_000_000 : n;
    matches.push({ idx: m.index ?? 0, val: thb });
  }
  if (matches.length === 0) return null;
  // Prefer the amount closest to the date (the last amount appearing in the local clause before the date)
  return matches[matches.length - 1].val;
}

function extractLocalClauseBeforeDate(norm: string, dateStartIdx: number): string {
  const rawWindow = norm
    .slice(Math.max(0, dateStartIdx - 90), dateStartIdx)
    // Strip negated/comparative pre-clauses like "โดยไม่มีการใช้บริการก่อนออกใบกำกับภาษีหรือรับชำระเงิน"
    .replace(/(?:โดย)?ไม่(?:มีการ|ได้)?(?:ใช้(?:ผล(?:ของ)?)?บริการ|ออกใบกำกับภาษี|รับชำระเงิน)[^,.]{0,45}?(?=\s+(?:บริษัท|ลูกค้า|ผู้|ต่อมา|แต่)|$)/gi, " ");
  // Trim at the most recent clause boundary (NEVER cut on a thousands-separator comma like 40,000!)
  const boundaryRe =
    /(?:ต่อมา|และ(?:ชำระ|รับชำระ|ได้รับชำระ|จ่าย|ออก)|and\s+(?:receives?|paid|pays?)|[.;]|,(?!\d)|แต่(?:ลูกค้า|ผู้ซื้อ|ผู้รับ)|(?:บริษัท|ลูกค้า|ผู้ให้บริการ|ผู้ประกอบการ|ผู้ซื้อ|ผู้รับบริการ)(?=\s*(?:ออกใบกำกับ|ชำระ|รับชำระ|จ่าย|ได้รับชำระ)))/gi;
  let lastCut = 0;
  for (const m of rawWindow.matchAll(boundaryRe)) {
    const pos = m.index ?? 0;
    // Only cut if there is meaningful text after the boundary
    if (rawWindow.length - pos >= 12) {
      lastCut = pos;
    }
  }
  return rawWindow.slice(lastCut);
}

function lastRegexMatchIndex(text: string, re: RegExp): number {
  const gRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let last = -1;
  for (const m of text.matchAll(gRe)) {
    if (typeof m.index === "number") last = m.index;
  }
  return last;
}

function extractEventKindSpanAndCoverage(params: {
  kind: TemporalEventKind;
  effectiveClause: string;
  postQualifier: string;
}): {
  amountThb: number | null;
  coverage: EventPortionCoverageScope;
} {
  const { kind, effectiveClause, postQualifier } = params;
  const verbRe =
    kind === "OWNERSHIP_TRANSFER"
      ? /(?:โอนกรรมสิทธิ์|กรรมสิทธิ์|(?:full\s+|partial\s+)?(?:ownership|title)|transfer(?:s|red)?\s+(?:full\s+|partial\s+)?(?:ownership|title))/i
      : kind === "INVOICE"
        ? /(?:ออกใบกำกับภาษี|ออกใบกำกับ|ออกใบแจ้งหนี้|issue(?:d|s)?\s+(?:a\s+|an\s+|the\s+)?(?:partial\s+|full\s+|initial\s+)?(?:tax\s+)?invoice|\binvoiced\b)/i
        : kind === "PAYMENT"
          ? /(?:ได้รับชำระ|รับชำระ|รับเงิน|แบ่งชำระ|แบ่งจ่าย|ชำระเงิน|ชำระค่าบริการ|ชำระค่า|ชำระงวด|ชำระส่วนที่เหลือ|ชำระบางส่วน|ชำระ(?:เมื่อ|วันที่|ในวันที่|ราคา)|จ่ายเงิน|จ่ายงวด|โอนเงิน(?:ล่วงหน้า|มัดจำ|ค่าสินค้า|ชำระ)|receiv(?:e|ed|es)|paid\b|payment(?:s)?\s+of|(?:and\s+)?(?:THB|฿)\s*[0-9,]+)/i
          : kind === "DELIVERY"
            ? /(?:ส่งมอบสินค้า|ส่งมอบของ|ส่งของ|ส่งสินค้า(?!ออก)|ส่งมอบ(?!บริการ)|\bdeliver(?:y|ed|s)?)/i
            : null;

  let subClause = effectiveClause;
  if (verbRe) {
    const firstMatch = effectiveClause.match(verbRe);
    const lastIdx = lastRegexMatchIndex(effectiveClause, verbRe);
    const anchorIdx =
      kind === "OWNERSHIP_TRANSFER"
        ? (firstMatch?.index ?? lastIdx)
        : lastIdx;
    if (anchorIdx >= 0) {
      subClause = effectiveClause.slice(anchorIdx);
    }
  }
  const combinedSpan = `${subClause} ${postQualifier}`.trim();
  const hasExplicitUnstated =
    /(?:ไม่(?:ได้)?ระบุ(?:ว่า)?(?:โอนกรรมสิทธิ์|ชำระ|ออกใบกำกับภาษี|ครอบคลุม)?(?:ทั้งหมด|เต็มจำนวน|บางส่วน|สัดส่วน|มูลค่า|จำนวน)|ไม่ทราบ(?:ว่า|มูลค่า|สัดส่วน|จำนวน)|ยังไม่ชัดเจนว่า(?:ทั้งหมด|เต็มจำนวน|บางส่วน)|without\s+stating\s+(?:whether|if|how\s+much|the\s+portion)|coverage\s+(?:is\s+)?(?:not\s+stated|unstated|unknown|unclear))/i.test(
      combinedSpan
    );
  if (hasExplicitUnstated) {
    return { amountThb: null, coverage: "UNSTATED" };
  }

  const preDateAmount = extractNearestClauseAmountThb(subClause);
  const amountThb =
    preDateAmount !== null
      ? preDateAmount
      : kind === "PAYMENT"
        ? extractNearestClauseAmountThb(combinedSpan) ??
          (/^\s*(?:and\s+)?(?:THB|฿)\s*[0-9,]+/i.test(effectiveClause)
            ? extractNearestClauseAmountThb(effectiveClause)
            : null)
        : extractNearestClauseAmountThb(combinedSpan);

  const hasExplicitPartial =
    /(?:บางส่วน|เฉพาะส่วน|เฉพาะบางรายการ|บางรายการ|ส่วนหนึ่ง|ส่วนแรก|ล็อตแรก|งวดแรก|มัดจำ|บางงวด|partial(?:ly)?|part\s+of\s+(?:the\s+)?goods|first\s+(?:lot|batch|portion|installment))/i.test(
      combinedSpan
    );
  if (hasExplicitPartial) {
    return { amountThb, coverage: "PARTIAL" };
  }

  const nonGoodsTotalBoilerplateRe =
    /(?:ส่วน)?(?:ข้อเท็จจริง|เงื่อนไข|รายละเอียด|ข้อมูล|ประเด็น)อื่น(?:ๆ)?\s*ทั้งหมด(?:\s*(?:เหมือนเดิม|คงเดิม|ไม่เปลี่ยน(?:แปลง)?))?/gi;
  const combinedSpanForCoverage = combinedSpan.replace(nonGoodsTotalBoilerplateRe, " ");

  const hasExplicitFull =
    /(?:ทั้งหมด|ทั้งจำนวน|ครบทั้งจำนวน|เต็มจำนวน|เต็มราคา|เต็มมูลค่า|ราคาทั้งหมด|ทั้งรายการ|ทั้งล็อต|ทั้งสัญญา|ทั้งก้อน|ครบถ้วน|100\s*%|ร้อยละ\s*100|(?:สินค้า|เครื่องจักร|รถยนต์|อุปกรณ์)(?:คัน|เครื่อง|ชิ้น|รายการ)(?:นั้น|ดังกล่าว)|full\s+(?:ownership|title|payment|price|amount|tax\s+invoice|invoice)|entire\s+(?:goods|shipment|order|lot|amount|price)|all\s+(?:of\s+)?(?:the\s+)?goods)/i.test(
      combinedSpanForCoverage
    );
  if (hasExplicitFull) {
    return { amountThb, coverage: "FULL" };
  }

  return { amountThb, coverage: "UNSTATED" };
}

function canonicalizeLotId(token: string): string {
  return `LOT_${thaiDigitsToArabic(token).trim().toUpperCase()}`;
}

function extractDeclaredGoodsLots(
  cleanedText: string,
  turnNumber: number
): DeclaredGoodsLot[] {
  const norm = thaiDigitsToArabic(cleanedText);
  const found = new Map<string, DeclaredGoodsLot>();
  // Matches structured goods lot/batch/tranche/set/item declarations such as:
  // "ล็อต A มูลค่า 20,000 บาท", "ชุดที่ 1 ราคา 20,000 บาท", "Lot A (THB 20,000)", "รายการที่ 2 จำนวน 10,000 บาท"
  // Deliberately excludes service installments (`งวดที่ 1`) and count phrases (`แบ่งเป็น 3 ล็อต`).
  const lotDeclRe =
    /(?:สินค้า\s*)?(ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|ส่วนที่|lot|set|batch|tranche|item)\s*([A-Z](?![A-Za-z0-9])|[1-9][0-9]?(?![0-9])|[ก-ฮ](?=\s*(?:มูลค่า|ราคา|จำนวน|เป็นเงิน|\(|:)))\s*(?:\(\s*)?(?:มูลค่า|ราคา|จำนวน|เป็นเงิน|valued\s+at|worth|:)?\s*(?:THB|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท|THB)?/gi;

  for (const m of norm.matchAll(lotDeclRe)) {
    const prefix = (m[1] || "").trim();
    const tok = (m[2] || "").trim();
    const rawNum = (m[3] || "").replace(/,/g, "");
    const unit = (m[4] || "").trim();
    // Require explicit currency/value cue when prefix is generic `ส่วนที่`
    const fullSpan = m[0];
    if (
      /^ส่วนที่$/i.test(prefix) &&
      !/(?:มูลค่า|ราคา|จำนวน|เป็นเงิน|บาท|THB|฿)/i.test(fullSpan)
    ) {
      continue;
    }
    if (!unit && !/(?:THB|฿|มูลค่า|ราคา)/i.test(fullSpan)) continue;
    const n = Number(rawNum);
    if (!Number.isFinite(n) || n <= 0) continue;
    const amountThb = unit === "ล้านบาท" ? n * 1_000_000 : n;
    const lotId = canonicalizeLotId(tok);
    if (!found.has(lotId)) {
      found.set(lotId, {
        lot_id: lotId,
        label_th: `${prefix} ${tok}`.replace(/\s+/g, " ").trim(),
        amount_thb: amountThb,
        source_turn: turnNumber,
      });
    }
  }
  const list = Array.from(found.values());
  return list.length >= 2 ? list : [];
}

function extractLotReferencesFromClause(
  clauseText: string,
  declaredLots: DeclaredGoodsLot[]
): {
  coveredLotIds: string[];
  excludedLotIds: string[];
  coversAllLots: boolean;
  isExplicitSameGoodsRepeat: boolean;
  isExplicitDistinctGoods: boolean;
} {
  const norm = thaiDigitsToArabic(clauseText);
  const declaredIds = new Set(declaredLots.map((l) => l.lot_id));
  const excludedSet = new Set<string>();

  const lotUnitTok = "(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|ส่วนที่|lot|set|batch|tranche|item)";
  const negatedLotSpanRe = new RegExp(
    `(?:ไม่ใช่|มิใช่|ไม่รวม(?:ถึง)?|ยกเว้น|\\bnot\\b|\\bexcluding\\b|\\bother\\s+than\\b)\\s*(?:สินค้า\\s*)?${lotUnitTok}\\s*([A-Z](?![A-Za-z0-9])|[1-9][0-9]?(?![0-9])|[ก-ฮ](?=\\s|$|[.,()]))(?:\\s*(?:,|\\/|และ|หรือ|\\bor\\b|\\band\\b)\\s*(?:สินค้า\\s*)?(?:${lotUnitTok}\\s*)?([A-Z](?![A-Za-z0-9])|[1-9][0-9]?(?![0-9])|[ก-ฮ](?=\\s|$|[.,()])))*`,
    "gi"
  );
  let positiveSpan = norm;
  for (const nm of norm.matchAll(negatedLotSpanRe)) {
    const subLotRe = /(?:^|[\s,\/(])(?:(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|ส่วนที่|lot|set|batch|tranche|item)\s*)?([A-Z](?![A-Za-z0-9])|[1-9][0-9]?(?![0-9])|[ก-ฮ](?=\s|$|[.,()]))/gi;
    for (const sm of nm[0].matchAll(subLotRe)) {
      const lid = canonicalizeLotId(sm[1]);
      if (declaredIds.size === 0 || declaredIds.has(lid)) {
        excludedSet.add(lid);
      }
    }
  }
  positiveSpan = positiveSpan.replace(negatedLotSpanRe, " ");

  const isExplicitSameGoodsRepeat =
    /(?:เดิมอีกครั้ง|เดิมซ้ำ|ส่วนเดียวกัน|ล็อตเดียวกัน|ชุดเดียวกัน|รายการเดียวกัน|สินค้าเดิม|สำหรับ(?:ล็อต|ชุดที่|รายการที่)\s*[A-Z0-9ก-ฮ]+\s*เดิม|same\s+(?:lot|goods|portion|batch))/i.test(
      norm
    );
  const isExplicitDistinctGoods =
    /(?:โดยเฉพาะ|แยกต่างหาก|คนละส่วน|คนละล็อต|คนละชุด|คนละรายการ|สินค้าอีกส่วน|อีกส่วนหนึ่ง|separate\s+(?:lot|goods|portion)|distinct\s+(?:lot|goods|portion)|another\s+(?:lot|portion))/i.test(
      norm
    );

  if (declaredLots.length === 0) {
    return {
      coveredLotIds: [],
      excludedLotIds: Array.from(excludedSet),
      coversAllLots: false,
      isExplicitSameGoodsRepeat,
      isExplicitDistinctGoods,
    };
  }

  const positiveSpanNoBoilerplate = positiveSpan
    .replace(
      /(?:ส่วน)?(?:ข้อเท็จจริง|เงื่อนไข|รายละเอียด|ข้อมูล|ประเด็น|เหตุการณ์)อื่น(?:ๆ)?\s*ทั้งหมด(?:\s*(?:เหมือนเดิม|คงเดิม|ไม่เปลี่ยน(?:แปลง)?))?/gi,
      " "
    )
    .replace(
      /(?:เหมือนเดิม|คงเดิม|ไม่เปลี่ยน(?:แปลง)?)\s*ทั้งหมด/gi,
      " "
    )
    // Strip preservation clauses (e.g. "โดยล็อต A และล็อต B รวมถึงข้อเท็จจริงอื่นทั้งหมดเหมือนเดิม")
    // so unchanged sibling lots cited for preservation are NEVER added to the modified event's covered lots!
    .replace(
      /(?:โดย|ส่วน|ซึ่ง)?\s*(?:สำหรับ\s*)?(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ)\s*[A-Z0-9ก-ฮ]+(?:(?:\s*(?:,|และ|กับ|รวมถึง|รวมทั้ง)\s*(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ)?\s*[A-Z0-9ก-ฮ]+)*)(?:\s*(?:รวมถึง|รวมทั้ง|และ)?\s*(?:ข้อเท็จจริง|เงื่อนไข|รายละเอียด|เหตุการณ์)อื่น(?:ๆ)?(?:\s*ทั้งหมด)?)?\s*(?:ยัง)?(?:เหมือนเดิม|คงเดิม|ไม่เปลี่ยน(?:แปลง)?)/gi,
      " "
    );

  // Strip negated lot-event subclauses inside a clause (e.g. "โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C",
  // "โดยล็อต B และล็อต C ไม่มีการโอนกรรมสิทธิ์") and record those lots as excluded rather than covered!
  const negatedSubclausePatterns = [
    /(?:โดย|ซึ่ง|แต่|ส่วน)?\s*(?:ยังไม่มี|ไม่มี|ยังไม่ได้|ไม่ได้|มิได้|ไม่เคย)\s*(?:เหตุการณ์(?:ใด)?|การกระทำ(?:ใด)?|การ)?[^.;\n]{0,60}?(?:ของ|สำหรับ)?\s*(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|lot|set|item)\s*[A-Z0-9ก-ฮ]+(?:\s*(?:,|และ|หรือ|กับ|\band\b|\bor\b)\s*(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|lot|set|item)?\s*[A-Z0-9ก-ฮ]+)*/gi,
    /(?:โดย|ซึ่ง|แต่|ส่วน)?\s*(?:สำหรับ\s*)?(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|lot|set|item)\s*[A-Z0-9ก-ฮ]+(?:\s*(?:,|และ|หรือ|กับ|\band\b|\bor\b)\s*(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|lot|set|item)?\s*[A-Z0-9ก-ฮ]+)*\s*(?:ยังไม่มี|ไม่มี|ยังไม่ได้|ไม่ได้|มิได้|ไม่เคย|ยังไม่)/gi,
    /\bno\s+(?:prior\s+|earlier\s+)?(?:event|events|act|acts|transfer|payment|invoice|tax\s+invoice)[^.;\n]{0,60}?\bfor\s+(?:lot|set|item)\s*[A-Z0-9]+(?:\s*(?:,|and|or)\s*(?:lot|set|item)?\s*[A-Z0-9]+)*/gi,
  ];
  let positiveSpanOnly = positiveSpanNoBoilerplate;
  const lotMentionRe =
    /(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|ส่วนที่|lot|set|batch|tranche|item)\s*([A-Z](?![A-Za-z0-9])|[1-9][0-9]?(?![0-9])|[ก-ฮ](?=\s|$|[.,()]))/gi;
  for (const negPat of negatedSubclausePatterns) {
    for (const nm of positiveSpanOnly.matchAll(negPat)) {
      for (const lm of nm[0].matchAll(lotMentionRe)) {
        const lid = canonicalizeLotId(lm[1]);
        if (declaredIds.has(lid)) {
          excludedSet.add(lid);
        }
      }
    }
    positiveSpanOnly = positiveSpanOnly.replace(negPat, " ");
  }

  const covered: string[] = [];
  for (const lm of positiveSpanOnly.matchAll(lotMentionRe)) {
    const lid = canonicalizeLotId(lm[1]);
    if (declaredIds.has(lid) && !excludedSet.has(lid) && !covered.includes(lid)) {
      covered.push(lid);
    }
  }

  const explicitCollectiveAllLots =
    /(?:ทั้ง\s*[0-9]+\s*(?:ล็อต|ล๊อต|ชุด|รายการ)|ทั้ง(?:สอง|สาม|สี่|ห้า)\s*(?:ล็อต|ล๊อต|ชุด|รายการ)|ทุกล็อต|ทุกชุด|ทุกรายการ|สินค้าทั้งหมด|\ball\s+(?:[0-9]+\s+)?(?:lots?|sets?|batches?|items?|goods))/i.test(
      positiveSpanOnly
    );
  const coversAllLots =
    explicitCollectiveAllLots ||
    (covered.length === 0 && /(?:ทั้งหมด|ทั้งจำนวน)/i.test(positiveSpanOnly));
  if (coversAllLots) {
    return {
      coveredLotIds: declaredLots
        .map((l) => l.lot_id)
        .filter((id) => !excludedSet.has(id)),
      excludedLotIds: Array.from(excludedSet),
      coversAllLots: true,
      isExplicitSameGoodsRepeat,
      isExplicitDistinctGoods,
    };
  }

  return {
    coveredLotIds: covered,
    excludedLotIds: Array.from(excludedSet),
    coversAllLots: false,
    isExplicitSameGoodsRepeat,
    isExplicitDistinctGoods,
  };
}

function extractDatesWithEventKinds(
  cleanedText: string,
  turnNumber: number,
  options?: {
    isImmovableTurn?: boolean;
    declaredLots?: DeclaredGoodsLot[];
    nonOccurringOut?: NonOccurringTemporalClause[];
  }
): PreservedTemporalEvent[] {
  const norm = thaiDigitsToArabic(cleanedText);
  const events: PreservedTemporalEvent[] = [];
  const seen = new Set<string>();
  const declaredLots = options?.declaredLots || [];
  const declaredLotById = new Map(declaredLots.map((l) => [l.lot_id, l]));

  // Candidate 8: agreed Thai short-year policy — a 2-digit year directly after a Thai month name/abbreviation
  // (optionally `พ.ศ.`) is B.E. 25xx only within 40..79 and never when the digits continue as an amount, rate,
  // count, or slash/dot number (`5 พ.ย. 50,000 บาท`). Ambiguous numeric slash dates are deliberately NOT parsed here.
  const datePattern = new RegExp(
    `(\\d{1,2}\\s*${THAI_MONTH_REGEX_SRC}\\s*(?:พ\\.ศ\\.\\s*)?(?:\\d{4}|[4-7]\\d(?![0-9]|\\s*(?:[,./][0-9]|%|บาท|ล้าน|แสน|หมื่น|พัน|ร้อย|เปอร์เซ็นต์|วัน|เดือน|ปี|คน|ราย|ฉบับ|ข้อ|เท่า|หุ้น|แห่ง|แปลง)))|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?\\s+\\d{4})`,
    "gi"
  );

  const dateMatches: Array<{ rawDate: string; iso: string; idx: number; endIdx: number }> = [];
  for (const m of norm.matchAll(datePattern)) {
    const rawDate = m[1].trim();
    const iso = parseFlexibleThaiOrEnglishDateToIso(rawDate);
    if (!iso) continue;
    const idx = m.index ?? 0;
    dateMatches.push({ rawDate, iso, idx, endIdx: idx + m[1].length });
  }

  const coBoundaryRe =
    /(?:[.;]|ทั้งนี้|ต่อมา|จากนั้น|ภายหลัง(?:จากนั้น)?|หลังจากนั้น|และ(?:ใน)?วันเดียวกัน|,\s*and\s+on\s+the\s+same\s+day|\band\s+on\s+the\s+same\s+day|(?<=บาท\)?\s+)(?=(?:(?:โอนกรรมสิทธิ์|ส่งมอบ|รับชำระ|ได้รับชำระ|ชำระ|ออกใบกำกับ)[^\n]{0,20}(?:ล็อต|ล๊อต|ชุดที่|รายการที่|lot)|(?:ล็อต|ล๊อต|ชุดที่|รายการที่|lot)\s*[A-Z1-9ก-ฮ]+\s*(?:โอนกรรมสิทธิ์|ส่งมอบ|รับชำระ|ได้รับชำระ|ชำระ|ออกใบกำกับ)))|(?<![ก-๙])ส่วน(?=\s*(?:การ|ในส่วน|เหตุการณ์|ที่เหลือ|ล็อต|ล๊อต|ชุด|รายการ|สินค้า|สำหรับ|ของ))|แต่(?=\s*(?:ต่อมา|การ|ส่งมอบ|โอนกรรมสิทธิ์|รับชำระ|ชำระ|ออกใบกำกับ|ผู้|ลูกค้า|บริษัท|ยัง|ในวันที่|เมื่อวันที่|เลื่อน))|โดย(?=\s*(?:สำหรับ|ยังไม่มี|ไม่มี|ยังไม่ได้|ยังมิได้|ไม่ได้|มิได้|ไม่เคย|โอนกรรมสิทธิ์|มีการโอนกรรมสิทธิ์|การส่งมอบ|ส่งมอบ|รับชำระ|ชำระ|ออกใบกำกับ|จดทะเบียน|บริษัท|ผู้))|และ(?=\s*สำหรับ\s*(?:ล็อต|ล๊อต|ชุด|รายการ))|เดิม(?=\s*(?:มีแผน|วางแผน|กำหนด|ตกลง))|\((?=\s*(?:สินค้า|ไม่|ยัง|ส่วน|ล็อต|ชุด|รายการ|no\s+early|no\s+prior))|(?:บริษัท|ลูกค้า|ผู้ให้บริการ|ผู้ประกอบการ|ผู้ขาย|ผู้ซื้อ|ผู้รับบริการ)(?=\s*(?:ออกใบกำกับ|แบ่งชำระ|แบ่งจ่าย|ชำระ|รับชำระ|จ่าย|ได้รับชำระ|โอนกรรมสิทธิ์|ส่งมอบ)))/gi;

  for (let k = 0; k < dateMatches.length; k++) {
    const { rawDate, iso, idx, endIdx } = dateMatches[k];
    const prevEndIdx = k > 0 ? dateMatches[k - 1].endIdx : 0;
    const nextStartIdx = k + 1 < dateMatches.length ? dateMatches[k + 1].idx : norm.length;

    const leftCtx = norm.slice(Math.max(0, idx - 65), idx);
    const localClause = extractLocalClauseBeforeDate(norm, idx);
    const rightCtx = norm.slice(endIdx, Math.min(norm.length, endIdx + 45));
    const ctx = `${leftCtx} ${rightCtx}`;

    const rawPreSegment = norm.slice(Math.max(prevEndIdx, idx - 190), idx);
    const rawPostSegment = norm.slice(endIdx, Math.min(nextStartIdx, endIdx + 170));

    let lastCoCut = 0;
    for (const bm of rawPreSegment.matchAll(coBoundaryRe)) {
      const pos = bm.index ?? 0;
      if (rawPreSegment.length - pos >= 8) {
        // Do NOT strip a directly preceding lot/portion topic introducer (e.g. "ส่วนล็อต A บริษัทโอนกรรมสิทธิ์...")
        // when the boundary hit is a bare actor subject noun (`บริษัท|ผู้ขาย|...`)!
        const hitText = bm[0] || "";
        const isActorNounBoundary =
          /^(?:บริษัท|ลูกค้า|ผู้ให้บริการ|ผู้ประกอบการ|ผู้ขาย|ผู้ซื้อ|ผู้รับบริการ)$/.test(hitText);
        if (isActorNounBoundary) {
          const betweenPrevCutAndActor = rawPreSegment.slice(lastCoCut, pos).trim();
          const isTopicIntroducerOnly =
            betweenPrevCutAndActor.length <= 45 &&
            /^(?:ส่วน|สำหรับ|กรณี)\s*(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ)\s*[A-Z0-9ก-ฮ]+/.test(
              betweenPrevCutAndActor
            ) &&
            !/(?:แบ่งเป็น|มูลค่า|ราคา|บาท|โอนกรรมสิทธิ์|ส่งมอบ|รับชำระ|ชำระ|ออกใบกำกับ|ใช้(?:ผล(?:ของ)?)?บริการ|ไม่มี|ไม่ได้|มิได้)/.test(
              betweenPrevCutAndActor
            );
          if (isTopicIntroducerOnly) {
            continue;
          }
        }
        lastCoCut = pos;
      }
    }
    const rawCoClause = rawPreSegment.slice(lastCoCut);

    // Candidate 10 (DEF-C9-3) & Candidate 11 (DEF-C10-3): Negated / boundary-only date suppression!
    // Apply negation to the WHOLE clause: dates that only serve as a boundary for negated events
    // (e.g. "โดยไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ ก่อนวันที่ 1 ตุลาคม 2569",
    //  "โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569",
    //  "ก่อนวันที่ 1 ตุลาคม 2569 ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ",
    //  "no payment or invoice before 1 October 2026") are NEVER positive VAT events on `iso`!
    const immediatePreDate = norm.slice(Math.max(prevEndIdx, idx - 34), idx);
    const hasBeforeDeliveryDayDateCue =
      /ก่อนวันส่งมอบ(?:สินค้า)?วันที่\s*$/.test(immediatePreDate);
    const hasBoundaryPrepositionBeforeDate =
      !hasBeforeDeliveryDayDateCue &&
      /(?:ก่อนหน้า(?:วันที่|วัน)?|ในหรือก่อน(?:วันที่|วัน)?|ก่อน(?:วันที่|วัน)?|จนถึงก่อน(?:วันที่|วัน)?|\b(?:on\s+or\s+before|prior\s+to|before))\s*$/i.test(
        immediatePreDate
      );
    const hasPreDateNegationCue =
      /(?:ยังไม่มี(?:การ|เหตุการณ์|การกระทำ|ใบกำกับ|การชำระ|การโอน|การส่งมอบ)|ไม่มี(?:การ|เหตุการณ์|การกระทำ|ใบกำกับ|การชำระ|การโอน|การส่งมอบ)|ยังไม่ได้(?:มีการ)?|ยังมิได้(?:มีการ)?|ไม่ได้(?:มีการ)?|มิได้(?:มีการ)?|ไม่เคย(?:มีการ)?|ปราศจากการ|\bno\s+(?:prior\s+|earlier\s+|early\s+)?(?:event|events|act|acts|payment|invoice|tax\s+invoice|ownership|title|transfer|delivery)|\bwithout\s+(?:any\s+)?(?:prior\s+|earlier\s+|early\s+)?(?:event|events|act|acts|payment|invoice|ownership|title|transfer)|\b(?:did|had|has)\s+not\b|\bnever\b)/i.test(
        rawCoClause
      );
    const postBeforeClauseBreak = rawPostSegment
      .split(
        /(?:โดย(?:บริษัท|ผู้|โอน|ส่งมอบ|ออก|รับชำระ)|แต่|ต่อมา|จากนั้น|ส่วน(?:การ|เหตุการณ์|ล็อต|ล๊อต|ชุด|รายการ|สินค้า)|วันเกิด|ต้องใช้|ต้องเรียกเก็บ|ต้องคิด|คิดเป็น|เสียภาษี|[.;?])/
      )[0]
      .trim();
    const hasPostDateNegationCue =
      /^(?:นั้น\s*)?(?:(?:ทาง)?(?:บริษัท|ผู้ขาย|ผู้ประกอบการ|ลูกค้า|ผู้ซื้อ|คู่สัญญา|ทั้งนี้)\s*)?(?:ยังไม่มี(?:การ|เหตุการณ์|การกระทำ)|ไม่มี(?:การ|เหตุการณ์|การกระทำ)|ยังไม่ได้|ยังมิได้|ไม่ได้|มิได้|ยังไม่|ไม่เคย|there\s+(?:was|were|is|are)\s+no\b|no\s+(?:event|events|act|acts|payment|invoice|tax\s+invoice|ownership|title|transfer|delivery)|(?:did|had|has)\s+not\b)/i.test(
        postBeforeClauseBreak
      );
    const positiveWhenTailMatch =
      /^\s*,?\s*(?:when|on\s+which(?:\s+date)?|ซึ่ง(?:มีการ)?|อันเป็นวันที่)\s+([^.;?]{6,140})/i.exec(
        rawPostSegment
      );
    if (hasBoundaryPrepositionBeforeDate && (hasPreDateNegationCue || hasPostDateNegationCue)) {
      options?.nonOccurringOut?.push({
        raw_date: rawDate,
        iso_date: iso,
        status: "NEGATED",
        provenance_clause_th: `${rawCoClause.trim()} ${rawDate} ${hasPostDateNegationCue ? postBeforeClauseBreak : ""}`
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180),
        source_turn: turnNumber,
      });
      if (!positiveWhenTailMatch) {
        continue;
      }
    }

    const postQualifier = rawPostSegment
      .split(
        /(?:(?<=เท่านั้น)\s+|(?<![ก-๙])ส่วน(?:การ|เหตุการณ์|ที่เหลือ|สินค้าที่เหลือ|ล็อต|ล๊อต|ชุด|รายการ|สำหรับ|ของ)|ทั้งนี้|ต่อมา|จากนั้น|และ(?:ใน)?วันเดียวกัน|,\s*and\s+on\s+the\s+same\s+day|\band\s+on\s+the\s+same\s+day|และ(?:ต่อมา|ส่งมอบ|รับชำระ|ชำระ|ออกใบกำกับ|โอนกรรมสิทธิ์|งวด|ส่วน|อีก|สำหรับ\s*(?:ล็อต|ล๊อต|ชุด|รายการ))(?!.*ในวันเดียวกัน)|\band\s+(?:receiv|pay|paid|deliver|issu|transfer)|,\s*(?:and\s+|then\s+)?(?:receiv|pay|paid|deliver|payment\b|tax\s+invoice\b)|แต่|โดย(?:ยัง)?ไม่มี|โดย(?:สำหรับ\s*)?(?:ล็อต|ล๊อต|ชุด|รายการ|ส่วนที่เหลือ|สินค้าส่วนที่เหลือ)[^\n]{0,55}?(?:(?:ยัง)?ไม่มี|เหมือนเดิม|คงเดิม|ไม่เปลี่ยน)|ซึ่ง(?:ยัง)?ไม่มี|วันเกิด|ต้องใช้|ต้องเรียกเก็บ|ต้องคิด|คิดเป็น|เสียภาษี|[?;.])/i
      )[0]
      .trim();
    const postSameDayClause = rawPostSegment
      .split(
        /(?:(?<=เท่านั้น)\s+|โดย(?:ยัง)?ไม่มี|โดย(?:สำหรับ\s*)?(?:ล็อต|ล๊อต|ชุด|รายการ|ส่วนที่เหลือ|สินค้าส่วนที่เหลือ)[^\n]{0,55}?(?:(?:ยัง)?ไม่มี|เหมือนเดิม|คงเดิม|ไม่เปลี่ยน)|ซึ่ง(?:ยัง)?ไม่มี|ทั้งนี้|แต่|ต่อมา|จากนั้น|และ(?:ใน)?วันเดียวกัน(?=\s*\()|,\s*and\s+on\s+the\s+same\s+day|\band\s+on\s+the\s+same\s+day|(?<![ก-๙])ส่วน(?:การ|เหตุการณ์|ที่เหลือ|สินค้าที่เหลือ|ล็อต|ล๊อต|ชุด|รายการ|สำหรับ|ของ)|และ\s*สำหรับ\s*(?:ล็อต|ล๊อต|ชุด|รายการ)|วันเกิด|ต้องใช้|ต้องเรียกเก็บ|ต้องคิด|คิดเป็น|เสียภาษี|[?;.])/i
      )[0]
      .trim();

    // Candidate 9 (§78(1)(a)): distinguish actual ownership transfer from a planned future transfer
    // or a transfer that did NOT occur on this date (never crossing a trailing `โดยไม่มี...` clause!).
    const hasPlannedTitleMarker =
      /(?:มีแผน(?:ที่จะ|จะ)?|วางแผน(?:ที่จะ|จะ)?|คาดว่าจะ|ตั้งใจ(?:ที่จะ|จะ)?|เดิมกำหนด(?:ให้|ไว้|ว่าจะ)?|กำหนด(?:การ)?(?:ไว้)?(?:ว่า)?จะ|ตกลง(?:กัน)?ไว้(?:ก่อน)?ว่าจะ|เลื่อน(?:การ|วัน)?โอนกรรมสิทธิ์จาก(?:เดิม)?|(?:plan(?:ned|s)?|schedul(?:ed|es)|intend(?:ed|s)?|postponed)\s+to\s+transfer\s+(?:ownership|title)|(?:planned|scheduled|intended)\s+(?:ownership|title)\s+transfer)/i.test(
        rawCoClause
      ) ||
      (/(?:จะโอนกรรมสิทธิ์|will\s+transfer\s+(?:ownership|title))/i.test(rawCoClause) &&
        /^\s*(?:\([^)]*\)\s*)?(?:แต่|ทว่า|ซึ่ง|ปรากฏว่า|however|but)\s*(?:ยังไม่ได้|ยังมิได้|ไม่ได้|มิได้|เลื่อน|ยกเลิก|ไม่มีการ|did\s+not|was\s+postponed)/i.test(
          rawPostSegment
        ));
    const hasNegatedTitleMarker =
      /(?:ยังไม่ได้|ยังมิได้|ไม่ได้|มิได้|ยังไม่มีการ|ไม่มีการ|ยังไม่|สงวนกรรมสิทธิ์(?:ไว้)?(?:โดยยังไม่)?)\s*(?:มีการ)?โอนกรรมสิทธิ์|(?:did\s+not|has\s+not|had\s+not|without|no)\s+(?:transfer(?:red|ring)?\s+(?:ownership|title)|(?:ownership|title)\s+transfer)/i.test(
        `${rawCoClause} ${postSameDayClause}`
      );
    const suppressOwnershipTransfer = hasPlannedTitleMarker || hasNegatedTitleMarker;

    // Strip whole coordinated negated/planned clauses (including chained verbs like
    // "ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ"), terminating cleanly after the final
    // `หรือ`/`และ <verb>` item so a subsequent positive clause (`ออกใบกำกับภาษีวันที่ 20 กันยายน 2568`) is never eaten!
    const negVerbAtom =
      "(?:ใช้(?:ผล(?:ของ)?)?บริการ(?:ก่อน(?:ออกใบกำกับ(?:ภาษี)?|รับชำระ(?:เงิน|ราคา)?))?|โอนกรรมสิทธิ์(?:ในสินค้า|สินค้า)?|ส่งมอบ(?:สินค้า)?|ออกใบกำกับ(?:ภาษี)?|รับชำระ(?:เงิน|ราคา)?|ชำระ(?:เงิน|ราคา)?)";
    const coClauseCleaned = rawCoClause.replace(
      new RegExp(
        `(?:โดย)?(?:ยังไม่มีการ|ไม่มีการ|ยังไม่ได้|ยังมิได้|ไม่ได้|มิได้|ไม่เคย|ยังไม่|มีแผน(?:ที่จะ|จะ)?|วางแผน(?:ที่จะ|จะ)?|กำหนด(?:การ)?(?:ไว้)?(?:ว่า)?จะ|เลื่อน(?:การ|วัน)?)\\s*(?:มีการ)?${negVerbAtom}(?:(?:\\s*,?\\s*${negVerbAtom})*\\s*(?:หรือ|และ)\\s*${negVerbAtom})?(?:\\s*ใดๆ)?(?:\\s*ก่อน(?:หน้า)?(?:นั้น)?)?`,
        "gi"
      ),
      " "
    );
    if (
      suppressOwnershipTransfer &&
      !/(?:จดทะเบียน|ส่งมอบ|ส่งของ|ส่งสินค้า|ได้รับชำระ|รับชำระ|รับเงิน|ชำระเงิน|ชำระค่า|จ่ายเงิน|โอนเงิน|ออกใบกำกับ|ใช้(?:ผล(?:ของ)?)?บริการ|นำผล(?:ของ)?บริการ(?:ไป|มา)ใช้|ใช้ผล(?:ของ)?งาน|\bdeliver|\binvoic|\bpaid|\bpayment|\breceiv|\bused\s+the\s+service)/i.test(
        `${coClauseCleaned} ${postSameDayClause}`
      )
    ) {
      options?.nonOccurringOut?.push({
        raw_date: rawDate,
        iso_date: iso,
        status: hasPlannedTitleMarker ? "PLANNED" : "NEGATED",
        provenance_clause_th: `${rawCoClause.trim()} ${rawDate}`.replace(/\s+/g, " ").trim().slice(0, 180),
        source_turn: turnNumber,
      });
      continue;
    }

    // Strip undated VAT-registrant / marital status phrases (even if left-sliced at rawPreSegment boundary!)
    // BEFORE checking whether a dated verb exists before the date or classifying REGISTRATION.
    const stripStatusRegistrationPhrases = (s: string) =>
      s.replace(
        /(?:(?:ผู้ประกอบการ|บริษัทที่)?จดทะเบียน(?:ภาษีมูลค่าเพิ่ม|\s*VAT)|สามีภริยาที่จดทะเบียนสมรส|จดทะเบียนสมรส)/gi,
        " "
      );
    const coClauseForPreVerb = stripStatusRegistrationPhrases(coClauseCleaned);
    const hasPreDateVerb =
      /(?:โอนกรรมสิทธิ์|จดทะเบียน|ส่งมอบ|ส่งของ|ส่งสินค้า|ได้รับชำระ|รับชำระ|รับเงิน|แบ่งชำระ|แบ่งจ่าย|ชำระเงิน|ชำระค่า|ชำระงวด|ชำระส่วนที่เหลือ|ชำระบางส่วน|ชำระ(?:เมื่อ|วันที่|ในวันที่|ราคา)|จ่ายเงิน|จ่ายงวด|โอนเงิน|ออกใบกำกับ|ใช้(?:ผล(?:ของ)?)?บริการ|นำผล(?:ของ)?บริการ(?:ไป|มา)ใช้|ใช้ผล(?:ของ)?งาน|งวดแรก|งวดที่\s*[0-9]+|งวดที่(?:หนึ่ง|สอง|สาม|สี่)|\bdeliver|\binvoic|\bpaid|\bpayment|\breceiv|\bownership|\btitle|\binstallment|\bused\s+the\s+service)/i.test(
        coClauseForPreVerb
      );
    const postQualHasLotAssignment =
      declaredLots.length >= 2 &&
      extractLotReferencesFromClause(coClauseForPreVerb, declaredLots).coveredLotIds.length === 0 &&
      extractLotReferencesFromClause(postQualifier, declaredLots).coveredLotIds.length > 0;
    const postDeliveryIsUndatedOrNonGoods =
      /(?:ไม่(?:ได้)?ระบุวัน(?:ที่)?ส่งมอบ|โดยไม่ระบุวัน(?:ที่)?ส่งมอบ|ส่งมอบ(?:ซอฟต์แวร์|งาน|รายงาน|เอกสาร|ไฟล์|ผลงาน|ผล(?:ของ)?บริการ)|ส่งมอบ[^\n.;,]{0,30}(?:ทางออนไลน์|ทางอีเมล|ออนไลน์|อีเมล)|undated\s+delivery|delivery\s+date\s+(?:is\s+)?(?:not\s+stated|unknown|unspecified))/i.test(
        postSameDayClause
      );
    const includePostSameDay =
      (!hasPreDateVerb && postSameDayClause.length > 0) ||
      postQualHasLotAssignment ||
      /(?:ในวันเดียวกัน|วันเดียวกันนั้น|พร้อมกันในวันนั้น|on\s+the\s+same\s+day)/i.test(postSameDayClause) ||
      (!postDeliveryIsUndatedOrNonGoods &&
        /^(?:พร้อม(?:กับ|ทั้ง)?|และพร้อมกันนั้น)\s*(?:โอนกรรมสิทธิ์|ส่งมอบ(?:สินค้า|ของ)|ส่งของ|รับชำระ|ชำระ|ออกใบกำกับ)/.test(
          postSameDayClause
        ));
    // When the action verb appears strictly AFTER the date (`เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์ในล็อต A...`),
    // NEVER concatenate verb-less pre-date preamble text (such as a multi-lot declaration schedule) into `effectiveClause`!
    const effectiveClause =
      hasBeforeDeliveryDayDateCue
        ? "ส่งมอบสินค้าทั้งหมด"
        : hasBoundaryPrepositionBeforeDate && hasPreDateNegationCue && positiveWhenTailMatch
          ? positiveWhenTailMatch[1].trim()
        : !hasPreDateVerb && postSameDayClause.length > 0
          ? postSameDayClause
          : postQualHasLotAssignment && !/(?:ในวันเดียวกัน|วันเดียวกันนั้น|พร้อมกันในวันนั้น|on\s+the\s+same\s+day)/i.test(postSameDayClause)
            ? `${coClauseCleaned} ${postQualifier}`.trim()
            : includePostSameDay
              ? `${coClauseCleaned} ${postSameDayClause}`.trim()
              : coClauseCleaned.trim();

    // If the entire effective clause is purely negated after stripping coordinated negations (e.g. "วันที่ 1 ต.ค. ยังไม่มีการรับชำระเงินหรือออกใบกำกับภาษี"), skip!
    if (
      (hasPreDateNegationCue || hasPostDateNegationCue) &&
      !/(?:โอนกรรมสิทธิ์|จดทะเบียน|ส่งมอบ|ส่งของ|ส่งสินค้า|ได้รับชำระ|รับชำระ|รับเงิน|แบ่งชำระ|แบ่งจ่าย|ชำระเงิน|ชำระค่า|ชำระงวด|จ่ายเงิน|จ่ายงวด|โอนเงิน|ออกใบกำกับ|ใช้(?:ผล(?:ของ)?)?บริการ|นำผล(?:ของ)?บริการ(?:ไป|มา)ใช้|ใช้ผล(?:ของ)?งาน|\bdeliver|\binvoic|\bpaid|\bpayment|\breceiv|\bownership|\btitle|\bused\s+the\s+service)/i.test(
        effectiveClause.replace(
          /(?:ยังไม่มีการ|ไม่มีการ|ยังไม่ได้|ยังมิได้|ไม่ได้|มิได้|ไม่เคย|ยังไม่)\s*(?:มีการ)?(?:ใช้(?:ผล(?:ของ)?)?บริการ|โอนกรรมสิทธิ์(?:ในสินค้า|สินค้า)?|ส่งมอบ(?:สินค้า)?|ออกใบกำกับ(?:ภาษี)?|รับชำระ(?:เงิน|ราคา)?|ชำระ(?:เงิน|ราคา)?)(?:(?:\s*(?:,|หรือ|และ)?\s*(?:โอนกรรมสิทธิ์(?:ในสินค้า|สินค้า)?|ส่งมอบ(?:สินค้า)?|ออกใบกำกับ(?:ภาษี)?|รับชำระ(?:เงิน|ราคา)?|ชำระ(?:เงิน|ราคา)?|ใช้(?:ผล(?:ของ)?)?บริการ|ใดๆ))*)/gi,
          " "
        )
      )
    ) {
      options?.nonOccurringOut?.push({
        raw_date: rawDate,
        iso_date: iso,
        status: "NEGATED",
        provenance_clause_th: `${rawCoClause.trim()} ${rawDate} ${postSameDayClause}`.replace(/\s+/g, " ").trim().slice(0, 180),
        source_turn: turnNumber,
      });
      continue;
    }

    // If a single date match covers >=2 distinct declared lots with separate actions (e.g.
    // "เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์ในล็อต A ให้แก่ผู้ซื้อ และได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต B โดยเฉพาะ"),
    // split into per-action sub-clauses so each distinct lot retains its own exact event type and amount!
    const topLotRefs = extractLotReferencesFromClause(effectiveClause, declaredLots);
    const actionSubClauses: string[] =
      declaredLots.length >= 2 &&
      !topLotRefs.coversAllLots &&
      topLotRefs.coveredLotIds.length >= 2
        ? effectiveClause
            .split(
              /(?:\s+และ(?:ในวันเดียวกัน)?(?:\s*(?:บริษัท|ผู้ขาย|ผู้ประกอบการ))?(?=\s*(?:ได้รับชำระ|รับชำระ|ชำระ|ออกใบกำกับ|โอนกรรมสิทธิ์|ส่งมอบ))|\s*,\s*(?:and\s+)?(?=(?:receiv|paid|issu|transfer|deliver|payment\b|tax\s+invoice\b)))/i
            )
            .map((s) => s.trim())
            .filter((s) => s.length >= 6)
        : [effectiveClause];

    const invoiceIssuanceRe =
      /(?:ออกใบกำกับภาษี(?!ไว้แล้ว)|ออกใบกำกับ(?!ภาษีไว้แล้ว)|ออกใบแจ้งหนี้|issue(?:d|s)?\s+(?:a\s+|an\s+|the\s+)?(?:partial\s+|full\s+|initial\s+)?(?:tax\s+)?invoice|(?:tax\s+)?invoice\s+(?:is|was|are|were)\s+issued|payment\s+(?:and|plus)\s+(?:a\s+)?tax\s+invoice|\binvoiced\b)/i;
    const paymentVerbRe =
      /(?:ได้รับชำระ|รับชำระ|รับเงิน|แบ่งชำระ|แบ่งจ่าย|ชำระเงิน|ชำระค่าบริการ|ชำระค่า|ชำระงวด|ชำระส่วนที่เหลือ|ชำระบางส่วน|ชำระ(?:เมื่อ|วันที่|ในวันที่|ราคา)|จ่ายเงิน|จ่ายงวด|โอนเงิน(?:ล่วงหน้า|มัดจำ|ค่าสินค้า|ชำระ)|receiv(?:e|ed|es)\s+(?:two\s+equal\s+|equal\s+|the\s+remaining\s+|partial\s+|final\s+|first\s+|second\s+|full\s+)?(?:payment(?:s)?|installment(?:s)?|THB|฿)|(?:full\s+)?payment(?:\s+(?:of|is|was|plus|and))?\b|paid\b)/i;
    const deliveryVerbRe =
      /(?:ส่งมอบสินค้า|ส่งมอบของ|ส่งของ|ส่งสินค้า(?!ออก)|ส่งมอบ(?!บริการ)|\bdeliver(?:y|ed|s)?(?:\s+of)?(?:\s+(?:the\s+|all\s+)?(?:[0-9]+\s+)?(?:goods|lots?|sets?|items?))?\b)/i;
    const actualOwnershipTransferRe =
      /(?:โอนกรรมสิทธิ์|กรรมสิทธิ์(?:ในสินค้า|ของสินค้า|ในทรัพย์สินที่ขาย|สินค้า)?(?:ได้)?(?:โอน|ตกเป็นของ|เปลี่ยนมือ)|ผู้ซื้อได้(?:รับ)?กรรมสิทธิ์|(?:full\s+|partial\s+)?(?:ownership|title)(?:\s+(?:in|to|of)\s+[^\n,.;]{1,35})?\s+(?:transfers?|transferred|passes?|passed)|transfer(?:s|red)?\s+(?:full\s+|partial\s+)?(?:ownership|title))/i;

    for (const subClauseRaw of actionSubClauses) {
      // Strip relative comparators (`ก่อนส่งมอบสินค้า`, `ก่อนรับชำระเงิน`, `prior to delivery`) before verb detection
      // so an early event described as occurring "before delivery/payment" never emits the comparator event on this date!
      const verbCheckClause = subClauseRaw
        .replace(
          /(?:ก่อน|หลัง(?:จาก)?|แทนการ)\s*(?:การ|วัน)?(?:ส่งมอบ(?:สินค้า|ของ|บริการ)?|โอนกรรมสิทธิ์(?:ในสินค้า|สินค้า)?|รับชำระ(?:เงิน|ราคา|ค่าบริการ|ค่าสินค้า)?|ชำระ(?:เงิน|ราคา|ค่าบริการ|ค่าสินค้า)?|ออกใบกำกับ(?:ภาษี)?|ใช้(?:ผล(?:ของ)?)?บริการ)/gi,
          " "
        )
        .replace(
          /\b(?:before|prior\s+to|after|ahead\s+of)\s+(?:deliver(?:y|ing)|transfer(?:ring)?\s+(?:ownership|title)|payment|paying|issuing\s+(?:a\s+|the\s+)?(?:tax\s+)?invoice|invoicing)/gi,
          " "
        );

      const isInvoiceIssuance = invoiceIssuanceRe.test(verbCheckClause);
      const isPaymentVerb = paymentVerbRe.test(verbCheckClause);
      const isEnglishContinuedPayment =
        actionSubClauses.length === 1 &&
        !isInvoiceIssuance &&
        !isPaymentVerb &&
        ((/^\s*(?:and\s+)?(?:THB|฿)\s*[0-9,]+/i.test(rawPreSegment) &&
          /(?:receiv(?:e|ed|es)\s+.*payment|two\s+equal\s+payment|paid\b)/i.test(
            norm.slice(Math.max(0, idx - 140), idx)
          )) ||
          (/^\s*(?:กับอีก|และอีก)\s*[0-9,]+\s*บาท/.test(rawPreSegment) &&
            /(?:ได้รับชำระ|รับชำระ|ชำระเงิน|ชำระค่า|จ่ายเงิน)/.test(
              norm.slice(Math.max(0, idx - 140), idx)
            )));
      const isInstallmentPaymentHint =
        actionSubClauses.length === 1 &&
        !isInvoiceIssuance &&
        !deliveryVerbRe.test(verbCheckClause) &&
        !actualOwnershipTransferRe.test(verbCheckClause) &&
        /(?:มัดจำ|งวดแรก|งวดที่\s*[0-9]|งวดที่(?:หนึ่ง|สอง|สาม)|ส่วนที่เหลือ|แบ่งชำระ|แบ่งจ่าย|ชำระบางส่วน|remaining\s+(?:THB|฿|balance|amount))/i.test(
          localClause
        );
      const hasRemainingBalanceMarker = /(?:ส่วนที่เหลือ|ยอดคงเหลือ|remaining\s+(?:THB|฿|balance|amount|portion))/i.test(
        subClauseRaw
      );
      const isSettlementOfPriorInvoice =
        (isPaymentVerb || isEnglishContinuedPayment) &&
        /(?:ตามใบกำกับภาษี(?:ดังกล่าว|นั้น)?|ที่ออกใบกำกับภาษีไว้แล้ว|สำหรับใบกำกับภาษี(?:ดังกล่าว|นั้น)|บาทนั้น|จำนวนนั้น|of\s+that\s+(?:THB|฿)?\s*[0-9,]+|for\s+that\s+(?:tax\s+)?invoice)/i.test(
          subClauseRaw
        );

      const matchedKinds: TemporalEventKind[] = [];
      const registrationCheckClause = stripStatusRegistrationPhrases(verbCheckClause);
      const hasActualOwnershipTransfer =
        !suppressOwnershipTransfer && actualOwnershipTransferRe.test(verbCheckClause);
      if (hasActualOwnershipTransfer) {
        matchedKinds.push(options?.isImmovableTurn ? "REGISTRATION" : "OWNERSHIP_TRANSFER");
      } else if (/จดทะเบียน/.test(registrationCheckClause)) {
        matchedKinds.push("REGISTRATION");
      }

      // Strip undated delivery clauses before checking whether THIS date actually belongs to DELIVERY:
      // 1) Non-goods service deliverable wording ("ส่งมอบซอฟต์แวร์/รายงาน/งาน/เอกสาร/ไฟล์/ทางออนไลน์") is not goods DELIVERY.
      // 2) An undated delivery separated from a dated PAYMENT/INVOICE verb by "โดย", "แล้ว", ",", "ค่าบริการ", "มูลค่า"
      //    (e.g. "ส่งมอบสินค้าให้ผู้ซื้อแล้ว โดยออกใบกำกับภาษีและรับชำระราคาเมื่อวันที่ 30 กันยายน 2569") must remain undated,
      //    while explicitly dated goods delivery ("ส่งมอบสินค้าเมื่อวันที่ 29 ก.ย.", "ส่งมอบสินค้าและออกใบกำกับภาษีในวันที่ 5 พ.ย.") still binds DELIVERY!
      const deliveryCheckClause = verbCheckClause
        .replace(
          /(?:ส่งมอบ(?:ซอฟต์แวร์|งาน(?:ซอฟต์แวร์)?|รายงาน|เอกสาร|ไฟล์|ผลงาน|ผล(?:ของ)?บริการ)[^\n.;,]{0,40}|ส่งมอบ[^\n.;,]{0,30}(?:ทางออนไลน์|ทางอีเมล|ออนไลน์|อีเมล)|ส่งมอบ[^\n.;]{0,50}โดยไม่(?:ได้)?ระบุวัน(?:ที่)?ส่งมอบ)/gi,
          " "
        )
        .replace(
          /(?:ส่งมอบ(?:สินค้า|ของ)?|ส่งของ|ส่งสินค้า)[^\n.;]{0,45}(?:แล้ว\s*(?:โดย|ซึ่ง|,|และ)?|ให้(?:แก่)?(?:ลูกค้า|ผู้ซื้อ|ผู้ว่าจ้าง)[^\n.;]{0,35}(?:โดย|ซึ่ง|และต่อมา|ค่าบริการ|มูลค่า))(?=\s*(?:ได้รับชำระ|รับชำระ|ชำระ|ออกใบกำกับ|บริษัท(?:ได้รับชำระ|ออกใบกำกับ)))/gi,
          " "
        )
        .replace(
          /\bdeliver(?:y|ed|s)?(?:\s+of)?(?:\s+(?:the\s+)?(?:software|report|work|deliverables?|goods|items?))?(?:\s+online|\s+by\s+email|\s+already|\s+without\s+(?:a\s+)?(?:stated\s+)?date)?\s*(?:,|;|\bwhile\b|\bwhereas\b|\band\s+(?:payment|the\s+invoice)\b)(?=[^\n.;]{0,40}\b(?:paid|payment|invoic))/gi,
          " "
        );
      const isGoodsDelivery =
        !options?.isImmovableTurn &&
        deliveryVerbRe.test(deliveryCheckClause) &&
        !/ส่งออก/.test(deliveryCheckClause) &&
        !/ไม่(?:ได้)?ระบุวัน(?:ที่)?ส่งมอบ/.test(verbCheckClause);
      if (isGoodsDelivery) {
        matchedKinds.push("DELIVERY");
      }

      // Require positive evidence tying THIS date to a service-use event — NEVER fabricate a `SERVICE_USE`
      // date from an undated place-of-use clause (including foreign city offices like โตเกียว and Thai provincial branches).
      const serviceUseCheckClause = verbCheckClause
        .replace(
          /(?:ซึ่ง|โดย|ที่|และ)?\s*(?:ลูกค้า|ผู้รับบริการ|ผู้ว่าจ้าง|บริษัท)?\s*(?:ได้)?(?:มีการ)?ใช้(?:ผล(?:ของ)?)?บริการ(?:นั้น|ดังกล่าว)?(?:ทั้งหมด|บางส่วน|เพียงอย่างเดียว)?(?:ที่สำนักงาน|ที่สาขา)?(?:ใน(?:ประเทศไทย|ราชอาณาจักร|ต่างประเทศ|ประเทศ[ก-๙]+|สิงคโปร์|ญี่ปุ่น|โตเกียว|โอซาก้า|โซล|ลอนดอน|นิวยอร์ก|ซิดนีย์|ปารีส|ฮ่องกง|สหรัฐอเมริกา|ยุโรป|ออสเตรเลีย|มาเลเซีย|เวียดนาม|อังกฤษ|เยอรมนี|กรุงเทพ(?:มหานคร)?)|นอกราชอาณาจักร|ที่สาขา[ก-๙]+)(?:\s*(?:ทั้งหมด|เพียงอย่างเดียว|บางส่วน))?(?!\s*(?:เมื่อ|ใน|ตั้งแต่)?วันที่)/gi,
          " "
        )
        .replace(
          /\b(?:which\s+is\s+|that\s+is\s+)?(?:service\s+is\s+)?used\s+(?:entirely\s+|wholly\s+|exclusively\s+|partly\s+|partially\s+)?(?:in\s+thailand|abroad|overseas|outside\s+thailand|at\s+(?:the\s+)?[a-z\s]{2,25}(?:office|branch)|in\s+[a-z]+)(?!\s+on\b)/gi,
          " "
        );
      // Require positive evidence of ACTUAL service use tied to THIS date — handover/completion alone
      // ("ส่งมอบบริการ", "ส่งมอบงาน", "ให้บริการเสร็จ", "service performed/completed") is NOT actual service use under §78/1(1)!
      const hasExplicitDatedServiceUseVerb =
        /(?:เริ่มใช้(?:ผล(?:ของ)?)?บริการ|ใช้(?:ผล(?:ของ)?)?บริการ(?:จริง|ครั้งแรก)?\s*(?:เมื่อ|ใน|ตั้งแต่|ยังคงเป็น|เป็น|ตรงกับ)?\s*วันที่|นำผล(?:ของ)?บริการ(?:ไป|มา)ใช้(?:จริง)?\s*(?:เมื่อ|ใน|ตั้งแต่|ยังคงเป็น|เป็น|ตรงกับ)?\s*วันที่|began\s+using\s+the\s+service|started\s+using\s+the\s+service|service\s+(?:output\s+)?(?:was\s+)?used\s+on)/i.test(
          serviceUseCheckClause
        ) ||
        (!isPaymentVerb &&
          !isInvoiceIssuance &&
          /(?:ใช้(?:ผล(?:ของ)?)?บริการ|ใช้ผล(?:ของ)?งาน|used\s+the\s+service)/i.test(
            serviceUseCheckClause
          ));

      if (isSettlementOfPriorInvoice) {
        matchedKinds.push("PAYMENT");
      } else {
        if (
          isPaymentVerb ||
          isEnglishContinuedPayment ||
          (isInstallmentPaymentHint && !hasExplicitDatedServiceUseVerb)
        ) {
          matchedKinds.push("PAYMENT");
        }
        if (isInvoiceIssuance) {
          matchedKinds.push("INVOICE");
        }
      }
      if (hasExplicitDatedServiceUseVerb) {
        matchedKinds.push("SERVICE_USE");
      }
      if (/รอบระยะเวลาบัญชี|รอบบัญชี/.test(ctx)) {
        matchedKinds.push("ACCOUNTING_PERIOD_START");
      }
      if (/(?:ถามเมื่อ|วันที่ถาม|สอบถามเมื่อ|ณ\s*วันที่ถาม)/.test(verbCheckClause)) {
        matchedKinds.push("QUESTION_DATE");
      }
      if (matchedKinds.length === 0) {
        if (/(?:โอน|ยก|ให้(?!บริการ)|ขาย|ซื้อ)/.test(verbCheckClause) && !suppressOwnershipTransfer) {
          matchedKinds.push("TRANSFER");
        } else {
          matchedKinds.push("STATED_TRANSACTION_DATE");
        }
      }

      const subLotRefs = extractLotReferencesFromClause(subClauseRaw, declaredLots);
      const coveredLotIds = subLotRefs.coveredLotIds;
      const lotKey = coveredLotIds.length > 0 ? coveredLotIds.join(",") : "";
      const provenanceText = (
        actionSubClauses.length > 1
          ? `${subClauseRaw} (${rawDate})`
          : includePostSameDay && !hasPreDateVerb
            ? `${rawDate} ${postSameDayClause}`
            : `${rawCoClause.trim()} ${rawDate}`
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);

      for (const kind of matchedKinds) {
        const dedupKey = `${turnNumber}:${kind}:${iso}:${lotKey}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const extracted = extractEventKindSpanAndCoverage({
          kind,
          effectiveClause:
            actionSubClauses.length > 1
              ? subClauseRaw
              : includePostSameDay
                ? effectiveClause
                : verbCheckClause,
          postQualifier: actionSubClauses.length > 1 ? "" : postQualifier,
        });

        // Resolve exact covered amount & portion coverage from declared lots when lot IDs are matched!
        let resolvedAmountThb = extracted.amountThb;
        let resolvedCoverage = extracted.coverage;
        let coveredGoodsLabelTh: string | undefined = undefined;
        if (coveredLotIds.length > 0) {
          const matchedLots = coveredLotIds
            .map((id) => declaredLotById.get(id))
            .filter((l): l is DeclaredGoodsLot => Boolean(l));
          if (matchedLots.length > 0) {
            resolvedAmountThb = matchedLots.reduce((s, l) => s + l.amount_thb, 0);
            resolvedCoverage =
              subLotRefs.coversAllLots || matchedLots.length >= declaredLots.length
                ? "FULL"
                : "PARTIAL";
            coveredGoodsLabelTh = matchedLots.map((l) => l.label_th).join(" และ ");
          }
        }

        events.push({
          event_type: kind,
          raw_text: rawDate,
          iso_date: iso,
          source_turn: turnNumber,
          event_status: "ACTUAL",
          provenance_clause_th: provenanceText,
          ...(resolvedAmountThb !== null ? { amount_thb: resolvedAmountThb } : {}),
          ...(kind === "OWNERSHIP_TRANSFER" || kind === "PAYMENT" || kind === "INVOICE" || kind === "DELIVERY"
            ? { portion_coverage: resolvedCoverage }
            : {}),
          ...(coveredLotIds.length > 0 ? { covered_lot_ids: coveredLotIds } : {}),
          ...(subLotRefs.excludedLotIds.length > 0
            ? { explicitly_excluded_lot_ids: subLotRefs.excludedLotIds }
            : {}),
          ...(coveredGoodsLabelTh ? { covered_goods_label_th: coveredGoodsLabelTh } : {}),
          ...(subLotRefs.isExplicitSameGoodsRepeat ? { is_explicit_same_goods_repeat: true } : {}),
          ...(subLotRefs.isExplicitDistinctGoods ? { is_explicit_distinct_goods: true } : {}),
          ...(kind === "PAYMENT" && isSettlementOfPriorInvoice
            ? { is_settlement_of_prior_invoice: true }
            : {}),
          ...(kind === "PAYMENT" && hasRemainingBalanceMarker
            ? { has_remaining_balance_marker: true }
            : {}),
          ...(kind === "DELIVERY" || (isGoodsDelivery && kind !== "PAYMENT" && kind !== "INVOICE" && kind !== "OWNERSHIP_TRANSFER")
            ? { is_goods_delivery: true }
            : {}),
        });
      }
    }
  }

  return events;
}

function upsertFact(
  factsMap: Map<string, PreservedMaterialFact>,
  overrides: StructuredCaseFactLedger["overrides"],
  next: Omit<PreservedMaterialFact, "overridden_from">
): void {
  const existing = factsMap.get(next.fact_key);
  if (
    existing &&
    (existing.normalized_category !== next.normalized_category ||
      existing.original_text_th !== next.original_text_th)
  ) {
    if (existing.source_turn !== next.source_turn) {
      overrides.push({
        fact_key: next.fact_key,
        from_text_th: existing.original_text_th,
        from_turn: existing.source_turn,
        to_text_th: next.original_text_th,
        to_turn: next.source_turn,
      });
    }
    factsMap.set(next.fact_key, {
      ...next,
      overridden_from: {
        previous_text_th: existing.original_text_th,
        previous_category: existing.normalized_category,
        previous_turn: existing.source_turn,
      },
    });
    return;
  }
  factsMap.set(next.fact_key, { ...next, overridden_from: existing?.overridden_from ?? null });
}

function extractAmountsForTurn(
  cleanedText: string,
  turnNumber: number,
  factsMap: Map<string, PreservedMaterialFact>,
  overrides: StructuredCaseFactLedger["overrides"]
): void {
  const norm = thaiDigitsToArabic(cleanedText);
  const re =
    /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท)/g;

  for (const m of norm.matchAll(re)) {
    const rawSpan = m[0].trim();
    const numVal = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(numVal)) continue;
    const thb = m[2] === "ล้านบาท" ? numVal * 1_000_000 : numVal;
    const idx = m.index ?? 0;
    const leftCtx = norm.slice(Math.max(0, idx - 80), idx);
    const immediateLeft = norm.slice(Math.max(0, idx - 50), idx);

    if (/ราคาประเมินทุนทรัพย์|ราคาประเมิน(?:ของทางราชการ)?/.test(leftCtx)) {
      upsertFact(factsMap, overrides, {
        fact_key: "appraised_value_thb",
        label_th: "ราคาประเมินทุนทรัพย์ของทางราชการ",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `OFFICIAL_APPRAISED_VALUE_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else if (/หนังสือสัญญา|ระบุมูลค่า|ราคาซื้อขาย|ราคาตลาด|ตกลงกันว่า/.test(leftCtx)) {
      upsertFact(factsMap, overrides, {
        fact_key: "stated_deed_or_agreed_value_thb",
        label_th: "มูลค่าตามสัญญาหรือราคาที่ตกลงกัน (มิใช่ราคาประเมินทางราชการ)",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `STATED_OR_AGREED_VALUE_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else if (/ค่าบริการ|ค่าจ้าง|ค่าตอบแทน|ราคาสินค้า/.test(leftCtx)) {
      upsertFact(factsMap, overrides, {
        fact_key: "service_or_sale_consideration_thb",
        label_th: "มูลค่าค่าบริการหรือราคาขาย",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `CONSIDERATION_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else if (
      /(?:หักภาษี(?:\s*เงินได้)?\s*ณ\s*ที่จ่าย(?:ไว้)?|ภาษี(?:\s*เงินได้)?หัก\s*ณ\s*ที่จ่าย|เสียอากรแสตมป์(?:อีก)?|ปิดอากรแสตมป์|เสียภาษี(?:เงินได้|ขาย|มูลค่าเพิ่ม)?(?:อีก|เป็นเงิน|จำนวน)|ภาษีขาย(?:เป็นเงิน|จำนวน)?|เบี้ยปรับ|เงินเพิ่ม)[^,.;0-9]{0,20}$/.test(
        immediateLeft
      )
    ) {
      // Never let a disputed/claimed withholding-tax, stamp-duty, or surcharge figure overwrite the principal asset/gift value!
      const dutyOrTaxKey = /อากรแสตมป์|แสตมป์/.test(immediateLeft)
        ? "disputed_or_stated_stamp_duty_thb"
        : /หักภาษี|หัก\s*ณ\s*ที่จ่าย/.test(immediateLeft)
          ? "disputed_or_stated_wht_thb"
          : "disputed_or_stated_tax_thb";
      const dutyOrTaxLabel = /อากรแสตมป์|แสตมป์/.test(immediateLeft)
        ? "จำนวนอากรแสตมป์ที่กล่าวถึงในคำถาม (เพื่อตรวจสอบความถูกต้อง)"
        : /หักภาษี|หัก\s*ณ\s*ที่จ่าย/.test(immediateLeft)
          ? "จำนวนภาษีหัก ณ ที่จ่ายที่กล่าวถึงในคำถาม (เพื่อตรวจสอบความถูกต้อง)"
          : "จำนวนภาษีที่กล่าวถึงในคำถาม";
      upsertFact(factsMap, overrides, {
        fact_key: dutyOrTaxKey,
        label_th: dutyOrTaxLabel,
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `DISPUTED_OR_STATED_TAX_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    } else {
      // Within the SAME turn, do not let a secondary trailing figure overwrite an already-captured principal asset value
      // unless preceded by an explicit in-turn correction marker; cross-turn updates override normally.
      const existingAssetVal = factsMap.get("stated_asset_value_thb");
      const hasSameTurnCorrectionMarker = /(?:แก้ไข(?:เป็น)?|เปลี่ยน(?:เป็น)?|ที่ถูกต้องคือ|แทนจำนวนเดิม)/.test(
        immediateLeft
      );
      if (
        existingAssetVal &&
        existingAssetVal.source_turn === turnNumber &&
        !hasSameTurnCorrectionMarker
      ) {
        continue;
      }
      upsertFact(factsMap, overrides, {
        fact_key: "stated_asset_value_thb",
        label_th: "มูลค่าทรัพย์สินที่ระบุในข้อเท็จจริง",
        original_text_th: `${rawSpan} (${thb.toLocaleString("en-US")} บาท)`,
        normalized_category: `STATED_VALUE_THB_${Math.round(thb)}`,
        source_turn: turnNumber,
      });
    }
  }
}

export type VatServiceUseLocationCategory =
  | "SERVICE_USE_LOCATION_UNKNOWN"
  | "SERVICE_USED_MIXED_THAILAND_AND_ABROAD"
  | "SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN"
  | "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN"
  | "SERVICE_USED_IN_THAILAND_DOMESTIC"
  | "SERVICE_USED_ENTIRELY_ABROAD_EXPORT";

export interface ExtractedServiceUseLocation {
  category: VatServiceUseLocationCategory;
  original_text_th: string;
  stated_overseas_location?: string | null;
}

const OVERSEAS_LOCATION_TOKEN_SOURCE =
  "(?:ต่างประเทศ|นอกราชอาณาจักร|ประเทศ(?:สิงคโปร์|ญี่ปุ่น|ฮ่องกง|สหรัฐอเมริกา|อเมริกา|ออสเตรเลีย|มาเลเซีย|เวียดนาม|อังกฤษ|เยอรมนี|ฝรั่งเศส|เกาหลีใต้|จีน|ไต้หวัน|อินเดีย|อินโดนีเซีย|ฟิลิปปินส์|สวิตเซอร์แลนด์|เนเธอร์แลนด์|แคนาดา|นิวซีแลนด์)|สิงคโปร์|ญี่ปุ่น|ฮ่องกง|สหรัฐอเมริกา|ยุโรป|ออสเตรเลีย|มาเลเซีย|เวียดนาม|อังกฤษ|เยอรมนี|โตเกียว|โอซาก้า|โซล|ลอนดอน|นิวยอร์ก|ซิดนีย์|เมลเบิร์น|ปารีส|แฟรงก์เฟิร์ต|เซี่ยงไฮ้|ปักกิ่ง|ไทเป|กัวลาลัมเปอร์|โฮจิมินห์|ฮานอย|จาการ์ตา|มะนิลา|ซูริก|อัมสเตอร์ดัม|ดูไบ|มุมไบ|abroad|overseas|outside\\s+thailand|japan|tokyo|osaka|singapore|hong\\s+kong|usa|united\\s+states|new\\s+york|europe|london|uk|united\\s+kingdom|australia|sydney|melbourne|malaysia|kuala\\s+lumpur|vietnam|germany|frankfurt|france|paris|south\\s+korea|korea|seoul|china|shanghai|beijing|taiwan|taipei|india|dubai|zurich)";

const THAILAND_LOCATION_TOKEN_SOURCE =
  "(?:ประเทศไทย|ราชอาณาจักร|ไทย|กรุงเทพ(?:มหานคร)?|กทม\\.?|(?:จังหวัด|จ\\.)\\s*[ก-๙]{2,20}|(?:สำนักงาน(?:สาขา)?|สาขา)\\s*(?:เชียงใหม่|เชียงราย|ภูเก็ต|ชลบุรี|ระยอง|ขอนแก่น|นครราชสีมา|โคราช|หาดใหญ่|สงขลา|อุดรธานี|อุบลราชธานี|พิษณุโลก|สุราษฎร์ธานี|นครปฐม|นนทบุรี|ปทุมธานี|สมุทรปราการ|สมุทรสาคร|อยุธยา|พระนครศรีอยุธยา|พัทยา|หัวหิน|ลำปาง|ลำพูน|ตรัง|กระบี่|นครศรีธรรมราช|สระบุรี|ฉะเชิงเทรา|ปราจีนบุรี|ต่างจังหวัด|ในประเทศ(?:ไทย)?|ในจังหวัด[ก-๙]{2,20})|thailand|bangkok|chiang\\s+mai|phuket|chonburi|rayong|khon\\s+kaen|hat\\s+yai|songkhla|korat|pattaya|thai\\s+(?:provincial\\s+)?branch)";

const TH_USE_VERB_SRC =
  "(?:ใช้(?:ผล(?:ของ)?)?บริการ(?:นั้น|ดังกล่าว)?|ใช้ผล(?:ของ)?งาน(?:นั้น|ดังกล่าว)?|นำ(?:ผล(?:ของ)?บริการ|งาน|ซอฟต์แวร์)?(?:นั้น|ดังกล่าว)?(?:กลับ)?(?:ไป|มา)?(?:ให้[^\\n.?]{0,25})?ใช้(?:งาน)?|ใช้(?:งาน)?)";

const TH_OVERSEAS_PLACE_PHRASE_SRC = `(?:(?:ที่(?:สำนักงาน(?:ใหญ่|สาขา)?|สาขา|ออฟฟิศ)?\\s*(?:ใน|ณ)?\\s*|(?:ใน|ณ)\\s*(?:สำนักงาน(?:ใหญ่|สาขา)?(?:ใน|ที่)?\\s*)?)${OVERSEAS_LOCATION_TOKEN_SOURCE})`;
const TH_DOMESTIC_PLACE_PHRASE_SRC = `(?:(?:ที่(?:สำนักงาน(?:ใหญ่|สาขา)?|สาขา|ออฟฟิศ)?\\s*(?:ใน|ณ)?\\s*|(?:ใน|ณ)\\s*)${THAILAND_LOCATION_TOKEN_SOURCE}|${THAILAND_LOCATION_TOKEN_SOURCE})`;

/**
 * Shared deterministic service place-of-use classifier used identically on initial turns
 * AND follow-up corrections (`buildStructuredCaseFactLedger` and `applyFactDelta`).
 *
 * Strictly binds ONLY to where the service or its output is actually USED (never where it was
 * performed, delivered, or billed, and never inferring use from a foreign customer address alone),
 * and leaves any unstated remainder unknown:
 * - Explicit use in BOTH Thailand (incl. provincial branches) and overseas (incl. foreign offices/cities) -> `SERVICE_USED_MIXED_THAILAND_AND_ABROAD`
 * - Partial use in Thailand ONLY (remainder unstated) -> `SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN`
 * - Partial use in an overseas location ONLY (remainder unstated) -> `SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN`
 * - Explicitly unknown use location -> `SERVICE_USE_LOCATION_UNKNOWN`
 * - Entire/unqualified domestic use in Thailand -> `SERVICE_USED_IN_THAILAND_DOMESTIC`
 * - Entire overseas use -> `SERVICE_USED_ENTIRELY_ABROAD_EXPORT`
 */
export function extractServiceUseLocationFromText(
  rawText: string
): ExtractedServiceUseLocation | null {
  const norm = thaiDigitsToArabic(rawText || "").replace(/\s+/g, " ").trim();
  if (!norm) return null;

  const normWithoutNegatedDomesticUse = norm.replace(
    new RegExp(
      `(?:ไม่(?:มี|ได้)?(?:ส่วนใด(?:ของ(?:ผล)?บริการ)?(?:ที่)?|การ|ใดๆ)?(?:ถูก)?(?:นำ(?:ผล(?:ของ)?บริการ)?(?:กลับ)?(?:เข้า)?มา)?ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)?(?:ใดๆ)?(?:ใน|ที่)${THAILAND_LOCATION_TOKEN_SOURCE}(?:\\s*เลย)?|มิได้(?:นำ(?:ผล(?:ของ)?บริการ)?(?:กลับ)?(?:เข้า)?มา)?ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)?(?:ใดๆ)?(?:ใน|ที่)${THAILAND_LOCATION_TOKEN_SOURCE}|ปราศจากการใช้(?:บริการ|งาน)?(?:ใน|ที่)${THAILAND_LOCATION_TOKEN_SOURCE}|\\b(?:no|zero|without\\s+any)\\s+(?:domestic\\s+)?use\\s+in\\s+thailand\\b|\\b(?:no\\s+part|none)(?:\\s+of\\s+(?:the\\s+)?(?:service|output))?\\s+(?:is|was|will\\s+be)?\\s*used\\s+in\\s+thailand\\b|\\bnot\\s+(?:being\\s+)?used\\s+(?:at\\s+all\\s+)?in\\s+thailand(?:\\s+at\\s+all)?\\b)`,
      "gi"
    ),
    " "
  );

  const normWithoutNegatedOverseasUse = norm.replace(
    new RegExp(
      `(?:ไม่(?:มี|ได้)?(?:ส่วนใด(?:ของ(?:ผล)?บริการ)?(?:ที่)?|การ|ใดๆ)?(?:ถูก)?(?:นำ(?:ผล(?:ของ)?บริการ)?ไป)?ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)?(?:ใดๆ)?(?:ใน|ที่)?${OVERSEAS_LOCATION_TOKEN_SOURCE}(?:\\s*เลย)?|มิได้(?:นำ(?:ผล(?:ของ)?บริการ)?ไป)?ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)?(?:ใดๆ)?(?:ใน|ที่)?${OVERSEAS_LOCATION_TOKEN_SOURCE}|\\b(?:no|zero|without\\s+any)\\s+use\\s+(?:in\\s+|at\\s+)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\b|\\b(?:no\\s+part|none)(?:\\s+of\\s+(?:the\\s+)?(?:service|output))?\\s+(?:is|was|will\\s+be)?\\s*used\\s+(?:in\\s+|at\\s+)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\b|\\bnot\\s+(?:being\\s+)?used\\s+(?:at\\s+all\\s+)?(?:in\\s+|at\\s+)?${OVERSEAS_LOCATION_TOKEN_SOURCE}(?:\\s+at\\s+all)?\\b)`,
      "gi"
    ),
    " "
  );

  // 1. Explicit use in BOTH Thailand (including Thai provincial branches) AND an overseas location (including foreign city offices).
  //    Anchored strictly on service-USE verbs so "performed in Thailand" + "used at Tokyo office"
  //    or "client in Tokyo" + "used partly at Chiang Mai branch" NEVER misclassifies as mixed!
  const explicitBothLocationsRe = new RegExp(
    `(?:${TH_USE_VERB_SRC}[^\\n.?]{0,35}(?:(?:ทั้ง|ร่วมกันทั้ง)(?:บางส่วน)?\\s*${TH_DOMESTIC_PLACE_PHRASE_SRC}\\s*และ(?:บางส่วน)?\\s*${TH_OVERSEAS_PLACE_PHRASE_SRC}|(?:ทั้ง|ร่วมกันทั้ง)(?:บางส่วน)?\\s*${TH_OVERSEAS_PLACE_PHRASE_SRC}\\s*และ(?:บางส่วน)?\\s*${TH_DOMESTIC_PLACE_PHRASE_SRC}|(?:บางส่วน|ส่วนหนึ่ง)\\s*${TH_DOMESTIC_PLACE_PHRASE_SRC}[^\\n.?]{0,35}(?:และ|กับ)(?:อีก)?(?:บางส่วน|ส่วนที่เหลือ|ส่วนหนึ่ง)[^\\n.?]{0,20}${TH_OVERSEAS_PLACE_PHRASE_SRC}|(?:บางส่วน|ส่วนหนึ่ง)\\s*${TH_OVERSEAS_PLACE_PHRASE_SRC}[^\\n.?]{0,35}(?:และ|กับ)(?:อีก)?(?:บางส่วน|ส่วนที่เหลือ|ส่วนหนึ่ง)[^\\n.?]{0,20}${TH_DOMESTIC_PLACE_PHRASE_SRC})|(?:บางส่วน|ส่วนหนึ่ง)[^\\n.?]{0,20}${TH_USE_VERB_SRC}[^\\n.?]{0,15}${TH_DOMESTIC_PLACE_PHRASE_SRC}[^\\n.?]{0,35}(?:และ|กับ)(?:อีก)?(?:บางส่วน|ส่วนหนึ่ง|ส่วนที่เหลือ)[^\\n.?]{0,20}${TH_USE_VERB_SRC}[^\\n.?]{0,15}${TH_OVERSEAS_PLACE_PHRASE_SRC}|(?:บางส่วน|ส่วนหนึ่ง)[^\\n.?]{0,20}${TH_USE_VERB_SRC}[^\\n.?]{0,15}${TH_OVERSEAS_PLACE_PHRASE_SRC}[^\\n.?]{0,35}(?:และ|กับ)(?:อีก)?(?:บางส่วน|ส่วนหนึ่ง|ส่วนที่เหลือ)[^\\n.?]{0,20}${TH_USE_VERB_SRC}[^\\n.?]{0,15}${TH_DOMESTIC_PLACE_PHRASE_SRC}|\\bused\\s+(?:both\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}\\s+and\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}|both\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\s+(?:office\\s+)?and\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}|(?:partly|partially)\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}\\s+and\\s+(?:(?:partly|partially|the\\s+rest|the\\s+remainder)\\s+)?(?:used\\s+)?(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}|(?:partly|partially)\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\s+and\\s+(?:(?:partly|partially|the\\s+rest|the\\s+remainder)\\s+)?(?:used\\s+)?(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE})\\b|\\b(?:partly|partially)\\s+used\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}\\s+and\\s+(?:partly|partially)\\s+(?:used\\s+)?(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\b|\\b(?:partly|partially)\\s+used\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\s+and\\s+(?:partly|partially)\\s+(?:used\\s+)?(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}\\b)`,
    "i"
  );
  if (
    explicitBothLocationsRe.test(normWithoutNegatedDomesticUse) &&
    explicitBothLocationsRe.test(normWithoutNegatedOverseasUse)
  ) {
    return {
      category: "SERVICE_USED_MIXED_THAILAND_AND_ABROAD",
      original_text_th:
        "มีการใช้บริการทั้งในประเทศไทยและในต่างประเทศ (Mixed Use — ต้องแยกสัดส่วนหรือมูลค่าค่าบริการตามสถานที่ที่มีการใช้บริการ)",
      stated_overseas_location: null,
    };
  }

  // 2. Partial use in Thailand ONLY (including Thai provincial branches, remainder location NOT stated)
  const partialThailandUseRe = new RegExp(
    `(?:${TH_USE_VERB_SRC}[^\\n.?]{0,25}(?:บางส่วน|ส่วนหนึ่ง)\\s*${TH_DOMESTIC_PLACE_PHRASE_SRC}|(?:บางส่วน|ส่วนหนึ่ง)(?:ของ(?:ผล)?บริการ)?(?:ถูก)?(?:นำ(?:กลับ)?มา)?${TH_USE_VERB_SRC}\\s*${TH_DOMESTIC_PLACE_PHRASE_SRC}|\\b(?:(?:partly|partially)\\s+used\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}|used\\s+(?:partly|partially|in\\s+part)\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}|partial\\s+use\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}|part\\s+of\\s+(?:the\\s+)?(?:service|output)\\s+(?:is|was|will\\s+be)\\s+used\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE})\\b)`,
    "i"
  );

  // 3. Partial use in a stated overseas location ONLY (including foreign city offices, remainder location NOT stated)
  const partialOverseasUseRe = new RegExp(
    `(?:${TH_USE_VERB_SRC}[^\\n.?]{0,25}(?:บางส่วน|ส่วนหนึ่ง)(?:ที่สำนักงาน|ที่สาขา)?(?:ใน|ที่|ณ)?\\s*(${OVERSEAS_LOCATION_TOKEN_SOURCE})|(?:บางส่วน|ส่วนหนึ่ง)(?:ของ(?:ผล)?บริการ)?(?:ถูก)?(?:นำไป)?${TH_USE_VERB_SRC}(?:ที่สำนักงาน|ที่สาขา)?(?:ใน|ที่|ณ)?\\s*(${OVERSEAS_LOCATION_TOKEN_SOURCE})|\\b(?:(?:partly|partially)\\s+used\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?(${OVERSEAS_LOCATION_TOKEN_SOURCE})|used\\s+(?:partly|partially|in\\s+part)\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?(${OVERSEAS_LOCATION_TOKEN_SOURCE})|partial\\s+use\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?(${OVERSEAS_LOCATION_TOKEN_SOURCE})|part\\s+of\\s+(?:the\\s+)?(?:service|output)\\s+(?:is|was|will\\s+be)\\s+used\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?(${OVERSEAS_LOCATION_TOKEN_SOURCE}))\\b)`,
    "i"
  );

  const hasPartialThailand = partialThailandUseRe.test(normWithoutNegatedDomesticUse);
  const partialOverseasMatch = partialOverseasUseRe.exec(normWithoutNegatedOverseasUse);
  const hasPartialOverseas = Boolean(partialOverseasMatch);

  if (hasPartialThailand && hasPartialOverseas) {
    return {
      category: "SERVICE_USED_MIXED_THAILAND_AND_ABROAD",
      original_text_th:
        "มีการใช้บริการทั้งในประเทศไทยและในต่างประเทศ (Mixed Use — ต้องแยกสัดส่วนหรือมูลค่าค่าบริการตามสถานที่ที่มีการใช้บริการ)",
      stated_overseas_location: null,
    };
  }
  if (hasPartialThailand) {
    return {
      category: "SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN",
      original_text_th:
        "มีการใช้บริการบางส่วนในประเทศไทย ส่วนที่เหลือยังไม่ระบุสถานที่ที่มีการใช้บริการ (Remainder Unknown)",
      stated_overseas_location: null,
    };
  }
  if (hasPartialOverseas && partialOverseasMatch) {
    const statedPlaceRaw = (
      partialOverseasMatch[1] ||
      partialOverseasMatch[2] ||
      partialOverseasMatch[3] ||
      partialOverseasMatch[4] ||
      partialOverseasMatch[5] ||
      partialOverseasMatch[6] ||
      "ต่างประเทศ"
    ).trim();
    const placeDisplayTh = /^(?:ต่างประเทศ|นอกราชอาณาจักร|abroad|overseas|outside\s+thailand)$/i.test(
      statedPlaceRaw
    )
      ? "ต่างประเทศ"
      : /^[a-z]/i.test(statedPlaceRaw)
        ? `ต่างประเทศ (${statedPlaceRaw})`
        : statedPlaceRaw;
    return {
      category: "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN",
      original_text_th: `มีการใช้บริการบางส่วนใน${placeDisplayTh} ส่วนที่เหลือยังไม่ระบุสถานที่ที่มีการใช้บริการ (Remainder Unknown)`,
      stated_overseas_location: statedPlaceRaw,
    };
  }

  // 4. Explicitly unknown place of use
  const hasUnknownServiceUseCue =
    /(?:ไม่ทราบว่า[^\n.?]{0,50}(?:ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)?|นำ(?:ผล(?:ของ)?บริการ|ซอฟต์แวร์|งาน)[^\n.?]{0,30}ใช้)[^\n.?]{0,40}(?:ที่ใด|ในประเทศไทยหรือ|ในไทยหรือ|หรือไม่)|ยังไม่ทราบ(?:สถานที่|ประเทศ)(?:ที่)?ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)|ไม่ระบุ(?:สถานที่|ประเทศ)(?:ที่)?ใช้(?:ผล(?:ของ)?)?(?:บริการ|งาน)|unknown\s+where\s+(?:the\s+)?(?:service|output)\s+(?:is|was|will\s+be)\s+used|unclear\s+whether\s+(?:the\s+)?(?:service|output)\s+(?:is|was|will\s+be)\s+used\s+in\s+thailand)/i.test(
      norm
    );
  if (hasUnknownServiceUseCue) {
    return {
      category: "SERVICE_USE_LOCATION_UNKNOWN",
      original_text_th:
        "ยังไม่ทราบสถานที่ที่มีการใช้บริการ (ต้องยืนยันว่าใช้ในประเทศไทยหรือต่างประเทศ)",
      stated_overseas_location: null,
    };
  }

  // 5. Entire/unqualified domestic use in Thailand (anchored strictly to USE verbs — NEVER "performed in Thailand"
  //    or "delivered/billed" when foreign clients/offices are mentioned!)
  const hasAnyForeignMention = new RegExp(
    `(?:${OVERSEAS_LOCATION_TOKEN_SOURCE}|foreign|ต่างประเทศ)`,
    "i"
  ).test(normWithoutNegatedDomesticUse);

  const domesticUseAnchoredRe = new RegExp(
    `(?:${TH_USE_VERB_SRC}(?:ทั้งหมด|เพียงอย่างเดียว)?\\s*${TH_DOMESTIC_PLACE_PHRASE_SRC}|\\b(?:service|output)\\s+(?:is|was)\\s+used\\s+(?:entirely\\s+|wholly\\s+|exclusively\\s+)?(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}\\b|\\bused\\s+(?:entirely\\s+|wholly\\s+|exclusively\\s+)?(?:in\\s+|at\\s+(?:the\\s+)?)?${THAILAND_LOCATION_TOKEN_SOURCE}\\b|\\bdomestic\\s+use\\s+in\\s+thailand\\b)`,
    "i"
  );
  const hasDomesticServiceUseCue =
    domesticUseAnchoredRe.test(normWithoutNegatedDomesticUse) ||
    (!hasAnyForeignMention &&
      /(?:ลูกค้าใน(?:กรุงเทพมหานคร|ประเทศไทย)|ให้บริการ[^\n.?]{0,40}ในประเทศไทย)/.test(
        normWithoutNegatedDomesticUse
      ) &&
      !/(?:ส่งมอบ[^\n.?]{0,25}(?:ทางอีเมล|ออนไลน์)|วางบิล)/.test(normWithoutNegatedDomesticUse));

  // 6. Entire overseas use (anchored strictly to USE verbs — NEVER foreign customer address, delivery, or billing alone!)
  const overseasUseAnchoredRe = new RegExp(
    `(?:${TH_USE_VERB_SRC}(?:ทั้งหมด|เพียงอย่างเดียว)?\\s*${TH_OVERSEAS_PLACE_PHRASE_SRC}(?:\\s*(?:ทั้งหมด|เพียงอย่างเดียว))?|\\bused\\s+(?:entirely|wholly|exclusively)\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\b|\\b(?:service|output)\\s+(?:is|was)\\s+used\\s+(?:entirely|wholly|exclusively)\\s+(?:in\\s+|at\\s+(?:the\\s+)?)?${OVERSEAS_LOCATION_TOKEN_SOURCE}\\b)`,
    "i"
  );
  const hasOverseasServiceUseCue = overseasUseAnchoredRe.test(normWithoutNegatedOverseasUse);

  // Explicit affirmative use in BOTH Thailand AND overseas in separate clauses -> Mixed use!
  if (hasDomesticServiceUseCue && hasOverseasServiceUseCue) {
    return {
      category: "SERVICE_USED_MIXED_THAILAND_AND_ABROAD",
      original_text_th:
        "มีการใช้บริการทั้งในประเทศไทยและในต่างประเทศ (Mixed Use — ต้องแยกสัดส่วนหรือมูลค่าค่าบริการตามสถานที่ที่มีการใช้บริการ)",
      stated_overseas_location: null,
    };
  }

  if (hasDomesticServiceUseCue) {
    const m = normWithoutNegatedDomesticUse.match(domesticUseAnchoredRe);
    return {
      category: "SERVICE_USED_IN_THAILAND_DOMESTIC",
      original_text_th: m ? m[0].trim() : "ใช้บริการในประเทศไทย",
      stated_overseas_location: null,
    };
  }

  if (hasOverseasServiceUseCue) {
    const m = normWithoutNegatedOverseasUse.match(overseasUseAnchoredRe);
    return {
      category: "SERVICE_USED_ENTIRELY_ABROAD_EXPORT",
      original_text_th: m ? m[0].trim() : "ใช้บริการทั้งหมดในต่างประเทศ",
      stated_overseas_location: null,
    };
  }

  return null;
}

export function isPartialMixedOrUnknownServiceUseCategory(
  category: string | null | undefined
): boolean {
  return (
    category === "SERVICE_USE_LOCATION_UNKNOWN" ||
    category === "SERVICE_USED_MIXED_THAILAND_AND_ABROAD" ||
    category === "SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN" ||
    category === "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN"
  );
}

export function buildUnknownServiceUseFactNoteTh(
  category: string,
  originalTextTh?: string
): string | null {
  if (category === "SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN") {
    return "ยังไม่ทราบสถานที่ที่มีการใช้บริการในส่วนที่เหลือ (ระบุเฉพาะการใช้บริการบางส่วนในประเทศไทย) และยังไม่ระบุสัดส่วนหรือมูลค่าค่าบริการที่แยกตามสถานที่ใช้งาน";
  }
  if (category === "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN") {
    return `ยังไม่ทราบสถานที่ที่มีการใช้บริการในส่วนที่เหลือ (${originalTextTh || "ระบุเฉพาะการใช้บริการบางส่วนในต่างประเทศ"}) และยังไม่ระบุสัดส่วนหรือมูลค่าค่าบริการที่แยกตามสถานที่ใช้งาน`;
  }
  if (category === "SERVICE_USED_MIXED_THAILAND_AND_ABROAD") {
    return "มีการใช้บริการทั้งในประเทศไทยและในต่างประเทศ ยังไม่ระบุสัดส่วนหรือมูลค่าค่าบริการที่แยกได้ตามสถานที่ใช้งาน";
  }
  if (category === "SERVICE_USE_LOCATION_UNKNOWN") {
    return "ยังไม่ทราบสถานที่ที่มีการใช้บริการ (ในประเทศไทยหรือต่างประเทศ)";
  }
  return null;
}

export function hasExplicitServiceUseFeeSplit(ledger: StructuredCaseFactLedger): boolean {
  const activePlace = ledger.material_facts.find(
    (f) => f.fact_key === "vat_place_of_use"
  )?.normalized_category;
  if (activePlace !== "SERVICE_USED_MIXED_THAILAND_AND_ABROAD") return false;
  const fullUserText = thaiDigitsToArabic(ledger.user_turns.map((t) => t.raw_text).join("\n"));
  // Explicit percentage split summing to <=100% (e.g. "40% in Thailand and 60% in Japan")
  const pctMatches = Array.from(fullUserText.matchAll(/(?:ร้อยละ\s*([0-9]{1,2}(?:\.[0-9]+)?)|([0-9]{1,2}(?:\.[0-9]+)?)\s*%)/g))
    .map((m) => Number(m[1] || m[2]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100 && n !== 7 && n !== 6.3 && n !== 10);
  if (pctMatches.length >= 2) return true;
  // Explicit per-location monetary split (2+ distinct positive baht amounts smaller than total fee alongside location cues)
  const moneyMatches = Array.from(
    fullUserText.matchAll(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})\s*(?:บาท|thb|baht)/gi)
  )
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const distinctMoney = Array.from(new Set(moneyMatches));
  return distinctMoney.length >= 2 && /(?:แยก(?:เป็น|ค่าบริการ|มูลค่า)|ส่วนที่(?:ใช้)?ใน|split|allocat)/i.test(fullUserText);
}

export function buildStructuredCaseFactLedger(input: {
  question: string;
  applicableDate?: string | null;
  conversationHistory?: ConversationTurnInput[];
}): StructuredCaseFactLedger {
  // Strictly read ONLY user turns from conversation_history — never assistant prose or assistant rulings!
  const priorUserTurns = (input.conversationHistory || [])
    .filter((t) => t && t.role === "user" && typeof t.content === "string" && t.content.trim().length > 0)
    .map((t) => ({
      raw_text: t.content.trim(),
      explicit_applicable_date: t.applicable_date ?? null,
    }));

  const allUserTurns = [
    ...priorUserTurns,
    {
      raw_text: input.question.trim(),
      explicit_applicable_date: input.applicableDate ?? null,
    },
  ];

  const isNewConversation = priorUserTurns.length === 0;
  const factsMap = new Map<string, PreservedMaterialFact>();
  const overrides: StructuredCaseFactLedger["overrides"] = [];
  const allTemporalEvents: PreservedTemporalEvent[] = [];
  const nonOccurringEvents: NonOccurringTemporalClause[] = [];
  const declaredLotsMap = new Map<string, DeclaredGoodsLot>();
  const unknownFacts = new Set<string>();
  const questionsAsked: string[] = [];

  let assetOriginalNounTh: string | null = null;
  let forbidLandSubstitution = false;
  let recipientOriginalNounTh: string | null = null;
  let forbidNieceSubstitution = false;
  let recipientKinshipCategory: string | null = null;
  let isAmbiguousLanSao = false;

  const userTurnsOut: StructuredCaseFactLedger["user_turns"] = [];
  let latestTurnWasDateShiftOverride = false;

  const dateShiftTokenSrc = `(?:\\d{1,2}\\s*${THAI_MONTH_REGEX_SRC}\\s*(?:พ\\.ศ\\.\\s*)?(?:\\d{4}|[4-7]\\d(?![0-9]))|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?\\s+\\d{4})`;
  const dateShiftPatterns = [
    new RegExp(
      `(?:เหตุการณ์(?:ทั้งหมด)?ที่เดิม(?:เกิดขึ้น)?(?:เมื่อ|ใน)?|วันที่เดิม(?:เกิดขึ้น)?(?:เมื่อ|ใน)?)(?:วันที่|วัน)?\\s*(${dateShiftTokenSrc})\\s*(?:ให้)?(?:เปลี่ยน|เลื่อน|แก้ไข)(?:เป็น)?(?:เกิดขึ้น)?(?:เมื่อ|ใน)?(?:วันที่|วัน)?\\s*(${dateShiftTokenSrc})(?:\\s*แทน)?`,
      "gi"
    ),
    new RegExp(
      `(?:เปลี่ยน|เลื่อน|แก้ไข)(?:\\s*เฉพาะ)?\\s*(?:วัน(?:ที่)?(?:เกิดเหตุการณ์|ส่งมอบ|โอนกรรมสิทธิ์|รับชำระ|ได้รับชำระ|ออกใบกำกับ(?:ภาษี)?|ใช้(?:ผล(?:ของ)?)?บริการ)?|เหตุการณ์(?:ทั้งหมด)?)(?:[^.;\\n]{0,85}?)(?:จาก|ที่เดิม(?:เป็น|เกิดขึ้น(?:เมื่อ|ใน)?)?)\\s*(?:เดิม)?(?:วันที่|วัน)?\\s*(${dateShiftTokenSrc})\\s*(?:ให้)?(?:เปลี่ยน|เลื่อน)?เป็น(?:เกิดขึ้น(?:เมื่อ|ใน)?)?\\s*(?:วันที่|วัน)?\\s*(${dateShiftTokenSrc})(?:\\s*แทน)?`,
      "gi"
    ),
    new RegExp(
      `(?:change|move|shift)(?:d|s|ing)?\\s+(?:all\\s+)?events?\\s+(?:from|originally\\s+(?:occurring\\s+)?on)\\s+(${dateShiftTokenSrc})\\s+to\\s+(${dateShiftTokenSrc})`,
      "gi"
    ),
  ];

  for (let i = 0; i < allUserTurns.length; i++) {
    const turnNumber = i + 1;
    const raw = allUserTurns[i].raw_text;
    const cleaned = stripNegatedFactualClauses(raw);
    const norm = thaiDigitsToArabic(cleaned);
    userTurnsOut.push({
      turn_number: turnNumber,
      raw_text: raw,
      cleaned_active_text: cleaned,
      explicit_applicable_date: allUserTurns[i].explicit_applicable_date,
    });

    // 1. Asset extraction (preserving exact noun alongside legal category — stop cleanly at phrase boundaries!)
    if (/ห้องชุด|คอนโดมิเนียม|คอนโด/.test(norm)) {
      const m = norm.match(/(ห้องชุด(?:ใน[^\s,.;]+)?|คอนโดมิเนียม(?:ใน[^\s,.;]+)?|คอนโด(?:ใน[^\s,.;]+)?)/);
      const rawAsset = m ? m[1].replace(/(?:หนึ่งห้อง)?ให้แก่.*$/, "หนึ่งห้อง").trim() : "ห้องชุด";
      assetOriginalNounTh = rawAsset || "ห้องชุด";
      forbidLandSubstitution = !/ที่ดิน/.test(norm);
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "IMMOVABLE_PROPERTY_CONDOMINIUM_UNIT",
        source_turn: turnNumber,
      });
    } else if (
      /(?:ที่ดินพร้อมอาคารพาณิชย์|อาคารพาณิชย์พร้อมที่ดิน|ที่ดินพร้อมสิ่งปลูกสร้าง|ที่ดินพร้อมอาคาร|ที่ดินพร้อมบ้าน(?:เดี่ยว)?|บ้านเดี่ยวพร้อมที่ดิน|บ้านพร้อมที่ดิน|อาคารพาณิชย์|ตึกแถว|ทาวน์โฮม|ทาวน์เฮาส์)/.test(
        norm
      )
    ) {
      const m = norm.match(
        /(ที่ดินพร้อมอาคารพาณิชย์|อาคารพาณิชย์พร้อมที่ดิน|ที่ดินพร้อมสิ่งปลูกสร้าง|ที่ดินพร้อมอาคาร|ที่ดินพร้อมบ้านเดี่ยว|ที่ดินพร้อมบ้าน|บ้านเดี่ยวพร้อมที่ดิน|บ้านพร้อมที่ดิน|อาคารพาณิชย์|ตึกแถว|ทาวน์โฮม|ทาวน์เฮาส์)/
      );
      const existingBuildingAsset = factsMap.get("asset");
      const matchedBuildingLabel = m ? m[1] : "อาคารพร้อมที่ดิน";
      // Preserve a more specific Turn 1 phrase (e.g. "ที่ดินพร้อมอาคารพาณิชย์") if a later turn uses shorthand "ที่ดินพร้อมอาคาร"
      const effectiveBuildingLabel =
        existingBuildingAsset?.normalized_category === "IMMOVABLE_PROPERTY_BUILDING_AND_LAND" &&
        existingBuildingAsset.original_text_th.includes("พาณิชย์") &&
        !matchedBuildingLabel.includes("พาณิชย์") &&
        !/เปลี่ยนทรัพย์สิน/.test(norm)
          ? existingBuildingAsset.original_text_th
          : matchedBuildingLabel;
      assetOriginalNounTh = effectiveBuildingLabel;
      forbidLandSubstitution = false;
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "IMMOVABLE_PROPERTY_BUILDING_AND_LAND",
        source_turn: turnNumber,
      });
    } else if (/ที่ดิน|อสังหาริมทรัพย์/.test(norm)) {
      const existingSpecificImmovable = factsMap.get("asset");
      const hasExplicitAssetTypeChange =
        /(?:เปลี่ยนทรัพย์สิน|ที่ดินเปล่า|เปลี่ยนจาก[^\n]{0,30}เป็น\s*ที่ดิน)/.test(norm);
      if (
        existingSpecificImmovable &&
        (existingSpecificImmovable.normalized_category === "IMMOVABLE_PROPERTY_BUILDING_AND_LAND" ||
          existingSpecificImmovable.normalized_category ===
            "IMMOVABLE_PROPERTY_CONDOMINIUM_UNIT") &&
        !hasExplicitAssetTypeChange
      ) {
        // Do NOT collapse a prior turn's "ที่ดินพร้อมอาคารพาณิชย์" / "บ้านเดี่ยวพร้อมที่ดิน" / "ห้องชุด" to generic "ที่ดิน"!
        assetOriginalNounTh = existingSpecificImmovable.original_text_th;
      } else {
        const m = norm.match(/(ที่ดินแปลง[^\s,.;]{0,20}|ที่ดินสองแปลง|ที่ดินเปล่า|ที่ดิน|อสังหาริมทรัพย์)/);
        assetOriginalNounTh = m ? m[1] : "ที่ดิน";
        forbidLandSubstitution = false;
        upsertFact(factsMap, overrides, {
          fact_key: "asset",
          label_th: "ทรัพย์สินที่โอน",
          original_text_th: assetOriginalNounTh,
          normalized_category: "IMMOVABLE_PROPERTY_LAND",
          source_turn: turnNumber,
        });
      }
    } else if (/(?:เงินสด|โอนเงิน|เงินโอน|สังหาริมทรัพย์|(?<!ห้าง)หุ้น(?!ส่วน))/.test(norm)) {
      const m = norm.match(/(เงินสด|เงินโอน|สังหาริมทรัพย์|(?<!ห้าง)หุ้น(?!ส่วน)[^\s,.;]{0,15})/);
      assetOriginalNounTh = m ? m[1] : "เงินสด/สังหาริมทรัพย์";
      forbidLandSubstitution = true;
      upsertFact(factsMap, overrides, {
        fact_key: "asset",
        label_th: "ทรัพย์สินที่โอน",
        original_text_th: assetOriginalNounTh,
        normalized_category: "MOVABLE_PROPERTY_CASH_OR_OTHER",
        source_turn: turnNumber,
      });
    }

    // 2. Marital co-ownership (สินสมรส)
    if (/สินสมรส|ซื้อ[^\n]{0,30}ร่วมกันระหว่างสมรส|สามีภริยาที่จดทะเบียนสมรส/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "ownership_regime",
        label_th: "กรรมสิทธิ์ในทรัพย์สิน",
        original_text_th: "สินสมรสของสามีภริยาที่จดทะเบียนสมรส (ถือกรรมสิทธิ์ร่วมกัน)",
        normalized_category: "MARITAL_COMMUNITY_PROPERTY_CO_OWNED_SIN_SOMROT",
        source_turn: turnNumber,
      });
    }

    const hasTransferOrGiftVerb =
      /(?:ให้(?:แก่|โดยเสน่หา)|โอน(?:กรรมสิทธิ์|ที่ดิน|ห้องชุด|บ้าน|อาคาร|เงิน|หุ้น|ทรัพย์สิน)?|ยก[^\n]{0,25}ให้|มอบ[^\n]{0,35}ให้|ผู้รับโอน|ผู้รับให้|ขายฝาก|แลกเปลี่ยน)/.test(
        norm
      );
    const isSection47AllowanceTurn =
      !hasTransferOrGiftVerb &&
      (/มาตรา\s*47\b|section\s*47\b/i.test(norm) || /(?:หักลดหย่อน|ค่าลดหย่อน)/.test(norm));

    // 3a. Section 47 Personal / Family Allowance Facts (OBS-2: list taxpayer, spouse income status, children + birth year, and tax year instead of gift-transfer recipient label!)
    if (isSection47AllowanceTurn) {
      const namedTaxpayerMatch = norm.match(
        /^((?:นาย|นางสาว|นาง|ดร\.)\s*[ก-๙]+(?:\s+[ก-๙]+)?)(?=\s+(?:มี|โสด|เป็นโสด|สถานะ|สถานภาพ|สมรส|จดทะเบียน|ไม่มี|อุปการะ|ปีภาษี))/
      );
      const isSingleTurn =
        /(?:สถานะโสด|สถานภาพโสด|เป็นโสด|คนโสด|ผู้มีเงินได้โสด|(?<![ก-๙])โสด)(?!า|\s*หนึ่ง)|ไม่มีคู่สมรส|ยังไม่ได้สมรส/.test(
          norm
        ) && !/(?:ไม่โสด|ไม่ได้เป็นโสด|มิใช่คนโสด|ไม่ใช่คนโสด)/.test(norm);

      upsertFact(factsMap, overrides, {
        fact_key: "s47_taxpayer",
        label_th: "ผู้มีเงินได้",
        original_text_th: namedTaxpayerMatch
          ? `${namedTaxpayerMatch[1].trim()} (บุคคลธรรมดา)`
          : isSingleTurn
            ? "ผู้มีเงินได้บุคคลธรรมดา (โสด)"
            : "ผู้มีเงินได้บุคคลธรรมดา",
        normalized_category: "S47_INDIVIDUAL_TAXPAYER",
        source_turn: turnNumber,
      });

      if (isSingleTurn) {
        upsertFact(factsMap, overrides, {
          fact_key: "s47_spouse_status",
          label_th: "สถานภาพสมรสและเงินได้ของคู่สมรส",
          original_text_th: "โสด (ไม่มีคู่สมรส)",
          normalized_category: "S47_SPOUSE_NONE_SINGLE",
          source_turn: turnNumber,
        });
      } else if (
        /(?:คู่สมรส|สามี|ภริยา|ภรรยา)[^\n]{0,75}(?:ไม่มีเงินได้|ไม่มีรายได้)/.test(norm)
      ) {
        upsertFact(factsMap, overrides, {
          fact_key: "s47_spouse_status",
          label_th: "สถานภาพสมรสและเงินได้ของคู่สมรส",
          original_text_th: "มีคู่สมรสที่ไม่มีเงินได้",
          normalized_category: "S47_SPOUSE_NO_INCOME",
          source_turn: turnNumber,
        });
      } else if (
        /(?:คู่สมรส|สามี|ภริยา|ภรรยา)[^\n]{0,65}(?:มีเงินได้(?:ของตนเอง|พึงประเมิน)?[^\n]{0,35}แยกยื่น|แยกยื่น(?:แบบ|รายการ))/.test(
          norm
        )
      ) {
        upsertFact(factsMap, overrides, {
          fact_key: "s47_spouse_status",
          label_th: "สถานภาพสมรสและเงินได้ของคู่สมรส",
          original_text_th: "มีคู่สมรสที่มีเงินได้แยกยื่นรายการ",
          normalized_category: "S47_SPOUSE_SEPARATE_INCOME",
          source_turn: turnNumber,
        });
      }

      if (/(?:ไม่มีบุตรเลย|ไม่มีบุตร(?!\s*(?:ชาย|สาว)?(?:ที่)?ชอบด้วยกฎหมาย|\s*บุญธรรม))/.test(norm)) {
        upsertFact(factsMap, overrides, {
          fact_key: "s47_children",
          label_th: "ข้อมูลบุตรและปี พ.ศ. ที่เกิด",
          original_text_th: "ไม่มีบุตร",
          normalized_category: "S47_CHILDREN_NONE",
          source_turn: turnNumber,
        });
      } else {
        const childClauseParts: string[] = [];
        const legitSnippet = norm.match(
          /((?:ไม่มี)?บุตร(?:ชาย|สาว)?(?:ที่)?ชอบด้วยกฎหมาย[^\n?;]*?(?=\s+และ(?:มี|ไม่มี)?บุตรบุญธรรม|\s+แต่มีบุตรบุญธรรม|\s+ปีภาษี|\s+มีสิทธิหัก|\s+หักลดหย่อน|$))/
        );
        if (legitSnippet && legitSnippet[1].trim()) {
          childClauseParts.push(legitSnippet[1].trim());
        }
        const adoptedSnippet = norm.match(
          /((?:ไม่มี)?บุตรบุญธรรม[^\n?;]*?(?=\s+ปีภาษี|\s+มีสิทธิหัก|\s+หักลดหย่อน|$))/
        );
        if (adoptedSnippet && adoptedSnippet[1].trim()) {
          childClauseParts.push(adoptedSnippet[1].trim());
        }
        if (childClauseParts.length > 0) {
          upsertFact(factsMap, overrides, {
            fact_key: "s47_children",
            label_th: "ข้อมูลบุตรและปี พ.ศ. ที่เกิด",
            original_text_th: childClauseParts.join("; "),
            normalized_category: "S47_CHILDREN_STATED",
            source_turn: turnNumber,
          });
        }
      }

      const taxYearMatch = norm.match(/ปีภาษี(?:\s*พ\.ศ\.)?\s*(25\d{2})/);
      if (taxYearMatch) {
        upsertFact(factsMap, overrides, {
          fact_key: "s47_tax_year",
          label_th: "ปีภาษีที่พิจารณา",
          original_text_th: `ปีภาษี ${taxYearMatch[1]}`,
          normalized_category: `S47_TAX_YEAR_BE_${taxYearMatch[1]}`,
          source_turn: turnNumber,
        });
      }
    }

    // 3. Recipient & Kinship extraction (preserving exact noun & gender, never guessing ambiguous หลานสาว)
    if (isSection47AllowanceTurn) {
      // Pure §47 personal allowance turn: do not emit gift/transfer `recipient_kinship` facts!
    } else if (/(?:บุตร(?:สาว|ชาย)?ของหลาน(?:ชาย|สาว)?|ลูก(?:สาว|ชาย)?ของหลาน(?:ชาย|สาว)?)/.test(norm)) {
      const isMaleGrand = /(?:บุตรชายของหลาน|ลูกชายของหลาน)/.test(norm);
      const m = norm.match(
        /((?:นางสาว|นาย|ด\.ญ\.|ด\.ช\.)?[ก-๙]+\s*ซึ่งเป็นบุตร(?:สาว|ชาย)?ของหลาน(?:ชาย|สาว)?[^\n,.?]*(?:\([^)]+\))?|บุตร(?:สาว|ชาย)?ของหลาน(?:ชาย|สาว)?[^\s,.;)]*(?:\s*\([^)]+\))?)/
      );
      recipientOriginalNounTh = m
        ? m[1].trim()
        : isMaleGrand
          ? "บุตรชายของหลาน (เหลน — มิใช่บุตรชอบด้วยกฎหมาย)"
          : "บุตรสาวของหลาน (เหลน — มิใช่บุตรชอบด้วยกฎหมาย)";
      forbidNieceSubstitution = isMaleGrand;
      recipientKinshipCategory =
        "COLLATERAL_GRANDNIECE_OR_GRANDNEPHEW_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/(?:บุตรชายของน้องสาว|บุตรชายของน้องชาย|บุตรชายของพี่สาว|บุตรชายของพี่ชาย|ลูกชายของน้อง|ลูกชายของพี่)/.test(norm)) {
      const m = norm.match(/((?:นาย|ด\.ช\.)[ก-๙]+\s*ซึ่งเป็นหลานชาย\s*\([^)]+\)|หลานชาย\s*\([^)]+\)|บุตรชายของ(?:น้อง|พี่)(?:สาว|ชาย)[^\s,.;)]*)/);
      recipientOriginalNounTh = m ? m[1].trim() : "หลานชาย (บุตรของพี่น้อง)";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "COLLATERAL_NEPHEW_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/(?:บุตรสาวของน้องชาย|บุตรสาวของน้องสาว|บุตรสาวของพี่ชาย|บุตรสาวของพี่สาว|ลูกสาวของน้อง|ลูกสาวของพี่)/.test(norm)) {
      const m = norm.match(/((?:นางสาว|นาง|ด\.ญ\.)?[ก-๙]+\s*ซึ่งเป็นหลานสาว\s*\([^)]+\)|หลานสาว\s*\([^)]+\)|บุตรสาวของ(?:น้อง|พี่)(?:ชาย|สาว)[^\s,.;)]*)/);
      recipientOriginalNounTh = m ? m[1].trim() : "หลานสาว (บุตรของพี่น้อง)";
      forbidNieceSubstitution = false;
      recipientKinshipCategory = "COLLATERAL_NIECE_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/(?:บุตรสาวของบุตรชาย|บุตรสาวของบุตรสาว|บุตรชายของบุตรชาย|บุตรชายของบุตรสาว|หลานสายตรง|ปู่กับย่า|ตากับยาย)/.test(norm)) {
      const isMale = /หลานชาย|บุตรชายของบุตร/.test(norm);
      const m = norm.match(/((?:นางสาว|นาย)?[ก-๙]+\s*ซึ่งเป็นหลาน(?:สาว|ชาย)\s*\([^)]+\)|หลาน(?:สาว|ชาย)\s*\([^)]+\))/);
      recipientOriginalNounTh = m ? m[1].trim() : isMale ? "หลานชาย (ผู้สืบสันดาน)" : "หลานสาว (ผู้สืบสันดาน)";
      forbidNieceSubstitution = isMale;
      recipientKinshipCategory = isMale
        ? "LINEAL_GRANDSON_DESCENDANT_NOT_LEGITIMATE_CHILD"
        : "LINEAL_GRANDDAUGHTER_DESCENDANT_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (
      /บุตรบุญธรรม/.test(norm) &&
      !/ไม่ใช่บุตรบุญธรรม|มิใช่บุตรบุญธรรม|ไม่รวม(?:ถึง)?บุตรบุญธรรม/.test(raw)
    ) {
      recipientOriginalNounTh = "บุตรบุญธรรม (มิใช่บุตรชอบด้วยกฎหมายตามข้อยกเว้นมาตรา 42 (26))";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "ADOPTED_CHILD_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/หลานชาย/.test(norm)) {
      recipientOriginalNounTh = "หลานชาย (ยังไม่ระบุว่าเป็นผู้สืบสันดานหรือบุตรของพี่น้อง)";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "AMBIGUOUS_GRANDSON_OR_NEPHEW_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (/หลานสาว/.test(norm)) {
      recipientOriginalNounTh = "หลานสาว (ยังไม่ระบุว่าเป็นบุตรของบุตร [ผู้สืบสันดาน] หรือบุตรของพี่น้อง [ญาติสายข้าง])";
      forbidNieceSubstitution = false;
      recipientKinshipCategory = "AMBIGUOUS_GRANDDAUGHTER_OR_NIECE_NOT_LEGITIMATE_CHILD";
      isAmbiguousLanSao = true;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (
      /บุตร(?:ชาย|สาว)?(?:ที่)?ชอบด้วยกฎหมาย/.test(norm) &&
      !/(?:ไม่ใช่|มิใช่)บุตร(?:ชาย|สาว)?(?:ที่)?ชอบด้วยกฎหมาย/.test(raw)
    ) {
      const childGender = /บุตรสาวชอบด้วยกฎหมาย/.test(norm)
        ? "บุตรสาวชอบด้วยกฎหมาย (มิใช่บุตรบุญธรรม)"
        : /บุตรชายชอบด้วยกฎหมาย/.test(norm)
          ? "บุตรชายชอบด้วยกฎหมาย (มิใช่บุตรบุญธรรม)"
          : "บุตรชอบด้วยกฎหมาย (มิใช่บุตรบุญธรรม)";
      recipientOriginalNounTh = childGender;
      forbidNieceSubstitution = !/บุตรสาว/.test(norm);
      recipientKinshipCategory = "LEGITIMATE_CHILD_NON_ADOPTED";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    } else if (
      /(?:ให้(?:แก่)?|โอน[^\n]{0,45}ให้(?:แก่)?|มอบ[^\n]{0,45}ให้(?:แก่)?)[^\n]{0,25}?(บิดา(?:บังเกิดเกล้า|แท้ๆ)?|มารดา(?:บังเกิดเกล้า|แท้ๆ)?|พ่อ(?:บังเกิดเกล้า|แท้ๆ)?|แม่(?:บังเกิดเกล้า|แท้ๆ)?|บุพการี)/.test(
        norm
      )
    ) {
      const m = norm.match(
        /(บิดา(?:บังเกิดเกล้า|แท้ๆ)?|มารดา(?:บังเกิดเกล้า|แท้ๆ)?|พ่อ(?:บังเกิดเกล้า|แท้ๆ)?|แม่(?:บังเกิดเกล้า|แท้ๆ)?|บุพการี)/
      );
      recipientOriginalNounTh = m ? `${m[1]} (บุพการี)` : "บุพการี";
      forbidNieceSubstitution = true;
      recipientKinshipCategory = "ASCENDANT_PARENT";
      isAmbiguousLanSao = false;
      upsertFact(factsMap, overrides, {
        fact_key: "recipient_kinship",
        label_th: "ผู้รับโอนและความสัมพันธ์ทางเครือญาติ",
        original_text_th: recipientOriginalNounTh,
        normalized_category: recipientKinshipCategory,
        source_turn: turnNumber,
      });
    }

    // 4. Transfer consideration, acquisition method & occasion
    if (/ได้[^\n]{0,35}มาโดย(?:ทาง)?มรดก|รับมรดกมาจาก|ได้มาจากการให้โดยเสน่หา/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "acquisition_method",
        label_th: "วิธีการได้มาซึ่งทรัพย์สินของผู้โอน",
        original_text_th: /ให้โดยเสน่หา/.test(norm) ? "ได้มาจากการให้โดยเสน่หา" : "ได้มาโดยทางมรดก",
        normalized_category: "ACQUIRED_BY_INHERITANCE_OR_GIFT",
        source_turn: turnNumber,
      });
    } else if (/ได้[^\n]{0,35}มาโดยการซื้อ|ซื้อ(?:ที่ดิน|บ้าน|ห้องชุด|อาคาร)[^\n]{0,30}มา(?:เอง|จาก)/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "acquisition_method",
        label_th: "วิธีการได้มาซึ่งทรัพย์สินของผู้โอน",
        original_text_th: "ได้มาโดยการซื้อ (ทางอื่นนอกจากมรดกหรือการได้รับจากการให้โดยเสน่หา)",
        normalized_category: "ACQUIRED_BY_PURCHASE",
        source_turn: turnNumber,
      });
    }

    if (/โดยไม่มีค่าตอบแทน|โดยเสน่หา|ยก[^\n]{0,25}ให้|มอบเงินสด[^\n]{0,35}ให้/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "consideration_type",
        label_th: "ลักษณะการโอน",
        original_text_th: /โดยเสน่หา/.test(norm) ? "การให้โดยเสน่หาไม่มีค่าตอบแทน" : "การโอนโดยไม่มีค่าตอบแทน",
        normalized_category: "GRATUITOUS_TRANSFER_NO_CONSIDERATION",
        source_turn: turnNumber,
      });
    }
    if (/ไม่(?:ได้)?เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณี|ไม่เกี่ยวกับพิธีหรือประเพณี|ไม่เกี่ยวกับพิธีตามประเพณี|มิใช่[^\n]{0,20}ประเพณี/.test(raw)) {
      upsertFact(factsMap, overrides, {
        fact_key: "customary_occasion",
        label_th: "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี",
        original_text_th: "ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณีใด",
        normalized_category: "NOT_CUSTOMARY_OCCASION",
        source_turn: turnNumber,
      });
    } else if (/งานบวช[^\n,.;]{0,30}|พิธีอุปสมบท[^\n,.;]{0,30}|งานสมรสตามประเพณี|พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี|อุปการะ/.test(norm)) {
      const m = norm.match(/(งานบวช[^\n,.;?]{0,35}|พิธีอุปสมบท[^\n,.;?]{0,35}|งานสมรสตามประเพณี|พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี|อุปการะ[^\s,.;]{0,20})/);
      upsertFact(factsMap, overrides, {
        fact_key: "customary_occasion",
        label_th: "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี",
        original_text_th: m ? m[1].trim() : "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี",
        normalized_category: "CUSTOMARY_OR_MORAL_OCCASION",
        source_turn: turnNumber,
      });
    }

    // 5. VAT Transaction Nature & Place of Use
    if (/ส่งออกสินค้า|ส่งสินค้าออกนอกราชอาณาจักร|ส่งออกรองเท้า/.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "vat_transaction_type",
        label_th: "ประเภทธุรกรรมภาษีมูลค่าเพิ่ม",
        original_text_th: "การส่งออกสินค้าออกนอกราชอาณาจักร",
        normalized_category: "VAT_EXPORT_OF_GOODS",
        source_turn: turnNumber,
      });
    } else if (/ให้บริการ|ค่าบริการ|บำรุงรักษาซอฟต์แวร์|ที่ปรึกษา|ออกแบบระบบ/.test(norm)) {
      const m = norm.match(/(ให้บริการ[^\n,.?]{0,80}?(?=\s+แก่|\s+ซึ่ง|\s+โดย|$)|บำรุงรักษาซอฟต์แวร์[^\n,.?]{0,40}?(?=\s+แก่|\s+จาก|$))/);
      upsertFact(factsMap, overrides, {
        fact_key: "vat_transaction_type",
        label_th: "ประเภทธุรกรรมภาษีมูลค่าเพิ่ม",
        original_text_th: m ? m[1].trim() : "การให้บริการในราชอาณาจักร",
        normalized_category: "VAT_PROVISION_OF_SERVICE",
        source_turn: turnNumber,
      });
    }

    // Service place-of-use extraction via the shared 6-state classifier:
    // strictly records ONLY the stated location(s), leaves unstated remainders unknown,
    // keeps explicit use in both locations as MIXED, and never routes from foreign customer address.
    const extractedPlace = extractServiceUseLocationFromText(norm);
    if (extractedPlace) {
      upsertFact(factsMap, overrides, {
        fact_key: "vat_place_of_use",
        label_th: "สถานที่ที่มีการใช้บริการ",
        original_text_th: extractedPlace.original_text_th,
        normalized_category: extractedPlace.category,
        source_turn: turnNumber,
      });
      // Replace any prior place-of-use unknown note cleanly so follow-up overrides stay in sync.
      for (const note of Array.from(unknownFacts)) {
        if (/สถานที่ที่มีการใช้บริการ/.test(note)) unknownFacts.delete(note);
      }
      const unknownNote = buildUnknownServiceUseFactNoteTh(
        extractedPlace.category,
        extractedPlace.original_text_th
      );
      if (unknownNote) {
        unknownFacts.add(unknownNote);
      }
    }

    if (/ผู้ประกอบการจดทะเบียน\s*(?:VAT|ภาษีมูลค่าเพิ่ม)/i.test(norm)) {
      upsertFact(factsMap, overrides, {
        fact_key: "vat_registrant_status",
        label_th: "สถานะผู้ประกอบการจดทะเบียน VAT",
        original_text_th: "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มในประเทศไทย",
        normalized_category: "THAI_VAT_REGISTERED_OPERATOR",
        source_turn: turnNumber,
      });
    }

    // 6. Amounts & declared goods lot schedules
    // Prevent a follow-up restating a single lot's existing value (e.g. "เฉพาะล็อต C มูลค่า 10,000 บาท")
    // from overwriting the overall transaction total (`50,000 บาท`) unless a total-price override cue is stated.
    const isSingleLotFollowUpAmountMention =
      turnNumber >= 2 &&
      declaredLotsMap.size >= 2 &&
      /(?:ล็อต|ล๊อต|ชุดที่|รายการที่|\blot\b)/i.test(thaiDigitsToArabic(cleaned)) &&
      !/(?:ราคารวม|มูลค่ารวม|ราคาสินค้าทั้งหมด|แก้ราคาขายรวม|เปลี่ยนราคารวม|total\s+(?:price|value|amount))/i.test(
        thaiDigitsToArabic(cleaned)
      );
    if (!isSingleLotFollowUpAmountMention) {
      extractAmountsForTurn(cleaned, turnNumber, factsMap, overrides);
    }
    const turnDeclaredLots = extractDeclaredGoodsLots(cleaned, turnNumber);
    for (const lot of turnDeclaredLots) {
      declaredLotsMap.set(lot.lot_id, lot);
    }

    // 7. Temporal events (with declared lot awareness, negated/boundary-date suppression, and targeted multi-turn date-shift overrides)
    const isImmovableTurn =
      Boolean(factsMap.get("asset")?.normalized_category.startsWith("IMMOVABLE_PROPERTY")) &&
      !/(?:ขายสินค้า|ส่งมอบสินค้า|ส่งมอบของ|ส่งของ|ภาษีมูลค่าเพิ่ม|\bVAT\b)/i.test(norm);
    const activeDeclaredLots = Array.from(declaredLotsMap.values());
    let cleanedForTemporalExtraction = cleaned;
    let appliedDateShiftThisTurn = false;

    if (turnNumber >= 2 && allTemporalEvents.length > 0) {
      const normForShift = thaiDigitsToArabic(cleaned);
      for (const shiftRe of dateShiftPatterns) {
        shiftRe.lastIndex = 0;
        let sm: RegExpExecArray | null;
        while ((sm = shiftRe.exec(normForShift)) !== null) {
          const oldRaw = (sm[1] || "").trim();
          const newRaw = (sm[2] || "").trim();
          const oldIso = parseFlexibleThaiOrEnglishDateToIso(oldRaw);
          const newIso = parseFlexibleThaiOrEnglishDateToIso(newRaw);
          if (!oldIso || !newIso || oldIso === newIso) continue;

          const shiftLotRefs = extractLotReferencesFromClause(sm[0], activeDeclaredLots);
          const targetedLots =
            !shiftLotRefs.coversAllLots && shiftLotRefs.coveredLotIds.length > 0
              ? new Set(shiftLotRefs.coveredLotIds)
              : null;

          const shiftClause = sm[0];
          const isAllEventsShift = /(?:เหตุการณ์ทั้งหมด|\ball\s+events?\b)/i.test(shiftClause);
          const targetedShiftEventTypes = new Set<TemporalEventKind>();
          if (!isAllEventsShift) {
            if (/(?:ใบกำกับ(?:ภาษี)?|invoice)/i.test(shiftClause)) {
              targetedShiftEventTypes.add("INVOICE");
            }
            if (/(?:รับชำระ|ชำระ|payment|paid)/i.test(shiftClause)) {
              targetedShiftEventTypes.add("PAYMENT");
            }
            if (/(?:ส่งมอบ|delivery)/i.test(shiftClause)) {
              targetedShiftEventTypes.add("DELIVERY");
            }
            if (/(?:โอนกรรมสิทธิ์|ownership|title)/i.test(shiftClause)) {
              targetedShiftEventTypes.add("OWNERSHIP_TRANSFER");
            }
            if (/(?:ใช้(?:ผล(?:ของ)?)?บริการ|service\s+use)/i.test(shiftClause)) {
              targetedShiftEventTypes.add("SERVICE_USE");
            }
          }

          let shiftedAny = false;
          for (let ei = 0; ei < allTemporalEvents.length; ei++) {
            const ev = allTemporalEvents[ei];
            if (ev.iso_date !== oldIso) continue;
            if (
              targetedShiftEventTypes.size > 0 &&
              !targetedShiftEventTypes.has(ev.event_type)
            ) {
              continue;
            }
            if (targetedLots) {
              const evLots = ev.covered_lot_ids || [];
              if (evLots.length > 0 && !evLots.some((id) => targetedLots.has(id))) {
                continue;
              }
            }
            shiftedAny = true;
            allTemporalEvents[ei] = {
              ...ev,
              iso_date: newIso,
              raw_text: newRaw,
              source_turn: turnNumber,
              provenance_clause_th: `[แก้ไขวันที่จาก ${oldRaw} เป็น ${newRaw} (Turn ${turnNumber})] ${ev.provenance_clause_th || ""}`
                .trim()
                .slice(0, 180),
            };
          }
          for (let ni = 0; ni < nonOccurringEvents.length; ni++) {
            if (nonOccurringEvents[ni].iso_date === oldIso) {
              nonOccurringEvents[ni] = {
                ...nonOccurringEvents[ni],
                iso_date: newIso,
                raw_date: newRaw,
                source_turn: turnNumber,
              };
            }
          }
          if (shiftedAny) {
            appliedDateShiftThisTurn = true;
            overrides.push({
              fact_key: `event_date_override:${oldIso}`,
              from_text_th: oldRaw,
              from_turn: Math.max(1, turnNumber - 1),
              to_text_th: newRaw,
              to_turn: turnNumber,
            });
            cleanedForTemporalExtraction = thaiDigitsToArabic(cleanedForTemporalExtraction).replace(
              sm[0],
              " "
            );
          }
        }
      }
    }
    latestTurnWasDateShiftOverride = appliedDateShiftThisTurn;

    const turnDates = extractDatesWithEventKinds(cleanedForTemporalExtraction, turnNumber, {
      isImmovableTurn,
      declaredLots: activeDeclaredLots,
      nonOccurringOut: nonOccurringEvents,
    });
    // On a follow-up correction turn that replaces targeted PAYMENT/INVOICE event date(s) without repeating
    // the old date (e.g. "ขอแก้ไขข้อเท็จจริงว่า การออกใบกำกับภาษีและการได้รับชำระค่าบริการเปลี่ยนเป็นวันที่ 1 ตุลาคม 2569 แทน"),
    // replace ONLY those targeted prior event types on a single-event non-lot/non-installment transaction,
    // preserving genuinely dated earlier SERVICE_USE events and unrelated installments!
    const isSingleTurnTargetedEventReplacement =
      turnNumber >= 2 &&
      !appliedDateShiftThisTurn &&
      activeDeclaredLots.length < 2 &&
      turnDates.length > 0 &&
      /(?:ขอแก้|แก้ไข|เปลี่ยนเป็น|เลื่อนเป็น|แทน(?:ที่)?|correction|instead|changed\s+to|moved\s+to)/i.test(
        thaiDigitsToArabic(cleaned)
      );
    if (isSingleTurnTargetedEventReplacement) {
      const replacedTypes = new Set(
        turnDates
          .filter((e) => e.event_type === "PAYMENT" || e.event_type === "INVOICE")
          .map((e) => e.event_type)
      );
      if (replacedTypes.size > 0) {
        const distinctPriorPayDates = new Set(
          allTemporalEvents
            .filter((e) => e.event_type === "PAYMENT" && e.source_turn < turnNumber)
            .map((e) => e.iso_date)
        );
        // Only auto-replace when not a multi-installment schedule (preserving unrelated installments!)
        if (distinctPriorPayDates.size <= 1) {
          for (let ei = allTemporalEvents.length - 1; ei >= 0; ei--) {
            const prevEv = allTemporalEvents[ei];
            if (prevEv.source_turn < turnNumber && replacedTypes.has(prevEv.event_type)) {
              allTemporalEvents.splice(ei, 1);
            }
          }
          latestTurnWasDateShiftOverride = true;
        }
      }
    }
    allTemporalEvents.push(...turnDates);

    // 8. Explicitly stated unknown facts
    const unknownMatches =
      thaiDigitsToArabic(raw).match(
        /(?:ยังไม่ทราบ(?:ว่า)?|ไม่ทราบ(?:ว่า)?|โดยไม่ระบุ(?:ว่า)?|ไม่ระบุ(?:ว่า)?|ยังไม่ชัดเจน(?:ว่า)?|ไม่มีข้อมูล(?:เรื่อง|ว่า)?)([^?。\n]+)/g
      ) || [];
    for (const um of unknownMatches) {
      unknownFacts.add(um.trim());
    }
  }

  // Extract questions asked on the final (active) turn
  const activeTurnRaw = allUserTurns[allUserTurns.length - 1].raw_text;
  const qParts = activeTurnRaw
    .split(/(?<=[?？])|\s+(?=และ(?:ต้อง|หลาน|ส่วน|ผู้|ภาระ))/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && /(?:อย่างไร|เท่าใด|เท่าไหร่|หรือไม่|หรือ|ใช่หรือไม่|ร้อยละ|ต้องเสีย|ต้องหัก|ผลจะเป็น)/.test(s));
  if (qParts.length > 0) {
    questionsAsked.push(...qParts);
  } else {
    questionsAsked.push(activeTurnRaw);
  }

  // Three-way temporal resolution:
  // 1) transaction_or_event_dates (all dated events across turns, keeping latest turn override if same event_type)
  // 2) legal_as_of_date (explicit req.applicableDate, or explicit `ปีภาษี 25XX` on pure §47 allowance queries — never silently fabricated!)
  // 3) controlling_tax_point (derived strictly from statutory event rules without guessing when ambiguous!)
  const s47TaxYearFact = factsMap.get("s47_tax_year");
  const legalAsOfDate = input.applicableDate ?? (s47TaxYearFact ? s47TaxYearFact.original_text_th : null);

  const isVatCase = factsMap.has("vat_transaction_type") || /ภาษีมูลค่าเพิ่ม|VAT/i.test(allUserTurns.map((t) => t.raw_text).join(" "));
  const nonQuestionDates = allTemporalEvents.filter((e) => e.event_type !== "QUESTION_DATE");
  const latestTurnNumber = allUserTurns.length;
  const latestTurnNonQuestionDates = nonQuestionDates.filter((e) => e.source_turn === latestTurnNumber);

  let controllingIso: string | null = null;
  let controllingEvent: string | null = null;
  let statutoryRuleHint: string | null = null;
  let isAmbiguous = false;
  let ambiguityReasonTh: string | null = null;
  let isSplitPaymentMultiTaxPoint = false;
  let splitPaymentTaxPoints: SplitPaymentTaxPointItem[] | undefined = undefined;
  let vatPortionAllocationRecord: VerifiedGoodsVatAllocationRecord | undefined = undefined;
  const declaredGoodsLots = Array.from(declaredLotsMap.values());

  const mergedAllUserText = allUserTurns.map((t) => t.raw_text).join(" ");
  const explicitUnknownDateInPrompt =
    /ยังไม่ทราบวันที่|ยังไม่ได้กำหนดวัน|ไม่ระบุวันที่|date\s+(?:is\s+)?unknown/i.test(
      mergedAllUserText
    );
  const hasSplitPaymentWording =
    /(?:มัดจำ|งวดแรก|งวดที่\s*1|งวดที่\s*2|งวดที่สอง|แบ่งชำระ|แบ่งจ่าย|ส่วนที่เหลือ|ชำระบางส่วน|2\s*งวด|สองงวด|หลายงวด|split[\s-]?payment|installment|deposit|milestone)/i.test(
      thaiDigitsToArabic(mergedAllUserText)
    );
  const hasSeparateInvoicePerInstallmentWording =
    /(?:ออกใบกำกับภาษี(?:แยก)?(?:ตาม|แต่ละ)งวด|ออกใบกำกับภาษีเมื่อรับชำระแต่ละงวด|separate\s+invoice(?:s)?\s+per\s+installment)/i.test(
      thaiDigitsToArabic(mergedAllUserText)
    );
  const vatWindowBucket = (iso: string): string => {
    if (iso >= "2024-10-01" && iso <= "2025-09-30") return "RD_790";
    if (iso >= "2025-10-01" && iso <= "2026-09-30") return "RD_799";
    if (iso >= "2026-10-01" && iso <= "2027-09-30") return "RD_807";
    if (iso > "2027-09-30") return "POST_807";
    if (iso >= "2023-10-01" && iso <= "2024-09-30") return "RD_780";
    return "PRE_CUTOFF_BEFORE_2023_10_01";
  };
  const governingDecreeWorkIdForIso = (iso: string): string | null => {
    if (iso >= "2023-10-01" && iso <= "2024-09-30") return "subreg.th.rc.royal_decree.780";
    if (iso >= "2024-10-01" && iso <= "2025-09-30") return "subreg.th.rc.royal_decree.790";
    if (iso >= "2025-10-01" && iso <= "2026-09-30") return "subreg.th.rc.royal_decree.799";
    if (iso >= "2026-10-01" && iso <= "2027-09-30") return "subreg.th.rc.royal_decree.807";
    return null;
  };

  // Detect split-payment / partial-invoice / multi-installment VAT transactions BEFORE single-tax-point selection:
  // 1) Under Revenue Code §78/1(1) ("ตามส่วนของการกระทำนั้นๆ"), a prior tax invoice fixes the tax point
  //    for the WHOLE transaction ONLY if it covers the FULL transaction (not partial coverage!).
  // 2) If a prior tax invoice covers only PART of the service (e.g. ฿40,000 of ฿100,000), the invoiced
  //    portion's tax point is fixed at the invoice date (and its later payment is settlement only — NOT
  //    a second VAT tax point!), while the uninvoiced remainder's tax point arises upon payment!
  // 3) Otherwise, when >= 2 distinct payment/portion dates exist, NEVER collapse to the earlier date
  //    for the whole transaction: assign authority and validity per tax point!
  const normMergedAll = thaiDigitsToArabic(mergedAllUserText);
  const allMentionedAmountsThb: number[] = [];
  for (const am of normMergedAll.matchAll(
    /(?:(?:THB|฿)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)|([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท))/gi
  )) {
    const rawNum = (am[1] || am[2] || "").replace(/,/g, "");
    const n = Number(rawNum);
    if (!Number.isFinite(n) || n <= 0) continue;
    allMentionedAmountsThb.push(am[3] === "ล้านบาท" ? n * 1_000_000 : n);
  }
  const maxMentionedAmountThb =
    allMentionedAmountsThb.length > 0 ? Math.max(...allMentionedAmountsThb) : 0;

  // When a multi-turn follow-up on a declared multi-lot goods sale updates a specific event (e.g. reassigning
  // which lot a 30 Sep payment/invoice covers while keeping unchanged prior-turn events intact), merge the
  // latest turn's updated `(event_type, iso_date)` events over the prior turns instead of dropping untouched lots!
  const isMultiTurnLotEventPartialUpdate = Boolean(
    allUserTurns.length >= 2 &&
      declaredGoodsLots.length >= 2 &&
      latestTurnNonQuestionDates.length > 0 &&
      !latestTurnNonQuestionDates.some((e) => e.event_type === "DELIVERY" || e.is_goods_delivery) &&
      nonQuestionDates.some(
        (e) => e.source_turn < latestTurnNumber && (e.event_type === "DELIVERY" || e.is_goods_delivery)
      )
  );
  const effectiveVatDateSource: PreservedTemporalEvent[] = latestTurnWasDateShiftOverride
    ? nonQuestionDates
    : isMultiTurnLotEventPartialUpdate
      ? (() => {
          const eventMergeKey = (e: PreservedTemporalEvent) =>
            `${e.event_type}:${e.iso_date}:${(e.covered_lot_ids || []).join(",")}`;
          const updatedKeys = new Set(latestTurnNonQuestionDates.map(eventMergeKey));
          const updatedLotEventTypes = new Set(
            latestTurnNonQuestionDates.flatMap((e) =>
              (e.covered_lot_ids || []).map((lid) => `${e.event_type}:${lid}`)
            )
          );
          const isExplicitReplacementTurn =
            /(?:แก้ไข(?:เฉพาะ)?|เปลี่ยน(?:เป็น|จาก)|แทน(?:ที่)?)/i.test(
              thaiDigitsToArabic(activeTurnRaw)
            );
          const retainedPrior: PreservedTemporalEvent[] = [];
          for (const e of nonQuestionDates) {
            if (e.source_turn >= latestTurnNumber) continue;
            if (updatedKeys.has(eventMergeKey(e))) continue;
            if (
              isExplicitReplacementTurn &&
              e.covered_lot_ids &&
              e.covered_lot_ids.length > 0 &&
              e.covered_lot_ids.some((lid) => updatedLotEventTypes.has(`${e.event_type}:${lid}`))
            ) {
              const remainingLots = e.covered_lot_ids.filter(
                (lid) => !updatedLotEventTypes.has(`${e.event_type}:${lid}`)
              );
              if (remainingLots.length === 0) continue;
              retainedPrior.push({
                ...e,
                covered_lot_ids: remainingLots,
                portion_coverage:
                  remainingLots.length >= declaredGoodsLots.length ? "FULL" : "PARTIAL",
              });
              continue;
            }
            retainedPrior.push(e);
          }
          return [...retainedPrior, ...latestTurnNonQuestionDates];
        })()
      : latestTurnNonQuestionDates.length > 0
        ? latestTurnNonQuestionDates
        : nonQuestionDates;

  const activeTurnVatDates = effectiveVatDateSource.filter(
    (e) =>
      e.event_type === "OWNERSHIP_TRANSFER" ||
      e.event_type === "DELIVERY" ||
      e.event_type === "PAYMENT" ||
      e.event_type === "INVOICE" ||
      e.event_type === "SERVICE_USE" ||
      e.event_type === "TRANSFER" ||
      e.event_type === "STATED_TRANSACTION_DATE"
  );
  const isImmovableAsset = Boolean(
    factsMap.get("asset")?.normalized_category.startsWith("IMMOVABLE_PROPERTY")
  );
  const isServiceVat =
    factsMap.get("vat_transaction_type")?.normalized_category === "VAT_PROVISION_OF_SERVICE";
  const isExportVat =
    factsMap.get("vat_transaction_type")?.normalized_category === "VAT_EXPORT_OF_GOODS";
  const isHirePurchaseGoods = /เช่าซื้อ|hire[\s-]?purchase/i.test(normMergedAll);
  const hasGoodsSaleSignal =
    /(?:ขายสินค้า|ซื้อขายสินค้า|ส่งมอบสินค้า|ส่งมอบของ|ส่งของ|ส่งสินค้า(?!ออก)|โอนกรรมสิทธิ์(?:ใน)?สินค้า|ราคาสินค้า|ค่าสินค้า|sale\s+of\s+goods|sell(?:s|ing)?\s+goods|deliver(?:y|ed|s)?\s+(?:of\s+)?(?:the\s+)?goods)/i.test(
      normMergedAll
    ) ||
    activeTurnVatDates.some(
      (e) =>
        e.is_goods_delivery ||
        e.event_type === "DELIVERY" ||
        e.event_type === "OWNERSHIP_TRANSFER"
    );
  const isDomesticGoodsSale = Boolean(
    isVatCase &&
      !isServiceVat &&
      !isExportVat &&
      !isImmovableAsset &&
      !isHirePurchaseGoods &&
      hasGoodsSaleSignal
  );

  // Establish independently stated total goods price (never mistaking a single partial advance figure for the total!)
  let statedGoodsTotalThb: number | null = null;
  for (const gm of normMergedAll.matchAll(
    /(?:ขายสินค้า[^\n,.;]{0,65}?(?:ใน)?ราคา(?:รวม)?|ราคารวม(?:ทั้งสิ้น)?|ราคาสินค้า(?:ทั้งหมด|รวม)?(?:\s*ก่อน[^\n,.;]{0,25})?\s*(?:คือ|จำนวน|เท่ากับ)?|ค่าสินค้า(?:\s*ก่อน[^\n,.;]{0,25})?\s*(?:คือ|จำนวน|เท่ากับ)?|มูลค่าสินค้า(?:รวม|ทั้งหมด)?)\s*(?:THB|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท)?/gi
  )) {
    const n = Number((gm[1] || "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) {
      statedGoodsTotalThb = gm[2] === "ล้านบาท" ? n * 1_000_000 : n;
    }
  }
  const goodsReferenceTotalThb =
    statedGoodsTotalThb ??
    (allMentionedAmountsThb.filter((a) => Math.abs(a - maxMentionedAmountThb) < 1).length >= 2
      ? maxMentionedAmountThb
      : 0);

  if (isDomesticGoodsSale && goodsReferenceTotalThb > 0) {
    for (const ev of activeTurnVatDates) {
      if (
        ev.event_type !== "OWNERSHIP_TRANSFER" &&
        ev.event_type !== "PAYMENT" &&
        ev.event_type !== "INVOICE" &&
        ev.event_type !== "DELIVERY"
      ) {
        continue;
      }
      if (ev.portion_coverage === "FULL") {
        if (ev.amount_thb == null || ev.amount_thb <= 0) {
          ev.amount_thb = goodsReferenceTotalThb;
        }
      } else if (typeof ev.amount_thb === "number" && ev.amount_thb > 0) {
        if (ev.amount_thb < goodsReferenceTotalThb - 1) {
          ev.portion_coverage = "PARTIAL";
        } else if (ev.portion_coverage !== "PARTIAL") {
          ev.portion_coverage = "FULL";
        }
      } else if (ev.portion_coverage === "PARTIAL" && ev.amount_thb == null && ev.provenance_clause_th) {
        if (/ครึ่งหนึ่ง|half\s+of/i.test(ev.provenance_clause_th)) {
          ev.amount_thb = Math.round(goodsReferenceTotalThb * 0.5 * 100) / 100;
        } else {
          const pctM = ev.provenance_clause_th.match(
            /(?:สัดส่วน|คิดเป็น|จำนวน)\s*ร้อยละ\s*([1-9][0-9]?(?:\.[0-9]+)?)|([1-9][0-9]?(?:\.[0-9]+)?)\s*%\s*ของ(?:สินค้า|มูลค่า|ราคา)/i
          );
          const pct = pctM ? Number(pctM[1] || pctM[2]) : NaN;
          if (Number.isFinite(pct) && pct > 0 && pct < 100) {
            ev.amount_thb = Math.round(goodsReferenceTotalThb * (pct / 100) * 100) / 100;
          }
        }
      }
    }
  }

  const activeInvoicesSorted = activeTurnVatDates
    .filter((e) => e.event_type === "INVOICE")
    .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
  const activePaymentsSorted = activeTurnVatDates
    .filter((e) => e.event_type === "PAYMENT")
    .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
  const activeServiceUseSorted = activeTurnVatDates
    .filter((e) => e.event_type === "SERVICE_USE")
    .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
  const hasEarlierServiceUseBeforeInvoice = Boolean(
    activeServiceUseSorted.length > 0 &&
      activeInvoicesSorted.length > 0 &&
      activeServiceUseSorted[0].iso_date < activeInvoicesSorted[0].iso_date
  );
  const distinctPaymentDateCount = new Set(activePaymentsSorted.map((e) => e.iso_date)).size;
  const sumPaymentAmountsThb = activePaymentsSorted.reduce(
    (sum, e) => sum + (typeof e.amount_thb === "number" ? e.amount_thb : 0),
    0
  );
  const referenceTotalThb = Math.max(maxMentionedAmountThb, sumPaymentAmountsThb);

  const hasExplicitPartialInvoiceWording =
    /(?:ออกใบกำกับภาษี(?:เฉพาะ)?(?:บางส่วน|งวดแรก|งวดที่\s*1|เพียง|แค่|สำหรับส่วน|สำหรับงวด)|ใบกำกับภาษี(?:เฉพาะ)?บางส่วน|(?:ไม่|ยังมิ|ยังไม)ได้ออกใบกำกับภาษีสำหรับ(?:ส่วนที่เหลือ|ยอด)|invoice(?:d)?\s+(?:for\s+)?only|only\s+(?:THB|฿)?\s*[0-9,]+\s+invoiced|partial\s+(?:tax\s+)?invoice)/i.test(
      normMergedAll
    );
  const hasExplicitFullInvoiceWording =
    /(?:ออกใบกำกับภาษี(?:เต็มจำนวน|ทั้งจำนวน|ครบทั้งจำนวน|เต็มมูลค่า|รวมทั้งสิ้น)|full\s+(?:tax\s+)?invoice|invoiced\s+(?:the\s+)?(?:full|entire)\s+amount)/i.test(
      normMergedAll
    );
  const hasExplicitUnstatedCoverageWording =
    /(?:ไม่(?:ได้)?ระบุว่า(?:ออกใบกำกับภาษี)?(?:เต็มจำนวน|บางส่วน)|ไม่ทราบ(?:มูลค่า|จำนวน)ใบกำกับภาษี|without\s+stating\s+(?:whether|if)\s+it\s+covers|coverage\s+(?:is\s+)?(?:not\s+stated|unstated|unknown))/i.test(
      normMergedAll
    );
  const hasExplicitUnstatedAllocationWording =
    /(?:ไม่(?:ได้)?ระบุว่า(?:ยอดชำระ|งวด|การชำระ)(?:ใด|ไหน)(?:เป็นการ)?ชำระ(?:ตาม|สำหรับ)ใบกำกับภาษี|ไม่(?:ได้)?ระบุการจัดสรร|with\s+no\s+stated\s+allocation|no\s+stated\s+allocation|without\s+(?:stating|specifying)\s+which\s+payment)/i.test(
      normMergedAll
    );

  const singlePriorInvoiceCandidate = Boolean(
    isVatCase &&
      !isDomesticGoodsSale &&
      !hasSeparateInvoicePerInstallmentWording &&
      !hasEarlierServiceUseBeforeInvoice &&
      activeInvoicesSorted.length === 1 &&
      activePaymentsSorted.length >= 1 &&
      activeInvoicesSorted[0].iso_date < activePaymentsSorted[0].iso_date
  );
  const priorInvoiceAmt = singlePriorInvoiceCandidate ? (activeInvoicesSorted[0].amount_thb ?? null) : null;
  const priorInvoiceBelowTotal = Boolean(
    priorInvoiceAmt !== null && referenceTotalThb > 0 && priorInvoiceAmt < referenceTotalThb - 1
  );
  // NEVER infer full coverage from invoice count (`distinctPaymentDateCount <= 1`) when coverage is unstated!
  const priorInvoiceCoverageStatus: "FULL" | "PARTIAL" | "UNSTATED" = !singlePriorInvoiceCandidate
    ? "UNSTATED"
    : hasExplicitPartialInvoiceWording || priorInvoiceBelowTotal
      ? "PARTIAL"
      : hasExplicitUnstatedCoverageWording
        ? "UNSTATED"
        : hasExplicitFullInvoiceWording ||
            (priorInvoiceAmt !== null && referenceTotalThb > 0 && priorInvoiceAmt >= referenceTotalThb - 1)
          ? "FULL"
          : "UNSTATED";

  const priorInvoiceAllSameVerifiedWindow = Boolean(
    singlePriorInvoiceCandidate &&
      activeInvoicesSorted[0].iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO &&
      activePaymentsSorted.every(
        (p) =>
          p.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO &&
          vatWindowBucket(p.iso_date) === vatWindowBucket(activeInvoicesSorted[0].iso_date)
      )
  );
  // If coverage is unstated AND all dates fall in the SAME verified decree window (with 1 payment),
  // facts ARE sufficient to answer the governing decree and rate without unnecessarily declining.
  // If coverage is unstated AND dates span DIFFERENT decree windows (or cutoff/expiry, or multi-date payments),
  // the missing coverage fact changes the governing authority -> DO NOT collapse; surface conditional branches!
  const isUnstatedCoverageMateriallyConditional = Boolean(
    singlePriorInvoiceCandidate &&
      priorInvoiceCoverageStatus === "UNSTATED" &&
      !(priorInvoiceAllSameVerifiedWindow && distinctPaymentDateCount === 1)
  );
  const priorInvoiceFixesWholeTaxPoint = Boolean(
    singlePriorInvoiceCandidate &&
      (priorInvoiceCoverageStatus === "FULL" ||
        (priorInvoiceCoverageStatus === "UNSTATED" &&
          priorInvoiceAllSameVerifiedWindow &&
          distinctPaymentDateCount === 1))
  );
  const isPartialPriorInvoiceMultiTaxPoint = Boolean(
    singlePriorInvoiceCandidate &&
      priorInvoiceCoverageStatus === "PARTIAL" &&
      distinctPaymentDateCount >= 1
  );

  const distinctActiveVatDatesByIso = new Map<string, PreservedTemporalEvent>();
  for (const ev of [...activeTurnVatDates].sort((a, b) => a.iso_date.localeCompare(b.iso_date))) {
    if (!distinctActiveVatDatesByIso.has(ev.iso_date)) {
      distinctActiveVatDatesByIso.set(ev.iso_date, ev);
    }
  }
  const detectedSplitPayment =
    isVatCase &&
    !priorInvoiceFixesWholeTaxPoint &&
    !isPartialPriorInvoiceMultiTaxPoint &&
    !isUnstatedCoverageMateriallyConditional &&
    distinctActiveVatDatesByIso.size >= 2 &&
    (hasSplitPaymentWording || distinctPaymentDateCount >= 2);

  // Candidate 8 & Candidate 9 — Sale of goods (Revenue Code §78(1)):
  // The tax point is delivery (`ส่งมอบสินค้า`), unless before delivery there is:
  //   (ก) actual transfer of ownership in the goods (`OWNERSHIP_TRANSFER`),
  //   (ข) receipt of payment (`PAYMENT`), or
  //   (ค) issuance of a tax invoice (`INVOICE`),
  // in which case liability arises upon that earlier act strictly for the portion it covers ("ตามส่วนของการกระทำนั้นๆ"),
  // without double-taxing that same portion on later delivery/payment/invoicing, without requiring a duplicate
  // payment amount on an explicit full-goods title transfer, and without guessing or defaulting to delivery when an
  // earlier event's coverage is unknown across decree windows.
  const goodsDeliveries = activeTurnVatDates
    .filter((e) => e.is_goods_delivery || e.event_type === "DELIVERY")
    .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
  const goodsDelivery = goodsDeliveries[0];
  const goodsEarlyActs = goodsDelivery
    ? activeTurnVatDates
        .filter(
          (e) =>
            (e.event_type === "OWNERSHIP_TRANSFER" ||
              e.event_type === "PAYMENT" ||
              e.event_type === "INVOICE") &&
            !e.is_goods_delivery &&
            e.iso_date < goodsDelivery.iso_date
        )
        .sort((a, b) => {
          const cmp = a.iso_date.localeCompare(b.iso_date);
          if (cmp !== 0) return cmp;
          const rank = (k: TemporalEventKind) =>
            k === "OWNERSHIP_TRANSFER" ? 0 : k === "PAYMENT" ? 1 : 2;
          return rank(a.event_type) - rank(b.event_type);
        })
    : [];

  const earliestEarlyIso = goodsEarlyActs[0]?.iso_date ?? null;
  const earliestFullAct = earliestEarlyIso
    ? goodsEarlyActs.find(
        (e) => e.iso_date === earliestEarlyIso && e.portion_coverage === "FULL"
      )
    : undefined;
  const goodsEarlyActsCoverWhole = Boolean(earliestFullAct);
  const goodsEarlyActsSameWindow =
    goodsDelivery !== undefined &&
    goodsDelivery.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO &&
    goodsEarlyActs.every(
      (e) =>
        e.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO &&
        vatWindowBucket(e.iso_date) === vatWindowBucket(goodsDelivery.iso_date)
    );

  const computeVerifiedVatForDateAndBase = (
    iso: string,
    baseThb: number
  ): { ratePct: number | null; vatThb: number | null; grossThb: number | null } => {
    const within = iso >= VAT_RATE_VERIFIED_COVERAGE_START_ISO;
    const govWid = governingDecreeWorkIdForIso(iso);
    if (!within || !govWid || !Number.isFinite(baseThb) || baseThb <= 0) {
      return { ratePct: null, vatThb: null, grossThb: null };
    }
    const vatThb = Math.round(baseThb * 0.07 * 100) / 100;
    const grossThb = Math.round((baseThb + vatThb) * 100) / 100;
    return { ratePct: 7, vatThb, grossThb };
  };

  // Group unnamed early acts into distinct clause units (co-occurring payment+invoice in the same local clause = 1 unit;
  // two separate acts on different dates or separate clauses = 2 units unless explicitly linked as same/distinct goods).
  const unnamedEarlyActUnits: PreservedTemporalEvent[] = [];
  if (declaredGoodsLots.length < 2 && goodsDelivery && goodsEarlyActs.length > 0 && !goodsEarlyActsCoverWhole) {
    const seenUnitKeys = new Set<string>();
    for (const ea of goodsEarlyActs) {
      const unitKey = `${ea.iso_date}|${(ea.provenance_clause_th || "").slice(0, 60)}`;
      if (seenUnitKeys.has(unitKey)) continue;
      seenUnitKeys.add(unitKey);
      unnamedEarlyActUnits.push(ea);
    }
  }
  const hasExplicitAmbiguousOverlapWording =
    /(?:ไม่(?:ได้)?ระบุว่า[^.;?]{0,80}(?:ส่วนเดียว(?:กัน)?|ล็อตเดียว(?:กัน)?|สินค้าเดิม)[^.;?]{0,40}หรือ[^.;?]{0,40}(?:คนละส่วน|คนละล็อต|แยกต่างหาก)|ยังไม่ชัดเจนว่า[^.;?]{0,60}(?:ซ้ำซ้อน|ส่วนเดียวกัน|คนละส่วน)|without\s+stating\s+whether[^.;?]{0,60}(?:same|separate|distinct))/i.test(
      normMergedAll
    );
  const unnamedMultiEarlyOverlapAmbiguous = Boolean(
    declaredGoodsLots.length < 2 &&
      unnamedEarlyActUnits.length >= 2 &&
      (hasExplicitAmbiguousOverlapWording ||
        unnamedEarlyActUnits
          .slice(1)
          .some((u) => !u.is_explicit_same_goods_repeat && !u.is_explicit_distinct_goods))
  );
  const resolvedUnnamedEarlyPortions: PreservedTemporalEvent[] = unnamedMultiEarlyOverlapAmbiguous
    ? []
    : unnamedEarlyActUnits.length >= 2 &&
        unnamedEarlyActUnits.slice(1).every((u) => Boolean(u.is_explicit_same_goods_repeat))
      ? [unnamedEarlyActUnits[0]]
      : unnamedEarlyActUnits;

  const allEarlyPartialAmountsKnown =
    declaredGoodsLots.length < 2 &&
    !unnamedMultiEarlyOverlapAmbiguous &&
    goodsReferenceTotalThb > 0 &&
    resolvedUnnamedEarlyPortions.length > 0 &&
    resolvedUnnamedEarlyPortions.every(
      (ea) =>
        ea.portion_coverage === "PARTIAL" &&
        typeof ea.amount_thb === "number" &&
        ea.amount_thb > 0
    );
  const earlyPartialKnownSumThb = allEarlyPartialAmountsKnown
    ? resolvedUnnamedEarlyPortions.reduce((s, ea) => s + (ea.amount_thb ?? 0), 0)
    : 0;
  const isKnownPartialGoodsSplit =
    allEarlyPartialAmountsKnown && earlyPartialKnownSumThb <= goodsReferenceTotalThb + 1;
  const hasDeclaredMultiLotGoods = Boolean(
    isDomesticGoodsSale && goodsDelivery && declaredGoodsLots.length >= 2
  );

  const isGoodsDeliveryTaxPoint = Boolean(
    isDomesticGoodsSale &&
      goodsDelivery &&
      // Keep multi-installment pure deposit splits without delivery-anchored portion facts on the split path ONLY when
      // neither declared lots nor full coverage nor known-partial goods split nor overlap ambiguity applies.
      !(
        !hasDeclaredMultiLotGoods &&
        !unnamedMultiEarlyOverlapAmbiguous &&
        goodsEarlyActs.length > 0 &&
        hasSplitPaymentWording &&
        !goodsEarlyActsCoverWhole &&
        !isKnownPartialGoodsSplit &&
        resolvedUnnamedEarlyPortions.some((e) => e.event_type === "PAYMENT") &&
        distinctPaymentDateCount >= 2 &&
        !goodsEarlyActs.some((e) => e.event_type === "OWNERSHIP_TRANSFER")
      )
  );

  const goodsEventActionTh = (k: TemporalEventKind): string =>
    k === "OWNERSHIP_TRANSFER"
      ? "โอนกรรมสิทธิ์ในสินค้า"
      : k === "PAYMENT"
        ? "รับชำระราคาสินค้า"
        : k === "DELIVERY"
          ? "ส่งมอบสินค้า"
          : "ออกใบกำกับภาษี";
  const goodsEventSubclauseTh = (k: TemporalEventKind): string =>
    k === "OWNERSHIP_TRANSFER"
      ? "มาตรา 78 (1) (ก)"
      : k === "PAYMENT"
        ? "มาตรา 78 (1) (ข)"
        : k === "DELIVERY"
          ? "มาตรา 78 (1)"
          : "มาตรา 78 (1) (ค)";

  if (isGoodsDeliveryTaxPoint && goodsDelivery) {
    if (goodsEarlyActs.length === 0) {
      controllingIso = goodsDelivery.iso_date;
      controllingEvent = `GOODS_DELIVERY (${goodsDelivery.raw_text}, Turn ${goodsDelivery.source_turn})`;
      // Build explanatory text strictly from the ACTUAL positive events recorded on each date —
      // same-day title and delivery alone NEVER imply same-day invoicing or payment!
      const sameDayEventKinds = Array.from(
        new Set(
          activeTurnVatDates
            .filter(
              (e) =>
                e.iso_date === goodsDelivery.iso_date &&
                (e.event_type === "OWNERSHIP_TRANSFER" ||
                  e.event_type === "DELIVERY" ||
                  e.event_type === "PAYMENT" ||
                  e.event_type === "INVOICE")
            )
            .map((e) => e.event_type)
        )
      );
      const laterEvents = activeTurnVatDates
        .filter(
          (e) =>
            e.iso_date > goodsDelivery.iso_date &&
            (e.event_type === "OWNERSHIP_TRANSFER" ||
              e.event_type === "PAYMENT" ||
              e.event_type === "INVOICE")
        )
        .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
      const sameDayLabels = sameDayEventKinds.map((k) => `การ${goodsEventActionTh(k)}`);
      const laterLabels = laterEvents.map(
        (e) => `การ${goodsEventActionTh(e.event_type)} (วันที่ ${e.iso_date})`
      );
      const sameDaySummary =
        sameDayLabels.length >= 2
          ? `${sameDayLabels.join(" และ")}สำหรับสินค้าเดียวกันเกิดขึ้นในวันที่ ${goodsDelivery.iso_date}`
          : `การส่งมอบสินค้าเกิดขึ้นในวันที่ ${goodsDelivery.iso_date}`;
      const laterSummary =
        laterLabels.length > 0
          ? ` ส่วน${laterLabels.join(" และ")}ในภายหลังสำหรับสินค้าเดียวกันไม่เปลี่ยนวันเกิดความรับผิดและไม่ก่อให้เกิดภาระภาษีมูลค่าเพิ่มซ้ำ`
          : " ความรับผิดในการเสียภาษีมูลค่าเพิ่มจึงเกิดขึ้นครั้งเดียวในวันที่ดังกล่าวโดยห้ามนับฐานภาษีซ้ำ";
      statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78 (1): ${sameDaySummary} (ไม่มีเหตุการณ์เกิดก่อนวันส่งมอบ) ความรับผิดในการเสียภาษีมูลค่าเพิ่มจึงเกิดขึ้นครั้งเดียวทั้งจำนวนในวันที่ ${goodsDelivery.iso_date}.${laterSummary}`;

      if (
        legalAsOfDate &&
        legalAsOfDate !== controllingIso &&
        vatWindowBucket(legalAsOfDate) !== vatWindowBucket(controllingIso)
      ) {
        isAmbiguous = true;
        ambiguityReasonTh = `วันที่ในคำถาม (${controllingIso}) ขัดแย้งกับวันที่ที่ระบุในคำขอ applicable_date (${legalAsOfDate}) ซึ่งอยู่คนละช่วงวันใช้บังคับของพระราชกฤษฎีกา — กรุณายืนยันวันเกิดความรับผิดทางภาษีที่ถูกต้อง`;
      }
    } else if (hasDeclaredMultiLotGoods) {
      // Candidate 10 — Portion/Lot-First Allocation Engine:
      // 1) Resolve which lot(s) each actual event covers BEFORE grouping by date.
      // 2) For each identified lot, select its single earliest supported trigger under §78(1).
      // 3) Deduplicate subsequent events covering that same lot (no double counting!), while keeping
      //    distinct lots on the same day separate and summing their bases cleanly into that tax date's bucket!
      const unattributedCrossWindowEarlyAct = goodsEarlyActs.find(
        (ea) =>
          (!ea.covered_lot_ids || ea.covered_lot_ids.length === 0) &&
          ea.portion_coverage !== "FULL" &&
          vatWindowBucket(ea.iso_date) !== vatWindowBucket(goodsDelivery.iso_date)
      );
      if (unattributedCrossWindowEarlyAct) {
        isAmbiguous = true;
        controllingIso = null;
        const actLabel = goodsEventActionTh(unattributedCrossWindowEarlyAct.event_type);
        controllingEvent = `GOODS_EARLY_ACT_UNKNOWN_COVERAGE_CONDITIONAL (${unattributedCrossWindowEarlyAct.iso_date}:${unattributedCrossWindowEarlyAct.event_type}:${vatWindowBucket(unattributedCrossWindowEarlyAct.iso_date)} + ${goodsDelivery.iso_date}:DELIVERY:${vatWindowBucket(goodsDelivery.iso_date)})`;
        ambiguityReasonTh = `มีการ${actLabel}ก่อนส่งมอบเมื่อวันที่ ${unattributedCrossWindowEarlyAct.raw_text} (${unattributedCrossWindowEarlyAct.iso_date}) แต่ข้อเท็จจริงยังไม่ระบุว่าครอบคลุมสินค้าล็อตใดบ้าง (${declaredGoodsLots.map((l) => l.label_th).join(", ")}) — กรุณาระบุว่าเหตุการณ์ดังกล่าวครอบคลุมสินค้าล็อตใด`;
        unknownFacts.add(ambiguityReasonTh);
        vatPortionAllocationRecord = {
          transaction_base_thb: goodsReferenceTotalThb,
          allocation_status: "AMBIGUOUS_COVERAGE",
          ambiguity_question_th: ambiguityReasonTh,
          lot_allocations: [],
          tax_date_buckets: [],
          reconciled_total_base_thb: 0,
          reconciled_total_vat_thb: null,
          reconciled_total_gross_thb: null,
          remaining_unallocated_base_thb: goodsReferenceTotalThb,
        };
        statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78 (1): ${ambiguityReasonTh} ห้ามเดาล็อตที่ครอบคลุมและห้ามคำนวณยอดภาษีแยกตามวันที่จนกว่าจะระบุชัดเจน`;
      } else {
        const eventRank = (k: TemporalEventKind) =>
          k === "OWNERSHIP_TRANSFER" ? 0 : k === "PAYMENT" ? 1 : k === "INVOICE" ? 2 : 3;
        const lotAllocations: GoodsLotAllocationItem[] = [];
        for (const lot of declaredGoodsLots) {
          const lotEvents = activeTurnVatDates
            .filter((ev) => {
              if (
                ev.event_type !== "OWNERSHIP_TRANSFER" &&
                ev.event_type !== "PAYMENT" &&
                ev.event_type !== "INVOICE" &&
                ev.event_type !== "DELIVERY"
              ) {
                return false;
              }
              if (ev.explicitly_excluded_lot_ids?.includes(lot.lot_id)) {
                return false;
              }
              if (ev.covered_lot_ids && ev.covered_lot_ids.length > 0) {
                return ev.covered_lot_ids.includes(lot.lot_id);
              }
              return ev.portion_coverage === "FULL" || ev.event_type === "DELIVERY";
            })
            .sort((a, b) => {
              const d = a.iso_date.localeCompare(b.iso_date);
              if (d !== 0) return d;
              return eventRank(a.event_type) - eventRank(b.event_type);
            });
          const primaryEv = lotEvents[0] || goodsDelivery;
          const subsequentNonTaxable = lotEvents
            .slice(1)
            .filter((ev) => ev.iso_date > primaryEv.iso_date)
            .map((ev) => ({
              event_type: ev.event_type,
              iso_date: ev.iso_date,
              raw_text: ev.raw_text,
              provenance_clause_th: ev.provenance_clause_th || "",
              reason_th: `${lot.label_th} เกิดความรับผิดทางภาษีมูลค่าเพิ่มไปแล้วเมื่อวันที่ ${primaryEv.iso_date} (${goodsEventActionTh(primaryEv.event_type)}) — การ${goodsEventActionTh(ev.event_type)}เมื่อวันที่ ${ev.iso_date} สำหรับสินค้าเดิมไม่ก่อให้เกิดภาระภาษีซ้ำ`,
            }));
          const vatCalc = computeVerifiedVatForDateAndBase(primaryEv.iso_date, lot.amount_thb);
          lotAllocations.push({
            lot_id: lot.lot_id,
            label_th: lot.label_th,
            taxable_base_thb: lot.amount_thb,
            controlling_tax_point_iso: primaryEv.iso_date,
            controlling_raw_date_th: primaryEv.raw_text,
            controlling_event_type: primaryEv.event_type,
            statutory_subclause_th: goodsEventSubclauseTh(primaryEv.event_type),
            decree_window: vatWindowBucket(primaryEv.iso_date),
            governing_decree_work_id: governingDecreeWorkIdForIso(primaryEv.iso_date),
            within_verified_coverage: primaryEv.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
            provenance_clause_th: primaryEv.provenance_clause_th || "",
            verified_rate_pct: vatCalc.ratePct,
            verified_vat_thb: vatCalc.vatThb,
            verified_gross_thb: vatCalc.grossThb,
            subsequent_non_taxable_events: subsequentNonTaxable,
          });
        }

        // Group reconciled lot allocations by controlling_tax_point_iso (NEVER merging distinct lots into one base,
        // and NEVER double-counting a lot across dates!)
        const lotsByDate = new Map<string, GoodsLotAllocationItem[]>();
        for (const la of lotAllocations) {
          const arr = lotsByDate.get(la.controlling_tax_point_iso) || [];
          arr.push(la);
          lotsByDate.set(la.controlling_tax_point_iso, arr);
        }
        const sortedDates = Array.from(lotsByDate.keys()).sort((a, b) => a.localeCompare(b));
        const taxDateBuckets: SplitPaymentTaxPointItem[] = sortedDates.map((iso, idx) => {
          const group = lotsByDate.get(iso)!;
          const bucketBase = Math.round(group.reduce((s, l) => s + l.taxable_base_thb, 0) * 100) / 100;
          const vatCalc = computeVerifiedVatForDateAndBase(iso, bucketBase);
          return {
            portion_index: idx + 1,
            iso_date: iso,
            raw_text: group[0].controlling_raw_date_th,
            event_type: group[0].controlling_event_type,
            decree_window: vatWindowBucket(iso),
            within_verified_coverage: iso >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
            governing_decree_work_id: governingDecreeWorkIdForIso(iso),
            expired_or_non_governing_work_ids:
              iso > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
            amount_thb: bucketBase,
            lot_ids: group.map((l) => l.lot_id),
            lot_labels_th: group.map((l) => l.label_th),
            verified_rate_pct: vatCalc.ratePct,
            verified_vat_thb: vatCalc.vatThb,
            verified_gross_thb: vatCalc.grossThb,
          };
        });

        const reconciledBase =
          Math.round(taxDateBuckets.reduce((s, b) => s + (b.amount_thb ?? 0), 0) * 100) / 100;
        const txBase = goodsReferenceTotalThb > 0 ? goodsReferenceTotalThb : reconciledBase;
        const remainingBase = Math.max(0, Math.round((txBase - reconciledBase) * 100) / 100);
        if (remainingBase > 1) {
          const existingDelBucket = taxDateBuckets.find((b) => b.iso_date === goodsDelivery.iso_date);
          if (existingDelBucket) {
            existingDelBucket.amount_thb =
              Math.round(((existingDelBucket.amount_thb ?? 0) + remainingBase) * 100) / 100;
            const updVat = computeVerifiedVatForDateAndBase(
              existingDelBucket.iso_date,
              existingDelBucket.amount_thb
            );
            existingDelBucket.verified_rate_pct = updVat.ratePct;
            existingDelBucket.verified_vat_thb = updVat.vatThb;
            existingDelBucket.verified_gross_thb = updVat.grossThb;
          } else {
            const remVat = computeVerifiedVatForDateAndBase(goodsDelivery.iso_date, remainingBase);
            taxDateBuckets.push({
              portion_index: taxDateBuckets.length + 1,
              iso_date: goodsDelivery.iso_date,
              raw_text: goodsDelivery.raw_text,
              event_type: "DELIVERY",
              decree_window: vatWindowBucket(goodsDelivery.iso_date),
              within_verified_coverage:
                goodsDelivery.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
              governing_decree_work_id: governingDecreeWorkIdForIso(goodsDelivery.iso_date),
              expired_or_non_governing_work_ids:
                goodsDelivery.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
              amount_thb: remainingBase,
              verified_rate_pct: remVat.ratePct,
              verified_vat_thb: remVat.vatThb,
              verified_gross_thb: remVat.grossThb,
            });
          }
        }

        const finalReconciledBase =
          Math.round(taxDateBuckets.reduce((s, b) => s + (b.amount_thb ?? 0), 0) * 100) / 100;
        const allBucketsVerified = taxDateBuckets.every(
          (b) => typeof b.verified_vat_thb === "number" && b.verified_vat_thb > 0
        );
        const totalVatThb = allBucketsVerified
          ? Math.round(taxDateBuckets.reduce((s, b) => s + (b.verified_vat_thb ?? 0), 0) * 100) / 100
          : null;
        const totalGrossThb =
          totalVatThb !== null ? Math.round((finalReconciledBase + totalVatThb) * 100) / 100 : null;

        vatPortionAllocationRecord = {
          transaction_base_thb: txBase,
          allocation_status: "RESOLVED",
          ambiguity_question_th: null,
          lot_allocations: lotAllocations,
          tax_date_buckets: taxDateBuckets,
          reconciled_total_base_thb: finalReconciledBase,
          reconciled_total_vat_thb: totalVatThb,
          reconciled_total_gross_thb: totalGrossThb,
          remaining_unallocated_base_thb: Math.max(
            0,
            Math.round((txBase - finalReconciledBase) * 100) / 100
          ),
        };

        isSplitPaymentMultiTaxPoint = taxDateBuckets.length >= 2;
        splitPaymentTaxPoints = taxDateBuckets;
        controllingIso = taxDateBuckets.length === 1 ? taxDateBuckets[0].iso_date : null;
        controllingEvent = `GOODS_LOT_ALLOCATED_MULTI_TAX_POINT (${taxDateBuckets
          .map(
            (b) =>
              `${b.iso_date}:${(b.lot_ids || []).join("+") || b.event_type}:${b.decree_window}:${b.amount_thb ?? "?"}`
          )
          .join(" | ")})`;
        const bucketSummaries = taxDateBuckets
          .map(
            (b) =>
              `วันที่ ${b.iso_date} (${b.decree_window}): ${(b.lot_labels_th || []).join(" + ")} ฐานภาษี ${(b.amount_thb ?? 0).toLocaleString("en-US")} บาท${
                b.verified_vat_thb !== null && b.verified_vat_thb !== undefined
                  ? ` (VAT 7% = ${b.verified_vat_thb.toLocaleString("en-US")} บาท)`
                  : ""
              }`
          )
          .join("; ");
        const nonTaxableNotes = lotAllocations
          .flatMap((l) => l.subsequent_non_taxable_events.map((s) => s.reason_th))
          .slice(0, 4);
        statutoryRuleHint =
          `ประมวลรัษฎากร มาตรา 78 (1) ("ตามส่วนของการกระทำนั้นๆ") การจัดสรรตามล็อตสินค้า (นับแต่ละล็อตครั้งเดียวตามเหตุการณ์แรกสุดที่เกิดขึ้นและกระทบยอดตรงกับมูลค่ารวม ${finalReconciledBase.toLocaleString("en-US")} บาท): ${bucketSummaries}` +
          (nonTaxableNotes.length > 0 ? ` | ข้อสังเกตห้ามนับซ้ำ: ${nonTaxableNotes.join("; ")}` : "");
      }
    } else if (goodsEarlyActsCoverWhole && earliestFullAct) {
      controllingIso = earliestFullAct.iso_date;
      controllingEvent = `GOODS_${earliestFullAct.event_type}_BEFORE_DELIVERY (${earliestFullAct.raw_text}, Turn ${earliestFullAct.source_turn})`;
      statutoryRuleHint = `ประมวลรัษฎากร ${goodsEventSubclauseTh(earliestFullAct.event_type)}: การขายสินค้าที่มีการ${goodsEventActionTh(earliestFullAct.event_type)}ทั้งหมดก่อนส่งมอบสินค้า ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับสินค้าทั้งหมดเกิดขึ้นเมื่อ${goodsEventActionTh(earliestFullAct.event_type)} (วันที่ ${earliestFullAct.iso_date}) การส่งมอบสินค้า การรับชำระราคา หรือการออกใบกำกับภาษีในภายหลัง (วันที่ ${goodsDelivery.iso_date}) สำหรับสินค้าเดียวกันไม่ก่อให้เกิดความรับผิดซ้ำและห้ามคำนวณภาษีซ้ำ`;
      if (
        legalAsOfDate &&
        legalAsOfDate !== controllingIso &&
        vatWindowBucket(legalAsOfDate) !== vatWindowBucket(controllingIso)
      ) {
        isAmbiguous = true;
        ambiguityReasonTh = `วันที่ในคำถาม (${controllingIso}) ขัดแย้งกับวันที่ที่ระบุในคำขอ applicable_date (${legalAsOfDate}) ซึ่งอยู่คนละช่วงวันใช้บังคับของพระราชกฤษฎีกา — กรุณายืนยันวันเกิดความรับผิดทางภาษีที่ถูกต้อง`;
      }
    } else if (unnamedMultiEarlyOverlapAmbiguous) {
      const condEvents: PreservedTemporalEvent[] = [...unnamedEarlyActUnits, goodsDelivery];
      isSplitPaymentMultiTaxPoint = true;
      splitPaymentTaxPoints = condEvents.map((ev, idx) => ({
        portion_index: idx + 1,
        iso_date: ev.iso_date,
        raw_text: ev.raw_text,
        event_type: ev === goodsDelivery ? "DELIVERY" : ev.event_type,
        decree_window: vatWindowBucket(ev.iso_date),
        within_verified_coverage: ev.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        governing_decree_work_id: governingDecreeWorkIdForIso(ev.iso_date),
        expired_or_non_governing_work_ids:
          ev.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
      }));
      controllingIso = null;
      isAmbiguous = true;
      const u1 = unnamedEarlyActUnits[0];
      const u2 = unnamedEarlyActUnits[1];
      controllingEvent = `GOODS_EARLY_ACT_AMBIGUOUS_OVERLAP_CONDITIONAL (${u1.iso_date}:${u1.event_type} vs ${u2.iso_date}:${u2.event_type} + ${goodsDelivery.iso_date}:DELIVERY)`;
      ambiguityReasonTh = `มีการกระทำก่อนส่งมอบสินค้า 2 รายการ ได้แก่ การ${goodsEventActionTh(u1.event_type)}เมื่อวันที่ ${u1.raw_text} (${u1.iso_date}${u1.amount_thb ? `, ${u1.amount_thb.toLocaleString("en-US")} บาท` : ""}) และการ${goodsEventActionTh(u2.event_type)}เมื่อวันที่ ${u2.raw_text} (${u2.iso_date}${u2.amount_thb ? `, ${u2.amount_thb.toLocaleString("en-US")} บาท` : ""}) โดยข้อเท็จจริงยังไม่ชัดเจนว่าครอบคลุมสินค้าส่วนเดียวกันหรือสินค้าคนละส่วนกัน — กรุณาระบุว่าเหตุการณ์ทั้งสองครอบคลุมสินค้าส่วนเดียวกันหรือแยกคนละส่วนก่อนคำนวณยอดภาษีแต่ละช่วง`;
      unknownFacts.add(ambiguityReasonTh);
      vatPortionAllocationRecord = {
        transaction_base_thb: goodsReferenceTotalThb,
        allocation_status: "AMBIGUOUS_OVERLAP",
        ambiguity_question_th: ambiguityReasonTh,
        lot_allocations: [],
        tax_date_buckets: splitPaymentTaxPoints,
        reconciled_total_base_thb: 0,
        reconciled_total_vat_thb: null,
        reconciled_total_gross_thb: null,
        remaining_unallocated_base_thb: goodsReferenceTotalThb,
      };
      statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78 (1) ("ตามส่วนของการกระทำนั้นๆ") กรณีไม่ชัดเจนว่าการกระทำก่อนส่งมอบทั้งสองรายการครอบคลุมสินค้าส่วนเดียวกันหรือคนละส่วนกัน: ห้ามเดาว่าซ้ำซ้อนหรือแยกส่วน และห้ามคำนวณยอดภาษีเป็นตัวเงินสมมติ — ให้ตั้ง answer_status = "CONDITIONAL" ระบุข้อเท็จจริงที่ขาดหายและถามยืนยันว่าเหตุการณ์แต่ละรายการครอบคลุมสินค้าส่วนใด`;
    } else if (isKnownPartialGoodsSplit) {
      const remainderThb = Math.max(
        0,
        Math.round((goodsReferenceTotalThb - earlyPartialKnownSumThb) * 100) / 100
      );
      const portions: SplitPaymentTaxPointItem[] = resolvedUnnamedEarlyPortions.map((ea, idx) => {
        const amt = ea.amount_thb ?? 0;
        const vc = computeVerifiedVatForDateAndBase(ea.iso_date, amt);
        return {
          portion_index: idx + 1,
          iso_date: ea.iso_date,
          raw_text: ea.raw_text,
          event_type: ea.event_type,
          decree_window: vatWindowBucket(ea.iso_date),
          within_verified_coverage: ea.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
          governing_decree_work_id: governingDecreeWorkIdForIso(ea.iso_date),
          expired_or_non_governing_work_ids:
            ea.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
          amount_thb: ea.amount_thb ?? null,
          settled_payment_date_iso: goodsDelivery.iso_date,
          verified_rate_pct: vc.ratePct,
          verified_vat_thb: vc.vatThb,
          verified_gross_thb: vc.grossThb,
        };
      });
      if (remainderThb > 1) {
        const remVc = computeVerifiedVatForDateAndBase(goodsDelivery.iso_date, remainderThb);
        portions.push({
          portion_index: portions.length + 1,
          iso_date: goodsDelivery.iso_date,
          raw_text: goodsDelivery.raw_text,
          event_type: "DELIVERY",
          decree_window: vatWindowBucket(goodsDelivery.iso_date),
          within_verified_coverage: goodsDelivery.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
          governing_decree_work_id: governingDecreeWorkIdForIso(goodsDelivery.iso_date),
          expired_or_non_governing_work_ids:
            goodsDelivery.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
          amount_thb: remainderThb,
          verified_rate_pct: remVc.ratePct,
          verified_vat_thb: remVc.vatThb,
          verified_gross_thb: remVc.grossThb,
        });
      }
      const recBase = Math.round(portions.reduce((s, p) => s + (p.amount_thb ?? 0), 0) * 100) / 100;
      const allV = portions.every((p) => typeof p.verified_vat_thb === "number" && p.verified_vat_thb > 0);
      const recVat = allV
        ? Math.round(portions.reduce((s, p) => s + (p.verified_vat_thb ?? 0), 0) * 100) / 100
        : null;
      vatPortionAllocationRecord = {
        transaction_base_thb: goodsReferenceTotalThb,
        allocation_status: "RESOLVED",
        ambiguity_question_th: null,
        lot_allocations: [],
        tax_date_buckets: portions,
        reconciled_total_base_thb: recBase,
        reconciled_total_vat_thb: recVat,
        reconciled_total_gross_thb:
          recVat !== null ? Math.round((recBase + recVat) * 100) / 100 : null,
        remaining_unallocated_base_thb: Math.max(0, Math.round((goodsReferenceTotalThb - recBase) * 100) / 100),
      };
      isSplitPaymentMultiTaxPoint = portions.length >= 2;
      splitPaymentTaxPoints = portions;
      controllingIso = portions.length === 1 ? portions[0].iso_date : null;
      controllingEvent = `GOODS_PARTIAL_EARLY_ACT_MULTI_TAX_POINT (${portions
        .map((p) => `${p.iso_date}:${p.event_type}:${p.decree_window}:${p.amount_thb ?? "?"}`)
        .join(" + ")})`;
      statutoryRuleHint =
        `ประมวลรัษฎากร มาตรา 78 (1) ("ตามส่วนของการกระทำนั้นๆ"): แยกวันเกิดความรับผิดและพระราชกฤษฎีกาตามสัดส่วนสินค้าที่มีหลักฐานรองรับโดยห้ามเก็บภาษีซ้ำเมื่อส่งมอบ/รับชำระ/ออกใบกำกับภาษีสำหรับส่วนที่เกิดความรับผิดไปแล้ว: ` +
        portions
          .map(
            (p) =>
              `ส่วนที่ ${p.portion_index} (${p.event_type === "DELIVERY" ? "ส่งมอบสินค้าส่วนที่เหลือ" : goodsEventActionTh(p.event_type)} มูลค่า ${(p.amount_thb ?? 0).toLocaleString("en-US")} บาท) วันที่ ${p.iso_date} ใช้ ${p.decree_window}`
          )
          .join("; ");
    } else if (goodsEarlyActsSameWindow) {
      const early = goodsEarlyActs[0];
      controllingIso = early.iso_date;
      controllingEvent = `GOODS_${early.event_type}_SAME_WINDOW_BEFORE_DELIVERY (${early.raw_text} & ${goodsDelivery.raw_text}, Turn ${early.source_turn})`;
      statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78 (1): ทั้งวัน${goodsEventActionTh(early.event_type)}ก่อนส่งมอบ (${early.iso_date}) และวันส่งมอบสินค้า (${goodsDelivery.iso_date}) อยู่ในช่วงเวลาใช้บังคับของพระราชกฤษฎีกาฉบับเดียวกัน (${vatWindowBucket(goodsDelivery.iso_date)}) โดยส่วนที่มีการ${goodsEventActionTh(early.event_type)}ก่อนส่งมอบเกิดความรับผิดวันที่ ${early.iso_date} และส่วนที่เหลือเกิดความรับผิดเมื่อส่งมอบวันที่ ${goodsDelivery.iso_date} โดยไม่เก็บภาษีซ้ำ`;
    } else {
      const early = goodsEarlyActs[0];
      const condEvents: PreservedTemporalEvent[] = [early, goodsDelivery];
      isSplitPaymentMultiTaxPoint = true;
      splitPaymentTaxPoints = condEvents.map((ev, idx) => ({
        portion_index: idx + 1,
        iso_date: ev.iso_date,
        raw_text: ev.raw_text,
        event_type: ev === goodsDelivery ? "DELIVERY" : ev.event_type,
        decree_window: vatWindowBucket(ev.iso_date),
        within_verified_coverage: ev.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        governing_decree_work_id: governingDecreeWorkIdForIso(ev.iso_date),
        expired_or_non_governing_work_ids:
          ev.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
      }));
      controllingIso = null;
      isAmbiguous = true;
      const actLabel = goodsEventActionTh(early.event_type);
      controllingEvent = `GOODS_EARLY_ACT_UNKNOWN_COVERAGE_CONDITIONAL (${early.iso_date}:${early.event_type}:${vatWindowBucket(early.iso_date)} + ${goodsDelivery.iso_date}:DELIVERY:${vatWindowBucket(goodsDelivery.iso_date)})`;
      ambiguityReasonTh = `มีการ${actLabel}ก่อนส่งมอบสินค้าเมื่อวันที่ ${early.raw_text} (${early.iso_date}) แต่ไม่ได้ระบุว่าครอบคลุมสินค้าทั้งหมดหรือเป็นมูลค่า/สัดส่วนเท่าใด และวันดังกล่าว (${vatWindowBucket(early.iso_date)}) กับวันส่งมอบสินค้า ${goodsDelivery.raw_text} (${goodsDelivery.iso_date}, ${vatWindowBucket(goodsDelivery.iso_date)}) อยู่คนละช่วงวันใช้บังคับของพระราชกฤษฎีกา — กรุณาระบุมูลค่าหรือสัดส่วนของสินค้าที่${actLabel}เมื่อวันที่ ${early.raw_text}`;
      unknownFacts.add(
        `มูลค่าหรือสัดส่วนของสินค้าที่${actLabel}ก่อนส่งมอบเมื่อวันที่ ${early.raw_text} (${early.iso_date})`
      );
      vatPortionAllocationRecord = {
        transaction_base_thb: goodsReferenceTotalThb,
        allocation_status: "AMBIGUOUS_COVERAGE",
        ambiguity_question_th: ambiguityReasonTh,
        lot_allocations: [],
        tax_date_buckets: splitPaymentTaxPoints,
        reconciled_total_base_thb: 0,
        reconciled_total_vat_thb: null,
        reconciled_total_gross_thb: null,
        remaining_unallocated_base_thb: goodsReferenceTotalThb,
      };
      statutoryRuleHint =
        `ประมวลรัษฎากร มาตรา 78 (1) ("ตามส่วนของการกระทำนั้นๆ") กรณีไม่ทราบขอบเขตของการ${actLabel}ก่อนส่งมอบ: ห้ามเดาว่าการ${actLabel}เมื่อวันที่ ${early.iso_date} ครอบคลุมสินค้าทั้งหมด และห้ามปัดไปใช้วันส่งมอบวันที่ ${goodsDelivery.iso_date} ทั้งจำนวน — ให้ระบุข้อเท็จจริงที่ขาดหาย (${ambiguityReasonTh}) ตั้ง answer_status = "CONDITIONAL" (โดยไม่คำนวณยอดภาษีเป็นตัวเงินสมมติ) และชี้แจงว่าส่วนที่${actLabel}เมื่อวันที่ ${early.iso_date} ตกอยู่ภายใต้ ${vatWindowBucket(early.iso_date)} (ไม่เสียซ้ำวันส่งมอบ) ส่วนสินค้าที่เหลือที่ส่งมอบวันที่ ${goodsDelivery.iso_date} ตกอยู่ภายใต้ ${vatWindowBucket(goodsDelivery.iso_date)}`;
    }
  } else if (priorInvoiceFixesWholeTaxPoint) {
    const inv = activeInvoicesSorted[0];
    controllingIso = inv.iso_date;
    if (priorInvoiceCoverageStatus === "FULL") {
      controllingEvent = `PRIOR_INVOICE_FIXED_TAX_POINT (${inv.raw_text}, Turn ${inv.source_turn})`;
      statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78/1 (1): เมื่อมีการออกใบกำกับภาษีเต็มจำนวนก่อนได้รับชำระราคาค่าบริการ (วันที่ ${inv.iso_date}) ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับทั้งธุรกรรมเกิดขึ้นแล้ว ณ วันออกใบกำกับภาษีดังกล่าว ไม่ใช่แยกตามวันรับชำระเงินงวดภายหลัง`;
    } else {
      const pay = activePaymentsSorted[0];
      controllingEvent = `PRIOR_INVOICE_SAME_WINDOW_SUFFICIENT (${inv.raw_text} & ${pay.raw_text}, Turn ${inv.source_turn})`;
      statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78/1 (1): แม้มิได้ระบุจำนวนเงินบนใบกำกับภาษีวันที่ ${inv.iso_date} แต่ทั้งวันออกใบกำกับภาษี (${inv.iso_date}) และวันรับชำระเงิน (${pay.iso_date}) อยู่ในช่วงเวลาใช้บังคับของพระราชกฤษฎีกาฉบับเดียวกัน (${vatWindowBucket(inv.iso_date)}) จึงสามารถระบุอัตราภาษีมูลค่าเพิ่มและพระราชกฤษฎีกาที่ใช้บังคับได้อย่างชัดเจนโดยไม่จำเป็นต้องปฏิเสธการตอบ (พร้อมระบุข้อสังเกตว่าหากออกใบกำกับภาษีเต็มจำนวน ความรับผิดเกิดวันที่ ${inv.iso_date} หากออกบางส่วน ส่วนที่เหลือเกิดวันที่ ${pay.iso_date} โดยไม่เก็บภาษีซ้ำ)`;
    }
  } else if (isUnstatedCoverageMateriallyConditional) {
    const inv = activeInvoicesSorted[0];
    const condEvents: PreservedTemporalEvent[] = [inv, ...activePaymentsSorted];
    isSplitPaymentMultiTaxPoint = true;
    splitPaymentTaxPoints = condEvents.map((ev, idx) => {
      const govWid = governingDecreeWorkIdForIso(ev.iso_date);
      const expiredWids = ev.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [];
      return {
        portion_index: idx + 1,
        iso_date: ev.iso_date,
        raw_text: ev.raw_text,
        event_type: ev.event_type,
        decree_window: vatWindowBucket(ev.iso_date),
        within_verified_coverage: ev.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        governing_decree_work_id: govWid,
        expired_or_non_governing_work_ids: expiredWids,
        ...(ev.amount_thb != null ? { amount_thb: ev.amount_thb } : {}),
      };
    });
    controllingIso = null;
    controllingEvent = `UNSTATED_INVOICE_COVERAGE_CONDITIONAL (${splitPaymentTaxPoints.map((p) => `${p.iso_date}:${p.event_type}:${p.decree_window}`).join(" + ")})`;
    unknownFacts.add(
      `ขอบเขตมูลค่าของใบกำกับภาษีที่ออกเมื่อวันที่ ${inv.iso_date} (ไม่ได้ระบุว่าออกเต็มจำนวนหรือเฉพาะบางส่วนเป็นจำนวนเงินเท่าใด)`
    );
    const payListDesc = activePaymentsSorted
      .map((p) => `วันที่ ${p.iso_date} (${vatWindowBucket(p.iso_date)}${p.amount_thb ? `, ${p.amount_thb.toLocaleString("en-US")} บาท` : ""})`)
      .join(", ");
    statutoryRuleHint =
      `ประมวลรัษฎากร มาตรา 78/1 (1) กรณีไม่ได้ระบุขอบเขตมูลค่าของใบกำกับภาษี (Unstated Invoice Coverage): ห้ามอนุมานว่าใบกำกับภาษีที่ออกเมื่อวันที่ ${inv.iso_date} (${vatWindowBucket(inv.iso_date)}) ครอบคลุมเต็มจำนวนทั้งสัญญาโดยไม่มีข้อเท็จจริงรองรับ เนื่องจากวันออกใบกำกับภาษีและวันรับชำระเงิน (${payListDesc}) อยู่คนละช่วงเวลาใช้บังคับของพระราชกฤษฎีกา — ให้ระบุข้อเท็จจริงที่ขาดหายอย่างชัดเจน (จำนวนเงินที่ออกใบกำกับภาษีเมื่อวันที่ ${inv.iso_date}) และแยกแสดงเงื่อนไข 2 กรณีภายใต้หลักฐานที่รองรับโดยไม่เก็บภาษีซ้ำหรือตกหล่น: ` +
      `(กรณีที่ 1) หากใบกำกับภาษีวันที่ ${inv.iso_date} ออกเต็มจำนวน ความรับผิดทั้งหมดเกิดขึ้นวันที่ ${inv.iso_date} ตาม ${vatWindowBucket(inv.iso_date)} และการรับชำระเงินภายหลังไม่ก่อให้เกิดภาระภาษีซ้ำ; ` +
      `(กรณีที่ 2) หากใบกำกับภาษีวันที่ ${inv.iso_date} ออกเฉพาะบางส่วน ส่วนที่ออกใบกำกับภาษีเกิดความรับผิดวันที่ ${inv.iso_date} ตาม ${vatWindowBucket(inv.iso_date)} ส่วนยอดคงเหลือที่ยังไม่ได้ออกใบกำกับภาษีเกิดความรับผิดเมื่อรับชำระเงิน (${payListDesc}) ตามพระราชกฤษฎีกาที่ใช้บังคับในวันรับชำระนั้น`;
  } else if (isPartialPriorInvoiceMultiTaxPoint) {
    const inv = activeInvoicesSorted[0];
    // NEVER infer settlement from equal amounts alone!
    // Exclude a payment as settlement ONLY when:
    //   (a) allocation is NOT explicitly unstated, AND
    //   (b) EITHER the payment clause explicitly references settling the prior invoice (`is_settlement_of_prior_invoice`),
    //       OR there is strictly ONE payment matching `inv.amount_thb` AND every other payment explicitly marks a distinct remaining balance (`has_remaining_balance_marker` with amount != inv.amount_thb).
    const equalToInvPayments = activePaymentsSorted.filter(
      (pay) =>
        inv.amount_thb != null &&
        pay.amount_thb != null &&
        Math.abs(pay.amount_thb - inv.amount_thb) < 1
    );
    const hasExplicitSettlementTag = activePaymentsSorted.some((p) => p.is_settlement_of_prior_invoice);
    let settledPayment: PreservedTemporalEvent | null = null;
    const uninvoicedPayments: PreservedTemporalEvent[] = [];
    let hasUnstatedPaymentAllocation = false;

    if (!hasExplicitUnstatedAllocationWording) {
      if (hasExplicitSettlementTag) {
        for (const pay of activePaymentsSorted) {
          if (!settledPayment && pay.is_settlement_of_prior_invoice) {
            settledPayment = pay;
            continue;
          }
          uninvoicedPayments.push(pay);
        }
      } else if (equalToInvPayments.length === 1 && activePaymentsSorted.length >= 2) {
        const candidateSettle = equalToInvPayments[0];
        const others = activePaymentsSorted.filter((p) => p !== candidateSettle);
        const othersClearlyDistinctRemainder =
          others.length > 0 &&
          others.every(
            (o) =>
              o.has_remaining_balance_marker &&
              (o.amount_thb == null || inv.amount_thb == null || Math.abs(o.amount_thb - inv.amount_thb) >= 1)
          );
        if (othersClearlyDistinctRemainder) {
          settledPayment = candidateSettle;
          uninvoicedPayments.push(...others);
        } else {
          hasUnstatedPaymentAllocation = true;
        }
      } else if (equalToInvPayments.length >= 2) {
        hasUnstatedPaymentAllocation = true;
      } else {
        // Payment amounts don't match the invoiced amount and no explicit settlement tag -> allocation unstated
        hasUnstatedPaymentAllocation = activePaymentsSorted.length >= 2;
      }
    } else {
      hasUnstatedPaymentAllocation = true;
    }

    const partialTaxPointEvents: PreservedTemporalEvent[] =
      !hasUnstatedPaymentAllocation && uninvoicedPayments.length >= 1
        ? [inv, ...uninvoicedPayments]
        : [inv, ...activePaymentsSorted];
    isSplitPaymentMultiTaxPoint = true;
    splitPaymentTaxPoints = partialTaxPointEvents.map((ev, idx) => {
      const govWid = governingDecreeWorkIdForIso(ev.iso_date);
      const expiredWids = ev.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [];
      return {
        portion_index: idx + 1,
        iso_date: ev.iso_date,
        raw_text: ev.raw_text,
        event_type: ev.event_type,
        decree_window: vatWindowBucket(ev.iso_date),
        within_verified_coverage: ev.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        governing_decree_work_id: govWid,
        expired_or_non_governing_work_ids: expiredWids,
        ...(ev.amount_thb != null ? { amount_thb: ev.amount_thb } : {}),
        ...(ev === inv && settledPayment ? { settled_payment_date_iso: settledPayment.iso_date } : {}),
      };
    });
    controllingIso = null;

    if (hasUnstatedPaymentAllocation) {
      controllingEvent = `PARTIAL_INVOICE_UNSTATED_ALLOCATION_CONDITIONAL (${splitPaymentTaxPoints.map((p) => `${p.iso_date}:${p.event_type}:${p.decree_window}`).join(" + ")})`;
      unknownFacts.add(
        `การจัดสรรการชำระเงิน (ไม่ได้ระบุว่ายอดชำระงวดใดเป็นการชำระตามใบกำกับภาษีบางส่วนลงวันที่ ${inv.iso_date}${inv.amount_thb ? ` จำนวน ${inv.amount_thb.toLocaleString("en-US")} บาท` : ""})`
      );
      const pA = activePaymentsSorted[0];
      const pB = activePaymentsSorted[1];
      const branchDesc =
        pA && pB
          ? `(กรณีที่ 1) หากยอดชำระวันที่ ${pA.iso_date} (${pA.amount_thb ? `${pA.amount_thb.toLocaleString("en-US")} บาท` : ""}) เป็นการชำระตามใบกำกับภาษีลงวันที่ ${inv.iso_date} -> ส่วนที่ออกใบกำกับภาษีเกิดความรับผิดวันที่ ${inv.iso_date} (${vatWindowBucket(inv.iso_date)}, ไม่เก็บภาษีซ้ำวันที่ ${pA.iso_date}) และส่วนที่ยังไม่ออกใบกำกับภาษีเกิดความรับผิดวันที่ ${pB.iso_date} (${vatWindowBucket(pB.iso_date)}); ` +
            `(กรณีที่ 2) หากยอดชำระวันที่ ${pA.iso_date} เป็นการชำระส่วนที่ยังไม่ได้ออกใบกำกับภาษี และยอดชำระวันที่ ${pB.iso_date} เป็นการชำระตามใบกำกับภาษีลงวันที่ ${inv.iso_date} -> ส่วนที่ออกใบกำกับภาษีเกิดความรับผิดวันที่ ${inv.iso_date} (${vatWindowBucket(inv.iso_date)}) และส่วนที่ยังไม่ออกใบกำกับภาษีเกิดความรับผิดวันที่ ${pA.iso_date} (${vatWindowBucket(pA.iso_date)}, ไม่เก็บภาษีซ้ำวันที่ ${pB.iso_date}${vatWindowBucket(pB.iso_date) !== vatWindowBucket(pA.iso_date) ? ` และไม่นำ ${vatWindowBucket(pB.iso_date)} มาใช้` : ""})`
          : `ต้องยืนยันว่ายอดชำระใดเป็นการชำระตามใบกำกับภาษีเดิมเพื่อไม่ให้เก็บภาษีซ้ำหรือตกหล่น`;
      statutoryRuleHint = `ประมวลรัษฎากร มาตรา 78/1 (1) กรณีใบกำกับภาษีบางส่วนและมีการชำระเงินหลายงวดโดยไม่ได้ระบุการจัดสรร (Unstated Payment Allocation): ห้ามอนุมานว่ายอดชำระงวดแรกเป็นการชำระตามใบกำกับภาษีเพียงเพราะจำนวนเงินเท่ากัน — ให้ตั้งคำถามขอข้อมูลการจัดสรรที่ขาดหาย แสดงเงื่อนไขแยกตามทางเลือกที่มีหลักฐานรองรับ และยืนยันว่าฐานภาษีรวมต้องเท่ากับมูลค่าบริการทั้งหมด (ห้ามเก็บภาษีซ้ำในส่วนที่ออกใบกำกับภาษีแล้วและห้ามตัดยอดส่วนที่เหลือตกหล่น): ${branchDesc}`;
    } else {
      controllingEvent = `PARTIAL_INVOICE_MULTI_TAX_POINT (${splitPaymentTaxPoints.map((p) => `${p.iso_date}:${p.event_type}:${p.decree_window}`).join(" + ")})`;
      const settlementNoteTh = settledPayment
        ? ` (การรับชำระเงินสำหรับยอดที่ออกใบกำกับภาษีไว้แล้วเมื่อวันที่ ${settledPayment.iso_date} เป็นเพียงการชำระหนี้ตามใบกำกับภาษีเดิม ไม่ก่อให้เกิดจุดความรับผิดทางภาษีซ้ำและไม่เปลี่ยนพระราชกฤษฎีกาที่ใช้บังคับกับส่วนที่ออกใบกำกับภาษีแล้ว)`
        : "";
      statutoryRuleHint =
        `ประมวลรัษฎากร มาตรา 78/1 (1) กรณีออกใบกำกับภาษีบางส่วนก่อนรับชำระเงิน ("ตามส่วนของการกระทำนั้นๆ"): ห้ามนำวันออกใบกำกับภาษีบางส่วนไปเหมารวมกับส่วนที่ยังไม่ได้ออกใบกำกับภาษี และห้ามเก็บภาษีซ้ำเมื่อรับชำระเงินตามยอดที่ออกใบกำกับภาษีแล้ว${settlementNoteTh} — แยกพิจารณาตามวันเกิดความรับผิดของแต่ละส่วน: ` +
        splitPaymentTaxPoints
          .map(
            (p) =>
              `ส่วนที่ ${p.portion_index} (${p.event_type === "INVOICE" ? "ออกใบกำกับภาษีบางส่วน" : "รับชำระส่วนที่ยังไม่ออกใบกำกับภาษี"}${p.amount_thb ? ` ${p.amount_thb.toLocaleString("en-US")} บาท` : ""}) วันที่ ${p.iso_date} (${
                !p.within_verified_coverage
                  ? "ก่อน 2023-10-01 — อยู่นอกขอบเขตต้นฉบับที่ตรวจสอบแล้ว"
                  : p.governing_decree_work_id
                    ? `กฎหมายลดอัตราที่ใช้บังคับเฉพาะส่วนนี้: ${p.decree_window} (${p.governing_decree_work_id})`
                    : "หลังวันสิ้นสุด พ.ร.ฎ. ฉบับที่ 807 (30 ก.ย. 2570) — พ.ร.ฎ. 807 ไม่ครอบคลุมส่วนนี้และห้ามสมมติอัตราลดในอนาคต"
              })`
          )
          .join("; ");
    }
  } else if (detectedSplitPayment) {
    isSplitPaymentMultiTaxPoint = true;
    splitPaymentTaxPoints = Array.from(distinctActiveVatDatesByIso.values()).map((ev, idx) => {
      const govWid = governingDecreeWorkIdForIso(ev.iso_date);
      const expiredWids =
        ev.iso_date > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [];
      const portionAmt =
        typeof ev.amount_thb === "number" && ev.amount_thb > 0 ? ev.amount_thb : null;
      const portionVat =
        portionAmt !== null ? computeVerifiedVatForDateAndBase(ev.iso_date, portionAmt) : null;
      return {
        portion_index: idx + 1,
        iso_date: ev.iso_date,
        raw_text: ev.raw_text,
        event_type: ev.event_type,
        decree_window: vatWindowBucket(ev.iso_date),
        within_verified_coverage: ev.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        governing_decree_work_id: govWid,
        expired_or_non_governing_work_ids: expiredWids,
        ...(portionAmt !== null
          ? {
              amount_thb: portionAmt,
              verified_rate_pct: portionVat?.ratePct ?? null,
              verified_vat_thb: portionVat?.vatThb ?? null,
              verified_gross_thb: portionVat?.grossThb ?? null,
            }
          : {}),
      };
    });
    controllingIso = null;
    controllingEvent = `SPLIT_PAYMENT_MULTI_TAX_POINT (${splitPaymentTaxPoints.map((p) => `${p.iso_date}:${p.decree_window}`).join(" + ")})`;
    statutoryRuleHint =
      "กรณีแบ่งรับชำระ/มัดจำหลายงวดโดยไม่มีการออกใบกำกับภาษีหรือใช้บริการก่อนรับชำระ (split payment): ห้ามนำวันที่หรือพระราชกฤษฎีกาของงวดหนึ่งไปใช้เหมารวมกับงวดอื่น — แต่ละงวดมีวันเกิดความรับผิดทางภาษี (tax point) และกฎหมายที่ใช้บังคับแยกตามวันที่ของแต่ละงวดตามประมวลรัษฎากร มาตรา 78 / 78/1 (1): " +
      splitPaymentTaxPoints
        .map(
          (p) =>
            `งวดที่ ${p.portion_index} วันที่ ${p.iso_date} (${
              !p.within_verified_coverage
                ? "ก่อน 2023-10-01 — อยู่นอกขอบเขตต้นฉบับที่ตรวจสอบแล้ว"
                : p.governing_decree_work_id
                  ? `กฎหมายลดอัตราที่ใช้บังคับเฉพาะงวดนี้: ${p.decree_window} (${p.governing_decree_work_id})`
                  : "หลังวันสิ้นสุด พ.ร.ฎ. ฉบับที่ 807 (30 ก.ย. 2570) — พ.ร.ฎ. 807 ไม่ครอบคลุมงวดนี้และห้ามสมมติอัตราลดในอนาคต ให้พิจารณาตามเพดานมาตรา 80 เว้นแต่จะมีพระราชกฤษฎีกาฉบับใหม่"
            })`
        )
        .join("; ");
  } else if (isVatCase && factsMap.get("vat_transaction_type")?.normalized_category === "VAT_PROVISION_OF_SERVICE") {
    // Under Revenue Code §78/1(1), service VAT tax point is the EARLIEST of:
    // payment received, tax invoice issued, or use of service.
    const activeServiceEvents = latestTurnWasDateShiftOverride
      ? nonQuestionDates
      : latestTurnNonQuestionDates.length > 0
        ? latestTurnNonQuestionDates
        : nonQuestionDates;
    const statutoryServiceEvents = activeServiceEvents.filter(
      (e) =>
        e.event_type === "PAYMENT" ||
        e.event_type === "INVOICE" ||
        e.event_type === "SERVICE_USE"
    );
    const taxPointCandidates =
      statutoryServiceEvents.length > 0
        ? statutoryServiceEvents
        : activeServiceEvents.filter((e) => e.event_type === "STATED_TRANSACTION_DATE");
    if (taxPointCandidates.length > 0) {
      const sorted = [...taxPointCandidates].sort((a, b) => a.iso_date.localeCompare(b.iso_date));
      const earliest = sorted[0];
      controllingIso = earliest.iso_date;
      controllingEvent = `${earliest.event_type} (${earliest.raw_text}, Turn ${earliest.source_turn})`;
      statutoryRuleHint =
        "ประมวลรัษฎากร มาตรา 78/1 (1): ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับการให้บริการเกิดขึ้นเมื่อได้รับชำระราคาค่าบริการ เว้นแต่ได้ออกใบกำกับภาษีหรือได้ใช้บริการก่อนได้รับชำระราคา (ถือเหตุการณ์ที่เกิดขึ้นก่อน)";
      if (
        legalAsOfDate &&
        legalAsOfDate !== earliest.iso_date &&
        vatWindowBucket(legalAsOfDate) !== vatWindowBucket(earliest.iso_date)
      ) {
        isAmbiguous = true;
        ambiguityReasonTh = `วันที่ในคำถาม (${earliest.iso_date}) ขัดแย้งกับวันที่ที่ระบุในคำขอ applicable_date (${legalAsOfDate}) ซึ่งอยู่คนละช่วงวันใช้บังคับของพระราชกฤษฎีกา — กรุณายืนยันวันเกิดความรับผิดทางภาษีที่ถูกต้อง`;
      }
    } else if (legalAsOfDate && !explicitUnknownDateInPrompt) {
      // Request-supplied applicable_date is usable just like a date extracted from the question when no conflicting prompt date exists
      controllingIso = legalAsOfDate;
      controllingEvent = `REQUEST_APPLICABLE_DATE (${legalAsOfDate})`;
      statutoryRuleHint =
        "ใช้ตามวันที่อ้างอิงที่ระบุในคำขอ (applicable_date) เป็นวันเกิดความรับผิดทางภาษีเพื่อตรวจสอบกฎหมายที่ใช้บังคับ";
    } else {
      isAmbiguous = true;
      ambiguityReasonTh =
        "ไม่ปรากฏวันที่เกิดความรับผิดทางภาษี (วันรับชำระราคา วันออกใบกำกับภาษี หรือวันใช้บริการ) ตามมาตรา 78/1 (1) ในข้อเท็จจริง";
    }
  } else if (nonQuestionDates.length > 0) {
    // Prefer latest turn's registration/transfer/stated date; on non-immovable VAT queries, generic REGISTRATION
    // (company/commercial/contract/machinery registration without ownership transfer) is NEVER a VAT tax point!
    const rawPool = latestTurnNonQuestionDates.length > 0 ? latestTurnNonQuestionDates : nonQuestionDates;
    const pool =
      isVatCase && !isImmovableAsset
        ? rawPool.filter((e) => e.event_type !== "REGISTRATION")
        : rawPool;
    if (pool.length === 0) {
      if (legalAsOfDate && !explicitUnknownDateInPrompt) {
        controllingIso = legalAsOfDate;
        controllingEvent = `REQUEST_APPLICABLE_DATE (${legalAsOfDate})`;
      } else if (isVatCase) {
        isAmbiguous = true;
        ambiguityReasonTh = "ไม่ปรากฏวันที่เกิดความรับผิดทางภาษีในคำถามหรือคำขอ (วันที่จดทะเบียนทั่วไปที่ไม่ใช่การโอนกรรมสิทธิ์สินค้าไม่ใช่วันเกิดความรับผิด VAT)";
      }
    } else {
      const chosen = isVatCase && !isImmovableAsset
        ? [...pool].sort((a, b) => a.iso_date.localeCompare(b.iso_date))[0]
        : (pool.filter((e) => e.event_type === "REGISTRATION" || e.event_type === "TRANSFER").slice(-1)[0] ||
            pool[pool.length - 1]);
      controllingIso = chosen.iso_date;
      controllingEvent = `${chosen.event_type} (${chosen.raw_text}, Turn ${chosen.source_turn})`;
      if (isImmovableAsset) {
        statutoryRuleHint = "การโอนกรรมสิทธิ์อสังหาริมทรัพย์พิจารณาตามวันจดทะเบียนสิทธิและนิติกรรม";
      }
      if (
        isVatCase &&
        legalAsOfDate &&
        legalAsOfDate !== chosen.iso_date &&
        vatWindowBucket(legalAsOfDate) !== vatWindowBucket(chosen.iso_date)
      ) {
        isAmbiguous = true;
        ambiguityReasonTh = `วันที่ในคำถาม (${chosen.iso_date}) ขัดแย้งกับวันที่ที่ระบุในคำขอ applicable_date (${legalAsOfDate}) ซึ่งอยู่คนละช่วงวันใช้บังคับของพระราชกฤษฎีกา — กรุณายืนยันวันเกิดความรับผิดทางภาษีที่ถูกต้อง`;
      }
    }
  } else if (legalAsOfDate && !explicitUnknownDateInPrompt) {
    // Request-supplied applicable_date is usable just like a date extracted from the question
    controllingIso = legalAsOfDate;
    controllingEvent = `REQUEST_APPLICABLE_DATE (${legalAsOfDate})`;
  } else if (isVatCase) {
    isAmbiguous = true;
    ambiguityReasonTh = "ไม่ปรากฏวันที่เกิดความรับผิดทางภาษีในคำถามหรือคำขอ";
  }

  const builtLedger: StructuredCaseFactLedger = {
    turn_count: allUserTurns.length,
    is_new_conversation: isNewConversation,
    user_turns: userTurnsOut,
    material_facts: Array.from(factsMap.values()),
    overrides,
    temporal_facts: {
      transaction_or_event_dates: allTemporalEvents,
      legal_as_of_date: legalAsOfDate,
      ...(declaredGoodsLots.length > 0 ? { declared_goods_lots: declaredGoodsLots } : {}),
      ...(nonOccurringEvents.length > 0
        ? { non_occurring_or_negated_events: nonOccurringEvents }
        : {}),
      ...(vatPortionAllocationRecord
        ? { vat_portion_allocation_record: vatPortionAllocationRecord }
        : {}),
      ...(splitPaymentTaxPoints ? { split_payment_tax_points: splitPaymentTaxPoints } : {}),
      controlling_tax_point: {
        iso_date: controllingIso,
        controlling_event: controllingEvent,
        statutory_rule_hint: statutoryRuleHint,
        is_ambiguous: isAmbiguous,
        ambiguity_reason_th: ambiguityReasonTh,
        ...(isSplitPaymentMultiTaxPoint ? { is_split_payment_multi_tax_point: true } : {}),
      },
    },
    explicitly_unknown_facts_th: Array.from(unknownFacts),
    questions_asked_th: questionsAsked,
    fact_preservation_guards: {
      asset_original_noun_th: assetOriginalNounTh,
      forbid_land_substitution: forbidLandSubstitution,
      recipient_original_noun_th: recipientOriginalNounTh,
      forbid_niece_substitution: forbidNieceSubstitution,
      recipient_kinship_category: recipientKinshipCategory,
      is_ambiguous_lan_sao: isAmbiguousLanSao,
    },
  };
  const stateHash = computeLedgerStateHash(builtLedger);
  builtLedger.ledger_state_hash = stateHash;
  if (builtLedger.temporal_facts.vat_portion_allocation_record) {
    builtLedger.temporal_facts.vat_portion_allocation_record.ledger_after_hash = stateHash;
  }
  return builtLedger;
}

const THAI_MONTH_NAMES = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

function formatIsoDateToThaiLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const yearBe = Number(m[1]) + 543;
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const monthName = THAI_MONTH_NAMES[monthIdx] || m[2];
  return `${day} ${monthName} ${yearBe}`;
}

function vatWindowBucketForIso(iso: string): string {
  if (iso >= "2024-10-01" && iso <= "2025-09-30") return "RD_790";
  if (iso >= "2025-10-01" && iso <= "2026-09-30") return "RD_799";
  if (iso >= "2026-10-01" && iso <= "2027-09-30") return "RD_807";
  if (iso > "2027-09-30") return "POST_807";
  if (iso >= "2023-10-01" && iso <= "2024-09-30") return "RD_780";
  return "PRE_CUTOFF_BEFORE_2023_10_01";
}

function governingDecreeWorkIdForIsoDate(iso: string): string | null {
  if (iso >= "2023-10-01" && iso <= "2024-09-30") return "subreg.th.rc.royal_decree.780";
  if (iso >= "2024-10-01" && iso <= "2025-09-30") return "subreg.th.rc.royal_decree.790";
  if (iso >= "2025-10-01" && iso <= "2026-09-30") return "subreg.th.rc.royal_decree.799";
  if (iso >= "2026-10-01" && iso <= "2027-09-30") return "subreg.th.rc.royal_decree.807";
  return null;
}

function computeVerifiedVatForIsoAndBase(
  iso: string,
  baseThb: number
): { ratePct: number | null; vatThb: number | null; grossThb: number | null } {
  const within = iso >= VAT_RATE_VERIFIED_COVERAGE_START_ISO;
  const govWid = governingDecreeWorkIdForIsoDate(iso);
  if (!within || !govWid || !Number.isFinite(baseThb) || baseThb <= 0) {
    return { ratePct: null, vatThb: null, grossThb: null };
  }
  const vatThb = Math.round(baseThb * 0.07 * 100) / 100;
  const grossThb = Math.round((baseThb + vatThb) * 100) / 100;
  return { ratePct: 7, vatThb, grossThb };
}

function deltaGoodsEventActionTh(k: TemporalEventKind): string {
  return k === "OWNERSHIP_TRANSFER"
    ? "โอนกรรมสิทธิ์ในสินค้า"
    : k === "PAYMENT"
      ? "รับชำระราคาสินค้า"
      : k === "DELIVERY"
        ? "ส่งมอบสินค้า"
        : "ออกใบกำกับภาษี";
}

function deltaGoodsEventSubclauseTh(k: TemporalEventKind): string {
  return k === "OWNERSHIP_TRANSFER"
    ? "มาตรา 78 (1) (ก)"
    : k === "PAYMENT"
      ? "มาตรา 78 (1) (ข)"
      : k === "DELIVERY"
        ? "มาตรา 78 (1)"
        : "มาตรา 78 (1) (ค)";
}

/**
 * C12 A3/B3: Deterministic SHA-256 fingerprint of a ledger's semantic state
 * (declared lots, active temporal events, legal_as_of_date, and core allocation record).
 * Deliberately excludes `ledger_after_hash` itself so stamping is idempotent.
 */
export function computeLedgerStateHash(ledger: StructuredCaseFactLedger): string {
  const lots = [...(ledger.temporal_facts.declared_goods_lots || [])]
    .sort((a, b) => a.lot_id.localeCompare(b.lot_id))
    .map((l) => ({ lot_id: l.lot_id, amount_thb: l.amount_thb }));

  const events = (ledger.temporal_facts.transaction_or_event_dates || [])
    .filter((e) => e.event_status !== "NEGATED" && e.event_type !== "QUESTION_DATE")
    .map((e) => ({
      event_type: e.event_type,
      iso_date: e.iso_date,
      covered_lot_ids: [...(e.covered_lot_ids || [])].sort(),
      explicitly_excluded_lot_ids: [...(e.explicitly_excluded_lot_ids || [])].sort(),
      portion_coverage: e.portion_coverage || "UNSTATED",
      amount_thb: e.amount_thb ?? null,
    }))
    .sort((a, b) =>
      `${a.iso_date}|${a.event_type}|${a.covered_lot_ids.join(",")}|${a.portion_coverage}|${a.amount_thb ?? ""}`.localeCompare(
        `${b.iso_date}|${b.event_type}|${b.covered_lot_ids.join(",")}|${b.portion_coverage}|${b.amount_thb ?? ""}`
      )
    );

  const alloc = ledger.temporal_facts.vat_portion_allocation_record;
  const allocCore = alloc
    ? {
        allocation_status: alloc.allocation_status,
        transaction_base_thb: alloc.transaction_base_thb,
        lots: [...alloc.lot_allocations]
          .sort((a, b) => a.lot_id.localeCompare(b.lot_id))
          .map((la) => ({
            lot_id: la.lot_id,
            taxable_base_thb: la.taxable_base_thb,
            controlling_tax_point_iso: la.controlling_tax_point_iso,
            controlling_event_type: la.controlling_event_type,
            decree_window: la.decree_window,
            verified_vat_thb: la.verified_vat_thb,
          })),
        buckets: alloc.tax_date_buckets.map((b) => ({
          iso_date: b.iso_date,
          decree_window: b.decree_window,
          amount_thb: b.amount_thb ?? null,
          lot_ids: [...(b.lot_ids || [])].sort(),
        })),
      }
    : null;

  const valueFacts = ledger.material_facts
    .filter((f) => /_thb$/i.test(f.fact_key) || f.fact_key === "vat_place_of_use")
    .map((f) => ({ k: f.fact_key, c: f.normalized_category }))
    .sort((a, b) => a.k.localeCompare(b.k));

  return sha256Bytes(
    JSON.stringify({
      lots,
      events,
      legal_as_of_date: ledger.temporal_facts.legal_as_of_date ?? null,
      controlling_iso: ledger.temporal_facts.controlling_tax_point.iso_date ?? null,
      alloc: allocCore,
      valueFacts,
    })
  );
}

/**
 * C12 A3 Pure Delta Applicator:
 * Applies a validated `FactDelta` to `priorLedger` without mutating `priorLedger`,
 * then deterministically rebuilds `vat_portion_allocation_record`, `split_payment_tax_points`,
 * and `controlling_tax_point` from scratch (NEVER copying the prior turn's allocation record),
 * and stamps `ledger_state_hash` / `ledger_after_hash`.
 */
export function applyFactDelta(
  priorLedger: StructuredCaseFactLedger,
  delta: FactDelta,
  opts?: { userTurnText?: string; applicableDate?: string | null }
): StructuredCaseFactLedger {
  const nextTurnNumber = priorLedger.turn_count + (opts?.userTurnText ? 1 : 0);
  const clonedLots: DeclaredGoodsLot[] = (priorLedger.temporal_facts.declared_goods_lots || []).map(
    (l) => ({ ...l })
  );
  const lotMap = new Map<string, DeclaredGoodsLot>(clonedLots.map((l) => [l.lot_id, l]));
  const allDeclaredIds = clonedLots.map((l) => l.lot_id);

  let workingEvents: PreservedTemporalEvent[] = (
    priorLedger.temporal_facts.transaction_or_event_dates || []
  ).map((e) => ({
    ...e,
    ...(e.covered_lot_ids ? { covered_lot_ids: [...e.covered_lot_ids] } : {}),
    ...(e.explicitly_excluded_lot_ids
      ? { explicitly_excluded_lot_ids: [...e.explicitly_excluded_lot_ids] }
      : {}),
  }));

  const clonedMaterialFacts: PreservedMaterialFact[] = priorLedger.material_facts.map((f) => ({
    ...f,
    overridden_from: f.overridden_from ? { ...f.overridden_from } : null,
  }));
  const clonedOverrides = priorLedger.overrides.map((o) => ({ ...o }));
  const clonedUserTurns = priorLedger.user_turns.map((t) => ({ ...t }));
  if (opts?.userTurnText) {
    clonedUserTurns.push({
      turn_number: nextTurnNumber,
      raw_text: opts.userTurnText,
      cleaned_active_text: stripNegatedFactualClauses(opts.userTurnText),
      explicit_applicable_date: opts.applicableDate ?? null,
    });
  }

  const computeLotSubsetSum = (lotIds: string[]): number | null => {
    if (lotIds.length === 0 || lotMap.size === 0) return null;
    const sum = lotIds.reduce((s, lid) => s + (lotMap.get(lid)?.amount_thb ?? 0), 0);
    return sum > 0 ? Math.round(sum * 100) / 100 : null;
  };
  const formatLotLabels = (lotIds: string[]): string =>
    lotIds.map((lid) => lotMap.get(lid)?.label_th || lid).join(" และ ");

  const buildFreshEvent = (params: {
    eventType: TemporalEventKind;
    isoDate: string;
    lots: string[];
    amountThb: number | null;
    sourceSpan: string;
  }): PreservedTemporalEvent => {
    const coverAll =
      allDeclaredIds.length > 0 && params.lots.length >= allDeclaredIds.length;
    const computedAmt = params.amountThb ?? computeLotSubsetSum(params.lots);
    return {
      event_type: params.eventType,
      iso_date: params.isoDate,
      raw_text: formatIsoDateToThaiLabel(params.isoDate),
      source_turn: nextTurnNumber,
      event_status: "ACTUAL",
      provenance_clause_th: params.sourceSpan,
      ...(computedAmt !== null ? { amount_thb: computedAmt } : {}),
      portion_coverage:
        allDeclaredIds.length === 0
          ? "UNSTATED"
          : coverAll
            ? "FULL"
            : params.lots.length > 0
              ? "PARTIAL"
              : "UNSTATED",
      ...(params.lots.length > 0
        ? {
            covered_lot_ids: [...params.lots],
            covered_goods_label_th: formatLotLabels(params.lots),
          }
        : {}),
      ...(params.eventType === "DELIVERY" ? { is_goods_delivery: true } : {}),
    };
  };

  for (const ch of delta.changes) {
    const targetLots = [...ch.lots];

    if (ch.op === "reassign_lots") {
      const matchDate = ch.from_date || ch.to_date;
      const newDate = ch.to_date || ch.from_date;
      const matchesEvent = (e: PreservedTemporalEvent) => {
        if (e.event_status === "NEGATED" || e.event_type === "QUESTION_DATE") return false;
        if (ch.event_type && e.event_type !== ch.event_type) return false;
        if (!ch.event_type && !["OWNERSHIP_TRANSFER", "DELIVERY", "PAYMENT", "INVOICE"].includes(e.event_type)) {
          return false;
        }
        if (matchDate && e.iso_date !== matchDate) return false;
        return true;
      };

      const matchedIndices: number[] = [];
      for (let i = 0; i < workingEvents.length; i++) {
        if (matchesEvent(workingEvents[i])) matchedIndices.push(i);
      }

      if (ch.lots_mode === "only") {
        if (matchedIndices.length > 0) {
          const groupedByType = new Map<TemporalEventKind, PreservedTemporalEvent[]>();
          for (const idx of matchedIndices) {
            const ev = workingEvents[idx];
            const arr = groupedByType.get(ev.event_type) || [];
            arr.push(ev);
            groupedByType.set(ev.event_type, arr);
          }
          const matchedSet = new Set(matchedIndices);
          workingEvents = workingEvents.filter((_, i) => !matchedSet.has(i));
          for (const [evType, oldGroup] of groupedByType.entries()) {
            const effectiveIso = newDate || oldGroup[0].iso_date;
            workingEvents.push(
              buildFreshEvent({
                eventType: evType,
                isoDate: effectiveIso,
                lots: targetLots,
                amountThb: ch.amount_thb,
                sourceSpan: ch.source_span,
              })
            );
          }
        } else if (ch.event_type && newDate && targetLots.length > 0) {
          workingEvents.push(
            buildFreshEvent({
              eventType: ch.event_type,
              isoDate: newDate,
              lots: targetLots,
              amountThb: ch.amount_thb,
              sourceSpan: ch.source_span,
            })
          );
        }
      } else if (ch.lots_mode === "add") {
        if (matchedIndices.length > 0) {
          for (const idx of matchedIndices) {
            const ev = workingEvents[idx];
            const merged = Array.from(new Set([...(ev.covered_lot_ids || []), ...targetLots]));
            workingEvents[idx] = {
              ...ev,
              iso_date: newDate || ev.iso_date,
              raw_text: formatIsoDateToThaiLabel(newDate || ev.iso_date),
              source_turn: nextTurnNumber,
              provenance_clause_th: ch.source_span,
              covered_lot_ids: merged,
              covered_goods_label_th: formatLotLabels(merged),
              portion_coverage:
                allDeclaredIds.length > 0 && merged.length >= allDeclaredIds.length
                  ? "FULL"
                  : "PARTIAL",
              amount_thb: ch.amount_thb ?? computeLotSubsetSum(merged) ?? ev.amount_thb,
              explicitly_excluded_lot_ids: (ev.explicitly_excluded_lot_ids || []).filter(
                (id) => !targetLots.includes(id)
              ),
            };
          }
        } else if (ch.event_type && newDate && targetLots.length > 0) {
          workingEvents.push(
            buildFreshEvent({
              eventType: ch.event_type,
              isoDate: newDate,
              lots: targetLots,
              amountThb: ch.amount_thb,
              sourceSpan: ch.source_span,
            })
          );
        }
      } else if (ch.lots_mode === "remove") {
        const nextList: PreservedTemporalEvent[] = [];
        for (let i = 0; i < workingEvents.length; i++) {
          const ev = workingEvents[i];
          if (!matchedIndices.includes(i)) {
            nextList.push(ev);
            continue;
          }
          const baseLots =
            ev.covered_lot_ids && ev.covered_lot_ids.length > 0
              ? ev.covered_lot_ids
              : [...allDeclaredIds];
          const remaining = baseLots.filter((id) => !targetLots.includes(id));
          if (remaining.length === 0) continue;
          nextList.push({
            ...ev,
            source_turn: nextTurnNumber,
            provenance_clause_th: ch.source_span,
            covered_lot_ids: remaining,
            covered_goods_label_th: formatLotLabels(remaining),
            portion_coverage:
              allDeclaredIds.length > 0 && remaining.length >= allDeclaredIds.length
                ? "FULL"
                : "PARTIAL",
            amount_thb: computeLotSubsetSum(remaining) ?? ev.amount_thb,
          });
        }
        workingEvents = nextList;
      }

      clonedOverrides.push({
        fact_key: `fact_delta:reassign_lots:${ch.event_type || "ALL"}:${matchDate || "*"}`,
        from_text_th: `${matchDate || "-"}`,
        from_turn: Math.max(1, nextTurnNumber - 1),
        to_text_th: `${newDate || matchDate || "-"} (${formatLotLabels(targetLots)}, ${ch.lots_mode})`,
        to_turn: nextTurnNumber,
      });
    } else if (ch.op === "set_event") {
      const targetDate = ch.to_date || ch.from_date;
      if (!ch.event_type || !targetDate) continue;
      const effectiveLots = targetLots.length > 0 ? targetLots : [...allDeclaredIds];

      // If `from_date` is set and differs from `targetDate`, detach `effectiveLots` from `from_date` first.
      // For non-lot single-transaction updates where `from_date` is omitted (null), replace the prior single
      // event of the same `event_type` (preserving genuinely dated earlier SERVICE_USE and unrelated installments!).
      const shouldReplacePriorSingleNonLotEvent =
        !ch.from_date &&
        allDeclaredIds.length === 0 &&
        !priorLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
        workingEvents.filter((ev) => ev.event_type === ch.event_type && ev.iso_date !== targetDate).length === 1;
      if ((ch.from_date && ch.from_date !== targetDate) || shouldReplacePriorSingleNonLotEvent) {
        const strippedFrom: PreservedTemporalEvent[] = [];
        for (const ev of workingEvents) {
          const matchesFrom = ch.from_date
            ? ev.event_type === ch.event_type && ev.iso_date === ch.from_date
            : ev.event_type === ch.event_type && ev.iso_date !== targetDate;
          if (matchesFrom) {
            const baseLots =
              ev.covered_lot_ids && ev.covered_lot_ids.length > 0
                ? ev.covered_lot_ids
                : [...allDeclaredIds];
            const rem = baseLots.filter((id) => !effectiveLots.includes(id));
            if (rem.length > 0) {
              strippedFrom.push({
                ...ev,
                covered_lot_ids: rem,
                covered_goods_label_th: formatLotLabels(rem),
                portion_coverage:
                  allDeclaredIds.length > 0 && rem.length >= allDeclaredIds.length
                    ? "FULL"
                    : "PARTIAL",
                amount_thb: computeLotSubsetSum(rem) ?? ev.amount_thb,
              });
            }
            continue;
          }
          strippedFrom.push(ev);
        }
        workingEvents = strippedFrom;
      }

      // Deduplicate/replace on `targetDate`
      const cleanedTarget: PreservedTemporalEvent[] = [];
      const exclusiveSameDateReassign =
        ch.lots_mode === "only" && Boolean(ch.from_date && ch.from_date === targetDate);
      for (const ev of workingEvents) {
        if (ev.event_type === ch.event_type && ev.iso_date === targetDate) {
          if (exclusiveSameDateReassign) {
            continue;
          }
          if (effectiveLots.length === 0) continue;
          const baseLots =
            ev.covered_lot_ids && ev.covered_lot_ids.length > 0
              ? ev.covered_lot_ids
              : [...allDeclaredIds];
          const rem = baseLots.filter((id) => !effectiveLots.includes(id));
          if (rem.length > 0) {
            cleanedTarget.push({
              ...ev,
              covered_lot_ids: rem,
              covered_goods_label_th: formatLotLabels(rem),
              portion_coverage:
                allDeclaredIds.length > 0 && rem.length >= allDeclaredIds.length
                  ? "FULL"
                  : "PARTIAL",
              amount_thb: computeLotSubsetSum(rem) ?? ev.amount_thb,
            });
          }
          continue;
        }
        cleanedTarget.push(ev);
      }
      cleanedTarget.push(
        buildFreshEvent({
          eventType: ch.event_type,
          isoDate: targetDate,
          lots: effectiveLots,
          amountThb: ch.amount_thb,
          sourceSpan: ch.source_span,
        })
      );
      workingEvents = cleanedTarget;

      clonedOverrides.push({
        fact_key: `fact_delta:set_event:${ch.event_type}:${effectiveLots.join("+") || "ALL"}`,
        from_text_th: ch.from_date || "-",
        from_turn: Math.max(1, nextTurnNumber - 1),
        to_text_th: `${targetDate} (${formatLotLabels(effectiveLots)})`,
        to_turn: nextTurnNumber,
      });
    } else if (ch.op === "shift_date") {
      if (!ch.from_date || !ch.to_date || ch.from_date === ch.to_date) continue;
      const nextList: PreservedTemporalEvent[] = [];
      for (const ev of workingEvents) {
        if (ev.iso_date !== ch.from_date) {
          nextList.push(ev);
          continue;
        }
        if (ch.event_type && ev.event_type !== ch.event_type) {
          nextList.push(ev);
          continue;
        }
        if (targetLots.length === 0) {
          nextList.push({
            ...ev,
            iso_date: ch.to_date,
            raw_text: formatIsoDateToThaiLabel(ch.to_date),
            source_turn: nextTurnNumber,
            provenance_clause_th: `[แก้ไขวันที่จาก ${ch.from_date} เป็น ${ch.to_date}] ${ch.source_span}`.slice(
              0,
              180
            ),
          });
          continue;
        }
        const evLots =
          ev.covered_lot_ids && ev.covered_lot_ids.length > 0
            ? ev.covered_lot_ids
            : [...allDeclaredIds];
        const moving = evLots.filter((id) => targetLots.includes(id));
        const staying = evLots.filter((id) => !targetLots.includes(id));
        if (moving.length === 0) {
          nextList.push(ev);
          continue;
        }
        if (staying.length > 0) {
          nextList.push({
            ...ev,
            covered_lot_ids: staying,
            covered_goods_label_th: formatLotLabels(staying),
            portion_coverage:
              allDeclaredIds.length > 0 && staying.length >= allDeclaredIds.length
                ? "FULL"
                : "PARTIAL",
            amount_thb: computeLotSubsetSum(staying) ?? ev.amount_thb,
          });
        }
        nextList.push({
          ...ev,
          iso_date: ch.to_date,
          raw_text: formatIsoDateToThaiLabel(ch.to_date),
          source_turn: nextTurnNumber,
          provenance_clause_th: `[แก้ไขวันที่จาก ${ch.from_date} เป็น ${ch.to_date}] ${ch.source_span}`.slice(
            0,
            180
          ),
          covered_lot_ids: moving,
          covered_goods_label_th: formatLotLabels(moving),
          portion_coverage:
            allDeclaredIds.length > 0 && moving.length >= allDeclaredIds.length
              ? "FULL"
              : "PARTIAL",
          amount_thb: computeLotSubsetSum(moving) ?? ev.amount_thb,
        });
      }
      workingEvents = nextList;

      clonedOverrides.push({
        fact_key: `fact_delta:shift_date:${ch.from_date}`,
        from_text_th: ch.from_date,
        from_turn: Math.max(1, nextTurnNumber - 1),
        to_text_th: ch.to_date,
        to_turn: nextTurnNumber,
      });
    } else if (ch.op === "remove_event") {
      const targetDate = ch.from_date || ch.to_date;
      const nextList: PreservedTemporalEvent[] = [];
      for (const ev of workingEvents) {
        const typeMatch = !ch.event_type || ev.event_type === ch.event_type;
        const dateMatch = !targetDate || ev.iso_date === targetDate;
        if (!typeMatch || !dateMatch) {
          nextList.push(ev);
          continue;
        }
        if (targetLots.length === 0) {
          continue;
        }
        const evLots =
          ev.covered_lot_ids && ev.covered_lot_ids.length > 0
            ? ev.covered_lot_ids
            : [...allDeclaredIds];
        const remaining = evLots.filter((id) => !targetLots.includes(id));
        if (remaining.length > 0) {
          nextList.push({
            ...ev,
            source_turn: nextTurnNumber,
            covered_lot_ids: remaining,
            covered_goods_label_th: formatLotLabels(remaining),
            portion_coverage:
              allDeclaredIds.length > 0 && remaining.length >= allDeclaredIds.length
                ? "FULL"
                : "PARTIAL",
            amount_thb: computeLotSubsetSum(remaining) ?? ev.amount_thb,
          });
        }
      }
      workingEvents = nextList;

      clonedOverrides.push({
        fact_key: `fact_delta:remove_event:${ch.event_type || "ALL"}:${targetDate || "*"}`,
        from_text_th: `${ch.event_type || "ALL"} @ ${targetDate || "*"}`,
        from_turn: Math.max(1, nextTurnNumber - 1),
        to_text_th: "removed",
        to_turn: nextTurnNumber,
      });
    } else if (ch.op === "set_amount" && ch.amount_thb !== null && ch.amount_thb > 0) {
      if (targetLots.length === 1 && lotMap.has(targetLots[0])) {
        const lot = lotMap.get(targetLots[0])!;
        const prevAmt = lot.amount_thb;
        lot.amount_thb = ch.amount_thb;
        lot.source_turn = nextTurnNumber;
        const newTotal = clonedLots.reduce((s, l) => s + l.amount_thb, 0);
        const valFact = clonedMaterialFacts.find(
          (f) => f.fact_key === "stated_asset_value_thb" || f.fact_key === "service_or_sale_consideration_thb"
        );
        if (valFact) {
          valFact.overridden_from = {
            previous_text_th: valFact.original_text_th,
            previous_category: valFact.normalized_category,
            previous_turn: valFact.source_turn,
          };
          valFact.original_text_th = `${newTotal.toLocaleString("en-US")} บาท`;
          valFact.normalized_category = `STATED_VALUE_THB_${Math.round(newTotal)}`;
          valFact.source_turn = nextTurnNumber;
        }
        clonedOverrides.push({
          fact_key: `fact_delta:set_amount:${lot.lot_id}`,
          from_text_th: `${prevAmt.toLocaleString("en-US")} บาท`,
          from_turn: Math.max(1, nextTurnNumber - 1),
          to_text_th: `${ch.amount_thb.toLocaleString("en-US")} บาท`,
          to_turn: nextTurnNumber,
        });
      } else if (targetLots.length === 0) {
        const valFact = clonedMaterialFacts.find(
          (f) => f.fact_key === "stated_asset_value_thb" || f.fact_key === "service_or_sale_consideration_thb"
        );
        const prevText = valFact?.original_text_th || "-";
        if (valFact) {
          valFact.overridden_from = {
            previous_text_th: valFact.original_text_th,
            previous_category: valFact.normalized_category,
            previous_turn: valFact.source_turn,
          };
          valFact.original_text_th = `${ch.amount_thb.toLocaleString("en-US")} บาท`;
          valFact.normalized_category = `STATED_VALUE_THB_${Math.round(ch.amount_thb)}`;
          valFact.source_turn = nextTurnNumber;
        }
        clonedOverrides.push({
          fact_key: "fact_delta:set_amount:TOTAL",
          from_text_th: prevText,
          from_turn: Math.max(1, nextTurnNumber - 1),
          to_text_th: `${ch.amount_thb.toLocaleString("en-US")} บาท`,
          to_turn: nextTurnNumber,
        });
      }
    } else if (ch.op === "set_service_use_location" && ch.service_use_location) {
      const locCategoryMap: Record<
        NonNullable<typeof ch.service_use_location>,
        { category: VatServiceUseLocationCategory; textTh: string }
      > = {
        THAILAND_DOMESTIC: {
          category: "SERVICE_USED_IN_THAILAND_DOMESTIC",
          textTh: "ใช้บริการในประเทศไทย (แก้ไขข้อเท็จจริงสถานที่ใช้งาน)",
        },
        ENTIRELY_ABROAD: {
          category: "SERVICE_USED_ENTIRELY_ABROAD_EXPORT",
          textTh: "ใช้บริการทั้งหมดในต่างประเทศ (แก้ไขข้อเท็จจริงสถานที่ใช้งาน)",
        },
        MIXED_THAILAND_AND_ABROAD: {
          category: "SERVICE_USED_MIXED_THAILAND_AND_ABROAD",
          textTh:
            "มีการใช้บริการทั้งในประเทศไทยและในต่างประเทศ (Mixed Use — ต้องแยกสัดส่วนหรือมูลค่าค่าบริการตามสถานที่ที่มีการใช้บริการ)",
        },
        MIXED_PARTIAL: {
          category: "SERVICE_USED_MIXED_THAILAND_AND_ABROAD",
          textTh:
            "มีการใช้บริการทั้งในประเทศไทยและในต่างประเทศ (Mixed Use — ต้องแยกสัดส่วนหรือมูลค่าค่าบริการตามสถานที่ที่มีการใช้บริการ)",
        },
        PARTIALLY_THAILAND_REMAINDER_UNKNOWN: {
          category: "SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN",
          textTh:
            "มีการใช้บริการบางส่วนในประเทศไทย ส่วนที่เหลือยังไม่ระบุสถานที่ที่มีการใช้บริการ (Remainder Unknown)",
        },
        PARTIALLY_ABROAD_REMAINDER_UNKNOWN: {
          category: "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN",
          textTh:
            "มีการใช้บริการบางส่วนในต่างประเทศ ส่วนที่เหลือยังไม่ระบุสถานที่ที่มีการใช้บริการ (Remainder Unknown)",
        },
        UNKNOWN: {
          category: "SERVICE_USE_LOCATION_UNKNOWN",
          textTh: "ยังไม่ทราบสถานที่ที่มีการใช้บริการ (ต้องยืนยันว่าใช้ในประเทศไทยหรือต่างประเทศ)",
        },
      };
      // Enforce the EXACT SAME shared rule on follow-up corrections as on initial turns:
      // if the verbatim turn/span only states partial use in one location (e.g. "used partly in Japan"
      // or "used partly in Thailand"), NEVER collapse it into "used in Thailand and overseas"!
      const textClassified = extractServiceUseLocationFromText(
        ch.source_span || opts?.userTurnText || ""
      );
      const rawMapped = locCategoryMap[ch.service_use_location];
      const useDeterministicPartialOverride =
        textClassified &&
        (textClassified.category === "SERVICE_USED_PARTIALLY_THAILAND_REMAINDER_UNKNOWN" ||
          textClassified.category === "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN") &&
        (rawMapped.category === "SERVICE_USED_MIXED_THAILAND_AND_ABROAD" ||
          rawMapped.category === textClassified.category);
      const resolvedCategory: VatServiceUseLocationCategory = useDeterministicPartialOverride
        ? textClassified.category
        : rawMapped.category;
      const resolvedTextTh = useDeterministicPartialOverride
        ? textClassified.original_text_th
        : resolvedCategory === "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN" &&
            textClassified?.category === "SERVICE_USED_PARTIALLY_ABROAD_REMAINDER_UNKNOWN"
          ? textClassified.original_text_th
          : ch.source_span || rawMapped.textTh;

      const existingLocFact = clonedMaterialFacts.find((f) => f.fact_key === "vat_place_of_use");
      const prevText = existingLocFact?.original_text_th || "ไม่ระบุ";
      if (existingLocFact) {
        existingLocFact.overridden_from = {
          previous_text_th: existingLocFact.original_text_th,
          previous_category: existingLocFact.normalized_category,
          previous_turn: existingLocFact.source_turn,
        };
        existingLocFact.original_text_th = resolvedTextTh;
        existingLocFact.normalized_category = resolvedCategory;
        existingLocFact.source_turn = nextTurnNumber;
      } else {
        clonedMaterialFacts.push({
          fact_key: "vat_place_of_use",
          label_th: "สถานที่ที่มีการใช้บริการ",
          original_text_th: resolvedTextTh,
          normalized_category: resolvedCategory,
          source_turn: nextTurnNumber,
        });
      }
      clonedOverrides.push({
        fact_key: "fact_delta:set_service_use_location",
        from_text_th: prevText,
        from_turn: Math.max(1, nextTurnNumber - 1),
        to_text_th: `${resolvedCategory} (${resolvedTextTh})`,
        to_turn: nextTurnNumber,
      });
    }
  }

  // Rebuild `vat_portion_allocation_record` and `controlling_tax_point` deterministically from scratch
  // (NEVER copying `priorLedger.temporal_facts.vat_portion_allocation_record`!).
  const activeEvents = workingEvents.filter(
    (e) => e.event_status !== "NEGATED" && e.event_type !== "QUESTION_DATE"
  );
  const goodsDeliveries = activeEvents
    .filter((e) => e.is_goods_delivery || e.event_type === "DELIVERY")
    .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
  const primaryDelivery = goodsDeliveries[0] || null;

  let rebuiltAlloc: VerifiedGoodsVatAllocationRecord | undefined = undefined;
  let rebuiltSplitPoints: SplitPaymentTaxPointItem[] | undefined = undefined;
  let rebuiltControlling = { ...priorLedger.temporal_facts.controlling_tax_point };

  if (clonedLots.length >= 2) {
    const eventRank = (k: TemporalEventKind) =>
      k === "OWNERSHIP_TRANSFER" ? 0 : k === "PAYMENT" ? 1 : k === "INVOICE" ? 2 : 3;
    const lotAllocations: GoodsLotAllocationItem[] = [];

    for (const lot of clonedLots) {
      const lotEvents = activeEvents
        .filter((ev) => {
          if (
            ev.event_type !== "OWNERSHIP_TRANSFER" &&
            ev.event_type !== "PAYMENT" &&
            ev.event_type !== "INVOICE" &&
            ev.event_type !== "DELIVERY"
          ) {
            return false;
          }
          if (ev.explicitly_excluded_lot_ids?.includes(lot.lot_id)) return false;
          if (ev.covered_lot_ids && ev.covered_lot_ids.length > 0) {
            return ev.covered_lot_ids.includes(lot.lot_id);
          }
          return ev.portion_coverage === "FULL" || ev.event_type === "DELIVERY";
        })
        .sort((a, b) => {
          const d = a.iso_date.localeCompare(b.iso_date);
          if (d !== 0) return d;
          return eventRank(a.event_type) - eventRank(b.event_type);
        });

      const primaryEv = lotEvents[0] || primaryDelivery;
      if (!primaryEv) continue;

      const subsequentNonTaxable = lotEvents
        .slice(1)
        .filter((ev) => ev.iso_date > primaryEv.iso_date)
        .map((ev) => ({
          event_type: ev.event_type,
          iso_date: ev.iso_date,
          raw_text: ev.raw_text,
          provenance_clause_th: ev.provenance_clause_th || "",
          reason_th: `${lot.label_th} เกิดความรับผิดทางภาษีมูลค่าเพิ่มไปแล้วเมื่อวันที่ ${primaryEv.iso_date} (${deltaGoodsEventActionTh(primaryEv.event_type)}) — การ${deltaGoodsEventActionTh(ev.event_type)}เมื่อวันที่ ${ev.iso_date} สำหรับสินค้าเดิมไม่ก่อให้เกิดภาระภาษีซ้ำ`,
        }));
      const vatCalc = computeVerifiedVatForIsoAndBase(primaryEv.iso_date, lot.amount_thb);
      lotAllocations.push({
        lot_id: lot.lot_id,
        label_th: lot.label_th,
        taxable_base_thb: lot.amount_thb,
        controlling_tax_point_iso: primaryEv.iso_date,
        controlling_raw_date_th: primaryEv.raw_text,
        controlling_event_type: primaryEv.event_type,
        statutory_subclause_th: deltaGoodsEventSubclauseTh(primaryEv.event_type),
        decree_window: vatWindowBucketForIso(primaryEv.iso_date),
        governing_decree_work_id: governingDecreeWorkIdForIsoDate(primaryEv.iso_date),
        within_verified_coverage: primaryEv.iso_date >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        provenance_clause_th: primaryEv.provenance_clause_th || "",
        verified_rate_pct: vatCalc.ratePct,
        verified_vat_thb: vatCalc.vatThb,
        verified_gross_thb: vatCalc.grossThb,
        subsequent_non_taxable_events: subsequentNonTaxable,
      });
    }

    const lotsByDate = new Map<string, GoodsLotAllocationItem[]>();
    for (const la of lotAllocations) {
      const arr = lotsByDate.get(la.controlling_tax_point_iso) || [];
      arr.push(la);
      lotsByDate.set(la.controlling_tax_point_iso, arr);
    }
    const sortedDates = Array.from(lotsByDate.keys()).sort((a, b) => a.localeCompare(b));
    const taxDateBuckets: SplitPaymentTaxPointItem[] = sortedDates.map((iso, idx) => {
      const group = lotsByDate.get(iso)!;
      const bucketBase =
        Math.round(group.reduce((s, l) => s + l.taxable_base_thb, 0) * 100) / 100;
      const vatCalc = computeVerifiedVatForIsoAndBase(iso, bucketBase);
      return {
        portion_index: idx + 1,
        iso_date: iso,
        raw_text: group[0].controlling_raw_date_th,
        event_type: group[0].controlling_event_type,
        decree_window: vatWindowBucketForIso(iso),
        within_verified_coverage: iso >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
        governing_decree_work_id: governingDecreeWorkIdForIsoDate(iso),
        expired_or_non_governing_work_ids:
          iso > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
        amount_thb: bucketBase,
        lot_ids: group.map((l) => l.lot_id),
        lot_labels_th: group.map((l) => l.label_th),
        verified_rate_pct: vatCalc.ratePct,
        verified_vat_thb: vatCalc.vatThb,
        verified_gross_thb: vatCalc.grossThb,
      };
    });

    const declaredTotal = Math.round(clonedLots.reduce((s, l) => s + l.amount_thb, 0) * 100) / 100;
    const finalReconciledBase =
      Math.round(taxDateBuckets.reduce((s, b) => s + (b.amount_thb ?? 0), 0) * 100) / 100;
    const allBucketsVerified = taxDateBuckets.every(
      (b) => typeof b.verified_vat_thb === "number" && b.verified_vat_thb > 0
    );
    const totalVatThb = allBucketsVerified
      ? Math.round(taxDateBuckets.reduce((s, b) => s + (b.verified_vat_thb ?? 0), 0) * 100) / 100
      : null;
    const totalGrossThb =
      totalVatThb !== null ? Math.round((finalReconciledBase + totalVatThb) * 100) / 100 : null;

    rebuiltAlloc = {
      transaction_base_thb: declaredTotal,
      allocation_status: "RESOLVED",
      ambiguity_question_th: null,
      lot_allocations: lotAllocations,
      tax_date_buckets: taxDateBuckets,
      reconciled_total_base_thb: finalReconciledBase,
      reconciled_total_vat_thb: totalVatThb,
      reconciled_total_gross_thb: totalGrossThb,
      remaining_unallocated_base_thb: Math.max(
        0,
        Math.round((declaredTotal - finalReconciledBase) * 100) / 100
      ),
    };
    rebuiltSplitPoints = taxDateBuckets;
    const bucketSummaries = taxDateBuckets
      .map(
        (b) =>
          `วันที่ ${b.iso_date} (${b.decree_window}): ${(b.lot_labels_th || []).join(" + ")} ฐานภาษี ${(b.amount_thb ?? 0).toLocaleString("en-US")} บาท${
            b.verified_vat_thb !== null && b.verified_vat_thb !== undefined
              ? ` (VAT 7% = ${b.verified_vat_thb.toLocaleString("en-US")} บาท)`
              : ""
          }`
      )
      .join("; ");
    const nonTaxableNotes = lotAllocations
      .flatMap((l) => l.subsequent_non_taxable_events.map((s) => s.reason_th))
      .slice(0, 4);

    rebuiltControlling = {
      iso_date: taxDateBuckets.length === 1 ? taxDateBuckets[0].iso_date : null,
      controlling_event: `GOODS_LOT_ALLOCATED_MULTI_TAX_POINT (${taxDateBuckets
        .map(
          (b) =>
            `${b.iso_date}:${(b.lot_ids || []).join("+") || b.event_type}:${b.decree_window}:${b.amount_thb ?? "?"}`
        )
        .join(" | ")})`,
      statutory_rule_hint:
        `ประมวลรัษฎากร มาตรา 78 (1) ("ตามส่วนของการกระทำนั้นๆ") การจัดสรรตามล็อตสินค้า (นับแต่ละล็อตครั้งเดียวตามเหตุการณ์แรกสุดที่เกิดขึ้นและกระทบยอดตรงกับมูลค่ารวม ${finalReconciledBase.toLocaleString("en-US")} บาท): ${bucketSummaries}` +
        (nonTaxableNotes.length > 0 ? ` | ข้อสังเกตห้ามนับซ้ำ: ${nonTaxableNotes.join("; ")}` : ""),
      is_ambiguous: false,
      ambiguity_reason_th: null,
      ...(taxDateBuckets.length >= 2 ? { is_split_payment_multi_tax_point: true } : {}),
    };
  } else {
    // Non-lot single/split VAT transaction: recompute controlling tax point from updated activeEvents
    const vatEvs = activeEvents
      .filter((e) =>
        ["OWNERSHIP_TRANSFER", "DELIVERY", "PAYMENT", "INVOICE", "SERVICE_USE"].includes(
          e.event_type
        )
      )
      .sort((a, b) => a.iso_date.localeCompare(b.iso_date));
    if (vatEvs.length > 0) {
      const distinctDates = Array.from(new Set(vatEvs.map((e) => e.iso_date)));
      if (
        priorLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
        distinctDates.length >= 2
      ) {
        rebuiltSplitPoints = distinctDates.map((iso, idx) => {
          const ev = vatEvs.find((e) => e.iso_date === iso)!;
          const amt = ev.amount_thb ?? null;
          const vc = amt ? computeVerifiedVatForIsoAndBase(iso, amt) : null;
          return {
            portion_index: idx + 1,
            iso_date: iso,
            raw_text: ev.raw_text,
            event_type: ev.event_type,
            decree_window: vatWindowBucketForIso(iso),
            within_verified_coverage: iso >= VAT_RATE_VERIFIED_COVERAGE_START_ISO,
            governing_decree_work_id: governingDecreeWorkIdForIsoDate(iso),
            expired_or_non_governing_work_ids:
              iso > "2027-09-30" ? ["subreg.th.rc.royal_decree.807"] : [],
            ...(amt !== null
              ? {
                  amount_thb: amt,
                  verified_rate_pct: vc?.ratePct ?? null,
                  verified_vat_thb: vc?.vatThb ?? null,
                  verified_gross_thb: vc?.grossThb ?? null,
                }
              : {}),
          };
        });
        rebuiltControlling = {
          ...rebuiltControlling,
          iso_date: null,
          is_split_payment_multi_tax_point: true,
          controlling_event: `SPLIT_PAYMENT_MULTI_TAX_POINT (${rebuiltSplitPoints.map((p) => `${p.iso_date}:${p.decree_window}`).join(" + ")})`,
        };
      } else {
        const earliest = vatEvs[0];
        rebuiltControlling = {
          ...rebuiltControlling,
          iso_date: earliest.iso_date,
          is_split_payment_multi_tax_point: false,
          controlling_event: `${earliest.event_type} (${earliest.raw_text}, Turn ${earliest.source_turn})`,
        };
      }
    }
  }

  const activePlaceFactAfterDelta = clonedMaterialFacts.find(
    (f) => f.fact_key === "vat_place_of_use"
  );
  const syncedUnknownFacts = (priorLedger.explicitly_unknown_facts_th || []).filter(
    (u) => !/สถานที่ที่มีการใช้บริการ/.test(u)
  );
  if (activePlaceFactAfterDelta) {
    const unknownPlaceNote = buildUnknownServiceUseFactNoteTh(
      activePlaceFactAfterDelta.normalized_category,
      activePlaceFactAfterDelta.original_text_th
    );
    if (unknownPlaceNote && !syncedUnknownFacts.includes(unknownPlaceNote)) {
      syncedUnknownFacts.push(unknownPlaceNote);
    }
  }

  const nextLedger: StructuredCaseFactLedger = {
    ...priorLedger,
    turn_count: clonedUserTurns.length,
    is_new_conversation: false,
    user_turns: clonedUserTurns,
    material_facts: clonedMaterialFacts,
    overrides: clonedOverrides,
    explicitly_unknown_facts_th: syncedUnknownFacts,
    temporal_facts: {
      ...priorLedger.temporal_facts,
      transaction_or_event_dates: workingEvents,
      legal_as_of_date: opts?.applicableDate ?? priorLedger.temporal_facts.legal_as_of_date,
      ...(clonedLots.length > 0 ? { declared_goods_lots: clonedLots } : {}),
      ...(rebuiltAlloc ? { vat_portion_allocation_record: rebuiltAlloc } : {}),
      ...(rebuiltSplitPoints ? { split_payment_tax_points: rebuiltSplitPoints } : {}),
      controlling_tax_point: rebuiltControlling,
    },
    questions_asked_th: opts?.userTurnText ? [opts.userTurnText] : priorLedger.questions_asked_th,
  };

  if (!rebuiltAlloc) {
    delete nextLedger.temporal_facts.vat_portion_allocation_record;
  }
  if (!rebuiltSplitPoints) {
    delete nextLedger.temporal_facts.split_payment_tax_points;
  }

  const afterHash = computeLedgerStateHash(nextLedger);
  nextLedger.ledger_state_hash = afterHash;
  if (nextLedger.temporal_facts.vat_portion_allocation_record) {
    nextLedger.temporal_facts.vat_portion_allocation_record.ledger_after_hash = afterHash;
  }
  return nextLedger;
}
