/**
 * REG24 Legal Form and Document Execution Engine (LFDE v2.0)
 * Core Domain Contracts, Entities, State Machines & Error Specifications
 * Specification: REG24-LFDE-v2.0 (23 October 2026)
 */

export type LfdeRole =
  | "contributor"
  | "legal_reviewer"
  | "designated_approver"
  | "tenant_admin"
  | "template_curator"
  | "compliance_auditor"
  | "integration_service";

export type LfdeScope =
  | "source:write"
  | "template:read"
  | "template:curate"
  | "template:review"
  | "template:publish"
  | "clause:read"
  | "clause:curate"
  | "clause:review"
  | "document:create"
  | "document:read"
  | "document:edit"
  | "document:comment"
  | "document:validate"
  | "document:request_review"
  | "document:approve"
  | "document:export"
  | "package:create"
  | "audit:read";

export type RiskLevel = "low" | "medium" | "high";

export interface ApprovalGrant {
  grant_id: string;
  tenant_id: string;
  subject_id: string;
  jurisdiction: string;
  document_categories: string[];
  risk_ceiling: RiskLevel;
  valid_from: string;
  valid_to: string;
  granted_by: string;
  verification_evidence: string;
  revoked?: boolean;
}

export interface TenantContext {
  subject_id: string;
  tenant_id: string;
  application_id: string;
  role: LfdeRole;
   is_service_account: boolean;
  scopes: LfdeScope[];
  matter_grants: string[];
  approval_grants: ApprovalGrant[];
  correlation_id: string;
  delegated_user_id?: string;
}

export type LfdeErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "MALFORMED_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
  | "REVISION_CONFLICT"
  | "APPROVAL_STALE"
  | "INVALID_TRANSITION"
  | "RIGHTS_UNVERIFIED"
  | "RIGHTS_DENIED"
  | "FACTS_INCOMPLETE"
  | "FACT_CONFLICT"
  | "AUTHORITY_UNKNOWN"
  | "SOURCE_STALE"
  | "RENDER_FAILED"
  | "UNSUPPORTED_TEMPLATE_FEATURE"
  | "UPLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "MALICIOUS_CONTENT_DETECTED"
  | "DEPENDENCY_UNAVAILABLE"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "SSRF_BLOCKED";

export interface LfdeErrorEnvelope {
  code: LfdeErrorCode;
  safe_message: string;
  correlation_id: string;
  retryable: boolean;
  http_status: number;
  field_errors?: Record<string, string>;
  finding_refs?: string[];
}

export class LfdeException extends Error {
  public readonly envelope: LfdeErrorEnvelope;
  constructor(envelope: LfdeErrorEnvelope) {
    super(envelope.safe_message);
    this.name = "LfdeException";
    this.envelope = envelope;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 3: INTAKE, EXTRACTION & LICENSING ENTITIES
   ══════════════════════════════════════════════════════════════════════════ */

export type AssetClassification =
  | "official_form"
  | "purchased_precedent"
  | "firm_precedent"
  | "client_document"
  | "ai_draft"
  | "secondary_commentary"
  | "unknown";

export type AssetScanState =
  | "upload_pending"
  | "scanning"
  | "quarantined"
  | "parsed"
  | "rejected";

export type PrivacyClass = "public" | "internal" | "confidential" | "restricted";

export interface ExtractedRegionSpan {
  span_id: string;
  page_number: number;
  printed_page_label?: string;
  field_hint?: string;
  raw_text: string;
  normalized_text: string;
  confidence: number;
  bbox: [number, number, number, number];
  ocr_engine_version?: string;
  language?: string;
  requires_human_confirmation: boolean;
}

export interface SourceAsset {
  id: string;
  tenant_id: string;
  kind: AssetClassification;
  original_name: string;
  mime: string;
  size: number;
  page_count: number;
  sha256: string;
  storage_ref: string;
  scan_state: AssetScanState;
  parse_state: "pending" | "completed" | "failed";
  privacy: PrivacyClass;
  extracted_spans: ExtractedRegionSpan[];
  warnings: string[];
  created_at: string;
  created_by: string;
  sanitized_derivative_ref?: string;
}

export type PermissionValue = "allowed" | "denied" | "unknown";

export type LicensedOperation =
  | "parse"
  | "embed"
  | "model_process"
  | "template_publish"
  | "draft_generate"
  | "template_redistribute"
  | "export_distribute"
  | "cross_app_deliver";

export interface LicenseGrant {
  id: string;
  tenant_id: string;
  source_id: string;
  rights_holder: string;
  supplier: string;
  acquisition_evidence: string;
  grant_document_ref: string;
  operations: Record<LicensedOperation, PermissionValue>;
  allowed_tenants: string[];
  allowed_applications: string[];
  territory: string;
  attribution_required: boolean;
  attribution_text?: string;
  valid_from: string;
  valid_to: string;
  status: "active" | "expired" | "revoked" | "quarantined_unknown";
  evaluation_only?: boolean;
  version: number;
  created_at: string;
  created_by: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 4 & 5: TEMPLATE REGISTRY, CLAUSES & STRUCTURED SCHEMA
   ══════════════════════════════════════════════════════════════════════════ */

export type TemplateLifecycleState =
  | "uploaded"
  | "parsed"
  | "classified"
  | "legal_review"
  | "approved"
  | "published"
  | "deprecated"
  | "withdrawn";

export type FieldDatatype =
  | "text"
  | "identifier"
  | "date"
  | "datetime"
  | "decimal"
  | "money"
  | "enum"
  | "boolean"
  | "entity"
  | "array";

export type ExpressionNode =
  | { eq: [ExpressionOperand, ExpressionOperand] }
  | { neq: [ExpressionOperand, ExpressionOperand] }
  | { gt: [ExpressionOperand, ExpressionOperand] }
  | { gte: [ExpressionOperand, ExpressionOperand] }
  | { lt: [ExpressionOperand, ExpressionOperand] }
  | { lte: [ExpressionOperand, ExpressionOperand] }
  | { and: ExpressionNode[] }
  | { or: ExpressionNode[] }
  | { not: ExpressionNode }
  | { exists: { field: string } };

export type ExpressionOperand =
  | { field: string }
  | string
  | number
  | boolean
  | null;

export type TriBool = "true" | "false" | "unknown";

export interface TemplateField {
  version_id: string;
  field_key: string;
  label_th: string;
  label_en?: string;
  group: "parties" | "transaction" | "dates" | "commercial" | "signatures" | "attachments";
  datatype: FieldDatatype;
  required_when?: ExpressionNode | boolean;
  constraints?: {
    min_length?: number;
    max_length?: number;
    pattern?: string;
    minimum?: string;
    maximum?: string;
    currency?: string;
    enum_values?: string[];
    rounding?: "HALF_UP" | "HALF_EVEN" | "FLOOR";
  };
  evidence_policy: "none" | "optional" | "required" | "human_confirmed";
  privacy_class: PrivacyClass;
  format_profile: string;
  confirmation_policy: "always" | "critical" | "on_low_confidence";
  why_needed_th: string;
  why_needed_en: string;
}

export type BlockType =
  | "heading"
  | "paragraph"
  | "table"
  | "header"
  | "footer"
  | "section"
  | "signature"
  | "annex";

export type BlockOrigin =
  | "source_span"
  | "approved_clause"
  | "user_text"
  | "ai_proposal";

export interface DocumentBlock {
  block_id: string;
  type: BlockType;
  title_th?: string;
  title_en?: string;
  template_text_th: string;
  template_text_en?: string;
  field_refs: string[];
  clause_id?: string;
  visible_when?: ExpressionNode;
  cross_refs?: string[];
  annex_target_id?: string;
  origin: BlockOrigin;
  authority_refs?: string[];
  mandatory_by_rule?: boolean;
  repeat_group?: {
    group_key: string;
    min_items: number;
    max_items: number;
  };
}

export interface ClauseVersion {
  id: string;
  clause_id: string;
  semver: string;
  title_th: string;
  title_en: string;
  text_th: string;
  text_en: string;
  purpose_th: string;
  purpose_en: string;
  language: "th" | "en" | "bilingual";
  compatible_templates: string[];
  governing_law: string;
  authority_refs: string[];
  secondary_commentary_refs?: Array<{
    author: string;
    edition: string;
    title: string;
    page: string;
  }>;
  prerequisites?: ExpressionNode;
  mutually_exclusive_with?: string[];
  risk: RiskLevel;
  source_id: string;
  approval_status: "proposed" | "approved" | "withdrawn";
  mandatory_by_law: boolean;
  content_hash: string;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  semver: string;
  title_th: string;
  title_en: string;
  domain: string;
  family: string;
  intended_task_th: string;
  intended_task_en: string;
  source_classification: AssetClassification;
  source_id: string;
  jurisdiction: string;
  language: "th" | "en" | "bilingual";
  risk: RiskLevel;
  effective_from: string;
  effective_to?: string;
  state: TemplateLifecycleState;
  fields: TemplateField[];
  blocks: DocumentBlock[];
  allowed_clause_ids: string[];
  authority_refs: string[];
  renderer_profile_id: string;
  content_hash: string;
  certification_checklist_passed: boolean;
  reviewer_decision_id?: string;
  published_by?: string;
  published_at?: string;
  withdrawn_reason?: string;
  drive_url?: string;
  lform_catalog_id?: string;
  strict_layout_lock?: boolean;
}

export interface Template {
  id: string;
  owner_type: "platform_catalog" | "tenant_private";
  tenant_id: string;
  domain: string;
  family: string;
  title_th: string;
  title_en: string;
  catalog_state: TemplateLifecycleState;
  published_version_id?: string;
  working_version_id?: string;
  entitled_tenants: string[];
  is_court_or_agency_form: boolean;
  strict_layout_lock?: boolean;
  drive_url?: string;
  lform_catalog_id?: string;
  created_at: string;
  created_by: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 6, 7 & 8: AUTHORITY, FACTS, ASSEMBLY, VALIDATION & REVIEW
   ══════════════════════════════════════════════════════════════════════════ */

export interface AuthoritySnapshot {
  id: string;
  tenant_id: string;
  canonical_ids: string[];
  legal_as_of_date: string;
  transaction_date: string;
  drafting_date: string;
  intended_filing_date?: string;
  retrieved_at: string;
  status: "verified" | "unknown" | "stale" | "withdrawn";
  provisions: Array<{
    canonical_id: string;
    version_id: string;
    title_th: string;
    title_en: string;
    effective_from: string;
    effective_to?: string | null;
    source_class: "primary_legislation" | "subordinate_regulation" | "supreme_court" | "admin_ruling" | "secondary_commentary";
    content_hash: string;
    pinpoint: string;
    supports_proposition: boolean;
  }>;
  findings: string[];
}

export type DocumentLifecycleState =
  | "draft"
  | "collecting_facts"
  | "assembling"
  | "validation_failed"
  | "review_ready"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "archived"
  | "canceled";

export type FactAssertionState = "extracted" | "asserted" | "confirmed" | "conflicted";

export interface FactCandidate {
  id: string;
  tenant_id: string;
  case_id: string;
  field_key: string;
  typed_value: unknown;
  original_representation: string;
  calendar_used?: "BE" | "CE";
  source_evidence_id?: string;
  source_span?: string;
  confidence: number;
  assertion_state: FactAssertionState;
  asserted_by: string;
  confirmed_by?: string;
  confirmed_at?: string;
  confirmed_value_hash?: string;
  conflict_reason?: string;
  created_at: string;
}

export interface FactSnapshot {
  id: string;
  tenant_id: string;
  case_id: string;
  included_candidate_ids: string[];
  resolved_values: Record<string, {
    typed_value: unknown;
    original_representation: string;
    confirmed_by?: string;
    confirmed_at?: string;
    value_hash: string;
  }>;
  content_hash: string;
  created_at: string;
}

export interface AssembledBlock {
  block_id: string;
  number_label: string;
  type: BlockType;
  title_th?: string;
  title_en?: string;
  rendered_text_th: string;
  rendered_text_en?: string;
  origin: BlockOrigin;
  field_refs: string[];
  clause_version_id?: string;
  authority_refs: string[];
  mandatory_by_rule: boolean;
}

export interface DraftRevision {
  id: string;
  tenant_id: string;
  case_id: string;
  revision_number: number;
  parent_revision_id?: string;
  template_version_id: string;
  fact_snapshot_id: string;
  authority_snapshot_id: string;
  selected_clause_version_ids: string[];
  assembled_blocks: AssembledBlock[];
  content_hash: string;
  renderer_profile_id: string;
  docx_fingerprint: string;
  pdf_fingerprint: string;
  accepted_ai_proposal_hashes: string[];
  created_at: string;
  created_by: string;
}

export type ValidationRuleLayer =
  | "Schema"
  | "Facts"
  | "Consistency"
  | "Clauses"
  | "Authority"
  | "Procedure"
  | "Rights and access"
  | "Rendering";

export type FindingSeverity = "blocker" | "high" | "warning";

export interface ValidationFinding {
  finding_id: string;
  run_id: string;
  rule_id: string;
  rule_version: string;
  layer: ValidationRuleLayer;
  severity: FindingSeverity;
  target_block_or_field: string;
  explanation_th: string;
  explanation_en: string;
  remediation_th: string;
  remediation_en: string;
  evidence_refs: string[];
  overridable: boolean;
  state: "open" | "resolved" | "overridden";
  override_decision?: {
    reviewer_id: string;
    grant_id: string;
    reason: string;
    evidence_ref: string;
    decided_at: string;
  };
}

export interface ValidationRun {
  id: string;
  tenant_id: string;
  case_id: string;
  revision_id: string;
  ruleset_version: string;
  input_hash: string;
  findings: ValidationFinding[];
  has_non_overridable_blockers: boolean;
  has_unresolved_blockers: boolean;
  readiness: "incomplete" | "complete" | "review_ready" | "approved" | "export_ready";
  completed_at: string;
}

export interface ReviewComment {
  id: string;
  tenant_id: string;
  case_id: string;
  revision_id: string;
  anchor_id: string;
  author_id: string;
  body: string;
  resolved: boolean;
  created_at: string;
}

export interface ReviewRequest {
  id: string;
  tenant_id: string;
  case_id: string;
  revision_id: string;
  revision_hash: string;
  fact_snapshot_id: string;
  authority_snapshot_id: string;
  validation_run_id: string;
  docx_fingerprint: string;
  pdf_fingerprint: string;
  renderer_profile_id: string;
  policy_version: string;
  assigned_reviewers: string[];
  state: "pending" | "approved" | "changes_requested" | "rejected" | "stale";
  created_at: string;
  created_by: string;
}

export interface ReviewDecision {
  id: string;
  tenant_id: string;
  request_id: string;
  case_id: string;
  revision_id: string;
  reviewer_id: string;
  reviewer_grant_id: string;
  decision: "approve" | "request_changes" | "reject";
  reason: string;
  revision_hash: string;
  decided_at: string;
}

export type ExportStatusLabel =
  | "draft"
  | "approved for export"
  | "awaiting signature"
  | "prepared for human submission";

export interface LineageManifest {
  manifest_id: string;
  case_id: string;
  revision_id: string;
  template_version_id: string;
  clause_version_ids: string[];
  fact_snapshot_id: string;
  authority_snapshot_ids: string[];
  validation_run_id: string;
  approval_decision_ids: string[];
  license_decision_snapshot: string;
  accepted_model_proposal_hashes: string[];
  model_and_prompt_versions: string[];
  assembly_build: string;
  renderer_build: string;
  artifact_sha256: string;
  status_label: ExportStatusLabel;
  generated_at: string;
}

export interface ExportArtifact {
  id: string;
  tenant_id: string;
  case_id: string;
  revision_id: string;
  mode: "draft" | "final";
  format: "docx" | "pdf";
  status_label: ExportStatusLabel;
  watermarked: boolean;
  object_ref: string;
  sha256: string;
  approval_decision_ids: string[];
  manifest: LineageManifest;
  created_at: string;
  created_by: string;
}

export interface DownloadSession {
  session_id: string;
  tenant_id: string;
  export_id: string;
  subject_id: string;
  expires_at: string;
  revoked: boolean;
}

export interface DocumentCase {
  id: string;
  tenant_id: string;
  matter_id: string;
  template_id: string;
  template_version_id: string;
  title_th: string;
  title_en: string;
  objective: string;
  language: "th" | "en" | "bilingual";
  state: DocumentLifecycleState;
  readiness: "incomplete" | "complete" | "review_ready" | "approved" | "export_ready";
  current_revision_id?: string;
  latest_validation_run_id?: string;
  latest_review_request_id?: string;
  latest_approval_decision_id?: string;
  selected_clause_ids: string[];
  legal_dates: {
    transaction_date: string;
    legal_as_of_date: string;
    drafting_date: string;
    intended_filing_date?: string;
  };
  external_reference_id?: string;
  application_id: string;
  lock_version: number;
  etag: string;
  status_advisories: string[];
  created_at: string;
  created_by: string;
  updated_at: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION 9, 11 & 12: FILING PACKAGES, JOBS, WORKFLOW TASKS & AUDIT
   ══════════════════════════════════════════════════════════════════════════ */

export interface FilingProfileVersion {
  id: string;
  destination_agency_th: string;
  destination_agency_en: string;
  jurisdiction: string;
  document_family: string;
  submission_route: "human_counter_submission" | "human_efiling_portal_upload";
  official_source_ref: string;
  checked_date: string;
  effective_from: string;
  allowed_file_types: Array<"pdf" | "docx">;
  max_size_mib: number;
  max_pages: number;
  signature_requirements_th: string;
  signature_requirements_en: string;
  required_annexes: string[];
  approved_by: string;
}

export interface FilingPackage {
  id: string;
  tenant_id: string;
  matter_id: string;
  profile_version_id: string;
  member_revision_ids: string[];
  exhibit_index: Array<{
    exhibit_no: string;
    title: string;
    artifact_id: string;
    sha256: string;
    page_range: string;
  }>;
  duplicate_exhibit_warnings: string[];
  checklist: Array<{
    item_key: string;
    label_th: string;
    label_en: string;
    passed: boolean;
  }>;
  status_label: "prepared for human submission";
  manifest_sha256: string;
  created_at: string;
  created_by: string;
}

export type JobState =
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "canceled";

export interface LfdeJob {
  id: string;
  tenant_id: string;
  operation_key: string;
  type: "scan_parse" | "ocr" | "assemble" | "render" | "export";
  target_id: string;
  state: JobState;
  stage: string;
  percent: number;
  attempts: number;
  lease_owner?: string;
  lease_expires_at?: string;
  input_hash: string;
  result_ref?: string;
  error_code?: LfdeErrorCode;
  safe_error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTask {
  id: string;
  tenant_id: string;
  type: "source_change_impact" | "rights_review" | "legal_review" | "curator_quarantine";
  target_id: string;
  dedup_key: string;
  title: string;
  assigned_to: string;
  state: "open" | "in_progress" | "resolved";
  dependency_refs: string[];
  created_at: string;
}

export interface LfdeAuditEvent {
  id: string;
  tenant_id: string;
  actor_id: string;
  delegated_actor_id?: string;
  application_id: string;
  action: string;
  target_type: string;
  target_id: string;
  before_hash?: string;
  after_hash?: string;
  policy_version: string;
  correlation_id: string;
  origin: "ui" | "rest" | "mcp" | "worker";
  timestamp: string;
  checkpoint_signature: string;
}

export type AgiTopology = "single" | "team" | "swarm";
export type AgiAutomationLevel = "draft" | "supervised" | "autopilot";

export interface AgiMissionExecution {
  mission_id: string;
  mission_type:
    | "find_suitable_form"
    | "prepare_draft"
    | "review_imported_draft"
    | "prepare_connected_documents"
    | "compare_updated_form"
    | "check_source_change_impact"
    | "prepare_submission_pack";
  topology: AgiTopology;
  automation: AgiAutomationLevel;
  budget_thb_cap: string;
  spent_thb: string;
  completed_stages: string[];
  paused_for_human_gate?: string;
  output_summary_th: string;
  output_summary_en: string;
  hard_boundary_notice: string;
}
