/**
 * REG24 Thai Legal Transcription, Native Layer Eligibility, 3-Layer Normalization & Semantics (`REG-003`)
 * Specification Sections 5 & 6 — `thai-legal-norm/2.0.0`
 */

import {
  LegalAnnotation,
  LegalDateRole,
  LegalGraphRelationKind,
  OCRIssue,
  RenderedPageEvidence,
  SourceSpan,
  ThaiLegalEntityType,
  sha256HexLower,
} from "./contract";

export const THAI_NORMALIZATION_RULESET_V2 = "thai-legal-norm/2.0.0";
export const THAI_SEMANTIC_EXTRACTOR_REVISION_V2 = "thai-legal-sem/2.0.0";
export const THAI_DETECTOR_VERSION_V2 = "thai-ocr-qa/2.0.0";

// ============================================================================
// 1. UNICODE CODE-POINT INDEXING HELPERS
// ============================================================================

export interface CodePointIndexMap {
  codePoints: string[];
  utf16ToCodePoint: Int32Array;
  codePointToUtf16: Int32Array;
}

export function buildCodePointIndexMap(text: string): CodePointIndexMap {
  const codePoints: string[] = [];
  const utf16ToCodePoint = new Int32Array(text.length + 1);
  const cpOffsets: number[] = [];

  let utf16Pos = 0;
  let cpPos = 0;
  for (const ch of text) {
    cpOffsets.push(utf16Pos);
    for (let k = 0; k < ch.length; k++) {
      utf16ToCodePoint[utf16Pos + k] = cpPos;
    }
    codePoints.push(ch);
    utf16Pos += ch.length;
    cpPos += 1;
  }
  utf16ToCodePoint[text.length] = cpPos;
  cpOffsets.push(text.length);

  return {
    codePoints,
    utf16ToCodePoint,
    codePointToUtf16: Int32Array.from(cpOffsets),
  };
}

export function sliceByCodePoints(text: string, rawStart: number, rawEnd: number): string {
  const cps = Array.from(text);
  return cps.slice(rawStart, rawEnd).join("");
}

const THAI_DIGIT_TO_ARABIC: Record<string, string> = {
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

export function thaiDigitsToArabicString(token: string): string {
  // Preserves leading zeros and non-digit separators; NEVER converts to arithmetic Number
  return Array.from(token)
    .map((ch) => THAI_DIGIT_TO_ARABIC[ch] ?? ch)
    .join("");
}

export function containsThaiDigits(token: string): boolean {
  return /[๐-๙]/.test(token);
}

// ============================================================================
// 2. THAI COMBINING-MARK & CODE-POINT DIAGNOSTICS (SECTION 5 & 7)
// ============================================================================

export interface ThaiCodePointDiagnostic {
  code_point_index: number;
  char: string;
  hex_code: string;
  category:
    | "thai_consonant"
    | "thai_leading_vowel"
    | "thai_above_below_vowel"
    | "thai_tone_mark"
    | "thai_diacritic"
    | "thai_digit"
    | "thai_repetition_yamakkan"
    | "private_use_area"
    | "replacement_char"
    | "zero_width"
    | "other";
  anomaly: string | null;
}

function isThaiConsonant(cp: number): boolean {
  return cp >= 0x0e01 && cp <= 0x0e2e;
}

function isThaiLeadingVowel(cp: number): boolean {
  return cp >= 0x0e40 && cp <= 0x0e44;
}

function isThaiAboveBelowVowel(cp: number): boolean {
  return cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a);
}

function isThaiToneMark(cp: number): boolean {
  return cp >= 0x0e48 && cp <= 0x0e4b;
}

function isThaiCombiningDiacritic(cp: number): boolean {
  return cp === 0x0e47 || cp === 0x0e4c || cp === 0x0e4d || cp === 0x0e4e;
}

export function inspectThaiCombiningDiagnostics(rawText: string): {
  diagnostics: ThaiCodePointDiagnostic[];
  anomalies: Array<{ code_point_index: number; code: string; message: string }>;
  puaCount: number;
  replacementCharCount: number;
} {
  const cps = Array.from(rawText);
  const diagnostics: ThaiCodePointDiagnostic[] = [];
  const anomalies: Array<{ code_point_index: number; code: string; message: string }> = [];
  let puaCount = 0;
  let replacementCharCount = 0;

  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const cp = ch.codePointAt(0) ?? 0;
    const prevCp = i > 0 ? cps[i - 1].codePointAt(0) ?? 0 : 0;
    const hexCode = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

    let category: ThaiCodePointDiagnostic["category"] = "other";
    let anomaly: string | null = null;

    if (isThaiConsonant(cp)) {
      category = "thai_consonant";
    } else if (isThaiLeadingVowel(cp)) {
      category = "thai_leading_vowel";
    } else if (isThaiAboveBelowVowel(cp)) {
      category = "thai_above_below_vowel";
      if (!isThaiConsonant(prevCp)) {
        anomaly = `Orphan/misplaced Thai vowel ${hexCode} not attached to a consonant`;
        anomalies.push({
          code_point_index: i,
          code: "THAI_INVALID_COMBINING_SEQUENCE",
          message: anomaly,
        });
      }
    } else if (isThaiToneMark(cp)) {
      category = "thai_tone_mark";
      if (isThaiToneMark(prevCp)) {
        anomaly = `Duplicate stacked Thai tone mark ${hexCode} at code point ${i}`;
        anomalies.push({
          code_point_index: i,
          code: "THAI_STACKED_TONE_MARK",
          message: anomaly,
        });
      } else if (isThaiLeadingVowel(prevCp) || (!isThaiConsonant(prevCp) && !isThaiAboveBelowVowel(prevCp))) {
        anomaly = `Thai tone mark ${hexCode} attached to invalid base (U+${prevCp.toString(16).toUpperCase().padStart(4, "0")})`;
        anomalies.push({
          code_point_index: i,
          code: "THAI_MISPLACED_TONE_MARK",
          message: anomaly,
        });
      }
    } else if (isThaiCombiningDiacritic(cp)) {
      category = "thai_diacritic";
      if (!isThaiConsonant(prevCp) && !isThaiAboveBelowVowel(prevCp)) {
        anomaly = `Thai diacritic ${hexCode} attached to non-consonant base`;
        anomalies.push({
          code_point_index: i,
          code: "THAI_MISPLACED_DIACRITIC",
          message: anomaly,
        });
      }
    } else if (cp >= 0x0e50 && cp <= 0x0e59) {
      category = "thai_digit";
    } else if (cp === 0x0e46) {
      category = "thai_repetition_yamakkan"; // Mai Yamok `ๆ`
    } else if (cp >= 0xe000 && cp <= 0xf8ff) {
      category = "private_use_area";
      puaCount += 1;
      anomaly = `Legacy PDF Private Use Area glyph ${hexCode} (corrupted Thai font encoding)`;
      anomalies.push({
        code_point_index: i,
        code: "PDF_PRIVATE_USE_GLYPH",
        message: anomaly,
      });
    } else if (cp === 0xfffd) {
      category = "replacement_char";
      replacementCharCount += 1;
      anomaly = "Unicode replacement character U+FFFD indicates undecodable glyph";
      anomalies.push({
        code_point_index: i,
        code: "UNICODE_REPLACEMENT_CHAR",
        message: anomaly,
      });
    } else if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) {
      category = "zero_width";
    }

    diagnostics.push({
      code_point_index: i,
      char: ch,
      hex_code: hexCode,
      category,
      anomaly,
    });
  }

  return { diagnostics, anomalies, puaCount, replacementCharCount };
}

// ============================================================================
// 3. PER-PAGE NATIVE PDF TEXT LAYER ELIGIBILITY CHECK (SECTION 5)
// ============================================================================

export interface NativePageEligibilityResult {
  page_number: number;
  eligible_for_native_bypass: boolean;
  recommended_route: "native" | "ocr" | "review_required";
  coverage_ratio: number | null;
  reasons: string[];
  issues: OCRIssue[];
}

export function assessNativePageEligibility(
  pageEvidence: RenderedPageEvidence,
  documentId: string
): NativePageEligibilityResult {
  const nativeText = (pageEvidence.native_pdf_text ?? "").trim();
  const renderedRef = (pageEvidence.rendered_reference_text ?? "").trim();
  const reasons: string[] = [];
  const issues: OCRIssue[] = [];

  // Blank page check
  if (!pageEvidence.has_visible_content) {
    if (pageEvidence.blank_detector_score !== null && pageEvidence.blank_detector_score >= 0.98 && nativeText.length === 0) {
      return {
        page_number: pageEvidence.page_number,
        eligible_for_native_bypass: true,
        recommended_route: "native",
        coverage_ratio: 1,
        reasons: ["Verified blank page with blank_detector_score >= 0.98 and empty text layer"],
        issues: [],
      };
    }
    reasons.push("Page lacks verified blank detector evidence");
    return {
      page_number: pageEvidence.page_number,
      eligible_for_native_bypass: false,
      recommended_route: "ocr",
      coverage_ratio: null,
      reasons,
      issues,
    };
  }

  // Visibly populated page with empty native text layer -> route to OCR
  if (nativeText.length === 0) {
    reasons.push("Visibly populated page has an empty PDF native text layer (scanned image PDF)");
    return {
      page_number: pageEvidence.page_number,
      eligible_for_native_bypass: false,
      recommended_route: "ocr",
      coverage_ratio: 0,
      reasons,
      issues,
    };
  }

  const diag = inspectThaiCombiningDiagnostics(nativeText);
  if (diag.puaCount > 0 || diag.replacementCharCount > 0) {
    const msg = `Native PDF text layer contains ${diag.puaCount} PUA glyph(s) and ${diag.replacementCharCount} U+FFFD replacement char(s)`;
    reasons.push(msg);
    issues.push({
      issue_id: `iss.${documentId}.p${pageEvidence.page_number}.native_encoding`,
      code: "NATIVE_LAYER_CORRUPT_ENCODING",
      severity: "warning",
      page_number: pageEvidence.page_number,
      block_id: null,
      message: msg,
      evidence_refs: [`img:${pageEvidence.image_sha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  if (diag.anomalies.length > 0) {
    reasons.push(`Native PDF text layer has ${diag.anomalies.length} Thai combining-mark anomaly/anomalies`);
  }

  // Duplicate hidden text layer heuristic (identical long line repeated back-to-back in PDF stream)
  const lines = nativeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 25);
  let duplicateLines = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1]) duplicateLines += 1;
  }
  if (duplicateLines > 0) {
    const msg = `Native PDF text layer contains ${duplicateLines} duplicate hidden text line(s)`;
    reasons.push(msg);
    issues.push({
      issue_id: `iss.${documentId}.p${pageEvidence.page_number}.hidden_dup`,
      code: "NATIVE_HIDDEN_DUPLICATE_TEXT",
      severity: "warning",
      page_number: pageEvidence.page_number,
      block_id: null,
      message: msg,
      evidence_refs: [`img:${pageEvidence.image_sha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  // Rendered vs extracted coverage & stale text layer check (Scenario 2: Gazette PDF omitting paragraph)
  let coverageRatio: number | null = null;
  if (renderedRef.length > 0) {
    const nativeLen = Array.from(nativeText.replace(/\s+/g, "")).length;
    const renderedLen = Array.from(renderedRef.replace(/\s+/g, "")).length;
    coverageRatio = renderedLen > 0 ? nativeLen / renderedLen : 1;

    // Check paragraph/clause coverage from rendered visual sample
    const renderedParagraphs = renderedRef
      .split(/\n{2,}|\r\n\r\n/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 12);
    const missingParagraphs = renderedParagraphs.filter((para) => {
      const probe = para.slice(0, Math.min(24, para.length)).trim();
      return probe.length > 0 && !nativeText.includes(probe);
    });

    if (coverageRatio < 0.94 || coverageRatio > 1.12 || missingParagraphs.length > 0) {
      const msg = `Hidden/stale PDF text layer mismatch on page ${pageEvidence.page_number}: coverage=${(
        coverageRatio * 100
      ).toFixed(1)}%, missing_rendered_paragraphs=${missingParagraphs.length}`;
      reasons.push(msg);
      issues.push({
        issue_id: `iss.${documentId}.p${pageEvidence.page_number}.stale_layer`,
        code: "NATIVE_TEXT_LAYER_MISMATCH",
        severity: "blocking",
        page_number: pageEvidence.page_number,
        block_id: null,
        message: msg,
        evidence_refs: [`img:${pageEvidence.image_sha256}`],
        detector_version: THAI_DETECTOR_VERSION_V2,
        resolution: "open",
      });
    }
  }

  const eligible = reasons.length === 0;
  return {
    page_number: pageEvidence.page_number,
    eligible_for_native_bypass: eligible,
    recommended_route: eligible ? "native" : "ocr",
    coverage_ratio: coverageRatio,
    reasons: eligible ? ["Per-page native text validation passed"] : reasons,
    issues,
  };
}

// ============================================================================
// 4. THREE-LAYER THAI NORMALIZATION WITH EXACT CODE-POINT OFFSET MAPPING
// ============================================================================

export interface NormalizationTransformationEntry {
  kind: "deletion" | "insertion" | "many_to_one" | "numeral_alias";
  raw_start: number;
  raw_end: number;
  norm_start: number;
  norm_end: number;
  raw_token: string;
  normalized_token: string;
  note: string;
}

export interface NumeralPreservationRecord {
  raw_token: string;
  arabic_lookup_token: string;
  script: "thai" | "arabic" | "mixed";
  has_leading_zero: boolean;
  raw_start: number;
  raw_end: number;
}

export interface ThaiNormalizationResult {
  ruleset: typeof THAI_NORMALIZATION_RULESET_V2;
  mapping_ref: string;
  raw_text: string;
  normalized_text: string;
  /**
   * For every zero-based Unicode code-point index `k` in `normalized_text`,
   * `normToRawCodePointSpan[k]` gives `[raw_start, raw_end]` in `raw_text`.
   */
  normToRawCodePointSpan: Array<[number, number]>;
  transformations: NormalizationTransformationEntry[];
  numeral_tokens: NumeralPreservationRecord[];
  combining_anomalies: Array<{ code_point_index: number; code: string; message: string }>;
}

/**
 * Normalizes Thai legal text deterministically (`thai-legal-norm/2.0.0`) while maintaining
 * exact code-point offset mappings (`raw_start`, `raw_end`) for insertions, deletions,
 * and many-to-one sequences:
 * - Preserves Thai tone marks (`\u0E48-\u0E4B`) — NEVER strips tone marks
 * - Preserves Thai repetition mark `ๆ` (`\u0E46`) and repeated Thai characters
 * - Normalizes decomposed Thai Sara Am (`\u0E4D\u0E32` -> `\u0E33`) as explicit `many_to_one`
 * - Removes zero-width characters (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`) as explicit `deletion`
 * - Collapses consecutive horizontal spaces/tabs into single `' '` as `many_to_one`
 * - Converts Thai digits `๐-๙` in `normalized_text` for unified search lookup while keeping
 *   `raw_text` untouched, preserving leading zeros (`๐๐๗` -> `007`), and recording every
 *   numeral token in `numeral_tokens` so `๒๕๖๙` and `2569` remain distinguishable in evidence.
 */
export function normalizeThaiLegalTextV2(
  rawText: string,
  mappingIdPrefix = "normmap"
): ThaiNormalizationResult {
  const rawCps = Array.from(rawText);
  const normCps: string[] = [];
  const normToRawCodePointSpan: Array<[number, number]> = [];
  const transformations: NormalizationTransformationEntry[] = [];
  const numeralTokens: NumeralPreservationRecord[] = [];

  let i = 0;
  while (i < rawCps.length) {
    const ch = rawCps[i];
    const cp = ch.codePointAt(0) ?? 0;

    // 1. Zero-width deletion (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`) and `\r` before `\n`
    if (
      cp === 0x200b ||
      cp === 0x200c ||
      cp === 0x200d ||
      cp === 0xfeff ||
      (ch === "\r" && i + 1 < rawCps.length && rawCps[i + 1] === "\n")
    ) {
      transformations.push({
        kind: "deletion",
        raw_start: i,
        raw_end: i + 1,
        norm_start: normCps.length,
        norm_end: normCps.length,
        raw_token: ch,
        normalized_token: "",
        note: ch === "\r" ? "CRLF carriage return folded" : "Zero-width character removed",
      });
      i += 1;
      continue;
    }

    // 2. Decomposed Thai Sara Am: Nikhahit (\u0E4D) + Sara Aa (\u0E32) -> Sara Am (\u0E33) [2 -> 1]
    // Also handles ToneMark + Nikhahit + Sara Aa -> ToneMark + Sara Am
    if (cp === 0x0e4d && i + 1 < rawCps.length && rawCps[i + 1].codePointAt(0) === 0x0e32) {
      const normIdx = normCps.length;
      normCps.push("\u0e33");
      normToRawCodePointSpan.push([i, i + 2]);
      transformations.push({
        kind: "many_to_one",
        raw_start: i,
        raw_end: i + 2,
        norm_start: normIdx,
        norm_end: normIdx + 1,
        raw_token: rawCps.slice(i, i + 2).join(""),
        normalized_token: "\u0e33",
        note: "Canonicalized decomposed Thai Sara Am (U+0E4D U+0E32 -> U+0E33)",
      });
      i += 2;
      continue;
    }

    // 3. Consecutive horizontal whitespace collapsing (`[ \t\u00A0]+` -> `' '`)
    if (ch === " " || ch === "\t" || cp === 0x00a0) {
      let j = i + 1;
      while (
        j < rawCps.length &&
        (rawCps[j] === " " || rawCps[j] === "\t" || (rawCps[j].codePointAt(0) ?? 0) === 0x00a0)
      ) {
        j += 1;
      }
      const normIdx = normCps.length;
      normCps.push(" ");
      normToRawCodePointSpan.push([i, j]);
      if (j - i > 1 || ch !== " ") {
        transformations.push({
          kind: "many_to_one",
          raw_start: i,
          raw_end: j,
          norm_start: normIdx,
          norm_end: normIdx + 1,
          raw_token: rawCps.slice(i, j).join(""),
          normalized_token: " ",
          note: "Collapsed horizontal whitespace run",
        });
      }
      i = j;
      continue;
    }

    // 4. Contiguous digit sequence (`[0-9๐-๙]+`) — preserve exact leading zeros & distinguish scripts
    if (/[0-9๐-๙]/.test(ch)) {
      let j = i;
      let hasThai = false;
      let hasArabic = false;
      while (j < rawCps.length && /[0-9๐-๙]/.test(rawCps[j])) {
        if (/[๐-๙]/.test(rawCps[j])) hasThai = true;
        else hasArabic = true;
        j += 1;
      }
      const rawNumToken = rawCps.slice(i, j).join("");
      const arabicToken = thaiDigitsToArabicString(rawNumToken);
      const normStart = normCps.length;

      for (let k = 0; k < j - i; k++) {
        const mappedDigit = THAI_DIGIT_TO_ARABIC[rawCps[i + k]] ?? rawCps[i + k];
        normCps.push(mappedDigit);
        normToRawCodePointSpan.push([i + k, i + k + 1]);
      }

      numeralTokens.push({
        raw_token: rawNumToken,
        arabic_lookup_token: arabicToken,
        script: hasThai && hasArabic ? "mixed" : hasThai ? "thai" : "arabic",
        has_leading_zero: arabicToken.length > 1 && arabicToken.startsWith("0"),
        raw_start: i,
        raw_end: j,
      });

      if (hasThai) {
        transformations.push({
          kind: "numeral_alias",
          raw_start: i,
          raw_end: j,
          norm_start: normStart,
          norm_end: normCps.length,
          raw_token: rawNumToken,
          normalized_token: arabicToken,
          note: "Thai numeral mapped to Arabic lookup form (raw Thai digits & leading zeros preserved)",
        });
      }

      i = j;
      continue;
    }

    // 5. Identity code point (including Thai tone marks, consonants, `ๆ`, newlines)
    normCps.push(ch);
    normToRawCodePointSpan.push([i, i + 1]);
    i += 1;
  }

  const normalizedText = normCps.join("");
  const diag = inspectThaiCombiningDiagnostics(rawText);
  const mappingDigest = sha256HexLower(`${rawText}||${normalizedText}`).slice(0, 16);

  return {
    ruleset: THAI_NORMALIZATION_RULESET_V2,
    mapping_ref: `${mappingIdPrefix}:${THAI_NORMALIZATION_RULESET_V2}:${mappingDigest}`,
    raw_text: rawText,
    normalized_text: normalizedText,
    normToRawCodePointSpan,
    transformations,
    numeral_tokens: numeralTokens,
    combining_anomalies: diag.anomalies,
  };
}

export function mapNormalizedSpanToRawSpan(
  normResult: ThaiNormalizationResult,
  normStartCp: number,
  normEndCp: number
): [number, number] {
  const map = normResult.normToRawCodePointSpan;
  if (map.length === 0 || normEndCp <= normStartCp) {
    return [0, 0];
  }
  const clampedStart = Math.max(0, Math.min(normStartCp, map.length - 1));
  const clampedEndIdx = Math.max(clampedStart, Math.min(normEndCp - 1, map.length - 1));
  return [map[clampedStart][0], map[clampedEndIdx][1]];
}

// ============================================================================
// 5. DETERMINISTIC THAI LEGAL SEMANTICS, DATES & VALIDATION (SECTION 6)
// ============================================================================

const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1,
  "ม.ค.": 1,
  กุมภาพันธ์: 2,
  "ก.พ.": 2,
  มีนาคม: 3,
  "มี.ค.": 3,
  เมษายน: 4,
  "เม.ย.": 4,
  พฤษภาคม: 5,
  "พ.ค.": 5,
  มิถุนายน: 6,
  "มิ.ย.": 6,
  กรกฎาคม: 7,
  "ก.ค.": 7,
  สิงหาคม: 8,
  "ส.ค.": 8,
  กันยายน: 9,
  "ก.ย.": 9,
  ตุลาคม: 10,
  "ต.ค.": 10,
  พฤศจิกายน: 11,
  "พ.ย.": 11,
  ธันวาคม: 12,
  "ธ.ค.": 12,
};

const KNOWN_INSTRUMENT_DICTIONARY: Array<{
  pattern: RegExp;
  canonical_id: string;
  canonical_title: string;
}> = [
  {
    pattern: /ประมวลรัษฎากร/,
    canonical_id: "inst.th.revenue_code",
    canonical_title: "ประมวลรัษฎากร",
  },
  {
    pattern: /ประมวลกฎหมายแพ่งและพาณิชย์/,
    canonical_id: "inst.th.ccc",
    canonical_title: "ประมวลกฎหมายแพ่งและพาณิชย์",
  },
  {
    pattern: /พระราชบัญญัติคุ้มครองแรงงาน(?:\s*\(ฉบับที่\s*[0-9๐-๙]+\))?(?:\s*พ\.ศ\.\s*[0-9๐-๙]{4})?/,
    canonical_id: "inst.th.lpa.2541",
    canonical_title: "พระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541",
  },
  {
    pattern: /พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล\s*พ\.ศ\.\s*(?:2562|๒๕๖๒)/,
    canonical_id: "inst.th.pdpa.2562",
    canonical_title: "พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562",
  },
  {
    pattern: /พระราชบัญญัติบริษัทมหาชนจำกัด\s*พ\.ศ\.\s*(?:2535|๒๕๓๕)/,
    canonical_id: "inst.th.plca.2535",
    canonical_title: "พระราชบัญญัติบริษัทมหาชนจำกัด พ.ศ. 2535",
  },
  {
    pattern: /พระราชบัญญัติหลักทรัพย์และตลาดหลักทรัพย์\s*พ\.ศ\.\s*(?:2535|๒๕๓๕)/,
    canonical_id: "inst.th.sea.2535",
    canonical_title: "พระราชบัญญัติหลักทรัพย์และตลาดหลักทรัพย์ พ.ศ. 2535",
  },
  {
    pattern: /พระราชบัญญัติการประกอบธุรกิจของคนต่างด้าว\s*พ\.ศ\.\s*(?:2542|๒๕๔๒)/,
    canonical_id: "inst.th.fba.2542",
    canonical_title: "พระราชบัญญัติการประกอบธุรกิจของคนต่างด้าว พ.ศ. 2542",
  },
];

// Known valid max sections for sanity validation (detects impossible OCR hallucinated section digits like Section 974 in Revenue Code)
const INSTRUMENT_MAX_PLAUSIBLE_SECTION: Record<string, number> = {
  "inst.th.lpa.2541": 166,
  "inst.th.pdpa.2562": 96,
  "inst.th.fba.2542": 46,
  "inst.th.revenue_code": 250,
};

function isValidCalendarDay(yearCe: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(yearCe, month - 1, day));
  return (
    dt.getUTCFullYear() === yearCe &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function inferDateRoleFromContext(windowText: string): LegalDateRole {
  if (/ให้ไว้\s*ณ\s*วันที่|ลงชื่อ|สั่ง\s*ณ\s*วันที่/.test(windowText)) return "signing";
  if (/ราชกิจจานุเบกษา|วันประกาศ/.test(windowText)) return "publication";
  if (/ใช้บังคับตั้งแต่วัน|มีผลใช้บังคับ/.test(windowText)) return "commencement";
  if (/แก้ไขเพิ่มเติม/.test(windowText)) return "amendment";
  if (/ยกเลิก/.test(windowText)) return "repeal";
  if (/อ่านคำพิพากษา|พิพากษาเมื่อวันที่/.test(windowText)) return "judgment";
  return "unspecified";
}

export interface PageSemanticInput {
  page_number: number;
  raw_text: string;
  image_sha256: string;
}

export interface SemanticExtractionOutput {
  annotation_version: string;
  annotations: LegalAnnotation[];
  issues: OCRIssue[];
}

/**
 * Deterministic Thai legal entity, citation, date & contradiction validator (`REG-003` / Section 6).
 * Enforces:
 * - Unqualified `"มาตรา ๕"` without a resolved statutory instrument stays `unresolved_candidate` (`resolved_target_id: null`) — NEVER fuzzy-matched!
 * - Distinguishes quoted content (`"..."`) vs operative holding/statutory text.
 * - Flags conflicting case IDs across pages, impossible calendar dates, ambiguous isolated/abbreviated years,
 *   implausible OCR-corrupted section numbers, missing referenced annexes (`ภาคผนวก`), and section sequence gaps.
 */
export function extractThaiLegalAnnotationsV2(params: {
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  extraction_version_id: string;
  pages: PageSemanticInput[];
  annotation_version?: string;
}): SemanticExtractionOutput {
  const annotationVersion = params.annotation_version ?? `ann.${params.extraction_version_id}.v1`;
  const annotations: LegalAnnotation[] = [];
  const issues: OCRIssue[] = [];

  const seenCaseIds = new Set<string>();
  const detectedSectionNumbersInOrder: Array<{ secNum: number; page: number }> = [];
  const headerDates: string[] = [];
  const bodyDates: string[] = [];
  let documentWideResolvedInstrument: { id: string; title: string } | null = null;
  let annSeq = 1;

  const nextAnnId = () => `ann.${params.document_id}.${annSeq++}`;

  // Pass 1: Detect explicit statutory instruments per page and document-wide if unambiguous single instrument
  const pageInstruments = new Map<number, Array<{ id: string | null; title: string; startCp: number; endCp: number }>>();
  const distinctInstrumentTitles = new Set<string>();

  for (const page of params.pages) {
    const cpMap = buildCodePointIndexMap(page.raw_text);
    const list: Array<{ id: string | null; title: string; startCp: number; endCp: number }> = [];

    // Match full Act/Royal Decree/Code titles (including multi-word Thai titles before พ.ศ.)
    const instRegex =
      /(?:พระราชบัญญัติ[^\n"“”]{2,110}?\s*พ\.ศ\.\s*[0-9๐-๙]{4}|พระราชกฤษฎีกา[^\n"“”]{2,110}?\s*พ\.ศ\.\s*[0-9๐-๙]{4}|ประมวลรัษฎากร|ประมวลกฎหมายแพ่งและพาณิชย์)/g;

    for (const m of page.raw_text.matchAll(instRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0].trim();
      const startCp = cpMap.utf16ToCodePoint[idx];
      const endCp = cpMap.utf16ToCodePoint[idx + m[0].length];

      let resolvedId: string | null = null;
      let canonicalTitle = thaiDigitsToArabicString(rawVal);
      for (const entry of KNOWN_INSTRUMENT_DICTIONARY) {
        if (entry.pattern.test(rawVal)) {
          resolvedId = entry.canonical_id;
          canonicalTitle = entry.canonical_title;
          break;
        }
      }

      distinctInstrumentTitles.add(canonicalTitle);
      list.push({ id: resolvedId, title: canonicalTitle, startCp, endCp });

      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "statutory_instrument",
        raw_value: rawVal,
        normalized_candidate: canonicalTitle,
        source_spans: [
          {
            page_number: page.page_number,
            block_id: null,
            raw_start: startCp,
            raw_end: endCp,
            polygon: null,
          },
        ],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: resolvedId ? "resolved" : "unresolved_candidate",
        resolved_target_id: resolvedId,
        cited_instrument_title: canonicalTitle,
        discourse_context: "statutory_provision",
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }
    pageInstruments.set(page.page_number, list);
  }

  const firstPageText = params.pages[0]?.raw_text ?? "";
  const isPrimaryStatuteDoc =
    /^(?:\s*ราชกิจจานุเบกษา[^\n]*\n)?\s*(?:พระราชบัญญัติ|พระราชกฤษฎีกา|ประมวล)/.test(
      firstPageText
    );
  if (isPrimaryStatuteDoc && distinctInstrumentTitles.size === 1) {
    const firstList = Array.from(pageInstruments.values()).find((l) => l.length > 0);
    if (firstList && firstList[0].id) {
      documentWideResolvedInstrument = { id: firstList[0].id, title: firstList[0].title };
    }
  }

  // Pass 2: Extract Courts, Supreme Court Case IDs, Gazette refs, Council of State / RD Rulings, Sections, Dates, Negations, Thresholds
  for (const page of params.pages) {
    const cpMap = buildCodePointIndexMap(page.raw_text);
    const makeSpan = (utf16Start: number, utf16End: number): SourceSpan => ({
      page_number: page.page_number,
      block_id: null,
      raw_start: cpMap.utf16ToCodePoint[utf16Start],
      raw_end: cpMap.utf16ToCodePoint[utf16End],
      polygon: null,
    });

    const detectDiscourse = (utf16Start: number): LegalAnnotation["discourse_context"] => {
      const before = page.raw_text.slice(Math.max(0, utf16Start - 60), utf16Start);
      if (/["“][^"”]*$/.test(before)) return "quoted_passage";
      if (/วินิจฉัยว่า|พิพากษาว่า/.test(before)) return "operative_holding";
      return "statutory_provision";
    };

    // 2A. Supreme Court Judgment Identifier (`คำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘`)
    const dikaRegex = /คำพิพากษาศาลฎีกาที่\s*([0-9๐-๙]+(?:-[0-9๐-๙]+)?)\s*\/\s*([0-9๐-๙]{2,4})/g;
    for (const m of page.raw_text.matchAll(dikaRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0];
      const caseNumNorm = thaiDigitsToArabicString(m[1]);
      const yearNorm = thaiDigitsToArabicString(m[2]);
      const normCandidate = `Dika:${caseNumNorm}/${yearNorm}`;
      seenCaseIds.add(normCandidate);

      const yearInt = Number(yearNorm);
      const invalidYear = yearNorm.length !== 4 || yearInt < 2450 || yearInt > 2585;
      if (invalidYear) {
        issues.push({
          issue_id: `iss.${params.document_id}.p${page.page_number}.case_year_${annSeq}`,
          code: "INVALID_CASE_IDENTIFIER_YEAR",
          severity: "blocking",
          page_number: page.page_number,
          block_id: null,
          message: `Case identifier '${rawVal}' has implausible or abbreviated Buddhist Era year (${yearNorm})`,
          evidence_refs: [`img:${page.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
      }

      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "case_identifier",
        raw_value: rawVal,
        normalized_candidate: normCandidate,
        source_spans: [makeSpan(idx, idx + rawVal.length)],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: invalidYear ? "conflict" : "resolved",
        resolved_target_id: invalidYear ? null : `case.th.dika.${caseNumNorm}_${yearNorm}`,
        cited_instrument_title: null,
        discourse_context: detectDiscourse(idx),
        proposed_relation: invalidYear
          ? undefined
          : { relation_type: "CITES", target_id: `case.th.dika.${caseNumNorm}_${yearNorm}` },
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }

    // 2B. Royal Gazette Reference (`ราชกิจจานุเบกษา เล่ม ... ตอนที่ ... หน้า ...`)
    const gazetteRegex =
      /ราชกิจจานุเบกษา\s*เล่ม\s*([0-9๐-๙]+)\s*ตอน(?:ที่)?\s*([^\s\n]+)(?:\s*หน้า\s*([0-9๐-๙]+))?/g;
    for (const m of page.raw_text.matchAll(gazetteRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0];
      const vol = thaiDigitsToArabicString(m[1]);
      const issue = thaiDigitsToArabicString(m[2]);
      const pg = m[3] ? thaiDigitsToArabicString(m[3]) : "?";
      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "gazette_reference",
        raw_value: rawVal,
        normalized_candidate: `Gazette:v${vol}:i${issue}:p${pg}`,
        source_spans: [makeSpan(idx, idx + rawVal.length)],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: "resolved",
        resolved_target_id: `gazette.th.${vol}.${issue}.${pg}`,
        cited_instrument_title: null,
        discourse_context: "header_footer",
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }

    // 2C. Revenue Department (`กค .../...`) & Council of State (`เรื่องเสร็จที่ .../...`) Identifiers
    const rulingRegex = /(?:กค\s*[0-9๐-๙]{4}\/[0-9๐-๙]+|เรื่องเสร็จที่\s*[0-9๐-๙]+\/[0-9๐-๙]{4})/g;
    for (const m of page.raw_text.matchAll(rulingRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0];
      const normVal = thaiDigitsToArabicString(rawVal).replace(/\s+/g, " ");
      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "ruling_identifier",
        raw_value: rawVal,
        normalized_candidate: normVal,
        source_spans: [makeSpan(idx, idx + rawVal.length)],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: "resolved",
        resolved_target_id: `ruling.th.${normVal.replace(/[^a-zA-Z0-9ก-ฮ]/g, "_")}`,
        cited_instrument_title: null,
        discourse_context: "header_footer",
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }

    // 2D. Statutory Section References (`มาตรา ...`) — Enforce Unresolved Instrument Rule!
    const sectionRegex = /มาตรา\s*([0-9๐-๙]+(?:\/[0-9๐-๙]+|\s*ทวิ|\s*ตรี|\s*จัตวา)?)(?:\s*วรรค([หนึ่งสองสามสี่ห้า0-9๐-๙]+))?(?:\s*\(([0-9๐-๙]+)\))?/g;
    const localInstruments = pageInstruments.get(page.page_number) ?? [];

    for (const m of page.raw_text.matchAll(sectionRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0];
      const secNorm = thaiDigitsToArabicString(m[1]).replace(/\s+/g, "");
      const span = makeSpan(idx, idx + rawVal.length);

      // Syntactic instrument binding (`มาตรา X แห่ง<ชื่อกฎหมาย>` or `<ชื่อกฎหมาย> ... มาตรา X` without clause break)
      const immediateAfter = page.raw_text.slice(
        idx + rawVal.length,
        Math.min(page.raw_text.length, idx + rawVal.length + 95)
      );
      const immediateBefore = page.raw_text.slice(Math.max(0, idx - 95), idx);

      let matchedInst: { id: string | null; title: string } | null = null;
      if (/^\s*แห่ง/.test(immediateAfter)) {
        for (const entry of KNOWN_INSTRUMENT_DICTIONARY) {
          if (entry.pattern.test(immediateAfter)) {
            matchedInst = { id: entry.canonical_id, title: entry.canonical_title };
            break;
          }
        }
      }
      if (
        !matchedInst &&
        !/และอ้างถึง|โดยไม่ระบุชื่อกฎหมาย|\n/.test(immediateBefore.slice(-35))
      ) {
        for (const entry of KNOWN_INSTRUMENT_DICTIONARY) {
          if (entry.pattern.test(immediateBefore)) {
            matchedInst = { id: entry.canonical_id, title: entry.canonical_title };
            break;
          }
        }
      }
      if (!matchedInst && documentWideResolvedInstrument) {
        matchedInst = documentWideResolvedInstrument;
      }

      // Check section plausibility against known instrument max sections (catches OCR wrong digit e.g. มาตรา 874 instead of มาตรา 74 in Revenue Code!)
      const numericSec = parseInt(secNorm, 10);
      let isImplausibleSectionDigit = false;
      if (
        matchedInst?.id &&
        !Number.isNaN(numericSec) &&
        INSTRUMENT_MAX_PLAUSIBLE_SECTION[matchedInst.id] !== undefined &&
        numericSec > INSTRUMENT_MAX_PLAUSIBLE_SECTION[matchedInst.id]
      ) {
        isImplausibleSectionDigit = true;
        issues.push({
          issue_id: `iss.${params.document_id}.p${page.page_number}.wrong_sec_${secNorm}`,
          code: "MATERIAL_SECTION_NUMBER_INVALID",
          severity: "blocking",
          page_number: page.page_number,
          block_id: null,
          message: `Section '${rawVal}' (${secNorm}) exceeds known section range (max ${
            INSTRUMENT_MAX_PLAUSIBLE_SECTION[matchedInst.id]
          }) for ${matchedInst.title}; likely OCR digit error`,
          evidence_refs: [`img:${page.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
      }

      // Track statutory heading progression (`\nมาตรา X `) for discontinuity check
      const isHeadingLine = idx === 0 || /\n\s*$/.test(page.raw_text.slice(Math.max(0, idx - 6), idx));
      if (isHeadingLine && !Number.isNaN(numericSec) && !secNorm.includes("/")) {
        detectedSectionNumbersInOrder.push({ secNum: numericSec, page: page.page_number });
      }

      const resolvedTargetId =
        matchedInst?.id && !isImplausibleSectionDigit
          ? `${matchedInst.id}.sec.${secNorm}`
          : null;

      // Determine relation kind (`AMENDS`, `REPEALS`, `CITES`)
      let relKind: LegalGraphRelationKind = "CITES";
      const beforeClause = page.raw_text.slice(Math.max(0, idx - 50), idx);
      if (/ยกเลิกความใน/.test(beforeClause)) relKind = "REPEALS";
      else if (/แก้ไขเพิ่มเติม/.test(beforeClause)) relKind = "AMENDS";

      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "section_reference",
        raw_value: rawVal,
        normalized_candidate: matchedInst
          ? `${matchedInst.title}#sec.${secNorm}`
          : `UNQUALIFIED#sec.${secNorm}`,
        source_spans: [span],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: isImplausibleSectionDigit
          ? "conflict"
          : resolvedTargetId
          ? "resolved"
          : "unresolved_candidate",
        resolved_target_id: resolvedTargetId,
        cited_instrument_title: matchedInst?.title ?? null,
        discourse_context: detectDiscourse(idx),
        proposed_relation: {
          relation_type: relKind,
          target_id: resolvedTargetId, // Remains null when instrument is unresolved!
        },
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }

    // 2E. Thai Date Expressions & Ambiguity / Date Role Rules (Section 5 & 6)
    const fullDateRegex =
      /(?:วันที่\s*)?([0-9๐-๙]{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(?:(พ\.ศ\.|ค\.ศ\.)\s*)?([0-9๐-๙]{2,4})/g;

    for (const m of page.raw_text.matchAll(fullDateRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0];
      const dayInt = parseInt(thaiDigitsToArabicString(m[1]), 10);
      const monthInt = THAI_MONTHS[m[2]] ?? 0;
      const eraMarker = m[3] ?? null;
      const yearStr = thaiDigitsToArabicString(m[4]);
      const yearInt = parseInt(yearStr, 10);
      const contextWin = page.raw_text.slice(
        Math.max(0, idx - 60),
        Math.min(page.raw_text.length, idx + rawVal.length + 60)
      );
      const dateRole = inferDateRoleFromContext(contextWin);
      const ambiguityFlags: string[] = [];

      let calendar: "BE" | "CE" | "unknown" = "unknown";
      if (eraMarker === "พ.ศ.") calendar = "BE";
      else if (eraMarker === "ค.ศ.") calendar = "CE";
      else if (yearStr.length === 4 && yearInt >= 2400) {
        calendar = "BE";
        ambiguityFlags.push("IMPLICIT_ERA_INFERRED_NEEDS_CONTEXT_CHECK");
      } else {
        ambiguityFlags.push("MISSING_CALENDAR_ERA_MARKER");
      }

      if (yearStr.length < 4) {
        ambiguityFlags.push("ABBREVIATED_TWO_DIGIT_YEAR");
      }

      let isoCandidate: string | null = null;
      if (calendar !== "unknown" && yearStr.length === 4 && ambiguityFlags.length === 0) {
        const yearCe = calendar === "BE" ? yearInt - 543 : yearInt;
        if (!isValidCalendarDay(yearCe, monthInt, dayInt)) {
          ambiguityFlags.push("IMPOSSIBLE_CALENDAR_DATE");
          issues.push({
            issue_id: `iss.${params.document_id}.p${page.page_number}.bad_date_${annSeq}`,
            code: "IMPOSSIBLE_CALENDAR_DATE",
            severity: "blocking",
            page_number: page.page_number,
            block_id: null,
            message: `Date '${rawVal}' resolves to impossible calendar day (${yearCe}-${monthInt}-${dayInt})`,
            evidence_refs: [`img:${page.image_sha256}`],
            detector_version: THAI_DETECTOR_VERSION_V2,
            resolution: "open",
          });
        } else {
          isoCandidate = `${String(yearCe).padStart(4, "0")}-${String(monthInt).padStart(
            2,
            "0"
          )}-${String(dayInt).padStart(2, "0")}`;
        }
      } else if (ambiguityFlags.includes("ABBREVIATED_TWO_DIGIT_YEAR") || ambiguityFlags.includes("MISSING_CALENDAR_ERA_MARKER")) {
        issues.push({
          issue_id: `iss.${params.document_id}.p${page.page_number}.ambig_date_${annSeq}`,
          code: "AMBIGUOUS_MATERIAL_DATE",
          severity: dateRole === "commencement" || dateRole === "repeal" || dateRole === "unspecified" ? "blocking" : "warning",
          page_number: page.page_number,
          block_id: null,
          message: `Ambiguous date expression '${rawVal}' (${ambiguityFlags.join(", ")}) requires reviewer adjudication`,
          evidence_refs: [`img:${page.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
      }

      if (idx < 160 && isoCandidate) headerDates.push(isoCandidate);
      else if (isoCandidate) bodyDates.push(isoCandidate);

      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "date_expression",
        raw_value: rawVal,
        normalized_candidate: isoCandidate ?? `AMBIGUOUS:${thaiDigitsToArabicString(rawVal)}`,
        source_spans: [makeSpan(idx, idx + rawVal.length)],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: ambiguityFlags.length > 0 ? "unresolved_candidate" : "resolved",
        resolved_target_id: null,
        cited_instrument_title: null,
        discourse_context: idx < 160 ? "header_footer" : "statutory_provision",
        date_metadata: {
          calendar,
          precision: ambiguityFlags.length > 0 ? "ambiguous" : "day",
          date_role: dateRole,
          iso_candidate: isoCandidate,
          ambiguity_flags: ambiguityFlags,
        },
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }

    // 2F. "Effective from publication" relative commencement candidate (Section 5: requires legal editor review)
    const relCommenceRegex = /ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป/g;
    for (const m of page.raw_text.matchAll(relCommenceRegex)) {
      const idx = m.index ?? 0;
      const rawVal = m[0];
      annotations.push({
        annotation_id: nextAnnId(),
        annotation_version: annotationVersion,
        tenant_id: params.tenant_id,
        workspace_id: params.workspace_id,
        document_id: params.document_id,
        extraction_version_id: params.extraction_version_id,
        entity_type: "amendment_repeal_reference",
        raw_value: rawVal,
        normalized_candidate: "EFFECTIVE_DAY_AFTER_GAZETTE_PUBLICATION",
        source_spans: [makeSpan(idx, idx + rawVal.length)],
        extractor_revision: THAI_SEMANTIC_EXTRACTOR_REVISION_V2,
        resolution_status: "unresolved_candidate",
        resolved_target_id: null,
        cited_instrument_title: documentWideResolvedInstrument?.title ?? null,
        discourse_context: "statutory_provision",
        proposed_relation: {
          relation_type: "EFFECTIVE_FROM",
          target_id: null,
        },
        evidence_refs: [`img:${page.image_sha256}`],
        reviewer_decision_ids: [],
      });
    }

    // 2G. Missing referenced annex check (`ตามบัญชีท้ายพระราชบัญญัติ` / `ตามภาคผนวก ก`)
    if (/ตามบัญชีท้าย|ตามภาคผนวก\s*[ก-ฮ1-9]/.test(page.raw_text)) {
      const fullDocText = params.pages.map((p) => p.raw_text).join("\n");
      const hasAnnexHeading = /(?:^|\n)\s*(?:บัญชีท้าย|ภาคผนวก)/.test(fullDocText);
      if (!hasAnnexHeading) {
        issues.push({
          issue_id: `iss.${params.document_id}.p${page.page_number}.missing_annex`,
          code: "MISSING_REFERENCED_ANNEX",
          severity: "blocking",
          page_number: page.page_number,
          block_id: null,
          message: "Document text references an attached schedule/annex (บัญชีท้าย/ภาคผนวก) that is absent from extracted pages",
          evidence_refs: [`img:${page.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
      }
    }
  }

  // Document-wide Check A: Section discontinuity (`มาตรา ๑`, `มาตรา ๒`, `มาตรา ๔` -> missing `มาตรา ๓`)
  for (let i = 1; i < detectedSectionNumbersInOrder.length; i++) {
    const prev = detectedSectionNumbersInOrder[i - 1];
    const curr = detectedSectionNumbersInOrder[i];
    if (curr.secNum > prev.secNum + 1 && curr.secNum - prev.secNum <= 10) {
      issues.push({
        issue_id: `iss.${params.document_id}.sec_gap_${prev.secNum}_${curr.secNum}`,
        code: "SECTION_SEQUENCE_DISCONTINUITY",
        severity: "blocking",
        page_number: curr.page,
        block_id: null,
        message: `Statutory section sequence jumped from Section ${prev.secNum} to Section ${curr.secNum}; review source pages without synthesizing omitted provisions`,
        evidence_refs: [],
        detector_version: THAI_DETECTOR_VERSION_V2,
        resolution: "open",
      });
    }
  }

  // Document-wide Check B: Conflicting header/signing date (e.g. header year earlier than body judgment date or vice-versa anomaly)
  if (headerDates.length > 0 && bodyDates.length > 0 && headerDates[0].slice(0, 4) !== bodyDates[0].slice(0, 4)) {
    // Only warn if years differ by > 5 years unexpectedly
    const y1 = Number(headerDates[0].slice(0, 4));
    const y2 = Number(bodyDates[0].slice(0, 4));
    if (Math.abs(y1 - y2) > 15) {
      issues.push({
        issue_id: `iss.${params.document_id}.date_conflict`,
        code: "CONFLICTING_DOCUMENT_DATES",
        severity: "warning",
        page_number: 1,
        block_id: null,
        message: `Header date (${headerDates[0]}) and body date (${bodyDates[0]}) differ by >15 years; verify date roles`,
        evidence_refs: [],
        detector_version: THAI_DETECTOR_VERSION_V2,
        resolution: "open",
      });
    }
  }

  return {
    annotation_version: annotationVersion,
    annotations,
    issues,
  };
}

/**
 * Compares primary OCR output against a secondary approved candidate provider on critical legal tokens
 * (negations `ไม่`, `มิให้`, `เว้นแต่`, `ห้ามมิให้`, and numerals).
 * Per Section 5: A second OCR result is comparison evidence (triggers `blocking` review), NEVER ground truth.
 */
export function compareEnsembleCriticalTokens(params: {
  document_id: string;
  page_number: number;
  primary_raw_text: string;
  secondary_raw_text: string;
  secondary_provider_id: string;
  image_sha256: string;
}): OCRIssue[] {
  const issues: OCRIssue[] = [];
  const countMatches = (txt: string, re: RegExp) => Array.from(txt.matchAll(re)).length;

  const negationRe = /(?:มิให้|ห้ามมิให้|เว้นแต่|ไม่ต้องรับผิด|ไม่มีสิทธิ)/g;
  const pNeg = countMatches(params.primary_raw_text, negationRe);
  const sNeg = countMatches(params.secondary_raw_text, negationRe);

  if (pNeg !== sNeg) {
    issues.push({
      issue_id: `iss.${params.document_id}.p${params.page_number}.negation_disagreement`,
      code: "CRITICAL_NEGATION_DISAGREEMENT",
      severity: "blocking",
      page_number: params.page_number,
      block_id: null,
      message: `Critical Thai legal negation count differs between primary OCR (${pNeg}) and comparison provider ${params.secondary_provider_id} (${sNeg})`,
      evidence_refs: [`img:${params.image_sha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  const extractArabicNums = (txt: string) =>
    Array.from(txt.matchAll(/[0-9๐-๙]+/g)).map((m) => thaiDigitsToArabicString(m[0]));

  const pNums = extractArabicNums(params.primary_raw_text);
  const sNums = extractArabicNums(params.secondary_raw_text);
  if (pNums.join("|") !== sNums.join("|")) {
    issues.push({
      issue_id: `iss.${params.document_id}.p${params.page_number}.numeral_disagreement`,
      code: "CRITICAL_NUMERAL_DISAGREEMENT",
      severity: "blocking",
      page_number: params.page_number,
      block_id: null,
      message: `Numeric token sequence differs between primary OCR and comparison provider ${params.secondary_provider_id}; exact source verification required`,
      evidence_refs: [`img:${params.image_sha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  return issues;
}
