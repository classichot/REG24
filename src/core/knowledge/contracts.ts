/**
 * REG24 — Ten-Batch GraphRAG Mandatory Data & Service Contracts
 * Version 1.1 · 14 November 2026
 *
 * Implements all required DTOs and strict runtime validators from:
 * - 01_SHARED_DEVELOPER_REQUIREMENTS.md (Sections 2, 3, 4, 8, 11, 12)
 * - 03_OCR_AUDIT_ADJUSTMENTS.md (Sections 3, 4, 6, 8)
 * - B01_DEVELOPER_REQUIREMENTS.md (Sections 3, 4, 5, 6)
 * - RELEASE_REPORT_TEMPLATE.json (schema_version 1.1)
 */

import type { KnowledgeEntityType, KnowledgeTypedPredicate } from "../graph/graph-schema";
import type { TraceableAnswerEnvelope } from "./citation-contracts";

export type BatchId =
  | "B01"
  | "B02"
  | "B03"
  | "B04"
  | "B05"
  | "B06"
  | "B07"
  | "B08"
  | "B09"
  | "B10";

export const FIXED_BATCH_ORDER: readonly BatchId[] = [
  "B01",
  "B02",
  "B03",
  "B04",
  "B05",
  "B06",
  "B07",
  "B08",
  "B09",
  "B10",
] as const;

export type ReleaseState =
  | "PLANNED"
  | "INVENTORY_FROZEN"
  | "PROCESSING"
  | "QA_READY"
  | "READY_FOR_UAT"
  | "UAT_PASSED"
  | "RELEASE_APPROVED"
  | "PUBLISHED"
  | "ACCEPTED"
  | "BLOCKED"
  | "PAUSED"
  | "UAT_FAILED"
  | "ROLLED_BACK"
  | "ACCEPTED_WITH_DECLARED_GAPS";

export type CandidateDisposition =
  | "PUBLISHED_NEW"
  | "REUSED_EXISTING"
  | "ATTACHED_REPRESENTATION"
  | "REJECTED_OUT_OF_SCOPE"
  | "DEFERRED_WITH_REASON"
  | "FAILED";

export type IdentityAction =
  | "SKIP_UNCHANGED"
  | "ATTACH_REPRESENTATION"
  | "NEW_EXTRACTION_REVISION"
  | "NEW_LEGAL_VERSION"
  | "CREATE_NEW_WORK"
  | "REVIEW_IDENTITY_CONFLICT";

export type ActorRole =
  | "product_owner"
  | "engineering_lead"
  | "legal_reviewer"
  | "data_operator"
  | "reader"
  | "tenant_reader";

export interface Actor {
  actor_id: string;
  role: ActorRole;
  tenant_id: string;
  authorized_scopes: string[];
  csrf_verified?: boolean;
}

export interface RunLimits {
  max_documents_per_run: number;
  max_source_pages_per_run: number;
  max_ocr_task_pages: number;
  max_ocr_dispatch_pages_per_run: number;
  stratified_audit_fraction: number;
  stratified_audit_min_docs: number;
}

export interface BatchManifest {
  manifest_id: string;
  batch_id: BatchId;
  previous_batch_id: BatchId | null;
  inventory_snapshot_id: string;
  inventory_hash: string;
  owned_folder_ids: string[];
  dependency_manifest_id: string;
  run_limits: RunLimits;
  source_cutoff_at: string;
  expected_previous_release_id: string | null;
  frozen_at: string;
  frozen_by: string;
  empty_folders_detected: string[];
  shortcut_cycles_prevented: string[];
  index_mismatches: Array<{
    row_id: string;
    official_id: string;
    expected_file_id: string;
    reason: string;
  }>;
  dedicated_oversized_runs_required: string[];
}

export interface Candidate {
  candidate_id: string;
  manifest_id: string;
  source_file_id: string;
  source_revision: string;
  path: string;
  owner_batch_id: BatchId;
  source_uri: string;
  artifact_id: string | null;
  canonical_work_id: string | null;
  processing_state: "DISCOVERED" | "FETCHED" | "EXTRACTED" | "IDENTITY_RESOLVED" | "VALIDATED" | "STAGED" | "PUBLISHED" | "REVIEW_REQUIRED" | "DEFERRED" | "FAILED";
  identity_action: IdentityAction | null;
  disposition: CandidateDisposition;
  reasons: string[];
  review_ids: string[];
  is_pilot_sample?: boolean;
  pilot_stratum?: string;
  is_dependency?: boolean;
  first_loaded_by_batch_id?: BatchId;
  required_by_work_ids?: string[];
}

export interface Artifact {
  artifact_id: string;
  actual_bytes_sha256: string;
  size: number;
  MIME: string;
  immutable_uri: string;
  fetched_at: string;
  origin_uri: string;
  authenticity_status: "official_original" | "official_html_snapshot" | "html_derived_pdf_derivative" | "verified_corpus_mirror" | "user_supplied_unverified";
  access_scope: string;
  rights_status: "approved_public" | "approved_internal" | "restricted_tenant" | "withdrawn";
  is_derivative?: boolean;
}

export interface OfficialIdentifierEntry {
  raw: string;
  normalized: string;
  kind: "rd_letter_no" | "statute_code" | "section_no" | "royal_decree_no" | "opinion_no" | "case_no" | "other";
}

export interface LegalWork {
  work_id: string;
  type: KnowledgeEntityType;
  issuer_id: string;
  jurisdiction: string;
  title_th: string;
  title_en?: string;
  official_identifiers: OfficialIdentifierEntry[];
  identity_evidence: string[];
  aliases: string[];
  owner_batch_id: BatchId;
  first_loaded_by_batch_id: BatchId;
  required_by?: string[];
  instrument_code?: string;
}

export type ApplicabilityBasis =
  | "ACCOUNTING_PERIOD_START"
  | "ACCOUNTING_PERIOD_END"
  | "ASSESSABLE_TAX_YEAR"
  | "TRANSACTION_OR_EVENT_DATE"
  | "CASE_SPECIFIC_OPINION"
  | "CONSOLIDATED_MULTI_AMENDMENT";

export interface ProvisionAmendmentLedgerItem {
  subprovision_label: string | null;
  amending_instrument_title_th: string;
  amending_work_id: string | null;
  amending_source_uri: string | null;
  royal_gazette_ref: string | null;
  gazette_publication_date: string | null;
  enactment_effective_date: string | null;
  applicability_basis: ApplicabilityBasis;
  applicability_from_date: string | null;
  applicability_from_tax_year_be: number | null;
  applicability_rule_th: string;
  saving_clause_th?: string | null;
  pre_amendment_verified_version_id: string | null;
  pre_amendment_source_uri?: string | null;
  clause_excerpt_th?: string | null;
  topic_keywords?: string[];
}

export interface ApplicabilityInterval {
  valid_from: string | null;
  valid_to: string | null;
  conditions: string[];
  date_status: "verified" | "unknown_restricted" | "retroactive_evidenced" | "transitional";
  applicability_basis?: ApplicabilityBasis;
  enactment_effective_date?: string | null;
  applicability_from_tax_year_be?: number | null;
}

export interface LegalVersion {
  version_id: string;
  work_id: string;
  version_label: string;
  legal_applicability: ApplicabilityInterval[];
  publication_date: string | null;
  decision_date: string | null;
  raw_date_text?: string | null;
  temporal_evidence_ids: string[];
  known_from: string;
  known_to: string | null;
  is_consolidated_derived?: boolean;
  draft_or_enacted_status?: "ENACTED_ORIGINAL" | "ENACTED_AMENDMENT" | "CONSOLIDATED_DERIVED" | "DRAFT_BILL" | "LEGISLATIVE_HISTORY" | "UNOFFICIAL_TRANSLATION";
  amendment_ledger?: ProvisionAmendmentLedgerItem[];
  access_scope: string;
}

export interface Extraction {
  extraction_id: string;
  artifact_id: string;
  work_id: string;
  version_id: string;
  extractor_version: string;
  model_version: string;
  configuration_version: string;
  raw_text_uri: string;
  raw_text: string;
  normalized_text: string;
  normalization_log: string[];
  quality_status: "VALIDATED" | "REPAIRED_VERIFIED" | "OCR_VERIFIED" | "REVIEW_REQUIRED" | "QUARANTINED";
  accepted_revision: number;
  created_at: string;
}

export type SourceLocatorKind = "pdf_page" | "html_structural" | "text_byte_offset";

export interface RealSourceLocator {
  kind: SourceLocatorKind;
  artifact_id: string;
  origin_uri: string;
  physical_page_index?: number;
  printed_page_label?: string | null;
  bounding_box?: [number, number, number, number];
  structural_selector?: string;
  byte_start?: number;
  byte_end?: number;
  line_start?: number;
  line_end?: number;
}

export type StatementRole =
  | "statutory_text"
  | "requester_facts"
  | "requester_question"
  | "requester_proposed_treatment"
  | "official_reasoning"
  | "official_conclusion"
  | "condition_clause"
  | "exception_clause"
  | "dissent_or_separate"
  | "secondary_commentary"
  | "reg24_inference";

export interface Passage {
  passage_id: string;
  work_id: string;
  version_id: string;
  extraction_id: string;
  release_id: string;
  exact_text: string;
  contextualized_header: string;
  real_locator: RealSourceLocator;
  structural_path: string[];
  parent_id: string | null;
  adjacent_ids: {
    previous_id: string | null;
    next_id: string | null;
  };
  language: "th" | "en" | "mixed";
  statement_role: StatementRole;
  token_count: number;
  critical_tokens_flagged: string[];
  contains_untrusted_instruction_like_text: boolean;
  access_scope: string;
}

export interface Assertion {
  assertion_id: string;
  release_id: string;
  subject: string;
  subject_type: KnowledgeEntityType;
  predicate: KnowledgeTypedPredicate;
  object: string;
  object_type: KnowledgeEntityType;
  qualifications: {
    conditions: string[];
    exceptions: string[];
    tax_types?: string[];
    applicable_period?: string | null;
  };
  evidence_ids: string[];
  statement_role: StatementRole;
  state: "PROPOSED" | "ACCEPTED" | "REJECTED";
  review_id: string | null;
  validity: {
    valid_from: string | null;
    valid_to: string | null;
  };
  confidence: number;
  legal_certainty: "settled_statutory" | "administrative_ruling_specific_facts" | "contested_or_conditional";
  scope: string;
}

export interface UnresolvedReferenceRecord {
  unresolved_ref_id: string;
  source_work_id: string;
  source_version_id: string;
  source_passage_id: string;
  raw_citation_text: string;
  target_hint: string;
  governing_instrument?: string;
  section_label?: string | null;
  quarantine_status?: "UNRESOLVED_QUARANTINED";
  usable_as_legal_evidence?: false;
  recorded_in_release_id?: string;
  owner_batch_hint: BatchId;
  reason: string;
  created_at: string;
}

export interface ProjectionReceipt {
  receipt_id: string;
  release_id: string;
  projection_kind: "LEXICAL" | "VECTOR" | "GRAPH_LOCAL_DURABLE" | "GRAPH_NEO4J_AURA";
  generation: string;
  item_count: number;
  manifest_checksum: string;
  completion_state: "COMPLETED" | "INCOMPLETE" | "FAILED";
  adapter_mode: "durable_disk" | "live_neo4j_aura" | "memory_only";
  recorded_at: string;
  error: string | null;
}

export interface UATCase {
  case_id: string;
  template_id: string;
  variant: "A" | "B";
  batch_id: BatchId;
  category: "legal_lookup" | "fact_pattern" | "comparison" | "role_separation" | "temporal_applicability" | "provision_navigation" | "duplicate_provenance" | "source_fidelity" | "missing_facts" | "nonexistent_lookup";
  exercises_source_fidelity: boolean;
  fixture_ids: string[];
  question: string;
  comparison_target_ids?: string[];
  applicable_date: string | null;
  expected_status: AnswerStatus[];
  expected_claims: string[];
  required_evidence: string[];
  forbidden_claims: string[];
  severity: "P0" | "P1" | "P2";
  evaluator_results: {
    automated_precheck_passed: boolean;
    citation_resolved: boolean;
    trace_id: string;
    verified_at: string;
  } | null;
  owner_result?: {
    decision: "PASS" | "FAIL";
    comment: string;
    actor_id: string;
    decided_at: string;
    trace_id?: string;
  } | null;
}

export interface AttestationRecord {
  actor_id: string;
  role: "engineering_lead" | "legal_reviewer";
  manifest_hash: string;
  attested_at: string;
  notes: string;
}

export interface GapAcceptanceRecord {
  accepted: boolean;
  accepted_by: string;
  accepted_at: string;
  declared_gaps: string[];
}

export interface OwnerCustomUatQuestionResult {
  question_id: string;
  question: string;
  applicable_date?: string | null;
  trace_id?: string | null;
  decision: "PASS" | "FAIL";
  comment: string;
  actor_id?: string;
  decided_at?: string;
}

export interface Acceptance {
  release_id: string;
  batch_id: BatchId;
  revision: number;
  manifest_hash: string;
  user_decision: "UAT_PASS" | "UAT_PASS_WITH_DECLARED_GAPS" | "UAT_FAIL" | null;
  technical_attestation: AttestationRecord | null;
  legal_attestation: AttestationRecord | null;
  gap_acceptance: GapAcceptanceRecord | null;
  comments: string[];
  case_decisions: Record<
    string,
    {
      decision: "PASS" | "FAIL";
      comment: string;
      actor_id: string;
      decided_at: string;
    }
  >;
  custom_owner_questions?: OwnerCustomUatQuestionResult[];
  actor_ids: string[];
  timestamps: {
    ready_for_uat_at: string | null;
    owner_decided_at: string | null;
    promoted_at: string | null;
  };
}

export type AnswerStatus =
  | "ANSWERED"
  | "CONDITIONAL"
  | "NEEDS_CLARIFICATION"
  | "INSUFFICIENT_EVIDENCE"
  | "REVIEW_REQUIRED";

export interface ClaimLedgerItem {
  claim_id: string;
  statement: string;
  claim_type: "direct_source_statement" | "qualified_legal_synthesis" | "fact_distinction" | "abstention_notice";
  statement_role: StatementRole;
  supporting_passage_ids: string[];
  applicable_version_id: string | null;
  factual_conditions: string[];
  exceptions: string[];
  counterevidence_passage_ids: string[];
  verification_result: "VERIFIED" | "CONDITIONAL_QUALIFIED" | "BLOCKED_CONTRADICTION" | "UNSUPPORTED";
}

export interface EvidenceCard {
  passage_id: string;
  work_id: string;
  version_id: string;
  official_identifier: string;
  title_th: string;
  authority_type: KnowledgeEntityType;
  authenticity_status: Artifact["authenticity_status"];
  is_derivative: boolean;
  statement_role: StatementRole;
  issue_or_effective_date: string | null;
  raw_date_text?: string | null;
  exact_excerpt: string;
  locator: RealSourceLocator;
  related_provisions: Array<{
    work_id: string;
    version_id?: string;
    label: string;
    predicate: KnowledgeTypedPredicate;
    resolved: boolean;
  }>;
}

export interface GroundedAnswer {
  release_id: string;
  knowledge_snapshot_at: string;
  generated_at?: string;
  status: AnswerStatus;
  answer: string;
  claims: ClaimLedgerItem[];
  evidence: EvidenceCard[];
  assumptions: string[];
  clarification_questions: string[];
  coverage_warnings: string[];
  applicable_date: string | null;
  model_policy_version: string;
  trace_id: string;
  latency_ms: number;
  traceable_answer?: TraceableAnswerEnvelope;
}

// ============================================================================
// AUDIT-DRIVEN PAGE ROUTING, FONT REPAIR, ARCHIVE INTAKE & ASSEMBLY CONTRACTS
// ============================================================================

export type PageRoute =
  | "NATIVE"
  | "REPAIR"
  | "OCR"
  | "MIXED"
  | "REVIEW"
  | "NONCONTENT_CONFIRMED";

export interface NativeTextSpan {
  span_id: string;
  text: string;
  bbox: [number, number, number, number];
  font_fingerprint: string;
}

export interface PageImageRegion {
  region_id: string;
  bbox: [number, number, number, number];
  kind: "scanned_body" | "seal_or_stamp" | "signature" | "handwriting" | "table_image" | "decorative_border";
}

export interface PageProbeInput {
  artifact_id: string;
  actual_bytes_sha256: string;
  source_file_id: string;
  source_revision: string;
  total_physical_pages: number;
  physical_page_index: number; // 0-based
  printed_page_label: string | null;
  native_spans: NativeTextSpan[];
  image_regions: PageImageRegion[];
  is_visually_blank_canvas?: boolean;
  has_uncertain_critical_tokens?: boolean;
  config_version: string;
}

export interface PageRouteDecision {
  page_id: string; // artifact_id + ':' + physical_page_index
  artifact_id: string;
  physical_page_index: number;
  route: PageRoute;
  reason_codes: string[];
  region_decisions: Array<{
    region_or_span_id: string;
    action: "KEEP_NATIVE" | "DROP_DUPLICATE_OVERLAP" | "FONT_REPAIR" | "INVOKE_OCR" | "QUARANTINE_REVIEW" | "SKIP_DECORATIVE";
  }>;
  quality_measurements: {
    thai_char_ratio: number;
    corrupt_glyph_ratio: number;
    duplicate_overlap_spans: number;
    critical_tokens_detected: string[];
  };
  matched_font_fingerprint: string | null;
  requires_review: boolean;
  config_version: string;
}

export interface RepairInput {
  page_id: string;
  artifact_id: string;
  physical_page_index: number;
  raw_spans: NativeTextSpan[];
  font_registry_version: string;
}

export interface RepairResult {
  page_id: string;
  raw_text_preserved: string;
  repaired_text: string | null;
  applied_font_fingerprint: string | null;
  duplicate_spans_removed: number;
  legitimate_repeats_preserved: number;
  status: "REPAIRED_VERIFIED" | "FALLBACK_TO_OCR" | "QUARANTINE_REVIEW";
  reason_codes: string[];
  output_sha256: string | null;
}

export interface AssembledPageOutcome {
  page_id: string;
  physical_page_index: number;
  printed_page_label: string | null;
  initial_route: PageRoute;
  final_outcome:
    | "accepted_native"
    | "accepted_repaired"
    | "accepted_ocr"
    | "accepted_mixed"
    | "confirmed_noncontent"
    | "unresolved";
  potentially_material: boolean;
  ocr_invoked: boolean;
  ocr_region_calls: number;
  ocr_retry_attempts: number;
  final_text: string;
  raw_native_text: string;
  output_sha256: string;
  reviewer_decision?: "APPROVED" | "CORRECTED" | "PENDING" | null;
}

export interface PageAssemblyInput {
  artifact_id: string;
  total_physical_pages: number;
  measurement_basis: "pdf_physical_pages" | "unpaginated_structural_records";
  pages?: AssembledPageOutcome[];
  structural_records?: Array<{
    record_id: string;
    locator: RealSourceLocator;
    text: string;
    validated: boolean;
  }>;
}

export interface PageEquationAccounting {
  total_source_pages: number;
  native: number;
  repaired: number;
  ocr: number;
  mixed: number;
  noncontent_confirmed: number;
  unresolved: number;
  unique_ocr_invoked_pages: number;
  ocr_calls_including_retries: number;
  sum_matches: boolean;
}

export interface DocumentEvidence {
  artifact_id: string;
  measurement_basis: "pdf_physical_pages" | "unpaginated_structural_records";
  complete_and_publishable: boolean;
  blocking_reasons: string[];
  page_accounting: PageEquationAccounting;
  assembled_text: string;
  page_outcomes: AssembledPageOutcome[];
  record_count: number;
}

// ============================================================================
// DOMAIN PROFILE CONTRACTS (B01..B10)
// ============================================================================

export interface ProfileInput {
  batch_id: BatchId;
  artifact: Artifact;
  extraction: Extraction;
  candidate_work_id: string;
  candidate_version_id: string;
  release_id?: string;
  source_metadata?: Record<string, unknown>;
  processing_version: string;
  access_scope: string;
}

export interface DependencyRequest {
  citation_raw: string;
  normalized_key: string;
  target_type: KnowledgeEntityType;
  instrument_title_th: string;
  section_label: string | null;
  owner_batch_id: BatchId;
  first_loaded_by_batch_id: BatchId;
  required_by_work_id: string;
}

export interface B01ExtractedDomainFields {
  official_letter_no_raw: string | null;
  official_letter_no_normalized: string | null;
  issue_date_raw: string | null;
  issue_date_iso: string | null;
  tax_types: string[];
  relevant_tax_periods: string[];
  subject_th: string;
  requester_facts: string | null;
  requester_question: string | null;
  requester_proposed_treatment: string | null;
  rd_reasoning: string | null;
  rd_conclusion: string | null;
  conditions: string[];
  exceptions: string[];
  cited_provisions_raw: string[];
  cited_rulings_raw: string[];
  identity_or_date_unknown_restricted: boolean;
}

export interface B02ExtractedDomainFields {
  instrument_type:
    | "CODE"
    | "ORGANIC_ACT"
    | "ACT"
    | "EMERGENCY_DECREE"
    | "ROYAL_DECREE"
    | "MINISTERIAL_REGULATION"
    | "NOTIFICATION"
    | "ORDER_OR_REGULATION"
    | "DRAFT_BILL"
    | "LEGISLATIVE_COMMITTEE_REPORT"
    | "GUIDANCE_OR_COMPENDIUM";
  official_name_th: string;
  year_be: string | null;
  number_code: string | null;
  issuing_authority_id: string;
  gazette_ref: string | null;
  publication_date_iso: string | null;
  commencement_date_iso: string | null;
  commencement_note: string | null;
  draft_or_enacted_status:
    | "ENACTED_ORIGINAL"
    | "ENACTED_AMENDMENT"
    | "CONSOLIDATED_DERIVED"
    | "DRAFT_BILL"
    | "LEGISLATIVE_HISTORY"
    | "UNOFFICIAL_TRANSLATION";
  is_consolidated_derived: boolean;
  enabling_statute_citation: string | null;
  enabling_work_id: string | null;
  amendment_targets: string[];
  repeal_targets: string[];
  transition_conditions: string[];
  definitions: Array<{ term_th: string; definition_text: string }>;
  schedules_and_footnotes: string[];
  sections_extracted: string[];
  identity_or_date_unknown_restricted: boolean;
}

export interface ProfileResult {
  work: LegalWork;
  version: LegalVersion;
  child_works?: LegalWork[];
  child_versions?: LegalVersion[];
  passages: Passage[];
  proposed_assertions: Assertion[];
  dependency_requests: DependencyRequest[];
  unresolved_references: UnresolvedReferenceRecord[];
  domain_fields: B01ExtractedDomainFields | B02ExtractedDomainFields | Record<string, unknown>;
  review_reasons: string[];
}

// ============================================================================
// SERVICE FUNCTION INPUT / OUTPUT CONTRACTS (SECTION 8)
// ============================================================================

export interface ReconciliationPlan {
  plan_id: string;
  manifest_id: string;
  batch_id: BatchId;
  total_candidates: number;
  by_identity_action: Record<IdentityAction, number>;
  by_disposition: Record<CandidateDisposition, number>;
  planned_new_works: number;
  planned_reused_works: number;
  accounting_matches_total: boolean;
  silent_drops: number;
  generated_at: string;
}

export interface StartRunRequest {
  batch_id: BatchId;
  manifest_id: string;
  idempotency_key: string;
  max_documents?: number;
  ocr_dispatch_budget_pages?: number;
  projection_mode_override?: "durable_disk" | "memory_only" | "simulate_outage";
}

export interface JobReceipt {
  job_id: string;
  batch_id: BatchId;
  manifest_id: string;
  release_id: string;
  state: "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
  fencing_token: number;
  processed_candidates: number;
  ocr_pages_dispatched: number;
  idempotent_replay: boolean;
  started_at: string;
}

export interface EvaluationReport {
  evaluation_id: string;
  release_id: string;
  batch_id: BatchId;
  suite_id: string;
  development_families: number;
  holdout_families: number;
  metrics: {
    candidate_accounting_reconciled: boolean;
    critical_defects_open: number;
    citation_resolution: number;
    exact_identifier_lookup: number;
    evidence_recall_at_20: number;
    complete_decisive_evidence_recall: number;
    graph_evidence_integrity: number;
    graph_semantic_precision: number;
    claim_support: number;
    attempted_answer_correctness: number;
    attempted_count: number;
    answerable_holdout_count: number;
    useful_answer_coverage: number;
    abstention_count: number;
    prior_batch_regression_passed: boolean;
  };
  confidence_intervals_95: {
    attempted_answer_correctness: [number, number];
    useful_answer_coverage: [number, number];
    evidence_recall_at_20: [number, number];
  };
  ablation_comparison: {
    exact_lexical_recall: number;
    hybrid_no_graph_recall: number;
    hybrid_with_graph_recall: number;
    graph_improves_or_preserves_accuracy: boolean;
  };
  slice_breakdown: Record<string, { total: number; passed: number; recall_at_20: number }>;
  all_automated_gates_passed: boolean;
  evaluated_at: string;
}

export interface UatDecisionRequest {
  release_id: string;
  manifest_hash: string;
  expected_revision: number;
  decision: "UAT_PASS" | "UAT_PASS_WITH_DECLARED_GAPS" | "UAT_FAIL";
  declared_gaps_accepted?: string[];
  comments: string;
  case_decisions?: Array<{
    case_id: string;
    decision: "PASS" | "FAIL";
    comment: string;
  }>;
  custom_owner_questions?: OwnerCustomUatQuestionResult[];
}

export interface PromotionRequest {
  release_id: string;
  manifest_hash: string;
  expected_active_release_id: string | null;
  require_live_neo4j_aura?: boolean;
}

export interface ReleaseReceipt {
  release_id: string;
  batch_id: BatchId;
  state: ReleaseState;
  previous_active_release_id: string | null;
  active_release_id: string;
  smoke_test_passed: boolean;
  promoted_at: string;
  next_batch_unlocked: boolean;
}

export interface ConversationTurnInput {
  role: "user" | "assistant";
  content: string;
  applicable_date?: string | null;
  cited_work_ids?: string[];
}

export interface QueryRequest {
  question: string;
  release_id?: string;
  applicable_date?: string | null;
  mode?: "standard" | "exact_lookup" | "comparison";
  comparison_work_ids?: string[];
  conversation_history?: ConversationTurnInput[];
  attachment_doc_ids?: string[];
}

// ============================================================================
// RELEASE REPORT SCHEMA & VALIDATOR (RELEASE_REPORT_TEMPLATE.json v1.1)
// ============================================================================

export interface ReleaseReport {
  template_only: boolean;
  schema_version: "1.1";
  batch_id: BatchId | null;
  release_id: string | null;
  candidate_url: string | null;
  code_commit: string | null;
  manifest_hash: string | null;
  inventory_snapshot_id: string | null;
  source_cutoff_at: string | null;
  previous_accepted_release_id: string | null;
  scope_classification?: "FULL_BATCH_CANDIDATE" | "LIMITED_SCOPE_CANDIDATE";
  scope_label?: string | null;
  review_gate_status?: {
    mandatory_uat_gate_policy: "ALL_MANDATORY_CASES_MUST_PASS_20_OF_20";
    automated_gates_passed: boolean;
    automated_tests_replace_independent_legal_review: false;
    technical_review_complete: boolean;
    independent_legal_review_complete: boolean;
    formal_owner_uat_opened: boolean;
  } | null;
  supersession_lineage?: {
    supersedes_release_id: string;
    supersedes_manifest_id: string;
    supersedes_manifest_hash: string;
    prior_release_preserved_state: ReleaseState;
    prior_chat_approval_preserved: boolean;
    explanation: string;
  } | null;
  status: ReleaseState;
  inventory: {
    total_candidates: number | null;
    published_new: number | null;
    reused_existing: number | null;
    attached_representation: number | null;
    rejected_out_of_scope: number | null;
    deferred_with_reason: number | null;
    failed: number | null;
    accounting_matches: boolean | null;
  };
  knowledge: {
    canonical_works_new: number | null;
    works_reused: number | null;
    legal_versions_new: number | null;
    extraction_revisions_new: number | null;
    accepted_passages: number | null;
    accepted_assertions: number | null;
    active_vectors: number | null;
  };
  dependency_manifest_uri: string | null;
  coverage_gaps: string[];
  quality: {
    suite_id: string | null;
    holdout_question_families: number | null;
    citation_resolution: number | null;
    claim_support: number | null;
    attempted_answer_correctness: number | null;
    useful_answer_coverage: number | null;
    evidence_recall_at_20: number | null;
    critical_defects_open: number | null;
    report_uri: string | null;
  };
  replay_report_uri: string | null;
  regression_report_uri: string | null;
  graph_quality_report_uri: string | null;
  projection_receipts: ProjectionReceipt[];
  uat: {
    case_sheet_uri: string | null;
    mandatory_case_count: number;
    passed: number | null;
    failed: number | null;
    owner_decision: "UAT_PASS" | "UAT_PASS_WITH_DECLARED_GAPS" | "UAT_FAIL" | null;
    owner_actor_id: string | null;
    decided_at: string | null;
    approved_manifest_hash: string | null;
  };
  technical_attestation: AttestationRecord | null;
  legal_attestation: AttestationRecord | null;
  gap_acceptance: GapAcceptanceRecord | null;
  page_route_manifest_uri: string | null;
  archive_member_manifest_uri: string | null;
  font_mapping_registry_uri: string | null;
  extraction_benchmark_report_uri: string | null;
  page_quality_report_uri: string | null;
  page_accounting: PageEquationAccounting;
  forecast_basis: {
    measurement_status:
      | "measured_full_batch_scope"
      | "measured_pilot_and_in_repo_scope"
      | "estimated"
      | "unknown"
      | null;
    measured_throughput_report_uri: string | null;
    review_capacity_report_uri: string | null;
  };
  performance_cost_report_uri: string | null;
  rollback_target: string | null;
  production_smoke_report_uri: string | null;
  next_batch_unlocked: boolean;
}

export function validateReleaseReport(
  report: ReleaseReport,
  targetStage: "READY_FOR_UAT" | "RELEASE_APPROVED" | "ACCEPTED"
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (report.template_only === true) {
    errors.push("TEMPLATE_ONLY_REJECTED: Release report still has template_only=true.");
  }
  if (!report.batch_id || !report.release_id || !report.manifest_hash || !report.code_commit || !report.candidate_url) {
    errors.push("MISSING_CORE_IDENTIFIERS: batch_id, release_id, manifest_hash, code_commit, and candidate_url are required.");
  }

  const inv = report.inventory;
  const invFields = [
    inv.total_candidates,
    inv.published_new,
    inv.reused_existing,
    inv.attached_representation,
    inv.rejected_out_of_scope,
    inv.deferred_with_reason,
    inv.failed,
  ];
  if (invFields.some((v) => typeof v !== "number" || v < 0)) {
    errors.push("NULL_OR_INVALID_INVENTORY_COUNTS: All inventory accounting counts must be non-negative numbers.");
  } else {
    const sum =
      (inv.published_new ?? 0) +
      (inv.reused_existing ?? 0) +
      (inv.attached_representation ?? 0) +
      (inv.rejected_out_of_scope ?? 0) +
      (inv.deferred_with_reason ?? 0) +
      (inv.failed ?? 0);
    if (sum !== inv.total_candidates || inv.accounting_matches !== true) {
      errors.push(`INVENTORY_SUM_MISMATCH: Disposition sum (${sum}) !== total_candidates (${inv.total_candidates}).`);
    }
    if ((inv.failed ?? 0) > 0) {
      errors.push(`FAILED_RECORDS_PRESENT: ${inv.failed} failed candidate(s) block release progression.`);
    }
    if ((inv.deferred_with_reason ?? 0) > 0 && report.coverage_gaps.length === 0) {
      errors.push("UNDECLARED_DEFERRED_GAPS: Deferred records require explicit visible coverage_gaps.");
    }
    if (
      (inv.deferred_with_reason ?? 0) > 0 &&
      report.scope_classification &&
      report.scope_classification !== "LIMITED_SCOPE_CANDIDATE"
    ) {
      errors.push(
        "MISLABELED_LIMITED_SCOPE_CANDIDATE: Any candidate with deferred_with_reason > 0 must be labeled LIMITED_SCOPE_CANDIDATE."
      );
    }
  }

  const pa = report.page_accounting;
  if (
    typeof pa.total_source_pages !== "number" ||
    pa.sum_matches !== true ||
    pa.native + pa.repaired + pa.ocr + pa.mixed + pa.noncontent_confirmed + pa.unresolved !== pa.total_source_pages
  ) {
    errors.push("PAGE_ACCOUNTING_MISMATCH: Page equation does not balance or contains null counts.");
  }
  if ((pa.unresolved ?? 0) > 0) {
    errors.push(`UNRESOLVED_PAGES_PRESENT: ${pa.unresolved} unresolved page(s) block READY_FOR_UAT.`);
  }

  const requiredUris = [
    report.page_route_manifest_uri,
    report.archive_member_manifest_uri,
    report.font_mapping_registry_uri,
    report.extraction_benchmark_report_uri,
    report.page_quality_report_uri,
    report.graph_quality_report_uri,
    report.replay_report_uri,
    report.quality.report_uri,
    report.uat.case_sheet_uri,
    report.performance_cost_report_uri,
  ];
  if (requiredUris.some((u) => !u || typeof u !== "string")) {
    errors.push("MISSING_REQUIRED_REPORT_URIS: All mandatory audit/quality/page/UAT report URIs must be populated.");
  }

  if (report.uat.mandatory_case_count < 20) {
    errors.push("UAT_CASE_COUNT_BELOW_20: At least 20 mandatory bound owner UAT cases are required.");
  }

  if (report.projection_receipts.length === 0 || report.projection_receipts.some((r) => r.adapter_mode === "memory_only")) {
    errors.push("INVALID_PROJECTION_RECEIPTS: Memory-only or empty projection receipts cannot certify a candidate release.");
  }

  if (targetStage === "READY_FOR_UAT") {
    if (report.next_batch_unlocked === true && !report.uat.owner_decision) {
      errors.push("PREMATURE_UNLOCK: next_batch_unlocked cannot be true before owner UAT decision.");
    }
  }

  if (targetStage === "RELEASE_APPROVED" || targetStage === "ACCEPTED") {
    if (
      report.uat.owner_decision !== "UAT_PASS" &&
      report.uat.owner_decision !== "UAT_PASS_WITH_DECLARED_GAPS"
    ) {
      errors.push("MISSING_OWNER_PASS: Owner UAT pass is required before approval or acceptance.");
    }
    if ((report.uat.failed ?? 0) > 0) {
      errors.push(
        `MANDATORY_UAT_CASE_FAILURE: ${report.uat.failed} mandatory UAT case(s) failed; 02_OWNER_UAT_CHECKLIST.md requires 100% pass across all ${report.uat.mandatory_case_count} mandatory cases.`
      );
    }
    if (
      report.uat.passed !== null &&
      report.uat.passed < report.uat.mandatory_case_count
    ) {
      errors.push(
        `INCOMPLETE_MANDATORY_UAT_PASS: ${report.uat.passed}/${report.uat.mandatory_case_count} mandatory UAT cases passed; 02_OWNER_UAT_CHECKLIST.md requires ${report.uat.mandatory_case_count}/${report.uat.mandatory_case_count} (100%) without lowering the gate.`
      );
    }
    if ((report.quality.critical_defects_open ?? 0) > 0) {
      errors.push(
        `OPEN_CRITICAL_DEFECTS: ${report.quality.critical_defects_open} P0/P1 defect(s) remain open.`
      );
    }
    if (report.uat.approved_manifest_hash !== report.manifest_hash) {
      errors.push("APPROVAL_HASH_MISMATCH: Owner UAT approval hash does not match manifest_hash.");
    }
    if (
      !report.technical_attestation ||
      report.technical_attestation.manifest_hash !== report.manifest_hash ||
      !report.legal_attestation ||
      report.legal_attestation.manifest_hash !== report.manifest_hash
    ) {
      errors.push("MISSING_OR_STALE_ATTESTATIONS: Both technical and legal attestations must match manifest_hash.");
    }
    if (
      (report.inventory.deferred_with_reason ?? 0) > 0 &&
      (!report.gap_acceptance || !report.gap_acceptance.accepted)
    ) {
      errors.push("MISSING_GAP_ACCEPTANCE: Deferred items require explicit gap_acceptance.");
    }
  }

  return { valid: errors.length === 0, errors };
}
