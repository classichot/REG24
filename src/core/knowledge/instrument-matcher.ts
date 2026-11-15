/**
 * Compound Thai Legal Instrument Identity Parser & Quarantine Matcher (`REG24` B01/B02)
 *
 * Prevents homonym / number-only false matches across subordinate & principal legislation by
 * binding full compound identity:
 *   1. `instrument_kind`: `ACT` | `EMERGENCY_DECREE` | `CODE` | `ROYAL_DECREE` | `MINISTERIAL_REGULATION` | `NOTIFICATION` | `DEPARTMENTAL_ORDER` | `OTHER`
 *   2. `instrument_number`: Explicit `ฉบับที่ N` / `_MR_N_` / `_RD_N_` ONLY (never mistaking `พ.ศ. 2560` for `No. 2560`)
 *   3. `governing_law_family`: Explicit parent Act / Code (`REVENUE_CODE`, `PETROLEUM_INCOME_TAX_ACT_2514`, `SIGNBOARD_TAX_ACT_2510`, etc.)
 *   4. `enactment_year_be`: Explicit Buddhist Era year (`พ.ศ. YYYY`, or CE + 543 when unambiguously tied to the instrument itself)
 *   5. `is_amending_instrument`: Distinguishes principal Act (`พ.ร.บ. คณะกรรมการกฤษฎีกา พ.ศ. 2522`) from amending Acts (`(ฉบับที่ 2) พ.ศ. 2527`)
 */

export type ThaiLegalInstrumentKind =
  | "CODE"
  | "ACT"
  | "EMERGENCY_DECREE"
  | "ROYAL_DECREE"
  | "MINISTERIAL_REGULATION"
  | "DEPARTMENTAL_ORDER"
  | "NOTIFICATION"
  | "OTHER";

export type GoverningLawFamily =
  | "REVENUE_CODE"
  | "PETROLEUM_INCOME_TAX_ACT_2514"
  | "SIGNBOARD_TAX_ACT_2510"
  | "EXPORT_TAX_COMPENSATION_ACT_2524"
  | "INHERITANCE_TAX_ACT_2558"
  | "CUSTOMS_ACT"
  | "EXCISE_TAX_ACT"
  | "TOP_UP_TAX_DECREE_2567"
  | "OUTBOUND_TRAVEL_TAX_DECREE_2526"
  | "COUNCIL_OF_STATE_ACT_2522"
  | "PUBLIC_LIMITED_COMPANIES_ACT_2535"
  | "CIVIL_AND_COMMERCIAL_CODE"
  | "OTHER_OR_UNSPECIFIED";

export interface ParsedLegalInstrumentIdentity {
  instrument_kind: ThaiLegalInstrumentKind;
  instrument_number: string | null;
  governing_law_family: GoverningLawFamily;
  governing_law_raw: string | null;
  principal_act_title_normalized: string | null;
  enactment_year_be: number | null;
  is_amending_instrument: boolean;
  amendment_issue_number: string | null;
}

export interface QuarantineInstrumentMatchResult {
  matched: boolean;
  match_status:
    | "VERIFIED_PRINCIPAL_INSTRUMENT_CANDIDATE"
    | "AMENDMENT_ACT_REQUIRES_SECTION_CHECK"
    | "REJECTED_DIFFERENT_GOVERNING_LAW"
    | "REJECTED_DIFFERENT_ENACTMENT_YEAR"
    | "REJECTED_DIFFERENT_INSTRUMENT_KIND"
    | "REJECTED_DIFFERENT_INSTRUMENT_NUMBER"
    | "REJECTED_UNSPECIFIED_HOMONYM_RISK";
  ocr_alone_releases_quarantine: false;
  rationale: string;
}

const THAI_DIGITS_MAP: Record<string, string> = {
  "๐": "0",
  "๑": "1",
  "๒": "2",
  "๓": "3",
  "๔": "4",
  "๕": "5",
  "๖": "6",
  "๗": "7",
  "๘": "8",
  "๙": "9",
};

export function normalizeThaiDigitsAndWhitespace(input: string): string {
  return input
    .replace(/[๐-๙]/g, (ch) => THAI_DIGITS_MAP[ch] ?? ch)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectGoverningLawFamily(rawText: string): {
  family: GoverningLawFamily;
  rawMatch: string | null;
} {
  const s = normalizeThaiDigitsAndWhitespace(rawText);
  if (/ภาษีเงินได้ปิโตรเลียม|Petroleum\s*Income\s*Tax/i.test(s)) {
    return { family: "PETROLEUM_INCOME_TAX_ACT_2514", rawMatch: "พระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514" };
  }
  if (/ภาษีป้าย|Signboard\s*Tax/i.test(s)) {
    return { family: "SIGNBOARD_TAX_ACT_2510", rawMatch: "พระราชบัญญัติภาษีป้าย พ.ศ. 2510" };
  }
  if (/ชดเชยค่าภาษีอากรสินค้าส่งออก/.test(s)) {
    return {
      family: "EXPORT_TAX_COMPENSATION_ACT_2524",
      rawMatch: "พระราชบัญญัติชดเชยค่าภาษีอากรสินค้าส่งออกที่ผลิตในราชอาณาจักร พ.ศ. 2524",
    };
  }
  if (/ภาษีการรับมรดก/.test(s)) {
    return { family: "INHERITANCE_TAX_ACT_2558", rawMatch: "พระราชบัญญัติภาษีการรับมรดก พ.ศ. 2558" };
  }
  if (/ภาษีส่วนเพิ่ม\s*พ\.ศ\.\s*2567/.test(s)) {
    return { family: "TOP_UP_TAX_DECREE_2567", rawMatch: "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. 2567" };
  }
  if (/ภาษีการเดินทางออกนอกราชอาณาจักร/.test(s)) {
    return {
      family: "OUTBOUND_TRAVEL_TAX_DECREE_2526",
      rawMatch: "พระราชกำหนดภาษีการเดินทางออกนอกราชอาณาจักร พ.ศ. 2526",
    };
  }
  if (/พระราชบัญญัติศุลกากร|Customs\s*Act|พิกัดอัตราศุลกากร/i.test(s)) {
    return { family: "CUSTOMS_ACT", rawMatch: "พระราชบัญญัติศุลกากร" };
  }
  if (/พระราชบัญญัติภาษีสรรพสามิต|Excise\s*(?:Tax\s*)?Act|พิกัดอัตราภาษีสรรพสามิต/i.test(s)) {
    return { family: "EXCISE_TAX_ACT", rawMatch: "พระราชบัญญัติภาษีสรรพสามิต" };
  }
  if (/คณะกรรมการกฤษฎีกา|กรรมการกฤษฎีกา/.test(s)) {
    return { family: "COUNCIL_OF_STATE_ACT_2522", rawMatch: "พระราชบัญญัติคณะกรรมการกฤษฎีกา พ.ศ. 2522" };
  }
  if (/บริษัทมหาชนจำกัด/.test(s)) {
    return { family: "PUBLIC_LIMITED_COMPANIES_ACT_2535", rawMatch: "พระราชบัญญัติบริษัทมหาชนจำกัด พ.ศ. 2535" };
  }
  if (/ประมวลกฎหมายแพ่งและพาณิชย์/.test(s)) {
    return { family: "CIVIL_AND_COMMERCIAL_CODE", rawMatch: "ประมวลกฎหมายแพ่งและพาณิชย์" };
  }
  if (/ประมวลรัษฎากร|revenue_code|\.rc\./i.test(s)) {
    return { family: "REVENUE_CODE", rawMatch: "ประมวลรัษฎากร" };
  }
  return { family: "OTHER_OR_UNSPECIFIED", rawMatch: null };
}

export function parseLegalInstrumentIdentity(params: {
  titleOrCitation: string;
  fileNameHint?: string;
  bodyHeadHint?: string;
  targetWorkHint?: string;
}): ParsedLegalInstrumentIdentity {
  const titlePart = normalizeThaiDigitsAndWhitespace((params.titleOrCitation || "").replace(/_/g, " "));
  const fileRaw = normalizeThaiDigitsAndWhitespace(params.fileNameHint || "");
  const fileSpaced = normalizeThaiDigitsAndWhitespace(
    (params.fileNameHint || "")
      .replace(/\.pdf$/i, "")
      .replace(/_fc[0-9a-f]{2}(?:\s*\([0-9]+\))?$/i, "")
      .replace(/_/g, " ")
  );
  const targetPart = normalizeThaiDigitsAndWhitespace(params.targetWorkHint || "");
  const bodyPart = normalizeThaiDigitsAndWhitespace((params.bodyHeadHint || "").slice(0, 800));
  const combinedHeader = `${titlePart} ${fileSpaced} ${targetPart}`.trim();
  const fullContext = `${combinedHeader} ${bodyPart}`.trim();

  // 1. Instrument Kind (evaluate subordinate forms BEFORE parent Act mentions in "ออกตามความในพระราชบัญญัติ...")
  let kind: ThaiLegalInstrumentKind = "OTHER";
  if (
    /(?:^|\s)กฎกระทรวง|_MR_|MinReg|MinisterialRegulation|ministerial_reg/i.test(`${combinedHeader} ${fileRaw}`) &&
    !/^(?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา)/.test(titlePart)
  ) {
    kind = "MINISTERIAL_REGULATION";
  } else if (
    /(?:^|\s)(?:พระราชกฤษฎีกา|พรฎ\.?)|_RD_|RoyalDecree|Royal-Decree|royal_decree/i.test(`${combinedHeader} ${fileRaw}`) &&
    !/^(?:พระราชบัญญัติ|พระราชกำหนด)/.test(titlePart)
  ) {
    kind = "ROYAL_DECREE";
  } else if (/คำสั่งกรม|RDOrder|order_tp|order_p/i.test(`${combinedHeader} ${fileRaw}`)) {
    kind = "DEPARTMENTAL_ORDER";
  } else if (/(?:^|\s)ประกาศ|DGNotif|EDNotif|Notification/i.test(`${combinedHeader} ${fileRaw}`)) {
    kind = "NOTIFICATION";
  } else if (/พระราชกำหนด|Emergency\s*Decree|EmergencyDecree/i.test(`${combinedHeader} ${fileRaw}`)) {
    kind = "EMERGENCY_DECREE";
  } else if (/พระราชบัญญัติ|_Act_|Act_/i.test(`${combinedHeader} ${fileRaw}`)) {
    kind = "ACT";
  } else if (/ประมวลรัษฎากร|ประมวลกฎหมาย/.test(combinedHeader)) {
    kind = "CODE";
  }

  // 2. Explicit Instrument Number (ONLY `ฉบับที่ N`, `No. N`, `_MR_N_`, `_RD_N_`, `.royal_decree.N`, `.ministerial_reg.N` — NEVER `พ.ศ. 2560`)
  let instrumentNumber: string | null = null;
  if (kind === "MINISTERIAL_REGULATION" || kind === "ROYAL_DECREE" || kind === "NOTIFICATION") {
    const headBeforeEnabling = combinedHeader.split(/ออกตามความใน|ออกต~ใน|ออก~ใน|อาศัยอำนาจตามความใน/)[0] || combinedHeader;
    instrumentNumber =
      headBeforeEnabling.match(/ฉบับที่\s*([0-9]{1,4})\b/)?.[1] ??
      fileRaw.match(/(?:_MR_|_RD_|MinReg_?|MinisterialRegulation_?(?:BE[0-9]{4}-)?|RoyalDecree_?(?:BE[0-9]{4}-)?|Royal-Decree_?)(?:No)?([0-9]{1,4})(?:[-_.\s]|$)/i)?.[1] ??
      targetPart.match(/(?:ministerial_reg|min_reg|royal_decree)\.([0-9]{1,4})\b/i)?.[1] ??
      null;
  }

  // 3. Amending Act detection (`(ฉบับที่ 2) พ.ศ. 2527`, `BE2522-No2`, or `แก้ไขเพิ่มเติม... (ฉบับที่ N)`)
  let isAmending = false;
  let amendmentIssueNumber: string | null = null;
  if (kind === "ACT" || kind === "EMERGENCY_DECREE") {
    const amendMatch =
      combinedHeader.match(/\(ฉบับที่\s*([0-9]{1,4})\)|แก้ไขเพิ่มเติม[^\n]{0,60}\(ฉบับที่\s*([0-9]{1,4})\)/) ??
      fileRaw.match(/Act_BE[0-9]{4}-No([0-9]{1,4})\b/i);
    if (amendMatch) {
      isAmending = true;
      amendmentIssueNumber = amendMatch[1] || amendMatch[2] || null;
    }
  }

  // 4. Enactment Year B.E. of THIS instrument (before `ออกตามความใน...` so parent Act year B.E. 2514 is not mistaken for MR year B.E. 2527!)
  const ownClause = combinedHeader.split(/ออกตามความใน|ออกต~ใน|ออก~ใน|แห่งพระราชบัญญัติ|แห่งพระราชกำหนด/)[0] || combinedHeader;
  let yearBe: number | null = null;
  const beOwnMatch = ownClause.match(/(?:พ\.?\s*ศ\.?|พุทธศักราช)\s*(2[3456][0-9]{2})\b/);
  if (beOwnMatch?.[1]) {
    yearBe = Number(beOwnMatch[1]);
  } else if (kind === "ACT" || kind === "EMERGENCY_DECREE") {
    const anyBe = combinedHeader.match(/(?:พ\.?\s*ศ\.?|พุทธศักราช)\s*(2[3456][0-9]{2})\b/);
    if (anyBe?.[1]) yearBe = Number(anyBe[1]);
  }
  if (!yearBe) {
    const cePrefix = fileRaw.match(/(?:^|\/|\\)((?:19|20)[0-9]{2})(?:[-_])/);
    if (cePrefix?.[1]) {
      yearBe = Number(cePrefix[1]) + 543;
    }
  }

  // 5. Governing Law Family & Full Principal Act Title (greedy Thai title before `(ฉบับที่...)` or `พ.ศ.`/`พุทธศักราช`)
  const gov = detectGoverningLawFamily(fullContext);
  let principalActTitle: string | null = null;
  const actSpanMatch = combinedHeader.match(/พระราชบัญญัติ[ก-๙\s]{4,120}/);
  if (actSpanMatch?.[0]) {
    const cleaned = actSpanMatch[0]
      .replace(/\s*(?:พ\.?\s*ศ\.?|พุทธศักราช).*$/, "")
      .replace(/\s*พุทธศักรา.*$/, "")
      .replace(/^พระราชบัญญัติแก้ไขเพิ่มเติม/, "พระราชบัญญัติ")
      .replace(/\s+/g, "")
      .trim();
    if (cleaned.length >= 16) {
      principalActTitle = cleaned;
    }
  }

  return {
    instrument_kind: kind,
    instrument_number: instrumentNumber,
    governing_law_family: gov.family,
    governing_law_raw: gov.rawMatch,
    principal_act_title_normalized: principalActTitle,
    enactment_year_be: yearBe,
    is_amending_instrument: isAmending,
    amendment_issue_number: amendmentIssueNumber,
  };
}

/**
 * Strict compound matcher between a candidate B02 document and a quarantined unresolved citation entry.
 * Never matches by number alone; never treats OCR extraction as releasing a quarantined citation.
 */
export function matchCandidateAgainstQuarantinedCitation(
  candidate: ParsedLegalInstrumentIdentity,
  quarantinedTarget: ParsedLegalInstrumentIdentity
): QuarantineInstrumentMatchResult {
  if (candidate.instrument_kind === "OTHER" || quarantinedTarget.instrument_kind === "OTHER") {
    return {
      matched: false,
      match_status: "REJECTED_DIFFERENT_INSTRUMENT_KIND",
      ocr_alone_releases_quarantine: false,
      rationale: "Unclassified instrument kind cannot satisfy compound legal identity match",
    };
  }

  // Subordinate instrument (`MR` / `RD`) can NEVER match a parent `ACT` citation (`พ.ร.บ. ภาษีเงินได้ปิโตรเลียม พ.ศ. 2514`), or vice versa
  if (candidate.instrument_kind !== quarantinedTarget.instrument_kind) {
    return {
      matched: false,
      match_status: "REJECTED_DIFFERENT_INSTRUMENT_KIND",
      ocr_alone_releases_quarantine: false,
      rationale: `Instrument kind mismatch: candidate=${candidate.instrument_kind} vs target=${quarantinedTarget.instrument_kind}`,
    };
  }

  // Subordinate regulations (`MINISTERIAL_REGULATION`, `ROYAL_DECREE`, `NOTIFICATION`, `DEPARTMENTAL_ORDER`)
  if (
    candidate.instrument_kind === "MINISTERIAL_REGULATION" ||
    candidate.instrument_kind === "ROYAL_DECREE"
  ) {
    if (
      !candidate.instrument_number ||
      !quarantinedTarget.instrument_number ||
      candidate.instrument_number !== quarantinedTarget.instrument_number
    ) {
      return {
        matched: false,
        match_status: "REJECTED_DIFFERENT_INSTRUMENT_NUMBER",
        ocr_alone_releases_quarantine: false,
        rationale: `Subordinate number mismatch (${candidate.instrument_number ?? "unnumbered"} vs ${quarantinedTarget.instrument_number ?? "unnumbered"})`,
      };
    }

    // Both must bind to a specific, identical governing parent law (NEVER match across unspecified homonyms!)
    if (
      candidate.governing_law_family === "OTHER_OR_UNSPECIFIED" ||
      quarantinedTarget.governing_law_family === "OTHER_OR_UNSPECIFIED"
    ) {
      return {
        matched: false,
        match_status: "REJECTED_UNSPECIFIED_HOMONYM_RISK",
        ocr_alone_releases_quarantine: false,
        rationale: `Subordinate No. ${candidate.instrument_number} lacks verified governing parent statute on one or both sides`,
      };
    }

    if (candidate.governing_law_family !== quarantinedTarget.governing_law_family) {
      return {
        matched: false,
        match_status: "REJECTED_DIFFERENT_GOVERNING_LAW",
        ocr_alone_releases_quarantine: false,
        rationale: `Same number (${candidate.instrument_number}) but different governing laws: ${candidate.governing_law_family} vs ${quarantinedTarget.governing_law_family}`,
      };
    }

    if (
      candidate.enactment_year_be !== null &&
      quarantinedTarget.enactment_year_be !== null &&
      candidate.enactment_year_be !== quarantinedTarget.enactment_year_be
    ) {
      return {
        matched: false,
        match_status: "REJECTED_DIFFERENT_ENACTMENT_YEAR",
        ocr_alone_releases_quarantine: false,
        rationale: `Same number (${candidate.instrument_number}) and law (${candidate.governing_law_family}) but different enactment years: B.E. ${candidate.enactment_year_be} vs B.E. ${quarantinedTarget.enactment_year_be}`,
      };
    }

    return {
      matched: true,
      match_status: "VERIFIED_PRINCIPAL_INSTRUMENT_CANDIDATE",
      ocr_alone_releases_quarantine: false,
      rationale: `Compound match on ${candidate.instrument_kind} No. ${candidate.instrument_number} under ${candidate.governing_law_family}${
        candidate.enactment_year_be ? ` (B.E. ${candidate.enactment_year_be})` : ""
      }; separate legal section/version/effective-date check still required before releasing quarantine`,
    };
  }

  // Principal Acts / Emergency Decrees (`ACT` / `EMERGENCY_DECREE`)
  if (candidate.instrument_kind === "ACT" || candidate.instrument_kind === "EMERGENCY_DECREE") {
    const candKnown = candidate.governing_law_family !== "OTHER_OR_UNSPECIFIED";
    const targKnown = quarantinedTarget.governing_law_family !== "OTHER_OR_UNSPECIFIED";

    // Never match across different known families OR between a known family (e.g. Signboard Tax) and an unspecified/other Act!
    if (candKnown || targKnown) {
      if (candidate.governing_law_family !== quarantinedTarget.governing_law_family) {
        return {
          matched: false,
          match_status: "REJECTED_DIFFERENT_GOVERNING_LAW",
          ocr_alone_releases_quarantine: false,
          rationale: `Governing law family mismatch: ${candidate.governing_law_family} vs ${quarantinedTarget.governing_law_family}`,
        };
      }
    } else {
      const sameExactActTitle =
        Boolean(candidate.principal_act_title_normalized) &&
        candidate.principal_act_title_normalized === quarantinedTarget.principal_act_title_normalized;
      if (!sameExactActTitle) {
        return {
          matched: false,
          match_status: "REJECTED_DIFFERENT_GOVERNING_LAW",
          ocr_alone_releases_quarantine: false,
          rationale: "Act title does not match exactly",
        };
      }
      // For Acts outside the enumerated tax families, require explicit matching enactment years on both sides
      if (
        candidate.enactment_year_be === null ||
        quarantinedTarget.enactment_year_be === null
      ) {
        return {
          matched: false,
          match_status: "REJECTED_UNSPECIFIED_HOMONYM_RISK",
          ocr_alone_releases_quarantine: false,
          rationale: "General Act match requires explicit enactment year on both candidate and quarantined citation",
        };
      }
    }

    // If candidate is an amending Act (`(ฉบับที่ 2)`), do NOT auto-equate with principal Act!
    if (candidate.is_amending_instrument !== quarantinedTarget.is_amending_instrument) {
      return {
        matched: false,
        match_status: "AMENDMENT_ACT_REQUIRES_SECTION_CHECK",
        ocr_alone_releases_quarantine: false,
        rationale: `Candidate is amending Act (ฉบับที่ ${candidate.amendment_issue_number ?? "?"}) whereas quarantined citation targets principal Act; requires section-level amendment check`,
      };
    }

    // Principal Acts with same name in different years (e.g. Customs Act B.E. 2469 vs B.E. 2560; Investment Promotion Act B.E. 2520 vs earlier) MUST match enactment year!
    if (
      candidate.enactment_year_be !== null &&
      quarantinedTarget.enactment_year_be !== null &&
      candidate.enactment_year_be !== quarantinedTarget.enactment_year_be
    ) {
      return {
        matched: false,
        match_status: "REJECTED_DIFFERENT_ENACTMENT_YEAR",
        ocr_alone_releases_quarantine: false,
        rationale: `Same Act title (${candidate.principal_act_title_normalized ?? candidate.governing_law_family}) but different enactment years: B.E. ${candidate.enactment_year_be} vs B.E. ${quarantinedTarget.enactment_year_be}`,
      };
    }

    return {
      matched: true,
      match_status: "VERIFIED_PRINCIPAL_INSTRUMENT_CANDIDATE",
      ocr_alone_releases_quarantine: false,
      rationale: `Compound principal-statute match (${candidate.principal_act_title_normalized ?? candidate.governing_law_family}, B.E. ${
        candidate.enactment_year_be ?? "unspecified"
      }); separate legal section/version/effective-date check required before releasing quarantine`,
    };
  }

  return {
    matched: false,
    match_status: "REJECTED_UNSPECIFIED_HOMONYM_RISK",
    ocr_alone_releases_quarantine: false,
    rationale: "Non-principal or unnumbered notification/order requires manual citation binding",
  };
}
