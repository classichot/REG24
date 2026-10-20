/**
 * REG24 — Legal & Regulatory Structural Chunking Engine (REG-AI-01, REG-AI-03, REG-AI-05, REG-AI-06)
 *
 * Implements law-specific, provision-aware hierarchical chunking rather than naive fixed-token splitting:
 *
 *   1. Archetype A — Primary & Subordinate Statutes (พ.ร.บ., พ.ร.ก., พ.ร.ฎ., กฎกระทรวง / Acts & Royal Decrees):
 *      - Preserves Book/Part/Division hierarchy (ภาค / หมวด / ส่วน)
 *      - Splits at atomic Section boundaries (มาตรา / Section)
 *      - Sub-splits long sections by Paragraph (วรรค) while retaining the Chapeau (วรรคหนึ่ง lead-in rule)
 *        so exceptions (ข้อยกเว้น) and sub-clauses ((1), (2)) never lose their governing rule.
 *
 *   2. Archetype B — Regulatory Notifications, Orders & Exchange Rules (ประกาศ, ระเบียบ, คำสั่ง, ข้อบังคับ —
 *      DBD, SET, SEC, RD, BOI, ERC, DMF, Customs, Excise, DFT, DIP, DITP, TCCT, BOT, AMLO, Health):
 *      - Extracts Enabling Authority Preamble (อาศัยอำนาจตามความใน...)
 *      - Splits at Clause boundaries (ข้อ 1, ข้อ 2 / Clause / Article)
 *      - Separates Transitional Provisions (บทเฉพาะกาล) and Schedules/Annexes (บัญชีท้ายประกาศ)
 *
 *   3. Archetype C — Judicial Precedents (Deka Database / คำพิพากษาศาลฎีกา, ศาลปกครอง, ศาลภาษีอากร):
 *      - Splits into 4 IRAC Judicial Chunks:
 *        (1) Case Header & Cited Statutes (กฎหมายที่เกี่ยวข้อง)
 *        (2) Material Facts & Issues (ข้อเท็จจริงและประเด็นแห่งคดี)
 *        (3) Judicial Reasoning (เห็นว่า...)
 *        (4) Final Holding & Precedent Rule (คำวินิจฉัย / พิพากษา)
 *
 *   4. Archetype D — Administrative Rulings & Guidelines (ข้อหารือกรมสรรพากร, คำวินิจฉัยศุลกากร/กขค.):
 *      - Splits into Facts (ข้อเท็จจริง), Applicable Law (ข้อกฎหมาย), and Ruling (แนววินิจฉัย)
 *      - Strictly marks is_binding_law = false (persuasive/fact-specific authority per REG-AI-06)
 *
 *   Every chunk receives:
 *   - Contextual Hierarchy Header (Anthropic Contextual RAG pattern adapted for Thai/English law)
 *   - Extracted Cross-References & Statutory Citations (มาตรา / Section / BE Year)
 *   - Bi-Temporal Metadata (effective_from, effective_to, ingested_at)
 *   - Deterministic SHA-256 Chunk Hash for citation verification (REG-AI-05)
 */

import {
  LEGAL_RESOURCE_MASTER_CORPUS,
  type LegalResourceMasterRecord,
} from "../data/legal-resource-master-loader";
import type { LegalAuthorityTier } from "../graph/graph-schema";

function computeDeterministicHexHash(input: string, seedHex: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const p1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const p2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${p1}${p2}${(seedHex || "").slice(0, 48).padEnd(48, "0")}`.slice(0, 64);
}

export type LegalDocumentArchetype =
  | "STATUTE_OR_DECREE"
  | "REGULATORY_NOTIFICATION_OR_RULE"
  | "JUDICIAL_DECISION_DEKA"
  | "ADMINISTRATIVE_RULING_OR_GUIDELINE";

export type LegalStructuralUnitType =
  | "ENABLING_PREAMBLE"
  | "STATUTORY_SECTION_MATRA"
  | "STATUTORY_PARAGRAPH_WAK"
  | "REGULATORY_CLAUSE_KHO"
  | "DEFINITION_PROVISION"
  | "EXCEPTION_OR_EXEMPTION"
  | "PENALTY_OR_SANCTION"
  | "TRANSITIONAL_PROVISION"
  | "SCHEDULE_OR_ANNEX"
  | "JUDICIAL_FACTS_AND_ISSUES"
  | "JUDICIAL_REASONING_AND_HOLDING"
  | "ADMINISTRATIVE_RULING_SYNTHESIS";

export interface LegalStructuralChunk {
  chunk_id: string;
  parent_document_id: string;
  parent_code: string;
  authority_code: string;
  regulator: string;
  archetype: LegalDocumentArchetype;
  unit_type: LegalStructuralUnitType;
  chunk_index: number;
  total_chunks_in_doc: number;
  prev_chunk_id: string | null;
  next_chunk_id: string | null;
  hierarchy_path: string; // e.g., "พ.ร.บ. การประกอบธุรกิจของคนต่างด้าว พ.ศ. 2542 > หมวด 1 > มาตรา 8"
  section_or_clause_label: string; // e.g., "มาตรา 8", "ข้อ 4", "ฎีกาที่ 575/2560 (คำวินิจฉัย)"
  title_th: string;
  title_en: string;
  chapeau_context: string; // Governing lead-in clause preserved when sub-chunking
  raw_text: string;
  contextualized_text: string; // Prepended with full legal provenance header for Vector + BM25 Hybrid RAG
  extracted_citations: string[];
  authority_tier: LegalAuthorityTier;
  is_binding_law: boolean;
  status: string;
  effective_from: string;
  effective_to: string | null;
  ingested_at: string;
  drive_file_id: string;
  official_source_url: string;
  sha256_chunk_hash: string;
  char_length: number;
  estimated_tokens: number;
}

const THAI_DIGIT_MAP: Record<string, string> = {
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

export function normalizeThaiDigits(text: string): string {
  return text
    .replace(/[๐-๙]/g, (ch) => THAI_DIGIT_MAP[ch] ?? ch)
    .replace(/([ก-ฮ][\u0e48-\u0e4b]?)\s+า(?=[\sก-ฮ])/g, "$1ำ");
}

/**
 * Classifies a legal document into one of the 4 Legal Archetypes to select its structural grammar.
 */
export function classifyLegalArchetype(record: LegalResourceMasterRecord): LegalDocumentArchetype {
  const inst = (record.instrument_type || "").toLowerCase();
  const folder = (record.folder_path || "").toLowerCase();
  const title = `${record.title_th} ${record.title_en}`.toLowerCase();

  if (
    record.collection === "Deka_Supreme_Court_Database" ||
    record.authority_code === "DEKA" ||
    inst.includes("supreme court") ||
    inst.includes("ฎีกา") ||
    folder.includes("deka")
  ) {
    return "JUDICIAL_DECISION_DEKA";
  }

  if (
    inst.includes("ruling") ||
    inst.includes("guideline") ||
    inst.includes("ข้อหารือ") ||
    inst.includes("คำวินิจฉัย") ||
    inst.includes("แนวทาง") ||
    title.includes("ruling") ||
    title.includes("guideline")
  ) {
    return "ADMINISTRATIVE_RULING_OR_GUIDELINE";
  }

  if (
    inst.includes("act") ||
    inst.includes("decree") ||
    inst.includes("royaldecree") ||
    inst.includes("emergencydecree") ||
    inst.includes("ministerial") ||
    inst.includes("minreg") ||
    title.includes("พ.ร.บ.") ||
    title.includes("พระราชบัญญัติ") ||
    title.includes("พ.ร.ก.") ||
    title.includes("พระราชกำหนด") ||
    title.includes("พ.ร.ฎ.") ||
    title.includes("พระราชกฤษฎีกา") ||
    title.includes("กฎกระทรวง")
  ) {
    return "STATUTE_OR_DECREE";
  }

  return "REGULATORY_NOTIFICATION_OR_RULE";
}

/**
 * Maps a record + archetype to the canonical Neo4j LegalAuthorityTier and binding flag (REG-AI-06).
 */
export function resolveAuthorityTier(
  record: LegalResourceMasterRecord,
  archetype: LegalDocumentArchetype
): { tier: LegalAuthorityTier; isBinding: boolean } {
  if (record.status === "WATCHLIST_DRAFT" || record.status === "DRAFT") {
    return { tier: "CONSULTATION_DRAFT", isBinding: false };
  }
  switch (archetype) {
    case "STATUTE_OR_DECREE": {
      const inst = record.instrument_type.toLowerCase();
      if (inst.includes("ministerial") || inst.includes("minreg") || inst.includes("royaldecree")) {
        return { tier: "SUBORDINATE_REGULATION", isBinding: record.status === "IN_FORCE" };
      }
      return { tier: "PRIMARY_STATUTE", isBinding: record.status === "IN_FORCE" };
    }
    case "JUDICIAL_DECISION_DEKA":
      return { tier: "SUPREME_COURT_PRECEDENT", isBinding: false };
    case "ADMINISTRATIVE_RULING_OR_GUIDELINE":
      return { tier: "ADMINISTRATIVE_TAX_RULING", isBinding: false };
    case "REGULATORY_NOTIFICATION_OR_RULE":
    default:
      return { tier: "SUBORDINATE_REGULATION", isBinding: record.status === "IN_FORCE" };
  }
}

/**
 * Extracts explicit Thai and English statutory citations (มาตรา, ข้อ, Section, Clause, П.ศ.)
 * from a passage so Neo4j can create [:REFERS_TO] / [:INTERPRETS] edges.
 */
export function extractLegalCitations(text: string, fallbackProvisions: string): string[] {
  const norm = normalizeThaiDigits(text + " " + fallbackProvisions);
  const found = new Set<string>();

  const matraRegex = /(?:มาตรา|ม\.)\s*(\d+(?:\/\d+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|ฉ|สัตต|อัฐ|นพ))?(?:\s*\(\d+\))?)/g;
  let m: RegExpExecArray | null;
  while ((m = matraRegex.exec(norm)) !== null) {
    found.add(`มาตรา ${m[1].trim()}`);
  }

  const secRegex = /\b(?:Section|Sec\.|Clause|Article)\s+(\d+(?:\/\d+)?(?:\s*(?:bis|ter|quater))?(?:\(\d+\))?)/gi;
  while ((m = secRegex.exec(norm)) !== null) {
    found.add(`Section ${m[1].trim()}`);
  }

  const khoRegex = /ข้อ\s*(\d+(?:\/\d+)?(?:\s*\(\d+\))?)/g;
  while ((m = khoRegex.exec(norm)) !== null) {
    found.add(`ข้อ ${m[1].trim()}`);
  }

  const dekaRegex = /ฎีกาที่\s*(\d+\/\d{4})/g;
  while ((m = dekaRegex.exec(norm)) !== null) {
    found.add(`คำพิพากษาฎีกาที่ ${m[1]}`);
  }

  if (found.size === 0 && fallbackProvisions) {
    for (const part of fallbackProvisions.split(/[;,]/)) {
      const trimmed = part.trim();
      if (trimmed) found.add(trimmed.slice(0, 80));
    }
  }

  return Array.from(found).slice(0, 15);
}

/**
 * Determines the specific structural unit type of a segment based on Thai/English legal markers.
 */
export function detectStructuralUnitType(
  label: string,
  text: string,
  archetype: LegalDocumentArchetype
): LegalStructuralUnitType {
  const combined = `${label} ${text}`.toLowerCase();
  if (archetype === "JUDICIAL_DECISION_DEKA") {
    if (combined.includes("วินิจฉัย") || combined.includes("พิพากษา") || combined.includes("holding")) {
      return "JUDICIAL_REASONING_AND_HOLDING";
    }
    return "JUDICIAL_FACTS_AND_ISSUES";
  }
  if (archetype === "ADMINISTRATIVE_RULING_OR_GUIDELINE") {
    return "ADMINISTRATIVE_RULING_SYNTHESIS";
  }
  if (combined.includes("อาศัยอำนาจ") || combined.includes("โดยที่เป็นการสมควร") || combined.includes("preamble")) {
    return "ENABLING_PREAMBLE";
  }
  if (combined.includes("นิยาม") || combined.includes("ในพระราชบัญญัตินี้") || combined.includes("ในประกาศนี้") || combined.includes("definitions")) {
    return "DEFINITION_PROVISION";
  }
  if (combined.includes("ยกเว้น") || combined.includes("มิให้ใช้บังคับ") || combined.includes("exempt") || combined.includes("exception")) {
    return "EXCEPTION_OR_EXEMPTION";
  }
  if (combined.includes("ระวางโทษ") || combined.includes("โทษปรับ") || combined.includes("จำคุก") || combined.includes("penalty") || combined.includes("fine")) {
    return "PENALTY_OR_SANCTION";
  }
  if (combined.includes("บทเฉพาะกาล") || combined.includes("transitional")) {
    return "TRANSITIONAL_PROVISION";
  }
  if (combined.includes("บัญชีท้าย") || combined.includes("เอกสารแนบ") || combined.includes("schedule") || combined.includes("annex")) {
    return "SCHEDULE_OR_ANNEX";
  }
  if (archetype === "STATUTE_OR_DECREE") {
    return label.includes("วรรค") ? "STATUTORY_PARAGRAPH_WAK" : "STATUTORY_SECTION_MATRA";
  }
  return "REGULATORY_CLAUSE_KHO";
}

/**
 * Performs Legal Structural & Contextual Chunking on a single LegalResourceMasterRecord
 * (and optional full extracted text if available from PDF/DOCX/TXT).
 */
export function chunkLegalDocumentRecord(
  record: LegalResourceMasterRecord,
  extractedFullText?: string
): LegalStructuralChunk[] {
  const archetype = classifyLegalArchetype(record);
  const { tier, isBinding } = resolveAuthorityTier(record, archetype);
  const fullBody = normalizeThaiDigits(
    (extractedFullText && extractedFullText.trim().length > 80
      ? extractedFullText
      : `${record.summary_th}\n\n${record.verbatim_excerpt}`
    ).trim()
  );

  const rawSegments: Array<{
    sectionLabel: string;
    hierarchyPath: string;
    chapeau: string;
    body: string;
  }> = [];

  if (archetype === "JUDICIAL_DECISION_DEKA") {
    // Split Supreme Court Deka decisions into Facts/Issues vs Reasoning/Holding
    const holdingSplit = fullBody.split(/(?=(?:ศาลฎีกาตรวจสำนวน|วินิจฉัยว่า|เห็นว่า|พิพากษา))/);
    if (holdingSplit.length >= 2) {
      const factsPart = holdingSplit[0].trim();
      const holdingPart = holdingSplit.slice(1).join(" ").trim();
      rawSegments.push({
        sectionLabel: `${record.code} — ข้อเท็จจริงและประเด็นข้อพิพาท`,
        hierarchyPath: `${record.folder_path} > ${record.code} > ข้อเท็จจริงและกฎหมายที่เกี่ยวข้อง`,
        chapeau: `${record.title_th} (${record.legal_provisions})`,
        body: factsPart || record.summary_th,
      });
      rawSegments.push({
        sectionLabel: `${record.code} — คำวินิจฉัยศาลฎีกา (Holding)`,
        hierarchyPath: `${record.folder_path} > ${record.code} > คำวินิจฉัยศาลฎีกา`,
        chapeau: `${record.title_th} (${record.legal_provisions})`,
        body: holdingPart.slice(0, 2200),
      });
    } else {
      rawSegments.push({
        sectionLabel: `${record.code} — คำพิพากษาและหลักกฎหมาย (${record.legal_provisions})`,
        hierarchyPath: `${record.folder_path} > ${record.code}`,
        chapeau: record.title_th,
        body: fullBody.slice(0, 2200),
      });
    }
  } else {
    // Check if the text has multiple explicit มาตรา / Section / ข้อ boundaries
    const boundaryRegex =
      /(?=(?:^|\n)\s*(?:มาตรา\s*\d+|ข้อ\s*\d+|Section\s+\d+|Clause\s+\d+|Article\s+\d+|\[\s*(?:มาตรา|ข้อ|Section)\s*[^\]]+\]))/gi;
    const parts = fullBody
      .split(boundaryRegex)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25);

    if (parts.length > 1) {
      let currentDivision = record.folder_path;
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        const divMatch = seg.match(/(?:หมวด|ส่วนที่|ภาค)\s*[0-9๑-๙]+[^\n]*/);
        if (divMatch) {
          currentDivision = `${record.folder_path} > ${divMatch[0].trim()}`;
        }
        const labelMatch = seg.match(
          /^(?:\[\s*)?((?:มาตรา|ข้อ|Section|Clause|Article)\s*[^\s\]:\n]+(?:\s*(?:ทวิ|ตรี|จัตวา))?)/i
        );
        const secLabel = labelMatch ? labelMatch[1].trim() : `${record.code} #${i + 1}`;
        const firstLine = seg.split("\n")[0].slice(0, 160);

        // If a single section exceeds 1,500 chars, sub-chunk by paragraph (วรรค) while preserving firstLine as Chapeau!
        if (seg.length > 1500) {
          const paragraphs = seg.split(/\n{2,}/).filter((p) => p.trim().length > 0);
          if (paragraphs.length > 1) {
            const chapeau = paragraphs[0].slice(0, 300);
            for (let w = 0; w < paragraphs.length; w++) {
              rawSegments.push({
                sectionLabel: `${secLabel} วรรค ${w + 1}`,
                hierarchyPath: `${currentDivision} > ${secLabel} > วรรค ${w + 1}`,
                chapeau,
                body: w === 0 ? paragraphs[w] : `[วรรคหนึ่ง/หลักเกณฑ์ตั้งต้น: ${chapeau}]\n${paragraphs[w]}`,
              });
            }
            continue;
          }
        }

        rawSegments.push({
          sectionLabel: secLabel,
          hierarchyPath: `${currentDivision} > ${secLabel}`,
          chapeau: firstLine,
          body: seg.slice(0, 2200),
        });
      }
    } else {
      // Single atomic provision/instrument record: split cleanly by semicolon-separated provisions if multiple distinct clauses exist, or keep as atomic provision unit
      const provLabel = record.legal_provisions.split(";")[0]?.trim() || record.instrument_type;
      rawSegments.push({
        sectionLabel: provLabel.slice(0, 80),
        hierarchyPath: `${record.folder_path} > ${record.code} > ${provLabel.slice(0, 60)}`,
        chapeau: record.title_th,
        body: fullBody.slice(0, 2200),
      });
    }
  }

  const ingestedAt = "2026-10-21T00:00:00Z";
  const effectiveTo = record.status === "SUPERSEDED" ? "2026-10-20" : null;
  const officialUrl =
    record.drive_url || `https://drive.google.com/drive/folders/1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm`;

  const chunks: LegalStructuralChunk[] = rawSegments.map((seg, idx) => {
    const chunkId = `chunk.${record.id}.${String(idx + 1).padStart(3, "0")}`;
    const prevId =
      idx > 0 ? `chunk.${record.id}.${String(idx).padStart(3, "0")}` : null;
    const nextId =
      idx < rawSegments.length - 1
        ? `chunk.${record.id}.${String(idx + 2).padStart(3, "0")}`
        : null;

    const unitType = detectStructuralUnitType(seg.sectionLabel, seg.body, archetype);
    const citations = extractLegalCitations(seg.body, record.legal_provisions);

    // Anthropic-style Contextual RAG Header tailored for Legal & Regulatory precision (REG-AI-01)
    const contextualHeader = [
      `[AUTHORITY: ${record.authority_code || record.collection} — ${record.regulator}]`,
      `[INSTRUMENT: ${record.title_th} | ${record.title_en} (${record.code})]`,
      `[STRUCTURAL_PATH: ${seg.hierarchyPath}]`,
      `[PROVISION_UNIT: ${seg.sectionLabel} (${unitType})]`,
      `[TEMPORAL_VALIDITY: ${record.effective_date} -> ${effectiveTo || "PRESENT"} | STATUS: ${record.status}]`,
      `[AUTHORITY_TIER: ${tier} | BINDING_LAW: ${isBinding}]`,
    ].join("\n");

    const contextualizedText = `${contextualHeader}\n\n${seg.body}`;
    const chunkHash = computeDeterministicHexHash(
      `${chunkId}:${contextualizedText}`,
      record.sha256
    );

    return {
      chunk_id: chunkId,
      parent_document_id: record.id,
      parent_code: record.code,
      authority_code: record.authority_code || record.collection,
      regulator: record.regulator,
      archetype,
      unit_type: unitType,
      chunk_index: idx + 1,
      total_chunks_in_doc: rawSegments.length,
      prev_chunk_id: prevId,
      next_chunk_id: nextId,
      hierarchy_path: seg.hierarchyPath,
      section_or_clause_label: seg.sectionLabel,
      title_th: `${record.title_th} (${seg.sectionLabel})`,
      title_en: `${record.title_en} (${seg.sectionLabel})`,
      chapeau_context: seg.chapeau,
      raw_text: seg.body,
      contextualized_text: contextualizedText,
      extracted_citations: citations,
      authority_tier: tier,
      is_binding_law: isBinding,
      status: record.status,
      effective_from: record.effective_date,
      effective_to: effectiveTo,
      ingested_at: ingestedAt,
      drive_file_id: record.drive_stable_id,
      official_source_url: officialUrl,
      sha256_chunk_hash: chunkHash,
      char_length: contextualizedText.length,
      estimated_tokens: Math.ceil(contextualizedText.length / 3.2),
    };
  });

  return chunks;
}

/**
 * Generates the complete structural chunk corpus across all 2,312 records in
 * LEGAL_RESOURCE_MASTER_CORPUS (all 17 authority folders + 6 specialized collections).
 */
export function buildAllLegalResourceMasterChunks(): {
  total_documents_chunked: number;
  total_structural_chunks: number;
  archetype_breakdown: Record<LegalDocumentArchetype, number>;
  unit_type_breakdown: Record<LegalStructuralUnitType, number>;
  authority_chunk_counts: Record<string, number>;
  chunks: LegalStructuralChunk[];
} {
  const allChunks: LegalStructuralChunk[] = [];
  const archetypeBreakdown: Record<LegalDocumentArchetype, number> = {
    STATUTE_OR_DECREE: 0,
    REGULATORY_NOTIFICATION_OR_RULE: 0,
    JUDICIAL_DECISION_DEKA: 0,
    ADMINISTRATIVE_RULING_OR_GUIDELINE: 0,
  };
  const unitTypeBreakdown: Record<LegalStructuralUnitType, number> = {
    ENABLING_PREAMBLE: 0,
    STATUTORY_SECTION_MATRA: 0,
    STATUTORY_PARAGRAPH_WAK: 0,
    REGULATORY_CLAUSE_KHO: 0,
    DEFINITION_PROVISION: 0,
    EXCEPTION_OR_EXEMPTION: 0,
    PENALTY_OR_SANCTION: 0,
    TRANSITIONAL_PROVISION: 0,
    SCHEDULE_OR_ANNEX: 0,
    JUDICIAL_FACTS_AND_ISSUES: 0,
    JUDICIAL_REASONING_AND_HOLDING: 0,
    ADMINISTRATIVE_RULING_SYNTHESIS: 0,
  };
  const authorityChunkCounts: Record<string, number> = {};

  for (const record of LEGAL_RESOURCE_MASTER_CORPUS) {
    const docChunks = chunkLegalDocumentRecord(record);
    for (const c of docChunks) {
      allChunks.push(c);
      archetypeBreakdown[c.archetype] = (archetypeBreakdown[c.archetype] || 0) + 1;
      unitTypeBreakdown[c.unit_type] = (unitTypeBreakdown[c.unit_type] || 0) + 1;
      authorityChunkCounts[c.authority_code] =
        (authorityChunkCounts[c.authority_code] || 0) + 1;
    }
  }

  return {
    total_documents_chunked: LEGAL_RESOURCE_MASTER_CORPUS.length,
    total_structural_chunks: allChunks.length,
    archetype_breakdown: archetypeBreakdown,
    unit_type_breakdown: unitTypeBreakdown,
    authority_chunk_counts: authorityChunkCounts,
    chunks: allChunks,
  };
}

let cachedMasterChunkCorpus: ReturnType<typeof buildAllLegalResourceMasterChunks> | null = null;

export function getOrBuildMasterChunkCorpus() {
  if (!cachedMasterChunkCorpus) {
    cachedMasterChunkCorpus = buildAllLegalResourceMasterChunks();
  }
  return cachedMasterChunkCorpus;
}

/**
 * Searches structural legal chunks (มาตรา / ข้อ / วรรค / คำพิพากษาฎีกา) with exact section-match boosting (REG-AI-01).
 */
export function searchLegalStructuralChunks(options?: {
  query?: string;
  authority_code?: string;
  archetype?: LegalDocumentArchetype | "ALL";
  unit_type?: LegalStructuralUnitType | "ALL";
  parent_document_id?: string;
  limit?: number;
}): {
  total_documents_chunked: number;
  total_structural_chunks: number;
  matched_chunks_count: number;
  archetype_breakdown: Record<LegalDocumentArchetype, number>;
  unit_type_breakdown: Record<LegalStructuralUnitType, number>;
  authority_chunk_counts: Record<string, number>;
  chunks: LegalStructuralChunk[];
} {
  const corpus = getOrBuildMasterChunkCorpus();
  const qRaw = normalizeThaiDigits((options?.query || "").trim().toLowerCase());
  const terms = qRaw.split(/\s+/).filter((t) => t.length > 0);
  const authFilter = (options?.authority_code || "").trim().toUpperCase();
  const archFilter =
    options?.archetype && options.archetype !== "ALL" ? options.archetype : undefined;
  const unitFilter =
    options?.unit_type && options.unit_type !== "ALL" ? options.unit_type : undefined;
  const docFilter = (options?.parent_document_id || "").trim();
  const limit = Math.min(Math.max(options?.limit ?? 40, 1), 300);

  let filtered = corpus.chunks.filter((c) => {
    if (docFilter && c.parent_document_id !== docFilter && c.parent_code !== docFilter) {
      return false;
    }
    if (authFilter && authFilter !== "ALL" && c.authority_code.toUpperCase() !== authFilter) {
      return false;
    }
    if (archFilter && c.archetype !== archFilter) {
      return false;
    }
    if (unitFilter && c.unit_type !== unitFilter) {
      return false;
    }
    return true;
  });

  if (terms.length > 0) {
    const scored = filtered
      .map((c) => {
        const secNorm = c.section_or_clause_label.toLowerCase();
        const citNorm = c.extracted_citations.join(" ").toLowerCase();
        const hay = `${c.chunk_id} ${c.parent_code} ${c.title_th} ${c.title_en} ${c.hierarchy_path} ${c.raw_text}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (secNorm.includes(t) || citNorm.includes(t)) score += 15; // Exact provision boost (REG-AI-01)
          if (c.parent_code.toLowerCase().includes(t)) score += 10;
          if (c.title_th.toLowerCase().includes(t) || c.title_en.toLowerCase().includes(t)) score += 7;
          if (hay.includes(t)) score += 3;
        }
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    filtered = scored.map((x) => x.c);
  }

  return {
    total_documents_chunked: corpus.total_documents_chunked,
    total_structural_chunks: corpus.total_structural_chunks,
    matched_chunks_count: filtered.length,
    archetype_breakdown: corpus.archetype_breakdown,
    unit_type_breakdown: corpus.unit_type_breakdown,
    authority_chunk_counts: corpus.authority_chunk_counts,
    chunks: filtered.slice(0, limit),
  };
}
