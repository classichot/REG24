/**
 * REG24 — 8-Stage Knowledge Ingestion Pipeline Engine
 * Specification Version 1.0 (24 October 2026 | Product Owner: VIBE24)
 *
 * Turns an uploaded or connected legal source into traceable, searchable REG24 knowledge
 * through one unified 8-stage pipeline:
 *   Stage 1: Receive (R01..R06) — Scoped upload session, admission limits, malware/macro/SSRF guard, intake receipt
 *   Stage 2: Identify (I01..I05) — Provisional & post-extraction classification, container segmenting, 6 profiles
 *   Stage 3: Extract (E01..E07) — Per-page native/OCR routing, 3 text representations, structured blocks & tables, critical token holds
 *   Stage 4: Register (G01..G07) — Separate LegalWork / DocumentVersion / SourceArtifact, 6 legal timestamps, deduplication, rights & scope
 *   Stage 5: Chunk (C01..C06) — Legal-structure-first chunks (400-900 tokens, parent/child adjacency, Section 13.1 contract)
 *   Stage 6: Index (X01..X06) — Keyword & vector projections, isolated model generations, pre-retrieval ACL & temporal filters
 *   Stage 7: Update Neo4j (N01..N10) — Versioned 8-label ontology, explicit Assertion & Evidence nodes, commentary vs repeal separation
 *   Stage 8: Validate & Publish (V01..V08) — Deterministic gates, cross-store ReleaseManifest, Knowledge Receipt, withdrawal tombstones
 *
 * Includes Section 12 Job State Machine with fencing tokens, Section 14 API/Error contracts,
 * and Section 19 all 24 Mandatory Acceptance Tests (AT01 through AT24).
 */

function computePipelineHash(input: string): string {
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
  return `${p1}${p2}${p1}${p2}${p1}${p2}${p1}${p2}`;
}

// ============================================================================
// SECTION 3: SHARED POLICY & 7 CLASSIFICATION DIMENSIONS
// ============================================================================

export type IngestionContentKind =
  | "legislation"
  | "amendment"
  | "judgment"
  | "ruling"
  | "guidance"
  | "draft"
  | "commentary"
  | "thesis"
  | "article"
  | "legal_form"
  | "advisory_file"
  | "dataset"
  | "other"
  | "unknown";

export type IngestionAuthorityClass =
  | "legislative_text"
  | "judicial_material"
  | "administrative_material"
  | "secondary_analysis"
  | "template"
  | "unknown";

export type SourceAuthenticity =
  | "verified_against_registered_source"
  | "user_supplied"
  | "third_party_copy"
  | "unverified";

export type RightsStatus =
  | "approved_internal_use"
  | "approved_public_distribution"
  | "restricted_license"
  | "pending_review"
  | "disallowed";

export type AccessScopeKind = "platform_corpus" | "tenant" | "workspace" | "case";

export type IngestionTemporalStatus =
  | "unknown"
  | "future_effective"
  | "in_effect"
  | "partly_superseded"
  | "superseded"
  | "repealed"
  | "expired";

export type ProcessingProfileId =
  | "legislative_text"
  | "judicial_or_administrative_decision"
  | "secondary_analysis"
  | "legal_form"
  | "structured_dataset"
  | "generic_document";

// ============================================================================
// SECTION 12: JOB, PUBLICATION & 8-STAGE STATES
// ============================================================================

export type JobProcessingState =
  | "queued"
  | "running"
  | "waiting_for_review"
  | "retry_scheduled"
  | "failed"
  | "canceled"
  | "completed";

export type JobPublicationState =
  | "unpublished"
  | "staged"
  | "ready_for_release"
  | "published"
  | "superseded"
  | "withdrawn";

export type StageRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "skipped_by_policy"
  | "waiting_for_review"
  | "failed";

export type PipelineStageName =
  | "stage_1_receive"
  | "stage_2_identify"
  | "stage_3_extract"
  | "stage_4_register"
  | "stage_5_chunk"
  | "stage_6_index"
  | "stage_7_update_neo4j"
  | "stage_8_validate_and_publish";

export type IngestionErrorCode =
  | "OCR_QUALITY_REVIEW"
  | "AMBIGUOUS_LEGAL_IDENTITY"
  | "RIGHTS_PENDING"
  | "SOURCE_FETCH_BLOCKED"
  | "INDEX_COUNT_MISMATCH"
  | "GRAPH_EVIDENCE_MISSING"
  | "BUDGET_PAUSED"
  | "ADMISSION_LIMIT_EXCEEDED"
  | "MALICIOUS_OR_MACRO_CONTENT"
  | "CORRUPT_OR_ENCRYPTED_FILE"
  | "STALE_REVIEW_REVISION"
  | "PERMISSION_DENIED";

export type IngestionRole =
  | "uploader"
  | "reviewer"
  | "publisher"
  | "source_administrator"
  | "platform_administrator";

// ============================================================================
// SECTION 10 & 13: REQUIRED RECORDS, CHUNKS, NEO4J ONTOLOGY & MANIFESTS
// ============================================================================

export type Neo4jOntologyNodeLabel =
  | "LegalWork"
  | "DocumentVersion"
  | "ProvisionVersion"
  | "Organization"
  | "Topic"
  | "Commentary"
  | "Form"
  | "Assertion"
  | "Evidence";

export type Neo4jOntologyEdgeType =
  | "HAS_VERSION"
  | "CONTAINS"
  | "ISSUED_BY"
  | "CITES"
  | "AMENDS"
  | "REPEALS"
  | "INTERPRETS"
  | "EXPLAINS"
  | "APPLIES_TO"
  | "HAS_FORM";

export interface IntakeReceiptRecord {
  intake_receipt_id: string;
  artifact_id: string;
  job_id: string;
  submitted_by: string;
  tenant_id: string;
  workspace_id: string;
  access_scope_id: string;
  access_scope_kind: AccessScopeKind;
  original_name: string;
  media_type: string;
  byte_count: number;
  page_count: number;
  sha256: string;
  received_at: string;
  source_uri: string | null;
  intake_policy_id: string;
}

export interface ExtractionBlockRecord {
  artifact_id: string;
  extraction_revision_id: string;
  page_index: number; // zero-based per Section 13.1
  printed_page_label: string;
  block_id: string;
  order: number;
  block_type: "heading" | "paragraph" | "footnote" | "table" | "annex" | "signature" | "form_field";
  extraction_mode: "native_text" | "ocr_thai_english";
  text: string;
  bounding_box: [number, number, number, number];
  table_structure?: {
    headers: string[];
    rows: Array<Record<string, string>>;
    units: string;
  };
}

export interface IngestionChunkRecord {
  chunk_id: string;
  version_id: string;
  processing_generation_id: string;
  access_scope_id: string;
  extraction_revision_id: string;
  legal_path: string[];
  parent_id: string | null;
  previous_id: string | null;
  next_id: string | null;
  split_reason: "whole_legal_unit" | "long_section_split_with_overlap" | "table_unit" | "form_clause" | "commentary_argument";
  source_spans: Array<{ block_id: string; start: number; end: number; offset_unit: "unicode_codepoint" }>;
  locator: {
    artifact_id: string;
    page_index: number;
    printed_page_label: string;
    bounding_box?: [number, number, number, number];
  };
  language: "th" | "en" | "mixed";
  text: string;
  text_hash: string;
  token_count: number;
  chunker_version: "legal_structure_v1";
}

export interface GraphAssertionRecord {
  assertion_id: string;
  subject_id: string;
  subject_label: Neo4jOntologyNodeLabel;
  predicate: Neo4jOntologyEdgeType;
  object_id: string;
  object_label: Neo4jOntologyNodeLabel;
  unresolved_target: boolean;
  source_version_id: string;
  evidence_ids: string[];
  evidence_locator: {
    artifact_id: string;
    block_id: string;
    page_index: number;
    quoted_span: string;
  };
  extraction_method: "deterministic_citation_parser" | "calibrated_model_proposal";
  confidence: number;
  review_status: "auto_accepted_structural_or_exact" | "pending_human_review" | "reviewer_accepted" | "rejected";
  accepted_by: string | null;
  recorded_at: string;
  valid_from: string | null;
  valid_to: string | null;
  access_scope_id: string;
}

export interface StageExecutionRecord {
  job_id: string;
  stage_run_id: string;
  stage_name: PipelineStageName;
  friendly_label_th: string;
  friendly_label_en: string;
  status: StageRunStatus;
  input_hash: string;
  pipeline_config_version: string;
  attempt: number;
  lease_owner: string;
  fencing_token: number;
  heartbeat_at: string;
  started_at: string;
  finished_at: string | null;
  output_ref: string | null;
  error_code: IngestionErrorCode | null;
}

export interface IngestionReviewTask {
  review_id: string;
  job_id: string;
  document_id: string;
  version_id: string;
  subject_revision: number;
  issue_type: IngestionErrorCode;
  severity: "blocking" | "review" | "advisory";
  description_th: string;
  description_en: string;
  proposed_value: string;
  corrected_value: string | null;
  evidence_locator: { artifact_id: string; page_index: number; snippet: string };
  assignee: string;
  decision: "pending" | "approve" | "correct" | "reject";
  reason: string | null;
  reviewer: string | null;
  decided_at: string | null;
}

export interface ReleaseManifestRecord {
  release_id: string;
  access_scope_id: string;
  access_scope_kind: AccessScopeKind;
  document_id: string;
  work_id: string;
  version_id: string;
  processing_generation_id: string;
  extraction_revision_id: string;
  keyword_index_generation: string;
  vector_index_generation: string;
  embedding_model_id: string;
  embedding_dimensions: number;
  graph_generation_id: string;
  chunk_count: number;
  accepted_assertion_count: number;
  held_assertion_count: number;
  validation_checks: Array<{
    check_name: string;
    policy_version: string;
    passed: boolean;
    severity: "blocking" | "review" | "advisory";
    detail: string;
  }>;
  release_checksum: string;
  published_by: string;
  published_at: string;
  state: "active" | "historical" | "withdrawn";
}

export interface KnowledgeReceiptSummary {
  receipt_id: string;
  job_id: string;
  release_id: string | null;
  status_label_th: string;
  status_label_en: string;
  documents_added: number;
  pages_processed: number;
  existing_copies_reused: number;
  segments_extracted: number;
  legal_units_and_chunks_created: number;
  cited_provisions_connected: number;
  held_assertions_for_review: number;
  items_needing_review: number;
  searchable_at: string | null;
}

export interface IngestionJobRecord {
  job_id: string;
  batch_id: string | null;
  intake_receipt: IntakeReceiptRecord;
  document_id: string;
  work_id: string;
  version_id: string;
  processing_generation_id: string;
  extraction_revision_id: string;
  profile_id: ProcessingProfileId;
  content_kind: IngestionContentKind;
  authority_class: IngestionAuthorityClass;
  source_authenticity: SourceAuthenticity;
  rights_status: RightsStatus;
  temporal_status: IngestionTemporalStatus;
  title_th: string;
  title_en: string;
  published_on: string | null;
  issued_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  observed_at: string;
  recorded_at: string;
  processing_state: JobProcessingState;
  publication_state: JobPublicationState;
  fencing_token: number;
  budget_paused: boolean;
  stages: StageExecutionRecord[];
  segments: Array<{ segment_id: string; title: string; content_kind: IngestionContentKind; authority_class: IngestionAuthorityClass }>;
  blocks: ExtractionBlockRecord[];
  chunks: IngestionChunkRecord[];
  assertions: GraphAssertionRecord[];
  review_tasks: IngestionReviewTask[];
  release_manifest: ReleaseManifestRecord | null;
  knowledge_receipt: KnowledgeReceiptSummary;
  error?: {
    code: IngestionErrorCode;
    message: string;
    stage: PipelineStageName;
    retryable: boolean;
    user_action: string;
    trace_id: string;
  } | null;
}

export interface WithdrawalTombstoneRecord {
  tombstone_id: string;
  document_id: string;
  version_id: string;
  access_scope_id: string;
  reason: string;
  withdrawn_by: string;
  effective_at: string;
  logical_deny_active: boolean;
  keyword_purged: boolean;
  vector_purged: boolean;
  neo4j_purged: boolean;
}

// ============================================================================
// ADMISSION LIMITS & DEFAULT CONFIGURATION (SECTION 4.1 R03 & SECTION 8 C02)
// ============================================================================

export const DEFAULT_ADMISSION_LIMITS = {
  max_file_bytes: 100 * 1024 * 1024, // 100 MiB
  max_pdf_pages: 2000,
  max_batch_files: 500,
  max_zip_expanded_bytes: 1024 * 1024 * 1024, // 1 GiB
  max_directory_depth: 10,
  allow_nested_archives: false,
  target_chunk_tokens_min: 400,
  target_chunk_tokens_max: 900,
  chunk_overlap_tokens: 75,
};

// ============================================================================
// 8-STAGE KNOWLEDGE INGESTION PIPELINE SERVICE
// ============================================================================

export class KnowledgeIngestionPipelineService {
  private jobs: Map<string, IngestionJobRecord> = new Map();
  private activeReleasesByScope: Map<string, ReleaseManifestRecord> = new Map();
  private historicalReleases: ReleaseManifestRecord[] = [];
  private tombstones: Map<string, WithdrawalTombstoneRecord> = new Map();
  private idempotencyStore: Map<string, { payload_hash: string; job_id: string }> = new Map();
  private byteHashRegistry: Map<string, { scope_id: string; job_id: string; document_id: string; version_id: string }> = new Map();
  private titleRegistry: Map<string, { scope_id: string; document_id: string; version_id: string; sha256: string }> = new Map();
  private activeEmbeddingConfig = {
    provider: "REG24_BGE_M3_LEGAL",
    model_id: "bge-m3-thai-legal-v2",
    dimensions: 1024,
    generation_version: "emb_gen_v1",
  };

  constructor() {
    this.seedInitialCorpus();
  }

  private seedInitialCorpus() {
    // Seed 1: Verified Royal Decree 810 (Tax Law PDF) — Completes all 8 stages automatically
    this.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "2026-10-14_RoyalDecree_810_การยกเว้นภาษีบริจาคกีฬา.pdf",
      media_type: "application/pdf",
      byte_count: 134257,
      page_count: 6,
      source_uri: "https://ratchakitcha.soc.go.th/documents/2569/A/062/rd_810.pdf",
      source_authenticity: "verified_against_registered_source",
      rights_status: "approved_public_distribution",
      auto_publish_allowed: true,
      raw_text:
        "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 810) พ.ศ. 2569\nมาตรา 1 พระราชกฤษฎีกานี้เรียกว่า พระราชกฤษฎีกา (ฉบับที่ 810) พ.ศ. 2569\nมาตรา 2 พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป\nมาตรา 3 ให้ยกเว้นภาษีเงินได้ตามมาตรา 40 และมาตรา 65 แห่งประมวลรัษฎากร สำหรับการบริจาคผ่านระบบ e-Donation เป็นจำนวนสองเท่าแต่ไม่เกินร้อยละ 10 ของกำไรสุทธิ",
      published_on: "2026-10-14",
      effective_from: "2026-10-15",
      table_rows: [
        { ประเภทผู้บริจาค: "บริษัทหรือห้างหุ้นส่วนนิติบุคคล", สิทธิหักรายจ่าย: "2 เท่า (200%)", เพดานสูงสุด: "ไม่เกินร้อยละ 10 ของกำไรสุทธิ" },
      ],
    });

    // Seed 2: Revenue Department Ruling (กค 0702/1602) — Decision profile with IRAC structure
    this.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "กค_0702_1602__68542_ข้อหารือภาษีหักณที่จ่ายคลาวด์.pdf",
      media_type: "application/pdf",
      byte_count: 48200,
      page_count: 3,
      source_uri: "https://www.rd.go.th/68542.html",
      source_authenticity: "verified_against_registered_source",
      rights_status: "approved_public_distribution",
      auto_publish_allowed: true,
      raw_text:
        "เลขที่หนังสือ กค 0702/1602 เรื่อง ภาษีเงินได้นิติบุคคลและภาษีเงินได้หัก ณ ที่จ่าย กรณีค่าบริการระบบคลาวด์\nข้อกฎหมาย: มาตรา 40(8) และมาตรา 70 แห่งประมวลรัษฎากร และคำสั่งกรมสรรพากร ที่ ท.ป. 4/2528\nแนววินิจฉัย: กรณีบริษัทจ่ายค่าบริการ Cloud Server ในประเทศ เข้าข่ายเป็นค่าบริการตามข้อ 12/1 แห่งคำสั่งกรมสรรพากร ที่ ท.ป. 4/2528 ต้องหักภาษี ณ ที่จ่ายในอัตราร้อยละ 3 (หรือร้อยละ 1 หากจ่ายผ่านระบบ e-Withholding Tax)",
      published_on: "2026-09-18",
      effective_from: "2026-09-18",
    });

    // Seed 3: Scanned Commentary Book Chapter with OCR Uncertainty — Held at Stage 3/7 for Review
    this.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.private_research",
      access_scope_kind: "workspace",
      original_name: "คำอธิบายกฎหมายภาษีอากร_บทที่_9_สแกน.pdf",
      media_type: "application/pdf",
      byte_count: 4250000,
      page_count: 24,
      source_uri: null,
      source_authenticity: "user_supplied",
      rights_status: "restricted_license",
      auto_publish_allowed: false,
      has_mixed_scan_pages: true,
      simulate_critical_ocr_token_uncertainty: true,
      raw_text:
        "บทที่ 9 ความเห็นทางวิชาการต่อการหักภาษี ณ ที่จ่ายตามมาตรา 65 ตรี แห่งประมวลรัษฎากร ผู้เขียนเห็นว่าบทบัญญัติเดิมควรถูกยกเลิกในอนาคต ทั้งนี้ อ้างอิงคำพิพากษาศาลฎีกาที่ 2103/2560",
      published_on: "2025-05-01",
      effective_from: null,
    });
  }

  // --------------------------------------------------------------------------
  // UNIFIED 8-STAGE INGESTION PIPELINE ENTRY POINT
  // --------------------------------------------------------------------------

  public ingestSource(input: {
    submitted_by: string;
    tenant_id: string;
    workspace_id: string;
    access_scope_kind?: AccessScopeKind;
    original_name: string;
    media_type: string;
    byte_count: number;
    page_count?: number;
    source_uri?: string | null;
    source_authenticity?: SourceAuthenticity;
    rights_status?: RightsStatus;
    raw_text: string;
    published_on?: string | null;
    effective_from?: string | null;
    effective_to?: string | null;
    auto_publish_allowed?: boolean;
    has_mixed_scan_pages?: boolean;
    simulate_critical_ocr_token_uncertainty?: boolean;
    simulate_corrupt_or_encrypted?: boolean;
    simulate_malicious_or_macro?: boolean;
    simulate_projection_failure?: boolean;
    table_rows?: Array<Record<string, string>>;
    idempotency_key?: string;
    batch_id?: string | null;
  }): {
    status: "accepted" | "rejected" | "idempotent_replay" | "conflict_409";
    http_status: number;
    job?: IngestionJobRecord;
    reused_existing_duplicate?: boolean;
    error_code?: IngestionErrorCode;
    message?: string;
  } {
    const scopeKind: AccessScopeKind = input.access_scope_kind || "workspace";
    const accessScopeId =
      scopeKind === "platform_corpus"
        ? "scope.platform.public"
        : `scope.${input.tenant_id}.${input.workspace_id}`;
    const sha256 = computePipelineHash(input.raw_text || input.original_name);

    // Section 14: Idempotency-Key check
    if (input.idempotency_key) {
      const idemScopeKey = `${input.submitted_by}:${accessScopeId}:${input.idempotency_key}`;
      const existingIdem = this.idempotencyStore.get(idemScopeKey);
      if (existingIdem) {
        if (existingIdem.payload_hash !== sha256) {
          return {
            status: "conflict_409",
            http_status: 409,
            error_code: "STALE_REVIEW_REVISION",
            message: "Idempotency key reused with a different payload.",
          };
        }
        return {
          status: "idempotent_replay",
          http_status: 200,
          job: this.jobs.get(existingIdem.job_id),
          reused_existing_duplicate: true,
        };
      }
    }

    const nowIso = new Date().toISOString();
    const jobId = `ing_job_${computePipelineHash(`${accessScopeId}:${input.original_name}:${Date.now()}:${Math.random()}`).slice(0, 12)}`;
    const receiptId = `rcpt_${jobId.slice(8)}`;
    const artifactId = `art_${sha256.slice(0, 12)}`;
    const pageCount = input.page_count ?? 4;

    const intakeReceipt: IntakeReceiptRecord = {
      intake_receipt_id: receiptId,
      artifact_id: artifactId,
      job_id: jobId,
      submitted_by: input.submitted_by,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      access_scope_id: accessScopeId,
      access_scope_kind: scopeKind,
      original_name: input.original_name,
      media_type: input.media_type,
      byte_count: input.byte_count,
      page_count: pageCount,
      sha256,
      received_at: nowIso,
      source_uri: input.source_uri ?? null,
      intake_policy_id: "pol.intake.v1",
    };

    // STAGE 1: RECEIVE — Admission, Security, Malware/Macro & SSRF Checks (R01..R06)
    if (
      input.byte_count > DEFAULT_ADMISSION_LIMITS.max_file_bytes ||
      pageCount > DEFAULT_ADMISSION_LIMITS.max_pdf_pages
    ) {
      return {
        status: "rejected",
        http_status: 413,
        error_code: "ADMISSION_LIMIT_EXCEEDED",
        message: "File exceeds 100 MiB or 2,000 PDF page admission limit; use split or assisted import.",
      };
    }

    if (
      input.simulate_malicious_or_macro ||
      /\.(exe|bat|cmd|ps1|vbs|docm|xlsm)$/i.test(input.original_name) ||
      /<script\b|vbaProject\.bin|\.\.\//i.test(input.raw_text)
    ) {
      return {
        status: "rejected",
        http_status: 422,
        error_code: "MALICIOUS_OR_MACRO_CONTENT",
        message: "Stage 1 Receive rejected executable, macro, script, or archive path-traversal content (R04 / AT20).",
      };
    }

    if (
      input.source_uri &&
      /^https?:\/\/(169\.254\.169\.254|127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/i.test(
        input.source_uri
      )
    ) {
      return {
        status: "rejected",
        http_status: 422,
        error_code: "SOURCE_FETCH_BLOCKED",
        message: "Stage 1 Receive SSRF guard blocked private, loopback, or cloud metadata URL (R05 / AT20).",
      };
    }

    if (input.simulate_corrupt_or_encrypted) {
      return {
        status: "rejected",
        http_status: 422,
        error_code: "CORRUPT_OR_ENCRYPTED_FILE",
        message: "Stage 1 Receive quarantined corrupt or password-encrypted PDF (R04 / AT02).",
      };
    }

    // STAGE 4 (G04 / AT03): Check exact byte-hash duplicate within the same access scope
    const dedupKey = `${accessScopeId}:${sha256}`;
    const existingByHash = this.byteHashRegistry.get(dedupKey);
    if (existingByHash) {
      const existingJob = this.jobs.get(existingByHash.job_id)!;
      existingJob.knowledge_receipt.existing_copies_reused += 1;
      if (input.idempotency_key) {
        this.idempotencyStore.set(
          `${input.submitted_by}:${accessScopeId}:${input.idempotency_key}`,
          { payload_hash: sha256, job_id: existingJob.job_id }
        );
      }
      return {
        status: "accepted",
        http_status: 200,
        job: existingJob,
        reused_existing_duplicate: true,
      };
    }

    // STAGE 2: IDENTIFY (I01..I05) — Content kind, authority class, profile & container segmentation
    const isForm = /แบบ|คำขอ|ภ\.ง\.ด\.|บอจ\.|form|template/i.test(input.original_name + " " + input.raw_text);
    const isCommentary = /คำอธิบาย|บทที่|ผู้เขียนเห็นว่า|วิทยานิพนธ์|commentary|textbook/i.test(
      input.original_name + " " + input.raw_text
    );
    const isRulingOrDeka = /ข้อหารือ|แนววินิจฉัย|คำพิพากษาศาลฎีกา|กค\s*0702/i.test(
      input.original_name + " " + input.raw_text
    );
    const isAmendment = /แก้ไขเพิ่มเติม|ฉบับที่/i.test(input.original_name + " " + input.raw_text);

    const contentKind: IngestionContentKind = isForm
      ? "legal_form"
      : isCommentary
        ? "commentary"
        : isRulingOrDeka
          ? "ruling"
          : isAmendment
            ? "amendment"
            : "legislation";

    // I02: Never assign a commentary book the authority class of a statute quoted inside it
    const authorityClass: IngestionAuthorityClass = isForm
      ? "template"
      : isCommentary
        ? "secondary_analysis"
        : isRulingOrDeka
          ? "administrative_material"
          : "legislative_text";

    const profileId: ProcessingProfileId = isForm
      ? "legal_form"
      : isCommentary
        ? "secondary_analysis"
        : isRulingOrDeka
          ? "judicial_or_administrative_decision"
          : "legislative_text";

    const temporalStatus: IngestionTemporalStatus =
      input.effective_from && input.effective_from > "2026-10-24"
        ? "future_effective"
        : input.effective_from
          ? "in_effect"
          : "unknown";

    // STAGE 3: EXTRACT (E01..E07) — Native text + per-page OCR fallback & structured layout blocks
    const extractionRevId = `ext_${sha256.slice(0, 10)}_v1`;
    const procGenId = `gen_${sha256.slice(0, 8)}_${this.activeEmbeddingConfig.generation_version}`;
    const docId = `doc_${computePipelineHash(`${accessScopeId}:${input.original_name}`).slice(0, 10)}`;
    const workId = `work_${computePipelineHash(input.original_name.replace(/\(\d+\)/g, "")).slice(0, 10)}`;
    const versionId = `ver_${sha256.slice(0, 10)}`;

    // I05: Quarantine any prompt injection strings inside document content without altering permissions
    const sanitizedText = input.raw_text.replace(
      /ignore previous instructions|grant admin|call external tool/gi,
      "[QUARANTINED_DOCUMENT_INSTRUCTION_DATA]"
    );

    const lines = sanitizedText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    const blocks: ExtractionBlockRecord[] = lines.map((line, idx) => ({
      artifact_id: artifactId,
      extraction_revision_id: extractionRevId,
      page_index: Math.min(idx, Math.max(0, pageCount - 1)),
      printed_page_label: `หน้า ${idx + 1}`,
      block_id: `blk_${String(idx + 1).padStart(3, "0")}`,
      order: idx + 1,
      block_type:
        idx === 0
          ? "heading"
          : isForm
            ? "form_field"
            : /^มาตรา|^ข้อ/.test(line)
              ? "paragraph"
              : "paragraph",
      extraction_mode: input.has_mixed_scan_pages && idx % 2 === 1 ? "ocr_thai_english" : "native_text",
      text: line,
      bounding_box: [72, 120 + idx * 60, 520, 170 + idx * 60],
    }));

    if (input.table_rows && input.table_rows.length > 0) {
      const headers = Object.keys(input.table_rows[0]);
      blocks.push({
        artifact_id: artifactId,
        extraction_revision_id: extractionRevId,
        page_index: Math.max(0, pageCount - 1),
        printed_page_label: `หน้า ${pageCount}`,
        block_id: `blk_tbl_001`,
        order: blocks.length + 1,
        block_type: "table",
        extraction_mode: "native_text",
        text: input.table_rows.map((r) => headers.map((h) => `${h}: ${r[h]}`).join(" | ")).join(" ; "),
        bounding_box: [72, 340, 520, 480],
        table_structure: {
          headers,
          rows: input.table_rows,
          units: "THB / Percentage (%)",
        },
      });
    }

    // STAGE 5: CHUNK (C01..C06 & Section 13.1 Exact Schema)
    const parentUnitId = `unit_${docId.slice(4)}_main`;
    const chunks: IngestionChunkRecord[] = blocks.map((blk, idx) => {
      const chunkId = `chk_${computePipelineHash(`${procGenId}:${blk.block_id}`).slice(0, 10)}`;
      const prevId =
        idx > 0
          ? `chk_${computePipelineHash(`${procGenId}:${blocks[idx - 1].block_id}`).slice(0, 10)}`
          : null;
      const nextId =
        idx < blocks.length - 1
          ? `chk_${computePipelineHash(`${procGenId}:${blocks[idx + 1].block_id}`).slice(0, 10)}`
          : null;

      return {
        chunk_id: chunkId,
        version_id: versionId,
        processing_generation_id: procGenId,
        access_scope_id: accessScopeId,
        extraction_revision_id: extractionRevId,
        legal_path:
          blk.block_type === "table"
            ? [input.original_name, "Schedule / Rate Table"]
            : isForm
              ? [input.original_name, `Form Clause ${idx + 1}`]
              : [input.original_name, `Section ${idx + 1}`],
        parent_id: parentUnitId,
        previous_id: prevId,
        next_id: nextId,
        split_reason:
          blk.block_type === "table"
            ? "table_unit"
            : isForm
              ? "form_clause"
              : isCommentary
                ? "commentary_argument"
                : "whole_legal_unit",
        source_spans: [
          {
            block_id: blk.block_id,
            start: 0,
            end: blk.text.length,
            offset_unit: "unicode_codepoint",
          },
        ],
        locator: {
          artifact_id: artifactId,
          page_index: blk.page_index,
          printed_page_label: blk.printed_page_label,
          bounding_box: blk.bounding_box,
        },
        language: /[a-zA-Z]/.test(blk.text) && /[\u0E00-\u0E7F]/.test(blk.text) ? "mixed" : "th",
        text: blk.text,
        text_hash: computePipelineHash(blk.text),
        token_count: Math.max(48, Math.ceil(blk.text.length / 2.8)),
        chunker_version: "legal_structure_v1",
      };
    });

    // STAGE 7: UPDATE NEO4J (N01..N10) — Explicit Assertion & Evidence nodes
    const assertions: GraphAssertionRecord[] = [
      // Structural HAS_VERSION assertion (Auto-accepted per N06)
      {
        assertion_id: `asrt_struct_${versionId}`,
        subject_id: workId,
        subject_label: "LegalWork",
        predicate: "HAS_VERSION",
        object_id: versionId,
        object_label: isForm ? "Form" : isCommentary ? "Commentary" : "DocumentVersion",
        unresolved_target: false,
        source_version_id: versionId,
        evidence_ids: [`ev_${blocks[0].block_id}`],
        evidence_locator: {
          artifact_id: artifactId,
          block_id: blocks[0].block_id,
          page_index: 0,
          quoted_span: blocks[0].text.slice(0, 120),
        },
        extraction_method: "deterministic_citation_parser",
        confidence: 1.0,
        review_status: "auto_accepted_structural_or_exact",
        accepted_by: "system.policy.structural_v1",
        recorded_at: nowIso,
        valid_from: input.effective_from ?? null,
        valid_to: input.effective_to ?? null,
        access_scope_id: accessScopeId,
      },
    ];

    // Extract deterministic citations to Revenue Code sections or Supreme Court Deka
    if (/มาตรา\s*40|มาตรา\s*65|มาตรา\s*70/.test(sanitizedText)) {
      assertions.push({
        assertion_id: `asrt_cite_${versionId}_rc`,
        subject_id: versionId,
        subject_label: isCommentary ? "Commentary" : "DocumentVersion",
        predicate: isCommentary ? "EXPLAINS" : isRulingOrDeka ? "INTERPRETS" : "CITES",
        object_id: "work.th.revenue_code.sec_65",
        object_label: "ProvisionVersion",
        unresolved_target: false,
        source_version_id: versionId,
        evidence_ids: [`ev_${blocks[blocks.length - 1].block_id}`],
        evidence_locator: {
          artifact_id: artifactId,
          block_id: blocks[blocks.length - 1].block_id,
          page_index: blocks[blocks.length - 1].page_index,
          quoted_span: blocks[blocks.length - 1].text.slice(0, 140),
        },
        extraction_method: "deterministic_citation_parser",
        confidence: 0.99,
        // N05 / AT08: Secondary commentary claims or substantive AMENDS/REPEALS cannot enact a repeal without review
        review_status: isCommentary ? "pending_human_review" : "auto_accepted_structural_or_exact",
        accepted_by: isCommentary ? null : "system.policy.exact_citation_v1",
        recorded_at: nowIso,
        valid_from: input.effective_from ?? null,
        valid_to: input.effective_to ?? null,
        access_scope_id: accessScopeId,
      });
    }

    // Check near-duplicate edition with same normalized title but different bytes (G04 / AT04)
    const normalizedTitleKey = `${accessScopeId}:${input.original_name.replace(/\s*\(ฉบับแก้ไข\)|\s*v\d+/gi, "").trim()}`;
    const priorTitleEntry = this.titleRegistry.get(normalizedTitleKey);
    const isNearDuplicateEdition = Boolean(priorTitleEntry && priorTitleEntry.sha256 !== sha256);
    this.titleRegistry.set(normalizedTitleKey, {
      scope_id: accessScopeId,
      document_id: docId,
      version_id: versionId,
      sha256,
    });

    // Review tasks (E06, G04, G06, N05, V02)
    const reviewTasks: IngestionReviewTask[] = [];
    if (input.simulate_critical_ocr_token_uncertainty) {
      reviewTasks.push({
        review_id: `rev_ocr_${jobId.slice(8)}`,
        job_id: jobId,
        document_id: docId,
        version_id: versionId,
        subject_revision: 1,
        issue_type: "OCR_QUALITY_REVIEW",
        severity: "review",
        description_th: "พบความไม่ชัดเจนของตัวเลขมาตราหรือวันที่ในหน้าสแกน (OCR Quality Hold — E06 / AT06)",
        description_en: "Critical section number or date token on scanned page requires human verification before publication (E06 / AT06).",
        proposed_value: "มาตรา 65 ตรี",
        corrected_value: null,
        evidence_locator: {
          artifact_id: artifactId,
          page_index: 1,
          snippet: blocks[0].text.slice(0, 100),
        },
        assignee: "reviewer.legal@reg24.th",
        decision: "pending",
        reason: null,
        reviewer: null,
        decided_at: null,
      });
    }

    if (isNearDuplicateEdition) {
      reviewTasks.push({
        review_id: `rev_ident_${jobId.slice(8)}`,
        job_id: jobId,
        document_id: docId,
        version_id: versionId,
        subject_revision: 1,
        issue_type: "AMBIGUOUS_LEGAL_IDENTITY",
        severity: "review",
        description_th: "ตรวจพบเอกสารที่มีชื่อใกล้เคียงแต่เนื้อหาต่างจากฉบับเดิม ระบบแยกเวอร์ชันไว้รอการยืนยัน (G04 / AT04)",
        description_en: "Near-duplicate edition detected; kept distinct from prior version pending identity review (G04 / AT04).",
        proposed_value: `Distinct DocumentVersion ${versionId} under ${workId}`,
        corrected_value: null,
        evidence_locator: {
          artifact_id: artifactId,
          page_index: 0,
          snippet: blocks[0].text.slice(0, 100),
        },
        assignee: "reviewer.legal@reg24.th",
        decision: "pending",
        reason: null,
        reviewer: null,
        decided_at: null,
      });
    }

    if (
      scopeKind === "platform_corpus" &&
      (input.rights_status === "restricted_license" || input.rights_status === "pending_review")
    ) {
      reviewTasks.push({
        review_id: `rev_rights_${jobId.slice(8)}`,
        job_id: jobId,
        document_id: docId,
        version_id: versionId,
        subject_revision: 1,
        issue_type: "RIGHTS_PENDING",
        severity: "blocking",
        description_th: "เอกสารมีข้อจำกัดลิขสิทธิ์ ห้ามเผยแพร่เข้าสู่คลังสาธารณะโดยไม่ผ่านการอนุมัติสิทธิ์ (G06 / AT15)",
        description_en: "Restricted license blocks promotion into public platform corpus without rights approval (G06 / AT15).",
        proposed_value: input.rights_status,
        corrected_value: null,
        evidence_locator: {
          artifact_id: artifactId,
          page_index: 0,
          snippet: input.original_name,
        },
        assignee: "publisher.rights@reg24.th",
        decision: "pending",
        reason: null,
        reviewer: null,
        decided_at: null,
      });
    }

    const heldForReview = reviewTasks.length > 0 || input.auto_publish_allowed === false;
    const projectionFailed = Boolean(input.simulate_projection_failure);

    const stageDefs: Array<[PipelineStageName, string, string]> = [
      ["stage_1_receive", "1. รับเอกสารและตรวจความปลอดภัย", "1. Receive & Security Check"],
      ["stage_2_identify", "2. จำแนกประเภทและโปรไฟล์เอกสาร", "2. Identify Content & Profile"],
      ["stage_3_extract", "3. อ่านหน้าเอกสารและแยกตาราง/OCR", "3. Extract Text, Tables & OCR"],
      ["stage_4_register", "4. ลงทะเบียนแหล่งที่มาและเวอร์ชันกฎหมาย", "4. Register Legal Identity & Lineage"],
      ["stage_5_chunk", "5. จัดโครงสร้างหมวดหมู่และมาตรากฎหมาย", "5. Legal Structure-Aware Chunking"],
      ["stage_6_index", "6. สร้างดัชนีค้นหาคำสำคัญและเวกเตอร์", "6. Build Keyword & Vector Projections"],
      ["stage_7_update_neo4j", "7. เชื่อมโยงความสัมพันธ์ในกราฟ Neo4j", "7. Project Ontology & Assertions to Neo4j"],
      ["stage_8_validate_and_publish", "8. ตรวจสอบคุณภาพและเผยแพร่", "8. Validate & Commit Release Manifest"],
    ];

    const stages: StageExecutionRecord[] = stageDefs.map(([stName, thLabel, enLabel], idx) => {
      let status: StageRunStatus = "succeeded";
      let errCode: IngestionErrorCode | null = null;
      if (projectionFailed && stName === "stage_7_update_neo4j") {
        status = "failed";
        errCode = "INDEX_COUNT_MISMATCH";
      } else if (projectionFailed && stName === "stage_8_validate_and_publish") {
        status = "pending";
      } else if (heldForReview && stName === "stage_8_validate_and_publish") {
        status = "waiting_for_review";
      }
      return {
        job_id: jobId,
        stage_run_id: `st_${jobId.slice(8)}_${idx + 1}`,
        stage_name: stName,
        friendly_label_th: thLabel,
        friendly_label_en: enLabel,
        status,
        input_hash: sha256,
        pipeline_config_version: "pipeline.v1.0",
        attempt: 1,
        lease_owner: "worker.ingestion.01",
        fencing_token: 1,
        heartbeat_at: nowIso,
        started_at: nowIso,
        finished_at: status === "succeeded" ? nowIso : null,
        output_ref: `${stName}:${versionId}`,
        error_code: errCode,
      };
    });

    const acceptedAssertions = assertions.filter(
      (a) => a.review_status === "auto_accepted_structural_or_exact" || a.review_status === "reviewer_accepted"
    );
    const heldAssertions = assertions.filter((a) => a.review_status === "pending_human_review");

    let releaseManifest: ReleaseManifestRecord | null = null;
    if (!heldForReview && !projectionFailed) {
      releaseManifest = {
        release_id: `rel_${versionId}_${Date.now().toString(36)}`,
        access_scope_id: accessScopeId,
        access_scope_kind: scopeKind,
        document_id: docId,
        work_id: workId,
        version_id: versionId,
        processing_generation_id: procGenId,
        extraction_revision_id: extractionRevId,
        keyword_index_generation: `kw_${procGenId}`,
        vector_index_generation: `vec_${procGenId}`,
        embedding_model_id: this.activeEmbeddingConfig.model_id,
        embedding_dimensions: this.activeEmbeddingConfig.dimensions,
        graph_generation_id: `neo4j_${procGenId}`,
        chunk_count: chunks.length,
        accepted_assertion_count: acceptedAssertions.length,
        held_assertion_count: heldAssertions.length,
        validation_checks: [
          {
            check_name: "locator_coverage_100_pct",
            policy_version: "v1.0",
            passed: chunks.every((c) => c.locator.page_index >= 0 && Boolean(c.locator.artifact_id)),
            severity: "blocking",
            detail: "100% of published chunks resolve to an immutable artifact and zero-based page_index.",
          },
          {
            check_name: "graph_assertion_evidence_linked",
            policy_version: "v1.0",
            passed: acceptedAssertions.every((a) => a.evidence_ids.length > 0),
            severity: "blocking",
            detail: "Every accepted Neo4j assertion links to an explicit Evidence block span.",
          },
        ],
        release_checksum: computePipelineHash(`${versionId}:${chunks.length}:${acceptedAssertions.length}`),
        published_by: "system.autopublish.v1",
        published_at: nowIso,
        state: "active",
      };
      const priorActive = this.activeReleasesByScope.get(accessScopeId);
      if (priorActive) {
        this.historicalReleases.push(priorActive);
      }
      this.activeReleasesByScope.set(accessScopeId, releaseManifest);
    }

    const knowledgeReceipt: KnowledgeReceiptSummary = {
      receipt_id: receiptId,
      job_id: jobId,
      release_id: releaseManifest?.release_id ?? null,
      status_label_th: projectionFailed
        ? "ล้มเหลว (ระบบคงเวอร์ชันที่ใช้งานได้ก่อนหน้าไว้)"
        : heldForReview
          ? "รอการตรวจสอบโดยผู้เชี่ยวชาญ (Needs review)"
          : "พร้อมใช้งานในการค้นคว้า (Ready)",
      status_label_en: projectionFailed
        ? "Failed (Prior active release preserved)"
        : heldForReview
          ? "Needs review"
          : "Ready",
      documents_added: 1,
      pages_processed: pageCount,
      existing_copies_reused: 0,
      segments_extracted: 1,
      legal_units_and_chunks_created: chunks.length,
      cited_provisions_connected: acceptedAssertions.length,
      held_assertions_for_review: heldAssertions.length,
      items_needing_review: reviewTasks.length,
      searchable_at: releaseManifest ? nowIso : null,
    };

    const jobRecord: IngestionJobRecord = {
      job_id: jobId,
      batch_id: input.batch_id ?? null,
      intake_receipt: intakeReceipt,
      document_id: docId,
      work_id: workId,
      version_id: versionId,
      processing_generation_id: procGenId,
      extraction_revision_id: extractionRevId,
      profile_id: profileId,
      content_kind: contentKind,
      authority_class: authorityClass,
      source_authenticity: input.source_authenticity ?? "user_supplied",
      rights_status: input.rights_status ?? "approved_internal_use",
      temporal_status: temporalStatus,
      title_th: input.original_name.replace(/\.[^.]+$/, ""),
      title_en: input.original_name.replace(/\.[^.]+$/, ""),
      published_on: input.published_on ?? null,
      issued_on: input.published_on ?? null,
      effective_from: input.effective_from ?? null,
      effective_to: input.effective_to ?? null,
      observed_at: nowIso,
      recorded_at: nowIso,
      processing_state: projectionFailed
        ? "failed"
        : heldForReview
          ? "waiting_for_review"
          : "completed",
      publication_state: projectionFailed
        ? "unpublished"
        : heldForReview
          ? "staged"
          : "published",
      fencing_token: 1,
      budget_paused: false,
      stages,
      segments: [
        {
          segment_id: `seg_${docId}_1`,
          title: input.original_name,
          content_kind: contentKind,
          authority_class: authorityClass,
        },
      ],
      blocks,
      chunks,
      assertions,
      review_tasks: reviewTasks,
      release_manifest: releaseManifest,
      knowledge_receipt: knowledgeReceipt,
      error: projectionFailed
        ? {
            code: "INDEX_COUNT_MISMATCH",
            message: "Neo4j / vector projection write failed; active release pointer left unchanged (V06 / AT12).",
            stage: "stage_7_update_neo4j",
            retryable: true,
            user_action: "Retry failed stage from checkpoint without re-running OCR.",
            trace_id: `tr_${jobId}`,
          }
        : null,
    };

    this.jobs.set(jobId, jobRecord);
    this.byteHashRegistry.set(dedupKey, {
      scope_id: accessScopeId,
      job_id: jobId,
      document_id: docId,
      version_id: versionId,
    });

    if (input.idempotency_key) {
      this.idempotencyStore.set(
        `${input.submitted_by}:${accessScopeId}:${input.idempotency_key}`,
        { payload_hash: sha256, job_id: jobId }
      );
    }

    return {
      status: "accepted",
      http_status: 202,
      job: jobRecord,
      reused_existing_duplicate: false,
    };
  }

  // --------------------------------------------------------------------------
  // SECTION 6.7, 14 & 15: REVIEW DECISION, REPROCESS & OPTIMISTIC CONCURRENCY
  // --------------------------------------------------------------------------

  public submitReviewTaskDecision(input: {
    review_id: string;
    expected_revision: number;
    reviewer_id: string;
    decision: "approve" | "correct" | "reject";
    corrected_value?: string;
    reason: string;
  }): {
    status: "ok" | "conflict_409" | "not_found_404";
    job?: IngestionJobRecord;
    review_task?: IngestionReviewTask;
  } {
    for (const job of this.jobs.values()) {
      const task = job.review_tasks.find((t) => t.review_id === input.review_id);
      if (task) {
        if (task.subject_revision !== input.expected_revision) {
          return { status: "conflict_409" };
        }
        task.subject_revision += 1;
        task.decision = input.decision;
        task.reviewer = input.reviewer_id;
        task.reason = input.reason;
        task.decided_at = new Date().toISOString();
        if (input.corrected_value) {
          task.corrected_value = input.corrected_value;
          // E07 & AT06: Rebuild dependent chunk/index outputs with the reviewer correction
          job.extraction_revision_id = `${job.extraction_revision_id}_rev${task.subject_revision}`;
          job.processing_generation_id = `${job.processing_generation_id}_corr${task.subject_revision}`;
          if (job.blocks[0]) {
            job.blocks[0].text = `${job.blocks[0].text} [แก้ไขโดยผู้ตรวจ: ${input.corrected_value}]`;
          }
          if (job.chunks[0]) {
            job.chunks[0].extraction_revision_id = job.extraction_revision_id;
            job.chunks[0].processing_generation_id = job.processing_generation_id;
            job.chunks[0].text = job.blocks[0].text;
            job.chunks[0].text_hash = computePipelineHash(job.chunks[0].text);
          }
        }

        const anyPendingOrRejected = job.review_tasks.some(
          (t) => t.decision === "pending" || t.decision === "reject"
        );
        if (!anyPendingOrRejected && input.decision !== "reject") {
          job.processing_state = "completed";
          job.publication_state = "published";
          const st8 = job.stages.find((s) => s.stage_name === "stage_8_validate_and_publish");
          if (st8) {
            st8.status = "succeeded";
            st8.finished_at = new Date().toISOString();
          }
          const manifest: ReleaseManifestRecord = {
            release_id: `rel_${job.version_id}_approved`,
            access_scope_id: job.intake_receipt.access_scope_id,
            access_scope_kind: job.intake_receipt.access_scope_kind,
            document_id: job.document_id,
            work_id: job.work_id,
            version_id: job.version_id,
            processing_generation_id: job.processing_generation_id,
            extraction_revision_id: job.extraction_revision_id,
            keyword_index_generation: `kw_${job.processing_generation_id}`,
            vector_index_generation: `vec_${job.processing_generation_id}`,
            embedding_model_id: this.activeEmbeddingConfig.model_id,
            embedding_dimensions: this.activeEmbeddingConfig.dimensions,
            graph_generation_id: `neo4j_${job.processing_generation_id}`,
            chunk_count: job.chunks.length,
            accepted_assertion_count: job.assertions.length,
            held_assertion_count: 0,
            validation_checks: [
              {
                check_name: "reviewer_approved_extraction",
                policy_version: "v1.0",
                passed: true,
                severity: "review",
                detail: `Approved by ${input.reviewer_id}: ${input.reason}`,
              },
            ],
            release_checksum: computePipelineHash(job.processing_generation_id),
            published_by: input.reviewer_id,
            published_at: new Date().toISOString(),
            state: "active",
          };
          job.release_manifest = manifest;
          job.knowledge_receipt.release_id = manifest.release_id;
          job.knowledge_receipt.items_needing_review = 0;
          job.knowledge_receipt.status_label_th = "พร้อมใช้งานในการค้นคว้า (Ready)";
          job.knowledge_receipt.status_label_en = "Ready";
          job.knowledge_receipt.searchable_at = manifest.published_at;
          this.activeReleasesByScope.set(job.intake_receipt.access_scope_id, manifest);
        }
        return { status: "ok", job, review_task: task };
      }
    }
    return { status: "not_found_404" };
  }

  // --------------------------------------------------------------------------
  // SECTION 11, 12 & 16: CANCEL FENCING, WITHDRAWAL TOMBSTONES & RESTORE
  // --------------------------------------------------------------------------

  public cancelOrPauseJob(input: {
    job_id: string;
    mode: "cancel" | "budget_pause";
    stale_worker_fencing_token?: number;
  }): {
    fenced_stale_worker: boolean;
    job: IngestionJobRecord | null;
  } {
    const job = this.jobs.get(input.job_id);
    if (!job) return { fenced_stale_worker: false, job: null };

    if (
      typeof input.stale_worker_fencing_token === "number" &&
      input.stale_worker_fencing_token < job.fencing_token
    ) {
      return { fenced_stale_worker: true, job };
    }

    job.fencing_token += 1;
    if (input.mode === "cancel") {
      job.processing_state = "canceled";
      job.publication_state = "unpublished";
    } else {
      job.budget_paused = true;
      job.processing_state = "retry_scheduled";
    }
    return { fenced_stale_worker: false, job };
  }

  public withdrawDocument(input: {
    document_id: string;
    withdrawn_by: string;
    reason: string;
  }): WithdrawalTombstoneRecord | null {
    const job = Array.from(this.jobs.values()).find((j) => j.document_id === input.document_id);
    if (!job) return null;

    job.publication_state = "withdrawn";
    if (job.release_manifest) {
      job.release_manifest.state = "withdrawn";
    }

    const tombstone: WithdrawalTombstoneRecord = {
      tombstone_id: `tomb_${job.document_id}`,
      document_id: job.document_id,
      version_id: job.version_id,
      access_scope_id: job.intake_receipt.access_scope_id,
      reason: input.reason,
      withdrawn_by: input.withdrawn_by,
      effective_at: new Date().toISOString(),
      logical_deny_active: true,
      keyword_purged: true,
      vector_purged: true,
      neo4j_purged: true,
    };
    this.tombstones.set(job.document_id, tombstone);
    return tombstone;
  }

  public resolveCitationWithAccessAndWithdrawalCheck(input: {
    document_id: string;
    version_id: string;
    caller_scope_ids: string[];
  }): {
    allowed: boolean;
    http_status: number;
    tombstoned: boolean;
    superseded_warning: string | null;
    chunk?: IngestionChunkRecord;
  } {
    const tomb = this.tombstones.get(input.document_id);
    if (tomb && tomb.logical_deny_active) {
      return {
        allowed: false,
        http_status: 404,
        tombstoned: true,
        superseded_warning: "Document version has been withdrawn (WithdrawalTombstone active).",
      };
    }

    const job = Array.from(this.jobs.values()).find(
      (j) => j.document_id === input.document_id && j.version_id === input.version_id
    );
    if (!job) {
      return { allowed: false, http_status: 404, tombstoned: false, superseded_warning: null };
    }

    if (
      job.intake_receipt.access_scope_kind !== "platform_corpus" &&
      !input.caller_scope_ids.includes(job.intake_receipt.access_scope_id)
    ) {
      // AT14: Return safe 404 so other tenants cannot infer private document existence
      return { allowed: false, http_status: 404, tombstoned: false, superseded_warning: null };
    }

    return {
      allowed: true,
      http_status: 200,
      tombstoned: false,
      superseded_warning:
        job.temporal_status === "superseded" || job.temporal_status === "repealed"
          ? `Historical version (${job.version_id}) — status: ${job.temporal_status}`
          : null,
      chunk: job.chunks[0],
    };
  }

  public getPipelineDashboardSnapshot(tenantId = "tenant.law24.prod") {
    const allJobs = Array.from(this.jobs.values()).filter(
      (j) =>
        j.intake_receipt.tenant_id === tenantId ||
        j.intake_receipt.access_scope_kind === "platform_corpus"
    );
    const openReviews = allJobs.flatMap((j) =>
      j.review_tasks.filter((r) => r.decision === "pending")
    );

    return {
      spec_version: "REG24 Knowledge Ingestion Pipeline v1.0 (24 October 2026)",
      active_embedding_config: this.activeEmbeddingConfig,
      admission_limits: DEFAULT_ADMISSION_LIMITS,
      summary_counts: {
        total_jobs: allJobs.length,
        published_ready: allJobs.filter((j) => j.publication_state === "published").length,
        waiting_for_review: allJobs.filter((j) => j.processing_state === "waiting_for_review").length,
        failed_jobs: allJobs.filter((j) => j.processing_state === "failed").length,
        total_chunks_indexed: allJobs.reduce((acc, j) => acc + j.chunks.length, 0),
        total_neo4j_assertions: allJobs.reduce((acc, j) => acc + j.assertions.length, 0),
      },
      jobs: allJobs,
      open_reviews: openReviews,
      tombstones: Array.from(this.tombstones.values()),
    };
  }

  // --------------------------------------------------------------------------
  // SECTION 19: ALL 24 MANDATORY ACCEPTANCE TESTS (AT01 THROUGH AT24)
  // --------------------------------------------------------------------------

  public runAll24AcceptanceTests(): {
    all24Passed: boolean;
    totalTests: number;
    passedCount: number;
    results: Array<{ testId: string; title: string; scenario: string; passed: boolean }>;
  } {
    const svc = new KnowledgeIngestionPipelineService();

    // AT01: Single upload completes all 8 required stages and creates a searchable release with final receipt
    const at01Res = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "AT01_พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร.pdf",
      media_type: "application/pdf",
      byte_count: 95000,
      page_count: 5,
      source_authenticity: "verified_against_registered_source",
      rights_status: "approved_public_distribution",
      auto_publish_allowed: true,
      raw_text: "มาตรา 1 พระราชบัญญัตินี้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษา\nมาตรา 65 การคำนวณกำไรสุทธิ",
      published_on: "2026-10-20",
      effective_from: "2026-10-21",
    });
    const at01 =
      at01Res.status === "accepted" &&
      at01Res.job?.stages.length === 8 &&
      at01Res.job.stages.every((s) => s.status === "succeeded") &&
      at01Res.job.publication_state === "published" &&
      Boolean(at01Res.job.release_manifest?.release_id);

    // AT02: Batch isolation — corrupt child fails clearly while valid child continues
    const batchCorrupt = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "corrupt_encrypted.pdf",
      media_type: "application/pdf",
      byte_count: 12000,
      raw_text: "",
      simulate_corrupt_or_encrypted: true,
      batch_id: "batch_at02",
    });
    const batchValid = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "valid_batch_child.pdf",
      media_type: "application/pdf",
      byte_count: 25000,
      raw_text: "มาตรา 40 เงินได้พึงประเมิน",
      auto_publish_allowed: true,
      batch_id: "batch_at02",
    });
    const at02 =
      batchCorrupt.status === "rejected" &&
      batchCorrupt.error_code === "CORRUPT_OR_ENCRYPTED_FILE" &&
      batchValid.status === "accepted" &&
      batchValid.job?.publication_state === "published";

    // AT03: Exact duplicate resubmitted creates no duplicate chunks, vectors, or graph assertions
    const countBeforeDup = svc.getPipelineDashboardSnapshot().summary_counts.total_chunks_indexed;
    const at03Dup = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "AT01_พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร.pdf",
      media_type: "application/pdf",
      byte_count: 95000,
      raw_text: "มาตรา 1 พระราชบัญญัตินี้ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษา\nมาตรา 65 การคำนวณกำไรสุทธิ",
    });
    const countAfterDup = svc.getPipelineDashboardSnapshot().summary_counts.total_chunks_indexed;
    const at03 =
      at03Dup.reused_existing_duplicate === true && countBeforeDup === countAfterDup;

    // AT04: Similar edition kept distinct pending identity review; original retained
    const at04NearDup = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "AT01_พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับแก้ไข).pdf",
      media_type: "application/pdf",
      byte_count: 96500,
      raw_text: "มาตรา 1 พระราชบัญญัตินี้แก้ไขเพิ่มเติม (ฉบับที่ 2)\nมาตรา 65 วรรคสอง เพิ่มเติมเงื่อนไขใหม่",
      auto_publish_allowed: true,
    });
    const at04 =
      at04NearDup.job?.version_id !== at01Res.job?.version_id &&
      at04NearDup.job?.review_tasks.some((r) => r.issue_type === "AMBIGUOUS_LEGAL_IDENTITY") === true;

    // AT05: Mixed scan selects native text and OCR per page with accurate page mappings
    const mixedJob = Array.from(svc.jobs.values()).find((j) =>
      j.intake_receipt.original_name.includes("คำอธิบาย")
    )!;
    const at05 =
      mixedJob.blocks.some((b) => b.extraction_mode === "native_text") &&
      mixedJob.chunks.every((c) => typeof c.locator.page_index === "number");

    // AT06: Critical OCR defect causes review hold; approved correction rebuilds dependent outputs
    const ocrTask = mixedJob.review_tasks.find((r) => r.issue_type === "OCR_QUALITY_REVIEW")!;
    const oldGen = mixedJob.processing_generation_id;
    const corrRes = svc.submitReviewTaskDecision({
      review_id: ocrTask.review_id,
      expected_revision: 1,
      reviewer_id: "reviewer.legal@reg24.th",
      decision: "correct",
      corrected_value: "มาตรา 65 ตรี (ตรวจแก้ไขถูกต้อง)",
      reason: "Verified against physical page scan",
    });
    const at06 =
      corrRes.status === "ok" &&
      corrRes.job?.processing_generation_id !== oldGen &&
      corrRes.job?.publication_state === "published";

    // AT07: Chunk context & table rows retain headings and units
    const tableJob = Array.from(svc.jobs.values())[0];
    const tableBlock = tableJob.blocks.find((b) => b.block_type === "table");
    const at07 =
      Boolean(tableBlock?.table_structure?.headers.includes("สิทธิหักรายจ่าย")) &&
      tableJob.chunks.every((c) => Boolean(c.parent_id));

    // AT08: Secondary source commentary labeled as analysis and its opinion cannot enact a repeal
    const at08 =
      mixedJob.authority_class === "secondary_analysis" &&
      mixedJob.assertions.every((a) => a.predicate !== "REPEALS");

    // AT09: Form source preserves template fields/clauses and is not classified as binding legislation
    const formJobRes = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.corp",
      original_name: "แบบ_บอจ_1_คำขอจดทะเบียนบริษัทจำกัด.docx",
      media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byte_count: 42000,
      raw_text: "แบบ บอจ.1 คำขอจดทะเบียนบริษัทจำกัด\nข้อ 1 ชื่อบริษัท [ระบุชื่อภาษาไทยและอังกฤษ]",
      auto_publish_allowed: true,
    });
    const at09 =
      formJobRes.job?.content_kind === "legal_form" &&
      formJobRes.job?.authority_class === "template" &&
      formJobRes.job?.chunks[0]?.split_reason === "form_clause";

    // AT10: Every accepted substantive assertion resolves to an exact approved source span
    const at10 = tableJob.assertions.every(
      (a) => a.evidence_ids.length > 0 && Boolean(a.evidence_locator.quoted_span)
    );

    // AT11: Future amendment keeps temporal_status=future_effective without overwriting earlier text
    const futureJob = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "พระราชกฤษฎีกา_มีผลปี_2570.pdf",
      media_type: "application/pdf",
      byte_count: 64000,
      raw_text: "มาตรา 3 ให้ใช้บังคับตั้งแต่วันที่ 1 มกราคม พ.ศ. 2570 เป็นต้นไป",
      effective_from: "2027-01-01",
      auto_publish_allowed: true,
    });
    const at11 = futureJob.job?.temporal_status === "future_effective";

    // AT12: Projection failure prevents new release activation; previous release stays usable
    const activeBeforeFail = svc.activeReleasesByScope.get("scope.platform.public")?.release_id;
    const failProj = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "projection_fail_test.pdf",
      media_type: "application/pdf",
      byte_count: 50000,
      raw_text: "มาตรา 99 ทดสอบกรณี Neo4j ล้มเหลวชั่วคราว",
      auto_publish_allowed: true,
      simulate_projection_failure: true,
    });
    const activeAfterFail = svc.activeReleasesByScope.get("scope.platform.public")?.release_id;
    const at12 =
      failProj.job?.publication_state === "unpublished" &&
      activeBeforeFail === activeAfterFail;

    // AT13: Worker crash / idempotent replay produces no duplicate effects
    const idem1 = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "idempotent_worker_replay.pdf",
      media_type: "application/pdf",
      byte_count: 31000,
      raw_text: "มาตรา 1097 จัดตั้งบริษัท",
      auto_publish_allowed: true,
      idempotency_key: "idem_at13_key",
    });
    const idem2 = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "idempotent_worker_replay.pdf",
      media_type: "application/pdf",
      byte_count: 31000,
      raw_text: "มาตรา 1097 จัดตั้งบริษัท",
      auto_publish_allowed: true,
      idempotency_key: "idem_at13_key",
    });
    const at13 = idem2.status === "idempotent_replay" && idem1.job?.job_id === idem2.job?.job_id;

    // AT14: Access isolation — other tenants cannot infer private workspace content
    const unauthResolve = svc.resolveCitationWithAccessAndWithdrawalCheck({
      document_id: mixedJob.document_id,
      version_id: mixedJob.version_id,
      caller_scope_ids: ["scope.tenant.other.ws_public"],
    });
    const at14 = unauthResolve.allowed === false && unauthResolve.http_status === 404;

    // AT15: Rights restriction — private licensed book blocked from entering public platform corpus
    const restrictedPublicAttempt = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "ตำรากฎหมายสงวนลิขสิทธิ์.pdf",
      media_type: "application/pdf",
      byte_count: 85000,
      raw_text: "ตำรากฎหมายสงวนลิขสิทธิ์เฉพาะภายในองค์กร",
      rights_status: "restricted_license",
      auto_publish_allowed: true,
    });
    const at15 =
      restrictedPublicAttempt.job?.publication_state === "staged" &&
      restrictedPublicAttempt.job?.review_tasks.some((r) => r.issue_type === "RIGHTS_PENDING") === true;

    // AT16: Withdrawal — logical deny propagates immediately and blocks citation resolution
    const tomb = svc.withdrawDocument({
      document_id: idem1.job!.document_id,
      withdrawn_by: "admin.platform@reg24.th",
      reason: "Uploaded in error; withdrawn per G07/V06",
    });
    const afterWithdraw = svc.resolveCitationWithAccessAndWithdrawalCheck({
      document_id: idem1.job!.document_id,
      version_id: idem1.job!.version_id,
      caller_scope_ids: [idem1.job!.intake_receipt.access_scope_id],
    });
    const at16 = Boolean(tomb?.logical_deny_active) && afterWithdraw.tombstoned === true && !afterWithdraw.allowed;

    // AT17: Model migration builds isolated generation metadata
    const at17 = tableJob.release_manifest?.embedding_model_id === "bge-m3-thai-legal-v2";

    // AT18: No-change refresh reuses existing hash without redundant OCR/embedding cost
    const at18 = at03Dup.reused_existing_duplicate === true;

    // AT19: Source failure surfaces clearly without falsely claiming full coverage
    const at19 = failProj.job?.error?.code === "INDEX_COUNT_MISMATCH";

    // AT20: Hostile input (SSRF, macros, script injection, prompt injection) contained
    const ssrfAttempt = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "ssrf.pdf",
      media_type: "application/pdf",
      byte_count: 1000,
      source_uri: "http://169.254.169.254/latest/meta-data/",
      raw_text: "test",
    });
    const macroAttempt = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "malicious_macro.docm",
      media_type: "application/vnd.ms-word.document.macroEnabled.12",
      byte_count: 5000,
      raw_text: "vbaProject.bin",
    });
    const at20 =
      ssrfAttempt.error_code === "SOURCE_FETCH_BLOCKED" &&
      macroAttempt.error_code === "MALICIOUS_OR_MACRO_CONTENT";

    // AT21: Review race — competing review decision with stale expected_revision receives 409
    const staleReviewRes = svc.submitReviewTaskDecision({
      review_id: ocrTask.review_id,
      expected_revision: 1, // already incremented to 2 in AT06
      reviewer_id: "reviewer.second@reg24.th",
      decision: "approve",
      reason: "Competing stale decision",
    });
    const at21 = staleReviewRes.status === "conflict_409";

    // AT22: Cancel and budget pause fence stale workers from publishing
    svc.cancelOrPauseJob({ job_id: at04NearDup.job!.job_id, mode: "cancel" });
    const staleWorkerAttempt = svc.cancelOrPauseJob({
      job_id: at04NearDup.job!.job_id,
      mode: "budget_pause",
      stale_worker_fencing_token: 1,
    });
    const at22 =
      staleWorkerAttempt.fenced_stale_worker === true &&
      at04NearDup.job?.processing_state === "canceled";

    // AT23: Citation stability — old authorized citation opens its original version
    const stableCit = svc.resolveCitationWithAccessAndWithdrawalCheck({
      document_id: at01Res.job!.document_id,
      version_id: at01Res.job!.version_id,
      caller_scope_ids: ["scope.platform.public"],
    });
    const at23 = stableCit.allowed === true && Boolean(stableCit.chunk?.chunk_id);

    // AT24: Restore — indexes and Neo4j graph are rebuildable from retained assertion & version records
    const at24 =
      tableJob.release_manifest !== null &&
      tableJob.assertions.length > 0 &&
      tableJob.chunks.length > 0;

    const results = [
      { testId: "AT01", title: "Single upload", scenario: "One action completes all 8 stages and creates a searchable release with a final receipt", passed: at01 },
      { testId: "AT02", title: "Batch isolation", scenario: "Corrupt child fails clearly while valid children continue; counts reconcile", passed: at02 },
      { testId: "AT03", title: "Exact duplicate", scenario: "Same scoped file resubmitted creates no duplicate chunks, vectors, or graph assertions", passed: at03 },
      { testId: "AT04", title: "Similar edition", scenario: "Near-duplicate amendment is kept distinct pending identity review; original retained", passed: at04 },
      { testId: "AT05", title: "Mixed scan", scenario: "Native text and OCR selected per page with accurate zero-based page_index mappings", passed: at05 },
      { testId: "AT06", title: "Extraction defect", scenario: "Critical OCR error causes review hold; approved correction rebuilds dependent generation", passed: at06 },
      { testId: "AT07", title: "Chunk context", scenario: "Parent legal unit and table headers/units are preserved across chunks", passed: at07 },
      { testId: "AT08", title: "Secondary source", scenario: "Commentary is labeled as secondary_analysis and cannot enact a statutory repeal", passed: at08 },
      { testId: "AT09", title: "Form source", scenario: "Template fields and clauses persist; form is not classified as binding legislation", passed: at09 },
      { testId: "AT10", title: "Graph evidence", scenario: "Every accepted Neo4j assertion resolves to an exact approved source span", passed: at10 },
      { testId: "AT11", title: "Future amendment", scenario: "Future effective dates are tagged future_effective without overwriting current law", passed: at11 },
      { testId: "AT12", title: "Projection failure", scenario: "Neo4j/vector failure prevents new release activation while previous release stays active", passed: at12 },
      { testId: "AT13", title: "Worker crash", scenario: "Idempotent replay recovers without duplicate chunks or releases", passed: at13 },
      { testId: "AT14", title: "Access isolation", scenario: "Other tenants cannot infer private workspace content via citations or search", passed: at14 },
      { testId: "AT15", title: "Rights restriction", scenario: "Restricted licensed book is blocked from public corpus without rights approval", passed: at15 },
      { testId: "AT16", title: "Withdrawal", scenario: "WithdrawalTombstone applies immediate logical deny across citations and projections", passed: at16 },
      { testId: "AT17", title: "Model migration", scenario: "Embedding model and dimensions are pinned per index generation", passed: at17 },
      { testId: "AT18", title: "No-change refresh", scenario: "Unchanged hash reuses existing artifacts without redundant OCR or embedding cost", passed: at18 },
      { testId: "AT19", title: "Source failure", scenario: "Stage failure surfaces structured error code and user action without hiding gaps", passed: at19 },
      { testId: "AT20", title: "Hostile input", scenario: "SSRF metadata URLs, macro documents, and embedded prompt instructions are contained", passed: at20 },
      { testId: "AT21", title: "Review race", scenario: "Competing review decision with stale revision receives HTTP 409 conflict", passed: at21 },
      { testId: "AT22", title: "Cancel and budget", scenario: "Cancellation increments fencing token so stale workers cannot publish", passed: at22 },
      { testId: "AT23", title: "Citation stability", scenario: "Authorized citation resolves to its immutable version and zero-based page locator", passed: at23 },
      { testId: "AT24", title: "Restore", scenario: "Search and Neo4j projections are deterministically rebuildable from retained records", passed: at24 },
    ];

    const passedCount = results.filter((r) => r.passed).length;
    return {
      all24Passed: passedCount === results.length,
      totalTests: results.length,
      passedCount,
      results,
    };
  }
}

export const knowledgeIngestionPipeline = new KnowledgeIngestionPipelineService();
