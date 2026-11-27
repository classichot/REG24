/**
 * REG24 — Official-Source Citations & Claim Traceability Contracts
 *
 * Implements the logical data, API, MCP, Evidence Resolver, Export, and Acceptance contracts from:
 * "REG24 developer requirements — official-source citations and claim traceability" (Sections 1–10).
 */

import type { BatchId, StatementRole } from "./contracts";

export type OfficialSourceFamily =
  | "gazette_enactment"
  | "supreme_court_decision"
  | "council_of_state_opinion"
  | "revenue_department_ruling";

export type OfficialRecordType =
  | "full_record"
  | "official_summary"
  | "landing_only"
  | "third_party_discovery"
  | "verified_official_attachment";

export type AccessPermissionKind =
  | "public"
  | "authenticated_internal"
  | "restricted_tenant"
  | "restricted_external_official";

export type PreservationPermissionKind =
  | "version_pinned_official_archive"
  | "retained_artifact_permitted"
  | "metadata_only_ineligible";

export interface OfficialPublisherRegistryEntry {
  publisher_id: string;
  name_th: string;
  name_en: string;
  source_families: OfficialSourceFamily[];
  permitted_hosts: string[];
  supports_pdf_page_fragment: boolean;
  supports_html_fragment: boolean;
  reviewed_by: string;
  reviewed_at: string;
  active: boolean;
}

export interface SourceFamilyPinpointMetadata {
  // Gazette enactment or amendment
  volume?: string | null;
  issue?: string | null;
  provision_label?: string | null;
  paragraph_label?: string | null;
  gazette_printed_page?: string | null;
  // Supreme Court decision
  court_name_th?: string | null;
  decision_identifier?: string | null;
  decision_year_be?: string | null;
  reasoning_or_disposition_section?: string | null;
  // Council of State opinion
  opinion_identifier?: string | null;
  opinion_year_be?: string | null;
  question_no?: string | null;
  // Revenue Department ruling
  ruling_reference_no?: string | null;
  ruling_subject_th?: string | null;
  ruling_part?: "facts" | "question" | "answer_reasoning" | "answer_conclusion" | null;
}

export interface OfficialDocumentRecord {
  doc_id: string;
  source_family: OfficialSourceFamily;
  issuer_id: string;
  source_native_id: string | null;
  reviewed_surrogate_id: string | null;
  is_reviewed_surrogate: boolean;
  original_title_th: string;
  language: "th" | "en" | "mixed";
  record_type: OfficialRecordType;
  access_permission: AccessPermissionKind;
  preservation_permission: PreservationPermissionKind;
  access_scope: string;
  access_conditions_th: string | null;
  eligible_for_citation: boolean;
  ineligible_reason: string | null;
  canonical_work_id: string | null;
  owner_batch_id: BatchId;
  created_at: string;
}

export type ByteChangeClassification =
  | "initial_capture"
  | "identical_retry_reused"
  | "unclassified_byte_change_quarantined"
  | "reencode_non_substantive"
  | "verified_legal_amendment";

export interface ProvisionEffectiveIntervalRecord {
  provision_key: string;
  provision_label_th: string;
  effective_from: string | null;
  effective_to: string | null;
  applicability_basis?: string | null;
  applicability_from_tax_year_be?: number | null;
  transitional_rule_th?: string | null;
  transitional_evidence_passage_ids?: string[];
}

export interface DocumentVersionRecord {
  version_id: string;
  doc_id: string;
  artifact_sha256: string;
  captured_at: string;
  artifact_ref: string;
  mime_type: string;
  byte_size: number;
  source_metadata: Record<string, unknown> & SourceFamilyPinpointMetadata;
  publication_date: string | null;
  publication_date_status: "known" | "unknown_explicit";
  effective_from: string | null;
  effective_to: string | null;
  effective_date_status: "known" | "unknown_explicit" | "open_ended" | "transitional_conditional";
  applicability_rules_th: string[];
  affected_provisions: ProvisionEffectiveIntervalRecord[];
  predecessor_version_id: string | null;
  amending_version_ids: string[];
  byte_change_classification: ByteChangeClassification;
  canonical_version_id: string | null;
  created_at: string;
}

export type IdentityMatchResult =
  | "VERIFIED_MATCH"
  | "FAILED_LOGIN_WALL"
  | "FAILED_HOMEPAGE_OR_SEARCH"
  | "FAILED_SOFT_404"
  | "FAILED_UNRELATED_DOCUMENT"
  | "FAILED_UNTRUSTED_HOST"
  | "PENDING_VERIFICATION";

export type OfficialLinkHealthStatus =
  | "verified_online"
  | "unchecked_live"
  | "temporarily_offline"
  | "moved_verified"
  | "quarantined_identity_failure";

export interface OfficialLocationRecord {
  location_id: string;
  doc_id: string;
  version_id: string | null;
  exact_official_url: string;
  role:
    | "primary_official"
    | "durable_landing_record"
    | "expiring_direct_asset"
    | "pinned_official_archive"
    | "official_attachment_origin"
    | "third_party_discovery";
  parent_landing_location_id: string | null;
  original_observed_url: string;
  redirect_history: string[];
  prior_urls: Array<{
    url: string;
    replaced_at: string;
    reason: string;
    approved_by: string;
  }>;
  first_verified_at: string | null;
  last_verified_at: string | null;
  last_successful_verified_at: string | null;
  verification_method: string;
  identity_match_result: IdentityMatchResult;
  link_health: OfficialLinkHealthStatus;
  last_http_status: number | null;
  failure_reason: string | null;
  is_active_primary: boolean;
}

export interface PageMappingEntry {
  physical_page_one_based: number;
  printed_page_label: string | null;
  width_pt?: number;
  height_pt?: number;
  rotation_deg?: 0 | 90 | 180 | 270;
  is_scanned_page?: boolean;
  scan_image_data_uri_or_ref?: string | null;
  page_text_verbatim: string;
}

export interface ExtractionAlignmentSegment {
  segment_index: number;
  physical_page_one_based: number;
  printed_page_label: string | null;
  raw_start: number;
  raw_end: number;
  normalized_start: number;
  normalized_end: number;
  bbox_normalized?: [number, number, number, number] | null;
}

export interface ExtractionRevisionRecord {
  extraction_revision_id: string;
  version_id: string;
  parent_revision_id: string | null;
  parser_or_ocr_version: string;
  model_confidence?: number | null;
  is_scanned_material: boolean;
  page_mapping: PageMappingEntry[];
  raw_transcription: string;
  normalized_search_text: string;
  alignment_map: ExtractionAlignmentSegment[];
  ocr_ambiguity_detected: boolean;
  ocr_ambiguity_reasons: string[];
  ocr_review_crop_bbox?: [number, number, number, number] | null;
  ocr_review_page_one_based?: number | null;
  review_status:
    | "VERIFIED_NATIVE"
    | "AWAITING_THAI_REVIEW"
    | "REVIEWED_APPROVED"
    | "REVIEWED_CORRECTED"
    | "QUARANTINED";
  reviewer_id: string | null;
  reviewed_at: string | null;
  correction_note: string | null;
  created_at: string;
}

export interface TypedPassageAnchor {
  anchor_kind: "pdf_page_span" | "scan_bbox_span" | "html_text_quote" | "table_cell_span";
  physical_page_one_based?: number;
  printed_page_label?: string | null;
  page_width_pt?: number;
  page_height_pt?: number;
  rotation_deg?: 0 | 90 | 180 | 270;
  /** Normalized [x0, y0, x1, y1] in [0..1] coordinates for scan/PDF highlighting */
  bbox_normalized?: [number, number, number, number];
  /** HTML captured-version anchor + W3C TextQuoteSelector-compatible prefix/exact/suffix */
  html_fragment_id?: string | null;
  structural_selector?: string | null;
  exact_quote?: string;
  quote_prefix?: string;
  quote_suffix?: string;
  /** Structured table headers when passage is extracted from a statutory/rate schedule table */
  table_row_headers?: string[];
  table_column_headers?: string[];
}

export interface EvidencePassageRecord {
  passage_id: string;
  extraction_revision_id: string;
  version_id: string;
  doc_id: string;
  verbatim_text: string;
  normalized_search_text: string;
  text_sha256: string;
  surrounding_before: string;
  surrounding_after: string;
  section_paragraph_path: string[];
  statement_role: StatementRole;
  physical_page_start: number | null;
  physical_page_end: number | null;
  printed_page_start: string | null;
  printed_page_end: string | null;
  anchors: TypedPassageAnchor[];
  human_pinpoint_th: string;
  source_family_pinpoint: SourceFamilyPinpointMetadata;
  locator_replay_status: "VERIFIED" | "QUARANTINED";
  quarantine_reason: string | null;
  eligible_for_publication: boolean;
  access_scope: string;
  created_at: string;
}

export interface EvidencedGraphAssertionRecord {
  assertion_id: string;
  subject_id: string;
  predicate: string;
  object_id: string;
  proposition_text_th: string;
  applicability: {
    valid_from: string | null;
    valid_to: string | null;
    conditions: string[];
  };
  evidence_passage_ids: string[];
  relation_to_evidence: "substantive_support" | "navigation_only" | "similarity_only";
  verification_state: "VERIFIED" | "PROPOSED" | "QUARANTINED" | "WITHDRAWN";
}

export type AtomicClaimType =
  | "legal_proposition"
  | "interpretation"
  | "user_fact_or_assumption"
  | "scoped_unresolved_notice";

export type VerifierDecisionOutcome =
  | "supported"
  | "insufficient"
  | "conflicting"
  | "needs_review"
  | "legacy_unverified"
  | "user_supplied_unverified";

export type ClaimSupportRole =
  | "primary_authority"
  | "statutory_premise"
  | "ruling_application"
  | "judicial_reasoning"
  | "exception_or_proviso"
  | "transitional_applicability"
  | "requester_factual_context"
  | "official_summary_scope"
  | "verified_attachment_authority"
  | "context";

export interface ClaimEvidenceReferenceDto {
  link_id: string;
  evidence_id: string;
  doc_id: string;
  version_id: string;
  extraction_revision_id: string;
  support_role: ClaimSupportRole;
  support_role_label_th: string;
  required_group: string;
  citation_label_th: string;
  issuer_name_th: string;
  source_family: OfficialSourceFamily;
  source_family_label_th: string;
  record_type: OfficialRecordType;
  record_type_label_th: string;
  date_relied_on: string | null;
  official_url: string;
  official_url_with_anchor: string;
  resolver_url: string;
  locator: {
    human_pinpoint_th: string;
    section_paragraph_path: string[];
    physical_page_start: number | null;
    physical_page_end: number | null;
    printed_page_start: string | null;
    printed_page_end: string | null;
    anchors: TypedPassageAnchor[];
  };
  verification_status: VerifierDecisionOutcome;
  link_health: OfficialLinkHealthStatus;
  link_health_notice_th: string | null;
  last_successful_verification_at: string | null;
  access_permission: AccessPermissionKind;
  access_conditions_th: string | null;
  /** Verbatim excerpt of the pinned passage preserved across Save and exact Reopen. */
  verbatim_excerpt_th?: string;
  /** Original official title of the source document preserved across Save and exact Reopen. */
  original_title_th?: string;
  /** False when a preserved historical attachment has been superseded or marked unverified. */
  currently_verified?: boolean;
  /** Distinguishes currently verified evidence from superseded/unverified historical attachments preserved for audit review. */
  historical_evidence_status?: "currently_verified" | "superseded_historical" | "unverified_historical";
  /** Thai reviewer notice displayed when historical cited evidence is no longer currently verified. */
  historical_evidence_notice_th?: string | null;
}

export interface ClaimBoundCalculationRecord {
  calculation_id: string;
  claim_id: string;
  answer_revision: string;
  verifier_version: string;
  formula: string;
  inputs: Record<string, number | string | boolean | null>;
  outputs: Record<string, number | string | boolean | null>;
  units: {
    primary_unit: "THB" | "PERCENT" | "DAYS" | "YEARS" | "MIXED";
    detail_th: string;
  };
  source_versions: Array<{
    evidence_id: string;
    doc_id: string;
    version_id: string;
  }>;
  verified_numeric_tokens: string[];
  verified_at: string;
}

export interface PublishedAtomicClaimDto {
  claim_id: string;
  claim_number: number;
  text: string;
  claim_type: AtomicClaimType;
  claim_type_label_th: string;
  premise_ids: string[];
  verification_decision: VerifierDecisionOutcome;
  published: boolean;
  withheld_explanation_th: string | null;
  evidence_references: ClaimEvidenceReferenceDto[];
  /** Subordinate instruments explicitly mentioned ONLY in an expiry/non-applicability exclusion context (DEF-C10-1). */
  excluded_context_instruments?: string[];
  /** Server-verified calculation bound strictly to THIS claim and answer revision (never pooled across claims). */
  bound_calculation?: ClaimBoundCalculationRecord | null;
}

export interface UnresolvedIssueDto {
  issue_id: string;
  scope_key: string;
  explanation_th: string;
  reason_code:
    | "MISSING_APPLICABLE_DATE"
    | "UNVERIFIED_HISTORICAL_VERSION"
    | "AMBIGUOUS_OCR_AWAITING_REVIEW"
    | "DEPENDENT_PREMISE_WITHHELD"
    | "CONTRADICTING_EXCEPTION_UNRESOLVED"
    | "THIRD_PARTY_ONLY_SOURCE"
    | "IDENTITY_VERIFICATION_FAILED"
    | "INSUFFICIENT_CORPUS_EVIDENCE"
    | "PUBLICATION_SWITCH_READONLY";
  withheld_claim_ids: string[];
}

export type TraceablePublicationChannel =
  | "chat"
  | "research"
  | "report"
  | "saved_answer"
  | "export"
  | "api"
  | "mcp";

export interface NewerMaterialUpdateNoticeDto {
  has_newer_material: boolean;
  latest_version_id: string;
  cited_version_id: string;
  doc_id: string;
  notice_th: string;
  detected_at: string;
}

export interface AnswerRevisionHistoryEntryDto {
  answer_revision: string;
  revision_number: number;
  supersedes_answer_revision: string | null;
  generated_at: string;
  as_of_date: string | null;
  status: "complete" | "partial" | "insufficient" | "legacy_unverified";
  actor_id: string;
  owner_actor_id: string;
  revision_reason: string;
  published_claims_count: number;
}

export interface RejectedCalculationDiagnosticDto {
  /** Matches `qa_synthetic_fixture` (e.g. `"RC1_REJECTED_CALC"`) when triggered by a QA synthetic fixture, else `null`. */
  fixture_id: string | null;
  /** Deterministic claim/issue ID whose proposed calculation was rejected by the verifier. */
  rejected_claim_or_issue_id: string;
  /** Verifier rejection code (without leaking unverified numeric figures). */
  rejection_code: string;
  /** Redacted human-readable diagnostic reason (zero unverified rates or amounts). */
  reason_th: string;
}

export interface TraceableAnswerEnvelope {
  schema_version: "reg24.citation-traceability.v1";
  answer_id: string;
  answer_revision: string;
  revision_number: number;
  supersedes_answer_revision: string | null;
  owner_actor_id?: string;
  owner_tenant_id?: string;
  revision_reason?: string;
  revision_history?: AnswerRevisionHistoryEntryDto[];
  channel: TraceablePublicationChannel;
  generated_at: string;
  as_of_date: string | null;
  status: "complete" | "partial" | "insufficient" | "legacy_unverified";
  /** Preserves exact GroundedAnswer status (`ANSWERED` / `CONDITIONAL` / `NEEDS_CLARIFICATION` / `INSUFFICIENT_EVIDENCE` / `REVIEW_REQUIRED`) across Save & Reopen. */
  grounded_answer_status?: import("./contracts").AnswerStatus;
  rendered_answer_th: string;
  user_supplied_facts: string[];
  assumptions: string[];
  clarification_questions_th?: string[];
  coverage_warnings_th?: string[];
  historical_evidence_warnings_th?: string[];
  rejected_calculations_diagnostic?: RejectedCalculationDiagnosticDto[];
  claims: PublishedAtomicClaimDto[];
  unresolved_issues: UnresolvedIssueDto[];
  legacy_warning_th: string | null;
  update_notices?: NewerMaterialUpdateNoticeDto[];
  execution_provenance?: import("./contracts").ExecutionProvenanceMetadata | null;
  /** Durable conversation lineage identifier bound to this revision chain for cross-matter isolation. */
  conversation_id?: string | null;
  /** Optional full GroundedAnswer snapshot persisted & rehydrated verbatim across Save and Reopen. */
  grounded_answer_snapshot?: Omit<
    import("./contracts").GroundedAnswer,
    "traceable_answer" | "llm_audit_trace"
  > | null;
  verifier_metadata: {
    verifier_version: string;
    ruleset_version: string;
    release_id: string;
    publication_gate_mode: "enforced" | "verified_readonly" | "generation_disabled";
  };
}

export interface ResolvedPinnedEvidenceResponse {
  ok: boolean;
  http_status: 200 | 403 | 404;
  unavailable_code?: "NOT_FOUND_OR_RESTRICTED" | "WITHDRAWN";
  error_th?: string;
  evidence?: {
    evidence_id: string;
    doc_id: string;
    version_id: string;
    extraction_revision_id: string;
    source_distinction_banner_th: string;
    reg24_preserved_copy_label_th: string;
    official_website_label_th: string;
    issuer_id: string;
    issuer_name_th: string;
    source_family: OfficialSourceFamily;
    source_family_label_th: string;
    record_type: OfficialRecordType;
    record_type_label_th: string;
    original_title_th: string;
    source_native_id: string | null;
    publication_date: string | null;
    effective_from: string | null;
    effective_to: string | null;
    artifact_sha256: string;
    captured_at: string;
    verbatim_quote: string;
    surrounding_before: string;
    surrounding_after: string;
    human_pinpoint_th: string;
    section_paragraph_path: string[];
    physical_page_start: number | null;
    physical_page_end: number | null;
    printed_page_start: string | null;
    printed_page_end: string | null;
    anchors: TypedPassageAnchor[];
    is_scanned_material: boolean;
    scan_pages: Array<{
      physical_page_one_based: number;
      printed_page_label: string | null;
      width_pt: number;
      height_pt: number;
      rotation_deg: 0 | 90 | 180 | 270;
      scan_preview_svg_data_uri: string;
      reviewed_text: string;
      highlight_bboxes: Array<[number, number, number, number]>;
    }>;
    ocr_audit_trail: Array<{
      extraction_revision_id: string;
      parser_or_ocr_version: string;
      review_status: ExtractionRevisionRecord["review_status"];
      raw_transcription: string;
      reviewer_id: string | null;
      reviewed_at: string | null;
      correction_note: string | null;
    }>;
    official_location: {
      exact_official_url: string;
      official_url_with_anchor: string;
      link_health: OfficialLinkHealthStatus;
      link_health_label_th: string;
      last_successful_verified_at: string | null;
      url_history: OfficialLocationRecord["prior_urls"];
      access_permission: AccessPermissionKind;
      access_conditions_th: string | null;
    };
    verification_status: "VERIFIED" | "QUARANTINED";
    currently_verified?: boolean;
    historical_evidence_status?: "currently_verified" | "superseded_historical" | "unverified_historical";
    historical_evidence_notice_th?: string | null;
    resolver_url: string;
  };
}

export interface TraceabilityAuditEventRecord {
  audit_id: string;
  actor_or_service: string;
  recorded_at: string;
  event_type:
    | "SOURCE_CAPTURED"
    | "OFFICIAL_ATTACHMENT_VERIFIED"
    | "OFFICIAL_ATTACHMENT_REJECTED"
    | "OFFICIAL_ATTACHMENT_SUPERSEDED"
    | "IDENTITY_VERIFIED"
    | "IDENTITY_QUARANTINED"
    | "OCR_AMBIGUITY_QUARANTINED"
    | "OCR_THAI_REVIEW_COMPLETED"
    | "ANSWER_PUBLISHED_ATOMIC"
    | "ANSWER_REVISION_CREATED"
    | "SECURITY_UNAUTHORIZED_ANSWER_MUTATION_BLOCKED"
    | "CLAIM_HUMAN_AMBIGUITY_APPROVED"
    | "OFFICIAL_LINK_HEALTH_UPDATED"
    | "OFFICIAL_URL_REPLACEMENT_APPROVED"
    | "PUBLICATION_GATE_SWITCH_CHANGED"
    | "LEGACY_ANSWER_BACKFILLED";
  affected_ids: string[];
  before_status: Record<string, unknown> | null;
  after_status: Record<string, unknown> | null;
  reason: string;
  correlation_id: string;
}

export interface ReconciliationTaskRecord {
  task_id: string;
  discovery_doc_id: string;
  observed_url: string;
  target_hint: string;
  reason: string;
  status: "OPEN" | "RECONCILED" | "REJECTED";
  created_at: string;
  resolved_at: string | null;
}

export interface TraceabilityProjectionOutboxItem {
  outbox_id: string;
  target_store: "lexical" | "vector" | "graph";
  entity_kind: "passage" | "assertion" | "answer";
  entity_id: string;
  attempt_count: number;
  status: "PENDING" | "COMPLETED" | "RETRYABLE_FAILED";
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
}

export type LegalReviewVerdict =
  | "PASS_SUPPORTED"
  | "FAIL_UNSUPPORTED_OR_WEAK_EVIDENCE"
  | "FAIL_WRONG_LAW_OR_VERSION"
  | "NEEDS_REFINEMENT";

export interface LegalReviewFeedbackRecord {
  feedback_id: string;
  scenario_id: string | null;
  question_text: string;
  as_of_date: string | null;
  answer_revision_id: string | null;
  answer_status: string;
  reviewer_name: string;
  reviewer_actor_id: string;
  verdict: LegalReviewVerdict;
  checked_original_source: boolean;
  comments_th: string;
  cited_evidence_ids: string[];
  environment_scope: "staging" | "trial";
  recorded_at: string;
}

export interface PersistedCitationTraceabilityState {
  initialized_for_release_id: string | null;
  publication_gate_mode: "enforced" | "verified_readonly" | "generation_disabled";
  publishers: Record<string, OfficialPublisherRegistryEntry>;
  documents: Record<string, OfficialDocumentRecord>;
  versions: Record<string, DocumentVersionRecord>;
  locations: Record<string, OfficialLocationRecord>;
  extraction_revisions: Record<string, ExtractionRevisionRecord>;
  passages: Record<string, EvidencePassageRecord>;
  graph_assertions: Record<string, EvidencedGraphAssertionRecord>;
  published_answers: Record<
    string,
    TraceableAnswerEnvelope & {
      actor_id: string;
      tenant_id: string;
      owner_actor_id: string;
      owner_tenant_id: string;
      revision_reason: string;
      question_text: string;
    }
  >;
  claim_evidence_links: Record<string, ClaimEvidenceReferenceDto & { answer_revision: string; claim_id: string; verifier_or_reviewer_id: string; ruleset_version: string; verified_at: string }>;
  audit_events: TraceabilityAuditEventRecord[];
  reconciliation_tasks: Record<string, ReconciliationTaskRecord>;
  projection_outbox: Record<string, TraceabilityProjectionOutboxItem>;
  legal_review_feedback?: Record<string, LegalReviewFeedbackRecord>;
}

export interface BatchIngestionStageCounts {
  batch_id: BatchId;
  release_id: string;
  documents: {
    discovered: number;
    captured: number;
    verified: number;
    eligible: number;
    quarantined: number;
    quarantined_by_reason: Record<string, number>;
    by_source_family: Record<
      OfficialSourceFamily,
      { discovered: number; eligible: number; quarantined: number }
    >;
  };
  passages: {
    discovered: number;
    captured: number;
    verified: number;
    eligible: number;
    quarantined: number;
    quarantined_by_reason: Record<string, number>;
  };
}

export interface CitationAcceptanceMeasurementReport {
  batch_id: BatchId;
  release_id: string;
  measured_at: string;
  published_claim_coverage: {
    numerator: number;
    denominator: number;
    ratio: number | "no_observations";
    unsegmented_rendered_claims_detected: number;
    passes_100_percent_gate: boolean;
  };
  published_citation_traceability: {
    numerator: number;
    denominator: number;
    ratio: number | "no_observations";
    channels_verified: TraceablePublicationChannel[];
    passes_100_percent_gate: boolean;
  };
  semantic_support_acceptance: {
    adjudicated_cases: number;
    supported_claims: number;
    unsupported_claims: number;
    material_omitted_qualifications: number;
    passes_zero_defect_gate: boolean;
    case_adjudications: Array<{
      case_id: string;
      as_of_date: string | null;
      expected_outcome: string;
      actual_status: string;
      reviewer_id: string;
      adjudication: "PASS" | "FAIL";
    }>;
  };
  official_link_availability: {
    verified_reachable_count: number;
    total_checked_locations: number;
    checked_at: string;
    failed_locations: Array<{
      location_id: string;
      url: string;
      cause: string;
    }>;
  };
  coverage_and_withholding: {
    eligible_documents: number;
    inventory_documents: number;
    document_eligibility_ratio: number | "no_observations";
    answered_questions: number;
    partial_questions: number;
    withheld_questions: number;
    attempted_questions: number;
    withheld_by_reason: Record<string, number>;
    positive_fixtures_non_empty_verified: boolean;
  };
  all_release_gates_passed: boolean;
}
