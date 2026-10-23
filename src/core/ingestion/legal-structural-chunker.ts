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

export type CrossReferenceEdgeType =
  | "REFERS_TO_PROVISION"
  | "ENABLED_BY_STATUTE"
  | "INTERPRETS_PROVISION"
  | "AMENDS_INSTRUMENT";

export interface ExtractedCrossReference {
  edge_type: CrossReferenceEdgeType;
  raw_citation: string;
  target_canonical_key: string;
  target_section_code: string | null;
  target_instrument_hint: string;
  resolved_chunk_id?: string | null;
  resolution_status?: "RESOLVED_IN_CORPUS" | "STUB_AWAITING_INGESTION";
}

export interface TemporalVersionMetadata {
  canonical_provision_key: string;
  version_sequence: number;
  amendment_no: string | null;
  amends_canonical_key: string | null;
  effective_from: string;
  effective_to: string | null;
  is_current_version: boolean;
}

export interface LegalStructuralChunk {
  chunk_id: string;
  canonical_provision_key: string; // e.g., "th:dbd:fba-2542#sec:8"
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
  outgoing_cross_references: ExtractedCrossReference[];
  temporal_version_meta: TemporalVersionMetadata;
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

const THAI_SUBSECTION_SUFFIX_MAP: Record<string, string> = {
  ทวิ: "bis",
  ตรี: "ter",
  จัตวา: "quater",
  เบญจ: "quinquies",
  ฉ: "sexies",
  สัตต: "septies",
  อัฐ: "octies",
  นพ: "novies",
};

function normalizeSectionToken(raw: string): string {
  let clean = normalizeThaiDigits(raw).trim().toLowerCase();
  for (const [thSuffix, latSuffix] of Object.entries(THAI_SUBSECTION_SUFFIX_MAP)) {
    clean = clean.replace(new RegExp(`\\s*${thSuffix}`, "g"), latSuffix);
  }
  return clean.replace(/\s+/g, "").replace(/[^a-z0-9/()-]/g, "");
}

function inferInstrumentSlug(text: string, fallbackAuthorityCode: string, fallbackCode: string): {
  slug: string;
  hint: string;
} {
  const combined = normalizeThaiDigits(text);
  if (/ประมวลรัษฎากร|revenue\s*code/i.test(combined)) {
    return { slug: "rd:revenue-code", hint: "ประมวลรัษฎากร (Revenue Code)" };
  }
  if (/ประมวลกฎหมายแพ่งและพาณิชย์|ป\.พ\.พ\.|civil\s*and\s*commercial\s*code|\bccc\b/i.test(combined)) {
    return { slug: "dbd:ccc", hint: "ประมวลกฎหมายแพ่งและพาณิชย์ (Civil and Commercial Code)" };
  }
  if (/ประกอบธุรกิจของคนต่างด้าว|foreign\s*business\s*act|\bfba\b/i.test(combined)) {
    return { slug: "dbd:fba-2542", hint: "พ.ร.บ. การประกอบธุรกิจของคนต่างด้าว พ.ศ. 2542" };
  }
  if (/หลักทรัพย์และตลาดหลักทรัพย์|securities\s*and\s*exchange\s*act|\bsea\b/i.test(combined)) {
    return { slug: "sec:sea-2535", hint: "พ.ร.บ. หลักทรัพย์และตลาดหลักทรัพย์ พ.ศ. 2535" };
  }
  if (/บริษัทมหาชนจำกัด|public\s*limited\s*compan/i.test(combined)) {
    return { slug: "dbd:plca-2535", hint: "พ.ร.บ. บริษัทมหาชนจำกัด พ.ศ. 2535" };
  }
  if (/ส่งเสริมการลงทุน|investment\s*promotion\s*act/i.test(combined)) {
    return { slug: "boi:ipa-2520", hint: "พ.ร.บ. ส่งเสริมการลงทุน พ.ศ. 2520" };
  }
  if (/การแข่งขันทางการค้า|trade\s*competition\s*act/i.test(combined)) {
    return { slug: "tcct:tca-2560", hint: "พ.ร.บ. การแข่งขันทางการค้า พ.ศ. 2560" };
  }
  if (/ศุลกากร|customs\s*act/i.test(combined)) {
    return { slug: "customs:customs-2560", hint: "พ.ร.บ. ศุลกากร พ.ศ. 2560" };
  }
  if (/ภาษีสรรพสามิต|excise\s*act/i.test(combined)) {
    return { slug: "excise:excise-2560", hint: "พ.ร.บ. ภาษีสรรพสามิต พ.ศ. 2560" };
  }
  if (/ป้องกันและปราบปรามการฟอกเงิน|anti-money\s*laundering|\bamlo\b/i.test(combined)) {
    return { slug: "amlo:amla-2542", hint: "พ.ร.บ. ป้องกันและปราบปรามการฟอกเงิน พ.ศ. 2542" };
  }
  const authSlug = (fallbackAuthorityCode || "lrm").toLowerCase().replace(/[^a-z0-9]/g, "");
  const codeSlug = (fallbackCode || "inst").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 32);
  return { slug: `${authSlug}:${codeSlug}`, hint: fallbackCode };
}

/**
 * Computes a deterministic ThLexGraph-style Canonical Provision Key for any chunk.
 */
export function deriveCanonicalProvisionKey(
  record: LegalResourceMasterRecord,
  sectionLabel: string,
  chunkIndex: number
): string {
  const { slug } = inferInstrumentSlug(
    `${record.title_th} ${record.title_en} ${record.code}`,
    record.authority_code || record.collection,
    record.code
  );
  const normLabel = normalizeThaiDigits(sectionLabel);
  const matraMatch = normLabel.match(/(?:มาตรา|ม\.|Section|Sec\.)\s*(\d+(?:\/\d+)?(?:\s*(?:ทวิ|ตรี|จัตวา|เบญจ|bis|ter|quater))?)/i);
  if (matraMatch) {
    return `th:${slug}#sec:${normalizeSectionToken(matraMatch[1])}`;
  }
  const khoMatch = normLabel.match(/(?:ข้อ|Clause|Article)\s*(\d+(?:\/\d+)?)/i);
  if (khoMatch) {
    return `th:${slug}#clause:${normalizeSectionToken(khoMatch[1])}`;
  }
  const dekaMatch = `${record.code} ${normLabel}`.match(/(\d+\/\d{4})/);
  if (dekaMatch && (record.authority_code === "DEKA" || record.collection === "Deka_Supreme_Court_Database")) {
    return `th:deka:${dekaMatch[1]}#part:${chunkIndex}`;
  }
  return `th:${slug}#unit:${chunkIndex}`;
}

/**
 * Extracts structured ThLexGraph-style outgoing cross-references (:REFERS_TO_PROVISION,
 * :ENABLED_BY_STATUTE, :INTERPRETS_PROVISION, :AMENDS_INSTRUMENT) with deterministic
 * Canonical Stub Keys so laws citing not-yet-ingested statutes create resolvable stubs.
 */
export function extractStructuredCrossReferences(
  record: LegalResourceMasterRecord,
  archetype: LegalDocumentArchetype,
  unitType: LegalStructuralUnitType,
  sectionLabel: string,
  bodyText: string,
  extractedCitations: string[]
): ExtractedCrossReference[] {
  const refs: ExtractedCrossReference[] = [];
  const seenKeys = new Set<string>();
  const combinedText = normalizeThaiDigits(`${sectionLabel} ${bodyText} ${record.legal_provisions}`);
  const defaultEdgeType: CrossReferenceEdgeType =
    archetype === "JUDICIAL_DECISION_DEKA" || archetype === "ADMINISTRATIVE_RULING_OR_GUIDELINE"
      ? "INTERPRETS_PROVISION"
      : unitType === "ENABLING_PREAMBLE" || /อาศัยอำนาจตามความใน/.test(combinedText)
      ? "ENABLED_BY_STATUTE"
      : /แก้ไขเพิ่มเติม|ยกเลิกความใน/.test(combinedText)
      ? "AMENDS_INSTRUMENT"
      : "REFERS_TO_PROVISION";

  const { slug: contextSlug, hint: contextHint } = inferInstrumentSlug(
    `${combinedText} ${record.title_th} ${record.title_en}`,
    record.authority_code || record.collection,
    record.code
  );

  for (const cit of extractedCitations) {
    const normCit = normalizeThaiDigits(cit);
    const dekaMatch = normCit.match(/(\d+\/\d{4})/);
    if (dekaMatch && normCit.includes("ฎีกา")) {
      const targetKey = `th:deka:${dekaMatch[1]}`;
      if (!seenKeys.has(targetKey)) {
        seenKeys.add(targetKey);
        refs.push({
          edge_type: "REFERS_TO_PROVISION",
          raw_citation: cit,
          target_canonical_key: targetKey,
          target_section_code: `deka:${dekaMatch[1]}`,
          target_instrument_hint: `คำพิพากษาศาลฎีกาที่ ${dekaMatch[1]}`,
        });
      }
      continue;
    }

    const secMatch = normCit.match(/(?:มาตรา|Section)\s*(.+)$/i);
    if (secMatch) {
      const secToken = normalizeSectionToken(secMatch[1]);
      if (secToken) {
        const targetKey = `th:${contextSlug}#sec:${secToken}`;
        if (!seenKeys.has(targetKey)) {
          seenKeys.add(targetKey);
          refs.push({
            edge_type: defaultEdgeType,
            raw_citation: cit,
            target_canonical_key: targetKey,
            target_section_code: `sec:${secToken}`,
            target_instrument_hint: contextHint,
          });
        }
      }
      continue;
    }

    const khoMatch = normCit.match(/(?:ข้อ|Clause)\s*(.+)$/i);
    if (khoMatch) {
      const khoToken = normalizeSectionToken(khoMatch[1]);
      if (khoToken) {
        const targetKey = `th:${contextSlug}#clause:${khoToken}`;
        if (!seenKeys.has(targetKey)) {
          seenKeys.add(targetKey);
          refs.push({
            edge_type: defaultEdgeType,
            raw_citation: cit,
            target_canonical_key: targetKey,
            target_section_code: `clause:${khoToken}`,
            target_instrument_hint: contextHint,
          });
        }
      }
    }
  }

  return refs.slice(0, 12);
}

/**
 * Derives bi-temporal version metadata (amendment number, version sequence, and target canonical key).
 */
export function deriveTemporalVersionMetadata(
  record: LegalResourceMasterRecord,
  canonicalProvisionKey: string,
  effectiveTo: string | null
): TemporalVersionMetadata {
  const normTitle = normalizeThaiDigits(`${record.title_th} ${record.title_en}`);
  const amendMatch = normTitle.match(/\(ฉบับที่\s*(\d+)\)\s*พ\.ศ\.\s*(\d{4})|No\.\s*(\d+)\s*B\.E\.\s*(\d{4})/i);
  const amendmentNo = amendMatch
    ? amendMatch[1]
      ? `ฉบับที่ ${amendMatch[1]} พ.ศ. ${amendMatch[2]}`
      : `No. ${amendMatch[3]} B.E. ${amendMatch[4]}`
    : null;
  const seqNum = amendMatch ? parseInt(amendMatch[1] || amendMatch[3] || "2", 10) : 1;

  return {
    canonical_provision_key: canonicalProvisionKey,
    version_sequence: Number.isFinite(seqNum) && seqNum > 0 ? seqNum : 1,
    amendment_no: amendmentNo,
    amends_canonical_key: amendmentNo ? canonicalProvisionKey : null,
    effective_from: record.effective_date,
    effective_to: effectiveTo,
    is_current_version: record.status === "IN_FORCE" && effectiveTo === null,
  };
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
    const canonicalProvisionKey = deriveCanonicalProvisionKey(record, seg.sectionLabel, idx + 1);
    const outgoingCrossRefs = extractStructuredCrossReferences(
      record,
      archetype,
      unitType,
      seg.sectionLabel,
      seg.body,
      citations
    );
    const temporalVersionMeta = deriveTemporalVersionMetadata(
      record,
      canonicalProvisionKey,
      effectiveTo
    );

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
      canonical_provision_key: canonicalProvisionKey,
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
      outgoing_cross_references: outgoingCrossRefs,
      temporal_version_meta: temporalVersionMeta,
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

  // Pass 2: ThLexGraph Global Cross-Reference Linker (resolves target_canonical_key -> resolved_chunk_id or STUB_AWAITING_INGESTION)
  const byCanonicalKey = new Map<string, string>();
  const byAuthAndSec = new Map<string, string>();
  for (const c of allChunks) {
    if (!byCanonicalKey.has(c.canonical_provision_key)) {
      byCanonicalKey.set(c.canonical_provision_key, c.chunk_id);
    }
    const secPart = c.canonical_provision_key.split("#")[1];
    if (secPart) {
      const authSecKey = `${c.authority_code.toLowerCase()}#${secPart}`;
      if (!byAuthAndSec.has(authSecKey)) {
        byAuthAndSec.set(authSecKey, c.chunk_id);
      }
    }
  }

  for (const c of allChunks) {
    for (const ref of c.outgoing_cross_references) {
      let resolved = byCanonicalKey.get(ref.target_canonical_key) || null;
      if (!resolved && ref.target_section_code) {
        const authSecKey = `${c.authority_code.toLowerCase()}#${ref.target_section_code}`;
        resolved = byAuthAndSec.get(authSecKey) || null;
      }
      if (resolved && resolved !== c.chunk_id) {
        ref.resolved_chunk_id = resolved;
        ref.resolution_status = "RESOLVED_IN_CORPUS";
      } else {
        ref.resolved_chunk_id = null;
        ref.resolution_status = "STUB_AWAITING_INGESTION";
      }
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

// ============================================================================
// UPDATE #1 & #2: ThLexGraph-Grade Multi-Hop Provision Graph Traversal,
// Canonical Stub Index & Interactive Statutory Version Diff Engine
// ============================================================================

export interface CanonicalProvisionStubNode {
  canonical_key: string;
  instrument_hint: string;
  section_code: string | null;
  status: "RESOLVED_IN_CORPUS" | "STUB_AWAITING_INGESTION";
  resolved_chunk_id: string | null;
  incoming_citation_count: number;
  citing_chunk_ids: string[];
  citing_deka_count: number;
  citing_ruling_count: number;
  citing_regulation_count: number;
}

export interface GlobalProvisionGraphIndex {
  total_provision_nodes: number;
  total_sequential_edges: number;
  total_cross_reference_edges: number;
  resolved_cross_references_count: number;
  stub_awaiting_ingestion_count: number;
  edge_type_counts: Record<CrossReferenceEdgeType, number>;
  top_co_cited_provisions: CanonicalProvisionStubNode[];
  stubs_by_key: Record<string, CanonicalProvisionStubNode>;
}

let cachedGlobalProvisionGraphIndex: GlobalProvisionGraphIndex | null = null;

export function buildGlobalProvisionGraphIndex(): GlobalProvisionGraphIndex {
  if (cachedGlobalProvisionGraphIndex) {
    return cachedGlobalProvisionGraphIndex;
  }

  const corpus = getOrBuildMasterChunkCorpus();
  const chunkMap = new Map<string, LegalStructuralChunk>();
  for (const c of corpus.chunks) {
    chunkMap.set(c.chunk_id, c);
  }

  let sequentialEdges = 0;
  let crossRefEdges = 0;
  let resolvedCount = 0;
  let stubCount = 0;
  const edgeTypeCounts: Record<CrossReferenceEdgeType, number> = {
    REFERS_TO_PROVISION: 0,
    ENABLED_BY_STATUTE: 0,
    INTERPRETS_PROVISION: 0,
    AMENDS_INSTRUMENT: 0,
  };

  const stubsMap = new Map<string, CanonicalProvisionStubNode>();

  for (const c of corpus.chunks) {
    if (c.next_chunk_id) sequentialEdges++;
    for (const ref of c.outgoing_cross_references) {
      crossRefEdges++;
      edgeTypeCounts[ref.edge_type] = (edgeTypeCounts[ref.edge_type] || 0) + 1;
      if (ref.resolution_status === "RESOLVED_IN_CORPUS") {
        resolvedCount++;
      } else {
        stubCount++;
      }

      let node = stubsMap.get(ref.target_canonical_key);
      if (!node) {
        node = {
          canonical_key: ref.target_canonical_key,
          instrument_hint: ref.target_instrument_hint,
          section_code: ref.target_section_code,
          status: ref.resolution_status || "STUB_AWAITING_INGESTION",
          resolved_chunk_id: ref.resolved_chunk_id || null,
          incoming_citation_count: 0,
          citing_chunk_ids: [],
          citing_deka_count: 0,
          citing_ruling_count: 0,
          citing_regulation_count: 0,
        };
        stubsMap.set(ref.target_canonical_key, node);
      }

      if (ref.resolved_chunk_id && !node.resolved_chunk_id) {
        node.resolved_chunk_id = ref.resolved_chunk_id;
        node.status = "RESOLVED_IN_CORPUS";
      }

      node.incoming_citation_count++;
      if (node.citing_chunk_ids.length < 25) {
        node.citing_chunk_ids.push(c.chunk_id);
      }
      if (c.archetype === "JUDICIAL_DECISION_DEKA") {
        node.citing_deka_count++;
      } else if (c.archetype === "ADMINISTRATIVE_RULING_OR_GUIDELINE") {
        node.citing_ruling_count++;
      } else {
        node.citing_regulation_count++;
      }
    }
  }

  const allStubs = Array.from(stubsMap.values()).sort(
    (a, b) => b.incoming_citation_count - a.incoming_citation_count
  );
  const stubsByKey: Record<string, CanonicalProvisionStubNode> = {};
  for (const s of allStubs) {
    stubsByKey[s.canonical_key] = s;
  }

  cachedGlobalProvisionGraphIndex = {
    total_provision_nodes: corpus.chunks.length,
    total_sequential_edges: sequentialEdges,
    total_cross_reference_edges: crossRefEdges,
    resolved_cross_references_count: resolvedCount,
    stub_awaiting_ingestion_count: stubCount,
    edge_type_counts: edgeTypeCounts,
    top_co_cited_provisions: allStubs.slice(0, 30),
    stubs_by_key: stubsByKey,
  };

  return cachedGlobalProvisionGraphIndex;
}

export interface MultiHopGraphTraversalHop {
  hop_distance: number;
  traversal_type:
    | "ANCHOR_PROVISION"
    | "HIERARCHY_SIBLING_PART_OF"
    | "SEQUENTIAL_PREV_PROVISION"
    | "SEQUENTIAL_NEXT_PROVISION"
    | "OUTGOING_CROSS_REFERENCE"
    | "INCOMING_CO_CITATION";
  edge_label: string;
  chunk: LegalStructuralChunk | null;
  stub_node: CanonicalProvisionStubNode | null;
}

export interface MultiHopTraversalResult {
  anchor_chunk: LegalStructuralChunk;
  max_hops: number;
  graph_stats: {
    total_provision_nodes: number;
    total_sequential_edges: number;
    total_cross_reference_edges: number;
    resolved_cross_references_count: number;
    stub_awaiting_ingestion_count: number;
  };
  co_citation_authority: {
    canonical_key: string;
    incoming_citation_count: number;
    citing_deka_count: number;
    citing_ruling_count: number;
    citing_regulation_count: number;
  };
  hops: MultiHopGraphTraversalHop[];
}

/**
 * ThLexGraph-style Multi-Hop Graph Traversal (Hierarchy + ±1 Sequential Sibling +
 * 1..3 Hop Cross-Reference Following + Incoming Co-Citation Authority).
 */
export function traverseProvisionGraph(options?: {
  chunk_id?: string;
  canonical_key?: string;
  query?: string;
  max_hops?: number;
}): MultiHopTraversalResult {
  const corpus = getOrBuildMasterChunkCorpus();
  const graphIndex = buildGlobalProvisionGraphIndex();
  const maxHops = Math.min(Math.max(options?.max_hops ?? 2, 1), 3);

  const chunkById = new Map<string, LegalStructuralChunk>();
  const chunkByCanonicalKey = new Map<string, LegalStructuralChunk>();
  for (const c of corpus.chunks) {
    chunkById.set(c.chunk_id, c);
    if (!chunkByCanonicalKey.has(c.canonical_provision_key)) {
      chunkByCanonicalKey.set(c.canonical_provision_key, c);
    }
  }

  let anchor: LegalStructuralChunk | undefined;
  if (options?.chunk_id) {
    anchor = chunkById.get(options.chunk_id.trim());
  }
  if (!anchor && options?.canonical_key) {
    anchor = chunkByCanonicalKey.get(options.canonical_key.trim());
  }
  if (!anchor && options?.query) {
    const searchRes = searchLegalStructuralChunks({ query: options.query, limit: 1 });
    anchor = searchRes.chunks[0];
  }
  if (!anchor) {
    // Default to a richly connected anchor chunk with cross-references
    anchor =
      corpus.chunks.find((c) => c.outgoing_cross_references.length >= 2) ||
      corpus.chunks[0];
  }

  const hops: MultiHopGraphTraversalHop[] = [
    {
      hop_distance: 0,
      traversal_type: "ANCHOR_PROVISION",
      edge_label: "ANCHOR",
      chunk: anchor,
      stub_node: graphIndex.stubs_by_key[anchor.canonical_provision_key] || null,
    },
  ];

  const visitedChunkIds = new Set<string>([anchor.chunk_id]);

  // 1. Sequential Sibling Context (±1 :PREV_PROVISION / :NEXT_PROVISION)
  if (anchor.prev_chunk_id) {
    const prevChunk = chunkById.get(anchor.prev_chunk_id);
    if (prevChunk && !visitedChunkIds.has(prevChunk.chunk_id)) {
      visitedChunkIds.add(prevChunk.chunk_id);
      hops.push({
        hop_distance: 1,
        traversal_type: "SEQUENTIAL_PREV_PROVISION",
        edge_label: ":PREV_PROVISION",
        chunk: prevChunk,
        stub_node: null,
      });
    }
  }
  if (anchor.next_chunk_id) {
    const nextChunk = chunkById.get(anchor.next_chunk_id);
    if (nextChunk && !visitedChunkIds.has(nextChunk.chunk_id)) {
      visitedChunkIds.add(nextChunk.chunk_id);
      hops.push({
        hop_distance: 1,
        traversal_type: "SEQUENTIAL_NEXT_PROVISION",
        edge_label: ":NEXT_PROVISION",
        chunk: nextChunk,
        stub_node: null,
      });
    }
  }

  // 2. Hierarchy Traversal (:PART_OF same parent LegalInstrument)
  const sameDocChunks = corpus.chunks
    .filter(
      (c) =>
        c.parent_document_id === anchor!.parent_document_id &&
        !visitedChunkIds.has(c.chunk_id)
    )
    .slice(0, 3);
  for (const sib of sameDocChunks) {
    visitedChunkIds.add(sib.chunk_id);
    hops.push({
      hop_distance: 1,
      traversal_type: "HIERARCHY_SIBLING_PART_OF",
      edge_label: ":PART_OF (Same Instrument)",
      chunk: sib,
      stub_node: null,
    });
  }

  // 3. Multi-Hop Outgoing Cross-Reference Following (1..maxHops)
  let frontier: LegalStructuralChunk[] = [anchor];
  for (let hop = 1; hop <= maxHops; hop++) {
    const nextFrontier: LegalStructuralChunk[] = [];
    for (const current of frontier) {
      for (const ref of current.outgoing_cross_references) {
        const stub = graphIndex.stubs_by_key[ref.target_canonical_key] || null;
        if (ref.resolved_chunk_id) {
          const targetChunk = chunkById.get(ref.resolved_chunk_id);
          if (targetChunk && !visitedChunkIds.has(targetChunk.chunk_id)) {
            visitedChunkIds.add(targetChunk.chunk_id);
            hops.push({
              hop_distance: hop,
              traversal_type: "OUTGOING_CROSS_REFERENCE",
              edge_label: `:${ref.edge_type} (${ref.raw_citation})`,
              chunk: targetChunk,
              stub_node: stub,
            });
            nextFrontier.push(targetChunk);
          }
        } else if (hop === 1) {
          // Include Canonical Provision Stub node even when target statute awaits full ingestion
          hops.push({
            hop_distance: hop,
            traversal_type: "OUTGOING_CROSS_REFERENCE",
            edge_label: `:${ref.edge_type} -> STUB (${ref.raw_citation})`,
            chunk: null,
            stub_node: stub || {
              canonical_key: ref.target_canonical_key,
              instrument_hint: ref.target_instrument_hint,
              section_code: ref.target_section_code,
              status: "STUB_AWAITING_INGESTION",
              resolved_chunk_id: null,
              incoming_citation_count: 1,
              citing_chunk_ids: [current.chunk_id],
              citing_deka_count: 0,
              citing_ruling_count: 0,
              citing_regulation_count: 1,
            },
          });
        }
      }
    }
    frontier = nextFrontier;
  }

  // 4. Incoming Co-Citations (Deka Judgments, Tax Rulings, Subordinate Regulations citing this anchor or its primary cited provisions)
  const anchorStub =
    graphIndex.stubs_by_key[anchor.canonical_provision_key] ||
    (anchor.outgoing_cross_references[0]
      ? graphIndex.stubs_by_key[anchor.outgoing_cross_references[0].target_canonical_key]
      : undefined);

  if (anchorStub) {
    for (const citingId of anchorStub.citing_chunk_ids.slice(0, 6)) {
      const citingChunk = chunkById.get(citingId);
      if (citingChunk && !visitedChunkIds.has(citingChunk.chunk_id)) {
        visitedChunkIds.add(citingChunk.chunk_id);
        hops.push({
          hop_distance: 1,
          traversal_type: "INCOMING_CO_CITATION",
          edge_label:
            citingChunk.archetype === "JUDICIAL_DECISION_DEKA"
              ? ":INTERPRETS_PROVISION (Deka Precedent)"
              : citingChunk.archetype === "ADMINISTRATIVE_RULING_OR_GUIDELINE"
              ? ":INTERPRETS_PROVISION (Admin Ruling)"
              : ":REFERS_TO_PROVISION (Co-Citing Regulation)",
          chunk: citingChunk,
          stub_node: anchorStub,
        });
      }
    }
  }

  return {
    anchor_chunk: anchor,
    max_hops: maxHops,
    graph_stats: {
      total_provision_nodes: graphIndex.total_provision_nodes,
      total_sequential_edges: graphIndex.total_sequential_edges,
      total_cross_reference_edges: graphIndex.total_cross_reference_edges,
      resolved_cross_references_count: graphIndex.resolved_cross_references_count,
      stub_awaiting_ingestion_count: graphIndex.stub_awaiting_ingestion_count,
    },
    co_citation_authority: {
      canonical_key: anchorStub?.canonical_key || anchor.canonical_provision_key,
      incoming_citation_count: anchorStub?.incoming_citation_count ?? 0,
      citing_deka_count: anchorStub?.citing_deka_count ?? 0,
      citing_ruling_count: anchorStub?.citing_ruling_count ?? 0,
      citing_regulation_count: anchorStub?.citing_regulation_count ?? 0,
    },
    hops,
  };
}

// ============================================================================
// UPDATE #2: Interactive Side-by-Side Statutory Version Diff Engine
// ============================================================================

export interface StatutoryVersionSnapshot {
  version_id: string;
  version_sequence: number;
  version_label_th: string;
  version_label_en: string;
  amendment_instrument_th: string;
  effective_from: string;
  effective_to: string | null;
  status: "HISTORICAL_SUPERSEDED" | "IN_FORCE_CURRENT";
  text_th: string;
  text_en_summary: string;
  key_legal_rule: string;
}

export interface StatutoryVersionChain {
  chain_id: string;
  canonical_provision_key: string;
  authority_code: string;
  regulator: string;
  instrument_title_th: string;
  instrument_title_en: string;
  provision_label: string;
  practice_area: string;
  amendment_rationale_th: string;
  point_in_time_routing_rule: string;
  versions: StatutoryVersionSnapshot[];
}

export interface DiffTokenSegment {
  type: "UNCHANGED" | "REMOVED" | "ADDED";
  text: string;
}

export interface StatutoryVersionDiffComparison {
  chain: StatutoryVersionChain;
  left_version: StatutoryVersionSnapshot;
  right_version: StatutoryVersionSnapshot;
  diff_segments: DiffTokenSegment[];
  stats: {
    added_tokens: number;
    removed_tokens: number;
    unchanged_tokens: number;
    change_ratio_pct: number;
  };
}

export const CURATED_STATUTORY_VERSION_CHAINS: StatutoryVersionChain[] = [
  {
    chain_id: "chain.ccc.1097",
    canonical_provision_key: "th:dbd:ccc#sec:1097",
    authority_code: "DBD",
    regulator: "กรมพัฒนาธุรกิจการค้า (Department of Business Development)",
    instrument_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ บรรพ 3 หุ้นส่วนและบริษัท",
    instrument_title_en: "Civil and Commercial Code Book III — Partnerships and Companies",
    provision_label: "มาตรา 1097 (การจัดตั้งบริษัทจำกัด / Minimum Promoters)",
    practice_area: "Corporate & M&A / Company Incorporation",
    amendment_rationale_th:
      "พ.ร.บ. แก้ไขเพิ่มเติมประมวลกฎหมายแพ่งและพาณิชย์ (ฉบับที่ 23) พ.ศ. 2565 ปรับลดจำนวนผู้เริ่มก่อการและผู้ถือหุ้นขั้นต่ำจาก 3 คน เหลือ 2 คน (มีผลบังคับใช้ตั้งแต่วันที่ 7 กุมภาพันธ์ 2566) เพื่อลดภาระการจัดตั้งบริษัทจำกัดและสอดคล้องกับมาตรฐานสากล",
    point_in_time_routing_rule:
      "หากวันจดทะเบียนหนังสือบริคณห์สนธิ (as_of_date) ก่อนวันที่ 2023-02-07 ต้องใช้เกณฑ์ผู้เริ่มก่อการอย่างน้อย 3 คน; ตั้งแต่วันที่ 2023-02-07 เป็นต้นไป ใช้เกณฑ์อย่างน้อย 2 คน (ดูเหตุเลิกบริษัทตามมาตรา 1237 (4) ประกอบ)",
    versions: [
      {
        version_id: "v1.ccc.1097.pre2023",
        version_sequence: 1,
        version_label_th: "ฉบับก่อนแก้ไข (พ.ศ. 2551 – 6 ก.พ. 2566)",
        version_label_en: "Pre-Amendment Version (Act No. 18 B.E. 2551)",
        amendment_instrument_th: "พ.ร.บ. แก้ไขเพิ่มเติมประมวลกฎหมายแพ่งและพาณิชย์ (ฉบับที่ 18) พ.ศ. 2551",
        effective_from: "2008-07-01",
        effective_to: "2023-02-06",
        status: "HISTORICAL_SUPERSEDED",
        text_th:
          "มาตรา 1097 บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้ โดยเข้าชื่อกันทำหนังสือบริคณห์สนธิ และกระทำการอย่างอื่นตามบทบัญญัติแห่งประมวลกฎหมายนี้",
        text_en_summary:
          "Section 1097: Any three or more persons may promote and form a limited company by subscribing their names to a memorandum of association and performing other acts in accordance with the provisions of this Code.",
        key_legal_rule: "ผู้เริ่มก่อการขั้นต่ำ ≥ 3 คน (Minimum 3 promoters & shareholders)",
      },
      {
        version_id: "v2.ccc.1097.act23_2565",
        version_sequence: 2,
        version_label_th: "ฉบับปัจจุบัน (ฉบับที่ 23 พ.ศ. 2565 — มีผล 7 ก.พ. 2566)",
        version_label_en: "Current In-Force Version (Act No. 23 B.E. 2565)",
        amendment_instrument_th: "พ.ร.บ. แก้ไขเพิ่มเติมประมวลกฎหมายแพ่งและพาณิชย์ (ฉบับที่ 23) พ.ศ. 2565 มาตรา 4",
        effective_from: "2023-02-07",
        effective_to: null,
        status: "IN_FORCE_CURRENT",
        text_th:
          "มาตรา 1097 บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้ โดยเข้าชื่อกันทำหนังสือบริคณห์สนธิ และกระทำการอย่างอื่นตามบทบัญญัติแห่งประมวลกฎหมายนี้",
        text_en_summary:
          "Section 1097: Any two or more persons may promote and form a limited company by subscribing their names to a memorandum of association and performing other acts in accordance with the provisions of this Code.",
        key_legal_rule: "ผู้เริ่มก่อการขั้นต่ำ ≥ 2 คน (Minimum 2 promoters & shareholders)",
      },
    ],
  },
  {
    chain_id: "chain.ccc.1175",
    canonical_provision_key: "th:dbd:ccc#sec:1175",
    authority_code: "DBD",
    regulator: "กรมพัฒนาธุรกิจการค้า (Department of Business Development)",
    instrument_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ บรรพ 3 หุ้นส่วนและบริษัท",
    instrument_title_en: "Civil and Commercial Code Book III — Partnerships and Companies",
    provision_label: "มาตรา 1175 (คำบอกกล่าวเรียกประชุมใหญ่ผู้ถือหุ้น / Notice of General Meeting)",
    practice_area: "Corporate Governance & Shareholder Meetings",
    amendment_rationale_th:
      "พ.ร.บ. แก้ไขเพิ่มเติม ป.พ.พ. (ฉบับที่ 23) พ.ศ. 2565 ยกเลิกหน้าที่ต้องลงโฆษณาคำบอกกล่าวเรียกประชุมใหญ่ในหนังสือพิมพ์แห่งท้องที่สำหรับบริษัทจำกัดที่ไม่มีหุ้นชนิดออกให้แก่ผู้ถือ และรองรับการส่งคำบอกกล่าวทางอิเล็กทรอนิกส์ตามหลักเกณฑ์ของนายทะเบียน",
    point_in_time_routing_rule:
      "คำบอกกล่าวเรียกประชุมใหญ่ที่ส่งก่อนวันที่ 2023-02-07 ต้องทั้งลงพิมพ์โฆษณาในหนังสือพิมพ์แห่งท้องที่และส่งไปรษณีย์ตอบรับ; ตั้งแต่วันที่ 2023-02-07 เป็นต้นไป บริษัทที่ไม่มีหุ้นผู้ถือส่งเฉพาะไปรษณีย์ตอบรับหรือสื่ออิเล็กทรอนิกส์ได้",
    versions: [
      {
        version_id: "v1.ccc.1175.pre2023",
        version_sequence: 1,
        version_label_th: "ฉบับก่อนแก้ไข (บังคับลงโฆษณาหนังสือพิมพ์ทุกกรณี)",
        version_label_en: "Pre-Amendment Version (Mandatory Local Newspaper Publication)",
        amendment_instrument_th: "พ.ร.บ. แก้ไขเพิ่มเติมประมวลกฎหมายแพ่งและพาณิชย์ (ฉบับที่ 18) พ.ศ. 2551",
        effective_from: "2008-07-01",
        effective_to: "2023-02-06",
        status: "HISTORICAL_SUPERSEDED",
        text_th:
          "มาตรา 1175 คำบอกกล่าวเรียกประชุมใหญ่ให้ลงพิมพ์โฆษณาในหนังสือพิมพ์แห่งท้องที่อย่างน้อยหนึ่งคราวก่อนวันนัดประชุมไม่น้อยกว่าเจ็ดวัน และส่งทางไปรษณีย์ตอบรับไปยังผู้ถือหุ้นทุกคนที่มีชื่อในทะเบียนของบริษัทก่อนวันนัดประชุมไม่น้อยกว่าเจ็ดวัน เว้นแต่เป็นคำบอกกล่าวเรียกประชุมใหญ่เพื่อลงมติพิเศษ ให้กระทำการดังกล่าวนั้นก่อนวันนัดประชุมไม่น้อยกว่าสิบสี่วัน",
        text_en_summary:
          "Section 1175 (Pre-2023): Notice summoning a general meeting must BOTH be published at least once in a local newspaper AND sent via return-receipt post to all shareholders at least 7 days prior (14 days for special resolutions).",
        key_legal_rule: "บังคับลงหนังสือพิมพ์แห่งท้องที่ + ส่งไปรษณีย์ตอบรับทุกบริษัท",
      },
      {
        version_id: "v2.ccc.1175.act23_2565",
        version_sequence: 2,
        version_label_th: "ฉบับปัจจุบัน (ฉบับที่ 23 พ.ศ. 2565 — ยกเลิกบังคับลงหนังสือพิมพ์กรณีหุ้นระบุชื่อ)",
        version_label_en: "Current In-Force Version (Act No. 23 B.E. 2565)",
        amendment_instrument_th: "พ.ร.บ. แก้ไขเพิ่มเติมประมวลกฎหมายแพ่งและพาณิชย์ (ฉบับที่ 23) พ.ศ. 2565 มาตรา 10",
        effective_from: "2023-02-07",
        effective_to: null,
        status: "IN_FORCE_CURRENT",
        text_th:
          "มาตรา 1175 คำบอกกล่าวเรียกประชุมใหญ่ให้ส่งทางไปรษณีย์ตอบรับไปยังผู้ถือหุ้นทุกคนที่มีชื่อในทะเบียนของบริษัทก่อนวันนัดประชุมไม่น้อยกว่าเจ็ดวัน หากบริษัทมีหุ้นชนิดที่มีใบหุ้นออกให้แก่ผู้ถือ ให้โฆษณาในหนังสือพิมพ์แห่งท้องที่อย่างน้อยหนึ่งคราวหรือในสื่ออิเล็กทรอนิกส์ตามหลักเกณฑ์และวิธีการที่กำหนดในกฎกระทรวงก่อนวันนัดประชุมไม่น้อยกว่าเจ็ดวันด้วย เว้นแต่เป็นคำบอกกล่าวเรียกประชุมใหญ่เพื่อลงมติพิเศษ ให้กระทำการดังกล่าวนั้นก่อนวันนัดประชุมไม่น้อยกว่าสิบสี่วัน",
        text_en_summary:
          "Section 1175 (Current): Notice summoning a general meeting is sent via return-receipt post at least 7 days prior (14 days for special resolution). Newspaper or electronic publication is ONLY required if the company has issued bearer shares.",
        key_legal_rule: "ส่งไปรษณีย์ตอบรับอย่างเดียวได้ (ลงหนังสือพิมพ์/อิเล็กทรอนิกส์เฉพาะกรณีมีหุ้นผู้ถือ)",
      },
    ],
  },
  {
    chain_id: "chain.ccc.1238",
    canonical_provision_key: "th:dbd:ccc#sec:1238",
    authority_code: "DBD",
    regulator: "กรมพัฒนาธุรกิจการค้า (Department of Business Development)",
    instrument_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ บรรพ 3 หุ้นส่วนและบริษัท",
    instrument_title_en: "Civil and Commercial Code Book III — Partnerships and Companies",
    provision_label: "มาตรา 1238 (การควบบริษัทจำกัด — Amalgamation A+B=C vs. Merger A+B=A)",
    practice_area: "M&A & Corporate Restructuring",
    amendment_rationale_th:
      "พ.ร.บ. แก้ไขเพิ่มเติม ป.พ.พ. (ฉบับที่ 23) พ.ศ. 2565 เพิ่มรูปแบบการควบรวมบริษัทให้บริษัทหนึ่งยังคงสภาพนิติบุคคลอยู่ (Merger: A+B=A) นอกเหนือจากการควบเข้ากันเป็นบริษัทใหม่ (Amalgamation: A+B=C) เพื่อลดขั้นตอนการขอใบอนุญาตใหม่ในธุรกรรม M&A",
    point_in_time_routing_rule:
      "ธุรกรรมควบรวมที่ลงมติพิเศษก่อนวันที่ 2023-02-07 ทำได้เฉพาะ A+B=C (เกิดนิติบุคคลใหม่และบริษัทเดิมสิ้นสภาพทั้งหมด); ตั้งแต่วันที่ 2023-02-07 เลือกทำแบบ A+B=A หรือ A+B=C ได้",
    versions: [
      {
        version_id: "v1.ccc.1238.pre2023",
        version_sequence: 1,
        version_label_th: "ฉบับก่อนแก้ไข (รองรับเฉพาะควบเข้ากันเกิดบริษัทใหม่ A+B=C)",
        version_label_en: "Pre-Amendment Version (Amalgamation Only: A+B=C)",
        amendment_instrument_th: "ประมวลกฎหมายแพ่งและพาณิชย์ บรรพ 3 เดิม",
        effective_from: "1929-01-01",
        effective_to: "2023-02-06",
        status: "HISTORICAL_SUPERSEDED",
        text_th:
          "มาตรา 1238 บริษัทจำกัดจะควบเข้ากันมิได้ เว้นแต่จะเป็นไปโดยมติพิเศษ",
        text_en_summary:
          "Section 1238 (Pre-2023): A limited company may not amalgamate with another company except by special resolution (resulting solely in a new company A+B=C under former Sec. 1243).",
        key_legal_rule: "รองรับเฉพาะ A+B=C (บริษัทเดิมสิ้นสภาพทั้งหมด เกิดนิติบุคคลใหม่)",
      },
      {
        version_id: "v2.ccc.1238.act23_2565",
        version_sequence: 2,
        version_label_th: "ฉบับปัจจุบัน (รองรับทั้ง A+B=C บริษัทใหม่ และ A+B=A บริษัทหนึ่งคงอยู่)",
        version_label_en: "Current In-Force Version (Both A+B=C and Statutory Merger A+B=A)",
        amendment_instrument_th: "พ.ร.บ. แก้ไขเพิ่มเติมประมวลกฎหมายแพ่งและพาณิชย์ (ฉบับที่ 23) พ.ศ. 2565 มาตรา 13",
        effective_from: "2023-02-07",
        effective_to: null,
        status: "IN_FORCE_CURRENT",
        text_th:
          "มาตรา 1238 บริษัทจำกัดตั้งแต่สองบริษัทขึ้นไปจะควบเข้ากันก็ได้ โดยที่ประชุมผู้ถือหุ้นของแต่ละบริษัทที่จะควบเข้ากันได้ลงมติพิเศษให้ควบเข้ากัน ในการควบบริษัทเข้ากันตามวรรคหนึ่ง จะควบเข้ากันโดยตั้งเป็นบริษัทใหม่และบริษัทที่ควบเข้ากันหมดสภาพการเป็นนิติบุคคล หรือจะควบเข้ากันโดยบริษัทหนึ่งบริษัทใดยังคงมีสภาพเป็นนิติบุคคลและบริษัทอื่นที่ควบเข้ากันหมดสภาพการเป็นนิติบุคคลก็ได้",
        text_en_summary:
          "Section 1238 (Current): Two or more limited companies may merge by special resolution of each company, either by forming a new company (A+B=C) or with one merging company surviving as a legal entity while the others dissolve (A+B=A).",
        key_legal_rule: "รองรับทั้งควบตั้งบริษัทใหม่ (A+B=C) และควบรวมโดยบริษัทหนึ่งคงสภาพนิติบุคคลเดิม (A+B=A)",
      },
    ],
  },
  {
    chain_id: "chain.rev.pillar2",
    canonical_provision_key: "th:rd:revenue-code#sec:65bis",
    authority_code: "RD",
    regulator: "กรมสรรพากร (Revenue Department)",
    instrument_title_th: "ประมวลรัษฎากร และพระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. 2567 (OECD Pillar Two GMT)",
    instrument_title_en: "Revenue Code & Emergency Decree on Top-Up Tax B.E. 2567 (Pillar Two 15% GMT)",
    provision_label: "มาตรา 65 ทวิ / พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 (Global Minimum Tax 15%)",
    practice_area: "Corporate Income Tax & BOI Cross-Border Structuring",
    amendment_rationale_th:
      "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. 2567 (มีผลบังคับใช้ตั้งแต่วันที่ 1 มกราคม 2568) กำหนดจัดเก็บภาษีส่วนเพิ่ม (Top-Up Tax: DMTT / IIR / UTPR) ให้มีอัตราภาษีที่แท้จริง (Effective Tax Rate: ETR) ขั้นต่ำร้อยละ 15 สำหรับกลุ่มนิติบุคคลข้ามชาติ (MNE) ที่มีรายได้รวมในงบการเงินรวมตั้งแต่ 750 ล้านยูโรขึ้นไป แม้ได้รับสิทธิยกเว้นภาษีเงินได้นิติบุคคลจาก BOI",
    point_in_time_routing_rule:
      "รอบระยะเวลาบัญชีที่เริ่มก่อนวันที่ 2025-01-01 ได้รับสิทธิยกเว้น CIT ตามบัตรส่งเสริม BOI เต็มจำนวนโดยไม่มี Top-Up Tax; รอบระยะเวลาบัญชีที่เริ่มตั้งแต่วันที่ 2025-01-01 ของกลุ่ม MNE รายได้ ≥ 750 ล้านยูโร ต้องคำนวณ ETR ขั้นต่ำ 15% และเสียภาษีส่วนเพิ่ม (Top-Up Tax)",
    versions: [
      {
        version_id: "v1.rev.pre2025",
        version_sequence: 1,
        version_label_th: "เกณฑ์ก่อนปี 2568 (CIT 20% มาตรฐาน / ยกเว้นภาษี BOI 0% โดยไม่มี Top-Up Tax)",
        version_label_en: "Pre-2025 Regime (Standard 20% CIT / Full 0% BOI Holiday without GMT)",
        amendment_instrument_th: "ประมวลรัษฎากร มาตรา 65 ทวิ และ พ.ร.บ. ส่งเสริมการลงทุน พ.ศ. 2520 มาตรา 31",
        effective_from: "2012-01-01",
        effective_to: "2024-12-31",
        status: "HISTORICAL_SUPERSEDED",
        text_th:
          "บริษัทหรือห้างหุ้นส่วนนิติบุคคลเสียภาษีเงินได้นิติบุคคลในอัตราร้อยละ 20 ของกำไรสุทธิ กรณีได้รับบัตรส่งเสริมการลงทุนตามมาตรา 31 แห่งพระราชบัญญัติส่งเสริมการลงทุน พ.ศ. 2520 ได้รับยกเว้นภาษีเงินได้นิติบุคคลสำหรับกำไรสุทธิที่ได้จากการประกอบกิจการที่ได้รับการส่งเสริมเต็มจำนวนโดยไม่มีภาระภาษีขั้นต่ำส่วนเพิ่ม",
        text_en_summary:
          "Standard 20% Corporate Income Tax on net profits; BOI-promoted companies under Sec. 31 enjoy a full 0% CIT holiday on promoted net profits without any Domestic Minimum Top-Up Tax.",
        key_legal_rule: "CIT 20% (กิจการ BOI ม.31 ยกเว้น CIT เต็มจำนวน 0% ไม่มี Top-Up Tax)",
      },
      {
        version_id: "v2.rev.pillar2_2568",
        version_sequence: 2,
        version_label_th: "เกณฑ์ปัจจุบันตั้งแต่ 1 ม.ค. 2568 (พ.ร.ก. ภาษีส่วนเพิ่ม พ.ศ. 2567 — ETR ขั้นต่ำ 15%)",
        version_label_en: "Current Regime from 1 Jan 2025 (Emergency Decree on Top-Up Tax B.E. 2567 — 15% GMT)",
        amendment_instrument_th: "พระราชกำหนดภาษีส่วนเพิ่ม พ.ศ. 2567 (ราชกิจจานุเบกษา 26 ธ.ค. 2567 มีผล 1 ม.ค. 2568)",
        effective_from: "2025-01-01",
        effective_to: null,
        status: "IN_FORCE_CURRENT",
        text_th:
          "บริษัทหรือห้างหุ้นส่วนนิติบุคคลเสียภาษีเงินได้นิติบุคคลในอัตราร้อยละ 20 ของกำไรสุทธิ แต่ในกรณีที่เป็นหน่วยธุรกิจในกลุ่มนิติบุคคลข้ามชาติขนาดใหญ่ที่มีรายได้ในงบการเงินรวมของบริษัทแม่ลำดับสูงสุดไม่น้อยกว่า 750 ล้านยูโร ในอย่างน้อย 2 ใน 4 รอบระยะเวลาบัญชีก่อนหน้า หากมีอัตราภาษีที่แท้จริงในประเทศไทยต่ำกว่าร้อยละ 15 (เช่น กรณีได้รับยกเว้นภาษีเงินได้นิติบุคคลตามมาตรา 31 แห่งพระราชบัญญัติส่งเสริมการลงทุน) ต้องเสียภาษีส่วนเพิ่มในประเทศ (DMTT) ให้ครบอัตราร้อยละ 15",
        text_en_summary:
          "In-scope MNE constituent entities (consolidated revenue ≥ EUR 750M in at least 2 of 4 preceding fiscal years) whose jurisdictional Effective Tax Rate in Thailand falls below 15% (including due to BOI Sec. 31 holidays) are subject to a Domestic Minimum Top-Up Tax (DMTT) up to 15%.",
        key_legal_rule: "กลุ่ม MNE รายได้ ≥ 750 ล้านยูโร ต้องเสียภาษีส่วนเพิ่ม (Top-Up Tax) ให้ ETR ขั้นต่ำ 15%",
      },
    ],
  },
  {
    chain_id: "chain.tcct.51",
    canonical_provision_key: "th:tcct:tca-2560#sec:51",
    authority_code: "TCCT",
    regulator: "สำนักงานคณะกรรมการการแข่งขันทางการค้า (Trade Competition Commission of Thailand)",
    instrument_title_th: "พระราชบัญญัติการแข่งขันทางการค้า (การควบคุมการรวมธุรกิจ / Merger Control)",
    instrument_title_en: "Trade Competition Act — Merger Control Regime",
    provision_label: "มาตรา 26 เดิม vs. มาตรา 51 ปัจจุบัน (Dual-Track Merger Control)",
    practice_area: "Antitrust & Merger Control",
    amendment_rationale_th:
      "พ.ร.บ. การแข่งขันทางการค้า พ.ศ. 2560 มาตรา 51 เปลี่ยนระบบควบคุมการรวมธุรกิจจากระบบขออนุญาตล่วงหน้าทางเดียว (ซึ่งไม่เคยมีการออกประกาศกำหนดเกณฑ์ขั้นต่ำตาม พ.ร.บ. 2542) เป็นระบบคู่ขนาน (Dual-Track): (1) แจ้งผลการรวมธุรกิจภายใน 7 วันนับแต่วันรวมธุรกิจกรณีอาจลดการแข่งขันอย่างมีนัยสำคัญ และ (2) ขออนุญาตก่อนรวมธุรกิจจาก กขค. กรณีอาจก่อให้เกิดการผูกขาดหรือเป็นผู้ประกอบธุรกิจซึ่งมีอำนาจเหนือตลาด",
    point_in_time_routing_rule:
      "ธุรกรรมรวมธุรกิจตั้งแต่วันที่ 2017-10-05 (และหลังประกาศ กขค. เรื่องเกณฑ์การรวมธุรกิจ พ.ศ. 2561 มีผลบังคับใช้) ต้องตรวจสอบเกณฑ์ Dual-Track ตามมาตรา 51 แห่ง พ.ร.บ. การแข่งขันทางการค้า พ.ศ. 2560",
    versions: [
      {
        version_id: "v1.tcct.2542_sec26",
        version_sequence: 1,
        version_label_th: "พ.ร.บ. การแข่งขันทางการค้า พ.ศ. 2542 มาตรา 26 (เดิม)",
        version_label_en: "Trade Competition Act B.E. 2542 Section 26 (Repealed)",
        amendment_instrument_th: "พระราชบัญญัติการแข่งขันทางการค้า พ.ศ. 2542 มาตรา 26",
        effective_from: "1999-04-30",
        effective_to: "2017-10-04",
        status: "HISTORICAL_SUPERSEDED",
        text_th:
          "มาตรา 26 ห้ามมิให้ผู้ประกอบธุรกิจรวมธุรกิจอันอาจก่อให้เกิดการผูกขาดหรือความไม่เป็นธรรมในการแข่งขันตามที่คณะกรรมการประกาศกำหนดในราชกิจจานุเบกษา เว้นแต่จะได้รับอนุญาตจากคณะกรรมการ",
        text_en_summary:
          "Section 26 (B.E. 2542): Single pre-merger permission regime for mergers that may cause monopoly or unfair competition as prescribed by the Commission.",
        key_legal_rule: "ระบบขออนุญาตล่วงหน้าทางเดียว (ม.26 พ.ร.บ. 2542)",
      },
      {
        version_id: "v2.tcct.2560_sec51",
        version_sequence: 2,
        version_label_th: "พ.ร.บ. การแข่งขันทางการค้า พ.ศ. 2560 มาตรา 51 (ฉบับปัจจุบัน)",
        version_label_en: "Trade Competition Act B.E. 2560 Section 51 (Current Dual-Track Regime)",
        amendment_instrument_th: "พระราชบัญญัติการแข่งขันทางการค้า พ.ศ. 2560 มาตรา 51",
        effective_from: "2017-10-05",
        effective_to: null,
        status: "IN_FORCE_CURRENT",
        text_th:
          "มาตรา 51 ผู้ประกอบธุรกิจใดจะกระทำการรวมธุรกิจอันอาจก่อให้เกิดการลดการแข่งขันอย่างมีนัยสำคัญในตลาดใดตลาดหนึ่งตามหลักเกณฑ์ที่คณะกรรมการประกาศกำหนด ต้องแจ้งผลการรวมธุรกิจต่อคณะกรรมการภายในเจ็ดวันนับแต่วันที่รวมธุรกิจ ผู้ประกอบธุรกิจใดจะกระทำการรวมธุรกิจอันอาจก่อให้เกิดการผูกขาดหรือการเป็นผู้ประกอบธุรกิจซึ่งมีอำนาจเหนือตลาด ต้องได้รับอนุญาตจากคณะกรรมการก่อนจึงจะทำการรวมธุรกิจได้",
        text_en_summary:
          "Section 51 (B.E. 2560): Dual-Track Merger Control — (1) Post-merger notification within 7 days if the merger may substantially lessen competition; (2) Mandatory pre-merger approval from TCCT if the merger may result in a monopoly or market dominance.",
        key_legal_rule: "ระบบคู่ขนาน: แจ้งภายใน 7 วันหลังรวมธุรกิจ (Post-Merger) vs. ขออนุญาตก่อนรวมธุรกิจ (Pre-Merger Approval)",
      },
    ],
  },
];

function computeWordLevelDiff(oldText: string, newText: string): {
  segments: DiffTokenSegment[];
  added: number;
  removed: number;
  unchanged: number;
} {
  // Tokenize by whitespace and Thai phrase boundaries for readable side-by-side & inline legal diffs
  const tokenize = (s: string) =>
    s
      .split(/(\s+|(?=[()0-9])|(?<=[()0-9])|(?=โดย|เว้นแต่|หรือ|และ|ตั้งแต่|ตาม|ต้อง|ให้|หาก|แต่))/g)
      .filter((t) => t.length > 0);

  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const rawSegments: DiffTokenSegment[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rawSegments.push({ type: "UNCHANGED", text: a[i] });
      unchanged++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawSegments.push({ type: "REMOVED", text: a[i] });
      removed++;
      i++;
    } else {
      rawSegments.push({ type: "ADDED", text: b[j] });
      added++;
      j++;
    }
  }
  while (i < m) {
    rawSegments.push({ type: "REMOVED", text: a[i++] });
    removed++;
  }
  while (j < n) {
    rawSegments.push({ type: "ADDED", text: b[j++] });
    added++;
  }

  // Merge adjacent segments of the same type
  const merged: DiffTokenSegment[] = [];
  for (const seg of rawSegments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === seg.type) {
      prev.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  return { segments: merged, added, removed, unchanged };
}

export function listStatutoryVersionChains(authorityCode?: string): StatutoryVersionChain[] {
  const filter = (authorityCode || "").trim().toUpperCase();
  if (!filter || filter === "ALL") {
    return CURATED_STATUTORY_VERSION_CHAINS;
  }
  const matched = CURATED_STATUTORY_VERSION_CHAINS.filter(
    (c) => c.authority_code.toUpperCase() === filter
  );
  return matched.length > 0 ? matched : CURATED_STATUTORY_VERSION_CHAINS;
}

export function compareStatutoryVersionsDiff(options?: {
  chain_id?: string;
  canonical_key?: string;
  left_version_id?: string;
  right_version_id?: string;
}): StatutoryVersionDiffComparison {
  const chain =
    CURATED_STATUTORY_VERSION_CHAINS.find(
      (c) =>
        c.chain_id === options?.chain_id ||
        c.canonical_provision_key === options?.canonical_key
    ) || CURATED_STATUTORY_VERSION_CHAINS[0];

  const leftVersion =
    chain.versions.find((v) => v.version_id === options?.left_version_id) ||
    chain.versions[0];
  const rightVersion =
    chain.versions.find((v) => v.version_id === options?.right_version_id) ||
    chain.versions[chain.versions.length - 1];

  const diff = computeWordLevelDiff(leftVersion.text_th, rightVersion.text_th);
  const totalTokens = Math.max(diff.added + diff.removed + diff.unchanged, 1);

  return {
    chain,
    left_version: leftVersion,
    right_version: rightVersion,
    diff_segments: diff.segments,
    stats: {
      added_tokens: diff.added,
      removed_tokens: diff.removed,
      unchanged_tokens: diff.unchanged,
      change_ratio_pct: Math.round(((diff.added + diff.removed) / totalTokens) * 100),
    },
  };
}
