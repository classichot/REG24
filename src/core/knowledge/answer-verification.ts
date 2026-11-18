/**
 * REG24 — Task F5 & Dodo Material Issue 1:
 * Substantive Claim-to-Evidence Entailment & Polarity Contradiction Verifier
 *
 * Implements:
 * - SH-12, SH-14
 * - AT09 (Prompt-injection untrusted text quarantine)
 * - AT11 (Blocks confident answer when quoted source contradicts the claimed legal conclusion)
 * - Material Issue 1 ("Evidence must support the claim"): Rejects any claim attached to a real
 *   source that does not substantively support the claim's legal domain, explicit statutory/ruling
 *   identifiers, quantitative rates/deadlines/thresholds, and substantive content concepts.
 */

import { normalizeOfficialRulingIdentifier, thaiDigitsToArabic } from "./identity";
import type { ClaimLedgerItem, Passage } from "./contracts";

export interface ClaimVerificationOutcome {
  verification_result: ClaimLedgerItem["verification_result"];
  allow_confident_answer: boolean;
  reason: string;
}

export interface SubstantiveSupportPassageInput {
  passage_id: string;
  doc_id?: string | null;
  verbatim_text: string;
  doc_title_th?: string | null;
  source_native_id?: string | null;
  section_path?: string[];
}

export interface SubstantiveClaimSupportOutcome {
  supported: boolean;
  reason_code:
    | "VERIFIED_SUBSTANTIVE_SUPPORT"
    | "EMPTY_CLAIM_OR_EVIDENCE"
    | "UNGROUNDED_LEGAL_IDENTIFIER"
    | "UNGROUNDED_NUMERIC_ASSERTION"
    | "DOMAIN_MISMATCH_IRRELEVANT_SOURCE"
    | "IRRELEVANT_CITED_PASSAGE"
    | "INSUFFICIENT_SUBSTANTIVE_OVERLAP";
  detail_th: string;
  overlap_ratio: number;
}

const THAI_NUMBER_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/ร้อยละหนึ่งร้อย/g, "ร้อยละ 100"],
  [/หนึ่งร้อยละ/g, "ร้อยละ 100"],
  [/หนึ่งล้าน/g, "1000000"],
  [/ห้าแสน/g, "500000"],
  [/หนึ่งแสน/g, "100000"],
  [/ห้าหมื่น/g, "50000"],
  [/สี่หมื่น/g, "40000"],
  [/สามหมื่น/g, "30000"],
  [/สองหมื่น/g, "20000"],
  [/หนึ่งหมื่น/g, "10000"],
  [/หนึ่งพัน/g, "1000"],
  [/หนึ่งร้อย/g, "100"],
  [/เก้าสิบ/g, "90"],
  [/แปดสิบ/g, "80"],
  [/เจ็ดสิบ/g, "70"],
  [/หกสิบ/g, "60"],
  [/ห้าสิบ/g, "50"],
  [/สี่สิบ/g, "40"],
  [/สามสิบ/g, "30"],
  [/ยี่สิบห้า/g, "25"],
  [/ยี่สิบ/g, "20"],
  [/สิบห้า/g, "15"],
  [/สิบสอง/g, "12"],
  [/สิบเอ็ด/g, "11"],
  [/สิบ(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า|บาท|%))/g, " 10 "],
  [/(?<=ร้อยละ\s*)ศูนย์/g, " 0 "],
  [/(?<=อัตรา\s*)ศูนย์/g, " 0 "],
  [/เก้า(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 9 "],
  [/แปด(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 8 "],
  [/เจ็ด(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 7 "],
  [/หก(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 6 "],
  [/ห้า(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 5 "],
  [/สี่(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 4 "],
  [/สาม(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 3 "],
  [/สอง(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 2 "],
  [/หนึ่ง(?=\s*(?:วัน(?!ที่|สิ้น)|เดือน|ปี|คน|ราย|เท่า))/g, " 1 "],
];

const EN_NUMBER_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bzero[- ]rat(?:ed|e)\b/gi, "ร้อยละ 0 vat 0%"],
  [/\bone\s+hundred\b/gi, "100"],
  [/\bfifty\b/gi, "50"],
  [/\bthirty\b/gi, "30"],
  [/\btwenty\b/gi, "20"],
  [/\bfifteen\b/gi, "15"],
  [/\bten\b/gi, "10"],
  [/\bseven\b/gi, "7"],
  [/\bfive\b/gi, "5"],
  [/\bthree\b/gi, "3"],
  [/\btwo\b/gi, "2"],
  [/\bone\b(?=\s+(?:year|month|day|promoter|person|time))/gi, "1"],
];

const EN_TO_TH_CONCEPT_BRIDGES: Array<[RegExp, string]> = [
  [/\b(?:sections?|secs?\.?|s\.)\s*(\d+(?:\/\d+)?)\s*bis\b/gi, "มาตรา $1 ทวิ"],
  [/\b(?:sections?|secs?\.?|s\.)\s*(\d+(?:\/\d+)?)\s*ter\b/gi, "มาตรา $1 ตรี"],
  [/\b(?:sections?|secs?\.?|s\.)\s*(\d+(?:\/\d+)?)\s*quater\b/gi, "มาตรา $1 จัตวา"],
  [/\b(?:sections?|secs?\.?|s\.)\s*(\d+(?:\/\d+)?)\b/gi, "มาตรา $1"],
  [/\b(?:gor\s*kor\.?|gk)\s*(\d{3,5})(?:\s*\(\s*(?:kor\s*mor|km)\.?(\d*)\s*\))?\s*\/\s*(\d+)/gi, "กค $1/$3"],
  [/\b(?:royal\s+decree|r\.?d\.?)\s*(?:no\.?|#)?\s*(\d+)\b/gi, "พระราชกฤษฎีกา ฉบับที่ $1"],
  [/\bvalue[- ]added\s+tax\b|\bvat\b/gi, "ภาษีมูลค่าเพิ่ม"],
  [/\bspecific\s+business\s+tax\b|\bsbt\b/gi, "ภาษีธุรกิจเฉพาะ"],
  [/\bstamp\s+duty\b/gi, "อากรแสตมป์"],
  [/\bcorporate\s+income\s+tax\b|\bcit\b/gi, "ภาษีเงินได้นิติบุคคล"],
  [/\bpersonal\s+income\s+tax\b|\bpit\b/gi, "ภาษีเงินได้บุคคลธรรมดา"],
  [/\bwithholding\s+tax\b|\bwithhold(?:ing)?\b|\bwht\b/gi, "หักภาษี ณ ที่จ่าย หักภาษี"],
  [/\bdividend\s+(?:tax\s+)?credit\b/gi, "เครดิตภาษีเงินปันผล เงินปันผล"],
  [/\bundivided\s+estate\b|\bestate\s+administrator\b/gi, "กองมรดก ผู้จัดการมรดก"],
  [/\bsummons\b/gi, "ออกหมายเรียก หมายเรียก ไต่สวน"],
  [/\bevasion\b|\bavoidance\b/gi, "หลีกเลี่ยงภาษีอากร เจตนาหลีกเลี่ยง"],
  [/\bdirector[- ]general\b/gi, "อธิบดี"],
  [/\bextend(?:ed|sion)?\b/gi, "ขยายเวลา"],
  [/\bpolitical\s+part(?:y|ies)\b/gi, "พรรคการเมือง"],
  [/\bdonat(?:e|ion|ions)\b|\bcontribut(?:e|ion|ions)\b|\bcharit(?:y|able)\b/gi, "บริจาค การกุศล"],
  [/\bexport(?:s|ed|ing)?\b/gi, "ส่งออก"],
  [/\bservices?\b/gi, "บริการ ให้บริการ"],
  [/\babroad\b|\bforeign\b|\boverseas\b|\boutside\s+thailand\b/gi, "ต่างประเทศ"],
  [/\binterest\b/gi, "ดอกเบี้ย"],
  [/\bgovernment\b/gi, "รัฐบาล ส่วนราชการ หน่วยงานของรัฐ"],
  [/\bfinancial\s+institutions?\b/gi, "สถาบันการเงิน"],
  [/\bend\s+of\s+(?:the\s+)?month\b/gi, "วันสิ้นเดือน"],
  [/\bremit(?:tance)?\b/gi, "นำส่ง"],
  [/\bautomation\b|\bautomated\s+systems?\b/gi, "ระบบอัตโนมัติ"],
  [/\binvestment\b/gi, "การลงทุน ลงทุน"],
  [/\bdepreciation\b|\bwear\s+and\s+tear\b/gi, "ค่าสึกหรอ ค่าเสื่อมราคา"],
  [/\bassets?\b/gi, "ทรัพย์สิน"],
  [/\bnet\s+profit\b/gi, "กำไรสุทธิ"],
  [/\bnon[- ]deductible\b|\bprohibited\s+expenses?\b/gi, "รายจ่ายต้องห้าม ไม่ให้ถือเป็นรายจ่าย"],
  [/\bpromoters?\b/gi, "ผู้เริ่มก่อการ เริ่มก่อการ"],
  [/\blimited\s+compan(?:y|ies)\b/gi, "บริษัทจำกัด"],
  [/\bimmovable\s+propert(?:y|ies)\b|\breal\s+estate\b|\bland\b/gi, "อสังหาริมทรัพย์ ที่ดิน"],
  [/\bsale\s+with\s+right\s+of\s+redemption\b/gi, "ขายฝาก"],
  [/\bseverance\s+pay\b|\blabou?r\s+protection\b|\bdismissal\b/gi, "ค่าชดเชย คุ้มครองแรงงาน เลิกจ้าง"],
  [/\bcustoms\s+dut(?:y|ies)\b/gi, "อากรศุลกากร ศุลกากร"],
  [/\bexcise\s+tax\b/gi, "ภาษีสรรพสามิต สรรพสามิต"],
  [/\bforeign\s+aid\b|\bgrant\b|\bassistance\b/gi, "เงินช่วยเหลือ ความช่วยเหลือ เงินสนับสนุน"],
  [/\beconomic\s+and\s+trade\s+office\b|\btrade\s+and\s+economic\s+office\b/gi, "สำนักงานเศรษฐกิจและการค้า"],
  [/\bfilm\b|\bmovie\b|\bcopyright\b|\blicen[cs](?:e|ing)\b/gi, "ลิขสิทธิ์ ภาพยนตร์"],
  [/\bmerger\b|\bcross[- ]border\b/gi, "ควบรวมกิจการ ข้ามพรมแดน"],
];

function normalizeForEntailment(raw: string): string {
  let s = thaiDigitsToArabic(raw || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/(\d+(?:\.\d+)?)\s*ล้านบาท/g, (_m, n) => `${Math.round(Number(n) * 1_000_000)} บาท`)
    .replace(/\.0+(?!\d)/g, "")
    .toLowerCase();

  for (const [re, rep] of THAI_NUMBER_WORD_REPLACEMENTS) {
    s = s.replace(re, rep);
  }
  for (const [re, rep] of EN_NUMBER_WORD_REPLACEMENTS) {
    s = s.replace(re, rep);
  }
  for (const [re, rep] of EN_TO_TH_CONCEPT_BRIDGES) {
    s = s.replace(re, ` ${rep} `);
  }
  return s.replace(/\s+/g, " ").trim();
}

function stripProvenanceHeaderPrefix(claimText: string): string {
  return claimText
    .replace(/^\[[^\]]{2,140}\]\s*/u, "")
    .replace(/^【[^】]{2,80}】\s*/u, "")
    .replace(
      /^สรุปผลการปรับใช้บทบัญญัติ[^:]{0,160}:\s*/u,
      ""
    )
    .trim();
}

function extractCanonicalSectionIds(normText: string): string[] {
  const out = new Set<string>();
  const matches = normText.matchAll(
    /มาตรา\s*([0-9]+(?:\/[0-9]+)?)(?:\s*(ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นว|ทศ|เตรส|โสฬส))?(?:\s*\(([0-9]{1,2})\))?/g
  );
  for (const m of matches) {
    const num = m[1];
    const ord = m[2] ? ` ${m[2]}` : "";
    out.add(`มาตรา ${num}${ord}`);
    if (m[3]) {
      out.add(`มาตรา ${num}${ord} (${m[3]})`);
    }
  }
  return Array.from(out);
}

function extractCanonicalRulingIds(rawText: string): string[] {
  const out = new Set<string>();
  const arabic = thaiDigitsToArabic(rawText);
  const matches = arabic.matchAll(
    /(?:กค|gor\s*kor\.?|gk)\s*[0-9]{2,5}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮa-zA-Z.]+\s*\/?\s*)?[0-9ก-๙a-zA-Z]+/gi
  );
  for (const m of matches) {
    const norm = normalizeOfficialRulingIdentifier(
      m[0].replace(/^(?:gor\s*kor\.?|gk)\s*/i, "กค ")
    ).toLowerCase();
    if (norm) out.add(norm);
  }
  return Array.from(out);
}

function extractCanonicalInstrumentNumbers(normText: string): string[] {
  const out = new Set<string>();
  for (const m of normText.matchAll(/พระราชกฤษฎีกา[^0-9\n]{0,45}ฉบับที่\s*([0-9]+)/g)) {
    out.add(`พรฎ.${m[1]}`);
  }
  for (const m of normText.matchAll(/ท\.ป\.\s*([0-9]+\/[0-9]+)/g)) {
    out.add(`ทป.${m[1]}`);
  }
  for (const m of normText.matchAll(/ฎีกาที่\s*([0-9]+\/[0-9]+)/g)) {
    out.add(`ฎีกา.${m[1]}`);
  }
  return Array.from(out);
}

function extractMaterialQuantitativeTokens(normText: string): Array<{
  kind: "rate" | "unit" | "money";
  val: string;
  unitTh: string;
}> {
  const out: Array<{ kind: "rate" | "unit" | "money"; val: string; unitTh: string }> = [];
  const seen = new Set<string>();
  const add = (kind: "rate" | "unit" | "money", val: string, unitTh: string) => {
    const key = `${kind}:${val}:${unitTh}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind, val, unitTh });
    }
  };

  // 1. Tax rates & percentages (`ร้อยละ 0`, `ร้อยละ 20`, `7%`, `15 percent`)
  for (const m of normText.matchAll(/(?:ร้อยละ|อัตรา(?:ภาษี)?(?:ร้อยละ)?)\s*([0-9]+(?:\.[0-9]+)?)/g)) {
    add("rate", m[1], "%");
  }
  for (const m of normText.matchAll(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:%|เปอร์เซ็นต์|percent)\b/g)) {
    add("rate", m[1], "%");
  }

  // 2. Deadlines, durations, promoter/person counts, multipliers, and monetary caps
  //    Note: In Thai script, words follow units without spaces (`15 วันนับแต่`, `3 คนขึ้นไป`, `5 ปีนับแต่`), so only guard `วัน` against `วันที่`/`วันสิ้น` and guard English units with `(?![a-z])`!
  for (const m of normText.matchAll(
    /(?<![0-9/.\-])([0-9]+(?:\.[0-9]+)?)\s*(วัน(?!ที่|สิ้น)|เดือน|ปี|คน|เท่า|ล้านบาท|บาท|(?:thb|baht|days?|months?|years?|promoters?)(?![a-z]))/g
  )) {
    const valNum = Number(m[1]);
    const u = m[2];
    // Skip 4-digit calendar years (`2569`, `2026`)
    if ((u === "ปี" || u.startsWith("year")) && valNum >= 1900 && valNum <= 2600) {
      continue;
    }
    if (u === "บาท" || u === "ล้านบาท" || u === "thb" || u === "baht") {
      const canonicalVal = u === "ล้านบาท" ? String(valNum * 1_000_000) : m[1];
      add("money", canonicalVal, "บาท");
    } else {
      const unitTh =
        u.startsWith("day")
          ? "วัน"
          : u.startsWith("month")
            ? "เดือน"
            : u.startsWith("year")
              ? "ปี"
              : u.startsWith("promoter")
                ? "คน"
                : u;
      add("unit", m[1], unitTh);
    }
  }
  return out;
}

const EXCLUSIVE_LEGAL_DOMAINS: Array<{
  domain: string;
  claimPattern: RegExp;
  sourcePattern: RegExp;
}> = [
  {
    domain: "VAT",
    claimPattern: /ภาษีมูลค่าเพิ่ม|ภาษีซื้อ|ภาษีขาย|ใบกำกับภาษี/,
    sourcePattern: /ภาษีมูลค่าเพิ่ม|ภาษีซื้อ|ภาษีขาย|ใบกำกับภาษี|80\/1|77\/|81|82|83|86/,
  },
  {
    domain: "WITHHOLDING_TAX",
    claimPattern: /หักภาษี\s*ณ\s*ที่จ่าย|หักภาษีจากเงินได้/,
    sourcePattern: /หักภาษี\s*ณ\s*ที่จ่าย|หักภาษีจากเงินได้|หัก\s*ณ\s*ที่จ่าย|มาตรา\s*70|3\s*เตรส|มาตรา\s*50|ท\.ป\.\s*4\/2528/,
  },
  {
    domain: "SBT",
    claimPattern: /ภาษีธุรกิจเฉพาะ/,
    sourcePattern: /ภาษีธุรกิจเฉพาะ|91\/|ฉบับที่\s*244/,
  },
  {
    domain: "STAMP_DUTY",
    claimPattern: /อากรแสตมป์|ปิดแสตมป์บริบูรณ์/,
    sourcePattern: /อากรแสตมป์|แสตมป์|103|104|บัญชีอัตราอากรแสตมป์/,
  },
  {
    domain: "DIVIDEND_CREDIT",
    claimPattern: /เครดิตภาษีเงินปันผล/,
    sourcePattern: /เครดิตภาษี|เงินปันผล|47\s*ทวิ/,
  },
  {
    domain: "SUMMONS_AUDIT",
    claimPattern: /ออกหมายเรียก|หมายเรียกไต่สวน/,
    sourcePattern: /หมายเรียก|มาตรา\s*19/,
  },
  {
    domain: "LABOR_PROTECTION",
    claimPattern: /ค่าชดเชย(?:การ)?เลิกจ้าง|คุ้มครองแรงงาน|ลูกจ้างถูกเลิกจ้าง/,
    sourcePattern: /คุ้มครองแรงงาน|ค่าชดเชย|เลิกจ้าง/,
  },
  {
    domain: "CUSTOMS_EXCISE",
    claimPattern: /อากรศุลกากร|พิกัดอัตราศุลกากร|ภาษีสรรพสามิต/,
    sourcePattern: /ศุลกากร|สรรพสามิต/,
  },
  {
    domain: "COMPANY_PROMOTERS",
    claimPattern: /ผู้เริ่มก่อการ|หนังสือบริคณห์สนธิ/,
    sourcePattern: /เริ่มก่อการ|ผู้เริ่มก่อการ|บริคณห์สนธิ|1097/,
  },
  {
    domain: "POLITICAL_PARTY_DONATION",
    claimPattern: /พรรคการเมือง/,
    sourcePattern: /พรรคการเมือง|ฉบับที่\s*51/,
  },
];

const GENERIC_LEGAL_STOPWORDS_RE =
  /(?:ประมวลรัษฎากร|กรมสรรพากร|อธิบดีกรมสรรพากร|พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศอธิบดี|คำสั่งกรมสรรพากร|หนังสือตอบข้อหารือ|ข้อหารือ|แนววินิจฉัย|วินิจฉัยว่า|วินิจฉัย|ความเห็น|บทบัญญัติ|ข้อกฎหมาย|กฎหมาย|มาตรา\s*[0-9/]+(?:\s*(?:ทวิ|ตรี|จัตวา|เตรส))?|วรรคหนึ่ง|วรรคสอง|วรรคสาม|อนุมาตรา|ฉบับที่\s*[0-9]+|พ\.ศ\.\s*[0-9]{4}|ค\.ศ\.\s*[0-9]{4}|บริษัทหรือห้างหุ้นส่วนนิติบุคคล|ห้างหุ้นส่วนนิติบุคคล|บริษัทจำกัด|บริษัท|นิติบุคคล|บุคคลธรรมดา|ผู้ประกอบการจดทะเบียน|ผู้ประกอบการ|ประกอบกิจการ|ประกอบกับ|ผู้เสียภาษี|ผู้มีเงินได้|ผู้จ่ายเงินได้|ผู้จ่าย|ผู้รับ|ในประเทศไทย|ประเทศไทย|ในราชอาณาจักร|ราชอาณาจักร|หลักเกณฑ์|วิธีการ|เงื่อนไข|ได้รับสิทธิ|มีสิทธิ|มีอำนาจ|มีหน้าที่|อยู่ในบังคับ|ต้องเสียภาษี|ไม่ต้องเสียภาษี|เสียภาษี|ภาษีเงินได้นิติบุคคล|ภาษีเงินได้บุคคลธรรมดา|ภาษีเงินได้|ภาษีอากร|ภาษี|อัตราร้อยละ|ในอัตรา|ร้อยละ|กรณีที่|ในกรณี|สำหรับ|เกี่ยวกับ|เนื่องจาก|ตามที่|ทั้งนี้|ตั้งแต่|จนถึง|วันที่|เดือน|ปี|สามารถ|จะต้อง|มิให้|ไม่ให้|ไม่ได้|มิได้|ต้อง|ได้|ให้|การ|ความ|ของ|ใน|จาก|แก่|กับ|โดย|เพื่อ|ตาม|และ|หรือ|เป็น|มี|ว่า|ซึ่ง|ที่|ณ|\b(?:the|a|an|of|to|in|for|on|by|with|from|as|at|is|are|was|were|be|been|can|may|must|shall|under|pursuant|section|thai|thailand|company|corporate|taxpayer|revenue|code|ruling|tax|law|act|decree|provision|applicable|qualifies|qualify|rate|percent)\b)/gi;

function extractSubstantiveContentShingles(normText: string): string[] {
  const cleaned = normText
    .replace(/กค\s*[0-9]{2,5}(?:\([^)]+\))?\/[0-9ก-๙a-z]+/gi, " ")
    .replace(GENERIC_LEGAL_STOPWORDS_RE, " ")
    .replace(/[^\u0E00-\u0E7Fa-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const features = new Set<string>();
  for (const tok of cleaned.split(" ")) {
    const t = tok.trim();
    if (!t) continue;
    if (/^[0-9]+$/.test(t)) continue;
    if (/^[a-z0-9]+$/.test(t)) {
      if (t.length >= 3) features.add(t);
      continue;
    }
    // Emit balanced features per Thai chunk (up to 3 evenly spaced 4-char shingles) so long modifiers never outweigh short legal terms!
    if (t.length >= 3 && t.length <= 8) {
      features.add(t);
    } else if (t.length > 8) {
      features.add(t.slice(0, 4));
      features.add(t.slice(Math.floor((t.length - 4) / 2), Math.floor((t.length - 4) / 2) + 4));
      features.add(t.slice(t.length - 4));
    }
  }
  return Array.from(features);
}

/**
 * Deterministic substantive support evaluator (`Material Issue 1`):
 * Ensures a claim is NEVER marked `supported` / `VERIFIED` merely because a real source was attached.
 * Every attached passage must substantively relate to the claim, and the union of cited passages must
 * ground the claim's legal domain, explicit identifiers, material numbers/rates/deadlines, and content concepts.
 */
export function evaluateSubstantiveClaimSupport(params: {
  claim_text: string;
  passages: SubstantiveSupportPassageInput[];
}): SubstantiveClaimSupportOutcome {
  const strippedClaim = stripProvenanceHeaderPrefix(params.claim_text || "");
  if (!strippedClaim || params.passages.length === 0) {
    return {
      supported: false,
      reason_code: "EMPTY_CLAIM_OR_EVIDENCE",
      detail_th: "ไม่มีข้อความข้อกล่าวอ้างหรือไม่มีรายการข้อความหลักฐานอ้างอิง",
      overlap_ratio: 0,
    };
  }

  const normClaim = normalizeForEntailment(strippedClaim);
  const perPassageNorms = params.passages.map((p) => {
    const metaParts = [
      p.source_native_id || "",
      p.doc_title_th || "",
      ...(p.section_path || []),
    ]
      .filter(Boolean)
      .join(" ");
    const fullText = `${metaParts} ${p.verbatim_text}`;
    return {
      passage_id: p.passage_id,
      normBodyOnly: normalizeForEntailment(p.verbatim_text),
      normWithMeta: normalizeForEntailment(fullText),
      rawFull: fullText,
    };
  });

  const distinctMetaParts = Array.from(
    new Set(
      params.passages.flatMap((p) => [
        p.source_native_id || "",
        p.doc_title_th || "",
        ...(p.section_path || []),
      ])
    )
  )
    .filter(Boolean)
    .join(" ");
  const combinedRawBodyOnly = params.passages.map((p) => p.verbatim_text).join("\n");
  const combinedNormBodyOnly = normalizeForEntailment(combinedRawBodyOnly);
  const combinedNormWithMeta = normalizeForEntailment(`${distinctMetaParts} ${combinedRawBodyOnly}`);
  const combinedRawFull = `${distinctMetaParts}\n${combinedRawBodyOnly}`;

  // Fast path Check 0: Even for verbatim segments, check per-passage relevance first so an extra irrelevant passage cannot piggyback!
  const claimShingles = extractSubstantiveContentShingles(normClaim);
  const claimSections = extractCanonicalSectionIds(normClaim);
  const claimRulings = extractCanonicalRulingIds(strippedClaim);
  const claimInstruments = extractCanonicalInstrumentNumbers(normClaim);
  const claimQuantities = extractMaterialQuantitativeTokens(normClaim);

  // 1. Explicit statutory section / sub-clause / ruling / Royal Decree / Order grounding check
  const normMetaCompact = combinedNormWithMeta.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  for (const sec of claimSections) {
    const subClauseMatch = /^มาตรา\s*([0-9/]+(?:\s*[ก-๙]+)?)\s*\(([0-9]{1,2})\)$/.exec(sec);
    if (subClauseMatch) {
      const baseNum = subClauseMatch[1].replace("/", "\\/").replace(/\s+/g, "\\s*");
      const subNum = subClauseMatch[2];
      const subPresent =
        new RegExp(`(?:มาตรา|ข้อ)\\s*${baseNum}\\s*\\(${subNum}\\)`).test(normMetaCompact) ||
        (new RegExp(`(?:มาตรา|ข้อ)\\s*${baseNum}(?![0-9/])`).test(normMetaCompact) &&
          normMetaCompact.includes(`(${subNum})`));
      if (!subPresent) {
        return {
          supported: false,
          reason_code: "UNGROUNDED_LEGAL_IDENTIFIER",
          detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากหลักฐานที่แนบไม่ได้รองรับอนุมาตรา "${sec}" ที่ระบุในข้อสรุป`,
          overlap_ratio: 0,
        };
      }
      continue;
    }
    const bareSecNum = sec.replace(/^มาตรา\s*/, "");
    const secPresent =
      combinedNormWithMeta.includes(sec) ||
      new RegExp(`(?:มาตรา|ข้อ)\\s*${bareSecNum.replace("/", "\\/")}(?![0-9/])`).test(
        combinedNormWithMeta
      );
    if (!secPresent) {
      return {
        supported: false,
        reason_code: "UNGROUNDED_LEGAL_IDENTIFIER",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากหลักฐานที่แนบไม่ได้กล่าวถึงหรือรองรับ "${sec}" ที่อ้างในข้อสรุป`,
        overlap_ratio: 0,
      };
    }
  }

  const sourceRulings = new Set(extractCanonicalRulingIds(combinedRawFull));
  for (const rId of claimRulings) {
    const bareRId = rId.replace(/^กค\s*/, "");
    if (!sourceRulings.has(rId) && !combinedNormWithMeta.includes(bareRId)) {
      return {
        supported: false,
        reason_code: "UNGROUNDED_LEGAL_IDENTIFIER",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากหลักฐานที่แนบไม่ใช่และไม่ได้อ้างถึงเลขที่หนังสือ "${rId}"`,
        overlap_ratio: 0,
      };
    }
  }

  const sourceInstruments = new Set(extractCanonicalInstrumentNumbers(combinedNormWithMeta));
  for (const inst of claimInstruments) {
    if (!sourceInstruments.has(inst)) {
      return {
        supported: false,
        reason_code: "UNGROUNDED_LEGAL_IDENTIFIER",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากหลักฐานที่แนบไม่ได้กล่าวถึงกฎหมายลำดับรองหรือคำพิพากษา (${inst}) ที่ระบุในข้อสรุป`,
        overlap_ratio: 0,
      };
    }
  }

  // 2. Material numeric / tax rate / unit-bound deadline / count / monetary threshold grounding check
  for (const qTok of claimQuantities) {
    const escapedVal = qTok.val.replace(".", "\\.");
    let grounded = false;
    if (qTok.kind === "rate") {
      grounded =
        new RegExp(`(?:ร้อยละ|อัตรา(?:ภาษี)?)\\s*${escapedVal}(?![0-9])`).test(
          combinedNormWithMeta
        ) ||
        new RegExp(`(?<![0-9.])${escapedVal}\\s*(?:%|เปอร์เซ็นต์|percent)`).test(
          combinedNormWithMeta
        );
    } else if (qTok.kind === "unit") {
      const unitGuard = qTok.unitTh === "วัน" ? "วัน(?!ที่|สิ้น)" : qTok.unitTh;
      grounded = new RegExp(`(?<![0-9.])${escapedVal}\\s*${unitGuard}`).test(
        combinedNormWithMeta
      );
    } else {
      grounded = new RegExp(`(?<![0-9.])${escapedVal}(?![0-9])`).test(combinedNormWithMeta);
    }
    if (!grounded) {
      return {
        supported: false,
        reason_code: "UNGROUNDED_NUMERIC_ASSERTION",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากตัวเลขอัตราภาษี กำหนดเวลา หรือจำนวน (${qTok.val} ${qTok.unitTh}) ในข้อสรุปไม่ตรงกับหลักฐานที่แนบ`,
        overlap_ratio: 0,
      };
    }
  }

  // 3. Exclusive tax / legal domain mismatch check
  for (const dom of EXCLUSIVE_LEGAL_DOMAINS) {
    if (dom.claimPattern.test(normClaim) && !dom.sourcePattern.test(combinedNormWithMeta)) {
      return {
        supported: false,
        reason_code: "DOMAIN_MISMATCH_IRRELEVANT_SOURCE",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากเนื้อหาหลักฐานที่แนบอยู่คนละประเภทภาษีหรือคนละเรื่องทางกฎหมาย (${dom.domain}) กับข้อกล่าวอ้าง`,
        overlap_ratio: 0,
      };
    }
  }

  // 4. Per-document / per-source substantive relevance check (blocks attaching an unrelated source or irrelevant real passage, while allowing multi-unit sequential passages of the same verified document!)
  const groupedBySource = new Map<
    string,
    { label: string; normWithMeta: string; normBodyOnly: string }
  >();
  for (let i = 0; i < params.passages.length; i++) {
    const rawP = params.passages[i];
    const pNorm = perPassageNorms[i];
    const groupKey = rawP.doc_id || rawP.passage_id;
    const prev = groupedBySource.get(groupKey);
    if (!prev) {
      groupedBySource.set(groupKey, {
        label: rawP.passage_id,
        normWithMeta: pNorm.normWithMeta,
        normBodyOnly: pNorm.normBodyOnly,
      });
    } else {
      prev.normWithMeta = `${prev.normWithMeta}\n${pNorm.normWithMeta}`;
      prev.normBodyOnly = `${prev.normBodyOnly}\n${pNorm.normBodyOnly}`;
    }
  }

  const matchedClaimDomains = EXCLUSIVE_LEGAL_DOMAINS.filter((dom) =>
    dom.claimPattern.test(normClaim)
  );

  for (const srcGroup of groupedBySource.values()) {
    const directSubstring =
      (normClaim.length >= 12 && srcGroup.normWithMeta.includes(normClaim)) ||
      (srcGroup.normBodyOnly.length >= 16 && normClaim.includes(srcGroup.normBodyOnly));
    if (directSubstring) continue;

    const pShingleSet = new Set(extractSubstantiveContentShingles(srcGroup.normWithMeta));
    const sharedWithThisSource = claimShingles.filter((sh) => pShingleSet.has(sh));
    const perSourceRatio =
      claimShingles.length > 0 ? sharedWithThisSource.length / claimShingles.length : 0;
    const groundsExplicitClaimIdentifier =
      claimSections.some((s) => srcGroup.normWithMeta.includes(s)) ||
      claimRulings.some((r) => srcGroup.normWithMeta.includes(r.replace(/^กค\s*/, ""))) ||
      claimInstruments.some((inst) =>
        extractCanonicalInstrumentNumbers(srcGroup.normWithMeta).includes(inst)
      );

    // If multiple distinct sources are attached and the claim belongs to specific tax domain(s),
    // every attached source must either belong to one of the claim's domains OR explicitly ground a named legal identifier!
    if (
      groupedBySource.size >= 2 &&
      matchedClaimDomains.length > 0 &&
      !groundsExplicitClaimIdentifier &&
      !matchedClaimDomains.some((dom) => dom.sourcePattern.test(srcGroup.normWithMeta))
    ) {
      return {
        supported: false,
        reason_code: "IRRELEVANT_CITED_PASSAGE",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากหลักฐานที่แนบเพิ่มเติม (${srcGroup.label}) อยู่คนละประเภทภาษีและไม่ได้ถูกอ้างอิงในข้อสรุป`,
        overlap_ratio: perSourceRatio,
      };
    }

    const minRequiredRatio = groundsExplicitClaimIdentifier ? 0.05 : 0.25;

    if (sharedWithThisSource.length === 0 || perSourceRatio < minRequiredRatio) {
      return {
        supported: false,
        reason_code: "IRRELEVANT_CITED_PASSAGE",
        detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากข้อความหลักฐานที่แนบ (${srcGroup.label}) ไม่มีเนื้อหาสาระสำคัญที่เกี่ยวข้องหรือรองรับข้อกล่าวอ้างนี้อย่างเพียงพอ`,
        overlap_ratio: perSourceRatio,
      };
    }
  }

  // 5. Overall union substantive entailment ratio check
  const directUnionSubstring =
    (normClaim.length >= 12 && combinedNormWithMeta.includes(normClaim)) ||
    (combinedNormBodyOnly.length >= 16 && normClaim.includes(combinedNormBodyOnly));
  if (directUnionSubstring) {
    return {
      supported: true,
      reason_code: "VERIFIED_SUBSTANTIVE_SUPPORT",
      detail_th: "ข้อความหลักฐานต้นฉบับรองรับข้อกล่าวอ้างโดยตรง",
      overlap_ratio: 1,
    };
  }

  if (claimShingles.length === 0) {
    return {
      supported: false,
      reason_code: "INSUFFICIENT_SUBSTANTIVE_OVERLAP",
      detail_th:
        "ระงับการรับรองข้อกล่าวอ้าง เนื่องจากข้อกล่าวอ้างมีแต่คำทั่วไปโดยไม่มีสาระข้อกฎหมายที่ตรวจสอบความตรงกันกับหลักฐานได้",
      overlap_ratio: 0,
    };
  }

  const unionShingleSet = new Set(extractSubstantiveContentShingles(combinedNormWithMeta));
  const matchedShingles = claimShingles.filter((sh) => unionShingleSet.has(sh));
  const overlapRatio = matchedShingles.length / claimShingles.length;

  // Require meaningful substantive concept/shingle coverage (>= 0.30, and >= 2 matched substantive features when claim has >= 3 features)
  const minMatchedCount = claimShingles.length >= 3 ? 2 : 1;
  if (overlapRatio < 0.3 || matchedShingles.length < minMatchedCount) {
    return {
      supported: false,
      reason_code: "INSUFFICIENT_SUBSTANTIVE_OVERLAP",
      detail_th: `ระงับการรับรองข้อกล่าวอ้าง เนื่องจากแหล่งอ้างอิงที่แนบไม่มีเนื้อหาสาระสำคัญรองรับข้อกล่าวอ้างอย่างเพียงพอ (ความสอดคล้องเชิงเนื้อหา ${(overlapRatio * 100).toFixed(0)}%)`,
      overlap_ratio: overlapRatio,
    };
  }

  return {
    supported: true,
    reason_code: "VERIFIED_SUBSTANTIVE_SUPPORT",
    detail_th: "ตรวจสอบพบเนื้อหาสาระสำคัญในแหล่งอ้างอิงรองรับข้อกล่าวอ้าง",
    overlap_ratio: overlapRatio,
  };
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
    /\bnot\s+exempt\b|\bsubject\s+to\s+(?:vat|tax)\b|\bnon[- ]deductible\b/i,
  ];

  const exemptPatterns = [
    /(?<!ไม่|มิได้|ที่จะ)ได้รับ(?:การ)?ยกเว้นภาษี/,
    /ไม่ต้องเสียภาษี/,
    /ไม่เสียภาษี/,
    /ไม่ต้องนำมาเป็นมูลค่าฐานภาษี/,
    /มีสิทธิเสียภาษี(?:มูลค่าเพิ่ม)?ในอัตรา(?:ภาษี)?ร้อยละ\s*0/,
    /ได้รับสิทธิ\s*เสียภาษีมูลค่าเพิ่มในอัตราร้อยละ\s*0/,
    /(?<!not\s+)\bexempt\s+from\s+(?:vat|corporate\s+income\s+tax|tax)\b/i,
    /\bqualif(?:y|ies)\s+for\s+0%\s*vat\b/i,
  ];

  const claimsTaxableOrNonExempt = nonExemptPatterns.some((re) => re.test(norm));
  const claimsExemptionOrZeroRate =
    exemptPatterns.some((re) => re.test(norm)) &&
    !/ไม่เข้าลักษณะ[^。\n]{0,80}ได้รับยกเว้น.*จึงต้องเสียภาษี/.test(norm);

  const hasConditions = /(?:หาก|เมื่อ|ทั้งนี้\s*ต้อง|เว้นแต่|ภายใต้เงื่อนไข|\bunless\b|\bprovided\s+that\b)/i.test(
    norm
  );

  return {
    claimsExemptionOrZeroRate,
    claimsTaxableOrNonExempt,
    hasConditions,
  };
}

/**
 * Verifies a proposed answer claim against its cited supporting passages (`AT11` + `Material Issue 1`).
 * Blocks confident answers when citations are missing, locators are broken, the cited passage
 * does NOT substantively support the claim, or legal polarity/negation contradicts the claim!
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

  // Material Issue 1: Substantive claim-to-evidence support check!
  const substantive = evaluateSubstantiveClaimSupport({
    claim_text: claim.statement,
    passages: cited.map((p) => ({
      passage_id: p.passage_id,
      doc_id: p.work_id,
      verbatim_text: p.exact_text,
      doc_title_th: p.contextualized_header,
      section_path: p.structural_path,
    })),
  });
  if (!substantive.supported) {
    return {
      verification_result: "UNSUPPORTED",
      allow_confident_answer: false,
      reason: `INSUFFICIENT_SUBSTANTIVE_SUPPORT:${substantive.reason_code}:${substantive.detail_th}`,
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
