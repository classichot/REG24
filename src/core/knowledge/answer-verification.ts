/**
 * REG24 — Task F5: Grounded Legal Claim Verification & Polarity Contradiction Blocker
 *
 * Implements:
 * - SH-12, SH-14
 * - AT09 (Prompt-injection untrusted text quarantine)
 * - AT11 (Blocks confident answer when quoted source contradicts the claimed legal conclusion)
 */

import { thaiDigitsToArabic } from "./identity";
import type { ClaimLedgerItem, Passage } from "./contracts";

export interface ClaimVerificationOutcome {
  verification_result: ClaimLedgerItem["verification_result"];
  allow_confident_answer: boolean;
  reason: string;
}

function detectThaiTaxPolarity(text: string): {
  claimsExemptionOrZeroRate: boolean;
  claimsTaxableOrNonExempt: boolean;
  hasConditions: boolean;
} {
  const norm = thaiDigitsToArabic(text).replace(/\s+/g, " ");

  const nonExemptPatterns = [
    /ไม่เข้าลักษณะ[^。\n]{0,80}ได้รับยกเว้น/,
    /ไม่ได้รับยกเว้น/,
    /มิได้รับยกเว้น/,
    /ไม่ได้รับสิทธิ/,
    /ไม่มีสิทธิได้รับเครดิตภาษี/,
    /จึงต้องเสียภาษี/,
    /(?<!ไม่|มิ)ต้องเสียภาษีมูลค่าเพิ่ม(?!ในอัตราร้อยละ\s*0)/,
    /(?<!ไม่|มิ)ต้องนำมารวมคำนวณกำไรสุทธิเพื่อเสียภาษี/,
    /ไม่ให้ถือเป็นรายจ่าย/,
  ];

  const exemptPatterns = [
    /(?<!ไม่|มิได้|ที่จะ)ได้รับ(?:การ)?ยกเว้นภาษี/,
    /ไม่ต้องเสียภาษี/,
    /ไม่เสียภาษี/,
    /ไม่ต้องนำมาเป็นมูลค่าฐานภาษี/,
    /มีสิทธิเสียภาษี(?:มูลค่าเพิ่ม)?ในอัตรา(?:ภาษี)?ร้อยละ\s*0/,
    /ได้รับสิทธิ\s*เสียภาษีมูลค่าเพิ่มในอัตราร้อยละ\s*0/,
  ];

  const claimsTaxableOrNonExempt = nonExemptPatterns.some((re) => re.test(norm));
  // Note: if non-exempt explicitly matched on "ไม่เข้าลักษณะ...ที่จะได้รับยกเว้น", prevent false positive exempt match on the embedded clause
  const claimsExemptionOrZeroRate =
    exemptPatterns.some((re) => re.test(norm)) &&
    !/ไม่เข้าลักษณะ[^。\n]{0,80}ได้รับยกเว้น.*จึงต้องเสียภาษี/.test(norm);

  const hasConditions = /(?:หาก|เมื่อ|ทั้งนี้\s*ต้อง|เว้นแต่|ภายใต้เงื่อนไข)/.test(norm);

  return {
    claimsExemptionOrZeroRate,
    claimsTaxableOrNonExempt,
    hasConditions,
  };
}

/**
 * Verifies a proposed answer claim against its cited supporting passages (`AT11`).
 * Blocks confident answers when citations are missing, locators are broken, or the cited
 * passage's legal polarity/negation contradicts the claim!
 */
export function verifyClaimAgainstPassages(
  claim: {
    statement: string;
    supporting_passage_ids: string[];
  },
  availablePassages: Passage[]
): ClaimVerificationOutcome {
  if (!claim.supporting_passage_ids || claim.supporting_passage_ids.length === 0) {
    return {
      verification_result: "UNSUPPORTED",
      allow_confident_answer: false,
      reason: "CLAIM_MISSING_SUPPORTING_PASSAGES",
    };
  }

  const psgMap = new Map(availablePassages.map((p) => [p.passage_id, p]));
  const cited: Passage[] = [];

  for (const pid of claim.supporting_passage_ids) {
    const p = psgMap.get(pid);
    if (!p) {
      return {
        verification_result: "UNSUPPORTED",
        allow_confident_answer: false,
        reason: `UNRESOLVED_SUPPORTING_PASSAGE:${pid}`,
      };
    }
    if (!p.real_locator || !p.real_locator.artifact_id || !p.real_locator.origin_uri) {
      return {
        verification_result: "UNSUPPORTED",
        allow_confident_answer: false,
        reason: `BROKEN_PASSAGE_LOCATOR:${pid}`,
      };
    }
    cited.push(p);
  }

  // Block claims that attempt to execute or repeat prompt-injection commands from quarantined untrusted text (AT09)
  if (
    cited.some((p) => p.contains_untrusted_instruction_like_text) &&
    /ignore previous instructions|grant admin|delete_database/i.test(claim.statement)
  ) {
    return {
      verification_result: "BLOCKED_CONTRADICTION",
      allow_confident_answer: false,
      reason: "UNTRUSTED_INSTRUCTION_EXECUTION_BLOCKED",
    };
  }

  const claimPol = detectThaiTaxPolarity(claim.statement);
  const combinedSourceText = cited.map((p) => p.exact_text).join("\n");
  const sourcePol = detectThaiTaxPolarity(combinedSourceText);

  // Contradiction 1: Claim asserts tax exemption / 0% / no tax, while source rules it is NOT exempt and MUST pay tax!
  if (
    claimPol.claimsExemptionOrZeroRate &&
    !claimPol.claimsTaxableOrNonExempt &&
    sourcePol.claimsTaxableOrNonExempt &&
    !sourcePol.claimsExemptionOrZeroRate
  ) {
    return {
      verification_result: "BLOCKED_CONTRADICTION",
      allow_confident_answer: false,
      reason:
        "POLARITY_CONTRADICTION: Claim states exemption/no-tax whereas cited source concludes non-exempt/taxable.",
    };
  }

  // Contradiction 2: Claim asserts non-exempt / taxable, while source unambiguously grants exemption / 0% without contrary clause
  if (
    claimPol.claimsTaxableOrNonExempt &&
    !claimPol.claimsExemptionOrZeroRate &&
    sourcePol.claimsExemptionOrZeroRate &&
    !sourcePol.claimsTaxableOrNonExempt
  ) {
    return {
      verification_result: "BLOCKED_CONTRADICTION",
      allow_confident_answer: false,
      reason:
        "POLARITY_CONTRADICTION: Claim states taxable/non-exempt whereas cited source concludes exempt/zero-rated.",
    };
  }

  if (sourcePol.hasConditions && !claimPol.hasConditions && claim.statement.length < 180) {
    return {
      verification_result: "CONDITIONAL_QUALIFIED",
      allow_confident_answer: true,
      reason: "SOURCE_CONTAINS_CONDITIONS_OR_EXCEPTIONS",
    };
  }

  return {
    verification_result: "VERIFIED",
    allow_confident_answer: true,
    reason: "VERIFIED_AGAINST_CITED_PASSAGES",
  };
}
