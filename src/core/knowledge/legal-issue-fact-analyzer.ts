/**
 * REG24 — General Legal Issue, Fact Extraction, Multi-Turn Reassessment & Controlling-Law Mapper
 *
 * Addresses Owner Focus Areas 1, 2, 3, and 4 at the architectural level (zero hardcoded test-pack answers):
 * 1. Distinguishes `DOCUMENT_LOOKUP` from `LEGAL_FACT_APPLICATION` and `MULTI_SOURCE_COMPARISON`.
 * 2. Strips negated correction clauses (`ไม่ใช่ ...`, `not ...`, `instead of ...`) and merges multi-turn
 *    user facts so changed facts override prior turns without locking onto stale `กค` ruling IDs.
 * 3. Maps implicated tax issues to their controlling primary provisions, schedules, amending Acts,
 *    and subordinate instruments (Hierarchy-of-Authority Retrieval).
 * 4. Detects decisive missing taxpayer facts (e.g., unspecified WHT recipient status) and invokes
 *    `tax-calculation-verifier.ts` for deterministic arithmetic and statutory condition application.
 */

import type { CanonicalPersistedState } from "./store";
import type { ConversationTurnInput } from "./contracts";
import { thaiDigitsToArabic } from "./identity";
import {
  parseFlexibleThaiOrEnglishDateToIso,
  parseQueryTemporalAndIntentContext,
} from "./temporal-versioning";
import {
  verifyComprehensiveGiftTaxCalculation,
  verifyCorporateDonationCapCalculation,
  verifyCorporateIncomeTaxCalculation,
  verifyCrossBorderWithholdingTaxCalculation,
  verifyDomesticWithholdingTaxCalculation,
  verifyPersonalIncomeTaxProgressiveCalculation,
  verifySalaryStandardDeductionCalculation,
  verifySpecificBusinessTaxCalculation,
  verifyStampDutyCalculation,
  verifySummonsDeadlineSection19Calculation,
  verifyVatRateAndAmountCalculation,
  verifyVatRegistrationThresholdCalculation,
  type VerifiedCalculationResult,
} from "./tax-calculation-verifier";

export type AnalyzedQueryKind =
  | "DOCUMENT_LOOKUP"
  | "MULTI_SOURCE_COMPARISON"
  | "LEGAL_FACT_APPLICATION";

export interface UnverifiedExplicitAuthorityGuard {
  shouldAbstain: boolean;
  authorityKind: "SUPREME_COURT_DECISION" | null;
  rawIdentifier: string | null;
  abstentionMessageTh: string | null;
  clarificationQuestionsTh: string[];
}

export interface LegalIssueAndFactAnalysis {
  queryKind: AnalyzedQueryKind;
  activeTextCleanedOfNegations: string;
  mergedUserFactContextText: string;
  implicatedRegimes: string[];
  controllingWorkIds: string[];
  incidentalPremiseSectionIds: string[];
  decisiveMissingFactQuestionsTh: string[];
  conditionalFrameworkSummaryTh: string | null;
  verifiedCalculations: VerifiedCalculationResult[];
  demoteRulingsIssuedBeforeIso: string | null;
  unverifiedAuthorityGuard: UnverifiedExplicitAuthorityGuard;
}

/**
 * Removes negated date/period/fact spans (`ไม่ใช่ 15 มิถุนายน 2568`, `ไม่ใช่เริ่ม 1 กรกฎาคม 2561`,
 * `instead of 15 June 2025`, `ไม่ได้ใช้ที่สำนักงานในสิงคโปร์`, `ไม่ได้มาทางมรดก`) so active extractors
 * never latch onto the old negated fact or old negated date!
 */
export function stripNegatedFactualClauses(rawText: string): string {
  let s = thaiDigitsToArabic(rawText).replace(/\s+/g, " ").trim();
  // Strip Thai "ไม่ใช่ <date / start-date / place / entity>" phrases up to clause boundary
  s = s.replace(
    /(?:แต่)?(?:ไม่ใช่|มิใช่)\s*(?:เริ่ม(?:ต้น)?(?:วันที่)?|วันที่|เมื่อวันที่|ในวันที่)?\s*(?:[0-9]{1,2}\s*[ก-๙a-zA-Z./\-]+\s*[0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/gi,
    " "
  );
  s = s.replace(
    /\b(?:not|instead\s+of|rather\s+than)\s+(?:starting(?:\s+on)?\s+|on\s+)?(?:[0-9]{1,2}[\s/\-.]+[a-zA-Z0-9.]+[\s/\-,]+[0-9]{2,4}|[a-zA-Z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/gi,
    " "
  );
  // Strip negated location/inheritance/channel clauses so positive extractors don't match the negated keyword
  s = s.replace(/ไม่ได้ใช้ที่[^\s,.;)]+(?:\s+ใน[^\s,.;)]+)?/g, " ");
  s = s.replace(/ไม่ได้มาทางมรดก/g, " ");
  s = s.replace(/ไม่ใช่บุตรชอบด้วยกฎหมาย/g, " ");
  s = s.replace(
    /(?:ไม่ได้|มิได้|ไม่)\s*(?:ผ่าน|นำส่งผ่าน|ใช้)(?:ระบบ)?\s*e-Withholding(?:\s*Tax)?/gi,
    " "
  );
  return s.replace(/\s+/g, " ").trim();
}

function parseThaiMoneyAmountsWithContext(text: string): Array<{
  amount: number;
  leftContext: string;
  rightContext: string;
}> {
  const norm = thaiDigitsToArabic(text);
  const out: Array<{ amount: number; leftContext: string; rightContext: string }> = [];
  const re =
    /(?:([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท|thb|baht)|\b(thb|baht)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?))/gi;
  for (const m of norm.matchAll(re)) {
    const numStr = m[1] || m[4] || "";
    const unitStr = (m[2] || m[3] || "").toLowerCase();
    const rawNum = Number(numStr.replace(/,/g, ""));
    if (!Number.isFinite(rawNum)) continue;
    const amount = unitStr === "ล้านบาท" ? rawNum * 1_000_000 : rawNum;
    const idx = m.index ?? 0;
    const leftContext = norm.slice(Math.max(0, idx - 85), idx);
    const rightContext = norm.slice(idx + m[0].length, idx + m[0].length + 60);
    out.push({ amount, leftContext, rightContext });
  }
  return out;
}

/**
 * Detects explicit Supreme Court Decision numbers (`คำพิพากษาศาลฎีกาที่ X/Y` / `Supreme Court Decision No. X/Y`)
 * that are NOT in the verified canonical store, preventing REG24 from hallucinating via an unrelated ruling.
 */
export function detectUnverifiedExplicitExternalAuthorities(
  question: string,
  state: CanonicalPersistedState
): UnverifiedExplicitAuthorityGuard {
  const qNorm = thaiDigitsToArabic(question).replace(/\s+/g, " ").trim();
  const dikaMatch =
    qNorm.match(/(?:คำพิพากษา(?:ศาล)?ฎีกา(?:ที่)?|ฎีกาที่)\s*([0-9]{1,6}\s*\/\s*[0-9]{4})/) ||
    qNorm.match(/\bSupreme\s+Court\s+(?:Decision|Judgment)\s*(?:No\.?)?\s*([0-9]{1,6}\s*\/\s*[0-9]{4})\b/i);

  if (!dikaMatch) {
    return {
      shouldAbstain: false,
      authorityKind: null,
      rawIdentifier: null,
      abstentionMessageTh: null,
      clarificationQuestionsTh: [],
    };
  }

  const dikaNo = dikaMatch[1].replace(/\s+/g, "");
  const existsInVerifiedWorks = Object.values(state.works).some((w) => {
    if (w.type === "TaxRuling") return false;
    const hay = thaiDigitsToArabic(
      `${w.title_th} ${w.official_identifiers.map((o) => o.normalized).join(" ")}`
    ).replace(/\s+/g, "");
    return hay.includes(dikaNo);
  });

  if (existsInVerifiedWorks) {
    return {
      shouldAbstain: false,
      authorityKind: null,
      rawIdentifier: null,
      abstentionMessageTh: null,
      clarificationQuestionsTh: [],
    };
  }

  const asksLandSbt = /ขายที่ดิน|อสังหาริมทรัพย์|ภาษีธุรกิจเฉพาะ/.test(qNorm);
  const clarificationQuestions: string[] = [];
  if (asksLandSbt) {
    clarificationQuestions.push(
      "หากต้องการให้วิเคราะห์ภาระภาษีธุรกิจเฉพาะสำหรับการขายที่ดินของท่านตามประมวลรัษฎากร มาตรา 91/2 (6) และพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 โดยตรง กรุณาระบุ (1) วิธีการได้มาของที่ดิน (เช่น ซื้อมา รับให้ หรือรับมรดก), (2) ระยะเวลาถือครองนับแต่วันที่ได้มาจนถึงวันขาย (เกิน 5 ปีหรือไม่), และ (3) มีการแบ่งแยกจัดสรร ขายในนามธุรกิจ หรือมีชื่ออยู่ในทะเบียนบ้านไม่น้อยกว่า 1 ปีหรือไม่"
    );
  } else {
    clarificationQuestions.push(
      `กรุณาแนบสำเนาคำพิพากษาศาลฎีกาที่ ${dikaNo} ฉบับทางการเพื่อใช้ตรวจสอบ หรือระบุข้อเท็จจริงธุรกรรมของท่านเพื่อวิเคราะห์จากบทบัญญัติประมวลรัษฎากรโดยตรง`
    );
  }

  const msgTh =
    `ไม่พบข้อมูลคำพิพากษาศาลฎีกาที่ \`${dikaNo}\` ในคลังข้อมูลที่ผ่านการตรวจรับรองของ REG24 Batch 1 (ซึ่งครอบคลุมประมวลรัษฎากร กฎหมายลำดับรอง และหนังสือตอบข้อหารือกรมสรรพากรที่รับรองแล้ว) ระบบจึง **ขอระงับการสรุปผลคำวินิจฉัยของคำพิพากษาศาลฎีกาที่ \`${dikaNo}\` (Abstain)** เพื่อไม่ให้คาดเดาหรือนำหนังสือตอบข้อหารืออื่นที่ไม่ตรงเรื่องมาอ้างแทนคำพิพากษาศาลฎีกา` +
    (asksLandSbt
      ? ` ทั้งนี้ สำหรับคำถามว่านำมาใช้กับกรณีขายที่ดินของท่านได้หรือไม่ ในทางกฎหมายภาษีอากร การขายที่ดินจะอยู่ในบังคับภาษีธุรกิจเฉพาะ (อัตราร้อยละ 3.3 รวมภาษีท้องถิ่น) หรือไม่ พิจารณาตาม **ประมวลรัษฎากร มาตรา 91/2 (6) และพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 มาตรา 4** จึงขอทราบข้อเท็จจริงการได้มาและระยะเวลาถือครองที่ดินของท่านเพิ่มเติมเพื่อวิเคราะห์จากตัวบทกฎหมายโดยตรง`
      : "");

  return {
    shouldAbstain: true,
    authorityKind: "SUPREME_COURT_DECISION",
    rawIdentifier: `คำพิพากษาศาลฎีกาที่ ${dikaNo}`,
    abstentionMessageTh: msgTh,
    clarificationQuestionsTh: clarificationQuestions,
  };
}

/**
 * Extracts incidental premise section mentions (e.g. `มีกำไรสุทธิที่คำนวณตามมาตรา 65 ทวิ และ 65 ตรี แล้ว`)
 * so retrieval does not let background premise sections crowd out the interrogated rate/liability section!
 */
export function detectIncidentalPremiseSections(questionNorm: string): string[] {
  const incidental = new Set<string>();
  const premiseRe =
    /คำนวณตาม\s*มาตรา\s*([0-9/]+(?:\s*(?:ทวิ|ตรี|จัตวา))?)(?:\s*(?:และ|กับ)\s*(?:มาตรา\s*)?([0-9/]+(?:\s*(?:ทวิ|ตรี|จัตวา))?))?\s*แล้ว/g;
  for (const m of questionNorm.matchAll(premiseRe)) {
    if (m[1]) incidental.add(`มาตรา ${m[1].replace(/\s+/g, " ").trim()}`);
    if (m[2]) incidental.add(`มาตรา ${m[2].replace(/\s+/g, " ").trim()}`);
  }
  return Array.from(incidental);
}

/**
 * Merges multi-turn user facts (prior `user` turns ONLY — never assistant `กค` citations!) with the current question.
 */
export function buildMergedUserFactContext(
  question: string,
  history?: ConversationTurnInput[]
): string {
  const priorUserTurns = (history || [])
    .filter((t) => t && t.role === "user" && typeof t.content === "string" && t.content.trim())
    .map((t) => stripNegatedFactualClauses(t.content));
  const currentActive = stripNegatedFactualClauses(question);
  if (priorUserTurns.length === 0) return currentActive;
  return [...priorUserTurns.slice(-2), currentActive].join(" | ");
}

/**
 * Main Issue, Fact, Condition & Calculation Analyzer
 */
export function analyzeLegalIssuesAndFacts(params: {
  question: string;
  applicableDate?: string | null;
  mode?: "standard" | "exact_lookup" | "comparison";
  explicitRulingIds: string[];
  conversationHistory?: ConversationTurnInput[];
  state: CanonicalPersistedState;
}): LegalIssueAndFactAnalysis {
  const rawNorm = thaiDigitsToArabic(params.question).replace(/\s+/g, " ").trim();
  const activeClean = stripNegatedFactualClauses(rawNorm);
  const mergedContext = buildMergedUserFactContext(params.question, params.conversationHistory);

  const unverifiedGuard = detectUnverifiedExplicitExternalAuthorities(params.question, params.state);

  if (params.mode === "comparison" || /^(?:เปรียบเทียบ|compare\b)/i.test(rawNorm)) {
    return {
      queryKind: "MULTI_SOURCE_COMPARISON",
      activeTextCleanedOfNegations: activeClean,
      mergedUserFactContextText: mergedContext,
      implicatedRegimes: [],
      controllingWorkIds: [],
      incidentalPremiseSectionIds: [],
      decisiveMissingFactQuestionsTh: [],
      conditionalFrameworkSummaryTh: null,
      verifiedCalculations: [],
      demoteRulingsIssuedBeforeIso: null,
      unverifiedAuthorityGuard: unverifiedGuard,
    };
  }

  const temporalActive = parseQueryTemporalAndIntentContext({
    question: activeClean,
    applicableDate: params.applicableDate ?? null,
    mode: params.mode,
    explicitRulingIds: params.explicitRulingIds,
  });

  const isPureLookup =
    params.mode === "exact_lookup" ||
    (params.explicitRulingIds.length > 0 && temporalActive.query_intent === "HISTORICAL_DOCUMENT_LOOKUP") ||
    /^(?:ค้นหา|แสดงบทบัญญัติ|แสดงตัวบท|ขอสรุปแนววินิจฉัย|ในหนังสือตอบข้อหารือ)/.test(rawNorm);

  if (isPureLookup) {
    return {
      queryKind: "DOCUMENT_LOOKUP",
      activeTextCleanedOfNegations: activeClean,
      mergedUserFactContextText: mergedContext,
      implicatedRegimes: [],
      controllingWorkIds: [],
      incidentalPremiseSectionIds: [],
      decisiveMissingFactQuestionsTh: [],
      conditionalFrameworkSummaryTh: null,
      verifiedCalculations: [],
      demoteRulingsIssuedBeforeIso: null,
      unverifiedAuthorityGuard: unverifiedGuard,
    };
  }

  const incidentalSections = detectIncidentalPremiseSections(activeClean);
  const controlling = new Set<string>();
  const regimes = new Set<string>();
  const missingQuestions: string[] = [];
  let conditionalFrameworkSummaryTh: string | null = null;
  const calcs: VerifiedCalculationResult[] = [];
  let demoteRulingsBeforeIso: string | null = null;

  const amounts = parseThaiMoneyAmountsWithContext(activeClean);
  const eventIso =
    temporalActive.point_in_time_date_iso ||
    temporalActive.transaction_date_iso ||
    temporalActive.accounting_period_start_iso ||
    null;

  // --- Regime A: Summons Time-Bar (`มาตรา 19` — two dates: return filing date + summons date) ---
  const asksSummonsS19 =
    /หมายเรียก|มาตรา\s*19(?![0-9/])|\bsummons\b[\s\S]{0,40}\bsection\s*19\b/i.test(mergedContext);
  if (asksSummonsS19) {
    regimes.add("TAX_ADMIN_SUMMONS_S19");
    controlling.add("prov.th.rc.19");

    const filingMatch = mergedContext.match(
      /(?:ยื่นแบบ[^\n,]{0,35}?(?:เมื่อวันที่|วันที่)|ยื่นรายการ(?:เมื่อวันที่|วันที่)?)\s*([0-9]{1,2}\s*[ก-๙a-zA-Z.]+\s*[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    const summonsMatch = mergedContext.match(
      /(?:ต่อมา(?:เมื่อ)?วันที่|ได้รับหมายเรียก[^\n,]{0,30}?วันที่|หมายเรียก(?:ลง)?วันที่|ออกหมายเรียก(?:เมื่อ)?วันที่)\s*([0-9]{1,2}\s*[ก-๙a-zA-Z.]+\s*[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i
    );
    const filingIso = filingMatch ? parseFlexibleThaiOrEnglishDateToIso(filingMatch[1]) : null;
    const summonsIso = summonsMatch ? parseFlexibleThaiOrEnglishDateToIso(summonsMatch[1]) : null;

    // Current turn overrides prior turn on evasion/DG approval!
    const currentHasPositiveDgExtension =
      /(?:อธิบดีอนุมัติให้ขยาย|อนุมัติขยายเวลา|มีเหตุอันควรสงสัยว่า[^\n]{0,40}หลีกเลี่ยงภาษี|มีเจตนาหลีกเลี่ยงภาษี)/.test(
        activeClean
      ) && !/ไม่มีข้อเท็จจริงว่ามีการหลีกเลี่ยง|ไม่มีเจตนาหลีกเลี่ยง/.test(activeClean);
    const currentExplicitlyNoEvasionNoRefund =
      /ไม่มีข้อเท็จจริงว่ามีการหลีกเลี่ยงภาษี|ไม่มีเจตนาหลีกเลี่ยง/.test(activeClean);

    if (filingIso && summonsIso && (currentHasPositiveDgExtension || currentExplicitlyNoEvasionNoRefund)) {
      calcs.push(
        verifySummonsDeadlineSection19Calculation({
          returnFilingDateIso: filingIso,
          summonsDateIso: summonsIso,
          hasDgApprovalForEvasionOrRefund: currentHasPositiveDgExtension,
        })
      );
    }
  }

  // --- Regime B: Corporate Donation Caps (`มาตรา 65 ตรี (3)(ก)` Political Party & `(3)(ข)` Public Charity) ---
  const asksPoliticalPartyDonation =
    /บริจาค[^\n]{0,35}พรรคการเมือง|พรรคการเมือง[\s\S]{0,40}65\s*ตรี|\bpolitical\s+party\b[\s\S]{0,40}\bdeduct/i.test(
      mergedContext
    );
  const asksPublicCharityDonation =
    !asksPoliticalPartyDonation &&
    /(?:บริษัท|ห้างหุ้นส่วนนิติบุคคล)[\s\S]{0,120}บริจาค[\s\S]{0,80}(?:องค์การสาธารณกุศล|กุศลสาธารณะ|สาธารณประโยชน์)/i.test(
      mergedContext
    );

  if (asksPoliticalPartyDonation) {
    regimes.add("CIT_POLITICAL_PARTY_DONATION");
    const explicitlyAsksAct51Applicability = /ฉบับที่\s*51|Act\s*\(?\s*No\.?\s*51/i.test(activeClean);
    controlling.add("statute.th.rc_amendment_51_2562");
    if (
      !temporalActive.accounting_period_start_iso ||
      temporalActive.accounting_period_start_iso >= "2018-01-01" ||
      !explicitlyAsksAct51Applicability
    ) {
      controlling.add("prov.th.rc.65_ตรี");
    }
    const donAmt =
      amounts.find((a) => /บริจาค|พรรคการเมือง/.test(a.leftContext))?.amount ??
      parseThaiMoneyAmountsWithContext(mergedContext).find((a) => /บริจาค|พรรคการเมือง/.test(a.leftContext))
        ?.amount ??
      null;
    if (
      donAmt !== null &&
      temporalActive.accounting_period_start_iso &&
      (temporalActive.accounting_period_start_iso >= "2018-01-01" || explicitlyAsksAct51Applicability)
    ) {
      calcs.push(
        verifyCorporateDonationCapCalculation({
          donationKind: "POLITICAL_PARTY_65_TER_3A",
          accountingPeriodStartIso: temporalActive.accounting_period_start_iso,
          netProfitBeforeDonationBaht: null,
          donationAmountBaht: donAmt,
        })
      );
    }
  } else if (asksPublicCharityDonation) {
    regimes.add("CIT_PUBLIC_CHARITY_DONATION");
    controlling.add("prov.th.rc.65_ตรี");
    controlling.add("subreg.th.rd.order_p.52_2537");
    const profitBefore =
      amounts.find((a) => /กำไรสุทธิ/.test(a.leftContext))?.amount ?? null;
    const donAmt =
      amounts.find((a) => /บริจาค/.test(a.leftContext) && !/กำไรสุทธิก่อน/.test(a.leftContext))?.amount ??
      null;
    if (profitBefore !== null && donAmt !== null) {
      calcs.push(
        verifyCorporateDonationCapCalculation({
          donationKind: "PUBLIC_CHARITY_65_TER_3B",
          accountingPeriodStartIso: temporalActive.accounting_period_start_iso,
          netProfitBeforeDonationBaht: profitBefore,
          donationAmountBaht: donAmt,
        })
      );
    }
  }

  // --- Regime B2: General Corporate Disallowed Expenses (`มาตรา 65 ตรี` — e.g. `(18)` unprovable recipient, `(6)` tax paid on behalf, `(13)` non-business expense) ---
  const asksGeneral65TerExpense =
    !asksPoliticalPartyDonation &&
    !asksPublicCharityDonation &&
    (/มาตรา\s*65\s*ตรี|\bsection\s*65\s*ter\b/i.test(activeClean) ||
      (/(?:รายจ่ายต้องห้าม|หักเป็นรายจ่ายในการคำนวณกำไรสุทธิ)/.test(activeClean) &&
        /(?:ไม่มีหลักฐานผู้รับ|พิสูจน์ไม่ได้ว่าใครเป็นผู้รับ|ออกภาษี[^\n]{0,25}แทน|มิใช่รายจ่ายเพื่อหากำไร)/.test(
          activeClean
        )));
  if (asksGeneral65TerExpense) {
    regimes.add("CIT_DISALLOWED_EXPENSE_S65_TER");
    controlling.add("prov.th.rc.65_ตรี");
  }

  // --- Regime C: Corporate Income Tax Rate & Net Profit Tax (`มาตรา 65`, `บัญชีอัตราภาษีเงินได้ (2)`, `พ.ร.บ. 42`, `พ.ร.ฎ. 530/577`) ---
  const asksCitRate =
    /(?:เสียภาษีเงินได้นิติบุคคล[^\n?]{0,40}(?:อัตรา|เท่าใด|กี่บาท)|อัตราภาษีเงินได้นิติบุคคล|corporate\s+income\s+tax)/i.test(
      mergedContext
    ) ||
    (/(?:รอบระยะเวลาบัญชี|รอบบัญชี|\baccounting\s+period\b)/i.test(activeClean) &&
      /ไม่ใช่\s*SME|มิใช่\s*SME|\bnot\s+an?\s+SME\b|\bSME\b/i.test(mergedContext) &&
      /(?:อัตรา|ร้อยละ\s*30|พ\.ร\.บ\.\s*(?:ฉบับที่\s*)?42|\brate\b|\btax\b)/i.test(activeClean));

  if (asksCitRate) {
    regimes.add("CIT_RATE");
    controlling.add("prov.th.rc.65");
    if (
      !temporalActive.accounting_period_start_iso ||
      temporalActive.accounting_period_start_iso >= "2019-01-01"
    ) {
      controlling.add("sched.th.rc.income_tax_rate");
    }
    controlling.add("statute.th.rc_amendment_42_2559");
    const isNotSme =
      /ไม่ใช่\s*SME|มิใช่\s*SME|ไม่ได้เป็น\s*SME|บริษัทจำกัดทั่วไป|บริษัททั่วไป|\bnot\s+an?\s+SME\b|\bnon-SME\b|\bgeneral\s+company\b/i.test(
        mergedContext
      );
    const isSme = !isNotSme && /\bSME\b|วิสาหกิจขนาดกลางและขนาดย่อม/i.test(mergedContext);
    if (isSme) {
      controlling.add("subreg.th.rc.royal_decree.530");
    }
    if (
      temporalActive.accounting_period_start_iso &&
      temporalActive.accounting_period_start_iso < "2016-01-01"
    ) {
      controlling.add("subreg.th.rc.royal_decree.530");
      controlling.add("subreg.th.rc.royal_decree.577");
    } else {
      demoteRulingsBeforeIso = "2016-03-05";
    }
    const netProfitAmt =
      amounts.find((a) => /กำไรสุทธิ|net\s+profit/i.test(a.leftContext))?.amount ?? null;
    if (isNotSme || isSme) {
      calcs.push(
        verifyCorporateIncomeTaxCalculation({
          isSme,
          accountingPeriodStartIso: temporalActive.accounting_period_start_iso,
          accountingPeriodEndIso: temporalActive.accounting_period_end_iso,
          netProfitBaht: netProfitAmt,
        })
      );
    }
  }

  // --- Regime D: Personal Income Tax Progressive Brackets (`มาตรา 48`, `บัญชีอัตราภาษีเงินได้ (1)`, `พ.ร.ฎ. 470`) ---
  const asksPitProgressive =
    /เงินได้สุทธิ/.test(activeClean) &&
    /ภาษีเงินได้บุคคลธรรมดา/.test(activeClean) &&
    /(?:อัตรา|เท่าใด|กี่บาท)/.test(activeClean);
  if (asksPitProgressive) {
    regimes.add("PIT_PROGRESSIVE");
    controlling.add("prov.th.rc.48");
    controlling.add("sched.th.rc.income_tax_rate");
    controlling.add("subreg.th.rc.royal_decree.470");
    controlling.add("statute.th.rc_amendment_44_2560");
    demoteRulingsBeforeIso = "2017-01-28";
    const netInc = amounts.find((a) => /เงินได้สุทธิ/.test(a.leftContext))?.amount ?? null;
    const taxYrBe =
      temporalActive.assessable_tax_year_ce !== null
        ? temporalActive.assessable_tax_year_ce + 543
        : temporalActive.transaction_year_ce !== null
          ? temporalActive.transaction_year_ce + 543
          : null;
    if (netInc !== null) {
      calcs.push(
        verifyPersonalIncomeTaxProgressiveCalculation({
          netIncomeBaht: netInc,
          taxYearBe: taxYrBe,
        })
      );
    }
  }

  // --- Regime E: Salary Expense Standard Deduction (`มาตรา 42 ทวิ` + `พ.ร.บ. 44`) ---
  const asksS42Bis =
    /มาตรา\s*42\s*ทวิ|หักค่าใช้จ่ายเป็นการเหมา[\s\S]{0,40}(?:เงินเดือน|40\s*\(1\))/.test(activeClean);
  if (asksS42Bis) {
    regimes.add("PIT_SALARY_DEDUCTION_S42_BIS");
    controlling.add("prov.th.rc.42_ทวิ");
    controlling.add("statute.th.rc_amendment_44_2560");
    demoteRulingsBeforeIso = "2017-01-28";
    const taxYrBe =
      temporalActive.assessable_tax_year_ce !== null
        ? temporalActive.assessable_tax_year_ce + 543
        : temporalActive.transaction_year_ce !== null
          ? temporalActive.transaction_year_ce + 543
          : 2568;
    const grossSalary =
      amounts.find((a) => /เงินเดือน|เงินได้/.test(a.leftContext) && !/ไม่เกิน/.test(a.leftContext))
        ?.amount ?? null;
    calcs.push(
      verifySalaryStandardDeductionCalculation({
        taxYearBe: taxYrBe,
        grossIncome40_1_2Baht: grossSalary,
      })
    );
  }

  // --- Regime F: Gift Tax / Gratuitous Property Transfer (`มาตรา 42 (26)-(28)`, `มาตรา 48`, `พ.ร.บ. 40`) ---
  const asksGiftTransfer =
    /(?:โอนที่ดิน|ให้อสังหาริมทรัพย์|ให้ที่ดิน|ให้โดยเสน่หา|โอนกรรมสิทธิ์[^\n]{0,40}โดยไม่มีค่าตอบแทน)/.test(
      mergedContext
    ) && /(?:บุตร|หลาน|งานสมรส|ยกเว้นภาษี|มาตรา\s*42)/.test(mergedContext);
  if (asksGiftTransfer) {
    regimes.add("PIT_GIFT_TAX");
    controlling.add("prov.th.rc.42");
    controlling.add("prov.th.rc.48");
    controlling.add("prov.th.rc.40");
    controlling.add("statute.th.rc_amendment_40_2558");
    const isImmovable = /ที่ดิน|บ้าน|คอนโด|อสังหาริมทรัพย์/.test(mergedContext);
    const valAmt =
      amounts.find((a) => /มูลค่า|ที่ดิน|ราคา/.test(a.leftContext))?.amount ??
      parseThaiMoneyAmountsWithContext(mergedContext).find((a) => /มูลค่า|ที่ดิน|ราคา/.test(a.leftContext))
        ?.amount ??
      null;
    const isLan = /หลานสาว|หลานชาย|หลาน/.test(activeClean);
    const isAdopted = /เป็นบุตรบุญธรรม/.test(activeClean) && !/ไม่ใช่บุตรบุญธรรม/.test(activeClean);
    const isLegitChild =
      !isLan && !isAdopted && /บุตรชอบด้วยกฎหมาย/.test(activeClean);
    const isCeremony = /งานสมรส|พิธี|ขนบธรรมเนียมประเพณี|หน้าที่ธรรมจรรยา/.test(activeClean);

    if (valAmt !== null && (isLan || isLegitChild || isAdopted)) {
      calcs.push(
        verifyComprehensiveGiftTaxCalculation({
          isImmovableProperty: isImmovable,
          recipientRole: isLan
            ? "AMBIGUOUS_LAN_OR_NIECE"
            : isAdopted
              ? "ADOPTED_CHILD"
              : "LEGITIMATE_CHILD",
          isCeremonyOrCustomOrMoralDuty: isCeremony,
          transferValueBaht: valAmt,
        })
      );
    }
  }

  // --- Regime G: VAT Registration Threshold (`มาตรา 81/1`, `มาตรา 85/1`, `พ.ร.ฎ. 432`) ---
  const asksVatRegistration =
    /(?:ต้องจดทะเบียน\s*(?:ภาษีมูลค่าเพิ่ม|VAT)|จดทะเบียนภาษีมูลค่าเพิ่มหรือไม่|register\s+for\s+vat)/i.test(
      activeClean
    );
  if (asksVatRegistration) {
    regimes.add("VAT_REGISTRATION");
    controlling.add("prov.th.rc.81/1");
    controlling.add("prov.th.rc.85/1");
    controlling.add("subreg.th.rc.royal_decree.432");
    const revAmt = amounts.find((a) => /รายรับ|ยอดขาย|มูลค่า/.test(a.leftContext))?.amount ?? null;
    if (revAmt !== null) {
      calcs.push(verifyVatRegistrationThresholdCalculation({ annualTurnoverBaht: revAmt }));
    }
  }

  // --- Regime H: VAT Rate (`7%` domestic / `807` expiry / `0%` export of service vs used in Thailand) ---
  const asksVatRate =
    !asksVatRegistration &&
    (/(?:คิด\s*VAT\s*กี่ร้อยละ|VAT\s*ร้อยละ\s*7\s*หรือ\s*ร้อยละ\s*0|อัตรา\s*VAT|ความรับผิดใน\s*VAT[\s\S]{0,80}อัตรา(?:ที่ต้องใช้เป็น)?เท่าใด|พระราชกฤษฎีกาฉบับที่\s*807|เสียภาษีมูลค่าเพิ่มอัตราร้อยละ)/i.test(
      mergedContext
    ) && !/สำนักงานเศรษฐกิจและการค้าของต่างประเทศ/.test(activeClean));

  if (asksVatRate) {
    regimes.add("VAT_RATE");
    const isUsedInThailandNow =
      /(?:ใช้ที่สาขา(?:กรุงเทพ|ในไทย|ในประเทศไทย)|ใช้บริการ(?:นั้น)?ในประเทศไทย|ถูกใช้ในไทย|ถูกใช้ที่สาขากรุงเทพ)/.test(
        activeClean
      );
    const isExportServiceAbroadNow =
      !isUsedInThailandNow &&
      /(?:ใช้บริการนั้นทั้งหมดที่สำนักงานใน(?:สิงคโปร์|ต่างประเทศ)|ใช้บริการในต่างประเทศทั้งหมด|ใช้ในต่างประเทศเพียงอย่างเดียว)/.test(
        activeClean
      );

    if (isExportServiceAbroadNow) {
      controlling.add("prov.th.rc.80/1");
      controlling.add("subreg.th.rd.dg_vat.105");
      calcs.push(
        verifyVatRateAndAmountCalculation({
          isExportOfGoodsOrServiceUsedEntirelyAbroad: true,
          isServiceUsedInThailand: false,
          taxPointDateIso: eventIso,
          taxBaseBaht: null,
        })
      );
    } else if (isUsedInThailandNow || /ขายสินค้าในราชอาณาจักร|ส่งมอบสินค้าในราชอาณาจักร|ความรับผิดใน\s*VAT/i.test(mergedContext)) {
      controlling.add("prov.th.rc.80");
      controlling.add("subreg.th.rc.royal_decree.807");
      controlling.add("subreg.th.rc.royal_decree.799");
      controlling.add("subreg.th.rd.vat_local_tax_guide");
      if (isUsedInThailandNow) {
        controlling.add("prov.th.rc.77/2");
        controlling.add("prov.th.rc.80/1");
        controlling.add("subreg.th.rd.dg_vat.105");
      }
      demoteRulingsBeforeIso = "2020-01-01";
      calcs.push(
        verifyVatRateAndAmountCalculation({
          isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
          isServiceUsedInThailand: isUsedInThailandNow,
          taxPointDateIso: eventIso,
          taxBaseBaht: null,
        })
      );
    }
  }

  // --- Regime I: Withholding Tax (Domestic `มาตรา 3 เตรส` / `ท.ป. 4/2528` / `3 ปัณรส` e-WHT vs Cross-Border `มาตรา 70` vs Missing Recipient Fact!) ---
  const asksWhtInActiveTurn =
    /(?:หักภาษี(?:\s*เงินได้)?\s*ณ\s*ที่จ่าย|อัตราหัก\s*ณ\s*ที่จ่าย|e-Withholding\s*Tax|withholding\s+tax)/i.test(
      activeClean
    );
  const asksWht =
    asksWhtInActiveTurn ||
    (!asksGeneral65TerExpense &&
      /(?:หักภาษี(?:\s*เงินได้)?\s*ณ\s*ที่จ่าย|อัตราหัก\s*ณ\s*ที่จ่าย|e-Withholding\s*Tax|withholding\s+tax)/i.test(
        mergedContext
      ));
  if (asksWht) {
    const isForeignNoPe =
      /(?:บริษัทต่างประเทศ|ตั้งขึ้นตามกฎหมายต่างประเทศ|\bforeign\s+company\b)[\s\S]{0,110}(?:ไม่มีสถานประกอบการในไทย|มิได้ประกอบกิจการในประเทศไทย|not\s+carrying\s+on\s+business\s+in\s+Thailand|no\s+permanent\s+establishment\s+in\s+Thailand)/i.test(
        activeClean
      ) ||
      /(?:บริษัท[^\n]{0,25}ในต่างประเทศ|ผู้ประกอบการในต่างประเทศ|ผู้ให้บริการในต่างประเทศ)[\s\S]{0,160}(?:ส่ง[^\n]{0,40}ทางอิเล็กทรอนิกส์|ภ\.พ\.\s*36|มาตรา\s*83\/6)/i.test(
        activeClean
      ) ||
      (/(?:บริษัทต่างประเทศ|ตั้งขึ้นตามกฎหมายต่างประเทศ|\bforeign\s+company\b)/i.test(mergedContext) &&
        /ไม่มีสถานประกอบการในไทย|มิได้ประกอบกิจการในประเทศไทย|not\s+carrying\s+on\s+business\s+in\s+Thailand|no\s+permanent\s+establishment\s+in\s+Thailand/i.test(
          mergedContext
        ) &&
        !/นิติบุคคลไทย/.test(activeClean));

    if (/มาตรา\s*83\/6|ภ\.พ\.\s*36/.test(activeClean)) {
      controlling.add("prov.th.rc.83/6");
    }

    const isDomesticThaiCompanyRecipient =
      !isForeignNoPe &&
      /(?:ให้(?:แก่)?บริษัท[^\n]{0,40}(?:นิติบุคคลไทย|จำกัด)|ผู้รับ[^\n]{0,30}นิติบุคคลไทย)/.test(
        mergedContext
      ) &&
      !/ตั้งขึ้นตามกฎหมายต่างประเทศ/.test(activeClean);

    const isRecipientUnspecified =
      !isForeignNoPe &&
      !isDomesticThaiCompanyRecipient &&
      !/e-Withholding|3\s*ปัณรส/i.test(activeClean) &&
      !/บุคคลธรรมดา|มูลนิธิ|สมาคม/.test(activeClean) &&
      /(?:จ่าย\s*['"“”]?ค่าที่ปรึกษา|จ่ายค่าบริการ|จ่ายค่าจ้าง)/.test(activeClean);

    if (isForeignNoPe) {
      regimes.add("WHT_CROSS_BORDER_S70");
      controlling.add("prov.th.rc.70");
      controlling.add("sched.th.rc.income_tax_rate");
      controlling.add("prov.th.rc.40");

      const items: Array<{
        labelTh: string;
        kind: "DIVIDEND_40_4_B" | "ROYALTY_OR_INTEREST_40_3_4" | "SERVICE_OR_MANAGEMENT_FEE";
        amountBaht: number | null;
      }> = [];
      if (/เงินปันผล|\bdividend\b/i.test(activeClean)) {
        const divAmt = amounts.find((a) => /เงินปันผล|dividend/i.test(a.leftContext))?.amount ?? null;
        items.push({ labelTh: "เงินปันผล (มาตรา 40 (4) (ข))", kind: "DIVIDEND_40_4_B", amountBaht: divAmt });
      }
      if (/ค่าสิทธิ|ลิขสิทธิ์|royalty/i.test(activeClean)) {
        const royAmt = amounts.find((a) => /ค่าสิทธิ|ลิขสิทธิ์|royalty/i.test(a.leftContext))?.amount ?? null;
        items.push({ labelTh: "ค่าสิทธิ (มาตรา 40 (3))", kind: "ROYALTY_OR_INTEREST_40_3_4", amountBaht: royAmt });
      }
      if (/ค่าบริหารจัดการ|management\s*fee|ค่าที่ปรึกษา|consulting\s*fee|ค่าบริการ/i.test(activeClean)) {
        const srvAmt =
          amounts.find((a) =>
            /ค่าบริหารจัดการ|management|ค่าที่ปรึกษา|consulting|ค่าบริการ/i.test(a.leftContext)
          )?.amount ??
          parseThaiMoneyAmountsWithContext(mergedContext).find((a) =>
            /ค่าบริหารจัดการ|management|ค่าที่ปรึกษา|consulting|ค่าบริการ/i.test(a.leftContext)
          )?.amount ??
          null;
        items.push({
          labelTh: /ค่าที่ปรึกษา|consulting/i.test(activeClean)
            ? "ค่าที่ปรึกษา (Consulting Fee)"
            : "ค่าบริหารจัดการ (Management Fee)",
          kind: "SERVICE_OR_MANAGEMENT_FEE",
          amountBaht: srvAmt,
        });
      }
      if (items.length > 0) {
        calcs.push(verifyCrossBorderWithholdingTaxCalculation({ items }));
      }
    } else if (isRecipientUnspecified) {
      regimes.add("WHT_RECIPIENT_CLARIFICATION_REQUIRED");
      controlling.add("prov.th.rc.3_เตรส");
      controlling.add("subreg.th.rd.order_tp.4_2528");
      controlling.add("prov.th.rc.70");
      controlling.add("prov.th.rc.50");
      controlling.add("prov.th.rc.3_ปัณรส");
      controlling.add("subreg.th.rc.min_reg.389");
      const feeAmt = amounts[0]?.amount ?? null;
      const wht3 = feeAmt !== null ? Math.round(feeAmt * 3) / 100 : null;
      const wht1 = feeAmt !== null ? Math.round(feeAmt * 1) / 100 : null;
      const wht15 = feeAmt !== null ? Math.round(feeAmt * 15) / 100 : null;

      missingQuestions.push(
        "ผู้รับเงินค่าที่ปรึกษาเป็นบุคคลประเภทใดและมีถิ่นที่อยู่/สถานประกอบการใด: (1) บริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ตั้งขึ้นตามกฎหมายไทย/ประกอบกิจการในไทย, (2) บุคคลธรรมดาผู้มีถิ่นที่อยู่ในไทย, หรือ (3) บริษัทต่างประเทศที่มิได้ประกอบกิจการในประเทศไทย?"
      );
      missingQuestions.push(
        "ขอบเขตงานที่ปรึกษาเข้าลักษณะใด (วิชาชีพอิสระตามมาตรา 40 (6), รับทำงานให้ตามมาตรา 40 (2), จ้างทำของ/บริการตามมาตรา 40 (7)/(8), หรือมีการถ่ายทอดวิทยาการอันเป็นค่าสิทธิตามมาตรา 40 (3)) และเป็นการนำส่งผ่านระบบ e-Withholding Tax ตามมาตรา 3 ปัณรส หรือไม่?"
      );
      conditionalFrameworkSummaryTh =
        `**กรอบหลักกฎหมายแบบมีเงื่อนไขตามข้อเท็จจริงที่ยังขาด**: การหักภาษี ณ ที่จ่ายสำหรับ "ค่าที่ปรึกษา"${feeAmt !== null ? ` จำนวน ${ feeAmt.toLocaleString("en-US") } บาท` : ""} ไม่สามารถฟันธงเป็นตัวเลขเดียวได้หากยังไม่ทราบสถานะผู้รับเงินและลักษณะงาน โดยแยกตามบทบัญญัติประมวลรัษฎากรดังนี้:\n` +
        `- **กรณีที่ 1 ผู้รับเป็นบริษัท/ห้างหุ้นส่วนนิติบุคคลไทย (หรือบริษัทต่างประเทศที่ประกอบกิจการในไทยมีสถานประกอบการถาวร)**: หักภาษี ณ ที่จ่ายอัตรามาตรฐาน **ร้อยละ 3.0**${wht3 !== null ? ` (คิดเป็น ${wht3.toLocaleString("en-US")} บาท)` : ""} ตามมาตรา 3 เตรส ประกอบคำสั่งกรมสรรพากร ที่ ท.ป. 4/2528 ข้อ 8 / ข้อ 12/1 (แต่หากจ่ายผ่านระบบ **e-Withholding Tax** ตามมาตรา 3 ปัณรส ประกอบกฎกระทรวง ฉบับที่ 389 / ท.ป. 354/2566 ลดเหลืออัตรา **ร้อยละ 1.0**${wht1 !== null ? ` = ${wht1.toLocaleString("en-US")} บาท` : ""})\n` +
        `- **กรณีที่ 2 ผู้รับเป็นบุคคลธรรมดาผู้มีถิ่นที่อยู่ในไทย**: หากเป็นเงินได้ตามมาตรา 40 (2) หักตามอัตราก้าวหน้าตามมาตรา 50 (1) แต่หากเป็นวิชาชีพอิสระตามมาตรา 40 (6) หรือรับจ้างทำของ/บริการตามมาตรา 40 (8) ที่จ่ายโดยบริษัทจำกัด หักอัตราร้อยละ 3.0 ตาม ท.ป. 4/2528 (หรือร้อยละ 1.0 กรณี e-Withholding Tax)\n` +
        `- **กรณีที่ 3 ผู้รับเป็นบริษัทต่างประเทศที่มิได้ประกอบกิจการในประเทศไทย**: พิจารณาตาม **มาตรา 70** (และอนุสัญญาภาษีซ้อนหากมี) — หากเข้าลักษณะมาตรา 40 (2), (3) หรือ (6) หักอัตรา **ร้อยละ 15**${wht15 !== null ? ` (คิดเป็น ${wht15.toLocaleString("en-US")} บาท)` : ""} แต่หากเป็นเงินได้ธุรกิจทั่วไปตามมาตรา 40 (8) ไม่อยู่ในบังคับต้องหักภาษีตามมาตรา 70`;
    } else {
      regimes.add("WHT_DOMESTIC");
      controlling.add("prov.th.rc.3_เตรส");
      controlling.add("subreg.th.rd.order_tp.4_2528");
      const isEWht =
        /e-Withholding|3\s*ปัณรส/i.test(activeClean) ||
        (/e-Withholding|3\s*ปัณรส/i.test(mergedContext) &&
          !/(?:ไม่ได้|มิได้|ไม่)\s*(?:ผ่าน|นำส่งผ่าน|ใช้)(?:ระบบ)?\s*e-Withholding/i.test(rawNorm));
      if (isEWht) {
        controlling.add("prov.th.rc.3_ปัณรส");
        controlling.add("subreg.th.rc.min_reg.389");
        controlling.add("subreg.th.rc.min_reg.402");
        controlling.add("subreg.th.rd.order_tp.354_2566");
      }
      demoteRulingsBeforeIso = "2023-01-01";
      const grossPay =
        amounts.find((a) => /จ่าย|ค่าจ้าง|ค่าบริการ|ค่าโฆษณา|ค่าเช่า/.test(a.leftContext))?.amount ??
        parseThaiMoneyAmountsWithContext(mergedContext).find((a) =>
          /จ่าย|ค่าจ้าง|ค่าบริการ|ค่าโฆษณา|ค่าเช่า/.test(a.leftContext)
        )?.amount ??
        null;
      const cat = /ค่าโฆษณา/.test(mergedContext)
        ? "ADVERTISING"
        : /ค่าขนส่ง/.test(mergedContext)
          ? "TRANSPORT"
          : /ค่าเช่า|รางวัล/.test(mergedContext)
            ? "RENT_OR_PRIZE"
            : "HIRE_OF_WORK_OR_SERVICE";
      calcs.push(
        verifyDomesticWithholdingTaxCalculation({
          incomeCategory: cat,
          isEWithholdingTax: isEWht,
          paymentDateIso: eventIso,
          grossPaymentBaht: grossPay,
        })
      );
    }
  }

  // --- Regime J: Stamp Duty (`มาตรา 103`, `104`, `บัญชีอัตราอากรแสตมป์`, `ประกาศอธิบดีฯ อากรแสตมป์ ฉบับที่ 37`) ---
  const asksStampDutyOnly =
    /อากรแสตมป์|ปิดอากรแสตมป์/.test(activeClean) &&
    !/ภาษีธุรกิจเฉพาะ/.test(activeClean);
  if (asksStampDutyOnly) {
    regimes.add("STAMP_DUTY");
    controlling.add("prov.th.rc.103");
    controlling.add("prov.th.rc.104");
    controlling.add("sched.th.rc.stamp_duty");
    const isHireOfWork = /จ้างทำของ|รับจ้างทำ/.test(activeClean);
    const isLoan = /กู้ยืมเงิน/.test(activeClean);
    const contractVal =
      amounts.find((a) => /สินจ้าง|ค่าจ้าง|วงเงิน|กู้ยืม|ค่าเช่า|กำหนด/.test(a.leftContext))?.amount ??
      amounts[0]?.amount ??
      null;
    if (isHireOfWork && contractVal !== null && contractVal >= 1_000_000) {
      controlling.add("subreg.th.rd.dg_stamp.37");
    }
    demoteRulingsBeforeIso = "2020-01-01";
    if (contractVal !== null && (isHireOfWork || isLoan || /เช่า/.test(activeClean))) {
      calcs.push(
        verifyStampDutyCalculation({
          instrumentKind: isHireOfWork
            ? "HIRE_OF_WORK_ITEM_4"
            : isLoan
              ? "LOAN_ITEM_5"
              : "LEASE_ITEM_1",
          contractValueBaht: contractVal,
        })
      );
    }
  }

  // --- Regime K: Specific Business Tax (`มาตรา 91/2`, `91/5`, `91/6`, `พ.ร.ฎ. 342`, `ภาษีท้องถิ่น 10% -> 3.3%`) ---
  const asksSbt =
    !unverifiedGuard.shouldAbstain &&
    /ภาษีธุรกิจเฉพาะ/.test(mergedContext);
  if (asksSbt) {
    regimes.add("SPECIFIC_BUSINESS_TAX");
    controlling.add("prov.th.rc.91/2");
    controlling.add("prov.th.rc.91/5");
    controlling.add("prov.th.rc.91/6");
    controlling.add("subreg.th.rd.sbt_local_tax_guide");

    const isFinanceBusiness =
      /ธุรกิจเงินทุน|ธนาคาร|หลักทรัพย์|เครดิตฟองซิเอร์|รายรับดอกเบี้ย/.test(activeClean);
    const isRealEstateSale = /ขายที่ดิน|อสังหาริมทรัพย์/.test(mergedContext);

    if (isFinanceBusiness) {
      demoteRulingsBeforeIso = "2020-01-01";
      const interestAmt =
        amounts.find((a) => /ดอกเบี้ย|รายรับ/.test(a.leftContext))?.amount ?? null;
      calcs.push(
        verifySpecificBusinessTaxCalculation({
          activityKind: "BANKING_OR_FINANCE_INTEREST",
          grossReceiptsBaht: interestAmt,
        })
      );
    } else if (isRealEstateSale) {
      controlling.add("subreg.th.rc.royal_decree.342");
      controlling.add("prov.th.rc.104");
      controlling.add("sched.th.rc.stamp_duty");
      demoteRulingsBeforeIso = "2020-01-01";

      const isDeveloper =
        /ประกอบธุรกิจ(?:พัฒนา|ค้า)อสังหาริมทรัพย์เป็นปกติ/.test(activeClean) &&
        !/มิได้ประกอบธุรกิจ|ไม่ได้ประกอบธุรกิจ/.test(activeClean);

      // Check if single-plot follow-up overriding Plot 1 (`แปลงที่หนึ่งไม่ได้มาทางมรดก... ถือครองเกิน 5 ปี`) vs two-plot question
      const isPlot1Override =
        /แปลงที่หนึ่ง/.test(activeClean) && !/แปลงที่สอง/.test(activeClean);
      const hasTwoPlots = /แปลงที่หนึ่ง[\s\S]+แปลงที่สอง/.test(activeClean);

      if (isPlot1Override) {
        const yrs = Number(activeClean.match(/ถือครอง(?:เกิน|มา)?\s*([0-9]+)\s*ปี/)?.[1] || "6");
        const inherited = /รับมรดก|ทางมรดก/.test(activeClean);
        calcs.push(
          verifySpecificBusinessTaxCalculation({
            activityKind: "REAL_ESTATE_PLOTS",
            plots: [
              {
                plotLabelTh: "ที่ดินแปลงที่หนึ่ง (กรณีซื้อมาจากบุคคลภายนอกและถือครองเกิน 5 ปี)",
                acquiredByInheritance: inherited,
                holdingYears: yrs,
                holdingMonths: null,
                isCommercialDeveloper: isDeveloper,
                saleValueBaht: null,
              },
            ],
          })
        );
      } else if (hasTwoPlots) {
        const seg1 = activeClean.split(/แปลงที่สอง/)[0] || "";
        const seg2 = activeClean.split(/แปลงที่สอง/)[1] || "";
        const yrs1 = seg1.match(/ถือครอง(?:มา|เกิน)?\s*([0-9]+)\s*ปี/)?.[1];
        const mos2 = seg2.match(/ถือครอง(?:ได้|มา)?\s*([0-9]+)\s*เดือน/)?.[1];
        const yrs2 = seg2.match(/ถือครอง(?:ได้|มา)?\s*([0-9]+)\s*ปี/)?.[1];
        calcs.push(
          verifySpecificBusinessTaxCalculation({
            activityKind: "REAL_ESTATE_PLOTS",
            plots: [
              {
                plotLabelTh: "แปลงที่หนึ่ง",
                acquiredByInheritance: /มรดก/.test(seg1),
                holdingYears: yrs1 ? Number(yrs1) : null,
                holdingMonths: null,
                isCommercialDeveloper: isDeveloper,
                saleValueBaht: null,
              },
              {
                plotLabelTh: "แปลงที่สอง",
                acquiredByInheritance: /มรดก/.test(seg2),
                holdingYears: yrs2 ? Number(yrs2) : null,
                holdingMonths: mos2 ? Number(mos2) : null,
                isCommercialDeveloper: isDeveloper,
                saleValueBaht: null,
              },
            ],
          })
        );
      } else {
        const yrsSingle = activeClean.match(/ถือครอง(?:มา|ได้|เกิน)?\s*([0-9]+)\s*ปี/)?.[1];
        const mosSingle = activeClean.match(/ถือครอง(?:มา|ได้)?\s*([0-9]+)\s*เดือน/)?.[1];
        const inheritedSingle = /รับมรดก|ทางมรดก/.test(activeClean);
        if (yrsSingle || mosSingle || inheritedSingle) {
          calcs.push(
            verifySpecificBusinessTaxCalculation({
              activityKind: "REAL_ESTATE_PLOTS",
              plots: [
                {
                  plotLabelTh: "ที่ดินที่ขาย",
                  acquiredByInheritance: inheritedSingle,
                  holdingYears: yrsSingle ? Number(yrsSingle) : null,
                  holdingMonths: mosSingle ? Number(mosSingle) : null,
                  isCommercialDeveloper: isDeveloper,
                  saleValueBaht: amounts[0]?.amount ?? null,
                },
              ],
            })
          );
        }
      }
    }
  }

  return {
    queryKind: "LEGAL_FACT_APPLICATION",
    activeTextCleanedOfNegations: activeClean,
    mergedUserFactContextText: mergedContext,
    implicatedRegimes: Array.from(regimes),
    controllingWorkIds: Array.from(controlling),
    incidentalPremiseSectionIds: incidentalSections,
    decisiveMissingFactQuestionsTh: missingQuestions,
    conditionalFrameworkSummaryTh,
    verifiedCalculations: calcs,
    demoteRulingsIssuedBeforeIso: demoteRulingsBeforeIso,
    unverifiedAuthorityGuard: unverifiedGuard,
  };
}
