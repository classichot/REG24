/**
 * REG24 — Task F3: Thai-Aware Structural Legal Passage Extraction & Untrusted Instruction Guard
 * Implements Section 6, SH-16 & AT09.
 */

import { sha256Bytes } from "./identity";
import { detectCriticalLegalTokens } from "./page-routing";
import type { Passage, RealSourceLocator, SourceLocatorKind, StatementRole } from "./contracts";

const PROMPT_INJECTION_PATTERNS =
  /ignore\s+(?:all\s+|previous\s+)?instructions|grant\s+admin|system\s+prompt|call\s+external\s+tool|delete_database|bypass\s+authorization/i;

export function estimateThaiLegalTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Thai legal prose averages ~2.7–3.2 Unicode chars per subword token
  return Math.max(1, Math.ceil(trimmed.length / 2.9));
}

export function detectLanguageKind(text: string): "th" | "en" | "mixed" {
  const hasTh = /[\u0E00-\u0E7F]/.test(text);
  const hasEn = /[A-Za-z]{2,}/.test(text);
  if (hasTh && hasEn) return "mixed";
  if (hasEn && !hasTh) return "en";
  return "th";
}

export interface StructuralChunkInput {
  work_id: string;
  version_id: string;
  extraction_id: string;
  release_id: string;
  artifact_id: string;
  origin_uri: string;
  locator_kind: SourceLocatorKind;
  physical_page_index?: number;
  printed_page_label?: string | null;
  structural_selector_prefix?: string;
  header_label: string;
  structural_path_prefix?: string[];
  raw_text: string;
  statement_role: StatementRole;
  access_scope: string;
  target_min_tokens?: number;
  target_max_tokens?: number;
}

/**
 * Splits Thai legal text by structural units (มาตรา, วรรค, ข้อ, (1)..(n), ตาราง, หมายเหตุ)
 * targeting ~300–800 tokens per passage, while NEVER detaching an exception/proviso clause
 * (`เว้นแต่`, `ทั้งนี้`, `ภายใต้บังคับ`, `แต่ไม่รวมถึง`) from the rule/condition it qualifies!
 */
export function chunkThaiLegalDocument(input: StructuralChunkInput): Passage[] {
  const minTokens = input.target_min_tokens ?? 300;
  const maxTokens = input.target_max_tokens ?? 800;

  const rawParagraphs = input.raw_text
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (rawParagraphs.length === 0) return [];

  // Group paragraphs so exception/condition continuation clauses stay bound to their preceding rule
  const mergedUnits: string[] = [];
  for (const para of rawParagraphs) {
    const startsWithProviso = /^(?:เว้นแต่|ทั้งนี้|ภายใต้บังคับ|แต่ไม่รวมถึง|แต่ทั้งนี้|อนึ่ง|หมายเหตุ)/.test(para);
    const currentLast = mergedUnits[mergedUnits.length - 1];

    if (!currentLast) {
      mergedUnits.push(para);
      continue;
    }

    const combinedCandidate = `${currentLast}\n${para}`;
    const combinedTokens = estimateThaiLegalTokens(combinedCandidate);

    if (
      startsWithProviso ||
      (estimateThaiLegalTokens(currentLast) < minTokens && combinedTokens <= maxTokens)
    ) {
      mergedUnits[mergedUnits.length - 1] = combinedCandidate;
    } else if (estimateThaiLegalTokens(para) > maxTokens) {
      // Split oversized paragraph along Thai clause boundaries while keeping overlap context
      const subClauses = para.split(/(?=(?:\([0-9๐-๙]+\)|ข้อ\s*[0-9๐-๙]+|วรรค))/g).filter(Boolean);
      if (subClauses.length > 1) {
        let acc = "";
        for (const sc of subClauses) {
          if (acc && estimateThaiLegalTokens(`${acc} ${sc}`) > maxTokens) {
            mergedUnits.push(acc.trim());
            acc = sc;
          } else {
            acc = acc ? `${acc} ${sc}` : sc;
          }
        }
        if (acc.trim()) mergedUnits.push(acc.trim());
      } else {
        mergedUnits.push(para);
      }
    } else {
      mergedUnits.push(para);
    }
  }

  const passageIds = mergedUnits.map((_, idx) => {
    const seed = `${input.version_id}:${input.extraction_id}:${input.statement_role}:${idx + 1}`;
    return `psg.${sha256Bytes(seed).slice(0, 14)}`;
  });

  let byteCursor = 0;
  return mergedUnits.map((unitText, idx) => {
    const byteLen = Buffer.byteLength(unitText, "utf8");
    const locator: RealSourceLocator =
      input.locator_kind === "pdf_page"
        ? {
            kind: "pdf_page",
            artifact_id: input.artifact_id,
            origin_uri: input.origin_uri,
            physical_page_index: input.physical_page_index ?? 0,
            printed_page_label: input.printed_page_label ?? String((input.physical_page_index ?? 0) + 1),
          }
        : input.locator_kind === "html_structural"
          ? {
              kind: "html_structural",
              artifact_id: input.artifact_id,
              origin_uri: input.origin_uri,
              structural_selector: `${input.structural_selector_prefix || "article > section"}[${idx + 1}]`,
            }
          : {
              kind: "text_byte_offset",
              artifact_id: input.artifact_id,
              origin_uri: input.origin_uri,
              byte_start: byteCursor,
              byte_end: byteCursor + byteLen,
            };

    byteCursor += byteLen + 1;

    return {
      passage_id: passageIds[idx],
      work_id: input.work_id,
      version_id: input.version_id,
      extraction_id: input.extraction_id,
      release_id: input.release_id,
      exact_text: unitText, // Exact source text preserved; instruction-like text flagged as untrusted data (AT09)
      contextualized_header: input.header_label,
      real_locator: locator,
      structural_path: [...(input.structural_path_prefix || [input.header_label]), `Unit ${idx + 1}`],
      parent_id: input.work_id,
      adjacent_ids: {
        previous_id: idx > 0 ? passageIds[idx - 1] : null,
        next_id: idx < passageIds.length - 1 ? passageIds[idx + 1] : null,
      },
      language: detectLanguageKind(unitText),
      statement_role: input.statement_role,
      token_count: estimateThaiLegalTokens(unitText),
      critical_tokens_flagged: detectCriticalLegalTokens(unitText),
      contains_untrusted_instruction_like_text: PROMPT_INJECTION_PATTERNS.test(unitText),
      access_scope: input.access_scope,
    };
  });
}
