/**
 * REG24 Infrastructure Developer Requirements v1.0 (30 October 2026)
 * Package: @reg24/contracts (packages/contracts)
 * Covers: ARC01–ARC06, AGN01–AGN06, API01–API04, CON01–CON06, INT01–INT07
 * Rule (ARC11): Pure TypeScript contracts — zero framework, DB driver, or model SDK imports.
 */

export type Reg24OutcomeStatus =
  | "complete"
  | "partial"
  | "abstained"
  | "needs_information"
  | "needs_review";

export type Reg24StandardErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "UNSUPPORTED_JURISDICTION"
  | "INSUFFICIENT_EVIDENCE"
  | "TEMPORAL_CONFLICT"
  | "STALE_SNAPSHOT"
  | "POLICY_DENIED"
  | "BUDGET_EXCEEDED"
  | "APPROVAL_REQUIRED"
  | "PROVIDER_UNAVAILABLE"
  | "VALIDATION_FAILED";

export type ClaimSupportKind = "factual" | "quoted" | "interpreted" | "inferred";

export type UncertaintyReasonCode =
  | "incomplete_corpus"
  | "missing_fact"
  | "conflicting_authority"
  | "low_quality_extraction"
  | "unclear_temporal_effect"
  | "unreviewed_interpretation";

export interface Reg24RequestConstraints {
  max_latency_ms?: number;
  max_cost_usd?: number;
  allowed_providers?: string[];
  require_pinned_evidence?: boolean;
  output_language?: "th" | "en" | "bilingual";
  allow_candidate_relationships?: boolean;
}

/**
 * CON01 & CON02: Canonical Request Envelope
 */
export interface Reg24CanonicalRequest<TPayload = Record<string, unknown>> {
  request_id: string;
  idempotency_key?: string;
  matter_id?: string;
  purpose?: string;
  jurisdiction: string;
  domain?: string;
  legal_as_of?: string;
  known_as_of?: string;
  input_refs?: string[];
  constraints?: Reg24RequestConstraints;
  corpus_snapshot_id?: string;
  payload: TPayload;
}

/**
 * CON02: Verified Authentication & Principal Context (resolved server-side, never trusted from body)
 */
export type PrincipalClass = "human_user" | "service_account" | "delegated_agent";

export type Reg24Role =
  | "tenant_administrator"
  | "matter_owner"
  | "legal_reviewer"
  | "analyst"
  | "integration_operator"
  | "auditor";

export interface DelegatedGrantContext {
  grant_id: string;
  principal_id: string;
  originating_principal_id: string;
  tenant_id: string;
  allowed_capabilities: string[];
  matter_scope: string[];
  allowed_providers: string[];
  budget_limit_usd: number;
  budget_spent_usd: number;
  expires_at: string;
  delegation_depth: number;
  max_delegation_depth: number;
  can_approve_external_actions: boolean;
  revoked: boolean;
}

export interface VerifiedAuthContext {
  authenticated: boolean;
  tenant_id: string;
  principal_id: string;
  principal_class: PrincipalClass;
  roles: Reg24Role[];
  permitted_matters: string[];
  ethical_wall_blocked_matters: string[];
  scopes: string[];
  token_audience?: string;
  token_issuer?: string;
  token_expires_at?: string;
  delegated_grant?: DelegatedGrantContext;
}

export interface ResolvedTemporalContext {
  jurisdiction: string;
  timezone: string;
  legal_as_of: string;
  known_as_of: string;
  defaulted_legal_as_of: boolean;
  defaulted_known_as_of: boolean;
  buddhist_era_year: number;
}

export interface Reg24StructuredClaim {
  claim_id: string;
  statement: string;
  claim_type: ClaimSupportKind;
  jurisdiction: string;
  applicable_time: string;
  evidence_links: string[];
  verification_state: {
    source_verified: boolean;
    exact_quotation: boolean;
    date_applicable: boolean;
    reasoning_assessed: boolean;
    professionally_approved: boolean;
  };
}

export interface Reg24CoverageStatement {
  jurisdiction: string;
  domains_covered: string[];
  sources_checked: string[];
  document_types: string[];
  time_range: { from: string; to: string };
  freshness_lag_hours: number;
  review_status: "reviewed" | "partial_review" | "unreviewed_candidates_excluded";
  missing_coverage_limitations: string[];
}

export interface Reg24ValidationSummary {
  source_verified: boolean;
  applicability_checked: boolean;
  reviewed: boolean;
  reviewer_id?: string;
  citation_checks_passed: number;
  citation_checks_failed: number;
  uncertainty_reasons: UncertaintyReasonCode[];
}

export interface Reg24UsageRecord {
  operation_id: string;
  capability_version: string;
  model_id: string;
  provider_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  retrieval_units: number;
  runtime_ms: number;
  estimated_cost_usd: number;
  settled_cost_usd: number;
  budget_reserved_usd: number;
}

/**
 * CON03 & CON04: Canonical Substantive Result Envelope
 */
export interface Reg24CanonicalResult<TData = unknown> {
  result_id: string;
  schema_version: string;
  capability_version: string;
  trace_id: string;
  resolved_temporal_context: ResolvedTemporalContext;
  corpus_snapshot_id: string;
  outcome: Reg24OutcomeStatus;
  data: TData;
  claims: Reg24StructuredClaim[];
  evidence_refs: string[];
  evidence_manifest_id: string;
  coverage: Reg24CoverageStatement;
  warnings: string[];
  validation_summary: Reg24ValidationSummary;
  usage: Reg24UsageRecord;
  timestamps: {
    requested_at: string;
    completed_at: string;
  };
}

/**
 * CON05 & CON06: Canonical Error Envelope
 */
export interface Reg24CanonicalErrorEnvelope {
  error: {
    code: Reg24StandardErrorCode;
    message: string;
    retryable: boolean;
    trace_id: string;
    schema_version: string;
    safe_details?: Record<string, unknown>;
  };
}

/**
 * Section 10: Service Catalogue & Protocol Mapping
 */
export interface ServiceCapabilityDescriptor {
  capability_id: string;
  api_method: "GET" | "POST";
  api_path: string;
  mcp_tool_name: string;
  capability_version: string;
  required_scopes: string[];
  requires_matter_context: boolean;
  billing_unit: "lookup" | "search" | "research_mission" | "verification" | "evaluation" | "drafting" | "mission_control";
  has_side_effects: boolean;
  requires_human_approval_for_external: boolean;
  timeout_ms: number;
  supported_jurisdictions: string[];
  description: string;
}

export const SECTION_10_SERVICE_CATALOGUE: ServiceCapabilityDescriptor[] = [
  {
    capability_id: "cap.discover",
    api_method: "GET",
    api_path: "/api/v1/capabilities",
    mcp_tool_name: "legal_discover_capabilities",
    capability_version: "1.0.0",
    required_scopes: ["legal:read"],
    requires_matter_context: false,
    billing_unit: "lookup",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 2000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Discover authorized capabilities, schemas, supported jurisdictions, and protocol metadata.",
  },
  {
    capability_id: "cap.search",
    api_method: "POST",
    api_path: "/api/v1/legal/search",
    mcp_tool_name: "legal_search",
    capability_version: "1.0.0",
    required_scopes: ["legal:read"],
    requires_matter_context: false,
    billing_unit: "search",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 3000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Search primary and secondary legal authority with bitemporal and jurisdiction constraints.",
  },
  {
    capability_id: "cap.get_provision",
    api_method: "GET",
    api_path: "/api/v1/legal/provisions/{id}",
    mcp_tool_name: "legal_get_provision",
    capability_version: "1.0.0",
    required_scopes: ["legal:read"],
    requires_matter_context: false,
    billing_unit: "lookup",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 500,
    supported_jurisdictions: ["TH", "SG"],
    description: "Resolve exact bitemporal provision version by legal_as_of and known_as_of.",
  },
  {
    capability_id: "cap.get_history",
    api_method: "GET",
    api_path: "/api/v1/legal/provisions/{id}/history",
    mcp_tool_name: "legal_get_history",
    capability_version: "1.0.0",
    required_scopes: ["legal:read"],
    requires_matter_context: false,
    billing_unit: "lookup",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 1000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Explain provision-level amendment history, renumbering, and consolidation evidence.",
  },
  {
    capability_id: "cap.query_relationships",
    api_method: "POST",
    api_path: "/api/v1/legal/relationships/query",
    mcp_tool_name: "legal_query_relationships",
    capability_version: "1.0.0",
    required_scopes: ["legal:read"],
    requires_matter_context: false,
    billing_unit: "search",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 2000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Traverse typed legal relationships (amends, repeals, implements, cites, interprets, conflicts_with).",
  },
  {
    capability_id: "cap.research",
    api_method: "POST",
    api_path: "/api/v1/legal/research",
    mcp_tool_name: "legal_research",
    capability_version: "1.0.0",
    required_scopes: ["legal:read", "legal:research"],
    requires_matter_context: false,
    billing_unit: "research_mission",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 15000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Execute structured legal issue research separating supplied facts, missing facts, applicable and contrary authority.",
  },
  {
    capability_id: "cap.verify",
    api_method: "POST",
    api_path: "/api/v1/legal/verify",
    mcp_tool_name: "legal_verify",
    capability_version: "1.0.0",
    required_scopes: ["legal:read", "legal:verify"],
    requires_matter_context: false,
    billing_unit: "verification",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 3000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Deterministically verify citations and claims against source identity, version, locator, exact span, and SHA-256 hash.",
  },
  {
    capability_id: "cap.evaluate_obligations",
    api_method: "POST",
    api_path: "/api/v1/legal/obligations/evaluate",
    mcp_tool_name: "legal_evaluate_obligations",
    capability_version: "1.0.0",
    required_scopes: ["legal:read", "legal:evaluate"],
    requires_matter_context: false,
    billing_unit: "evaluation",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 3000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Evaluate reviewed, versioned obligation rule packs against supplied entity facts.",
  },
  {
    capability_id: "cap.create_draft",
    api_method: "POST",
    api_path: "/api/v1/legal/drafts",
    mcp_tool_name: "legal_create_draft",
    capability_version: "1.0.0",
    required_scopes: ["legal:read", "legal:draft"],
    requires_matter_context: true,
    billing_unit: "drafting",
    has_side_effects: true,
    requires_human_approval_for_external: true,
    timeout_ms: 10000,
    supported_jurisdictions: ["TH"],
    description: "Generate or review a legal draft from approved templates with clause source maps and unresolved field checks.",
  },
  {
    capability_id: "cap.create_mission",
    api_method: "POST",
    api_path: "/api/v1/missions",
    mcp_tool_name: "legal_create_mission",
    capability_version: "1.0.0",
    required_scopes: ["legal:mission:write"],
    requires_matter_context: true,
    billing_unit: "mission_control",
    has_side_effects: true,
    requires_human_approval_for_external: true,
    timeout_ms: 2000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Create a durable legal mission (HTTP 202) with explicit spend cap, snapshot pin, and approval gates.",
  },
  {
    capability_id: "cap.get_mission",
    api_method: "GET",
    api_path: "/api/v1/missions/{id}",
    mcp_tool_name: "legal_get_mission",
    capability_version: "1.0.0",
    required_scopes: ["legal:mission:read"],
    requires_matter_context: false,
    billing_unit: "mission_control",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 1000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Inspect durable mission state, checkpoints, blockers, costs, and evidence manifest.",
  },
  {
    capability_id: "cap.cancel_mission",
    api_method: "POST",
    api_path: "/api/v1/missions/{id}/cancel",
    mcp_tool_name: "legal_cancel_mission",
    capability_version: "1.0.0",
    required_scopes: ["legal:mission:write"],
    requires_matter_context: false,
    billing_unit: "mission_control",
    has_side_effects: true,
    requires_human_approval_for_external: false,
    timeout_ms: 2000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Cancel an in-progress mission, stop new activities, and report committed actions.",
  },
  {
    capability_id: "cap.get_evidence",
    api_method: "GET",
    api_path: "/api/v1/evidence/{id}",
    mcp_tool_name: "legal_get_evidence",
    capability_version: "1.0.0",
    required_scopes: ["legal:read"],
    requires_matter_context: false,
    billing_unit: "lookup",
    has_side_effects: false,
    requires_human_approval_for_external: false,
    timeout_ms: 1000,
    supported_jurisdictions: ["TH", "SG"],
    description: "Retrieve authorized immutable evidence span, byte hash, and quotation rights manifest.",
  },
];

/**
 * Section 6 (AGN01–AGN06): Replaceability Port Contracts
 */
export interface ModelProviderCapabilities {
  provider_id: string;
  model_id: string;
  supports_structured_json: boolean;
  supports_streaming: boolean;
  context_window_tokens: number;
  supports_tools: boolean;
  supported_languages: string[];
  residency_regions: string[];
  cost_per_1k_input_usd: number;
  cost_per_1k_output_usd: number;
}

export interface ModelGenerationRequest {
  prompt: string;
  system_instruction?: string;
  require_structured_json?: boolean;
  require_tools?: boolean;
  max_tokens?: number;
  temperature?: number;
  tenant_id: string;
  required_region?: string;
}

export interface ModelGenerationResponse {
  provider_id: string;
  model_id: string;
  prompt_version: string;
  content: string;
  structured_output?: Record<string, unknown>;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
}

export interface ModelProviderPort {
  getCapabilities(): ModelProviderCapabilities;
  generate(req: ModelGenerationRequest): Promise<ModelGenerationResponse>;
}

export interface EmbeddingIndexMetadata {
  index_generation_id: string;
  provider_id: string;
  model_id: string;
  dimensions: number;
  preprocessing_version: string;
  corpus_snapshot_id: string;
}

export interface EmbeddingProviderPort {
  getMetadata(): EmbeddingIndexMetadata;
  embedText(texts: string[]): Promise<{ vectors: number[][]; index_generation_id: string }>;
}

export interface RetrievalFilter {
  jurisdiction: string;
  domain?: string;
  legal_as_of: string;
  known_as_of: string;
  tenant_id: string;
  matter_id?: string;
  corpus_snapshot_id: string;
  exclude_unreviewed_candidates: boolean;
}

export interface RetrievedEvidenceSnippet {
  evidence_span_id: string;
  provision_id: string;
  provision_version_id: string;
  instrument_id: string;
  official_identifier: string;
  title: string;
  quote: string;
  byte_hash: string;
  authority_kind: "statute" | "subordinate_regulation" | "supreme_court_judgment" | "tax_ruling" | "secondary_commentary";
  binding_force: "binding_statute" | "binding_precedent" | "persuasive_authority" | "administrative_guidance" | "non_binding_commentary";
  score: number;
}

export interface RetrieverPort {
  retrieve(query: string, filter: RetrievalFilter, topK?: number): Promise<RetrievedEvidenceSnippet[]>;
}

export interface CanonicalGraphNodeRecord {
  id: string;
  entity_type: string;
  jurisdiction: string;
  properties: Record<string, unknown>;
}

export interface CanonicalGraphEdgeRecord {
  id: string;
  subject_id: string;
  predicate:
    | "amends"
    | "repeals"
    | "replaces"
    | "implements"
    | "cites"
    | "interprets"
    | "distinguishes"
    | "conflicts_with";
  object_id: string;
  legal_valid_from: string;
  legal_valid_to: string | null;
  recorded_from: string;
  recorded_to: string | null;
  evidence_ids: string[];
  review_status: "candidate" | "reviewed" | "rejected";
}

export interface GraphStorePort {
  resolveProvision(provisionId: string, legalAsOf: string, knownAsOf: string): Promise<CanonicalGraphNodeRecord | null>;
  traverseAmendmentChain(provisionId: string): Promise<CanonicalGraphEdgeRecord[]>;
  findRelatedAuthorities(
    subjectId: string,
    predicates?: CanonicalGraphEdgeRecord["predicate"][],
    includeCandidates?: boolean
  ): Promise<CanonicalGraphEdgeRecord[]>;
  exportCanonicalGraph(): Promise<{ nodes: CanonicalGraphNodeRecord[]; edges: CanonicalGraphEdgeRecord[] }>;
  rebuildFromCanonicalExport(dump: { nodes: CanonicalGraphNodeRecord[]; edges: CanonicalGraphEdgeRecord[] }): Promise<{
    restored_nodes: number;
    restored_edges: number;
  }>;
}

export interface ObjectStoreManifestEntry {
  object_ref: string;
  byte_hash: string;
  media_type: string;
  size_bytes: number;
  tenant_id: string;
  rights_classification: "PUBLIC_STATUTE" | "INTERNAL_OWN_USE_ONLY" | "RESTRICTED_CLIENT_MATTER";
  stored_at: string;
}

export interface ObjectStorePort {
  putObject(ref: string, content: string, mediaType: string, tenantId: string, rights: ObjectStoreManifestEntry["rights_classification"]): Promise<ObjectStoreManifestEntry>;
  getObject(ref: string, tenantId: string): Promise<{ content: string; manifest: ObjectStoreManifestEntry } | null>;
  exportManifest(): Promise<ObjectStoreManifestEntry[]>;
}

export type DurableMissionState =
  | "created"
  | "validating"
  | "planned"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface MissionCheckpointRecord {
  checkpoint_id: string;
  mission_id: string;
  engine_run_id: string;
  state: DurableMissionState;
  completed_activities: Array<{ activity_id: string; idempotency_key: string; output_hash: string; result: unknown }>;
  approved_artifact_hashes: string[];
  created_at: string;
}

export interface MissionRuntimePort {
  getEngineName(): string;
  saveCheckpoint(checkpoint: MissionCheckpointRecord): Promise<void>;
  loadCheckpoint(missionId: string): Promise<MissionCheckpointRecord | null>;
  exportCompletedMission(missionId: string): Promise<Record<string, unknown> | null>;
  drainAndRestartFromCheckpoint(missionId: string, targetEngineName: string): Promise<MissionCheckpointRecord | null>;
}

export interface IdentityVerifierPort {
  verifyRequestAuth(headers: Record<string, string | undefined>, requestedTenantId?: string): Promise<VerifiedAuthContext>;
}

export interface PolicyEvaluatorPort {
  evaluateAccess(
    auth: VerifiedAuthContext,
    capability: ServiceCapabilityDescriptor,
    req: Reg24CanonicalRequest<unknown>
  ): { allowed: boolean; error_code?: Reg24StandardErrorCode; reason?: string };
}

export interface DocumentRendererPort {
  renderDeliverable(
    templateId: string,
    templateVersion: string,
    fields: Record<string, string>,
    clauseSources: string[]
  ): Promise<{ content: string; artifact_hash: string; unresolved_placeholders: string[] }>;
}

export type ExternalActionType =
  | "court_filing"
  | "regulator_submission"
  | "external_transmission"
  | "electronic_signature"
  | "payment_execution"
  | "enterprise_record_mutation";

export interface ConnectorPort {
  getConnectorId(): string;
  getSupportedActions(): ExternalActionType[];
  executeExternalAction(params: {
    action_type: ExternalActionType;
    idempotency_key: string;
    artifact_hash: string;
    approval_ref?: string;
    payload: Record<string, unknown>;
  }): Promise<{ committed: boolean; external_reference_id: string; status: string }>;
}
