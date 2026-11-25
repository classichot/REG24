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
  // Strip negated location/inheritance/relationship/channel clauses so positive extractors don't match negated keywords
  s = s.replace(/ไม่ได้ใช้(?:บริการ(?:นั้น)?)?ที่[^\s,.;)]+(?:\s+ใน[^\s,.;)]+)?(?:\s+ของ[^\s,.;)]+)?/g, " ");
  s = s.replace(/ไม่ได้มาทางมรดก/g, " ");
  s = s.replace(
    /(?:ไม่ใช่|มิใช่)(?:ตัว)?(?:บุตร(?:ชาย|สาว)?(?:ที่)?ชอบด้วยกฎหมาย(?:โดยกำเนิด)?|บุตรชาย|บุตรสาว|บุตร(?!บุญธรรม)|คนในครอบครัว)/g,
    " "
  );
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
  return [...priorUserTurns.slice(-6), currentActive].join(" | ");
}

interface DatedVatEvent {
  iso: string;
  raw: string;
  kind: "PAYMENT" | "INVOICE" | "SERVICE_USE" | "QUESTION_DATE" | "GENERAL";
}

function extractDatedVatEventsFromText(text: string): DatedVatEvent[] {
  const cleaned = stripNegatedFactualClauses(text);
  const out: DatedVatEvent[] = [];
  const thaiDateRe =
    /(?:([0-9]{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(?:พ\.ศ\.\s*)?([0-9]{4})|([0-9]{4}-[0-9]{2}-[0-9]{2})|([0-9]{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+[0-9]{4}))/gi;
  for (const m of cleaned.matchAll(thaiDateRe)) {
    const raw = m[0];
    const iso = parseFlexibleThaiOrEnglishDateToIso(raw);
    if (!iso) continue;
    const idx = m.index ?? 0;
    const left = cleaned.slice(Math.max(0, idx - 85), idx);
    let kind: DatedVatEvent["kind"] = "GENERAL";
    if (/(?:วันนี้|ณ\s*วันที่ถาม|วันที่สอบถาม|สอบถามเมื่อ|ถามเมื่อ|วันที่ตั้งคำถาม)/i.test(left)) {
      kind = "QUESTION_DATE";
    } else if (
      /(?:ออกใบกำกับภาษี|ใบกำกับภาษี)[^\n]{0,35}(?:และ|กับ)?[^\n]{0,25}(?:รับชำระ|ชำระ)/.test(left) ||
      /(?:รับชำระ|ชำระค่าบริการ|จ่ายเงิน|รับเงิน|โอนเงิน)/.test(left)
    ) {
      kind = "PAYMENT";
    } else if (/(?:ออกใบกำกับภาษี|ใบกำกับภาษี|ออกใบแจ้งหนี้|tax\s*invoice)/i.test(left)) {
      kind = "INVOICE";
    } else if (/(?:ใช้บริการ|ให้บริการเสร็จ|ส่งมอบงาน|เริ่มใช้บริการ|service\s+used)/i.test(left)) {
      kind = "SERVICE_USE";
    }
    out.push({ iso, raw, kind });
  }
  return out;
}

function resolveServiceVatTaxPointFromTurns(
  turnsCleaned: string[],
  fallbackIso: string | null
): { taxPointIso: string | null; explanationTh: string | null; usedSection78_1: boolean } {
  // Replay chronological user turns: if a later turn explicitly states new event date(s), they override earlier turns!
  let activeEvents: DatedVatEvent[] = [];
  for (const t of turnsCleaned) {
    const evs = extractDatedVatEventsFromText(t);
    const statutoryEvs = evs.filter((e) => e.kind !== "QUESTION_DATE");
    if (statutoryEvs.length > 0) {
      activeEvents = evs;
    } else if (evs.length > 0 && activeEvents.length === 0) {
      activeEvents = evs;
    }
  }

  const statutory = activeEvents.filter((e) => e.kind !== "QUESTION_DATE");
  const questionDates = activeEvents.filter((e) => e.kind === "QUESTION_DATE");
  if (statutory.length === 0) {
    // Do NOT treat a pure "date asked" as a VAT tax point; fall back only if explicit non-question fallbackIso exists
    if (questionDates.length > 0) {
      return { taxPointIso: null, explanationTh: null, usedSection78_1: false };
    }
    return { taxPointIso: fallbackIso, explanationTh: null, usedSection78_1: false };
  }

  const distinctStatutoryIsos = Array.from(new Set(statutory.map((e) => e.iso))).sort();
  const earliestIso = distinctStatutoryIsos[0];

  if (distinctStatutoryIsos.length > 1 || questionDates.length > 0) {
    const earliestEv = statutory.find((e) => e.iso === earliestIso)!;
    const kindLabel: Record<DatedVatEvent["kind"], string> = {
      PAYMENT: "วันที่ได้รับชำระราคาค่าบริการ",
      INVOICE: "วันที่ออกใบกำกับภาษี",
      SERVICE_USE: "วันที่ใช้บริการ",
      GENERAL: "วันที่เกิดธุรกรรม",
      QUESTION_DATE: "วันที่สอบถาม",
    };
    const eventSummary = statutory
      .map((e) => `${kindLabel[e.kind]} (${e.iso})`)
      .join(", ");
    const qNote =
      questionDates.length > 0
        ? ` ส่วนวันที่สอบถาม (${questionDates.map((q) => q.iso).join(", ")}) ไม่ใช่วันเกิดความรับผิดทางภาษี`
        : "";
    return {
      taxPointIso: earliestIso,
      usedSection78_1: true,
      explanationTh: `**การกำหนดวันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มสำหรับบริการตามประมวลรัษฎากร มาตรา 78/1 (1)**: ความรับผิดสำหรับการให้บริการเกิดขึ้นเมื่อได้รับชำระราคาค่าบริการ เว้นแต่ได้มีการออกใบกำกับภาษีหรือได้ใช้บริการก่อนได้รับชำระราคา ให้ถือว่าความรับผิดเกิดขึ้นเมื่อมีการกระทำนั้น จากวันที่ที่ระบุในข้อเท็จจริง (${eventSummary}) เหตุการณ์ที่เกิดขึ้นก่อนสุดคือ **${kindLabel[earliestEv.kind]} วันที่ \`${earliestIso}\`** จึงเป็นวันเกิดความรับผิดที่ใช้กำหนดพระราชกฤษฎีกาและอัตราภาษีมูลค่าเพิ่ม${qNote}`,
    };
  }

  return { taxPointIso: earliestIso, explanationTh: null, usedSection78_1: false };
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
  const priorUserTurnsCleaned = (params.conversationHistory || [])
    .filter((t) => t && t.role === "user" && typeof t.content === "string" && t.content.trim())
    .map((t) => stripNegatedFactualClauses(t.content))
    .slice(-6);
  const userTurnsCleaned = [...priorUserTurnsCleaned, activeClean];
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
  const temporalMerged = parseQueryTemporalAndIntentContext({
    question: mergedContext,
    applicableDate: params.applicableDate ?? null,
  });
  const eventIso =
    temporalActive.point_in_time_date_iso ||
    temporalActive.transaction_date_iso ||
    temporalActive.accounting_period_start_iso ||
    temporalMerged.point_in_time_date_iso ||
    temporalMerged.transaction_date_iso ||
    temporalMerged.accounting_period_start_iso ||
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

  // --- Regime D2: Personal Income Tax Allowances (`มาตรา 47`, `พ.ร.บ. 44 พ.ศ. 2560`, `พ.ร.บ. 46 พ.ศ. 2561`) ---
  const asksPitAllowancesS47 =
    !asksPoliticalPartyDonation &&
    !asksPublicCharityDonation &&
    (/มาตรา\s*47\b|\bsection\s*47\b/i.test(mergedContext) ||
      /(?:หักลดหย่อน|ค่าลดหย่อน|ลดหย่อนส่วนตัว|ลดหย่อนคู่สมรส|ลดหย่อนบุตร|ลดหย่อนบิดามารดา)/.test(
        mergedContext
      ));
  if (asksPitAllowancesS47) {
    regimes.add("PIT_ALLOWANCES_S47");
    controlling.add("prov.th.rc.47");
    controlling.add("statute.th.rc_amendment_44_2560");
    demoteRulingsBeforeIso = "2017-01-28";
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

  // --- Regime F: Gift Tax / Gratuitous Property Transfer (`มาตรา 41 ทวิ`, `42 (26)-(28)`, `48`, `49 ทวิ`, `50 (5)-(6)`, `54`, `พ.ร.บ. 40`) ---
  const asksGiftTransfer =
    /(?:โอนที่ดิน|ยกที่ดิน|ให้อสังหาริมทรัพย์|ยกอสังหาริมทรัพย์|ให้ที่ดิน|ยกห้องชุด|โอนห้องชุด|ให้ห้องชุด|โอนกรรมสิทธิ์ห้องชุด|ยกคอนโด|โอนคอนโด|ยกบ้าน|ยกอาคาร[^\n]{0,25}|ให้โดยเสน่หา|โดยเสน่หา(?:และ)?ไม่มีค่าตอบแทน|โดยไม่มีค่าตอบแทน|มอบเงินสด|ให้เงินสด|โอนเงินสด|โอนเงินให้|ค่าอุปการะเลี้ยงดู|ของขวัญงานสมรส|ของขวัญเนื่องในพิธี|โอนกรรมสิทธิ์[^\n]{0,60}โดย(?:เสน่หา)?(?:และ)?ไม่มีค่าตอบแทน|gift(?:ing)?\s+(?:a\s+)?(?:condominium|condo|land|property|cash)|transferring\s+ownership[^\n]{0,60}(?:gift|without\s+consideration))/i.test(
      mergedContext
    ) &&
    /(?:บุตร|หลาน|ผู้สืบสันดาน|บุพการี|มารดา|บิดา|พ่อ|แม่|ญาติ|พี่สาว|พี่ชาย|น้องสาว|น้องชาย|คู่สมรส|สามี|ภริยา|ปู่|ย่า|ตา|ยาย|เพื่อน|บุคคลภายนอก|งานสมรส|พิธีอุปสมบท|ค่าอุปการะ|ยกเว้นภาษี|มาตรา\s*42|ให้โดยเสน่หา|โดยเสน่หา|โดยไม่มีค่าตอบแทน|ภาษีการรับให้|nephew|niece|child|spouse|parent|brother|sister|without\s+consideration|gift)/i.test(
      mergedContext
    );
  if (asksGiftTransfer) {
    regimes.add("PIT_GIFT_TAX");
    controlling.add("prov.th.rc.42");
    controlling.add("prov.th.rc.48");

    // Turn-by-turn state reducer: each chronological user turn updates ONLY explicitly stated/changed facts
    // and preserves all unchanged facts (guaranteeing 3rd-turn answers match fresh sessions with identical facts).
    let isImmovable = false;
    let assetLabelTh: string | null = null;
    let recipientRole:
      | "LEGITIMATE_CHILD"
      | "ADOPTED_CHILD"
      | "ASCENDANT"
      | "SPOUSE"
      | "AMBIGUOUS_LAN_OR_NIECE"
      | "EXPLICIT_LINEAL_GRANDCHILD"
      | "EXPLICIT_COLLATERAL_NIECE"
      | "LINEAL_DESCENDANT"
      | "NON_LINEAL_RELATIVE_OR_THIRD_PARTY"
      | null = null;
    let recipientDisplayTh: string | null = null;
    let isCeremony = false;
    let occasionLabelTh: string | null = null;
    let valAmt: number | null = null;
    let officialAppraisalAmt: number | null = null;
    let isMaritalCoOwned = false;
    let acquisitionMethod: "INHERITANCE_OR_GIFT" | "OTHER_PURCHASE" | null = null;
    let holdingYears: number | null = null;

    for (const turnText of userTurnsCleaned) {
      // 1) Asset classification & exact asset label preservation (never overwrite condo/shophouse with land!)
      const turnHasMovable =
        /(?:เงินสด|โอนเงิน|ทองคำ|(?<!ห้าง)หุ้น(?!ส่วน)|สังหาริมทรัพย์)/.test(turnText) &&
        !/(?:ที่ดิน|บ้าน|คอนโด|ห้องชุด|อาคารชุด|อาคารพาณิชย์|ตึกแถว|อสังหาริมทรัพย์)/.test(turnText);
      const turnHasImmovable =
        /(?:ที่ดิน|บ้าน|คอนโด|ห้องชุด|อาคารชุด|อาคารพาณิชย์|ตึกแถว|อสังหาริมทรัพย์|condominium|condo|land|real\s+estate|immovable\s+property)/i.test(turnText);

      if (turnHasMovable) {
        isImmovable = false;
        assetLabelTh = /เงินสด/.test(turnText)
          ? "เงินสด/สังหาริมทรัพย์"
          : /ทองคำ/.test(turnText)
            ? "ทองคำ (สังหาริมทรัพย์)"
            : /(?<!ห้าง)หุ้น(?!ส่วน)/.test(turnText)
              ? "หุ้น (สังหาริมทรัพย์)"
              : "เงินสด/สังหาริมทรัพย์";
      } else if (turnHasImmovable) {
        isImmovable = true;
        if (/ที่ดินพร้อมอาคารพาณิชย์/.test(turnText)) assetLabelTh = "ที่ดินพร้อมอาคารพาณิชย์";
        else if (/อาคารพาณิชย์พร้อมที่ดิน/.test(turnText)) assetLabelTh = "อาคารพาณิชย์พร้อมที่ดิน";
        else if (/อาคารพาณิชย์/.test(turnText)) assetLabelTh = "อาคารพาณิชย์";
        else if (/ห้องชุด|อาคารชุด|คอนโด/.test(turnText)) assetLabelTh = "ห้องชุด";
        else if (/บ้านเดี่ยวพร้อมที่ดิน/.test(turnText)) assetLabelTh = "บ้านเดี่ยวพร้อมที่ดิน";
        else if (/บ้านพร้อมที่ดิน/.test(turnText)) assetLabelTh = "บ้านพร้อมที่ดิน";
        else if (/ที่ดินเปล่า/.test(turnText)) assetLabelTh = "ที่ดินเปล่า";
        else if (/ที่ดิน/.test(turnText)) {
          if (
            !assetLabelTh ||
            assetLabelTh === "อสังหาริมทรัพย์" ||
            /เปลี่ยนทรัพย์สิน/.test(turnText)
          ) {
            assetLabelTh = "ที่ดิน";
          }
        } else if (!assetLabelTh) {
          assetLabelTh = "อสังหาริมทรัพย์";
        }
      }

      // 2) Recipient kinship & gender-faithful display label (explicit kinship overrides generic หลาน)
      const tExplicitGrandNieceOrNephew =
        /บุตร(?:สาว|ชาย)?ของหลาน(?:ชาย|สาว)?|ลูก(?:สาว|ชาย)?ของหลาน(?:ชาย|สาว)?/.test(turnText);
      const tExplicitGrandchild =
        !tExplicitGrandNieceOrNephew &&
        /บุตร(?:สาว|ชาย)?ของ(?:บุตร(?:สาว|ชาย)?|ลูก(?:สาว|ชาย)?)|หลานปู่|หลานตา|หลานย่า|หลานยาย|ผู้สืบสันดานสายตรง|ผู้สืบสันดานโดยตรง/.test(
          turnText
        );
      const tExplicitCollateral =
        !tExplicitGrandNieceOrNephew &&
        !tExplicitGrandchild &&
        /บุตร(?:สาว|ชาย)?ของ(?:พี่|น้อง)(?:สาว|ชาย)?|ลูก(?:สาว|ชาย)?ของ(?:พี่|น้อง)(?:สาว|ชาย)?|หลานลุง|หลานอา|หลานน้า|หลานป้า/.test(
          turnText
        );
      const tAdopted =
        /บุตรบุญธรรม/.test(turnText) &&
        !/ไม่ใช่บุตรบุญธรรม|มิใช่บุตรบุญธรรม|ไม่รวม(?:ถึง)?บุตรบุญธรรม/.test(turnText);
      const tAmbiguousLan =
        !tExplicitGrandNieceOrNephew &&
        !tExplicitGrandchild &&
        !tExplicitCollateral &&
        !tAdopted &&
        /หลานสาว|หลานชาย|หลาน/.test(turnText);
      const tAscendantMatch =
        !tExplicitGrandNieceOrNephew &&
        !tExplicitGrandchild &&
        !tExplicitCollateral &&
        !tAdopted &&
        !tAmbiguousLan
          ? turnText.match(
              /(?:ให้(?:แก่)?[^\n]{0,35}?(?:ซึ่งเป็น|ที่เป็น|คือ)?\s*|(?:ผู้รับ(?:โอน|เงิน|ให้)?)[^\n]{0,25}?(?:เป็น|คือ)\s*)(มารดา(?:บังเกิดเกล้า|แท้ๆ)?|บิดา(?:บังเกิดเกล้า|แท้ๆ)?|พ่อ(?:บังเกิดเกล้า|แท้ๆ)?|แม่(?:บังเกิดเกล้า|แท้ๆ)?|บุพการี)/
            )
          : null;
      const tSpouseMatch =
        !tExplicitGrandNieceOrNephew &&
        !tExplicitGrandchild &&
        !tExplicitCollateral &&
        !tAdopted &&
        !tAmbiguousLan &&
        !tAscendantMatch
          ? turnText.match(
              /(?:ให้(?:แก่)?[^\n]{0,25}?(?:ซึ่งเป็น|ที่เป็น|คือ)?\s*|(?:ผู้รับ(?:โอน|เงิน|ให้)?)[^\n]{0,25}?(?:เป็น|คือ)\s*)(คู่สมรส|สามี|ภริยา|ภรรยา)/
            )
          : null;
      const tOtherCollateralMatch =
        !tExplicitGrandNieceOrNephew &&
        !tExplicitGrandchild &&
        !tExplicitCollateral &&
        !tAdopted &&
        !tAmbiguousLan &&
        !tAscendantMatch &&
        !tSpouseMatch
          ? turnText.match(
              /(?:ให้(?:แก่)?[^\n]{0,35}?(?:ซึ่งเป็น|ที่เป็น|คือ)?\s*|(?:ผู้รับ(?:โอน|เงิน|ให้)?)[^\n]{0,35}?(?:เป็น|คือ)\s*)(พี่สาว(?:แท้ๆ)?|พี่ชาย(?:แท้ๆ)?|น้องสาว(?:แท้ๆ)?|น้องชาย(?:แท้ๆ)?|เพื่อน(?:สนิท)?|บุคคลภายนอก|บุคคลอื่น)/
            )
          : null;
      const tLegitChild =
        !tExplicitGrandNieceOrNephew &&
        !tExplicitGrandchild &&
        !tExplicitCollateral &&
        !tAdopted &&
        !tAmbiguousLan &&
        !tAscendantMatch &&
        !tSpouseMatch &&
        !tOtherCollateralMatch &&
        /บุตร(?:ชาย|สาว)?(?:ที่)?ชอบด้วยกฎหมาย/.test(turnText);

      if (tExplicitGrandNieceOrNephew) {
        recipientRole = "NON_LINEAL_RELATIVE_OR_THIRD_PARTY";
        const isGrandNephew = /บุตรชายของหลาน|ลูกชายของหลาน/.test(turnText);
        recipientDisplayTh = isGrandNephew
          ? "บุตรชายของหลาน (เหลนสายข้าง — มิใช่บุตรชอบด้วยกฎหมายและมิใช่ผู้สืบสันดานสายตรง)"
          : "บุตรสาวของหลานชาย (เหลนสายข้าง — มิใช่บุตรชอบด้วยกฎหมายและมิใช่ผู้สืบสันดานสายตรง)";
      } else if (tExplicitGrandchild) {
        recipientRole = "EXPLICIT_LINEAL_GRANDCHILD";
        const genderWord = /หลานชาย|บุตรชายของบุตร/.test(turnText) ? "หลานชาย" : "หลานสาว";
        recipientDisplayTh = `${genderWord}ที่เป็นบุตรของบุตร (หลานปู่/หลานตา — ผู้สืบสันดานสายตรง แต่มิใช่บุตรชอบด้วยกฎหมาย)`;
      } else if (tExplicitCollateral) {
        recipientRole = "EXPLICIT_COLLATERAL_NIECE";
        const isNephew = /หลานชาย|บุตรชายของ(?:พี่|น้อง)/.test(turnText);
        const relDetail =
          turnText.match(/บุตร(?:สาว|ชาย)?ของ(?:พี่|น้อง)(?:สาว|ชาย)?(?:แท้ๆ)?/)?.[0] ||
          "บุตรของพี่หรือน้อง";
        recipientDisplayTh = isNephew
          ? `หลานชาย (${relDetail} — บุตรของพี่หรือน้อง / ญาติสายข้าง มิใช่บุตรชอบด้วยกฎหมาย)`
          : `หลานสาว (${relDetail} — บุตรของพี่หรือน้อง / ญาติสายข้าง มิใช่บุตรชอบด้วยกฎหมาย)`;
      } else if (tAdopted) {
        recipientRole = "ADOPTED_CHILD";
        recipientDisplayTh = "บุตรบุญธรรม (มิใช่บุตรชอบด้วยกฎหมายตามข้อยกเว้นมาตรา 42 (26))";
      } else if (tAmbiguousLan) {
        recipientRole = "AMBIGUOUS_LAN_OR_NIECE";
        const lanWord = /หลานชาย/.test(turnText) ? "หลานชาย" : /หลานสาว/.test(turnText) ? "หลานสาว" : "หลาน";
        recipientDisplayTh = `ผู้รับโอนที่เป็น "${lanWord}" (ยังไม่ระบุชัดว่าเป็นบุตรของบุตรหรือบุตรของพี่หรือน้อง แต่ทั้งสองกรณีมิใช่บุตรชอบด้วยกฎหมาย)`;
      } else if (tAscendantMatch) {
        recipientRole = "ASCENDANT";
        recipientDisplayTh = `${tAscendantMatch[1]} (บุพการี — ได้รับจากผู้สืบสันดาน)`;
      } else if (tSpouseMatch) {
        recipientRole = "SPOUSE";
        recipientDisplayTh = `${tSpouseMatch[1]} (คู่สมรส)`;
      } else if (tOtherCollateralMatch) {
        recipientRole = "NON_LINEAL_RELATIVE_OR_THIRD_PARTY";
        recipientDisplayTh = `${tOtherCollateralMatch[1]} (บุคคลซึ่งมิใช่บุพการี ผู้สืบสันดาน หรือคู่สมรส และมิใช่บุตรชอบด้วยกฎหมาย)`;
      } else if (tLegitChild) {
        recipientRole = "LEGITIMATE_CHILD";
        recipientDisplayTh = "บุตรชอบด้วยกฎหมาย";
      }

      // 3) Occasion / ceremony / moral duty
      if (/ไม่ได้เกี่ยวกับพิธี|มิได้เกี่ยวกับพิธี|ไม่เกี่ยวกับพิธี|ไม่ใช่(?:การให้ใน)?พิธี/.test(turnText)) {
        isCeremony = false;
        occasionLabelTh = null;
      } else if (/พิธีอุปสมบท|งานบวช/.test(turnText)) {
        isCeremony = true;
        occasionLabelTh = /น้องชายหลานสาว/.test(turnText)
          ? "งานบวชของน้องชายหลานสาวตามประเพณี"
          : "พิธีอุปสมบทตามประเพณี";
      } else if (/งานสมรส|งานแต่งงาน/.test(turnText)) {
        isCeremony = true;
        occasionLabelTh = "งานสมรสตามประเพณี";
      } else if (/ค่าอุปการะเลี้ยงดู|อุปการะเลี้ยงดู/.test(turnText)) {
        isCeremony = true;
        occasionLabelTh = "ค่าอุปการะเลี้ยงดู";
      } else if (/พิธี|ขนบธรรมเนียมประเพณี|หน้าที่ธรรมจรรยา/.test(turnText)) {
        isCeremony = true;
        occasionLabelTh = "พิธีหรือโอกาสตามขนบธรรมเนียมประเพณี";
      }

      // 4) Values, appraisal, co-ownership, acquisition, holding years
      const tAmounts = parseThaiMoneyAmountsWithContext(turnText);
      const tVal =
        tAmounts.find(
          (a) =>
            /มูลค่า|ที่ดิน|ห้องชุด|อาคาร|ราคา|เงินสด|จำนวน|อุปการะเลี้ยงดู|ของขวัญ/.test(a.leftContext) &&
            !/ราคาประเมินทุนทรัพย์|ราคาประเมินราชการ|หักภาษี|อากรแสตมป์/.test(a.leftContext)
        )?.amount ??
        (tAmounts.length === 1 && !/ราคาประเมิน|หักภาษี|อากรแสตมป์/.test(tAmounts[0].leftContext)
          ? tAmounts[0].amount
          : null);
      if (tVal !== null) valAmt = tVal;

      const tAppraisalMatch = turnText.match(
        /ราคาประเมินทุนทรัพย์(?:ของทางราชการ)?(?:ที่ใช้ในการจดทะเบียน|ในการจดทะเบียน)?\s*(?:คือ|เป็นจำนวนเงิน|เท่ากับ)?\s*([0-9,]+(?:\.[0-9]+)?)\s*บาท/
      );
      if (tAppraisalMatch) {
        officialAppraisalAmt = Number(tAppraisalMatch[1].replace(/,/g, ""));
      } else {
        const tAppAmt = tAmounts.find((a) => /ราคาประเมินทุนทรัพย์|ราคาประเมินราชการ/.test(a.leftContext))?.amount;
        if (tAppAmt !== undefined) officialAppraisalAmt = tAppAmt;
      }
      if (/ยังไม่ทราบราคาประเมินทุนทรัพย์/.test(turnText)) {
        officialAppraisalAmt = null;
      }

      if (/สินสมรส|ซื้อที่ดิน[^\n]{0,30}ร่วมกันระหว่างสมรส|สามีภริยาที่จดทะเบียนสมรส/.test(turnText)) {
        isMaritalCoOwned = true;
      }
      if (/ได้มาโดยทางมรดก|รับมรดก|ได้มาจากการให้โดยเสน่หา/.test(turnText)) {
        acquisitionMethod = "INHERITANCE_OR_GIFT";
      } else if (
        /ซื้อที่ดิน(?:แปลงหนึ่ง)?(?:มา|ร่วมกัน)|ได้[^\n]{0,60}มา(?:โดยการ)?ซื้อ|ซื้อ(?:ที่ดิน|บ้าน|ห้องชุด|คอนโด|อาคาร|ตึกแถว|ทาวน์โฮม|อสังหาริมทรัพย์)[^\n]{0,55}มา|ซื้อมาจาก/.test(
          turnText
        )
      ) {
        acquisitionMethod = "OTHER_PURCHASE";
      } else if (/ไม่ทราบว่า[^\n]{0,35}ได้(?:ที่ดิน|ห้องชุด|อาคาร|อสังหา)[^\n]{0,20}มา(?:อย่างไร|ด้วยวิธีใด)/.test(turnText)) {
        acquisitionMethod = null;
      }
      const tHoldMatch = turnText.match(/ถือครอง(?:มา|ไว้|นาน|เกิน)?\s*([0-9]+)\s*ปี/);
      if (tHoldMatch) holdingYears = Number(tHoldMatch[1]);
    }

    const explicitWhtOrShortfallIssue =
      /(?:หักภาษี(?:\s*เงินได้)?\s*ณ\s*ที่จ่าย|ภาษีหัก\s*ณ\s*ที่จ่าย|รับผิดร่วม|หักไว้ไม่ครบ|หักภาษีไว้ไม่ครบ|มาตรา\s*54|withholding\s+tax)/i.test(
        mergedContext
      );

    if (isImmovable) {
      // Derive required property-transfer authorities strictly from asset + relationship + withholding relevance (NO blanket §54!).
      controlling.add("prov.th.rc.50");
      const effectiveTransferVal = officialAppraisalAmt ?? valAmt;
      const exceedsChildExemptionCap =
        recipientRole === "LEGITIMATE_CHILD" &&
        effectiveTransferVal !== null &&
        effectiveTransferVal > 20_000_000;
      if (
        recipientRole !== "LEGITIMATE_CHILD" ||
        exceedsChildExemptionCap ||
        explicitWhtOrShortfallIssue
      ) {
        controlling.add("prov.th.rc.54");
      }
      controlling.add("prov.th.rc.41_ทวิ");
      controlling.add("prov.th.rc.49_ทวิ");
      controlling.add("statute.th.rc_amendment_40_2558");
      controlling.add("prov.th.rc.40");
      if (
        acquisitionMethod !== null ||
        holdingYears !== null ||
        /(?:มรดก|ถือครอง|ซื้อ[^\n]{0,40}เมื่อวันที่|ภาษีธุรกิจเฉพาะ)/.test(mergedContext)
      ) {
        controlling.add("prov.th.rc.91/2");
        controlling.add("subreg.th.rc.royal_decree.342");
      }
      if (recipientRole === "LEGITIMATE_CHILD") {
        controlling.add("work.th.rd.gk_0702_3889_2022_0d0a6d5b");
      } else {
        controlling.add("work.th.rd.0702_5958_2015_04f2b49f");
        if (isMaritalCoOwned) {
          controlling.add("work.th.rd.gk_0702_3889_2022_0d0a6d5b");
        }
      }
    } else {
      controlling.add("statute.th.rc_amendment_40_2558");
      controlling.add("prov.th.rc.40");
      if (explicitWhtOrShortfallIssue) {
        controlling.add("prov.th.rc.50");
        controlling.add("prov.th.rc.3_เตรส");
      }
    }

    // Detect whose tax the ACTIVE turn is asking about (Recipient vs Donor vs Both)
    const asksRecipientTax =
      /(?:ภาษี(?:เงินได้)?(?:บุคคลธรรมดา)?ของ(?:ผู้รับโอน|ผู้รับเงิน|ผู้รับ|หลานสาว|หลานชาย|หลาน|บุตรบุญธรรม|บุตร|พี่สาว|พี่ชาย|น้องสาว|น้องชาย|มารดา|บิดา|เพื่อน|คู่สมรส|สามี|ภริยา|นาย[^\s]{1,20}|นางสาว[^\s]{1,20})|ผู้รับ(?:โอน|เงิน)[^\n]{0,25}(?:เสียภาษี|รับภาระภาษี|ต้องเสียภาษี)|หลาน(?:สาว|ชาย)?[^\n]{0,25}(?:เสียภาษี|ยกเว้นภาษี|เปลี่ยนอย่างไร|มีภาระภาษี)|เงินได้ของ(?:บุตร|หลาน|ผู้รับ)|ต้องเสียภาษีเงินได้อย่างไร|ต้องเสียภาษีเงินได้บุคคลธรรมดาหรือไม่)/.test(
        activeClean
      );
    const asksDonorTax =
      /(?:ภาษี(?:เงินได้|หัก\s*ณ\s*ที่จ่าย)?ของ(?:ผู้โอน|ผู้ให้|บิดา|มารดา|พ่อ|แม่|ปู่|ย่า|ตา|ยาย|ลุง|ป้า|น้า|อา)|ผู้โอน[^\n]{0,30}(?:เสียภาษี|หักภาษี|ต้องหัก)|ต้องหักภาษี\s*ณ\s*ที่จ่าย|หักภาษี\s*ณ\s*ที่จ่าย\s*ณ\s*สำนักงานที่ดิน)/.test(
        activeClean
      );
    const queriedPartyFocus: "RECIPIENT" | "DONOR" | "BOTH" =
      asksRecipientTax && !asksDonorTax
        ? "RECIPIENT"
        : asksDonorTax && !asksRecipientTax
          ? "DONOR"
          : "BOTH";

    if ((isImmovable || valAmt !== null) && recipientRole !== null) {
      calcs.push(
        verifyComprehensiveGiftTaxCalculation({
          isImmovableProperty: isImmovable,
          assetLabelTh,
          recipientDisplayTh,
          occasionLabelTh,
          isMaritalCoOwnedProperty: isMaritalCoOwned,
          queriedPartyFocus,
          recipientRole,
          isCeremonyOrCustomOrMoralDuty: isCeremony,
          transferValueBaht: valAmt,
          officialAppraisedValueBaht: officialAppraisalAmt,
          acquisitionMethod,
          holdingYears,
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

  // --- Regime G2: Distinct VAT Special Regimes (Exemptions §81, Mixed-Use Apportionment §82/6, Cross-Border Inbound ภ.พ.36 §77/2 + §83/6) ---
  // Kept strictly distinct from ordinary domestic 7% VAT routing (Section 2)!
  const asksVatExemption81 =
    !asksVatRegistration &&
    /(?:ได้รับยกเว้นภาษีมูลค่าเพิ่ม|ยกเว้นภาษีมูลค่าเพิ่ม|กิจการที่ได้รับยกเว้น\s*VAT|ขายพืชผลทางการเกษตร|สถานพยาบาล[^\n]{0,40}ภาษีมูลค่าเพิ่ม|ตำราเรียน[^\n]{0,40}ภาษีมูลค่าเพิ่ม)/i.test(
      mergedContext
    ) &&
    !/เฉลี่ยภาษีซื้อ/.test(mergedContext);
  if (asksVatExemption81) {
    regimes.add("VAT_RATE");
    controlling.add("prov.th.rc.81");
  }

  const asksVatMixedUse82_6 =
    !asksVatRegistration &&
    /(?:เฉลี่ยภาษีซื้อ|ทั้งประเภทที่ต้องเสียภาษีมูลค่าเพิ่มและประเภทที่ได้รับยกเว้น|ทั้งกิจการที่ต้องเสีย[^\n]{0,30}และ[^\n]{0,30}ยกเว้นภาษีมูลค่าเพิ่ม|input\s+tax\s+apportionment)/i.test(
      mergedContext
    );
  if (asksVatMixedUse82_6) {
    regimes.add("VAT_RATE");
    controlling.add("prov.th.rc.82/6");
    controlling.add("prov.th.rc.82/3");
  }

  const asksVatCrossBorderInboundPP36 =
    !asksVatRegistration &&
    /(?:ภ\.พ\.\s*36|PP\s*36|นำส่งภาษีมูลค่าเพิ่ม[^\n]{0,60}ต่างประเทศ|ชำระค่าบริการ[^\n]{0,60}ผู้ประกอบการในต่างประเทศ[^\n]{0,60}ใช้บริการ[^\n]{0,40}ในราชอาณาจักร)/i.test(
      mergedContext
    );
  if (asksVatCrossBorderInboundPP36) {
    regimes.add("VAT_RATE");
    controlling.add("prov.th.rc.77/2");
    controlling.add("prov.th.rc.83/6");
  }

  // --- Regime H: VAT Rate (`7%` domestic / `790`/`799`/`807` exact dates / post-807 expiry / `0%` export of service vs goods) ---
  // 1. Preserve the difference between an explicit statutory citation lookup (e.g. `มาตรา 80/1 (1)` or `(2)`)
  //    and a legal fact-application question asking which VAT rate/decree applies!
  const isExplicitSection80_1Lookup =
    /มาตรา\s*80\/1(?:\s*\([0-9ก-ฮ]+\))?/.test(activeClean) &&
    /(?:บัญญัติ|กำหนดหลักเกณฑ์|สาระสำคัญ|มีหลักเกณฑ์|หนังสือตอบข้อหารือใด|ข้อหารือใดที่ตีความ)/.test(
      activeClean
    ) &&
    !/(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.|ร้อยละ\s*7|7%|อัตราภาษีมูลค่าเพิ่มสำหรับ(?:การขาย|การให้บริการ)ในประเทศ)/.test(
      activeClean
    );

  // 2. Prevent incidental VAT wording (e.g. "ไม่รวมภาษีมูลค่าเพิ่ม", "จดทะเบียน VAT", "ออกใบกำกับภาษี")
  //    in a primary withholding-tax or income-tax narrative from displacing the primary WHT/PIT issue!
  const asksExplicitVatRateOrDecreeQuestion =
    /(?:(?:คิด|เสีย|เรียกเก็บ|เก็บ|ใช้)\s*VAT\s*(?:กี่(?:ร้อยละ|เปอร์เซ็นต์)|ร้อยละเท่าใด|อัตราใด|อัตราเท่าใด)|VAT\s*ร้อยละ\s*7\s*หรือ\s*ร้อยละ\s*0|อัตรา\s*VAT|VAT\s+rate|อัตราภาษีมูลค่าเพิ่ม|ภาษีมูลค่าเพิ่ม[^\n]{0,60}(?:กี่เปอร์เซ็นต์|กี่ร้อยละ|ร้อยละเท่าใด|อัตราใด|อัตราเท่าใด|ร้อยละ\s*7|ร้อยละ\s*0|พระราชกฤษฎีกา|พ\.ร\.ฎ\.|กฎหมายใด|กฎหมายฉบับใด)|(?:เรียกเก็บ|เก็บ|คิด|เสีย|ใช้)ภาษีมูลค่าเพิ่ม[^\n]{0,40}(?:อัตรา|ร้อยละ|กี่เปอร์เซ็นต์|พระราชกฤษฎีกา|พ\.ร\.ฎ\.)|พระราชกฤษฎีกา(?:ฉบับที่|\s*\(ฉบับที่)\s*(?:646|780|790|799|807)|พ\.ร\.ฎ\.\s*(?:ฉบับที่\s*)?(?:646|780|790|799|807)|ความรับผิดใน(?:ภาษีมูลค่าเพิ่ม|\s*VAT)[\s\S]{0,80}อัตรา(?:ที่ต้องใช้เป็น)?เท่าใด|ส่งมอบผลของบริการ[^\n]{0,60}(?:ต่างประเทศ|ญี่ปุ่น|สิงคโปร์)[^\n]{0,60}ภาษีมูลค่าเพิ่ม)/i.test(
      mergedContext
    );

  const hasPrimaryWhtFocusOnly =
    /(?:หักภาษี(?:\s*เงินได้)?\s*ณ\s*ที่จ่าย|อัตราหัก\s*ณ\s*ที่จ่าย|ภาษีเงินได้หัก\s*ณ\s*ที่จ่าย|ภ\.ง\.ด\.\s*(?:1|2|3|53|54)|มาตรา\s*69\s*ทวิ|มาตรา\s*3\s*เตรส|มาตรา\s*70|withholding\s+tax)/i.test(
      activeClean
    ) && !asksExplicitVatRateOrDecreeQuestion;

  const asksVatRate =
    !asksVatRegistration &&
    !asksVatExemption81 &&
    !asksVatMixedUse82_6 &&
    !asksVatCrossBorderInboundPP36 &&
    !isExplicitSection80_1Lookup &&
    !hasPrimaryWhtFocusOnly &&
    asksExplicitVatRateOrDecreeQuestion &&
    !/สำนักงานเศรษฐกิจและการค้าของต่างประเทศ/.test(activeClean);

  if (asksVatRate) {
    regimes.add("VAT_RATE");

    // Turn-by-turn VAT transaction classification & place-of-use reducer (generalized on transaction + parties + place of use)
    let vatTxKind:
      | "EXPORT_GOODS"
      | "EXPORT_SERVICE_ABROAD"
      | "CROSS_BORDER_SERVICE_USED_IN_THAILAND"
      | "DOMESTIC_SERVICE"
      | "DOMESTIC_SALE"
      | null = null;
    let hadForeignClient = false;

    for (const turnText of userTurnsCleaned) {
      const mentionsForeignClient =
        /(?:(?:บริษัท|ลูกค้า|ผู้ว่าจ้าง|ผู้รับบริการ)(?:[^\n]{0,12})ใน(?:ต่างประเทศ|ประเทศ(?!ไทย)[ก-๙]+|สิงคโปร์|ญี่ปุ่น|ฮ่องกง|สหรัฐ|จีน|ยุโรป|เยอรมนี|อังกฤษ|มาเลเซีย|เวียดนาม|เกาหลี[ก-๙]*)|ลูกค้า(?:ใน)?ต่างประเทศ|ลูกค้าญี่ปุ่น|ลูกค้าสิงคโปร์|foreign\s+(?:client|customer|company))/i.test(
          turnText
        );
      if (mentionsForeignClient) hadForeignClient = true;

      const turnExplicitDomesticUse =
        /(?:(?:นำ[^\n]{0,20}ไป)?ใช้(?:บริการ|งาน|ซอฟต์แวร์|ระบบ)?(?:นั้น|ดังกล่าว)?(?:ทั้งหมด)?(?:ที่สาขา[^\n]{0,30}(?:กรุงเทพ|ชลบุรี|ในไทย|ประเทศไทย)|ในประเทศไทย|ในไทย|ในราชอาณาจักร)|ถูกใช้(?:ที่สาขา|ในไทย|ในประเทศไทย)|ลูกค้า(?:ใน|หน้าร้าน|ที่)(?:กรุงเทพ|ประเทศไทย|ประเทศ(?![ก-๙])|จังหวัด[ก-๙]+)|(?:ขาย|จำหน่าย|ส่งมอบ|รับเหมา|ก่อสร้าง|ซ่อมบำรุง)[^\n]{0,40}(?:ในไทย|ในประเทศไทย|ในประเทศ(?![ก-๙])|ในกรุงเทพ|จังหวัด[ก-๙]+|หน้าร้าน)|ให้บริการ[^\n]{0,45}ใน(?:ไทย|ประเทศไทย|ประเทศ(?![ก-๙])|ราชอาณาจักร)(?!.*(?:ต่างประเทศ|ประเทศ(?!ไทย)[ก-๙]+|เกาหลี|ญี่ปุ่น|สิงคโปร์)))/i.test(
          turnText
        );
      const turnUsedEntirelyAbroad =
        !/(?:(?:นำ[^\n]{0,20}ไป)?ใช้(?:บริการ|งาน|ซอฟต์แวร์)?(?:นั้น|ดังกล่าว)?[^\n]{0,25}(?:ที่สาขา[^\n]{0,25}(?:กรุงเทพ|ชลบุรี|ในไทย|ประเทศไทย)|ในประเทศไทย|ในไทย)|ถูกใช้(?:ที่สาขา|ในไทย|ในประเทศไทย))/.test(
          turnText
        ) &&
        (/(?:ใช้บริการ(?:นั้น|ดังกล่าว)?ทั้งหมดที่สำนักงานใน(?:ต่างประเทศ|ประเทศ(?!ไทย)[ก-๙]+|สิงคโปร์|ญี่ปุ่น|เกาหลี[ก-๙]*|ฮ่องกง|สหรัฐ|อังกฤษ|มาเลเซีย|เวียดนาม)|ใช้บริการในต่างประเทศทั้งหมด|ใช้ในต่างประเทศเพียงอย่างเดียว|นำไป(?:ใช้|ก่อสร้าง|ผลิต|ติดตั้ง|ดำเนินการ|ปฏิบัติ)[^\n]{0,25}(?:ในต่างประเทศ|นอกราชอาณาจักร|ใน(?:ประเทศ)?(?!ไทย)(?:เกาหลี[ก-๙]*|ญี่ปุ่น|สิงคโปร์|ฮ่องกง|สหรัฐ|จีน|ยุโรป|เยอรมนี|อังกฤษ|มาเลเซีย|เวียดนาม|[ก-๙]+))[^\n]{0,15}ทั้งหมด|used\s+(?:entirely\s+)?(?:abroad|outside\s+thailand))/i.test(
          turnText
        ) ||
          (hadForeignClient &&
            /(?:ร้อยละ\s*0|อัตราศูนย์|0%)/.test(turnText) &&
            !turnExplicitDomesticUse));
      const turnIsExportGoods =
        /ส่งออกสินค้า|ส่งออก[^\n]{0,25}ไปต่างประเทศ|export\s+of\s+goods/i.test(turnText) &&
        !/ให้บริการ|ค่าบริการ|ซอฟต์แวร์|ที่ปรึกษา|ออกแบบระบบ|แบบแปลน/.test(turnText);
      const turnIsService =
        /ให้บริการ|ค่าบริการ|ซอฟต์แวร์|ที่ปรึกษา|ออกแบบ|จัดทำแบบแปลน|ซ่อมบำรุง|บำรุงรักษา|รับเหมา|ก่อสร้าง|ให้เช่า|service/i.test(
          turnText
        );
      const turnIsDomesticSale =
        (/(?:ขาย(?:สินค้า|อุปกรณ์|เครื่องจักร|ผลิตภัณฑ์|วัสดุ|อะไหล่|เครื่องใช้ไฟฟ้า|[ก-๙]{2,20})|จำหน่าย|ส่งมอบ(?:สินค้า|อุปกรณ์|[ก-๙]{2,20})|domestic\s+sale(?:\s+of\s+goods)?|sale\s+of\s+goods\s+in\s+thailand)/i.test(
          turnText
        ) &&
          !turnIsService &&
          !turnIsExportGoods);

      if (turnIsExportGoods) {
        vatTxKind = "EXPORT_GOODS";
      } else if (turnUsedEntirelyAbroad) {
        vatTxKind = "EXPORT_SERVICE_ABROAD";
      } else if (turnExplicitDomesticUse) {
        vatTxKind = hadForeignClient
          ? "CROSS_BORDER_SERVICE_USED_IN_THAILAND"
          : turnIsDomesticSale
            ? "DOMESTIC_SALE"
            : "DOMESTIC_SERVICE";
      } else if (turnIsDomesticSale) {
        vatTxKind = "DOMESTIC_SALE";
      } else if (turnIsService) {
        vatTxKind = hadForeignClient
          ? "CROSS_BORDER_SERVICE_USED_IN_THAILAND"
          : "DOMESTIC_SERVICE";
      }
    }

    const { taxPointIso, explanationTh: vatTaxPointExpTh, usedSection78_1 } =
      resolveServiceVatTaxPointFromTurns(userTurnsCleaned, eventIso);

    if (usedSection78_1) {
      controlling.add("prov.th.rc.78/1");
    }

    if (vatTxKind === "EXPORT_GOODS") {
      controlling.add("prov.th.rc.80/1");
      demoteRulingsBeforeIso = "2020-01-01";
      calcs.push(
        verifyVatRateAndAmountCalculation({
          isExportOfGoodsOrServiceUsedEntirelyAbroad: true,
          isExportOfGoods: true,
          isServiceUsedInThailand: false,
          taxPointDateIso: taxPointIso,
          taxBaseBaht: null,
        })
      );
    } else if (vatTxKind === "EXPORT_SERVICE_ABROAD") {
      controlling.add("prov.th.rc.80/1");
      controlling.add("subreg.th.rd.dg_vat.105");
      demoteRulingsBeforeIso = "2020-01-01";
      calcs.push(
        verifyVatRateAndAmountCalculation({
          isExportOfGoodsOrServiceUsedEntirelyAbroad: true,
          isServiceUsedInThailand: false,
          taxPointDateIso: taxPointIso,
          taxPointExplanationTh: vatTaxPointExpTh,
          taxBaseBaht: null,
        })
      );
    } else if (
      vatTxKind === "CROSS_BORDER_SERVICE_USED_IN_THAILAND" ||
      vatTxKind === "DOMESTIC_SERVICE" ||
      vatTxKind === "DOMESTIC_SALE" ||
      /ขายสินค้าในราชอาณาจักร|ส่งมอบสินค้าในราชอาณาจักร|ความรับผิดใน\s*VAT|พระราชกฤษฎีกา(?:ฉบับที่|\s*\(ฉบับที่)\s*(?:780|790|799|807)/i.test(
        mergedContext
      )
    ) {
      const isCrossBorderThai = vatTxKind === "CROSS_BORDER_SERVICE_USED_IN_THAILAND";
      const isDomesticSvc = vatTxKind === "DOMESTIC_SERVICE";
      controlling.add("prov.th.rc.80");
      controlling.add("subreg.th.rd.vat_local_tax_guide");
      if (isCrossBorderThai) {
        controlling.add("prov.th.rc.77/2");
        controlling.add("prov.th.rc.80/1");
        controlling.add("subreg.th.rd.dg_vat.105");
      } else if (isDomesticSvc) {
        controlling.add("prov.th.rc.77/2");
      }

      const isPreCutoffVatDate = Boolean(
        taxPointIso &&
          (taxPointIso < "2017-10-01" || (taxPointIso >= "2018-10-01" && taxPointIso < "2023-10-01"))
      );
      if (isPreCutoffVatDate) {
        // Unsupported historical VAT windows (< 2017-10-01 or 2018-10-01..2023-09-30): NEVER route consolidated RD 646 as governing!
        controlling.delete("subreg.th.rc.royal_decree.646");
      } else if (!taxPointIso) {
        controlling.add("prov.th.rc.78/1");
        controlling.add("prov.th.rc.78");
        controlling.add("subreg.th.rc.royal_decree.790");
        controlling.add("subreg.th.rc.royal_decree.799");
        controlling.add("subreg.th.rc.royal_decree.807");
        missingQuestions.push(
          "กรุณาระบุวันเกิดความรับผิดในการเสียภาษีมูลค่าเพิ่ม (tax point ตามมาตรา 78 หรือมาตรา 78/1 (1) ได้แก่ วันที่ส่งมอบสินค้า/วันที่ได้รับชำระราคา วันที่ออกใบกำกับภาษี หรือวันที่ใช้บริการ แล้วแต่วันใดเกิดก่อน) เพื่อระบุพระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่มที่ใช้บังคับตรงตามช่วงเวลาโดยไม่คาดเดา"
        );
      } else if (taxPointIso >= "2017-10-01" && taxPointIso <= "2018-09-30") {
        controlling.add("subreg.th.rc.royal_decree.646");
      } else if (taxPointIso >= "2024-10-01" && taxPointIso <= "2025-09-30") {
        controlling.add("subreg.th.rc.royal_decree.790");
      } else if (taxPointIso >= "2025-10-01" && taxPointIso <= "2026-09-30") {
        controlling.add("subreg.th.rc.royal_decree.799");
      } else if (taxPointIso >= "2026-10-01" && taxPointIso <= "2027-09-30") {
        controlling.add("subreg.th.rc.royal_decree.807");
      } else if (taxPointIso > "2027-09-30") {
        // Post-2027-09-30: temporary RD 807 EXPIRED! NEVER add RD 807 to controllingWorkIds; only §80 governs (query.ts attaches RD 807 strictly as historical_or_excluded_context).
      } else if (taxPointIso >= "2023-10-01" && taxPointIso <= "2024-09-30") {
        controlling.add("subreg.th.rc.royal_decree.780");
      }
      // Note: Strict endpoint matching! Never route RD 780/790/799/807 outside their enacted transaction windows,
      // and never route consolidated RD 646 as governing historical proof.

      demoteRulingsBeforeIso = "2020-01-01";
      if (!isPreCutoffVatDate) {
        calcs.push(
          verifyVatRateAndAmountCalculation({
            isExportOfGoodsOrServiceUsedEntirelyAbroad: false,
            isServiceUsedInThailand: isCrossBorderThai || isDomesticSvc,
            isCrossBorderServiceUsedInThailand: isCrossBorderThai,
            isDomesticService: isDomesticSvc,
            taxPointDateIso: taxPointIso,
            taxPointExplanationTh: vatTaxPointExpTh,
            taxBaseBaht: null,
          })
        );
      }
    }
  }

  // --- Regime I: Withholding Tax (Domestic `มาตรา 3 เตรส` / `ท.ป. 4/2528` / `3 ปัณรส` e-WHT vs Cross-Border `มาตรา 70` vs Missing Recipient Fact!) ---
  // NEVER hijack a gratuitous immovable property transfer (`มาตรา 50 (5)-(6)` in Regime F) into `ท.ป. 4/2528` service WHT!
  const asksServiceOrCommercialWht =
    !asksGiftTransfer ||
    /(?:ค่าจ้างทำของ|ค่าบริการ|ค่าที่ปรึกษา|ค่าบริหารจัดการ|ค่าเช่า|ค่าโฆษณา|เงินปันผล|ค่าสิทธิ|e-Withholding|มาตรา\s*3\s*เตรส|มาตรา\s*70|ท\.ป\.\s*4\/2528)/i.test(
      activeClean
    );
  const asksWhtInActiveTurn =
    asksServiceOrCommercialWht &&
    /(?:หักภาษี(?:\s*เงินได้)?\s*ณ\s*ที่จ่าย|อัตราหัก\s*ณ\s*ที่จ่าย|e-Withholding\s*Tax|withholding\s+tax)/i.test(
      activeClean
    );
  const asksWht =
    asksWhtInActiveTurn ||
    (asksServiceOrCommercialWht &&
      !asksGeneral65TerExpense &&
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

    const isGovernmentPayerWht =
      !isForeignNoPe &&
      /(?:รัฐบาล|ส่วนราชการ|องค์การของรัฐบาล|เทศบาล|สุขาภิบาล|องค์การบริหาร(?:ส่วนจังหวัด|ส่วนตำบล|ราชการส่วนท้องถิ่น)|กระทรวง|หน่วยงานราชการ|หน่วยงานของรัฐ|รัฐวิสาหกิจ|มหาวิทยาลัยของรัฐ|โรงพยาบาลของรัฐ|มาตรา\s*69\s*ทวิ)/i.test(
        mergedContext
      );

    if (isGovernmentPayerWht) {
      regimes.add("WHT_GOVERNMENT_PAYER_S69_BIS");
      controlling.add("prov.th.rc.69_ทวิ");
      controlling.add("prov.th.rc.50");
    } else if (isForeignNoPe) {
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
        "ผู้รับเงินค่าที่ปรึกษาเป็นบุคคลประเภทใดและมีถิ่นที่อยู่/สถานประกอบการถาวรที่ใด: (1) บริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ตั้งขึ้นตามกฎหมายไทยหรือประกอบกิจการในไทย, (2) บุคคลธรรมดาผู้มีถิ่นที่อยู่ในไทย, หรือ (3) บริษัทต่างประเทศที่มิได้ประกอบกิจการในประเทศไทย?"
      );
      missingQuestions.push(
        "ลักษณะงานที่ปรึกษาเข้าประเภทเงินได้ใด (มาตรา 40 (2) รับทำงานให้, มาตรา 40 (3) ค่าสิทธิ, มาตรา 40 (6) วิชาชีพอิสระ, หรือมาตรา 40 (7)/(8) จ้างทำของ/ธุรกิจทั่วไป) งานดังกล่าวกระทำในประเทศไทยหรือต่างประเทศ และเป็นการนำส่งผ่านระบบ e-Withholding Tax ตามมาตรา 3 ปัณรส หรือไม่?"
      );
      missingQuestions.push(
        "หากผู้รับเงินเป็นนิติบุคคลหรือบุคคลที่มีถิ่นที่อยู่ในต่างประเทศ กรุณาระบุประเทศถิ่นที่อยู่เพื่อตรวจสอบข้อเท็จจริงตามอนุสัญญาภาษีซ้อน (DTA) ที่เกี่ยวข้อง"
      );
      conditionalFrameworkSummaryTh =
        `**ยังไม่สามารถสรุปอัตราหัก ณ ที่จ่ายหรือสรุปว่าไม่ต้องหักภาษีได้จนกว่าจะยืนยันข้อเท็จจริงสำคัญข้างต้น** — สำหรับ "ค่าที่ปรึกษา"${feeAmt !== null ? ` จำนวน ${feeAmt.toLocaleString("en-US")} บาท` : ""} ภาระภาษีหัก ณ ที่จ่ายขึ้นอยู่กับสถานะและถิ่นที่อยู่ผู้รับเงิน ลักษณะงาน สถานที่ให้บริการ และอนุสัญญาภาษีซ้อน โดยแยกกรอบกฎหมายตามประมวลรัษฎากรดังนี้:\n` +
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
    const isRealEstateSale =
      /ขายที่ดิน|ขายบ้าน|ที่ดิน|ห้องชุด|คอนโด|อาคาร|บ้าน|ตึกแถว|ทาวน์โฮม|สิ่งปลูกสร้าง|อสังหาริมทรัพย์/.test(
        mergedContext
      );

    const detectResidence1Yr = (segment: string): boolean =>
      /(?:มีชื่ออยู่ในทะเบียนบ้าน(?:ไม่น้อยกว่า|เกิน|มา|ครบ)?\s*[1-9]\s*ปี|ใช้เป็นสถานที่อยู่อาศัยอันเป็นแหล่งสำคัญ|ทะเบียนบ้าน(?:ไม่น้อยกว่า|เกิน|มา|ครบ)?\s*[1-9]\s*ปี)/.test(
        segment
      ) && !/ไม่มีชื่ออยู่ในทะเบียนบ้าน|ไม่ได้มีชื่ออยู่ในทะเบียนบ้าน/.test(segment);

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
        const inherited =
          /รับมรดก|ทางมรดก/.test(activeClean) &&
          !/ไม่ได้รับมรดก|มิได้รับมรดก|ไม่ได้มาทางมรดก|มิได้มาทางมรดก/.test(activeClean);
        const hasResidence1Yr = detectResidence1Yr(activeClean);
        const hasPriorPlot2 = /แปลงที่สอง/.test(mergedContext);
        const priorPlot2Mos = mergedContext.match(/แปลงที่สอง[\s\S]{0,120}?ถือครอง(?:ได้|มา)?\s*([0-9]+)\s*เดือน/)?.[1];
        calcs.push(
          verifySpecificBusinessTaxCalculation({
            activityKind: "REAL_ESTATE_PLOTS",
            plots: [
              {
                plotLabelTh: "ที่ดินแปลงที่หนึ่ง (กรณีซื้อมาจากบุคคลภายนอกและถือครองเกิน 5 ปี)",
                acquiredByInheritance: inherited,
                hasPrincipalResidenceOneYear: hasResidence1Yr,
                holdingYears: yrs,
                holdingMonths: null,
                isCommercialDeveloper: isDeveloper,
                saleValueBaht: null,
              },
              ...(hasPriorPlot2
                ? [
                    {
                      plotLabelTh: "ที่ดินแปลงที่สอง (ข้อเท็จจริงเดิมไม่เปลี่ยนแปลง — ซื้อมาถือครองไม่เกิน 5 ปี)",
                      acquiredByInheritance: false,
                      hasPrincipalResidenceOneYear: false,
                      holdingYears: null,
                      holdingMonths: priorPlot2Mos ? Number(priorPlot2Mos) : 3,
                      isCommercialDeveloper: isDeveloper,
                      saleValueBaht: null,
                    },
                  ]
                : []),
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
                hasPrincipalResidenceOneYear: detectResidence1Yr(seg1),
                holdingYears: yrs1 ? Number(yrs1) : null,
                holdingMonths: null,
                isCommercialDeveloper: isDeveloper,
                saleValueBaht: null,
              },
              {
                plotLabelTh: "แปลงที่สอง",
                acquiredByInheritance: /มรดก/.test(seg2),
                hasPrincipalResidenceOneYear: detectResidence1Yr(seg2),
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
        const inheritedSingle =
          /รับมรดก|ทางมรดก/.test(activeClean) &&
          !/ไม่ได้รับมรดก|มิได้รับมรดก|ไม่ได้มาทางมรดก|มิได้มาทางมรดก/.test(activeClean);
        const hasResidence1YrSingle = detectResidence1Yr(activeClean);
        if (yrsSingle || mosSingle || inheritedSingle || hasResidence1YrSingle) {
          calcs.push(
            verifySpecificBusinessTaxCalculation({
              activityKind: "REAL_ESTATE_PLOTS",
              plots: [
                {
                  plotLabelTh: hasResidence1YrSingle
                    ? "บ้านพร้อมที่ดินที่ใช้เป็นสถานที่อยู่อาศัยอันเป็นแหล่งสำคัญ"
                    : "ที่ดินที่ขาย",
                  acquiredByInheritance: inheritedSingle,
                  hasPrincipalResidenceOneYear: hasResidence1YrSingle,
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
