import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import {
  reopenSavedTraceableAnswer,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import type { Actor } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";

const STAGING_STORE_SRC = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");

const TEST_ACTOR: Actor = {
  actor_id: "usr.cand9.early_title.verifier",
  role: "legal_reviewer",
  tenant_id: "tenant.cand9.test",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const CASE_A_SIMULTANEOUS_DELIVERY_FIRST =
  "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์ในสินค้าทั้งหมดให้แก่ผู้ซื้อเมื่อวันที่ 30 กันยายน 2569 ส่วนการส่งมอบสินค้า การรับชำระราคาสินค้าเต็มจำนวน และการออกใบกำกับภาษีเกิดขึ้นพร้อมกันเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีการรับชำระเงินหรือออกใบกำกับภาษีก่อนหน้านั้น วันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มคือวันใด ใช้พระราชกฤษฎีกาฉบับใด อัตราภาษีร้อยละเท่าใด และภาษีขายเป็นเงินเท่าใด";

const CASE_A_DELIVERY_RECOGNIZED_PHRASING =
  "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์ในสินค้าทั้งหมดให้แก่ผู้ซื้อเมื่อวันที่ 30 กันยายน 2569 ส่วนการรับชำระราคาสินค้าเต็มจำนวน การออกใบกำกับภาษี และการส่งมอบสินค้าเกิดขึ้นพร้อมกันเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีการรับชำระเงินหรือออกใบกำกับภาษีก่อนหน้านั้น วันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มคือวันใด ใช้พระราชกฤษฎีกาฉบับใด อัตราภาษีร้อยละเท่าใด และภาษีขายเป็นเงินเท่าใด";

const CASE_B_SAME_DAY_CONTROL =
  "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์ในสินค้าทั้งหมดให้แก่ผู้ซื้อเมื่อวันที่ 1 ตุลาคม 2569 ส่วนการส่งมอบสินค้า การรับชำระราคาสินค้าเต็มจำนวน และการออกใบกำกับภาษีเกิดขึ้นพร้อมกันเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีการรับชำระเงินหรือออกใบกำกับภาษีก่อนหน้านั้น วันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มคือวันใด ใช้พระราชกฤษฎีกาฉบับใด อัตราภาษีร้อยละเท่าใด และภาษีขายเป็นเงินเท่าใด";

describe("Formal Test 1 Candidate 9 — §78(1)(a) Early Ownership Transfer & Portion Coverage", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand9-"));
    fs.cpSync(STAGING_STORE_SRC, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
  }, 60_000);

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const buildSingleDecreeGoodsDraft = (params: {
    taxPointTh: string;
    decree: "799" | "807";
    startBe: string;
    endBe: string;
    baseThb?: number;
    taxThb?: number;
  }): GroundedLlmDraftResponse => {
    const base = params.baseThb ?? 50000;
    const tax = params.taxThb ?? 3500;
    return {
      answer_status: "ANSWERED",
      overall_summary_th: `วันเกิดความรับผิดคือวันที่ ${params.taxPointTh} ใช้พระราชกฤษฎีกา (ฉบับที่ ${params.decree}) อัตรารวมร้อยละ 7.0 ภาษีขาย ${tax.toLocaleString("en-US")} บาท`,
      case_facts_used: [],
      issues: [
        {
          issue_id: "issue_1_tax_point",
          issue_title_th: "วันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับการขายสินค้าในประเทศ",
          party_or_scope_th: "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม",
          conclusion_th: `วันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับราคาสินค้าทั้งหมด ${base.toLocaleString("en-US")} บาท เกิดขึ้นเมื่อวันที่ ${params.taxPointTh} ตามประมวลรัษฎากร มาตรา 78 (1)`,
          material_facts_relied_on: [`วันเกิดความรับผิดวันที่ ${params.taxPointTh}`],
          governing_passage_ids: ["psg.aa853373203223"],
          application_explanation_th: `ตามประมวลรัษฎากร มาตรา 78 (1) ความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับการขายสินค้าเกิดขึ้นเมื่อส่งมอบสินค้า เว้นแต่ได้มีการโอนกรรมสิทธิ์สินค้า ได้รับชำระราคาสินค้า หรือได้ออกใบกำกับภาษีก่อนส่งมอบสินค้า ให้ถือว่าความรับผิดเกิดขึ้นเมื่อได้มีการกระทำนั้นๆ ตามส่วนของการกระทำนั้น ดังนั้นความรับผิดทั้งหมดจึงเกิดขึ้นในวันที่ ${params.taxPointTh} และการกระทำภายหลังสำหรับสินค้าเดียวกันไม่ทำให้เกิดความรับผิดซ้ำอีก`,
          authority_distinction_note_th: "",
          proposed_calculation: null,
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "issue_2_vat_rate_and_calculation",
          issue_title_th: "พระราชกฤษฎีกาที่ใช้บังคับ อัตราภาษีมูลค่าเพิ่ม และการคำนวณภาษีขาย",
          party_or_scope_th: "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม",
          conclusion_th: `ใช้พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ${params.decree}) ในอัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีขาย ${tax.toLocaleString("en-US")} บาท`,
          material_facts_relied_on: [`ฐานภาษี ${base.toLocaleString("en-US")} บาท ณ วันที่ ${params.taxPointTh}`],
          governing_passage_ids: [
            "psg.1b1abb8e7e22df",
            `psg.rc8.rd${params.decree}.sec_1_2`,
            `psg.rc8.rd${params.decree}.sec_3_quoted_rd646_sec_4`,
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th: `ตามประมวลรัษฎากร มาตรา 80 และพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ${params.decree}) ซึ่งมีผลใช้บังคับตั้งแต่วันที่ 1 ตุลาคม พ.ศ. ${params.startBe} ตามมาตรา 2 โดยแก้ไขความในมาตรา 4 แห่งพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 ให้คงจัดเก็บในอัตราร้อยละ 6.3 สำหรับความรับผิดที่เกิดขึ้นตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2560 ถึงวันที่ 30 กันยายน พ.ศ. ${params.endBe} รวมภาษีท้องถิ่นอีก 1 ใน 9 เป็นร้อยละ 7.0 คิดเป็นภาษีขาย ${tax.toLocaleString("en-US")} บาท`,
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: `${base.toLocaleString("en-US")} × 7%`,
            tax_base_thb: base,
            exempt_amount_thb: 0,
            taxable_amount_thb: base,
            rate_pct: 7,
            computed_tax_thb: tax,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: [`${base.toLocaleString("en-US")} × 7% = ${tax.toLocaleString("en-US")} บาท`],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };
  };

  it("T1a. Case A (delivery-recognized phrasing, matching hosted trc.d6ea8930ba195b): classifies 30 Sep 2569 as OWNERSHIP_TRANSFER (FULL), selects 2026-09-30 under §78(1)(a), binds RD 799 (not RD 807), and survives Save/Reopen", async () => {
    const ledger = buildStructuredCaseFactLedger({ question: CASE_A_DELIVERY_RECOGNIZED_PHRASING, applicableDate: null });
    const events = ledger.temporal_facts.transaction_or_event_dates;

    // 1. Event classification, provenance & coverage (without needing duplicate ฿50,000 on the title clause)
    const titleEv = events.find((e) => e.iso_date === "2026-09-30" && e.event_type === "OWNERSHIP_TRANSFER");
    expect(titleEv).toBeDefined();
    expect(titleEv?.portion_coverage).toBe("FULL");
    expect(titleEv?.amount_thb).toBe(50000);
    expect(titleEv?.provenance_clause_th).toContain("โอนกรรมสิทธิ์");
    expect(events.some((e) => e.iso_date === "2026-09-30" && e.event_type === "REGISTRATION")).toBe(false);

    // Simultaneous 1 Oct 2569 events all preserved
    expect(events.some((e) => e.iso_date === "2026-10-01" && e.is_goods_delivery)).toBe(true);
    expect(events.some((e) => e.iso_date === "2026-10-01" && e.event_type === "PAYMENT")).toBe(true);
    expect(events.some((e) => e.iso_date === "2026-10-01" && e.event_type === "INVOICE")).toBe(true);

    // 2. Tax-point selection
    expect(ledger.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-30");
    expect(ledger.temporal_facts.controlling_tax_point.controlling_event).toContain("OWNERSHIP_TRANSFER");
    expect(ledger.temporal_facts.controlling_tax_point.statutory_rule_hint).toContain("มาตรา 78 (1)");

    // 3. Downstream version resolution, verification, atomic Save & exact Reopen
    let packetWorkIds: string[] = [];
    const res = await queryKnowledge(
      { question: CASE_A_DELIVERY_RECOGNIZED_PHRASING, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        onRealAppEvidenceAssembly: (cap) => {
          packetWorkIds = cap.actual_model_packet.map((p) => p.work_id);
        },
        llmMockInvokerForTesting: () =>
          buildSingleDecreeGoodsDraft({ taxPointTh: "30 กันยายน 2569", decree: "799", startBe: "2568", endBe: "2569" }),
      }
    );
    expect(packetWorkIds).toContain("subreg.th.rc.royal_decree.799");
    expect(packetWorkIds).not.toContain("subreg.th.rc.royal_decree.807");
    expect(res.status).toBe("ANSWERED");
    expect(res.claims.length).toBe(2);
    expect(res.claims[1].supporting_passage_ids).toContain("psg.rc8.rd799.sec_1_2");
    expect(res.claims[1].supporting_passage_ids).toContain("psg.rc8.rd799.sec_3_quoted_rd646_sec_4");
    expect(res.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(3500);

    const saved = await saveOrReviseAnswerServerVerified(store, {
      actor: TEST_ACTOR,
      question_text: CASE_A_DELIVERY_RECOGNIZED_PHRASING,
      save_operation_key: "op.cand9.caseA.r1",
      submitted_envelope: res.traceable_answer!,
      grounded_answer_snapshot: res,
    });
    expect(saved.revision_number).toBe(1);
    const reopened = reopenSavedTraceableAnswer(store, saved.answer_revision, TEST_ACTOR);
    expect(reopened.found).toBe(true);
    expect(reopened.answer!.rendered_answer_th).toContain("30 กันยายน 2569");
    expect(reopened.answer!.rendered_answer_th).toContain("799");
    expect(reopened.answer!.rendered_answer_th).toContain("3,500");
  });

  it("T1b. Case A (delivery-first simultaneous phrasing) & Case B (same-day 1 Oct 2569 control): recognize all four events cleanly and resolve 2026-09-30 (RD 799) vs 2026-10-01 (RD 807) via §78(1)", async () => {
    const ledgerA = buildStructuredCaseFactLedger({ question: CASE_A_SIMULTANEOUS_DELIVERY_FIRST, applicableDate: null });
    expect(ledgerA.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2026-09-30" && e.event_type === "OWNERSHIP_TRANSFER")).toBe(true);
    expect(ledgerA.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2026-10-01" && e.is_goods_delivery)).toBe(true);
    expect(ledgerA.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2026-10-01" && e.event_type === "PAYMENT")).toBe(true);
    expect(ledgerA.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2026-10-01" && e.event_type === "INVOICE")).toBe(true);
    expect(ledgerA.temporal_facts.controlling_tax_point.iso_date).toBe("2026-09-30");
    expect(ledgerA.temporal_facts.controlling_tax_point.statutory_rule_hint).toContain("มาตรา 78 (1)");

    const ledgerB = buildStructuredCaseFactLedger({ question: CASE_B_SAME_DAY_CONTROL, applicableDate: null });
    expect(ledgerB.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2026-10-01" && e.event_type === "OWNERSHIP_TRANSFER")).toBe(true);
    expect(ledgerB.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2026-10-01" && e.is_goods_delivery)).toBe(true);
    expect(ledgerB.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");
    expect(ledgerB.temporal_facts.controlling_tax_point.statutory_rule_hint).toContain("มาตรา 78 (1)");

    let packetWorkIdsB: string[] = [];
    const resB = await queryKnowledge(
      { question: CASE_B_SAME_DAY_CONTROL, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        onRealAppEvidenceAssembly: (cap) => {
          packetWorkIdsB = cap.actual_model_packet.map((p) => p.work_id);
        },
        llmMockInvokerForTesting: () =>
          buildSingleDecreeGoodsDraft({ taxPointTh: "1 ตุลาคม 2569", decree: "807", startBe: "2569", endBe: "2570" }),
      }
    );
    expect(packetWorkIdsB).toContain("subreg.th.rc.royal_decree.807");
    expect(packetWorkIdsB).not.toContain("subreg.th.rc.royal_decree.799");
    expect(resB.status).toBe("ANSWERED");
    expect(resB.claims[1].supporting_passage_ids).toContain("psg.rc8.rd807.sec_1_2");
    expect(resB.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(3500);
  });

  it("T2. Title passing AFTER delivery: delivery on 30 Sep 2569 + ownership transfer on 1 Oct 2569 keeps 2026-09-30 (RD 799) and never shifts to 1 Oct", () => {
    for (const q of [
      "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยการส่งมอบสินค้า การรับชำระราคาสินค้าเต็มจำนวน และการออกใบกำกับภาษีเกิดขึ้นพร้อมกันเมื่อวันที่ 30 กันยายน 2569 แต่โอนกรรมสิทธิ์ในสินค้าทั้งหมดให้แก่ผู้ซื้อเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด ใช้ พ.ร.ฎ. ใด",
      "ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศราคา 50,000 บาท ส่งมอบสินค้าให้ผู้ซื้อเมื่อวันที่ 30 กันยายน 2569 และโอนกรรมสิทธิ์ในสินค้าทั้งหมดพร้อมรับชำระราคาและออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
    ]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date, q).toBe("2026-09-30");
      expect(l.temporal_facts.controlling_tax_point.is_ambiguous, q).toBe(false);
    }
  });

  it("T3. Planned future title transfer or transfer that did NOT occur on 30 Sep 2569 is never treated as an early §78(1)(a) VAT trigger", () => {
    for (const q of [
      "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศราคา 50,000 บาท เดิมมีแผนจะโอนกรรมสิทธิ์ในสินค้าวันที่ 30 กันยายน 2569 แต่ยังไม่ได้โอนกรรมสิทธิ์จริง ต่อมาโอนกรรมสิทธิ์ในสินค้าทั้งหมด ส่งมอบสินค้า รับชำระราคาเต็มจำนวน และออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
      "บริษัทผู้ขายจดทะเบียน VAT ขายสินค้าในประเทศราคา 50,000 บาท โดยยังไม่ได้โอนกรรมสิทธิ์ในสินค้าเมื่อวันที่ 30 กันยายน 2569 แต่ส่งมอบสินค้า โอนกรรมสิทธิ์ รับชำระเงินเต็มจำนวน และออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
      "บริษัทผู้ขายจดทะเบียน VAT ขายสินค้าในประเทศราคา 50,000 บาท กำหนดจะโอนกรรมสิทธิ์ในวันที่ 30 กันยายน 2569 แต่เลื่อนออกไปโดยไม่ได้โอนจริง และส่งมอบสินค้าพร้อมโอนกรรมสิทธิ์ รับชำระราคา และออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
    ]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date, q).toBe("2026-10-01");
    }
  });

  it("T4. Generic registration date (company, commercial, contract, or machinery registration without goods title transfer) does NOT trigger §78(1)(a)", () => {
    for (const q of [
      "บริษัทผู้ขายซึ่งจดทะเบียนพาณิชย์เมื่อวันที่ 30 กันยายน 2569 และเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคา 50,000 บาท โดยส่งมอบสินค้า รับชำระเงินเต็มจำนวน และออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
      "บริษัทผู้ขายจดทะเบียน VAT ขายสินค้าในประเทศราคา 50,000 บาท โดยจดทะเบียนสัญญากรอบซื้อขายสินค้าเมื่อวันที่ 30 กันยายน 2569 (โดยยังไม่ได้โอนกรรมสิทธิ์ในสินค้า) ส่วนการส่งมอบสินค้า การรับชำระเงินเต็มจำนวน และการออกใบกำกับภาษีเกิดขึ้นเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
      "บริษัทผู้ขายจดทะเบียน VAT นำสินค้าที่เคยจดทะเบียนเครื่องจักรเมื่อวันที่ 30 กันยายน 2569 มาขายในประเทศราคา 50,000 บาท โดยส่งมอบสินค้า โอนกรรมสิทธิ์ รับชำระเงินเต็มจำนวน และออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด",
    ]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date, q).toBe("2026-10-01");
      expect(
        l.temporal_facts.transaction_or_event_dates.some(
          (e) => e.iso_date === "2026-09-30" && e.event_type === "OWNERSHIP_TRANSFER"
        ),
        q
      ).toBe(false);
    }
  });

  it("T5. Partial early title transfer with all needed facts known (฿20,000 on 30 Sep 2569 + remaining ฿30,000 delivered/settled on 1 Oct 2569): splits ฿20,000 (RD 799) and ฿30,000 (RD 807) without double-counting", async () => {
    const q =
      "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์ในสินค้าส่วนแรกมูลค่า 20,000 บาทให้แก่ผู้ซื้อเมื่อวันที่ 30 กันยายน 2569 และส่งมอบสินค้าทั้งหมดพร้อมโอนกรรมสิทธิ์ส่วนที่เหลืออีก 30,000 บาท รับชำระราคาเต็มจำนวน 50,000 บาท และออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิด พระราชกฤษฎีกาที่ใช้บังคับ และภาษีขายของแต่ละส่วนเป็นเท่าใด";
    const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
    expect(l.temporal_facts.controlling_tax_point.iso_date).toBeNull();
    expect(l.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
    const pts = l.temporal_facts.split_payment_tax_points || [];
    expect(pts.length).toBe(2);
    expect(pts[0]).toMatchObject({
      iso_date: "2026-09-30",
      event_type: "OWNERSHIP_TRANSFER",
      decree_window: "RD_799",
      amount_thb: 20000,
    });
    expect(pts[1]).toMatchObject({
      iso_date: "2026-10-01",
      decree_window: "RD_807",
      amount_thb: 30000,
    });

    let packetWorkIds: string[] = [];
    const splitRes = await queryKnowledge(
      { question: q, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        onRealAppEvidenceAssembly: (cap) => {
          packetWorkIds = cap.actual_model_packet.map((p) => p.work_id);
        },
        llmMockInvokerForTesting: () => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "ส่วนที่ 1 มูลค่า 20,000 บาท เกิดความรับผิดวันที่ 30 กันยายน 2569 (พ.ร.ฎ. 799 ภาษี 1,400 บาท) และส่วนที่ 2 มูลค่า 30,000 บาท เกิดความรับผิดวันที่ 1 ตุลาคม 2569 (พ.ร.ฎ. 807 ภาษี 2,100 บาท)",
          case_facts_used: [],
          issues: [
            {
              issue_id: "portion_1_30_sep",
              issue_title_th: "ส่วนที่ 1: สินค้าที่โอนกรรมสิทธิ์ก่อนส่งมอบวันที่ 30 กันยายน 2569",
              party_or_scope_th: "มูลค่าสินค้า 20,000 บาท",
              conclusion_th:
                "ความรับผิดสำหรับส่วนที่โอนกรรมสิทธิ์ก่อนส่งมอบมูลค่า 20,000 บาท เกิดขึ้นวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) (ก) ใช้ พ.ร.ฎ. (ฉบับที่ 799) ร้อยละ 7.0 คิดเป็นภาษีขาย 1,400 บาท (ไม่เสียซ้ำเมื่อส่งมอบและรับชำระวันที่ 1 ตุลาคม 2569)",
              material_facts_relied_on: ["โอนกรรมสิทธิ์ส่วนแรก 20,000 บาท วันที่ 30 กันยายน 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd799.sec_1_2",
                "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) (ก) การโอนกรรมสิทธิ์สินค้าก่อนส่งมอบทำให้ความรับผิดเกิดขึ้นตามส่วนของการกระทำนั้นในวันที่ 30 กันยายน 2569 จึงอยู่ในบังคับ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2568 ตามมาตรา 2 แก้ไขมาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560) คิดเป็นภาษี 1,400 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: {
                formula_description_th: "20,000 × 7%",
                tax_base_thb: 20000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 20000,
                rate_pct: 7,
                computed_tax_thb: 1400,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["20,000 × 7% = 1,400 บาท"],
              },
              missing_facts_or_uncertainties_th: [],
            },
            {
              issue_id: "portion_2_1_oct",
              issue_title_th: "ส่วนที่ 2: สินค้าส่วนที่เหลือที่ส่งมอบวันที่ 1 ตุลาคม 2569",
              party_or_scope_th: "มูลค่าสินค้าส่วนที่เหลือ 30,000 บาท",
              conclusion_th:
                "ความรับผิดสำหรับสินค้าส่วนที่เหลือมูลค่า 30,000 บาท เกิดขึ้นเมื่อส่งมอบวันที่ 1 ตุลาคม 2569 ตามมาตรา 78 (1) ใช้ พ.ร.ฎ. (ฉบับที่ 807) ร้อยละ 7.0 คิดเป็นภาษีขาย 2,100 บาท",
              material_facts_relied_on: ["ส่งมอบส่วนที่เหลือ 30,000 บาท วันที่ 1 ตุลาคม 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd807.sec_1_2",
                "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) สินค้าส่วนที่เหลือ 30,000 บาท เกิดความรับผิดเมื่อส่งมอบวันที่ 1 ตุลาคม 2569 จึงอยู่ในบังคับ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2569 ตามมาตรา 2 แก้ไขมาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560) คิดเป็นภาษีขายสำหรับส่วนที่สอง 2,100 บาท (เมื่อรวมกับภาษีขายของส่วนแรก 1,400 บาท รวมเป็นภาษีขายทั้งธุรกรรม 3,500 บาท และยอดรวมราคาสินค้าพร้อมภาษีมูลค่าเพิ่มทั้งสิ้น 53,500 บาท)",
              authority_distinction_note_th: "",
              proposed_calculation: {
                formula_description_th: "30,000 × 7%",
                tax_base_thb: 30000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 30000,
                rate_pct: 7,
                computed_tax_thb: 2100,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["30,000 × 7% = 2,100 บาท"],
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
    expect(packetWorkIds).toContain("subreg.th.rc.royal_decree.799");
    expect(packetWorkIds).toContain("subreg.th.rc.royal_decree.807");
    expect(splitRes.status).toBe("ANSWERED");
    expect(splitRes.claims.length).toBe(2);
    expect(splitRes.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(1400);
    expect(splitRes.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(2100);
  });

  it("T6. Partial or unclear early title transfer with unknown coverage across decree cutoff: asks for the missing coverage fact and neither guesses 30 Sep nor defaults to 1 Oct delivery", async () => {
    for (const q of [
      "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศราคา 50,000 บาท (ยังไม่รวม VAT) โดยโอนกรรมสิทธิ์ในสินค้าบางส่วนเมื่อวันที่ 30 กันยายน 2569 (ไม่ระบุมูลค่าส่วนที่โอน) และส่งมอบสินค้าทั้งหมดพร้อมรับชำระราคาและออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด ใช้ พ.ร.ฎ. ใด",
      "บริษัทผู้ขายจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าในประเทศราคา 50,000 บาท มีการโอนกรรมสิทธิ์ในสินค้าเมื่อวันที่ 30 กันยายน 2569 แต่ไม่ทราบว่าโอนกรรมสิทธิ์ทั้งหมดหรือบางส่วน และส่งมอบสินค้าพร้อมรับชำระราคาเต็มจำนวนและออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 ต้องใช้พระราชกฤษฎีกาฉบับใดและเสียภาษีเท่าใด",
    ]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date, q).toBeNull();
      expect(l.temporal_facts.controlling_tax_point.is_ambiguous, q).toBe(true);
      expect(l.explicitly_unknown_facts_th.join(" "), q).toMatch(/โอนกรรมสิทธิ์|30\s*กันยายน|2026-09-30/);
    }

    const unclearQ =
      "บริษัทผู้ขายซึ่งเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่มขายสินค้าทั่วไปในประเทศราคา 50,000 บาท (ยังไม่รวม VAT) โดยโอนกรรมสิทธิ์ในสินค้าบางส่วนเมื่อวันที่ 30 กันยายน 2569 (ไม่ระบุมูลค่าส่วนที่โอน) และส่งมอบสินค้าทั้งหมดพร้อมรับชำระราคาและออกใบกำกับภาษีเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด ใช้ พ.ร.ฎ. ใด";
    const unclearRes = await queryKnowledge(
      { question: unclearQ, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () => ({
          answer_status: "CONDITIONAL",
          overall_summary_th:
            "ต้องทราบมูลค่าสินค้าส่วนที่โอนกรรมสิทธิ์เมื่อวันที่ 30 กันยายน 2569 จึงจะแยกคำนวณตาม พ.ร.ฎ. 799 และ พ.ร.ฎ. 807 ได้",
          case_facts_used: [],
          issues: [
            {
              issue_id: "cond_partial_title",
              issue_title_th: "การพิจารณาวันเกิดความรับผิดแยกตามสัดส่วนการโอนกรรมสิทธิ์ก่อนส่งมอบ",
              party_or_scope_th: "การขายสินค้าในประเทศราคารวม 50,000 บาท",
              conclusion_th:
                "ตามมาตรา 78 (1) (ก) ส่วนที่โอนกรรมสิทธิ์เมื่อวันที่ 30 กันยายน 2569 เกิดความรับผิดภายใต้ พ.ร.ฎ. (ฉบับที่ 799) และส่วนที่เหลือซึ่งส่งมอบวันที่ 1 ตุลาคม 2569 เกิดความรับผิดภายใต้ พ.ร.ฎ. (ฉบับที่ 807) โดยยังไม่สามารถคำนวณแยกตัวเงินของแต่ละส่วนได้จนกว่าจะทราบมูลค่าส่วนที่โอนกรรมสิทธิ์วันที่ 30 กันยายน 2569",
              material_facts_relied_on: ["โอนกรรมสิทธิ์บางส่วนไม่ระบุมูลค่าวันที่ 30 กันยายน 2569", "ส่งมอบวันที่ 1 ตุลาคม 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.rc8.rd799.sec_1_2",
                "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
                "psg.rc8.rd807.sec_1_2",
                "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
              ],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) (ก) ความรับผิดเกิดขึ้นตามส่วนของการโอนกรรมสิทธิ์ก่อนส่งมอบในวันที่ 30 กันยายน 2569 ตาม พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2568 ตามมาตรา 2 แก้ไขมาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560) ส่วนสินค้าที่เหลือเกิดความรับผิดเมื่อส่งมอบวันที่ 1 ตุลาคม 2569 ตาม พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 (ใช้บังคับตั้งแต่วันที่ 1 ตุลาคม พ.ศ. 2569 ตามมาตรา 2 แก้ไขมาตรา 4 แห่ง พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560)",
              authority_distinction_note_th: "",
              proposed_calculation: null,
              missing_facts_or_uncertainties_th: ["มูลค่าของสินค้าส่วนที่โอนกรรมสิทธิ์เมื่อวันที่ 30 กันยายน 2569"],
            },
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(["CONDITIONAL", "NEEDS_CLARIFICATION"]).toContain(unclearRes.status);
    expect(unclearRes.clarification_questions.join(" ")).toMatch(/โอนกรรมสิทธิ์|30\s*กันยายน|2026-09-30/);
    expect(unclearRes.claims.every((c) => !c.bound_calculation)).toBe(true);
  });

  it("T7. No-double-count guard: when title, delivery, payment, and invoice all cover the same ฿50,000 goods, verifier blocks excess base (฿100,000 / ฿7,000) and blocks taxing two co-occurring or sequential events separately", async () => {
    // 7a: Same-day 1 Oct 2569 (title + delivery + payment + invoice all on 1 Oct for the same ฿50,000 goods):
    //     double-counting 50,000 + 50,000 = 100,000 -> MUST be rejected!
    const overBaseSameDay = await queryKnowledge(
      { question: CASE_B_SAME_DAY_CONTROL, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () =>
          buildSingleDecreeGoodsDraft({
            taxPointTh: "1 ตุลาคม 2569",
            decree: "807",
            startBe: "2569",
            endBe: "2570",
            baseThb: 100000,
            taxThb: 7000,
          }),
      }
    );
    expect(overBaseSameDay.claims.some((c) => c.bound_calculation?.outputs.computed_tax_thb === 7000)).toBe(false);
    expect(overBaseSameDay.answer).not.toContain("7,000");

    // 7b: Early title (30 Sep) + delivery/payment/invoice (1 Oct) double-counting 100,000 -> rejected
    const overBaseRes = await queryKnowledge(
      { question: CASE_A_DELIVERY_RECOGNIZED_PHRASING, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () =>
          buildSingleDecreeGoodsDraft({
            taxPointTh: "30 กันยายน 2569",
            decree: "799",
            startBe: "2568",
            endBe: "2569",
            baseThb: 100000,
            taxThb: 7000,
          }),
      }
    );
    expect(overBaseRes.claims.some((c) => c.bound_calculation?.outputs.computed_tax_thb === 7000)).toBe(false);
    expect(overBaseRes.answer).not.toContain("7,000");

    // 7c: Two separate issues taxing ฿50,000 on 30 Sep AND taxing ฿50,000 again on 1 Oct -> duplicate tax rejected
    const twoEventDoubleTaxRes = await queryKnowledge(
      { question: CASE_A_DELIVERY_RECOGNIZED_PHRASING, release_id: "rel.B01.rc8", answer_generation_mode: "llm_grounded", thinking_level: "low" },
      TEST_ACTOR,
      {
        store,
        channel: "chat",
        persistAnswerAtomically: false,
        llmMockInvokerForTesting: () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "เสียภาษีทั้งสองวันรวม 7,000 บาท",
          case_facts_used: [],
          issues: [
            buildSingleDecreeGoodsDraft({
              taxPointTh: "30 กันยายน 2569",
              decree: "799",
              startBe: "2568",
              endBe: "2569",
            }).issues[1],
            {
              issue_id: "duplicate_1_oct_tax",
              issue_title_th: "ภาษีขายเมื่อส่งมอบและรับชำระเงินวันที่ 1 ตุลาคม 2569",
              party_or_scope_th: "การส่งมอบและรับชำระเงินวันที่ 1 ตุลาคม 2569",
              conclusion_th:
                "เมื่อส่งมอบและรับชำระราคาสินค้า 50,000 บาท ในวันที่ 1 ตุลาคม 2569 ต้องเสียภาษีมูลค่าเพิ่มอีกครั้งจำนวน 3,500 บาท",
              material_facts_relied_on: ["รับชำระราคา 50,000 บาท วันที่ 1 ตุลาคม 2569"],
              governing_passage_ids: ["psg.aa853373203223", "psg.1b1abb8e7e22df", "psg.3d0eb5636faa0e"],
              application_explanation_th:
                "ตามประมวลรัษฎากร มาตรา 78 (1) และมาตรา 80 คิดภาษีขายร้อยละ 7.0 จากฐาน 50,000 บาท เท่ากับ 3,500 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: {
                formula_description_th: "50,000 × 7%",
                tax_base_thb: 50000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 50000,
                rate_pct: 7,
                computed_tax_thb: 3500,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["50,000 × 7% = 3,500 บาท"],
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
    const verifiedCalcs = twoEventDoubleTaxRes.claims
      .map((c) => c.bound_calculation)
      .filter((bc): bc is NonNullable<typeof bc> => Boolean(bc));
    expect(verifiedCalcs.length).toBe(1);
    const totalTaxedBase = verifiedCalcs.reduce((s, bc) => s + Number(bc.inputs.tax_base_thb ?? 0), 0);
    expect(totalTaxedBase).toBe(50000);
  });
});
