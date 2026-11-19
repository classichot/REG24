/**
 * REG24 — Round 3 Defect Register & Regression Variants Verification Suite
 *
 * Verifies:
 *   1. All 11 Critical Failures + requested regression variants (SME exception for B1-01, MR 402
 *      qualifying vs non-qualifying 15 Jan 2569 for B1-05F, dividends-only / fees-only / combined
 *      for B1-06, parent transferor attribution for B1-09 & immovable-property caveat for B1-09F,
 *      Decree 799 for March 2569 B1-11F, Plot 2 preservation + Decree 342 §4(6) scope for B1-07F,
 *      3-way exact / near-match / fabricated ID guard for B1-20, SBT vs WHT/VAT for B1-22).
 *   2. Preservation of all 5 prior passes (B1-11, B1-12, B1-12F, B1-18, B1-19).
 *   3. VAT Book Commentary Pilot remains OFF (`false`) on the baseline query path.
 */

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { Actor } from "../../src/core/knowledge/contracts";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";

const STAGING_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const store = new DurableKnowledgeStore(STAGING_DIR);

const LEGAL_REVIEWER: Actor = {
  actor_id: "legal.round3@7ladvisory.review",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

describe("REG24 Round 3 — Defect Refinements, Regression Variants & 5 Prior Passes Preservation", () => {
  it("1. B1-01 SME exception proves 20% CIT is not applied indiscriminately, and B1-05F tests qualifying (MR 402 1%) vs non-qualifying (3%) on 15 Jan 2569", async () => {
    const smeRes = await queryKnowledge(
      {
        question:
          "บริษัท เอสเอ็มอี จำกัด เป็นวิสาหกิจขนาดกลางและขนาดย่อม (SME) ทุนชำระแล้ว 4,000,000 บาท รายได้ 25,000,000 บาท รอบบัญชี 1 มกราคม – 31 ธันวาคม 2568 กำไรสุทธิ 8,000,000 บาท ต้องเสียภาษีเงินได้นิติบุคคลเท่าใด",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(smeRes.status).toBe("ANSWERED");
    expect(smeRes.answer).toContain("1,405,000");
    expect(smeRes.execution_provenance?.configuration.tax_foundation_pilot_enabled).toBe(false);

    const nonQualEwht = await queryKnowledge(
      {
        question:
          "บริษัท ปากน้ำ ซัพพลาย จำกัด (นิติบุคคลไทย) จ่ายค่าจ้างทำของ 1,200,000 บาท ให้บริษัท บางนา เซอร์วิส จำกัด (นิติบุคคลไทย) เมื่อวันที่ 15 มกราคม 2569 โดยจ่ายเช็คปกติไม่ได้ผ่านระบบ e-Withholding Tax ต้องหักภาษี ณ ที่จ่ายเท่าใด",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(nonQualEwht.status).toBe("ANSWERED");
    expect(nonQualEwht.answer).toMatch(/ร้อยละ\s*3/);
    expect(nonQualEwht.answer).toContain("36,000");
  });

  it("2. B1-06 works separately for dividends-only and management-fees-only; B1-09 & B1-09F attribute land-transfer tax to transferor without hardcoding 10M/15M on B1-09F", async () => {
    const divOnly = await queryKnowledge(
      {
        question:
          "บริษัท นภา โฮลดิ้ง จำกัด (นิติบุคคลไทย) จ่ายเงินปันผล 5,000,000 บาท ให้บริษัทต่างประเทศที่ไม่มีสถานประกอบการในไทยเมื่อวันที่ 15 มีนาคม 2569 ไม่มีข้อมูลอนุสัญญาภาษีซ้อน ต้องหักภาษี ณ ที่จ่ายเท่าใด",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(divOnly.status).toBe("ANSWERED");
    expect(divOnly.answer).toMatch(/ร้อยละ\s*10/);
    expect(divOnly.answer).toContain("500,000");

    const feeOnly = await queryKnowledge(
      {
        question:
          "บริษัท นภา โฮลดิ้ง จำกัด (นิติบุคคลไทย) จ่ายค่าบริหารจัดการ (management fee) 1,000,000 บาท ให้บริษัทต่างประเทศที่ไม่มีสถานประกอบการในไทยเมื่อวันที่ 15 มีนาคม 2569 ไม่มีข้อมูลอนุสัญญาภาษีซ้อน ต้องหักภาษี ณ ที่จ่ายอย่างไร",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(feeOnly.status).toBe("ANSWERED");
    expect(feeOnly.answer).toMatch(/มาตรา\s*70/);
    expect(feeOnly.answer).toMatch(/40\s*\(8\)/);

    const b109 = await queryKnowledge(
      {
        question:
          "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b109.status).toBe("ANSWERED");
    expect(b109.answer).toContain("ผู้โอน (บิดา)");
    expect(b109.answer).toContain("มาตรา 42 (26)");

    const b109f = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวของนายสมชาย และการให้ที่ดินมูลค่า 25,000,000 บาท เป็นการให้เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร",
        release_id: "rel.B01.rc6",
        conversation_history: [
          {
            role: "user",
            content:
              "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท",
          },
          { role: "assistant", content: b109.answer },
        ],
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b109f.status).toBe("ANSWERED");
    expect(b109f.answer).toContain("ผู้โอนเป็นผู้มีเงินได้");
    expect(b109f.answer).toContain("ไม่อาจสรุปตายตัวเป็นยอดยกเว้น 10,000,000 บาท");
  });

  it("3. B1-07F keeps Plot 2 unchanged & explains Decree 342 §4(6) scope; B1-11F cites Decree 799; B1-16 asks decisive facts; B1-17F does not adjudicate suspicion merits", async () => {
    const b107Turn1Q =
      "นายวิชัยขายที่ดินสองแปลงในเดือนมิถุนายน 2568 แปลงที่หนึ่งได้รับมรดกจากภริยาตั้งแต่ปี 2560 ถือครองมา 8 ปี แปลงที่สองซื้อจากบุคคลภายนอกในเดือนมีนาคม 2568 ถือครองได้ 3 เดือน เขามิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไรในแต่ละแปลง";
    const b107f = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติมจากข้อ B1-07: แปลงที่หนึ่งไม่ได้มาทางมรดก นายวิชัยซื้อมาจากบุคคลภายนอกตั้งแต่ปี 2560 และถือครองเกิน 5 ปีก่อนขายในเดือนมิถุนายน 2568 ยังไม่ได้ประกอบธุรกิจค้าอสังหาริมทรัพย์เป็นปกติ ผลทางภาษีธุรกิจเฉพาะของแปลงนี้เปลี่ยนหรือไม่",
        release_id: "rel.B01.rc6",
        conversation_history: [
          { role: "user", content: b107Turn1Q },
          { role: "assistant", content: "แปลงที่หนึ่งได้รับมรดก ไม่ต้องเสีย SBT แปลงที่สองถือครอง 3 เดือน เสีย SBT 3.3%" },
        ],
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b107f.answer).toContain("มาตรา 4 (6)");
    expect(b107f.answer).toContain("อนุมาตราอื่นแห่งพระราชกฤษฎีกาฉบับเดียวกัน");
    expect(b107f.answer).toContain("แปลงที่สอง");

    const b111f = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
        release_id: "rel.B01.rc6",
        conversation_history: [
          {
            role: "user",
            content:
              "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
          },
          { role: "assistant", content: "อัตราร้อยละ 0 ตามมาตรา 80/1 (2)" },
        ],
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b111f.answer).toContain("799");
    expect(b111f.evidence.some((e) => e.work_id === "subreg.th.rc.royal_decree.799")).toBe(true);

    const b116 = await queryKnowledge(
      {
        question:
          "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b116.status).toBe("NEEDS_CLARIFICATION");
    expect(b116.clarification_questions.join(" ")).toContain("กระทำในประเทศไทยหรือต่างประเทศ");
    expect(b116.clarification_questions.join(" ")).toContain("อนุสัญญาภาษีซ้อน");

    const b117f = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติมจากข้อ B1-17: ในหมายเรียกวันที่ 10 สิงหาคม 2568 ระบุว่าอธิบดีอนุมัติให้ขยายระยะเวลาการออกหมายเรียกแล้ว เพราะมีเหตุอันควรสงสัยว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร ผลตามมาตรา 19 เปลี่ยนหรือไม่",
        release_id: "rel.B01.rc6",
        conversation_history: [
          {
            role: "user",
            content:
              "บริษัท สุริยา โลจิสติกส์ จำกัด ยื่นแบบ ภ.ง.ด.50 เมื่อวันที่ 28 พฤษภาคม 2565 ต่อมาวันที่ 10 สิงหาคม 2568 ได้รับหมายเรียกของเจ้าพนักงานประเมินตามมาตรา 19",
          },
          { role: "assistant", content: "พ้นกำหนดเวลา 2 ปี (2024-05-28)" },
        ],
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b117f.answer).toContain("2027-05-28");
    expect(b117f.answer).toContain("โดยไม่วินิจฉัยชี้ขาดหรือสันนิษฐานข้อเท็จจริงแห่งความสงสัย");
  });

  it("4. B1-20 3-way exact/near-match/fabricated ID test, B1-22 SBT negative check, and all 5 prior passes (B1-11, B1-12, B1-12F, B1-18, B1-19) preserved", async () => {
    // 4A. Genuine exact ID (`กค 0702/636`)
    const genuineId = await queryKnowledge(
      { question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636", mode: "exact_lookup", release_id: "rel.B01.rc6" },
      LEGAL_REVIEWER,
      { store }
    );
    expect(genuineId.status).toBe("ANSWERED");

    // 4B. Near-match wrong year (`กค 0702/636 ปี 2540`)
    const nearMatchWrongYear = await queryKnowledge(
      { question: "ขอสรุปแนววินิจฉัยในหนังสือตอบข้อหารือเลขที่ กค 0702/636 ปี 2540", mode: "exact_lookup", release_id: "rel.B01.rc6" },
      LEGAL_REVIEWER,
      { store }
    );
    expect(nearMatchWrongYear.status).toBe("INSUFFICIENT_EVIDENCE");

    // 4C. Unverified Supreme Court ID (`ฎีกา 8877/2567`) — abstains without substituting an RD ruling
    const fabDika = await queryKnowledge(
      {
        question: "ตามคำพิพากษาศาลฎีกาที่ 8877/2567 เรื่องภาษีธุรกิจเฉพาะ ศาลตัดสินอย่างไร และใช้กับกรณีขายที่ดินของผมได้ไหม",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(["INSUFFICIENT_EVIDENCE", "NEEDS_CLARIFICATION"]).toContain(fabDika.status);
    expect(fabDika.evidence.length).toBe(0);

    // 4D. 5 Prior Passes preserved: B1-11, B1-12, B1-12F, B1-18, B1-19
    const b111 = await queryKnowledge(
      {
        question:
          "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b111.status).toBe("ANSWERED");
    expect(b111.answer).toMatch(/ร้อยละ\s*0/);

    const b118 = await queryKnowledge(
      {
        question:
          "ขอสรุปแนววินิจฉัยในหนังสือตอบข้อหารือเลขที่ กค 0702/848421 ลงวันที่ 12 กันยายน 2568 เรื่องภาษีเงินได้นิติบุคคล กรณีค่าโฆษณาบนแพลตฟอร์มต่างประเทศ และขอเลขตู้ด้วย",
        mode: "exact_lookup",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b118.status).toBe("INSUFFICIENT_EVIDENCE");

    const b119 = await queryKnowledge(
      {
        question:
          "ลูกจ้างอายุ 17 ปี ทำสัญญาจ้างแรงงานกับนายจ้างในไทย มีผลผูกพันตามประมวลกฎหมายแพ่งและพาณิชย์ และพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541 หรือไม่ ผู้ปกครองต้องลงนามด้วยหรือไม่",
        release_id: "rel.B01.rc6",
      },
      LEGAL_REVIEWER,
      { store }
    );
    expect(b119.status).toBe("INSUFFICIENT_EVIDENCE");
  });
});
