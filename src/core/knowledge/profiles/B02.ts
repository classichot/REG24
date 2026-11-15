/**
 * REG24 — Batch B02 Domain Extraction Profile: Statutes & Tax Framework (`extractB02`)
 * Implements B02_DEVELOPER_REQUIREMENTS.md Sections 3, 4 & 5 (B02-EX, B02-GR, B02-QA).
 */

import { chunkThaiLegalDocument } from "../extraction";
import {
  buildDeterministicWorkId,
  normalizeThaiLegalSectionRef,
  parseThaiBuddhistDateToIso,
  sha256Bytes,
  thaiDigitsToArabic,
} from "../identity";
import type { KnowledgeEntityType } from "../../graph/graph-schema";
import type {
  ApplicabilityInterval,
  Assertion,
  B02ExtractedDomainFields,
  DependencyRequest,
  LegalVersion,
  LegalWork,
  Passage,
  ProfileInput,
  ProfileResult,
  StatementRole,
  UnresolvedReferenceRecord,
} from "../contracts";

function addDaysIso(isoDate: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const THAI_WORD_NUMBERS: Record<string, number> = {
  สามสิบ: 30,
  สี่สิบห้า: 45,
  หกสิบ: 60,
  เก้าสิบ: 90,
  หนึ่งร้อยยี่สิบ: 120,
  ร้อยยี่สิบ: 120,
  หนึ่งร้อยแปดสิบ: 180,
  ร้อยแปดสิบ: 180,
  สองร้อยสี่สิบ: 240,
  สามร้อยหกสิบ: 360,
  หนึ่งปี: 365,
};

export function classifyB02InstrumentAndStatus(
  titleTh: string,
  fullText: string,
  folderHint: string,
  fileNameHint: string
): {
  instrumentType: B02ExtractedDomainFields["instrument_type"];
  entityType: KnowledgeEntityType;
  draftStatus: B02ExtractedDomainFields["draft_or_enacted_status"];
  isConsolidatedDerived: boolean;
  issuerId: string;
} {
  const combined = `${titleTh}\n${fileNameHint}\n${fullText.slice(0, 1600)}`;
  const lowerFn = fileNameHint.toLowerCase();

  const isConsolidated =
    /consolidated|ฉบับประมวล|รวบรวมข้อมูล|ประมวลข้อมูล/.test(combined) ||
    lowerFn.includes("_consolidated") ||
    lowerFn.includes("consolidated");

  const isUnofficialTranslation =
    /_en\.pdf$/i.test(fileNameHint) ||
    /acttranslation_en|english translation|unofficial translation/i.test(combined);

  // Detect Parliamentary bills / Section 77 consultation drafts / Senate bill analyses (B02-U06)
  if (
    /^ร่าง\s*(?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง)/.test(titleTh.trim()) ||
    /draft-with-rationale|accepted-bill-with-rationale|^HoR-s77_|^S77-/i.test(fileNameHint) ||
    (/ร่างพระราชบัญญัติ/.test(combined.slice(0, 500)) && folderHint === "Parliament")
  ) {
    return {
      instrumentType: "DRAFT_BILL",
      entityType: "LegalWork",
      draftStatus: "DRAFT_BILL",
      isConsolidatedDerived: false,
      issuerId: "reg.th.parliament",
    };
  }

  if (
    /bill-analysis|committee-report|CommitteeReport|รายงานการวิเคราะห์ร่าง|รายงานของคณะกรรมาธิการ/i.test(
      `${titleTh} ${fileNameHint}`
    )
  ) {
    return {
      instrumentType: "LEGISLATIVE_COMMITTEE_REPORT",
      entityType: "LegalWork",
      draftStatus: "LEGISLATIVE_HISTORY",
      isConsolidatedDerived: false,
      issuerId: "reg.th.parliament",
    };
  }

  if (/คู่มือ|Guidance|คำชี้แจง/i.test(`${titleTh} ${fileNameHint}`)) {
    const issuer = inferB02IssuerId(titleTh, fullText, folderHint);
    return {
      instrumentType: "GUIDANCE_OR_COMPENDIUM",
      entityType: "SubordinateLegislation",
      draftStatus: isUnofficialTranslation ? "UNOFFICIAL_TRANSLATION" : "CONSOLIDATED_DERIVED",
      isConsolidatedDerived: true,
      issuerId: issuer,
    };
  }

  let instrumentType: B02ExtractedDomainFields["instrumentType" extends never ? never : "instrument_type"] =
    "ACT";
  let entityType: KnowledgeEntityType = "Statute";

  if (/ประมวลรัษฎากร|ประมวลกฎหมาย/.test(titleTh) || folderHint.endsWith("/Codes")) {
    instrumentType = "CODE";
    entityType = "Statute";
  } else if (
    /พระราชบัญญัติประกอบรัฐธรรมนูญ|Organic_Act/i.test(`${titleTh} ${fileNameHint}`) ||
    folderHint.endsWith("/Organic Acts")
  ) {
    instrumentType = "ORGANIC_ACT";
    entityType = "Statute";
  } else if (
    /พระราชกำหนด|EmergencyDecree|Emergency_Decree/i.test(`${titleTh} ${fileNameHint}`) ||
    folderHint.endsWith("/Emergency Decrees")
  ) {
    instrumentType = "EMERGENCY_DECREE";
    entityType = "Statute";
  } else if (
    /พระราชกฤษฎีกา|RoyalDecree|Royal_Decree|Royal Decree|_RD_/i.test(`${titleTh} ${fileNameHint}`) ||
    folderHint.endsWith("/Royal Decrees")
  ) {
    instrumentType = "ROYAL_DECREE";
    entityType = "SubordinateLegislation";
  } else if (/กฎกระทรวง|MinisterialRegulation|MinReg|_MR_/i.test(`${titleTh} ${fileNameHint}`)) {
    instrumentType = "MINISTERIAL_REGULATION";
    entityType = "SubordinateLegislation";
  } else if (
    /ประกาศ|Notification|DGNotif|MOFNotif|RDNotif|EDNotif/i.test(`${titleTh} ${fileNameHint}`)
  ) {
    instrumentType = "NOTIFICATION";
    entityType = "SubordinateLegislation";
  } else if (
    /คำสั่ง|ระเบียบ|ข้อบังคับ|Order|RDOrder|EDReg|Rules-of-Procedure|Regulation/i.test(
      `${titleTh} ${fileNameHint}`
    ) &&
    !/พระราชบัญญัติ/.test(titleTh)
  ) {
    instrumentType = "ORDER_OR_REGULATION";
    entityType = "SubordinateLegislation";
  } else {
    instrumentType = "ACT";
    entityType = "Statute";
  }

  const isAmending = /แก้ไขเพิ่มเติม|\(ฉบับที่\s*[0-9๐-๙]+\)/.test(titleTh);
  const draftStatus: B02ExtractedDomainFields["draft_or_enacted_status"] = isUnofficialTranslation
    ? "UNOFFICIAL_TRANSLATION"
    : isConsolidated
      ? "CONSOLIDATED_DERIVED"
      : isAmending
        ? "ENACTED_AMENDMENT"
        : "ENACTED_ORIGINAL";

  return {
    instrumentType,
    entityType,
    draftStatus,
    isConsolidatedDerived: isConsolidated,
    issuerId: inferB02IssuerId(titleTh, fullText, folderHint, entityType),
  };
}

export function inferB02IssuerId(
  titleTh: string,
  fullText: string,
  folderHint: string,
  entityType?: KnowledgeEntityType
): string {
  const probe = `${titleTh}\n${fullText.slice(0, 900)}`;
  if (/อธิบดีกรมสรรพากร|คำสั่งกรมสรรพากร|ประกาศกรมสรรพากร/.test(probe)) return "reg.th.rd";
  if (/กรมศุลกากร|อธิบดีกรมศุลกากร/.test(probe) || folderHint.includes("Customs")) {
    if (entityType === "Statute") return "reg.th.parliament";
    if (/กฎกระทรวง|ประกาศกระทรวงการคลัง/.test(titleTh)) return "reg.th.mof";
    return "reg.th.customs";
  }
  if (/กรมสรรพสามิต|อธิบดีกรมสรรพสามิต/.test(probe) || folderHint.includes("Excise")) {
    if (entityType === "Statute") return "reg.th.parliament";
    if (/กฎกระทรวง|ประกาศกระทรวงการคลัง/.test(titleTh)) return "reg.th.mof";
    return "reg.th.excise";
  }
  if (/กฎกระทรวง.*ประมวลรัษฎากร|ประกาศกระทรวงการคลัง|รัฐมนตรีว่าการกระทรวงการคลัง/.test(probe)) {
    return "reg.th.mof";
  }
  if (/คณะกรรมการกฤษฎีกา|สำนักงานคณะกรรมการกฤษฎีกา/.test(probe) || folderHint.includes("Council of State")) {
    return entityType === "Statute" ? "reg.th.parliament" : "reg.th.ocs";
  }
  if (/สำนักนายกรัฐมนตรี/.test(probe)) return "reg.th.opm";
  if (/กระทรวงมหาดไทย/.test(probe)) return "reg.th.moi";
  if (/พระราชกฤษฎีกา/.test(titleTh)) return "reg.th.cabinet";
  if (folderHint.startsWith("RD/")) {
    return entityType === "Statute" ? "reg.th.parliament" : "reg.th.rd";
  }
  return "reg.th.parliament";
}

export function resolveCanonicalB02WorkId(params: {
  titleTh: string;
  fullText: string;
  folderHint: string;
  fileNameHint: string;
  entityType: KnowledgeEntityType;
  issuerId: string;
  publicationYearCe: string | null;
  accessScope: string;
  fallbackId?: string;
}): string {
  const normTitle = thaiDigitsToArabic(`${params.titleTh} ${params.fileNameHint}`);
  const normBodyHead = thaiDigitsToArabic(params.fullText.slice(0, 1200));

  // 1. Exact alignment with B01 dependency keys so B02 upgrades B01 stubs cleanly in place (B02-U09, B02-U10, AT18)!
  if (
    /^ประมวลรัษฎากร$/.test(params.titleTh.trim()) ||
    /พระราชบัญญัติให้ใช้บทบัญญัติแห่งประมวลรัษฎากร/.test(normTitle)
  ) {
    return "statute.th.revenue_code";
  }

  // Detect explicit non-Revenue-Code parent statutes so RD/CIT or RD/* folder hints never misroute
  // Petroleum Income Tax, Signboard Tax, Inheritance Tax, Export Tax Compensation, or Top-Up Tax instruments
  // onto `subreg.th.rc.*` canonical IDs!
  const probeParentStatute = `${normTitle} ${normBodyHead}`;
  const isPetroleumIncomeTax = /ภาษีเงินได้ปิโตรเลียม|Petroleum\s*Income\s*Tax/i.test(probeParentStatute);
  const isSignboardTax = /ภาษีป้าย|Signboard\s*Tax/i.test(probeParentStatute);
  const isInheritanceTax = /ภาษีการรับมรดก/i.test(probeParentStatute);
  const isExportTaxComp = /ชดเชยค่าภาษีอากรสินค้าส่งออก/i.test(probeParentStatute);
  const isTopUpTax = /ภาษีส่วนเพิ่ม\s*พ\.ศ\.\s*2567/i.test(probeParentStatute);
  const isOutboundTravelTax = /ภาษีการเดินทางออกนอกราชอาณาจักร/i.test(probeParentStatute);
  const hasExplicitNonRcParent =
    isPetroleumIncomeTax ||
    isSignboardTax ||
    isInheritanceTax ||
    isExportTaxComp ||
    isTopUpTax ||
    isOutboundTravelTax;

  // Law-scoped canonical IDs for Petroleum Income Tax & Signboard Tax subordinate regulations
  if (/พระราชกฤษฎีกา|RoyalDecree|Royal-Decree|_RD_/i.test(normTitle) && isPetroleumIncomeTax) {
    const rdNum =
      normTitle.match(/\(ฉบับที่\s*([0-9]+)\)/)?.[1] ||
      params.fileNameHint.match(/(?:_RD_|RoyalDecree_|Royal-Decree_)([0-9]{1,4})(?:_|\b)/i)?.[1];
    if (rdNum) {
      return `subreg.th.petroleum_tax.royal_decree.${rdNum}`;
    }
  }
  if (/กฎกระทรวง|_MR_|MinReg/i.test(normTitle) && isPetroleumIncomeTax) {
    const mrNum =
      normTitle.match(/ฉบับที่\s*([0-9]+)/)?.[1] ||
      normBodyHead.match(/กฎกระทรวง\s*ฉบับที่\s*([0-9]+)/)?.[1] ||
      params.fileNameHint.match(/(?:_MR_|MinReg_)([0-9]{1,4})(?:_|\b)/i)?.[1];
    if (mrNum) {
      return `subreg.th.petroleum_tax.min_reg.${mrNum}`;
    }
  }
  if (/กฎกระทรวง|_MR_|MinReg/i.test(normTitle) && isSignboardTax) {
    const mrNum =
      normTitle.match(/ฉบับที่\s*([0-9]+)/)?.[1] ||
      normBodyHead.match(/กฎกระทรวง\s*ฉบับที่\s*([0-9]+)/)?.[1] ||
      params.fileNameHint.match(/(?:_MR_|MinReg_)([0-9]{1,4})(?:_|\b)/i)?.[1];
    if (mrNum) {
      return `subreg.th.signboard_tax.min_reg.${mrNum}`;
    }
  }

  // Royal Decree under Revenue Code (`พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ... (ฉบับที่ N)`)
  if (
    /พระราชกฤษฎีกา|RoyalDecree|Royal-Decree|_RD_/i.test(normTitle) &&
    !hasExplicitNonRcParent &&
    (/ประมวลรัษฎากร/.test(normTitle) ||
      /ประมวลรัษฎากร/.test(normBodyHead) ||
      (params.folderHint.startsWith("RD/") && params.folderHint !== "RD/General & Other Taxes"))
  ) {
    const rdNum =
      normTitle.match(/\(ฉบับที่\s*([0-9]+)\)/)?.[1] ||
      params.fileNameHint.match(/(?:_RD_|RoyalDecree_|Royal-Decree_)([0-9]{2,4})(?:_|\b)/i)?.[1];
    if (rdNum) {
      return `subreg.th.rc.royal_decree.${rdNum}`;
    }
  }

  // RD Departmental Order (`คำสั่งกรมสรรพากร ที่ ท.ป. X/YYYY` or `ป. X/YYYY`)
  const tpMatch =
    normTitle.match(/ท\.?ป\.?\s*([0-9]+)[/-]([0-9]{4})/) ||
    normBodyHead.match(/คำสั่งกรมสรรพากร\s*ที่\s*ท\.?ป\.?\s*([0-9]+)\/([0-9]{4})/);
  if (tpMatch) {
    return `subreg.th.rd.order_tp.${tpMatch[1]}_${tpMatch[2]}`;
  }
  const pawMatch =
    normTitle.match(/(?:RDOrder_|คำสั่งกรมสรรพากร\s*ที่\s*)ป\.?\s*([0-9]+)[/-]([0-9]{4})/) ||
    normBodyHead.match(/คำสั่งกรมสรรพากร\s*ที่\s*ป\.?\s*([0-9]+)\/([0-9]{4})/);
  if (pawMatch) {
    return `subreg.th.rd.order_p.${pawMatch[1]}_${pawMatch[2]}`;
  }

  // DG VAT Notification (`ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ N)`)
  if (
    (/ภาษีมูลค่าเพิ่ม|VAT/i.test(normTitle) || params.folderHint === "RD/VAT") &&
    /ประกาศอธิบดีกรมสรรพากร|DGNotif|DG-Notice-VAT/i.test(`${normTitle} ${normBodyHead}`)
  ) {
    const vatNum =
      normTitle.match(/ฉบับที่\s*([0-9]+)/)?.[1] ||
      normBodyHead.match(/เกี่ยวกับภาษีมูลค่าเพิ่ม\s*\(ฉบับที่\s*([0-9]+)\)/)?.[1] ||
      params.fileNameHint.match(/(?:DGNotif|DG-Notice-VAT)_([0-9]+)_/i)?.[1];
    if (vatNum) {
      return `subreg.th.rd.dg_vat.${vatNum}`;
    }
  }

  // Ministerial Regulation under Revenue Code (`กฎกระทรวง ฉบับที่ N (...) ออกตามความในประมวลรัษฎากร`)
  if (
    /กฎกระทรวง|_MR_|MinReg/i.test(normTitle) &&
    !hasExplicitNonRcParent &&
    (/ประมวลรัษฎากร/.test(normTitle) ||
      /ประมวลรัษฎากร/.test(normBodyHead) ||
      (params.folderHint.startsWith("RD/") && params.folderHint !== "RD/General & Other Taxes"))
  ) {
    const mrNum =
      normTitle.match(/ฉบับที่\s*([0-9]+)/)?.[1] ||
      normBodyHead.match(/กฎกระทรวง\s*ฉบับที่\s*([0-9]+)/)?.[1] ||
      params.fileNameHint.match(/(?:_MR_|MinReg_)([0-9]{1,4})(?:_|\b)/i)?.[1];
    if (mrNum) {
      return `subreg.th.rc.min_reg.${mrNum}`;
    }
  }

  // Well-known core B02 primary statutes
  if (/^พระราชบัญญัติศุลกากร\s*พ\.ศ\.\s*2560/.test(thaiDigitsToArabic(params.titleTh.trim())) || /CustomsAct2560_TH/i.test(params.fileNameHint)) {
    return "statute.th.customs_act_2560";
  }
  if (/^พระราชบัญญัติภาษีสรรพสามิต\s*พ\.ศ\.\s*2560/.test(thaiDigitsToArabic(params.titleTh.trim())) || /Excise-Tax-Act-main/i.test(params.fileNameHint)) {
    return "statute.th.excise_tax_act_2560";
  }
  if (/พระราชกำหนดภาษีส่วนเพิ่ม\s*พ\.ศ\.\s*2567/.test(normTitle)) {
    return "statute.th.top_up_tax_2567";
  }
  const rcAmendMatch = normTitle.match(/พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร\s*\(ฉบับที่\s*([0-9]+)\)/);
  if (rcAmendMatch) {
    return `statute.th.rc_amendment_act.${rcAmendMatch[1]}`;
  }

  if (params.fallbackId && !params.fallbackId.startsWith("work.")) {
    return params.fallbackId;
  }

  return buildDeterministicWorkId({
    doc_type: params.entityType,
    issuer_id: params.issuerId,
    normalized_identifier: thaiDigitsToArabic(params.titleTh || params.fileNameHint),
    issue_year_ce: params.publicationYearCe,
    access_scope: params.accessScope,
  });
}

export function extractPublicationAndCommencement(
  fullText: string,
  metaDateHint?: string | null
): {
  gazetteRef: string | null;
  publicationDateIso: string | null;
  commencementDateIso: string | null;
  commencementNote: string | null;
  transitionConditions: string[];
  dateUnknownRestricted: boolean;
} {
  const norm = thaiDigitsToArabic(fullText);

  // 1. Royal Gazette header (`เล่ม 134 ตอนที่ 53 ก ราชกิจจานุเบกษา 17 พฤษภาคม 2560`, including PDF-split `เลม` where tone mark `่` sits on the preceding page line)
  const gazMatch = norm.match(
    /เล่?ม\s*[0-9]+\s*ตอน(?:พิเศษ)?(?:ที่)?\s*[0-9]+\s*[กงขค]?\s*ราชกิจจานุเบกษา\s*([0-9]{1,2}\s+[^\s\d]{2,15}\s+[0-9]{4})/
  );
  const gazRefMatch = norm.match(
    /เล่?ม\s*[0-9]+\s*ตอน(?:พิเศษ)?(?:ที่)?\s*[0-9]+\s*[กงขค]?\s*ราชกิจจานุเบกษา/
  );
  const gazetteRef = gazRefMatch
    ? gazRefMatch[0].replace(/^เลม(?=\s)/, "เล่ม").replace(/\s+/g, " ").trim()
    : null;

  let publicationDateIso: string | null = null;
  if (gazMatch?.[1]) {
    publicationDateIso = parseThaiBuddhistDateToIso(gazMatch[1]);
  }
  if (!publicationDateIso && metaDateHint) {
    publicationDateIso = parseThaiBuddhistDateToIso(metaDateHint);
  }
  if (!publicationDateIso) {
    const givenMatch = norm.match(
      /(?:ให้ไว้\s*ณ\s*วันที่|ประกาศ\s*ณ\s*วันที่|สั่ง\s*ณ\s*วันที่)\s*([0-9]{1,2}\s+[^\s\d]{2,15}\s+(?:พ\.ศ\.\s*)?[0-9]{4})/
    );
    if (givenMatch?.[1]) {
      publicationDateIso = parseThaiBuddhistDateToIso(givenMatch[1]);
    }
  }

  // 2. Statutory commencement clause (`ให้ใช้บังคับตั้งแต่...`)
  let commencementDateIso: string | null = null;
  let commencementNote: string | null = null;

  const explicitDateClause = norm.match(
    /ให้ใช้บังคับตั้งแต่วันที่\s*([0-9]{1,2}\s+[^\s\d]{2,15}\s+(?:พ\.ศ\.\s*)?[0-9]{4})/
  );
  const nextDayClause = norm.match(
    /ให้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษา\s*เป็นต้นไป/
  );
  const afterDaysNumeric = norm.match(
    /ให้ใช้บังคับเมื่อพ้นกำหนด\s*([0-9]+)\s*วัน\s*นับแต่วันประกาศในราชกิจจานุเบกษา/
  );
  const afterDaysWord = norm.match(
    /ให้ใช้บังคับเมื่อพ้นกำหนด(สามสิบ|สี่สิบห้า|หกสิบ|เก้าสิบ|หนึ่งร้อยยี่สิบ|ร้อยยี่สิบ|หนึ่งร้อยแปดสิบ|ร้อยแปดสิบ|สองร้อยสี่สิบ|สามร้อยหกสิบ|หนึ่งปี)(?:วัน)?นับแต่วันประกาศในราชกิจจานุเบกษา/
  );
  const onPubDayClause = norm.match(
    /ให้ใช้บังคับตั้งแต่วันประกาศในราชกิจจานุเบกษา\s*เป็นต้นไป/
  );

  if (explicitDateClause?.[1]) {
    commencementDateIso = parseThaiBuddhistDateToIso(explicitDateClause[1]);
    commencementNote = explicitDateClause[0].replace(/\s+/g, " ").trim();
  } else if (nextDayClause && publicationDateIso) {
    commencementDateIso = addDaysIso(publicationDateIso, 1);
    commencementNote = "ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป";
  } else if (afterDaysNumeric && publicationDateIso) {
    const days = Number(afterDaysNumeric[1]);
    commencementDateIso = addDaysIso(publicationDateIso, days);
    commencementNote = `ใช้บังคับเมื่อพ้นกำหนด ${days} วันนับแต่วันประกาศในราชกิจจานุเบกษา`;
  } else if (afterDaysWord && publicationDateIso) {
    const days = THAI_WORD_NUMBERS[afterDaysWord[1]] || 90;
    commencementDateIso = addDaysIso(publicationDateIso, days);
    commencementNote = `ใช้บังคับเมื่อพ้นกำหนด${afterDaysWord[1]}วันนับแต่วันประกาศในราชกิจจานุเบกษา (${days} วัน)`;
  } else if (onPubDayClause && publicationDateIso) {
    commencementDateIso = publicationDateIso;
    commencementNote = "ใช้บังคับตั้งแต่วันประกาศในราชกิจจานุเบกษาเป็นต้นไป";
  } else if (nextDayClause) {
    commencementNote = "ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป";
  }

  // 3. Transitional / accounting-period rules (`บทเฉพาะกาล`, `รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่...`, `เงินได้พึงประเมินประจำปีภาษี...`)
  const transitionConditions: string[] = [];
  const transRegexes = [
    /(?:สำหรับรอบระยะเวลาบัญชีที่(?:เริ่มในหรือหลังวันที่|ได้รับ[^\s\n]{2,40})|สำหรับเงินได้พึงประเมินประจำปีภาษี|ทั้งนี้\s*เฉพาะ(?:รายรับที่ได้รับ|ตราสารที่ได้กระทำ)ตั้งแต่วันที่|บรรดาคำขอ|ในวาระเริ่มแรก|บทบัญญัติแห่ง[^\s]{3,40}ซึ่งถูกยกเลิกโดย)[^。\n]{8,240}/g,
    /บทเฉพาะกาล[\s\S]{0,360}/g,
  ];
  for (const rgx of transRegexes) {
    for (const m of norm.match(rgx) || []) {
      const cleaned = m.replace(/\s+/g, " ").trim();
      if (cleaned.length >= 15 && transitionConditions.length < 5) {
        transitionConditions.push(cleaned.slice(0, 260));
      }
    }
  }

  const dateUnknownRestricted = !publicationDateIso && !commencementDateIso;

  return {
    gazetteRef,
    publicationDateIso,
    commencementDateIso,
    commencementNote,
    transitionConditions: [...new Set(transitionConditions)],
    dateUnknownRestricted,
  };
}

export function extractEnablingAndAmendmentLinks(
  titleTh: string,
  fullText: string
): {
  enablingCitation: string | null;
  enablingWorkId: string | null;
  amendmentTargets: Array<{ raw: string; targetWorkId: string; targetType: KnowledgeEntityType }>;
  repealTargets: Array<{ raw: string; targetWorkId: string; targetType: KnowledgeEntityType }>;
  definitions: Array<{ term_th: string; definition_text: string }>;
  schedulesAndFootnotes: string[];
} {
  const norm = thaiDigitsToArabic(`${titleTh}\n${fullText}`);
  // Collapse soft line-wraps within paragraphs while preserving clause boundaries (`ข้อ N`, `มาตรา N`, `;`)
  // so multi-line Gazette citations like `ให้ยกเลิกกฎกระทรวง ฉบับที่ 5 (พ.ศ. 2535)\nออกตามความในพระราชบัญญัติภาษีป้าย พ.ศ. 2510`
  // are never truncated mid-title at `\n`.
  const normUnwrapped = norm
    .replace(/\r/g, "")
    .replace(/\n(?=\s*(?:ข้อ|มาตรา)\s*[0-9]+\b)/g, " ; ")
    .replace(/([\u0E00-\u0E7F])\s*\n\s*([\u0E00-\u0E7F])/g, "$1$2")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ");

  // 1. Enabling law (`MADE_UNDER`): `อาศัยอำนาจตามความในมาตรา ... แห่งพระราชบัญญัติ...` or `ออกตามความในประมวลรัษฎากร`
  let enablingCitation: string | null = null;
  let enablingWorkId: string | null = null;

  const madeUnderMatch = normUnwrapped.match(
    /อาศัยอำนาจตามความใน\s*(มาตรา\s*[0-9]+[^;]{0,140}?แห่ง(?:พระราชบัญญัติ|พระราชกำหนด|ประมวลรัษฎากร)[^;(]{0,90}?(?:พ\.ศ\.\s*[0-9]{4})?)(?=\s*(?:ซึ่งแก้ไข|รัฐมนตรี|อธิบดี|คณะรัฐมนตรี|จึงทรง|ออก|;|$))/
  );
  if (madeUnderMatch?.[1]) {
    enablingCitation = madeUnderMatch[1].replace(/\s+/g, " ").trim();
  } else if (/ออกตามความในประมวลรัษฎากร/.test(normUnwrapped)) {
    enablingCitation = "ประมวลรัษฎากร";
  } else if (/ตามความใน.*แห่งพระราชกำหนดภาษีส่วนเพิ่ม\s*พ\.ศ\.\s*2567/.test(normUnwrapped)) {
    enablingCitation = "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. 2567";
  }

  if (enablingCitation) {
    if (/ประมวลรัษฎากร/.test(enablingCitation)) {
      enablingWorkId = "statute.th.revenue_code";
    } else if (/พระราชบัญญัติศุลกากร\s*พ\.ศ\.\s*2560/.test(enablingCitation)) {
      enablingWorkId = "statute.th.customs_act_2560";
    } else if (/พระราชบัญญัติภาษีสรรพสามิต\s*พ\.ศ\.\s*2560/.test(enablingCitation)) {
      enablingWorkId = "statute.th.excise_tax_act_2560";
    } else if (/พระราชกำหนดภาษีส่วนเพิ่ม\s*พ\.ศ\.\s*2567/.test(enablingCitation)) {
      enablingWorkId = "statute.th.top_up_tax_2567";
    }
  }

  // 2. Explicit Amendments (`AMENDS`) and Repeals (`REPEALS`)
  const amendmentTargets: Array<{ raw: string; targetWorkId: string; targetType: KnowledgeEntityType }> = [];
  const repealTargets: Array<{ raw: string; targetWorkId: string; targetType: KnowledgeEntityType }> = [];

  if (/แก้ไขเพิ่มเติมประมวลรัษฎากร/.test(norm)) {
    amendmentTargets.push({
      raw: "ประมวลรัษฎากร",
      targetWorkId: "statute.th.revenue_code",
      targetType: "Statute",
    });
    // Check specific Revenue Code sections amended (`ให้ยกเลิกความในมาตรา X แห่งประมวลรัษฎากร และให้ใช้ความต่อไปนี้แทน` / `ให้เพิ่มความต่อไปนี้เป็นมาตรา X`)
    const rcSecAmends =
      norm.match(
        /ให้(?:ยกเลิกความใน|เพิ่มความต่อไปนี้เป็น)\s*(มาตรา\s*[0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?)\s*แห่งประมวลรัษฎากร/g
      ) || [];
    for (const m of rcSecAmends.slice(0, 8)) {
      const secM = m.match(/มาตรา\s*([0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?)/);
      if (secM?.[1]) {
        const secSlug = secM[1].trim().replace(/\s+/g, "_");
        amendmentTargets.push({
          raw: `ประมวลรัษฎากร มาตรา ${secM[1].trim()}`,
          targetWorkId: `prov.th.rc.${secSlug}`,
          targetType: "Provision",
        });
      }
    }
  }

  // Explicit Repeals (`ให้ยกเลิกพระราชบัญญัติ...` / `ให้ยกเลิกกฎกระทรวง...`)
  // Match against `normUnwrapped` so multi-line Gazette repeal clauses capture the full governing parent statute!
  const repealMatches =
    normUnwrapped.match(
      /ให้ยกเลิก\s*((?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศคณะปฏิวัติ)[^;]{4,150}?(?:พ\.ศ\.\s*[0-9]{4}\)?|ลงวันที่\s*[0-9]{1,2}\s+[^\s]+\s+[0-9]{4}|ออกตามความใน\s*(?:พระราชบัญญัติ|พระราชกำหนด|ประมวลรัษฎากร)(?:[^;]{0,90}?พ\.ศ\.\s*[0-9]{4})?)(?:\s*ออกตามความใน\s*(?:พระราชบัญญัติ|พระราชกำหนด|ประมวลรัษฎากร)(?:[^;]{0,90}?พ\.ศ\.\s*[0-9]{4})?)?)/g
    ) || [];
  for (const rm of repealMatches.slice(0, 6)) {
    const targetRaw = rm.replace(/^ให้ยกเลิก\s*/, "").replace(/\s+/g, " ").trim();
    if (/ความในมาตรา/.test(targetRaw)) continue; // That's a section replacement amendment, not whole-instrument repeal
    const targetId = buildDeterministicWorkId({
      doc_type: /พระราชกฤษฎีกา|กฎกระทรวง/.test(targetRaw) ? "SubordinateLegislation" : "Statute",
      issuer_id: "reg.th.parliament",
      normalized_identifier: targetRaw,
      issue_year_ce: null,
      access_scope: "scope.platform.public",
    });
    repealTargets.push({
      raw: targetRaw,
      targetWorkId: targetId,
      targetType: /พระราชกฤษฎีกา|กฎกระทรวง/.test(targetRaw) ? "SubordinateLegislation" : "Statute",
    });
  }

  // 3. Statutory Definitions (`DEFINES`: `"..." หมายความว่า ...`)
  const definitions: Array<{ term_th: string; definition_text: string }> = [];
  const defMatches =
    norm.match(/[“"]([^”"\n]{2,45})[”"]\s*หมายความ(?:รวมถึง|ว่า)[^\n]{6,220}/g) || [];
  for (const dm of defMatches.slice(0, 8)) {
    const m = dm.match(/[“"]([^”"\n]{2,45})[”"]\s*(หมายความ(?:รวมถึง|ว่า)[\s\S]+)$/);
    if (m) {
      definitions.push({
        term_th: m[1].trim(),
        definition_text: m[2].replace(/\s+/g, " ").trim(),
      });
    }
  }

  // 4. Schedules, Rate Tables & Footnotes (`บัญชีอัตรา...`, `พิกัดอัตรา...`, `หมายเหตุท้ายตาราง`)
  const schedulesAndFootnotes: string[] = [];
  const schedMatches =
    norm.match(/(?:บัญชีอัตรา[^\n]{0,160}|พิกัดอัตรา[^\n]{0,160}|หมายเหตุ\s*:-?[^\n]{5,220})/g) || [];
  for (const sm of schedMatches.slice(0, 6)) {
    schedulesAndFootnotes.push(sm.replace(/\s+/g, " ").trim());
  }

  return {
    enablingCitation,
    enablingWorkId,
    amendmentTargets,
    repealTargets,
    definitions,
    schedulesAndFootnotes,
  };
}

interface ExtractedSectionUnit {
  sectionLabel: string;
  sectionSlug: string;
  bodyText: string;
  physicalPageIndex: number;
}

function splitIntoStatutorySections(
  fullText: string,
  pagesSample?: Array<{ p: number; t: string }>
): ExtractedSectionUnit[] {
  const norm = thaiDigitsToArabic(fullText);
  const units: ExtractedSectionUnit[] = [];

  // Map character offset or snippet to physical page index when pagesSample is provided
  const inferPageIdx = (snippet: string): number => {
    if (!pagesSample || pagesSample.length === 0) return 0;
    const probe = thaiDigitsToArabic(snippet.slice(0, 48)).trim();
    for (const pg of pagesSample) {
      if (probe && thaiDigitsToArabic(pg.t).includes(probe)) {
        return pg.p;
      }
    }
    return pagesSample[0].p || 0;
  };

  // Match `มาตรา N` or `ข้อ N` boundaries
  const markerRegex =
    /(?:^|\n|\s{2,})((?:มาตรา|ข้อ)\s*[0-9]+(?:\/[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว))?)\s+/g;
  const matches: Array<{ label: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(norm)) !== null) {
    const label = normalizeThaiLegalSectionRef(m[1]);
    matches.push({ label, index: m.index });
    if (matches.length >= 24) break;
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(norm.length, start + 1400);
    const body = norm.slice(start, end).replace(/\s+/g, " ").trim();
    if (body.length < 15) continue;
    const slug = matches[i].label
      .replace(/^(?:มาตรา|ข้อ)\s*/, "")
      .trim()
      .replace(/\s+/g, "_");
    units.push({
      sectionLabel: matches[i].label,
      sectionSlug: slug,
      bodyText: body.slice(0, 1400),
      physicalPageIndex: inferPageIdx(body),
    });
  }

  return units;
}

/**
 * Mandatory B02 Extraction Profile (`extractB02`).
 * Returns canonical instrument work/version, child structural `Provision` works and dated
 * `ProvisionVersion` versions, contextualized passages, typed assertions (`ISSUED_BY`,
 * `MADE_UNDER`, `AMENDS`, `REPEALS`, `DEFINES`, `CONTAINS`, `HAS_VERSION`), and review reasons.
 */
export async function extractB02(input: ProfileInput): Promise<ProfileResult> {
  const meta = (input.source_metadata || {}) as {
    title_th?: string;
    folder?: string;
    file_name?: string;
    rel_path?: string;
    date_hint?: string;
    page_count?: number;
    pages_sample?: Array<{ p: number; t: string }>;
    legacy_id?: string;
    is_ocr_verified?: boolean;
  };

  const fullText = (input.extraction.normalized_text || input.extraction.raw_text || "").trim();
  const folderHint = meta.folder || "";
  const fileNameHint = meta.file_name || meta.rel_path || "";
  const rawTitle =
    (meta.title_th || "").trim() ||
    fullText.split("\n")[0]?.slice(0, 180).trim() ||
    fileNameHint ||
    "ตราสารกฎหมายไทย";

  const cls = classifyB02InstrumentAndStatus(rawTitle, fullText, folderHint, fileNameHint);
  const temporal = extractPublicationAndCommencement(fullText, meta.date_hint);
  const links = extractEnablingAndAmendmentLinks(rawTitle, fullText);

  const yearBeMatch = thaiDigitsToArabic(`${rawTitle} ${fullText.slice(0, 500)}`).match(
    /พ\.ศ\.\s*(2[345][0-9]{2})/
  );
  const yearBe = yearBeMatch ? yearBeMatch[1] : null;
  const pubYearCe =
    temporal.publicationDateIso?.slice(0, 4) ||
    (yearBe ? String(Number(yearBe) - 543) : null);

  const workId = resolveCanonicalB02WorkId({
    titleTh: rawTitle,
    fullText,
    folderHint,
    fileNameHint,
    entityType: cls.entityType,
    issuerId: cls.issuerId,
    publicationYearCe: pubYearCe,
    accessScope: input.access_scope,
    fallbackId: input.candidate_work_id,
  });

  const versionId =
    input.candidate_version_id || `ver.${workId.replace(/^(?:work\.|statute\.|subreg\.)/, "")}.v1`;

  const numberCodeMatch = thaiDigitsToArabic(rawTitle).match(
    /(?:ฉบับที่\s*([0-9]+)|ที่\s*([ก-ฮ.]*\s*[0-9]+\/[0-9]{4}))/
  );
  const numberCode = numberCodeMatch ? (numberCodeMatch[1] || numberCodeMatch[2]).trim() : null;

  const isNonEnactedDraft =
    cls.draftStatus === "DRAFT_BILL" || cls.draftStatus === "LEGISLATIVE_HISTORY";
  const statementRole: StatementRole = isNonEnactedDraft ? "secondary_commentary" : "statutory_text";

  const applicability: ApplicabilityInterval[] = isNonEnactedDraft
    ? [
        {
          valid_from: null,
          valid_to: null,
          conditions: [
            "สถานะร่างกฎหมายหรือเอกสารประกอบการพิจารณานิติบัญญัติ ยังไม่ได้ตราขึ้นใช้บังคับเป็นกฎหมาย",
          ],
          date_status: "unknown_restricted",
        },
      ]
    : [
        {
          valid_from: temporal.commencementDateIso || temporal.publicationDateIso,
          valid_to: null,
          conditions: [
            ...(temporal.commencementNote ? [temporal.commencementNote] : []),
            ...temporal.transitionConditions.slice(0, 2),
          ],
          date_status: temporal.dateUnknownRestricted
            ? "unknown_restricted"
            : temporal.transitionConditions.length > 0
              ? "transitional"
              : "verified",
        },
      ];

  const officialIds: LegalWork["official_identifiers"] = [
    {
      raw: rawTitle,
      normalized: thaiDigitsToArabic(rawTitle).replace(/\s+/g, " ").trim(),
      kind: cls.instrumentType === "ROYAL_DECREE" ? "royal_decree_no" : "statute_code",
    },
  ];
  if (numberCode) {
    officialIds.push({
      raw: numberCode,
      normalized: numberCode,
      kind: cls.instrumentType === "ROYAL_DECREE" ? "royal_decree_no" : "statute_code",
    });
  }

  const work: LegalWork = {
    work_id: workId,
    type: cls.entityType,
    issuer_id: cls.issuerId,
    jurisdiction: "TH",
    title_th: rawTitle,
    official_identifiers: officialIds,
    identity_evidence: [input.artifact.artifact_id],
    aliases: [meta.legacy_id, fileNameHint, thaiDigitsToArabic(rawTitle)].filter(
      (x): x is string => Boolean(x)
    ),
    owner_batch_id: "B02",
    first_loaded_by_batch_id: "B02",
    instrument_code: numberCode || undefined,
  };

  const version: LegalVersion = {
    version_id: versionId,
    work_id: workId,
    version_label: cls.isConsolidatedDerived
      ? "v1_consolidated_derived"
      : isNonEnactedDraft
        ? "v1_legislative_draft"
        : "v1",
    legal_applicability: applicability,
    publication_date: temporal.publicationDateIso,
    decision_date: null,
    raw_date_text:
      temporal.commencementNote && temporal.publicationDateIso
        ? `ประกาศราชกิจจานุเบกษา ${temporal.publicationDateIso} (${temporal.commencementNote})`
        : temporal.publicationDateIso,
    temporal_evidence_ids: [input.artifact.artifact_id],
    known_from: input.extraction.created_at,
    known_to: null,
    is_consolidated_derived: cls.isConsolidatedDerived,
    draft_or_enacted_status: cls.draftStatus,
    access_scope: input.access_scope,
  };

  const isPdf = input.artifact.MIME === "application/pdf";
  const headerPrefix = isNonEnactedDraft
    ? `[สถานะ: ร่างกฎหมาย/เอกสารนิติบัญญัติ — ยังไม่มีผลใช้บังคับเป็นกฎหมาย] ${rawTitle}`
    : cls.isConsolidatedDerived
      ? `[ฉบับประมวลข้อมูล (Derived Consolidation)] ${rawTitle}`
      : rawTitle;

  const passages: Passage[] = [];
  const childWorks: LegalWork[] = [];
  const childVersions: LegalVersion[] = [];
  const assertions: Assertion[] = [];
  const dependencies: DependencyRequest[] = [];
  const unresolvedRefs: UnresolvedReferenceRecord[] = [];
  const reviewReasons: string[] = [];

  if (temporal.dateUnknownRestricted && !isNonEnactedDraft) {
    reviewReasons.push("PUBLICATION_OR_COMMENCEMENT_DATE_RESTRICTED_UNKNOWN");
  }

  // 1. Instrument overview / preamble / commencement / schedule passage(s)
  const overviewTextParts = [
    rawTitle,
    temporal.gazetteRef ? `อ้างอิงราชกิจจานุเบกษา: ${temporal.gazetteRef}` : "",
    temporal.publicationDateIso ? `วันประกาศในราชกิจจานุเบกษา: ${temporal.publicationDateIso}` : "",
    temporal.commencementDateIso
      ? `วันเริ่มใช้บังคับ: ${temporal.commencementDateIso}${temporal.commencementNote ? ` (${temporal.commencementNote})` : ""}`
      : temporal.commencementNote || "",
    links.enablingCitation ? `บทอาศัยอำนาจ (กฎหมายแม่บท): ${links.enablingCitation}` : "",
    ...temporal.transitionConditions.map((tc) => `บทเฉพาะกาล/เงื่อนไขการเริ่มใช้บังคับ: ${tc}`),
    ...links.schedulesAndFootnotes.map((sf) => `บัญชีอัตรา/ตาราง/หมายเหตุ: ${sf}`),
    fullText.slice(0, 1800),
  ].filter(Boolean);

  const overviewPassages = chunkThaiLegalDocument({
    work_id: workId,
    version_id: versionId,
    extraction_id: input.extraction.extraction_id,
    release_id: "rel.staged",
    artifact_id: input.artifact.artifact_id,
    origin_uri: input.artifact.origin_uri,
    locator_kind: isPdf ? "pdf_page" : "text_byte_offset",
    physical_page_index: isPdf ? 0 : undefined,
    structural_selector_prefix: "instrument#overview",
    header_label: `${headerPrefix}${temporal.publicationDateIso ? ` | ประกาศ ${temporal.publicationDateIso}` : ""}${temporal.commencementDateIso ? ` | ใช้บังคับ ${temporal.commencementDateIso}` : ""}`,
    structural_path_prefix: [rawTitle, "ภาพรวมและวันใช้บังคับ"],
    raw_text: overviewTextParts.join("\n"),
    statement_role: statementRole,
    access_scope: input.access_scope,
  });
  passages.push(...overviewPassages);

  // 2. Structural Section / Clause (`มาตรา` / `ข้อ`) Decomposition -> `Provision` + `ProvisionVersion` (B02-GR)
  const sectionUnits = isNonEnactedDraft
    ? []
    : splitIntoStatutorySections(fullText, meta.pages_sample);

  const provPrefix =
    workId === "statute.th.revenue_code" || workId.startsWith("statute.th.rc_amendment_act.")
      ? "prov.th.rc"
      : workId === "statute.th.customs_act_2560"
        ? "prov.th.customs_2560"
        : workId === "statute.th.excise_tax_act_2560"
          ? "prov.th.excise_2560"
          : workId === "statute.th.top_up_tax_2567"
            ? "prov.th.top_up_tax_2567"
            : `prov.${sha256Bytes(workId).slice(0, 10)}`;

  for (const unit of sectionUnits.slice(0, 12)) {
    const provWorkId = `${provPrefix}.${unit.sectionSlug}`;
    const provVerSuffix = yearBe ? `v_${yearBe}` : "v1";
    const provVerId = `ver.${provWorkId.replace(/^prov\./, "")}.${provVerSuffix}`;
    const parentLabel =
      provPrefix === "prov.th.rc" ? "ประมวลรัษฎากร" : rawTitle;

    const provWork: LegalWork = {
      work_id: provWorkId,
      type: "Provision",
      issuer_id: cls.issuerId,
      jurisdiction: "TH",
      title_th: `${parentLabel} ${unit.sectionLabel}`,
      official_identifiers: [
        {
          raw: unit.sectionLabel,
          normalized: unit.sectionLabel,
          kind: "section_no",
        },
        {
          raw: `${unit.sectionLabel} แห่ง${parentLabel}`,
          normalized: thaiDigitsToArabic(`${unit.sectionLabel} แห่ง${parentLabel}`),
          kind: "section_no",
        },
      ],
      identity_evidence: [input.artifact.artifact_id],
      aliases: [`${parentLabel} ${unit.sectionLabel}`, `${unit.sectionLabel} แห่ง${parentLabel}`],
      owner_batch_id: "B02",
      first_loaded_by_batch_id: "B02",
    };

    const provVersion: LegalVersion = {
      version_id: provVerId,
      work_id: provWorkId,
      version_label: provVerSuffix,
      legal_applicability: applicability,
      publication_date: temporal.publicationDateIso,
      decision_date: null,
      raw_date_text: version.raw_date_text,
      temporal_evidence_ids: [input.artifact.artifact_id],
      known_from: input.extraction.created_at,
      known_to: null,
      is_consolidated_derived: cls.isConsolidatedDerived,
      draft_or_enacted_status: cls.draftStatus,
      access_scope: input.access_scope,
    };

    childWorks.push(provWork);
    childVersions.push(provVersion);

    const secPsgs = chunkThaiLegalDocument({
      work_id: provWorkId,
      version_id: provVerId,
      extraction_id: input.extraction.extraction_id,
      release_id: "rel.staged",
      artifact_id: input.artifact.artifact_id,
      origin_uri: input.artifact.origin_uri,
      locator_kind: isPdf ? "pdf_page" : "text_byte_offset",
      physical_page_index: isPdf ? unit.physicalPageIndex : undefined,
      structural_selector_prefix: `section#${unit.sectionSlug}`,
      header_label: `${parentLabel} | ${unit.sectionLabel}${yearBe ? ` (พ.ศ. ${yearBe})` : ""}`,
      structural_path_prefix: [parentLabel, unit.sectionLabel],
      raw_text: `${parentLabel} ${unit.sectionLabel}: ${unit.bodyText}`,
      statement_role: "statutory_text",
      access_scope: input.access_scope,
    });
    passages.push(...secPsgs);

    const secEvIds = secPsgs.length > 0 ? [secPsgs[0].passage_id] : [overviewPassages[0].passage_id];

    assertions.push(
      {
        assertion_id: `asrt.${sha256Bytes(`${workId}:CONTAINS:${provWorkId}`).slice(0, 14)}`,
        release_id: "rel.staged",
        subject: workId,
        subject_type: cls.entityType,
        predicate: "CONTAINS",
        object: provWorkId,
        object_type: "Provision",
        qualifications: { conditions: [], exceptions: [] },
        evidence_ids: secEvIds,
        statement_role: "statutory_text",
        state: "PROPOSED",
        review_id: null,
        validity: {
          valid_from: applicability[0]?.valid_from ?? null,
          valid_to: applicability[0]?.valid_to ?? null,
        },
        confidence: 1.0,
        legal_certainty: "settled_statutory",
        scope: input.access_scope,
      },
      {
        assertion_id: `asrt.${sha256Bytes(`${provWorkId}:HAS_VERSION:${provVerId}`).slice(0, 14)}`,
        release_id: "rel.staged",
        subject: provWorkId,
        subject_type: "Provision",
        predicate: "HAS_VERSION",
        object: provVerId,
        object_type: "ProvisionVersion",
        qualifications: { conditions: [], exceptions: [] },
        evidence_ids: secEvIds,
        statement_role: "statutory_text",
        state: "PROPOSED",
        review_id: null,
        validity: {
          valid_from: applicability[0]?.valid_from ?? null,
          valid_to: applicability[0]?.valid_to ?? null,
        },
        confidence: 1.0,
        legal_certainty: "settled_statutory",
        scope: input.access_scope,
      }
    );
  }

  const primaryEvIds = [overviewPassages[0].passage_id];
  const validInterval = {
    valid_from: applicability[0]?.valid_from ?? null,
    valid_to: applicability[0]?.valid_to ?? null,
  };

  // 3. Core Instrument Assertions: `ISSUED_BY`, `HAS_VERSION`, `REPRESENTED_BY`, `SUPPORTED_BY`
  assertions.push(
    {
      assertion_id: `asrt.${sha256Bytes(`${workId}:ISSUED_BY:${cls.issuerId}`).slice(0, 14)}`,
      release_id: "rel.staged",
      subject: workId,
      subject_type: cls.entityType,
      predicate: "ISSUED_BY",
      object: cls.issuerId,
      object_type: "Agency",
      qualifications: { conditions: [], exceptions: [] },
      evidence_ids: primaryEvIds,
      statement_role: statementRole,
      state: "PROPOSED",
      review_id: null,
      validity: validInterval,
      confidence: 1.0,
      legal_certainty: isNonEnactedDraft ? "contested_or_conditional" : "settled_statutory",
      scope: input.access_scope,
    },
    {
      assertion_id: `asrt.${sha256Bytes(`${workId}:HAS_VERSION:${versionId}`).slice(0, 14)}`,
      release_id: "rel.staged",
      subject: workId,
      subject_type: cls.entityType,
      predicate: "HAS_VERSION",
      object: versionId,
      object_type: "LegalVersion",
      qualifications: { conditions: [], exceptions: [] },
      evidence_ids: primaryEvIds,
      statement_role: statementRole,
      state: "PROPOSED",
      review_id: null,
      validity: validInterval,
      confidence: 1.0,
      legal_certainty: isNonEnactedDraft ? "contested_or_conditional" : "settled_statutory",
      scope: input.access_scope,
    },
    {
      assertion_id: `asrt.${sha256Bytes(`${workId}:REPRESENTED_BY:${input.artifact.artifact_id}`).slice(0, 14)}`,
      release_id: "rel.staged",
      subject: workId,
      subject_type: cls.entityType,
      predicate: "REPRESENTED_BY",
      object: input.artifact.artifact_id,
      object_type: "Artifact",
      qualifications: { conditions: [], exceptions: [] },
      evidence_ids: primaryEvIds,
      statement_role: statementRole,
      state: "PROPOSED",
      review_id: null,
      validity: validInterval,
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: input.access_scope,
    },
    {
      assertion_id: `asrt.${sha256Bytes(`${versionId}:SUPPORTED_BY:${primaryEvIds[0]}`).slice(0, 14)}`,
      release_id: "rel.staged",
      subject: versionId,
      subject_type: "LegalVersion",
      predicate: "SUPPORTED_BY",
      object: primaryEvIds[0],
      object_type: "Passage",
      qualifications: { conditions: [], exceptions: [] },
      evidence_ids: primaryEvIds,
      statement_role: statementRole,
      state: "PROPOSED",
      review_id: null,
      validity: validInterval,
      confidence: 1.0,
      legal_certainty: "settled_statutory",
      scope: input.access_scope,
    }
  );

  // 4. `MADE_UNDER` for Subordinate Legislation -> Enabling Statute (kept strictly separate from `ISSUED_BY`! B02-U07)
  if (cls.entityType === "SubordinateLegislation" && links.enablingWorkId && !isNonEnactedDraft) {
    dependencies.push({
      citation_raw: links.enablingCitation || links.enablingWorkId,
      normalized_key: links.enablingWorkId,
      target_type: "Statute",
      instrument_title_th: links.enablingCitation || links.enablingWorkId,
      section_label: null,
      owner_batch_id: "B02",
      first_loaded_by_batch_id: "B02",
      required_by_work_id: workId,
    });
    assertions.push({
      assertion_id: `asrt.${sha256Bytes(`${workId}:MADE_UNDER:${links.enablingWorkId}`).slice(0, 14)}`,
      release_id: "rel.staged",
      subject: workId,
      subject_type: "SubordinateLegislation",
      predicate: "MADE_UNDER",
      object: links.enablingWorkId,
      object_type: "Statute",
      qualifications: {
        conditions: links.enablingCitation ? [links.enablingCitation] : [],
        exceptions: [],
      },
      evidence_ids: primaryEvIds,
      statement_role: "statutory_text",
      state: "PROPOSED",
      review_id: null,
      validity: validInterval,
      confidence: 0.98,
      legal_certainty: "settled_statutory",
      scope: input.access_scope,
    });
  } else if (cls.entityType === "SubordinateLegislation" && links.enablingCitation && !links.enablingWorkId) {
    unresolvedRefs.push({
      unresolved_ref_id: `uref.${sha256Bytes(`${workId}:made_under:${links.enablingCitation}`).slice(0, 14)}`,
      source_work_id: workId,
      source_version_id: versionId,
      source_passage_id: primaryEvIds[0],
      raw_citation_text: links.enablingCitation,
      target_hint: links.enablingCitation,
      governing_instrument: links.enablingCitation,
      quarantine_status: "UNRESOLVED_QUARANTINED",
      usable_as_legal_evidence: false,
      owner_batch_hint: "B02",
      reason: "ENABLING_STATUTE_CITATION_RECORDED_PENDING_CANONICAL_MATCH",
      created_at: input.extraction.created_at,
    });
  }

  // 5. `AMENDS` & `REPEALS` (proposed with substantive review requirement per SH-17)
  if (!isNonEnactedDraft && (cls.entityType === "Statute" || cls.entityType === "SubordinateLegislation")) {
    for (const am of links.amendmentTargets) {
      dependencies.push({
        citation_raw: am.raw,
        normalized_key: am.targetWorkId,
        target_type: am.targetType,
        instrument_title_th: am.raw,
        section_label: am.targetType === "Provision" ? am.raw : null,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B02",
        required_by_work_id: workId,
      });
      assertions.push({
        assertion_id: `asrt.${sha256Bytes(`${workId}:AMENDS:${am.targetWorkId}`).slice(0, 14)}`,
        release_id: "rel.staged",
        subject: workId,
        subject_type: cls.entityType,
        predicate: "AMENDS",
        object: am.targetWorkId,
        object_type: am.targetType,
        qualifications: {
          conditions: temporal.transitionConditions.slice(0, 2),
          exceptions: [],
        },
        evidence_ids: primaryEvIds,
        statement_role: "statutory_text",
        state: "PROPOSED",
        review_id: null,
        validity: validInterval,
        confidence: 0.97,
        legal_certainty: "settled_statutory",
        scope: input.access_scope,
      });
    }

    for (const rp of links.repealTargets) {
      dependencies.push({
        citation_raw: rp.raw,
        normalized_key: rp.targetWorkId,
        target_type: rp.targetType,
        instrument_title_th: rp.raw,
        section_label: null,
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B02",
        required_by_work_id: workId,
      });
      assertions.push({
        assertion_id: `asrt.${sha256Bytes(`${workId}:REPEALS:${rp.targetWorkId}`).slice(0, 14)}`,
        release_id: "rel.staged",
        subject: workId,
        subject_type: cls.entityType,
        predicate: "REPEALS",
        object: rp.targetWorkId,
        object_type: rp.targetType,
        qualifications: {
          conditions: temporal.transitionConditions.slice(0, 2),
          exceptions: [],
        },
        evidence_ids: primaryEvIds,
        statement_role: "statutory_text",
        state: "PROPOSED",
        review_id: null,
        validity: validInterval,
        confidence: 0.97,
        legal_certainty: "settled_statutory",
        scope: input.access_scope,
      });
    }
  }

  // 6. `DEFINES` links for defined terms
  if (!isNonEnactedDraft && (cls.entityType === "Statute" || cls.entityType === "SubordinateLegislation")) {
    for (const def of links.definitions.slice(0, 6)) {
      const termId = `term.th.${sha256Bytes(`${workId}:${def.term_th}`).slice(0, 10)}`;
      assertions.push({
        assertion_id: `asrt.${sha256Bytes(`${workId}:DEFINES:${termId}`).slice(0, 14)}`,
        release_id: "rel.staged",
        subject: workId,
        subject_type: cls.entityType,
        predicate: "DEFINES",
        object: termId,
        object_type: "DefinedTerm",
        qualifications: {
          conditions: [`"${def.term_th}" หมายความว่า ${def.definition_text}`],
          exceptions: [],
        },
        evidence_ids: primaryEvIds,
        statement_role: "statutory_text",
        state: "PROPOSED",
        review_id: null,
        validity: validInterval,
        confidence: 0.96,
        legal_certainty: "settled_statutory",
        scope: input.access_scope,
      });
    }
  }

  // 7. Transition conditions (`HAS_CONDITION`)
  for (let i = 0; i < Math.min(3, temporal.transitionConditions.length); i++) {
    const tc = temporal.transitionConditions[i];
    const condId = `cond.b02.${sha256Bytes(`${versionId}:${tc}`).slice(0, 10)}`;
    assertions.push({
      assertion_id: `asrt.${sha256Bytes(`${versionId}:HAS_CONDITION:${condId}`).slice(0, 14)}`,
      release_id: "rel.staged",
      subject: versionId,
      subject_type: "LegalVersion",
      predicate: "HAS_CONDITION",
      object: condId,
      object_type: "Condition",
      qualifications: {
        conditions: [tc],
        exceptions: [],
      },
      evidence_ids: primaryEvIds,
      statement_role: statementRole,
      state: "PROPOSED",
      review_id: null,
      validity: validInterval,
      confidence: 0.95,
      legal_certainty: "settled_statutory",
      scope: input.access_scope,
    });
  }

  const domainFields: B02ExtractedDomainFields = {
    instrument_type: cls.instrumentType,
    official_name_th: rawTitle,
    year_be: yearBe,
    number_code: numberCode,
    issuing_authority_id: cls.issuerId,
    gazette_ref: temporal.gazetteRef,
    publication_date_iso: temporal.publicationDateIso,
    commencement_date_iso: temporal.commencementDateIso,
    commencement_note: temporal.commencementNote,
    draft_or_enacted_status: cls.draftStatus,
    is_consolidated_derived: cls.isConsolidatedDerived,
    enabling_statute_citation: links.enablingCitation,
    enabling_work_id: links.enablingWorkId,
    amendment_targets: links.amendmentTargets.map((a) => a.raw),
    repeal_targets: links.repealTargets.map((r) => r.raw),
    transition_conditions: temporal.transitionConditions,
    definitions: links.definitions,
    schedules_and_footnotes: links.schedulesAndFootnotes,
    sections_extracted: sectionUnits.map((u) => u.sectionLabel),
    identity_or_date_unknown_restricted: temporal.dateUnknownRestricted,
  };

  return {
    work,
    version,
    child_works: childWorks,
    child_versions: childVersions,
    passages,
    proposed_assertions: assertions,
    dependency_requests: dependencies,
    unresolved_references: unresolvedRefs,
    domain_fields: domainFields,
    review_reasons: reviewReasons,
  };
}
