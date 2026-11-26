import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFactDelta,
  buildStructuredCaseFactLedger,
  computeLedgerStateHash,
  type StructuredCaseFactLedger,
} from "../../src/core/knowledge/case-fact-ledger";
import {
  evaluateFactDeltaFailClosed,
  validateFactDelta,
  type FactDelta,
  type FactDeltaExtractionOutcome,
} from "../../src/core/knowledge/fact-delta";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

const SF_C11_3A_R1 =
  "บริษัท ทดสอบนกแก้ว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น ส่วนเหตุการณ์อื่นทั้งหมด ได้แก่ การโอนกรรมสิทธิ์ การรับชำระราคา และการออกใบกำกับภาษีของล็อต B และล็อต C รวมทั้งการส่งมอบสินค้าทั้ง 3 ล็อต เกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const SF_C11_3B_R2 =
  "ขอเปลี่ยนข้อเท็จจริงว่า เหตุการณ์ทั้งหมดที่เดิมเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 ให้เปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 2 ตุลาคม 2569 แทน ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด วันเกิดความรับผิด พระราชกฤษฎีกา และภาษีมูลค่าเพิ่มของแต่ละส่วนเป็นอย่างไร";

const R3_EXACT_EN =
  "Correction: the 30 September payment and tax invoice covered lot B only. Keep all other facts unchanged.";

const SF_C11_3C_LOT_C =
  "ขอเปลี่ยนข้อเท็จจริงเฉพาะล็อต C มูลค่า 10,000 บาทว่า บริษัทได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C เมื่อวันที่ 30 กันยายน 2569 ส่วนข้อเท็จจริงของล็อต A และล็อต B เหมือนเดิมทั้งหมด ภาระภาษีมูลค่าเพิ่มของแต่ละส่วนเปลี่ยนไปอย่างไร";

function buildR2Ledger(): StructuredCaseFactLedger {
  return buildStructuredCaseFactLedger({
    question: SF_C11_3B_R2,
    applicableDate: null,
    conversationHistory: [{ role: "user", content: SF_C11_3A_R1 }],
  });
}

function buildR1Ledger(): StructuredCaseFactLedger {
  return buildStructuredCaseFactLedger({
    question: SF_C11_3A_R1,
    applicableDate: null,
    conversationHistory: [],
  });
}

function makeMockOutcome(
  delta: FactDelta | null,
  priorLedger: StructuredCaseFactLedger,
  userTurnText: string
): FactDeltaExtractionOutcome {
  const validation = validateFactDelta(delta, priorLedger, userTurnText);
  return {
    ok: validation.valid,
    provider_failed: false,
    raw_delta: delta,
    validation,
    raw_output_text: JSON.stringify(delta),
    invocation_audit: {
      provider: "google-gemini",
      requested_model: "gemini-4-neon",
      resolved_model: "gemini-4-neon",
      thinking_level: "low",
      temperature: 0,
      silent_fallback_disabled: true,
      live_provider_called: true,
      failure_classification: "NONE",
      latency_ms: 12,
      input_tokens: 100,
      output_tokens: 50,
      thought_tokens: 10,
      total_tokens: 160,
      error_summary: null,
    },
  };
}

describe("C12 Workstream A — Structured FactDelta Extraction, Validation & Pure Application", () => {
  it("A5.1: applies exact DEF-C11-2 English r3 correction against r2 ledger -> A 29 Sep, B 30 Sep, C 2 Oct", () => {
    const r2Ledger = buildR2Ledger();
    const beforeHash = computeLedgerStateHash(r2Ledger);
    const r2SnapshotBefore = JSON.stringify(r2Ledger);

    const delta: FactDelta = {
      is_correction: true,
      confidence: "high",
      changes: [
        {
          op: "reassign_lots",
          event_type: "PAYMENT",
          lots: ["LOT_B"],
          lots_mode: "only",
          from_date: "2026-09-30",
          to_date: "2026-09-30",
          amount_thb: null,
          source_span: "30 September payment and tax invoice covered lot B only",
        },
        {
          op: "reassign_lots",
          event_type: "INVOICE",
          lots: ["LOT_B"],
          lots_mode: "only",
          from_date: "2026-09-30",
          to_date: "2026-09-30",
          amount_thb: null,
          source_span: "30 September payment and tax invoice covered lot B only",
        },
      ],
      unchanged_scope: "all_other_facts",
    };

    const validation = validateFactDelta(delta, r2Ledger, R3_EXACT_EN);
    expect(validation.valid).toBe(true);
    expect(validation.normalized_delta).not.toBeNull();

    const r3Ledger = applyFactDelta(r2Ledger, validation.normalized_delta!, {
      userTurnText: R3_EXACT_EN,
    });

    // Purity check: r2Ledger untouched
    expect(JSON.stringify(r2Ledger)).toBe(r2SnapshotBefore);

    const afterHash = computeLedgerStateHash(r3Ledger);
    expect(afterHash).not.toBe(beforeHash);
    expect(r3Ledger.ledger_state_hash).toBe(afterHash);

    const alloc = r3Ledger.temporal_facts.vat_portion_allocation_record!;
    expect(alloc).toBeDefined();
    expect(alloc.allocation_status).toBe("RESOLVED");
    expect(alloc.ledger_after_hash).toBe(afterHash);
    expect(alloc.reconciled_total_base_thb).toBe(50000);
    expect(alloc.reconciled_total_vat_thb).toBe(3500);
    expect(alloc.remaining_unallocated_base_thb).toBe(0);

    const byLot = new Map(alloc.lot_allocations.map((l) => [l.lot_id, l]));
    expect(byLot.get("LOT_A")?.controlling_tax_point_iso).toBe("2026-09-29");
    expect(byLot.get("LOT_A")?.decree_window).toBe("RD_799");
    expect(byLot.get("LOT_A")?.taxable_base_thb).toBe(20000);
    expect(byLot.get("LOT_A")?.verified_vat_thb).toBe(1400);

    expect(byLot.get("LOT_B")?.controlling_tax_point_iso).toBe("2026-09-30");
    expect(byLot.get("LOT_B")?.decree_window).toBe("RD_799");
    expect(byLot.get("LOT_B")?.taxable_base_thb).toBe(20000);
    expect(byLot.get("LOT_B")?.verified_vat_thb).toBe(1400);

    expect(byLot.get("LOT_C")?.controlling_tax_point_iso).toBe("2026-10-02");
    expect(byLot.get("LOT_C")?.decree_window).toBe("RD_807");
    expect(byLot.get("LOT_C")?.taxable_base_thb).toBe(10000);
    expect(byLot.get("LOT_C")?.verified_vat_thb).toBe(700);
  });

  it("A5.2: produces identical allocation across Thai, mixed Thai/English, and lot-first vs lot-last wordings", () => {
    const r2Ledger = buildR2Ledger();
    const variants: Array<{ label: string; text: string; span: string }> = [
      {
        label: "Thai wording",
        text: "ขอแก้ไขข้อเท็จจริง: การรับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569 ครอบคลุมเฉพาะล็อต B เท่านั้น ข้อเท็จจริงอื่นเหมือนเดิม",
        span: "ครอบคลุมเฉพาะล็อต B เท่านั้น",
      },
      {
        label: "Mixed Thai/English",
        text: "Correction: วันที่ 30 ก.ย. 69 payment และ tax invoice เป็นของ Lot B เท่านั้น ส่วนอื่นคงเดิม",
        span: "เป็นของ Lot B เท่านั้น",
      },
      {
        label: "Lot named first (English)",
        text: "Lot B only was covered by the 30 September payment and tax invoice; keep all other facts unchanged.",
        span: "Lot B only was covered by the 30 September payment and tax invoice",
      },
      {
        label: "Lot named last (English)",
        text: "The 30 September payment and tax invoice applied solely to lot B, with every other fact unchanged.",
        span: "applied solely to lot B",
      },
    ];

    for (const v of variants) {
      const delta: FactDelta = {
        is_correction: true,
        confidence: "high",
        changes: [
          {
            op: "reassign_lots",
            event_type: "PAYMENT",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: v.span,
          },
          {
            op: "reassign_lots",
            event_type: "INVOICE",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: v.span,
          },
        ],
        unchanged_scope: "all_other_facts",
      };
      const val = validateFactDelta(delta, r2Ledger, v.text);
      expect(val.valid, `variant ${v.label} failed: ${val.rejection_reasons.join("; ")}`).toBe(true);
      const next = applyFactDelta(r2Ledger, val.normalized_delta!, { userTurnText: v.text });
      const byLot = new Map(
        next.temporal_facts.vat_portion_allocation_record!.lot_allocations.map((l) => [l.lot_id, l])
      );
      expect(byLot.get("LOT_A")?.controlling_tax_point_iso).toBe("2026-09-29");
      expect(byLot.get("LOT_B")?.controlling_tax_point_iso).toBe("2026-09-30");
      expect(byLot.get("LOT_C")?.controlling_tax_point_iso).toBe("2026-10-02");
    }
  });

  it("A5.3: handles Lot C variant (SF-C11-3C) and Lot A + C combined correction", () => {
    const r1Ledger = buildR1Ledger();
    // Lot C variant
    const lotCDelta: FactDelta = {
      is_correction: true,
      confidence: "high",
      changes: [
        {
          op: "set_event",
          event_type: "PAYMENT",
          lots: ["LOT_C"],
          lots_mode: "only",
          from_date: null,
          to_date: "2026-09-30",
          amount_thb: 10000,
          source_span: "ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C เมื่อวันที่ 30 กันยายน 2569",
        },
        {
          op: "set_event",
          event_type: "INVOICE",
          lots: ["LOT_C"],
          lots_mode: "only",
          from_date: null,
          to_date: "2026-09-30",
          amount_thb: 10000,
          source_span: "ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C เมื่อวันที่ 30 กันยายน 2569",
        },
      ],
      unchanged_scope: "all_other_facts",
    };
    const valC = validateFactDelta(lotCDelta, r1Ledger, SF_C11_3C_LOT_C);
    expect(valC.valid).toBe(true);
    const afterC = applyFactDelta(r1Ledger, valC.normalized_delta!, {
      userTurnText: SF_C11_3C_LOT_C,
    });
    const byLotC = new Map(
      afterC.temporal_facts.vat_portion_allocation_record!.lot_allocations.map((l) => [l.lot_id, l])
    );
    expect(byLotC.get("LOT_A")?.controlling_tax_point_iso).toBe("2026-09-29");
    expect(byLotC.get("LOT_A")?.verified_vat_thb).toBe(1400);
    expect(byLotC.get("LOT_C")?.controlling_tax_point_iso).toBe("2026-09-30");
    expect(byLotC.get("LOT_C")?.decree_window).toBe("RD_799");
    expect(byLotC.get("LOT_C")?.verified_vat_thb).toBe(700);
    expect(byLotC.get("LOT_B")?.controlling_tax_point_iso).toBe("2026-10-01");
    expect(byLotC.get("LOT_B")?.decree_window).toBe("RD_807");
    expect(byLotC.get("LOT_B")?.verified_vat_thb).toBe(1400);

    // Combined Lot A + C reassignment from r2 ledger
    const r2Ledger = buildR2Ledger();
    const acTurn =
      "Correction: the 30 September payment and tax invoice covered lot A and lot C only. Keep all other facts unchanged.";
    const acDelta: FactDelta = {
      is_correction: true,
      confidence: "high",
      changes: [
        {
          op: "reassign_lots",
          event_type: "PAYMENT",
          lots: ["LOT_A", "LOT_C"],
          lots_mode: "only",
          from_date: "2026-09-30",
          to_date: "2026-09-30",
          amount_thb: 30000,
          source_span: "covered lot A and lot C only",
        },
        {
          op: "reassign_lots",
          event_type: "INVOICE",
          lots: ["LOT_A", "LOT_C"],
          lots_mode: "only",
          from_date: "2026-09-30",
          to_date: "2026-09-30",
          amount_thb: 30000,
          source_span: "covered lot A and lot C only",
        },
      ],
      unchanged_scope: "all_other_facts",
    };
    const valAC = validateFactDelta(acDelta, r2Ledger, acTurn);
    expect(valAC.valid).toBe(true);
    const afterAC = applyFactDelta(r2Ledger, valAC.normalized_delta!, { userTurnText: acTurn });
    const byLotAC = new Map(
      afterAC.temporal_facts.vat_portion_allocation_record!.lot_allocations.map((l) => [l.lot_id, l])
    );
    expect(byLotAC.get("LOT_A")?.controlling_tax_point_iso).toBe("2026-09-29");
    expect(byLotAC.get("LOT_C")?.controlling_tax_point_iso).toBe("2026-09-30");
    expect(byLotAC.get("LOT_B")?.controlling_tax_point_iso).toBe("2026-10-02");
  });

  it("A5.4: no-op follow-up ('สรุปให้อีกครั้ง') yields empty delta, unchanged allocation, and does NOT fail closed", () => {
    const r2Ledger = buildR2Ledger();
    const beforeHash = computeLedgerStateHash(r2Ledger);
    const noopText = "สรุปให้อีกครั้ง";
    const noopDelta: FactDelta = {
      is_correction: false,
      confidence: "high",
      changes: [],
      unchanged_scope: "all_other_facts",
    };
    const outcome = makeMockOutcome(noopDelta, r2Ledger, noopText);
    expect(outcome.ok).toBe(true);
    const nextLedger = applyFactDelta(r2Ledger, outcome.validation.normalized_delta!, {
      userTurnText: noopText,
    });
    const afterHash = computeLedgerStateHash(nextLedger);
    expect(afterHash).toBe(beforeHash);

    const failClosed = evaluateFactDeltaFailClosed({
      userTurnText: noopText,
      priorLedger: r2Ledger,
      extraction: outcome,
      ledgerBeforeHash: beforeHash,
      ledgerAfterHash: afterHash,
    });
    expect(failClosed.fail_closed).toBe(false);
    expect(nextLedger.temporal_facts.vat_portion_allocation_record?.tax_date_buckets).toHaveLength(2);
  });

  it("A1 + A4: rejects non-verbatim source_span, unknown lot ID, low confidence, and unapplied corrections (fail closed)", () => {
    const r2Ledger = buildR2Ledger();
    const beforeHash = computeLedgerStateHash(r2Ledger);

    // 1) Non-verbatim source_span
    const badSpanVal = validateFactDelta(
      {
        is_correction: true,
        confidence: "high",
        changes: [
          {
            op: "reassign_lots",
            event_type: "PAYMENT",
            lots: ["LOT_B"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: "not actually present in prompt",
          },
        ],
        unchanged_scope: "all_other_facts",
      },
      r2Ledger,
      R3_EXACT_EN
    );
    expect(badSpanVal.valid).toBe(false);
    expect(badSpanVal.rejection_reasons[0]).toMatch(/source_span/);

    // 2) Unknown lot ID ("LOT_D")
    const badLotTurn = "Correction: the 30 September payment covered lot D only.";
    const badLotOutcome = makeMockOutcome(
      {
        is_correction: true,
        confidence: "high",
        changes: [
          {
            op: "reassign_lots",
            event_type: "PAYMENT",
            lots: ["LOT_D"],
            lots_mode: "only",
            from_date: "2026-09-30",
            to_date: "2026-09-30",
            amount_thb: null,
            source_span: "covered lot D only",
          },
        ],
        unchanged_scope: "all_other_facts",
      },
      r2Ledger,
      badLotTurn
    );
    expect(badLotOutcome.validation.valid).toBe(false);
    const fcBadLot = evaluateFactDeltaFailClosed({
      userTurnText: badLotTurn,
      priorLedger: r2Ledger,
      extraction: badLotOutcome,
      ledgerBeforeHash: beforeHash,
      ledgerAfterHash: beforeHash,
    });
    expect(fcBadLot.fail_closed).toBe(true);
    expect(fcBadLot.clarification_question_th).toContain("lot D");

    // 3) Low confidence -> fail closed
    const ambigTurn = "ขอแก้ไขให้ใบกำกับภาษีวันที่ 30 ก.ย. เป็นของล็อตใดล็อตหนึ่งเท่านั้น";
    const lowConfOutcome = makeMockOutcome(
      {
        is_correction: true,
        confidence: "low",
        changes: [],
        unchanged_scope: "unspecified",
      },
      r2Ledger,
      ambigTurn
    );
    const fcLow = evaluateFactDeltaFailClosed({
      userTurnText: ambigTurn,
      priorLedger: r2Ledger,
      extraction: lowConfOutcome,
      ledgerBeforeHash: beforeHash,
      ledgerAfterHash: beforeHash,
    });
    expect(fcLow.fail_closed).toBe(true);
    expect(fcLow.reason).toBe("LOW_CONFIDENCE_FACT_DELTA");

    // 4) Correction keyword + empty/no-op change -> fail closed
    const unappliedTurn = "Correction: please update the other lot date instead.";
    const emptyOutcome = makeMockOutcome(
      {
        is_correction: true,
        confidence: "high",
        changes: [],
        unchanged_scope: "unspecified",
      },
      r2Ledger,
      unappliedTurn
    );
    const fcNoChange = evaluateFactDeltaFailClosed({
      userTurnText: unappliedTurn,
      priorLedger: r2Ledger,
      extraction: emptyOutcome,
      ledgerBeforeHash: beforeHash,
      ledgerAfterHash: beforeHash,
    });
    expect(fcNoChange.fail_closed).toBe(true);
    expect(fcNoChange.reason).toBe("CORRECTION_PRODUCED_NO_LEDGER_CHANGE");
  });

  it("A5.5 Property test: random ledgers & valid deltas preserve total base and assign every lot exactly 1 tax point", () => {
    let seed = 20261126;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
    const candidateDates = [
      "2026-09-25",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-10",
    ];
    const eventKinds = ["OWNERSHIP_TRANSFER", "PAYMENT", "INVOICE"] as const;

    for (let trial = 0; trial < 50; trial++) {
      const lotCount = 2 + (trial % 4); // 2..5 lots
      const lotLetters = ["A", "B", "C", "D", "E"].slice(0, lotCount);
      const declaredLots = lotLetters.map((ch) => ({
        lot_id: `LOT_${ch}`,
        label_th: `ล็อต ${ch}`,
        amount_thb: (1 + Math.floor(rand() * 5)) * 10000,
        source_turn: 1,
      }));
      const totalBase = declaredLots.reduce((s, l) => s + l.amount_thb, 0);

      const baseLedger: StructuredCaseFactLedger = {
        turn_count: 1,
        is_new_conversation: true,
        user_turns: [
          {
            turn_number: 1,
            raw_text: "synthetic property test turn 1",
            cleaned_active_text: "synthetic property test turn 1",
            explicit_applicable_date: null,
          },
        ],
        material_facts: [
          {
            fact_key: "vat_registrant_status",
            label_th: "VAT",
            original_text_th: "VAT registered",
            normalized_category: "THAI_VAT_REGISTERED_OPERATOR",
            source_turn: 1,
          },
          {
            fact_key: "stated_asset_value_thb",
            label_th: "Total",
            original_text_th: `${totalBase} บาท`,
            normalized_category: `STATED_VALUE_THB_${totalBase}`,
            source_turn: 1,
          },
        ],
        overrides: [],
        temporal_facts: {
          transaction_or_event_dates: [
            {
              event_type: "OWNERSHIP_TRANSFER",
              raw_text: "29 กันยายน 2569",
              iso_date: "2026-09-29",
              source_turn: 1,
              event_status: "ACTUAL",
              portion_coverage: "PARTIAL",
              covered_lot_ids: [declaredLots[0].lot_id],
              amount_thb: declaredLots[0].amount_thb,
            },
            {
              event_type: "PAYMENT",
              raw_text: "30 กันยายน 2569",
              iso_date: "2026-09-30",
              source_turn: 1,
              event_status: "ACTUAL",
              portion_coverage: "PARTIAL",
              covered_lot_ids: [declaredLots[0].lot_id],
              amount_thb: declaredLots[0].amount_thb,
            },
            {
              event_type: "DELIVERY",
              raw_text: "1 ตุลาคม 2569",
              iso_date: "2026-10-01",
              source_turn: 1,
              event_status: "ACTUAL",
              portion_coverage: "FULL",
              covered_lot_ids: declaredLots.map((l) => l.lot_id),
              amount_thb: totalBase,
              is_goods_delivery: true,
            },
          ],
          legal_as_of_date: null,
          declared_goods_lots: declaredLots,
          controlling_tax_point: {
            iso_date: null,
            controlling_event: null,
            statutory_rule_hint: null,
            is_ambiguous: false,
            ambiguity_reason_th: null,
            is_split_payment_multi_tax_point: true,
          },
        },
        explicitly_unknown_facts_th: [],
        questions_asked_th: [],
        fact_preservation_guards: {
          asset_original_noun_th: null,
          forbid_land_substitution: false,
          recipient_original_noun_th: null,
          forbid_niece_substitution: false,
          recipient_kinship_category: null,
          is_ambiguous_lan_sao: false,
        },
      };

      const op = pick(["reassign_lots", "set_event", "shift_date", "remove_event", "set_amount"] as const);
      const targetLot = pick(declaredLots);
      const span = "synthetic correction span";
      let delta: FactDelta;

      if (op === "reassign_lots") {
        delta = {
          is_correction: true,
          confidence: "high",
          changes: [
            {
              op: "reassign_lots",
              event_type: "PAYMENT",
              lots: [targetLot.lot_id],
              lots_mode: pick(["only", "add"] as const),
              from_date: "2026-09-30",
              to_date: "2026-09-30",
              amount_thb: null,
              source_span: span,
            },
          ],
          unchanged_scope: "all_other_facts",
        };
      } else if (op === "set_event") {
        delta = {
          is_correction: true,
          confidence: "high",
          changes: [
            {
              op: "set_event",
              event_type: pick([...eventKinds]),
              lots: [targetLot.lot_id],
              lots_mode: "only",
              from_date: null,
              to_date: pick(candidateDates),
              amount_thb: targetLot.amount_thb,
              source_span: span,
            },
          ],
          unchanged_scope: "all_other_facts",
        };
      } else if (op === "shift_date") {
        delta = {
          is_correction: true,
          confidence: "high",
          changes: [
            {
              op: "shift_date",
              event_type: null,
              lots: [],
              lots_mode: "only",
              from_date: "2026-10-01",
              to_date: "2026-10-05",
              amount_thb: null,
              source_span: span,
            },
          ],
          unchanged_scope: "all_other_facts",
        };
      } else if (op === "remove_event") {
        delta = {
          is_correction: true,
          confidence: "high",
          changes: [
            {
              op: "remove_event",
              event_type: "PAYMENT",
              lots: [declaredLots[0].lot_id],
              lots_mode: "remove",
              from_date: "2026-09-30",
              to_date: null,
              amount_thb: null,
              source_span: span,
            },
          ],
          unchanged_scope: "all_other_facts",
        };
      } else {
        delta = {
          is_correction: true,
          confidence: "high",
          changes: [
            {
              op: "set_amount",
              event_type: null,
              lots: [targetLot.lot_id],
              lots_mode: "only",
              from_date: null,
              to_date: null,
              amount_thb: targetLot.amount_thb + 5000,
              source_span: span,
            },
          ],
          unchanged_scope: "all_other_facts",
        };
      }

      const val = validateFactDelta(delta, baseLedger, `turn 2: ${span}`);
      expect(val.valid, `trial ${trial} (${op}): ${val.rejection_reasons.join("; ")}`).toBe(true);

      const next = applyFactDelta(baseLedger, val.normalized_delta!, {
        userTurnText: `turn 2: ${span}`,
      });
      const alloc = next.temporal_facts.vat_portion_allocation_record!;
      expect(alloc).toBeDefined();
      const expectedTotal = (next.temporal_facts.declared_goods_lots || []).reduce(
        (s, l) => s + l.amount_thb,
        0
      );

      // Conservation of total base
      expect(alloc.transaction_base_thb).toBe(expectedTotal);
      expect(alloc.reconciled_total_base_thb).toBe(expectedTotal);
      expect(alloc.remaining_unallocated_base_thb).toBe(0);

      // Every lot assigned exactly 1 controlling tax point
      expect(alloc.lot_allocations).toHaveLength(lotCount);
      const seenLotIds = new Set(alloc.lot_allocations.map((la) => la.lot_id));
      expect(seenLotIds.size).toBe(lotCount);
      for (const la of alloc.lot_allocations) {
        expect(la.controlling_tax_point_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // Hash consistency
      expect(alloc.ledger_after_hash).toBe(computeLedgerStateHash(next));
    }
  });

  it("A2/A3/A4 end-to-end queryKnowledge: English r3 fails closed when low-confidence and logs delta_disagreement when applied", async () => {
    const store = new DurableKnowledgeStore(
      path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging")
    );
    const actor: Actor = {
      actor_id: "c12.test@reg24.th",
      tenant_id: "PUBLIC",
      role: "legal_reviewer",
      authorized_scopes: ["PUBLIC"],
    };

    // 1) Low-confidence ambiguous correction -> NEEDS_CLARIFICATION (fail closed, 0 claims, no allocation record)
    const ambigRes = await queryKnowledge(
      {
        question: "Correction: move the earlier payment to one of the other lots.",
        applicable_date: null,
        answer_generation_mode: "llm_grounded",
        conversation_history: [
          { role: "user", content: SF_C11_3A_R1 },
          { role: "user", content: SF_C11_3B_R2 },
        ],
      },
      actor,
      {
        store,
        mockFactDeltaExtractorForTesting: () => ({
          is_correction: true,
          confidence: "low",
          changes: [],
          unchanged_scope: "unspecified",
        }),
      }
    );
    expect(ambigRes.status).toBe("NEEDS_CLARIFICATION");
    expect(ambigRes.claims).toHaveLength(0);
    expect(ambigRes.clarification_questions.length).toBeGreaterThanOrEqual(1);
    expect(ambigRes.answer).not.toContain("Verified VAT Allocation Record");

    // 2) Valid English r3 correction -> applies delta cleanly, logs delta_disagreement vs legacy regex
    const r3Res = await queryKnowledge(
      {
        question: R3_EXACT_EN,
        applicable_date: null,
        answer_generation_mode: "llm_grounded",
        conversation_history: [
          { role: "user", content: SF_C11_3A_R1 },
          { role: "user", content: SF_C11_3B_R2 },
        ],
      },
      actor,
      {
        store,
        mockFactDeltaExtractorForTesting: () => ({
          is_correction: true,
          confidence: "high",
          changes: [
            {
              op: "reassign_lots",
              event_type: "PAYMENT",
              lots: ["LOT_B"],
              lots_mode: "only",
              from_date: "2026-09-30",
              to_date: "2026-09-30",
              amount_thb: null,
              source_span: "covered lot B only",
            },
            {
              op: "reassign_lots",
              event_type: "INVOICE",
              lots: ["LOT_B"],
              lots_mode: "only",
              from_date: "2026-09-30",
              to_date: "2026-09-30",
              amount_thb: null,
              source_span: "covered lot B only",
            },
          ],
          unchanged_scope: "all_other_facts",
        }),
        llmMockInvokerForTesting: () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "แยกวันเกิดความรับผิดของล็อต A, B และ C ครบถ้วน",
          case_facts_used: [],
          issues: [
            {
              issue_id: "ISSUE_1_LOT_A_2026_09_29",
              issue_title_th: "ภาระภาษีมูลค่าเพิ่มของล็อต A (วันที่ 29 กันยายน 2569)",
              party_or_scope_th: "สินค้าล็อต A มูลค่า 20,000 บาท",
              conclusion_th:
                "ความรับผิดของล็อต A เกิดขึ้นเมื่อวันที่ 29 กันยายน 2569 ตามมาตรา 78 (1) (ก) อยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 7.0 เป็นเงิน 1,400 บาท",
              material_facts_relied_on: ["ล็อต A มูลค่า 20,000 บาท โอนกรรมสิทธิ์ 29 กันยายน 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd799.sec_1_2",
                "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2568 ตามมาตรา 2) และคำแนะนำกรมสรรพากร คิดเป็น VAT 1,400 บาท",
              authority_distinction_note_th: "ประมวลรัษฎากร มาตรา 78, 80 และ พ.ร.ฎ. ฉบับที่ 799",
              proposed_calculation: {
                formula_description_th: "20,000 x 7%",
                tax_base_thb: 20000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 20000,
                rate_pct: 7,
                computed_tax_thb: 1400,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["20,000 x 7% = 1,400 บาท"],
              },
              missing_facts_or_uncertainties_th: [],
            },
            {
              issue_id: "ISSUE_2_LOT_B_2026_09_30",
              issue_title_th: "ภาระภาษีมูลค่าเพิ่มของล็อต B (วันที่ 30 กันยายน 2569)",
              party_or_scope_th: "สินค้าล็อต B มูลค่า 20,000 บาท",
              conclusion_th:
                "ความรับผิดของล็อต B เกิดขึ้นเมื่อวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) (ข) และ (ค) อยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 7.0 เป็นเงิน 1,400 บาท",
              material_facts_relied_on: ["ล็อต B มูลค่า 20,000 บาท ชำระราคาและออกใบกำกับภาษี 30 กันยายน 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd799.sec_1_2",
                "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2568 ตามมาตรา 2) และคำแนะนำกรมสรรพากร คิดเป็น VAT 1,400 บาท",
              authority_distinction_note_th: "ประมวลรัษฎากร มาตรา 78, 80 และ พ.ร.ฎ. ฉบับที่ 799",
              proposed_calculation: {
                formula_description_th: "20,000 x 7%",
                tax_base_thb: 20000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 20000,
                rate_pct: 7,
                computed_tax_thb: 1400,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["20,000 x 7% = 1,400 บาท"],
              },
              missing_facts_or_uncertainties_th: [],
            },
            {
              issue_id: "ISSUE_3_LOT_C_2026_10_02",
              issue_title_th: "ภาระภาษีมูลค่าเพิ่มของล็อต C (วันที่ 2 ตุลาคม 2569)",
              party_or_scope_th: "สินค้าล็อต C มูลค่า 10,000 บาท",
              conclusion_th:
                "ความรับผิดของล็อต C เกิดขึ้นเมื่อวันที่ 2 ตุลาคม 2569 ตามมาตรา 78 (1) อยู่ภายใต้พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 7.0 เป็นเงิน 700 บาท",
              material_facts_relied_on: ["ล็อต C มูลค่า 10,000 บาท ส่งมอบและโอนกรรมสิทธิ์ 2 ตุลาคม 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd807.sec_1_2",
                "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2569 ตามมาตรา 2) และคำแนะนำกรมสรรพากร คิดเป็น VAT 700 บาท",
              authority_distinction_note_th: "ประมวลรัษฎากร มาตรา 78, 80 และ พ.ร.ฎ. ฉบับที่ 807",
              proposed_calculation: {
                formula_description_th: "10,000 x 7%",
                tax_base_thb: 10000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 10000,
                rate_pct: 7,
                computed_tax_thb: 700,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["10,000 x 7% = 700 บาท"],
              },
              missing_facts_or_uncertainties_th: [],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );

    expect(r3Res.status).toBe("ANSWERED");
    expect(r3Res.claims).toHaveLength(3);
    expect(r3Res.execution_provenance?.delta_disagreement).toBe(true);
    expect(r3Res.execution_provenance?.ledger_before_hash).toBeTruthy();
    expect(r3Res.execution_provenance?.ledger_after_hash).toBeTruthy();
    expect(r3Res.execution_provenance?.ledger_before_hash).not.toBe(
      r3Res.execution_provenance?.ledger_after_hash
    );
    expect(r3Res.answer).toContain("2026-09-29 (RD_799, ล็อต A");
    expect(r3Res.answer).toContain("2026-09-30 (RD_799, ล็อต B");
    expect(r3Res.answer).toContain("2026-10-02 (RD_807, ล็อต C");
  });
});
