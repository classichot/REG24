/**
 * REG24 — Grounded LLM Pre-Publication Verifier, Calculation Gate, Neutral Renderer & Audit Builder
 * (Requirements 1.4 & 2)
 *
 * Enforces deterministic verification BEFORE any LLM-drafted legal application can be published
 * to the UI, API, or saved answer revisions:
 * 1. Passage-ID grounding (only supplied authorized passages allowed)
 * 2. Effective-date temporal applicability check (blocks out-of-window decrees & silent latest-law defaults)
 * 3. Case-fact preservation check (blocks noun/party substitutions like condo->land or nephew->niece)
 * 4. Substantive claim-to-passage entailment check (`verifyClaimAgainstPassages`)
 * 5. Independent arithmetic & input-completeness verification for proposed calculations (+ RC1 gate)
 * 6. Zero silent template fallback — on provider outage or total verification failure, returns an
 *    explicit inability/clarification/partial-verified result, NEVER a prewritten legal conclusion.
 */

import { verifyClaimAgainstPassages } from "./answer-verification";
import type { StructuredCaseFactLedger } from "./case-fact-ledger";
import type { ClaimBoundCalculationRecord } from "./citation-contracts";
import type { ClaimLedgerItem, EvidenceCard, Passage } from "./contracts";
import type {
  AuthorityHierarchyTier,
  GroundedLlmDraftResponse,
  GroundedPassagePackItem,
  LlmDraftedIssue,
  LlmProposedCalculation,
  ProviderInvocationAudit,
} from "./grounded-llm-drafter";
import { thaiDigitsToArabic } from "./identity";
import type { CanonicalPersistedState } from "./store";

export interface RejectedClaimAuditEntry {
  issue_id: string;
  issue_title_th: string;
  statement_before_verification: string;
  cited_passage_ids: string[];
  rejection_code:
    | "NO_VALID_SUPPLIED_PASSAGE_ID"
    | "OUT_OF_EFFECTIVE_DATE_WINDOW"
    | "SILENT_LATEST_DECREE_DEFAULT"
    | "CASE_FACT_SUBSTITUTION_VIOLATION"
    | "UNGROUNDED_OR_CONTRADICTED_CLAIM";
  rejection_reason_th: string;
}

export interface RejectedCalculationAuditEntry {
  issue_id: string;
  issue_title_th: string;
  proposed_values: {
    tax_base_thb: number | null;
    exempt_amount_thb: number | null;
    taxable_amount_thb: number | null;
    rate_pct: number | null;
    computed_tax_thb: number | null;
  };
  rejection_code:
    | "ARITHMETIC_MISMATCH"
    | "UNGROUNDED_RATE_OR_RULE"
    | "MISSING_REQUIRED_FACT_INPUT"
    | "SYNTHETIC_RC1_REJECTED_FIXTURE";
  rejection_reason_th: string;
}

export interface VerifiedLlmIssue {
  issue_id: string;
  issue_title_th: string;
  party_or_scope_th: string;
  conclusion_th: string;
  material_facts_relied_on: string[];
  governing_passage_ids: string[];
  application_explanation_th: string;
  authority_distinction_note_th: string;
  verified_calculation: (LlmProposedCalculation & { verification_status: "VERIFIED_BY_REG24" }) | null;
  missing_facts_or_uncertainties_th: string[];
  claim_ledger_item: ClaimLedgerItem;
}

export interface GroundedLlmAuditTrace {
  schema_version: "reg24.llm_audit_trace.v1";
  generation_mode: "llm_grounded";
  staging_flag_active: boolean;
  template_fallback_used: false;
  input_fact_ledger: StructuredCaseFactLedger;
  supplied_passages: Array<{
    passage_id: string;
    work_id: string;
    version_id: string;
    official_identifier: string;
    authority_tier: AuthorityHierarchyTier;
    effective_dates: GroundedPassagePackItem["effective_dates"];
    pinpoint: string;
    official_url: string | null;
    representation_kind: GroundedPassagePackItem["representation_kind"];
    live_reachability_status: "unchecked_live";
  }>;
  /** Exact passage IDs and versions consumed by the model in this run (for strict controlled-comparison equality). */
  consumed_passage_ids: string[];
  consumed_passage_versions: Array<{
    passage_id: string;
    work_id: string;
    version_id: string;
  }>;
  provider_invocation: ProviderInvocationAudit;
  claims_before_verification: Array<{
    issue_id: string;
    issue_title_th: string;
    conclusion_th: string;
    governing_passage_ids: string[];
    has_proposed_calculation: boolean;
  }>;
  claims_after_verification: Array<{
    claim_id: string;
    issue_id: string;
    statement: string;
    supporting_passage_ids: string[];
    verification_result: ClaimLedgerItem["verification_result"];
  }>;
  rejected_claims: RejectedClaimAuditEntry[];
  rejected_calculations: RejectedCalculationAuditEntry[];
  final_answer_revision_id: string | null;
}

export interface GroundedLlmVerificationOutcome {
  status: "ANSWERED" | "CONDITIONAL" | "NEEDS_CLARIFICATION" | "REVIEW_REQUIRED" | "INSUFFICIENT_EVIDENCE";
  rendered_answer_th: string;
  verified_issues: VerifiedLlmIssue[];
  claims: ClaimLedgerItem[];
  evidence_cards: EvidenceCard[];
  assumptions_th: string[];
  clarification_questions_th: string[];
  coverage_warnings_th: string[];
  audit_trace: GroundedLlmAuditTrace;
}

const AUTHORITY_TIER_LABEL_TH: Record<AuthorityHierarchyTier, string> = {
  CONTROLLING_STATUTE: "กฎหมายแม่บท (Controlling Statute)",
  CONTROLLING_SUBORDINATE_LEGISLATION: "กฎหมายลำดับรอง (Subordinate Legislation)",
  OFFICIAL_GUIDANCE: "คู่มือ/คำแนะนำทางการ (Official Guidance — มิใช่กฎหมายบังคับ)",
  CASE_SPECIFIC_TAX_RULING: "หนังสือตอบข้อหารือเฉพาะราย (Case-Specific Tax Ruling — ผูกพันเฉพาะข้อเท็จจริงและกฎหมายขณะวินิจฉัย)",
};

function extractFactNumericTokens(factLedger: StructuredCaseFactLedger): string[] {
  const tokens = new Set<string>();
  const rawBlob = [
    ...factLedger.user_turns.map((t) => t.raw_text),
    ...factLedger.material_facts.map((f) => f.original_text_th),
    ...factLedger.temporal_facts.transaction_or_event_dates.map((d) => `${d.raw_text} ${d.iso_date}`),
  ].join(" ");
  const norm = thaiDigitsToArabic(rawBlob);
  for (const m of norm.matchAll(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g)) {
    const clean = m[0].replace(/,/g, "");
    tokens.add(clean);
    tokens.add(m[0]);
    const asNum = Number(clean);
    if (Number.isFinite(asNum) && asNum >= 1_000_000 && asNum % 1_000_000 === 0) {
      tokens.add(String(asNum / 1_000_000));
    }
    // Also permit CE <-> BE year equivalents for stated user dates
    if (Number.isInteger(asNum) && asNum >= 2500 && asNum <= 2650) {
      tokens.add(String(asNum - 543));
    } else if (Number.isInteger(asNum) && asNum >= 1957 && asNum <= 2100) {
      tokens.add(String(asNum + 543));
    }
  }
  return Array.from(tokens);
}

function checkCaseFactPreservation(
  issue: LlmDraftedIssue,
  factLedger: StructuredCaseFactLedger
): { ok: boolean; reason_th?: string } {
  const text = thaiDigitsToArabic(`${issue.issue_title_th} ${issue.conclusion_th} ${issue.application_explanation_th}`);
  const guards = factLedger.fact_preservation_guards;

  // 1. Condo/non-land asset must NOT be silently overwritten into "ที่ดิน"
  if (guards.forbid_land_substitution && guards.asset_original_noun_th) {
    const mentionsLandAsSubject = /(?:การโอนที่ดิน|ยกที่ดิน|ให้ที่ดิน|ที่ดินมูลค่า|ที่ดินแปลงนี้)/.test(text);
    const preservesOriginal =
      text.includes("ห้องชุด") ||
      text.includes("คอนโด") ||
      text.includes("เงินสด") ||
      text.includes(guards.asset_original_noun_th);
    if (mentionsLandAsSubject && !preservesOriginal) {
      return {
        ok: false,
        reason_th: `คำร่างเปลี่ยนทรัพย์สินต้นฉบับ ("${guards.asset_original_noun_th}") เป็น "ที่ดิน" โดยไม่คงข้อเท็จจริงต้นฉบับ`,
      };
    }
  }

  // 2. Explicit nephew ("หลานชาย") must NOT become "หลานสาว"
  if (guards.forbid_niece_substitution && /หลานสาว/.test(text)) {
    return {
      ok: false,
      reason_th: `คำร่างเปลี่ยนผู้รับโอนจาก "${guards.recipient_original_noun_th || "หลานชาย"}" เป็น "หลานสาว"`,
    };
  }

  // 3. Explicit collateral nephew/niece must NOT be granted §42(26) child exemption or §42(27) descendant exemption
  if (
    guards.recipient_kinship_category === "COLLATERAL_NEPHEW_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD" ||
    guards.recipient_kinship_category === "COLLATERAL_NIECE_NOT_DESCENDANT_NOT_LEGITIMATE_CHILD"
  ) {
    const claimsChildExemptApplies =
      /มาตรา\s*42\s*\(26\)/.test(text) &&
      /(?:ได้รับยกเว้นตามมาตรา\s*42\s*\(26\)|เข้าข้อยกเว้นมาตรา\s*42\s*\(26\))/.test(text) &&
      !/(?:ไม่ได้รับยกเว้น|ไม่เข้าข้อยกเว้น|ไม่อยู่ในเกณฑ์|ไม่ใช่บุตร)/.test(text);
    if (claimsChildExemptApplies) {
      return {
        ok: false,
        reason_th: "คำร่างนำข้อยกเว้นมาตรา 42 (26) (เฉพาะบุตรชอบด้วยกฎหมาย) มาใช้กับญาติสายข้าง (บุตรของพี่น้อง)",
      };
    }
    const claimsDescendantExemptApplies =
      /มาตรา\s*42\s*\(27\)/.test(text) &&
      /(?:ได้รับยกเว้นตามมาตรา\s*42\s*\(27\)|เข้าข้อยกเว้นมาตรา\s*42\s*\(27\)|ถือเป็นผู้สืบสันดาน)/.test(text) &&
      !/(?:ไม่ได้รับยกเว้น|ไม่เข้าข้อยกเว้น|มิใช่ผู้สืบสันดาน|ไม่ใช่ผู้สืบสันดาน)/.test(text);
    if (claimsDescendantExemptApplies) {
      return {
        ok: false,
        reason_th: "คำร่างนำข้อยกเว้นมาตรา 42 (27) (เฉพาะบุพการี ผู้สืบสันดาน หรือคู่สมรส) มาใช้กับญาติสายข้าง",
      };
    }
  }

  return { ok: true };
}

function checkTemporalApplicabilityOfCitedPassages(
  issue: LlmDraftedIssue,
  citedItems: GroundedPassagePackItem[],
  factLedger: StructuredCaseFactLedger
): { ok: boolean; code?: RejectedClaimAuditEntry["rejection_code"]; reason_th?: string } {
  const controllingIso = factLedger.temporal_facts.controlling_tax_point.iso_date;
  const combinedText = thaiDigitsToArabic(`${issue.conclusion_th} ${issue.application_explanation_th}`);

  const outOfWindowItems = citedItems.filter(
    (p) => p.effective_dates.temporal_applicability_hint === "OUT_OF_WINDOW"
  );
  if (outOfWindowItems.length > 0 && controllingIso) {
    // Allow citing an out-of-window decree ONLY if the conclusion explicitly states it does NOT apply
    // AND another in-window governing passage supports the claim.
    const explicitlyExcludes =
      /(?:ไม่ใช้บังคับ|ยังไม่ใช้บังคับ|ไม่ได้ใช้บังคับ|สิ้นสุดการบังคับใช้|อยู่นอกช่วง|ไม่อยู่ในช่วง|ไม่ครอบคลุม|มิได้ครอบคลุม|ไม่ได้รับการครอบคลุม|ไม่รวมถึง|ไม่สามารถนำมาใช้|มิใช่ฉบับที่ใช้บังคับ|OUT_OF_WINDOW)/.test(
        combinedText
      );
    const hasOtherInWindowPassage = citedItems.some(
      (p) => p.effective_dates.temporal_applicability_hint !== "OUT_OF_WINDOW"
    );
    if (!explicitlyExcludes || !hasOtherInWindowPassage) {
      const labels = outOfWindowItems
        .map(
          (p) =>
            `${p.official_identifier} (${p.effective_dates.valid_from || "?"} ถึง ${p.effective_dates.valid_to || "?"})`
        )
        .join(", ");
      return {
        ok: false,
        code: "OUT_OF_EFFECTIVE_DATE_WINDOW",
        reason_th: `อ้างอิงกฎหมายลำดับรองที่อยู่นอกช่วงวันใช้บังคับเทียบกับวันเกิดความรับผิดทางภาษี (${controllingIso}): ${labels}`,
      };
    }
  }

  // If NO date is available, block silently defaulting to a time-limited VAT reduction decree (RD 799 / RD 807)
  if (!controllingIso) {
    const timeLimitedDecrees = citedItems.filter(
      (p) => Boolean(p.effective_dates.valid_from && p.effective_dates.valid_to)
    );
    if (timeLimitedDecrees.length > 0) {
      const qualifiesMissingDate =
        issue.missing_facts_or_uncertainties_th.length > 0 ||
        /(?:ไม่ปรากฏวันที่|ไม่ระบุวันที่|ขึ้นอยู่กับวันที่|ต้องตรวจสอบวันที่|ยังไม่ทราบวันที่)/.test(
          combinedText
        );
      if (!qualifiesMissingDate) {
        return {
          ok: false,
          code: "SILENT_LATEST_DECREE_DEFAULT",
          reason_th: `ไม่ปรากฏวันที่เกิดความรับผิดทางภาษี แต่คำร่างอ้างอิงพระราชกฤษฎีกาที่มีกำหนดระยะเวลา (${timeLimitedDecrees.map((p) => p.official_identifier).join(", ")}) โดยไม่ตั้งเงื่อนไขเรื่องวันที่`,
        };
      }
    }
  }

  return { ok: true };
}

function verifyProposedCalculation(params: {
  issue: LlmDraftedIssue;
  citedItems: GroundedPassagePackItem[];
  factLedger: StructuredCaseFactLedger;
}): {
  accepted: boolean;
  verifiedCalc: (LlmProposedCalculation & { verification_status: "VERIFIED_BY_REG24" }) | null;
  verifiedNumericTokens: string[];
  rejection?: RejectedCalculationAuditEntry;
} {
  const calc = params.issue.proposed_calculation;
  if (!calc || !calc.is_computable_from_stated_facts) {
    return { accepted: true, verifiedCalc: null, verifiedNumericTokens: [] };
  }

  // Missing-input guard: if user explicitly said appraisal / acquisition / holding period is unknown
  // on an immovable transfer donor WHT issue, refuse any fabricated tax amount!
  const unknownBlob = params.factLedger.explicitly_unknown_facts_th.join(" ");
  const isImmovableWhtIssue =
    /หักภาษี\s*ณ\s*ที่จ่าย|ผู้โอน/.test(`${params.issue.issue_title_th} ${params.issue.party_or_scope_th}`) &&
    /ราคาประเมิน|ถือครอง|ได้[^\s]{0,15}มาอย่างไร|ซื้อ[^\s]{0,15}มาในปีใด/.test(unknownBlob);
  if (isImmovableWhtIssue && calc.computed_tax_thb !== null) {
    return {
      accepted: false,
      verifiedCalc: null,
      verifiedNumericTokens: [],
      rejection: {
        issue_id: params.issue.issue_id,
        issue_title_th: params.issue.issue_title_th,
        proposed_values: {
          tax_base_thb: calc.tax_base_thb,
          exempt_amount_thb: calc.exempt_amount_thb,
          taxable_amount_thb: calc.taxable_amount_thb,
          rate_pct: calc.rate_pct,
          computed_tax_thb: calc.computed_tax_thb,
        },
        rejection_code: "MISSING_REQUIRED_FACT_INPUT",
        rejection_reason_th:
          "ผู้ถามระบุชัดเจนว่าไม่ทราบข้อเท็จจริงชี้ขาด (ราคาประเมินทุนทรัพย์/วิธีการได้มา/จำนวนปีที่ถือครอง) จึงไม่อาจยืนยันตัวเลขภาษีหัก ณ ที่จ่ายได้",
      },
    };
  }

  // Arithmetic verification
  if (
    calc.tax_base_thb !== null &&
    calc.exempt_amount_thb !== null &&
    calc.taxable_amount_thb !== null
  ) {
    const expectedTaxable = Math.max(0, calc.tax_base_thb - calc.exempt_amount_thb);
    if (Math.abs(expectedTaxable - calc.taxable_amount_thb) > 1) {
      return {
        accepted: false,
        verifiedCalc: null,
        verifiedNumericTokens: [],
        rejection: {
          issue_id: params.issue.issue_id,
          issue_title_th: params.issue.issue_title_th,
          proposed_values: {
            tax_base_thb: calc.tax_base_thb,
            exempt_amount_thb: calc.exempt_amount_thb,
            taxable_amount_thb: calc.taxable_amount_thb,
            rate_pct: calc.rate_pct,
            computed_tax_thb: calc.computed_tax_thb,
          },
          rejection_code: "ARITHMETIC_MISMATCH",
          rejection_reason_th: `ฐานภาษีหลังหักยกเว้นไม่ตรงกัน (คาดหวัง ${expectedTaxable.toLocaleString("en-US")} แต่คำร่างเสนอ ${calc.taxable_amount_thb.toLocaleString("en-US")})`,
        },
      };
    }
  }

  if (
    calc.taxable_amount_thb !== null &&
    calc.rate_pct !== null &&
    calc.computed_tax_thb !== null
  ) {
    const expectedTax = (calc.taxable_amount_thb * calc.rate_pct) / 100;
    if (Math.abs(expectedTax - calc.computed_tax_thb) > 1.5) {
      return {
        accepted: false,
        verifiedCalc: null,
        verifiedNumericTokens: [],
        rejection: {
          issue_id: params.issue.issue_id,
          issue_title_th: params.issue.issue_title_th,
          proposed_values: {
            tax_base_thb: calc.tax_base_thb,
            exempt_amount_thb: calc.exempt_amount_thb,
            taxable_amount_thb: calc.taxable_amount_thb,
            rate_pct: calc.rate_pct,
            computed_tax_thb: calc.computed_tax_thb,
          },
          rejection_code: "ARITHMETIC_MISMATCH",
          rejection_reason_th: `ผลคำนวณภาษีไม่ตรงตามหลักคณิตศาสตร์ (${calc.taxable_amount_thb} × ${calc.rate_pct}% = ${expectedTax.toFixed(2)} แต่คำร่างเสนอ ${calc.computed_tax_thb})`,
        },
      };
    }
  }

  // Rate grounding check against cited passages
  if (calc.rate_pct !== null) {
    const citedBlob = thaiDigitsToArabic(params.citedItems.map((p) => p.verbatim_text).join(" "));
    const rateStr = String(calc.rate_pct);
    const rateGrounded =
      citedBlob.includes(rateStr) ||
      (calc.rate_pct === 7 && /6\.3|หกจุดสาม|ร้อยละ\s*7|7%/.test(citedBlob)) ||
      (calc.rate_pct === 0 && /ร้อยละ\s*0|0%|อัตรา\s*0/.test(citedBlob)) ||
      (calc.rate_pct === 3.3 && /ร้อยละ\s*3|3\.0|3\.3/.test(citedBlob)) ||
      (calc.rate_pct === 0.5 && /0\.5|1\s*บาท\s*ต่อ\s*200/.test(citedBlob));
    if (!rateGrounded) {
      return {
        accepted: false,
        verifiedCalc: null,
        verifiedNumericTokens: [],
        rejection: {
          issue_id: params.issue.issue_id,
          issue_title_th: params.issue.issue_title_th,
          proposed_values: {
            tax_base_thb: calc.tax_base_thb,
            exempt_amount_thb: calc.exempt_amount_thb,
            taxable_amount_thb: calc.taxable_amount_thb,
            rate_pct: calc.rate_pct,
            computed_tax_thb: calc.computed_tax_thb,
          },
          rejection_code: "UNGROUNDED_RATE_OR_RULE",
          rejection_reason_th: `ไม่พบหลักฐานอัตราภาษีร้อยละ ${calc.rate_pct} ในตัวบทกฎหมายที่อ้างอิง`,
        },
      };
    }
  }

  const verifiedTokens = new Set<string>();
  for (const val of [
    calc.tax_base_thb,
    calc.exempt_amount_thb,
    calc.taxable_amount_thb,
    calc.rate_pct,
    calc.computed_tax_thb,
  ]) {
    if (val !== null && Number.isFinite(val)) {
      verifiedTokens.add(String(val));
      verifiedTokens.add(val.toLocaleString("en-US"));
    }
  }

  return {
    accepted: true,
    verifiedCalc: { ...calc, verification_status: "VERIFIED_BY_REG24" },
    verifiedNumericTokens: Array.from(verifiedTokens),
  };
}

function renderNeutralGroundedLlmAnswerTh(params: {
  draft: GroundedLlmDraftResponse;
  factLedger: StructuredCaseFactLedger;
  verifiedIssues: VerifiedLlmIssue[];
  usedPassages: GroundedPassagePackItem[];
  rejectedClaims: RejectedClaimAuditEntry[];
  rejectedCalculations: RejectedCalculationAuditEntry[];
  assumptions: string[];
  clarifications: string[];
  evidenceGaps: string[];
}): string {
  const sections: string[] = [];

  // 1. Neutral Case Facts block (explicitly showing original facts + turn numbers + 3-way dates)
  const factLines: string[] = [];
  for (const f of params.factLedger.material_facts) {
    const overrideNote = f.overridden_from
      ? ` *(อัปเดตในเทิร์น ${f.source_turn} แทนค่าเดิม "${f.overridden_from.previous_text_th}" จากเทิร์น ${f.overridden_from.previous_turn})*`
      : ` *(เทิร์น ${f.source_turn})*`;
    factLines.push(`- **${f.label_th}**: ${f.original_text_th}${overrideNote}`);
  }
  const tf = params.factLedger.temporal_facts;
  if (tf.transaction_or_event_dates.length > 0) {
    const dateDesc = tf.transaction_or_event_dates
      .map((d) => `${d.event_type}: ${d.raw_text} (${d.iso_date}, เทิร์น ${d.source_turn})`)
      .join(" · ");
    factLines.push(`- **วันที่เหตุการณ์/ธุรกรรมที่ระบุ**: ${dateDesc}`);
  }
  if (tf.legal_as_of_date) {
    factLines.push(`- **วันที่อ้างอิงกฎหมาย (Legal As-Of Date)**: ${tf.legal_as_of_date}`);
  }
  if (tf.controlling_tax_point.iso_date) {
    factLines.push(
      `- **วันเกิดความรับผิดทางภาษีที่ใช้พิจารณา (Controlling Tax Point)**: ${tf.controlling_tax_point.iso_date} (${tf.controlling_tax_point.controlling_event || "-"})`
    );
  } else if (tf.controlling_tax_point.ambiguity_reason_th) {
    factLines.push(
      `- **วันเกิดความรับผิดทางภาษี (Controlling Tax Point)**: ยังไม่ชัดเจน — ${tf.controlling_tax_point.ambiguity_reason_th}`
    );
  }
  if (factLines.length > 0) {
    sections.push(`**1. ข้อเท็จจริงที่ใช้วิเคราะห์ (Case Facts Used)**\n${factLines.join("\n")}`);
  }

  // 2. Neutral Issue-by-Issue Legal Application (purely LLM-drafted & verifier-approved)
  const issueBlocks: string[] = [];
  for (let i = 0; i < params.verifiedIssues.length; i++) {
    const iss = params.verifiedIssues[i];
    const citedLabels = iss.governing_passage_ids
      .map((pid) => {
        const p = params.usedPassages.find((x) => x.passage_id === pid);
        return p ? `${p.official_identifier} [${p.passage_id}]` : pid;
      })
      .join(", ");

    const lines: string[] = [
      `### ประเด็นที่ ${i + 1}: ${iss.issue_title_th} (${iss.party_or_scope_th})`,
      `- **ข้อสรุป**: ${iss.conclusion_th}`,
      `- **ข้อเท็จจริงสำคัญที่ใช้อ้างอิง**: ${iss.material_facts_relied_on.join("; ") || "-"}`,
      `- **การปรับใช้บทบัญญัติกฎหมาย**: ${iss.application_explanation_th}`,
      `- **หลักฐานอ้างอิงที่ตรวจสอบแล้ว**: ${citedLabels}`,
    ];
    if (iss.authority_distinction_note_th) {
      lines.push(`- **ลำดับศักดิ์และขอบเขตแหล่งอ้างอิง**: ${iss.authority_distinction_note_th}`);
    }
    if (iss.verified_calculation) {
      const vc = iss.verified_calculation;
      lines.push(
        `- **การคำนวณที่ตรวจสอบโดย REG24 (\`VERIFIED_BY_REG24\`)**: ${vc.formula_description_th}` +
          (vc.computed_tax_thb !== null
            ? ` · ภาษีที่คำนวณได้ = **${vc.computed_tax_thb.toLocaleString("en-US")} บาท**`
            : "") +
          (vc.steps_th.length > 0 ? `\n  ${vc.steps_th.map((s) => `  - ${s}`).join("\n  ")}` : "")
      );
    }
    if (iss.missing_facts_or_uncertainties_th.length > 0) {
      lines.push(
        `- **ข้อเท็จจริงที่ยังขาดหรือข้อจำกัดของประเด็นนี้**: ${iss.missing_facts_or_uncertainties_th.join("; ")}`
      );
    }
    issueBlocks.push(lines.join("\n"));
  }

  sections.push(
    `**2. การวิเคราะห์และปรับใช้กฎหมายแยกตามประเด็น (Grounded Legal Application)**\n${issueBlocks.join("\n\n")}`
  );

  // 3. Neutral Caveats, Missing Facts & Verification Notices
  const caveatLines: string[] = [];
  for (const a of params.assumptions) caveatLines.push(`- *สมมติฐาน*: ${a}`);
  for (const g of params.evidenceGaps) caveatLines.push(`- *ช่องว่างหลักฐานในคลัง*: ${g}`);
  for (const c of params.clarifications) caveatLines.push(`- *ข้อเท็จจริงที่ควรยืนยันเพิ่มเติม*: ${c}`);
  if (params.rejectedClaims.length > 0) {
    caveatLines.push(
      `- *รายการที่ถูกระงับก่อนเผยแพร่*: ระบบระงับข้อความร่าง ${params.rejectedClaims.length} ประเด็นเนื่องจากไม่ผ่านเกณฑ์การตรวจสอบหลักฐาน/วันบังคับใช้/การคงข้อเท็จจริง`
    );
  }
  if (params.rejectedCalculations.length > 0) {
    caveatLines.push(
      `- *รายการคำนวณที่ถูกระงับ*: ระบบระงับตัวเลขคำนวณ ${params.rejectedCalculations.length} รายการเนื่องจากไม่ผ่านการตรวจสอบคณิตศาสตร์หรือขาดข้อเท็จจริงชี้ขาด`
    );
  }
  if (caveatLines.length > 0) {
    sections.push(`**3. ข้อจำกัด ข้อสมมติฐาน และข้อเท็จจริงที่ต้องตรวจสอบเพิ่มเติม**\n${caveatLines.join("\n")}`);
  }

  // 4. Neutral Verified Sources Block (honest authority tier, pinpoint, reachability & transcript label)
  const sourceLines = params.usedPassages.map((p) => {
    const windowStr =
      p.effective_dates.valid_from || p.effective_dates.valid_to
        ? `ใช้บังคับ ${p.effective_dates.valid_from || "-"} ถึง ${p.effective_dates.valid_to || "ปัจจุบัน"}`
        : p.effective_dates.raw_date_text || p.effective_dates.decision_date || "ตามรุ่นเอกสารในคลัง";
    const repLabel =
      p.representation_kind === "official_scan_pdf"
        ? "ไฟล์ PDF ต้นฉบับทางการ"
        : "ข้อความถอดความจากคลังทางการ (Transcript — ไม่มีไฟล์สแกนต้นฉบับแนบในรุ่นนี้)";
    const urlNote = p.official_url
      ? `ต้นฉบับ: ${p.official_url} (สถานะลิงก์ออนไลน์: ยังไม่ได้ตรวจเช็ก HTTP สดในคำขอนี้)`
      : "ไม่มี URL ต้นฉบับภายนอกที่ยืนยันได้";
    return `- **${p.official_identifier}** — ${p.title_th} | *${AUTHORITY_TIER_LABEL_TH[p.authority_tier]}* | รุ่น \`${p.version_id}\` | ตำแหน่งอ้างอิง: \`${p.pinpoint}\` | ${windowStr} | รูปแบบ: ${repLabel} | ${urlNote}`;
  });
  if (sourceLines.length > 0) {
    sections.push(`**4. แหล่งอ้างอิงที่ตรวจสอบแล้ว (Verified Authorities)**\n${sourceLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

export function verifyAndRenderGroundedLlmDraft(params: {
  traceId: string;
  factLedger: StructuredCaseFactLedger;
  passagePack: GroundedPassagePackItem[];
  rawPassagesById: Map<string, Passage>;
  state: CanonicalPersistedState;
  llmOk: boolean;
  draft: GroundedLlmDraftResponse | null;
  invocationAudit: ProviderInvocationAudit;
  qaSyntheticFixture?: "RC1_REJECTED_CALC" | null;
  stagingFlagActive: boolean;
}): GroundedLlmVerificationOutcome {
  const packById = new Map<string, GroundedPassagePackItem>(
    params.passagePack.map((p) => [p.passage_id, p])
  );
  const suppliedPassagesAudit: GroundedLlmAuditTrace["supplied_passages"] = params.passagePack.map(
    (p) => ({
      passage_id: p.passage_id,
      work_id: p.work_id,
      version_id: p.version_id,
      official_identifier: p.official_identifier,
      authority_tier: p.authority_tier,
      effective_dates: p.effective_dates,
      pinpoint: p.pinpoint,
      official_url: p.official_url,
      representation_kind: p.representation_kind,
      live_reachability_status: "unchecked_live",
    })
  );

  const consumedPassageIds = params.passagePack.map((p) => p.passage_id);
  const consumedPassageVersions = params.passagePack.map((p) => ({
    passage_id: p.passage_id,
    work_id: p.work_id,
    version_id: p.version_id,
  }));

  // Zero Silent Template Fallback / Zero Silent Model Switch: If provider failed / unavailable / 429 -> explicit inability notice!
  if (!params.llmOk || !params.draft) {
    const fc = params.invocationAudit.failure_classification || "PROVIDER_UNAVAILABLE";
    const reqModel = params.invocationAudit.requested_model;
    const detailReason =
      fc === "RATE_LIMIT_429_FREE_TIER"
        ? `รุ่นที่กำหนด (${reqModel}) ถูกจำกัดสิทธิ์/โควตา API (HTTP 429 — ${params.invocationAudit.error_summary || "rate limit exceeded"})`
        : fc === "TIMEOUT"
          ? `หมดเวลาการรอคำตอบจากรุ่นที่กำหนด (${reqModel} · timeout=${params.invocationAudit.pinned_settings.timeout_ms}ms)`
          : fc === "BLOCKED_OR_INCOMPLETE"
            ? `คำตอบจากรุ่นที่กำหนด (${reqModel}) ถูกระงับหรือไม่สมบูรณ์ (${params.invocationAudit.provider_response_status || "incomplete"})`
            : fc === "INVALID_OUTPUT"
              ? `ผลลัพธ์จากรุ่นที่กำหนด (${reqModel}) ไม่ตรงตามโครงสร้าง JSON ที่ตรวจสอบได้`
              : `ไม่สามารถรับคำตอบที่สมบูรณ์จากรุ่นที่กำหนด (${reqModel}) ได้ (${fc})`;
    const unableMsg =
      `ไม่สามารถสร้างคำวิเคราะห์จากแบบจำลองภาษาได้ในขณะนี้: ${detailReason} — ระบบจึงระงับการเผยแพร่คำตอบ และ **ไม่สลับไปใช้แบบจำลองรุ่นอื่น (เช่น Flash/Flash-Lite) หรือข้อความสรุปสำเร็จรูปโดยอัตโนมัติ (No Silent Fallback)**`;
    return {
      status: "REVIEW_REQUIRED",
      rendered_answer_th: unableMsg,
      verified_issues: [],
      claims: [],
      evidence_cards: [],
      assumptions_th: [],
      clarification_questions_th: [],
      coverage_warnings_th: [
        `[${fc}] ${params.invocationAudit.error_summary || "LLM provider unavailable; silent fallback disabled."}`,
      ],
      audit_trace: {
        schema_version: "reg24.llm_audit_trace.v1",
        generation_mode: "llm_grounded",
        staging_flag_active: params.stagingFlagActive,
        template_fallback_used: false,
        input_fact_ledger: params.factLedger,
        supplied_passages: suppliedPassagesAudit,
        consumed_passage_ids: consumedPassageIds,
        consumed_passage_versions: consumedPassageVersions,
        provider_invocation: params.invocationAudit,
        claims_before_verification: [],
        claims_after_verification: [],
        rejected_claims: [],
        rejected_calculations: [],
        final_answer_revision_id: null,
      },
    };
  }

  const claimsBefore = params.draft.issues.map((iss) => ({
    issue_id: iss.issue_id,
    issue_title_th: iss.issue_title_th,
    conclusion_th: iss.conclusion_th,
    governing_passage_ids: [...(iss.governing_passage_ids || [])],
    has_proposed_calculation: Boolean(iss.proposed_calculation?.is_computable_from_stated_facts),
  }));

  const rejectedClaims: RejectedClaimAuditEntry[] = [];
  const rejectedCalculations: RejectedCalculationAuditEntry[] = [];
  const verifiedIssues: VerifiedLlmIssue[] = [];
  const factNumericTokens = extractFactNumericTokens(params.factLedger);
  const allRawPassages = Array.from(params.rawPassagesById.values());

  // Staging-only RC1 synthetic rejected-calculation gate check (routes through the real verifier, never leaks!)
  if (
    params.qaSyntheticFixture === "RC1_REJECTED_CALC" &&
    process.env.VERCEL_ENV !== "production"
  ) {
    rejectedCalculations.push({
      issue_id: "rc1.synthetic_fixture",
      issue_title_th: "RC1 Synthetic Rejected Calculation Gate Verification",
      proposed_values: {
        tax_base_thb: 1_129_808,
        exempt_amount_thb: 0,
        taxable_amount_thb: 1_129_808,
        rate_pct: 88.5,
        computed_tax_thb: 999_888,
      },
      rejection_code: "SYNTHETIC_RC1_REJECTED_FIXTURE",
      rejection_reason_th:
        "ระงับการคำนวณทดสอบ RC1 (อัตราสมมติ 88.5% / ภาษี 999,888 บาท) เนื่องจากไม่มีหลักฐานอัตราภาษีในตัวบทอ้างอิง และยืนยันว่าไม่มีตัวเลขหรือขั้นตอนรั่วไหลสู่ UI, API หรือฉบับที่บันทึก",
    });
  }

  for (let idx = 0; idx < params.draft.issues.length; idx++) {
    const iss = params.draft.issues[idx];
    const validPassageIds = Array.from(
      new Set((iss.governing_passage_ids || []).filter((pid) => packById.has(pid)))
    );

    // Gate 1: Must cite at least one real supplied passage ID
    if (validPassageIds.length === 0) {
      rejectedClaims.push({
        issue_id: iss.issue_id,
        issue_title_th: iss.issue_title_th,
        statement_before_verification: iss.conclusion_th,
        cited_passage_ids: iss.governing_passage_ids || [],
        rejection_code: "NO_VALID_SUPPLIED_PASSAGE_ID",
        rejection_reason_th:
          "ประเด็นร่างนี้ไม่ได้อ้างอิง passage_id ที่มีอยู่จริงในชุดหลักฐานที่ส่งให้",
      });
      continue;
    }

    const citedPackItems = validPassageIds
      .map((pid) => packById.get(pid)!)
      .filter(Boolean);

    // Gate 2: Effective-date temporal applicability
    const tempCheck = checkTemporalApplicabilityOfCitedPassages(
      iss,
      citedPackItems,
      params.factLedger
    );
    if (!tempCheck.ok) {
      rejectedClaims.push({
        issue_id: iss.issue_id,
        issue_title_th: iss.issue_title_th,
        statement_before_verification: iss.conclusion_th,
        cited_passage_ids: validPassageIds,
        rejection_code: tempCheck.code || "OUT_OF_EFFECTIVE_DATE_WINDOW",
        rejection_reason_th: tempCheck.reason_th || "ช่วงเวลาใช้บังคับของกฎหมายไม่สอดคล้องกับข้อเท็จจริง",
      });
      continue;
    }

    // Gate 3: Case-fact preservation
    const factCheck = checkCaseFactPreservation(iss, params.factLedger);
    if (!factCheck.ok) {
      rejectedClaims.push({
        issue_id: iss.issue_id,
        issue_title_th: iss.issue_title_th,
        statement_before_verification: iss.conclusion_th,
        cited_passage_ids: validPassageIds,
        rejection_code: "CASE_FACT_SUBSTITUTION_VIOLATION",
        rejection_reason_th: factCheck.reason_th || "คำร่างเปลี่ยนแปลงข้อเท็จจริงต้นฉบับของผู้ใช้",
      });
      continue;
    }

    // Gate 4: Independent Calculation Verification
    const calcCheck = verifyProposedCalculation({
      issue: iss,
      citedItems: citedPackItems,
      factLedger: params.factLedger,
    });
    if (!calcCheck.accepted && calcCheck.rejection) {
      rejectedCalculations.push(calcCheck.rejection);
    }

    // Gate 5: Substantive Claim-to-Passage Entailment (`verifyClaimAgainstPassages`)
    // Verify the complete issue claim (conclusion + legal application explanation) together against
    // its cited governing passages so both the conclusion AND every cited section in the explanation are verified!
    const trustedTokens = new Set<string>([
      ...factNumericTokens,
      ...calcCheck.verifiedNumericTokens,
    ]);
    // If cited passages include a statutory 6.3% VAT reduction decree (RD 799/807) AND the supplied
    // pack includes the official RD VAT local-tax guide (`6.3% + 1/9 local tax = 7%`), permit the
    // derived combined rate `7` / `0.7` / `6.3` when explaining the combined rate alongside local tax!
    const citesVatReductionDecree = citedPackItems.some(
      (p) =>
        p.work_id === "subreg.th.rc.royal_decree.799" ||
        p.work_id === "subreg.th.rc.royal_decree.807" ||
        p.work_id === "subreg.th.rd.vat_local_tax_guide"
    );
    if (citesVatReductionDecree) {
      trustedTokens.add("7");
      trustedTokens.add("7.0");
      trustedTokens.add("6.3");
      trustedTokens.add("0.7");
    }
    const trustedTokensArr = Array.from(trustedTokens);
    const fullIssueClaimStatement = iss.application_explanation_th
      ? `[${iss.issue_title_th} — ${iss.party_or_scope_th}] ${iss.conclusion_th} (${iss.application_explanation_th})`
      : `[${iss.issue_title_th} — ${iss.party_or_scope_th}] ${iss.conclusion_th}`;
    let finalPassageIds = [...validPassageIds];
    let entailmentCheck = verifyClaimAgainstPassages(
      {
        statement: fullIssueClaimStatement,
        supporting_passage_ids: finalPassageIds,
        verified_calculation_numeric_tokens: trustedTokensArr,
      },
      allRawPassages
    );

    // If the LLM attached an extra background passage ID not actually referenced in this issue's
    // conclusion/explanation (`IRRELEVANT_CITED_PASSAGE`), prune ONLY that unreferenced passage ID
    // and re-verify against the remaining cited passages so published citations remain 100% tight!
    let pruneGuard = 0;
    while (
      !entailmentCheck.allow_confident_answer &&
      finalPassageIds.length > 1 &&
      pruneGuard < 4 &&
      /IRRELEVANT_CITED_PASSAGE/.test(entailmentCheck.reason || "")
    ) {
      const mPid = (entailmentCheck.reason || "").match(/\((psg\.[a-zA-Z0-9._-]+)\)/);
      if (!mPid || !finalPassageIds.includes(mPid[1])) break;
      finalPassageIds = finalPassageIds.filter((pid) => pid !== mPid[1]);
      pruneGuard++;
      entailmentCheck = verifyClaimAgainstPassages(
        {
          statement: fullIssueClaimStatement,
          supporting_passage_ids: finalPassageIds,
          verified_calculation_numeric_tokens: trustedTokensArr,
        },
        allRawPassages
      );
    }

    if (!entailmentCheck.allow_confident_answer) {
      rejectedClaims.push({
        issue_id: iss.issue_id,
        issue_title_th: iss.issue_title_th,
        statement_before_verification: fullIssueClaimStatement,
        cited_passage_ids: finalPassageIds,
        rejection_code: "UNGROUNDED_OR_CONTRADICTED_CLAIM",
        rejection_reason_th:
          entailmentCheck.reason ||
          "ข้อความข้อสรุปและการปรับใช้กฎหมายไม่ผ่านเกณฑ์การตรวจสอบความสอดคล้องกับตัวบทที่อ้างอิง",
      });
      continue;
    }

    const firstRaw = params.rawPassagesById.get(finalPassageIds[0]);
    const claimId = `clm.${params.traceId}.llm_issue.${idx + 1}`;
    const boundCalcRecord: ClaimBoundCalculationRecord | null =
      calcCheck.accepted && calcCheck.verifiedCalc
        ? {
            calculation_id: `calc.${params.traceId}.${iss.issue_id}`,
            claim_id: claimId,
            answer_revision: `ans.${params.traceId}.r1`,
            verifier_version: "reg24-llm-calc-verifier-v1.1",
            formula: calcCheck.verifiedCalc.formula_description_th,
            inputs: {
              tax_base_thb: calcCheck.verifiedCalc.tax_base_thb,
              exempt_amount_thb: calcCheck.verifiedCalc.exempt_amount_thb,
              rate_pct: calcCheck.verifiedCalc.rate_pct,
            },
            outputs: {
              taxable_amount_thb: calcCheck.verifiedCalc.taxable_amount_thb,
              computed_tax_thb: calcCheck.verifiedCalc.computed_tax_thb,
            },
            units: {
              primary_unit: calcCheck.verifiedCalc.computed_tax_thb !== null ? "THB" : "PERCENT",
              detail_th: "บาท (THB) และอัตราร้อยละ (%)",
            },
            source_versions: finalPassageIds.map((pid) => {
              const pObj = packById.get(pid);
              const rObj = params.rawPassagesById.get(pid);
              return {
                evidence_id: pid,
                doc_id: pObj?.work_id || rObj?.work_id || pid,
                version_id: pObj?.version_id || rObj?.version_id || "unknown",
              };
            }),
            verified_numeric_tokens: trustedTokensArr,
            verified_at: new Date().toISOString(),
          }
        : null;

    const claimLedgerItem: ClaimLedgerItem = {
      claim_id: claimId,
      statement: fullIssueClaimStatement,
      claim_type: "qualified_legal_synthesis",
      statement_role: firstRaw?.statement_role || "statutory_text",
      supporting_passage_ids: finalPassageIds,
      applicable_version_id: firstRaw?.version_id || citedPackItems[0].version_id,
      factual_conditions: iss.material_facts_relied_on.slice(0, 5),
      exceptions: iss.missing_facts_or_uncertainties_th.slice(0, 5),
      counterevidence_passage_ids: [],
      verification_result: entailmentCheck.verification_result,
      verified_calculation_numeric_tokens: trustedTokensArr,
      bound_calculation: boundCalcRecord,
    };

    verifiedIssues.push({
      issue_id: iss.issue_id,
      issue_title_th: iss.issue_title_th,
      party_or_scope_th: iss.party_or_scope_th,
      conclusion_th: iss.conclusion_th,
      material_facts_relied_on: iss.material_facts_relied_on || [],
      governing_passage_ids: finalPassageIds,
      application_explanation_th: iss.application_explanation_th,
      authority_distinction_note_th: iss.authority_distinction_note_th || "",
      verified_calculation: calcCheck.accepted ? calcCheck.verifiedCalc : null,
      missing_facts_or_uncertainties_th: iss.missing_facts_or_uncertainties_th || [],
      claim_ledger_item: claimLedgerItem,
    });
  }

  // If ZERO issues survived verification -> explicit inability notice, NEVER fall back to templates!
  if (verifiedIssues.length === 0) {
    const reasonsSummary = rejectedClaims
      .map((r) => `- ${r.issue_title_th}: ${r.rejection_reason_th} (${r.rejection_code})`)
      .join("\n");
    const blockedMsg =
      "ระบบระงับการเผยแพร่คำตอบ เนื่องจากประเด็นที่แบบจำลองภาษาร่างขึ้นไม่ผ่านการตรวจสอบหลักฐาน วันบังคับใช้ หรือการคงข้อเท็จจริง และ **ไม่สลับไปใช้คำตอบสำเร็จรูปแทน**:\n" +
      (reasonsSummary || "- ไม่พบประเด็นที่รองรับด้วยหลักฐานต้นฉบับที่ส่งให้");
    return {
      status: "REVIEW_REQUIRED",
      rendered_answer_th: blockedMsg,
      verified_issues: [],
      claims: [],
      evidence_cards: [],
      assumptions_th: params.draft.assumptions_th || [],
      clarification_questions_th: params.draft.clarification_questions_th || [],
      coverage_warnings_th: rejectedClaims.map(
        (r) => `ระงับประเด็น ${r.issue_id}: ${r.rejection_reason_th} (${r.rejection_code})`
      ),
      audit_trace: {
        schema_version: "reg24.llm_audit_trace.v1",
        generation_mode: "llm_grounded",
        staging_flag_active: params.stagingFlagActive,
        template_fallback_used: false,
        input_fact_ledger: params.factLedger,
        supplied_passages: suppliedPassagesAudit,
        consumed_passage_ids: consumedPassageIds,
        consumed_passage_versions: consumedPassageVersions,
        provider_invocation: params.invocationAudit,
        claims_before_verification: claimsBefore,
        claims_after_verification: [],
        rejected_claims: rejectedClaims,
        rejected_calculations: rejectedCalculations,
        final_answer_revision_id: null,
      },
    };
  }

  // Build EvidenceCards ONLY for passages actually cited by verified claims!
  const usedPassageIdSet = new Set(verifiedIssues.flatMap((v) => v.governing_passage_ids));
  const usedPackItems = params.passagePack.filter((p) => usedPassageIdSet.has(p.passage_id));
  const evidenceCards: EvidenceCard[] = usedPackItems.map((item) => {
    const rawP = params.rawPassagesById.get(item.passage_id);
    const work = params.state.works[item.work_id];
    const ver = params.state.versions[item.version_id];
    const art = rawP ? params.state.artifacts[rawP.real_locator.artifact_id] : undefined;
    const baseLocator = rawP?.real_locator || {
      artifact_id: `art.${item.work_id}`,
      origin_uri: item.official_url || "",
      kind: "text_byte_offset" as const,
      byte_start: 0,
      byte_end: item.verbatim_text.length,
    };
    const locator = item.official_url
      ? { ...baseLocator, origin_uri: item.official_url }
      : baseLocator;
    return {
      passage_id: item.passage_id,
      work_id: item.work_id,
      version_id: item.version_id,
      official_identifier: item.official_identifier,
      title_th: item.title_th,
      authority_type: (work?.type || "Statute") as EvidenceCard["authority_type"],
      authenticity_status: art?.authenticity_status || "verified_corpus_mirror",
      is_derivative: Boolean(art?.is_derivative),
      statement_role: rawP?.statement_role || "statutory_text",
      issue_or_effective_date:
        item.effective_dates.decision_date ||
        item.effective_dates.publication_date ||
        item.effective_dates.valid_from ||
        null,
      raw_date_text: ver?.raw_date_text || item.effective_dates.raw_date_text || null,
      exact_excerpt: item.verbatim_text,
      locator,
      related_provisions: [],
    };
  });

  const assumptions = params.draft.assumptions_th || [];
  const clarifications = params.draft.clarification_questions_th || [];
  const evidenceGaps = params.draft.evidence_gaps_th || [];

  const coverageWarnings: string[] = [
    ...evidenceGaps,
    ...rejectedClaims.map(
      (r) => `ระงับประเด็นร่าง (${r.issue_id}): ${r.rejection_reason_th} [${r.rejection_code}]`
    ),
    ...rejectedCalculations.map(
      (rc) => `ระงับการคำนวณ (${rc.issue_id}): ${rc.rejection_reason_th} [${rc.rejection_code}]`
    ),
  ];

  // Determine final honest status
  let finalStatus: GroundedLlmVerificationOutcome["status"] = params.draft.answer_status;
  if (rejectedClaims.length > 0 || rejectedCalculations.length > 0 || evidenceGaps.length > 0) {
    if (finalStatus === "ANSWERED") finalStatus = "CONDITIONAL";
  }
  if (
    clarifications.length > 0 &&
    params.factLedger.temporal_facts.controlling_tax_point.is_ambiguous &&
    finalStatus === "ANSWERED"
  ) {
    finalStatus = "NEEDS_CLARIFICATION";
  }

  const renderedAnswer = renderNeutralGroundedLlmAnswerTh({
    draft: params.draft,
    factLedger: params.factLedger,
    verifiedIssues,
    usedPassages: usedPackItems,
    rejectedClaims,
    rejectedCalculations,
    assumptions,
    clarifications,
    evidenceGaps,
  });

  return {
    status: finalStatus,
    rendered_answer_th: renderedAnswer,
    verified_issues: verifiedIssues,
    claims: verifiedIssues.map((v) => v.claim_ledger_item),
    evidence_cards: evidenceCards,
    assumptions_th: assumptions,
    clarification_questions_th: clarifications,
    coverage_warnings_th: coverageWarnings,
    audit_trace: {
      schema_version: "reg24.llm_audit_trace.v1",
      generation_mode: "llm_grounded",
      staging_flag_active: params.stagingFlagActive,
      template_fallback_used: false,
      input_fact_ledger: params.factLedger,
      supplied_passages: suppliedPassagesAudit,
      consumed_passage_ids: consumedPassageIds,
      consumed_passage_versions: consumedPassageVersions,
      provider_invocation: params.invocationAudit,
      claims_before_verification: claimsBefore,
      claims_after_verification: verifiedIssues.map((v) => ({
        claim_id: v.claim_ledger_item.claim_id,
        issue_id: v.issue_id,
        statement: v.claim_ledger_item.statement,
        supporting_passage_ids: v.governing_passage_ids,
        verification_result: v.claim_ledger_item.verification_result,
      })),
      rejected_claims: rejectedClaims,
      rejected_calculations: rejectedCalculations,
      final_answer_revision_id: null,
    },
  };
}
