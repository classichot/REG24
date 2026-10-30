/**
 * REG24 Infrastructure Developer Requirements v1.0 (30 October 2026)
 * Package: @reg24/legal-domain (packages/legal-domain)
 * Covers: SCOPE01–SCOPE05, DATA01–DATA05, TIME01–TIME06, INTEL06, MISSION04
 * Rule (ARC11): Pure TypeScript legal domain — MUST NOT import Next.js, Prisma, Neo4j drivers, or LLM SDKs.
 */

import type {
  DurableMissionState,
  Reg24OutcomeStatus,
  ResolvedTemporalContext,
  UncertaintyReasonCode,
} from "../contracts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 2: ARCHITECTURAL SCOPE & JURISDICTION PACKS (SCOPE01–SCOPE05)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface JurisdictionPackDefinition {
  jurisdiction_id: string;
  name_en: string;
  name_local: string;
  authority_types: string[];
  territorial_scope: string;
  primary_calendar: "buddhist_era" | "gregorian";
  timezone: string;
  languages: string[];
  citation_format: string;
  source_rights_policy: string;
  retention_years: number;
  reviewer_qualification_required: string;
  supported_domains: string[];
  holidays_iso: string[];
  status: "production_p0" | "staging_synthetic" | "planned";
}

export const JURISDICTION_PACK_REGISTRY: Record<string, JurisdictionPackDefinition> = {
  TH: {
    jurisdiction_id: "TH",
    name_en: "Thailand",
    name_local: "ราชอาณาจักรไทย",
    authority_types: [
      "primary_statute",
      "royal_decree",
      "ministerial_regulation",
      "regulator_notification",
      "supreme_court_dika_precedent",
      "revenue_department_ruling",
    ],
    territorial_scope: "Kingdom of Thailand",
    primary_calendar: "buddhist_era",
    timezone: "Asia/Bangkok",
    languages: ["th", "en"],
    citation_format: "{Title} B.E. {Year} ({GregorianYear}) Section {Section}",
    source_rights_policy: "Thai Royal Gazette public statutes; Legal Forms own-use-only restricted.",
    retention_years: 10,
    reviewer_qualification_required: "Licensed Thai Attorney-at-Law (Lawyers Council of Thailand)",
    supported_domains: ["corporate", "contract", "civil", "tax", "labor", "boi", "pdpa", "sec"],
    holidays_iso: ["2026-01-01", "2026-04-06", "2026-04-13", "2026-04-14", "2026-04-15", "2026-05-01", "2026-10-13", "2026-10-23", "2026-12-05", "2026-12-10"],
    status: "production_p0",
  },
  SG: {
    jurisdiction_id: "SG",
    name_en: "Singapore (Staging Pack)",
    name_local: "Republic of Singapore",
    authority_types: ["act_of_parliament", "subsidiary_legislation", "court_of_appeal_judgment", "iras_e_tax_guide"],
    territorial_scope: "Republic of Singapore",
    primary_calendar: "gregorian",
    timezone: "Asia/Singapore",
    languages: ["en"],
    citation_format: "{Title} ({CapOrYear}, {Section})",
    source_rights_policy: "Singapore Statutes Online staging terms; no cross-border rule merging.",
    retention_years: 7,
    reviewer_qualification_required: "Advocate and Solicitor of the Supreme Court of Singapore",
    supported_domains: ["corporate", "pdpa"],
    holidays_iso: ["2026-01-01", "2026-02-17", "2026-05-01", "2026-08-09", "2026-12-25"],
    status: "staging_synthetic",
  },
};

export function evaluateJurisdictionAndCrossBorderScope(params: {
  jurisdiction: string;
  secondary_jurisdiction?: string;
  domain?: string;
}): {
  supported: boolean;
  pack?: JurisdictionPackDefinition;
  outcome: Reg24OutcomeStatus;
  reason?: string;
  coverage_limitation?: string;
} {
  const pack = JURISDICTION_PACK_REGISTRY[params.jurisdiction];
  if (!pack) {
    return {
      supported: false,
      outcome: "abstained",
      reason: `Unsupported jurisdiction '${params.jurisdiction}'. Supported packs: ${Object.keys(JURISDICTION_PACK_REGISTRY).join(", ")}.`,
      coverage_limitation: `Jurisdiction '${params.jurisdiction}' has no registered domain pack.`,
    };
  }
  if (params.secondary_jurisdiction && params.secondary_jurisdiction !== params.jurisdiction) {
    return {
      supported: false,
      pack,
      outcome: "abstained",
      reason: `Cross-border legal conclusion between '${params.jurisdiction}' and '${params.secondary_jurisdiction}' is rejected under SCOPE01/Phase 3 boundary rules: similar concepts across jurisdictions must not be merged into one rule.`,
      coverage_limitation: `Cross-border conflict-of-laws synthesis (${params.jurisdiction} ↔ ${params.secondary_jurisdiction}) requires Phase 3 cross-border workflow approval.`,
    };
  }
  if (params.domain && !pack.supported_domains.includes(params.domain.toLowerCase())) {
    return {
      supported: false,
      pack,
      outcome: "abstained",
      reason: `Domain '${params.domain}' is not covered in jurisdiction pack '${params.jurisdiction}'.`,
      coverage_limitation: `Supported domains for ${params.jurisdiction}: ${pack.supported_domains.join(", ")}.`,
    };
  }
  return {
    supported: true,
    pack,
    outcome: "complete",
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 7: CANONICAL LEGAL DATA MODEL (DATA01–DATA05)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * DATA05: Explicit Buddhist Era & ISO Date Normalization with Conversion Provenance
 * Unknown dates remain null ("unknown") rather than defaulting to publication or ingestion date.
 */
export interface NormalizedLegalDate {
  source_stated_text: string | null;
  iso_date: string | null;
  calendar_origin: "buddhist_era" | "gregorian" | "unknown";
  timezone: string;
  conversion_provenance: string;
}

export function normalizeThaiLegalDate(
  rawInput: string | null | undefined,
  timezone = "Asia/Bangkok"
): NormalizedLegalDate {
  if (!rawInput || rawInput.trim() === "" || rawInput.toLowerCase() === "unknown") {
    return {
      source_stated_text: rawInput ?? null,
      iso_date: null,
      calendar_origin: "unknown",
      timezone,
      conversion_provenance: "unknown_preserved_no_default",
    };
  }

  const trimmed = rawInput.trim();
  // Match ISO YYYY-MM-DD where YYYY >= 2400 (Buddhist Era year in ISO format)
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const yr = Number(isoMatch[1]);
    if (yr >= 2400) {
      const gregYear = yr - 543;
      return {
        source_stated_text: trimmed,
        iso_date: `${gregYear}-${isoMatch[2]}-${isoMatch[3]}`,
        calendar_origin: "buddhist_era",
        timezone,
        conversion_provenance: `BE_year_${yr}_minus_543_to_CE_${gregYear}`,
      };
    }
    return {
      source_stated_text: trimmed,
      iso_date: trimmed,
      calendar_origin: "gregorian",
      timezone,
      conversion_provenance: "iso_8601_gregorian_direct",
    };
  }

  // Match Thai B.E. year mention e.g. "พ.ศ. 2562" or "B.E. 2566"
  const beYearMatch = /(?:พ\.ศ\.|B\.E\.)\s*(\d{4})/i.exec(trimmed);
  if (beYearMatch) {
    const beYear = Number(beYearMatch[1]);
    const ceYear = beYear - 543;
    return {
      source_stated_text: trimmed,
      iso_date: `${ceYear}-01-01`,
      calendar_origin: "buddhist_era",
      timezone,
      conversion_provenance: `extracted_BE_${beYear}_converted_to_${ceYear}`,
    };
  }

  return {
    source_stated_text: trimmed,
    iso_date: null,
    calendar_origin: "unknown",
    timezone,
    conversion_provenance: "unparsed_preserved_as_unknown",
  };
}

/**
 * DATA01: 12 Required Canonical Entities
 */
export interface CanonicalLegalInstrument {
  id: string; // Stable REG24 ID e.g. "INST-TH-CCC"
  jurisdiction: string;
  instrument_type: "statute" | "royal_decree" | "ministerial_regulation" | "notification" | "code";
  issuing_authority: string;
  official_identifier: string;
  titles: { th?: string; en: string };
  language: "th" | "en" | "bilingual";
  source_ids: string[];
}

export interface CanonicalProvision {
  id: string; // Stable REG24 ID e.g. "PROV-TH-CCC-1097"
  instrument_id: string;
  structural_path: string; // e.g. "/book-3/title-22/chapter-4/part-1/section-1097"
  parent_id: string | null;
  display_number: string; // e.g. "1097"
  provision_type: "section" | "chapter" | "part" | "clause" | "schedule";
}

export interface HalfOpenInterval {
  from: string; // Inclusive ISO date YYYY-MM-DD
  to: string | null; // Exclusive ISO date YYYY-MM-DD (null = open-ended)
}

export interface CanonicalProvisionVersion {
  id: string; // e.g. "PVER-TH-CCC-1097-V2"
  provision_id: string;
  jurisdiction: string;
  text: string;
  text_th?: string;
  is_authoritative_thai: boolean;
  translation_origin?: "official" | "reg24_reviewed_unofficial" | "none";
  text_hash: string;
  publication_date: NormalizedLegalDate;
  effective_date: NormalizedLegalDate;
  legal_validity: HalfOpenInterval; // TIME01: Valid time in the world [from, to)
  recorded_interval: HalfOpenInterval; // TIME01: Recorded time when REG24 knew this version [from, to)
  version_basis: string; // Amending instrument or Gazette reference
  review_status: "reviewed" | "candidate" | "disputed" | "withdrawn";
  transitional_condition?: {
    required_fact_key: string;
    threshold_date: string;
    description: string;
  };
  competing_source_conflict?: {
    conflicting_version_id: string;
    source_a_claim: string;
    source_b_claim: string;
    requires_legal_review: boolean;
  };
}

export interface CanonicalCaseDecision {
  id: string;
  jurisdiction: string;
  court: string;
  case_identifiers: string[];
  decision_date: NormalizedLegalDate;
  publication_date: NormalizedLegalDate;
  procedural_context: string;
  source_ids: string[];
  binding_scope: "erga_omnes_statutory" | "supreme_court_exemplary_precedent" | "party_specific_only";
}

export interface CanonicalAuthorityRecord {
  id: string;
  issuer: string;
  authority_kind:
    | "primary_legislation"
    | "subordinate_regulation"
    | "supreme_court_judgment"
    | "tax_ruling"
    | "regulator_guidance"
    | "secondary_commentary";
  jurisdiction: string;
  binding_weight: number; // 100 = primary statute, 85 = sub-reg, 75 = Dika, 50 = RD ruling, 10 = secondary commentary
  is_universally_binding: boolean;
  applicability_notes: string;
  review_provenance: string;
}

export type CanonicalRelationshipPredicate =
  | "amends"
  | "repeals"
  | "replaces"
  | "implements"
  | "cites"
  | "interprets"
  | "distinguishes"
  | "conflicts_with";

export interface CanonicalLegalRelationship {
  id: string;
  subject_id: string;
  predicate: CanonicalRelationshipPredicate;
  object_id: string;
  legal_interval: HalfOpenInterval;
  recorded_interval: HalfOpenInterval;
  evidence_ids: string[];
  status: "candidate" | "reviewed" | "rejected";
}

/**
 * DATA02: SourceArtifact with preserved original bytes, OCR extraction versions, and reviewed corrections
 */
export interface ExtractionVersionRecord {
  extraction_version_id: string;
  stage: "raw_ocr" | "normalized_parse" | "human_reviewed_correction";
  extracted_text: string;
  text_hash: string;
  ocr_confidence: number;
  created_at: string;
  reviewer_id?: string;
  correction_note?: string;
}

export interface CanonicalSourceArtifact {
  id: string;
  origin: string;
  retrieved_at: string;
  byte_hash: string; // Immutable hash of original bytes
  original_bytes_preview: string;
  media_type: string;
  object_ref: string;
  rights: {
    owner: string;
    permitted_processing: boolean;
    redistribution_allowed: boolean;
    quotation_policy: "full_quotation" | "excerpt_only" | "metadata_only";
    model_use_allowed: boolean;
    license_scope: "PUBLIC_STATUTE" | "INTERNAL_OWN_USE_ONLY" | "RESTRICTED_CLIENT_MATTER";
  };
  classification: "primary_authority" | "secondary_commentary" | "administrative_notice" | "client_matter_doc";
  extraction_versions: ExtractionVersionRecord[];
}

export interface CanonicalEvidenceSpan {
  id: string;
  artifact_id: string;
  artifact_version: string;
  page_or_paragraph_locator: string;
  offsets: { start_char: number; end_char: number; page_bbox?: [number, number, number, number] };
  quote: string;
  hash: string;
  extraction_version: string;
}

export interface CanonicalLegalClaim {
  id: string;
  statement: string;
  claim_type: "factual" | "quoted" | "interpreted" | "inferred";
  jurisdiction: string;
  applicable_time: string;
  evidence_links: string[];
  verification_state: "verified" | "unverified" | "disputed" | "abstained";
}

export interface CanonicalObligationRule {
  id: string;
  jurisdiction: string;
  domain: string;
  rule_version: string;
  title: string;
  trigger: string;
  required_facts: string[];
  conditions: Array<{
    condition_id: string;
    fact_key: string;
    operator: "eq" | "gte" | "lte" | "in";
    expected_value: string | number | boolean | Array<string | number>;
    description: string;
  }>;
  exceptions: string[];
  responsible_role: string;
  rule_basis: string; // Provision ID
  reviewer: string;
  status: "candidate" | "reviewed_executable" | "suspended";
}

export interface CanonicalMatter {
  id: string;
  tenant_id: string;
  client_ref: string;
  purpose: string;
  authorized_participants: string[];
  ethical_wall_restricted_principals: string[];
  classification: "public" | "internal" | "confidential" | "strictly_confidential";
}

export interface CanonicalMission {
  id: string;
  tenant_id: string;
  matter_id: string;
  mission_class:
    | "corporate_issue_research"
    | "contract_review"
    | "contract_draft"
    | "obligation_assessment"
    | "legal_change_impact";
  capability_version: string;
  state: DurableMissionState;
  budget: {
    spend_cap_usd: number;
    reserved_usd: number;
    settled_usd: number;
  };
  corpus_snapshot_id: string;
  approval_refs: string[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 8: BITEMPORAL LEGAL INTELLIGENCE & 5 MANDATORY FIXTURES (TIME01–TIME06)
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function isDateInHalfOpenInterval(dateIso: string, interval: HalfOpenInterval): boolean {
  if (dateIso < interval.from) return false;
  if (interval.to !== null && dateIso >= interval.to) return false;
  return true;
}

export function resolveTemporalContext(params: {
  jurisdiction: string;
  legal_as_of?: string;
  known_as_of?: string;
  server_today_iso?: string;
}): ResolvedTemporalContext {
  const pack = JURISDICTION_PACK_REGISTRY[params.jurisdiction] ?? JURISDICTION_PACK_REGISTRY.TH;
  const fallbackToday = params.server_today_iso ?? "2026-10-30";
  const legalAsOf = params.legal_as_of && params.legal_as_of.trim() !== "" ? params.legal_as_of : fallbackToday;
  const knownAsOf = params.known_as_of && params.known_as_of.trim() !== "" ? params.known_as_of : fallbackToday;
  const ceYear = Number(legalAsOf.slice(0, 4)) || 2026;

  return {
    jurisdiction: params.jurisdiction,
    timezone: pack.timezone,
    legal_as_of: legalAsOf,
    known_as_of: knownAsOf,
    defaulted_legal_as_of: !params.legal_as_of,
    defaulted_known_as_of: !params.known_as_of,
    buddhist_era_year: ceYear + 543,
  };
}

/**
 * Canonical Bitemporal Seed Versions covering real Thai statutes + all 5 Mandatory Section 8 Fixtures:
 * - Fixture 1: Provision published in January (2026-01-15) becomes effective in April (2026-04-01). Feb and May queries return different outcomes.
 * - Fixture 2: Amendment discovered in June (2026-06-10) has a stated retroactive effective date in March (2026-03-01). Current knowledge (Oct) vs May knowledge (2026-05-15) preserve the difference.
 * - Fixture 3: One section (CCC Sec. 1097) changes while neighboring sections (CCC Sec. 1098) remain unchanged. Consolidation preserves their independent histories.
 * - Fixture 4: Transitional rule depends on contract_date. Missing contract_date produces needs_information rather than an assumed result.
 * - Fixture 5: Two sources disagree on commencement date. Result identifies the conflict and required review (TEMPORAL_CONFLICT / needs_review).
 */
export const BITEMPORAL_PROVISION_VERSIONS: CanonicalProvisionVersion[] = [
  // CCC Section 1097 (Historical 3 promoters vs Amended 2 promoters — Fixture 3 Part A)
  {
    id: "PVER-TH-CCC-1097-V1",
    provision_id: "PROV-TH-CCC-1097",
    jurisdiction: "TH",
    text: "Section 1097 (Prior to B.E. 2565 Amendment): Any three or more persons may, by subscribing their names to a memorandum and otherwise complying with the provisions of this Code, promote and form a limited company.",
    text_th: "มาตรา 1097 บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้ โดยเข้าชื่อกันทำหนังสือบริคณห์สนธิ",
    is_authoritative_thai: true,
    translation_origin: "reg24_reviewed_unofficial",
    text_hash: "sha256:ccc1097_v1_three_promoters_hash",
    publication_date: normalizeThaiLegalDate("2008-03-01"),
    effective_date: normalizeThaiLegalDate("2008-07-01"),
    legal_validity: { from: "2008-07-01", to: "2023-02-07" },
    recorded_interval: { from: "2008-07-01", to: null },
    version_basis: "Civil and Commercial Code Amendment Act (No. 18) B.E. 2551",
    review_status: "reviewed",
  },
  {
    id: "PVER-TH-CCC-1097-V2",
    provision_id: "PROV-TH-CCC-1097",
    jurisdiction: "TH",
    text: "Section 1097 (Amended B.E. 2565, effective 7 Feb 2023): Any two or more persons may, by subscribing their names to a memorandum and otherwise complying with the provisions of this Code, promote and form a limited company.",
    text_th: "มาตรา 1097 บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้ โดยเข้าชื่อกันทำหนังสือบริคณห์สนธิ",
    is_authoritative_thai: true,
    translation_origin: "reg24_reviewed_unofficial",
    text_hash: "sha256:ccc1097_v2_two_promoters_hash",
    publication_date: normalizeThaiLegalDate("2022-11-08"),
    effective_date: normalizeThaiLegalDate("2023-02-07"),
    legal_validity: { from: "2023-02-07", to: null },
    recorded_interval: { from: "2022-11-08", to: null },
    version_basis: "Civil and Commercial Code Amendment Act (No. 23) B.E. 2565",
    review_status: "reviewed",
  },
  // CCC Section 1098 (Neighboring section unchanged — Fixture 3 Part B)
  {
    id: "PVER-TH-CCC-1098-V1",
    provision_id: "PROV-TH-CCC-1098",
    jurisdiction: "TH",
    text: "Section 1098: The Memorandum of Association must contain the name of the proposed company, geographical location, objects, declaration of limited liability, share capital registration, and promoter particulars.",
    text_th: "มาตรา 1098 หนังสือบริคณห์สนธินั้น ต้องมีรายการดังต่อไปนี้ (1) ชื่อบริษัทอันคิดจะตั้งขึ้น ซึ่งต้องมีคำว่า “จำกัด” ไว้ปลายชื่อนั้นด้วยเสมอไป...",
    is_authoritative_thai: true,
    translation_origin: "reg24_reviewed_unofficial",
    text_hash: "sha256:ccc1098_v1_unchanged_neighbor_hash",
    publication_date: normalizeThaiLegalDate("1925-01-01"),
    effective_date: normalizeThaiLegalDate("1925-01-01"),
    legal_validity: { from: "1925-01-01", to: null },
    recorded_interval: { from: "1925-01-01", to: null },
    version_basis: "Civil and Commercial Code Book III Original Enactment",
    review_status: "reviewed",
  },
  // Fixture 1: Delayed commencement (Published 2026-01-15, Effective 2026-04-01)
  {
    id: "PVER-FIX1-DELAYED-V1-PRIOR",
    provision_id: "PROV-TH-FIXTURE-01",
    jurisdiction: "TH",
    text: "Baseline Rule (In force prior to 1 April 2026): Cross-border data controller notification filing is voluntary.",
    is_authoritative_thai: true,
    text_hash: "sha256:fix1_v1_prior_baseline",
    publication_date: normalizeThaiLegalDate("2022-06-01"),
    effective_date: normalizeThaiLegalDate("2022-06-01"),
    legal_validity: { from: "2022-06-01", to: "2026-04-01" },
    recorded_interval: { from: "2022-06-01", to: null },
    version_basis: "PDPC Baseline Notification B.E. 2565",
    review_status: "reviewed",
  },
  {
    id: "PVER-FIX1-DELAYED-V2-APR",
    provision_id: "PROV-TH-FIXTURE-01",
    jurisdiction: "TH",
    text: "Amended Rule (Published 15 Jan 2026, Effective 1 Apr 2026): Mandatory annual cross-border transfer log filing applies.",
    is_authoritative_thai: true,
    text_hash: "sha256:fix1_v2_delayed_commencement_apr",
    publication_date: normalizeThaiLegalDate("2026-01-15"),
    effective_date: normalizeThaiLegalDate("2026-04-01"),
    legal_validity: { from: "2026-04-01", to: null },
    recorded_interval: { from: "2026-01-15", to: null },
    version_basis: "PDPC Notification on Transfer Logs B.E. 2569 (Published Jan 2026, Effective Apr 2026)",
    review_status: "reviewed",
  },
  // Fixture 2: Retroactive amendment discovered in June 2026 (recorded_from: 2026-06-10) with stated effective date March 2026 (legal_validity.from: 2026-03-01)
  {
    id: "PVER-FIX2-RETRO-V1-ORIGINAL",
    provision_id: "PROV-TH-FIXTURE-02",
    jurisdiction: "TH",
    text: "Original Tax Deduction Rule (Known in May 2026): Standard 100% deduction on R&D expenses.",
    is_authoritative_thai: true,
    text_hash: "sha256:fix2_v1_original_known_in_may",
    publication_date: normalizeThaiLegalDate("2025-01-01"),
    effective_date: normalizeThaiLegalDate("2025-01-01"),
    legal_validity: { from: "2025-01-01", to: null },
    recorded_interval: { from: "2025-01-01", to: "2026-06-10" }, // Superseded in recorded history on 2026-06-10 (TIME06 append-only)
    version_basis: "Revenue Code Royal Decree No. 750",
    review_status: "reviewed",
  },
  {
    id: "PVER-FIX2-RETRO-V2-DISCOVERED-JUNE",
    provision_id: "PROV-TH-FIXTURE-02",
    jurisdiction: "TH",
    text: "Retroactive Tax Exemption (Discovered 10 Jun 2026, Retroactively Effective 1 Mar 2026): 200% super-deduction on certified green R&D.",
    is_authoritative_thai: true,
    text_hash: "sha256:fix2_v2_retroactive_discovered_june",
    publication_date: normalizeThaiLegalDate("2026-06-10"),
    effective_date: normalizeThaiLegalDate("2026-03-01"),
    legal_validity: { from: "2026-03-01", to: null },
    recorded_interval: { from: "2026-06-10", to: null },
    version_basis: "Revenue Code Royal Decree No. 799 (Retroactive to 1 Mar 2026, Recorded 10 Jun 2026)",
    review_status: "reviewed",
  },
  // Fixture 4: Transitional rule depending on contract_date
  {
    id: "PVER-FIX4-TRANSITIONAL-V2",
    provision_id: "PROV-TH-FIXTURE-04",
    jurisdiction: "TH",
    text: "Transitional Provision (Section 42): Contracts executed before 1 July 2026 remain governed by the 2019 penalty cap; contracts executed on or after 1 July 2026 are subject to the new statutory cap.",
    is_authoritative_thai: true,
    text_hash: "sha256:fix4_transitional_contract_date",
    publication_date: normalizeThaiLegalDate("2026-05-01"),
    effective_date: normalizeThaiLegalDate("2026-07-01"),
    legal_validity: { from: "2026-07-01", to: null },
    recorded_interval: { from: "2026-05-01", to: null },
    version_basis: "Unfair Contract Terms Amendment B.E. 2569 Section 42 (Transitional)",
    review_status: "reviewed",
    transitional_condition: {
      required_fact_key: "contract_date",
      threshold_date: "2026-07-01",
      description: "Applicability depends on whether contract_date is before or on/after 2026-07-01.",
    },
  },
  // Fixture 5: Competing sources disagree on commencement
  {
    id: "PVER-FIX5-CONFLICT-V1",
    provision_id: "PROV-TH-FIXTURE-05",
    jurisdiction: "TH",
    text: "Subordinate Notification on Digital Platform Reporting: Source A (Agency Summary) states commencement on 1 Aug 2026; Source B (Gazette Errata) states 1 Nov 2026.",
    is_authoritative_thai: true,
    text_hash: "sha256:fix5_competing_commencement_conflict",
    publication_date: normalizeThaiLegalDate("2026-07-15"),
    effective_date: normalizeThaiLegalDate("2026-08-01"),
    legal_validity: { from: "2026-08-01", to: null },
    recorded_interval: { from: "2026-07-15", to: null },
    version_basis: "ETDA Notification B.E. 2569 (Competing Commencement Sources)",
    review_status: "disputed",
    competing_source_conflict: {
      conflicting_version_id: "PVER-FIX5-CONFLICT-V1-ALT",
      source_a_claim: "Agency Press Release states effective 2026-08-01",
      source_b_claim: "Royal Gazette Errata Slip states effective 2026-11-01",
      requires_legal_review: true,
    },
  },
];

export interface BitemporalResolutionResult {
  provision_id: string;
  legal_as_of: string;
  known_as_of: string;
  outcome: Reg24OutcomeStatus;
  resolved_version: CanonicalProvisionVersion | null;
  upcoming_published_versions: CanonicalProvisionVersion[];
  missing_facts_required: string[];
  conflict_details?: CanonicalProvisionVersion["competing_source_conflict"];
  uncertainty_reasons: UncertaintyReasonCode[];
  explanation: string;
}

export function evaluateBitemporalProvision(params: {
  provision_id: string;
  legal_as_of: string;
  known_as_of: string;
  supplied_facts?: Record<string, string | number | boolean>;
}): BitemporalResolutionResult {
  const candidates = BITEMPORAL_PROVISION_VERSIONS.filter((v) => v.provision_id === params.provision_id);
  if (candidates.length === 0) {
    return {
      provision_id: params.provision_id,
      legal_as_of: params.legal_as_of,
      known_as_of: params.known_as_of,
      outcome: "abstained",
      resolved_version: null,
      upcoming_published_versions: [],
      missing_facts_required: [],
      uncertainty_reasons: ["incomplete_corpus"],
      explanation: `No canonical provision versions registered for '${params.provision_id}'.`,
    };
  }

  // Step 1: Filter by recorded_interval (what REG24 knew as of known_as_of)
  const knownCandidates = candidates.filter((v) =>
    isDateInHalfOpenInterval(params.known_as_of, v.recorded_interval)
  );

  // Step 2: Filter by legal_validity (what was in force in the world on legal_as_of)
  const applicable = knownCandidates.filter((v) =>
    isDateInHalfOpenInterval(params.legal_as_of, v.legal_validity)
  );

  // Check for published but not-yet-effective versions known at known_as_of (Fixture 1)
  const upcoming = knownCandidates.filter(
    (v) => v.legal_validity.from > params.legal_as_of
  );

  if (applicable.length === 0) {
    return {
      provision_id: params.provision_id,
      legal_as_of: params.legal_as_of,
      known_as_of: params.known_as_of,
      outcome: "abstained",
      resolved_version: null,
      upcoming_published_versions: upcoming,
      missing_facts_required: [],
      uncertainty_reasons: ["unclear_temporal_effect"],
      explanation: `No version of ${params.provision_id} was legally in force on ${params.legal_as_of} as known on ${params.known_as_of}.`,
    };
  }

  // Pick the most recently recorded version among applicable candidates
  const chosen = applicable[applicable.length - 1];

  // Check Fixture 5: Competing source assertions on commencement
  if (chosen.competing_source_conflict) {
    return {
      provision_id: params.provision_id,
      legal_as_of: params.legal_as_of,
      known_as_of: params.known_as_of,
      outcome: "needs_review",
      resolved_version: chosen,
      upcoming_published_versions: upcoming,
      missing_facts_required: [],
      conflict_details: chosen.competing_source_conflict,
      uncertainty_reasons: ["conflicting_authority", "unclear_temporal_effect"],
      explanation: `Competing sources disagree on commencement for ${params.provision_id}: (${chosen.competing_source_conflict.source_a_claim}) vs (${chosen.competing_source_conflict.source_b_claim}). Escalated to legal review.`,
    };
  }

  // Check Fixture 4: Transitional rule requiring specific fact (e.g. contract_date)
  if (chosen.transitional_condition) {
    const reqKey = chosen.transitional_condition.required_fact_key;
    const factVal = params.supplied_facts?.[reqKey];
    if (factVal === undefined || factVal === null || String(factVal).trim() === "") {
      return {
        provision_id: params.provision_id,
        legal_as_of: params.legal_as_of,
        known_as_of: params.known_as_of,
        outcome: "needs_information",
        resolved_version: chosen,
        upcoming_published_versions: upcoming,
        missing_facts_required: [reqKey],
        uncertainty_reasons: ["missing_fact"],
        explanation: `Transitional rule on ${params.provision_id} depends on '${reqKey}' (${chosen.transitional_condition.description}). Supply '${reqKey}' to resolve applicability.`,
      };
    }
  }

  return {
    provision_id: params.provision_id,
    legal_as_of: params.legal_as_of,
    known_as_of: params.known_as_of,
    outcome: "complete",
    resolved_version: chosen,
    upcoming_published_versions: upcoming,
    missing_facts_required: [],
    uncertainty_reasons: [],
    explanation: `Resolved ${chosen.id} (${chosen.version_basis}) valid [${chosen.legal_validity.from}, ${chosen.legal_validity.to ?? "∞"}) and known as of ${params.known_as_of}.`,
  };
}

/**
 * TIME04: Consolidated Instrument View preserving independent section histories (Fixture 3)
 */
export function buildConsolidatedInstrumentView(params: {
  provision_ids: string[];
  legal_as_of: string;
  known_as_of: string;
}): Array<{
  provision_id: string;
  version_id: string | null;
  version_basis: string | null;
  effective_from: string | null;
  text: string | null;
  evidence_hash: string | null;
}> {
  return params.provision_ids.map((pid) => {
    const res = evaluateBitemporalProvision({
      provision_id: pid,
      legal_as_of: params.legal_as_of,
      known_as_of: params.known_as_of,
    });
    return {
      provision_id: pid,
      version_id: res.resolved_version?.id ?? null,
      version_basis: res.resolved_version?.version_basis ?? null,
      effective_from: res.resolved_version?.legal_validity.from ?? null,
      text: res.resolved_version?.text ?? null,
      evidence_hash: res.resolved_version?.text_hash ?? null,
    };
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 13 (INTEL06): REVIEWED OBLIGATION RULE PACK EVALUATION
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const CANONICAL_OBLIGATION_RULES: CanonicalObligationRule[] = [
  {
    id: "RULE-TH-SSO-033",
    jurisdiction: "TH",
    domain: "labor",
    rule_version: "SR-SSO-033.v1.0",
    title: "Social Security Act B.E. 2533 Section 33 & 34 Employer Registration",
    trigger: "Hiring one or more employees under an employment contract in Thailand",
    required_facts: ["employer_in_thailand", "contract_type", "employee_age"],
    conditions: [
      {
        condition_id: "COND-1",
        fact_key: "employer_in_thailand",
        operator: "eq",
        expected_value: true,
        description: "Works for an employer located in Thailand",
      },
      {
        condition_id: "COND-2",
        fact_key: "contract_type",
        operator: "eq",
        expected_value: "employment_contract",
        description: "Employed under a contract of employment (not independent contractor)",
      },
      {
        condition_id: "COND-3",
        fact_key: "employee_age",
        operator: "gte",
        expected_value: 15,
        description: "Employee age is at least 15 years old and not over 60 at entry",
      },
    ],
    exceptions: ["Independent contractors under hire-of-work (CCC Sec. 587)"],
    responsible_role: "Employer HR / Legal Compliance",
    rule_basis: "PROV-TH-SSA-033",
    reviewer: "LCT-REV-001",
    status: "reviewed_executable",
  },
  {
    id: "RULE-TH-PDPA-023",
    jurisdiction: "TH",
    domain: "pdpa",
    rule_version: "SR-PDPA-023.v1.0",
    title: "PDPA B.E. 2562 Section 23 & 24 Privacy Notice & Lawful Basis",
    trigger: "Collection of personal data from data subjects in Thailand",
    required_facts: ["collects_personal_data", "has_lawful_basis", "notice_given_at_collection"],
    conditions: [
      {
        condition_id: "COND-PDPA-1",
        fact_key: "collects_personal_data",
        operator: "eq",
        expected_value: true,
        description: "Entity collects personal data of individuals",
      },
      {
        condition_id: "COND-PDPA-2",
        fact_key: "has_lawful_basis",
        operator: "eq",
        expected_value: true,
        description: "Documented lawful basis under Section 24 (consent, contract, legal obligation, legitimate interest)",
      },
      {
        condition_id: "COND-PDPA-3",
        fact_key: "notice_given_at_collection",
        operator: "eq",
        expected_value: true,
        description: "Section 23 privacy notice provided prior to or at collection",
      },
    ],
    exceptions: ["Data subject already knows all required Section 23 particulars"],
    responsible_role: "Data Protection Officer (DPO) / Data Controller",
    rule_basis: "PROV-TH-PDPA-023",
    reviewer: "LCT-REV-002",
    status: "reviewed_executable",
  },
];

export function evaluateCanonicalObligationRule(
  rule: CanonicalObligationRule,
  facts: Record<string, string | number | boolean | undefined>
): {
  rule_id: string;
  rule_version: string;
  outcome: Reg24OutcomeStatus;
  evaluation_status: "applicable_compliant" | "not_applicable" | "conditional_missing_facts" | "candidate_unapproved";
  missing_facts: string[];
  condition_results: Array<{ condition_id: string; status: "met" | "not_met" | "unknown"; description: string }>;
} {
  if (rule.status !== "reviewed_executable") {
    return {
      rule_id: rule.id,
      rule_version: rule.rule_version,
      outcome: "needs_review",
      evaluation_status: "candidate_unapproved",
      missing_facts: [],
      condition_results: [],
    };
  }

  const missing: string[] = [];
  const condResults: Array<{ condition_id: string; status: "met" | "not_met" | "unknown"; description: string }> = [];

  for (const c of rule.conditions) {
    const val = facts[c.fact_key];
    if (val === undefined || val === null || val === "") {
      missing.push(c.fact_key);
      condResults.push({ condition_id: c.condition_id, status: "unknown", description: c.description });
      continue;
    }
    let met = false;
    if (c.operator === "eq") met = val === c.expected_value;
    else if (c.operator === "gte") met = Number(val) >= Number(c.expected_value);
    else if (c.operator === "lte") met = Number(val) <= Number(c.expected_value);
    else if (c.operator === "in" && Array.isArray(c.expected_value)) met = c.expected_value.includes(val as string | number);

    condResults.push({
      condition_id: c.condition_id,
      status: met ? "met" : "not_met",
      description: c.description,
    });
  }

  if (condResults.some((r) => r.status === "not_met")) {
    return {
      rule_id: rule.id,
      rule_version: rule.rule_version,
      outcome: "complete",
      evaluation_status: "not_applicable",
      missing_facts: [],
      condition_results: condResults,
    };
  }

  if (missing.length > 0) {
    return {
      rule_id: rule.id,
      rule_version: rule.rule_version,
      outcome: "needs_information",
      evaluation_status: "conditional_missing_facts",
      missing_facts: missing,
      condition_results: condResults,
    };
  }

  return {
    rule_id: rule.id,
    rule_version: rule.rule_version,
    outcome: "complete",
    evaluation_status: "applicable_compliant",
    missing_facts: [],
    condition_results: condResults,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION 16 (MISSION04): DEADLINE CALCULATOR WITH THAI HOLIDAYS
 * Returns a proposed date requiring review rather than an authoritative deadline.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function calculateJurisdictionDeadline(params: {
  jurisdiction: string;
  trigger_date_iso: string;
  statutory_days: number;
  rule_pack_id: string;
  rule_pack_validated?: boolean;
}): {
  jurisdiction: string;
  trigger_date_iso: string;
  statutory_days: number;
  proposed_deadline_iso: string;
  adjusted_for_holidays_and_weekends: string[];
  status: "proposed_date_requiring_review" | "validated_deadline";
  outcome: Reg24OutcomeStatus;
  disclaimer: string;
} {
  const pack = JURISDICTION_PACK_REGISTRY[params.jurisdiction] ?? JURISDICTION_PACK_REGISTRY.TH;
  const start = new Date(`${params.trigger_date_iso}T00:00:00Z`);
  const target = new Date(start.getTime() + params.statutory_days * 86400000);
  const adjustments: string[] = [];

  // Roll forward if landing on weekend or official jurisdiction holiday
  for (let i = 0; i < 10; i++) {
    const iso = target.toISOString().slice(0, 10);
    const dayOfWeek = target.getUTCDay();
    if (dayOfWeek === 6) {
      adjustments.push(`${iso} (Saturday -> rolled forward)`);
      target.setUTCDate(target.getUTCDate() + 2);
      continue;
    }
    if (dayOfWeek === 0) {
      adjustments.push(`${iso} (Sunday -> rolled forward)`);
      target.setUTCDate(target.getUTCDate() + 1);
      continue;
    }
    if (pack.holidays_iso.includes(iso)) {
      adjustments.push(`${iso} (Public Holiday in ${params.jurisdiction} -> rolled forward)`);
      target.setUTCDate(target.getUTCDate() + 1);
      continue;
    }
    break;
  }

  const finalIso = target.toISOString().slice(0, 10);
  return {
    jurisdiction: params.jurisdiction,
    trigger_date_iso: params.trigger_date_iso,
    statutory_days: params.statutory_days,
    proposed_deadline_iso: finalIso,
    adjusted_for_holidays_and_weekends: adjustments,
    status: "proposed_date_requiring_review",
    outcome: "needs_review",
    disclaimer:
      "MISSION04: Proposed deadline calculated using jurisdiction holiday calendar. Requires professional review of service dates and statutory exceptions before reliance.",
  };
}
