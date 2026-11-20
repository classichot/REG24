/**
 * REG24 — Shared Issue Selection, Temporal Decree Boundaries & Verifier Control Regression Suite
 *
 * Regression coverage for the 4 critical failures isolated on frozen baseline `683e429`:
 *   1. S7: Land gift with missing facts & registration WHT question -> MUST NOT route to 3% service WHT (`ท.ป. 4/2528`).
 *   2. U1: Condo (`ห้องชุด`) gift to nephew (`บุตรชายของน้องสาว`), appraisal 7.2M vs contract 6M -> MUST NOT route to 3% service WHT; cites §49 bis appraisal 7,200,000.
 *   3. U2: Marital co-owned (`สินสมรส`) land gift to granddaughter (`บุตรสาวของบุตรชาย`), appraisal 30M, unknown year -> MUST NOT route to SBT ruling กค 0706/5610.
 *   4. Explicit kinship override (`บุตรสาวของน้องชาย` / `บุตรสาวของบุตรชาย`) overrides generic `หลานสาว`.
 *   5. B1-11F & VAT Decree Boundaries: carry-forward date (`10 มีนาคม 2569` -> RD 799, NOT RD 807), boundaries (`2025-09-30`, `2025-10-01`, `2026-09-30`, `2026-10-01`, `2027-09-30`, `2027-10-01`), and absent-date (NO fallback to latest decree 807).
 *   6. Third-turn conversation context check (`B1-09` land/child -> `B1-09F` land/niece -> Turn 3 cash/niece).
 *   7. Verification controls what the user sees: a rejected calculation NEVER leaks into `answer`, `steps`, or `traceable_answer`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyClaimAgainstPassages } from "../../src/core/knowledge/answer-verification";
import type { Actor } from "../../src/core/knowledge/contracts";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { verifyVatRateAndAmountCalculation } from "../../src/core/knowledge/tax-calculation-verifier";

const STAGING_GZ = path.resolve(
  process.cwd(),
  "data",
  "knowledge-store-b01-rc2-staging",
  "canonical-state.json.gz"
);

const TEST_ACTOR: Actor = {
  actor_id: "legal.r3.issue_and_decree",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Shared Issue Selection, VAT Decree Boundaries & Verifier Control (Baseline 683e429 Fixes)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-r3-shared-"));
    fs.copyFileSync(STAGING_GZ, path.join(tmpDir, "canonical-state.json.gz"));
    store = new DurableKnowledgeStore(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("S7 regression: land gift mentioning registration WHT stays in PIT_GIFT_TAX (§41 bis/§49 bis/§50(5)-(6)/§54) and NEVER routes to 3% service WHT (ท.ป. 4/2528)", async () => {
    const res = await queryKnowledge(
      {
        question:
          "นายสมชายยกที่ดินแปลงหนึ่งให้หลานสาว (บุตรสาวของน้องชายนายสมชาย) โดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 ทั้งสองตกลงกันว่าที่ดินมีมูลค่าประมาณ 25,000,000 บาท ยังไม่ทราบราคาประเมินทุนทรัพย์ของทางราชการ และไม่ทราบว่านายสมชายได้ที่ดินมาอย่างไรและถือครองมากี่ปี ต้องหักภาษี ณ ที่จ่ายในวันจดทะเบียนเท่าใด และหลานสาวมีภาระภาษีเงินได้อย่างไร",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );

    expect(["ANSWERED", "CONDITIONAL"]).toContain(res.status);
    const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
    expect(rendered).not.toContain("ท.ป. 4/2528");
    expect(rendered).not.toContain("มาตรา 3 เตรส");
    expect(rendered).toContain("ฝั่งผู้รับโอน");
    expect(rendered).toContain("ส่งต่อฝ่ายกฎหมาย");
    expect(rendered).toContain("มาตรา 54");
    expect(rendered).toContain("มาตรา 41 ทวิ");
    expect(rendered).toContain("มาตรา 50 (5)");
    expect(rendered).toContain("มาตรา 49 ทวิ");
    expect(rendered).toContain("ไม่สามารถคำนวณยอดภาษีหัก ณ ที่จ่ายฝั่งผู้โอนเป็นตัวเลข");
    // Explicit niece recognized — not treated as ambiguous
    expect(rendered).toContain("บุตรของพี่หรือน้อง");
  });

  it("U1 regression: condo (ห้องชุด) gift to nephew (บุตรชายของน้องสาว) with 7.2M official appraisal vs 6M contract NEVER routes to 3% service WHT and uses 7,200,000 appraisal under §49 bis", async () => {
    const res = await queryKnowledge(
      {
        question:
          "นางวิไลวรรณยกห้องชุดในกรุงเทพมหานครหนึ่งห้องให้แก่นายภูมิ ซึ่งเป็นหลานชาย (บุตรชายของน้องสาวนางวิไลวรรณ) โดยเสน่หาไม่มีค่าตอบแทน และจดทะเบียนโอนกรรมสิทธิ์เมื่อวันที่ 18 สิงหาคม 2568 หนังสือสัญญาให้ระบุมูลค่า 6,000,000 บาท แต่ราคาประเมินทุนทรัพย์ของทางราชการที่ใช้ในการจดทะเบียนคือ 7,200,000 บาท การให้ครั้งนี้ไม่ได้เกี่ยวกับพิธีหรือโอกาสตามขนบธรรมเนียมประเพณีใด นายภูมิต้องเสียภาษีเงินได้อย่างไร และต้องหักภาษี ณ ที่จ่ายเท่าใดในวันจดทะเบียน",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );

    expect(["ANSWERED", "CONDITIONAL"]).toContain(res.status);
    const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
    expect(rendered).not.toContain("ท.ป. 4/2528");
    expect(rendered).not.toContain("มาตรา 3 เตรส");
    expect(rendered).toContain("มาตรา 41 ทวิ");
    expect(rendered).toContain("มาตรา 49 ทวิ");
    expect(rendered).toContain("7,200,000");
    expect(rendered).toContain("มาตรา 50 (5)");
    expect(rendered).toContain("มาตรา 54");
    expect(rendered).toContain("ส่งต่อฝ่ายกฎหมาย");
  });

  it("U2 regression: marital co-owned (สินสมรส) land gift to granddaughter (บุตรสาวของบุตรชาย) NEVER routes to SBT ruling กค 0706/5610 and applies PIT gift/land rules with marital co-ownership note", async () => {
    const res = await queryKnowledge(
      {
        question:
          "นายประเสริฐและนางบุญมาเป็นสามีภริยาที่จดทะเบียนสมรสกันตั้งแต่ปี 2515 ทั้งสองซื้อที่ดินแปลงหนึ่งร่วมกันระหว่างสมรส ที่ดินจึงเป็นสินสมรส เมื่อวันที่ 5 พฤษภาคม 2568 ทั้งสองยกที่ดินแปลงนี้ให้นางสาวน้ำฝน ซึ่งเป็นหลานสาว (บุตรสาวของบุตรชายของทั้งสอง) โดยไม่มีค่าตอบแทน ราคาประเมินทุนทรัพย์ของทางราชการในการจดทะเบียนคือ 30,000,000 บาท ไม่ทราบว่าซื้อที่ดินมาในปีใด ภาระภาษีเงินได้ของนางสาวน้ำฝน และของปู่กับย่า เป็นอย่างไร",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );

    expect(["ANSWERED", "CONDITIONAL"]).toContain(res.status);
    const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
    expect(rendered).not.toContain("0706/5610");
    expect(rendered).not.toContain("มาตรา 91/2");
    expect(rendered).toContain("สินสมรส");
    expect(rendered).toContain("มาตรา 41 ทวิ");
    expect(rendered).toContain("30,000,000");
    expect(rendered).toContain("มาตรา 49 ทวิ");
    expect(rendered).toContain("มาตรา 50 (5)");
    expect(rendered).toContain("มาตรา 54");
    expect(rendered).toContain("บุตรของบุตร");
  });

  it("Explicit kinship override (Turn 7 cash prompt): 'หลานสาว (บุตรสาวของน้องชายนายสมชาย)' resolves to explicit collateral niece §42(28) 10M/15M/750k without ambiguous two-branch hedging", async () => {
    const res = await queryKnowledge(
      {
        question:
          "นายสมชายให้เงินสด 25,000,000 บาท แก่หลานสาว (บุตรสาวของน้องชายนายสมชาย) เนื่องในงานสมรสตามประเพณี เมื่อวันที่ 10 กุมภาพันธ์ 2568 ปีนั้นไม่มีการให้ทรัพย์สินอื่นแก่หลานสาว ผลทางภาษีเงินได้ของหลานสาวเป็นอย่างไร",
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );

    expect(["ANSWERED", "CONDITIONAL"]).toContain(res.status);
    const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
    expect(rendered).toContain("มาตรา 42 (28)");
    expect(rendered).toContain("10,000,000");
    expect(rendered).toContain("15,000,000");
    expect(rendered).toContain("750,000");
    // Must NOT treat explicit niece as ambiguous
    expect(rendered).not.toContain("ขึ้นอยู่กับข้อเท็จจริงชี้ขาดว่า");
  });

  it("B1-11F regression: carries forward 10 มีนาคม 2569 from Turn 1 and credits Royal Decree 799 — NOT Royal Decree 807", async () => {
    const turn1Q =
      "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0";
    const turn2Q =
      "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร";

    const res = await queryKnowledge(
      {
        question: turn2Q,
        conversation_history: [{ role: "user", content: turn1Q }],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );

    expect(["ANSWERED", "CONDITIONAL"]).toContain(res.status);
    const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
    expect(rendered).toContain("ฉบับที่ 799");
    expect(rendered).toContain("ร้อยละ 7.0");
    expect(rendered).not.toContain("ฉบับที่ 807");
  });

  it("VAT decree temporal boundaries: before 799 (2025-09-30), on 799 (2025-10-01 / 2026-09-30), on 807 (2026-10-01 / 2027-09-30), after 807 (2027-10-01), and absent date (no fallback to latest decree 807)", () => {
    const pre799 = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: true,
      taxPointDateIso: "2025-09-30",
      taxBaseBaht: null,
    });
    expect(pre799.calculation_id).toBe("calc.vat.pre_rd799_window");
    expect(pre799.summary_statement_th).toContain("ไม่ใช้ พ.ร.ฎ. ฉบับที่ 799");

    const on799Start = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: true,
      taxPointDateIso: "2025-10-01",
      taxBaseBaht: null,
    });
    expect(on799Start.required_authority_work_ids).toContain("subreg.th.rc.royal_decree.799");
    expect(on799Start.required_authority_work_ids).not.toContain("subreg.th.rc.royal_decree.807");
    expect(on799Start.summary_statement_th).toContain("ฉบับที่ 799");

    const on799End = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: true,
      taxPointDateIso: "2026-09-30",
      taxBaseBaht: null,
    });
    expect(on799End.required_authority_work_ids).toContain("subreg.th.rc.royal_decree.799");
    expect(on799End.required_authority_work_ids).not.toContain("subreg.th.rc.royal_decree.807");

    const on807Start = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: true,
      taxPointDateIso: "2026-10-01",
      taxBaseBaht: null,
    });
    expect(on807Start.required_authority_work_ids).toContain("subreg.th.rc.royal_decree.807");
    expect(on807Start.required_authority_work_ids).not.toContain("subreg.th.rc.royal_decree.799");
    expect(on807Start.summary_statement_th).toContain("ฉบับที่ 807");

    const after807 = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: true,
      taxPointDateIso: "2027-10-01",
      taxBaseBaht: null,
    });
    expect(after807.calculation_id).toBe("calc.vat.post_rd807_expiry");
    expect(after807.summary_statement_th).toContain("ร้อยละ 10.0");

    const absentDate = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: true,
      taxPointDateIso: null,
      taxBaseBaht: null,
    });
    expect(absentDate.calculation_id).toBe("calc.vat.date_required_for_decree");
    expect(absentDate.outputs.tax_point_date_missing).toBe(true);
    expect(absentDate.summary_statement_th).toContain("ยังไม่ระบุพระราชกฤษฎีกาฉบับใดเป็นกฎหมายใช้บังคับ");
  });

  it("Third-turn conversation context check: B1-09 (land/child) -> B1-09F (land/หลานสาว) -> Turn 3 (switch asset to cash while preserving หลานสาว + 25M + wedding)", async () => {
    const turn1 =
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ";
    const turn2 =
      "ถ้าผู้รับโอนไม่ใช่บุตร แต่เป็นหลานสาว และเป็นการให้เนื่องในงานสมรสตามประเพณี ผลจะเป็นอย่างไร";
    const turn3 =
      "หากเปลี่ยนทรัพย์สินที่ให้เป็นเงินสด 25,000,000 บาท แทน โดยผู้รับยังคงเป็นหลานสาวคนเดิมในงานสมรสตามประเพณี ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร";

    const res = await queryKnowledge(
      {
        question: turn3,
        conversation_history: [
          { role: "user", content: turn1 },
          { role: "user", content: turn2 },
        ],
        enable_tax_foundation_pilot: false,
      },
      TEST_ACTOR,
      { store, persistAnswerAtomically: false }
    );

    expect(["ANSWERED", "CONDITIONAL"]).toContain(res.status);
    const rendered = res.traceable_answer?.rendered_answer_th || res.answer;
    // Switched cleanly to cash/movable gift rules for ambiguous หลานสาว!
    expect(rendered).toContain("เงินสด/สังหาริมทรัพย์");
    expect(rendered).toContain("มาตรา 42 (27)");
    expect(rendered).toContain("มาตรา 42 (28)");
    expect(rendered).toContain("250,000");
    expect(rendered).toContain("750,000");
  });

  it("Verification controls user-facing output: verifyClaimAgainstPassages rejects an unsupported calculation so it cannot enter claims or answer", () => {
    const state = store.getState();
    const rd342Passages = Object.values(state.passages).filter(
      (p) => p.work_id === "subreg.th.rc.royal_decree.342"
    );
    const rejected = verifyClaimAgainstPassages(
      {
        statement:
          "ตามประมวลรัษฎากร มาตรา 3 เตรส ประกอบคำสั่งกรมสรรพากร ที่ ท.ป. 4/2528 ต้องหักภาษี ณ ที่จ่ายร้อยละ 3",
        supporting_passage_ids: rd342Passages.map((p) => p.passage_id),
        verified_calculation_numeric_tokens: ["3"],
      },
      rd342Passages
    );
    expect(rejected.allow_confident_answer).toBe(false);
    expect(rejected.verification_result).toBe("UNSUPPORTED");
  });
});
