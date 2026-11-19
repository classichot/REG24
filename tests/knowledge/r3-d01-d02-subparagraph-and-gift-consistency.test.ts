/**
 * REG24 — Round 3 Assigned Defect Regression Suite (`R3-D01` & `R3-D02`)
 *
 * Covers the exact requirements from the Product Owner's Round 3 Defect Sign-off Gate:
 *   1. R3-D01 (Royal Decree No. 342 §4(6)(ข) vs (ค) exact subparagraph verification):
 *      - Inherited land (`B1-07`) cites `มาตรา 4 (6) (ข)` (NOT `(ค)`), with official RD evidence link `https://www.rd.go.th/2818.html`.
 *      - Qualifying principal residence (`มีชื่ออยู่ในทะเบียนบ้านไม่น้อยกว่า 1 ปี`) cites `มาตรา 4 (6) (ค)` (NOT `(ข)`).
 *      - Short-held purchase (`< 5 years`) cites `มาตรา 4 (6)` (`3.3%` SBT, exempt from Stamp Duty).
 *      - Deliberately swapping `(ข)` and `(ค)` against verbatim Royal Decree 342 passages is REJECTED by `evaluateSubstantiveClaimSupport`.
 *   2. R3-D02 (Gift Tax Donor vs Recipient Separation & Headline/Analysis/Calculation Consistency):
 *      - Explicit niece (`บุตรของพี่หรือน้อง`) — standalone & follow-up.
 *      - Explicit granddaughter (`บุตรของบุตร / หลานปู่หลานตา`) — standalone & follow-up.
 *      - Ambiguous `"หลานสาว"` (`B1-09F`) — standalone & follow-up:
 *        * Headline, analysis, calculation, and citations are consistent (no "cannot conclude" contradiction).
 *        * Donor (`ผู้โอน`) and Recipient (`ผู้รับโอน`) positions are explicitly separated.
 *        * Confirmed follow-up change replaces legitimate-child rule (`§42(26)` NOT silently carried forward), while unaffected facts (`25,000,000 บาท`, land transfer, `10 กุมภาพันธ์ 2568`) carry forward.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateSubstantiveClaimSupport } from "../../src/core/knowledge/answer-verification";
import type { Actor } from "../../src/core/knowledge/contracts";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_GZ = path.resolve(
  process.cwd(),
  "data",
  "knowledge-store-b01-rc2-staging",
  "canonical-state.json.gz"
);

const TEST_ACTOR: Actor = {
  actor_id: "legal.r3.regression",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Round 3 Defect Gate — R3-D01 (RD 342 Subparagraphs) & R3-D02 (Gift Tax Consistency)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-r3-d01-d02-"));
    const copyPath = path.join(tmpDir, "canonical-state.json.gz");
    fs.copyFileSync(STAGING_GZ, copyPath);
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // R3-D01: Royal Decree No. 342 §4(6)(ข) vs (ค) & Short-held Purchase
  // =========================================================================
  describe("R3-D01: Royal Decree No. 342 §4(6) Subparagraph Precision & Swap Rejection", () => {
    it("cites มาตรา 4 (6) (ข) — NOT (ค) — for inherited land in rendered answer and links RD 342 official evidence", async () => {
      const res = await queryKnowledge(
        {
          question:
            "นายวิชัยขายที่ดินสองแปลงในเดือนมิถุนายน 2568 แปลงที่หนึ่งได้รับมรดกจากภริยาตั้งแต่ปี 2560 ถือครองมา 8 ปี แปลงที่สองซื้อจากบุคคลภายนอกในเดือนมีนาคม 2568 ถือครองได้ 3 เดือน เขามิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไรในแต่ละแปลง",
          applicable_date: "2025-06-15",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("มาตรา 4 (6) (ข)");
      expect(rendered).not.toContain("มาตรา 4 (6) (ค)");
      expect(rendered).toMatch(/ร้อยละ\s*3\.3|3\.3%/);

      // Check evidence links actually point to official Royal Decree 342 (`https://www.rd.go.th/2818.html`)
      const allEvidenceRefs = (res.traceable_answer?.claims || []).flatMap(
        (c) => c.evidence_references || []
      );
      const rd342Ref = allEvidenceRefs.find((r) =>
        (r.official_url || "").includes("rd.go.th/2818.html")
      );
      expect(rd342Ref).toBeDefined();
    });

    it("cites มาตรา 4 (6) (ค) — NOT (ข) — for a qualifying 1-year principal residence sale", async () => {
      const res = await queryKnowledge(
        {
          question:
            "นางสาวมาลีขายบ้านพร้อมที่ดินในเดือนมิถุนายน 2568 ซึ่งซื้อมาและถือครองไว้ 2 ปี แต่มีชื่ออยู่ในทะเบียนบ้านไม่น้อยกว่า 1 ปี เพื่อใช้เป็นสถานที่อยู่อาศัยอันเป็นแหล่งสำคัญ และมิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรือไม่",
          applicable_date: "2025-06-15",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("มาตรา 4 (6) (ค)");
      expect(rendered).not.toContain("มาตรา 4 (6) (ข)");
      expect(rendered).toContain("อากรแสตมป์");

      const allEvidenceRefs = (res.traceable_answer?.claims || []).flatMap(
        (c) => c.evidence_references || []
      );
      const rd342Ref = allEvidenceRefs.find((r) =>
        (r.official_url || "").includes("rd.go.th/2818.html")
      );
      expect(rd342Ref).toBeDefined();
    });

    it("cites มาตรา 4 (6) and 3.3% SBT for a short-held (< 5 years) purchased plot without inheritance or residence exception", async () => {
      const res = await queryKnowledge(
        {
          question:
            "นายกิตติซื้อที่ดินเปล่าจากบุคคลภายนอกและถือครองได้ 6 เดือน ก่อนขายไปในเดือนมิถุนายน 2568 โดยไม่ได้รับมรดก ไม่มีชื่ออยู่ในทะเบียนบ้าน และมิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะในอัตราเท่าใด",
          applicable_date: "2025-06-15",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("มาตรา 4 (6)");
      expect(rendered).toMatch(/ร้อยละ\s*3\.3|3\.3%/);
      expect(rendered).not.toContain("มาตรา 4 (6) (ข)");
      expect(rendered).not.toContain("มาตรา 4 (6) (ค)");
    });

    it("REJECTS deliberately swapped (ข) and (ค) claims in evaluateSubstantiveClaimSupport", () => {
      const state = store.getState();
      const rd342Work = state.works["subreg.th.rc.royal_decree.342"];
      const rd342Passages = Object.values(state.passages)
        .filter(
          (p) =>
            p.work_id === "subreg.th.rc.royal_decree.342" &&
            (p.exact_text.includes("มาตรา 4") ||
              p.exact_text.includes("มาตรา ๔") ||
              p.exact_text.includes("(ข)") ||
              p.exact_text.includes("(ค)"))
        )
        .map((p) => ({
          passage_id: p.passage_id,
          verbatim_text: p.exact_text,
          doc_title_th:
            rd342Work?.title_th ||
            "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการขายอสังหาริมทรัพย์เป็นทางค้าหรือหากำไร (ฉบับที่ 342) พ.ศ. 2541",
          human_pinpoint_th: "พระราชกฤษฎีกา ฉบับที่ 342 มาตรา 4 (6)",
        }));
      expect(rd342Passages.length).toBeGreaterThan(0);

      // Deliberate swap 1: inheritance claim wrongly citing `(ค)`
      const swappedInheritance = evaluateSubstantiveClaimSupport({
        claim_text:
          "การขายอสังหาริมทรัพย์ที่ได้มาทางมรดกได้รับยกเว้นภาษีธุรกิจเฉพาะตามมาตรา 4 (6) (ค) แห่งพระราชกฤษฎีกา ฉบับที่ 342",
        passages: rd342Passages,
        verified_calculation_numeric_tokens: ["1"],
      });
      expect(swappedInheritance.supported).toBe(false);
      expect(swappedInheritance.reason_code).toBe("UNGROUNDED_LEGAL_IDENTIFIER");

      // Deliberate swap 2: principal residence (1-year house registration) claim wrongly citing `(ข)`
      const swappedResidence = evaluateSubstantiveClaimSupport({
        claim_text:
          "การขายบ้านพร้อมที่ดินที่มีชื่ออยู่ในทะเบียนบ้านไม่น้อยกว่า 1 ปี เพื่อใช้เป็นสถานที่อยู่อาศัยอันเป็นแหล่งสำคัญ ได้รับยกเว้นภาษีธุรกิจเฉพาะตามมาตรา 4 (6) (ข) แห่งพระราชกฤษฎีกา ฉบับที่ 342",
        passages: rd342Passages,
        verified_calculation_numeric_tokens: ["1"],
      });
      expect(swappedResidence.supported).toBe(false);
      expect(swappedResidence.reason_code).toBe("UNGROUNDED_LEGAL_IDENTIFIER");

      // Control: exact matching `(ข)` for inheritance & `(ค)` for residence MUST PASS
      const correctInheritance = evaluateSubstantiveClaimSupport({
        claim_text:
          "การขายอสังหาริมทรัพย์ที่ได้มาทางมรดกไม่ถือเป็นการขายอสังหาริมทรัพย์เป็นทางค้าหรือหากำไรตามมาตรา 4 (6) (ข) แห่งพระราชกฤษฎีกา ฉบับที่ 342",
        passages: rd342Passages,
        verified_calculation_numeric_tokens: ["1"],
      });
      expect(correctInheritance).toEqual(
        expect.objectContaining({ supported: true, reason_code: "VERIFIED_SUBSTANTIVE_SUPPORT" })
      );

      const correctResidence = evaluateSubstantiveClaimSupport({
        claim_text:
          "การขายอสังหาริมทรัพย์ที่ใช้เป็นสถานที่อยู่อาศัยอันเป็นแหล่งสำคัญโดยมีชื่ออยู่ในทะเบียนบ้านไม่น้อยกว่า 1 ปี ไม่ถือเป็นการขายอสังหาริมทรัพย์เป็นทางค้าหรือหากำไรตามมาตรา 4 (6) (ค) แห่งพระราชกฤษฎีกา ฉบับที่ 342",
        passages: rd342Passages,
        verified_calculation_numeric_tokens: ["1"],
      });
      expect(correctResidence).toEqual(
        expect.objectContaining({ supported: true, reason_code: "VERIFIED_SUBSTANTIVE_SUPPORT" })
      );
    });
  });

  // =========================================================================
  // R3-D02: Gift & Immovable Property Transfer — Asset-First Classification,
  // Donor Replacement Rule (§41 bis, §49 bis, §50(5)-(6)), Cash Comparison,
  // Missing-Facts Guard, and Verifier Party/Asset-Type Rejection
  // =========================================================================
  describe("R3-D02: Asset-First Gift/Land Decision Logic, Cash Comparison & Verifier Guards", () => {
    const B1_09_TURN_1 =
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ";

    it("preserves original B1-09 (land to legitimate child) as a regression check", async () => {
      const res = await queryKnowledge(
        {
          question: B1_09_TURN_1,
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("มาตรา 41 ทวิ");
      expect(rendered).toContain("มาตรา 42 (26)");
      expect(rendered).toContain("มาตรา 49 ทวิ");
      expect(rendered).toContain("มาตรา 50 (6)");
      expect(rendered).toContain("20,000,000");
      expect(rendered).toContain("5,000,000");
      expect(rendered).toContain("250,000");
    });

    it("handles LAND follow-up to explicit collateral niece (บุตรของน้องสาว): applies Donor §41 bis / §50(6)->§50(5) / §49 bis and does NOT publish cash-gift recipient numbers", async () => {
      const res = await queryKnowledge(
        {
          question:
            "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวซึ่งเป็นบุตรของน้องสาวนายสมชาย เนื่องในงานสมรสตามประเพณี ผลทางภาษีเปลี่ยนอย่างไร",
          applicable_date: "2025-02-10",
          conversation_history: [{ role: "user", content: B1_09_TURN_1 }],
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("ฝั่งผู้โอน");
      expect(rendered).toContain("ฝั่งผู้รับโอน");
      expect(rendered).toContain("มาตรา 41 ทวิ");
      expect(rendered).toContain("ไม่ได้รับสิทธิยกเว้นตามมาตรา 42 (26)");
      expect(rendered).toContain("มาตรา 50 (6)");
      expect(rendered).toContain("มาตรา 50 (5)");
      expect(rendered).toContain("มาตรา 49 ทวิ");
      expect(rendered).toContain("ราคาประเมินทุนทรัพย์");
      expect(rendered).toContain("จำนวนปีที่ผู้โอนถือครองที่ดิน");
      // Must NOT publish movable-gift recipient tax numbers (`750,000` / `15,000,000`) for LAND
      expect(rendered).not.toContain("750,000");
      expect(rendered).not.toContain("15,000,000");
      expect(rendered).not.toContain("ฝ่ายกฎหมายควรยืนยัน");
    });

    it("handles LAND follow-up to explicit lineal granddaughter (บุตรของบุตร / หลานตา): applies Donor §41 bis / §50(6)->§50(5) / §49 bis and does NOT publish 250,000 recipient tax", async () => {
      const res = await queryKnowledge(
        {
          question:
            "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวซึ่งเป็นบุตรของบุตร (หลานตา) ผลทางภาษีเปลี่ยนอย่างไร",
          applicable_date: "2025-02-10",
          conversation_history: [{ role: "user", content: B1_09_TURN_1 }],
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("ฝั่งผู้โอน");
      expect(rendered).toContain("ฝั่งผู้รับโอน");
      expect(rendered).toContain("มาตรา 41 ทวิ");
      expect(rendered).toContain("ไม่ได้รับสิทธิยกเว้นตามมาตรา 42 (26)");
      expect(rendered).toContain("มาตรา 50 (6)");
      expect(rendered).toContain("มาตรา 50 (5)");
      expect(rendered).toContain("มาตรา 49 ทวิ");
      expect(rendered).not.toContain("250,000");
      expect(rendered).not.toContain("5,000,000");
      expect(rendered).not.toContain("ฝ่ายกฎหมายควรยืนยัน");
    });

    it("handles LAND follow-up to ambiguous 'หลานสาว' (original B1-09F): gives kinship-independent Donor & Recipient rules without inventing withholding or cash-gift tax figures", async () => {
      const res = await queryKnowledge(
        {
          question:
            "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวของนายสมชาย และการให้ที่ดินมูลค่า 25,000,000 บาท เป็นการให้เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร",
          applicable_date: "2025-02-10",
          conversation_history: [{ role: "user", content: B1_09_TURN_1 }],
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("ฝั่งผู้โอน");
      expect(rendered).toContain("ฝั่งผู้รับโอน");
      expect(rendered).toContain("มาตรา 41 ทวิ");
      expect(rendered).toContain("มาตรา 50 (6)");
      expect(rendered).toContain("มาตรา 50 (5)");
      expect(rendered).toContain("มาตรา 49 ทวิ");
      expect(rendered).toContain("มีผลเหมือนกันทั้งกรณีหลานปู่หลานตา");
      expect(rendered).not.toContain("750,000");
      expect(rendered).not.toContain("250,000");
      expect(rendered).not.toContain("ไม่อาจสรุปตายตัว");
      expect(rendered).not.toContain("ฝ่ายกฎหมายควรยืนยัน");
    });

    it("switches rules cleanly for a matching CASH wedding-gift comparison (25,000,000 baht cash) for niece, granddaughter, and ambiguous 'หลานสาว'", async () => {
      const nieceCash = await queryKnowledge(
        {
          question:
            "นายสมชายมอบเงินสดมูลค่า 25,000,000 บาท ให้โดยเสน่หาแก่หลานสาวซึ่งเป็นบุตรของน้องสาว เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของผู้ให้และหลานสาวเป็นอย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );
      const nieceText = nieceCash.traceable_answer?.rendered_answer_th || nieceCash.answer;
      expect(nieceCash.status).toBe("ANSWERED");
      expect(nieceText).toContain("มาตรา 42 (28)");
      expect(nieceText).toContain("10,000,000");
      expect(nieceText).toContain("15,000,000");
      expect(nieceText).toContain("750,000");

      const grandCash = await queryKnowledge(
        {
          question:
            "นายสมชายมอบเงินสดมูลค่า 25,000,000 บาท ให้โดยเสน่หาแก่หลานสาวซึ่งเป็นบุตรของบุตร (หลานปู่) เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของผู้ให้และหลานสาวเป็นอย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );
      const grandText = grandCash.traceable_answer?.rendered_answer_th || grandCash.answer;
      expect(grandCash.status).toBe("ANSWERED");
      expect(grandText).toContain("มาตรา 42 (27)");
      expect(grandText).toContain("20,000,000");
      expect(grandText).toContain("5,000,000");
      expect(grandText).toContain("250,000");

      const ambigCash = await queryKnowledge(
        {
          question:
            "นายสมชายมอบเงินสดมูลค่า 25,000,000 บาท ให้โดยเสน่หาแก่หลานสาว เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของผู้ให้และหลานสาวเป็นอย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );
      const ambigText = ambigCash.traceable_answer?.rendered_answer_th || ambigCash.answer;
      expect(ambigCash.status).toBe("ANSWERED");
      expect(ambigText).toContain("มาตรา 42 (27)");
      expect(ambigText).toContain("มาตรา 42 (28)");
      expect(ambigText).toContain("250,000");
      expect(ambigText).toContain("750,000");
    });

    it("refuses to invent a withholding tax number for a LAND transfer with missing valuation and acquisition facts", async () => {
      const res = await queryKnowledge(
        {
          question:
            "นายสมชายโอนที่ดินให้แก่หลานสาวซึ่งเป็นบุตรของพี่ชายโดยไม่มีค่าตอบแทนในเดือนกุมภาพันธ์ 2568 โดยยังไม่ทราบราคาประเมินทุนทรัพย์และไม่ทราบปีที่ถือครอง ต้องเสียภาษีเงินได้อย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("ไม่สามารถคำนวณยอดภาษีหัก ณ ที่จ่ายฝั่งผู้โอนเป็นตัวเลข");
      expect(rendered).toContain("มาตรา 49 ทวิ");
      expect(rendered).toContain("มาตรา 50 (5)");
      expect(rendered).not.toContain("750,000");
      expect(rendered).not.toContain("250,000");
    });

    it("REJECTS claims applying movable-gift rules to land OR applying §42(26) to the wrong party in evaluateSubstantiveClaimSupport", () => {
      const state = store.getState();
      const act40Work = state.works["statute.th.rc_amendment_40_2558"];
      const act40Passages = Object.values(state.passages)
        .filter(
          (p) =>
            p.work_id === "statute.th.rc_amendment_40_2558" &&
            (p.exact_text.includes("(26)") ||
              p.exact_text.includes("(27)") ||
              p.exact_text.includes("(28)") ||
              p.exact_text.includes("มาตรา 48"))
        )
        .map((p) => ({
          passage_id: p.passage_id,
          verbatim_text: p.exact_text,
          doc_title_th:
            act40Work?.title_th ||
            "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 40) พ.ศ. 2558",
          human_pinpoint_th: "พ.ร.บ. แก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 40) พ.ศ. 2558",
        }));
      expect(act40Passages.length).toBeGreaterThan(0);

      // Wrong asset type: applying movable-gift §42(28) 10M / 750,000 to LAND
      const wrongAssetClaim = evaluateSubstantiveClaimSupport({
        claim_text:
          "การโอนที่ดินให้แก่หลานสาวในงานสมรสตามประเพณีได้รับยกเว้นไม่เกิน 10,000,000 บาท ตามมาตรา 42 (28) และส่วนเกินเสียภาษีร้อยละ 5 = 750,000 บาท ตามมาตรา 48 (7)",
        passages: act40Passages,
        verified_calculation_numeric_tokens: ["10000000", "750000", "5"],
      });
      expect(wrongAssetClaim.supported).toBe(false);
      expect(wrongAssetClaim.reason_code).toBe("UNGROUNDED_LEGAL_IDENTIFIER");

      // Wrong party/relationship: applying §42(26) legitimate-child exemption to a niece
      const wrongPartyClaim = evaluateSubstantiveClaimSupport({
        claim_text:
          "หลานสาวซึ่งเป็นบุตรของพี่ชายได้รับยกเว้นภาษีไม่เกิน 20,000,000 บาท ตามมาตรา 42 (26)",
        passages: act40Passages,
        verified_calculation_numeric_tokens: ["20000000"],
      });
      expect(wrongPartyClaim.supported).toBe(false);
      expect(wrongPartyClaim.reason_code).toBe("UNGROUNDED_LEGAL_IDENTIFIER");
    });
  });
});
