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
  | "CONDITIONAL_ON"
  | "SUPPORTED_BY"
  | "CONFLICTS_WITH";

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
