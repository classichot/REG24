/**
 * REG24 ↔ RAG24 Normative Shared Contract — `ocr-contract/2.0.0`
 * Specification: REG24 Thai Legal OCR, Verification and Source-Linked Publication v2.0 (13 November 2026)
 *
 * Rules:
 * - JSON field names: snake_case
 * - Timestamps: UTC RFC 3339
 * - SHA-256 digests: 64-character lowercase hexadecimal (no `sha256:` prefix inside contract fields)
 * - Page numbers: 1-based integers
 * - SourceSpan offsets: 0-based Unicode code-point indices into `page.raw_text` (`raw_start` inclusive, `raw_end` exclusive)
 * - Table cells: 0-based `row`/`column`, positive integer `row_span`/`column_span`, non-overlapping
 * - Money: integer micro-units + ISO 4217 currency code (never binary floating point)
 * - `null` = unknown/unavailable; `[]` = evaluated and none found; never invent polygons, confidence, or missing text.
 */

import { createHash, createHmac } from "crypto";

// ============================================================================
// 1. NORMATIVE `ocr-contract/2.0.0` TYPES
// ============================================================================

export type JobState =
  | "queued"
  | "running"
  | "waiting_retry"
  | "review_required"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PageState = "extracted" | "verified_blank" | "unresolved" | "failed";

export type PrivacyClass = "public" | "internal" | "confidential" | "restricted";

export type IssueSeverity = "info" | "warning" | "blocking";

export interface SourceSpan {
  page_number: number;
  block_id: string | null;
  raw_start: number | null; // zero-based Unicode code-point offset, inclusive
  raw_end: number | null;   // exclusive; offsets reference page.raw_text
  polygon: {
    points: Array<[number, number]>;
    units: "normalized";
    origin: "top_left";
    rotation_degrees: number;
    image_sha256: string;
  } | null;
}

export interface OCRIssue {
  issue_id: string;
  code: string;
  severity: IssueSeverity;
  page_number: number | null;
  block_id: string | null;
  message: string;
  evidence_refs: string[];
  detector_version: string;
  resolution: "open" | "accepted" | "corrected";
}

export type OCRBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "caption"
  | "footnote"
  | "header"
  | "footer"
  | "other";

export interface OCRBlock {
  block_id: string;
  kind: OCRBlockKind;
  reading_order: number;
  raw_text: string;
  span: SourceSpan;
}

export interface OCRTableCell {
  row: number;
  column: number;
  row_span: number;
  column_span: number;
  raw_text: string;
  span: SourceSpan;
}

export interface OCRTable {
  table_id: string;
  page_number: number;
  block_id: string | null;
  structure_status: "supported" | "partial" | "unsupported";
  cells: OCRTableCell[];
  markdown: string | null;
  issue_ids: string[];
  continuation_from_table_id?: string | null;
  continuation_to_table_id?: string | null;
}

export interface OCRPage {
  page_number: number;
  state: PageState;
  image_sha256: string;
  raw_text: string;
  markdown: string | null;
  normalized_text: string;
  normalization: {
    ruleset: string;
    mapping_ref: string;
  };
  blocks: OCRBlock[];
  tables: OCRTable[];
  provenance: {
    method: "native" | "ocr" | "human";
    attempt_id: string;
    provider_id: string;
    model_revision: string;
    adapter_version: string;
    raw_response_ref: string | null;
  };
  confidence: {
    value: number;
    scale: string;
    meaning: string;
    calibration_id: string | null;
  } | null;
  issue_ids: string[];
}

export interface ExtractionManifest {
  contract_version: "2.0.0";
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  source_version_id: string;
  extraction_version_id: string;
  job_id: string;
  original_sha256: string;
  source_metadata_ref: string;
  expected_page_count: number;
  returned_page_count: number;
  content_digest: string;
  digest_ruleset: "ocr-digest/1";
  privacy_class: PrivacyClass;
  policy_revision: string;
  created_at: string;
  completeness: "complete" | "incomplete" | "unverified";
  quality: "passed" | "review_required" | "failed";
  pages_ref: string;
  issues: OCRIssue[];
  predecessor_extraction_version_id?: string | null;
}

export interface OCRJob {
  job_id: string;
  parent_job_id?: string | null;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  source_version_id: string;
  state: JobState;
  state_revision: number;
  policy_revision: string;
  created_at: string;
  updated_at: string;
  extraction_version_id: string | null;
  progress: {
    expected_pages: number | null;
    completed_pages: number;
  };
  budget: {
    reservation_id: string;
    currency: string;
    reserved_micros: number;
    consumed_micros: number;
    uncertain_micros?: number;
  };
  error: {
    code: string;
    retryable: boolean;
    message: string;
  } | null;
}

// ============================================================================
// 2. STABLE ERROR ENVELOPE & CODES
// ============================================================================

export type OcrErrorCode =
  | "SOURCE_NOT_READY"
  | "INVALID_FILE"
  | "PAGE_LIMIT"
  | "VERSION_REQUIRED"
  | "POLICY_BLOCKED"
  | "PROVIDER_UNAVAILABLE"
  | "BUDGET_EXCEEDED"
  | "RATE_LIMITED"
  | "INCOMPLETE_OUTPUT"
  | "QUALITY_REVIEW_REQUIRED"
  | "VERSION_CONFLICT"
  | "ACCESS_DENIED"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "DUAL_CONTROL_REQUIRED"
  | "STAGING_FAILED"
  | "FEATURE_DISABLED";

export interface OcrContractErrorEnvelope {
  code: OcrErrorCode;
  message: string;
  retryable: boolean;
  request_id: string;
  details: Record<string, unknown>;
}

// ============================================================================
// 3. REG24 LEGAL DOMAIN TYPES (SECTIONS 4, 6, 7, 8)
// ============================================================================

export type LegalSourceCategory =
  | "supreme_court_judgment"       // คำพิพากษาศาลฎีกา
  | "royal_gazette"                // ราชกิจจานุเบกษา
  | "council_of_state_opinion"     // ความเห็นคณะกรรมการกฤษฎีกา
  | "revenue_department_ruling"    // ข้อหารือกรมสรรพากร
  | "statute"                      // พระราชบัญญัติ / ประมวลกฎหมาย
  | "subordinate_legislation"      // พระราชกฤษฎีกา / กฎกระทรวง / ประกาศ
  | "organization_contract";       // สัญญาและเอกสารภายในองค์กร

export type SourceAuthorityStatus =
  | "official_confirmed"
  | "secondary"
  | "unconfirmed"
  | "disputed";

export type TranscriptionStatus =
  | "unreviewed"
  | "review_required"
  | "ocr_verified"
  | "rejected";

export type ReferenceStatus =
  | "unchecked"
  | "candidate"
  | "resolved"
  | "conflict";

export type ApplicabilityStatus =
  | "not_assessed"
  | "curated"
  | "disputed";

export type LegalPublicationStatus =
  | "draft"
  | "staging"
  | "published"
  | "superseded"
  | "withdrawn";

export type OcrHumanRole =
  | "uploader"
  | "reviewer"
  | "legal_editor"
  | "publisher"
  | "administrator"
  | "reader"
  | "service_account";

export interface OcrPrincipalContext {
  principal_id: string;
  tenant_id: string;
  workspace_id: string;
  roles: OcrHumanRole[];
  scopes: string[];
  is_service_account: boolean;
  revoked?: boolean;
  confidential_access_granted?: boolean;
}

export interface LegalSourceRecord {
  source_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  title_th: string;
  title_en: string;
  original_url: string | null;
  redirect_history: string[];
  retrieval_headers: Record<string, string>;
  publisher_asserted: string;
  publisher_verified: string | null;
  source_category: LegalSourceCategory;
  acquisition_method: "direct_upload" | "official_connector" | "gazette_feed" | "court_archive";
  retrieval_timestamp: string;
  declared_document_date: string | null;
  privacy_class: PrivacyClass;
  retention_policy: string;
  authority_assessment: {
    status: SourceAuthorityStatus;
    evidence: string;
    assessor_id: string | null;
    reviewed_at: string | null;
  };
  legal_hold: boolean;
  status: "active" | "superseded" | "withdrawn";
}

export interface RenderedPageEvidence {
  page_number: number;
  image_sha256: string;
  width_px: number;
  height_px: number;
  rotation_degrees: number;
  has_visible_content: boolean;
  blank_detector_score: number | null;
  rendered_reference_text?: string; // Reference visual ground-truth or sampled OCR check in fixtures
  native_pdf_text?: string | null;
}

export interface LegalSourceVersion {
  source_version_id: string;
  source_id: string;
  document_id: string;
  tenant_id: string;
  workspace_id: string;
  original_sha256: string;
  mime_type: string;
  byte_length: number;
  privacy_class: PrivacyClass;
  state: "pending_upload" | "ready" | "quarantined" | "rejected";
  quarantine_reason: string | null;
  expected_page_count: number;
  renderer_revision: string;
  pages_manifest: RenderedPageEvidence[];
  created_at: string;
  finalized_at: string | null;
}

export type ThaiLegalEntityType =
  | "court"
  | "case_identifier"
  | "statutory_instrument"
  | "section_reference"
  | "gazette_reference"
  | "agency"
  | "ruling_identifier"
  | "date_expression"
  | "amendment_repeal_reference"
  | "monetary_threshold"
  | "negation_clause";

export type LegalDateRole =
  | "signing"
  | "publication"
  | "commencement"
  | "amendment"
  | "repeal"
  | "judgment"
  | "unspecified";

export type LegalGraphRelationKind =
  | "AMENDS"
  | "REPEALS"
  | "CITES"
  | "INTERPRETS"
  | "EFFECTIVE_FROM";

export interface LegalAnnotation {
  annotation_id: string;
  annotation_version: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  extraction_version_id: string;
  entity_type: ThaiLegalEntityType;
  raw_value: string;
  normalized_candidate: string;
  source_spans: SourceSpan[];
  extractor_revision: string;
  resolution_status: "unresolved_candidate" | "resolved" | "conflict" | "rejected";
  resolved_target_id: string | null;
  cited_instrument_title: string | null;
  discourse_context: "operative_holding" | "quoted_passage" | "statutory_provision" | "header_footer";
  date_metadata?: {
    calendar: "BE" | "CE" | "unknown";
    precision: "day" | "month" | "year" | "ambiguous";
    date_role: LegalDateRole;
    iso_candidate: string | null;
    ambiguity_flags: string[];
  };
  proposed_relation?: {
    relation_type: LegalGraphRelationKind;
    target_id: string | null;
  };
  evidence_refs: string[];
  reviewer_decision_ids: string[];
  invalidated_by_correction_id?: string | null;
}

export interface ApplicabilityCurationMetadata {
  scope: string | null;
  relevant_effective_from: string | null;
  relevant_effective_to: string | null;
  jurisdiction: string;
  evidence: string | null;
  curator_id: string | null;
  curated_at: string | null;
}

export interface LegalDocumentVersion {
  version_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  source_id: string;
  source_version_id: string;
  extraction_version_id: string;
  annotation_version: string;
  normalization_ruleset: string;
  workflow_revision: number; // Required for `If-Match` optimistic locking
  transcription_status: TranscriptionStatus;
  reference_status: ReferenceStatus;
  applicability_status: ApplicabilityStatus;
  publication_status: LegalPublicationStatus;
  applicability_metadata: ApplicabilityCurationMetadata;
  active_publication_id: string | null;
  migration_audit_tag?: "legacy_unverified" | null;
  has_resolved_material_issues: boolean;
  last_critical_corrector_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalCorrectionRecord {
  correction_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  base_extraction_version_id: string;
  successor_extraction_version_id: string;
  source_spans: SourceSpan[];
  before_text: string;
  after_text: string;
  is_critical_token_change: boolean;
  issue_ids: string[];
  invalidated_annotation_ids: string[];
  reason: string;
  reviewer_principal_snapshot: {
    principal_id: string;
    roles: OcrHumanRole[];
  };
  created_at: string;
}

export interface LegalReviewDecisionRecord {
  decision_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  version_id: string;
  extraction_version_id: string;
  annotation_version: string;
  issue_ids: string[];
  disposition: "accept_warning" | "resolve_blocking" | "reject_extraction" | "curate_applicability" | "resolve_reference";
  evidence: string;
  rationale: string;
  rule_revision: string;
  actor_principal_snapshot: {
    principal_id: string;
    roles: OcrHumanRole[];
  };
  created_at: string;
}

export type ApprovalScope =
  | "transcription_checked"
  | "references_resolved"
  | "applicability_curated"
  | "ready_to_publish";

export interface LegalApprovalRecord {
  approval_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  version_id: string;
  source_version_id: string;
  extraction_version_id: string;
  annotation_version: string;
  scopes: ApprovalScope[];
  prior_decision_ids: string[];
  bound_content_digest: string;
  approver_principal_snapshot: {
    principal_id: string;
    roles: OcrHumanRole[];
  };
  status: "active" | "revoked" | "invalidated_by_edit";
  created_at: string;
}

export interface StagedKeywordChunk {
  chunk_id: string;
  publication_id: string;
  document_id: string;
  version_id: string;
  source_version_id: string;
  extraction_version_id: string;
  page_number: number;
  raw_start: number;
  raw_end: number;
  heading_context: string;
  raw_text: string;
  normalized_text: string;
  citation_locator: string;
  privacy_class: PrivacyClass;
}

export interface StagedGraphEdge {
  edge_id: string;
  publication_id: string;
  tenant_id: string;
  workspace_id: string;
  source_document_id: string;
  source_version_id: string;
  extraction_version_id: string;
  annotation_version: string;
  relation_type: LegalGraphRelationKind;
  from_node_id: string;
  to_node_id: string;
  source_span: SourceSpan;
  relationship_status: "verified_published";
  editorial_basis: string;
}

export interface LegalPublicationManifest {
  publication_id: string;
  staging_operation_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string;
  version_id: string;
  source_version_id: string;
  extraction_version_id: string;
  annotation_version: string;
  chunking_revision: string;
  embedding_revision: string;
  graph_schema_revision: string;
  expected_artifact_counts: {
    keyword_chunks: number;
    vector_embeddings: number;
    graph_edges: number;
    tables: number;
  };
  actual_artifact_counts: {
    keyword_chunks: number;
    vector_embeddings: number;
    graph_edges: number;
    tables: number;
  };
  manifest_digest: string;
  approval_ids: string[];
  previous_publication_id: string | null;
  status: "staging" | "active" | "superseded" | "withdrawn" | "failed_staging";
  created_at: string;
  activated_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
}

export interface OutboxEvent {
  event_id: string;
  event_type: "ocr.job.updated" | "ocr.extraction.ready" | "ocr.review.required";
  schema_version: "2.0.0";
  tenant_id: string;
  workspace_id: string;
  job_id: string;
  state_revision: number;
  occurred_at: string;
  extraction_version_id: string | null;
  trace_id: string;
  dispatched: boolean;
  delivery_attempts: number;
  last_delivery_error: string | null;
}

export interface LegalAuditEvent {
  audit_id: string;
  tenant_id: string;
  workspace_id: string;
  document_id: string | null;
  action: string;
  actor_id: string;
  actor_roles: OcrHumanRole[];
  occurred_at: string;
  details: Record<string, unknown>;
}

// ============================================================================
// 4. ROLLOUT FEATURE FLAGS (`REG-001` / SECTION 3 & 12)
// ============================================================================

export interface OcrV2FeatureFlags {
  ocr_v2_ingestion_enabled: boolean;
  ocr_v2_review_enabled: boolean;
  ocr_v2_publication_enabled: boolean;
  shadow_mode_only: boolean;
}

export const DEFAULT_OCR_V2_FEATURE_FLAGS: OcrV2FeatureFlags = {
  ocr_v2_ingestion_enabled: process.env.OCR_V2_INGESTION_ENABLED !== "false",
  ocr_v2_review_enabled: process.env.OCR_V2_REVIEW_ENABLED !== "false",
  ocr_v2_publication_enabled: process.env.OCR_V2_PUBLICATION_ENABLED !== "false",
  shadow_mode_only: process.env.OCR_V2_SHADOW_MODE_ONLY === "true",
};

// ============================================================================
// 5. CRYPTOGRAPHIC SHA-256, RFC 8785 JCS (`ocr-digest/1`) & WEBHOOK HMAC
// ============================================================================

export function sha256HexLower(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex").toLowerCase();
}

/**
 * UTF-8 RFC 8785 JSON Canonicalization Scheme (JCS).
 * Deterministic serialization with lexicographically sorted UTF-16 code unit object keys
 * and ECMAScript number formatting (no trailing zeros, `-0` -> `0`).
 */
export function canonicalizeJcsRfc8785(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("RFC 8785 JCS forbids NaN or Infinity in JSON numbers.");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      item === undefined ? "null" : canonicalizeJcsRfc8785(item)
    );
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    const props = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalizeJcsRfc8785(record[k])}`
    );
    return `{${props.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/**
 * Computes `content_digest` under ruleset `ocr-digest/1` (Section: Shared Contract):
 * Covers manifest content (excluding `content_digest` itself and any expiring transport links)
 * plus ordered page digests using UTF-8 RFC 8785 JSON canonicalization.
 */
export function computeOcrDigestV1(
  manifest: Omit<ExtractionManifest, "content_digest"> & { content_digest?: string },
  orderedPages: OCRPage[]
): string {
  const { content_digest: _ignored, ...manifestCore } = manifest;
  const pageDigests = [...orderedPages]
    .sort((a, b) => a.page_number - b.page_number)
    .map((page) => ({
      page_number: page.page_number,
      page_sha256: sha256HexLower(canonicalizeJcsRfc8785(page)),
    }));
  const canonicalPayload = canonicalizeJcsRfc8785({
    digest_ruleset: "ocr-digest/1",
    manifest: manifestCore,
    ordered_page_digests: pageDigests,
  });
  return sha256HexLower(Buffer.from(canonicalPayload, "utf8"));
}

export function signWebhookPayloadHmacSha256(params: {
  secret: string;
  keyId: string;
  timestampSec: number;
  eventId: string;
  rawBodyBytes: Buffer | string;
}): { signatureHeader: string; digestHex: string } {
  const bodyBuf =
    typeof params.rawBodyBytes === "string"
      ? Buffer.from(params.rawBodyBytes, "utf8")
      : params.rawBodyBytes;
  const prefix = Buffer.from(`${params.timestampSec}.${params.eventId}.`, "utf8");
  const mac = createHmac("sha256", params.secret)
    .update(Buffer.concat([prefix, bodyBuf]))
    .digest("hex")
    .toLowerCase();
  return {
    signatureHeader: `kid=${params.keyId},t=${params.timestampSec},v1=${mac}`,
    digestHex: mac,
  };
}

export function verifyWebhookPayloadHmacSha256(params: {
  signatureHeader: string;
  secretsByKeyId: Record<string, string>;
  eventId: string;
  rawBodyBytes: Buffer | string;
  nowEpochSec?: number;
  replayWindowSec?: number;
}): { valid: boolean; reason?: string; keyId?: string; timestampSec?: number } {
  const parts: Record<string, string> = {};
  for (const segment of params.signatureHeader.split(",")) {
    const [k, v] = segment.trim().split("=");
    if (k && v) parts[k] = v;
  }
  const keyId = parts.kid;
  const tStr = parts.t;
  const v1 = parts.v1;
  if (!keyId || !tStr || !v1) {
    return { valid: false, reason: "MALFORMED_SIGNATURE_HEADER" };
  }
  const secret = params.secretsByKeyId[keyId];
  if (!secret) {
    return { valid: false, reason: "UNKNOWN_KEY_ID" };
  }
  const timestampSec = Number(tStr);
  if (!Number.isInteger(timestampSec)) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }
  const nowSec = params.nowEpochSec ?? Math.floor(Date.now() / 1000);
  const windowSec = params.replayWindowSec ?? 300; // 5-minute replay window
  if (Math.abs(nowSec - timestampSec) > windowSec) {
    return { valid: false, reason: "REPLAY_WINDOW_EXPIRED" };
  }
  const expected = signWebhookPayloadHmacSha256({
    secret,
    keyId,
    timestampSec,
    eventId: params.eventId,
    rawBodyBytes: params.rawBodyBytes,
  });
  if (expected.digestHex !== v1.toLowerCase()) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }
  return { valid: true, keyId, timestampSec };
}

// ============================================================================
// 6. JOB STATE MACHINE & CONTRACT VALIDATORS (`ocr-contract/2.0.0`)
// ============================================================================

const ALLOWED_JOB_TRANSITIONS: Record<JobState, ReadonlySet<JobState>> = {
  queued: new Set<JobState>(["running", "cancelled", "failed"]),
  running: new Set<JobState>([
    "waiting_retry",
    "review_required",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  waiting_retry: new Set<JobState>(["queued", "cancelled", "failed"]),
  review_required: new Set<JobState>([]), // terminal
  succeeded: new Set<JobState>([]),       // terminal
  failed: new Set<JobState>([]),          // terminal
  cancelled: new Set<JobState>([]),       // terminal
};

export function isTerminalJobState(state: JobState): boolean {
  return (
    state === "review_required" ||
    state === "succeeded" ||
    state === "failed" ||
    state === "cancelled"
  );
}

export function canTransitionJobState(from: JobState, to: JobState): boolean {
  return ALLOWED_JOB_TRANSITIONS[from].has(to);
}

const HEX_SHA256_RE = /^[0-9a-f]{64}$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function validateSourceSpanV2(
  span: SourceSpan,
  pageRawCodePointLength?: number
): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(span.page_number) || span.page_number < 1) {
    errors.push(`SourceSpan.page_number must be 1-based integer, got ${span.page_number}`);
  }
  if (span.raw_start !== null || span.raw_end !== null) {
    if (
      span.raw_start === null ||
      span.raw_end === null ||
      !Number.isInteger(span.raw_start) ||
      !Number.isInteger(span.raw_end) ||
      span.raw_start < 0 ||
      span.raw_end < span.raw_start
    ) {
      errors.push(`Invalid SourceSpan code-point range [${span.raw_start}, ${span.raw_end})`);
    } else if (
      pageRawCodePointLength !== undefined &&
      span.raw_end > pageRawCodePointLength
    ) {
      errors.push(
        `SourceSpan.raw_end (${span.raw_end}) exceeds page raw_text code-point length (${pageRawCodePointLength})`
      );
    }
  }
  if (span.polygon !== null) {
    if (span.polygon.units !== "normalized" || span.polygon.origin !== "top_left") {
      errors.push("Polygon units must be 'normalized' and origin 'top_left'");
    }
    if (!HEX_SHA256_RE.test(span.polygon.image_sha256)) {
      errors.push("Polygon image_sha256 must be lowercase 64-char hex");
    }
    for (const [x, y] of span.polygon.points) {
      if (typeof x !== "number" || typeof y !== "number" || x < 0 || x > 1 || y < 0 || y > 1) {
        errors.push(`Polygon point [${x}, ${y}] out of normalized [0, 1] range`);
      }
    }
  }
  return errors;
}

export function validateTableCellsNonOverlapping(table: OCRTable): string[] {
  const errors: string[] = [];
  const occupied = new Set<string>();
  for (const cell of table.cells) {
    if (
      !Number.isInteger(cell.row) ||
      cell.row < 0 ||
      !Number.isInteger(cell.column) ||
      cell.column < 0
    ) {
      errors.push(`Table ${table.table_id}: row/column must be 0-based integers`);
      continue;
    }
    if (
      !Number.isInteger(cell.row_span) ||
      cell.row_span < 1 ||
      !Number.isInteger(cell.column_span) ||
      cell.column_span < 1
    ) {
      errors.push(`Table ${table.table_id}: row_span/column_span must be positive integers`);
      continue;
    }
    for (let r = cell.row; r < cell.row + cell.row_span; r++) {
      for (let c = cell.column; c < cell.column + cell.column_span; c++) {
        const key = `${r}:${c}`;
        if (occupied.has(key)) {
          errors.push(`Table ${table.table_id}: overlapping cell occupancy at (${r}, ${c})`);
        }
        occupied.add(key);
      }
    }
  }
  return errors;
}

export function validateOcrJobContractV2(job: OCRJob): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!RFC3339_UTC_RE.test(job.created_at) || !RFC3339_UTC_RE.test(job.updated_at)) {
    errors.push("OCRJob timestamps must be UTC RFC 3339");
  }
  if (!Number.isSafeInteger(job.budget.reserved_micros) || job.budget.reserved_micros < 0) {
    errors.push("OCRJob budget.reserved_micros must be non-negative safe integer micro-units");
  }
  if (!Number.isSafeInteger(job.budget.consumed_micros) || job.budget.consumed_micros < 0) {
    errors.push("OCRJob budget.consumed_micros must be non-negative safe integer micro-units");
  }
  if (!/^[A-Z]{3}$/.test(job.budget.currency)) {
    errors.push("OCRJob budget.currency must be a 3-letter ISO currency code");
  }
  return { valid: errors.length === 0, errors };
}

export function validateExtractionManifestContractV2(
  manifest: ExtractionManifest,
  pages?: OCRPage[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (manifest.contract_version !== "2.0.0") {
    errors.push(`Unsupported contract_version: ${manifest.contract_version}`);
  }
  if (manifest.digest_ruleset !== "ocr-digest/1") {
    errors.push(`Unsupported digest_ruleset: ${manifest.digest_ruleset}`);
  }
  if (!HEX_SHA256_RE.test(manifest.original_sha256)) {
    errors.push("original_sha256 must be 64-char lowercase hex");
  }
  if (!HEX_SHA256_RE.test(manifest.content_digest)) {
    errors.push("content_digest must be 64-char lowercase hex");
  }
  if (!RFC3339_UTC_RE.test(manifest.created_at)) {
    errors.push("created_at must be UTC RFC 3339");
  }
  if (/^https?:\/\//i.test(manifest.pages_ref)) {
    errors.push("pages_ref must be an opaque authenticated reference, not a public URL");
  }
  if (pages) {
    const expectedDigest = computeOcrDigestV1(manifest, pages);
    if (expectedDigest !== manifest.content_digest) {
      errors.push(
        `content_digest mismatch: expected ${expectedDigest}, got ${manifest.content_digest}`
      );
    }
    for (const page of pages) {
      if (page.page_number < 1 || !Number.isInteger(page.page_number)) {
        errors.push(`Page number must be 1-based integer, got ${page.page_number}`);
      }
      if (!HEX_SHA256_RE.test(page.image_sha256)) {
        errors.push(`Page ${page.page_number}: image_sha256 must be lowercase hex`);
      }
      const cpLen = Array.from(page.raw_text).length;
      for (const block of page.blocks) {
        errors.push(...validateSourceSpanV2(block.span, cpLen));
      }
      for (const table of page.tables) {
        errors.push(...validateTableCellsNonOverlapping(table));
        for (const cell of table.cells) {
          errors.push(...validateSourceSpanV2(cell.span, cpLen));
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
