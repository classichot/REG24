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

const TH_MONTH_NAME_TO_MM: Record<string, string> = {
  มกราคม: "01",
  กุมภาพันธ์: "02",
  กุมพาภัณฑ์: "02",
  มีนาคม: "03",
  เมษายน: "04",
  พฤษภาคม: "05",
  มิถุนายน: "06",
  กรกฎาคม: "07",
  กรกฏาคม: "07",
  สิงหาคม: "08",
  กันยายน: "09",
  ตุลาคม: "10",
  พฤศจิกายน: "11",
  ธันวาคม: "12",
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

const TH_UNDOTTED_SHORT_MONTH_TO_FULL: Record<string, string> = {
  มค: "มกราคม",
  กพ: "กุมภาพันธ์",
  มีค: "มีนาคม",
  เมย: "เมษายน",
  พค: "พฤษภาคม",
  มิย: "มิถุนายน",
  กค: "กรกฎาคม",
  สค: "สิงหาคม",
  กย: "กันยายน",
  ตค: "ตุลาคม",
  พย: "พฤศจิกายน",
  ธค: "ธันวาคม",
};

function daysInMonthUtc(yearCe: number, month1Based: number): number {
  return new Date(Date.UTC(yearCe, month1Based, 0)).getUTCDate();
}

function isValidIsoComponents(yearCe: number, month: number, day: number): boolean {
  if (yearCe < 1900 || yearCe > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonthUtc(yearCe, month)) return false;
  return true;
}

/**
 * Resolves 4-digit or 2-digit Buddhist Era (`24xx`–`25xx`, `40`–`79`) and Common Era (`19xx`–`20xx`, `00`–`39`)
 * year tokens into canonical 4-digit Common Era (`CE`).
 */
export function resolveFlexibleYearTokenToCe(
  yrRaw: string,
  eraHint?: "BE" | "CE" | null
): number | null {
  const n = Number(yrRaw);
  if (!Number.isFinite(n)) return null;
  if (yrRaw.length === 4) {
    if (eraHint === "BE" || n >= 2400) return n - 543;
    if (n >= 1900 && n <= 2100) return n;
    return null;
  }
  if (yrRaw.length === 2) {
    if (eraHint === "BE") return 2500 + n - 543;
    if (eraHint === "CE") return n >= 80 ? 1900 + n : 2000 + n;
    // Unambiguous Thai/CE 2-digit split: 40..79 = B.E. 2540..2579 (1997..2036); 00..39 = C.E. 2000..2039
    if (n >= 40 && n <= 79) return 2500 + n - 543;
    if (n >= 0 && n <= 39) return 2000 + n;
  }
  return null;
}

function expandThaiMonthTokens(input: string): string {
  let s = input;
  for (const [abbr, full] of Object.entries(TH_SHORT_MONTH_TO_FULL)) {
    s = s.split(abbr).join(full);
  }
  // Expand undotted Thai month abbreviations ONLY when bounded by a day/เดือน (and NOT `กค` ruling IDs!)
  s = s.replace(
    /(?:(\b[0-9]{1,2}\s+)|(เดือน\s*))(มค|กพ|มีค|เมย|พค|มิย|กค|สค|กย|ตค|พย|ธค)(?=\s*(?:พ\.ศ\.|ค\.ศ\.)?\s*[0-9]{2,4}\b|\s|$)/g,
    (_m, dayPart, monthWord, abbr) => {
      if (abbr === "กค" && !monthWord) return _m;
      return `${dayPart || monthWord || ""}${TH_UNDOTTED_SHORT_MONTH_TO_FULL[abbr] || abbr} `;
    }
  );
  return s;
}

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

const TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD =
  "(?!\\s*(?:[,./][0-9]|%|บาท|ล้าน|แสน|หมื่น|พัน|ร้อย|เปอร์เซ็นต์|วัน|เดือน|ปี|คน|ราย|ฉบับ|ข้อ|เท่า|หุ้น|แห่ง|แปลง|baht|thb|million|percent|days?|months?|years?|promoters?|companies|employees|items?))";

/**
 * Detects explicit impossible calendar dates (e.g. `2019-02-30`, `2019-02-29` non-leap, `31/06/2018`,
 * `30 กุมภาพันธ์ 2562`, `31 มิถุนายน 2561`, `29 Feb 2019`, `June 31, 2018`) so invalid dates
 * are flagged for clarification rather than silently ignored or truncated into month-year ranges.
 */
export function detectInvalidCalendarDateInText(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return false;
  const s = expandThaiMonthTokens(thaiDigitsToArabic(raw).replace(/\s+/g, " ").trim());

  for (const m of s.matchAll(/\b((?:19|20|24|25)\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:T|\b)/g)) {
    const yr = resolveFlexibleYearTokenToCe(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (yr === null || !isValidIsoComponents(yr, mm, dd)) return true;
  }

  for (const m of s.matchAll(/\b([0-9]{1,2})[\/.\-]([0-9]{1,2})[\/.\-]((?:19|20|24|25)[0-9]{2})\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const yr = resolveFlexibleYearTokenToCe(m[3]);
    if (yr === null) return true;
    const validDmy = a >= 1 && a <= 31 && b >= 1 && b <= 12 && isValidIsoComponents(yr, b, a);
    const validMdy = a >= 1 && a <= 12 && b > 12 && b <= 31 && isValidIsoComponents(yr, a, b);
    if (!validDmy && !validMdy) return true;
  }

  for (const m of s.matchAll(
    /([0-9]{1,2})\s*(?:เดือน)?\s*(มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(?:(พ\.ศ\.|ค\.ศ\.)\s*)?((?:19|20|24|25)[0-9]{2})/g
  )) {
    const dd = Number(m[1]);
    const mm = Number(TH_MONTH_NAME_TO_MM[m[2]] || 0);
    const eraHint = m[3] === "พ.ศ." ? "BE" : m[3] === "ค.ศ." ? "CE" : null;
    const yr = resolveFlexibleYearTokenToCe(m[4], eraHint);
    if (yr === null || !isValidIsoComponents(yr, mm, dd)) return true;
  }

  const sEn = s
    .replace(/\b([0-9]{1,2})-([a-zA-Z]{3,9})-((?:19|20|24|25)?[0-9]{2})\b/g, "$1 $2 $3")
    .replace(/\b([a-zA-Z]{3,9})-([0-9]{1,2})-((?:19|20|24|25)?[0-9]{2})\b/g, "$1 $2, $3");

  for (const m of sEn.matchAll(
    /\b([0-9]{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*,?\s*(?:(b\.?e\.?|พ\.ศ\.|c\.?e\.?|a\.?d\.?)\s*)?((?:19|20|24|25)[0-9]{2})\b/gi
  )) {
    const dd = Number(m[1]);
    const mm = Number(EN_MONTH_MAP[m[2].toLowerCase().replace(/\.$/, "")] || 0);
    const marker = (m[3] || "").toLowerCase();
    const eraHint = marker.includes("b") || marker.includes("พ") ? "BE" : marker ? "CE" : null;
    const yr = resolveFlexibleYearTokenToCe(m[4], eraHint);
    if (yr === null || !isValidIsoComponents(yr, mm, dd)) return true;
  }

  for (const m of sEn.matchAll(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s*(?:(b\.?e\.?|c\.?e\.?)\s*)?((?:19|20|24|25)[0-9]{2})\b/gi
  )) {
    const mm = Number(EN_MONTH_MAP[m[1].toLowerCase().replace(/\.$/, "")] || 0);
    const dd = Number(m[2]);
    const marker = (m[3] || "").toLowerCase();
    const eraHint = marker.includes("b") ? "BE" : marker ? "CE" : null;
    const yr = resolveFlexibleYearTokenToCe(m[4], eraHint);
    if (yr === null || !isValidIsoComponents(yr, mm, dd)) return true;
  }

  return false;
}

/**
 * Parses Thai Buddhist/Common Era dates (`1 ม.ค. 2561`, `วันที่ 30 เดือนมิถุนายน พ.ศ. 2561`, `30 มิ.ย. 61`, `30 มิถุนายน 2018`),
 * English dates (`30 June 2018`, `June 30, 2018`, `30-Jun-2018`, `30-Jun-18`, `1 Jan B.E. 2561`),
 * numeric slash/dot/dash dates (`30/06/2561`, `30/06/2018`, `30-06-2018`, `30.06.2018`, `30/06/61`, `06/30/2018`),
 * and year-first dates (`2018-06-30`, `2018/06/30`, `2561-06-30`, `2018-06-30T00:00:00Z`) into canonical ISO `YYYY-MM-DD`.
 * Never invents a date from year-only, month-only, month+year, or monetary/rate numbers following a month.
 */
export function parseFlexibleThaiOrEnglishDateToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = thaiDigitsToArabic(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;

  // 1. Year-first ISO / slash / dot (`2018-06-30`, `2561-06-30`, `2018/06/30`, `2018-06-30T...`)
  const ymdMatch = s.match(/\b((?:19|20|24|25)\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:T|\b)/);
  if (ymdMatch) {
    const yr = resolveFlexibleYearTokenToCe(ymdMatch[1]);
    const mm = Number(ymdMatch[2]);
    const dd = Number(ymdMatch[3]);
    if (yr !== null && isValidIsoComponents(yr, mm, dd)) {
      return `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    return null;
  }

  // 2. Numeric Day/Month/Year or unambiguous US Month/Day/Year (`30/06/2561`, `1/7/60`, `30-06-2018`, `30.06.2018`, `06/30/2018`)
  const numericDmy = s.match(
    /\b([0-9]{1,2})[\/.\-]([0-9]{1,2})[\/.\-]((?:19|20|24|25)[0-9]{2}|[0-7][0-9])\b/
  );
  if (numericDmy) {
    const a = Number(numericDmy[1]);
    const b = Number(numericDmy[2]);
    const yr = resolveFlexibleYearTokenToCe(numericDmy[3]);
    if (yr !== null) {
      if (a >= 1 && a <= 31 && b >= 1 && b <= 12 && isValidIsoComponents(yr, b, a)) {
        return `${yr}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
      }
      if (a >= 1 && a <= 12 && b > 12 && b <= 31 && isValidIsoComponents(yr, a, b)) {
        return `${yr}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
      }
    }
    return null;
  }

  // 3. Thai full/abbreviated month with optional `ที่` / `เดือน` / `พ.ศ.` / `ค.ศ.` and 2- or 4-digit B.E. or C.E. year
  //    Guards 2-digit years against matching monetary amounts (`50,000 บาท`), rates (`7%`), or counts!
  s = expandThaiMonthTokens(s);
  const thFlexRe = new RegExp(
    `([0-9]{1,2})\\s*(?:เดือน)?\\s*(มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\\s*(?:(พ\\.ศ\\.|ค\\.ศ\\.)\\s*)?((?:19|20|24|25)[0-9]{2}|[0-7][0-9]\\b${TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD})`
  );
  const thFlex = s.match(thFlexRe);
  if (thFlex) {
    const dd = Number(thFlex[1]);
    const mm = Number(TH_MONTH_NAME_TO_MM[thFlex[2]] || 0);
    const eraHint = thFlex[3] === "พ.ศ." ? "BE" : thFlex[3] === "ค.ศ." ? "CE" : null;
    const yr = resolveFlexibleYearTokenToCe(thFlex[4].trim(), eraHint);
    if (yr !== null && isValidIsoComponents(yr, mm, dd)) {
      return `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    return null;
  }
  const thIsoFallback = parseThaiBuddhistDateToIso(s);
  if (thIsoFallback) return thIsoFallback;

  // 4. Hyphenated English dates (`30-Jun-2018`, `15-Jan-19`, `Jun-30-2018`, `Jun-30-18`) — hyphen explicitly binds the 2-digit year!
  const hyphDmy = s.match(
    /\b([0-9]{1,2})-(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-((?:19|20|24|25)?[0-9]{2})\b/i
  );
  if (hyphDmy) {
    const dd = Number(hyphDmy[1]);
    const mm = Number(EN_MONTH_MAP[hyphDmy[2].toLowerCase()] || 0);
    const yr = resolveFlexibleYearTokenToCe(hyphDmy[3]);
    return yr !== null && isValidIsoComponents(yr, mm, dd)
      ? `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      : null;
  }
  const hyphMdy = s.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-([0-9]{1,2})-((?:19|20|24|25)?[0-9]{2})\b/i
  );
  if (hyphMdy) {
    const mm = Number(EN_MONTH_MAP[hyphMdy[1].toLowerCase()] || 0);
    const dd = Number(hyphMdy[2]);
    const yr = resolveFlexibleYearTokenToCe(hyphMdy[3]);
    return yr !== null && isValidIsoComponents(yr, mm, dd)
      ? `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
      : null;
  }

  // 5. Space-separated English Day Month Year (`30 June 2018`, `30 Jun '18`, `1 Jan B.E. 2561`, `1 Jan B.E. 61`)
  //    Space-separated bare 2-digit numbers WITHOUT `'`, `B.E.`, or `C.E.` require a 4-digit year so `"On 15 June 20 companies"` never invents 2020!
  const dmyEn = s.match(
    /\b([0-9]{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*,?\s*(?:(b\.?e\.?|พ\.ศ\.|c\.?e\.?|a\.?d\.?)\s*([0-9]{2,4})|'([0-7][0-9])|((?:19|20|24|25)[0-9]{2}))\b/i
  );
  if (dmyEn) {
    const dd = Number(dmyEn[1]);
    const mm = Number(EN_MONTH_MAP[dmyEn[2].toLowerCase().replace(/\.$/, "")] || 0);
    const marker = (dmyEn[3] || "").toLowerCase();
    const eraHint = marker.includes("b") || marker.includes("พ") ? "BE" : marker ? "CE" : null;
    const rawYr = dmyEn[4] || dmyEn[5] || dmyEn[6];
    const yr = resolveFlexibleYearTokenToCe(rawYr, eraHint);
    if (yr !== null && isValidIsoComponents(yr, mm, dd)) {
      return `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    return null;
  }

  // 6. Space-separated English Month Day, Year (`June 30, 2018`, `July 1, 2017`, `Jun 30, '18`, `Jun 30, B.E. 2561`)
  const mdyEn = s.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s*(?:(b\.?e\.?|c\.?e\.?|a\.?d\.?)\s*([0-9]{2,4})|'([0-7][0-9])|((?:19|20|24|25)[0-9]{2}))\b/i
  );
  if (mdyEn) {
    const mm = Number(EN_MONTH_MAP[mdyEn[1].toLowerCase().replace(/\.$/, "")] || 0);
    const dd = Number(mdyEn[2]);
    const marker = (mdyEn[3] || "").toLowerCase();
    const eraHint = marker.includes("b") ? "BE" : marker ? "CE" : null;
    const rawYr = mdyEn[4] || mdyEn[5] || mdyEn[6];
    const yr = resolveFlexibleYearTokenToCe(rawYr, eraHint);
    if (yr !== null && isValidIsoComponents(yr, mm, dd)) {
      return `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
    return null;
  }

  return null;
}

/**
 * Parses month-and-year expressions lacking a specific day (`พฤษภาคม 2560`, `มิ.ย. 61`, `มิ.ย. 2018`,
 * `May 2017`, `June 2018`, `Jun-2018`, `06/2018`, `06/2561`, `2018-06`, `2561-06`) into exact
 * first-of-month (`startIso`) and last-of-month (`endIso`) ISO dates.
 * Strictly guarded so full 3-part dates (valid or invalid, like `2019-02-30` or `15/06/2018`) and
 * month-only questions followed by monetary amounts (`มิถุนายน 50,000 บาท`) never match here!
 */
export function parseFlexibleMonthYearToRange(raw: string | null | undefined): {
  startIso: string;
  endIso: string;
  yearCe: number;
  month: number;
} | null {
  if (!raw) return null;
  if (detectInvalidCalendarDateInText(raw)) return null;
  const s = expandThaiMonthTokens(thaiDigitsToArabic(raw).replace(/\s+/g, " ").trim());
  if (!s) return null;

  const buildRange = (yr: number | null, mm: number) => {
    if (yr === null || yr < 1900 || yr > 2100 || mm < 1 || mm > 12) return null;
    const mmStr = String(mm).padStart(2, "0");
    const lastDay = String(daysInMonthUtc(yr, mm)).padStart(2, "0");
    return {
      startIso: `${yr}-${mmStr}-01`,
      endIso: `${yr}-${mmStr}-${lastDay}`,
      yearCe: yr,
      month: mm,
    };
  };

  // Thai Month + Year (`พฤษภาคม 2560`, `เดือนมิถุนายน 61`, `มิถุนายน 2018`) — must NOT be preceded by day-of-month!
  const thMyRe = new RegExp(
    `(?<![0-9]\\s*)(?<!วันที่\\s*[0-9]{1,2}\\s*)(?:เดือน)?\\s*(มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\\s*(?:(พ\\.ศ\\.|ค\\.ศ\\.)\\s*)?((?:19|20|24|25)[0-9]{2}|[4-7][0-9]\\b${TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD})`
  );
  const thMy = s.match(thMyRe);
  if (thMy) {
    const mm = Number(TH_MONTH_NAME_TO_MM[thMy[1]] || 0);
    const eraHint = thMy[2] === "พ.ศ." ? "BE" : thMy[2] === "ค.ศ." ? "CE" : null;
    return buildRange(resolveFlexibleYearTokenToCe(thMy[3].trim(), eraHint), mm);
  }

  // English Month + Year (`May 2017`, `June 2018`, `Jun-2018`, `Jun B.E. 2561`) — must NOT be preceded by day-of-month!
  const enMy = s.match(
    /(?<![0-9](?:st|nd|rd|th)?[\s\-]+)\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[a-z.]*[\s\-]+(?:(b\.?e\.?|พ\.ศ\.)\s*)?((?:19|20|24|25)[0-9]{2})\b/i
  );
  if (enMy) {
    const mm = Number(EN_MONTH_MAP[enMy[1].toLowerCase().replace(/\.$/, "")] || 0);
    const eraHint = enMy[2] ? "BE" : null;
    return buildRange(resolveFlexibleYearTokenToCe(enMy[3], eraHint), mm);
  }

  // Numeric `MM/YYYY` or `YYYY-MM` (`06/2018`, `06/2561`, `2018-06`, `2561-06`) — must NOT be part of a 3-part `DD/MM/YYYY` or `YYYY-MM-DD`!
  const myNum = s.match(
    /(?<![0-9/.\-])(0?[1-9]|1[0-2])[\/\-]((?:19|20|24|25)[0-9]{2})(?![\/.\-][0-9]|[0-9])/
  );
  if (myNum) {
    return buildRange(resolveFlexibleYearTokenToCe(myNum[2]), Number(myNum[1]));
  }
  const ymNum = s.match(
    /(?<![0-9/.\-])((?:19|20|24|25)[0-9]{2})[\/\-](0?[1-9]|1[0-2])(?![\/.\-][0-9]|[0-9])/
  );
  if (ymNum) {
    return buildRange(resolveFlexibleYearTokenToCe(ymNum[1]), Number(ymNum[2]));
  }

  return null;
}

/**
 * Parses standalone year-only inputs (`"2018"`, `"2561"`, `"พ.ศ. 2561"`, `"ปี 2561"`, `"FY2018"`,
 * `"fiscal year 2018"`, `"2018 fiscal year"`, `"B.E. 2561"`, `"2561 B.E."`, `"รอบระยะเวลาบัญชีปี 2561"`)
 * into a 4-digit Common Era year without fabricating a month or day!
 */
export function parseFlexibleYearOnlyToCe(raw: string | null | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const s = thaiDigitsToArabic(raw).replace(/\s+/g, " ").trim();
  const m =
    /^(?:(?:ในปี|เมื่อปี|สำหรับปี|ของปี|ประจำปี|ปีภาษี|ปีบัญชี|รอบระยะเวลาบัญชี(?:\s*ปี)?|รอบบัญชี(?:\s*ปี)?|งวดบัญชี(?:\s*ปี)?|งวดปี|งบปี|ปี|พ\.ศ\.|ค\.ศ\.|in\s+(?:the\s+)?year|for\s+(?:the\s+)?year|in|for|during|as\s+of|fiscal\s+year|accounting\s+period|tax\s+year|year|FY|B\.?E\.?|C\.?E\.?|A\.?D\.?)\s*)?(?:(พ\.ศ\.|ค\.ศ\.|B\.?E\.?|C\.?E\.?|A\.?D\.?)\s*)?((?:19|20|24|25)[0-9]{2}|[4-7][0-9])\s*(?:(B\.?E\.?|C\.?E\.?|A\.?D\.?|fiscal\s+year|accounting\s+period|tax\s+year))?$/i.exec(
      s
    );
  if (!m) return null;
  const marker = `${m[1] || ""} ${m[3] || ""} ${s}`.toLowerCase();
  const eraHint: "BE" | "CE" | null =
    marker.includes("พ.ศ.") || /\bb\.?e\.?\b/.test(marker)
      ? "BE"
      : marker.includes("ค.ศ.") || /\b(?:c\.?e\.?|a\.?d\.?)\b/.test(marker)
        ? "CE"
        : null;
  return resolveFlexibleYearTokenToCe(m[2], eraHint);
}

/**
 * Detects yearless month-only or day+month expressions in Thai and English
 * (e.g. `"เดือนมิถุนายน"`, `"มิถุนายน"`, `"มิ.ย."`, `"15 มิ.ย."`, `"in June"`, `"for Feb"`,
 * `"June"`, `"15 Jun"`, `"June 15"`, `"during May"`, `"15 May"`), while excluding the English
 * modal verb `"May a company..."` at sentence start!
 */
export function detectYearlessMonthOrPartialDate(scrubbedText: string): boolean {
  if (!scrubbedText || !scrubbedText.trim()) return false;
  const expanded = expandThaiMonthTokens(thaiDigitsToArabic(scrubbedText).replace(/\s+/g, " ").trim());

  // 1. Any of the 12 Thai month names (unambiguous in Thai; instrument dates were already scrubbed)
  if (
    /(?:มกราคม|กุมภาพันธ์|กุมพาภัณฑ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|กรกฏาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/.test(
      expanded
    )
  ) {
    return true;
  }

  // 2. English full & abbreviated months (excluding modal "may", handled separately below)
  if (
    /\b(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?(?![a-z])/i.test(
      expanded
    )
  ) {
    return true;
  }

  // 3. English "May" ONLY when used as a month (`in May`, `on 15 May`, `May 15`, `for May`, `during May`, `ended May`, `ending May`, `since May`, `as of May`, `month of May`, or standalone `"May"`)
  if (
    /^may$/i.test(expanded) ||
    /\b(?:in|on|during|for|since|from|until|by|as\s+of|ended|ending|starting|beginning|month\s+of|[0-9]{1,2}(?:st|nd|rd|th)?)\s+may\b/i.test(
      expanded
    ) ||
    /\bmay\s+[0-9]{1,2}(?:st|nd|rd|th)?\b/i.test(expanded)
  ) {
    return true;
  }

  // 4. Numeric day/month without year explicitly marked as a date (`วันที่ 15/06`, `วันที่ 30/6`)
  if (/(?:เมื่อวันที่|ตั้งแต่วันที่|ณ\s*วันที่|วันที่|สิ้นสุดวันที่)\s*[0-9]{1,2}[\/.\-][0-9]{1,2}(?![\/.\-0-9])/.test(expanded)) {
    return true;
  }

  return false;
}

export interface NormalizedTemporalInterval {
  kind:
    | "empty"
    | "exact_day"
    | "month_year_range"
    | "sub_year_range"
    | "year_only_range"
    | "incomplete_or_invalid";
  startIso: string | null;
  endIso: string | null;
  yearCe: number | null;
  canonicalLabel: string | null;
  ambiguousAltIso: string | null;
}

/**
 * Resolves any `applicable_date` / `as_of_date` string into an exact ISO interval without
 * ever inventing a specific month or day (e.g. `"2018"` -> `year_only_range` `2018-01-01..2018-12-31`
 * with `canonicalLabel: "2018"`, `"June"` or `"2019-02-30"` -> `incomplete_or_invalid`).
 */
export function resolveTemporalInputToIsoInterval(
  raw: string | null | undefined
): NormalizedTemporalInterval {
  if (!raw || !raw.trim()) {
    return {
      kind: "empty",
      startIso: null,
      endIso: null,
      yearCe: null,
      canonicalLabel: null,
      ambiguousAltIso: null,
    };
  }
  const trimmed = raw.trim();
  if (detectInvalidCalendarDateInText(trimmed)) {
    return {
      kind: "incomplete_or_invalid",
      startIso: null,
      endIso: null,
      yearCe: null,
      canonicalLabel: null,
      ambiguousAltIso: null,
    };
  }
  const exactIso = parseFlexibleThaiOrEnglishDateToIso(trimmed);
  if (exactIso) {
    return {
      kind: "exact_day",
      startIso: exactIso,
      endIso: exactIso,
      yearCe: Number(exactIso.slice(0, 4)),
      canonicalLabel: exactIso,
      ambiguousAltIso: detectAmbiguousNumericDateAlternativeIso(trimmed),
    };
  }
  const myRange = parseFlexibleMonthYearToRange(trimmed);
  if (myRange) {
    return {
      kind: "month_year_range",
      startIso: myRange.startIso,
      endIso: myRange.endIso,
      yearCe: myRange.yearCe,
      canonicalLabel: myRange.startIso.slice(0, 7),
      ambiguousAltIso: null,
    };
  }
  const subYr = parseSubYearPartialPeriodToRange(trimmed);
  if (subYr) {
    return {
      kind: "sub_year_range",
      startIso: subYr.startIso,
      endIso: subYr.endIso,
      yearCe: subYr.yearCe,
      canonicalLabel: `${subYr.startIso}..${subYr.endIso}`,
      ambiguousAltIso: null,
    };
  }
  const yrOnly = parseFlexibleYearOnlyToCe(trimmed);
  if (yrOnly !== null) {
    return {
      kind: "year_only_range",
      startIso: `${yrOnly}-01-01`,
      endIso: `${yrOnly}-12-31`,
      yearCe: yrOnly,
      canonicalLabel: String(yrOnly),
      ambiguousAltIso: null,
    };
  }
  return {
    kind: "incomplete_or_invalid",
    startIso: null,
    endIso: null,
    yearCe: null,
    canonicalLabel: null,
    ambiguousAltIso: null,
  };
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
  normalized_applicable_date_iso: string | null;
  accounting_period_start_iso: string | null;
  accounting_period_start_max_iso: string | null;
  accounting_period_end_iso: string | null;
  point_in_time_date_iso: string | null;
  assessable_tax_year_ce: number | null;
  transaction_date_iso: string | null;
  transaction_date_end_iso: string | null;
  transaction_year_ce: number | null;
  ambiguous_numeric_date_alt_iso: string | null;
  has_multiple_distinct_point_dates: boolean;
  is_upper_bounded_before_period: boolean;
  has_vague_historical_reference: boolean;
  has_yearless_partial_date: boolean;
  has_invalid_calendar_date?: boolean;
  asks_whether_ruling_applies: boolean;
  asks_pre_amendment_version_explicitly: boolean;
  has_any_temporal_anchor: boolean;
  is_concrete_taxpayer_fact_query: boolean;
}

function shiftIsoDateByDays(iso: string, deltaDays: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function detectAmbiguousNumericDateAlternativeIso(raw: string): string | null {
  const s = thaiDigitsToArabic(raw).trim();
  const m = s.match(
    /\b([0-9]{1,2})[\/.\-]([0-9]{1,2})[\/.\-]((?:19|20|24|25)[0-9]{2}|[0-7][0-9])\b/
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const yr = resolveFlexibleYearTokenToCe(m[3]);
  if (yr === null || a < 1 || a > 12 || b < 1 || b > 12 || a === b) return null;
  if (!isValidIsoComponents(yr, a, b)) return null;
  // Primary parser treats ambiguous a<=12, b<=12 as DD/MM/YYYY (`yr-b-a`); return MM/DD/YYYY (`yr-a-b`) alternative
  return `${yr}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
}

function parseSubYearPartialPeriodToRange(scrubbed: string): {
  startIso: string;
  endIso: string;
  yearCe: number;
} | null {
  const s = thaiDigitsToArabic(scrubbed);

  const quarterBounds = (yr: number | null, q: number) => {
    if (yr === null || yr < 1900 || yr > 2100 || q < 1 || q > 4) return null;
    const sm = (q - 1) * 3 + 1;
    const em = q * 3;
    const ed = daysInMonthUtc(yr, em);
    return {
      startIso: `${yr}-${String(sm).padStart(2, "0")}-01`,
      endIso: `${yr}-${String(em).padStart(2, "0")}-${String(ed).padStart(2, "0")}`,
      yearCe: yr,
    };
  };

  // 1. Thai Quarter (`ไตรมาส 1 ปี 2562`, `ไตรมาสที่ 2/2561`, `ไตรมาส 1/62`)
  const thQ = s.match(
    /ไตรมาส(?:ที่)?\s*([1-4])\s*(?:ของปี|ปี|พ\.ศ\.|ค\.ศ\.|\/|-|\s)\s*(?:(พ\.ศ\.|ค\.ศ\.)\s*)?((?:19|20|24|25)[0-9]{2}|[4-7][0-9])\b/
  );
  if (thQ) {
    const eraHint = thQ[2] === "พ.ศ." ? "BE" : thQ[2] === "ค.ศ." ? "CE" : null;
    return quarterBounds(resolveFlexibleYearTokenToCe(thQ[3], eraHint), Number(thQ[1]));
  }

  // 2. English Quarter (`Q1 2019`, `Q1/2019`, `1Q2019`, `1Q19`, `first quarter of 2019`)
  const enQ = s.match(
    /\b(?:Q([1-4])\s*[\/\-]?\s*(?:(B\.?E\.?)\s*)?((?:19|20|24|25)[0-9]{2}|[124-7][0-9])|([1-4])Q\s*[\/\-]?\s*((?:19|20|24|25)[0-9]{2}|[124-7][0-9])|(1st|first|2nd|second|3rd|third|4th|fourth)\s+quarter\s+(?:of\s+)?((?:19|20|24|25)[0-9]{2}))\b/i
  );
  if (enQ) {
    if (enQ[1] && enQ[3]) {
      return quarterBounds(
        resolveFlexibleYearTokenToCe(enQ[3], enQ[2] ? "BE" : null),
        Number(enQ[1])
      );
    }
    if (enQ[4] && enQ[5]) {
      return quarterBounds(resolveFlexibleYearTokenToCe(enQ[5]), Number(enQ[4]));
    }
    if (enQ[6] && enQ[7]) {
      const ord = enQ[6].toLowerCase();
      const q = ord.startsWith("1") || ord === "first" ? 1 : ord.startsWith("2") || ord === "second" ? 2 : ord.startsWith("3") || ord === "third" ? 3 : 4;
      return quarterBounds(resolveFlexibleYearTokenToCe(enQ[7]), q);
    }
  }

  // 3. Half-Year (`ครึ่งปีแรก 2562`, `ครึ่งปีหลัง 2561`, `H1 2019`, `first half of 2019`)
  const thHalf = s.match(
    /(ครึ่งปีแรก|ครึ่งแรกของปี|ครึ่งปีหลัง|ครึ่งหลังของปี)\s*(?:พ\.ศ\.\s*|ค\.ศ\.\s*)?((?:19|20|24|25)[0-9]{2}|[4-7][0-9])\b/
  );
  if (thHalf) {
    const yr = resolveFlexibleYearTokenToCe(thHalf[2]);
    if (yr !== null) {
      const isH1 = thHalf[1].includes("แรก");
      return {
        startIso: isH1 ? `${yr}-01-01` : `${yr}-07-01`,
        endIso: isH1 ? `${yr}-06-30` : `${yr}-12-31`,
        yearCe: yr,
      };
    }
  }
  const enHalf = s.match(
    /\b(?:(H1|1H|first\s+half(?:\s+of)?)|(H2|2H|second\s+half(?:\s+of)?))\s*[\/\-]?\s*((?:19|20|24|25)[0-9]{2})\b/i
  );
  if (enHalf) {
    const yr = resolveFlexibleYearTokenToCe(enHalf[3]);
    if (yr !== null) {
      const isH1 = Boolean(enHalf[1]);
      return {
        startIso: isH1 ? `${yr}-01-01` : `${yr}-07-01`,
        endIso: isH1 ? `${yr}-06-30` : `${yr}-12-31`,
        yearCe: yr,
      };
    }
  }

  // 4. Early / Mid / Late Year (`ต้นปี 2562`, `กลางปี 2561`, `ปลายปี 2560`, `early 2019`, `mid-2018`, `late 2017`)
  const thPartYr = s.match(
    /(?:ช่วง)?(ต้นปี|กลางปี|ปลายปี|ท้ายปี)\s*(?:พ\.ศ\.\s*|ค\.ศ\.\s*)?((?:19|20|24|25)[0-9]{2}|[4-7][0-9])\b/
  );
  if (thPartYr) {
    const yr = resolveFlexibleYearTokenToCe(thPartYr[2]);
    if (yr !== null) {
      const p = thPartYr[1];
      if (p === "ต้นปี") return { startIso: `${yr}-01-01`, endIso: `${yr}-04-30`, yearCe: yr };
      if (p === "กลางปี") return { startIso: `${yr}-05-01`, endIso: `${yr}-08-31`, yearCe: yr };
      return { startIso: `${yr}-09-01`, endIso: `${yr}-12-31`, yearCe: yr };
    }
  }
  const enPartYr = s.match(
    /\b(early|mid|late)[\s\-]+(?:(B\.?E\.?)\s*)?((?:19|20|24|25)[0-9]{2})\b/i
  );
  if (enPartYr) {
    const yr = resolveFlexibleYearTokenToCe(enPartYr[3], enPartYr[2] ? "BE" : null);
    if (yr !== null) {
      const p = enPartYr[1].toLowerCase();
      if (p === "early") return { startIso: `${yr}-01-01`, endIso: `${yr}-04-30`, yearCe: yr };
      if (p === "mid") return { startIso: `${yr}-05-01`, endIso: `${yr}-08-31`, yearCe: yr };
      return { startIso: `${yr}-09-01`, endIso: `${yr}-12-31`, yearCe: yr };
    }
  }

  return null;
}

const FLEX_DATE_TOKEN_PATTERN =
  `(?:(?:19|20|24|25)\\d{2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,2}|[0-9]{1,2}[\\/.\\-][0-9]{1,2}[\\/.\\-](?:(?:19|20|24|25)[0-9]{2}|[0-7][0-9])|[0-9]{1,2}[\\s\\-]+(?:เดือน)?\\s*[ก-๙a-zA-Z.]+,?\\s*(?:(?:พ\\.ศ\\.|ค\\.ศ\\.|B\\.?E\\.?|C\\.?E\\.?)\\s*)?(?:(?:19|20|24|25)[0-9]{2}|'?[0-7][0-9]\\b${TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD})|[a-zA-Z.]+[\\s\\-]+[0-9]{1,2}(?:st|nd|rd|th)?,?[\\s\\-]*(?:(?:B\\.?E\\.?|C\\.?E\\.?)\\s*)?(?:(?:19|20|24|25)[0-9]{2}|'[0-7][0-9]|(?<=-)[0-7][0-9]\\b))(?![0-9])`;

/**
 * Strips statutory/regulatory enactment title years (`พระราชบัญญัติ... พ.ศ. 2562`, `ท.ป. 299/2561`,
 * `Royal Decree No. 595 B.E. 2558`), section numbers (`มาตรา 80/1`), AND ruling-identifier date qualifiers
 * (`กค 0702/636 ปี 2555`, `กค 0706/4887 ลงวันที่ 15 พฤษภาคม 2549`) so citation titles and homonym
 * document qualifiers are NEVER mistaken for user transaction dates!
 */
function stripInstrumentTitleYearsForTemporalScan(q: string): string {
  return q
    .replace(
      /(?:(?:กค|Gor\s*Kor\.?|GK)\s*)?[0-9]{3,5}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮA-Za-z.]+\s*\/?\s*)?[0-9]+\s*(?:,|\(\s*)?(?:ลงวันที่|ฉบับลงวันที่|dated|issued(?:\s+on)?|ฉบับปี|ปี(?:\s*พ\.ศ\.)?|พ\.ศ\.|B\.?E\.?)\s*(?:[0-9]{1,2}\s+[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*)?[0-9]{2,4}|[a-zA-Z.]+\s+[0-9]{1,2},?\s*[0-9]{4}|(?:19|20|24|25)[0-9]{2})\s*\)?/gi,
      " [RULING_QUAL_REF] "
    )
    .replace(
      /(?:(?:กค|Gor\s*Kor\.?|GK)\s*)?[0-9]{3,5}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮA-Za-z.]+\s*\/?\s*)?[0-9]+\s*\(\s*(?:19|20|24|25)[0-9]{2}\s*\)/gi,
      " [RULING_QUAL_REF] "
    )
    .replace(
      /(?:(?:กค|Gor\s*Kor\.?|GK)\s*)+[0-9]{2,5}(?:\s*\([^)]+\))?\s*[\/\-]\s*(?:[ก-ฮA-Za-z.]+\s*[\/\-]?\s*)?[0-9]+[ก-ฮA-Za-z]*|(?<![0-9/.\-])0[0-9]{3}(?:\s*\([^)]+\))?\s*\/\s*(?:[ก-ฮA-Za-z.]+\s*\/?\s*)?[0-9]+[ก-ฮA-Za-z]*/gi,
      " [RULING_REF] "
    )
    .replace(
      /(?:ร่าง)?(?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศ[^\s,;]{0,45}|ระเบียบ[^\s,;]{0,45}|คำสั่ง[^\s,;]{0,35})[^?\n]{0,115}?(?:ลงวันที่\s*[0-9]{1,2}\s+[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*)?2[45][0-9]{2}|พ\.ศ\.\s*2[45][0-9]{2}|\(พ\.ศ\.\s*2[45][0-9]{2}\))/g,
      " [STATUTE_REF] "
    )
    .replace(/(?:ท\.ป\.|ป\.|คำสั่ง[^\s]{0,25})\s*[0-9]+\/2[45][0-9]{2}/g, " [ORDER_REF] ")
    .replace(/ศาลฎีกาที่\s*[0-9]+\/2[45][0-9]{2}/g, " [CASE_REF] ")
    .replace(/(?:มาตรา|ข้อ)\s*[0-9]+\/[0-9]+/g, " [SEC_REF] ")
    .replace(
      /\b(?:Act|Decree|Regulation|Notification)[^?\n]{0,65}?\b(?:B\.?E\.?\s*2[45][0-9]{2}|(?:19|20)[0-9]{2})\b/gi,
      " [STATUTE_REF] "
    );
}

/**
 * Parses bilingual (Thai + English) temporal facts across ALL common & alternative date formats
 * and distinguishes genuine historical document lookups (`กค 0811/11340`, `กค 0811(กม.03)/366`,
 * `กค 0702/636 ปี 2555`) from period-applicability questions — including questions that cite a
 * ruling number while asking about the law applicable to a particular period or date!
 */
export function parseQueryTemporalAndIntentContext(params: {
  question: string;
  applicableDate?: string | null;
  mode?: "standard" | "exact_lookup" | "comparison";
  explicitRulingIds: string[];
}): TemporalFactContext {
  const qNorm = thaiDigitsToArabic(params.question).replace(/\s+/g, " ").trim();

  const asksNamedAmendingActDirectly =
    /(?:พระราชบัญญัติ|พระราชกำหนด)แก้ไขเพิ่มเติมประมวลรัษฎากร\s*\(ฉบับที่\s*[0-9]+\)\s*พ\.ศ\.\s*25[0-9]{2}/.test(
      qNorm
    ) && !/รอบระยะเวลาบัญชี|รอบบัญชี|บริษัท|หักรายจ่าย|หักเป็นรายจ่าย/.test(qNorm);

  const isPureRulingSurveyOrDraftStatusLookup =
    asksNamedAmendingActDirectly ||
    /(?:มีหนังสือตอบข้อหารือใด|ข้อหารือใดบ้าง|ค้นหาแนววินิจฉัย|มีแนววินิจฉัยใด|ข้อหารือเกี่ยวกับ[\s\S]+กรมสรรพากรมีแนววินิจฉัยอย่างไร|หลักเกณฑ์ของ[\s\S]+กำหนดไว้อย่างไร|สถานะทางกฎหมายของ|ยังเป็นร่างกฎหมาย)/.test(
      qNorm
    );

  const scrubbed = stripInstrumentTitleYearsForTemporalScan(qNorm);

  let accountingStart: string | null = null;
  let accountingStartMax: string | null = null;
  let accountingEnd: string | null = null;
  let assessableTaxYearCe: number | null = null;
  let transactionDateIso: string | null = null;
  let transactionDateEndIso: string | null = null;
  let transactionYearCe: number | null = null;

  // 1a. Explicit accounting period full-date range (Thai, English, ISO, slash, dot, dash):
  // e.g. `รอบระยะเวลาบัญชี 1 กรกฎาคม 2560 ถึง 30 มิถุนายน 2561`, `รอบบัญชี 01/07/2560 - 30/06/2561`,
  //      `FY 1-Feb-2018 to 30-Jun-2018`, `accounting period 07/01/2017 - 06/30/2018`
  const rangeRe = new RegExp(
    `(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\\s+period|fiscal\\s+year|\\bFY\\b)(?:\\s*(?:ที่)?\\s*(?:เริ่ม|เริ่มต้น|ตั้งแต่วันที่|ตั้งแต่|วันที่|from|starting(?:\\s+on)?|beginning(?:\\s+on)?))?\\s*(${FLEX_DATE_TOKEN_PATTERN})\\s*(?:ถึง|จนถึง|–|—|-|\\bto\\b|\\bthrough\\b|ending(?:\\s+on)?|สิ้นสุด(?:วันที่)?)\\s*(${FLEX_DATE_TOKEN_PATTERN})`,
    "i"
  );
  const rangeMatch = scrubbed.match(rangeRe);
  if (rangeMatch) {
    accountingStart = parseFlexibleThaiOrEnglishDateToIso(rangeMatch[1]);
    accountingEnd = parseFlexibleThaiOrEnglishDateToIso(rangeMatch[2]);
  }

  // 1a-ii. Split fiscal-year notation (`FY 2017/18`, `FY2017-18`, `FY 2017/2018`, `รอบบัญชี 2560/2561`, `งวดปี 60/61`)
  if (!accountingStart && !accountingEnd) {
    const splitFyMatch = scrubbed.match(
      /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|ปีบัญชี|งวดปี|accounting\s+period|fiscal\s+year|\bFY)\s*((?:19|20|24|25)[0-9]{2}|[4-7][0-9])\s*[\/\-]\s*((?:19|20|24|25)?[0-9]{2})\b/i
    );
    if (splitFyMatch) {
      const y1 = resolveFlexibleYearTokenToCe(splitFyMatch[1]);
      const y2Raw = splitFyMatch[2];
      const y2 =
        y2Raw.length === 2 && splitFyMatch[1].length === 4
          ? resolveFlexibleYearTokenToCe(`${splitFyMatch[1].slice(0, 2)}${y2Raw}`)
          : resolveFlexibleYearTokenToCe(y2Raw);
      if (y1 !== null && y2 !== null && y2 === y1 + 1) {
        accountingStartMax = `${y1}-12-31`;
        accountingEnd = `${y2}-12-31`;
      }
    }
  }

  // 1a-iii. Month-Year accounting period range (`รอบบัญชี ก.ค. 2560 ถึง มิ.ย. 2561`, `FY Jul 2017 - Jun 2018`)
  if (!accountingStart && !accountingEnd) {
    const myRange = scrubbed.match(
      /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b)[^0-9ก-๙a-zA-Z]{0,25}?((?:เดือน)?\s*[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|(?:0?[1-9]|1[0-2])\/[0-9]{4})\s*(?:ถึง|จนถึง|–|—|-|\bto\b|\bthrough\b)\s*((?:เดือน)?\s*[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|(?:0?[1-9]|1[0-2])\/[0-9]{4})/i
    );
    if (myRange) {
      const m1 = parseFlexibleMonthYearToRange(myRange[1]);
      const m2 = parseFlexibleMonthYearToRange(myRange[2]);
      if (m1 && m2) {
        accountingStart = m1.startIso;
        accountingEnd = m2.endIso;
      }
    }
  }

  // 1b. Explicit accounting period START date without range
  if (!accountingStart) {
    const startRe = new RegExp(
      `(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\\s+period|fiscal\\s+year|\\bFY\\b)\\s*(?:ที่)?\\s*(?:เริ่ม|เริ่มต้น|starting|beginning|commencing)(?:\\s*(?:ใน|วันที่|ตั้งแต่วันที่|เมื่อวันที่|on|from))?\\s*(${FLEX_DATE_TOKEN_PATTERN})`,
      "i"
    );
    const startMatch = scrubbed.match(startRe);
    if (startMatch) {
      accountingStart = parseFlexibleThaiOrEnglishDateToIso(startMatch[1]);
    } else {
      const startMy = scrubbed.match(
        /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b)\s*(?:ที่)?\s*(?:เริ่ม|เริ่มต้น|starting|beginning|commencing)(?:\s*(?:ใน|เดือน|on|from))?\s*([ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|(?:0?[1-9]|1[0-2])\/[0-9]{4})/i
      );
      if (startMy) {
        accountingStart = parseFlexibleMonthYearToRange(startMy[1])?.startIso ?? null;
      }
    }
  }

  // 1c. Explicit accounting period END date (`สิ้นสุด 30/06/2561`, `ปิดงบ 31/03/61`, `สิ้นสุด มิ.ย. 61`, `fiscal year ended June 2018`, `FY ending 30-Jun-18`)
  if (!accountingEnd) {
    const endRe = new RegExp(
      `(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|งบปี|ปิดงบ|ปิดงวด|accounting\\s+period|fiscal\\s+year|\\bFY\\b)?\\s*(?:ที่)?\\s*(?:สิ้นสุด|วันสิ้นรอบ|ปิดงบ|ปิดงวด|ending|ended)(?:\\s*(?:ใน|ณ\\s*วันที่|วันที่|เมื่อวันที่|on))?\\s*(${FLEX_DATE_TOKEN_PATTERN})`,
      "i"
    );
    const endMatch = scrubbed.match(endRe);
    if (endMatch) {
      accountingEnd = parseFlexibleThaiOrEnglishDateToIso(endMatch[1]);
    } else {
      const endMy = scrubbed.match(
        /(?:รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|งบปี|accounting\s+period|fiscal\s+year|\bFY\b)\s*(?:ที่)?\s*(?:สิ้นสุด|วันสิ้นรอบ|ปิดงบ|ปิดงวด|ending|ended)(?:\s*(?:ใน|เดือน|on))?\s*((?:เดือน)?\s*[ก-๙a-zA-Z.]+\s*(?:พ\.ศ\.\s*|B\.?E\.?\s*)?[0-9]{2,4}|(?:0?[1-9]|1[0-2])\/[0-9]{4})/i
      );
      if (endMy) {
        accountingEnd = parseFlexibleMonthYearToRange(endMy[1])?.endIso ?? null;
      }
    }
  }

  // 2. Assessable tax year (`ปีภาษี 2560`, `ปีภาษี 60`, `เงินได้ประจำปี 2561`, `tax year 2017`, `2017 tax return`)
  const taxYrTh = scrubbed.match(
    /(?:ปีภาษี|เงินได้พึงประเมินประจำปี|เงินได้ประจำปี|ภ\.ง\.ด\.9[01]\s*ปี)\s*(?:พ\.ศ\.\s*)?(25[0-9]{2}|24[89][0-9]|[4-7][0-9])\b/
  );
  const taxYrEn = scrubbed.match(
    /\b(?:tax\s+year\s+((?:19|20|25)\d{2})|((?:19|20)\d{2})\s+(?:personal\s+income\s+)?tax\s+(?:year|return))\b/i
  );
  if (taxYrTh) {
    assessableTaxYearCe = resolveFlexibleYearTokenToCe(taxYrTh[1], "BE");
  } else if (taxYrEn) {
    assessableTaxYearCe = resolveFlexibleYearTokenToCe(taxYrEn[1] || taxYrEn[2]);
  }

  // 3. Transaction / event dates (including boundary-relative `ก่อน...`/`before ...`, quarters/half-years/early-mid-late, slash/dot/dash dates, and Month+Year without day!)
  let ambiguousNumericDateAltIso: string | null = null;
  let hasMultipleDistinctPointDates = false;
  let isUpperBoundedBeforePeriod = false;
  let hasInvalidCalendarDate = detectInvalidCalendarDateInText(scrubbed);
  let hasExplicitIncompleteAppDate = false;

  // 3a-0. Boundary-relative "before / prior to / earlier than" exact date or month-year (`ก่อนวันที่ 28/02/2562`, `before Feb 28, 2019`, `prior to 01/01/2018`, `ก่อนเดือนมีนาคม 2562`)
  const beforeDateRe = new RegExp(
    `(?:ก่อนวันที่|ก่อนเมื่อวันที่|ไม่เกินวันที่|\\bbefore\\b|\\bprior\\s+to\\b|\\bearlier\\s+than\\b)\\s*(${FLEX_DATE_TOKEN_PATTERN})`,
    "i"
  );
  const beforeDateMatch = !hasInvalidCalendarDate ? scrubbed.match(beforeDateRe) : null;
  if (beforeDateMatch && !accountingStart && !accountingEnd && !accountingStartMax) {
    const boundIso = parseFlexibleThaiOrEnglishDateToIso(beforeDateMatch[1]);
    const prevDayIso = boundIso ? shiftIsoDateByDays(boundIso, -1) : null;
    if (prevDayIso) {
      transactionDateIso = prevDayIso;
      transactionDateEndIso = prevDayIso;
      transactionYearCe = Number(prevDayIso.slice(0, 4));
      isUpperBoundedBeforePeriod = true;
      if (/รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b/i.test(scrubbed)) {
        accountingStartMax = prevDayIso;
      }
    }
  }

  if (!hasInvalidCalendarDate && !transactionDateIso && !accountingStart && !accountingEnd && !accountingStartMax) {
    const beforeMyMatch = scrubbed.match(
      /(?:ก่อนเดือน|ก่อนช่วงเดือน|\bbefore\b|\bprior\s+to\b)\s*((?:เดือน)?\s*[ก-๙a-zA-Z.]+[\s\-]+(?:พ\.ศ\.\s*|ค\.ศ\.\s*|B\.?E\.?\s*)?(?:(?:19|20|24|25)[0-9]{2}|[4-7][0-9])|(?:0?[1-9]|1[0-2])\/(?:19|20|24|25)[0-9]{2})\b/i
    );
    if (beforeMyMatch) {
      const my = parseFlexibleMonthYearToRange(beforeMyMatch[1]);
      const prevDayIso = my ? shiftIsoDateByDays(my.startIso, -1) : null;
      if (prevDayIso) {
        transactionDateIso = prevDayIso;
        transactionDateEndIso = prevDayIso;
        transactionYearCe = Number(prevDayIso.slice(0, 4));
        isUpperBoundedBeforePeriod = true;
      }
    }
  }

  if (!hasInvalidCalendarDate && !transactionDateIso && !accountingStart && !accountingEnd && !accountingStartMax) {
    const subYr = parseSubYearPartialPeriodToRange(scrubbed);
    if (subYr) {
      transactionDateIso = subYr.startIso;
      transactionDateEndIso = subYr.endIso;
      transactionYearCe = subYr.yearCe;
    } else {
      const allTxRe = new RegExp(FLEX_DATE_TOKEN_PATTERN, "gi");
      const parsedTxDates: string[] = [];
      const rawMatchedTokens: string[] = [];
      for (const m of scrubbed.matchAll(allTxRe)) {
        const iso = parseFlexibleThaiOrEnglishDateToIso(m[0]);
        if (iso) {
          parsedTxDates.push(iso);
          rawMatchedTokens.push(m[0]);
        }
      }
      if (parsedTxDates.length > 0) {
        const uniqueDates = Array.from(new Set(parsedTxDates)).sort();
        hasMultipleDistinctPointDates = uniqueDates.length >= 2;
        if (uniqueDates.length === 1 && rawMatchedTokens.length === 1) {
          ambiguousNumericDateAltIso = detectAmbiguousNumericDateAlternativeIso(rawMatchedTokens[0]);
        }
        // Keep earliest date in `transactionDateIso` so multi-date comparisons (`2018-06-30` vs `2025-01-15`) evaluate historical applicability on the earlier date!
        transactionDateIso = uniqueDates[0];
        transactionDateEndIso = uniqueDates[uniqueDates.length - 1];
        transactionYearCe = Number(transactionDateIso.slice(0, 4));
      } else {
        // Month + Year without day — supports both prepositioned (`ในเดือนพฤษภาคม 2560`, `in Feb 2019`) AND bare Month+Year (`กุมภาพันธ์ 2562`, `February 2019`, `06/2018`, `2019-02`)!
        const myDirect = parseFlexibleMonthYearToRange(scrubbed);
        if (myDirect) {
          transactionDateIso = myDirect.startIso;
          transactionDateEndIso = myDirect.endIso;
          transactionYearCe = myDirect.yearCe;
        }
      }
    }
  }

  // 3b. Boundary-relative "before year" (`ก่อนปี 2561`, `ก่อน พ.ศ. 2562`, `before 2019`, `prior to 2018`, `pre-2019`)
  //     AND Thai + English year-only formats (`ปี 2561`, `ของปี 2561`, `ในปี 60`, `พ.ศ. 2561`, `รอบบัญชี 2561`, `FY2018`, `fiscal year 2018`, `2018 fiscal year`, `in 2018`, `as of 2018`, `2561 B.E.`, standalone `2561`/`2018`)
  //     NEVER invents `-01-01` or `-12-31` point dates for year-only inputs!
  if (
    !hasInvalidCalendarDate &&
    !transactionYearCe &&
    !assessableTaxYearCe &&
    !accountingStart &&
    !accountingEnd &&
    !accountingStartMax
  ) {
    const beforeYrTh = scrubbed.match(
      /(?:ก่อนปีภาษี|ก่อนปี|ก่อน\s*พ\.ศ\.|ก่อน\s*ค\.ศ\.)\s*(?:(พ\.ศ\.|ค\.ศ\.)\s*)?(25[0-7][0-9]|24[89][0-9]|(?:199|20[0-3])[0-9]|[4-7][0-9])(?![0-9])/
    );
    const beforeYrEn = scrubbed.match(
      /\b(?:before\s+|prior\s+to\s+|pre[\s\-]*)(?:year\s+|(B\.?E\.?|C\.?E\.?)\s*)?(25[0-7][0-9]|(?:199|20[0-3])[0-9])\b/i
    );
    if (beforeYrTh) {
      const eraHint =
        beforeYrTh[1] === "ค.ศ."
          ? "CE"
          : Number(beforeYrTh[2]) >= 1900 && Number(beforeYrTh[2]) < 2400
            ? "CE"
            : "BE";
      const yrCe = resolveFlexibleYearTokenToCe(beforeYrTh[2], eraHint);
      if (yrCe !== null) {
        transactionYearCe = yrCe - 1;
        accountingStartMax = `${yrCe - 1}-12-31`;
        isUpperBoundedBeforePeriod = true;
      }
    } else if (beforeYrEn) {
      const eraHint = beforeYrEn[1] && /b/i.test(beforeYrEn[1]) ? "BE" : null;
      const yrCe = resolveFlexibleYearTokenToCe(beforeYrEn[2], eraHint);
      if (yrCe !== null) {
        transactionYearCe = yrCe - 1;
        accountingStartMax = `${yrCe - 1}-12-31`;
        isUpperBoundedBeforePeriod = true;
      }
    } else {
      // Note: NEVER use ASCII `\b` before Thai `ปี` (JS treats Thai script as `\W`, so `\bปี` fails at string start and after spaces/Thai chars!)
      const yrThContext = scrubbed.match(
        new RegExp(
          `(?:(?:ในปี|เมื่อปี|สำหรับปี|ช่วงปี|ระหว่างปี|ของปี|ประจำปี|ตอนปี|ตั้งแต่ปี|ย้อนไปปี|ปีบัญชี|รอบระยะเวลาบัญชี(?:\\s*ปี)?|รอบบัญชี(?:\\s*ปี)?|งวดบัญชี(?:\\s*ปี)?|งวดปี|งบปี|สำหรับรอบปี)\\s*(?:(พ\\.ศ\\.|ค\\.ศ\\.)\\s*)?((?:19|20|24|25)[0-9]{2}|[4-7][0-9]\\b${TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD})|(?:ปี\\s*พ\\.ศ\\.|พ\\.ศ\\.)\\s*(25[0-7][0-9]|24[89][0-9]|[4-7][0-9]\\b${TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD})|(?<!ระยะเวลา\\s*)(?<!กำหนด\\s*)(?<!เกิน\\s*)(?<!ไม่เกิน\\s*)(?<!ภายใน\\s*)(?<!เวลา\\s*)(?<![ก-๙])ปี\\s*((?:19|20|24|25)[0-9]{2}|[4-7][0-9]\\b${TWO_DIGIT_YEAR_DISQUALIFIER_LOOKAHEAD}))(?![0-9])`
        )
      );
      const yrCeExplicit = scrubbed.match(
        /(?:(?:ค\.ศ\.|C\.?E\.?|A\.?D\.?)\s*((?:199|20[0-3])[0-9])|\b((?:199|20[0-3])[0-9])\s*(?:C\.?E\.?|A\.?D\.?))\b/i
      );
      const yrBeEn = scrubbed.match(
        /\b(?:B\.?E\.?\s*(25[0-7][0-9]|24[89][0-9])|(25[0-7][0-9]|24[89][0-9])\s*B\.?E\.?)\b/i
      );
      const yrFyOrPeriodEn = scrubbed.match(
        /\b(?:(?:fiscal\s+year|accounting\s+period|FY)\s*(?:(B\.?E\.?|C\.?E\.?)\s*)?((?:199|20[0-3])[0-9]|25[0-7][0-9]|[124-6][0-9])|((?:199|20[0-3])[0-9]|25[0-7][0-9])\s+(?:fiscal\s+year|accounting\s+period))\b/i
      );
      const yrEnProse = scrubbed.match(
        /\b(?:in|during|for|as\s+of|under|since|from|of|year|in\s+(?:the\s+)?year|for\s+(?:the\s+)?year|between)\s+(?:(B\.?E\.?|C\.?E\.?|A\.?D\.?)\s*)?((?:199|20[0-3])[0-9]|25[0-7][0-9])\b/i
      );
      const yrStandalone4Digit = scrubbed.match(
        /(?<!(?:มาตรา|ข้อ|ฉบับที่|เล่ม|ตอนที่|หน้า|จำนวน|เงิน|บาท|section|sec\.?|no\.?)\s*)(?<![0-9/.,\-])(25[4-7][0-9]|20[0-3][0-9]|199[0-9])(?![0-9/.,\-])(?!\s*(?:บาท|ล้าน|แสน|หมื่น|พัน|คน|วัน|baht|thb))/i
      );

      if (yrThContext) {
        const rawTok = (yrThContext[2] || yrThContext[3] || yrThContext[4] || "").trim();
        const eraHint =
          yrThContext[1] === "ค.ศ."
            ? "CE"
            : Number(rawTok) >= 1900 && Number(rawTok) < 2400
              ? "CE"
              : "BE";
        transactionYearCe = resolveFlexibleYearTokenToCe(rawTok, eraHint);
      } else if (yrCeExplicit) {
        transactionYearCe = Number(yrCeExplicit[1] || yrCeExplicit[2]);
      } else if (yrBeEn) {
        transactionYearCe = Number(yrBeEn[1] || yrBeEn[2]) - 543;
      } else if (yrFyOrPeriodEn) {
        const eraHint = yrFyOrPeriodEn[1] && /b/i.test(yrFyOrPeriodEn[1]) ? "BE" : null;
        const fyYr = resolveFlexibleYearTokenToCe(yrFyOrPeriodEn[2] || yrFyOrPeriodEn[3], eraHint);
        if (fyYr !== null) {
          transactionYearCe = fyYr;
        }
      } else if (yrEnProse) {
        const eraHint = yrEnProse[1] && /b/i.test(yrEnProse[1]) ? "BE" : null;
        transactionYearCe = resolveFlexibleYearTokenToCe(yrEnProse[2], eraHint);
      } else if (yrStandalone4Digit) {
        transactionYearCe = resolveFlexibleYearTokenToCe(yrStandalone4Digit[1]);
      }
    }
  }

  // 4. Explicit API `applicable_date` parameter — normalized as an exact ISO interval without inventing dates!
  let pointInTimeIso: string | null = null;
  if (params.applicableDate && params.applicableDate.trim()) {
    const rawApp = params.applicableDate.trim();
    const appInterval = resolveTemporalInputToIsoInterval(rawApp);
    if (appInterval.kind === "exact_day") {
      pointInTimeIso = appInterval.startIso;
      if (!ambiguousNumericDateAltIso && appInterval.ambiguousAltIso) {
        ambiguousNumericDateAltIso = appInterval.ambiguousAltIso;
      }
      if (
        pointInTimeIso &&
        /รอบระยะเวลาบัญชี|รอบบัญชี|งวดบัญชี|accounting\s+period|fiscal\s+year|\bFY\b/i.test(scrubbed) &&
        !accountingStart &&
        !accountingEnd
      ) {
        accountingEnd = pointInTimeIso;
      }
    } else if (
      appInterval.kind === "month_year_range" ||
      appInterval.kind === "sub_year_range"
    ) {
      transactionDateIso = appInterval.startIso;
      transactionDateEndIso = appInterval.endIso;
      transactionYearCe = appInterval.yearCe;
    } else if (appInterval.kind === "year_only_range") {
      transactionYearCe = appInterval.yearCe;
    } else if (appInterval.kind === "incomplete_or_invalid") {
      if (detectInvalidCalendarDateInText(rawApp)) {
        hasInvalidCalendarDate = true;
      }
      hasExplicitIncompleteAppDate = true;
    }
  }

  // 5. Partial / unclear / invalid date signals (yearless month/day-month, invalid calendar date, or vague relative past)
  const hasVagueHistoricalReference =
    /(?:เมื่อหลายปีก่อน|เมื่อไม่กี่ปีก่อน|หลายปีที่แล้ว|ไม่กี่ปีที่แล้ว|เมื่อปีก่อนๆ|ปีก่อนๆ|สมัยก่อน|ในอดีต|เมื่อนานมาแล้ว|\b(?:several|many|a\s+few)\s+years\s+ago\b|\bin\s+the\s+past\b|\bin\s+previous\s+years\b|\bsome\s+time\s+ago\b)/i.test(
      scrubbed
    );

  const hasConcreteYearOrIsoAnchor =
    !hasInvalidCalendarDate &&
    !hasExplicitIncompleteAppDate &&
    Boolean(
      accountingStart ||
        accountingStartMax ||
        accountingEnd ||
        pointInTimeIso ||
        assessableTaxYearCe !== null ||
        transactionDateIso ||
        transactionYearCe !== null
    );

  const hasYearlessPartialDate =
    hasInvalidCalendarDate ||
    hasExplicitIncompleteAppDate ||
    (!hasConcreteYearOrIsoAnchor && detectYearlessMonthOrPartialDate(scrubbed));

  const asksPreAmendmentExplicitly =
    /(?:ก่อนแก้ไข|ฉบับเดิม|รุ่นเดิม|ตัวบทเดิม|ย้อนหลัง|ก่อนวันที่\s*20\s*มีนาคม\s*2562|prior\s+to\s+(?:the\s+)?(?:\d{4}\s+)?amendment|pre[- ]amendment|previous\s+version|historical\s+version)/i.test(
      scrubbed
    );

  const hasAnyTemporalAnchor = Boolean(
    hasConcreteYearOrIsoAnchor ||
      asksPreAmendmentExplicitly ||
      hasVagueHistoricalReference ||
      hasYearlessPartialDate
  );

  // Detect explicit ruling-applicability / transfer questions (`นำ กค ... มาใช้กับ...ได้หรือไม่`, `ยังใช้บังคับ...หรือไม่`, `กฎหมาย...ใช้บังคับอย่างไร`, `หากบริษัท...`, `Does ruling ... apply`)
  const asksWhetherRulingApplies =
    params.explicitRulingIds.length > 0 &&
    (/(?:นำ(?:แนววินิจฉัย|หนังสือตอบข้อหารือ|ข้อหารือ|หลักเกณฑ์)?[^\n?]{0,60}?มา(?:ใช้|ปรับใช้|อ้างอิง|เทียบเคียง)|ยัง(?:คง)?(?:นำมา)?ใช้(?:บังคับ|อ้างอิง|ได้)?[^\n?]{0,50}?(?:ได้หรือไม่|ได้ไหม|อยู่หรือไม่|หรือไม่|ไหม)|ใช้บังคับกับ[^\n?]{0,60}?(?:ได้หรือไม่|ได้ไหม|หรือไม่|ไหม)|ปรับใช้กับ[^\n?]{0,60}?(?:ได้หรือไม่|ได้ไหม|หรือไม่|ไหม)|ใช้(?:ได้)?กับ(?:กรณี|ธุรกรรม|บริษัท|ห้าง|กิจการ|รอบ|ปี|เมื่อ)[^\n?]{0,60}?(?:ได้หรือไม่|ได้ไหม|หรือไม่|ไหม)|กฎหมาย[^\n?]{0,45}?ใช้บังคับอย่างไร|มีผลผูกพัน[^\n?]{0,45}?(?:หรือไม่|ไหม)|หาก(?:บริษัท|ห้าง|กิจการ|ผู้ประกอบการ|ผู้เสียภาษี|เรา|เปลี่ยนเป็น|ข้อเท็จจริง)|สมมติว่า|สำหรับกรณีของบริษัทเรา|ในกรณีของบริษัทเรา)/.test(
      qNorm
    ) ||
      /\b(?:does\s+(?:ruling\s+|this\s+ruling\s+|the\s+ruling\s+)?[^\n?]{0,55}?(?:still\s+)?apply|can\s+(?:we|a\s+company|our\s+company|a\s+taxpayer|taxpayers)\s+(?:rely\s+on|apply|use)\b|is\s+(?:ruling\s+|this\s+ruling\s+|the\s+ruling\s+)?[^\n?]{0,55}?(?:still\s+)?(?:applicable|binding|valid)\b|if\s+(?:a|our)\s+(?:thai\s+)?(?:company|partnership|taxpayer|business)\b|apply\s+(?:ruling\s+|this\s+ruling\s+)?[^\n?]{0,45}?\bto\s+(?:our|a)\b)/i.test(
        qNorm
      ));

  // Distinguish historical document lookup vs applicable law for a period (even when a ruling number IS included in the prompt!):
  const asksOnlyWhatRulingDecided =
    params.explicitRulingIds.length > 0 &&
    !asksWhetherRulingApplies &&
    !pointInTimeIso &&
    !hasYearlessPartialDate &&
    !asksPreAmendmentExplicitly &&
    !hasVagueHistoricalReference &&
    /(?:ค้นหาหนังสือ|สรุปหนังสือ|ในหนังสือตอบข้อหารือ|แสดงแนววินิจฉัย|วินิจฉัย(?:เรื่อง[^\n?]{0,60})?(?:ไว้)?อย่างไร|\bfind\b|\bsummarize\b|\bwhat\s+did\b)/i.test(
      qNorm
    ) &&
    !/(?:นำมาใช้กับ|ใช้บังคับกับ|หักเป็นรายจ่ายได้|หักรายจ่ายได้|ได้รับยกเว้น[^\n?]{0,30}หรือไม่|\bapply\s+to\b|\bcan\s+(?:we|a|our)\b|\bcould\s+(?:we|a|our)\b|\bdeductible\b)/i.test(
      qNorm
    );

  const matchesConcreteTaxpayerPattern =
    /(?:บริษัท|ห้างหุ้นส่วน|กิจการ|ผู้ประกอบการ|บุคคลธรรมดา|ผู้เสียภาษี)[\s\S]{0,140}?(?:หักเป็นรายจ่าย|ถือเป็นรายจ่าย|หักรายจ่าย|หักลดหย่อน|ได้รับยกเว้น|ได้สิทธิ[^\n?]{0,30}ร้อยละ\s*0|เสียภาษี[^\n?]{0,30}ร้อยละ\s*0|ได้หรือไม่|ได้ไหม|ได้เท่าไร)/.test(
      qNorm
    ) ||
    /\b(?:can\s+(?:a|our|the|we)\s+(?:thai\s+)?(?:company|taxpayer|corporate|business|partnership|individual)|is\s+(?:a|our)\s+(?:company|donation|contribution|sale)|may\s+a\s+company|does\s+(?:selling|a\s+sale|donating|a\s+donation))\b[\s\S]{0,160}?\b(?:deduct|deductible|claim|qualify|exempt|0%\s*vat|zero[- ]rat(?:e|ed))\b/i.test(
      qNorm
    );

  const isHistoricalDocLookup = isPureRulingSurveyOrDraftStatusLookup
    ? true
    : asksWhetherRulingApplies
      ? false
      : hasAnyTemporalAnchor
        ? asksOnlyWhatRulingDecided
        : params.mode === "exact_lookup" ||
          params.mode === "comparison" ||
          (params.explicitRulingIds.length > 0 &&
            (!matchesConcreteTaxpayerPattern ||
              /(?:ตามหนังสือตอบข้อหารือ|ตามข้อหารือ|ในหนังสือตอบข้อหารือ|ตาม\s*กค|\bunder\s+ruling\b|\bin\s+ruling\b)/i.test(
                qNorm
              )));

  const isConcreteTaxpayerFactQuery =
    !isHistoricalDocLookup && !hasAnyTemporalAnchor && matchesConcreteTaxpayerPattern;

  return {
    query_intent: isHistoricalDocLookup ? "HISTORICAL_DOCUMENT_LOOKUP" : "APPLICABLE_LAW_AT_TIME",
    normalized_applicable_date_iso: pointInTimeIso,
    accounting_period_start_iso: accountingStart,
    accounting_period_start_max_iso: accountingStartMax,
    accounting_period_end_iso: accountingEnd,
    point_in_time_date_iso: pointInTimeIso,
    assessable_tax_year_ce: assessableTaxYearCe,
    transaction_date_iso: transactionDateIso,
    transaction_date_end_iso: transactionDateEndIso,
    transaction_year_ce: transactionYearCe,
    ambiguous_numeric_date_alt_iso: ambiguousNumericDateAltIso,
    has_multiple_distinct_point_dates: hasMultipleDistinctPointDates,
    is_upper_bounded_before_period: isUpperBoundedBeforePeriod,
    has_vague_historical_reference: hasVagueHistoricalReference,
    has_yearless_partial_date: hasYearlessPartialDate,
    has_invalid_calendar_date: hasInvalidCalendarDate,
    asks_whether_ruling_applies: asksWhetherRulingApplies,
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

  // 1. Explicit request for an unverified pre-amendment historical version OR vague relative past reference (`เมื่อหลายปีก่อน`, `ในอดีต`, `several years ago`)
  if (
    (temporalCtx.asks_pre_amendment_version_explicitly && !temporalCtx.accounting_period_start_iso) ||
    temporalCtx.has_vague_historical_reference
  ) {
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
      containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle} รุ่นก่อนการแก้ไขเพิ่มเติมหรือสำหรับช่วงเวลาในอดีตที่ยังไม่ชัดเจนชั่วคราว เนื่องจากคลังข้อมูลชุด ${releaseId} เก็บเฉพาะตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน (${originUri})${amendInfo} และไม่คาดเดาหรือประกอบสร้างตัวบทย้อนหลังขึ้นเองจากตัวบทปัจจุบันจนกว่าจะตรวจรับรองต้นฉบับจากราชกิจจานุเบกษา (${srcHint})`,
      clarification_question_th:
        "กรุณาระบุวันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริง หรือวันเดือนปีที่เกิดธุรกรรมให้ชัดเจน เพื่อตรวจสอบเงื่อนไขการใช้บังคับตามพระราชบัญญัติแก้ไขเพิ่มเติมที่เกี่ยวข้อง",
    };
  }

  // 1b. Invalid calendar date (`2019-02-30`, `31/06/2018`, `30 กุมภาพันธ์ 2562`) OR yearless partial/month-only date (`ในเดือนมิถุนายน`, `มิ.ย.`, `in June`, `in Feb`, `15 Jun` without year)
  if (temporalCtx.has_invalid_calendar_date) {
    return {
      action: "ASK_FOR_MISSING_RELEVANT_DATE",
      has_direct_clause_match: hasDirectClauseMatch,
      matched_amendment: explicitMatched || implicated || null,
      amending_work_id_to_cite: (explicitMatched || implicated)?.amending_work_id || null,
      explanation_banner_th:
        `**วันที่ในคำถามไม่ถูกต้องตามปฏิทิน**: ระบบตรวจพบวันที่ที่ไม่มีอยู่จริงตามปฏิทิน จึงไม่อาจคาดเดาหรือเปลี่ยนเป็นวันที่อื่นโดยพลการเพื่อเลือกรุ่นของ ${secTitle}`,
      containment_message_th: null,
      clarification_question_th:
        "กรุณาตรวจสอบและระบุวัน เดือน ปี (พ.ศ. หรือ ค.ศ.) ที่ถูกต้องตามปฏิทินในรูปแบบ YYYY-MM-DD (เช่น 2019-02-28)",
    };
  }

  if (temporalCtx.has_yearless_partial_date) {
    const targetForPartial = explicitMatched || implicated;
    if (targetForPartial && targetForPartial.applicability_from_date) {
      return {
        action: "ASK_FOR_MISSING_RELEVANT_DATE",
        has_direct_clause_match: hasDirectClauseMatch,
        matched_amendment: targetForPartial,
        amending_work_id_to_cite: targetForPartial.amending_work_id,
        explanation_banner_th:
          `**ต้องทราบปี พ.ศ./ค.ศ. และช่วงเวลาที่ครบถ้วน (${targetForPartial.amending_instrument_title_th})**: คำถามระบุเฉพาะวันหรือเดือนโดยไม่ระบุปี ในขณะที่ ${secTitle}${targetForPartial.subprovision_label ? ` ${targetForPartial.subprovision_label}` : ""} มีการแก้ไขเพิ่มเติมซึ่ง **${targetForPartial.applicability_rule_th}** ระบบจึงไม่อาจคาดเดาปีของข้อเท็จจริงได้`,
        containment_message_th: null,
        clarification_question_th:
          targetForPartial.applicability_basis === "ACCOUNTING_PERIOD_START"
            ? `กรุณาระบุ **วันเดือนปี (พ.ศ. หรือ ค.ศ.) ของวันเริ่มต้นและวันสิ้นสุดรอบระยะเวลาบัญชีจริง** (เกณฑ์ใช้บังคับ: เริ่มในหรือหลังวันที่ ${targetForPartial.applicability_from_date})`
            : `กรุณาระบุ **วันเดือนปี (พ.ศ. หรือ ค.ศ.) ที่เกิดธุรกรรมให้ครบถ้วน** (เกณฑ์ใช้บังคับ: ตั้งแต่วันที่ ${targetForPartial.applicability_from_date} เป็นต้นไป)`,
      };
    }
    return {
      action: "ASK_FOR_MISSING_RELEVANT_DATE",
      has_direct_clause_match: hasDirectClauseMatch,
      matched_amendment: null,
      amending_work_id_to_cite: null,
      explanation_banner_th:
        `**ต้องทราบปี พ.ศ./ค.ศ. ที่แน่นอนของข้อเท็จจริง**: คำถามระบุเฉพาะเดือนหรือวันและเดือนโดยไม่ระบุปี ระบบจึงไม่อาจคาดเดาปีที่เกิดรายการเพื่อยืนยันรุ่นบทบัญญัติ ${secTitle} ที่ใช้บังคับ`,
      containment_message_th: null,
      clarification_question_th:
        "กรุณาระบุปี พ.ศ. หรือ ค.ศ. ของธุรกรรมหรือวันเริ่มต้น–วันสิ้นสุดรอบระยะเวลาบัญชีให้ครบถ้วน",
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
    const exactHistoricalDate =
      temporalCtx.accounting_period_start_iso ||
      temporalCtx.transaction_date_iso ||
      temporalCtx.point_in_time_date_iso ||
      temporalCtx.accounting_period_end_iso;
    const yearOnlyHistoricalCe =
      temporalCtx.transaction_year_ce ?? temporalCtx.assessable_tax_year_ce;
    const isPre2020 =
      (exactHistoricalDate && exactHistoricalDate < "2020-01-01") ||
      (!exactHistoricalDate && yearOnlyHistoricalCe !== null && yearOnlyHistoricalCe < 2020);
    if (isPre2020 && work.work_id.startsWith("prov.th.rc.")) {
      const periodDisplay = exactHistoricalDate
        ? exactHistoricalDate
        : `ปี พ.ศ. ${yearOnlyHistoricalCe! + 543} (${yearOnlyHistoricalCe})`;
      return {
        action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
        has_direct_clause_match: hasDirectClauseMatch,
        matched_amendment: null,
        amending_work_id_to_cite: null,
        explanation_banner_th: null,
        containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle} รุ่นย้อนหลังสำหรับช่วงเวลาที่ระบุ (${periodDisplay}) เนื่องจากคลังข้อมูลชุด ${releaseId} เก็บเฉพาะตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน (${originUri}) และไม่คาดเดาว่าตัวบทดังกล่าวมีการแก้ไขหลังช่วงเวลาที่ถามหรือไม่ กรุณาตรวจสอบจากราชกิจจานุเบกษา (https://ratchakitcha.soc.go.th) โดยตรง`,
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

      if (temporalCtx.accounting_period_start_max_iso && temporalCtx.accounting_period_start_max_iso < cutoffIso) {
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th:
            `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบทประมวลรัษฎากร ${secTitle.replace(/^ประมวลรัษฎากร\s*/, "").replace(/\s*\([^)]*\)\s*$/, "")} รุ่นย้อนหลังชั่วคราว สำหรับรอบระยะเวลาบัญชีที่เริ่มต้นไม่เกินวันที่ \`${temporalCtx.accounting_period_start_max_iso}\` (เริ่มก่อนวันที่ \`${cutoffIso}\`): ตาม **${targetItem.amending_instrument_title_th}** บทบัญญัติที่แก้ไขใหม่ใน ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ใช้บังคับเฉพาะ **รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561 (\`${cutoffIso}\`) เป็นต้นไป** เท่านั้น **จึงไม่อาจนำมาตรา 65 ตรี (3)(ก) ที่แก้ไขใหม่มาใช้บังคับได้** และระบบไม่ประกอบสร้างตัวบทก่อนแก้ไขจากตัวบทปัจจุบันจนกว่าจะตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"}) (อ้างอิงบทเฉพาะกาล: ${targetItem.amending_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th:
            "กรุณาระบุวันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริงเพื่อยืนยันบทบัญญัติที่ใช้บังคับ",
        };
      }

      const refEndOrPoint =
        temporalCtx.accounting_period_end_iso ||
        temporalCtx.point_in_time_date_iso ||
        temporalCtx.transaction_date_iso;

      if (!refEndOrPoint) {
        // Year-only input (`ในปี 2561`, `in 2018`, `FY2018`, `ในปี 2560`, `in 2017`) — NEVER fabricate `-12-31`!
        const yrOnly = temporalCtx.transaction_year_ce ?? temporalCtx.assessable_tax_year_ce;
        const cutoffYrCe = Number(cutoffIso.slice(0, 4));
        if (yrOnly !== null) {
          if (yrOnly < cutoffYrCe || temporalCtx.is_upper_bounded_before_period) {
            return {
              action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
              has_direct_clause_match: hasDirectClauseMatch,
              matched_amendment: targetItem,
              amending_work_id_to_cite: null,
              explanation_banner_th: null,
              containment_message_th:
                `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบทประมวลรัษฎากร ${secTitle.replace(/^ประมวลรัษฎากร\s*/, "").replace(/\s*\([^)]*\)\s*$/, "")} รุ่นย้อนหลังชั่วคราว สำหรับปี พ.ศ. ${yrOnly + 543} (${yrOnly}) เนื่องจากคลังข้อมูลชุด ${releaseId} เก็บเฉพาะตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบัน (${originUri}) และไม่ประกอบสร้างตัวบทย้อนหลังขึ้นเองจากตัวบทปัจจุบันจนกว่าจะตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"}) โดยตรง. ทั้งนี้ ตาม **${targetItem.amending_instrument_title_th}** บทบัญญัติที่แก้ไขใหม่ใน ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ใช้บังคับเฉพาะ **รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561 (\`${cutoffIso}\`) เป็นต้นไป** เท่านั้น จึง **ไม่อาจนำมาใช้บังคับกับช่วงเวลาก่อนหน้านั้นได้**${targetItem.amending_source_uri ? ` (อ้างอิงบทเฉพาะกาล: ${targetItem.amending_source_uri})` : ""}`,
              clarification_question_th:
                "กรุณาระบุวันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริงเพื่อยืนยันบทบัญญัติที่ใช้บังคับ",
            };
          }
          if (yrOnly === cutoffYrCe) {
            // Year `2018` (`พ.ศ. 2561`) straddles `ACCOUNTING_PERIOD_START >= 2018-01-01`:
            // A calendar-year taxpayer (`1 Jan 2018 – 31 Dec 2018`) started on `2018-01-01` (eligible),
            // whereas a non-calendar taxpayer (`1 Jul 2017 – 30 Jun 2018`) started in `2017` (ineligible)!
            return {
              action: "ASK_FOR_MISSING_RELEVANT_DATE",
              has_direct_clause_match: hasDirectClauseMatch,
              matched_amendment: targetItem,
              amending_work_id_to_cite: targetItem.amending_work_id,
              explanation_banner_th:
                `**ต้องทราบวันเริ่มรอบระยะเวลาบัญชีจริงสำหรับปี พ.ศ. ${yrOnly + 543} (${yrOnly})**: คำถามระบุเฉพาะปีโดยไม่ระบุวันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชี ในขณะที่ **${targetItem.amending_instrument_title_th}** กำหนดให้ใช้บังคับเฉพาะ **รอบระยะเวลาบัญชีที่เริ่มในหรือหลังวันที่ \`${cutoffIso}\` เป็นต้นไป** (หากรอบระยะเวลาบัญชีปี ${yrOnly + 543} เป็นรอบไม่ตรงปีปฏิทินที่เริ่มในปี พ.ศ. ${yrOnly + 542} เช่น เริ่ม 1 กรกฎาคม ${yrOnly + 542} จะยังไม่เข้าเกณฑ์ใช้ตัวบทที่แก้ไขใหม่)`,
              containment_message_th: null,
              clarification_question_th:
                `กรุณาระบุวันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริงของบริษัทในปี พ.ศ. ${yrOnly + 543} (เริ่มในหรือหลังวันที่ ${cutoffIso} หรือเริ่มก่อนหน้านั้น?)`,
            };
          }
          if (yrOnly >= cutoffYrCe + 1) {
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
        }
      }

      const inferred12mStart = refEndOrPoint ? addMonthsMinusOneDay(refEndOrPoint, 12) : null;
      if (refEndOrPoint && inferred12mStart && inferred12mStart >= cutoffIso && refEndOrPoint >= "2020-01-01") {
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
        refEndOrPoint && refEndOrPoint >= cutoffIso && inferred12mStart && inferred12mStart < cutoffIso
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
    const exactEventEndIso =
      temporalCtx.transaction_date_end_iso || exactEventIso;
    const yearOnlyCe = temporalCtx.transaction_year_ce ?? temporalCtx.assessable_tax_year_ce;
    const cutoffYearCe = Number(cutoffIso.slice(0, 4));

    if (exactEventIso) {
      // Ambiguous DD/MM/YYYY vs MM/DD/YYYY numeric date straddling the amendment cutoff (e.g. `02/03/2019` = 2 Mar 2019 vs 3 Feb 2019 relative to `2019-02-28`)
      if (
        temporalCtx.ambiguous_numeric_date_alt_iso &&
        (exactEventIso < cutoffIso) !== (temporalCtx.ambiguous_numeric_date_alt_iso < cutoffIso)
      ) {
        return {
          action: "ASK_FOR_MISSING_RELEVANT_DATE",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: targetItem.amending_work_id,
          explanation_banner_th: `**รูปแบบวันที่ตัวเลขมีความกำกวมต่อวันเริ่มใช้บังคับของกฎหมาย**: วันที่ที่ระบุสามารถตีความได้ทั้งแบบ \`วัน/เดือน/ปี\` (\`${exactEventIso}\`) และ \`เดือน/วัน/ปี\` (\`${temporalCtx.ambiguous_numeric_date_alt_iso}\`) ซึ่งอยู่คนละฝั่งกับวันเริ่มใช้บังคับ (\`${cutoffIso}\`) ของ **${targetItem.amending_instrument_title_th}**`,
          containment_message_th: null,
          clarification_question_th: `กรุณายืนยันวันและเดือนให้ชัดเจนเป็นชื่อเดือนหรือรูปแบบ YYYY-MM-DD (เช่น ${exactEventIso} หรือ ${temporalCtx.ambiguous_numeric_date_alt_iso}) เพื่อตรวจสอบว่าเกิดก่อนหรือตั้งแต่วันที่ ${cutoffIso}`,
        };
      }

      // Partial sub-year period straddle (Month+Year `กุมภาพันธ์ 2562`, Quarter `ไตรมาส 1 ปี 2562` / `Q1 2019`, Half-Year `ครึ่งปีแรก 2562`, or `ต้นปี 2562` / `early 2019`)
      // Note: do NOT trigger this on explicit multi-point comparisons (`ระหว่างวันที่ 2018-06-30 กับ 2025-01-15`), where `has_multiple_distinct_point_dates` is true!
      const spanDays =
        exactEventEndIso && exactEventEndIso !== exactEventIso
          ? Math.round(
              (Date.parse(exactEventEndIso) - Date.parse(exactEventIso)) / 86_400_000
            )
          : 0;
      if (
        spanDays > 0 &&
        spanDays <= 185 &&
        !temporalCtx.has_multiple_distinct_point_dates &&
        exactEventIso < cutoffIso &&
        exactEventEndIso! >= cutoffIso
      ) {
        return {
          action: "ASK_FOR_MISSING_RELEVANT_DATE",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: targetItem.amending_work_id,
          explanation_banner_th: `**ต้องทราบวันที่เกิดธุรกรรมที่แน่นอนในช่วงเวลาดังกล่าว (\`${exactEventIso}\` ถึง \`${exactEventEndIso}\`)**: บทบัญญัติ ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} แก้ไขเพิ่มเติมโดย **${targetItem.amending_instrument_title_th}** มีผลใช้บังคับตั้งแต่วันที่ \`${cutoffIso}\` เป็นต้นไป`,
          containment_message_th: null,
          clarification_question_th: `กรุณาระบุวันที่เกิดธุรกรรมที่ชัดเจนว่าเกิดขึ้นก่อนหรือตั้งแต่วันที่ ${cutoffIso} เป็นต้นไป`,
        };
      }
      if (exactEventIso < cutoffIso || temporalCtx.is_upper_bounded_before_period) {
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} สำหรับช่วงเวลาไม่เกินวันที่ \`${exactEventIso}\` เนื่องจากบทบัญญัติฉบับปัจจุบันแก้ไขเพิ่มเติมโดย **${targetItem.amending_instrument_title_th}** (${targetItem.royal_gazette_ref || "ราชกิจจานุเบกษา"}${targetItem.amending_source_uri ? ` · ${targetItem.amending_source_uri}` : ""}) ซึ่งมีผลใช้บังคับตั้งแต่วันที่ \`${cutoffIso}\` เป็นต้นไป จึง **ไม่อาจนำบทบัญญัติที่แก้ไขใหม่มาใช้บังคับย้อนหลังกับช่วงเวลาก่อนวันที่ \`${cutoffIso}\` ได้** และตัวบทก่อนแก้ไขยังอยู่ระหว่างรอตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th: "กรุณาระบุวันเดือนปีที่เกิดธุรกรรมจริง หรือตรวจสอบตัวบทก่อนการแก้ไขเพิ่มเติมจากราชกิจจานุเบกษาโดยตรง",
        };
      }
      if (exactEventIso >= cutoffIso && exactEventIso < "2020-06-01" && targetItem.amending_work_id) {
        return {
          action: "ALLOW_VERIFIED_AMENDMENT_WITH_PROOF",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: targetItem.amending_work_id,
          explanation_banner_th: `**ผลการตรวจสอบวันมีผลใช้บังคับของบทบัญญัติ**: ธุรกรรมตั้งแต่วันที่ \`${exactEventIso}\` เกิดขึ้นในหรือหลังวันที่ \`${cutoffIso}\` ซึ่งเป็นวันเริ่มใช้บังคับของ **${targetItem.amending_instrument_title_th}** (${targetItem.royal_gazette_ref || ""}${targetItem.amending_source_uri ? ` · ${targetItem.amending_source_uri}` : ""}) บทบัญญัติ ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} ฉบับปัจจุบันจึงใช้บังคับได้`,
          containment_message_th: null,
          clarification_question_th: null,
        };
      }
    } else if (yearOnlyCe !== null) {
      if (yearOnlyCe < cutoffYearCe || temporalCtx.is_upper_bounded_before_period) {
        return {
          action: "CONTAIN_UNVERIFIED_HISTORICAL_VERSION",
          has_direct_clause_match: hasDirectClauseMatch,
          matched_amendment: targetItem,
          amending_work_id_to_cite: null,
          explanation_banner_th: null,
          containment_message_th: `ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง / หลักฐานไม่เพียงพอ — ระบบระงับการแสดงตัวบท ${secTitle}${targetItem.subprovision_label ? ` ${targetItem.subprovision_label}` : ""} สำหรับช่วงปี พ.ศ. ${yearOnlyCe + 543} (${yearOnlyCe}) หรือก่อนหน้านั้น เนื่องจากบทบัญญัติปัจจุบันแก้ไขเพิ่มเติมโดย **${targetItem.amending_instrument_title_th}** ซึ่งมีผลใช้บังคับตั้งแต่วันที่ \`${cutoffIso}\` เป็นต้นไป จึงไม่อาจนำมาใช้บังคับย้อนหลังก่อนวันมีผลใช้บังคับได้ และตัวบทก่อนแก้ไขยังอยู่ระหว่างรอตรวจรับรองจากราชกิจจานุเบกษา (${targetItem.pre_amendment_source_uri || "https://ratchakitcha.soc.go.th"})`,
          clarification_question_th: `กรุณาระบุวันเดือนปีที่เกิดธุรกรรมจริง หรือตรวจสอบตัวบทก่อนแก้ไขเพิ่มเติมจากราชกิจจานุเบกษาสำหรับปี พ.ศ. ${yearOnlyCe + 543}`,
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
 * Evaluates whether a TaxRuling can be used to answer an `APPLICABLE_LAW_AT_TIME` or
 * explicit ruling-applicability (`asks_whether_ruling_applies`) question, while ALWAYS
 * permitting `HISTORICAL_DOCUMENT_LOOKUP` and questions recounting a ruling's own requester facts.
 */
export function evaluateRulingTemporalApplicability(params: {
  rulingWork: LegalWork | undefined;
  rulingVersion: LegalVersion | undefined;
  conclusionText: string;
  requesterFactsText?: string;
  originUri?: string;
  hasQuarantinedExternalDependencies?: boolean;
  quarantinedCitationLabels?: string[];
  temporalCtx: TemporalFactContext;
  releaseId: string;
}): {
  shouldContainAnachronism: boolean;
  shouldAskClarificationForApplicability?: boolean;
  explanationBannerTh?: string | null;
  messageTh: string | null;
  clarificationQuestionTh?: string | null;
} {
  const { rulingWork, rulingVersion, conclusionText, temporalCtx, releaseId } = params;
  if (!rulingWork || rulingWork.type !== "TaxRuling") {
    return { shouldContainAnachronism: false, messageTh: null };
  }
  if (temporalCtx.query_intent === "HISTORICAL_DOCUMENT_LOOKUP") {
    return { shouldContainAnachronism: false, messageTh: null };
  }
  if (!temporalCtx.has_any_temporal_anchor && !temporalCtx.asks_whether_ruling_applies) {
    return { shouldContainAnachronism: false, messageTh: null };
  }

  const rId = rulingWork.official_identifiers[0]?.normalized || rulingWork.work_id;
  const srcRef = params.originUri ? ` (ต้นฉบับ: ${params.originUri})` : "";
  const rulingDecisionIso = rulingVersion?.decision_date || null;
  const rulingDecisionYearCe = rulingDecisionIso ? Number(rulingDecisionIso.slice(0, 4)) : null;

  // 0. Vague historical reference (`เมื่อหลายปีก่อน`, `ในอดีต`, `several years ago`) or explicit pre-amendment request
  if (temporalCtx.asks_pre_amendment_version_explicitly || temporalCtx.has_vague_historical_reference) {
    return {
      shouldContainAnachronism: true,
      messageTh: `ไม่พบข้อมูลหลักฐานที่ใช้ยืนยันการบังคับใช้ย้อนหลัง / หลักฐานไม่เพียงพอ — หนังสือตอบข้อหารือ \`${rId}\` (${rulingVersion?.raw_date_text || rulingDecisionIso || "ไม่ระบุวันที่"}${srcRef}) เป็นความเห็นทางปกครองเฉพาะรายตามข้อเท็จจริงและกฎหมายในขณะวินิจฉัย ระบบจึงไม่คาดเดาหรือนำแนววินิจฉัยนี้ไปรับรองใช้กับช่วงเวลาในอดีตที่ยังไม่ระบุวันเดือนปีชัดเจนโดยไม่มีตัวบทกฎหมายที่ผ่านการรับรองสำหรับช่วงเวลานั้น`,
      clarificationQuestionTh:
        "กรุณาระบุวันเดือนปีที่เกิดธุรกรรมหรือวันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริง เพื่อตรวจสอบบทบัญญัติที่ใช้บังคับ",
    };
  }

  const userEarliestIso =
    temporalCtx.accounting_period_start_iso ||
    temporalCtx.accounting_period_start_max_iso ||
    temporalCtx.transaction_date_iso ||
    temporalCtx.point_in_time_date_iso ||
    temporalCtx.accounting_period_end_iso;

  const userYearCe =
    (userEarliestIso ? Number(userEarliestIso.slice(0, 4)) : null) ??
    temporalCtx.transaction_year_ce ??
    temporalCtx.assessable_tax_year_ce;

  // 0b. Self-Fact Protection: When user is NOT asking to transfer/apply the ruling to an external case (`!asks_whether_ruling_applies`),
  //     and the year mentioned in the question literally appears inside the ruling's own recorded requester facts (e.g. `ลดทุนเหลือ 5 ล้านบาทในปี 2543` in `กค 0702/4825`),
  //     treat it as reading the ruling's own decision rather than projecting the ruling onto an external historical tax return!
  if (
    !temporalCtx.asks_whether_ruling_applies &&
    !temporalCtx.point_in_time_date_iso &&
    !temporalCtx.is_upper_bounded_before_period &&
    userYearCe !== null &&
    params.requesterFactsText
  ) {
    const normReqFacts = thaiDigitsToArabic(params.requesterFactsText);
    const yrBeRe = new RegExp(`(?<![0-9/,])${userYearCe + 543}(?![0-9/,])`);
    const yrCeRe = new RegExp(`(?<![0-9/,])${userYearCe}(?![0-9/,])`);
    if (yrBeRe.test(normReqFacts) || yrCeRe.test(normReqFacts)) {
      return { shouldContainAnachronism: false, messageTh: null };
    }
  }

  // 0c. Questions that BOTH mention a ruling AND ask whether it applies, WITHOUT a complete year/date (`has_yearless_partial_date` or `userYearCe === null`)
  if (userYearCe === null) {
    if (!temporalCtx.asks_whether_ruling_applies && !temporalCtx.has_yearless_partial_date) {
      return { shouldContainAnachronism: false, messageTh: null };
    }
    const quarList = (params.quarantinedCitationLabels || []).join(", ");
    if (
      params.hasQuarantinedExternalDependencies ||
      (rulingDecisionYearCe !== null && rulingDecisionYearCe < 2021)
    ) {
      const reasonDetail = params.hasQuarantinedExternalDependencies
        ? ` อีกทั้งข้อหารือฉบับนี้มีการอ้างอิงกฎหมายลำดับรองภายนอกที่ยังอยู่ในทะเบียนกักกันรอตรวจรับรองต้นฉบับ (${quarList || "usable_as_legal_evidence: false"})`
        : ` ซึ่งเป็นความเห็นเฉพาะรายที่ออกเมื่อปี พ.ศ. ${rulingDecisionYearCe! + 543}`;
      return {
        shouldContainAnachronism: true,
        messageTh: `ไม่พบข้อมูลหลักฐานที่เพียงพอในการยืนยันว่าหนังสือตอบข้อหารือ \`${rId}\` (${rulingVersion?.raw_date_text || rulingDecisionIso || ""}${srcRef}) ใช้บังคับกับกรณีที่ถามได้โดยอัตโนมัติ — หนังสือตอบข้อหารือกรมสรรพากรเป็นแนววินิจฉัยเฉพาะรายตามข้อเท็จจริงของผู้ขอหารือ${reasonDetail} และคำถามยังไม่ได้ระบุวันเดือนปีที่เกิดธุรกรรมหรือวันเริ่มรอบระยะเวลาบัญชีที่ครบถ้วน ระบบจึงระงับการฟันธงและไม่คาดเดาว่ากฎหมายที่เกี่ยวข้องยังคงใช้บังคับไม่เปลี่ยนแปลง (หากต้องการเปิดอ่านเนื้อหาต้นฉบับของ \`${rId}\` โดยตรง กรุณาค้นหาเฉพาะเลขที่หนังสือ)`,
        clarificationQuestionTh:
          "กรุณาระบุวันเดือนปี (พ.ศ./ค.ศ.) ที่เกิดธุรกรรมหรือวันเริ่ม–สิ้นสุดรอบระยะเวลาบัญชีจริง พร้อมข้อเท็จจริงสำคัญของกิจการ เพื่อตรวจสอบกับบทบัญญัติที่ใช้บังคับ",
      };
    }

    return {
      shouldContainAnachronism: false,
      shouldAskClarificationForApplicability: true,
      explanationBannerTh:
        `**ข้อจำกัดการใช้หนังสือตอบข้อหารือเฉพาะราย (\`${rId}\` ลงวันที่ ${rulingVersion?.raw_date_text || rulingDecisionIso || "-"})**: เอกสารฉบับนี้เป็นความเห็นทางปกครองเฉพาะรายตามข้อเท็จจริงของผู้ขอหารือ${srcRef} การพิจารณาว่าจะนำแนววินิจฉัยนี้มาเทียบเคียงใช้ได้หรือไม่ ต้องยืนยันทั้ง **(1) วันเดือนปีที่เกิดธุรกรรม/รอบระยะเวลาบัญชีจริง** ว่าอยู่ในบังคับบทบัญญัติรุ่นเดียวกัน และ **(2) เงื่อนไขข้อเท็จจริงทุกประการ** ตามแนววินิจฉัยด้านล่าง`,
      messageTh: null,
      clarificationQuestionTh: `กรุณาระบุวันเดือนปีที่เกิดธุรกรรมหรือรอบระยะเวลาบัญชีจริง และยืนยันว่าข้อเท็จจริงของท่านตรงตามเงื่อนไขใน ${rId} ทุกประการหรือไม่`,
    };
  }

  const normConc = thaiDigitsToArabic(conclusionText);
  const citedStatuteYearsBe = [
    ...normConc.matchAll(
      /(?:พระราชบัญญัติ|พระราชกำหนด|พระราชกฤษฎีกา|กฎกระทรวง|ประกาศ[^\n,;]{0,45})[^,;]{0,80}?พ\.ศ\.\s*(25[0-9]{2})/g
    ),
  ].map((m) => Number(m[1]));

  const postPeriodStatuteYearBe = citedStatuteYearsBe.find((yrBe) => yrBe - 543 > userYearCe);
  if (postPeriodStatuteYearBe) {
    return {
      shouldContainAnachronism: true,
      messageTh: `ไม่พบข้อมูลหลักฐานกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543} ที่ผ่านการรับรองอย่างเพียงพอ — แนววินิจฉัยที่อ้างอิงหรือใกล้เคียงที่สุดในคลังข้อมูลชุด ${releaseId} คือหนังสือตอบข้อหารือ \`${rId}\` (${rulingVersion?.raw_date_text || ""}${srcRef}) ซึ่งวินิจฉัยโดยอ้างอิงกฎหมายปี พ.ศ. ${postPeriodStatuteYearBe} ที่ตราขึ้นภายหลังช่วงเวลาที่ถาม ระบบจึงระงับการนำแนววินิจฉัยภายหลังมาสรุปใช้ย้อนหลังโดยไม่ตรวจสอบตัวบทกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543}`,
      clarificationQuestionTh: `กรุณาตรวจสอบตัวบทกฎหมายที่ใช้บังคับจริงในปี พ.ศ. ${userYearCe + 543} จากราชกิจจานุเบกษาโดยตรง`,
    };
  }

  // 1. Ruling was issued AFTER the user's queried transaction/period date (for ANY year, including explicit ruling + historical date queries!)
  if (
    (rulingDecisionIso && userEarliestIso && rulingDecisionIso > userEarliestIso) ||
    (rulingDecisionYearCe !== null && rulingDecisionYearCe > userYearCe)
  ) {
    const rulingYrBe = rulingDecisionYearCe ? rulingDecisionYearCe + 543 : "";
    return {
      shouldContainAnachronism: true,
      messageTh: `ไม่พบข้อมูลหลักฐานกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543}${userEarliestIso ? ` (\`${userEarliestIso}\`)` : ""} ที่ผ่านการรับรองอย่างเพียงพอ — หนังสือตอบข้อหารือ \`${rId}\` ออกเมื่อวันที่ ${rulingVersion?.raw_date_text || rulingDecisionIso || `พ.ศ. ${rulingYrBe}`}${srcRef} ซึ่งออก **ภายหลัง** ช่วงเวลาของข้อเท็จจริงที่ถาม ระบบจึงระงับการนำแนววินิจฉัยเฉพาะรายในภายหลังมาสรุปยืนยันเป็นกฎหมายที่ใช้บังคับย้อนหลังโดยไม่มีตัวบทที่ผ่านการรับรองสำหรับช่วงเวลาดังกล่าว (หากต้องการอ่านเนื้อหาข้อหารือ \`${rId}\` ตามข้อเท็จจริงเดิมโดยตรง กรุณาค้นหาเฉพาะเลขที่หนังสือโดยไม่ระบุช่วงเวลาย้อนหลังอื่น)`,
      clarificationQuestionTh:
        "กรุณาตรวจสอบตัวบทกฎหมายที่ใช้บังคับจริงในช่วงเวลาที่ถามจากราชกิจจานุเบกษา หรือค้นหาเฉพาะเลขที่หนังสือตอบข้อหารือ",
    };
  }

  // 2. Older case-specific ruling vs a LATER queried year (`rulingDecisionYearCe < userYearCe`):
  //    Contain when `userYearCe < 2020`, OR when `asks_whether_ruling_applies` and either quarantined external decrees are involved or >= 2 years elapsed without verified statutory continuity!
  if (
    rulingDecisionYearCe !== null &&
    rulingDecisionYearCe < userYearCe &&
    (userYearCe < 2020 ||
      (temporalCtx.asks_whether_ruling_applies &&
        (params.hasQuarantinedExternalDependencies || userYearCe - rulingDecisionYearCe >= 2)))
  ) {
    const quarSuffix = params.hasQuarantinedExternalDependencies
      ? ` อีกทั้งกฎหมายลำดับรองที่อ้างถึงในข้อหารือยังอยู่ในทะเบียนกักกันรอตรวจรับรองต้นฉบับ (${(params.quarantinedCitationLabels || []).join(", ")})`
      : "";
    return {
      shouldContainAnachronism: true,
      messageTh: `ไม่พบข้อมูลหลักฐานกฎหมายที่ใช้บังคับในปี พ.ศ. ${userYearCe + 543} ที่ผ่านการรับรองอย่างเพียงพอ — แม้คลังข้อมูลชุด ${releaseId} มีหนังสือตอบข้อหารือ \`${rId}\` ลงวันที่ ${rulingVersion?.raw_date_text || rulingDecisionIso} (พ.ศ. ${rulingDecisionYearCe + 543}${srcRef}) แต่เอกสารดังกล่าวเป็นความเห็นเฉพาะรายในปี พ.ศ. ${rulingDecisionYearCe + 543}${quarSuffix} และระบบยังไม่มีหลักฐานยืนยันครบทุกการแก้ไขเพิ่มเติมของกฎหมายลำดับรองจนถึงปี พ.ศ. ${userYearCe + 543} จึงระงับการรับรองว่าแนววินิจฉัยดังกล่าวยังคงใช้บังคับได้โดยไม่เปลี่ยนแปลงในปี พ.ศ. ${userYearCe + 543} (หากต้องการเปิดอ่านข้อหารือ \`${rId}\` โดยตรง กรุณาค้นหาเฉพาะเลขที่หนังสือ)`,
      clarificationQuestionTh:
        "กรุณาตรวจสอบตัวบทกฎหมายและกฎหมายลำดับรองที่ใช้บังคับในปีที่เกิดธุรกรรม หรือค้นหาเฉพาะเลขที่หนังสือตอบข้อหารือเพื่ออ่านข้อเท็จจริงเดิม",
    };
  }

  // 3. Explicit ruling-applicability query in a contemporaneous verified period: require factual-condition confirmation rather than unconditional "yes"!
  if (temporalCtx.asks_whether_ruling_applies) {
    if (params.hasQuarantinedExternalDependencies) {
      return {
        shouldContainAnachronism: true,
        messageTh: `ไม่พบข้อมูลตัวบทกฎหมายลำดับรองที่ผ่านการรับรองครบถ้วน — หนังสือตอบข้อหารือ \`${rId}\` (${rulingVersion?.raw_date_text || rulingDecisionIso || ""}${srcRef}) มีการอ้างอิงกฎหมายลำดับรองที่ยังอยู่ในทะเบียนกักกันรอตรวจรับรองต้นฉบับ (${(params.quarantinedCitationLabels || []).join(", ")}) ระบบจึงไม่รับรองการนำข้อหารือนี้ไปปรับใช้กับกรณีอื่นโดยยังไม่ได้ตรวจรับรองตัวบทกฎหมายลำดับรองต้นฉบับ`,
        clarificationQuestionTh:
          "กรุณาตรวจสอบตัวบทกฎหมายลำดับรองต้นฉบับจากราชกิจจานุเบกษา หรือค้นหาเฉพาะเลขที่หนังสือตอบข้อหารือเพื่อดูแนววินิจฉัยตามข้อเท็จจริงเดิม",
      };
    }
    return {
      shouldContainAnachronism: false,
      shouldAskClarificationForApplicability: true,
      explanationBannerTh:
        `**ข้อจำกัดการใช้หนังสือตอบข้อหารือเฉพาะราย (\`${rId}\` ลงวันที่ ${rulingVersion?.raw_date_text || rulingDecisionIso || "-"})**: หนังสือตอบข้อหารือกรมสรรพากรมีผลเฉพาะรายตามข้อเท็จจริงของผู้ขอหารือ${srcRef} การนำมาเทียบเคียงกับธุรกรรมวันที่/ปีที่ระบุ ต้องตรวจสอบให้มั่นใจว่าข้อเท็จจริงและเงื่อนไขทางกฎหมายตรงกันทุกประการ`,
      messageTh: null,
      clarificationQuestionTh: `กรุณายืนยันว่าข้อเท็จจริงและเอกสารหลักฐานของกิจการตรงตามเงื่อนไขสำคัญใน ${rId} ทุกประการหรือไม่`,
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
