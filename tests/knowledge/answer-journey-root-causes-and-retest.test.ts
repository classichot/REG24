import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  analyzeLegalIssuesAndFacts,
  buildMergedUserFactContext,
  detectIncidentalPremiseSections,
  detectUnverifiedExplicitExternalAuthorities,
  stripNegatedFactualClauses,
} from "../../src/core/knowledge/legal-issue-fact-analyzer";
import {
  verifyComprehensiveGiftTaxCalculation,
  verifyCorporateDonationCapCalculation,
  verifyCorporateIncomeTaxCalculation,
  verifyCrossBorderWithholdingTaxCalculation,
  verifyDomesticWithholdingTaxCalculation,
  verifyPersonalIncomeTaxProgressiveCalculation,
  verifySpecificBusinessTaxCalculation,
  verifyStampDutyCalculation,
  verifySummonsDeadlineSection19Calculation,
  verifyVatRateAndAmountCalculation,
  verifyVatRegistrationThresholdCalculation,
} from "../../src/core/knowledge/tax-calculation-verifier";
import {
  evaluateSubstantiveClaimSupport,
  verifyClaimAgainstPassages,
} from "../../src/core/knowledge/answer-verification";
import { parseQueryTemporalAndIntentContext } from "../../src/core/knowledge/temporal-versioning";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";

const READER_ACTOR: Actor = {
  actor_id: "legal.retest@reg24.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("REG24 Answer Journey Root-Cause Safeguards, Calculation Verifier & Changed-Fact Reassessment", () => {
  let stagingStore: DurableKnowledgeStore;

  beforeAll(() => {
    const stagingDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
    stagingStore = new DurableKnowledgeStore(stagingDir);
  }, 60_000);

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
  });

  it("Focus Area 1: Distinguishes DOCUMENT_LOOKUP from LEGAL_FACT_APPLICATION, strips incidental premise sections, and abstains on unverified Supreme Court decisions", () => {
    const state = stagingStore.getState();

    const lookupAnalysis = analyzeLegalIssuesAndFacts({
      question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1494",
      mode: "exact_lookup",
      explicitRulingIds: ["กค 0702/1494"],
      state,
    });
    expect(lookupAnalysis.queryKind).toBe("DOCUMENT_LOOKUP");

    const factApplicationAnalysis = analyzeLegalIssuesAndFacts({
      question:
        "บริษัท แสงตะวัน จำกัด มีกำไรสุทธิที่คำนวณตามมาตรา 65 ทวิ และ 65 ตรี แล้ว 8,000,000 บาท ไม่ใช่ SME รอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2568 ต้องเสียภาษีเงินได้นิติบุคคลในอัตราเท่าใด",
      explicitRulingIds: [],
      state,
    });
    expect(factApplicationAnalysis.queryKind).toBe("LEGAL_FACT_APPLICATION");
    expect(factApplicationAnalysis.incidentalPremiseSectionIds).toEqual(
      expect.arrayContaining(["มาตรา 65 ทวิ", "มาตรา 65 ตรี"])
    );
    expect(factApplicationAnalysis.controllingWorkIds).toEqual(
      expect.arrayContaining(["prov.th.rc.65", "sched.th.rc.income_tax_rate"])
    );

    const inc = detectIncidentalPremiseSections(
      "มีกำไรสุทธิที่คำนวณตามมาตรา 65 ทวิ และ 65 ตรี แล้ว 8,000,000 บาท"
    );
    expect(inc).toEqual(["มาตรา 65 ทวิ", "มาตรา 65 ตรี"]);

    const dikaGuard = detectUnverifiedExplicitExternalAuthorities(
      "ตามคำพิพากษาศาลฎีกาที่ 8877/2567 เรื่องภาษีธุรกิจเฉพาะ ศาลตัดสินอย่างไร และใช้กับกรณีขายที่ดินของผมได้ไหม",
      state
    );
    expect(dikaGuard.shouldAbstain).toBe(true);
    expect(dikaGuard.authorityKind).toBe("SUPREME_COURT_DECISION");
    expect(dikaGuard.abstentionMessageTh).toContain("8877/2567");
  });

  it("Focus Area 3: Strips negated dates/facts ('ไม่ใช่ ...', 'instead of ...', 'ไม่ได้ผ่านระบบ e-Withholding Tax') and parses accounting period ranges accurately", () => {
    const cleanedDate = stripNegatedFactualClauses(
      "วันที่จ่ายค่าจ้างทำของจริงคือ 15 มกราคม 2569 ไม่ใช่ 15 มิถุนายน 2568"
    );
    expect(cleanedDate).toContain("15 มกราคม 2569");
    expect(cleanedDate).not.toContain("15 มิถุนายน 2568");

    const t1 = parseQueryTemporalAndIntentContext({
      question:
        "ข้อมูลเพิ่มเติมจากข้อ B1-12: รอบระยะเวลาบัญชีของบริษัท คิริ จำกัด คือ 1 กรกฎาคม 2560 – 30 มิถุนายน 2561 ไม่ใช่เริ่ม 1 กรกฎาคม 2561",
    });
    expect(t1.accounting_period_start_iso).toBe("2017-07-01");
    expect(t1.accounting_period_end_iso).toBe("2018-06-30");

    const t2 = parseQueryTemporalAndIntentContext({
      question:
        "ข้อมูลเพิ่มเติมจากข้อ B1-15: ความรับผิดใน VAT เกิดวันที่ 20 กันยายน 2570 ไม่ใช่ 20 ตุลาคม 2570 อัตราที่ต้องใช้เป็นเท่าใด",
    });
    expect(t2.transaction_date_iso).toBe("2027-09-20");

    const merged = buildMergedUserFactContext("ผู้รับคือบริษัทต่างประเทศ", [
      { role: "user", content: "บริษัทจ่ายค่าที่ปรึกษา 2,000,000 บาท" },
      {
        role: "assistant",
        content: "อ้างอิงหนังสือตอบข้อหารือเลขที่ กค 0811/4401 ลงวันที่ 10 พฤษภาคม 2545",
      },
    ]);
    expect(merged).toContain("2,000,000 บาท");
    expect(merged).not.toContain("0811/4401");
  });

  it("Focus Area 4: Verifies deterministic tax calculations separately and blocks real-but-unrelated evidence from validating claims", () => {
    // 1. CIT General vs Historical FY 2558/2559 vs SME
    const citGeneral = verifyCorporateIncomeTaxCalculation({
      isSme: false,
      accountingPeriodStartIso: "2025-01-01",
      accountingPeriodEndIso: "2025-12-31",
      netProfitBaht: 8_000_000,
    });
    expect(citGeneral.outputs.tax_payable_baht).toBe(1_600_000);

    const citSplit2558 = verifyCorporateIncomeTaxCalculation({
      isSme: false,
      accountingPeriodStartIso: "2015-07-01",
      accountingPeriodEndIso: "2016-06-30",
      netProfitBaht: null,
    });
    expect(citSplit2558.outputs.applicable_rate_pct).toBe(20);
    expect(citSplit2558.required_authority_work_ids).toContain("subreg.th.rc.royal_decree.577");

    const citSme = verifyCorporateIncomeTaxCalculation({
      isSme: true,
      accountingPeriodStartIso: "2025-01-01",
      accountingPeriodEndIso: "2025-12-31",
      netProfitBaht: 2_500_000,
    });
    expect(citSme.outputs.tax_payable_baht).toBe(330_000);

    // 2. PIT Progressive Brackets (900,000 -> 95,000; 2,500,000 -> 515,000)
    const pit900k = verifyPersonalIncomeTaxProgressiveCalculation({
      netIncomeBaht: 900_000,
      taxYearBe: 2568,
    });
    expect(pit900k.outputs.total_tax_payable_baht).toBe(95_000);

    const pit2_5m = verifyPersonalIncomeTaxProgressiveCalculation({
      netIncomeBaht: 2_500_000,
      taxYearBe: 2568,
    });
    expect(pit2_5m.outputs.total_tax_payable_baht).toBe(515_000);

    // 3. Public Charity 2/102 Cap under Order P. 52/2537 (20,000,000 * 2 / 102 = 392,156.86)
    const charity = verifyCorporateDonationCapCalculation({
      donationKind: "PUBLIC_CHARITY_65_TER_3B",
      accountingPeriodStartIso: "2025-01-01",
      netProfitBeforeDonationBaht: 20_000_000,
      donationAmountBaht: 1_000_000,
    });
    expect(charity.outputs.deductible_amount_baht).toBe(392_156.86);
    expect(charity.outputs.disallowed_amount_baht).toBe(607_843.14);

    // 4. Stamp Duty + Cash Payment O.S.4 (>= 1M hire of work) & Loan 10,000 Cap
    const stampHire = verifyStampDutyCalculation({
      instrumentKind: "HIRE_OF_WORK_ITEM_4",
      contractValueBaht: 2_000_000,
    });
    expect(stampHire.outputs.stamp_duty_baht).toBe(2_000);
    expect(stampHire.outputs.must_pay_in_cash_os4).toBe(true);

    const stampLoan = verifyStampDutyCalculation({
      instrumentKind: "LOAN_ITEM_5",
      contractValueBaht: 50_000_000,
    });
    expect(stampLoan.outputs.stamp_duty_baht).toBe(10_000);

    // 5. VAT RD 807 Window vs Post-2027-09-30 Expiry & Small-Business 1.8M Threshold
    const vatInWindow = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: false,
      taxPointDateIso: "2027-09-20",
      taxBaseBaht: null,
    });
    expect(vatInWindow.outputs.effective_vat_rate_pct).toBe(7);

    const vatExpired = verifyVatRateAndAmountCalculation({
      isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
      isServiceUsedInThailand: false,
      taxPointDateIso: "2027-10-20",
      taxBaseBaht: null,
    });
    expect(vatExpired.outputs.rd807_covers_date).toBe(false);
    expect(vatExpired.outputs.statutory_fallback_rate_pct).toBe(10);

    const vatReg = verifyVatRegistrationThresholdCalculation({ annualTurnoverBaht: 1_500_000 });
    expect(vatReg.outputs.must_register_vat).toBe(false);

    // 6. Gift Tax Legitimate Child vs "หลานสาว" (Collateral Niece vs Lineal Grandchild)
    const giftLan = verifyComprehensiveGiftTaxCalculation({
      isImmovableProperty: true,
      recipientRole: "AMBIGUOUS_LAN_OR_NIECE",
      isCeremonyOrCustomOrMoralDuty: true,
      transferValueBaht: 25_000_000,
    });
    expect(giftLan.outputs.collateral_niece_exempt_baht).toBe(10_000_000);
    expect(giftLan.outputs.collateral_niece_5pct_tax_baht).toBe(750_000);
    expect(giftLan.outputs.lineal_grandchild_exempt_baht).toBe(20_000_000);
    expect(giftLan.outputs.lineal_grandchild_5pct_tax_baht).toBe(250_000);

    // 7. Domestic e-WHT (MR 389 & MR 402) & Cross-Border s.70 & Finance SBT 3.3% & Summons s.19
    const ewht2569 = verifyDomesticWithholdingTaxCalculation({
      incomeCategory: "HIRE_OF_WORK_OR_SERVICE",
      isEWithholdingTax: true,
      paymentDateIso: "2026-01-15",
      grossPaymentBaht: 1_200_000,
    });
    expect(ewht2569.outputs.applicable_wht_rate_pct).toBe(1);
    expect(ewht2569.outputs.wht_amount_baht).toBe(12_000);
    expect(ewht2569.required_authority_work_ids).toContain("subreg.th.rc.min_reg.402");

    const crossBorder = verifyCrossBorderWithholdingTaxCalculation({
      items: [
        { labelTh: "เงินปันผล", kind: "DIVIDEND_40_4_B", amountBaht: 5_000_000 },
        { labelTh: "ค่าบริหารจัดการ", kind: "SERVICE_OR_MANAGEMENT_FEE", amountBaht: 1_000_000 },
      ],
    });
    expect(crossBorder.outputs.dividend_rate_pct).toBe(10);
    expect(crossBorder.outputs.other_s70_rate_pct).toBe(15);

    const sbtFin = verifySpecificBusinessTaxCalculation({
      activityKind: "BANKING_OR_FINANCE_INTEREST",
      grossReceiptsBaht: 10_000_000,
    });
    expect(sbtFin.outputs.total_sbt_and_local_baht).toBe(330_000);

    const s19Barred = verifySummonsDeadlineSection19Calculation({
      returnFilingDateIso: "2022-05-28",
      summonsDateIso: "2025-08-10",
      hasDgApprovalForEvasionOrRefund: false,
    });
    expect(s19Barred.outputs.summons_lawful_under_s19).toBe(false);

    const s19Extended = verifySummonsDeadlineSection19Calculation({
      returnFilingDateIso: "2022-05-28",
      summonsDateIso: "2025-08-10",
      hasDgApprovalForEvasionOrRefund: true,
    });
    expect(s19Extended.outputs.summons_lawful_under_s19).toBe(true);

    // 8. Real-but-unrelated passage must NEVER validate a calculation or legal claim
    const relPassages = stagingStore.getPassagesForRelease("rel.B01.rc6");
    const unrelatedVatPassage = relPassages.find((p) => p.work_id === "prov.th.rc.80")!;
    const bogusCheck = verifyClaimAgainstPassages(
      {
        statement: citGeneral.summary_statement_th,
        supporting_passage_ids: [unrelatedVatPassage.passage_id],
        verified_calculation_numeric_tokens: citGeneral.verified_numeric_tokens,
      },
      [unrelatedVatPassage]
    );
    expect(bogusCheck.allow_confident_answer).toBe(false);

    const subCheck = evaluateSubstantiveClaimSupport({
      claim_text: "บริษัทต้องเสียภาษีธุรกิจเฉพาะอัตราร้อยละ 3.3 สำหรับรายรับดอกเบี้ย 10,000,000 บาท",
      passages: [
        {
          passage_id: unrelatedVatPassage.passage_id,
          doc_id: unrelatedVatPassage.work_id,
          verbatim_text: unrelatedVatPassage.exact_text,
          doc_title_th: "ประมวลรัษฎากร มาตรา 80",
          section_path: ["มาตรา 80"],
        },
      ],
    });
    expect(subCheck.supported).toBe(false);
  });

  it("Focus Areas 2, 3 & 5: End-to-end query journey reassesses changed facts across multi-turn follow-ups, asks for clarification on missing decisive facts, and stamps execution_provenance", async () => {
    setDefaultKnowledgeStoreForTesting(stagingStore);

    // Pair 1: Missing WHT recipient -> Clarification -> Foreign Recipient -> Section 70 (no stale ruling lock-in!)
    const turn1Wht = await queryKnowledge(
      {
        question:
          "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
      },
      READER_ACTOR
    );
    expect(turn1Wht.status).toBe("NEEDS_CLARIFICATION");
    expect(turn1Wht.execution_provenance?.release_id).toBe("rel.B01.rc6");
    expect(turn1Wht.execution_provenance?.calculation_verifier_version).toBe(
      "reg24-tax-calc-verifier-v1.0"
    );

    const turn2Wht = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติมจากข้อ B1-16: ผู้รับค่าที่ปรึกษา 2,000,000 บาท คือบริษัทที่ตั้งขึ้นตามกฎหมายต่างประเทศ ไม่มีสถานประกอบการในไทย งานบริหารจัดการทำจากต่างประเทศ จ่ายเมื่อ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายอย่างไร",
        conversation_history: [
          {
            role: "user",
            content:
              "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
          },
          { role: "assistant", content: turn1Wht.answer },
        ],
      },
      READER_ACTOR
    );
    expect(turn2Wht.status).toBe("ANSWERED");
    expect(turn2Wht.evidence.map((e) => e.work_id)).toEqual(
      expect.arrayContaining(["prov.th.rc.70", "sched.th.rc.income_tax_rate", "prov.th.rc.40"])
    );
    expect(turn2Wht.answer).toContain("300,000 บาท");

    // Pair 2: Export of service 0% VAT -> Service used in Bangkok branch flips to 7% VAT!
    const turn1Vat = await queryKnowledge(
      {
        question:
          "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
      },
      READER_ACTOR
    );
    expect(turn1Vat.answer).toMatch(/ร้อยละ\s*0/);

    const turn2Vat = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติม: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
        conversation_history: [
          {
            role: "user",
            content:
              "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
          },
          { role: "assistant", content: turn1Vat.answer },
        ],
      },
      READER_ACTOR
    );
    expect(turn2Vat.answer).toContain("ไม่เข้าเงื่อนไขใช้อัตราร้อยละ 0");
    expect(turn2Vat.answer).toMatch(/ร้อยละ\s*7/);

    // Pair 3: Historical CIT 2559 (Act No. 42) -> Changed fact FY 1 Jul 2558 - 30 Jun 2559 (RD No. 577, NOT Act No. 42)
    const turn1Cit = await queryKnowledge(
      {
        question:
          "บริษัท สยามเฟอร์นิเจอร์ จำกัด เป็นบริษัททั่วไป (ไม่ใช่ SME) มีรอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2559 กรรมการเข้าใจว่าอัตราภาษีเงินได้นิติบุคคลยังเป็นร้อยละ 30 อยู่จริงหรือไม่",
      },
      READER_ACTOR
    );
    expect(turn1Cit.status).toBe("ANSWERED");
    expect(turn1Cit.evidence.map((e) => e.work_id)).toEqual(
      expect.arrayContaining(["prov.th.rc.65", "statute.th.rc_amendment_42_2559"])
    );
    expect(turn1Cit.answer).toContain("ไม่ใช่อัตราร้อยละ 30");

    const turn2Cit = await queryKnowledge(
      {
        question:
          "ข้อมูลเพิ่มเติม: รอบระยะเวลาบัญชีคือ 1 กรกฎาคม 2558 – 30 มิถุนายน 2559 ไม่ใช่เริ่ม 1 มกราคม 2559 บริษัททั่วไปที่ไม่ใช่ SME ต้องใช้อัตราตามพ.ร.บ. ฉบับที่ 42 หรือไม่ แล้วอัตราที่ถูกต้องของรอบนี้คืออะไร",
        conversation_history: [
          {
            role: "user",
            content:
              "บริษัท สยามเฟอร์นิเจอร์ จำกัด เป็นบริษัททั่วไป (ไม่ใช่ SME) มีรอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2559 กรรมการเข้าใจว่าอัตราภาษีเงินได้นิติบุคคลยังเป็นร้อยละ 30 อยู่จริงหรือไม่",
          },
          { role: "assistant", content: turn1Cit.answer },
        ],
      },
      READER_ACTOR
    );
    expect(turn2Cit.status).toBe("ANSWERED");
    expect(turn2Cit.evidence.map((e) => e.work_id)).toEqual(
      expect.arrayContaining(["statute.th.rc_amendment_42_2559", "subreg.th.rc.royal_decree.577"])
    );
    expect(turn2Cit.answer).toContain("2015-07-01");
    expect(turn2Cit.answer).toContain("577");
  });
});
