import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import { evaluateSubstantiveClaimSupport } from "../../src/core/knowledge/answer-verification";
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
import { resolveServerActor } from "../../src/core/knowledge/http-auth";
import { onboardVerifiedOfficialAttachment } from "../../src/core/knowledge/source-onboarding";
import { queryKnowledge } from "../../src/core/knowledge/query";
import * as cte from "../../src/core/knowledge/claim-traceability-engine";
import {
  loadSavedAnswerFromPostgres,
  setCustomCitationDbTransportForTesting,
} from "../../src/core/knowledge/citation-postgres-store";
import type { Actor, GroundedAnswer } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";

const STAGING_STORE_SRC = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");

// Exact QA prompts preserved from frozen Candidate 10 (8cf706c)
const QA_DEF_C10_3_R1 =
  "[QA-SYNTHETIC C10 THREE-TURN] บริษัท ทดสอบนกแก้ว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น ส่วนเหตุการณ์อื่นทั้งหมด ได้แก่ การโอนกรรมสิทธิ์ การรับชำระราคา และการออกใบกำกับภาษีของล็อต B และล็อต C รวมทั้งการส่งมอบสินค้าทั้ง 3 ล็อต เกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const QA_DEF_C10_3_R2 =
  "ขอเปลี่ยนข้อเท็จจริงว่า เหตุการณ์ทั้งหมดที่เดิมเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 ให้เปลี่ยนเป็นเกิดขึ้นเมื่อวันที่ 2 ตุลาคม 2569 แทน ข้อเท็จจริงอื่นเหมือนเดิมทั้งหมด วันเกิดความรับผิด พระราชกฤษฎีกา และภาษีมูลค่าเพิ่มของแต่ละส่วนเป็นอย่างไร";

const QA_DEF_C10_3_R3_TARGETED_LOT_C =
  "ขอแก้ไขเฉพาะล็อต C เพิ่มเติมว่า บริษัทโอนกรรมสิทธิ์ในล็อต C เมื่อวันที่ 30 กันยายน 2569 โดยล็อต A และล็อต B รวมถึงข้อเท็จจริงอื่นทั้งหมดเหมือนเดิม วันเกิดความรับผิด พระราชกฤษฎีกา และภาษีมูลค่าเพิ่มของแต่ละส่วนเป็นอย่างไร";

const QA_DEF_C10_1_SF4 =
  "บริษัท ทดสอบหงส์ขาว จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แยกสินค้าเป็น 3 ชุด คือ ชุดที่ 1 ราคา 20,000 บาท ชุดที่ 2 ราคา 20,000 บาท และชุดที่ 3 ราคา 10,000 บาท เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์สำหรับชุดที่ 1 และในวันเดียวกันได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับชุดที่ 2 โดยชุดที่ 3 ยังไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อน จากนั้นบริษัทส่งมอบสินค้าทั้ง 3 ชุดพร้อมกันเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const QA_DEF_C10_2_INSTALLMENT =
  "บริษัท โอเมก้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่ารวม 100,000 บาท โดยไม่มีการใช้บริการหรือออกใบกำกับภาษีก่อนหน้า ลูกค้าแบ่งชำระ 2 งวด คือ งวดที่ 1 จำนวน 40,000 บาท วันที่ 25 กันยายน 2568 และงวดที่ 2 จำนวน 60,000 บาท วันที่ 5 ตุลาคม 2568 ฝ่ายบัญชีคำนวณว่างวดที่ 1 ต้องเสียภาษีมูลค่าเพิ่ม 4,200 บาท ถูกต้องหรือไม่ และแต่ละงวดต้องเสียภาษีมูลค่าเพิ่มตามพระราชกฤษฎีกาฉบับใดและเป็นเงินเท่าใด";

const QA_DEF_C10_4_K1 =
  "นายกิตติโอนเงินสดจำนวน 24,000,000 บาท จากบัญชีธนาคารของตนให้แก่นางสาวพิมพ์ชนก ซึ่งเป็นบุตรสาวชอบด้วยกฎหมาย โดยเสน่หาเมื่อวันที่ 15 มีนาคม 2569 เพื่อนำไปใช้ลงทุนทั่วไป (ไม่เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณี) นางสาวพิมพ์ชนกต้องเสียภาษีเงินได้บุคคลธรรมดาอย่างไรและเป็นเงินเท่าใด";

const QA_DEF_C10_4_K2 =
  "ขอแก้ไขข้อเท็จจริงว่านายกิตติโอนเงินสดจำนวน 30,000,000 บาท (แทน 24,000,000 บาท) ในวันที่ 15 มีนาคม 2569 ข้อเท็จจริงอื่นเหมือนเดิม ภาษีเงินได้บุคคลธรรมดาของนางสาวพิมพ์ชนกเปลี่ยนเป็นเท่าใด";

const MOCK_INVOCATION_AUDIT = {
  provider: "google-gemini" as const,
  api_surface: "interactions-v1beta" as const,
  requested_model: "gemini-4-neon",
  resolved_model: "gemini-4-neon",
  actual_model_invoked: "gemini-4-neon",
  live_provider_called: true,
  silent_fallback_disabled: true,
  prompt_version: "reg24-grounded-llm-legal-application-v1.1",
  pinned_settings: {
    temperature: 0,
    max_output_tokens: 16384,
    thinking_level: "low" as const,
    thinking_level_note: null,
    store: false,
    timeout_ms: 240000,
  },
  provider_interaction_id: null,
  provider_response_status: "completed",
  latency_ms: 1200,
  input_tokens: 1000,
  output_tokens: 500,
  thought_tokens: 100,
  total_tokens: 1600,
  estimated_cost_usd: 0.01,
  failure_classification: "NONE" as const,
  error_summary: null,
  attempts: [
    {
      provider: "google-gemini" as const,
      model: "gemini-4-neon",
      thinking_level: "low" as const,
      status: "succeeded" as const,
      http_status: 200,
      latency_ms: 1200,
    },
  ],
};

describe("Formal Test 1 Candidate 11 — Consolidated 5-Defect Remediation Suite (DEF-C10-1..5)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand11-"));
    fs.cpSync(STAGING_STORE_SRC, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
  }, 60_000);

  afterEach(() => {
    setCustomCitationDbTransportForTesting(null);
  });

  afterAll(() => {
    setCustomCitationDbTransportForTesting(null);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 1. DEF-C10-3 (Critical): Lot A's 30 Sep date spills into Lots B and C
  // =========================================================================
  describe("DEF-C10-3 (Critical): Per-clause lot binding, negated bounds, r1->r2->r3 date shifts & variants", () => {
    it("D3-1: Exact QA r1 isolates Lot A (29 Sep, RD 799, 20k -> 1,400) and allocates B+C to 1 Oct (RD 807, 30k -> 2,100) with zero 30 Sep spill or fake ownership transfer", () => {
      const fl = buildStructuredCaseFactLedger({ question: QA_DEF_C10_3_R1, applicableDate: null });
      const alloc = fl.temporal_facts.vat_portion_allocation_record;
      expect(alloc).toBeDefined();
      expect(alloc!.allocation_status).toBe("RESOLVED");

      // No fake OWNERSHIP_TRANSFER on 30 Sep, and 30 Sep PAYMENT/INVOICE must cover ONLY LOT_A!
      const sep30Events = fl.temporal_facts.transaction_or_event_dates.filter(
        (e) => e.iso_date === "2026-09-30"
      );
      expect(sep30Events.some((e) => e.event_type === "OWNERSHIP_TRANSFER")).toBe(false);
      for (const ev of sep30Events) {
        expect(ev.covered_lot_ids).toEqual(["LOT_A"]);
      }

      // Negated boundary clause "โดยไม่มีเหตุการณ์ใดของล็อต B และล็อต C ก่อนวันที่ 1 ตุลาคม 2569" must be NEGATED, not a positive event
      const negClauses = fl.temporal_facts.non_occurring_or_negated_events || [];
      expect(
        negClauses.some((n) => n.iso_date === "2026-10-01" && n.status === "NEGATED")
      ).toBe(true);
      expect(
        fl.temporal_facts.transaction_or_event_dates.some(
          (e) => e.event_type === "STATED_TRANSACTION_DATE" && e.iso_date === "2026-10-01"
        )
      ).toBe(false);

      // Assert EVERY lot individually: lot, event, date, decree, base, tax
      const lotA = alloc!.lot_allocations.find((l) => l.lot_id === "LOT_A");
      const lotB = alloc!.lot_allocations.find((l) => l.lot_id === "LOT_B");
      const lotC = alloc!.lot_allocations.find((l) => l.lot_id === "LOT_C");
      expect(lotA).toMatchObject({
        lot_id: "LOT_A",
        taxable_base_thb: 20000,
        controlling_tax_point_iso: "2026-09-29",
        controlling_event_type: "OWNERSHIP_TRANSFER",
        decree_window: "RD_799",
        verified_vat_thb: 1400,
      });
      expect(lotB).toMatchObject({
        lot_id: "LOT_B",
        taxable_base_thb: 20000,
        controlling_tax_point_iso: "2026-10-01",
        decree_window: "RD_807",
        verified_vat_thb: 1400,
      });
      expect(lotC).toMatchObject({
        lot_id: "LOT_C",
        taxable_base_thb: 10000,
        controlling_tax_point_iso: "2026-10-01",
        decree_window: "RD_807",
        verified_vat_thb: 700,
      });

      expect(alloc!.tax_date_buckets).toHaveLength(2);
      expect(alloc!.tax_date_buckets[0]).toMatchObject({
        iso_date: "2026-09-29",
        decree_window: "RD_799",
        amount_thb: 20000,
        verified_vat_thb: 1400,
        lot_ids: ["LOT_A"],
      });
      expect(alloc!.tax_date_buckets[1]).toMatchObject({
        iso_date: "2026-10-01",
        decree_window: "RD_807",
        amount_thb: 30000,
        verified_vat_thb: 2100,
        lot_ids: ["LOT_B", "LOT_C"],
      });
    });

    it("D3-2: Exact QA r2 shifts ONLY 1 Oct events to 2 Oct (B+C -> 2 Oct 2569 / RD 807 / 30,000 / 2,100) while leaving Lot A on 29 Sep unchanged; r3 targeted Lot C edit updates ONLY Lot C", () => {
      const fl2 = buildStructuredCaseFactLedger({
        question: QA_DEF_C10_3_R2,
        applicableDate: null,
        conversationHistory: [{ role: "user", content: QA_DEF_C10_3_R1 }],
      });
      const alloc2 = fl2.temporal_facts.vat_portion_allocation_record!;
      expect(alloc2.allocation_status).toBe("RESOLVED");
      expect(alloc2.lot_allocations.find((l) => l.lot_id === "LOT_A")).toMatchObject({
        controlling_tax_point_iso: "2026-09-29",
        decree_window: "RD_799",
        taxable_base_thb: 20000,
        verified_vat_thb: 1400,
      });
      expect(alloc2.lot_allocations.find((l) => l.lot_id === "LOT_B")).toMatchObject({
        controlling_tax_point_iso: "2026-10-02",
        decree_window: "RD_807",
        taxable_base_thb: 20000,
        verified_vat_thb: 1400,
      });
      expect(alloc2.lot_allocations.find((l) => l.lot_id === "LOT_C")).toMatchObject({
        controlling_tax_point_iso: "2026-10-02",
        decree_window: "RD_807",
        taxable_base_thb: 10000,
        verified_vat_thb: 700,
      });
      expect(alloc2.tax_date_buckets).toHaveLength(2);
      expect(alloc2.tax_date_buckets[1]).toMatchObject({
        iso_date: "2026-10-02",
        decree_window: "RD_807",
        amount_thb: 30000,
        verified_vat_thb: 2100,
        lot_ids: ["LOT_B", "LOT_C"],
      });

      // Turn 3 (r3): targeted edit to Lot C ONLY (30 Sep 2569) leaves Lot A (29 Sep) and Lot B (2 Oct) intact
      const fl3 = buildStructuredCaseFactLedger({
        question: QA_DEF_C10_3_R3_TARGETED_LOT_C,
        applicableDate: null,
        conversationHistory: [
          { role: "user", content: QA_DEF_C10_3_R1 },
          { role: "user", content: QA_DEF_C10_3_R2 },
        ],
      });
      const alloc3 = fl3.temporal_facts.vat_portion_allocation_record!;
      expect(alloc3.allocation_status).toBe("RESOLVED");
      expect(alloc3.lot_allocations.find((l) => l.lot_id === "LOT_A")).toMatchObject({
        controlling_tax_point_iso: "2026-09-29",
        decree_window: "RD_799",
        taxable_base_thb: 20000,
        verified_vat_thb: 1400,
      });
      expect(alloc3.lot_allocations.find((l) => l.lot_id === "LOT_C")).toMatchObject({
        controlling_tax_point_iso: "2026-09-30",
        decree_window: "RD_799",
        taxable_base_thb: 10000,
        verified_vat_thb: 700,
      });
      expect(alloc3.lot_allocations.find((l) => l.lot_id === "LOT_B")).toMatchObject({
        controlling_tax_point_iso: "2026-10-02",
        decree_window: "RD_807",
        taxable_base_thb: 20000,
        verified_vat_thb: 1400,
      });
    });

    it("D3-3: Reordered clauses, separate negation, and genuine same-date positive control all allocate accurately", () => {
      // Variant A: Reordered clauses (1 Oct stated BEFORE 29 Sep / 30 Sep) + separate negations for B and C
      const qReorderedSeparateNeg =
        "บริษัท ทดสอบนกแก้ว จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท การโอนกรรมสิทธิ์ การรับชำระราคา และการออกใบกำกับภาษีของล็อต B และล็อต C รวมทั้งการส่งมอบสินค้าทั้ง 3 ล็อต เกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 โดยสำหรับล็อต B ไม่มีการโอนกรรมสิทธิ์หรือรับชำระเงินก่อนวันที่ 1 ตุลาคม 2569 และสำหรับล็อต C ไม่มีการออกใบกำกับภาษีหรือเหตุการณ์ใดก่อนวันที่ 1 ตุลาคม 2569 ส่วนล็อต A บริษัทโอนกรรมสิทธิ์เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 ได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เท่านั้น วันเกิดความรับผิดแต่ละส่วนคือวันใด";
      const flReord = buildStructuredCaseFactLedger({
        question: qReorderedSeparateNeg,
        applicableDate: null,
      });
      const aReord = flReord.temporal_facts.vat_portion_allocation_record!;
      expect(aReord.lot_allocations.find((l) => l.lot_id === "LOT_A")?.controlling_tax_point_iso).toBe("2026-09-29");
      expect(aReord.lot_allocations.find((l) => l.lot_id === "LOT_B")?.controlling_tax_point_iso).toBe("2026-10-01");
      expect(aReord.lot_allocations.find((l) => l.lot_id === "LOT_C")?.controlling_tax_point_iso).toBe("2026-10-01");

      // Variant B: Genuine same-date positive control (B & C actually transfer ownership on 30 Sep 2569!)
      const qGenuineSameDate =
        "บริษัท ทดสอบนกแก้ว จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A เมื่อวันที่ 29 กันยายน 2569 และเมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์ในล็อต B และล็อต C พร้อมรับชำระราคาและออกใบกำกับภาษีสำหรับทั้ง 3 ล็อต จากนั้นส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดแต่ละส่วนคือวันใด";
      const flPos = buildStructuredCaseFactLedger({
        question: qGenuineSameDate,
        applicableDate: null,
      });
      const aPos = flPos.temporal_facts.vat_portion_allocation_record!;
      expect(aPos.lot_allocations.find((l) => l.lot_id === "LOT_A")).toMatchObject({
        controlling_tax_point_iso: "2026-09-29",
        decree_window: "RD_799",
        verified_vat_thb: 1400,
      });
      expect(aPos.lot_allocations.find((l) => l.lot_id === "LOT_B")).toMatchObject({
        controlling_tax_point_iso: "2026-09-30",
        decree_window: "RD_799",
        verified_vat_thb: 1400,
      });
      expect(aPos.lot_allocations.find((l) => l.lot_id === "LOT_C")).toMatchObject({
        controlling_tax_point_iso: "2026-09-30",
        decree_window: "RD_799",
        verified_vat_thb: 700,
      });
    });

    it("D3-4: r3 targeted Lot C edit (2 Oct RD 807 -> 30 Sep RD 799) survives verifier & publication when contrasting prior RD 807, while affirmative wrong-version RD 807 stays rejected", async () => {
      const testActor: Actor = {
        actor_id: "trial.user.cand11.d3_4@reg24.th",
        role: "legal_reviewer",
        tenant_id: "tenant.trial.cand11",
        authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.cand11"],
        csrf_verified: true,
      };
      const r3Turn3Prompt =
        "ขอเปลี่ยนข้อเท็จจริงเฉพาะล็อต C มูลค่า 10,000 บาทว่า บริษัทได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C เมื่อวันที่ 30 กันยายน 2569 ส่วนข้อเท็จจริงของล็อต A และล็อต B เหมือนเดิมทั้งหมด ภาระภาษีมูลค่าเพิ่มของแต่ละส่วนเปลี่ยนไปอย่างไร";
      const r3Draft: GroundedLlmDraftResponse = {
        answer_status: "ANSWERED",
        overall_summary_th:
          "ล็อต A (20,000 บาท) วันที่ 29 กันยายน 2569 ภายใต้ พ.ร.ฎ. 799 ภาษีมูลค่าเพิ่ม 1,400 บาท; ล็อต C (10,000 บาท) เปลี่ยนมาวันที่ 30 กันยายน 2569 ภายใต้ พ.ร.ฎ. 799 ภาษีมูลค่าเพิ่ม 700 บาท; ล็อต B (20,000 บาท) วันที่ 2 ตุลาคม 2569 ภายใต้ พ.ร.ฎ. 807 ภาษีมูลค่าเพิ่ม 1,400 บาท",
        case_facts_used: [],
        issues: [
          {
            issue_id: "ISSUE_1_LOT_A_2026_09_29",
            issue_title_th: "ล็อต A (20,000 บาท) — 29 กันยายน 2569",
            party_or_scope_th: "ล็อต A มูลค่า 20,000 บาท",
            conclusion_th:
              "ล็อต A เกิดความรับผิดเมื่อวันที่ 29 กันยายน 2569 ตามมาตรา 78 (1) (ก) ภายใต้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
            material_facts_relied_on: ["ล็อต A มูลค่า 20,000 บาท โอนกรรมสิทธิ์วันที่ 29 กันยายน 2569"],
            governing_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd799.sec_1_2",
              "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            application_explanation_th:
              "ตามมาตรา 78 (1) (ก) และมาตรา 80 แห่งประมวลรัษฎากร ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2568) ภาษีมูลค่าเพิ่มรวมภาษีท้องถิ่นร้อยละ 7.0 ของ 20,000 บาท เท่ากับ 1,400 บาท",
            authority_distinction_note_th: "",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "20,000 × 7.0% = 1,400",
              tax_base_thb: 20000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 20000,
              rate_pct: 7,
              computed_tax_thb: 1400,
              steps_th: ["20,000 × 7.0% = 1,400 บาท"],
              missing_inputs_th: [],
            },
          },
          {
            issue_id: "ISSUE_2_LOT_C_2026_09_30",
            issue_title_th: "ล็อต C (10,000 บาท) — 30 กันยายน 2569",
            party_or_scope_th: "ล็อต C มูลค่า 10,000 บาท (แก้ไขข้อเท็จจริง)",
            conclusion_th:
              "ล็อต C มูลค่า 10,000 บาท เกิดความรับผิดเมื่อวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) (ข)/(ค) จึงเปลี่ยนจาก พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 มาอยู่ภายใต้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 แทน อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท",
            material_facts_relied_on: ["ล็อต C มูลค่า 10,000 บาท ชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569"],
            governing_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd799.sec_1_2",
              "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            application_explanation_th:
              "เมื่อได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต C เมื่อวันที่ 30 กันยายน 2569 ซึ่งอยู่ก่อนที่ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 จะเริ่มใช้บังคับ (1 ตุลาคม 2569) จึงเปลี่ยนจาก พ.ร.ฎ. (ฉบับที่ 807) มาใช้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2568) อัตราร้อยละ 7.0 คิดเป็น 700 บาท",
            authority_distinction_note_th: "",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "10,000 × 7.0% = 700",
              tax_base_thb: 10000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 10000,
              rate_pct: 7,
              computed_tax_thb: 700,
              steps_th: ["10,000 × 7.0% = 700 บาท"],
              missing_inputs_th: [],
            },
          },
          {
            issue_id: "ISSUE_3_LOT_B_2026_10_02",
            issue_title_th: "ล็อต B (20,000 บาท) — 2 ตุลาคม 2569",
            party_or_scope_th: "ล็อต B มูลค่า 20,000 บาท",
            conclusion_th:
              "ล็อต B มูลค่า 20,000 บาท ยังคงเกิดความรับผิดเมื่อวันที่ 2 ตุลาคม 2569 ตามมาตรา 78 (1) ภายใต้ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
            material_facts_relied_on: ["ล็อต B มูลค่า 20,000 บาท โอนกรรมสิทธิ์และส่งมอบวันที่ 2 ตุลาคม 2569"],
            governing_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd807.sec_1_2",
              "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            application_explanation_th:
              "ตามมาตรา 78 (1) และมาตรา 80 แห่งประมวลรัษฎากร ประกอบ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2569) ภาษีมูลค่าเพิ่มรวมภาษีท้องถิ่นร้อยละ 7.0 ของ 20,000 บาท เท่ากับ 1,400 บาท",
            authority_distinction_note_th: "",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "20,000 × 7.0% = 1,400",
              tax_base_thb: 20000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 20000,
              rate_pct: 7,
              computed_tax_thb: 1400,
              steps_th: ["20,000 × 7.0% = 1,400 บาท"],
              missing_inputs_th: [],
            },
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      };
      const r3Res = await queryKnowledge(
        {
          question: r3Turn3Prompt,
          conversation_history: [
            { role: "user", content: QA_DEF_C10_3_R1 },
            { role: "user", content: QA_DEF_C10_3_R2 },
          ],
          applicable_date: null,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        testActor,
        {
          store,
          persistAnswerAtomically: false,
          llmMockInvokerForTesting: async () => r3Draft,
        }
      );

      expect(r3Res.status).toBe("ANSWERED");
      expect(r3Res.traceable_answer?.status).toBe("complete");
      expect(r3Res.traceable_answer?.claims).toHaveLength(3);
      expect(
        r3Res.traceable_answer?.claims
          .map((c) => Number(c.bound_calculation?.outputs.computed_tax_thb ?? 0))
          .sort((a, b) => a - b)
      ).toEqual([700, 1400, 1400]);

      // Negative control: affirmatively citing RD 807 as governing for Lot C on 30 Sep MUST still be rejected!
      const badR3Draft: GroundedLlmDraftResponse = {
        ...r3Draft,
        issues: [
          r3Draft.issues[0],
          {
            ...r3Draft.issues[1],
            conclusion_th:
              "ล็อต C มูลค่า 10,000 บาท เกิดความรับผิดวันที่ 30 กันยายน 2569 และต้องใช้ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 เสียภาษี 700 บาท",
            application_explanation_th:
              "วันที่ 30 กันยายน 2569 ให้อยู่ภายใต้บังคับ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 อัตราร้อยละ 7.0 คิดเป็น 700 บาท",
          },
          r3Draft.issues[2],
        ],
      };
      const badR3Res = await queryKnowledge(
        {
          question: r3Turn3Prompt,
          conversation_history: [
            { role: "user", content: QA_DEF_C10_3_R1 },
            { role: "user", content: QA_DEF_C10_3_R2 },
          ],
          applicable_date: null,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        testActor,
        {
          store,
          persistAnswerAtomically: false,
          llmMockInvokerForTesting: async () => badR3Draft,
        }
      );
      expect(badR3Res.traceable_answer?.claims).toHaveLength(2);
      expect(
        badR3Res.traceable_answer?.claims
          .map((c) => Number(c.bound_calculation?.outputs.computed_tax_thb ?? 0))
      ).not.toContain(700);
    });
  });

  // =========================================================================
  // 2. DEF-C10-5 (Critical): Authorized reviewer cannot reopen attachment-backed answer
  // =========================================================================
  describe("DEF-C10-5 (Critical): Consistent server-verified tenant/matter scope across Attach -> Generate -> Save -> Reopen", () => {
    it("D5-1: Invite-authenticated reviewer can Attach, Generate, Save, and exact-Reopen r1 & r2 from Postgres while out-of-tenant, out-of-matter, and revoked evidence stay 404 and corpus fingerprint stays unchanged", async () => {
      const prevInviteOnly = process.env.REG24_TRIAL_INVITE_ONLY;
      process.env.REG24_TRIAL_INVITE_ONLY = "1";
      try {
        const reviewerA = resolveServerActor(
          new Request("http://localhost/api/v1/knowledge/answers", {
            headers: { "x-reg24-trial-invite": "cand11-reviewer-alpha-token" },
          })
        );
        const reviewerB = resolveServerActor(
          new Request("http://localhost/api/v1/knowledge/answers", {
            headers: { "x-reg24-trial-invite": "cand11-reviewer-beta-token" },
          })
        );
        const publicUnauth = resolveServerActor(
          new Request("http://localhost/api/v1/knowledge/answers")
        );

        const fpBefore = cte.computeEligibleReleaseCorpusFingerprint(store, "rel.B01.rc8");
        const attText =
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙\n" +
          "ให้ไว้ ณ วันที่ ๒๐ สิงหาคม พ.ศ. ๒๕๖๙\n" +
          "มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙”\n" +
          "มาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙ เป็นต้นไป";

        const onboarded = onboardVerifiedOfficialAttachment(store, {
          release_id: "rel.B01.rc8",
          issuer_id: "reg.th.rd",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 807) มาตรา ๑ [C11-TEST]",
          original_title_th:
            "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569",
          official_origin_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf",
          enactment_date: "2026-08-20",
          publication_date: "2026-08-23",
          effective_from: "2026-10-01",
          section_label: "มาตรา ๑",
          physical_page_one_based: 1,
          mime_type: "application/pdf",
          attachment_bytes_or_text: attText,
          actor: reviewerA,
        });

        // Eligible corpus counts & fingerprint MUST stay unchanged after attaching!
        const fpAfter = cte.computeEligibleReleaseCorpusFingerprint(store, "rel.B01.rc8");
        expect(fpAfter.eligible_official_documents).toBe(fpBefore.eligible_official_documents);
        expect(fpAfter.eligible_evidence_passages).toBe(fpBefore.eligible_evidence_passages);
        expect(fpAfter.eligible_corpus_fingerprint_sha256).toBe(
          fpBefore.eligible_corpus_fingerprint_sha256
        );

        const attDoc = onboarded.doc;
        const attVer = onboarded.version;
        const attPsg = onboarded.passages[0];
        const expectedScope = `scope.tenant.${reviewerA.tenant_id}`;
        expect(attDoc.access_scope).toBe(expectedScope);
        expect(attPsg.access_scope).toBe(expectedScope);

        // Mock Neon Postgres holding exact saved r1 and r2 citing the restricted attachment
        let docEligible = true;
        let psgEligible = true;
        const mockAnswerRow = (revNo: number) => ({
          answer_revision_id: `ans.trc.onb.cand11test.r${revNo}`,
          answer_id: "ans.trc.onb.cand11test",
          revision_number: revNo,
          supersedes_revision_id: revNo > 1 ? `ans.trc.onb.cand11test.r${revNo - 1}` : null,
          channel: "api",
          question_text: "[C11 ISO-X] พ.ร.ฎ. 807 ให้ไว้เมื่อวันที่ใด และมีชื่อเต็มตามมาตรา ๑ ว่าอย่างไร",
          generated_at: "2026-11-26T07:00:00.000Z",
          as_of_date_raw: null,
          status: "complete",
          rendered_answer_th: `[1] ${attText}`,
          ordered_claim_ids: [`clm.ans.trc.onb.cand11test.r${revNo}.1`],
          unresolved_issues: [],
          user_supplied_facts: [],
          assumptions: [],
          legacy_warning_th: null,
          release_id: "rel.B01.rc8",
          verifier_version: "reg24-claim-verifier-v2.1",
          ruleset_version: "th-official-traceability-2026.11.2",
          owner_actor_id: reviewerA.actor_id,
          owner_tenant_id: reviewerA.tenant_id,
          actor_id: reviewerA.actor_id,
          tenant_id: reviewerA.tenant_id,
          revision_reason: revNo === 1 ? "Persisted initial verified answer" : "Saved revision 2",
          execution_provenance: {},
        });

        setCustomCitationDbTransportForTesting(async <T = Record<string, unknown>>(query: string, params: unknown[] = []) => {
          const q = query.trim();
          const targetId = String(params[0] || "");
          if (q.startsWith("SELECT answer_revision_id, answer_id, revision_number, supersedes_revision_id,")) {
            const revNo = targetId.endsWith(".r1") ? 1 : 2;
            return { rows: [mockAnswerRow(revNo)] as unknown as T[], rowCount: 1 };
          }
          if (q.startsWith("SELECT answer_revision_id, revision_number, supersedes_revision_id,")) {
            return { rows: [mockAnswerRow(1), mockAnswerRow(2)] as unknown as T[], rowCount: 2 };
          }
          if (q.startsWith("SELECT claim_id, display_order, displayed_claim_text,")) {
            const revNo = targetId.endsWith(".r1") ? 1 : 2;
            return {
              rows: [
                {
                  claim_id: `clm.ans.trc.onb.cand11test.r${revNo}.1`,
                  display_order: 1,
                  displayed_claim_text: attText,
                  claim_type: "legal_proposition",
                  premise_claim_ids: [],
                  verification_decision: "supported",
                  published: true,
                  withheld_reason_th: null,
                  bound_calculation: null,
                },
              ] as unknown as T[],
              rowCount: 1,
            };
          }
          if (q.includes("FROM citation_claim_evidence_link l")) {
            const revNo = targetId.endsWith(".r1") ? 1 : 2;
            return {
              rows: [
                {
                  link_id: `cel.cand11.r${revNo}.1`,
                  claim_id: `clm.ans.trc.onb.cand11test.r${revNo}.1`,
                  passage_id: attPsg.passage_id,
                  version_id: attVer.version_id,
                  support_role: "verified_attachment_authority",
                  required_group: "grp.primary_statute",
                  citation_label_th: `${attDoc.source_native_id} · มาตรา ๑`,
                  official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf",
                  resolver_url: `/api/v1/knowledge/evidence/${encodeURIComponent(attPsg.passage_id)}`,
                  human_pinpoint_th: "PDF หน้า 1 · หน้าพิมพ์ ๑ · มาตรา ๑",
                  doc_id: attDoc.doc_id,
                  extraction_revision_id: attPsg.extraction_revision_id,
                  section_paragraph_path: attPsg.section_paragraph_path,
                  physical_page_start: 1,
                  physical_page_end: 1,
                  printed_page_start: "๑",
                  printed_page_end: "๑",
                  anchors: [],
                  access_scope: attPsg.access_scope,
                  verbatim_text: attText,
                  original_title_th: attDoc.original_title_th,
                  issuer_id: attDoc.issuer_id,
                  source_family: attDoc.source_family,
                  record_type: attDoc.record_type,
                  access_permission: attDoc.access_permission,
                  access_conditions_th: null,
                  eligible_for_citation: docEligible,
                  eligible_for_publication: psgEligible,
                  effective_from: "2026-10-01",
                  publication_date: "2026-08-20",
                  link_health: "unchecked_live",
                  last_successful_verified_at: null,
                },
              ] as unknown as T[],
              rowCount: 1,
            };
          }
          return { rows: [] as T[], rowCount: 0 };
        });

        // 1) Authorized reviewerA MUST reopen BOTH r1 and r2 from Postgres with exact claims & attachment evidence!
        const reopenR1 = await loadSavedAnswerFromPostgres("ans.trc.onb.cand11test.r1", reviewerA);
        expect(reopenR1.found).toBe(true);
        expect(reopenR1.forbidden_restricted).toBeUndefined();
        expect(reopenR1.answer?.claims).toHaveLength(1);
        expect(reopenR1.answer?.claims[0].evidence_references[0].evidence_id).toBe(attPsg.passage_id);

        const reopenR2 = await loadSavedAnswerFromPostgres("ans.trc.onb.cand11test.r2", reviewerA);
        expect(reopenR2.found).toBe(true);
        expect(reopenR2.answer?.revision_number).toBe(2);
        expect(reopenR2.answer?.claims[0].evidence_references[0].evidence_id).toBe(attPsg.passage_id);

        // 2) Out-of-tenant reviewerB and public unauthenticated caller MUST stay denied (404 / forbidden_restricted)!
        const reopenB = await loadSavedAnswerFromPostgres("ans.trc.onb.cand11test.r1", reviewerB);
        expect(reopenB.found).toBe(false);
        expect(reopenB.forbidden_restricted).toBe(true);

        const reopenPub = await loadSavedAnswerFromPostgres("ans.trc.onb.cand11test.r1", publicUnauth);
        expect(reopenPub.found).toBe(false);
        expect(reopenPub.forbidden_restricted).toBe(true);

        // 3) Out-of-matter isolation: querying without attachment_doc_ids MUST NOT match restricted attachment!
        const outOfMatter = cte.tryAnswerFromOnboardedCitationSources(store, {
          question: "พระราชกฤษฎีกา (ฉบับที่ 807) มาตรา ๑ [C11-TEST] มีชื่อเต็มว่าอย่างไร",
          applicable_date: null,
          release_id: "rel.B01.rc8",
          actor: reviewerA,
          attachment_doc_ids: [],
          persist: false,
        });
        expect(outOfMatter).toBeNull();

        // In-matter authorized reviewerA CAN generate & open evidence; out-of-tenant reviewerB CANNOT!
        const inMatterA = cte.tryAnswerFromOnboardedCitationSources(store, {
          question: "พระราชกฤษฎีกา (ฉบับที่ 807) มาตรา ๑ [C11-TEST] มีชื่อเต็มว่าอย่างไร",
          applicable_date: null,
          release_id: "rel.B01.rc8",
          actor: reviewerA,
          attachment_doc_ids: [attDoc.doc_id],
          persist: false,
        });
        expect(inMatterA?.status).toBe("ANSWERED");
        expect(cte.resolveTraceableEvidenceById(store, attPsg.passage_id, reviewerA, "rel.B01.rc8").ok).toBe(true);
        expect(cte.resolveTraceableEvidenceById(store, attPsg.passage_id, reviewerB, "rel.B01.rc8").ok).toBe(false);
        expect(cte.resolveTraceableEvidenceById(store, attPsg.passage_id, publicUnauth, "rel.B01.rc8").ok).toBe(false);

        // 4) Revoked / ineligible evidence MUST deny even the owning reviewer!
        docEligible = false;
        const reopenRevokedDoc = await loadSavedAnswerFromPostgres("ans.trc.onb.cand11test.r1", reviewerA);
        expect(reopenRevokedDoc.found).toBe(false);
        expect(reopenRevokedDoc.forbidden_restricted).toBe(true);
        docEligible = true;
        psgEligible = false;
        const reopenRevokedPsg = await loadSavedAnswerFromPostgres("ans.trc.onb.cand11test.r1", reviewerA);
        expect(reopenRevokedPsg.found).toBe(false);
        expect(reopenRevokedPsg.forbidden_restricted).toBe(true);
      } finally {
        if (prevInviteOnly === undefined) delete process.env.REG24_TRIAL_INVITE_ONLY;
        else process.env.REG24_TRIAL_INVITE_ONLY = prevInviteOnly;
      }
    });
  });

  // =========================================================================
  // 3. DEF-C10-1 (Material): Verified RD 807 claim disappears at publication
  // =========================================================================
  describe("DEF-C10-1 (Material): Offline replay of trc.166ae831528562 & single-published-record invariant", () => {
    const actorA: Actor = {
      actor_id: "trial.user.cand11_c10_1@reg24.th",
      role: "reader",
      tenant_id: "tenant.trial.cand11_c10_1",
      authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.cand11_c10_1"],
      csrf_verified: true,
    };

    it("D1-1: Replays trc.166ae831528562's verified RD 799 (2,800) + RD 807 (700) claims (explicitly noting RD 799 expiry) without dropping Set 3 through Publish -> Save -> Reopen", () => {
      const capturedSnap: GroundedAnswer = {
        trace_id: "trc.166ae831528562.replay",
        release_id: "rel.B01.rc8",
        knowledge_snapshot_at: "2026-11-26T00:37:14.180Z",
        generated_at: "2026-11-26T00:37:14.180Z",
        applicable_date: null,
        status: "ANSWERED",
        answer:
          "### ประเด็นที่ 1 (ชุดที่ 1+2): 40,000 บาท พ.ร.ฎ. 799 VAT 2,800 บาท\n### ประเด็นที่ 2 (ชุดที่ 3): 10,000 บาท พ.ร.ฎ. 807 VAT 700 บาท",
        claims: [
          {
            claim_id: "clm.trc.166ae831528562.replay.1",
            statement:
              "[วันเกิดความรับผิด พระราชกฤษฎีกาที่ใช้บังคับ และการคำนวณภาษีมูลค่าเพิ่มสำหรับสินค้าชุดที่ 1 และชุดที่ 2 (วันที่ 30 กันยายน 2569) — สินค้าชุดที่ 1 (20,000 บาท) และชุดที่ 2 (20,000 บาท) รวมฐานภาษี 40,000 บาท] ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับสินค้าชุดที่ 1 (20,000 บาท) และชุดที่ 2 (20,000 บาท) เกิดขึ้นเมื่อวันที่ 30 กันยายน 2569 รวมฐานภาษี 40,000 บาท อยู่ภายใต้บังคับพระราชกฤษฎีกาฯ (ฉบับที่ 799) พ.ศ. 2568 คงจัดเก็บภาษีมูลค่าเพิ่มอัตราร้อยละ 6.3 รวมภาษีท้องถิ่นอีกร้อยละ 0.7 เป็นอัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่มรวม 2,800 บาท (ตามประมวลรัษฎากร มาตรา 78 (1) และมาตรา 80 ประกอบพระราชกฤษฎีกาฯ (ฉบับที่ 799) พ.ศ. 2568 มาตรา 2 และมาตรา 3 แก้ไขเพิ่มเติมมาตรา 4 แห่งพระราชกฤษฎีกาฯ (ฉบับที่ 646) พ.ศ. 2560 สำหรับความรับผิดที่เกิดขึ้นถึงวันที่ 30 กันยายน พ.ศ. 2569 รวมภาษีท้องถิ่นอีกร้อยละ 0.7 คิดเป็น 2,800 บาท)",
            claim_type: "qualified_legal_synthesis",
            statement_role: "statutory_text",
            supporting_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd799.sec_1_2",
              "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            applicable_version_id: "ver.th.rc.78.v1",
            factual_conditions: ["ชุดที่ 1 (20,000 บาท) และชุดที่ 2 (20,000 บาท) วันที่ 30 กันยายน 2569"],
            exceptions: [],
            counterevidence_passage_ids: [],
            verification_result: "VERIFIED",
            verified_calculation_numeric_tokens: [
              "50000", "50,000", "3", "1", "20000", "20,000", "2", "10000", "10,000",
              "30", "2569", "2026", "09", "10", "01", "40000", "40,000", "0", "7",
              "2800", "2,800", "42800", "42,800", "7.0", "6.3", "0.7", "1400", "1,400",
            ],
            bound_calculation: {
              calculation_id: "calc.replay.1",
              claim_id: "clm.trc.166ae831528562.replay.1",
              answer_revision: "ans.trc.166ae831528562.replay.r1",
              verifier_version: "reg24-llm-calc-verifier-v1.1",
              formula: "40,000 × 7% = 2,800",
              inputs: { tax_base_thb: 40000, exempt_amount_thb: 0, rate_pct: 7 },
              outputs: { taxable_amount_thb: 40000, computed_tax_thb: 2800 },
              units: { primary_unit: "THB", detail_th: "บาท (THB)" },
              source_versions: [
                { doc_id: "prov.th.rc.78", version_id: "ver.th.rc.78.v1", evidence_id: "psg.aa853373203223" },
                { doc_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_id: "psg.1b1abb8e7e22df" },
                { doc_id: "subreg.th.rc.royal_decree.799", version_id: "ver.th.rc.royal_decree.799.v3", evidence_id: "psg.rc8.rd799.sec_1_2" },
                { doc_id: "subreg.th.rc.royal_decree.799", version_id: "ver.th.rc.royal_decree.799.v3", evidence_id: "psg.rc8.rd799.sec_3_quoted_rd646_sec_4" },
                { doc_id: "subreg.th.rd.vat_local_tax_guide", version_id: "ver.th.rd.vat_local_tax_guide.v1", evidence_id: "psg.3d0eb5636faa0e" },
              ],
              verified_numeric_tokens: ["40000", "40,000", "7", "7.0", "6.3", "0.7", "2800", "2,800"],
              verified_at: "2026-11-26T00:37:14.171Z",
            },
          },
          {
            claim_id: "clm.trc.166ae831528562.replay.2",
            statement:
              "[วันเกิดความรับผิด พระราชกฤษฎีกาที่ใช้บังคับ และการคำนวณภาษีมูลค่าเพิ่มสำหรับสินค้าชุดที่ 3 (วันที่ 1 ตุลาคม 2569) — สินค้าชุดที่ 3 ฐานภาษี 10,000 บาท] ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับสินค้าชุดที่ 3 ราคา 10,000 บาท เกิดขึ้นเมื่อส่งมอบสินค้าในวันที่ 1 ตุลาคม 2569 อยู่ภายใต้บังคับพระราชกฤษฎีกาฯ (ฉบับที่ 807) พ.ศ. 2569 คงจัดเก็บภาษีมูลค่าเพิ่มอัตราร้อยละ 6.3 รวมภาษีท้องถิ่นอีกร้อยละ 0.7 เป็นอัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท (ยอดรวมทั้งสิ้น 10,700 บาท) (ตามประมวลรัษฎากร มาตรา 78 (1) เมื่อสินค้าชุดที่ 3 ราคา 10,000 บาท ยังไม่มีการโอนกรรมสิทธิ์ รับชำระราคา หรือออกใบกำกับภาษีก่อนส่งมอบ ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับชุดที่ 3 จึงเกิดขึ้นเมื่อส่งมอบสินค้าในวันที่ 1 ตุลาคม 2569 ซึ่งเป็นวันหลังจากช่วงเวลาของพระราชกฤษฎีกาฯ (ฉบับที่ 799) พ.ศ. 2568 สิ้นสุดลง และเข้าสู่ช่วงเวลาของพระราชกฤษฎีกาฯ (ฉบับที่ 807) พ.ศ. 2569 ซึ่งมาตรา 2 กำหนดให้ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2569 เป็นต้นไป โดยมาตรา 3 แก้ไขเพิ่มเติมมาตรา 4 แห่งพระราชกฤษฎีกาฯ (ฉบับที่ 646) พ.ศ. 2560 ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 และคงจัดเก็บในอัตราร้อยละ 6.3 สำหรับความรับผิดที่เกิดขึ้นถึงวันที่ 30 กันยายน พ.ศ. 2570 เมื่อรวมภาษีท้องถิ่นอีก 1 ใน 9 ของอัตราภาษีที่จัดเก็บ (ร้อยละ 0.7) ตามแนวทางของกรมสรรพากร จึงจัดเก็บรวมในอัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่มสำหรับชุดที่ 3 จำนวน 700 บาท (รวมภาษีมูลค่าเพิ่มทั้ง 3 ชุดเป็นเงินทั้งสิ้น 3,500 บาท จากฐานภาษีรวม 50,000 บาท))",
            claim_type: "qualified_legal_synthesis",
            statement_role: "statutory_text",
            supporting_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd807.sec_1_2",
              "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            applicable_version_id: "ver.th.rc.78.v1",
            factual_conditions: ["ชุดที่ 3 ราคา 10,000 บาท ส่งมอบวันที่ 1 ตุลาคม 2569"],
            exceptions: [],
            counterevidence_passage_ids: [],
            verification_result: "VERIFIED",
            verified_calculation_numeric_tokens: [
              "50000", "50,000", "3", "1", "20000", "20,000", "2", "10000", "10,000",
              "30", "2569", "2026", "09", "10", "01", "0", "7", "700", "10700", "10,700",
              "7.0", "6.3", "0.7", "3500", "3,500", "53500", "53,500", "40000", "40,000",
              "2800", "2,800",
            ],
            bound_calculation: {
              calculation_id: "calc.replay.2",
              claim_id: "clm.trc.166ae831528562.replay.2",
              answer_revision: "ans.trc.166ae831528562.replay.r1",
              verifier_version: "reg24-llm-calc-verifier-v1.1",
              formula: "10,000 × 7% = 700",
              inputs: { tax_base_thb: 10000, exempt_amount_thb: 0, rate_pct: 7 },
              outputs: { taxable_amount_thb: 10000, computed_tax_thb: 700 },
              units: { primary_unit: "THB", detail_th: "บาท (THB)" },
              source_versions: [
                { doc_id: "prov.th.rc.78", version_id: "ver.th.rc.78.v1", evidence_id: "psg.aa853373203223" },
                { doc_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_id: "psg.1b1abb8e7e22df" },
                { doc_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v3", evidence_id: "psg.rc8.rd807.sec_1_2" },
                { doc_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v3", evidence_id: "psg.rc8.rd807.sec_3_quoted_rd646_sec_4" },
                { doc_id: "subreg.th.rd.vat_local_tax_guide", version_id: "ver.th.rd.vat_local_tax_guide.v1", evidence_id: "psg.3d0eb5636faa0e" },
              ],
              verified_numeric_tokens: ["10000", "10,000", "7", "7.0", "6.3", "0.7", "700", "10700", "10,700", "3500", "3,500", "50000", "50,000"],
              verified_at: "2026-11-26T00:37:14.180Z",
            },
          },
        ],
        evidence: [
          { passage_id: "psg.aa853373203223" },
          { passage_id: "psg.1b1abb8e7e22df" },
          { passage_id: "psg.rc8.rd799.sec_1_2" },
          { passage_id: "psg.rc8.rd799.sec_3_quoted_rd646_sec_4" },
          { passage_id: "psg.rc8.rd807.sec_1_2" },
          { passage_id: "psg.rc8.rd807.sec_3_quoted_rd646_sec_4" },
          { passage_id: "psg.3d0eb5636faa0e" },
        ] as never,
        assumptions: [],
        coverage_warnings: [],
        clarification_questions: [],
        model_policy_version: "reg24-grounded-llm-legal-application-v1.1",
        latency_ms: 1000,
      };

      const env = cte.attachTraceableEnvelopeToGroundedAnswer(store, capturedSnap, {
        question: QA_DEF_C10_1_SF4,
        actor: actorA,
        persist: true,
      });

      expect(env.status).toBe("complete");
      expect(env.unresolved_issues).toHaveLength(0);
      expect(env.claims).toHaveLength(2);
      expect(env.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(2800);
      expect(env.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(700);
      expect(env.claims[1].evidence_references.map((r) => r.evidence_id)).toContain(
        "psg.rc8.rd807.sec_1_2"
      );
      expect(env.rendered_answer_th).toContain("807");
      expect(env.rendered_answer_th).toContain("700");

      const reopened = cte.reopenSavedTraceableAnswer(store, env.answer_revision, actorA);
      expect(reopened.found).toBe(true);
      expect(reopened.answer?.claims).toHaveLength(2);
      expect(reopened.answer?.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(700);
    });

    it("D1-2: Single-published-record invariant — a claim citing a wrong/unsupported decree (e.g. RD 780 without exclusion) is withheld from BOTH claims AND official answer body with recorded reason", () => {
      const badSnap: GroundedAnswer = {
        trace_id: "trc.cand11.wrongdecree",
        release_id: "rel.B01.rc8",
        knowledge_snapshot_at: "2026-11-26T00:40:00.000Z",
        generated_at: "2026-11-26T00:40:00.000Z",
        applicable_date: null,
        status: "ANSWERED",
        answer:
          "### ประเด็นที่ 1: ชุดที่ 1+2 VAT 2,800 บาท\n### ประเด็นที่ 2: ชุดที่ 3 ใช้ พ.ร.ฎ. (ฉบับที่ 780) VAT 700 บาท",
        claims: [
          {
            claim_id: "clm.bad.1",
            statement:
              "[ชุดที่ 1 และชุดที่ 2] ความรับผิดเกิดวันที่ 30 กันยายน 2569 ฐาน 40,000 บาท ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น VAT 2,800 บาท",
            claim_type: "qualified_legal_synthesis",
            statement_role: "statutory_text",
            supporting_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd799.sec_1_2",
              "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            applicable_version_id: "ver.th.rc.78.v1",
            factual_conditions: [],
            exceptions: [],
            counterevidence_passage_ids: [],
            verification_result: "VERIFIED",
            verified_calculation_numeric_tokens: ["40000", "40,000", "7", "7.0", "6.3", "0.7", "2800", "2,800"],
          },
          {
            claim_id: "clm.bad.2",
            statement:
              "[ชุดที่ 3 ผิดฉบับ] ความรับผิดเกิดวันที่ 1 ตุลาคม 2569 ฐาน 10,000 บาท อยู่ภายใต้บังคับพระราชกฤษฎีกาฯ (ฉบับที่ 780) พ.ศ. 2566 คิดเป็น VAT 700 บาท",
            claim_type: "qualified_legal_synthesis",
            statement_role: "statutory_text",
            supporting_passage_ids: [
              "psg.aa853373203223",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd807.sec_1_2",
              "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            applicable_version_id: "ver.th.rc.78.v1",
            factual_conditions: [],
            exceptions: [],
            counterevidence_passage_ids: [],
            verification_result: "VERIFIED",
            verified_calculation_numeric_tokens: ["10000", "10,000", "7", "700"],
          },
        ],
        evidence: [
          { passage_id: "psg.aa853373203223" },
          { passage_id: "psg.1b1abb8e7e22df" },
          { passage_id: "psg.rc8.rd799.sec_1_2" },
          { passage_id: "psg.rc8.rd799.sec_3_quoted_rd646_sec_4" },
          { passage_id: "psg.rc8.rd807.sec_1_2" },
          { passage_id: "psg.rc8.rd807.sec_3_quoted_rd646_sec_4" },
          { passage_id: "psg.3d0eb5636faa0e" },
        ] as never,
        assumptions: [],
        coverage_warnings: [],
        clarification_questions: [],
        model_policy_version: "reg24-grounded-llm-legal-application-v1.1",
        latency_ms: 1000,
      };

      const env = cte.attachTraceableEnvelopeToGroundedAnswer(store, badSnap, {
        question: QA_DEF_C10_1_SF4,
        actor: actorA,
        persist: false,
      });

      expect(env.status).toBe("partial");
      expect(env.claims).toHaveLength(1);
      expect(env.unresolved_issues.length).toBeGreaterThanOrEqual(1);
      expect(env.coverage_warnings_th?.some((w) => w.includes("780"))).toBe(true);
      expect(env.rendered_answer_th).not.toContain("ฉบับที่ 780");
      expect(env.grounded_answer_snapshot?.claims).toHaveLength(1);
      expect(env.grounded_answer_snapshot?.answer).not.toContain("ฉบับที่ 780");
      expect(env.grounded_answer_status).toBe("CONDITIONAL");
    });
  });

  // =========================================================================
  // 4. DEF-C10-2 (Material): Comparison date redirects installment check
  // =========================================================================
  describe("DEF-C10-2 (Material): Installment extraction, stable installment-ID targeting, written ordinals, comparison dates & conflict guard", () => {
    it("D2-1: Exact QA UI-WRONG-INSTALLMENT-ADV prompt preserves 25 Sep 2568 as an ACTUAL split installment (not NEGATED) alongside 5 Oct 2568", () => {
      const fl = buildStructuredCaseFactLedger({
        question: QA_DEF_C10_2_INSTALLMENT,
        applicableDate: null,
      });
      const negs = fl.temporal_facts.non_occurring_or_negated_events || [];
      expect(negs.some((n) => n.iso_date === "2025-09-25")).toBe(false);
      expect(fl.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
      const pts = fl.temporal_facts.split_payment_tax_points || [];
      expect(pts).toHaveLength(2);
      expect(pts[0]).toMatchObject({
        iso_date: "2025-09-25",
        decree_window: "RD_790",
        governing_decree_work_id: "subreg.th.rc.royal_decree.790",
        amount_thb: 40000,
      });
      expect(pts[1]).toMatchObject({
        iso_date: "2025-10-05",
        decree_window: "RD_799",
        governing_decree_work_id: "subreg.th.rc.royal_decree.799",
        amount_thb: 60000,
      });
    });

    it("D2-2: Verifier survives BOTH installments with sibling date in scope/conclusion comparison, written Thai งวดที่หนึ่ง/งวดที่สอง, reversed order, rejects 4,200 on installment 1, and flags genuine label/date conflict", async () => {
      const state = store.getState();
      const view = cte.getUnifiedCitationLedgerView(store, "rel.B01.rc8");
      const getRaw = (pid: string) => state.passages[pid];
      const toPack = (pid: string, app: string[], exc: string[] = []) => {
        const p = view.passages[pid]!;
        const v = view.versions[p.version_id]!;
        const d = view.documents[p.doc_id]!;
        return {
          passage_id: p.passage_id,
          work_id: d.doc_id,
          version_id: v.version_id,
          work_type: "Statute",
          authority_tier: "CONTROLLING_STATUTE",
          evidence_role: "governing",
          official_identifier: d.source_native_id || d.original_title_th,
          title_th: d.original_title_th,
          pinpoint: p.human_pinpoint_th,
          verbatim_text: p.verbatim_text,
          effective_dates: {
            valid_from: v.effective_from,
            valid_to: v.effective_to,
            temporal_applicability_hint: "APPLICABLE_ON_DATE",
          },
          applicable_tax_point_dates: app,
          excluded_tax_point_dates: exc,
        };
      };

      const rawAll = new Map(
        [
          "psg.7bdc85da3153a7",
          "psg.3228c2c7aaeb10",
          "psg.1b1abb8e7e22df",
          "psg.rc8.rd790.sec_1_2",
          "psg.rc8.rd790.sec_3_quoted_rd646_sec_4",
          "psg.rc8.rd799.sec_1_2",
          "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
          "psg.3d0eb5636faa0e",
        ].map((pid) => [pid, getRaw(pid)!])
      );
      const passagePack = [
        toPack("psg.7bdc85da3153a7", ["2025-09-25", "2025-10-05"]),
        toPack("psg.3228c2c7aaeb10", ["2025-09-25", "2025-10-05"]),
        toPack("psg.1b1abb8e7e22df", ["2025-09-25", "2025-10-05"]),
        toPack("psg.rc8.rd790.sec_1_2", ["2025-09-25"], ["2025-10-05"]),
        toPack("psg.rc8.rd790.sec_3_quoted_rd646_sec_4", ["2025-09-25"], ["2025-10-05"]),
        toPack("psg.rc8.rd799.sec_1_2", ["2025-10-05"], ["2025-09-25"]),
        toPack("psg.rc8.rd799.sec_3_quoted_rd646_sec_4", ["2025-10-05"], ["2025-09-25"]),
        toPack("psg.3d0eb5636faa0e", ["2025-09-25", "2025-10-05"]),
      ];

      const fl = buildStructuredCaseFactLedger({
        question: QA_DEF_C10_2_INSTALLMENT,
        applicableDate: null,
      });

      // Scenario A: Reversed order + written Thai "งวดที่หนึ่ง" + sibling date "5 ตุลาคม 2568" in comparison text inside scope AND conclusion!
      const draftComparisonAndWritten: GroundedLlmDraftResponse = {
        answer_status: "ANSWERED",
        overall_summary_th: "งวดที่ 1 (40,000 บาท วันที่ 25 กันยายน 2568) ใช้ พ.ร.ฎ. 790 VAT 2,800 บาท และงวดที่ 2 (60,000 บาท วันที่ 5 ตุลาคม 2568) ใช้ พ.ร.ฎ. 799 VAT 4,200 บาท",
        case_facts_used: [],
        issues: [
          {
            issue_id: "INST_2_FIRST_REVERSED",
            issue_title_th: "ภาษีมูลค่าเพิ่มสำหรับงวดที่สอง (60,000 บาท)",
            party_or_scope_th: "งวดที่สอง จำนวน 60,000 บาท วันที่ 5 ตุลาคม 2568 (แยกจากงวดที่หนึ่งวันที่ 25 กันยายน 2568)",
            conclusion_th:
              "งวดที่สองเกิดความรับผิดวันที่ 5 ตุลาคม 2568 ตามมาตรา 78/1 (1) อยู่ภายใต้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น VAT 4,200 บาท",
            material_facts_relied_on: ["งวดที่ 2 จำนวน 60,000 บาท วันที่ 5 ตุลาคม 2568"],
            governing_passage_ids: [
              "psg.7bdc85da3153a7",
              "psg.3228c2c7aaeb10",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd799.sec_1_2",
              "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            application_explanation_th:
              "ตามมาตรา 77/2 (1) มาตรา 78/1 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม 2568) และคู่มือภาษีท้องถิ่น 60,000 × 7% = 4,200 บาท",
            authority_distinction_note_th: "",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "60,000 × 7% = 4,200",
              tax_base_thb: 60000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 60000,
              rate_pct: 7,
              computed_tax_thb: 4200,
              steps_th: ["60,000 × 7% = 4,200 บาท"],
              missing_inputs_th: [],
            },
          },
          {
            issue_id: "INST_1_WITH_SIBLING_COMPARISON",
            issue_title_th: "ตรวจสอบการคำนวณของฝ่ายบัญชีและภาษีมูลค่าเพิ่มสำหรับงวดที่หนึ่ง",
            party_or_scope_th:
              "งวดที่หนึ่ง จำนวน 40,000 บาท (เปรียบเทียบกับการชำระงวดที่สองวันที่ 5 ตุลาคม 2568)",
            conclusion_th:
              "ที่ฝ่ายบัญชีคำนวณว่างวดที่หนึ่งต้องเสียภาษี 4,200 บาทนั้นไม่ถูกต้อง เนื่องจากงวดที่หนึ่งรับชำระวันที่ 25 กันยายน 2568 (ก่อนงวดที่สองวันที่ 5 ตุลาคม 2568) จึงเกิดความรับผิดตามมาตรา 78/1 (1) ในวันที่ 25 กันยายน 2568 ภายใต้ พ.ร.ฎ. (ฉบับที่ 790) พ.ศ. 2567 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น VAT 2,800 บาท",
            material_facts_relied_on: ["งวดที่ 1 จำนวน 40,000 บาท วันที่ 25 กันยายน 2568"],
            governing_passage_ids: [
              "psg.7bdc85da3153a7",
              "psg.3228c2c7aaeb10",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd790.sec_1_2",
              "psg.rc8.rd790.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            application_explanation_th:
              "ตามมาตรา 77/2 (1) มาตรา 78/1 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 790) พ.ศ. 2567 (ใช้บังคับถึง 30 กันยายน 2568) และคู่มือภาษีท้องถิ่น ฐานภาษีกำหนดจากยอดรับชำระงวดที่หนึ่ง 40,000 บาท × 7% = 2,800 บาท ไม่ใช่ 4,200 บาท",
            authority_distinction_note_th: "",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "40,000 × 7% = 2,800",
              tax_base_thb: 40000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 40000,
              rate_pct: 7,
              computed_tax_thb: 2800,
              steps_th: ["40,000 × 7% = 2,800 บาท"],
              missing_inputs_th: [],
            },
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      };

      const verBoth = verifyAndRenderGroundedLlmDraft({
        traceId: "trc.cand11.d2.both",
        factLedger: fl,
        passagePack: passagePack as never,
        rawPassagesById: rawAll,
        state,
        llmOk: true,
        invocationAudit: MOCK_INVOCATION_AUDIT as never,
        stagingFlagActive: true,
        draft: draftComparisonAndWritten,
      });

      expect(verBoth.status).toBe("ANSWERED");
      expect(verBoth.verified_issues).toHaveLength(2);
      const vInst1 = verBoth.verified_issues.find((v) => v.issue_id === "INST_1_WITH_SIBLING_COMPARISON");
      const vInst2 = verBoth.verified_issues.find((v) => v.issue_id === "INST_2_FIRST_REVERSED");
      expect(vInst1?.verified_calculation?.tax_base_thb).toBe(40000);
      expect(vInst1?.verified_calculation?.computed_tax_thb).toBe(2800);
      expect(vInst2?.verified_calculation?.tax_base_thb).toBe(60000);
      expect(vInst2?.verified_calculation?.computed_tax_thb).toBe(4200);

      // End-to-end Save & exact Reopen!
      const actor: Actor = {
        actor_id: "trial.user.cand11_d2@reg24.th",
        role: "reader",
        tenant_id: "tenant.trial.cand11_d2",
        authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.cand11_d2"],
        csrf_verified: true,
      };
      const groundedOut = await queryKnowledge(
        {
          question: QA_DEF_C10_2_INSTALLMENT,
          applicable_date: null,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
        },
        actor,
        { store, persistAnswerAtomically: true, llmMockInvokerForTesting: async () => draftComparisonAndWritten }
      );
      expect(groundedOut.status).toBe("ANSWERED");
      expect(groundedOut.traceable_answer?.claims).toHaveLength(2);
      const reopened = cte.reopenSavedTraceableAnswer(
        store,
        groundedOut.traceable_answer!.answer_revision,
        actor
      );
      expect(reopened.found).toBe(true);
      expect(reopened.answer?.claims).toHaveLength(2);
      expect(
        reopened.answer?.claims
          .map((c) => Number(c.bound_calculation?.outputs.computed_tax_thb ?? 0))
          .sort((a, b) => a - b)
      ).toEqual([2800, 4200]);

      // Scenario B: Genuine label/date conflict (labeled งวดที่ 1 but affirmatively asserts 5 ตุลาคม 2568 as its own tax point!) -> withheld while sibling Inst 2 survives!
      const draftConflict: GroundedLlmDraftResponse = {
        ...draftComparisonAndWritten,
        issues: [
          draftComparisonAndWritten.issues[0],
          {
            ...draftComparisonAndWritten.issues[1],
            issue_id: "INST_1_GENUINE_DATE_CONFLICT",
            issue_title_th: "งวดที่ 1 (40,000 บาท)",
            party_or_scope_th: "งวดที่ 1 จำนวน 40,000 บาท",
            conclusion_th:
              "งวดที่ 1 จำนวน 40,000 บาท เกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มในวันที่ 5 ตุลาคม 2568 ภายใต้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 7.0 คิดเป็น VAT 2,800 บาท",
            governing_passage_ids: [
              "psg.7bdc85da3153a7",
              "psg.3228c2c7aaeb10",
              "psg.1b1abb8e7e22df",
              "psg.rc8.rd799.sec_1_2",
              "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
              "psg.3d0eb5636faa0e",
            ],
            application_explanation_th:
              "งวดที่ 1 เกิดความรับผิดวันที่ 5 ตุลาคม 2568 ตามมาตรา 78/1 (1) และ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 คิดเป็น VAT 2,800 บาท",
          },
        ],
      };
      const verConflict = verifyAndRenderGroundedLlmDraft({
        traceId: "trc.cand11.d2.conflict",
        factLedger: fl,
        passagePack: passagePack as never,
        rawPassagesById: rawAll,
        state,
        llmOk: true,
        invocationAudit: MOCK_INVOCATION_AUDIT as never,
        stagingFlagActive: true,
        draft: draftConflict,
      });
      expect(verConflict.verified_issues.map((v) => v.issue_id)).toEqual(["INST_2_FIRST_REVERSED"]);
      expect(verConflict.audit_trace.rejected_claims.map((r) => r.issue_id)).toContain(
        "INST_1_GENUINE_DATE_CONFLICT"
      );

      // Scenario C: Negative retention — 4,200 MUST NEVER publish as installment 1's tax!
      const draftWrong4200: GroundedLlmDraftResponse = {
        ...draftComparisonAndWritten,
        issues: [
          draftComparisonAndWritten.issues[0],
          {
            ...draftComparisonAndWritten.issues[1],
            issue_id: "INST_1_WRONG_4200_ASSERTED",
            issue_title_th: "งวดที่ 1 วันที่ 25 กันยายน 2568 (40,000 บาท)",
            party_or_scope_th: "งวดที่ 1 จำนวน 40,000 บาท วันที่ 25 กันยายน 2568",
            conclusion_th:
              "งวดที่ 1 วันที่ 25 กันยายน 2568 มูลค่า 40,000 บาท เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 790) พ.ศ. 2567 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็น VAT 4,200 บาท",
            application_explanation_th:
              "มาตรา 78/1 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 790) คิดเป็นภาษีมูลค่าเพิ่ม 4,200 บาท",
            proposed_calculation: null,
          },
        ],
      };
      const verWrong4200 = verifyAndRenderGroundedLlmDraft({
        traceId: "trc.cand11.d2.wrong4200",
        factLedger: fl,
        passagePack: passagePack as never,
        rawPassagesById: rawAll,
        state,
        llmOk: true,
        invocationAudit: MOCK_INVOCATION_AUDIT as never,
        stagingFlagActive: true,
        draft: draftWrong4200,
      });
      expect(verWrong4200.verified_issues.map((v) => v.issue_id)).toEqual(["INST_2_FIRST_REVERSED"]);
      expect(verWrong4200.audit_trace.rejected_claims.map((r) => r.issue_id)).toContain(
        "INST_1_WRONG_4200_ASSERTED"
      );
    });
  });

  // =========================================================================
  // 5. DEF-C10-4 (Material): Land-transfer check blocks cash-gift correction K2
  // =========================================================================
  describe("DEF-C10-4 (Material): Paired cash vs land against mixed §42(26)/§42(27) excerpt & K1 -> K2 preservation", () => {
    it("D4-1: Paired cash vs land against the SAME mixed §42(26)/§42(27) excerpt — K2 cash gift (฿30M -> ฿500,000 with §48(6)) PASSES while land gift applying §42(27)/§48(6) is REJECTED", () => {
      const view = cte.getUnifiedCitationLedgerView(store, "rel.B01.rc8");
      const p40 = view.passages["psg.c19259d1204dec"]!;
      const p42_1 = view.passages["psg.067bb96e61ea56"]!;
      const p42_7 = view.passages["psg.c7c4aa1c3ac667"]!; // contains (26) อสังหาริมทรัพย์
      const p42_8 = view.passages["psg.56a3c0621dc6fa"]!; // contains (27) สังหาริมทรัพย์/เงินสด
      const p48_1 = view.passages["psg.f8c2b4a868fd22"]!;
      const p48_8 = view.passages["psg.975f660d15bdaf"]!; // contains (6) 5%

      // Mixed §42(26)/§42(27) passage list
      const mixedPassages = [p40, p42_1, p42_7, p42_8, p48_1, p48_8].map((p) => ({
        passage_id: p.passage_id,
        doc_id: p.doc_id,
        verbatim_text: p.verbatim_text,
        doc_title_th: view.documents[p.doc_id]?.original_title_th || null,
        source_native_id: view.documents[p.doc_id]?.source_native_id || null,
        section_path: p.section_paragraph_path,
      }));

      // 1) K2 cash gift distinguishing itself from immovable property under §42(26): MUST PASS!
      const k2CashClaimText =
        "[ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวพิมพ์ชนกจากการรับโอนเงินสดโดยเสน่หาจำนวน 30,000,000 บาท — นางสาวพิมพ์ชนก (ผู้รับโอนเงินสด / บุตรสาวชอบด้วยกฎหมาย)] นางสาวพิมพ์ชนกได้รับยกเว้นภาษีเงินได้บุคคลธรรมดาสำหรับเงินสดที่ได้รับโดยเสน่หาจากบิดาเฉพาะส่วนที่ไม่เกิน 20,000,000 บาท ตามมาตรา 42 (27) และสำหรับส่วนที่เกิน 10,000,000 บาท สามารถเลือกเสียภาษีอัตราร้อยละ 5 เป็นเงิน 500,000 บาท ตามมาตรา 48 (6) โดยไม่ต้องนำไปรวมคำนวณภาษีตามมาตรา 48 (1) และ (2) (กรณีนี้เป็นการโอนเงินสดโดยเสน่หาเข้าลักษณะเงินได้ตามมาตรา 40 (8) มิใช่การโอนอสังหาริมทรัพย์ตามมาตรา 42 (26) จึงปรับใช้เกณฑ์มาตรา 42 (27) ยกเว้น 20,000,000 บาท และส่วนที่เกิน 10,000,000 บาท เลือกเสียภาษีร้อยละ 5 ตามมาตรา 48 (6) เป็นเงิน 500,000 บาท)";

      const cashRes = evaluateSubstantiveClaimSupport({
        claim_text: k2CashClaimText,
        passages: mixedPassages,
        verified_calculation_numeric_tokens: [
          "30000000", "30,000,000", "20000000", "20,000,000", "10000000", "10,000,000", "5", "500000", "500,000",
        ],
      });
      expect(cashRes.supported).toBe(true);

      // 2) Paired land transfer attempting to apply §42(27)/§48(6) 5% recipient tax figure to land against the SAME mixed excerpt: MUST BE REJECTED!
      const landMisappliedClaimText =
        "[ภาระภาษีเงินได้บุคคลธรรมดาของผู้รับโอนที่ดินโดยเสน่หาจำนวน 30,000,000 บาท — ผู้รับโอนที่ดิน] ผู้รับโอนที่ดินได้รับยกเว้นภาษีเฉพาะส่วนที่ไม่เกิน 20,000,000 บาท ตามมาตรา 42 (27) และส่วนที่เกิน 10,000,000 บาท เสียภาษีอัตราร้อยละ 5 เป็นเงิน 500,000 บาท ตามมาตรา 48 (6) (การโอนกรรมสิทธิ์ที่ดินโดยไม่มีค่าตอบแทนให้แก่บุตรชอบด้วยกฎหมายเข้าลักษณะมาตรา 40 (8) และเลือกเสียภาษีร้อยละ 5 ตามมาตรา 48 (6) เป็นเงิน 500,000 บาท)";

      const landRes = evaluateSubstantiveClaimSupport({
        claim_text: landMisappliedClaimText,
        passages: mixedPassages,
        verified_calculation_numeric_tokens: [
          "30000000", "30,000,000", "20000000", "20,000,000", "10000000", "10,000,000", "5", "500000", "500,000",
        ],
      });
      expect(landRes.supported).toBe(false);
      expect(landRes.reason_code).toBe("UNGROUNDED_LEGAL_IDENTIFIER");
    });

    it("D4-2: K1 (฿24M -> ฿200,000) and K2 (฿30M -> ฿500,000 with §48(6)) preserve cash asset & NOT_CUSTOMARY_OCCASION and survive Generate -> Save -> Reopen", async () => {
      const flK1 = buildStructuredCaseFactLedger({ question: QA_DEF_C10_4_K1, applicableDate: null });
      expect(flK1.material_facts.find((f) => f.fact_key === "asset")?.normalized_category).toBe(
        "MOVABLE_PROPERTY_CASH_OR_OTHER"
      );
      expect(
        flK1.material_facts.find((f) => f.fact_key === "customary_occasion")?.normalized_category
      ).toBe("NOT_CUSTOMARY_OCCASION");

      const flK2 = buildStructuredCaseFactLedger({
        question: QA_DEF_C10_4_K2,
        applicableDate: null,
        conversationHistory: [{ role: "user", content: QA_DEF_C10_4_K1 }],
      });
      expect(flK2.material_facts.find((f) => f.fact_key === "asset")?.normalized_category).toBe(
        "MOVABLE_PROPERTY_CASH_OR_OTHER"
      );
      expect(
        flK2.material_facts.find((f) => f.fact_key === "stated_asset_value_thb")?.original_text_th
      ).toContain("30,000,000");

      const actor: Actor = {
        actor_id: "trial.user.cand11_d4@reg24.th",
        role: "reader",
        tenant_id: "tenant.trial.cand11_d4",
        authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.cand11_d4"],
        csrf_verified: true,
      };
      const k2Draft: GroundedLlmDraftResponse = {
        answer_status: "ANSWERED",
        overall_summary_th:
          "เงินสด 30,000,000 บาท ได้รับยกเว้น 20,000,000 บาท ตามมาตรา 42 (27) ส่วนที่เกิน 10,000,000 บาท เลือกเสียภาษีร้อยละ 5 ตามมาตรา 48 (6) เป็นเงิน 500,000 บาท",
        case_facts_used: [],
        issues: [
          {
            issue_id: "ISSUE_1",
            issue_title_th:
              "ภาระภาษีเงินได้บุคคลธรรมดาของนางสาวพิมพ์ชนกจากการรับโอนเงินสดโดยเสน่หาจำนวน 30,000,000 บาท",
            party_or_scope_th: "นางสาวพิมพ์ชนก (ผู้รับโอนเงินสด / บุตรสาวชอบด้วยกฎหมาย)",
            conclusion_th:
              "นางสาวพิมพ์ชนกได้รับยกเว้นภาษีเงินได้บุคคลธรรมดาสำหรับเงินสดที่ได้รับโดยเสน่หาจากบิดาเฉพาะส่วนที่ไม่เกิน 20,000,000 บาทตลอดปีภาษี 2569 ตามมาตรา 42 (27) ส่วนที่เกินจำนวน 10,000,000 บาท สามารถเลือกเสียภาษีในอัตราร้อยละ 5 เป็นเงิน 500,000 บาท ตามมาตรา 48 (6) โดยไม่ต้องนำไปรวมคำนวณภาษีตามมาตรา 48 (1) และ (2)",
            material_facts_relied_on: [
              "นายกิตติโอนเงินสดจำนวน 30,000,000 บาท ให้แก่นางสาวพิมพ์ชนก ซึ่งเป็นบุตรสาวชอบด้วยกฎหมาย โดยเสน่หาเมื่อวันที่ 15 มีนาคม 2569",
            ],
            governing_passage_ids: [
              "psg.c19259d1204dec",
              "psg.067bb96e61ea56",
              "psg.56a3c0621dc6fa",
              "psg.f8c2b4a868fd22",
              "psg.975f660d15bdaf",
            ],
            application_explanation_th:
              "เงินสดจำนวน 30,000,000 บาท เป็นเงินได้พึงประเมินตามมาตรา 40 (8) และกรณีนี้เป็นการโอนเงินสดมิใช่การโอนอสังหาริมทรัพย์ จึงได้รับยกเว้นตามมาตรา 42 (27) เฉพาะส่วนที่ไม่เกิน 20,000,000 บาท ส่วนที่เกิน 10,000,000 บาท มีสิทธิเลือกเสียภาษีตามมาตรา 48 (6) ในอัตราร้อยละ 5 คิดเป็นเงิน 500,000 บาท โดยไม่ต้องนำไปรวมคำนวณภาษีตามมาตรา 48 (1) และ (2)",
            authority_distinction_note_th: "ประมวลรัษฎากร มาตรา 40 (8), มาตรา 42 (27) และมาตรา 48 (6)",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "(30,000,000 - 20,000,000) × 5% = 500,000 บาท",
              tax_base_thb: 30000000,
              exempt_amount_thb: 20000000,
              taxable_amount_thb: 10000000,
              rate_pct: 5,
              computed_tax_thb: 500000,
              steps_th: [
                "เงินสดที่ได้รับโดยเสน่หา = 30,000,000 บาท",
                "หัก ส่วนที่ได้รับยกเว้นตามมาตรา 42 (27) = 20,000,000 บาท",
                "ส่วนที่เกิน = 10,000,000 บาท × 5% ตามมาตรา 48 (6) = 500,000 บาท",
              ],
              missing_inputs_th: [],
            },
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      };

      const resK2 = await queryKnowledge(
        {
          question: QA_DEF_C10_4_K2,
          applicable_date: null,
          release_id: "rel.B01.rc8",
          answer_generation_mode: "llm_grounded",
          conversation_history: [{ role: "user", content: QA_DEF_C10_4_K1 }],
        },
        actor,
        { store, persistAnswerAtomically: true, llmMockInvokerForTesting: async () => k2Draft }
      );
      expect(resK2.status).toBe("ANSWERED");
      expect(resK2.traceable_answer?.claims).toHaveLength(1);
      expect(resK2.traceable_answer?.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(500000);
      expect(
        resK2.traceable_answer?.claims[0].evidence_references.map((r) => r.evidence_id)
      ).toContain("psg.975f660d15bdaf");

      const reopenedK2 = cte.reopenSavedTraceableAnswer(
        store,
        resK2.traceable_answer!.answer_revision,
        actor
      );
      expect(reopenedK2.found).toBe(true);
      expect(reopenedK2.answer?.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(500000);
    });
  });
});
