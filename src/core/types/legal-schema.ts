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
  | "CONTAINS"
  | "PART_OF"
  | "AMENDS"
  | "REPEALS"
  | "SUPERSEDES"
  | "IMPLEMENTS"
  | "REFERS_TO"
  | "TRIGGERS"
  | "REQUIRES_APPROVAL"
  | "REQUIRES_DISCLOSURE"
  | "DEPENDS_ON"
  | "DERIVES_AUTHORITY_FROM"
  | "ISSUED_BY"
  | "APPLIES_TO"
  | "REQUIRES"
  | "EXEMPTS"
  | "EXCEPTION_TO"
  | "EFFECTIVE_DURING"
  | "REFERENCES"
  | "INTERPRETS"
  | "CITES"
  | "APPLIES_TO_FACTS"
  | "CLARIFIES"
  | "CONTRADICTS"
  | "RELATED_TO"
  | "REQUIRES_CONDITION"
  | "INTERPRETATION_CHANGED_BY"
  | "CONDITIONAL_ON"
  | "SUPPORTED_BY"
  | "CONFLICTS_WITH"
  | "CASE_CITES_CASE"
  | "CASE_INTERPRETS_SECTION"
  | "CASE_ADDRESSES_ISSUE"
  | "CASE_APPLIES_VERSION"
  | "RULING_INTERPRETS_SECTION"
  | "SECTION_AMENDED_BY"
  | "CASE_RELATED_TO_CASE"
  | "CASE_DISTINGUISHES_CASE"
  | "CASE_OVERRULES_CASE"
  | "DOCUMENT_PUBLISHED_BY";

export type TaxDocumentAuthorityClass =
  | "primary_legislation"
  | "delegated_binding_regulation"
  | "formal_statutory_interpretation"
  | "judicial_decision"
  | "administrative_order_or_guidance"
  | "fact_specific_administrative_opinion"
  | "non_authoritative_explanatory_material";

export type TaxInstrumentCategory =
  | "Revenue Code"
  | "Emergency Decree (Top-up Tax)"
  | "Royal Decree"
  | "Ministerial Regulation"
  | "Ministry of Finance Notification"
  | "Director-General Notification"
  | "Revenue Department Order (Tor.Por. / Paw.)"
  | "Tax Ruling Committee Decision"
  | "Revenue Department Explanation"
  | "Tax Consultation Letter"
  | "Supreme Court Tax Judgment";

export type RegulatoryBindingStatus =
  | "binding_enacted"
  | "consultation_draft_non_binding"
  | "repealed"
  | "superseded";

export type AgenticExecutionMode = "single_agent" | "agent_team" | "agent_swarm";

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
  code: string; // e.g., "DBD", "RD", "MOL", "BOI", "OCS", "SEC", "SET", "LED"
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
  regulatory_binding_status?: RegulatoryBindingStatus; // CORE-03: Separate consultation/draft papers from binding law
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

export interface ProvisionClause {
  clause_id: string; // e.g., "clause.th.pdpa.24.1"
  clause_number: string; // e.g., "(1)", "Paragraph 2", "Clause 5(3)"
  text_th: string;
  text_en: string;
  legal_effect: "obligation" | "lawful_basis" | "exception" | "condition" | "refusal_ground" | "penalty";
}

export interface ProvisionVersion {
  id: string; // Separate version ID e.g., "ver.th.ccc.1097.v2566"
  provision_id: string;
  version_number: string; // e.g., "B.E. 2566 (2023 Amendment)"
  text_th: string; // Authoritative Thai text (REG-DATA-004)
  translation_en: TranslationRepresentation;
  clauses?: ProvisionClause[]; // Clause-level legal indexing (PDPA Deliverable 2)
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
  enforcement_consequences?: {
    civil_liability?: string;
    criminal_penalty?: string;
    administrative_fine_max_thb?: number;
    enforcement_provision_id?: string;
  };
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
  privacy_by_design_redacted?: boolean;
  pii_redacted_fields?: string[];
  latency_ms: number;
  status: "success" | "blocked" | "requires_review" | "error";
  summary: string;
}

// ============================================================================
// AGENT-TO-AGENT (A2A) PROTOCOL v1.0 INFRASTRUCTURE (REG-A2A-001 TO REG-A2A-009)
// ============================================================================

export type A2ATaskLifecycleState =
  | "submitted"
  | "working"
  | "input_required"
  | "completed"
  | "canceled"
  | "failed";

export type A2APriorityTier = "P0_A2A_READY_FOUNDATION" | "P1_PRODUCTION_A2A_GATEWAY" | "P2_MULTI_AGENT_FEDERATION";

/**
 * REG-A2A-003: Standard Evidence & Citation Envelope shared across all modules, MCP tools, and A2A tasks
 */
export interface A2AEvidenceEnvelope {
  envelope_id: string;
  trace_id: string;
  as_of_date: string;
  known_at_date: string;
  module_versions: Record<string, string>;
  verified_provisions: {
    provision_id: string;
    instrument_short_code: string;
    section_number: string;
    canonical_owner_module: string;
    referencing_module: string;
    version_id: string;
    text_th: string;
    text_en: string;
    citation_locator: string;
    official_url: string;
    sha256_hash: string;
  }[];
  deterministic_evaluations: {
    rule_id: string;
    rule_version: string;
    module_id: string;
    outcome: ApplicabilityOutcome;
    calculated_result: Record<string, unknown>;
    explanation: string;
    human_approval_verified: boolean;
  }[];
  unresolved_questions: string[];
  coverage_gaps: {
    domain: string;
    missing_module_or_scope: string;
    recommendation: string;
  }[];
  human_review_required: boolean;
}

export interface A2ADomainStepResult {
  step_number: number;
  module_id: string;
  module_display_name: string;
  focus_area: string;
  status: "completed" | "partial_coverage" | "requires_review";
  provisions_checked: string[];
  rule_evaluated?: string;
  rule_outcome?: ApplicabilityOutcome;
  findings_summary: string;
  conditions_and_prerequisites: string[];
  unresolved_or_external_scope?: string;
}

/**
 * REG-A2A-001 & REG-A2A-002: Durable A2A Task Contract & Lifecycle State
 */
export interface A2ATaskContract {
  task_id: string; // Durable task ID (REG-A2A-002)
  session_id: string;
  protocol_version: "A2A-1.0.0";
  priority_tier: A2APriorityTier;
  delegating_agent: {
    agent_id: string; // e.g., "agent.law24.orchestrator", "agent.cfo24.tax", "agent.vibe24.workflow", "agent.external.counsel"
    tenant_id: string;
    scoped_role: UserRole;
    authenticated: boolean;
  };
  receiving_agent_id: "reg24.legal_task_agent"; // Single coordinating Legal Task Agent backed by the 6 domain modules
  objective: string;
  structured_facts: Record<string, unknown>;
  requested_domains: string[];
  state: A2ATaskLifecycleState;
  progress_pct: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  canceled_at?: string;
  domain_steps: A2ADomainStepResult[];
  artifacts: {
    artifact_id: string;
    name: string;
    mime_type: "application/json" | "text/markdown";
    summary: string;
    data: Record<string, unknown>;
  }[];
  evidence_envelope: A2AEvidenceEnvelope;
}

/**
 * REG-A2A-005: Official A2A v1.0 Agent Card (/.well-known/agent.json)
 */
export interface A2AAgentCard {
  name: string;
  id: string;
  description: string;
  version: string;
  protocol_version: "1.0.0";
  url: string;
  documentation_url: string;
  provider: {
    organization: string;
    jurisdiction: string;
    architecture_principle: string;
  };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
    asynchronousTasks: boolean;
    taskCancellation: boolean;
  };
  authentication: {
    schemes: string[];
    tenantIsolation: boolean;
    scopedPermissions: string[];
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  backed_by_domain_modules: string[]; // The 6 modules remain domain modules, NOT 6 separate agents
  skills: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
  }[];
}

// ============================================================================
// REG24-P0-GRAPH-001 — 3R ARCHITECTURE (R1 HYBRID GRAPHRAG • R2 REASONING • R3 REVIEW)
// ============================================================================

export interface CourtDecision {
  id: string; // e.g., "case.th.dika.8790_2563"
  case_number: string;
  court_name_th: string;
  court_name_en: string;
  decision_date: string;
  jurisdiction_id: string;
  module_id: string;
  title_th: string;
  title_en: string;
  holding_summary_th: string;
  holding_summary_en: string;
  interpreted_provision_ids: string[];
  official_citation: string;
  verified: boolean;
}

export interface GraphRAGHopNode {
  hop_depth: number;
  node_id: string;
  node_type: "Provision" | "LegalInstrument" | "Amendment" | "CourtDecision";
  module_id: string;
  label: string;
  via_relationship: GraphRelationshipType | "DIRECT_VECTOR_KEYWORD_HIT";
  from_node_id: string;
  version_id?: string;
  effective_from?: string;
  effective_to?: string;
  verified_edge: boolean;
  citation_locator: string;
}

export interface ThreeRGraphRAGResponse {
  query: string;
  jurisdiction_id: string;
  as_of_date: string;
  known_at_date: string;
  architecture_pipeline: "3R_HYBRID_GRAPHRAG_V1";
  r1_retrieval_graphrag: {
    engine: string;
    vector_keyword_candidates_count: number;
    multi_hop_nodes_traversed: GraphRAGHopNode[];
    relationships_followed: GraphRelationshipType[];
    linked_court_decisions: CourtDecision[];
    version_filter_applied: {
      as_of_date: string;
      known_at_date: string;
      regulatory_status_filter: string;
    };
    ai_inferred_edges_quarantined: {
      edge_id: string;
      relationship: GraphRelationshipType;
      reason: string;
    }[];
  };
  r2_reasoning_analysis: {
    statutory_interpretation: string;
    cross_law_analysis: {
      source_module: string;
      target_module: string;
      relationship: GraphRelationshipType;
      analysis: string;
    }[];
    fact_to_rule_matching: {
      matched_rule_ids: string[];
      deterministic_evaluations: {
        rule_id: string;
        module_id: string;
        outcome: ApplicabilityOutcome;
        calculated_result: Record<string, unknown>;
        explanation: string;
      }[];
    };
  };
  r3_review_verification: {
    engine: string;
    overall_verification_status: "verified" | "requires_human_review";
    citation_verification_passed: boolean;
    amendment_check_passed: boolean;
    effective_date_check_passed: boolean;
    contradiction_detection_passed: boolean;
    ai_inferred_relationships_quarantined: boolean;
    detected_conflicts: {
      edge_id: string;
      source_id: string;
      target_id: string;
      conflict_notes: string;
    }[];
    uncertainty_flags: string[];
    verified_legal_response_summary: string;
  };
}

// ============================================================================
// CAPITAL MARKETS, CORPORATE RESTRUCTURING & INSOLVENCY EXPANSION (v1.0 OCT 2026)
// REG-SEC (reg24.sec.th) • REG-SET (reg24.set.th) • REG-RESTRUCT (reg24.restruct.th) • REG-INSOLV (reg24.insolv.th)
// ============================================================================

export interface NonBindingConsultationItem {
  id: string;
  regulator_code: string;
  module_id: string;
  title_th: string;
  title_en: string;
  published_date: string;
  regulatory_binding_status: "consultation_draft_non_binding";
  summary_en: string;
  official_url: string;
  enforcement_block_reason: string;
}

export interface CrossModuleRestructuringMissionResult {
  mission_id: string;
  trace_id: string;
  execution_mode: AgenticExecutionMode;
  scenario_question: string;
  transaction_date: string;
  set_mt_rpt_regime_applied: "PRE_JULY_2026_REGIME" | "REVISED_1_JULY_2026_REGIME";
  activated_modules: {
    module_id: string;
    module_code: string;
    display_name: string;
    regulator_code: string;
    question_answered: string;
    provisions_cited: string[];
    deterministic_rule_id: string;
    rule_outcome: ApplicabilityOutcome;
    calculated_metrics: Record<string, unknown>;
    legal_findings: string;
  }[];
  alternative_structures: {
    structure_id: string;
    name: string;
    feasibility: "HIGH_FEASIBILITY_RECOMMENDED" | "CONDITIONAL_HIGH_EXECUTION_RISK" | "PROHIBITED_OR_INFEASIBLE";
    governing_laws: string[];
    required_approvals: string[];
    tax_implications: string;
    estimated_duration: string;
    shareholder_dilution_impact: string;
    creditor_impact: string;
    set_listing_preservation: string;
  }[];
  dependency_workflow: {
    step_order: number;
    phase: string;
    responsible_party: string;
    regulator_or_forum: string;
    trigger_event: string;
    deadline_calculation: string;
    governing_provision: string;
    depends_on_steps: number[];
    autonomous_submission_blocked: boolean;
  }[];
  draft_advisory_documents: {
    doc_id: string;
    doc_type: "SETLink_Disclosure_Draft" | "Board_Resolution_Draft" | "Rehabilitation_Plan_Term_Sheet" | "SEC_Exempt_Offering_Checklist";
    title: string;
    target_regulator: string;
    cited_provisions: string[];
    draft_excerpt: string;
    human_approval_required: true;
    autonomous_submission_permitted: false;
  }[];
  quarantined_non_binding_consultations: NonBindingConsultationItem[];
  risk_register_and_escalations: string[];
}

// ============================================================================
// TAX RULINGS & REVENUE CODE SUB-REGULATIONS EXPANSION (v1.1 OCT 2026)
// REG-TAX-SUB • REG-TAX-RULING • REG-TAX-CASE • REG-TAX-CHANGE
// ============================================================================

export interface TaxSubRegulationRecord {
  id: string;
  module_id: string;
  document_type: TaxInstrumentCategory;
  thai_terminology: string;
  reg24_treatment: string;
  authority_classification: TaxDocumentAuthorityClass;
  number_code: string; // e.g., "Royal Decree No. 10 (พ.ร.ฎ. ฉบับที่ 10)", "Ministerial Regulation No. 126 (กฎกระทรวง ฉบับที่ 126)"
  title_th: string;
  title_en: string;
  enabling_revenue_code_sections: string[]; // e.g., ["prov.th.rc.73_74", "prov.th.rc.77_1"]
  cross_referenced_provisions: string[]; // e.g., ["prov.th.ccc.1238_1243"]
  tax_subjects: string[]; // e.g., ["Corporate Income Tax", "VAT", "Specific Business Tax", "Stamp Duty", "Tax Restructuring"]
  publication_date: string;
  effective_from: string;
  effective_to?: string;
  transitional_provisions?: string;
  exemption_conditions: string[];
  summary_th: string;
  summary_en: string;
  official_url: string;
  binding_status: RegulatoryBindingStatus;
  verification_pipeline: {
    official_source_validated: boolean;
    thai_extraction_verified: boolean;
    section_validation_passed: boolean;
    effective_date_verified: boolean;
    human_legal_reviewed_by: string;
  };
}

export interface TaxRulingRecord {
  id: string;
  module_id: string;
  ruling_reference_number: string; // e.g., "กค 0702(กม.)/462" or "กค 0702(กม.)/453" or "คำวินิจฉัยที่ 40/2560"
  issue_date: string; // e.g., "2026-04-22"
  buddhist_era_year: number; // e.g., 2569
  document_type: "Tax Consultation Letter" | "Tax Ruling Committee Decision" | "Revenue Department Explanation";
  thai_terminology: string; // "ข้อหารือภาษีอากร" | "คำวินิจฉัยของคณะกรรมการวินิจฉัยภาษีอากร"
  authority_classification: TaxDocumentAuthorityClass;
  can_override_statute: false; // TAX-QUALITY-01: A tax consultation letter must never silently override a conflicting statutory provision
  subject_th: string;
  subject_en: string;
  tax_categories: string[];
  corporate_event_type: string; // e.g., "Company Merger (CCC Sec. 1238/1243 - One Survives, One Ceases)"
  facts_and_assumptions: string[];
  questions_referred: string[];
  revenue_code_sections_cited: string[]; // e.g., ["Section 73", "Section 74", "Section 77/1", "Section 65 bis (10)"]
  provision_ids_linked: string[];
  subregulation_ids_linked: string[]; // e.g., ["subreg.th.rd.royal_decree_10", "subreg.th.rd.min_reg_126"]
  administrative_analysis_th: string;
  administrative_analysis_en: string;
  conclusions_th: string;
  conclusions_en: string;
  follows_earlier_ruling_ref?: string; // e.g., "กค 0702(กม.)/453 (11 April 2025)"
  related_ruling_ids: string[];
  related_court_decision_ids: string[];
  official_url: string;
  publication_date: string;
  retrieved_at: string;
  legal_applicability_warning: string;
}

export interface TaxJudicialDecisionRecord {
  id: string;
  module_id: string;
  court_name: string; // e.g., "Supreme Court Tax Division (ศาลฎีกาแผนกคดีภาษีอากร)"
  case_number: string; // e.g., "คำพิพากษาศาลฎีกาที่ 5412/2565"
  judgment_date: string;
  authority_classification: "judicial_decision";
  tax_categories: string[];
  material_facts: string;
  legal_issues: string[];
  statutory_provisions_cited: string[];
  provision_ids_linked: string[];
  court_reasoning_th: string;
  court_reasoning_en: string;
  decision_outcome: string;
  related_rd_ruling_ids: string[];
  diverges_from_rd_interpretation: boolean;
  divergence_explanation: string;
  official_url: string;
}

export interface TaxFactComparisonResult {
  comparison_id: string;
  trace_id: string;
  scenario_title: string;
  queried_transaction_date: string;
  accounting_period: string;
  user_scenario_facts: Record<string, unknown>;
  focal_ruling: {
    ruling_id: string;
    reference_number: string;
    issue_date: string;
    subject_th: string;
    subject_en: string;
    authority_classification: TaxDocumentAuthorityClass;
    official_url: string;
    follows_earlier_ruling_ref?: string;
  };
  fact_comparison_matrix: {
    similarities: string[];
    material_differences: string[];
    depends_on_special_facts: string[];
    changes_in_law_since_ruling: string[];
    later_interpretations_affect_relevance: string;
  };
  article_to_regulation_to_ruling_graph: {
    civil_code_provisions: { section: string; role: string }[];
    revenue_code_sections: { section: string; provision_id: string; role: string }[];
    implementing_subregulations: {
      id: string;
      number_code: string;
      document_type: string;
      authority_classification: TaxDocumentAuthorityClass;
      role: string;
    }[];
    ruling_chain: {
      reference_number: string;
      issue_date: string;
      relationship: string;
      official_url: string;
    }[];
    judicial_decisions: {
      case_number: string;
      judgment_date: string;
      diverges_from_rd: boolean;
      summary: string;
    }[];
  };
  generated_tax_assessment: {
    merger_or_transaction_structure: string;
    applicable_tax_treatment_summary: string;
    exemption_conditions_checklist: string[];
    required_documentary_evidence: string[];
    legal_uncertainty_flags: string[];
    legal_applicability_warning: string;
    can_consultation_letter_override_statute: false;
    autonomous_tax_filing_permitted: false;
  };
}

// ============================================================================
// PDPA SCOPE EXPANSION (v1.2 OCT 2026) — MODULE REG24-PDPA (reg24.pdpa.th)
// PDPA B.E. 2562 • 2026 Access-Request Notification • Breach • DPO • Cross-Border
// ============================================================================

export interface PDPASubordinateRegulationRecord {
  id: string;
  module_id: string;
  regulation_code: string;
  title_th: string;
  title_en: string;
  buddhist_era_year: number;
  enabling_pdpa_sections: string[];
  publication_date: string;
  effective_from: string;
  key_requirements_th: string[];
  key_requirements_en: string[];
  official_url: string;
  sha256_hash: string;
  binding_status: RegulatoryBindingStatus;
}

export interface PDPAComplianceAssessmentResult {
  assessment_id: string;
  trace_id: string;
  tenant_id: string;
  evaluated_as_of_date: string;
  access_request_regime: "PRE_2026_BASELINE_DSAR" | "2026_PDPC_ACCESS_REQUEST_NOTIFICATION_REGIME";
  privacy_by_design_guard: {
    pii_minimization_applied: boolean;
    redacted_fields: string[];
    tenant_isolation_verified: boolean;
    sanitized_scenario_summary: string;
  };
  domain_evaluations: {
    applicability: {
      outcome: ApplicabilityOutcome;
      section_cited: string;
      basis_type: "domestic_establishment_sec_5_para_1" | "extraterritorial_offering_or_monitoring_sec_5_para_2" | "exempt_sec_4";
      explanation: string;
    };
    lawful_basis_and_consent: {
      outcome: ApplicabilityOutcome;
      section_cited: string;
      relied_basis: string;
      involves_sensitive_data_sec_26: boolean;
      consent_validity_sec_19_passed: boolean;
      explanation: string;
    };
    data_subject_access_request_2026: {
      outcome: ApplicabilityOutcome;
      section_cited: string;
      notification_applied: string;
      days_elapsed: number;
      statutory_max_days: 30;
      within_statutory_deadline: boolean;
      identity_verification_compliant: boolean;
      permissible_refusal_ground_applicable: boolean;
      explanation: string;
    };
    breach_notification: {
      outcome: ApplicabilityOutcome;
      section_cited: string;
      hours_since_discovery: number;
      statutory_pdpc_deadline_hours: 72;
      pdpc_notification_required: boolean;
      late_notification_violation: boolean;
      immediate_data_subject_notice_required: boolean;
      explanation: string;
    };
    dpo_designation: {
      outcome: ApplicabilityOutcome;
      section_cited: string;
      mandatory_dpo_required: boolean;
      dpo_appointed: boolean;
      trigger_reason: string;
      explanation: string;
    };
    cross_border_transfer: {
      outcome: ApplicabilityOutcome;
      section_cited: string;
      transfer_mechanism: string;
      lawful_transfer_verified: boolean;
      explanation: string;
    };
  };
  cross_module_dependencies: {
    target_module_id: string;
    relationship: GraphRelationshipType;
    target_provision_id: string;
    legal_impact_summary: string;
  }[];
  enforcement_exposure: {
    civil_liability_sec_77_78: string;
    criminal_penalty_sec_79_81: string;
    administrative_fine_sec_82_90_max_thb: number;
    referenced_pdpc_expert_committee_orders: {
      case_number: string;
      title_en: string;
      holding_summary_en: string;
    }[];
  };
  verified_citations: {
    provision_id: string;
    section_number: string;
    version_id: string;
    clause_ids_matched: string[];
    citation_locator: string;
    official_url: string;
    sha256_hash: string;
  }[];
  overall_compliance_status: "COMPLIANT" | "NON_COMPLIANT_ENFORCEMENT_RISK" | "REQUIRES_HUMAN_LEGAL_REVIEW";
  human_review_required: boolean;
}

// ============================================================================
// COURT CASE INTELLIGENCE & LEGAL PRECEDENT MODULE (v1.0 OCT 2026) — MODULE REG24-CASE (reg24.case.th)
// SDR Sections 1–18: 13 Services • Connectors • LegalCase • Graph RAG • 8-Step Agentic Research • Point-in-Time Law
// ============================================================================

export type CaseServiceId =
  | "CASE-SOURCE"
  | "CASE-INGEST"
  | "CASE-PARSER"
  | "CASE-NORMALIZER"
  | "CASE-VALIDATOR"
  | "CASE-GRAPH"
  | "CASE-INDEX"
  | "CASE-RETRIEVAL"
  | "CASE-REASONER"
  | "CASE-CITATION"
  | "CASE-MONITOR"
  | "CASE-API"
  | "CASE-TRACE";

export interface CaseServiceDescriptor {
  service_id: CaseServiceId;
  responsibility: string;
  implementation_mode: "logical_in_process_module_p0";
  shared_reg24_dependencies: string[];
  status: "operational" | "degraded";
}

export interface CaseSourceConnector {
  connector_id: string;
  source_name: string;
  source_name_th: string;
  priority_tier: "P0_MANDATORY" | "P1_SPECIALIST";
  base_url: string;
  data_scope: string;
  required_action: string;
  supported_formats: ("PDF" | "HTML" | "TXT" | "STRUCTURED_JSON")[];
  incremental_ingestion_enabled: boolean;
  manual_import_enabled: boolean;
  fingerprinting_and_dedup: "SHA256_CANONICAL_DEDUP";
  licensing_and_rights: {
    rights_status: "approved" | "restricted" | "unknown";
    redistribution_permitted: boolean;
    respects_robots_txt: true;
    retention_policy: string;
    access_permission_roles: UserRole[];
  };
  operational_status: {
    status: "active_verified" | "authorized_metadata_only" | "reused_internal_corpus" | "standby";
    last_sync_at: string;
    documents_ingested: number;
    duplicate_imports_skipped: number;
    failed_ingestions_isolated: number;
  };
}

export interface CaseIngestionJob {
  job_id: string;
  connector_id: string;
  source_name: string;
  started_at: string;
  completed_at: string;
  mode: "scheduled_incremental" | "manual_admin_import" | "connector_discovery";
  format: "PDF" | "HTML" | "TXT" | "STRUCTURED_JSON";
  status: "completed_verified" | "duplicate_skipped" | "isolated_failure" | "quarantined_prompt_injection";
  source_url: string;
  source_hash: string;
  canonical_case_id?: string;
  notes: string;
}

export interface StatuteReference {
  statute_id: string;
  provision_id: string;
  statute_name_th: string;
  statute_name_en: string;
  section_number: string;
  applied_version_id: string;
  effective_from: string;
  effective_to?: string;
  historical_version_warning?: string;
}

export interface CaseReference {
  target_case_id: string;
  case_number: string;
  court_name: string;
  relationship:
    | "CASE_CITES_CASE"
    | "CASE_DISTINGUISHES_CASE"
    | "CASE_OVERRULES_CASE"
    | "CASE_RELATED_TO_CASE";
  citation_context_note: string;
  verified: boolean;
}

export interface SourcePassageLink {
  passage_id: string;
  field_supported: "facts" | "disputed_issues" | "reasoning" | "outcome" | "case_summary";
  verbatim_quote_th: string;
  translation_en: string;
  locator: string;
  sha256_fragment_hash: string;
}

export interface LegalCase {
  id: string;
  jurisdiction: string;
  court_name: string;
  court_level: string;
  court_division?: string;

  case_number: string;
  judgment_number?: string;
  judgment_date?: string;
  publication_date?: string;
  transaction_or_event_date?: string;
  assessment_or_filing_date?: string;

  case_type: string;
  legal_domains: string[];
  legal_issues: string[];
  legal_issue_ids: string[];
  domain_pack: "P0_TAX_PACK" | "P0_CORPORATE_PACK" | "P1_INSOLVENCY_PACK" | "CROSS_DOMAIN_LABOR_PDPA_SEC";

  authority_distinction: {
    document_category:
      | "supreme_court_judgment"
      | "supreme_court_general_assembly_judgment"
      | "specialist_court_judgment"
      | "administrative_ruling";
    is_binding_statute: false;
    can_override_statute: false;
    precedent_weight_th: string;
    precedent_weight_en: string;
  };

  original_language: string;
  full_text?: string;
  case_summary?: string;
  is_ai_generated_summary: boolean;

  facts?: string;
  disputed_issues?: string[];
  reasoning?: string;
  outcome?: string;

  cited_statutes: StatuteReference[];
  cited_cases: CaseReference[];
  supporting_source_passages: SourcePassageLink[];

  source_name: string;
  source_url: string;
  source_document_id?: string;
  source_hash: string;

  text_completeness: "full" | "partial" | "summary_only";
  verification_status: "unverified" | "machine_verified" | "human_verified";
  rights_status: "approved" | "restricted" | "unknown";

  extraction_confidence: number;
  pdpa_redacted: boolean;
  ingestion_timestamp: string;
  last_verified_at?: string;
}

export type CaseGraphNodeType =
  | "LegalCase"
  | "Court"
  | "LegalIssue"
  | "Statute"
  | "StatuteSection"
  | "StatuteVersion"
  | "AdministrativeRuling"
  | "RegulatoryInstrument"
  | "LegalConcept"
  | "Organization"
  | "SourceDocument";

export interface CaseGraphNode {
  id: string;
  node_type: CaseGraphNodeType;
  label_th: string;
  label_en: string;
  module_id: string;
  metadata: Record<string, string | number | boolean>;
}

export interface CaseGraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relationship:
    | "CASE_CITES_CASE"
    | "CASE_INTERPRETS_SECTION"
    | "CASE_ADDRESSES_ISSUE"
    | "CASE_APPLIES_VERSION"
    | "RULING_INTERPRETS_SECTION"
    | "SECTION_AMENDED_BY"
    | "CASE_RELATED_TO_CASE"
    | "CASE_DISTINGUISHES_CASE"
    | "CASE_OVERRULES_CASE"
    | "DOCUMENT_PUBLISHED_BY";
  provenance_citation: string;
  confidence: number;
  extraction_method: "explicit_source_text" | "deterministic_parser" | "ai_inferred_quarantined";
  verification_status: "human_verified" | "machine_verified" | "unverified_ai_inferred";
  is_ai_inferred: boolean;
  notes?: string;
}

export interface CaseLegalIssueNode {
  id: string;
  code: string;
  title_th: string;
  title_en: string;
  domain: string;
  governing_statute_sections: string[];
  linked_case_ids: string[];
  has_conflicting_or_distinguished_decisions: boolean;
}

export interface CaseHybridSearchRequest {
  query?: string;
  retrieval_methods?: ("keyword" | "semantic" | "graph" | "metadata")[];
  filters?: {
    court?: string;
    date_from?: string;
    date_to?: string;
    legal_domain?: string;
    statute_or_section?: string;
    case_type?: string;
    domain_pack?: string;
    verification_status?: "unverified" | "machine_verified" | "human_verified";
    include_restricted?: boolean;
  };
  limit?: number;
  tenant_id?: string;
  role?: UserRole;
}

export interface CaseSearchResultItem {
  case_id: string;
  case_number: string;
  court: string;
  court_level: string;
  judgment_date: string;
  domain_pack: string;
  relevant_legal_issue: string;
  short_factual_summary: string;
  is_ai_generated_summary: boolean;
  relevant_statutory_provisions: {
    provision_id: string;
    section_number: string;
    statute_name_en: string;
    applied_version_id: string;
  }[];
  source_link: string;
  source_name: string;
  verification_status: "unverified" | "machine_verified" | "human_verified";
  text_completeness: "full" | "partial" | "summary_only";
  rights_status: "approved" | "restricted" | "unknown";
  authority_distinction_badge: string;
  matched_methods: ("keyword" | "semantic" | "graph" | "metadata")[];
  ranking_breakdown: {
    exact_issue_match_score: number;
    material_fact_similarity_score: number;
    statutory_version_relevance_score: number;
    court_authority_score: number;
    completeness_and_verification_score: number;
    total_relevance_score: number;
  };
}

export interface CaseHybridSearchResponse {
  trace_id: string;
  query: string;
  methods_executed: ("keyword" | "semantic" | "graph" | "metadata")[];
  total_hits: number;
  results: CaseSearchResultItem[];
  related_tax_rulings: {
    ruling_id: string;
    reference_number: string;
    issue_date: string;
    subject_th: string;
    subject_en: string;
    authority_classification: TaxDocumentAuthorityClass;
    official_url: string;
  }[];
}

export interface CaseComparisonResult {
  comparison_id: string;
  trace_id: string;
  compared_cases: {
    id: string;
    case_number: string;
    court_name: string;
    judgment_date: string;
    domain_pack: string;
    outcome: string;
    verification_status: string;
    text_completeness: string;
  }[];
  shared_statutory_provisions: {
    provision_id: string;
    section_number: string;
    statute_name_en: string;
    applied_versions: string[];
  }[];
  material_factual_similarities: string[];
  material_factual_differences: string[];
  judicial_reasoning_comparison: {
    dimension: string;
    case_a_position: string;
    case_b_position: string;
    legal_significance: string;
  }[];
  relationship_classification:
    | "DISTINGUISHED_ON_MATERIAL_FACTS"
    | "CONISTENT_PRECEDENT_LINE"
    | "CONFLICTING_INTERPRETATION_REQUIRES_REVIEW"
    | "HISTORICAL_STATUTE_AMENDMENT_DIVERGENCE";
  synthesis_conclusion: string;
  supporting_source_passages: SourcePassageLink[];
  human_review_required: boolean;
}

export interface HistoricalLawPointInTimeResult {
  trace_id: string;
  queried_provision_or_topic: string;
  timeline_dates: {
    transaction_date: string;
    assessment_date?: string;
    filing_date?: string;
    judgment_date?: string;
  };
  governing_date_used: string;
  historically_applicable_law: {
    provision_id: string;
    statute_name_th: string;
    statute_name_en: string;
    section_number: string;
    historical_version_id: string;
    effective_from: string;
    effective_to?: string;
    historical_rule_summary_th: string;
    historical_rule_summary_en: string;
    official_source_url: string;
  };
  current_law_comparison: {
    current_version_id: string;
    current_effective_from: string;
    differs_from_historical_law: boolean;
    amendment_instrument_title: string;
    material_change_warning: string;
  };
  illustrative_cases_applying_historical_version: {
    case_id: string;
    case_number: string;
    judgment_date: string;
    how_applied: string;
  }[];
}

export interface CaseCitationVerificationResult {
  trace_id: string;
  submitted_citation: string;
  submitted_statute_section?: string;
  submitted_quote?: string;
  claimed_overruled?: boolean;
  verified: boolean;
  verification_status:
    | "DETERMINISTICALLY_VERIFIED"
    | "UNVERIFIED_CITATION_NOT_FOUND"
    | "STATUTE_SECTION_MISMATCH"
    | "UNSUPPORTED_OVERRULING_CLAIM"
    | "QUOTE_NOT_IN_SOURCE_PASSAGES";
  hallucination_blocked: boolean;
  matched_case?: {
    id: string;
    case_number: string;
    court_name: string;
    judgment_date?: string;
    source_url: string;
    source_hash: string;
    text_completeness: "full" | "partial" | "summary_only";
    verification_status: "unverified" | "machine_verified" | "human_verified";
    rights_status: "approved" | "restricted" | "unknown";
  };
  checks_performed: {
    no_invented_judgment_number: boolean;
    no_invented_statutory_section: boolean;
    no_fabricated_quotation: boolean;
    no_unsupported_overruling_claim: boolean;
    resolves_to_stored_source_passage: boolean;
    restricted_content_policy_enforced: boolean;
  };
  explanation: string;
}

export interface CaseDataQualityMetrics {
  evaluated_at: string;
  benchmark_dataset_name: string;
  total_canonical_cases: number;
  metrics: {
    metadata_completeness_pct: number;
    duplicate_rate_pct: number;
    citation_validity_pct: number;
    source_coverage_pct: number;
    avg_extraction_confidence: number;
    statutory_link_accuracy_pct: number;
    human_review_verified_pct: number;
    source_freshness_hours: number;
    full_text_availability_pct: number;
  };
  release_thresholds: {
    min_metadata_completeness_pct: number;
    max_duplicate_rate_pct: number;
    min_citation_validity_pct: number;
    min_statutory_link_accuracy_pct: number;
  };
  all_release_thresholds_met: boolean;
}

export interface CaseAgenticResearchResponse {
  research_id: string;
  trace_id: string;
  scenario_code?: "SCENARIO_A_TAX_65_TER" | "SCENARIO_B_DIRECTOR_LIABILITY" | "SCENARIO_C_HISTORICAL_LAW" | "SCENARIO_D_UNSUPPORTED_CITATION" | "SCENARIO_E_CONFLICTING_CASES" | "CUSTOM_LEGAL_RESEARCH";
  workflow_steps_executed: {
    step_number: number;
    step_name: string;
    service_invoked: CaseServiceId;
    status: "completed" | "flagged_uncertainty";
    detail: string;
  }[];
  mandatory_research_memo: {
    question_presented: string;
    applicable_law: {
      provision_id: string;
      statute_name_th: string;
      statute_name_en: string;
      section_number: string;
      applied_version_id: string;
      effective_period: string;
      historical_warning?: string;
    }[];
    relevant_cases: {
      case_id: string;
      case_number: string;
      court_name: string;
      judgment_date: string;
      authority_category: string;
      outcome_summary: string;
      verification_status: string;
      text_completeness: string;
    }[];
    relevant_administrative_rulings: {
      ruling_id: string;
      reference_number: string;
      authority_classification: string;
      can_override_statute: false;
      summary_en: string;
    }[];
    material_factual_similarities_and_differences: {
      similarities: string[];
      differences: string[];
    };
    legal_analysis: string;
    conflicting_authorities_or_uncertainty: string[];
    conclusion: string;
    source_citations: {
      citation_id: string;
      source_type: "statute" | "supreme_court_judgment" | "specialist_court_judgment" | "administrative_ruling";
      reference_label: string;
      locator_or_passage: string;
      source_url: string;
      sha256_hash: string;
      verified: boolean;
    }[];
  };
  epistemic_classification: {
    directly_supported_findings: string[];
    reasonable_inferences: string[];
    unverified_assumptions: string[];
    missing_evidence: string[];
  };
  citation_verification_summary: {
    all_citations_verified: boolean;
    unverified_citations_blocked: string[];
    human_review_required: boolean;
  };
}



