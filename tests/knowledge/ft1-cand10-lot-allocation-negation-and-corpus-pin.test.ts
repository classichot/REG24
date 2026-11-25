import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
import * as cte from "../../src/core/knowledge/claim-traceability-engine";
import { onboardVerifiedOfficialAttachment } from "../../src/core/knowledge/source-onboarding";
import type { Actor } from "../../src/core/knowledge/contracts";
import type { GroundedLlmDraftResponse } from "../../src/core/knowledge/grounded-llm-drafter";

const STAGING_STORE_SRC = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");

const TEST_ACTOR_A: Actor = {
  actor_id: "usr.cand10.verifier.a",
  role: "legal_reviewer",
  tenant_id: "tenant.cand10.a",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const TEST_ACTOR_B: Actor = {
  actor_id: "usr.cand10.verifier.b",
  role: "legal_reviewer",
  tenant_id: "tenant.cand10.b",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

// Exact locked QA fixtures from Candidate 9 QA traces
const DEF_C9_1_DISTINCT_LOTS_SAME_DAY =
  "บริษัท ทดสอบนกขุนทอง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์ในล็อต A ให้แก่ผู้ซื้อ และในวันเดียวกัน (30 กันยายน 2569) บริษัทได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต B โดยเฉพาะ ส่วนล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อน และบริษัทส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const DEF_C9_1_SINGLE_DATE_MENTION_VARIANT =
  "บริษัท ทดสอบนกขุนทอง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์ในล็อต A ให้แก่ผู้ซื้อ และได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับล็อต B โดยเฉพาะ ส่วนล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อน และบริษัทส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const DEF_C9_2_SAME_LOT_DIFFERENT_DAYS =
  "บริษัท ทดสอบนกกระเรียน จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อรายเดียว ราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) แบ่งเป็น 3 ล็อต คือ ล็อต A มูลค่า 20,000 บาท ล็อต B มูลค่า 20,000 บาท และล็อต C มูลค่า 10,000 บาท บริษัทโอนกรรมสิทธิ์ในล็อต A ให้แก่ผู้ซื้อเมื่อวันที่ 29 กันยายน 2569 ต่อมาวันที่ 30 กันยายน 2569 บริษัทได้รับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เดิมอีกครั้ง (ไม่ใช่ล็อต B) ส่วนล็อต B และล็อต C ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีก่อน และบริษัทส่งมอบสินค้าทั้ง 3 ล็อตเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

const DEF_C9_3_NEGATED_BOUNDARY_ORIGINAL =
  "บริษัท ทดสอบนกนางนวล จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศให้แก่ผู้ซื้อในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์และส่งมอบสินค้าทั้งหมดเมื่อวันที่ 1 ตุลาคม 2569 ออกใบกำกับภาษีเมื่อวันที่ 2 ตุลาคม 2569 และได้รับชำระราคาเต็มจำนวนเมื่อวันที่ 3 ตุลาคม 2569 โดยไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มเป็นเงินเท่าใด";

const DEF_C9_3_REORDERED_NEGATIVE_CLAUSE =
  "บริษัท ทดสอบนกนางนวล จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) ก่อนวันที่ 1 ตุลาคม 2569 ไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ โดยบริษัทโอนกรรมสิทธิ์และส่งมอบสินค้าทั้งหมดเมื่อวันที่ 1 ตุลาคม 2569 ออกใบกำกับภาษีเมื่อวันที่ 2 ตุลาคม 2569 และได้รับชำระราคาเต็มจำนวนเมื่อวันที่ 3 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มเป็นเงินเท่าใด";

const DEF_C9_3_POSITIVE_SAME_DAY_CONTROL =
  "บริษัท ทดสอบนกนางนวล จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศในราคา 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์ ส่งมอบสินค้าทั้งหมด ออกใบกำกับภาษี และได้รับชำระราคาเต็มจำนวนพร้อมกันเมื่อวันที่ 1 ตุลาคม 2569 โดยไม่มีการโอนกรรมสิทธิ์ รับชำระเงิน หรือออกใบกำกับภาษีใดๆ ก่อนวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มเป็นเงินเท่าใด";

const AMBIGUOUS_OVERLAP_EARLY_ACTS =
  "บริษัท ทดสอบนกกระจาบ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าทั่วไปในประเทศราคารวม 50,000 บาท (ยังไม่รวมภาษีมูลค่าเพิ่ม) โดยโอนกรรมสิทธิ์ในสินค้าบางส่วนมูลค่า 20,000 บาท เมื่อวันที่ 29 กันยายน 2569 และได้รับชำระราคาพร้อมออกใบกำกับภาษีมูลค่า 20,000 บาท เมื่อวันที่ 30 กันยายน 2569 (โดยไม่ระบุว่าการชำระเงินและออกใบกำกับภาษีดังกล่าวเป็นสินค้าส่วนเดียวกับที่โอนกรรมสิทธิ์แล้วหรือเป็นสินค้าคนละส่วน) จากนั้นส่งมอบสินค้าทั้งหมดเมื่อวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดของแต่ละส่วนคือวันใด ใช้พระราชกฤษฎีกาฉบับใด และภาษีมูลค่าเพิ่มแต่ละส่วนเป็นเงินเท่าใด";

describe("Formal Test 1 Candidate 10 — Lot-Aware VAT Allocation, Negated Boundary Dates & Corpus Pin Isolation", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand10-"));
    fs.cpSync(STAGING_STORE_SRC, tmpDir, { recursive: true });
    store = new DurableKnowledgeStore(tmpDir);
  }, 60_000);

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("T1a (DEF-C9-1 exact trc.a081cac166d453 + single-date variant): allocates Lot A (title 30 Sep) + Lot B (payment/invoice 30 Sep) = ฿40,000 RD 799 (VAT ฿2,800) and Lot C (delivery 1 Oct) = ฿10,000 RD 807 (VAT ฿700) without collapsing distinct lots", async () => {
    for (const q of [DEF_C9_1_DISTINCT_LOTS_SAME_DAY, DEF_C9_1_SINGLE_DATE_MENTION_VARIANT]) {
      const ledger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(ledger.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
      expect(ledger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
      expect(ledger.temporal_facts.controlling_tax_point.controlling_event).not.toContain(
        "UNKNOWN_COVERAGE"
      );

      const pts = ledger.temporal_facts.split_payment_tax_points || [];
      expect(pts.length).toBe(2);
      expect(pts[0]).toMatchObject({
        iso_date: "2026-09-30",
        decree_window: "RD_799",
        governing_decree_work_id: "subreg.th.rc.royal_decree.799",
        amount_thb: 40000,
      });
      expect(pts[1]).toMatchObject({
        iso_date: "2026-10-01",
        decree_window: "RD_807",
        governing_decree_work_id: "subreg.th.rc.royal_decree.807",
        amount_thb: 10000,
      });
    }

    // End-to-end verification & Save/Reopen with BOTH per-date draft layout (40k + 10k) and per-lot draft layout (20k + 20k + 10k)
    const perDateDraft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th:
        "วันที่ 30 กันยายน 2569 (ล็อต A 20,000 บาท + ล็อต B 20,000 บาท = 40,000 บาท) ใช้ พ.ร.ฎ. (ฉบับที่ 799) VAT 2,800 บาท และวันที่ 1 ตุลาคม 2569 (ล็อต C 10,000 บาท) ใช้ พ.ร.ฎ. (ฉบับที่ 807) VAT 700 บาท รวม VAT 3,500 บาท",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_1_SEP30_LOTS_A_B",
          issue_title_th: "ส่วนที่ 1 (ล็อต A และล็อต B) — วันเกิดความรับผิดวันที่ 30 กันยายน 2569 (ฐานภาษี 40,000 บาท)",
          party_or_scope_th: "ล็อต A (20,000 บาท โอนกรรมสิทธิ์) และล็อต B (20,000 บาท รับชำระราคาและออกใบกำกับภาษี) วันที่ 30 กันยายน 2569",
          conclusion_th:
            "ล็อต A (โอนกรรมสิทธิ์วันที่ 30 กันยายน 2569 มูลค่า 20,000 บาท) และล็อต B (รับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569 มูลค่า 20,000 บาท) เป็นสินค้าคนละส่วนกัน ความรับผิดตามประมวลรัษฎากร มาตรา 78 (1) จึงเกิดขึ้นในวันที่ 30 กันยายน 2569 รวมฐานภาษี 40,000 บาท ใช้พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 2,800 บาท",
          material_facts_relied_on: ["ล็อต A 20,000 บาท + ล็อต B 20,000 บาท = 40,000 บาท วันที่ 30 กันยายน 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd799.sec_1_2",
            "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 (ใช้บังคับ 1 ต.ค. 2568 ถึง 30 ก.ย. 2569) รวมภาษีท้องถิ่นร้อยละ 7.0 คำนวณจากฐาน 40,000 บาท ได้ภาษีมูลค่าเพิ่ม 2,800 บาท การส่งมอบในวันที่ 1 ตุลาคม 2569 ไม่ก่อให้เกิดภาระภาษีซ้ำ",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "40,000 × 7% = 2,800 บาท",
            tax_base_thb: 40000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 40000,
            rate_pct: 7,
            computed_tax_thb: 2800,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["(20,000 + 20,000) × 7% = 2,800 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "ISSUE_2_OCT1_LOT_C",
          issue_title_th: "ส่วนที่ 2 (ล็อต C) — วันเกิดความรับผิดวันที่ 1 ตุลาคม 2569 (ฐานภาษี 10,000 บาท)",
          party_or_scope_th: "ล็อต C มูลค่า 10,000 บาท ส่งมอบวันที่ 1 ตุลาคม 2569",
          conclusion_th:
            "ล็อต C มูลค่า 10,000 บาท ไม่มีการกระทำก่อนส่งมอบ ความรับผิดจึงเกิดขึ้นเมื่อส่งมอบสินค้าในวันที่ 1 ตุลาคม 2569 ตามมาตรา 78 (1) ใช้พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท (รวมภาษีมูลค่าเพิ่มทั้ง 3 ล็อตเป็นเงิน 3,500 บาท)",
          material_facts_relied_on: ["ล็อต C 10,000 บาท ส่งมอบวันที่ 1 ตุลาคม 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd807.sec_1_2",
            "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 (เริ่มใช้บังคับ 1 ต.ค. 2569) รวมภาษีท้องถิ่นร้อยละ 7.0 คำนวณจากฐาน 10,000 บาท ได้ภาษีมูลค่าเพิ่ม 700 บาท รวมกับส่วนวันที่ 30 กันยายน 2569 (2,800 บาท) เป็นภาษีมูลค่าเพิ่มรวมทั้งสิ้น 3,500 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "10,000 × 7% = 700 บาท",
            tax_base_thb: 10000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 10000,
            rate_pct: 7,
            computed_tax_thb: 700,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["10,000 × 7% = 700 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const ansPerDate = await queryKnowledge(
      {
        question: DEF_C9_1_DISTINCT_LOTS_SAME_DAY,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      { store, llmMockInvokerForTesting: async () => perDateDraft }
    );
    expect(ansPerDate.status).toBe("ANSWERED");
    expect(ansPerDate.claims.length).toBe(2);
    expect(ansPerDate.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(2800);
    expect(ansPerDate.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(700);
    expect(ansPerDate.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(true);
    expect(ansPerDate.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.807")).toBe(true);

    // Also test per-lot 3-issue layout (matching how Gemini drafted trc.a081cac166d453)
    const perLotDraft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th:
        "ล็อต A (20,000 -> 1,400) และล็อต B (20,000 -> 1,400) รวมวันที่ 30 ก.ย. 2569 ฐาน 40,000 บาท VAT 2,800 บาท (พ.ร.ฎ. 799) และล็อต C วันที่ 1 ต.ค. 2569 ฐาน 10,000 บาท VAT 700 บาท (พ.ร.ฎ. 807)",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_1_LOT_A",
          issue_title_th: "ล็อต A (มูลค่า 20,000 บาท) — โอนกรรมสิทธิ์วันที่ 30 กันยายน 2569",
          party_or_scope_th: "สินค้าล็อต A มูลค่า 20,000 บาท",
          conclusion_th:
            "ล็อต A เกิดความรับผิดเมื่อโอนกรรมสิทธิ์วันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) ใช้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["ล็อต A 20,000 บาท โอนกรรมสิทธิ์วันที่ 30 กันยายน 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd799.sec_1_2",
            "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) รวมภาษีท้องถิ่นร้อยละ 7.0 จากฐาน 20,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "20,000 × 7% = 1,400 บาท",
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
          issue_id: "ISSUE_2_LOT_B",
          issue_title_th: "ล็อต B (มูลค่า 20,000 บาท) — รับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569",
          party_or_scope_th: "สินค้าล็อต B มูลค่า 20,000 บาท",
          conclusion_th:
            "ล็อต B เป็นสินค้าคนละล็อตกับล็อต A เกิดความรับผิดเมื่อรับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569 ตามมาตรา 78 (1) ใช้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท (รวมล็อต A และล็อต B ในวันที่ 30 กันยายน 2569 ฐานภาษี 40,000 บาท ภาษีมูลค่าเพิ่ม 2,800 บาท)",
          material_facts_relied_on: ["ล็อต B 20,000 บาท รับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd799.sec_1_2",
            "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) รวมภาษีท้องถิ่นร้อยละ 7.0 จากฐาน 20,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท รวมยอดวันที่ 30 กันยายน 2569 เป็น 40,000 บาท ภาษีมูลค่าเพิ่ม 2,800 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "20,000 × 7% = 1,400 บาท",
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
          issue_id: "ISSUE_3_LOT_C",
          issue_title_th: "ล็อต C (มูลค่า 10,000 บาท) — ส่งมอบสินค้าวันที่ 1 ตุลาคม 2569",
          party_or_scope_th: "สินค้าล็อต C มูลค่า 10,000 บาท",
          conclusion_th:
            "ล็อต C เกิดความรับผิดเมื่อส่งมอบสินค้าวันที่ 1 ตุลาคม 2569 ตามมาตรา 78 (1) ใช้ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท (รวมทั้ง 3 ล็อต 3,500 บาท)",
          material_facts_relied_on: ["ล็อต C 10,000 บาท ส่งมอบวันที่ 1 ตุลาคม 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd807.sec_1_2",
            "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 807) รวมภาษีท้องถิ่นร้อยละ 7.0 จากฐาน 10,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "10,000 × 7% = 700 บาท",
            tax_base_thb: 10000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 10000,
            rate_pct: 7,
            computed_tax_thb: 700,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["10,000 × 7% = 700 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };

    const ansPerLot = await queryKnowledge(
      {
        question: DEF_C9_1_DISTINCT_LOTS_SAME_DAY,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      { store, llmMockInvokerForTesting: async () => perLotDraft }
    );
    expect(ansPerLot.status).toBe("ANSWERED");
    expect(ansPerLot.claims.length).toBe(3);
    expect(ansPerLot.claims.map((c) => c.bound_calculation?.outputs.computed_tax_thb)).toEqual([
      1400, 1400, 700,
    ]);
  });

  it("T2 (DEF-C9-2 exact trc.c67c184da6d7f2): counts Lot A ONCE at earliest trigger (29 Sep, ฿20,000, RD 799, VAT ฿1,400), ignores repeat 30 Sep payment/invoice on Lot A, and keeps Lot B+C on 1 Oct (฿30,000, RD 807, VAT ฿2,100)", async () => {
    const ledger = buildStructuredCaseFactLedger({
      question: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS,
      applicableDate: null,
    });
    expect(ledger.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
    expect(ledger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
    expect(ledger.temporal_facts.controlling_tax_point.controlling_event).not.toContain(
      "UNKNOWN_COVERAGE"
    );

    const pts = ledger.temporal_facts.split_payment_tax_points || [];
    // MUST have strictly TWO tax-point dates: 2026-09-29 (20,000) and 2026-10-01 (30,000) — NEVER a 2026-09-30 tax point!
    expect(pts.length).toBe(2);
    expect(pts[0]).toMatchObject({
      iso_date: "2026-09-29",
      decree_window: "RD_799",
      governing_decree_work_id: "subreg.th.rc.royal_decree.799",
      amount_thb: 20000,
    });
    expect(pts[1]).toMatchObject({
      iso_date: "2026-10-01",
      decree_window: "RD_807",
      governing_decree_work_id: "subreg.th.rc.royal_decree.807",
      amount_thb: 30000,
    });

    const draftC92: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th:
        "ล็อต A เกิดความรับผิดครั้งเดียววันที่ 29 กันยายน 2569 (20,000 บาท, พ.ร.ฎ. 799, VAT 1,400 บาท) และล็อต B + C วันที่ 1 ตุลาคม 2569 (30,000 บาท, พ.ร.ฎ. 807, VAT 2,100 บาท)",
      case_facts_used: [],
      issues: [
        {
          issue_id: "ISSUE_1_LOT_A_SEP29",
          issue_title_th: "ล็อต A (มูลค่า 20,000 บาท) — วันเกิดความรับผิดวันที่ 29 กันยายน 2569",
          party_or_scope_th: "สินค้าล็อต A มูลค่า 20,000 บาท",
          conclusion_th:
            "ล็อต A เกิดความรับผิดครั้งเดียวเมื่อโอนกรรมสิทธิ์วันที่ 29 กันยายน 2569 ตามมาตรา 78 (1) (ก) การรับชำระราคาและออกใบกำกับภาษีสำหรับล็อต A เดิมในวันที่ 30 กันยายน 2569 และการส่งมอบวันที่ 1 ตุลาคม 2569 ไม่ก่อให้เกิดภาระภาษีซ้ำ ใช้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
          material_facts_relied_on: ["ล็อต A 20,000 บาท โอนกรรมสิทธิ์วันที่ 29 กันยายน 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd799.sec_1_2",
            "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) รวมภาษีท้องถิ่นร้อยละ 7.0 จากฐาน 20,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "20,000 × 7% = 1,400 บาท",
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
          issue_id: "ISSUE_2_LOT_B_C_OCT1",
          issue_title_th: "ล็อต B (20,000 บาท) และล็อต C (10,000 บาท) — วันเกิดความรับผิดวันที่ 1 ตุลาคม 2569",
          party_or_scope_th: "สินค้าล็อต B และล็อต C รวมมูลค่า 30,000 บาท",
          conclusion_th:
            "ล็อต B และล็อต C รวมมูลค่า 30,000 บาท ไม่มีการกระทำก่อนส่งมอบ ความรับผิดเกิดขึ้นเมื่อส่งมอบสินค้าวันที่ 1 ตุลาคม 2569 ตามมาตรา 78 (1) ใช้ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 2,100 บาท (รวมภาษีมูลค่าเพิ่มทั้งหมด 3,500 บาท)",
          material_facts_relied_on: ["ล็อต B 20,000 บาท + ล็อต C 10,000 บาท = 30,000 บาท ส่งมอบวันที่ 1 ตุลาคม 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd807.sec_1_2",
            "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th:
            "ตามมาตรา 78 (1) และมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 807) รวมภาษีท้องถิ่นร้อยละ 7.0 จากฐาน 30,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 2,100 บาท รวมกับล็อต A (1,400 บาท) เป็นภาษีมูลค่าเพิ่มรวมทั้งสิ้น 3,500 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "30,000 × 7% = 2,100 บาท",
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
    };

    const ans = await queryKnowledge(
      {
        question: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      { store, llmMockInvokerForTesting: async () => draftC92 }
    );
    expect(ans.status).toBe("ANSWERED");
    expect(ans.claims.length).toBe(2);
    expect(ans.claims[0].bound_calculation?.outputs.computed_tax_thb).toBe(1400);
    expect(ans.claims[1].bound_calculation?.outputs.computed_tax_thb).toBe(2100);
  });

  it("T3 (DEF-C9-3 exact trc.603e80c7eb17a2 + reordered negative clause + positive same-day control): suppresses phantom 1 Oct payment/invoice from negated boundary clause, fixes explanatory hint, and preserves true same-day positive events", async () => {
    for (const q of [DEF_C9_3_NEGATED_BOUNDARY_ORIGINAL, DEF_C9_3_REORDERED_NEGATIVE_CLAUSE]) {
      const ledger = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      const evs = ledger.temporal_facts.transaction_or_event_dates;
      const pairs = evs.map((e) => `${e.event_type}:${e.iso_date}`);

      expect(pairs).toContain("OWNERSHIP_TRANSFER:2026-10-01");
      expect(pairs).toContain("DELIVERY:2026-10-01");
      expect(pairs).toContain("INVOICE:2026-10-02");
      expect(pairs).toContain("PAYMENT:2026-10-03");
      // ZERO invented 1 Oct invoice or payment!
      expect(pairs).not.toContain("INVOICE:2026-10-01");
      expect(pairs).not.toContain("PAYMENT:2026-10-01");
      expect(ledger.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");
      // Explanatory statutory_rule_hint MUST NOT claim payment & invoice happened on 2026-10-01!
      const hint = ledger.temporal_facts.controlling_tax_point.statutory_rule_hint || "";
      expect(hint).not.toContain("การรับชำระราคา และการออกใบกำกับภาษีสำหรับสินค้าเดียวกันเกิดขึ้นพร้อมกันในวันที่ 2026-10-01");
      expect(hint).toContain("2026-10-02");
      expect(hint).toContain("2026-10-03");
    }

    // Positive control: payment & invoice GENUINELY occurred on 1 Oct 2569!
    const posLedger = buildStructuredCaseFactLedger({
      question: DEF_C9_3_POSITIVE_SAME_DAY_CONTROL,
      applicableDate: null,
    });
    const posPairs = posLedger.temporal_facts.transaction_or_event_dates.map(
      (e) => `${e.event_type}:${e.iso_date}`
    );
    expect(posPairs).toContain("OWNERSHIP_TRANSFER:2026-10-01");
    expect(posPairs).toContain("DELIVERY:2026-10-01");
    expect(posPairs).toContain("INVOICE:2026-10-01");
    expect(posPairs).toContain("PAYMENT:2026-10-01");
    expect(posLedger.temporal_facts.controlling_tax_point.iso_date).toBe("2026-10-01");
  });

  it("T4 (Ambiguous overlap control): when facts do not establish whether two early acts cover the same goods or separate goods, marks ambiguous and asks which goods each act covered instead of guessing", async () => {
    const ledger = buildStructuredCaseFactLedger({
      question: AMBIGUOUS_OVERLAP_EARLY_ACTS,
      applicableDate: null,
    });
    expect(ledger.temporal_facts.controlling_tax_point.is_ambiguous).toBe(true);
    expect(ledger.temporal_facts.controlling_tax_point.iso_date).toBeNull();
    expect(ledger.temporal_facts.controlling_tax_point.ambiguity_reason_th || "").toMatch(
      /(?:สินค้าส่วนเดียวกัน|คนละส่วน|ครอบคลุมสินค้า)/
    );
  });

  it("T5 (Strict Verifier Rejection Guards): rejects swapped lot/date bases, wrong splits whose total VAT is still ฿3,500, double-counted Lot A, and arbitrary sibling tax numbers", async () => {
    // T5a: Swapped bases on DEF-C9-1 (10k on 30 Sep + 40k on 1 Oct -> total VAT still 3,500!) MUST BE REJECTED!
    const swappedDraft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "สลับฐานภาษี",
      case_facts_used: [],
      issues: [
        {
          issue_id: "SWAPPED_SEP30_10K",
          issue_title_th: "ส่วนวันที่ 30 กันยายน 2569",
          party_or_scope_th: "วันที่ 30 กันยายน 2569",
          conclusion_th:
            "วันที่ 30 กันยายน 2569 ฐานภาษี 10,000 บาท ตามมาตรา 78 (1) และ พ.ร.ฎ. (ฉบับที่ 799) อัตรารวมร้อยละ 7.0 ภาษีมูลค่าเพิ่ม 700 บาท",
          material_facts_relied_on: ["วันที่ 30 กันยายน 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd799.sec_1_2",
            "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th: "10,000 × 7% = 700 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "10,000 × 7%",
            tax_base_thb: 10000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 10000,
            rate_pct: 7,
            computed_tax_thb: 700,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["10,000 × 7% = 700 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
        {
          issue_id: "SWAPPED_OCT1_40K",
          issue_title_th: "ส่วนวันที่ 1 ตุลาคม 2569",
          party_or_scope_th: "วันที่ 1 ตุลาคม 2569",
          conclusion_th:
            "วันที่ 1 ตุลาคม 2569 ฐานภาษี 40,000 บาท ตามมาตรา 78 (1) และ พ.ร.ฎ. (ฉบับที่ 807) อัตรารวมร้อยละ 7.0 ภาษีมูลค่าเพิ่ม 2,800 บาท รวม 3,500 บาท",
          material_facts_relied_on: ["วันที่ 1 ตุลาคม 2569"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd807.sec_1_2",
            "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th: "40,000 × 7% = 2,800 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "40,000 × 7%",
            tax_base_thb: 40000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 40000,
            rate_pct: 7,
            computed_tax_thb: 2800,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["40,000 × 7% = 2,800 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };
    const resSwapped = await queryKnowledge(
      {
        question: DEF_C9_1_DISTINCT_LOTS_SAME_DAY,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      { store, llmMockInvokerForTesting: async () => swappedDraft }
    );
    expect(resSwapped.claims.length).toBe(0);
    expect(resSwapped.status).toBe("REVIEW_REQUIRED");

    // T5b: Wrong split totaling 3,500 (25,000 @ 30 Sep + 25,000 @ 1 Oct) MUST BE REJECTED!
    const wrongSplitSameTotal: GroundedLlmDraftResponse = {
      ...swappedDraft,
      issues: [
        {
          ...swappedDraft.issues[0],
          issue_id: "WRONG_25K_SEP30",
          conclusion_th:
            "วันที่ 30 กันยายน 2569 ฐานภาษี 25,000 บาท ใช้ พ.ร.ฎ. (ฉบับที่ 799) อัตรารวมร้อยละ 7.0 ภาษีมูลค่าเพิ่ม 1,750 บาท",
          application_explanation_th: "25,000 × 7% = 1,750 บาท",
          proposed_calculation: {
            formula_description_th: "25,000 × 7%",
            tax_base_thb: 25000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 25000,
            rate_pct: 7,
            computed_tax_thb: 1750,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["25,000 × 7% = 1,750 บาท"],
          },
        },
        {
          ...swappedDraft.issues[1],
          issue_id: "WRONG_25K_OCT1",
          conclusion_th:
            "วันที่ 1 ตุลาคม 2569 ฐานภาษี 25,000 บาท ใช้ พ.ร.ฎ. (ฉบับที่ 807) อัตรารวมร้อยละ 7.0 ภาษีมูลค่าเพิ่ม 1,750 บาท รวม 3,500 บาท",
          application_explanation_th: "25,000 × 7% = 1,750 บาท",
          proposed_calculation: {
            formula_description_th: "25,000 × 7%",
            tax_base_thb: 25000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 25000,
            rate_pct: 7,
            computed_tax_thb: 1750,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["25,000 × 7% = 1,750 บาท"],
          },
        },
      ],
    };
    const resWrongSplit = await queryKnowledge(
      {
        question: DEF_C9_1_DISTINCT_LOTS_SAME_DAY,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      { store, llmMockInvokerForTesting: async () => wrongSplitSameTotal }
    );
    expect(resWrongSplit.claims.length).toBe(0);
    expect(resWrongSplit.status).toBe("REVIEW_REQUIRED");

    // T5c: Arbitrary sibling tax number injected into a single-portion issue (Lot C 10,000 -> 700 falsely claiming 1,400 as Lot C's own tax / sibling leak without verified sibling) MUST BE REJECTED!
    const siblingLeakDraft: GroundedLlmDraftResponse = {
      answer_status: "ANSWERED",
      overall_summary_th: "",
      case_facts_used: [],
      issues: [
        {
          issue_id: "LOT_C_SIBLING_LEAK",
          issue_title_th: "ล็อต C (มูลค่า 10,000 บาท) — วันที่ 1 ตุลาคม 2569",
          party_or_scope_th: "สินค้าล็อต C มูลค่า 10,000 บาท",
          conclusion_th:
            "ล็อต C มูลค่า 10,000 บาท เกิดความรับผิดวันที่ 1 ตุลาคม 2569 ใช้ พ.ร.ฎ. (ฉบับที่ 807) อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท (หรือ 1,400 บาท)",
          material_facts_relied_on: ["ล็อต C 10,000 บาท"],
          governing_passage_ids: [
            "psg.aa853373203223",
            "psg.1b1abb8e7e22df",
            "psg.rc8.rd807.sec_1_2",
            "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
            "psg.3d0eb5636faa0e",
          ],
          application_explanation_th: "ฐานภาษี 10,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท หรือ 1,400 บาท",
          authority_distinction_note_th: "",
          proposed_calculation: {
            formula_description_th: "10,000 × 7% = 700 บาท",
            tax_base_thb: 10000,
            exempt_amount_thb: 0,
            taxable_amount_thb: 10000,
            rate_pct: 7,
            computed_tax_thb: 700,
            is_computable_from_stated_facts: true,
            missing_inputs_th: [],
            steps_th: ["10,000 × 7% = 700 บาท"],
          },
          missing_facts_or_uncertainties_th: [],
        },
      ],
      assumptions_th: [],
      clarification_questions_th: [],
      evidence_gaps_th: [],
    };
    const resSiblingLeak = await queryKnowledge(
      {
        question: DEF_C9_1_DISTINCT_LOTS_SAME_DAY,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      { store, llmMockInvokerForTesting: async () => siblingLeakDraft }
    );
    expect(resSiblingLeak.claims.length).toBe(0);
  });

  it("T6 (Platform Track — Matter Attachment Isolation & Verifiable Corpus Fingerprint Fail-Closed): matter attachments never inflate 5,070/11,783 release eligibility, never leak across matters/reviewers without explicit attachment_doc_ids, and corpus integrity fails closed on mismatch", async () => {
    const beforeCounts = cte.computeBatchTraceabilityInventoryCounts(store, "B01", "rel.B01.rc8");
    expect(beforeCounts.documents.eligible).toBe(5070);
    expect(beforeCounts.passages.eligible).toBe(11783);

    // Simulate onboarding a verified official attachment (identical pattern to the 5 historical 2026-11-18 RD 779 records in Neon)
    const attached = onboardVerifiedOfficialAttachment(store, {
      release_id: "rel.B01.rc8",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_family: "gazette_enactment",
      source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) มาตรา 4 [cand10_iso_test]",
      original_title_th:
        "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566",
      official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-779-2566.pdf",
      publication_date: "2023-12-27",
      effective_from: "2024-01-01",
      effective_to: "2026-12-31",
      mime_type: "application/pdf",
      section_label: "มาตรา 4",
      physical_page_one_based: 3,
      printed_page_label: "๓",
      attachment_bytes_or_text:
        "ราชกิจจานุเบกษา เล่ม 140 ตอนที่ 77 ก พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ให้ยกเว้นภาษีเงินได้สำหรับเงินบริจาคให้แก่สถานศึกษาผ่านระบบอิเล็กทรอนิกส์",
      actor: TEST_ACTOR_A,
    });

    // 1. Release corpus counts MUST stay strictly 5,070 docs / 11,783 passages (never drift to 5,071 / 11,784!)
    const afterCounts = cte.computeBatchTraceabilityInventoryCounts(store, "B01", "rel.B01.rc8");
    expect(afterCounts.documents.eligible).toBe(5070);
    expect(afterCounts.passages.eligible).toBe(11783);

    // 2. Unattached query (empty attachment_doc_ids) MUST NOT intercept or cite the attachment for Actor B or Actor A!
    const unattachedCrossReviewer = cte.tryAnswerFromOnboardedCitationSources(store, {
      question:
        "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ยกเว้นภาษีอะไร",
      applicable_date: "2026-06-01",
      release_id: "rel.B01.rc8",
      actor: TEST_ACTOR_B,
      attachment_doc_ids: [],
    });
    expect(unattachedCrossReviewer).toBeNull();

    const unattachedSameReviewer = cte.tryAnswerFromOnboardedCitationSources(store, {
      question:
        "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ยกเว้นภาษีอะไร",
      applicable_date: "2026-06-01",
      release_id: "rel.B01.rc8",
      actor: TEST_ACTOR_A,
      attachment_doc_ids: [],
    });
    expect(unattachedSameReviewer).toBeNull();

    // 3. Cross-tenant explicit reference by Actor B MUST be denied, while owning Actor A with explicit attachment_doc_ids succeeds
    const crossTenantExplicit = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "มาตรา 4 ยกเว้นภาษีอะไร",
      applicable_date: "2026-06-01",
      release_id: "rel.B01.rc8",
      actor: TEST_ACTOR_B,
      attachment_doc_ids: [attached.doc.doc_id],
    });
    expect(crossTenantExplicit?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(crossTenantExplicit?.claims.length).toBe(0);

    const ownerExplicit = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "มาตรา 4 ยกเว้นภาษีอะไร",
      applicable_date: "2026-06-01",
      release_id: "rel.B01.rc8",
      actor: TEST_ACTOR_A,
      attachment_doc_ids: [attached.doc.doc_id],
    });
    expect(ownerExplicit?.status).toBe("ANSWERED");
    expect(ownerExplicit?.claims.length).toBeGreaterThan(0);

    // 4. Live verifiable corpus fingerprint check exists, verifies clean pinned corpus, and FAILS CLOSED on drift!
    const verifyFn = (cte as Record<string, unknown>).verifyPinnedReleaseCorpusIntegrity as
      | ((s: DurableKnowledgeStore, relId: string, opts?: { enforceFailClosed?: boolean }) => {
          ok: boolean;
          eligible_official_documents: number;
          eligible_evidence_passages: number;
          eligible_corpus_fingerprint_sha256: string;
          isolated_matter_attachment_documents: number;
          isolated_matter_attachment_passages: number;
        })
      | undefined;
    expect(typeof verifyFn).toBe("function");
    const cleanIntegrity = verifyFn!(store, "rel.B01.rc8", { enforceFailClosed: true });
    expect(cleanIntegrity.ok).toBe(true);
    expect(cleanIntegrity.eligible_official_documents).toBe(5070);
    expect(cleanIntegrity.eligible_evidence_passages).toBe(11783);
    expect(cleanIntegrity.isolated_matter_attachment_documents).toBeGreaterThanOrEqual(1);
    expect(cleanIntegrity.eligible_corpus_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);

    // 5. Fail-closed verification: injecting an unauthorized non-attachment release doc MUST throw CORPUS_PIN_MISMATCH_500!
    const driftTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-ft1-cand10-drift-"));
    try {
      fs.cpSync(STAGING_STORE_SRC, driftTmpDir, { recursive: true });
      const driftStore = new DurableKnowledgeStore(driftTmpDir);
      cte.mutateCitationLedgerAtomically(driftStore, "TEST_INJECT_DRIFT", TEST_ACTOR_A.actor_id, (ledger) => {
        ledger.documents["odoc.unauthorized_drift_test"] = {
          doc_id: "odoc.unauthorized_drift_test",
          source_family: "gazette_enactment",
          issuer_id: "reg.th.soc_ratchakitcha",
          source_native_id: "DRIFT-999",
          reviewed_surrogate_id: null,
          is_reviewed_surrogate: false,
          original_title_th: "เอกสารจำลองทดสอบการเบี่ยงเบนของคลัง",
          language: "th",
          record_type: "full_record",
          access_permission: "public",
          preservation_permission: "retained_artifact_permitted",
          access_scope: "scope.platform.public",
          access_conditions_th: null,
          eligible_for_citation: true,
          ineligible_reason: null,
          canonical_work_id: null,
          owner_batch_id: "B01",
          created_at: new Date().toISOString(),
        };
      });
      expect(() =>
        verifyFn!(driftStore, "rel.B01.rc8", { enforceFailClosed: true })
      ).toThrow(/CORPUS_PIN_MISMATCH_500/);
    } finally {
      if (fs.existsSync(driftTmpDir)) fs.rmSync(driftTmpDir, { recursive: true, force: true });
    }
  });

  it("T7 (Fresh wording variant — ชุดที่ 1/2/3 distinct sets): allocates Set 1 (title 30 Sep, ฿20k) + Set 2 (payment/invoice 30 Sep, ฿20k) = ฿40k RD 799 (VAT ฿2,800) and Set 3 (delivery 1 Oct, ฿10k) = ฿10k RD 807 (VAT ฿700)", () => {
    const freshWordingQ =
      "บริษัท ทดสอบนกกระจิบ จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในประเทศราคารวม 50,000 บาท (ก่อนภาษีมูลค่าเพิ่ม) แบ่งสินค้าเป็น ชุดที่ 1 ราคา 20,000 บาท ชุดที่ 2 ราคา 20,000 บาท และชุดที่ 3 ราคา 10,000 บาท เมื่อวันที่ 30 กันยายน 2569 บริษัทโอนกรรมสิทธิ์สินค้าชุดที่ 1 ให้ลูกค้า และในวันเดียวกัน (30 กันยายน 2569) ได้รับชำระราคาพร้อมออกใบกำกับภาษีสำหรับชุดที่ 2 โดยเฉพาะ ส่วนชุดที่ 3 ไม่มีการโอนกรรมสิทธิ์ ชำระเงิน หรือออกใบกำกับภาษีก่อน โดยส่งมอบสินค้าทั้ง 3 ชุดวันที่ 1 ตุลาคม 2569 วันเกิดความรับผิดแต่ละส่วนคือวันใด ใช้ พ.ร.ฎ. ฉบับใด และคิดภาษีมูลค่าเพิ่มเท่าใด";
    const ledger = buildStructuredCaseFactLedger({ question: freshWordingQ, applicableDate: null });
    expect(ledger.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
    const alloc = ledger.temporal_facts.vat_portion_allocation_record;
    expect(alloc?.allocation_status).toBe("RESOLVED");
    expect(alloc?.tax_date_buckets.length).toBe(2);
    expect(alloc?.tax_date_buckets[0]).toMatchObject({
      iso_date: "2026-09-30",
      amount_thb: 40000,
      verified_vat_thb: 2800,
      decree_window: "RD_799",
    });
    expect(alloc?.tax_date_buckets[1]).toMatchObject({
      iso_date: "2026-10-01",
      amount_thb: 10000,
      verified_vat_thb: 700,
      decree_window: "RD_807",
    });
  });

  it("T8 (Reopen -> Changed-Lot Follow-Up + Unchanged Save No-Op + Parent Mismatch Rejection): reassigning 30 Sep payment/invoice from Lot A to Lot B recomputes r2 to ฿40k RD 799 + ฿10k RD 807 while keeping r1 intact", async () => {
    // Turn 1: DEF-C9-2 (Lot A title 29 Sep + Lot A payment/invoice 30 Sep -> 20k @ 29 Sep + 30k @ 1 Oct)
    const t2FollowUpQ =
      "ขอแก้ข้อเท็จจริง: การรับชำระราคาและออกใบกำกับภาษีเมื่อวันที่ 30 กันยายน 2569 เป็นของล็อต B โดยเฉพาะ ไม่ใช่ล็อต A ข้อเท็จจริงอื่นเหมือนเดิม วันเกิดความรับผิดของแต่ละส่วนเปลี่ยนไปอย่างไร";
    const t2Ledger = buildStructuredCaseFactLedger({
      question: t2FollowUpQ,
      applicableDate: null,
      conversationHistory: [
        { role: "user", content: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS },
        { role: "assistant", content: "คำตอบรอบแรก" },
      ],
    });
    const alloc = t2Ledger.temporal_facts.vat_portion_allocation_record;
    expect(t2Ledger.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
    expect(alloc?.allocation_status).toBe("RESOLVED");
    // Now Lot A = 29 Sep (20k, RD 799, VAT 1,400), Lot B = 30 Sep (20k, RD 799, VAT 1,400), Lot C = 1 Oct (10k, RD 807, VAT 700)!
    expect(alloc?.tax_date_buckets.map((b) => `${b.iso_date}:${b.amount_thb}:${b.decree_window}`)).toEqual([
      "2026-09-29:20000:RD_799",
      "2026-09-30:20000:RD_799",
      "2026-10-01:10000:RD_807",
    ]);
    expect(alloc?.reconciled_total_base_thb).toBe(50000);
    expect(alloc?.reconciled_total_vat_thb).toBe(3500);

    // Verify end-to-end Generate -> Save r1 -> unchanged duplicate Save no-op -> Reopen r1 -> Follow-up Save r2 -> Reopen r1 unchanged -> Stale parent rejected
    const r1Res = await queryKnowledge(
      {
        question: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
      },
      TEST_ACTOR_A,
      {
        store,
        llmMockInvokerForTesting: async () => ({
          answer_status: "ANSWERED",
          overall_summary_th: "ล็อต A 20,000 (29 ก.ย., VAT 1,400) และล็อต B+C 30,000 (1 ต.ค., VAT 2,100)",
          case_facts_used: [],
          issues: [
            {
              issue_id: "T8_R1_LOT_A",
              issue_title_th: "ล็อต A (20,000 บาท) — วันที่ 29 กันยายน 2569",
              party_or_scope_th: "สินค้าล็อต A มูลค่า 20,000 บาท",
              conclusion_th:
                "ล็อต A เกิดความรับผิดครั้งเดียววันที่ 29 กันยายน 2569 ใช้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
              material_facts_relied_on: ["ล็อต A 20,000 บาท วันที่ 29 กันยายน 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd799.sec_1_2",
                "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th: "ฐานภาษี 20,000 บาท อัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
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
          ],
          assumptions_th: [],
          clarification_questions_th: [],
          evidence_gaps_th: [],
        }),
      }
    );
    expect(r1Res.status).toBe("ANSWERED");
    const r1Save = await cte.saveOrReviseAnswerServerVerified(store, {
      actor: TEST_ACTOR_A,
      question_text: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS,
      save_operation_key: "op.cand10.t8.r1",
      submitted_envelope: r1Res.traceable_answer!,
      grounded_answer_snapshot: r1Res,
    });
    expect(r1Save.revision_number).toBe(1);
    expect(r1Save.answer_revision).toMatch(/\.r1$/);

    // Unchanged duplicate Save MUST return idempotent_replay without creating .r2
    const dupSave = await cte.saveOrReviseAnswerServerVerified(store, {
      actor: TEST_ACTOR_A,
      question_text: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS,
      parent_answer_revision: r1Save.answer_revision,
      save_operation_key: "op.cand10.t8.r1.dup",
      submitted_envelope: r1Res.traceable_answer!,
      grounded_answer_snapshot: r1Res,
    });
    expect(dupSave.answer_revision).toBe(r1Save.answer_revision);
    expect(dupSave.revision_number).toBe(1);
    expect((dupSave as { __idempotent_replay?: boolean }).__idempotent_replay).toBe(true);

    // Genuine Turn 2 follow-up creates .r2 in the SAME matter while leaving .r1 intact
    const r2Res = await queryKnowledge(
      {
        question: t2FollowUpQ,
        applicable_date: null,
        release_id: "rel.B01.rc8",
        answer_generation_mode: "llm_grounded",
        conversation_history: [
          { role: "user", content: DEF_C9_2_SAME_LOT_DIFFERENT_DAYS },
          { role: "assistant", content: r1Res.answer },
        ],
      },
      TEST_ACTOR_A,
      {
        store,
        llmMockInvokerForTesting: async () => ({
          answer_status: "ANSWERED",
          overall_summary_th:
            "เมื่อเปลี่ยนวันที่ 30 ก.ย. เป็นของล็อต B: ล็อต A 20,000 (29 ก.ย., พ.ร.ฎ. 799, VAT 1,400), ล็อต B 20,000 (30 ก.ย., พ.ร.ฎ. 799, VAT 1,400), ล็อต C 10,000 (1 ต.ค., พ.ร.ฎ. 807, VAT 700)",
          case_facts_used: [],
          issues: [
            {
              issue_id: "T8_R2_LOT_B",
              issue_title_th: "ล็อต B (20,000 บาท) — รับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569",
              party_or_scope_th: "สินค้าล็อต B มูลค่า 20,000 บาท",
              conclusion_th:
                "เมื่อแก้ไขข้อเท็จจริงให้การรับชำระราคาและออกใบกำกับภาษีวันที่ 30 กันยายน 2569 เป็นของล็อต B ล็อต B จึงเกิดความรับผิดวันที่ 30 กันยายน 2569 ใช้ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
              material_facts_relied_on: ["ล็อต B 20,000 บาท วันที่ 30 กันยายน 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd799.sec_1_2",
                "psg.rc8.rd799.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th: "ฐานภาษี 20,000 บาท อัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 1,400 บาท",
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
              issue_id: "T8_R2_LOT_C",
              issue_title_th: "ล็อต C (10,000 บาท) — ส่งมอบวันที่ 1 ตุลาคม 2569",
              party_or_scope_th: "สินค้าล็อต C มูลค่า 10,000 บาท",
              conclusion_th:
                "ล็อต C มูลค่า 10,000 บาท เกิดความรับผิดเมื่อส่งมอบวันที่ 1 ตุลาคม 2569 ใช้ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท",
              material_facts_relied_on: ["ล็อต C 10,000 บาท วันที่ 1 ตุลาคม 2569"],
              governing_passage_ids: [
                "psg.aa853373203223",
                "psg.1b1abb8e7e22df",
                "psg.rc8.rd807.sec_1_2",
                "psg.rc8.rd807.sec_3_quoted_rd646_sec_4",
                "psg.3d0eb5636faa0e",
              ],
              application_explanation_th: "ฐานภาษี 10,000 บาท อัตราร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 700 บาท",
              authority_distinction_note_th: "",
              proposed_calculation: {
                formula_description_th: "10,000 × 7%",
                tax_base_thb: 10000,
                exempt_amount_thb: 0,
                taxable_amount_thb: 10000,
                rate_pct: 7,
                computed_tax_thb: 700,
                is_computable_from_stated_facts: true,
                missing_inputs_th: [],
                steps_th: ["10,000 × 7% = 700 บาท"],
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
    expect(r2Res.status).toBe("ANSWERED");
    const r2Save = await cte.saveOrReviseAnswerServerVerified(store, {
      actor: TEST_ACTOR_A,
      question_text: t2FollowUpQ,
      parent_answer_revision: r1Save.answer_revision,
      save_operation_key: "op.cand10.t8.r2",
      submitted_envelope: { ...r2Res.traceable_answer!, answer_id: r1Save.answer_id },
      grounded_answer_snapshot: r2Res,
    });
    expect(r2Save.revision_number).toBe(2);
    expect(r2Save.answer_revision).toMatch(/\.r2$/);

    // Exact Reopen of r1 MUST remain completely intact
    const reopenedR1 = cte.reopenSavedTraceableAnswer(store, r1Save.answer_revision, TEST_ACTOR_A);
    expect(reopenedR1.found).toBe(true);
    expect(reopenedR1.answer?.rendered_answer_th).toContain("29 กันยายน 2569");
    expect(reopenedR1.answer?.rendered_answer_th).not.toContain("ล็อต B (20,000 บาท)");

    // Stale parent mismatch (attempting to save a DIFFERENT edit against stale .r1 after .r2 exists) MUST be rejected!
    const staleEnvelope = {
      ...r2Res.traceable_answer!,
      answer_id: r1Save.answer_id,
      rendered_answer_th: `${r2Res.traceable_answer!.rendered_answer_th} (แก้ไขซ้อนบนรุ่นเดิม)`,
    };
    await expect(
      cte.saveOrReviseAnswerServerVerified(store, {
        actor: TEST_ACTOR_A,
        question_text: "แก้ไขซ้อนบน r1 ที่ล้าสมัยแล้ว",
        parent_answer_revision: r1Save.answer_revision,
        save_operation_key: "op.cand10.t8.stale_parent",
        submitted_envelope: staleEnvelope,
        grounded_answer_snapshot: r2Res,
      })
    ).rejects.toThrow(/REVISION_CONFLICT|409|CONFLICT|stale|superseded/i);
  });
});
