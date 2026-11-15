/**
 * Genuine Typhoon OCR V2 (`typhoon-ocr-v2` / `typhoon-ai/typhoon-ocr2-2b`) Structured Layout Parser
 * & Thai Legal Critical-Token / Dual-OCR Gate (`REG24` v2.0)
 */

import {
  OCRBlock,
  OCRBlockKind,
  OCRIssue,
  OCRTable,
  OCRTableCell,
  SourceSpan,
} from "./contract";
import { THAI_DETECTOR_VERSION_V2, buildCodePointIndexMap } from "./thai-normalizer";

export interface TyphoonV2RawElement {
  bbox?: [number, number, number, number] | number[];
  category?: string;
  text?: string;
}

export interface ParsedTyphoonV2Page {
  raw_text: string;
  markdown: string;
  blocks: OCRBlock[];
  tables: OCRTable[];
  issues: OCRIssue[];
}

function stripHtmlTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function mapCategoryToBlockKind(cat: string): OCRBlockKind {
  switch (cat) {
    case "header":
      return "header";
    case "footer":
      return "footer";
    case "title":
      return "heading";
    case "table":
      return "table";
    case "figure_caption":
    case "table_caption":
    case "formula_caption":
      return "caption";
    case "figure_footnote":
    case "table_footnote":
    case "page_footnote":
      return "footnote";
    default:
      return "paragraph";
  }
}

function bbox1000ToNormalizedPolygon(
  bbox: number[] | undefined,
  imageSha256: string
): SourceSpan["polygon"] {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [x1, y1, x2, y2] = bbox.map((v) => Math.max(0, Math.min(1, Number((Number(v) / 1000).toFixed(4)))));
  if ([x1, y1, x2, y2].some((v) => Number.isNaN(v)) || x2 < x1 || y2 < y1) return null;
  return {
    points: [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ],
    units: "normalized",
    origin: "top_left",
    rotation_degrees: 0,
    image_sha256: imageSha256,
  };
}

export function parseHtmlTableToOcrTable(params: {
  htmlTable: string;
  tableId: string;
  pageNumber: number;
  blockId: string;
  rawBlockStartCp: number;
  rawBlockEndCp: number;
}): { table: OCRTable; plainText: string; hasMergedCells: boolean } {
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  const occupied = new Set<string>();
  const cells: OCRTableCell[] = [];
  const rowTexts: string[] = [];
  let hasMergedCells = false;
  let rowIdx = 0;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(params.htmlTable)) !== null) {
    const rowInner = rowMatch[1];
    let colCursor = 0;
    const lineCells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;

    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      while (occupied.has(`${rowIdx}:${colCursor}`)) colCursor += 1;
      const attrs = cellMatch[2] || "";
      const rs = Math.max(1, Number(attrs.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1"));
      const cs = Math.max(1, Number(attrs.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1"));
      if (rs > 1 || cs > 1) hasMergedCells = true;

      for (let r = rowIdx; r < rowIdx + rs; r++) {
        for (let c = colCursor; c < colCursor + cs; c++) {
          occupied.add(`${r}:${c}`);
        }
      }
      const cellText = stripHtmlTags(cellMatch[3] || "");
      lineCells.push(cellText);
      cells.push({
        row: rowIdx,
        column: colCursor,
        row_span: rs,
        column_span: cs,
        raw_text: cellText,
        span: {
          page_number: params.pageNumber,
          block_id: params.blockId,
          raw_start: params.rawBlockStartCp,
          raw_end: params.rawBlockEndCp,
          polygon: null,
        },
      });
      colCursor += cs;
    }
    if (lineCells.length > 0) rowTexts.push(lineCells.join(" | "));
    rowIdx += 1;
  }

  const plainText = rowTexts.join("\n") || stripHtmlTags(params.htmlTable);
  return {
    table: {
      table_id: params.tableId,
      page_number: params.pageNumber,
      block_id: params.blockId,
      structure_status: cells.length === 0 ? "unsupported" : hasMergedCells ? "partial" : "supported",
      cells,
      markdown: params.htmlTable.trim(),
      issue_ids: [],
    },
    plainText,
    hasMergedCells,
  };
}

export function parseTyphoonV2StructuredResponse(params: {
  documentId: string;
  pageNumber: number;
  imageSha256: string;
  rawContent: string;
  keepHeaderFooter?: boolean;
}): ParsedTyphoonV2Page {
  const keepHF = params.keepHeaderFooter !== false; // Default TRUE for Thai Royal Gazette!
  let cleaned = params.rawContent.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsedElements: TyphoonV2RawElement[];
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error("Typhoon V2 output is not a JSON array");
    }
    parsedElements = parsed as TyphoonV2RawElement[];
  } catch (err) {
    return {
      raw_text: "",
      markdown: "",
      blocks: [],
      tables: [],
      issues: [
        {
          issue_id: `iss.${params.documentId}.p${params.pageNumber}.invalid_typhoon_json`,
          code: "MALFORMED_PROVIDER_JSON_OUTPUT",
          severity: "blocking",
          page_number: params.pageNumber,
          block_id: null,
          message: `Typhoon V2 returned non-parseable structured JSON on page ${params.pageNumber}: ${(err as Error).message}`,
          evidence_refs: [`img:${params.imageSha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        },
      ],
    };
  }

  const rawLines: string[] = [];
  const mdLines: string[] = [];
  const stagedMeta: Array<{
    cat: string;
    plain: string;
    origText: string;
    bbox?: number[];
  }> = [];

  for (const el of parsedElements) {
    const cat = String(el?.category ?? "text");
    const origText = String(el?.text ?? "").trim();
    if (cat === "figure" || origText.length === 0) continue;
    if (!keepHF && (cat === "header" || cat === "footer" || cat === "page_footnote")) continue;

    const isHtmlTable = cat === "table" || /<table\b/i.test(origText);
    const plain = isHtmlTable
      ? stripHtmlTags(origText)
      : origText.replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*/g, "").trim();
    if (plain.length === 0) continue;

    stagedMeta.push({ cat, plain, origText, bbox: el.bbox });
    rawLines.push(plain);
    mdLines.push(origText);
  }

  const rawText = rawLines.join("\n");
  const cpMap = buildCodePointIndexMap(rawText);
  const blocks: OCRBlock[] = [];
  const tables: OCRTable[] = [];
  const issues: OCRIssue[] = [];

  let cursorUtf16 = 0;
  stagedMeta.forEach((m, idx) => {
    const startUtf16 = cursorUtf16;
    const endUtf16 = startUtf16 + m.plain.length;
    cursorUtf16 = endUtf16 + 1;
    const rawStart = cpMap.utf16ToCodePoint[startUtf16] ?? 0;
    const rawEnd = cpMap.utf16ToCodePoint[endUtf16] ?? Array.from(rawText).length;
    const blockId = `blk.p${params.pageNumber}.${idx + 1}`;
    const span: SourceSpan = {
      page_number: params.pageNumber,
      block_id: blockId,
      raw_start: rawStart,
      raw_end: rawEnd,
      polygon: bbox1000ToNormalizedPolygon(m.bbox, params.imageSha256),
    };

    blocks.push({
      block_id: blockId,
      kind: mapCategoryToBlockKind(m.cat),
      reading_order: idx,
      raw_text: m.plain,
      span,
    });

    if (m.cat === "table" || /<table\b/i.test(m.origText)) {
      const tableId = `tbl.p${params.pageNumber}.${tables.length + 1}`;
      const parsedTbl = parseHtmlTableToOcrTable({
        htmlTable: m.origText,
        tableId,
        pageNumber: params.pageNumber,
        blockId,
        rawBlockStartCp: rawStart,
        rawBlockEndCp: rawEnd,
      });
      if (parsedTbl.hasMergedCells || parsedTbl.table.structure_status !== "supported") {
        const issId = `iss.${params.documentId}.p${params.pageNumber}.${tableId}.merged`;
        parsedTbl.table.issue_ids.push(issId);
        issues.push({
          issue_id: issId,
          code: "UNCERTAIN_TABLE_STRUCTURE_MERGED_CELLS",
          severity: "blocking",
          page_number: params.pageNumber,
          block_id: blockId,
          message: `Table ${tableId} on page ${params.pageNumber} contains merged rowspan/colspan Gazette cells; requires human verification`,
          evidence_refs: [`img:${params.imageSha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
      }
      tables.push(parsedTbl.table);
    }
  });

  return {
    raw_text: rawText,
    markdown: mdLines.join("\n\n"),
    blocks,
    tables,
    issues,
  };
}

export interface CriticalLegalTokenSummary {
  section_and_clause_numbers: string[];
  buddhist_era_years: string[];
  thai_numeral_tokens: string[];
  rate_and_amount_tokens: string[];
  negation_tokens: string[];
  exception_tokens: string[];
  illegible_or_handwritten_flags: string[];
}

const THAI_TO_ARABIC_DIGITS: Record<string, string> = {
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

function foldDigits(s: string): string {
  return s.replace(/[๐-๙]/g, (c) => THAI_TO_ARABIC_DIGITS[c] ?? c);
}

export function auditCriticalThaiLegalTokens(rawText: string): CriticalLegalTokenSummary {
  const norm = foldDigits(rawText).replace(/\s+/g, " ");
  const secMatches = Array.from(
    norm.matchAll(/(?:มาตรา|ข้อ)\s*[0-9]+(?:\/[0-9]+|\.[0-9]+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|วรรค[^\s]+|\([0-9]+\)))?/g),
    (m) => m[0].trim()
  );
  const yearMatches = Array.from(norm.matchAll(/พ\.ศ\.\s*(2[3456][0-9]{2})\b/g), (m) => `พ.ศ. ${m[1]}`);
  const thaiNums = Array.from(rawText.matchAll(/[๐-๙][๐-๙,./]*/g), (m) => m[0]);
  const rateMatches = Array.from(
    norm.matchAll(/(?:ร้อยละ\s*[0-9]+(?:\.[0-9]+)?|[0-9,]+(?:\.[0-9]+)?\s*บาท)/g),
    (m) => m[0].trim()
  );
  const negMatches = Array.from(
    rawText.matchAll(/(?:ไม่ต้อง|ไม่ได้|ไม่เกิน|ไม่น้อยกว่า|ไม่คุ้ม|ไม่อาจ|ไม่มี|ไม่ว่า|มิได้|มิใช่|มิให้|ไม่ต้องเสีย)/g),
    (m) => m[0]
  );
  const excMatches = Array.from(rawText.matchAll(/(?:เว้นแต่|นอกจาก|ทั้งนี้\s*เฉพาะ)/g), (m) => m[0]);
  const illegMatches = Array.from(
    rawText.matchAll(/(?:\[ILLEGIBLE\]|\ufffd|[\ue000-\uf8ff])/g),
    (m) => m[0]
  );

  return {
    section_and_clause_numbers: [...new Set(secMatches)],
    buddhist_era_years: [...new Set(yearMatches)],
    thai_numeral_tokens: [...new Set(thaiNums)],
    rate_and_amount_tokens: [...new Set(rateMatches)],
    negation_tokens: [...new Set(negMatches)],
    exception_tokens: [...new Set(excMatches)],
    illegible_or_handwritten_flags: [...new Set(illegMatches)],
  };
}

/**
 * Compares Primary OCR (`typhoon-ocr-v2`) against Secondary/Fallback OCR (`gemini-3.8-flash` / `typhoon-ocr-v1.5`)
 * and emits blocking `OCRIssue`s whenever negations (`มิใช่` vs `มีใช้`), exceptions (`เว้นแต่`),
 * section numbers, B.E. years, rates, or statutory titles (`ภาษีป้าย` vs `ภาษีป่าย`) diverge.
 * Never auto-merges or invents text — routes disagreements directly to human review!
 */
export function compareDualOcrPassages(params: {
  documentId: string;
  pageNumber: number;
  imageSha256: string;
  primaryText: string;
  secondaryText: string;
}): OCRIssue[] {
  const pSum = auditCriticalThaiLegalTokens(params.primaryText);
  const sSum = auditCriticalThaiLegalTokens(params.secondaryText);
  const issues: OCRIssue[] = [];

  const diffSymmetric = (a: string[], b: string[]) => {
    const setA = new Set(a);
    const setB = new Set(b);
    return [
      ...a.filter((x) => !setB.has(x)).map((x) => `primary_only:${x}`),
      ...b.filter((x) => !setA.has(x)).map((x) => `secondary_only:${x}`),
    ];
  };

  const negDiff = diffSymmetric(pSum.negation_tokens, sSum.negation_tokens);
  const excDiff = diffSymmetric(pSum.exception_tokens, sSum.exception_tokens);
  if (negDiff.length > 0 || excDiff.length > 0) {
    issues.push({
      issue_id: `iss.${params.documentId}.p${params.pageNumber}.dual_negation_conflict`,
      code: "CRITICAL_NEGATION_OR_EXCEPTION_DISAGREEMENT",
      severity: "blocking",
      page_number: params.pageNumber,
      block_id: null,
      message: `Primary vs secondary OCR disagreed on statutory negation/exception tokens on page ${params.pageNumber}: [${[
        ...negDiff,
        ...excDiff,
      ].join(", ")}]`,
      evidence_refs: [`img:${params.imageSha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  const secDiff = diffSymmetric(pSum.section_and_clause_numbers, sSum.section_and_clause_numbers);
  const yrDiff = diffSymmetric(pSum.buddhist_era_years, sSum.buddhist_era_years);
  const rateDiff = diffSymmetric(pSum.rate_and_amount_tokens, sSum.rate_and_amount_tokens);
  if (secDiff.length > 0 || yrDiff.length > 0 || rateDiff.length > 0) {
    issues.push({
      issue_id: `iss.${params.documentId}.p${params.pageNumber}.dual_critical_token_conflict`,
      code: "CRITICAL_LEGAL_TOKEN_DISAGREEMENT",
      severity: "blocking",
      page_number: params.pageNumber,
      block_id: null,
      message: `Primary vs secondary OCR disagreed on section/year/rate tokens on page ${params.pageNumber}: [${[
        ...secDiff,
        ...yrDiff,
        ...rateDiff,
      ].join(", ")}]`,
      evidence_refs: [`img:${params.imageSha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  // Catch Thai tone-mark / title-term corruption (e.g. `ภาษีป่าย` vs `ภาษีป้าย`)
  if (/ภาษีป่าย/.test(params.primaryText) || (/ภาษีป้าย/.test(params.secondaryText) && !/ภาษีป้าย/.test(params.primaryText))) {
    issues.push({
      issue_id: `iss.${params.documentId}.p${params.pageNumber}.tonemark_statute_title`,
      code: "STATUTORY_TITLE_TONEMARK_UNCERTAINTY",
      severity: "blocking",
      page_number: params.pageNumber,
      block_id: null,
      message: `Statutory title tone-mark discrepancy detected on page ${params.pageNumber} (e.g. 'ภาษีป่าย' vs 'ภาษีป้าย'); routed to human review`,
      evidence_refs: [`img:${params.imageSha256}`],
      detector_version: THAI_DETECTOR_VERSION_V2,
      resolution: "open",
    });
  }

  return issues;
}
