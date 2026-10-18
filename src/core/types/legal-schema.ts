/**
 * REG24 — Canonical Data Model & Shared Schema (REG-DATA-001 to 004, REG-MOD-001 to 003, REG-GRAPH-001)
 */

export type ModuleState =
  | "created"
  | "ingesting"
  | "draft"
  | "validated"
  | "published"
  | "deprecated"
  | "archived";

export type RuleLifecycleState =
  | "extracted"
  | "proposed"
  | "legally_verified"
  | "executable_approved"
  | "suspended"
  | "superseded";

export type ApplicabilityOutcome =
  | "applicable"
  | "not_applicable"
  | "conditional"
  | "requires_review"
  | "unknown";

export type GraphRelationshipType =
  | "PART_OF"
  | "AMENDS"
  | "REPEALS"
  | "SUPERSEDES"
  | "DERIVES_AUTHORITY_FROM"
  | "ISSUED_BY"
  | "APPLIES_TO"
  | "REQUIRES"
  | "EXEMPTS"
  | "REFERENCES"
  | "INTERPRETS"
  | "CONDITIONAL_ON"
  | "SUPPORTED_BY"
  | "CONFLICTS_WITH";

export type UserRole =
  | "Platform Administrator"
  | "Module Maintainer"
  | "Legal Reviewer"
  | "Source Operator"
  | "API Developer"
  | "Read-only Auditor";

export type BOIPromotionState =
  | "potential_eligibility_evaluated"
  | "application_submitted"
  | "boi_approved_pending_certificate"
  | "promotion_certificate_issued"
  | "incentive_entitlement_verified"
  | "not_eligible";

export interface Jurisdiction {
  id: string;
  code: string; // e.g., "TH"
  name_th: string;
  name_en: string;
}

export interface Regulator {
  id: string;
  code: string; // e.g., "DBD", "RD", "MOL", "BOI", "OCS"
  name_th: string;
  name_en: string;
  official_url: string;
  jurisdiction_id: string;
}

export interface SourceDocument {
  id: string;
  title_th: string;
  title_en: string;
  regulator_id: string;
  official_url: string;
  sha256_hash: string;
  publication_date: string; // ISO date
  acquired_at: string; // System knowledge time
  verified_at: string;
  immutable_locked: boolean; // REG-SEC-002
  mime_type: string;
  status: "verified" | "parsing_failed" | "pending_verification";
}

export interface SourceEvidence {
  id: string;
  source_document_id: string;
  sha256_hash: string;
  official_url: string;
  page_number?: number;
  citation_locator: string; // e.g., "Royal Gazette Vol. 139 Part 69 Kor, p. 12"
  verified_by: string;
}

export interface LegalInstrument {
  id: string; // Stable internal ID e.g., "inst.th.ccc"
  canonical_owner_module: string; // e.g., "reg24.civil.th"
  type: "code" | "act" | "royal_decree" | "ministerial_regulation" | "announcement" | "notification" | "ruling";
  title_th: string;
  title_en: string;
  short_code: string; // e.g., "CCC", "PLCA", "FBA", "RC", "LPA", "IPA"
  regulator_id: string;
  jurisdiction_id: string;
  enacted_date: string;
  effective_date: string;
  repealed_date?: string;
  source_document_id: string;
}

export interface TranslationRepresentation {
  language: "en";
  text: string;
  origin: "official_government" | "reviewed_legal_translation" | "ai_assisted_draft";
  is_official: boolean;
  is_authentic_enacted: false; // REG-DATA-004: English translations are never authentic enacted Thai law
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface Provision {
  id: string; // Stable across amendments e.g., "prov.th.ccc.1097"
  instrument_id: string;
  canonical_owner_module: string; // REG-CORE-003: Single canonical owner
  section_number: string; // e.g., "1097", "383", "118"
  book?: string;
  title?: string;
  chapter?: string;
  heading_th: string;
  heading_en: string;
  current_version_id: string;
  version_ids: string[];
  concept_ids: string[];
  executable_rule_ids: string[];
}

export interface ProvisionVersion {
  id: string; // Separate version ID e.g., "ver.th.ccc.1097.v2566"
  provision_id: string;
  version_number: string; // e.g., "B.E. 2566 (2023 Amendment)"
  text_th: string; // Authoritative Thai text (REG-DATA-004)
  translation_en: TranslationRepresentation;
  publication_date: string;
  effective_from: string; // Legal effective time start
  effective_to?: string; // null/undefined if currently in force
  known_from: string; // System knowledge time (REG-DATA-002)
  verified_at: string;
  supersedes_version_id?: string;
  superseded_by_version_id?: string;
  transitional_note?: string;
  source_evidence: SourceEvidence;
}

export interface ModuleReference {
  id: string;
  module_id: string; // e.g., "reg24.corporate.th"
  provision_id: string; // e.g., "prov.th.ccc.1097" (owned by reg24.civil.th)
  relationship_role: "canonical_owner" | "domain_consumer" | "cross_module_dependency";
  domain_interpretation_th: string;
  domain_interpretation_en: string;
  applicability_notes: string;
}

export interface LegalConcept {
  id: string;
  code: string;
  label_th: string;
  label_en: string;
  domain: string;
  description: string;
}

export interface Obligation {
  id: string;
  module_id: string;
  provision_id: string;
  title_th: string;
  title_en: string;
  obligated_party: string; // e.g., "Limited Company / Board of Directors"
  prerequisite_trigger: string;
  action_required: string;
  filing_deadline?: string;
  regulator_id: string;
  statutory_vs_constitutional: "statutory_obligation" | "constitutional_article_option" | "case_specific_interpretation";
  penalties_summary?: string;
}

export interface Condition {
  id: string;
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "exists";
  value: unknown;
  description: string;
}

export interface Exception {
  id: string;
  code: string;
  description_en: string;
  description_th: string;
  provision_id: string;
  condition_summary: string;
}

export interface ReviewDecision {
  id: string;
  target_type: "rule" | "module" | "provision_version" | "regulatory_change";
  target_id: string;
  reviewer_name: string;
  reviewer_role: UserRole;
  decision: "approved" | "rejected" | "requires_revision";
  notes: string;
  decided_at: string;
}

export interface RuleTestFixture {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  expected_outcome: ApplicabilityOutcome;
  expected_values?: Record<string, unknown>;
}

export interface RuleDefinition {
  id: string; // e.g., "rule.th.corporate.incorporation_promoters"
  module_id: string;
  name_en: string;
  name_th: string;
  description: string;
  provision_ids: string[];
  version: string;
  lifecycle_state: RuleLifecycleState;
  effective_from: string;
  effective_to?: string;
  input_schema: {
    required: string[];
    properties: Record<string, { type: string; description: string }>;
  };
  conditions: Condition[];
  exceptions: Exception[];
  review_record?: ReviewDecision;
  test_fixtures: RuleTestFixture[];
  output_explanation_template: string;
}

export interface RuleEvaluation {
  evaluation_id: string;
  trace_id: string;
  rule_id: string;
  rule_version: string;
  module_id: string;
  outcome: ApplicabilityOutcome;
  calculated_result: Record<string, unknown>;
  explanation: string;
  missing_facts: string[];
  citations: {
    provision_id: string;
    section_number: string;
    instrument_title: string;
    version_id: string;
    official_url: string;
    citation_locator: string;
  }[];
  review_approval_verified: boolean;
  evaluated_at: string;
  as_of_date: string;
}

export interface GraphEdge {
  id: string;
  source_id: string; // provision_id, instrument_id, or concept_id
  target_id: string;
  relationship: GraphRelationshipType;
  source_module: string;
  target_module: string;
  valid_from_version: string;
  valid_to_version?: string;
  provenance_citation: string;
  verified: boolean;
  conflict_flagged?: boolean;
  conflict_notes?: string;
}

export interface RegulatoryChange {
  id: string;
  title_en: string;
  title_th: string;
  change_type:
    | "new_legislation"
    | "amendment"
    | "repeal"
    | "subordinate_regulation"
    | "announcement"
    | "guidance_change"
    | "boi_activity_change"
    | "commencement_date_change";
  detected_at: string;
  effective_date: string;
  source_document_id: string;
  affected_instrument_ids: string[];
  affected_provision_ids: string[];
  impacted_module_ids: string[];
  potentially_affected_rule_ids: string[];
  potentially_affected_obligation_ids: string[];
  review_status: "queued_for_review" | "under_legal_review" | "verified_and_propagated";
  required_actions: string[];
}

export interface ModuleManifest {
  module_id: string;
  display_name: string;
  display_name_th: string;
  version: string;
  jurisdiction: string;
  legal_domains: string[];
  source_registry: {
    name: string;
    url: string;
    regulator_code: string;
    check_interval_hours: number;
    last_checked_at: string;
    last_check_status: "ok" | "access_degraded" | "parsing_error";
  }[];
  supported_capabilities: string[];
  dependency_modules: string[];
  ontology_version: string;
  ruleset_version: string;
  schema_version: string;
  source_coverage: {
    approved_instruments_target: number;
    ingested_instruments_count: number;
    provisions_indexed: number;
    executable_rules_approved: number;
    provision_boundary_accuracy_pct: number;
    known_limitations: string[];
  };
  review_status: ModuleState;
  published_at: string;
  maintainer: string;
  permissions: {
    read_roles: UserRole[];
    write_roles: UserRole[];
    approve_roles: UserRole[];
  };
  test_suite: {
    validation_cases: string[];
    pass_rate_pct: number;
  };
  metro_tile: {
    accent_hex: string;
    tile_size: "1x1" | "2x1" | "2x2";
    icon_name: string;
    short_code: string;
  };
}

export interface BusinessContext {
  tenant_id: string;
  entity_type?: "thai_limited_company" | "public_limited_company" | "foreign_branch" | "partnership" | "individual";
  facts: Record<string, unknown>;
  as_of_date: string;
  known_at_date?: string;
}

export interface ModuleRelease {
  release_id: string;
  module_id: string;
  version: string;
  previous_version?: string;
  state: ModuleState;
  released_at: string;
  released_by: string;
  changelog: string;
}

export interface AuditTraceEvent {
  trace_id: string;
  timestamp: string;
  tenant_id: string;
  actor_role: UserRole;
  operation: string;
  module_ids: string[];
  module_versions: Record<string, string>;
  provisions_accessed: string[];
  rules_evaluated: string[];
  prompt_injection_checked: boolean;
  prompt_injection_blocked: boolean;
  latency_ms: number;
  status: "success" | "blocked" | "requires_review" | "error";
  summary: string;
}
