import { describe, expect, it } from "vitest";
import {
  matchCandidateAgainstQuarantinedCitation,
  parseLegalInstrumentIdentity,
} from "../../src/core/knowledge/instrument-matcher";
import {
  extractEnablingAndAmendmentLinks,
  resolveCanonicalB02WorkId,
} from "../../src/core/knowledge/profiles/B02";

describe("Requirement 1 — Compound Thai Legal Instrument Identity & Homonym Collision Regression Suite", () => {
  it("rejects matching Petroleum Income Tax MR No. 5 (B.E. 2527 / 1984) against Signboard Tax MR No. 5 (B.E. 2535 / 1992)", () => {
    const p0Candidate = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2527) ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514",
      fileNameHint: "RD/CIT/1984_MR_5_กฎกระทรวง ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ.pdf",
    });

    const quarantinedSignboardTarget = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2535) ออกตามความในพระราชบัญญัติภาษีป้าย พ.ศ. 2510",
      targetWorkHint: "work.subordinatelegislation.reg_th_parliament.กฎกระทรวง_ฉบับที่_5_พ_ศ_2535_23fd6079",
    });

    expect(p0Candidate.instrument_kind).toBe("MINISTERIAL_REGULATION");
    expect(p0Candidate.instrument_number).toBe("5");
    expect(p0Candidate.enactment_year_be).toBe(2527);
    expect(p0Candidate.governing_law_family).toBe("PETROLEUM_INCOME_TAX_ACT_2514");

    expect(quarantinedSignboardTarget.instrument_kind).toBe("MINISTERIAL_REGULATION");
    expect(quarantinedSignboardTarget.instrument_number).toBe("5");
    expect(quarantinedSignboardTarget.enactment_year_be).toBe(2535);
    expect(quarantinedSignboardTarget.governing_law_family).toBe("SIGNBOARD_TAX_ACT_2510");

    const result = matchCandidateAgainstQuarantinedCitation(p0Candidate, quarantinedSignboardTarget);
    expect(result.matched).toBe(false);
    expect(result.match_status).toBe("REJECTED_DIFFERENT_GOVERNING_LAW");
    expect(result.ocr_alone_releases_quarantine).toBe(false);
  });

  it("rejects matching Signboard Tax MR No. 5 when soft line-wrap previously truncated governing law in target citation", () => {
    const p0Candidate = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2527) ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514",
      fileNameHint: "1984_MR_5_กฎกระทรวง ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ.pdf",
    });

    // Even if an older ledger entry had truncated at `\n` to `"กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2535"` without governing law:
    const truncatedTarget = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2535",
      targetWorkHint: "work.subordinatelegislation.reg_th_parliament.กฎกระทรวง_ฉบับที่_5_พ_ศ_2535_23fd6079",
    });

    const result = matchCandidateAgainstQuarantinedCitation(p0Candidate, truncatedTarget);
    expect(result.matched).toBe(false);
    expect(result.match_status).toBe("REJECTED_UNSPECIFIED_HOMONYM_RISK");
    expect(result.ocr_alone_releases_quarantine).toBe(false);
  });

  it("preserves wrapped multi-line repeal citations in B02.extractEnablingAndAmendmentLinks without newline truncation", () => {
    const signboard2020Text = [
      "อาศัยอำนาจตามความในมาตรา ๕ วรรคหนึ่ง แห่งพระราชบัญญัติภาษีป้าย พ.ศ. ๒๕๑๐",
      "ซึ่งแก้ไขเพิ่มเติมโดยพระราชบัญญัติภาษีป้าย (ฉบับที่ ๒) พ.ศ. ๒๕๓๔ รัฐมนตรีว่าการ",
      "กระทรวงมหาดไทยออกกฎกระทรวงไว้ ดังต่อไปนี้",
      "ข้อ ๑ ให้ยกเลิกกฎกระทรวง ฉบับที่ ๕ (พ.ศ. ๒๕๓๕) ออกตามความในพระราชบัญญัติ",
      "ภาษีป้าย พ.ศ. ๒๕๑๐",
      "ข้อ ๒ ให้กำหนดอัตราภาษีป้าย ดังต่อไปนี้",
    ].join("\n");

    const extracted = extractEnablingAndAmendmentLinks(
      "กฎกระทรวงกำหนดอัตราภาษีป้าย พ.ศ. ๒๕๖๓",
      signboard2020Text
    );

    expect(extracted.repealTargets.length).toBeGreaterThanOrEqual(1);
    expect(extracted.repealTargets[0].raw).toContain("กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2535)");
    expect(extracted.repealTargets[0].raw).toContain("พระราชบัญญัติ ภาษีป้าย พ.ศ. 2510".replace("พระราชบัญญัติ ", "พระราชบัญญัติ"));
  });

  it("prevents B02 canonical Work ID collisions between Petroleum Income Tax MRs (7, 8, 9, 10) and Revenue Code MRs", () => {
    for (const num of ["5", "7", "8", "9", "10"]) {
      const petroleumId = resolveCanonicalB02WorkId({
        titleTh: `กฎกระทรวง ฉบับที่ ${num} (พ.ศ. 2562) ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514`,
        fullText: "อาศัยอำนาจตามความในมาตรา 19 แห่งพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514",
        folderHint: "RD/CIT",
        fileNameHint: `2019_MR_${num}_กฎกระทรวง ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม.pdf`,
        entityType: "SubordinateLegislation",
        issuerId: "reg.th.mof",
        publicationYearCe: "2019",
        accessScope: "scope.platform.public",
      });

      const revenueCodeId = resolveCanonicalB02WorkId({
        titleTh: `กฎกระทรวง ฉบับที่ ${num} ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร`,
        fullText: "อาศัยอำนาจตามความในมาตรา 4 แห่งประมวลรัษฎากร",
        folderHint: "RD/CIT",
        fileNameHint: `1960_MR_${num}_กฎกระทรวง ออกตามความในประมวลรัษฎากร.pdf`,
        entityType: "SubordinateLegislation",
        issuerId: "reg.th.mof",
        publicationYearCe: "1960",
        accessScope: "scope.platform.public",
      });

      expect(petroleumId).toBe(`subreg.th.petroleum_tax.min_reg.${num}`);
      expect(revenueCodeId).toBe(`subreg.th.rc.min_reg.${num}`);
      expect(petroleumId).not.toBe(revenueCodeId);
    }

    const signboardId = resolveCanonicalB02WorkId({
      titleTh: "กฎกระทรวง ฉบับที่ 9 (พ.ศ. 2543) ออกตามความในพระราชบัญญัติภาษีป้าย พ.ศ. 2510",
      fullText: "อาศัยอำนาจตามความในมาตรา 5 แห่งพระราชบัญญัติภาษีป้าย พ.ศ. 2510",
      folderHint: "RD/General & Other Taxes",
      fileNameHint: "2000_MR_9_กฎกระทรวง ออกตามความในพระราชบัญญัติภาษีป้าย พ.ศ. 2510.pdf",
      entityType: "SubordinateLegislation",
      issuerId: "reg.th.moi",
      publicationYearCe: "2000",
      accessScope: "scope.platform.public",
    });
    expect(signboardId).toBe("subreg.th.signboard_tax.min_reg.9");
  });

  it("rejects same-number Royal Decrees & Ministerial Regulations when enactment years conflict or parent laws differ", () => {
    const rcRd6 = parseLegalInstrumentIdentity({
      titleOrCitation: "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 6) พ.ศ. 2500",
      targetWorkHint: "subreg.th.rc.royal_decree.6",
    });
    const ocsRd6 = parseLegalInstrumentIdentity({
      titleOrCitation: "พระราชกฤษฎีกาเบี้ยประชุมของกรรมการกฤษฎีกา (ฉบับที่ 6) พ.ศ. 2547",
      fileNameHint: "2004-10-20_RoyalDecree_BE2547-No6.pdf",
    });
    expect(matchCandidateAgainstQuarantinedCitation(ocsRd6, rcRd6).matched).toBe(false);
    expect(matchCandidateAgainstQuarantinedCitation(ocsRd6, rcRd6).match_status).toBe(
      "REJECTED_DIFFERENT_GOVERNING_LAW"
    );

    const mrSameLaw1982 = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวง ฉบับที่ 144 (พ.ศ. 2525) ออกตามความในประมวลรัษฎากร",
    });
    const mrSameLaw2015 = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวง ฉบับที่ 144 (พ.ศ. 2558) ออกตามความในประมวลรัษฎากร",
    });
    const yrRes = matchCandidateAgainstQuarantinedCitation(mrSameLaw1982, mrSameLaw2015);
    expect(yrRes.matched).toBe(false);
    expect(yrRes.match_status).toBe("REJECTED_DIFFERENT_ENACTMENT_YEAR");
  });

  it("distinguishes principal Acts from amending Acts and subordinate regulations, and never mistakes พ.ศ. 2560 for No. 2560", () => {
    const baseOcsAct = parseLegalInstrumentIdentity({
      titleOrCitation: "มาตรา 15 วรรคสาม แห่งพระราชบัญญัติคณะกรรมการกฤษฎีกา พ.ศ. 2522",
    });
    const amendingOcsAct2 = parseLegalInstrumentIdentity({
      titleOrCitation: "พระราชบัญญัติคณะกรรมการกฤษฎีกา (ฉบับที่ 2) พ.ศ. 2527",
    });
    const amendRes = matchCandidateAgainstQuarantinedCitation(amendingOcsAct2, baseOcsAct);
    expect(amendRes.matched).toBe(false);
    expect(amendRes.match_status).toBe("AMENDMENT_ACT_REQUIRES_SECTION_CHECK");

    // Unnumbered regulation enacted in B.E. 2560 must have `instrument_number: null`, NEVER `"2560"`
    const unnumbered2560 = parseLegalInstrumentIdentity({
      titleOrCitation: "กฎกระทรวงกำหนดพิกัดอัตราภาษีสรรพสามิต พ.ศ. 2560",
    });
    expect(unnumbered2560.instrument_kind).toBe("MINISTERIAL_REGULATION");
    expect(unnumbered2560.instrument_number).toBeNull();
    expect(unnumbered2560.enactment_year_be).toBe(2560);

    // Genuine P0 principal Act matches succeed ONLY with `ocr_alone_releases_quarantine: false`
    const petroleumActCand = parseLegalInstrumentIdentity({
      titleOrCitation: "พระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514",
      fileNameHint: "RD/CIT/1971_Act_na_พระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514.pdf",
    });
    const petroleumQuarTarget = parseLegalInstrumentIdentity({
      titleOrCitation: "มาตรา 19 แห่งพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514",
    });
    const genuineMatch = matchCandidateAgainstQuarantinedCitation(petroleumActCand, petroleumQuarTarget);
    expect(genuineMatch.matched).toBe(true);
    expect(genuineMatch.match_status).toBe("VERIFIED_PRINCIPAL_INSTRUMENT_CANDIDATE");
    expect(genuineMatch.ocr_alone_releases_quarantine).toBe(false);
  });

  it("handles underscore-delimited Council of State filenames and rejects prefix-sharing Thai tax Acts", () => {
    // Underscore-delimited Ministerial Regulation under Administrative Procedure Act MUST NOT be parsed as an ACT!
    const adminMr2 = parseLegalInstrumentIdentity({
      titleOrCitation:
        "1997-05-22_MinisterialRegulation_BE2540-No2_กฎกระทรวง_ฉบับที่_2_(พ.ศ._2540)_ออกต~ในพระราชบัญญัติวิธีปฏิบัติราชการทางปกครอง",
      fileNameHint:
        "Council of State (กฤษฎีกา)/1997-05-22_MinisterialRegulation_BE2540-No2_กฎกระทรวง_ฉบับที่_2_(พ.ศ._2540)_ออกต~ในพระราชบัญญัติวิธีปฏิบัติราชการทางปกครอง.pdf",
    });
    const adminActTarget = parseLegalInstrumentIdentity({
      titleOrCitation: "มาตรา 44 แห่งพระราชบัญญัติวิธีปฏิบัติราชการทางปกครอง พ.ศ. 2539",
    });
    expect(adminMr2.instrument_kind).toBe("MINISTERIAL_REGULATION");
    expect(adminMr2.instrument_number).toBe("2");
    expect(matchCandidateAgainstQuarantinedCitation(adminMr2, adminActTarget).matched).toBe(false);
    expect(matchCandidateAgainstQuarantinedCitation(adminMr2, adminActTarget).match_status).toBe(
      "REJECTED_DIFFERENT_INSTRUMENT_KIND"
    );

    // Underscore-delimited amending Act `_(ฉบับที่_2)_` MUST set `is_amending_instrument: true`
    const ocsAmendUnderscore = parseLegalInstrumentIdentity({
      titleOrCitation: "1979-07-27_Act_BE2522-No2_พระราชบัญญัติคณะกรรมการกฤษฎีกา_(ฉบับที่_2)_พ.ศ._2522",
      fileNameHint: "1979-07-27_Act_BE2522-No2_พระราชบัญญัติคณะกรรมการกฤษฎีกา_(ฉบับที่_2)_พ.ศ._2522.pdf",
    });
    expect(ocsAmendUnderscore.is_amending_instrument).toBe(true);
    expect(ocsAmendUnderscore.amendment_issue_number).toBe("2");

    // Prefix-sharing Acts (`พระราชบัญญัติภาษีป้าย` vs `พระราชบัญญัติภาษีที่ดินและสิ่งปลูกสร้าง`) MUST NEVER match!
    const signboardAct = parseLegalInstrumentIdentity({
      titleOrCitation: "1967_Act_na_พระราชบัญญัติภาษีป้าย พศ 2510_fc67",
      fileNameHint: "RD/General & Other Taxes/1967_Act_na_พระราชบัญญัติภาษีป้าย พศ 2510_fc67.pdf",
    });
    const landTaxAct = parseLegalInstrumentIdentity({
      titleOrCitation: "มาตรา 41 แห่งพระราชบัญญัติภาษีที่ดินและสิ่งปลูกสร้าง พ.ศ. 2562",
    });
    expect(matchCandidateAgainstQuarantinedCitation(signboardAct, landTaxAct).matched).toBe(false);
    expect(matchCandidateAgainstQuarantinedCitation(signboardAct, landTaxAct).match_status).toBe(
      "REJECTED_DIFFERENT_GOVERNING_LAW"
    );
  });
});
