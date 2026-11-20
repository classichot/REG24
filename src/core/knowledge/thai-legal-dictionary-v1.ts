/**
 * REG24 — Versioned Thai Legal Dictionary & Pinned Thai-Aware Tokenizer (`reg24-th-legal-dict-v1.0`)
 *
 * Single pinned normalization, tokenizer, and legal dictionary contract used identically on BOTH:
 *   1. Offline/candidate index build (`buildReleaseProjectionsFromOutbox` / `build-rc7-candidate-overlay.ts`), and
 *   2. Live BM25 query runtime (`retrieveAuthorizedKnowledge`) on Next.js / Vercel Linux.
 *
 * Design guarantees (Section 1 & Section 2):
 *   - ONE engine on both sides (`ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`); ZERO mixed-engine
 *     index/query builds and ZERO silent per-passage fallback.
 *   - Preserves original Thai text untouched; all normalization happens in separate search fields.
 *   - Normalizes Thai digits <-> Arabic digits, known Thai legal abbreviations, spacing, and citation forms.
 *   - Preserves composite identifiers atomically (e.g., `มาตรา ๘๐/๑ (๒)` -> `sec:80/1(2)` + `sec:80/1`,
 *     NEVER emitting `sec:80` so `มาตรา 80/1` is never confused with `มาตรา 80`!).
 *   - Preserves Thai legal negations & exception markers (`มิให้`, `เว้นแต่`, `ไม่รวม`, `ไม่ต้อง`,
 *     `ยกเว้น`, `นอกจาก`, `ห้ามมิให้`, `ไม่มีค่าตอบแทน`, `โดยเสน่หา`, `ไม่ถือเป็น`, etc.).
 */

import { sha256Bytes, thaiDigitsToArabic } from "./identity";

export const THAI_LEGAL_DICTIONARY_VERSION = "reg24-th-legal-dict-v1.0";
export const THAI_TOKENIZER_ENGINE_ID = "ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0";

/** Negations & exception markers that MUST remain intact single tokens at index and query time. */
export const THAI_LEGAL_NEGATIONS_AND_EXCEPTIONS: readonly string[] = [
  "มิให้",
  "ห้ามมิให้",
  "เว้นแต่",
  "ยกเว้น",
  "ได้รับยกเว้น",
  "ไม่รวม",
  "ไม่ต้อง",
  "ไม่ต้องรวมคำนวณ",
  "ไม่ถือเป็น",
  "ไม่ถือว่า",
  "ไม่เป็น",
  "ไม่เข้าข่าย",
  "ไม่มีค่าตอบแทน",
  "โดยเสน่หา",
  "นอกจาก",
  "ไม่เกิน",
  "เกินกว่า",
  "ไม่น้อยกว่า",
  "มิใช่",
  "มิได้",
  "ไม่ใช่",
  "ไม่ได้",
  "ไม่เสียภาษี",
  "ไม่อยู่ในบังคับ",
  "ไม่รวมถึง",
  "ไม่นับรวม",
  "ภายใต้บังคับ",
  "ทั้งนี้",
];

/** Versioned Thai Tax & Statutory Legal Compound Dictionary (applied on top of PyThaiNLP newmm lexicon). */
export const THAI_LEGAL_COMPOUND_TERMS: readonly string[] = [
  ...THAI_LEGAL_NEGATIONS_AND_EXCEPTIONS,
  // Statutory instruments & identifiers
  "ประมวลรัษฎากร",
  "พระราชบัญญัติ",
  "พระราชบัญญัติแก้ไขเพิ่มเติม",
  "พระราชกฤษฎีกา",
  "พระราชกำหนด",
  "กฎกระทรวง",
  "ประกาศอธิบดีกรมสรรพากร",
  "ประกาศกระทรวงการคลัง",
  "คำสั่งกรมสรรพากร",
  "หนังสือตอบข้อหารือ",
  "ข้อหารือ",
  "ราชกิจจานุเบกษา",
  "บทเฉพาะกาล",
  "หมายเหตุ",
  "เหตุผลในการประกาศใช้",
  // Tax types & core concepts
  "ภาษีมูลค่าเพิ่ม",
  "ภาษีท้องถิ่น",
  "ภาษีธุรกิจเฉพาะ",
  "ภาษีเงินได้บุคคลธรรมดา",
  "ภาษีเงินได้นิติบุคคล",
  "ภาษีเงินได้หัก ณ ที่จ่าย",
  "หักภาษี ณ ที่จ่าย",
  "ภาษีหัก ณ ที่จ่าย",
  "อากรแสตมป์",
  "ภาษีมรดก",
  "ภาษีการรับมรดก",
  "ภาษีการรับให้",
  "ภาษีซื้อ",
  "ภาษีขาย",
  "ใบกำกับภาษี",
  "ใบเพิ่มหนี้",
  "ใบลดหนี้",
  "ผู้ประกอบการจดทะเบียน",
  "ผู้มีเงินได้",
  "เงินได้พึงประเมิน",
  "เงินได้สุทธิ",
  "เงินได้จากการให้",
  "ความรับผิดในการเสียภาษีมูลค่าเพิ่ม",
  "วันเกิดความรับผิด",
  "การลดอัตราภาษีมูลค่าเพิ่ม",
  "คงจัดเก็บในอัตรา",
  "อัตราร้อยละ",
  "อัตราศูนย์",
  "อัตราร้อยละศูนย์",
  "ร้อยละหกจุดสาม",
  "ร้อยละเจ็ด",
  "ร้อยละสิบ",
  "ร้อยละห้า",
  // VAT routing distinctions (domestic vs zero-rate vs exempt vs mixed-use vs cross-border)
  "การขายสินค้า",
  "การให้บริการ",
  "การนำเข้า",
  "การส่งออก",
  "ส่งออกสินค้า",
  "ส่งออกบริการ",
  "ให้บริการในราชอาณาจักร",
  "ใช้บริการในต่างประเทศ",
  "ใช้บริการในราชอาณาจักร",
  "นอกราชอาณาจักร",
  "ในราชอาณาจักร",
  "เขตปลอดอากร",
  "คลังสินค้าทัณฑ์บน",
  "เฉลี่ยภาษีซื้อ",
  "กิจการที่ต้องเสียภาษีมูลค่าเพิ่ม",
  "กิจการที่ไม่ต้องเสียภาษีมูลค่าเพิ่ม",
  "กิจการที่ได้รับยกเว้นภาษีมูลค่าเพิ่ม",
  "นำส่งภาษีมูลค่าเพิ่ม",
  "ภ.พ.36",
  "ภ.พ.30",
  // Gift / property transfer & family relationships (distinct legal categories!)
  "อสังหาริมทรัพย์",
  "สังหาริมทรัพย์",
  "ห้องชุด",
  "คอนโดมิเนียม",
  "ที่ดิน",
  "ที่ดินพร้อมสิ่งปลูกสร้าง",
  "อาคารชุด",
  "กรรมสิทธิ์",
  "สิทธิครอบครอง",
  "โอนกรรมสิทธิ์",
  "จดทะเบียนสิทธิและนิติกรรม",
  "ราคาประเมิน",
  "ราคาประเมินทุนทรัพย์",
  "เจ้าพนักงานที่ดิน",
  "ผู้ให้",
  "ผู้รับ",
  "ผู้โอน",
  "ผู้รับโอน",
  "บุพการี",
  "ผู้สืบสันดาน",
  "คู่สมรส",
  "บุตรชอบด้วยกฎหมาย",
  "บุตรบุญธรรม",
  "พี่น้อง",
  "พี่ชาย",
  "พี่สาว",
  "น้องชาย",
  "น้องสาว",
  "หลาน",
  "หลานชาย",
  "หลานสาว",
  "หลานปู่",
  "หลานตา",
  "บุตรของพี่สาว",
  "บุตรของพี่ชาย",
  "บุตรของน้องชาย",
  "บุตรของน้องสาว",
  "ลุง",
  "ป้า",
  "น้า",
  "อา",
  "อุปการะตามหน้าที่ธรรมจรรยา",
  "ขนบธรรมเนียมประเพณี",
  "พิธีหรือโอกาสแห่งขนบธรรมเนียมประเพณี",
  "รับผิดร่วม",
  "ความรับผิดร่วม",
  "หักภาษีไว้ไม่ครบ",
  "เงินเพิ่ม",
  "เบี้ยปรับ",
  // Corporate / WHT / cross-border / dates
  "รอบระยะเวลาบัญชี",
  "ปีภาษี",
  "รายจ่ายต้องห้าม",
  "ค่าบริการ",
  "ค่าสิทธิ",
  "เงินปันผล",
  "ดอกเบี้ย",
  "ค่าเช่า",
  "ค่าจ้างทำของ",
  "อนุสัญญาภาษีซ้อน",
  "สถานประกอบการถาวร",
  "ใช้บังคับตั้งแต่วันที่",
  "มีผลใช้บังคับ",
  "ตั้งแต่วันที่",
  "ถึงวันที่",
  "ให้ยกเลิกความใน",
  "และให้ใช้ความต่อไปนี้แทน",
];

/** Canonical Thai legal abbreviation expansions (applied in separate normalized search fields only). */
export const THAI_LEGAL_ABBREVIATION_MAP: ReadonlyArray<[RegExp, string]> = [
  [/พ\.ร\.ฎ\./g, "พระราชกฤษฎีกา"],
  [/พ\.ร\.บ\./g, "พระราชบัญญัติ"],
  [/พ\.ร\.ก\./g, "พระราชกำหนด"],
  [/ป\.ร\./g, "ประมวลรัษฎากร"],
  [/ป\.พ\.พ\./g, "ประมวลกฎหมายแพ่งและพาณิชย์"],
  [/ท\.ป\./g, "คำสั่งกรมสรรพากร ท.ป."],
  [/\bvat\b/gi, "ภาษีมูลค่าเพิ่ม"],
  [/\bwht\b/gi, "หักภาษี ณ ที่จ่าย"],
  [/\bpit\b/gi, "ภาษีเงินได้บุคคลธรรมดา"],
  [/\bcit\b/gi, "ภาษีเงินได้นิติบุคคล"],
  [/\bsbt\b/gi, "ภาษีธุรกิจเฉพาะ"],
  [/คอนโดมิเนียม|คอนโด/g, "ห้องชุด คอนโดมิเนียม"],
];

const LEGAL_TERM_SET = new Set<string>(THAI_LEGAL_COMPOUND_TERMS);
const MAX_LEGAL_TERM_LEN = Math.max(...THAI_LEGAL_COMPOUND_TERMS.map((t) => t.length));

export function getThaiLegalDictionarySha256(): string {
  return sha256Bytes(
    JSON.stringify({
      version: THAI_LEGAL_DICTIONARY_VERSION,
      terms: THAI_LEGAL_COMPOUND_TERMS,
      negations: THAI_LEGAL_NEGATIONS_AND_EXCEPTIONS,
      abbreviations: THAI_LEGAL_ABBREVIATION_MAP.map(([re, repl]) => [re.source, re.flags, repl]),
    })
  );
}

export interface ThaiTokenizerContractMetadata {
  tokenizer_engine: string;
  tokenizer_contract_sha256: string;
  legal_dictionary_version: string;
  legal_dictionary_sha256: string;
  runtime_icu_version: string;
}

export function getThaiTokenizerContractMetadata(): ThaiTokenizerContractMetadata {
  const dictSha = getThaiLegalDictionarySha256();
  const contractSha = sha256Bytes(
    JSON.stringify({
      tokenizer_engine: THAI_TOKENIZER_ENGINE_ID,
      normalizer: "thaiDigitsToArabic+abbrevMapV1+compositeSlashMaskV1",
      segmenter: "longestMatchLegalDict+Intl.Segmenter(th,word)",
      legal_dictionary_version: THAI_LEGAL_DICTIONARY_VERSION,
      legal_dictionary_sha256: dictSha,
    })
  );
  return {
    tokenizer_engine: THAI_TOKENIZER_ENGINE_ID,
    tokenizer_contract_sha256: contractSha,
    legal_dictionary_version: THAI_LEGAL_DICTIONARY_VERSION,
    legal_dictionary_sha256: dictSha,
    runtime_icu_version:
      (typeof process !== "undefined" && process.versions?.icu) || "unknown",
  };
}

/**
 * Extracts ATOMIC composite Thai legal identifiers so that:
 *   - `มาตรา ๘๐/๑ (๒)` -> `["sec:80/1(2)", "sec:80/1"]` (NEVER `"sec:80"`!)
 *   - `มาตรา 80` -> `["sec:80"]`
 *   - `มาตรา 42 (28)` -> `["sec:42(28)", "sec:42"]`
 *   - `พ.ร.ฎ. (ฉบับที่ ๗๙๐)` -> `["rd:790"]`
 *   - `กค 0702/5958` -> `["ruling:กค_0702/5958"]`
 */
export function extractCompositeLegalTokens(rawText: string): string[] {
  const arabic = thaiDigitsToArabic(rawText || "");
  const out = new Set<string>();

  // 1. Composite sections: มาตรา 80/1 (2), มาตรา 42 (28), มาตรา 3 เตรส, ข้อ 12 (1)
  const secRe =
    /(มาตรา|ข้อ)\s*([0-9]+(?:\/[0-9]+)?)(?:\s*(อัฏฐารส|สัตตรส|เอกาทศ|ทวาทศ|จตุทศ|ปัณรส|จัตวา|เบญจ|เตรส|โสฬส|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ))?((?:\s*\([0-9ก-ฮ]+\))*)/g;
  let m: RegExpExecArray | null;
  while ((m = secRe.exec(arabic)) !== null) {
    const kind = m[1] === "ข้อ" ? "clause" : "sec";
    const numPart = m[2]; // e.g., "80/1" or "80" — kept atomic!
    const thaiSuffix = m[3] ? `_${m[3]}` : "";
    const subParts = (m[4] || "").replace(/\s+/g, ""); // e.g., "(2)" or "(28)"
    const baseToken = `${kind}:${numPart}${thaiSuffix}`;
    out.add(baseToken);
    if (subParts) {
      out.add(`${baseToken}${subParts}`);
    }
  }

  // 2. Royal Decrees / Ministerial Regs / Amending Acts: ฉบับที่ 790, พ.ร.ฎ. 799, พ.ร.ฎ. (ฉบับที่ 807)
  const rdRe =
    /(?:พระราชกฤษฎีกา|พ\.ร\.ฎ\.)[^\n]{0,90}?(?:ฉบับที่\s*|เลขที่\s*|\(\s*ฉบับที่\s*|\s+)([0-9]{1,4})(?![0-9/])/g;
  while ((m = rdRe.exec(arabic)) !== null) {
    out.add(`rd:${m[1]}`);
  }
  const minRegRe =
    /(?:กฎกระทรวง)[^\n]{0,40}?(?:ฉบับที่\s*)([0-9]{1,4})(?![0-9/])/g;
  while ((m = minRegRe.exec(arabic)) !== null) {
    out.add(`minreg:${m[1]}`);
  }
  const amendActRe =
    /(?:พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร)[^\n]{0,40}?(?:ฉบับที่\s*)([0-9]{1,3})(?![0-9/])/g;
  while ((m = amendActRe.exec(arabic)) !== null) {
    out.add(`rc_amend:${m[1]}`);
  }

  // 3. Revenue Department Rulings: กค 0702/5958, 0702/5958 (bare), กค 0811/พ.06343
  const rulingRe =
    /(?:กค\s*[0-9]{2,5}|(?<![0-9/])0[78][0-9]{2})(?:\s*\([^)]+\))?\s*[\/\-]\s*(?:[ก-ฮA-Za-z.]+\s*[\/\-]?\s*)?[0-9]+[ก-ฮA-Za-z]*/g;
  while ((m = rulingRe.exec(arabic)) !== null) {
    const bare = m[0]
      .replace(/^กค\s*/, "")
      .replace(/\s+/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .trim();
    out.add(`ruling:กค_${bare}`);
  }

  // 4. Tax Order TP / P: ท.ป. 4/2528, ป. 52/2537
  const orderRe = /(ท\.ป\.|ป\.)\s*([0-9]+\/[0-9]{4})/g;
  while ((m = orderRe.exec(arabic)) !== null) {
    out.add(`order:${m[1]}${m[2]}`);
  }

  return Array.from(out);
}

/**
 * Produces a separate normalized search string WITHOUT mutating the original Thai text.
 */
export function normalizeTextForThaiLegalSearchField(rawText: string): string {
  let norm = thaiDigitsToArabic(rawText || "");
  for (const [re, replacement] of THAI_LEGAL_ABBREVIATION_MAP) {
    norm = norm.replace(re, ` ${replacement} `);
  }
  return norm.replace(/\s+/g, " ").trim();
}

/**
 * Extracts preserved Thai legal negation & exception tokens present in text.
 */
export function extractPreservedNegationTokens(rawText: string): string[] {
  const norm = thaiDigitsToArabic(rawText || "");
  const found: string[] = [];
  for (const term of THAI_LEGAL_NEGATIONS_AND_EXCEPTIONS) {
    if (norm.includes(term)) {
      found.push(term);
    }
  }
  return found;
}

/**
 * Runtime-consistent Thai-aware tokenizer aligned with PyThaiNLP `newmm` + `reg24-th-legal-dict-v1.0`:
 *   1. Emits atomic composite legal tokens FIRST (so `มาตรา 80/1 (2)` emits `sec:80/1(2)` + `sec:80/1`,
 *      and masks the raw slash-number span so `80` is NEVER emitted as a standalone match for `มาตรา 80`!).
 *   2. Uses longest-match (maximal matching) over `THAI_LEGAL_COMPOUND_TERMS` (preserving negations
 *      `มิให้`, `เว้นแต่`, `ไม่มีค่าตอบแทน`, compound tax phrases, etc.) combined with `Intl.Segmenter("th")`
 *      for general Thai words when outside the legal compound dictionary.
 *   3. Keeps standalone English/number tokens cleanly normalized.
 */
let thaiWordSegmenter: Intl.Segmenter | null = null;
function getThaiSegmenter(): Intl.Segmenter {
  if (thaiWordSegmenter) return thaiWordSegmenter;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    throw new Error(
      "TOKENIZER_CONTRACT_VIOLATION: Intl.Segmenter('th') is unavailable in this runtime; refusing silent regex fallback."
    );
  }
  thaiWordSegmenter = new Intl.Segmenter("th", { granularity: "word" });
  return thaiWordSegmenter;
}

export function tokenizeThaiLegalWithDictionary(
  rawText: string,
  options?: { includeDuplicates?: boolean; expandAbbreviations?: boolean }
): string[] {
  const includeDuplicates = options?.includeDuplicates ?? true;
  const expandAbbreviations = options?.expandAbbreviations ?? true;

  const compositeTokens = extractCompositeLegalTokens(rawText);
  const workingBase = expandAbbreviations
    ? normalizeTextForThaiLegalSearchField(rawText)
    : thaiDigitsToArabic(rawText || "");

  // Mask composite section numbers like `มาตรา 80/1 (2)` from generating stray `80` tokens!
  const maskedForGeneralTokens = workingBase.replace(
    /(?:มาตรา|ข้อ)\s*[0-9]+\/[0-9]+(?:\s*\([0-9ก-ฮ]+\))*/g,
    " "
  );

  const tokens: string[] = [...compositeTokens];

  // Maximal-matching scan prioritizing versioned Thai legal compound & negation dictionary
  let i = 0;
  const n = maskedForGeneralTokens.length;
  let residualStart = 0;

  const flushResidual = (end: number) => {
    if (end <= residualStart) return;
    const chunk = maskedForGeneralTokens.slice(residualStart, end);
    const seg = getThaiSegmenter();
    for (const part of seg.segment(chunk)) {
      if (!part.isWordLike) continue;
      const tok = part.segment.toLowerCase().trim();
      if (tok.length >= 2 || /^[0-9]+$/.test(tok)) {
        tokens.push(tok);
      }
    }
  };

  while (i < n) {
    let matched: string | null = null;
    const ch = maskedForGeneralTokens.charCodeAt(i);
    // Only test Thai legal compound dictionary at Thai Unicode characters (U+0E00..U+0E7F)
    if (ch >= 0x0e00 && ch <= 0x0e7f) {
      const maxLen = Math.min(MAX_LEGAL_TERM_LEN, n - i);
      for (let len = maxLen; len >= 3; len--) {
        const cand = maskedForGeneralTokens.slice(i, i + len);
        if (LEGAL_TERM_SET.has(cand)) {
          matched = cand;
          break;
        }
      }
    }
    if (matched) {
      flushResidual(i);
      tokens.push(matched);
      i += matched.length;
      residualStart = i;
    } else {
      i += 1;
    }
  }
  flushResidual(n);

  return includeDuplicates ? tokens : Array.from(new Set(tokens));
}
