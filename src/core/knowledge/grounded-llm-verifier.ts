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

import {
  extractCanonicalInstrumentNumbers,
  verifyClaimAgainstPassages,
} from "./answer-verification";
import {
  auditEssentialIssueSurfaceText,
  extractNamedAuthoritiesFromText,
  findUnsupportedAuthoritiesInText,
  redactAuthorityIdentifiersFromPublicDiagnosticTh,
  resolveInPlaceAmendedBaseDecreeBindings,
  sanitizeIncidentalSurfaceText,
  type VerifiedAuthorityPassageBinding,
} from "./authority-surface-auditor";
import {
  evaluateSection47ClaimAmountsAndSubclauses,
  verifySection47AllowanceComponentsFromFacts,
  type Section47AllowanceEvalResult,
} from "./tax-calculation-verifier";
import { recordSection47RestrictedDiagnostic } from "./s47-restricted-diagnostics";
import type { StructuredCaseFactLedger } from "./case-fact-ledger";
import type {
  ClaimBoundCalculationRecord,
  RejectedCalculationDiagnosticDto,
} from "./citation-contracts";
import type { ClaimLedgerItem, EvidenceCard, Passage, QaSyntheticFixtureId } from "./contracts";
import type {
  AuthorityHierarchyTier,
  GroundedLlmDraftResponse,
  GroundedLlmSpecialConstraints,
  GroundedPassagePackItem,
  LlmDraftedIssue,
  LlmProposedCalculation,
  ProviderInvocationAudit,
} from "./grounded-llm-drafter";
import { thaiDigitsToArabic } from "./identity";
import type { CanonicalPersistedState } from "./store";

/**
 * Candidate 8 — Amending-decree commencement vs. restated period (VAT RD 780/790/799/807-style instruments).
 *
 * When an issue cites the quoted, amended text of a base decree article (e.g. "มาตรา ๔ ให้ลดอัตรา... ตั้งแต่วันที่
 * ๑ ตุลาคม พ.ศ. ๒๕๖๐ ถึงวันที่ ...") supplied as a governing passage of an amending decree, the cumulative period
 * belongs to the amended base-decree article — NOT to the amending decree's own commencement. This normalizer:
 *  - resolves the amended base decree/article generically from the bound passage (no decree allowlist),
 *  - reads the amending decree's own commencement from its bound Gazette `มาตรา 2` passage in the packet,
 *  - attributes any restated-period wording to the amended article, states the commencement separately,
 *  - binds the commencement passage so the published evidence itself proves the date.
 * If the commencement passage is not in the packet, the text is left unchanged (nothing is invented).
 */
export function applyAmendingDecreeCommencementAttribution(
  iss: LlmDraftedIssue,
  packById: Map<string, GroundedPassagePackItem>,
  pack: GroundedPassagePackItem[]
): LlmDraftedIssue {
  const cited = (iss.governing_passage_ids || [])
    .map((pid) => packById.get(pid))
    .filter((p): p is GroundedPassagePackItem => Boolean(p));
  let conclusion = iss.conclusion_th || "";
  let explanation = iss.application_explanation_th || "";
  const addIds: string[] = [];
  const handled = new Set<string>();

  for (const q of cited) {
    const m = /^subreg\.th\.rc\.royal_decree\.([0-9]+)$/.exec(q.work_id);
    if (!m || handled.has(q.work_id) || q.evidence_role !== "governing") continue;
    const amendNum = m[1];
    const link = resolveInPlaceAmendedBaseDecreeBindings([
      { work_id: q.work_id, pinpoint: q.pinpoint, verbatim_text: q.verbatim_text },
    ]).find((l) => l.amendingDecreeNum === amendNum);
    if (!link) continue;
    const commencementItem = pack.find(
      (p) =>
        p.work_id === q.work_id &&
        p.version_id === q.version_id &&
        /พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่/.test(thaiDigitsToArabic(p.verbatim_text))
    );
    if (!commencementItem) continue;
    const cm =
      /มาตรา\s*2\s*พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่\s*([0-9]{1,2}\s*[ก-๙]+\s*(?:พ\.ศ\.\s*)?[0-9]{4})/.exec(
        thaiDigitsToArabic(commencementItem.verbatim_text)
      );
    if (!cm) continue;
    handled.add(q.work_id);
    const commencementTh = cm[1].replace(/\s+/g, " ").trim();
    const cmParts = /^([0-9]{1,2})\s*([ก-๙]+)\s*(?:พ\.ศ\.\s*)?([0-9]{4})$/.exec(commencementTh);
    const commencementRe = cmParts
      ? new RegExp(`${cmParts[1]}\\s*${cmParts[2]}\\s*(?:พ\\.ศ\\.\\s*)?${cmParts[3]}`)
      : null;

    // Period restated inside the amended article (start date = the amended article's own start, read from text)
    const quotedArabic = thaiDigitsToArabic(q.verbatim_text);
    const periodStart = /ตั้งแต่วันที่\s*([0-9]{1,2})\s*([ก-๙]+)\s*(?:พ\.ศ\.\s*)?([0-9]{4})/.exec(quotedArabic);
    const startRe = periodStart
      ? new RegExp(
          `(?:(?:มีผล)?(?:ใช้)?บังคับ(?:ใช้)?\\s*)?(?:ตั้งแต่)?วันที่\\s*${periodStart[1]}\\s*${periodStart[2]}\\s*(?:พ\\.ศ\\.\\s*)?${periodStart[3]}(?:\\s*(?:ถึง|-|–)\\s*(?:วันที่)?\\s*[0-9]{1,2}\\s*[ก-๙]+\\s*(?:พ\\.ศ\\.\\s*)?[0-9]{4})?`
        )
      : null;
    const articleAttributionRe = new RegExp(
      `มาตรา\\s*${link.amendedSectionNum}\\s*แห่ง[^\\n]{0,90}${link.amendedBaseDecreeNum}`
    );
    const rewritePeriod = (text: string): string => {
      if (!startRe || !text) return text;
      const t = thaiDigitsToArabic(text);
      const mm = startRe.exec(t);
      if (!mm) return text;
      const before = t.slice(Math.max(0, mm.index - 160), mm.index);
      const rawMatched = mm[0].replace(/^(?:มีผล)?(?:ใช้)?บังคับ(?:ใช้)?\s*/, "");
      const falselyClaimsCommencementIn2560 = /^(?:มีผล)?(?:ใช้)?บังคับ/.test(mm[0]);
      if (articleAttributionRe.test(before) && !falselyClaimsCommencementIn2560) return t;
      const span = rawMatched.startsWith("ตั้งแต่") ? rawMatched : `ตั้งแต่${rawMatched}`;
      const attributed = `ตามข้อความมาตรา ${link.amendedSectionNum} แห่งพระราชกฤษฎีกา (ฉบับที่ ${link.amendedBaseDecreeNum}) ที่แก้ไขเพิ่มเติมโดยพระราชกฤษฎีกา (ฉบับที่ ${amendNum}) ซึ่งกำหนดช่วงความรับผิด${span}`;
      return `${t.slice(0, mm.index)}${attributed}${t.slice(mm.index + mm[0].length)}`;
    };
    conclusion = rewritePeriod(conclusion);
    explanation = rewritePeriod(explanation);

    const combined = thaiDigitsToArabic(`${conclusion} ${explanation}`);
    // Require explicit decree-commencement wording (`ใช้บังคับตั้งแต่วันที่ ...` or `มาตรา 2 ...`) so a boundary
    // transaction date (such as `1 ตุลาคม 2569` on RD 807) never suppresses stating the decree's own commencement!
    const explicitCommencementRe = commencementRe
      ? new RegExp(
          `(?:ใช้บังคับ|มีผล(?:ใช้)?บังคับ(?:ใช้)?)\\s*ตั้งแต่วันที่\\s*${commencementRe.source}|มาตรา\\s*2[^\\n]{0,65}${commencementRe.source}`
        )
      : null;
    if (!explicitCommencementRe || !explicitCommencementRe.test(combined)) {
      const mentionsRestatedStart = Boolean(startRe && startRe.test(combined));
      const note = `(พระราชกฤษฎีกา (ฉบับที่ ${amendNum}) ใช้บังคับตั้งแต่วันที่ ${commencementTh} ตามมาตรา 2 ของพระราชกฤษฎีกาฉบับดังกล่าว${
        mentionsRestatedStart && periodStart
          ? ` ส่วนวันที่ ${periodStart[1]} ${periodStart[2]} ${periodStart[3]} เป็นวันเริ่มต้นของช่วงเวลาที่ระบุในข้อความมาตรา ${link.amendedSectionNum} แห่งพระราชกฤษฎีกา (ฉบับที่ ${link.amendedBaseDecreeNum}) ที่แก้ไขแล้ว`
          : ""
      })`;
      if (explanation) explanation = `${explanation} ${note}`;
      else conclusion = `${conclusion} ${note}`;
    }
    addIds.push(commencementItem.passage_id);
  }

  if (addIds.length === 0) return iss;
  return {
    ...iss,
    conclusion_th: conclusion,
    application_explanation_th: explanation,
    governing_passage_ids: Array.from(new Set([...(iss.governing_passage_ids || []), ...addIds])),
  };
}

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
    | "UNGROUNDED_OR_CONTRADICTED_CLAIM"
    | "S47_AUTHORIZED_SET_TOTAL_MISMATCH"
    | "S47_SUBCLAUSE_AMOUNT_MISMATCH"
    | "S47_TOKEN_NOT_IN_AUTHORIZED_SET";
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
    | "UNSUPPORTED_IMMOVABLE_RECIPIENT_CALCULATION"
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
  rejected_calculations_diagnostic: RejectedCalculationDiagnosticDto[];
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

const EXPLICIT_EXCLUSION_RE =
  /(?:ไม่ใช้บังคับ|ยังไม่ใช้บังคับ|ไม่ได้ใช้บังคับ|ไม่ต้องนำ|ไม่นำ|ไม่มีความรับผิด(?:เกิดขึ้น)?ภายใต้|ไม่เกิดความรับผิดภายใต้|ไม่ตกอยู่ภายใต้|ไม่อยู่ภายใต้|สิ้นสุดการบังคับใช้|สิ้นสุดระยะเวลา|สิ้นสุดในวันที่|สิ้นสุดเมื่อวันที่|สิ้นสุดลง|พ้นกำหนด|อยู่นอกช่วง|ไม่อยู่ในช่วง|ไม่ครอบคลุม|มิได้ครอบคลุม|ไม่ได้รับการครอบคลุม|ไม่รวมถึง|ไม่สามารถนำมาใช้|ไม่อาจนำ|ห้ามนำ|มิใช่ฉบับที่ใช้บังคับ|ไม่มีผลใช้บังคับ|OUT_OF_WINDOW)/;

interface ResolvedIssueAllocationTarget {
  targetIso: string | null;
  expectedBaseThb: number | null;
  governingDecreeWorkId: string | null;
  lotIds: string[];
  sameDateBucketBaseThb: number | null;
  sameDateBucketVatThb: number | null;
  sameDateBucketGrossThb: number | null;
  hasMixedDatesError: boolean;
}

function resolveIssueTargetAllocation(
  issue: LlmDraftedIssue,
  factLedger: StructuredCaseFactLedger
): ResolvedIssueAllocationTarget | null {
  const alloc = factLedger.temporal_facts.vat_portion_allocation_record;
  const splitPoints = factLedger.temporal_facts.split_payment_tax_points || [];
  if (splitPoints.length < 2 && (!alloc || alloc.lot_allocations.length < 2)) {
    return null;
  }

  const headerText = thaiDigitsToArabic(`${issue.issue_title_th} ${issue.party_or_scope_th}`).replace(
    /\s+/g,
    " "
  );
  // 1. If declared lot allocations exist, match explicit lot labels in header first (e.g. "ล็อต A", "ล็อต B และล็อต C", "ล็อต A และล็อต B")
  if (alloc && alloc.allocation_status === "RESOLVED" && alloc.lot_allocations.length >= 2) {
    const isSummaryHeader = /(?:สรุปรวม|ยอดรวมทั้งสิ้น|รวมทั้ง\s*[0-9]+\s*ล็อต|รวมทั้งธุรกรรม|ภาพรวมทั้งหมด)/i.test(
      headerText
    );
    if (!isSummaryHeader) {
      const positiveHeaderText = headerText.replace(
        /(?:ไม่รวม(?:ถึง)?|ไม่ใช่|มิใช่|ยกเว้น|\bnot\b|\bexcluding\b)\s*(?:สินค้า\s*)?(?:ล็อต|ล๊อต|ชุดที่|ชุด|รายการที่|รายการ|ส่วนที่|lot|batch|tranche|item)\s*[A-Z0-9ก-ฮ]+/gi,
        " "
      );
      const matchedLots = alloc.lot_allocations.filter((la) => {
        const escLabel = thaiDigitsToArabic(la.label_th).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const lotToken = la.lot_id.replace(/^LOT_/, "");
        const escTok = lotToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          `(?:${escLabel}|(?:ล็อต|ล๊อต|ชุดที่|รายการที่|lot)\\s*${escTok})(?![A-Za-z0-9])`,
          "i"
        );
        return re.test(positiveHeaderText);
      });
      if (matchedLots.length > 0 && matchedLots.length < alloc.lot_allocations.length) {
        const distinctDates = Array.from(new Set(matchedLots.map((l) => l.controlling_tax_point_iso)));
        const distinctWindows = Array.from(new Set(matchedLots.map((l) => l.decree_window)));
        const distinctDecrees = Array.from(
          new Set(matchedLots.map((l) => l.governing_decree_work_id || ""))
        );
        const hasMixedDecreeWindows = distinctWindows.length > 1 || distinctDecrees.length > 1;
        const targetIso = !hasMixedDecreeWindows ? distinctDates[0] : null;
        const expectedBaseThb =
          Math.round(matchedLots.reduce((s, l) => s + l.taxable_base_thb, 0) * 100) / 100;
        const bucket =
          distinctDates.length === 1
            ? alloc.tax_date_buckets.find((b) => b.iso_date === distinctDates[0])
            : undefined;
        return {
          targetIso,
          expectedBaseThb,
          governingDecreeWorkId: !hasMixedDecreeWindows
            ? matchedLots[0].governing_decree_work_id
            : null,
          lotIds: matchedLots.map((l) => l.lot_id),
          sameDateBucketBaseThb: bucket?.amount_thb ?? (!hasMixedDecreeWindows ? expectedBaseThb : null),
          sameDateBucketVatThb:
            bucket?.verified_vat_thb ??
            (!hasMixedDecreeWindows
              ? Math.round(matchedLots.reduce((s, l) => s + (l.verified_vat_thb ?? 0), 0) * 100) / 100
              : null),
          sameDateBucketGrossThb:
            bucket?.verified_gross_thb ??
            (!hasMixedDecreeWindows
              ? Math.round(matchedLots.reduce((s, l) => s + (l.verified_gross_thb ?? 0), 0) * 100) / 100
              : null),
          hasMixedDatesError: hasMixedDecreeWindows,
        };
      }
    }
  }

  // 2. Fallback to date / ordinal portion targeting on split_payment_tax_points
  const targetIso = resolveIssueTargetSplitPortionIso(issue, splitPoints);
  if (!targetIso) return null;
  const matchedPortion = splitPoints.find((sp) => sp.iso_date === targetIso);
  if (!matchedPortion) return null;
  return {
    targetIso,
    expectedBaseThb:
      typeof matchedPortion.amount_thb === "number" && matchedPortion.amount_thb > 0
        ? matchedPortion.amount_thb
        : null,
    governingDecreeWorkId: matchedPortion.governing_decree_work_id ?? null,
    lotIds: matchedPortion.lot_ids || [],
    sameDateBucketBaseThb: matchedPortion.amount_thb ?? null,
    sameDateBucketVatThb: matchedPortion.verified_vat_thb ?? null,
    sameDateBucketGrossThb: matchedPortion.verified_gross_thb ?? null,
    hasMixedDatesError: false,
  };
}

function resolveIssueTargetSplitPortionIso(
  issue: LlmDraftedIssue,
  splitPoints: NonNullable<StructuredCaseFactLedger["temporal_facts"]["split_payment_tax_points"]>
): string | null {
  if (splitPoints.length < 2) return null;
  const headerText = thaiDigitsToArabic(`${issue.issue_title_th} ${issue.party_or_scope_th}`).replace(
    /\s+/g,
    " "
  );
  const matchIn = (haystack: string) =>
    splitPoints.filter((sp) => {
      const rawNorm = thaiDigitsToArabic(sp.raw_text).replace(/\s+/g, " ").trim();
      return haystack.includes(sp.iso_date) || (rawNorm.length >= 6 && haystack.includes(rawNorm));
    });

  // 0. If this issue is an explicit multi-portion conditional branch whose conclusion applies >= 2 distinct
  //    split-point dates (e.g. "กรณีที่ 2: หากออกใบกำกับภาษีบางส่วน ... และรับชำระส่วนที่เหลือ ..."),
  //    do NOT collapse the whole branch to a single date mentioned in the title!
  const concText = thaiDigitsToArabic(issue.conclusion_th).replace(/\s+/g, " ");
  const concMatches = matchIn(concText);
  const isConditionalBranchHeader = /(?:กรณีที่\s*[0-9]|ทางเลือก|หากออกใบกำกับ|หากยอดชำระ|หากโอนกรรมสิทธิ์|หากการโอนกรรมสิทธิ์|การพิจารณาวันเกิดความรับผิดแยกตามสัดส่วน|conditional|branch|scenario)/i.test(
    headerText
  );
  if (isConditionalBranchHeader && concMatches.length >= 2) {
    return null;
  }

  // 1. Prefer exact date match in issue title / party_or_scope (never fooled by expiry date cited in explanation!)
  const headerMatches = matchIn(headerText);
  if (headerMatches.length === 1) return headerMatches[0].iso_date;

  // 2. Ordinal portion match in header (e.g. "งวดแรก" / "ส่วนที่ 1" / "ล็อตแรก" vs "งวดที่สอง" / "ส่วนที่ 2" / "ส่วนที่เหลือ")
  const ordMatches = splitPoints.filter((sp, idx) => {
    const num = sp.portion_index ?? idx + 1;
    const ordRe =
      num === 1
        ? /(?:งวดแรก|งวดที่\s*1(?!\d)|ส่วนแรก|ส่วนที่\s*1(?!\d)|ล็อตแรก)/
        : num === 2
          ? /(?:งวดที่สอง|งวดที่\s*2(?!\d)|ส่วนที่สอง|ส่วนที่\s*2(?!\d)|ส่วนที่เหลือ)/
          : new RegExp(`(?:งวดที่|ส่วนที่)\\s*${num}(?!\\d)`);
    return ordRe.test(headerText);
  });
  if (ordMatches.length === 1) return ordMatches[0].iso_date;

  // 3. Fallback to conclusion text
  if (concMatches.length === 1) return concMatches[0].iso_date;

  return null;
}

function extractExplicitlyExcludedContextInstruments(params: {
  issue: LlmDraftedIssue;
  validPassageIds: string[];
  passagePack: GroundedPassagePackItem[];
  factLedger: StructuredCaseFactLedger;
}): string[] {
  const normClaim = thaiDigitsToArabic(
    `${params.issue.issue_title_th} ${params.issue.party_or_scope_th} ${params.issue.conclusion_th} ${params.issue.application_explanation_th}`
  ).replace(/\s+/g, " ");
  if (!EXPLICIT_EXCLUSION_RE.test(normClaim)) {
    return [];
  }

  const citedSet = new Set(params.validPassageIds);
  const splitPoints = params.factLedger.temporal_facts.split_payment_tax_points || [];
  const isSplitMultiTaxPoint = Boolean(
    params.factLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
      splitPoints.length >= 2
  );
  const singleTargetIso = isSplitMultiTaxPoint
    ? resolveIssueTargetSplitPortionIso(params.issue, splitPoints)
    : null;

  const excludedPackPassages = params.passagePack.filter((p) => {
    if (citedSet.has(p.passage_id)) return false;
    if (singleTargetIso && (p.excluded_tax_point_dates || []).includes(singleTargetIso)) {
      return true;
    }
    if (isSplitMultiTaxPoint && !singleTargetIso && (p.excluded_tax_point_dates || []).length > 0) {
      return true;
    }
    return (
      p.effective_dates.temporal_applicability_hint === "OUT_OF_WINDOW" ||
      p.evidence_role === "historical_or_excluded_context"
    );
  });
  if (excludedPackPassages.length === 0) return [];

  const candidateInstruments = new Set<string>();
  for (const p of excludedPackPassages) {
    const blob = thaiDigitsToArabic(
      `${p.official_identifier} ${p.title_th} ${p.pinpoint} ${p.verbatim_text}`
    ).replace(/\s+/g, " ");
    for (const inst of extractCanonicalInstrumentNumbers(blob)) {
      candidateInstruments.add(inst);
    }
  }

  const verifiedExcluded: string[] = [];
  for (const inst of candidateInstruments) {
    const numPart = inst.replace(/^(?:พรฎ\.|ทป\.|ฎีกา\.)/, "");
    const esc = numPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionRe = new RegExp(`(?:ฉบับที่\\s*${esc}|ท\\.ป\\.\\s*${esc}|ฎีกาที่\\s*${esc})`, "g");
    const matches = Array.from(normClaim.matchAll(mentionRe));
    if (matches.length === 0) continue;
    // Require EVERY mention of this uncited instrument to appear within an explicit exclusion context!
    const allMentionsExcluded = matches.every((m) => {
      const idx = m.index ?? 0;
      const win = normClaim.slice(Math.max(0, idx - 180), Math.min(normClaim.length, idx + 200));
      return EXPLICIT_EXCLUSION_RE.test(win);
    });
    if (allMentionsExcluded) {
      verifiedExcluded.push(inst);
    }
  }
  return verifiedExcluded;
}

function checkTemporalApplicabilityOfCitedPassages(
  issue: LlmDraftedIssue,
  citedItems: GroundedPassagePackItem[],
  factLedger: StructuredCaseFactLedger
): { ok: boolean; code?: RejectedClaimAuditEntry["rejection_code"]; reason_th?: string } {
  const controllingIso = factLedger.temporal_facts.controlling_tax_point.iso_date;
  const splitPoints = factLedger.temporal_facts.split_payment_tax_points || [];
  const isSplitMultiTaxPoint = Boolean(
    factLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
      splitPoints.length >= 2
  );
  const combinedText = thaiDigitsToArabic(`${issue.conclusion_th} ${issue.application_explanation_th}`);
  const explicitlyExcludes = EXPLICIT_EXCLUSION_RE.test(combinedText);

  // Per-tax-point temporal verification for multi-tax-point (split-payment / multi-lot) transactions:
  if (isSplitMultiTaxPoint) {
    const resolvedTarget = resolveIssueTargetAllocation(issue, factLedger);
    const targetIso =
      resolvedTarget?.targetIso ?? resolveIssueTargetSplitPortionIso(issue, splitPoints);
    // If this issue targets strictly ONE portion date (e.g. Portion 2 on 2027-10-01), verify that
    // any cited time-limited decree excluded for THAT portion date is ONLY cited with explicit exclusion
    // AND alongside an in-window/timeless statute (e.g. §80) — NEVER as governing authority for that portion!
    if (targetIso) {
      const excludedForPortion = citedItems.filter((p) =>
        (p.excluded_tax_point_dates || []).includes(targetIso)
      );
      if (excludedForPortion.length > 0) {
        const hasValidAuthorityForPortion = citedItems.some(
          (p) => !(p.excluded_tax_point_dates || []).includes(targetIso)
        );
        if (!explicitlyExcludes || !hasValidAuthorityForPortion) {
          const labels = excludedForPortion
            .map(
              (p) =>
                `${p.official_identifier} (${p.effective_dates.valid_from || "?"} ถึง ${p.effective_dates.valid_to || "?"})`
            )
            .join(", ");
          return {
            ok: false,
            code: "OUT_OF_EFFECTIVE_DATE_WINDOW",
            reason_th: `งวดวันที่ ${targetIso} อยู่นอกช่วงวันใช้บังคับของกฎหมายลำดับรองที่อ้างถึง (${labels}) และข้อความร่างไม่ได้ระบุการสิ้นสุด/ไม่ครอบคลุมควบคู่หลักฐานที่ใช้บังคับได้`,
          };
        }
      }
    }
    return { ok: true };
  }

  const outOfWindowItems = citedItems.filter(
    (p) => p.effective_dates.temporal_applicability_hint === "OUT_OF_WINDOW"
  );
  if (outOfWindowItems.length > 0 && controllingIso) {
    // Allow citing an out-of-window decree ONLY if the conclusion explicitly states it does NOT apply
    // AND another in-window governing passage supports the claim.
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

function extractMonetaryAmountsThb(txt: string): number[] {
  const vals: number[] = [];
  for (const am of thaiDigitsToArabic(txt).matchAll(
    /(?:(?:THB|฿)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)|([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท))/gi
  )) {
    const rawNum = (am[1] || am[2] || "").replace(/,/g, "");
    const n = Number(rawNum);
    if (!Number.isFinite(n) || n <= 0) continue;
    vals.push(am[3] === "ล้านบาท" ? n * 1_000_000 : n);
  }
  return vals;
}

function detectSupersededMonetaryBase(factLedger: StructuredCaseFactLedger): {
  activeBaseThb: number;
  supersededBasesThb: number[];
} | null {
  if (factLedger.user_turns.length < 2) return null;
  const declaredLots = factLedger.temporal_facts.declared_goods_lots || [];
  const latestTurnForLotCheck = factLedger.user_turns[factLedger.user_turns.length - 1];
  const latestTextForLotCheck = thaiDigitsToArabic(latestTurnForLotCheck.raw_text);
  // A follow-up that reassigns an existing lot event (e.g. "30 Sep 20,000 THB covers Lot B instead of Lot A,
  // all other facts remain unchanged") does NOT supersede the overall transaction base (`50,000 THB`)!
  if (
    declaredLots.length >= 2 &&
    !/(?:ราคารวม|มูลค่ารวม|ราคาสินค้าทั้งหมด|แก้ราคาขายรวม|เปลี่ยนราคารวม)/i.test(
      latestTextForLotCheck
    )
  ) {
    const latestAmts = extractMonetaryAmountsThb(latestTextForLotCheck);
    const mentionsExistingLot = /(?:ล็อต|ล๊อต|ชุดที่|รายการที่|\blot\b)/i.test(latestTextForLotCheck);
    if (
      mentionsExistingLot &&
      (latestAmts.length === 0 ||
        latestAmts.every((a) => declaredLots.some((dl) => Math.abs(dl.amount_thb - a) <= 1)))
    ) {
      return null;
    }
  }
  const activeValFact = factLedger.material_facts.find(
    (f) =>
      /_thb$/i.test(f.fact_key) &&
      Boolean(f.overridden_from) &&
      f.source_turn > (f.overridden_from?.previous_turn ?? f.source_turn)
  );
  if (activeValFact?.overridden_from) {
    const curMatch = activeValFact.normalized_category.match(/_THB_(\d+)/);
    const curVal = curMatch ? Number(curMatch[1]) : null;
    const prevVals = extractMonetaryAmountsThb(activeValFact.overridden_from.previous_text_th);
    if (curVal !== null && Number.isFinite(curVal) && prevVals.length > 0) {
      return {
        activeBaseThb: curVal,
        supersededBasesThb: prevVals.filter((p) => Math.abs(p - curVal) > 1),
      };
    }
  }
  const latestTurn = factLedger.user_turns[factLedger.user_turns.length - 1];
  const latestText = thaiDigitsToArabic(latestTurn.raw_text);
  const hasExplicitEditCue =
    /(?:แก้ไข|แก้เป็น|เปลี่ยน(?:มูลค่า|ฐาน|ราคา|ค่าบริการ|ยอด)|ปรับ(?:มูลค่า|ฐาน|ราคา|ยอด)|change|update|revise)/i.test(
      latestText
    );
  if (!hasExplicitEditCue) return null;
  const latestAmounts = extractMonetaryAmountsThb(latestText);
  if (latestAmounts.length === 0) return null;
  const activeBase = latestAmounts[latestAmounts.length - 1];
  const priorAmounts = factLedger.user_turns
    .slice(0, -1)
    .flatMap((t) => extractMonetaryAmountsThb(t.raw_text))
    .filter((p) => Math.abs(p - activeBase) > 1);
  if (priorAmounts.length === 0) return null;
  return { activeBaseThb: activeBase, supersededBasesThb: Array.from(new Set(priorAmounts)) };
}

function resolveSingleTransactionVatBaseCeilingThb(
  factLedger: StructuredCaseFactLedger,
  supersededBaseInfo: { activeBaseThb: number; supersededBasesThb: number[] } | null
): number | null {
  if (supersededBaseInfo && supersededBaseInfo.activeBaseThb > 0) {
    return supersededBaseInfo.activeBaseThb;
  }
  const vatAlloc = factLedger.temporal_facts.vat_portion_allocation_record;
  if (
    vatAlloc &&
    vatAlloc.allocation_status === "RESOLVED" &&
    vatAlloc.transaction_base_thb > 0
  ) {
    return vatAlloc.transaction_base_thb;
  }
  const ctrlEvent = factLedger.temporal_facts.controlling_tax_point.controlling_event || "";
  const splitPts = factLedger.temporal_facts.split_payment_tax_points || [];
  if (
    factLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
    !ctrlEvent.includes("CONDITIONAL") &&
    splitPts.length >= 2 &&
    splitPts.every((sp) => typeof sp.amount_thb === "number" && sp.amount_thb > 0)
  ) {
    return splitPts.reduce((s, sp) => s + (sp.amount_thb ?? 0), 0);
  }
  const activeText = thaiDigitsToArabic(
    factLedger.user_turns.map((t) => t.cleaned_active_text || t.raw_text).join(" ")
  );
  // Explicit total sale/service price marker
  const explicitTotalMatches = Array.from(
    activeText.matchAll(
      /(?:ขายสินค้า[^\n,.;]{0,65}?(?:ใน)?ราคา(?:รวม)?|ราคารวม(?:ทั้งสิ้น)?|มูลค่ารวม(?:ทั้งสิ้น)?|ราคาสินค้า(?:ทั้งหมด|รวม)?(?:\s*ก่อน[^\n,.;]{0,25})?\s*(?:คือ|จำนวน|เท่ากับ)?|ค่าสินค้า(?:\s*ก่อน[^\n,.;]{0,25})?\s*(?:คือ|จำนวน|เท่ากับ)?)\s*(?:THB|฿)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท)?/gi
    )
  );
  if (explicitTotalMatches.length > 0) {
    const last = explicitTotalMatches[explicitTotalMatches.length - 1];
    const n = Number((last[1] || "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) {
      return last[2] === "ล้านบาท" ? n * 1_000_000 : n;
    }
  }
  // If every principal (non-disputed-tax) monetary amount mentioned in the transaction equals the same single base M,
  // repeating M across title/delivery/payment/invoice of the same goods/service never increases the ceiling above M.
  const principalFacts = factLedger.material_facts.filter(
    (f) =>
      f.fact_key === "service_or_sale_consideration_thb" ||
      f.fact_key === "stated_asset_value_thb" ||
      f.fact_key === "stated_deed_or_agreed_value_thb"
  );
  const distinctBases = Array.from(
    new Set(
      principalFacts
        .flatMap((f) => extractMonetaryAmountsThb(f.original_text_th))
        .filter((v) => v > 0)
    )
  );
  if (distinctBases.length === 1) {
    return distinctBases[0];
  }
  return null;
}

function verifyProposedCalculation(params: {
  issue: LlmDraftedIssue;
  citedItems: GroundedPassagePackItem[];
  factLedger: StructuredCaseFactLedger;
  isSingleSummaryIssue?: boolean;
}): {
  accepted: boolean;
  verifiedCalc: (LlmProposedCalculation & { verification_status: "VERIFIED_BY_REG24" }) | null;
  verifiedNumericTokens: string[];
  rejection?: RejectedCalculationAuditEntry;
} {
  const calc = params.issue.proposed_calculation;
  const issueScopeBlob = thaiDigitsToArabic(
    `${params.issue.issue_title_th} ${params.issue.party_or_scope_th} ${params.issue.conclusion_th}`
  );
  const allFactBlob = thaiDigitsToArabic(
    [
      ...params.factLedger.user_turns.map((t) => t.raw_text),
      ...params.factLedger.material_facts.map((f) => f.original_text_th),
      ...params.citedItems.map((c) => `${c.work_id} ${c.title_th}`),
    ].join(" ")
  );
  const isImmovableContext =
    /(?:ที่ดิน|ห้องชุด|คอนโด|บ้านเดี่ยว|บ้านพร้อมที่ดิน|อาคารพาณิชย์|สิ่งปลูกสร้าง|อสังหาริมทรัพย์|prov\.th\.rc\.41_ทวิ)/.test(
      allFactBlob
    ) && !/(?:เงินสด|โอนเงิน)/.test(allFactBlob);
  const isImmovableRecipientPitIssue =
    isImmovableContext &&
    /(?:ผู้รับโอน|ผู้รับให้|ภาระภาษีเงินได้(?:บุคคลธรรมดา)?ของ(?:นางสาว|นาย|นาง|หลาน|บุตร))/.test(
      issueScopeBlob
    ) &&
    !/(?:ผู้โอน(?!และผู้รับ)|ผู้ให้|หักภาษี\s*ณ\s*ที่จ่าย|มาตรา\s*54|ความรับผิดร่วม|ผู้โอนเป็นหลัก|ภาษีธุรกิจเฉพาะ|อากรแสตมป์)/.test(
      `${params.issue.issue_title_th} ${params.issue.party_or_scope_th}`
    );

  // Immovable-property recipient PIT guard (G2b, G3, G4, G3t2, G1, M1t1, M1t2):
  // Never allow ANY recipient tax figure (including 0 / 0 บาท) when authority establishes only donor-side rules!
  if (
    isImmovableRecipientPitIssue &&
    calc &&
    (calc.is_computable_from_stated_facts ||
      calc.computed_tax_thb !== null ||
      calc.tax_base_thb !== null)
  ) {
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
        rejection_code: "UNSUPPORTED_IMMOVABLE_RECIPIENT_CALCULATION",
        rejection_reason_th:
          "ระงับตัวเลขคำนวณฝั่งผู้รับโอนอสังหาริมทรัพย์ (รวมถึงค่าศูนย์) เนื่องจากบทบัญญัติที่อ้างอิงไม่ได้กำหนดภาระภาษีเงินได้หรือวงเงินยกเว้นของผู้รับโอนอสังหาริมทรัพย์เป็นตัวเลขได้",
      },
    };
  }

  if (!calc || !calc.is_computable_from_stated_facts) {
    return { accepted: true, verifiedCalc: null, verifiedNumericTokens: [] };
  }

  // Statutory Section 47 (`มาตรา 47`) allowance sum check (no tax rate_pct; verifies exact multi-allowance sum
  // against stated family facts and suppresses mislabelling an allowance sum as `ภาษีที่คำนวณได้`):
  const citesSection47OnlyAllowance =
    params.citedItems.some((p) => p.work_id === "prov.th.rc.47") &&
    !params.citedItems.some((p) => p.work_id === "prov.th.rc.48" || p.work_id === "sched.th.rc.income_tax_rate") &&
    (calc.rate_pct === null || calc.rate_pct === 0);
  if (citesSection47OnlyAllowance) {
    const s47Eval = verifySection47AllowanceComponentsFromFacts({
      userContextText: params.factLedger.user_turns
        .map((t) => t.cleaned_active_text || t.raw_text)
        .join(" "),
      citedVerbatimText: params.citedItems.map((p) => p.verbatim_text).join("\n"),
    });
    const candidateCalcValues = [
      calc.exempt_amount_thb,
      calc.computed_tax_thb,
      calc.taxable_amount_thb,
      calc.tax_base_thb,
    ]
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
      .map((v) => Math.round(v));
    if (s47Eval.applicable && candidateCalcValues.length > 0) {
      const allValid = candidateCalcValues.every((v) => s47Eval.validAmountsThb.includes(v));
      const matchesExpectedTotalOrComponent = params.isSingleSummaryIssue
        ? allValid &&
          s47Eval.expectedTotalThb !== null &&
          candidateCalcValues.includes(s47Eval.expectedTotalThb) &&
          Math.max(...candidateCalcValues) === s47Eval.expectedTotalThb
        : allValid;
      if (matchesExpectedTotalOrComponent) {
        return {
          accepted: true,
          verifiedCalc: null,
          verifiedNumericTokens: s47Eval.verifiedNumericTokens,
        };
      }
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
          rejection_reason_th:
            "ระงับยอดรวมค่าลดหย่อนตามมาตรา 47 ที่เสนอ เนื่องจากไม่ตรงกับผลรวมตามข้อเท็จจริงและบทบัญญัติที่อ้างอิง [รหัสขั้นตอน: S47_AUTHORIZED_SET_TOTAL_MISMATCH]",
        },
      };
    }
  }

  // Out-of-scope / non-applicable duty guard (e.g. K2 bank cash transfer: no WHT duty under §50 / not a dutiable stamp-duty instrument under §103-104):
  // If the LLM filled `tax_base_thb = 24,000,000` with `taxable_amount_thb = 0, rate_pct = 0, computed_tax_thb = 0`
  // on a non-immovable-recipient out-of-scope issue, treat as non-computable (no calculation card, no false ARITHMETIC_MISMATCH)!
  const isOutOfScopeNoDutyIssue =
    !isImmovableRecipientPitIssue &&
    /(?:ไม่มีหน้าที่(?:ต้อง)?หักภาษี|ไม่อยู่ในบังคับต้อง(?:เสีย|หัก)|มิใช่ตราสารที่ต้อง(?:เสีย|ปิด)อากรแสตมป์|ไม่ต้อง(?:เสีย|ปิด)อากรแสตมป์)/.test(
      issueScopeBlob
    ) &&
    (calc.computed_tax_thb === 0 || calc.computed_tax_thb === null) &&
    (calc.rate_pct === 0 || calc.rate_pct === null) &&
    (calc.taxable_amount_thb === 0 || calc.taxable_amount_thb === null);
  if (isOutOfScopeNoDutyIssue) {
    return { accepted: true, verifiedCalc: null, verifiedNumericTokens: ["0"] };
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

  // Installment & lot/portion allocation consistency guard (Controls B & C + Candidate 10):
  // 1) On a single-portion or lot-scoped issue with a known allocated base, `tax_base_thb` MUST match
  //    THAT exact lot/portion's allocated base — never a swapped installment, wrong split totaling ฿3,500,
  //    or double-counted lot!
  const splitPointsForCalc = params.factLedger.temporal_facts.split_payment_tax_points || [];
  const targetAllocation = resolveIssueTargetAllocation(params.issue, params.factLedger);
  if (targetAllocation && calc.tax_base_thb !== null) {
    if (targetAllocation.hasMixedDatesError) {
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
          rejection_reason_th:
            "ห้ามรวมคำนวณสินค้าหลายล็อตที่มีวันเกิดความรับผิดคนละช่วงวันใช้บังคับของพระราชกฤษฎีกาไว้ในฐานภาษีเดียวกัน [field:tax_point_date]",
        },
      };
    }
    if (
      targetAllocation.expectedBaseThb !== null &&
      targetAllocation.expectedBaseThb > 0 &&
      Math.abs(calc.tax_base_thb - targetAllocation.expectedBaseThb) > 1
    ) {
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
          rejection_reason_th: `ฐานภาษีที่เสนอ (${calc.tax_base_thb.toLocaleString("en-US")} บาท) ไม่ตรงกับมูลค่าที่จัดสรรให้${
            targetAllocation.lotIds.length > 0
              ? `ส่วน/ล็อต (${targetAllocation.lotIds.join(", ")})`
              : `งวดวันที่ ${targetAllocation.targetIso || "-"}`
          } (${targetAllocation.expectedBaseThb.toLocaleString("en-US")} บาท) [field:tax_base_thb]`,
        },
      };
    }
  } else if (
    params.factLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
    splitPointsForCalc.length >= 2 &&
    calc.tax_base_thb !== null
  ) {
    const targetIso = resolveIssueTargetSplitPortionIso(params.issue, splitPointsForCalc);
    const matchedPortion = targetIso
      ? splitPointsForCalc.find((sp) => sp.iso_date === targetIso)
      : undefined;
    if (
      matchedPortion &&
      typeof matchedPortion.amount_thb === "number" &&
      matchedPortion.amount_thb > 0 &&
      Math.abs(calc.tax_base_thb - matchedPortion.amount_thb) > 1
    ) {
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
          rejection_reason_th: `ฐานภาษีที่เสนอ (${calc.tax_base_thb.toLocaleString("en-US")} บาท) ไม่ตรงกับมูลค่าของงวดวันที่ ${targetIso} (${matchedPortion.amount_thb.toLocaleString("en-US")} บาท) [field:tax_base_thb]`,
        },
      };
    }
  }

  // 2) If a later turn explicitly superseded the transaction's stated monetary base (e.g., Turn 1 ฿100k -> Turn 2 ฿200k),
  //    reject any calculation still using the superseded base.
  const supersededBaseInfo = detectSupersededMonetaryBase(params.factLedger);
  if (
    supersededBaseInfo &&
    calc.tax_base_thb !== null &&
    supersededBaseInfo.supersededBasesThb.some((oldVal) => Math.abs(calc.tax_base_thb! - oldVal) <= 1)
  ) {
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
        rejection_reason_th: `ฐานภาษีที่เสนอใช้มูลค่าเดิมที่ถูกแก้ไขทับแล้ว (${calc.tax_base_thb.toLocaleString("en-US")} บาท แทนมูลค่าล่าสุด ${supersededBaseInfo.activeBaseThb.toLocaleString("en-US")} บาท)`,
      },
    };
  }

  // 3) Candidate 9 & 10 (§78(1)):
  //    (a) Reject guessed baht calculations when an early goods event has unknown coverage or ambiguous overlap.
  //    (b) Reject double-counted / excess VAT bases when title, delivery, payment, and invoice cover the same goods!
  const ctrlEventName = params.factLedger.temporal_facts.controlling_tax_point.controlling_event || "";
  if (
    (ctrlEventName.startsWith("GOODS_EARLY_ACT_UNKNOWN_COVERAGE_CONDITIONAL") ||
      ctrlEventName.startsWith("GOODS_EARLY_ACT_AMBIGUOUS_OVERLAP_CONDITIONAL")) &&
    calc.computed_tax_thb !== null
  ) {
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
          params.factLedger.temporal_facts.controlling_tax_point.ambiguity_reason_th ||
          "ยังไม่ทราบมูลค่า สัดส่วน หรือขอบเขตสินค้าที่มีการกระทำก่อนส่งมอบซึ่งอยู่คนละช่วงพระราชกฤษฎีกา จึงไม่อาจคำนวณยอดภาษีแยกแต่ละส่วนเป็นตัวเงินได้ [field:portion_coverage]",
      },
    };
  }

  const isVatCalcIssue = params.citedItems.some(
    (p) =>
      p.work_id === "prov.th.rc.78" ||
      p.work_id === "prov.th.rc.78/1" ||
      p.work_id === "prov.th.rc.80" ||
      p.work_id.startsWith("subreg.th.rc.royal_decree.")
  );
  if (isVatCalcIssue && calc.tax_base_thb !== null) {
    const vatCeiling = resolveSingleTransactionVatBaseCeilingThb(params.factLedger, supersededBaseInfo);
    if (vatCeiling !== null && calc.tax_base_thb > vatCeiling + 1) {
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
          rejection_reason_th: `ฐานภาษีที่เสนอ (${calc.tax_base_thb.toLocaleString("en-US")} บาท) เกินกว่ามูลค่าสินค้าหรือบริการของธุรกรรม (${vatCeiling.toLocaleString("en-US")} บาท) — ห้ามนับฐานภาษีซ้ำเมื่อการโอนกรรมสิทธิ์ การส่งมอบ การรับชำระราคา และการออกใบกำกับภาษีครอบคลุมสินค้าเดียวกัน`,
        },
      };
    }
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
      (calc.rate_pct === 5 && /ร้อยละ\s*(?:5|ห้า)|5%/.test(citedBlob)) ||
      (calc.rate_pct === 1 && /ร้อยละ\s*(?:1|หนึ่ง)|1%/.test(citedBlob)) ||
      (calc.rate_pct === 7 && /6\.3|หกจุดสาม|ร้อยละ\s*7|7%/.test(citedBlob)) ||
      (calc.rate_pct === 0 && /ร้อยละ\s*0|0%|อัตรา\s*0/.test(citedBlob)) ||
      (calc.rate_pct === 3.3 && /ร้อยละ\s*(?:3|สาม)|3\.0|3\.3/.test(citedBlob)) ||
      (calc.rate_pct === 0.5 && /0\.5|ศูนย์จุดห้า|หนึ่งบาท|1\s*บาท\s*ต่อ\s*200/.test(citedBlob));
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
  const grossTotalThb =
    calc.tax_base_thb !== null &&
    calc.computed_tax_thb !== null &&
    Number.isFinite(calc.tax_base_thb) &&
    Number.isFinite(calc.computed_tax_thb)
      ? Math.round((calc.tax_base_thb + calc.computed_tax_thb) * 100) / 100
      : null;
  for (const val of [
    calc.tax_base_thb,
    calc.exempt_amount_thb,
    calc.taxable_amount_thb,
    calc.rate_pct,
    calc.computed_tax_thb,
    grossTotalThb,
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
  } else if (tf.vat_portion_allocation_record?.allocation_status === "RESOLVED") {
    const bucketSummary = tf.vat_portion_allocation_record.tax_date_buckets
      .map(
        (b) =>
          `${b.iso_date} (${b.decree_window}${
            b.lot_labels_th && b.lot_labels_th.length > 0 ? `, ${b.lot_labels_th.join(" + ")}` : ""
          }: ฐานภาษี ${(b.amount_thb ?? 0).toLocaleString("en-US")} บาท${
            typeof b.verified_vat_thb === "number"
              ? `, VAT ${b.verified_vat_thb.toLocaleString("en-US")} บาท`
              : ""
          })`
      )
      .join(" · ");
    factLines.push(
      `- **การจัดสรรวันเกิดความรับผิดแยกตามส่วน/ล็อตสินค้า (Verified VAT Allocation Record)**: ${bucketSummary}`
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
    const fullAnswerDraftText = `${params.verifiedIssues
      .map((v) => `${v.conclusion_th} ${v.application_explanation_th}`)
      .join(" ")} ${params.evidenceGaps.join(" ")}`;
    if (
      /(?:ฉบับที่\s*165|พ\.ร\.ฎ\.[^\n]{0,20}165)/.test(thaiDigitsToArabic(fullAnswerDraftText)) &&
      !params.usedPassages.some((p) => p.work_id === "subreg.th.rc.royal_decree.165")
    ) {
      const ref50 = params.usedPassages.find(
        (p) => p.work_id === "prov.th.rc.50" && thaiDigitsToArabic(p.verbatim_text).includes("165")
      );
      if (ref50?.official_url) {
        sourceLines.push(
          `- **พระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 (อ้างถึงใน ${ref50.official_identifier} มาตรา 50 (5) (ข) \`[${ref50.passage_id}]\`)** — ตัวบทอ้างอิงที่มาตรา 50: ${ref50.official_url} *(หมายเหตุข้อจำกัดคลังข้อมูล: ตารางอัตราค่าใช้จ่ายเหมาตามจำนวนปีถือครองของ พ.ร.ฎ. (ฉบับที่ 165) พ.ศ. 2529 แยกต่างหากยังไม่ได้รวมอยู่ในคลังรุ่นนี้)*`
        );
      }
    }
    sections.push(`**4. แหล่งอ้างอิงที่ตรวจสอบแล้ว (Verified Authorities)**\n${sourceLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

function redactRejectedCalculationNumbers(
  reasonTh: string,
  proposed?: RejectedCalculationAuditEntry["proposed_values"]
): string {
  let out = reasonTh.replace(/999,?888|88\.5%?|1,?129,?808/g, "[REDACTED_REJECTED_VALUE]");
  if (proposed) {
    for (const v of [
      proposed.tax_base_thb,
      proposed.exempt_amount_thb,
      proposed.taxable_amount_thb,
      proposed.rate_pct,
      proposed.computed_tax_thb,
    ]) {
      if (v !== null && Number.isFinite(v) && Math.abs(v) > 0) {
        const rawStr = String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const fmtStr = v.toLocaleString("en-US").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out
          .replace(new RegExp(fmtStr, "g"), "[REDACTED_REJECTED_VALUE]")
          .replace(new RegExp(`\\b${rawStr}\\b`, "g"), "[REDACTED_REJECTED_VALUE]");
      }
    }
  }
  return out;
}

function redactPublicClaimRejectionReasonTh(rawReason: string): string {
  const numRedacted = (rawReason || "")
    .replace(/\(\s*[0-9๐-๙][0-9๐-๙,.\s]*(?:บาท|ล้านบาท|%|เปอร์เซ็นต์|วัน|เดือน|ปี)?\s*\)/g, "(ตัวเลขถูกระงับ)")
    .replace(/[0-9๐-๙]{1,3}(?:,[0-9๐-๙]{3})+\s*(?:บาท|ล้านบาท)?/g, "[ตัวเลขถูกระงับ]")
    .replace(/(?<![0-9๐-๙])[0-9๐-๙]+\s*(?:บาท|ล้านบาท)/g, "[จำนวนเงินถูกระงับ]");
  return redactAuthorityIdentifiersFromPublicDiagnosticTh(numRedacted);
}

function applyPreviewOnlyS47SyntheticFixture(
  issues: LlmDraftedIssue[],
  fixture: QaSyntheticFixtureId | null | undefined,
  passagePack: GroundedPassagePackItem[]
): LlmDraftedIssue[] {
  if (!fixture || fixture === "RC1_REJECTED_CALC" || process.env.VERCEL_ENV === "production") {
    return issues;
  }
  const s47Pids = passagePack.filter((p) => p.work_id === "prov.th.rc.47").map((p) => p.passage_id);
  const fallbackPid = s47Pids[0] || passagePack[0]?.passage_id || "psg.e4ec78f644930e";
  const baseIssue: LlmDraftedIssue = issues[0]
    ? { ...issues[0], governing_passage_ids: s47Pids.length > 0 ? s47Pids : issues[0].governing_passage_ids }
    : {
        issue_id: "s47.synthetic_neg",
        issue_title_th: "สิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47",
        party_or_scope_th: "ผู้มีเงินได้บุคคลธรรมดา",
        conclusion_th: "",
        material_facts_relied_on: [],
        governing_passage_ids: [fallbackPid],
        application_explanation_th: "",
        authority_distinction_note_th: "",
        proposed_calculation: null,
        missing_facts_or_uncertainties_th: [],
      };

  const buildCalc = (amt: number): LlmProposedCalculation => ({
    is_computable_from_stated_facts: true,
    formula_description_th: "ผลรวมค่าลดหย่อนตามมาตรา 47 (Synthetic Negative Control)",
    tax_base_thb: null,
    exempt_amount_thb: amt,
    taxable_amount_thb: null,
    rate_pct: null,
    computed_tax_thb: null,
    missing_inputs_th: [],
    steps_th: [],
  });

  switch (fixture) {
    case "S47_NEG_1_TOTAL_240K":
      return [
        {
          ...baseIssue,
          conclusion_th:
            "ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47 (1) (ก) (ข) และ (ค) รวมทั้งสิ้น 240,000 บาท",
          application_explanation_th:
            "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) หักลดหย่อนส่วนตัว 60,000 บาท มาตรา 47 (1) (ข) คู่สมรสไม่มีเงินได้ 60,000 บาท และมาตรา 47 (1) (ค) (1) บุตรชอบด้วยกฎหมาย 2 คน คนละ 60,000 บาท รวมเป็นเงินทั้งสิ้น 240,000 บาท",
          proposed_calculation: buildCalc(240_000),
        },
      ];
    case "S47_NEG_2_TOTAL_210K_PRE2561":
      return [
        {
          ...baseIssue,
          conclusion_th:
            "ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47 (1) (ก) (ข) และ (ค) รวมทั้งสิ้น 210,000 บาท",
          application_explanation_th:
            "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) หักลดหย่อนส่วนตัว 60,000 บาท มาตรา 47 (1) (ข) คู่สมรส 60,000 บาท และมาตรา 47 (1) (ค) (1) บุตรคนแรก 30,000 บาท บุตรคนที่สอง 60,000 บาท รวมทั้งสิ้น 210,000 บาท",
          proposed_calculation: buildCalc(210_000),
        },
      ];
    case "S47_NEG_3_SINGLE_120K":
      return [
        {
          ...baseIssue,
          conclusion_th:
            "ผู้มีเงินได้โสดมีสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47 (1) (ก) และ (ข) รวมทั้งสิ้น 120,000 บาท",
          application_explanation_th:
            "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) หักลดหย่อนส่วนตัว 60,000 บาท และมาตรา 47 (1) (ข) อีก 60,000 บาท รวมทั้งสิ้น 120,000 บาท",
          proposed_calculation: buildCalc(120_000),
        },
      ];
    case "S47_NEG_4_ADOPTED_BAR_240K":
      return [
        {
          ...baseIssue,
          conclusion_th:
            "ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47 (1) (ก) (ข) และ (ค) รวมทั้งสิ้น 240,000 บาท",
          application_explanation_th:
            "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) ส่วนตัว 60,000 บาท มาตรา 47 (1) (ข) คู่สมรส 60,000 บาท มาตรา 47 (1) (ค) (1) บุตรชอบด้วยกฎหมาย 3 คน 90,000 บาท และมาตรา 47 (1) (ค) (2) บุตรบุญธรรมอีก 1 คน 30,000 บาท รวมทั้งสิ้น 240,000 บาท",
          proposed_calculation: buildCalc(240_000),
        },
      ];
    case "S47_NEG_5_WRONG_SUBPARA_47_1_NGOR":
      return [
        {
          ...baseIssue,
          conclusion_th:
            "ผู้มีเงินได้มีสิทธิหักลดหย่อนส่วนตัวตามมาตรา 47 (1) (ก) คู่สมรสตามมาตรา 47 (1) (ข) และค่าลดหย่อนบุตรตามมาตรา 47 (1) (ง) รวมทั้งสิ้น 180,000 บาท",
          application_explanation_th:
            "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) จำนวน 60,000 บาท มาตรา 47 (1) (ข) จำนวน 60,000 บาท และอ้างมาตรา 47 (1) (ง) สำหรับบุตร 2 คน คนละ 30,000 บาท เป็นเงิน 60,000 บาท รวมทั้งสิ้น 180,000 บาท",
          proposed_calculation: buildCalc(180_000),
        },
      ];
    case "S47_NEG_6_SUBSET_TOTAL_150K":
      return [
        {
          ...baseIssue,
          conclusion_th:
            "ผู้มีเงินได้มีสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47 (1) (ก) (ข) และ (ค) รวมทั้งสิ้น 150,000 บาท",
          application_explanation_th:
            "ตามประมวลรัษฎากร มาตรา 47 (1) (ก) ส่วนตัว 60,000 บาท มาตรา 47 (1) (ข) คู่สมรส 60,000 บาท และมาตรา 47 (1) (ค) (1) บุตร 30,000 บาท รวมทั้งสิ้น 150,000 บาท",
          proposed_calculation: buildCalc(150_000),
        },
      ];
    default:
      return issues;
  }
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
  qaSyntheticFixture?: QaSyntheticFixtureId | null;
  specialConstraints?: GroundedLlmSpecialConstraints;
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
      `ไม่สามารถสร้างคำวิเคราะห์จากแบบจำลองภาษาได้ในขณะนี้ (Trace ID: ${params.traceId}): ${detailReason} — ระบบจึงระงับการเผยแพร่คำตอบ ไม่บันทึกเป็นคำตอบที่เสร็จสมบูรณ์ และ **ไม่สลับไปใช้แบบจำลองรุ่นอื่น (เช่น Flash/Flash-Lite) หรือข้อความสรุปสำเร็จรูปโดยอัตโนมัติ (No Silent Fallback)**`;
    return {
      status: "REVIEW_REQUIRED",
      rendered_answer_th: unableMsg,
      verified_issues: [],
      claims: [],
      evidence_cards: [],
      assumptions_th: [],
      clarification_questions_th: [],
      coverage_warnings_th: [
        `[${fc}] Trace ${params.traceId}: ${params.invocationAudit.error_summary || "LLM provider unavailable; silent fallback disabled."}`,
      ],
      rejected_calculations_diagnostic: [],
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

  // Post-LLM Deterministic Abstention Enforcement for Unresolved Explicit Rulings (CI1) & Pre-Cutoff VAT Coverage (VF/VG)
  if ((params.specialConstraints?.unresolved_explicit_ruling_ids?.length || 0) > 0) {
    const missingIds = params.specialConstraints!.unresolved_explicit_ruling_ids!;
    const missingLabel = missingIds.join(", ");
    const releaseLabel = params.passagePack[0]?.version_id ? "rel.B01.rc8" : "rel.B01.rc8";
    const normalizedMissingSet = new Set(
      missingIds.flatMap((id) =>
        extractNamedAuthoritiesFromText(id)
          .filter((a) => a.kind === "ruling")
          .map((a) => a.canonicalId)
      )
    );
    const summaryExtractedAuths = extractNamedAuthoritiesFromText(
      params.draft.overall_summary_th || ""
    );
    const summaryHasForeignAuthority = summaryExtractedAuths.some(
      (a) =>
        a.kind === "rd_url" ||
        (a.kind === "ruling" && !normalizedMissingSet.has(a.canonicalId))
    );
    const draftSummaryClean =
      params.draft.overall_summary_th &&
      !summaryHasForeignAuthority &&
      missingIds.every((id) => params.draft!.overall_summary_th.includes(id.replace(/^กค\s+/, ""))) &&
      !/ได้รับยกเว้น|ไม่ต้องหักภาษี/.test(params.draft.overall_summary_th)
        ? params.draft.overall_summary_th
        : null;
    const abstentionMsg =
      draftSummaryClean ||
      `ไม่พบข้อมูล / หลักฐานไม่เพียงพอ — ไม่พบหนังสือตอบข้อหารือกรมสรรพากรเลขที่ ${missingLabel} ในคลังข้อมูลที่ผ่านการรับรองของ REG24 (${releaseLabel}) ระบบจึงระงับการยืนยันข้อกฎหมายตามหนังสือตอบข้อหารือดังกล่าว และไม่นำข้อหารือหรือบทบัญญัติอื่นมาสรุปสวมรอยแทน`;
    return {
      status: "INSUFFICIENT_EVIDENCE",
      rendered_answer_th: abstentionMsg,
      verified_issues: [],
      claims: [
        {
          claim_id: `clm.${params.traceId}.abstain`,
          statement: abstentionMsg,
          claim_type: "abstention_notice",
          statement_role: "reg24_inference",
          supporting_passage_ids: [],
          applicable_version_id: null,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "UNSUPPORTED",
        },
      ],
      evidence_cards: [],
      assumptions_th: [],
      clarification_questions_th:
        params.draft.clarification_questions_th?.length > 0
          ? params.draft.clarification_questions_th
          : [`กรุณาตรวจสอบเลขที่หนังสือตอบข้อหารือ (${missingLabel}) หรือวันที่ออกหนังสืออีกครั้ง`],
      coverage_warnings_th: [abstentionMsg],
      rejected_calculations_diagnostic: [],
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

  if (params.specialConstraints?.pre_cutoff_vat_coverage_constraint) {
    const preVat = params.specialConstraints.pre_cutoff_vat_coverage_constraint;
    const preCutoffMsg =
      `ข้อจำกัดขอบเขตข้อมูลสำหรับวันเกิดความรับผิด ${preVat.controlling_date_iso} — ขอบเขตการตอบอัตราภาษีมูลค่าเพิ่มที่มีหลักฐานต้นฉบับราชกิจจานุเบกษาตรวจสอบครบถ้วนในคลังข้อมูลเริ่มตั้งแต่วันที่ 1 ตุลาคม 2566 (2023-10-01) เป็นต้นไป (พ.ร.ฎ. ฉบับที่ 780, 790, 799 และ 807) สำหรับวันเกิดความรับผิดก่อนวันที่ 1 ตุลาคม 2566 สายการแก้ไขเพิ่มเติมและต้นฉบับราชกิจจานุเบกษายังไม่ครบถ้วน ระบบจึงระงับการระบุอัตราภาษี ไม่คำนวณจำนวนเงินภาษีขาย และไม่อ้างเอกสารฉบับรวมกฎหมายย้อนหลัง`;
    return {
      status: "INSUFFICIENT_EVIDENCE",
      rendered_answer_th: preCutoffMsg,
      verified_issues: [],
      claims: [
        {
          claim_id: `clm.${params.traceId}.abstain_vat_pre_cutoff`,
          statement: preCutoffMsg,
          claim_type: "abstention_notice",
          statement_role: "reg24_inference",
          supporting_passage_ids: [],
          applicable_version_id: null,
          factual_conditions: [],
          exceptions: [],
          counterevidence_passage_ids: [],
          verification_result: "UNSUPPORTED",
        },
      ],
      evidence_cards: [],
      assumptions_th: [],
      clarification_questions_th: [
        "กรุณาตรวจสอบต้นฉบับราชกิจจานุเบกษาของพระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่มที่ใช้บังคับสำหรับวันเกิดความรับผิดก่อนวันที่ 1 ตุลาคม 2566 โดยตรง หรือยืนยันวันเกิดความรับผิดที่อยู่ในช่วงตั้งแต่วันที่ 1 ตุลาคม 2566 เป็นต้นไป",
      ],
      coverage_warnings_th: [preCutoffMsg],
      rejected_calculations_diagnostic: [],
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

  const workingIssues = applyPreviewOnlyS47SyntheticFixture(
    params.draft.issues,
    params.qaSyntheticFixture,
    params.passagePack
  );

  const claimsBefore = workingIssues.map((iss) => ({
    issue_id: iss.issue_id,
    issue_title_th: iss.issue_title_th,
    conclusion_th: iss.conclusion_th,
    governing_passage_ids: [...(iss.governing_passage_ids || [])],
    has_proposed_calculation: Boolean(iss.proposed_calculation?.is_computable_from_stated_facts),
  }));

  // Change 2: If `prov.th.rc.47` is supplied for a §47 allowance question and the user named a child type
  // without a parseable count (e.g. "มีบุตรชอบด้วยกฎหมายหลายคน"), route cleanly to NEEDS_CLARIFICATION
  // instead of guessing 0 children or failing with REVIEW_REQUIRED!
  const s47PackPassages = params.passagePack.filter((p) => p.work_id === "prov.th.rc.47");
  const s47ActiveUserContext = params.factLedger.user_turns
    .map((t) => t.cleaned_active_text || t.raw_text)
    .join(" ");
  if (
    s47PackPassages.length > 0 &&
    (/มาตรา\s*47\b|section\s*47\b/i.test(s47ActiveUserContext) || /ลดหย่อน/.test(s47ActiveUserContext))
  ) {
    const s47PreEval = verifySection47AllowanceComponentsFromFacts({
      userContextText: s47ActiveUserContext,
      citedVerbatimText: s47PackPassages.map((p) => p.verbatim_text).join("\n"),
    });
    if (s47PreEval.applicable && s47PreEval.needsChildCountClarification) {
      recordSection47RestrictedDiagnostic({
        trace_id: params.traceId,
        issue_id: workingIssues[0]?.issue_id || "s47.child_count_clarification",
        outcome: "CLARIFICATION_REQUIRED",
        stage_code: "S47_FACT_EXTRACTION_CLARIFICATION",
        cleaned_active_text: s47ActiveUserContext,
        extracted_facts: s47PreEval.extractedFacts,
        authorized_valid_amounts_thb: s47PreEval.validAmountsThb,
        expected_total_thb: s47PreEval.expectedTotalThb,
        draft_numeric_tokens: [],
        rejected_token: null,
        qa_synthetic_fixture: params.qaSyntheticFixture ?? null,
      });
      const clarifyQs = [
        "กรุณาระบุจำนวนบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่และจำนวนบุตรบุญธรรม (พร้อมระบุปี พ.ศ. ที่เกิดของบุตรแต่ละคนว่าเกิดก่อนหรือตั้งแต่ปี พ.ศ. 2561) เพื่อคำนวณสิทธิหักลดหย่อนตามมาตรา 47 (1) (ค) ได้อย่างถูกต้อง",
      ];
      const clarifyMsg =
        "ต้องการข้อมูลจำนวนบุตรที่แน่นอนเพิ่มเติม (จำนวนบุตรชอบด้วยกฎหมายที่มีชีวิตอยู่ จำนวนบุตรบุญธรรม และลำดับปี พ.ศ. ที่เกิดเทียบกับปี พ.ศ. 2561) เพื่อคำนวณยอดรวมค่าลดหย่อนตามมาตรา 47 — ระบบไม่สมมติให้จำนวนบุตรเป็นศูนย์และยังไม่สรุปตัวเลขรวมจนกว่าจะได้รับข้อมูลครบถ้วน";
      return {
        status: "NEEDS_CLARIFICATION",
        rendered_answer_th: clarifyMsg,
        verified_issues: [],
        claims: [],
        evidence_cards: [],
        assumptions_th: params.draft.assumptions_th || [],
        clarification_questions_th: clarifyQs,
        coverage_warnings_th: [],
        rejected_calculations_diagnostic: [],
        audit_trace: {
          schema_version: "reg24.llm_audit_trace.v1",
          generation_mode: "llm_grounded",
          staging_flag_active: params.stagingFlagActive,
          template_fallback_used: false,
          input_fact_ledger: params.factLedger,
          supplied_passages: suppliedPassagesAudit,
          consumed_passage_ids: [],
          consumed_passage_versions: [],
          provider_invocation: params.invocationAudit,
          claims_before_verification: claimsBefore,
          claims_after_verification: [],
          rejected_claims: [],
          rejected_calculations: [],
          final_answer_revision_id: null,
        },
      };
    }
  }

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
        "ระงับการคำนวณทดสอบสังเคราะห์ RC1 เนื่องจากไม่มีหลักฐานอัตราภาษีในตัวบทอ้างอิง และยืนยันว่าไม่มีตัวเลขหรือขั้นตอนที่ถูกระงับรั่วไหลสู่ UI, API หรือฉบับที่บันทึก",
    });
  }

  const totalS47IssueCount = workingIssues.filter((wIss) =>
    (wIss.governing_passage_ids || []).some((pid) => packById.get(pid)?.work_id === "prov.th.rc.47")
  ).length;
  const isClarificationTurn =
    params.draft.answer_status === "NEEDS_CLARIFICATION" ||
    Boolean(params.specialConstraints?.needs_vat_date_clarification);

  const toVerifiedAuthorityBindings = (pids: string[]): VerifiedAuthorityPassageBinding[] => {
    const out: VerifiedAuthorityPassageBinding[] = [];
    for (const pid of pids) {
      const item = packById.get(pid);
      if (!item) continue;
      const ver = params.state.versions[item.version_id];
      if (!ver) continue;
      const work = params.state.works[item.work_id];
      out.push({
        passage_id: item.passage_id,
        work_id: item.work_id,
        version_id: item.version_id,
        work_type: work?.type || null,
        authority_tier: item.authority_tier,
        official_identifier: item.official_identifier,
        title_th: item.title_th,
        pinpoint: item.pinpoint,
        verbatim_text: item.verbatim_text,
        official_url: item.official_url,
        temporal_applicability_hint: item.effective_dates.temporal_applicability_hint,
      });
    }
    return out;
  };

  const factNumericTokenSet = new Set<string>(factNumericTokens);
  const stripTentativeClarificationArithmeticTh = (text: string): string => {
    if (!isClarificationTurn || !text) return text;
    return text
      .replace(
        /\s*\([^()]{0,220}?(?:หากใช้|สมมติ|คิดเป็น|เท่ากับ|เป็นเงิน)[^()]{0,160}?([0-9๐-๙]{1,3}(?:,[0-9๐-๙]{3})+|[0-9๐-๙]+(?:\.[0-9๐-๙]+)?)\s*บาท[^()]{0,120}?\)/gu,
        (full, rawNum: string) => {
          const normNum = thaiDigitsToArabic(rawNum).replace(/,/g, "");
          return factNumericTokenSet.has(normNum) ? full : "";
        }
      )
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  let strippedIncidentalMissingAuthorityCount = 0;

  for (let idx = 0; idx < workingIssues.length; idx++) {
    const rawIss = workingIssues[idx];
    const issPreCommencement: LlmDraftedIssue = isClarificationTurn
      ? {
          ...rawIss,
          conclusion_th: stripTentativeClarificationArithmeticTh(rawIss.conclusion_th),
          application_explanation_th: stripTentativeClarificationArithmeticTh(
            rawIss.application_explanation_th
          ),
          missing_facts_or_uncertainties_th: (
            rawIss.missing_facts_or_uncertainties_th || []
          )
            .map(stripTentativeClarificationArithmeticTh)
            .filter(Boolean),
        }
      : rawIss;
    // Candidate 8: amending-decree commencement kept separate from the restated period (clarification turns
    // never assert a governing decree, so they are left untouched).
    const iss: LlmDraftedIssue = isClarificationTurn
      ? issPreCommencement
      : applyAmendingDecreeCommencementAttribution(issPreCommencement, packById, params.passagePack);
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

    // Gate 4: Independent Calculation Verification (VC-EQ: never expose unapproved arithmetic or bound_calculation on NEEDS_CLARIFICATION!)
    const citesSection47InIssue = citedPackItems.some((p) => p.work_id === "prov.th.rc.47");
    const effectiveIssueForCalc: LlmDraftedIssue = isClarificationTurn
      ? { ...iss, proposed_calculation: null }
      : iss;
    const calcCheck = verifyProposedCalculation({
      issue: effectiveIssueForCalc,
      citedItems: citedPackItems,
      factLedger: params.factLedger,
      isSingleSummaryIssue: citesSection47InIssue ? totalS47IssueCount <= 1 : undefined,
    });
    if (!calcCheck.accepted && calcCheck.rejection) {
      rejectedCalculations.push(calcCheck.rejection);
    }

    // Gate 5: Substantive Claim-to-Passage Entailment (`verifyClaimAgainstPassages`)
    // Verify the complete issue claim (conclusion + legal application explanation) together against
    // its cited governing passages so both the conclusion AND every cited section in the explanation are verified!
    // On §47 issues, never let non-year user-prompt figures (such as a disputed wrong allowance figure) enter trustedTokens!
    const baseFactTokensForIssue = citesSection47InIssue
      ? Array.from(factNumericTokens).filter((tok) => {
          const numVal = Number(tok.replace(/,/g, ""));
          return Number.isFinite(numVal) && numVal > 0 && numVal < 10_000;
        })
      : Array.from(factNumericTokens);
    const trustedTokens = new Set<string>([
      ...baseFactTokensForIssue,
      ...calcCheck.verifiedNumericTokens,
    ]);
    // Ground Thai statutory word-number thresholds ("ยี่สิบล้านบาท" -> 20,000,000; "สิบล้านบาท" -> 10,000,000; "ร้อยละห้า" -> 5)
    // and deterministic excess/5%-tax derivations ONLY on non-recipient-immovable issues when calcCheck.accepted!
    const citedVerbatimNorm = thaiDigitsToArabic(citedPackItems.map((p) => p.verbatim_text).join(" "));
    const issueScopeNorm = thaiDigitsToArabic(`${iss.issue_title_th} ${iss.party_or_scope_th}`);
    const isRecipientOnImmovable =
      /(?:ผู้รับโอน|ผู้รับให้|ภาระภาษีเงินได้(?:บุคคลธรรมดา)?ของ(?:นางสาว|นาย|นาง|หลาน|บุตร))/.test(issueScopeNorm) &&
      !/(?:ผู้โอน(?!และผู้รับ)|ผู้ให้|หักภาษี\s*ณ\s*ที่จ่าย|มาตรา\s*54|ความรับผิดร่วม|ผู้โอนเป็นหลัก|เงินสด)/.test(issueScopeNorm) &&
      citedPackItems.some((p) => p.work_id === "prov.th.rc.41_ทวิ" || /\(26\)/.test(p.verbatim_text));
    if (!isRecipientOnImmovable && calcCheck.accepted) {
      const hasMaritalHalfShareAuthority =
        /คนละกึ่งหนึ่ง|คนละส่วนเท่ากัน/.test(citedVerbatimNorm) ||
        params.factLedger.material_facts.some(
          (f) => f.normalized_category === "MARITAL_COMMUNITY_PROPERTY_CO_OWNED_SIN_SOMROT"
        );
      if (hasMaritalHalfShareAuthority) {
        const maritalBases = extractMonetaryAmountsThb(
          [
            ...params.factLedger.material_facts
              .filter(
                (f) =>
                  f.fact_key === "official_appraised_value_thb" ||
                  f.fact_key === "appraised_value_thb" ||
                  f.fact_key === "stated_asset_value_thb"
              )
              .map((f) => f.original_text_th),
            ...params.factLedger.user_turns.map((t) => t.raw_text),
          ].join(" ")
        );
        for (const baseVal of maritalBases) {
          if (baseVal > 0 && baseVal % 2 === 0) {
            const halfShare = baseVal / 2;
            trustedTokens.add(String(halfShare));
            trustedTokens.add(halfShare.toLocaleString("en-US"));
          }
        }
      }
      if (citedVerbatimNorm.includes("ยี่สิบล้านบาท")) {
        trustedTokens.add("20000000");
        trustedTokens.add("20,000,000");
        trustedTokens.add("20");
        const activeBasesForThreshold = extractMonetaryAmountsThb(
          params.factLedger.material_facts
            .filter((f) => f.fact_key === "appraised_value_thb" || f.fact_key === "stated_asset_value_thb")
            .map((f) => f.original_text_th)
            .join(" ")
        );
        const citesFivePct = /ร้อยละ\s*(?:5|ห้า)/.test(citedVerbatimNorm);
        if (citesFivePct) trustedTokens.add("5");
        // Candidate 8: the 5%-of-excess figure exists in law ONLY for a legitimate (non-adopted) child recipient
        // (§48(4/1) / §50(6) proviso). After a follow-up changes the recipient (adopted child, nephew, etc.), the
        // Turn-1 derived amount (e.g. ฿100,000) must never be trusted as a grounded figure.
        const recipientKinship = params.factLedger.fact_preservation_guards.recipient_kinship_category;
        const allowsLegitChildFivePctDerivation =
          !recipientKinship || recipientKinship === "LEGITIMATE_CHILD_NON_ADOPTED";
        for (const baseVal of activeBasesForThreshold) {
          if (baseVal > 20_000_000) {
            const excess = baseVal - 20_000_000;
            trustedTokens.add(String(excess));
            trustedTokens.add(excess.toLocaleString("en-US"));
            if (citesFivePct && allowsLegitChildFivePctDerivation) {
              const fivePctTax = Math.round(excess * 0.05 * 100) / 100;
              trustedTokens.add(String(fivePctTax));
              trustedTokens.add(fivePctTax.toLocaleString("en-US"));
            }
          }
        }
      }
      if (citedVerbatimNorm.includes("สิบล้านบาท")) {
        trustedTokens.add("10000000");
        trustedTokens.add("10,000,000");
        trustedTokens.add("10");
      }
    }

    const fullIssueClaimStatement = iss.application_explanation_th
      ? `[${iss.issue_title_th} — ${iss.party_or_scope_th}] ${iss.conclusion_th} (${iss.application_explanation_th})`
      : `[${iss.issue_title_th} — ${iss.party_or_scope_th}] ${iss.conclusion_th}`;

    // DEF-C3-2 & DEF-C4-1/2 (Candidate 5 Changes 1–6 + Restricted Server-Side Diagnostics):
    let s47IssueEval: Section47AllowanceEvalResult | null = null;
    let s47DraftNumericTokens: string[] = [];
    if (citesSection47InIssue) {
      s47IssueEval = verifySection47AllowanceComponentsFromFacts({
        userContextText: s47ActiveUserContext,
        citedVerbatimText: citedVerbatimNorm,
      });
      if (s47IssueEval.applicable) {
        const s47ClaimCheck = evaluateSection47ClaimAmountsAndSubclauses({
          conclusionTh: iss.conclusion_th,
          applicationExplanationTh: iss.application_explanation_th || "",
          fullClaimStatement: fullIssueClaimStatement,
          userContextText: s47ActiveUserContext,
          s47Eval: s47IssueEval,
          isSingleSummaryIssue: totalS47IssueCount <= 1,
        });
        s47DraftNumericTokens = s47ClaimCheck.draftNumericTokens;

        if (!s47ClaimCheck.ok || !calcCheck.accepted) {
          const stageCode = !s47ClaimCheck.ok
            ? s47ClaimCheck.stageCode!
            : "S47_AUTHORIZED_SET_TOTAL_MISMATCH";
          const calcProposedAmt =
            iss.proposed_calculation?.exempt_amount_thb ??
            iss.proposed_calculation?.computed_tax_thb ??
            iss.proposed_calculation?.tax_base_thb ??
            iss.proposed_calculation?.taxable_amount_thb ??
            null;
          const rejectedTok = !s47ClaimCheck.ok
            ? s47ClaimCheck.rejectedToken || null
            : calcProposedAmt !== null
              ? `${Math.round(calcProposedAmt)} บาท`
              : "PROPOSED_CALC_MISMATCH";

          recordSection47RestrictedDiagnostic({
            trace_id: params.traceId,
            issue_id: iss.issue_id,
            outcome: "SUPPRESSED",
            stage_code: stageCode,
            cleaned_active_text: s47ActiveUserContext,
            extracted_facts: s47IssueEval.extractedFacts,
            authorized_valid_amounts_thb: s47IssueEval.validAmountsThb,
            expected_total_thb: s47IssueEval.expectedTotalThb,
            draft_numeric_tokens: s47DraftNumericTokens,
            rejected_token: rejectedTok,
            qa_synthetic_fixture: params.qaSyntheticFixture ?? null,
          });

          rejectedClaims.push({
            issue_id: iss.issue_id,
            issue_title_th: iss.issue_title_th,
            statement_before_verification: fullIssueClaimStatement,
            cited_passage_ids: validPassageIds,
            rejection_code: stageCode,
            rejection_reason_th:
              s47ClaimCheck.publicRedactedReasonTh ||
              "ระงับการรับรองข้อกล่าวอ้าง เนื่องจากยอดรวมค่าลดหย่อนตามมาตรา 47 ที่เสนอไม่ตรงกับผลรวมตามข้อเท็จจริงและบทบัญญัติที่อ้างอิง [รหัสขั้นตอน: S47_AUTHORIZED_SET_TOTAL_MISMATCH]",
          });
          continue;
        }

        for (const tok of s47IssueEval.verifiedNumericTokens) {
          trustedTokens.add(tok);
        }
        if (s47ClaimCheck.allowZeroTokenInClaim) {
          trustedTokens.add("0");
        }
      }
    }
    // If cited passages include a statutory 6.3% VAT reduction decree (RD 799/807) AND the supplied
    // pack includes the official RD VAT local-tax guide (`6.3% + 1/9 local tax = 7%`), permit the
    // derived combined rate `7` / `0.7` / `6.3` when explaining the combined rate alongside local tax!
    const citesVatReductionDecree = citedPackItems.some(
      (p) =>
        p.work_id === "subreg.th.rc.royal_decree.646" ||
        p.work_id === "subreg.th.rc.royal_decree.780" ||
        p.work_id === "subreg.th.rc.royal_decree.790" ||
        p.work_id === "subreg.th.rc.royal_decree.799" ||
        p.work_id === "subreg.th.rc.royal_decree.807" ||
        p.work_id === "subreg.th.rd.vat_local_tax_guide"
    );
    if (citesVatReductionDecree) {
      trustedTokens.add("7");
      trustedTokens.add("7.0");
      trustedTokens.add("6.3");
      trustedTokens.add("0.7");
      // When a VAT reduction decree is validly cited and no calculation was rejected (`calcCheck.accepted`),
      // deterministically ground exact VAT-exclusive (7% / 6.3% / 0.7%), VAT-inclusive total (107% = base + VAT),
      // and VAT-inclusive back-out (7/107, 100/107) figures derived STRICTLY from THIS claim's own valid taxable base
      // (never pooling across sibling installments or superseded multi-turn bases!).
      // Only ground derived VAT baht outputs when NOT on a clarification turn (`!isClarificationTurn` — VC-EQ guard)!
      if (calcCheck.accepted && !isClarificationTurn) {
        const extractAmounts = (txt: string): number[] => {
          const vals: number[] = [];
          for (const am of thaiDigitsToArabic(txt).matchAll(
            /(?:(?:THB|฿)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)|([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(ล้านบาท|บาท))/gi
          )) {
            const rawNum = (am[1] || am[2] || "").replace(/,/g, "");
            const n = Number(rawNum);
            if (!Number.isFinite(n) || n <= 0) continue;
            vals.push(am[3] === "ล้านบาท" ? n * 1_000_000 : n);
          }
          return vals;
        };

        // Determine active (non-superseded) user-stated monetary bases (cross-turn override only)
        const supersededGate5 = detectSupersededMonetaryBase(params.factLedger);
        const latestTurn = params.factLedger.user_turns[params.factLedger.user_turns.length - 1];
        const activeUserBases = new Set<number>(
          supersededGate5 && latestTurn
            ? [supersededGate5.activeBaseThb, ...extractMonetaryAmountsThb(latestTurn.raw_text)]
            : extractMonetaryAmountsThb(params.factLedger.user_turns.map((t) => t.raw_text).join(" "))
        );

        const scopedBasesThb = new Set<number>();
        const splitPts = params.factLedger.temporal_facts.split_payment_tax_points || [];
        const resolvedIssueAlloc = resolveIssueTargetAllocation(iss, params.factLedger);
        const singleSplitTargetIso =
          resolvedIssueAlloc?.targetIso ??
          (params.factLedger.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point &&
          splitPts.length >= 2
            ? resolveIssueTargetSplitPortionIso(iss, splitPts)
            : null);
        const singleSplitPortion = singleSplitTargetIso
          ? splitPts.find((sp) => sp.iso_date === singleSplitTargetIso)
          : undefined;
        const addExactVerifiedToken = (val: number | null | undefined) => {
          if (typeof val === "number" && Number.isFinite(val) && val > 0) {
            trustedTokens.add(String(val));
            trustedTokens.add(val.toLocaleString("en-US"));
          }
        };

        if (calcCheck.verifiedCalc && calcCheck.verifiedCalc.tax_base_thb !== null) {
          scopedBasesThb.add(calcCheck.verifiedCalc.tax_base_thb);
          if (
            calcCheck.verifiedCalc.taxable_amount_thb !== null &&
            calcCheck.verifiedCalc.taxable_amount_thb > 0
          ) {
            scopedBasesThb.add(calcCheck.verifiedCalc.taxable_amount_thb);
          }
          // Constituent lots of THIS exact verified multi-lot bucket ONLY (e.g. Case 1 30 Sep bucket =
          // Lot A 20k -> VAT 1,400 + Lot B 20k -> VAT 1,400 = 40k / VAT 2,800; Case 2A 1 Oct bucket =
          // Lot B 20k -> VAT 1,400 + Lot C 10k -> VAT 700 = 30k / VAT 2,100). Never adds lots from other buckets!
          const vatAllocRecForConstituents =
            params.factLedger.temporal_facts.vat_portion_allocation_record;
          if (
            vatAllocRecForConstituents &&
            vatAllocRecForConstituents.allocation_status === "RESOLVED" &&
            resolvedIssueAlloc &&
            resolvedIssueAlloc.lotIds.length >= 2
          ) {
            for (const lot of vatAllocRecForConstituents.lot_allocations) {
              if (!resolvedIssueAlloc.lotIds.includes(lot.lot_id)) continue;
              addExactVerifiedToken(lot.taxable_base_thb);
              addExactVerifiedToken(lot.verified_vat_thb);
              addExactVerifiedToken(lot.verified_gross_thb);
              addExactVerifiedToken(Math.round(lot.taxable_base_thb * 0.063 * 100) / 100);
              addExactVerifiedToken(Math.round(lot.taxable_base_thb * 0.007 * 100) / 100);
            }
          }
          // Candidate 10 Strict Per-Portion Reconciliation:
          // Do NOT blindly pool arbitrary sibling portion bases! Permit exact reconciled subtotals
          // (same-date multi-lot bucket subtotal, verified grand total, and already-verified sibling
          // portion tax outputs) ONLY when:
          //   (1) THIS issue's own `verifiedCalc` passed AND its own `computed_tax_thb` appears in the text, AND
          //   (2) the text contains an explicit aggregation/reconciliation phrase (`รวม...` / `ยอดรวม`), AND
          //   (3) the allocation record is `RESOLVED` with verified portion VAT totals!
          if (
            calcCheck.verifiedCalc.computed_tax_thb !== null &&
            calcCheck.verifiedCalc.computed_tax_thb > 0 &&
            splitPts.length >= 2
          ) {
            const ownTaxPlain = String(calcCheck.verifiedCalc.computed_tax_thb);
            const ownTaxFmt = calcCheck.verifiedCalc.computed_tax_thb.toLocaleString("en-US");
            const normClaimCheck = thaiDigitsToArabic(fullIssueClaimStatement);
            const hasExplicitAggregationCue =
              /(?:รวมกับ|รวมยอด|ยอดรวม|รวมฐานภาษี|รวมภาษีมูลค่าเพิ่ม|รวมเป็นเงิน|รวม\s*[0-9]+\s*(?:ล็อต|ชุด|รายการ|ส่วน)|รวมทั้ง\s*[0-9]+\s*(?:ล็อต|ชุด|รายการ|ส่วน)|รวมทั้งสิ้น|รวมทั้งหมด|รวมล็อต|รวมเป็นภาษี|ทั้งธุรกรรม|ตลอดรายการ)/i.test(
                normClaimCheck
              );
            if (
              hasExplicitAggregationCue &&
              (normClaimCheck.includes(ownTaxFmt) || normClaimCheck.includes(ownTaxPlain))
            ) {
              // 1) Same-date bucket subtotal (e.g. Lot A + Lot B on 30 Sep -> 40,000 / 2,800 / 42,800)
              if (resolvedIssueAlloc && resolvedIssueAlloc.sameDateBucketBaseThb !== null) {
                addExactVerifiedToken(resolvedIssueAlloc.sameDateBucketBaseThb);
                addExactVerifiedToken(resolvedIssueAlloc.sameDateBucketVatThb);
                addExactVerifiedToken(resolvedIssueAlloc.sameDateBucketGrossThb);
              }
              // 2) Verified grand total derived STRICTLY from verified portions in vat_portion_allocation_record
              const vatAllocRec = params.factLedger.temporal_facts.vat_portion_allocation_record;
              if (
                vatAllocRec &&
                vatAllocRec.allocation_status === "RESOLVED" &&
                vatAllocRec.reconciled_total_vat_thb !== null
              ) {
                addExactVerifiedToken(vatAllocRec.reconciled_total_base_thb);
                addExactVerifiedToken(vatAllocRec.reconciled_total_vat_thb);
                addExactVerifiedToken(vatAllocRec.reconciled_total_gross_thb);
              }
              // 3) Already-verified sibling portions' exact `computed_tax_thb` & `tax_base_thb` (ONLY siblings that ALREADY passed!)
              for (const priorVerified of verifiedIssues) {
                if (
                  priorVerified.verified_calculation &&
                  priorVerified.verified_calculation.computed_tax_thb !== null &&
                  priorVerified.verified_calculation.computed_tax_thb > 0
                ) {
                  addExactVerifiedToken(priorVerified.verified_calculation.tax_base_thb);
                  addExactVerifiedToken(priorVerified.verified_calculation.computed_tax_thb);
                }
              }
            }
          }
        } else if (
          resolvedIssueAlloc?.expectedBaseThb !== null &&
          resolvedIssueAlloc?.expectedBaseThb !== undefined &&
          resolvedIssueAlloc.expectedBaseThb > 0
        ) {
          // Single-lot / single-portion claim without verifiedCalc: strictly scope to THAT lot/portion's own allocated base!
          scopedBasesThb.add(resolvedIssueAlloc.expectedBaseThb);
        } else if (
          singleSplitPortion &&
          typeof singleSplitPortion.amount_thb === "number" &&
          singleSplitPortion.amount_thb > 0
        ) {
          scopedBasesThb.add(singleSplitPortion.amount_thb);
        } else {
          // Multi-portion conditional / non-split claim without verifiedCalc: intersect claim-mentioned bases with active user bases.
          const claimMentioned = extractAmounts(
            `${iss.issue_title_th} ${iss.party_or_scope_th} ${iss.conclusion_th} ${iss.application_explanation_th}`
          );
          for (const b of claimMentioned) {
            if (activeUserBases.has(b)) scopedBasesThb.add(b);
          }
          if (scopedBasesThb.size === 0 && activeUserBases.size === 1) {
            for (const b of activeUserBases) scopedBasesThb.add(b);
          }
        }

        for (const base of scopedBasesThb) {
          for (const mult of [0.07, 0.063, 0.007, 1.07, 7 / 107, 100 / 107]) {
            const derived = Math.round(base * mult * 100) / 100;
            trustedTokens.add(String(derived));
            trustedTokens.add(derived.toLocaleString("en-US"));
          }
        }
      }
    }
    const trustedTokensArr = Array.from(trustedTokens);
    let finalPassageIds = [...validPassageIds];
    const normStmtPreBind = thaiDigitsToArabic(fullIssueClaimStatement);
    // Minor 1 (G1): Auto-bind กค 0702/3889 (psg.1285e0045e3266 / rd.go.th/66517.html) when referenced or when
    // marital co-owned immovable property (`สินสมรส`) is transferred to a legitimate child under §42(26)!
    if (
      /0702\/3889/.test(normStmtPreBind) ||
      (/สินสมรส/.test(normStmtPreBind) && /42\s*\(26\)/.test(normStmtPreBind))
    ) {
      const p3889 = params.passagePack.find(
        (p) =>
          p.work_id === "work.th.rd.gk_0702_3889_2022_0d0a6d5b" &&
          !finalPassageIds.includes(p.passage_id)
      );
      if (p3889) {
        finalPassageIds.push(p3889.passage_id);
      }
    }
    // Minor 3 (M1t3): Auto-bind exact §50(5) unit (`psg.e5b0d991385db2`) & §48(4) unit (`psg.35d2ae2eddfff5`)
    // when §50(5) / RD 165 / §48(4) expense-deduction rules are cited!
    if (/(?:มาตรา\s*50\s*\(5\)|ฉบับที่\s*165|พ\.ร\.ฎ\.[^\n]{0,20}165)/.test(normStmtPreBind)) {
      const p50_5 = params.passagePack.find(
        (p) =>
          p.work_id === "prov.th.rc.50" &&
          (/\(5\)\s*ในกรณี/.test(thaiDigitsToArabic(p.verbatim_text)) ||
            thaiDigitsToArabic(p.verbatim_text).includes("165")) &&
          !finalPassageIds.includes(p.passage_id)
      );
      if (p50_5) {
        finalPassageIds.push(p50_5.passage_id);
      }
    }
    if (/มาตรา\s*48\s*\(4\)(?!\s*\/)/.test(normStmtPreBind)) {
      // If the LLM accidentally attached bond-redemption Unit 3 (`psg.bf16a87e2d1f29`) without citing `48 (3)`,
      // drop that unrelated unit before binding exact `(4)` (`psg.35d2ae2eddfff5`) + section header!
      if (!/มาตรา\s*48\s*\(3\)/.test(normStmtPreBind)) {
        finalPassageIds = finalPassageIds.filter((pid) => pid !== "psg.bf16a87e2d1f29");
      }
      const p48Header = params.passagePack.find(
        (p) =>
          p.work_id === "prov.th.rc.48" &&
          /^มาตรา\s*48\b/.test(thaiDigitsToArabic(p.verbatim_text).trim()) &&
          !finalPassageIds.includes(p.passage_id)
      );
      if (p48Header) {
        finalPassageIds.push(p48Header.passage_id);
      }
      const p48_4 = params.passagePack.find(
        (p) =>
          p.work_id === "prov.th.rc.48" &&
          /\(4\)\s*ผู้มีเงินได้จะเลือกเสียภาษี|ทางอื่นนอกจาก\s*\(ก\)/.test(
            thaiDigitsToArabic(p.verbatim_text)
          ) &&
          !finalPassageIds.includes(p.passage_id)
      );
      if (p48_4) {
        finalPassageIds.push(p48_4.passage_id);
      }
    }
    // DEF-C3-2 (s.47): Auto-bind sibling `prov.th.rc.47` unit `psg.cfc975a6134b54` when `psg.e4ec78f644930e` is cited
    // and the explanation also mentions the child-income proviso (`มาตรา 42`) or `ฉบับที่ 44` from that unit!
    if (
      finalPassageIds.includes("psg.e4ec78f644930e") &&
      /มาตรา\s*42|ฉบับที่\s*44|ฉบับที่\s*46|ผู้เยาว์|25\s*ปี|ยี่สิบห้าปี|ศึกษา/.test(normStmtPreBind) &&
      !finalPassageIds.includes("psg.cfc975a6134b54")
    ) {
      const p47Unit2 = params.passagePack.find((p) => p.passage_id === "psg.cfc975a6134b54");
      if (p47Unit2) {
        finalPassageIds.push(p47Unit2.passage_id);
      }
    }
    const excludedContextInstruments = extractExplicitlyExcludedContextInstruments({
      issue: iss,
      validPassageIds: finalPassageIds,
      passagePack: params.passagePack,
      factLedger: params.factLedger,
    });

    // Candidate 6 P0: Strip incidental unverified authority references in heading/party/comparison clauses
    // BEFORE claim entailment while keeping essential authority checks strict!
    const preCheckBindings = toVerifiedAuthorityBindings([
      ...finalPassageIds,
      ...params.passagePack
        .filter((p) => p.evidence_role === "governing" && p.work_id.startsWith("prov.th.rc."))
        .map((p) => p.passage_id),
    ]);
    const preCleanTitle =
      sanitizeIncidentalSurfaceText(iss.issue_title_th, preCheckBindings, {
        excludedContextInstruments,
      }).cleanedText || redactAuthorityIdentifiersFromPublicDiagnosticTh(iss.issue_title_th);
    const preCleanParty =
      sanitizeIncidentalSurfaceText(iss.party_or_scope_th, preCheckBindings, {
        excludedContextInstruments,
      }).cleanedText || redactAuthorityIdentifiersFromPublicDiagnosticTh(iss.party_or_scope_th);
    const preAuditConcl = auditEssentialIssueSurfaceText(iss.conclusion_th, preCheckBindings, {
      excludedContextInstruments,
    });
    const preAuditExpl = iss.application_explanation_th
      ? auditEssentialIssueSurfaceText(iss.application_explanation_th, preCheckBindings, {
          excludedContextInstruments,
        })
      : { ok: true, cleanedText: "", unsupportedAuthorities: [] };

    // Candidate 8: if the conclusion is fully supported but the explanation carries an unsupported authority ONLY
    // inside an incidental parenthetical / discourse clause, remove that statement and keep the independently
    // supported analysis (the remaining explanation must still cite a verified statutory section). An operative
    // explanation that depends entirely on an unsupported authority is NOT rescued (whole text would be stripped).
    let explanationForAudit = iss.application_explanation_th || "";
    if (preAuditConcl.ok && explanationForAudit && !preAuditExpl.ok) {
      const san = sanitizeIncidentalSurfaceText(explanationForAudit, preCheckBindings, {
        excludedContextInstruments,
      });
      if (san.cleanedText.length >= 40 && /มาตรา\s*[0-9]/.test(thaiDigitsToArabic(san.cleanedText))) {
        explanationForAudit = san.cleanedText;
        strippedIncidentalMissingAuthorityCount++;
      }
    }
    const workingExplanation =
      explanationForAudit !== (iss.application_explanation_th || "")
        ? explanationForAudit
        : preAuditExpl.cleanedText;

    let workingClaimStatement = workingExplanation
      ? `[${preCleanTitle} — ${preCleanParty}] ${preAuditConcl.cleanedText} (${workingExplanation})`
      : `[${preCleanTitle} — ${preCleanParty}] ${preAuditConcl.cleanedText}`;

    let entailmentCheck = verifyClaimAgainstPassages(
      {
        statement: workingClaimStatement,
        supporting_passage_ids: finalPassageIds,
        verified_calculation_numeric_tokens: trustedTokensArr,
        excluded_context_instruments: excludedContextInstruments,
      },
      allRawPassages
    );

    // Cross-referenced governing passage binding within the supplied `passagePack` (e.g., §54 issue cross-referencing
    // §50(5)(ก)/(ข) or §50(6) that was cited in sibling Issue 1): if the issue names an explicit Revenue Code section
    // whose `governing` passages already exist in `params.passagePack`, bind those governing passages and re-verify!
    if (
      !entailmentCheck.allow_confident_answer &&
      /UNGROUNDED_LEGAL_IDENTIFIER/.test(entailmentCheck.reason || "")
    ) {
      const normStmtForSec = thaiDigitsToArabic(workingClaimStatement);
      const mentionedRcNums = new Set<string>();
      for (const sm of normStmtForSec.matchAll(
        /มาตรา\s*(\d+(?:\/\d+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ(?!บับ|พาะ|ุกเฉิน)|สัตต|อัฏฐ|เตรส))?)/g
      )) {
        mentionedRcNums.add(sm[1].replace(/\s+/g, "_"));
      }
      const candidateGoverningAdds = params.passagePack
        .filter((p) => {
          if (finalPassageIds.includes(p.passage_id)) return false;
          if (p.evidence_role !== "governing") return false;
          if (p.work_id.startsWith("prov.th.rc.")) {
            const secKey = p.work_id.slice("prov.th.rc.".length);
            return (
              mentionedRcNums.has(secKey) ||
              mentionedRcNums.has(secKey.replace(/_/g, "/"))
            );
          }
          if (
            p.work_id === "sched.th.rc.stamp_duty" &&
            /บัญชีอัตราอากรแสตมป์/.test(normStmtForSec)
          ) {
            return true;
          }
          if (
            p.work_id === "subreg.th.rc.royal_decree.342" &&
            /(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,50}342/.test(normStmtForSec)
          ) {
            return true;
          }
          return false;
        })
        .map((p) => p.passage_id);
      if (candidateGoverningAdds.length > 0) {
        finalPassageIds = [...finalPassageIds, ...candidateGoverningAdds];
        entailmentCheck = verifyClaimAgainstPassages(
          {
            statement: workingClaimStatement,
            supporting_passage_ids: finalPassageIds,
            verified_calculation_numeric_tokens: trustedTokensArr,
            excluded_context_instruments: excludedContextInstruments,
          },
          allRawPassages
        );
      }
    }

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
      const nextCandidateIds = finalPassageIds.filter((pid) => pid !== mPid[1]);
      pruneGuard++;
      const nextCheck = verifyClaimAgainstPassages(
        {
          statement: workingClaimStatement,
          supporting_passage_ids: nextCandidateIds,
          verified_calculation_numeric_tokens: trustedTokensArr,
          excluded_context_instruments: excludedContextInstruments,
        },
        allRawPassages
      );
      if (/UNGROUNDED_LEGAL_IDENTIFIER/.test(nextCheck.reason || "")) {
        break;
      }
      finalPassageIds = nextCandidateIds;
      entailmentCheck = nextCheck;
    }

    // Candidate 6 P0 Strict Final Issue-Level Authority Audit:
    // Every named authority in `conclusion_th` and `application_explanation_th` MUST point to an exact
    // verified passage + version in `finalPassageIds`! If essential and unsupported, withhold ONLY this issue;
    // for incidental surfaces (`issue_title_th`, `authority_distinction_note_th`, `missing_facts_or_uncertainties_th`,
    // `material_facts_relied_on`), strip any unsupported reference and its dependent clause!
    let strictIssueBindings = toVerifiedAuthorityBindings(finalPassageIds);
    let strictConclAudit = auditEssentialIssueSurfaceText(
      iss.conclusion_th,
      strictIssueBindings,
      { excludedContextInstruments }
    );
    let strictExplAudit = explanationForAudit
      ? auditEssentialIssueSurfaceText(explanationForAudit, strictIssueBindings, {
          excludedContextInstruments,
        })
      : { ok: true, cleanedText: "", unsupportedAuthorities: [] as string[] };

    // Candidate 8 (trc.c33cad106d7d9d): before withholding, bind the EXACT governing passage for a cited
    // Revenue Code section/subclause (e.g. `มาตรา 48 (4/1)`) or Revenue Code amending Act that is already in the
    // supplied packet but was not attached to this issue. Only `governing` passages whose own text contains the
    // cited subclause marker are eligible; the claim is re-verified against the enlarged set and the binding is
    // kept only if BOTH entailment and the strict audit then pass. Authorities absent from the packet stay unsupported.
    if (entailmentCheck.allow_confident_answer && (!strictConclAudit.ok || !strictExplAudit.ok)) {
      const unsupportedNow = [
        ...findUnsupportedAuthoritiesInText(iss.conclusion_th, strictIssueBindings, { excludedContextInstruments }),
        ...findUnsupportedAuthoritiesInText(explanationForAudit, strictIssueBindings, {
          excludedContextInstruments,
        }),
      ];
      const bindAdds = new Set<string>();
      for (const a of unsupportedNow) {
        if (a.kind === "section") {
          const sm = /^มาตรา\s*([0-9]+(?:\/[0-9]+)?)(?:\s+([ก-๙]+))?(?:\s*\(([0-9]{1,2}(?:\/[0-9]+)?)\))?$/.exec(
            a.canonicalId
          );
          if (!sm) continue;
          const wid = `prov.th.rc.${sm[1]}${sm[2] ? `_${sm[2]}` : ""}`;
          for (const p of params.passagePack) {
            if (p.evidence_role !== "governing" || finalPassageIds.includes(p.passage_id)) continue;
            if (p.work_id !== wid && p.work_id !== wid.replace(/_/g, "/")) continue;
            const txt = thaiDigitsToArabic(p.verbatim_text);
            const matches = sm[3]
              ? new RegExp(`(?:^|\\n|-->|\\s)\\(${sm[3].replace("/", "\\/")}\\)\\s`).test(txt)
              : new RegExp(`^\\s*มาตรา\\s*${sm[1].replace("/", "\\/")}(?![0-9/])`).test(txt);
            if (matches) bindAdds.add(p.passage_id);
          }
        } else if (a.kind === "amending_act") {
          const num = a.canonicalId.slice("พรบแก้ไข.".length);
          for (const p of params.passagePack) {
            if (
              p.evidence_role === "governing" &&
              !finalPassageIds.includes(p.passage_id) &&
              p.work_id.startsWith(`statute.th.rc_amendment_${num}_`)
            ) {
              bindAdds.add(p.passage_id);
              break;
            }
          }
        }
      }
      if (bindAdds.size > 0) {
        const candidateIds = [...finalPassageIds, ...Array.from(bindAdds)];
        const candidateBindings = toVerifiedAuthorityBindings(candidateIds);
        const candConcl = auditEssentialIssueSurfaceText(iss.conclusion_th, candidateBindings, {
          excludedContextInstruments,
        });
        const candExpl = explanationForAudit
          ? auditEssentialIssueSurfaceText(explanationForAudit, candidateBindings, { excludedContextInstruments })
          : { ok: true, cleanedText: "", unsupportedAuthorities: [] as string[] };
        const candEntail = verifyClaimAgainstPassages(
          {
            statement: workingClaimStatement,
            supporting_passage_ids: candidateIds,
            verified_calculation_numeric_tokens: trustedTokensArr,
            excluded_context_instruments: excludedContextInstruments,
          },
          allRawPassages
        );
        if (candConcl.ok && candExpl.ok && candEntail.allow_confident_answer) {
          finalPassageIds = candidateIds;
          strictIssueBindings = candidateBindings;
          strictConclAudit = candConcl;
          strictExplAudit = candExpl;
          entailmentCheck = candEntail;
        }
      }
    }

    // Candidate 8: exact-subclause evidence precision. A cited Revenue Code subclause (`มาตรา 48 (4/1)`) must point
    // to the verified passage whose own text contains that subclause; when only sibling units of the same section are
    // attached and the exact governing unit is in the packet, attach it (re-verified; kept only if still supported).
    if (entailmentCheck.allow_confident_answer && strictConclAudit.ok && strictExplAudit.ok) {
      const precisionAdds: string[] = [];
      for (const a of extractNamedAuthoritiesFromText(`${iss.conclusion_th} ${explanationForAudit}`)) {
        if (a.kind !== "section") continue;
        const sm = /^มาตรา\s*([0-9]+(?:\/[0-9]+)?)(?:\s+([ก-๙]+))?\s*\(([0-9]{1,2}(?:\/[0-9]+)?)\)$/.exec(a.canonicalId);
        if (!sm) continue;
        const wid = `prov.th.rc.${sm[1]}${sm[2] ? `_${sm[2]}` : ""}`;
        const markerRe = new RegExp(`(?:^|\\n|-->|\\s)\\(${sm[3].replace("/", "\\/")}\\)\\s`);
        const sameWorkBound = [...finalPassageIds, ...precisionAdds]
          .map((pid) => packById.get(pid))
          .filter((p): p is GroundedPassagePackItem => Boolean(p) && (p!.work_id === wid || p!.work_id === wid.replace(/_/g, "/")));
        if (sameWorkBound.length === 0) continue;
        if (sameWorkBound.some((p) => markerRe.test(thaiDigitsToArabic(p.verbatim_text)))) continue;
        const exact = params.passagePack.find(
          (p) =>
            p.evidence_role === "governing" &&
            (p.work_id === wid || p.work_id === wid.replace(/_/g, "/")) &&
            !finalPassageIds.includes(p.passage_id) &&
            markerRe.test(thaiDigitsToArabic(p.verbatim_text))
        );
        if (exact) precisionAdds.push(exact.passage_id);
      }
      if (precisionAdds.length > 0) {
        const candidateIds = [...finalPassageIds, ...precisionAdds];
        const candEntail = verifyClaimAgainstPassages(
          {
            statement: workingClaimStatement,
            supporting_passage_ids: candidateIds,
            verified_calculation_numeric_tokens: trustedTokensArr,
            excluded_context_instruments: excludedContextInstruments,
          },
          allRawPassages
        );
        if (candEntail.allow_confident_answer) {
          finalPassageIds = candidateIds;
          strictIssueBindings = toVerifiedAuthorityBindings(candidateIds);
          entailmentCheck = candEntail;
        }
      }
    }

    if (entailmentCheck.allow_confident_answer && (!strictConclAudit.ok || !strictExplAudit.ok)) {
      entailmentCheck = {
        verification_result: "UNSUPPORTED",
        allow_confident_answer: false,
        reason:
          "UNGROUNDED_LEGAL_IDENTIFIER: ระงับการรับรองข้อกล่าวอ้าง เนื่องจากข้อสรุปหรือคำอธิบายอ้างอิงแหล่งกฎหมายที่ไม่มีข้อความหลักฐานและรุ่นกฎหมายที่ตรวจสอบแล้วรองรับในประเด็นนี้",
      };
    }

    const sanitizedIssueTitleTh =
      sanitizeIncidentalSurfaceText(iss.issue_title_th, strictIssueBindings, {
        excludedContextInstruments,
      }).cleanedText || redactAuthorityIdentifiersFromPublicDiagnosticTh(iss.issue_title_th);
    const sanitizedPartyOrScopeTh =
      sanitizeIncidentalSurfaceText(iss.party_or_scope_th, strictIssueBindings, {
        excludedContextInstruments,
      }).cleanedText || redactAuthorityIdentifiersFromPublicDiagnosticTh(iss.party_or_scope_th);
    const sanitizedAuthorityNoteTh = sanitizeIncidentalSurfaceText(
      iss.authority_distinction_note_th || "",
      strictIssueBindings,
      { excludedContextInstruments }
    ).cleanedText;
    const sanitizedMaterialFacts = (iss.material_facts_relied_on || [])
      .map(
        (mf) =>
          sanitizeIncidentalSurfaceText(mf, strictIssueBindings, {
            excludedContextInstruments,
          }).cleanedText
      )
      .filter(Boolean);
    const sanitizedMissingFacts = (iss.missing_facts_or_uncertainties_th || [])
      .map(
        (mf) =>
          sanitizeIncidentalSurfaceText(mf, strictIssueBindings, {
            excludedContextInstruments,
          }).cleanedText
      )
      .filter(Boolean);

    if (entailmentCheck.allow_confident_answer) {
      workingClaimStatement = strictExplAudit.cleanedText
        ? `[${sanitizedIssueTitleTh} — ${sanitizedPartyOrScopeTh}] ${strictConclAudit.cleanedText} (${strictExplAudit.cleanedText})`
        : `[${sanitizedIssueTitleTh} — ${sanitizedPartyOrScopeTh}] ${strictConclAudit.cleanedText}`;
    }

    if (!entailmentCheck.allow_confident_answer) {
      if (s47IssueEval?.applicable) {
        const rawTokMatch = /\(([^()]{1,40})\)/.exec(entailmentCheck.reason || "");
        const s47Stage = /UNGROUNDED_NUMERIC_ASSERTION/.test(entailmentCheck.reason || "")
          ? "S47_TOKEN_NOT_IN_AUTHORIZED_SET"
          : "S47_SUBCLAUSE_AMOUNT_MISMATCH";
        recordSection47RestrictedDiagnostic({
          trace_id: params.traceId,
          issue_id: iss.issue_id,
          outcome: "SUPPRESSED",
          stage_code: s47Stage,
          cleaned_active_text: s47ActiveUserContext,
          extracted_facts: s47IssueEval.extractedFacts,
          authorized_valid_amounts_thb: s47IssueEval.validAmountsThb,
          expected_total_thb: s47IssueEval.expectedTotalThb,
          draft_numeric_tokens: s47DraftNumericTokens,
          rejected_token: rawTokMatch?.[1] || null,
          qa_synthetic_fixture: params.qaSyntheticFixture ?? null,
        });
        rejectedClaims.push({
          issue_id: iss.issue_id,
          issue_title_th: iss.issue_title_th,
          statement_before_verification: fullIssueClaimStatement,
          cited_passage_ids: finalPassageIds,
          rejection_code: s47Stage,
          rejection_reason_th: redactPublicClaimRejectionReasonTh(
            entailmentCheck.reason ||
              "ข้อความข้อสรุปและการปรับใช้มาตรา 47 ไม่ผ่านเกณฑ์การตรวจสอบความสอดคล้องกับตัวบทที่อ้างอิง"
          ),
        });
        continue;
      }

      rejectedClaims.push({
        issue_id: iss.issue_id,
        issue_title_th: iss.issue_title_th,
        statement_before_verification: fullIssueClaimStatement,
        cited_passage_ids: finalPassageIds,
        rejection_code: "UNGROUNDED_OR_CONTRADICTED_CLAIM",
        rejection_reason_th: redactPublicClaimRejectionReasonTh(
          entailmentCheck.reason ||
            "ข้อความข้อสรุปและการปรับใช้กฎหมายไม่ผ่านเกณฑ์การตรวจสอบความสอดคล้องกับตัวบทที่อ้างอิง"
        ),
      });
      continue;
    }

    if (s47IssueEval?.applicable) {
      recordSection47RestrictedDiagnostic({
        trace_id: params.traceId,
        issue_id: iss.issue_id,
        outcome: "PASSED",
        stage_code: "S47_VERIFIED_PASS",
        cleaned_active_text: s47ActiveUserContext,
        extracted_facts: s47IssueEval.extractedFacts,
        authorized_valid_amounts_thb: s47IssueEval.validAmountsThb,
        expected_total_thb: s47IssueEval.expectedTotalThb,
        draft_numeric_tokens: s47DraftNumericTokens,
        rejected_token: null,
        qa_synthetic_fixture: params.qaSyntheticFixture ?? null,
      });
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
      statement: workingClaimStatement,
      claim_type: "qualified_legal_synthesis",
      statement_role: firstRaw?.statement_role || "statutory_text",
      supporting_passage_ids: finalPassageIds,
      applicable_version_id: firstRaw?.version_id || citedPackItems[0].version_id,
      factual_conditions: sanitizedMaterialFacts.slice(0, 5),
      exceptions: sanitizedMissingFacts.slice(0, 5),
      counterevidence_passage_ids: [],
      verification_result: entailmentCheck.verification_result,
      verified_calculation_numeric_tokens: trustedTokensArr,
      bound_calculation: boundCalcRecord,
    };

    verifiedIssues.push({
      issue_id: iss.issue_id,
      issue_title_th: sanitizedIssueTitleTh,
      party_or_scope_th: sanitizedPartyOrScopeTh,
      conclusion_th: strictConclAudit.cleanedText,
      material_facts_relied_on: sanitizedMaterialFacts,
      governing_passage_ids: finalPassageIds,
      application_explanation_th: strictExplAudit.cleanedText,
      authority_distinction_note_th: sanitizedAuthorityNoteTh,
      verified_calculation: calcCheck.accepted ? calcCheck.verifiedCalc : null,
      missing_facts_or_uncertainties_th: sanitizedMissingFacts,
      claim_ledger_item: claimLedgerItem,
    });
  }

  // Candidate 9 Cross-Issue Same-Goods Double-Count Guard:
  // On non-conditional VAT answers with a known transaction base ceiling, prevent two separate event issues
  // (e.g. early title on 30 Sep AND later delivery/payment/invoice on 1 Oct) from taxing the same portion twice!
  const crossCheckCtrlEvent =
    params.factLedger.temporal_facts.controlling_tax_point.controlling_event || "";
  const crossCheckVatCeiling = !crossCheckCtrlEvent.includes("CONDITIONAL")
    ? resolveSingleTransactionVatBaseCeilingThb(
        params.factLedger,
        detectSupersededMonetaryBase(params.factLedger)
      )
    : null;
  if (crossCheckVatCeiling !== null && crossCheckVatCeiling > 0) {
    const nonSummaryVatCalcIndices: number[] = [];
    for (let i = 0; i < verifiedIssues.length; i++) {
      const vi = verifiedIssues[i];
      if (!vi.verified_calculation || (vi.verified_calculation.computed_tax_thb ?? 0) <= 0) {
        continue;
      }
      if (/(?:สรุปรวม|ยอดรวมทั้งสิ้น|รวมทั้งธุรกรรม)/i.test(vi.issue_title_th)) {
        continue;
      }
      const citesVat = vi.governing_passage_ids.some((pid) => {
        const wid = packById.get(pid)?.work_id || "";
        return (
          wid === "prov.th.rc.78" ||
          wid === "prov.th.rc.78/1" ||
          wid === "prov.th.rc.80" ||
          wid.startsWith("subreg.th.rc.royal_decree.")
        );
      });
      if (citesVat) {
        nonSummaryVatCalcIndices.push(i);
      }
    }
    if (nonSummaryVatCalcIndices.length >= 2) {
      const totalTaxedBase = nonSummaryVatCalcIndices.reduce(
        (s, idx) => s + (verifiedIssues[idx].verified_calculation?.tax_base_thb ?? 0),
        0
      );
      if (totalTaxedBase > crossCheckVatCeiling + 1) {
        const ctrlIso = params.factLedger.temporal_facts.controlling_tax_point.iso_date;
        const ctrlRawText = ctrlIso
          ? params.factLedger.temporal_facts.transaction_or_event_dates.find(
              (d) => d.iso_date === ctrlIso
            )?.raw_text || null
          : null;
        let keptPrimaryIdx = nonSummaryVatCalcIndices[0];
        if (ctrlIso || ctrlRawText) {
          const matchingCtrl = nonSummaryVatCalcIndices.find((idx) => {
            const blob = thaiDigitsToArabic(
              `${verifiedIssues[idx].issue_title_th} ${verifiedIssues[idx].party_or_scope_th} ${verifiedIssues[idx].conclusion_th}`
            );
            return (
              (ctrlIso ? blob.includes(ctrlIso) : false) ||
              (ctrlRawText ? blob.includes(thaiDigitsToArabic(ctrlRawText)) : false)
            );
          });
          if (matchingCtrl !== undefined) {
            keptPrimaryIdx = matchingCtrl;
          }
        }
        const indicesToDrop = new Set(
          nonSummaryVatCalcIndices.filter((idx) => idx !== keptPrimaryIdx)
        );
        for (const dropIdx of Array.from(indicesToDrop).sort((a, b) => b - a)) {
          const dup = verifiedIssues[dropIdx];
          if (dup.verified_calculation) {
            rejectedCalculations.push({
              issue_id: dup.issue_id,
              issue_title_th: dup.issue_title_th,
              proposed_values: {
                tax_base_thb: dup.verified_calculation.tax_base_thb,
                exempt_amount_thb: dup.verified_calculation.exempt_amount_thb,
                taxable_amount_thb: dup.verified_calculation.taxable_amount_thb,
                rate_pct: dup.verified_calculation.rate_pct,
                computed_tax_thb: dup.verified_calculation.computed_tax_thb,
              },
              rejection_code: "ARITHMETIC_MISMATCH",
              rejection_reason_th:
                "ระงับการคำนวณภาษีมูลค่าเพิ่มซ้ำสำหรับสินค้าเดียวกันที่เกิดความรับผิดทางภาษีไปแล้วในเหตุการณ์ก่อนหน้า",
            });
          }
          rejectedClaims.push({
            issue_id: dup.issue_id,
            issue_title_th: dup.issue_title_th,
            statement_before_verification: dup.claim_ledger_item.statement,
            cited_passage_ids: dup.governing_passage_ids,
            rejection_code: "UNGROUNDED_OR_CONTRADICTED_CLAIM",
            rejection_reason_th:
              "ระงับข้อกล่าวอ้างที่คิดภาษีมูลค่าเพิ่มซ้ำในเหตุการณ์ส่งมอบ ชำระเงิน หรือออกใบกำกับภาษีภายหลังสำหรับสินค้าเดียวกัน",
          });
          verifiedIssues.splice(dropIdx, 1);
        }
      }
    }
  }

  const buildRejectedDiagnostics = (): RejectedCalculationDiagnosticDto[] =>
    rejectedCalculations.map((rc) => ({
      rejected_claim_or_issue_id: rc.issue_id,
      rejection_code: rc.rejection_code,
      reason_th: redactRejectedCalculationNumbers(rc.rejection_reason_th, rc.proposed_values),
      fixture_id:
        rc.rejection_code === "SYNTHETIC_RC1_REJECTED_FIXTURE" ||
        params.qaSyntheticFixture === "RC1_REJECTED_CALC"
          ? "RC1_REJECTED_CALC"
          : null,
    }));

  // If ZERO issues survived verification:
  // - When `needs_vat_date_clarification` is active (e.g. VC), return clean `NEEDS_CLARIFICATION` asking for the tax-point date!
  // - Otherwise return explicit `REVIEW_REQUIRED` inability notice, NEVER falling back to prewritten legal conclusions!
  if (verifiedIssues.length === 0) {
    const fallbackGoverningBindings = toVerifiedAuthorityBindings(
      params.passagePack
        .filter((p) => p.evidence_role === "governing" && p.work_id.startsWith("prov.th.rc."))
        .map((p) => p.passage_id)
    );
    const cleanZeroIssueAssumptions = (params.draft.assumptions_th || [])
      .map((a) => sanitizeIncidentalSurfaceText(a, fallbackGoverningBindings).cleanedText)
      .filter(Boolean);
    const cleanZeroIssueClarifications = (params.draft.clarification_questions_th || [])
      .map((q) =>
        stripTentativeClarificationArithmeticTh(
          sanitizeIncidentalSurfaceText(q, fallbackGoverningBindings).cleanedText
        )
      )
      .filter(Boolean);

    if (isClarificationTurn) {
      const clarifyQs =
        cleanZeroIssueClarifications.length > 0
          ? cleanZeroIssueClarifications
          : [
              "กรุณาระบุวันที่รับชำระค่าบริการและวันที่ออกใบกำกับภาษี (ตามมาตรา 78/1 (1)) เพื่อยืนยันพระราชกฤษฎีกาที่ใช้บังคับและคำนวณภาษีขาย",
            ];
      const clarifyMsg =
        "ต้องการข้อมูลวันที่เกิดความรับผิดในการเสียภาษีมูลค่าเพิ่มเพิ่มเติม (เช่น วันรับชำระค่าบริการหรือวันออกใบกำกับภาษีตามมาตรา 78/1 (1)) เพื่อยืนยันพระราชกฤษฎีกาที่ใช้บังคับ — ระบบยังไม่สมมติใช้พระราชกฤษฎีกาฉบับล่าสุดและยังไม่คำนวณยอดภาษีขายจนกว่าจะระบุวันที่ชัดเจน";
      return {
        status: "NEEDS_CLARIFICATION",
        rendered_answer_th: clarifyMsg,
        verified_issues: [],
        claims: [],
        evidence_cards: [],
        assumptions_th: cleanZeroIssueAssumptions,
        clarification_questions_th: clarifyQs,
        coverage_warnings_th: [],
        rejected_calculations_diagnostic: buildRejectedDiagnostics(),
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
    const reasonsSummary = rejectedClaims
      .map(
        (r) =>
          `- ${redactAuthorityIdentifiersFromPublicDiagnosticTh(r.issue_title_th)}: ${redactPublicClaimRejectionReasonTh(r.rejection_reason_th)} (${r.rejection_code})`
      )
      .join("\n");
    const blockedMsg =
      `ระบบระงับการเผยแพร่คำตอบ (Trace ID: ${params.traceId}) เนื่องจากประเด็นที่แบบจำลองภาษาร่างขึ้นไม่ผ่านการตรวจสอบหลักฐาน วันบังคับใช้ หรือการคงข้อเท็จจริง และ **ไม่สลับไปใช้คำตอบสำเร็จรูปแทน**:\n` +
      (reasonsSummary || "- ไม่พบประเด็นที่รองรับด้วยหลักฐานต้นฉบับที่ส่งให้");
    return {
      status: "REVIEW_REQUIRED",
      rendered_answer_th: blockedMsg,
      verified_issues: [],
      claims: [],
      evidence_cards: [],
      assumptions_th: cleanZeroIssueAssumptions,
      clarification_questions_th: cleanZeroIssueClarifications,
      coverage_warnings_th: rejectedClaims.map(
        (r) =>
          `ระงับประเด็น ${r.issue_id}: ${redactPublicClaimRejectionReasonTh(r.rejection_reason_th)} (${r.rejection_code})`
      ),
      rejected_calculations_diagnostic: buildRejectedDiagnostics(),
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

  // Candidate 6 P0: Sanitize ALL answer-level surfaces (`assumptions`, `clarifications`, `evidenceGaps`,
  // `overall_summary_th`, `case_facts_used`) strictly against `usedPackItems`!
  const answerLevelBindings = toVerifiedAuthorityBindings(usedPackItems.map((p) => p.passage_id));
  const assumptions = (params.draft.assumptions_th || [])
    .map(
      (a) =>
        stripTentativeClarificationArithmeticTh(
          sanitizeIncidentalSurfaceText(a, answerLevelBindings).cleanedText
        )
    )
    .filter(Boolean);
  const clarificationBindings = [
    ...answerLevelBindings,
    ...toVerifiedAuthorityBindings(
      params.passagePack
        .filter((p) => p.evidence_role === "governing" && p.work_id.startsWith("prov.th.rc."))
        .map((p) => p.passage_id)
    ),
  ];
  const clarifications = (params.draft.clarification_questions_th || [])
    .map(
      (c) =>
        stripTentativeClarificationArithmeticTh(
          sanitizeIncidentalSurfaceText(c, clarificationBindings).cleanedText
        )
    )
    .filter(Boolean);
  if (params.specialConstraints?.needs_vat_date_clarification && clarifications.length === 0) {
    clarifications.push(
      "กรุณาระบุวันที่รับชำระค่าบริการและวันที่ออกใบกำกับภาษี (ตามมาตรา 78/1 (1)) เพื่อยืนยันพระราชกฤษฎีกาที่ใช้บังคับและคำนวณภาษีขาย"
    );
  }
  const unknownEarlyCoverageReasonTh =
    params.factLedger.temporal_facts.controlling_tax_point.controlling_event?.startsWith(
      "GOODS_EARLY_ACT_UNKNOWN_COVERAGE_CONDITIONAL"
    ) ||
    params.factLedger.temporal_facts.controlling_tax_point.controlling_event?.startsWith(
      "GOODS_EARLY_ACT_AMBIGUOUS_OVERLAP_CONDITIONAL"
    )
      ? params.factLedger.temporal_facts.controlling_tax_point.ambiguity_reason_th
      : null;
  if (unknownEarlyCoverageReasonTh && clarifications.length === 0) {
    clarifications.push(unknownEarlyCoverageReasonTh);
  }
  const rawEvidenceGaps = [...(params.draft.evidence_gaps_th || [])];
  const usesRd646Governing =
    Boolean(params.specialConstraints?.rd646_original_sec4_limitation) ||
    usedPackItems.some((p) => p.work_id === "subreg.th.rc.royal_decree.646");
  if (
    usesRd646Governing &&
    !rawEvidenceGaps.some((g) => thaiDigitsToArabic(g).includes("646") && thaiDigitsToArabic(g).includes("มาตรา 4"))
  ) {
    rawEvidenceGaps.push(
      "หมายเหตุข้อจำกัดต้นฉบับ พ.ร.ฎ. (ฉบับที่ 646) พ.ศ. 2560: ตัวบทมาตรา 4 ฉบับแรกเริ่มตามราชกิจจานุเบกษาไม่ได้แยกอยู่ในคลังหลักฐาน (คลังมีเฉพาะเอกสารฉบับประมวลของกรมสรรพากรซึ่งแสดงข้อความมาตรา 4 ที่แก้ไขเพิ่มเติมในภายหลัง)"
    );
  }
  if (
    strippedIncidentalMissingAuthorityCount > 0 &&
    !rawEvidenceGaps.some((g) => /ไม่ได้รวมอยู่ในชุดหลักฐาน/.test(g))
  ) {
    rawEvidenceGaps.push(
      "เอกสารลำดับรอง คำสั่ง หรือแนววินิจฉัยบางรายการที่กล่าวพาดพิงไม่ได้รวมอยู่ในชุดหลักฐานที่ตรวจสอบแล้ว ระบบจึงตัดเฉพาะข้อความส่วนที่ไม่มีหลักฐานรองรับออกและคงเฉพาะผลวิเคราะห์ตามบทบัญญัติที่ตรวจสอบต้นฉบับแล้ว"
    );
  }
  const evidenceGaps = rawEvidenceGaps
    .map(
      (g) =>
        stripTentativeClarificationArithmeticTh(
          sanitizeIncidentalSurfaceText(g, answerLevelBindings, {
            isEvidenceGapNotice: true,
          }).cleanedText
        )
    )
    .filter(Boolean);

  const sanitizedDraftForRender: GroundedLlmDraftResponse = {
    ...params.draft,
    overall_summary_th: stripTentativeClarificationArithmeticTh(
      sanitizeIncidentalSurfaceText(params.draft.overall_summary_th || "", answerLevelBindings)
        .cleanedText
    ),
    case_facts_used: (params.draft.case_facts_used || []).map((cf) => ({
      ...cf,
      legal_significance_th: stripTentativeClarificationArithmeticTh(
        sanitizeIncidentalSurfaceText(cf.legal_significance_th || "", answerLevelBindings)
          .cleanedText
      ),
    })),
    assumptions_th: assumptions,
    clarification_questions_th: clarifications,
    evidence_gaps_th: evidenceGaps,
  };

  const coverageWarnings: string[] = [
    ...evidenceGaps,
    ...rejectedClaims.map(
      (r) =>
        `ระงับประเด็นร่าง (${r.issue_id}): ${redactPublicClaimRejectionReasonTh(r.rejection_reason_th)} [${r.rejection_code}]`
    ),
    ...rejectedCalculations.map(
      (rc) =>
        `ระงับการคำนวณ (${rc.issue_id}): ${redactRejectedCalculationNumbers(rc.rejection_reason_th, rc.proposed_values)} [${rc.rejection_code}]`
    ),
  ];

  // Determine final honest status
  let finalStatus: GroundedLlmVerificationOutcome["status"] = params.draft.answer_status;
  if (params.specialConstraints?.needs_vat_date_clarification) {
    finalStatus = "NEEDS_CLARIFICATION";
  } else {
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
  }

  const renderedAnswer = renderNeutralGroundedLlmAnswerTh({
    draft: sanitizedDraftForRender,
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
    rejected_calculations_diagnostic: buildRejectedDiagnostics(),
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
