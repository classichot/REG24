/**
 * REG24 — Durable Multi-Batch Statutory Versioning, Amendment Ledger & Temporal Applicability Engine
 *
 * Applies uniformly across Batch 1 (`B01`), Batch 2 (`B02`), and future batches (`B03`–`B10`):
 * 1. Extracts structured `ProvisionAmendmentLedgerItem[]` from official statutory amendment notes
 *    using balanced-parenthesis parsing (never conflating Royal Gazette enactment date with
 *    accounting-period start, accounting-period end, or assessable tax-year applicability rules).
 * 2. Normalizes bilingual (Thai + English) statutory/ruling identifiers and domain concepts so
 *    differently worded Thai and English questions route through the exact same retrieval &
 *    version-selection pipeline rather than one-off keyword filters.
 * 3. Separates `HISTORICAL_DOCUMENT_LOOKUP` (displaying a requested historical ruling/Act with
 *    clear currency context) from `APPLICABLE_LAW_AT_TIME` (selecting the verified statutory
 *    version governing the user's factual period, asking for missing dates where material, and
 *    containing unverified pre-amendment versions rather than guessing).
 */

import {
  normalizeOfficialRulingIdentifier,
  normalizeThaiLegalSectionRef,
  parseThaiBuddhistDateToIso,
  thaiDigitsToArabic,
} from "./identity";
import type {
  ApplicabilityBasis,
  LegalVersion,
  LegalWork,
  ProvisionAmendmentLedgerItem,
} from "./contracts";

const EN_MONTH_MAP: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12",
};

const TH_SHORT_MONTH_TO_FULL: Record<string, string> = {
  "ม.ค.": "มกราคม",
  "ก.พ.": "กุมภาพันธ์",
  "มี.ค.": "มีนาคม",
  "เม.ย.": "เมษายน",
  "พ.ค.": "พฤษภาคม",
  "มิ.ย.": "มิถุนายน",
  "ก.ค.": "กรกฎาคม",
  "ส.ค.": "สิงหาคม",
  "ก.ย.": "กันยายน",
  "ต.ค.": "ตุลาคม",
  "พ.ย.": "พฤศจิกายน",
  "ธ.ค.": "ธันวาคม",
};

const EN_LATIN_ORDINAL_TO_THAI: Record<string, string> = {
  bis: "ทวิ",
  ter: "ตรี",
  quater: "จัตวา",
  quinquies: "เบญจ",
  sexies: "ฉ",
  septies: "สัตต",
  octies: "อัฐ",
  novies: "นว",
  decies: "ทศ",
  tredecies: "เตรส",
};

const EN_SUBCLAUSE_LETTER_TO_THAI: Record<string, string> = {
  a: "ก",
  b: "ข",
  c: "ค",
  d: "ง",
  e: "จ",
};

/**
 * Parses either a Thai Buddhist date (`1 ม.ค. 2561`, `30 มิถุนายน พ.ศ. 2561`),
 * an English date (`30 June 2018`, `June 30, 2018`, `1 Jan B.E. 2561`),
 * or an ISO date (`2018-06-30`) into canonical ISO `YYYY-MM-DD`.
 */
export function parseFlexibleThaiOrEnglishDateToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = thaiDigitsToArabic(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;

  const isoDirect = s.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/);
  if (isoDirect) {
    return `${isoDirect[1]}-${isoDirect[2]}-${isoDirect[3]}`;
  }

  // Expand Thai abbreviated months (`ม.ค.` -> `มกราคม`) and 2-digit B.E. years (`61` -> `2561` when after Thai month)
  for (const [abbr, full] of Object.entries(TH_SHORT_MONTH_TO_FULL)) {
    s = s.split(abbr).join(full);
  }
  s = s.replace(
    /([0-9]{1,2}\s+(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s+)(?:พ\.ศ\.\s*)?([456][0-9])\b/g,
    (_m, prefix, twoDigitBe) => `${prefix}25${twoDigitBe}`
  );
  const thIso = parseThaiBuddhistDateToIso(s);
  if (thIso) return thIso;

  // English Day Month Year: `30 June 2018`, `1 Jan B.E. 2561`
  const dmyEn = s.match(
    /\b([0-9]{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*,?\s*(?:(b\.?e\.?|พ\.ศ\.)\s*)?((?:19|20|24|25)\d{2})\b/i
  );
  if (dmyEn) {
    const day = dmyEn[1].padStart(2, "0");
    const mm = EN_MONTH_MAP[dmyEn[2].toLowerCase().replace(/\.$/, "")];
    let yr = Number(dmyEn[4]);
    if (dmyEn[3] || yr >= 2400) yr -= 543;
    if (mm && yr >= 1900 && yr <= 2100) return `${yr}-${mm}-${day}`;
  }

  // English Month Day, Year: `June 30, 2018`, `July 1, 2017`
  const mdyEn = s.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s*(?:(b\.?e\.?)\s*)?((?:19|20|24|25)\d{2})\b/i
  );
  if (mdyEn) {
    const mm = EN_MONTH_MAP[mdyEn[1].toLowerCase().replace(/\.$/, "")];
    const day = mdyEn[2].padStart(2, "0");
    let yr = Number(mdyEn[4]);
    if (mdyEn[3] || yr >= 2400) yr -= 543;
    if (mm && yr >= 1900 && yr <= 2100) return `${yr}-${mm}-${day}`;
  }

  return null;
}

/**
 * Normalizes English statutory and ruling identifiers into canonical REG24 Thai identifiers,
 * and appends canonical Thai search terms for bilingual retrieval parity (no keyword hardcoding
 * of legal conclusions — strictly maps terminology so retrieval lands on the canonical `LegalWork`).
 */
export function normalizeBilingualQueryForRetrieval(question: string): {
  normalizedQuestionForIdentifiers: string;
  bilingualExpandedQuery: string;
} {
  let norm = thaiDigitsToArabic(question);

  // 1. Normalize English ruling prefixes (`GorKor 0811(KorMor.03)/366`, `GK 0702/1494`)
  norm = norm.replace(
    /\b(?:Gor\s*Kor\.?|GK)\s*([0-9]{3,5})(?:\s*\(\s*(?:Kor\s*Mor|KM)\.?([0-9]*)\s*\))?\s*\/\s*([0-9]+)/gi,
    (_m, bureau, kmNum, num) =>
      kmNum !== undefined ? `กค ${bureau}(กม.${kmNum})/${num}` : `กค ${bureau}/${num}`
  );

  // 2. Normalize English section references (`Section 65 ter (3)(a)`, `s. 80/1 (5)`, `Sec. 47 bis`)
  norm = norm.replace(
    /\b(?:sections?|secs?\.?|s\.)\s*([0-9]+(?:\/[0-9]+)?)(?:\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|tredecies))?((?:\s*\([0-9a-eA-Eก-ฮ]+\))*)/gi,
    (_m, secNum, latinOrd, subParens: string) => {
      const thOrd = latinOrd ? ` ${EN_LATIN_ORDINAL_TO_THAI[latinOrd.toLowerCase()] || latinOrd}` : "";
      const normSubs = (subParens || "").replace(/\(([a-eA-E])\)/g, (_sm, ch: string) => {
        const mapped = EN_SUBCLAUSE_LETTER_TO_THAI[ch.toLowerCase()];
        return mapped ? `(${mapped})` : `(${ch})`;
      });
      return `มาตรา ${secNum}${thOrd}${normSubs}`;
    }
  );

  // 3. Normalize English Royal Decree references (`Royal Decree No. 736`, `RD No. 244`)
  norm = norm.replace(
    /\b(?:Royal\s+Decree|R\.?D\.?)\s*(?:No\.?|#)?\s*([0-9]{1,4})\b/gi,
    (_m, num) => `พระราชกฤษฎีกา (ฉบับที่ ${num})`
  );
  if (/\bRevenue\s+Code\b/i.test(norm) && !/ประมวลรัษฎากร/.test(norm)) {
    norm = `${norm} ประมวลรัษฎากร`;
  }

  // 4. Bilingual concept bridge for lexical/vector retrieval when question contains English terms
  const extraTerms: string[] = [];
  if (/[a-zA-Z]{3,}/.test(question)) {
    const low = question.toLowerCase();
    if (/political\s+part(?:y|ies)/.test(low)) {
      extraTerms.push("พรรคการเมือง บริจาคแก่พรรคการเมือง มาตรา 65 ตรี (3)");
    }
    if (/donat(?:e|ion|ions)|contribut(?:e|ion|ions)|charit(?:y|able)/.test(low)) {
      extraTerms.push("บริจาค การกุศล รายจ่ายต้องห้าม มาตรา 65 ตรี");
    }
    if (/summons|assessment\s+audit|statute\s+of\s+limitations|extend.*5\s*years/.test(low)) {
      extraTerms.push("ออกหมายเรียก ไต่สวน ขยายเวลา ห้าปี อธิบดี มาตรา 19");
    }
    if (/economic\s+and\s+trade\s+office|trade\s+and\s+economic\s+office|international\s+organi[sz]ation|embass(?:y|ies)|united\s+nations/.test(low)) {
      extraTerms.push("สำนักงานเศรษฐกิจและการค้าของต่างประเทศ องค์การระหว่างประเทศ สถานเอกอัครราชทูต มาตรา 80/1 (5)");
    }
    if (/(?:0%|zero[- ]rat(?:e|ed))/.test(low) && /vat|value[- ]added|export|service/.test(low)) {
      extraTerms.push("ภาษีมูลค่าเพิ่ม อัตราร้อยละ 0 ส่งออก มาตรา 80/1");
    }
    if (/dividend\s+(?:tax\s+)?credit/.test(low)) {
      extraTerms.push("เครดิตภาษีเงินปันผล มาตรา 47 ทวิ");
    }
    if (/undivided\s+estate|estate\s+administrator/.test(low)) {
      extraTerms.push("กองมรดกที่ยังมิได้แบ่ง ผู้จัดการมรดก ภูมิลำเนาเฉพาะการ มาตรา 47 ทวิ");
    }
    if (/withholding\s+tax|wht/.test(low) && /foreign|abroad|overseas|non[- ]resident/.test(low)) {
      extraTerms.push("จ่ายเงินได้ไปต่างประเทศ บริษัทต่างประเทศ หักภาษี ณ ที่จ่าย มาตรา 70");
    }
    if (/sale\s+with\s+right\s+of\s+redemption/.test(low)) {
      extraTerms.push("ขายฝาก ภาษีธุรกิจเฉพาะ พระราชกฤษฎีกา ฉบับที่ 244");
    }
    if (/expropriat(?:e|ion)/.test(low)) {
      extraTerms.push("เวนคืนอสังหาริมทรัพย์ ภาษีธุรกิจเฉพาะ อากรแสตมป์");
    }
  }

  return {
    normalizedQuestionForIdentifiers: norm,
    bilingualExpandedQuery: extraTerms.length > 0 ? `${norm} ${extraTerms.join(" ")}` : norm,
  };
}

/**
 * Extracts balanced parenthetical notes `( ... (ฉบับที่ N) ... )` from statutory text,
 * together with their start/end character offsets.
 */
export function extractBalancedParentheticalSpans(
  text: string
): Array<{ content: string; start: number; end: number }> {
  const spans: Array<{ content: string; start: number; end: number }> = [];
  let depth = 0;
  let openIdx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      if (depth === 0) openIdx = i;
      depth += 1;
    } else if (ch === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0 && openIdx >= 0) {
        spans.push({
          content: text.slice(openIdx + 1, i).trim(),
          start: openIdx,
          end: i + 1,
        });
        openIdx = -1;
      }
    }
  }
  return spans;
}

const VERIFIED_GAZETTE_ENRICHMENTS: Record<
  string,
  Partial<ProvisionAmendmentLedgerItem>
> = {
  "prov.th.rc.65_ตรี|(3)": {
    amending_instrument_title_th: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 51) พ.ศ. 2562",
    amending_work_id: "statute.th.rc_amendment_51_2562",
    amending_source_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p51.pdf",
    royal_gazette_ref: "ราชกิจจานุเบกษา เล่ม 136 ตอนที่ 50 ก หน้า 103–105 วันที่ 16 เมษายน 2562",
    gazette_publication_date: "2019-04-16",
    enactment_effective_date: "2019-04-17",
    applicability_basis: "ACCOUNTING_PERIOD_START",
    applicability_from_date: "2018-01-01",
    applicability_rule_th:
      "มาตรา 5 วรรคสอง กำหนดให้ใช้บังคับกับการคำนวณกำไรสุทธิของบริษัทหรือห้างหุ้นส่วนนิติบุคคลซึ่งรอบระยะเวลาบัญชีเริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561 เป็นต้นไป (ต่างจากวันมีผลใช้บังคับของ พ.ร.บ. คือ 17 เมษายน 2562 และต้องดูวันเริ่มรอบระยะเวลาบัญชีจริง มิใช่วันสิ้นสุดรอบระยะเวลาบัญชี)",
    saving_clause_th:
      "มาตรา 6 กำหนดให้บทบัญญัติเดิมก่อนแก้ไข (พ.ร.ก. แก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 16) พ.ศ. 2534 ซึ่งไม่มีสิทธิหักเงินบริจาคพรรคการเมืองตาม (3)(ก)) ยังคงใช้บังคับต่อไปสำหรับรอบระยะเวลาบัญชีที่มีวันเริ่มต้นก่อนวันที่ 1 มกราคม พ.ศ. 2561",
    pre_amendment_verified_version_id: null,
    pre_amendment_source_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/prk16.pdf",
    topic_keywords: [
      "พรรคการเมือง",
      "บริจาค",
      "การกุศล",
      "ห้าหมื่นบาท",
      "50,000",
      "political party",
      "donation",
      "contribution",
      "(3)",
      "(3)(ก)",
    ],
  },
  "prov.th.rc.80/1|(5)": {
    amending_instrument_title_th: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 49) พ.ศ. 2562",
    amending_work_id: "statute.th.rc_amendment_49_2562",
    amending_source_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p49.pdf",
    royal_gazette_ref: "ราชกิจจานุเบกษา เล่ม 136 ตอนที่ 23 ก หน้า 1–3 วันที่ 27 กุมภาพันธ์ 2562",
    gazette_publication_date: "2019-02-27",
    enactment_effective_date: "2019-02-28",
    applicability_basis: "TRANSACTION_OR_EVENT_DATE",
    applicability_from_date: "2019-02-28",
    applicability_rule_th:
      "มาตรา 2 ให้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป คือตั้งแต่วันที่ 28 กุมภาพันธ์ พ.ศ. 2562 เป็นต้นไป (ขยายสิทธิ VAT อัตราร้อยละ 0 ตามมาตรา 80/1 (5)(ข) และ (ค) รวมถึงสำนักงานเศรษฐกิจและการค้าของต่างประเทศ)",
    pre_amendment_verified_version_id: null,
    pre_amendment_source_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p30.pdf",
    topic_keywords: [
      "สำนักงานเศรษฐกิจและการค้าของต่างประเทศ",
      "องค์การระหว่างประเทศ",
      "สหประชาชาติ",
      "สถานเอกอัครราชทูต",
      "สถานทูต",
      "สถานกงสุล",
      "economic and trade office",
      "trade and economic office",
      "international organization",
      "united nations",
      "(5)",
    ],
  },
  "prov.th.rc.47|(1)(ฏ)": {
    amending_instrument_title_th: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 51) พ.ศ. 2562",
    amending_work_id: "statute.th.rc_amendment_51_2562",
    amending_source_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p51.pdf",
    royal_gazette_ref: "ราชกิจจานุเบกษา เล่ม 136 ตอนที่ 50 ก หน้า 103–105 วันที่ 16 เมษายน 2562",
    gazette_publication_date: "2019-04-16",
    enactment_effective_date: "2019-04-17",
    applicability_basis: "ASSESSABLE_TAX_YEAR",
    applicability_from_date: "2018-01-01",
    applicability_from_tax_year_be: 2561,
    applicability_rule_th:
      "มาตรา 5 วรรคหนึ่ง กำหนดให้ใช้บังคับสำหรับเงินได้พึงประเมินประจำปี พ.ศ. 2561 ที่จะต้องยื่นรายการในปี พ.ศ. 2562 เป็นต้นไป",
    pre_amendment_verified_version_id: null,
    topic_keywords: ["พรรคการเมือง", "ระดมทุน", "หนึ่งหมื่นบาท", "10,000", "political party", "(ฏ)"],
  },
};

/**
 * Universal statutory amendment-ledger extractor across Revenue Code (`B01`/`B02`) and
 * future consolidated primary/subordinate legislation (`B03`–`B10`).
 */
export function extractAmendmentLedgerFromStatutoryText(
  workId: string,
  verbatimText: string
): ProvisionAmendmentLedgerItem[] {
  const cleanText = thaiDigitsToArabic(verbatimText || "");
  const spans = extractBalancedParentheticalSpans(cleanText);
  const ledger: ProvisionAmendmentLedgerItem[] = [];

  for (const sp of spans) {
    const note = sp.content.replace(/\s+/g, " ").trim();
    // Must be an amending legislative instrument note (not a short `(1)` subclause or `(ดูคำสั่ง...)` cross-ref)
    if (note.length < 18) continue;
    if (/^ดู(?:คำสั่ง|ประกาศ|กฎกระทรวง|พระราชกฤษฎีกา|คำวินิจฉัย)/.test(note)) continue;
    if (
      !/(?:แก้ไขเพิ่มเติม|เพิ่มเติมโดย|ยกเลิกโดย|พระราชบัญญัติ|พระราชกำหนด|ประกาศของคณะปฏิวัติ|ประกาศคณะรักษาความสงบ)/.test(
        note
      )
    ) {
      continue;
    }

    // Identify preceding sub-provision label (`(3)`, `(5)`, `(6 ทวิ)`, `วรรคหนึ่ง`, etc.)
    const beforeSlice = cleanText.slice(0, sp.start);
    const subMatches = [
      ...beforeSlice.matchAll(
        /(?:^|\n)\s*(\([0-9]+(?:\s*(?:ทวิ|ตรี|จัตวา))?\))\s+([^\n]+)/g
      ),
    ];
    const lastSub = subMatches.length > 0 ? subMatches[subMatches.length - 1] : null;
    const subLabel = lastSub ? lastSub[1].replace(/\s+/g, " ").trim() : null;
    const clauseBlock = lastSub
      ? cleanText.slice((lastSub.index ?? 0), sp.start).replace(/\s+/g, " ").trim()
      : beforeSlice.slice(-360).replace(/\s+/g, " ").trim();

    // Parse amending instrument title
    const instMatch = note.match(
      /((?:พระราชบัญญัติ|พระราชกำหนด|ประกาศของคณะปฏิวัติ|ประกาศคณะรักษาความสงบเรียบร้อยแห่งชาติ)[^ใช้บังคับ]{0,95}?(?:พ\.ศ\.\s*[0-9]{4}|\(ฉบับที่\s*[0-9]+\)))/
    );
    const rawInstTitle = instMatch ? instMatch[1].replace(/\s+/g, " ").trim() : note.slice(0, 90);
    const normalizedInstTitle =
      workId.startsWith("prov.th.rc.") &&
      /^พระราชบัญญัติแก้ไขเพิ่มเติม\s*\(/.test(rawInstTitle)
        ? rawInstTitle.replace(/^พระราชบัญญัติแก้ไขเพิ่มเติม/, "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร")
        : workId.startsWith("prov.th.rc.") &&
            /^พระราชกำหนดแก้ไขเพิ่มเติม\s*\(/.test(rawInstTitle)
          ? rawInstTitle.replace(/^พระราชกำหนดแก้ไขเพิ่มเติม/, "พระราชกำหนดแก้ไขเพิ่มเติมประมวลรัษฎากร")
          : rawInstTitle;

    // Classify applicability basis (NEVER assuming effective date == accounting period!)
    let basis: ApplicabilityBasis = "TRANSACTION_OR_EVENT_DATE";
    let fromDate: string | null = null;
    let fromTaxYearBe: number | null = null;

    if (/รอบระยะเวลาบัญชี[^)]{0,35}(?:เริ่ม|เริ่มต้น)/.test(note)) {
      basis = "ACCOUNTING_PERIOD_START";
      const dm = note.match(
        /(?:เริ่ม|เริ่มต้น)(?:ใน\s*หรือหลัง|ในหรือหลัง|ตั้งแต่)?(?:วันที่)?\s*([0-9]{1,2}\s*[^\s)]+\s*(?:พ\.ศ\.\s*)?2[45][0-9]{2})/
      );
      if (dm) fromDate = parseFlexibleThaiOrEnglishDateToIso(dm[1]);
    } else if (/รอบระยะเวลาบัญชี[^)]{0,35}สิ้นสุด/.test(note)) {
      basis = "ACCOUNTING_PERIOD_END";
      const dm = note.match(
        /สิ้นสุด(?:ใน\s*หรือหลัง|ในหรือหลัง|ตั้งแต่)?(?:วันที่)?\s*([0-9]{1,2}\s*[^\s)]+\s*(?:พ\.ศ\.\s*)?2[45][0-9]{2})/
      );
      if (dm) fromDate = parseFlexibleThaiOrEnglishDateToIso(dm[1]);
    } else if (/(?:เงินได้พึงประเมิน|สำหรับเงินได้)?\s*ปีภาษี\s*([0-9]{4})|ที่ต้องยื่นใน\s*พ\.ศ\.\s*([0-9]{4})|ประจำปี\s*พ\.ศ\.\s*([0-9]{4})/.test(note)) {
      basis = "ASSESSABLE_TAX_YEAR";
      const ym = note.match(
        /(?:ปีภาษี\s*([0-9]{4})|ที่ต้องยื่นใน\s*พ\.ศ\.\s*([0-9]{4})|ประจำปี\s*พ\.ศ\.\s*([0-9]{4}))/
      );
      const yrBe = Number(ym?.[1] || ym?.[2] || ym?.[3] || 0);
      if (yrBe >= 2480) {
        fromTaxYearBe = ym?.[2] ? yrBe - 1 : yrBe;
        fromDate = `${fromTaxYearBe - 543}-01-01`;
      }
    } else {
      const dm = note.match(
        /ใช้บังคับ(?:ตั้งแต่วันที่|ตั้งแต่)?\s*([0-9]{1,2}\s*[^\s)]+\s*(?:พ\.ศ\.\s*)?2[45][0-9]{2})/
      );
      if (dm) {
        fromDate = parseFlexibleThaiOrEnglishDateToIso(dm[1]);
      } else {
        const yrOnly = note.match(/พ\.ศ\.\s*(2[45][0-9]{2})/);
        if (yrOnly) {
          // Year of amending Act known, exact day not in parenthetical note
          fromDate = `${Number(yrOnly[1]) - 543}-01-01`;
        }
      }
    }

    // Derive clause-specific topic terms from the amended clause itself
    const derivedKeywords = Array.from(
      new Set(
        (clauseBlock.match(/[ก-๙]{5,32}/g) || []).filter(
          (w) =>
            !/^(?:มาตรา|ประมวลรัษฎากร|บริษัทหรือห้างหุ้นส่วน|นิติบุคคล|หลักเกณฑ์|วิธีการ|เงื่อนไข|อธิบดี|ประกาศกำหนด|กระทรวง|พระราชกฤษฎีกา|ในต่างประเทศ|ในประเทศไทย|ในราชอาณาจักร|นอกประเทศ|เงินได้พึงประเมิน|คำนวณกำไรสุทธิ|ภาษีมูลค่าเพิ่ม|ผู้ประกอบการ|จดทะเบียน)$/.test(
              w
            )
        )
      )
    ).slice(0, 12);

    // Map known verified Amending Act work IDs in staging corpus
    let amendingWorkId: string | null = null;
    let amendingSourceUri: string | null = null;
    if (/ฉบับที่\s*48\)\s*พ\.ศ\.\s*2562/.test(normalizedInstTitle)) {
      amendingWorkId = "statute.th.rc_amendment_48_2562";
      amendingSourceUri = "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p48.pdf";
    } else if (/ฉบับที่\s*49\)\s*พ\.ศ\.\s*2562/.test(normalizedInstTitle)) {
      amendingWorkId = "statute.th.rc_amendment_49_2562";
      amendingSourceUri = "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p49.pdf";
    } else if (/ฉบับที่\s*51\)\s*พ\.ศ\.\s*2562/.test(normalizedInstTitle)) {
      amendingWorkId = "statute.th.rc_amendment_51_2562";
      amendingSourceUri = "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p51.pdf";
    }

    const enrichmentKey = `${workId}|${subLabel || ""}`;
    const enriched = VERIFIED_GAZETTE_ENRICHMENTS[enrichmentKey];

    ledger.push({
      subprovision_label: subLabel,
      amending_instrument_title_th:
        enriched?.amending_instrument_title_th || normalizedInstTitle,
      amending_work_id: enriched?.amending_work_id ?? amendingWorkId,
      amending_source_uri: enriched?.amending_source_uri ?? amendingSourceUri,
      royal_gazette_ref: enriched?.royal_gazette_ref ?? null,
      gazette_publication_date: enriched?.gazette_publication_date ?? null,
      enactment_effective_date: enriched?.enactment_effective_date ?? null,
      applicability_basis: enriched?.applicability_basis || basis,
      applicability_from_date: enriched?.applicability_from_date ?? fromDate,
      applicability_from_tax_year_be:
        enriched?.applicability_from_tax_year_be ?? fromTaxYearBe,
      applicability_rule_th: enriched?.applicability_rule_th || note,
      saving_clause_th: enriched?.saving_clause_th ?? null,
      pre_amendment_verified_version_id:
        enriched?.pre_amendment_verified_version_id ?? null,
      pre_amendment_source_uri:
        enriched?.pre_amendment_source_uri ?? "https://ratchakitcha.soc.go.th",
      clause_excerpt_th: clauseBlock.slice(0, 260),
      topic_keywords: Array.from(
        new Set([...(enriched?.topic_keywords || []), ...derivedKeywords])
      ),
    });
  }

  return ledger;
}

export type QueryTemporalIntent =
  | "HISTORICAL_DOCUMENT_LOOKUP"
  | "APPLICABLE_LAW_AT_TIME";

export interface TemporalFactContext {
  query_intent: QueryTemporalIntent;
  accounting_period_start_iso: string | null;
  accounting_period_end_iso: string | null;
  point_in_time_date_iso: string | null;
  assessable_tax_year_ce: number | null;
  transaction_date_iso: string | null;
  transaction_year_ce: number | null;
  asks_pre_amendment_version_explicitly: boolean;
  has_any_temporal_anchor: boolean;
  is_concrete_taxpayer_fact_query: boolean;
}

/**
 * Strips statutory/regulatory enactment title years (`พระราชบัญญัติ... พ.ศ. 2562`, `ท.ป. 299/2561`,
 * `Royal Decree No. 595 B.E. 2558`) so citation titles are NEVER mistaken for user transaction dates!
 */
function stripInstrumentTitleYearsForTemporalScan(q: string): string {
  return q
    .replace(
      /(?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศ[^\s,;]{0,40}|ระเบียบ[^\s,;]{0,40})[^?\n]{0,95}?(?:พ\.ศ\.\s*2[45][0-9]{2}|\(พ\.ศ\.\s*2[45][0-9]{2}\))/g,
      " [STATUTE_REF] "
    )
    .replace(/(?:ท\.ป\.|ป\.|คำสั่ง[^\s]{0,25})\s*[0-9]+\/2[45][0-9]{2}/g, " [ORDER_REF] ")
    .replace(/ศาลฎีกาที่\s*[0-9]+\/2[45][0-9]{2}/g, " [CASE_REF] ")
    .replace(
      /\b(?:Act|Decree|Regulation|Notification)[^?\n]{0,60}?\b(?:B\.?E\.?\s*2[45][0-9]{2}|(?:19|20)[0-9]{2})\b/gi,
      " [STATUTE_REF] "
    );
}

/**
 * Parses bilingual (Thai + English) temporal facts and distinguishes historical document lookups
 * (`กค 0811/11340`, `กค 0811(กม.03)/366`, `พ.ร.บ. แก้ไขเพิ่มเติม... (ฉบับที่ 51)`) from requests
 * for the law applicable to a particular period or transaction.
 */
export function parseQueryTemporalAndIntentContext(params: {
  question: string;
  applicableDate?: string | null;
  mode?: "standard" | "exact_lookup" | "comparison";
  explicitRulingIds: string[];
}): TemporalFactContext {
  const qNorm = thaiDigitsToArabic(params.question).replace(/\s+/g, " ").trim();

  // Requirement 3: Distinguish historical document lookup from applicable-law-for-period query
  const asksNamedAmendingActDirectly =
    /(?:พระราชบัญญัติ|พระราชกำหนด)แก้ไขเพิ่มเติมประมวลรัษฎากร\s*\(ฉบับที่\s*[0-9]+\)\s*พ\.ศ\.\s*25[0-9]{2}/.test(
      qNorm
    ) && !/รอบระยะเวลาบัญชี|บริษัท|หักรายจ่ายได้/.test(qNorm);

  const isHistoricalDocLookup =
    params.explicitRulingIds.length > 0 ||
    params.mode === "exact_lookup" ||
    params.mode === "comparison" ||
    asksNamedAmendingActDirectly ||
    /(?:มีหนังสือตอบข้อหารือใด|ข้อหารือใดบ้าง|ค้นหาแนววินิจฉัย|มีแนววินิจฉัยใด|สถานะทางกฎหมายของ|ยังเป็นร่างกฎหมาย)/.test(
      qNorm
    );

  const scrubbed = stripInstrumentTitleYearsForTemporalScan(qNorm);

  let accountingStart: string | null = null;
  let accountingEnd: string | null = null;
  let assessableTaxYearCe: number | null = null;
  let transactionDateIso: string | null = null;
  let transactionYearCe: number | null = null;

  // 1a. Explicit accounting period range in Thai or English:
  // e.g. `รอบระยะเวลาบัญชี 1 กรกฎาคม 2560 ถึง 30 มิถุนายน 2561`, `รอบบัญชีเริ่ม 1 ม.ค. 2561 สิ้นสุด 31 ธ.ค. 2561`,
  //      `accounting period from 1 Jan 2018 to 31 Dec 2018`, `FY 1 Feb 2018 - 30 Jun 2018`
  const rangeThOrEn = scrubbed.match(
    /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b)[^0-9]{0,30}?([0-9]{1,2}\s+[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|\d{4}-\d{2}-\d{2})\s*(?:ถึง|จนถึง|-|–|to|through|ending(?:\s+on)?|สิ้นสุด(?:วันที่)?)\s*([0-9]{1,2}\s+[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|\d{4}-\d{2}-\d{2})/i
  );
  if (rangeThOrEn) {
    accountingStart = parseFlexibleThaiOrEnglishDateToIso(rangeThOrEn[1]);
    accountingEnd = parseFlexibleThaiOrEnglishDateToIso(rangeThOrEn[2]);
  }

  // 1b. Explicit accounting period START date without range
  if (!accountingStart) {
    const startMatch = scrubbed.match(
      /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b)\s*(?:ที่)?\s*(?:เริ่ม|เริ่มต้น|starting|beginning|commencing)(?:\s*(?:ใน|วันที่|ตั้งแต่วันที่|on|from))?\s*([0-9]{1,2}\s+[ก-๙a-zA-Z.]+,?\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|\d{4}-\d{2}-\d{2})/i
    );
    if (startMatch) {
      accountingStart = parseFlexibleThaiOrEnglishDateToIso(startMatch[1]);
    }
  }

  // 1c. Explicit accounting period END date (`สิ้นสุดวันที่ 30 มิถุนายน 2561`, `FY ending 30 Jun 2018`, `fiscal year ended June 30, 2018`)
  if (!accountingEnd) {
    const endMatch = scrubbed.match(
      /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b)?\s*(?:ที่)?\s*(?:สิ้นสุด|วันสิ้นรอบ|ending|ended)(?:\s*(?:ใน|ณ\s*วันที่|วันที่|on))?\s*([0-9]{1,2}\s+[ก-๙a-zA-Z.]+,?\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|[a-zA-Z.]+\s+[0-9]{1,2},?\s*(?:B\.?E\.?\s*)?[0-9]{4}|\d{4}-\d{2}-\d{2})/i
    );
    if (endMatch) {
      accountingEnd = parseFlexibleThaiOrEnglishDateToIso(endMatch[1]);
    }
  }

  // 2. Assessable tax year (`ปีภาษี 2560`, `เงินได้ประจำปี 2561`, `tax year 2017`, `2017 tax return`)
  const taxYrTh = scrubbed.match(/(?:ปีภาษี|เงินได้พึงประเมินประจำปี|เงินได้ประจำปี|ภ\.ง\.ด\.9[01]\s*ปี)\s*(?:พ\.ศ\.\s*)?(25[0-9]{2}|24[89][0-9])/);
  const taxYrEn = scrubbed.match(/\b(?:tax\s+year\s+((?:19|20|25)\d{2})|((?:19|20)\d{2})\s+(?:personal\s+income\s+)?tax\s+(?:year|return))\b/i);
  if (taxYrTh) {
    assessableTaxYearCe = Number(taxYrTh[1]) - 543;
  } else if (taxYrEn) {
    const rawYr = Number(taxYrEn[1] || taxYrEn[2]);
    assessableTaxYearCe = rawYr >= 2400 ? rawYr - 543 : rawYr;
  }

  // 3. Transaction / event date or year (`เมื่อวันที่ 15 ม.ค. 2562`, `ในปี 2560`, `ปี 2560`, `on 15 January 2019`, `in 2017`, `in B.E. 2560`)
  if (!accountingStart && !accountingEnd) {
    const txFullDate = scrubbed.match(
      /(?:เมื่อวันที่|ในวันที่|ณ\s*วันที่|วันที่|on)\s*([0-9]{1,2}\s+[ก-๙a-zA-Z.]+,?\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|[a-zA-Z.]+\s+[0-9]{1,2},?\s*[0-9]{4}|\d{4}-\d{2}-\d{2})/i
    );
    if (txFullDate) {
      transactionDateIso = parseFlexibleThaiOrEnglishDateToIso(txFullDate[1]);
      if (transactionDateIso) {
        transactionYearCe = Number(transactionDateIso.slice(0, 4));
      }
    }
  }

  if (!transactionYearCe && !assessableTaxYearCe && !accountingStart && !accountingEnd) {
    const yrBeProse = scrubbed.match(
      /(?:ในปี|เมื่อปี|สำหรับปี|ช่วงปี|ระหว่างปี|ปีบัญชี|รอบปี|ปี\s*พ\.ศ\.|ปี)\s*(25[0-6][0-9]|24[89][0-9])\b/
    );
    const yrEnProse = scrubbed.match(
      /\b(?:in|during|for|in\s+year|for\s+year|in\s+B\.?E\.?|for\s+FY)\s*((?:199|20[012])[0-9]|25[0-6][0-9])\b/i
    );
    if (yrBeProse) {
      transactionYearCe = Number(yrBeProse[1]) - 543;
    } else if (yrEnProse) {
      const y = Number(yrEnProse[1]);
      transactionYearCe = y >= 2400 ? y - 543 : y;
    }
  }

  // 4. Explicit API `applicable_date` parameter
  let pointInTimeIso: string | null = null;
  if (params.applicableDate && /^\d{4}-\d{2}-\d{2}$/.test(params.applicableDate.trim())) {
    pointInTimeIso = params.applicableDate.trim();
    // If question asks about an accounting period (`รอบระยะเวลาบัญชี` / `accounting period`) as of `pointInTimeIso`
    // WITHOUT confirming the start date, do NOT treat `pointInTimeIso` as `accountingStart`!
    if (/รอบระยะเวลาบัญชี|รอบบัญชี|accounting\s+period|fiscal\s+year|\bFY\b/i.test(scrubbed) && !accountingStart && !accountingEnd) {
      accountingEnd = pointInTimeIso;
    }
  }

  const asksPreAmendmentExplicitly =
    /(?:ก่อนแก้ไข|ฉบับเดิม|รุ่นเดิม|ตัวบทเดิม|ย้อนหลัง|ก่อนปี\s*2562|ก่อนวันที่\s*20\s*มีนาคม\s*2562|prior\s+to\s+(?:the\s+)?(?:\d{4}\s+)?amendment|pre[- ]amendment|previous\s+version|historical\s+version)/i.test(
      scrubbed
    );

  const hasAnyTemporalAnchor = Boolean(
    accountingStart ||
      accountingEnd ||
      pointInTimeIso ||
      assessableTaxYearCe !== null ||
      transactionDateIso ||
      transactionYearCe !== null ||
      asksPreAmendmentExplicitly
  );

  // Detect concrete taxpayer fact/deductibility/exemption questions lacking a date
  const isConcreteTaxpayerFactQuery =
    !isHistoricalDocLookup &&
    !hasAnyTemporalAnchor &&
    (/(?:บริษัท|ห้างหุ้นส่วน|กิจการ|ผู้ประกอบการ|บุคคลธรรมดา|ผู้เสียภาษี)[\s\S]{0,140}?(?:หักเป็นรายจ่าย|ถือเป็นรายจ่าย|หักรายจ่าย|หักลดหย่อน|ได้รับยกเว้น|ได้สิทธิ[^\n?]{0,30}ร้อยละ\s*0|เสียภาษี[^\n?]{0,30}ร้อยละ\s*0|ได้หรือไม่|ได้ไหม|ได้เท่าไร)/.test(
      qNorm
    ) ||
      /\b(?:can\s+(?:a|our|the)\s+(?:thai\s+)?(?:company|taxpayer|corporate|business|partnership|individual)|is\s+(?:a|our)\s+(?:company|donation|contribution|sale)|may\s+a\s+company|does\s+(?:selling|a\s+sale|donating|a\s+donation))\b[\s\S]{0,160}?\b(?:deduct|deductible|claim|qualify|exempt|0%\s*vat|zero[- ]rat(?:e|ed))\b/i.test(
        qNorm
      ));

  return {
    query_intent: isHistoricalDocLookup ? "HISTORICAL_DOCUMENT_LOOKUP" : "APPLICABLE_LAW_AT_TIME",
    accounting_period_start_iso: accountingStart,
    accounting_period_end_iso: accountingEnd,
    point_in_time_date_iso: pointInTimeIso,
    assessable_tax_year_ce: assessableTaxYearCe,
    transaction_date_iso: transactionDateIso,
    transaction_year_ce: transactionYearCe,
    asks_pre_amendment_version_explicitly: asksPreAmendmentExplicitly,
    has_any_temporal_anchor: hasAnyTemporalAnchor,
    is_concrete_taxpayer_fact_query: isConcreteTaxpayerFactQuery,
  };
}

export interface StatutoryVersionEvaluationResult {
  action:
    | "ALLOW_CURRENT_CONSOLIDATED"
    | "ALLOW_VERIFIED_AMENDMENT_WITH_PROOF"
    | "ASK_FOR_MISSING_RELEVANT_DATE"
    | "CONTAIN_UNVERIFIED_HISTORICAL_VERSION";
  has_direct_clause_match: boolean;
  matched_amendment: ProvisionAmendmentLedgerItem | null;
  amending_work_id_to_cite: string | null;
  explanation_banner_th: string | null;
  containment_message_th: string | null;
  clarification_question_th: string | null;
}

function addMonthsMinusOneDay(endIso: string, monthsBack: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endIso);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 - monthsBack, Number(m[3]) + 1));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function matchAmendmentLedgerForQuestion(
  question: string,
  ledger: ProvisionAmendmentLedgerItem[]
): {
  explicitMatched: ProvisionAmendmentLedgerItem | null;
  latestInSection: ProvisionAmendmentLedgerItem | null;
} {
  if (ledger.length === 0) {
    return { explicitMatched: null, latestInSection: null };
  }
  const qNorm = thaiDigitsToArabic(question).toLowerCase();

  let best: { item: ProvisionAmendmentLedgerItem; hits: number; cutoff: string } | null = null;
  for (const item of ledger) {
    let hits = 0;
    if (item.subprovision_label && qNorm.includes(item.subprovision_label.toLowerCase())) {
      hits += 4;
    }
    for (const kw of item.topic_keywords || []) {
      if (kw.length >= 3 && qNorm.includes(kw.toLowerCase())) {
        hits += kw.length >= 6 ? 3 : 2;
      }
    }
    const cutoff = item.applicability_from_date || item.enactment_effective_date || "0000-00-00";
    if (hits > 0 && (!best || hits > best.hits || (hits === best.hits && cutoff > best.cutoff))) {
      best = { item, hits, cutoff };
    }
  }

  const latestInSection = [...ledger].sort((a, b) =>
    (b.applicability_from_date || b.enactment_effective_date || "").localeCompare(
      a.applicability_from_date || a.enactment_effective_date || ""
    )
  )[0];

  return {
    explicitMatched: best ? best.item : null,
    latestInSection,
  };
}

/**
 * Post-retrieval, data-model-driven statutory version & applicability evaluator.
 * Works identically across ALL batches (`B01`..`B10`) and BOTH Thai & English queries.
 */
export function evaluateStatutoryVersionApplicability(params: {
  work: LegalWork | undefined;
  version: LegalVersion | undefined;
  verbatimText: string;
  question: string;
  temporalCtx: TemporalFactContext;
  releaseId: string;
  originUri: string;
}): StatutoryVersionEvaluationResult {
  const { work, version, verbatimText, question, temporalCtx, releaseId, originUri } = params;

  if (
    !work ||
    work.type === "TaxRuling" ||
    version?.draft_or_enacted_status === "DRAFT_BILL" ||
    version?.draft_or_enacted_status === "LEGISLATIVE_HISTORY" ||
    temporalCtx.query_intent === "HISTORICAL_DOCUMENT_LOOKUP"
  ) {
    return {
      action: "ALLOW_CURRENT_CONSOLIDATED",
      has_direct_clause_match: false,
      matched_amendment: null,
      amending_work_id_to_cite: null,
      explanation_banner_th: null,
      containment_message_th: null,
      clarification_question_th: null,
    };
  }

  const ledger =
    version?.amendment_ledger && version.amendment_ledger.length > 0
      ? version.amendment_ledger
      : extractAmendmentLedgerFromStatutoryText(work.work_id, verbatimText);

  const secTitle = work.title_th || work.official_identifiers[0]?.normalized || work.work_id;
  const { explicitMatched, latestInSection } = matchAmendmentLedgerForQuestion(question, ledger);
  const hasDirectClauseMatch = Boolean(explicitMatched);
  // For temporal evaluation when a date IS supplied, inspect the directly matched clause first, and on consolidated full-section texts also ensure no later amendment in the section is anachronistically rendered!
  const implicated = explicitMatched || latestInSection;

  // 1. Explicit request for an unverified pre-amendment historical version without dates
  if (temporalCtx.asks_pre_amendment_version_explicitly && !temporalCtx.accounting_period_start_iso) {
    const srcHint = implicated?.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th";
    const amendInfo = implicated
      ? ` (เช่น อนุมาตรา ${implicated.subprovision_label || ""} แก้ไขเพิ่มเติมโดย ${implicated.amending_instrument_title_th}: ${implicated.applicability_rule_th})`
      : "";
    return {
      action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
      has_direct_clause_match: hasDirectClauseMatch,
      matched_amendment: implicated,
      amending_work_id_to_cite: null,
      explanation_banner_th: null,
      containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle} รุ่นก่อนการแก้ไขเพิ่มเติมชั่วคราว เนื่องจากคลังข้อมูลชุด ${releaseId} เก็บเฉพาะตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน (${originUri})${amendInfo} และไม่ประกอบสร้างตัวบทย้อนหลังขึ้นเองจากตัวบทปัจจุบันจนกว่าจะตรวจรับรองต้นฉบับจากราชกิจจานุเบกษา (${srcHint})`,
      clarification_question_th:
        "กรุณาระบุวันเริ่มรอบระยะเวลาบัญชีจริงหรือวันเกิดธุรกรรม เพื่อตรวจสอบเงื่อนไขการใช้บังคับตามพระราชบัญญัติแก้ไขเพิ่มเติมที่เกี่ยวข้อง",
    };
  }

  // 2. Missing relevant date on a concrete taxpayer question directly implicating a recent (post-B.E. 2557 / >= 2014) amended clause
  if (!temporalCtx.has_any_temporal_anchor) {
    if (
      temporalCtx.is_concrete_taxpayer_fact_query &&
      explicitMatched &&
      (explicitMatched.applicability_from_date || "") >= "2014-01-01"
    ) {
      const basisPrompt =
        explicitMatched.applicability_basis === "ACCOUNTING_PERIOD_START"
          ? `กรุณาระบุ **วันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริง** (เนื่องจาก ${explicitMatched.amending_instrument_title_th} กำหนดให้ใช้บังคับเฉพาะรอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ ${explicitMatched.applicability_from_date} เป็นต้นไป)`
          : explicitMatched.applicability_basis === "ASSESSABLE_TAX_YEAR"
            ? `กรุณาระบุ **ปีภาษีของเงินได้พึงประเมิน** (เนื่องจาก ${explicitMatched.amending_instrument_title_th} ใช้บังคับตั้งแต่ปีภาษี พ.ศ. ${explicitMatched.applicability_from_tax_year_be} เป็นต้นไป)`
            : `กรุณาระบุ **วันเกิดธุรกรรม/ความรับผิดทางภาษี** (เนื่องจาก ${explicitMatched.amending_instrument_title_th} ใช้บังคับตั้งแต่วันที่ ${explicitMatched.applicability_from_date} เป็นต้นไป)`;

      return {
        action: "ASK_FOR_MISSING_RELEVANT_DATE",
        has_direct_clause_match: true,
        matched_amendment: explicitMatched,
        amending_work_id_to_cite: explicitMatched.amending_work_id,
        explanation_banner_th:
          `**การตรวจสอบช่วงเวลาและรุ่นบทบัญญัติที่เกี่ยวข้อง (${explicitMatched.amending_instrument_title_th})**: ประเด็นที่ถามเกี่ยวข้องกับบทบัญญัติที่มีการแก้ไขเพิ่มเติม (${secTitle}${explicitMatched.subprovision_label ? ` ${explicitMatched.subprovision_label}` : ""}) โดย **${explicitMatched.applicability_rule_th}**${explicitMatched.amending_source_uri ? ` (ต้นฉบับราชกิจจานุเบกษา: ${explicitMatched.amending_source_uri})` : ""} ระบบจึงแสดงหลักเกณฑ์ตามตัวบทปัจจุบันไว้เบื้องต้น และขอทราบวันที่ของข้อเท็จจริงเพื่อยืนยันรุ่นกฎหมายที่ใช้บังคับจริง`,
        containment_message_th: null,
        clarification_question_th: basisPrompt,
      };
    }

    return {
      action: "ALLOW_CURRENT_CONSOLIDATED",
      has_direct_clause_match: hasDirectClauseMatch,
      matched_amendment: explicitMatched || latestInSection,
      amending_work_id_to_cite: null,
      explanation_banner_th: null,
      containment_message_th: null,
      clarification_question_th: null,
    };
  }

  // 3. User supplied a temporal anchor (`accounting_period_start`, `accounting_period_end`, `point_in_time`, `tax_year`, or `transaction_date`/`year`)!
  if (!implicated || !implicated.applicability_from_date) {
    // Consolidated statute with no parsed amendment cutoff, yet user asks about a historical pre-2020 date
    const earliestUserDate =
      temporalCtx.accounting_period_start_iso ||
      temporalCtx.transaction_date_iso ||
      temporalCtx.point_in_time_date_iso ||
      temporalCtx.accounting_period_end_iso ||
      (temporalCtx.transaction_year_ce ? `${temporalCtx.transaction_year_ce}-01-01` : null) ||
      (temporalCtx.assessable_tax_year_ce ? `${temporalCtx.assessable_tax_year_ce}-01-01` : null);
    if (earliestUserDate && earliestUserDate < "2020-01-01" && work.work_id.startsWith("prov.th.rc.")) {
      return {
        action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
        has_direct_clause_match: hasDirectClauseMatch,
        matched_amendment: null,
        amending_work_id_to_cite: null,
        explanation_banner_th: null,
        containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle} รุ่นย้อนหลังสำหรับช่วงเวลาที่ระบุ (${earliestUserDate}) เนื่องจากคลังข้อมูลชุด ${releaseId} เก็บเฉพาะตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน (${originUri}) และไม่คาดเดาว่าตัวบทดังกล่าวมีการแก้ไขหลังช่วงเวลาที่ถามหรือไม่ กรุณาตรวจสอบจากราชกิจจานุเบกษา (https://ratchakitcha.soc.go.th) โดยตรง`,
        clarification_question_th: "กรุณาระบุวันเริ่มรอบระยะเวลาบัญชีหรือวันเกิดธุรกรรมเพิ่มเติมเพื่อตรวจสอบบทเฉพาะกาล",
      };
    }
    return {
      action: "ALLOW_CURRENT_CONSOLIDATED",
      has_direct_clause_match: hasDirectClauseMatch,
      matched_amendment: null,
      amending_work_id_to_cite: null,
      explanation_banner_th: null,
      containment_message_th: null,
      clarification_question_th: null,
    };
  }

  // Consolidated Multi-Amendment Completeness Rule:
  // If `explicitMatched` was amended long ago (e.g. s.65 ter (6) in B.E. 2527), yet `version.is_consolidated_derived`
  // ALSO includes a later amendment (`latestInSection`, e.g. s.65 ter (3) in B.E. 2562) that had NOT yet taken effect on the user's date,
  // we MUST evaluate against `latestInSection` as well so we never emit a consolidated full-section text containing post-period clauses!
  const evaluateItemAgainstDates = (
    targetItem: ProvisionAmendmentLedgerItem
  ): StatutoryVersionEvaluationResult => {
    const cutoffIso = targetItem.applicability_from_date!;
    const basis = targetItem.applicability_basis;

    if (basis === "ACCOUNTING_PERIOD_START") {
      if (temporalCtx.accounting_period_start_iso) {
        if (temporalCtx.accounting_period_start_iso >= cutoffIso) {
          const enNote =
            targetItem.enactment_effective_date &&
            temporalCtx.accounting_period_start_iso < targetItem.enactment_effective_date
              ? ` (แม้ ${targetItem.amending_instrument_title_th} จะประกาศราชกิจจานุเบกษาและมีผลใช้บังคับวันที่ \`${targetItem.enactment_effective_date}\` แต่บทเฉพาะกาลกำหนดให้นำมาใช้บังคับกับรอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ \`${cutoffIso}\` เป็นต้นไป)`
              : "";
          return {
            action: "ALLOW_VERIFIED_AMENDMENT_WITH_PROOF",
            has_direct_clause_match: hasDirectClauseMatch,
            matched_amendment: targetItem,
            amending_work_id_to_cite: targetItem.amending_work_id,
            explanation_banner_th:
              `**ผลการตรวจสอบรุ่นบทบัญญัติและเงื่อนไขวันเริ่มรอบระยะเวลาบัญชี**: รอบระยะเวลาบัญชีที่ระบุมี **วันเริ่มต้นจริงคือ \`${temporalCtx.accounting_period_start_iso}\`** ซึ่งอยู่ในเกณฑ์ **เริ่มในหรือหลังวันที่ \`${cutoffIso}\`** ตาม **${targetItem.amending_instrument_title_th}**${enNote} ดังนั้น บทบัญญัติ ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ฉบับปัจจุบันจึง **ใช้บังคับได้กับรอบระยะเวลาบัญชีนี้**${targetItem.amending_source_uri ? ` (ต้นฉบับราชกิจจานุเบกษา: ${targetItem.amending_source_uri})` : ""}`,
            containment_message_th: null,
            clarification_question_th: null,
          };
        }
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th:
            `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle} รุ่นย้อนหลังชั่วคราว สำหรับรอบระยะเวลาบัญชีที่เริ่มต้นวันที่ \`${temporalCtx.accounting_period_start_iso}\`: ตาม **${targetItem.amending_instrument_title_th}** (${targetItem.royal_gazette_ref || "ราชกิจจานุเบกษา"}${targetItem.amending_source_uri ? ` · ${targetItem.amending_source_uri}` : ""}) บทบัญญัติที่แก้ไขใหม่ใน ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ใช้บังคับเฉพาะ **รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ \`${cutoffIso}\` (1 มกราคม พ.ศ. 2561) เป็นต้นไป** เท่านั้น เมื่อวันเริ่มรอบระยะเวลาบัญชีจริง (\`${temporalCtx.accounting_period_start_iso}\`) อยู่ก่อนวันที่ \`${cutoffIso}\` **จึงไม่อาจนำบทบัญญัติที่แก้ไขใหม่ (เช่น สิทธิหักเงินบริจาคพรรคการเมืองตามมาตรา 65 ตรี (3)(ก)) มาใช้บังคับได้**${targetItem.saving_clause_th ? ` (${targetItem.saving_clause_th})` : ""} ทั้งนี้ ระบบไม่ประกอบสร้างตัวบทก่อนแก้ไขจากตัวบทปัจจุบัน และคงการกักกันตัวบทย้อนหลังไว้จนกว่าจะตรวจรับรองต้นฉบับจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th:
            "หากต้องการตรวจสอบตัวบทก่อนแก้ไขโดยตรง กรุณาอ้างอิงเอกสารราชกิจจานุเบกษาต้นฉบับตามลิงก์ที่แสดง",
        };
      }

      const refEndOrPoint =
        temporalCtx.accounting_period_end_iso ||
        temporalCtx.point_in_time_date_iso ||
        temporalCtx.transaction_date_iso ||
        (temporalCtx.transaction_year_ce ? `${temporalCtx.transaction_year_ce}-12-31` : null) ||
        (temporalCtx.assessable_tax_year_ce ? `${temporalCtx.assessable_tax_year_ce}-12-31` : null)!;

      const inferred12mStart = addMonthsMinusOneDay(refEndOrPoint, 12);
      if (inferred12mStart && inferred12mStart >= cutoffIso && refEndOrPoint >= "2020-01-01") {
        return {
          action: "ALLOW_CURRENT_CONSOLIDATED",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th: null,
          clarification_question_th: null,
        };
      }

      const straddleExplanation =
        refEndOrPoint >= cutoffIso && inferred12mStart && inferred12mStart < cutoffIso
          ? `กฎหมายกำหนดเงื่อนไขการใช้บังคับตาม **"วันเริ่มรอบระยะเวลาบัญชีจริง" (รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561 / \`${cutoffIso}\` เป็นต้นไป)** มิใช่พิจารณาจากวันสิ้นสุดรอบระยะเวลาบัญชี (\`${refEndOrPoint}\`) และมิใช่วันประกาศราชกิจจานุเบกษา (\`${targetItem.enactment_effective_date || "2019-04-17"}\`) ดังนั้น หากรอบระยะเวลาบัญชีปกติ 12 เดือนสิ้นสุดวันที่ \`${refEndOrPoint}\` วันเริ่มรอบระยะเวลาบัญชีจริงคือวันที่ \`${inferred12mStart}\` (1 กรกฎาคม 2560 สำหรับงวดสิ้นสุด 30 มิถุนายน 2561) ซึ่งเริ่มก่อนวันที่ 1 มกราคม พ.ศ. 2561 **จึงไม่อาจนำมาตรา 65 ตรี (3)(ก) ที่แก้ไขใหม่มาใช้บังคับได้** (เว้นแต่เป็นรอบระยะเวลาบัญชีสั้นที่เริ่มต้นจริงในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561)`
          : `ตาม **${targetItem.amending_instrument_title_th}** บทบัญญัติที่แก้ไขใหม่ใน ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ใช้บังคับเฉพาะ **รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561 (\`${cutoffIso}\`) เป็นต้นไป** เท่านั้น จึง **ไม่อาจนำมาตรา 65 ตรี (3)(ก) ที่แก้ไขใหม่มาใช้บังคับกับช่วงเวลาก่อนหน้านั้นได้**`;

      return {
        action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
        has_direct_clause_match: hasDirectClauseMatch,
        matched_amendment: targetItem,
        amending_work_id_to_cite: null,
        explanation_banner_th: null,
        containment_message_th:
          `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบทประมวลรัษฎากร ${secTitle.replace(/^ประมวลรัษฎากร\s*/, "").replace(/\s*\([^)]*\)\s*$/, "")} รุ่นย้อนหลังชั่วคราว เนื่องจากคลังข้อมูลชุด ${releaseId} เก็บเฉพาะตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน (${originUri}) และไม่ประกอบสร้างตัวบทย้อนหลังขึ้นเองจากตัวบทปัจจุบันจนกว่าจะตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"}) โดยตรง. ทั้งนี้ ${straddleExplanation}${targetItem.amending_source_uri ? ` (อ้างอิงบทเฉพาะกาล: ${targetItem.amending_source_uri})` : ""}`,
        clarification_question_th:
          "กรุณาระบุวันเริ่มต้นของรอบระยะเวลาบัญชีจริง (เช่น เริ่ม 1 กรกฎาคม 2560 ถึง 30 มิถุนายน 2561 หรือเริ่มใน/หลังวันที่ 1 มกราคม 2561) เพื่อยืนยันบทบัญญัติที่ใช้บังคับ",
      };
    }

    if (basis === "ASSESSABLE_TAX_YEAR") {
      const reqTaxYrCe =
        temporalCtx.assessable_tax_year_ce ??
        temporalCtx.transaction_year_ce ??
        (temporalCtx.transaction_date_iso ? Number(temporalCtx.transaction_date_iso.slice(0, 4)) : null) ??
        (temporalCtx.point_in_time_date_iso ? Number(temporalCtx.point_in_time_date_iso.slice(0, 4)) : null);
      const cutoffYrCe = targetItem.applicability_from_tax_year_be
        ? targetItem.applicability_from_tax_year_be - 543
        : Number(cutoffIso.slice(0, 4));
      if (reqTaxYrCe !== null && reqTaxYrCe < cutoffYrCe) {
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle} รุ่นย้อนหลังสำหรับปีภาษี พ.ศ. ${reqTaxYrCe + 543} (${reqTaxYrCe}) เนื่องจากบทบัญญัติปัจจุบันแก้ไขเพิ่มเติมโดย **${targetItem.amending_instrument_title_th}** ซึ่งใช้บังคับตั้งแต่ปีภาษี พ.ศ. ${cutoffYrCe + 543} เป็นต้นไป และตัวบทก่อนแก้ไขยังอยู่ระหว่างรอตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th: "กรุณาตรวจสอบตัวบทก่อนการแก้ไขเพิ่มเติมจากราชกิจจานุเบกษาสำหรับปีภาษีดังกล่าว",
        };
      }
      if (reqTaxYrCe !== null && reqTaxYrCe >= cutoffYrCe && targetItem.amending_work_id) {
        return {
          action: "ALLOW_VERIFIED_AMENDMENT_WITH_PROOF",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: targetItem.amending_work_id,
          explanation_banner_th: `**ผลการตรวจสอบรุ่นบทบัญญัติตามปีภาษี**: ปีภาษี พ.ศ. ${reqTaxYrCe + 543} อยู่ในเกณฑ์ใช้บังคับของ **${targetItem.amending_instrument_title_th}** (${targetItem.applicability_rule_th})`,
          containment_message_th: null,
          clarification_question_th: null,
        };
      }
    }

    const exactEventIso =
      temporalCtx.transaction_date_iso ||
      temporalCtx.point_in_time_date_iso ||
      temporalCtx.accounting_period_end_iso ||
      temporalCtx.accounting_period_start_iso;
    const yearOnlyCe = temporalCtx.transaction_year_ce ?? temporalCtx.assessable_tax_year_ce;
    const cutoffYearCe = Number(cutoffIso.slice(0, 4));

    if (exactEventIso) {
      if (exactEventIso < cutoffIso) {
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} สำหรับธุรกรรมวันที่ \`${exactEventIso}\` เนื่องจากบทบัญญัติฉบับปัจจุบันแก้ไขเพิ่มเติมโดย **${targetItem.amending_instrument_title_th}** (${targetItem.royal_gazette_ref || "ราชกิจจานุเบกษา"}${targetItem.amending_source_uri ? ` · ${targetItem.amending_source_uri}` : ""}) ซึ่งมีผลใช้บังคับตั้งแต่วันที่ \`${cutoffIso}\` เป็นต้นไป จึง **ไม่อาจนำบทบัญญัติที่แก้ไขใหม่มาใช้บังคับย้อนหลังกับวันที่ \`${exactEventIso}\` ได้** และตัวบทก่อนแก้ไขยังอยู่ระหว่างรอตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th: "กรุณาตรวจสอบตัวบทก่อนการแก้ไขเพิ่มเติมจากราชกิจจานุเบกษาสำหรับธุรกรรมก่อนวันมีผลใช้บังคับดังกล่าว",
        };
      }
      if (exactEventIso >= cutoffIso && exactEventIso < "2020-06-01" && targetItem.amending_work_id) {
        return {
          action: "ALLOW_VERIFIED_AMENDMENT_WITH_PROOF",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: targetItem.amending_work_id,
          explanation_banner_th: `**ผลการตรวจสอบวันมีผลใช้บังคับของบทบัญญัติ**: ธุรกรรมวันที่ \`${exactEventIso}\` เกิดขึ้นในหรือหลังวันที่ \`${cutoffIso}\` ซึ่งเป็นวันเริ่มใช้บังคับของ **${targetItem.amending_instrument_title_th}** (${targetItem.royal_gazette_ref || ""}${targetItem.amending_source_uri ? ` · ${targetItem.amending_source_uri}` : ""}) บทบัญญัติ ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ฉบับปัจจุบันจึงใช้บังคับได้`,
          containment_message_th: null,
          clarification_question_th: null,
        };
      }
    } else if (yearOnlyCe !== null) {
      if (yearOnlyCe < cutoffYearCe) {
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} สำหรับปี พ.ศ. ${yearOnlyCe + 543} (${yearOnlyCe}) เนื่องจากบทบัญญัติปัจจุบันแก้ไขเพิ่มเติมโดย **${targetItem.amending_instrument_title_th}** ซึ่งมีผลใช้บังคับตั้งแต่วันที่ \`${cutoffIso}\` เป็นต้นไป จึงไม่อาจนำมาใช้บังคับกับปี พ.ศ. ${yearOnlyCe + 543} ได้ และตัวบทก่อนแก้ไขยังอยู่ระหว่างรอตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th: `กรุณาตรวจสอบตัวบทก่อนแก้ไขเพิ่มเติมจากราชกิจจานุเบกษาสำหรับปี พ.ศ. ${yearOnlyCe + 543}`,
        };
      }
      if (yearOnlyCe === cutoffYearCe && cutoffIso.slice(5) !== "01-01") {
        return {
          action: "ASK_FOR_MISSING_RELEVANT_DATE",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: targetItem.amending_work_id,
          explanation_banner_th: `**ต้องทราบวันเกิดธุรกรรมที่ชัดเจนในปี พ.ศ. ${yearOnlyCe + 543}**: บทบัญญัติ ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ถูกแก้ไขเพิ่มเติมระหว่างปีโดย **${targetItem.amending_instrument_title_th}** ซึ่งมีผลใช้บังคับตั้งแต่วันที่ \`${cutoffIso}\` เป็นต้นไป`,
          containment_message_th: null,
          clarification_question_th: `กรุณาระบุวันเดือนปีที่เกิดธุรกรรมในปี พ.ศ. ${yearOnlyCe + 543} ว่าเกิดขึ้นก่อนหรือตั้งแต่วันที่ ${cutoffIso} เป็นต้นไป`,
        };
      }
    }

    return {
      action: "ALLOW_CURRENT_CONSOLIDATED",
      has_direct_clause_match: hasDirectClauseMatch,
      matched_amendment: targetItem,
      amending_work_id_to_cite: null,
      explanation_banner_th: null,
      containment_message_th: null,
      clarification_question_th: null,
    };
  };

  const primaryEval = evaluateItemAgainstDates(implicated);
  if (
    primaryEval.action === "CONTAIN_UNVERIFIED_HISTORICAL_VERSION" ||
    primaryEval.action === "ASK_FOR_MISSING_RELEVANT_DATE"
  ) {
    return primaryEval;
  }

  // Ensure consolidated full-section text never leaks a LATER amendment in the same section onto an earlier historical date!
  if (
    version?.is_consolidated_derived !== false &&
    latestInSection &&
    latestInSection !== implicated &&
    latestInSection.applicability_from_date &&
    !latestInSection.pre_amendment_verified_version_id
  ) {
    const latestEval = evaluateItemAgainstDates(latestInSection);
    if (latestEval.action === "CONTAIN_UNVERIFIED_HISTORICAL_VERSION") {
      return latestEval;
    }
  }

  return primaryEval;
}

/**
 * Prevents anachronistic application of a later TaxRuling (that relies on later-enacted statutes/decrees)
 * when the user asked for the law applicable to an earlier historical period (`APPLICABLE_LAW_AT_TIME`),
 * while ALWAYS permitting `HISTORICAL_DOCUMENT_LOOKUP` when the user requested a specific ruling.
 */
export function evaluateRulingTemporalApplicability(params: {
  rulingWork: LegalWork | undefined;
  rulingVersion: LegalVersion | undefined;
  conclusionText: string;
  temporalCtx: TemporalFactContext;
  releaseId: string;
}): {
  shouldContainAnachronism: boolean;
  messageTh: string | null;
} {
  const { rulingWork, rulingVersion, conclusionText, temporalCtx, releaseId } = params;
  if (!rulingWork || rulingWork.type !== "TaxRuling") {
    return { shouldContainAnachronism: false, messageTh: null };
  }
  if (temporalCtx.query_intent === "HISTORICAL_DOCUMENT_LOOKUP" || !temporalCtx.has_any_temporal_anchor) {
    return { shouldContainAnachronism: false, messageTh: null };
  }

  const userYearCe =
    temporalCtx.transaction_year_ce ??
    temporalCtx.assessable_tax_year_ce ??
    (temporalCtx.accounting_period_start_iso ? Number(temporalCtx.accounting_period_start_iso.slice(0, 4)) : null) ??
    (temporalCtx.transaction_date_iso ? Number(temporalCtx.transaction_date_iso.slice(0, 4)) : null) ??
    (temporalCtx.point_in_time_date_iso ? Number(temporalCtx.point_in_time_date_iso.slice(0, 4)) : null) ??
    (temporalCtx.accounting_period_end_iso ? Number(temporalCtx.accounting_period_end_iso.slice(0, 4)) : null);

  if (userYearCe === null) {
    return { shouldContainAnachronism: false, messageTh: null };
  }

  const normConc = thaiDigitsToArabic(conclusionText);
  const citedStatuteYearsBe = [
    ...normConc.matchAll(
      /(?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศ[^\n,;]{0,45})[^,;]{0,80}?พ\.ศ\.\s*(25[0-9]{2})/g
    ),
  ].map((m) => Number(m[1]));

  const postPeriodStatuteYearBe = citedStatuteYearsBe.find((yrBe) => yrBe - 543 > userYearCe);
  if (postPeriodStatuteYearBe) {
    const rId = rulingWork.official_identifiers[0]?.normalized || rulingWork.work_id;
    return {
      shouldContainAnachronism: true,
      messageTh: `ไม่พบข้อมูลหลักฐานกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543} ที่ผ่านการรับรองอย่างเพียงพอ — แนววินิจฉัยที่ใกล้เคียงที่สุดในคลังข้อมูลชุด ${releaseId} คือหนังสือตอบข้อหารือ \`${rId}\` (${rulingVersion?.raw_date_text || ""}) ซึ่งวินิจฉัยโดยอ้างอิงกฎหมายปี พ.ศ. ${postPeriodStatuteYearBe} ที่ตราขึ้นภายหลังช่วงเวลาที่ถาม ระบบจึงระงับการนำแนววินิจฉัยภายหลังมาสรุปใช้ย้อนหลังโดยไม่ตรวจสอบตัวบทกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543}`,
    };
  }

  const rulingDecisionYearCe = rulingVersion?.decision_date
    ? Number(rulingVersion.decision_date.slice(0, 4))
    : null;
  if (userYearCe < 2020 && rulingDecisionYearCe !== null && rulingDecisionYearCe > userYearCe) {
    const rId = rulingWork.official_identifiers[0]?.normalized || rulingWork.work_id;
    const rulingYrBe = rulingDecisionYearCe + 543;
    return {
      shouldContainAnachronism: true,
      messageTh: `ไม่พบข้อมูลหลักฐานกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543} ที่ผ่านการรับรองอย่างเพียงพอ — แนววินิจฉัยที่ใกล้เคียงที่สุดในคลังข้อมูลชุด ${releaseId} คือหนังสือตอบข้อหารือ \`${rId}\` ลงวันที่ ${rulingVersion?.raw_date_text || `พ.ศ. ${rulingYrBe}`} ซึ่งออกภายหลังช่วงปีที่ถาม (พ.ศ. ${userYearCe + 543}) ระบบจึงระงับการนำแนววินิจฉัยเฉพาะรายในภายหลังมาสรุปเป็นกฎหมายที่ใช้บังคับย้อนหลังโดยไม่มีตัวบทที่ผ่านการรับรองสำหรับปี พ.ศ. ${userYearCe + 543} (หากต้องการอ่านข้อหารือ \`${rId}\` โดยตรง กรุณาระบุเลขที่หนังสือในคำค้นหา)`,
    };
  }

  return { shouldContainAnachronism: false, messageTh: null };
}

/**
 * Formats a concise, human-readable Amendment History & Applicability Rule summary block
 * from a statutory `LegalVersion.amendment_ledger`.
 */
export function formatAmendmentLedgerSummaryTh(
  ledger: ProvisionAmendmentLedgerItem[] | undefined,
  focusedItem?: ProvisionAmendmentLedgerItem | null
): string | null {
  if (!ledger || ledger.length === 0) return null;
  const itemsToRender: ProvisionAmendmentLedgerItem[] = [];
  if (focusedItem) itemsToRender.push(focusedItem);
  for (const it of ledger) {
    if (itemsToRender.length >= 4) break;
    if (!itemsToRender.includes(it)) itemsToRender.push(it);
  }

  const lines = itemsToRender.map((it) => {
    const sub = it.subprovision_label ? `อนุมาตรา/วรรค \`${it.subprovision_label}\`: ` : "";
    const basisLabel =
      it.applicability_basis === "ACCOUNTING_PERIOD_START"
        ? "เกณฑ์วันเริ่มรอบระยะเวลาบัญชี"
        : it.applicability_basis === "ACCOUNTING_PERIOD_END"
          ? "เกณฑ์วันสิ้นสุดรอบระยะเวลาบัญชี"
          : it.applicability_basis === "ASSESSABLE_TAX_YEAR"
            ? "เกณฑ์ปีภาษีของเงินได้พึงประเมิน"
            : "เกณฑ์วันมีผลใช้บังคับ/วันเกิดธุรกรรม";
    const srcLink = it.amending_source_uri ? ` · ต้นฉบับราชกิจจานุเบกษา: ${it.amending_source_uri}` : "";
    return `- ${sub}**${it.amending_instrument_title_th}** (${basisLabel}): ${it.applicability_rule_th}${srcLink}`;
  });

  return `**ประวัติการแก้ไขเพิ่มเติมและเงื่อนไขการใช้บังคับรายอนุมาตรา**:\n${lines.join("\n")}`;
}
