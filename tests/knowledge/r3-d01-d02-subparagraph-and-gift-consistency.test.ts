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
  // R3-D02: Gift Tax Donor vs Recipient Separation & Kinship Branch Consistency
  // =========================================================================
  describe("R3-D02: Gift Tax Donor/Recipient Separation & Standalone vs Follow-Up Consistency", () => {
    const B1_09_TURN_1 =
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ";

    it("handles explicit collateral niece (บุตรของพี่หรือน้อง) standalone with strict Donor vs Recipient separation", async () => {
      const res = await queryKnowledge(
        {
          question:
            "นายสมชายโอนที่ดินมูลค่า 25,000,000 บาท โดยไม่มีค่าตอบแทนให้แก่หลานสาวซึ่งเป็นบุตรของพี่ชาย เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของผู้โอนและผู้รับโอนเป็นอย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("ฝั่งผู้โอน");
      expect(rendered).toContain("ฝั่งผู้รับโอน");
      expect(rendered).toContain("มาตรา 42 (28)");
      expect(rendered).toContain("10,000,000");
      expect(rendered).toContain("15,000,000");
      expect(rendered).not.toContain("ไม่อาจสรุปตายตัว");
    });

    it("handles explicit lineal granddaughter (บุตรของบุตร / หลานปู่หลานตา) standalone with strict Donor vs Recipient separation", async () => {
      const res = await queryKnowledge(
        {
          question:
            "นายสมชายโอนที่ดินมูลค่า 25,000,000 บาท โดยไม่มีค่าตอบแทนให้แก่หลานสาวซึ่งเป็นบุตรของบุตร (หลานปู่) เมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของผู้โอนและผู้รับโอนเป็นอย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      expect(res.status).toBe("ANSWERED");
      const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
      expect(rendered).toContain("ฝั่งผู้โอน");
      expect(rendered).toContain("ฝั่งผู้รับโอน");
      expect(rendered).toContain("มาตรา 42 (27)");
      expect(rendered).toContain("20,000,000");
      expect(rendered).toContain("5,000,000");
      expect(rendered).not.toContain("ไม่อาจสรุปตายตัว");
    });

    it("handles explicit niece as a follow-up from B1-09, replacing legitimate-child rule while carrying forward 25,000,000 baht", async () => {
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
      expect(rendered).toContain("มาตรา 42 (28)");
      expect(rendered).toContain("10,000,000");
      expect(rendered).toContain("15,000,000");
      // 10,000,000 exempt + 15,000,000 taxable excess proves 25,000,000 baht carried forward from B1-09
      expect(rendered).toContain("750,000");
      // Must NOT silently carry forward the legitimate-child exemption conclusion
      expect(rendered).toContain("ไม่ได้รับสิทธิยกเว้น");
      expect(rendered).toContain("มาตรา 42 (26)");
    });

    it("handles explicit granddaughter as a follow-up from B1-09, replacing legitimate-child rule while carrying forward 25,000,000 baht", async () => {
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
      expect(rendered).toContain("มาตรา 42 (27)");
      expect(rendered).toContain("20,000,000");
      expect(rendered).toContain("5,000,000");
      expect(rendered).toContain("ไม่ได้รับสิทธิยกเว้น");
      expect(rendered).toContain("มาตรา 42 (26)");
    });

    it("handles ambiguous 'หลานสาว' both standalone and as B1-09F follow-up with consistent conditional headline, Donor/Recipient separation, and one resolving kinship question", async () => {
      const standaloneRes = await queryKnowledge(
        {
          question:
            "นายสมชายโอนที่ดินมูลค่า 25,000,000 บาท โดยไม่มีค่าตอบแทนให้แก่หลานสาว เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของผู้โอนและหลานสาวเป็นอย่างไร",
          applicable_date: "2025-02-10",
          enable_tax_foundation_pilot: false,
        },
        TEST_ACTOR,
        { store, persistAnswerAtomically: false }
      );

      const followUpRes = await queryKnowledge(
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

      for (const res of [standaloneRes, followUpRes]) {
        expect(res.status).toBe("ANSWERED");
        const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
        // Consistent conditional headline — no "cannot conclude" contradiction
        expect(rendered).not.toContain("ไม่อาจสรุปตายตัว");
        expect(rendered).toContain("แยกเป็นฝั่งผู้โอนและฝั่งผู้รับโอนตามเงื่อนไขความสัมพันธ์");
        // Strict Donor vs Recipient separation
        expect(rendered).toContain("ฝั่งผู้โอน");
        expect(rendered).toContain("ฝั่งผู้รับโอน");
        expect(rendered).toContain("ไม่ได้รับสิทธิยกเว้น");
        // Both conditional branches clearly stated with consistent math
        expect(rendered).toContain("มาตรา 42 (27)");
        expect(rendered).toContain("20,000,000");
        expect(rendered).toContain("5,000,000");
        expect(rendered).toContain("มาตรา 42 (28)");
        expect(rendered).toContain("10,000,000");
        expect(rendered).toContain("15,000,000");
        // Explicitly identifies the single decisive fact needed to resolve the branch
        expect(rendered).toContain("ข้อเท็จจริงชี้ขาด");
      }
    });
  });
});
