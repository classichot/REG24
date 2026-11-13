/**
 * REG24 Thai Legal OCR v2.0 Core Service, Evidence Registry, Dual-Control Review & Atomic Publication Engine
 * Covers `REG-001` through `REG-009` and all 12 Section 11 End-to-End Acceptance Scenarios.
 */

import {
  ApplicabilityCurationMetadata,
  ApprovalScope,
  DEFAULT_OCR_V2_FEATURE_FLAGS,
  ExtractionManifest,
  LegalAnnotation,
  LegalApprovalRecord,
  LegalAuditEvent,
  LegalCorrectionRecord,
  LegalDocumentVersion,
  LegalPublicationManifest,
  LegalReviewDecisionRecord,
  LegalSourceCategory,
  LegalSourceRecord,
  LegalSourceVersion,
  OCRJob,
  OCRPage,
  OCRTable,
  OcrContractErrorEnvelope,
  OcrErrorCode,
  OcrHumanRole,
  OcrPrincipalContext,
  OcrV2FeatureFlags,
  OutboxEvent,
  PrivacyClass,
  RenderedPageEvidence,
  SourceSpan,
  StagedGraphEdge,
  StagedKeywordChunk,
  canonicalizeJcsRfc8785,
  computeOcrDigestV1,
  isTerminalJobState,
  sha256HexLower,
  signWebhookPayloadHmacSha256,
  validateExtractionManifestContractV2,
  verifyWebhookPayloadHmacSha256,
} from "./contract";
import {
  DEFAULT_LEGAL_OCR_POLICY,
  OcrProviderDescriptor,
  OcrRoutingPolicy,
  Rag24ContinuityAdapter,
  SimulatedProviderBehaviorOverride,
  segmentStructuredBlocksFromRawText,
} from "./providers";
import {
  THAI_DETECTOR_VERSION_V2,
  THAI_NORMALIZATION_RULESET_V2,
  extractThaiLegalAnnotationsV2,
  inspectThaiCombiningDiagnostics,
  normalizeThaiLegalTextV2,
  sliceByCodePoints,
} from "./thai-normalizer";
import {
  BenchmarkFixtureDocument,
  ThaiOcrBenchmarkReport,
  evaluateThaiOcrBenchmarkSuite,
} from "./benchmark";

export interface HttpServiceResult<T = unknown> {
  status: number;
  headers?: Record<string, string>;
  body: T | OcrContractErrorEnvelope;
}

interface IdempotencyEntry {
  key: string;
  scope_hash: string;
  request_hash: string;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  created_at_ms: number;
  retain_until_ms: number;
}

interface WorkerLeaseRecord {
  job_id: string;
  fencing_token: number;
  worker_id: string;
  leased_at_ms: number;
  expires_at_ms: number;
  active: boolean;
}

export interface PublicationRetrievalSnapshot {
  snapshot_id: string;
  captured_at: string;
  tenant_id: string;
  workspace_id: string;
  active_publications_by_document: Map<string, LegalPublicationManifest>;
}

export interface SourceLinkedSearchHit {
  document_id: string;
  title_th: string;
  title_en: string;
  publication_id: string;
  version_id: string;
  source_version_id: string;
  extraction_version_id: string;
  page_number: number;
  source_span: SourceSpan;
  raw_excerpt: string;
  normalized_excerpt: string;
  citation_locator: string;
  transcription_status: LegalDocumentVersion["transcription_status"];
  reference_status: LegalDocumentVersion["reference_status"];
  applicability_status: LegalDocumentVersion["applicability_status"];
  applicability_disclosure: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_SYSTEM_OPERATOR: OcrPrincipalContext = {
  principal_id: "principal.legal_ops.01",
  tenant_id: "tenant.reg24.th",
  workspace_id: "ws.reg24.main",
  roles: ["uploader", "reviewer", "legal_editor", "publisher"],
  scopes: ["ocr:submit", "ocr:read", "ocr:cancel", "ocr:policy:write"],
  is_service_account: false,
  confidential_access_granted: true,
};

export const SECOND_APPROVER_PRINCIPAL: OcrPrincipalContext = {
  principal_id: "principal.senior_counsel.02",
  tenant_id: "tenant.reg24.th",
  workspace_id: "ws.reg24.main",
  roles: ["reviewer", "legal_editor", "publisher"],
  scopes: ["ocr:read"],
  is_service_account: false,
  confidential_access_granted: true,
};

export class Reg24OcrV2Service {
  private flags: OcrV2FeatureFlags;
  private adapter: Rag24ContinuityAdapter;
  private policies: Map<string, OcrRoutingPolicy> = new Map();

  // Domain & shared contract stores
  private sources: Map<string, LegalSourceRecord> = new Map();
  private sourceVersions: Map<string, LegalSourceVersion> = new Map();
  private jobs: Map<string, OCRJob> = new Map();
  private workerLeases: Map<string, WorkerLeaseRecord> = new Map();
  private diagnosticLateOutputs: Array<{
    job_id: string;
    fencing_token: number;
    rejected_reason: string;
    incurred_micros: number;
    recorded_at: string;
  }> = [];

  private manifests: Map<string, ExtractionManifest> = new Map();
  private extractionPages: Map<string, OCRPage[]> = new Map();
  private documentVersions: Map<string, LegalDocumentVersion> = new Map(); // keyed by `version_id`
  private latestDocVersionByDocId: Map<string, string> = new Map();        // `document_id -> version_id`
  private annotationsByVersion: Map<string, LegalAnnotation[]> = new Map(); // keyed by `annotation_version`
  private corrections: Map<string, LegalCorrectionRecord> = new Map();
  private reviewDecisions: Map<string, LegalReviewDecisionRecord> = new Map();
  private approvals: Map<string, LegalApprovalRecord> = new Map();

  // Publication & staged cross-store projections
  private publications: Map<string, LegalPublicationManifest> = new Map();
  private activePublicationPointer: Map<string, string> = new Map(); // `(tenant:ws:docId) -> publication_id`
  private stagedChunksByPub: Map<string, StagedKeywordChunk[]> = new Map();
  private stagedEdgesByPub: Map<string, StagedGraphEdge[]> = new Map();
  private answerCache: Map<string, { publication_ids: string[]; cached_answer: string }> = new Map();

  // Outbox, Consumer Inbox, Webhooks & Audit
  private outbox: Map<string, OutboxEvent> = new Map();
  private consumerInboxProcessed: Map<string, { event_id: string; job_id: string; state_revision: number; staging_op_id: string }> = new Map();
  private allowlistedWebhookTargets: Map<string, { url: string; key_id: string; secret: string }> = new Map();
  private idempotencyStore: Map<string, IdempotencyEntry> = new Map();
  private tenantConsumedMicros: Map<string, number> = new Map();
  private auditEvents: LegalAuditEvent[] = [];

  private seqCounter = 1000;
  private fencingCounter = 1;

  constructor(options?: { seedFixtures?: boolean; flags?: Partial<OcrV2FeatureFlags> }) {
    this.flags = { ...DEFAULT_OCR_V2_FEATURE_FLAGS, ...(options?.flags ?? {}) };
    this.adapter = new Rag24ContinuityAdapter();
    this.policies.set(DEFAULT_LEGAL_OCR_POLICY.policy_id, {
      ...DEFAULT_LEGAL_OCR_POLICY,
      allowed_providers_by_privacy: {
        public: [...DEFAULT_LEGAL_OCR_POLICY.allowed_providers_by_privacy.public],
        internal: [...DEFAULT_LEGAL_OCR_POLICY.allowed_providers_by_privacy.internal],
        confidential: [...DEFAULT_LEGAL_OCR_POLICY.allowed_providers_by_privacy.confidential],
        restricted: [...DEFAULT_LEGAL_OCR_POLICY.allowed_providers_by_privacy.restricted],
      },
    });
    this.allowlistedWebhookTargets.set("wh.reg24.internal", {
      url: "https://reg24-theta.vercel.app/api/v1/ocr/webhooks/internal",
      key_id: "whk-2026-11",
      secret: "reg24-ocr-v2-hmac-secret-2026",
    });

    if (options?.seedFixtures !== false) {
      this.seedGoldenFixtures();
    }
  }

  private nextId(prefix: string): string {
    this.seqCounter += 1;
    return `${prefix}.${this.seqCounter}`;
  }

  private errorResponse(
    status: number,
    code: OcrErrorCode,
    message: string,
    retryable = false,
    details: Record<string, unknown> = {},
    headers?: Record<string, string>
  ): HttpServiceResult<never> {
    return {
      status,
      headers,
      body: {
        code,
        message,
        retryable,
        request_id: this.nextId("req"),
        details,
      },
    };
  }

  private recordAudit(
    principal: OcrPrincipalContext,
    documentId: string | null,
    action: string,
    details: Record<string, unknown>
  ): void {
    this.auditEvents.push({
      audit_id: this.nextId("aud"),
      tenant_id: principal.tenant_id,
      workspace_id: principal.workspace_id,
      document_id: documentId,
      action,
      actor_id: principal.principal_id,
      actor_roles: [...principal.roles],
      occurred_at: new Date().toISOString(),
      details,
    });
  }

  public setFeatureFlags(partial: Partial<OcrV2FeatureFlags>): OcrV2FeatureFlags {
    this.flags = { ...this.flags, ...partial };
    return { ...this.flags };
  }

  public getFeatureFlags(): OcrV2FeatureFlags {
    return { ...this.flags };
  }

  public setProviderWorkerAvailability(providerId: string, available: boolean): void {
    this.adapter.setProviderWorkerAvailability(providerId, available);
  }

  // ==========================================================================
  // AUTHORIZATION & IDEMPOTENCY HELPERS
  // ==========================================================================

  private verifyAccess(
    principal: OcrPrincipalContext,
    targetTenantId: string,
    targetWorkspaceId: string,
    privacyClass: PrivacyClass,
    requiredRoles?: OcrHumanRole[],
    requiredScope?: string
  ): HttpServiceResult<never> | null {
    if (principal.revoked) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        `Principal '${principal.principal_id}' access has been revoked`
      );
    }
    if (principal.tenant_id !== targetTenantId || principal.workspace_id !== targetWorkspaceId) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        "Tenant or workspace isolation boundary mismatch"
      );
    }
    // Section 7: Administrators do NOT automatically receive unrestricted access to confidential/restricted content
    if (
      (privacyClass === "confidential" || privacyClass === "restricted") &&
      !principal.confidential_access_granted
    ) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        `Principal lacks explicit clearance for privacy_class='${privacyClass}' (admin role alone does not grant confidential access)`
      );
    }
    if (requiredScope && !principal.scopes.includes(requiredScope)) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        `Missing required service scope '${requiredScope}'`
      );
    }
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some((r) => principal.roles.includes(r));
      if (!hasRole) {
        return this.errorResponse(
          403,
          "ACCESS_DENIED",
          `Principal requires one of roles: ${requiredRoles.join(", ")}`
        );
      }
    }
    return null;
  }

  private checkOrRunIdempotent<T>(params: {
    principal: OcrPrincipalContext;
    route: string;
    idempotencyKey: string | undefined;
    canonicalPayload: unknown;
    execute: () => HttpServiceResult<T>;
  }): HttpServiceResult<T> {
    if (!params.idempotencyKey || params.idempotencyKey.trim().length === 0) {
      return this.errorResponse(
        400,
        "IDEMPOTENCY_CONFLICT",
        "Mutating route requires a non-empty Idempotency-Key header"
      );
    }
    const scopeKey = `${params.principal.principal_id}|${params.principal.tenant_id}|${params.principal.workspace_id}|${params.route}|${params.idempotencyKey}`;
    const reqHash = sha256HexLower(canonicalizeJcsRfc8785(params.canonicalPayload));
    const now = Date.now();
    const existing = this.idempotencyStore.get(scopeKey);

    if (existing && existing.retain_until_ms > now) {
      if (existing.request_hash !== reqHash) {
        return this.errorResponse(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different canonical request payload"
        );
      }
      return {
        status: existing.status,
        headers: existing.headers,
        body: existing.body as T,
      };
    }

    const result = params.execute();
    if (result.status >= 200 && result.status < 300) {
      this.idempotencyStore.set(scopeKey, {
        key: params.idempotencyKey,
        scope_hash: scopeKey,
        request_hash: reqHash,
        status: result.status,
        headers: result.headers,
        body: result.body,
        created_at_ms: now,
        retain_until_ms: now + Math.max(THIRTY_DAYS_MS, SEVEN_DAYS_MS),
      });
    }
    return result;
  }

  private checkIfMatch(
    ifMatchHeader: string | undefined,
    expectedRevisionOrEtag: string | number
  ): HttpServiceResult<never> | null {
    const expectedStr = String(expectedRevisionOrEtag);
    const expectedW = `W/"rev-${expectedStr}"`;
    if (!ifMatchHeader || ifMatchHeader.trim().length === 0) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        `Missing required If-Match precondition (expected ${expectedW} or ${expectedStr})`
      );
    }
    const cleaned = ifMatchHeader.trim();
    if (cleaned !== expectedStr && cleaned !== expectedW && cleaned !== `"${expectedStr}"`) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        `Stale If-Match precondition '${cleaned}'; current revision is ${expectedW}`
      );
    }
    return null;
  }

  // ==========================================================================
  // SHARED `ocr-contract/2.0.0` ENDPOINTS
  // ==========================================================================

  /**
   * `POST /api/v1/documents`
   */
  public registerDocument(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    title_th: string;
    title_en?: string;
    source_category: LegalSourceCategory;
    privacy_class: PrivacyClass;
    expected_sha256: string;
    original_url?: string | null;
    publisher_asserted?: string;
    declared_document_date?: string | null;
    authority_status?: LegalSourceRecord["authority_assessment"]["status"];
    document_id_override?: string;
  }): HttpServiceResult<{
    document_id: string;
    source_id: string;
    source_version_id: string;
    upload_instruction: {
      method: "PUT";
      upload_token_ref: string;
      expires_at: string;
      allowed_mime_types: string[];
      max_bytes: number;
    };
  }> {
    if (!this.flags.ocr_v2_ingestion_enabled) {
      return this.errorResponse(503, "FEATURE_DISABLED", "ocr_v2_ingestion_enabled flag is disabled", true);
    }
    const accessErr = this.verifyAccess(
      params.principal,
      params.principal.tenant_id,
      params.principal.workspace_id,
      params.privacy_class,
      ["uploader", "administrator"],
      "ocr:submit"
    );
    if (accessErr) return accessErr;

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: "POST /api/v1/documents",
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        title_th: params.title_th,
        source_category: params.source_category,
        privacy_class: params.privacy_class,
        expected_sha256: params.expected_sha256.toLowerCase(),
      },
      execute: () => {
        const expectedHex = params.expected_sha256.toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(expectedHex)) {
          return this.errorResponse(
            400,
            "INVALID_FILE",
            "expected_sha256 must be a 64-character lowercase hexadecimal SHA-256 digest"
          );
        }

        const nowIso = new Date().toISOString();
        const docId = params.document_id_override ?? this.nextId("doc.th");
        const sourceId = this.nextId("src.th");
        const sourceVersionId = this.nextId("srcver.th");

        const sourceRecord: LegalSourceRecord = {
          source_id: sourceId,
          tenant_id: params.principal.tenant_id,
          workspace_id: params.principal.workspace_id,
          document_id: docId,
          title_th: params.title_th,
          title_en: params.title_en ?? params.title_th,
          original_url: params.original_url ?? null,
          redirect_history: params.original_url ? [params.original_url] : [],
          retrieval_headers: { "content-type": "application/pdf" },
          publisher_asserted: params.publisher_asserted ?? "Unverified Uploader Assertion",
          publisher_verified:
            params.authority_status === "official_confirmed"
              ? params.publisher_asserted ?? "Verified Official Gazette/Court"
              : null,
          source_category: params.source_category,
          acquisition_method: "direct_upload",
          retrieval_timestamp: nowIso,
          declared_document_date: params.declared_document_date ?? null,
          privacy_class: params.privacy_class,
          retention_policy: "thai_legal_evidence_10y",
          authority_assessment: {
            status: params.authority_status ?? "unconfirmed",
            evidence:
              params.authority_status === "official_confirmed"
                ? "Verified against official registry checksum"
                : "Pending curator authority verification",
            assessor_id:
              params.authority_status === "official_confirmed" ? params.principal.principal_id : null,
            reviewed_at: params.authority_status === "official_confirmed" ? nowIso : null,
          },
          legal_hold: false,
          status: "active",
        };

        const sourceVersion: LegalSourceVersion = {
          source_version_id: sourceVersionId,
          source_id: sourceId,
          document_id: docId,
          tenant_id: params.principal.tenant_id,
          workspace_id: params.principal.workspace_id,
          original_sha256: expectedHex,
          mime_type: "application/pdf",
          byte_length: 0,
          privacy_class: params.privacy_class,
          state: "pending_upload",
          quarantine_reason: null,
          expected_page_count: 0,
          renderer_revision: "pdfium-render-300dpi/2.0.0",
          pages_manifest: [],
          created_at: nowIso,
          finalized_at: null,
        };

        this.sources.set(sourceId, sourceRecord);
        this.sourceVersions.set(sourceVersionId, sourceVersion);
        this.recordAudit(params.principal, docId, "source.registered", {
          source_id: sourceId,
          source_version_id: sourceVersionId,
          privacy_class: params.privacy_class,
        });

        return {
          status: 201,
          body: {
            document_id: docId,
            source_id: sourceId,
            source_version_id: sourceVersionId,
            upload_instruction: {
              method: "PUT",
              upload_token_ref: `upl:${sourceVersionId}`,
              expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              allowed_mime_types: ["application/pdf", "image/png", "image/jpeg", "image/tiff"],
              max_bytes: 104_857_600, // 100 MiB
            },
          },
        };
      },
    });
  }

  /**
   * `POST /api/v1/documents/{id}/sources/{source_version_id}/finalize`
   */
  public finalizeSourceVersion(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    document_id: string;
    source_version_id: string;
    stored_sha256: string;
    actual_mime_type: string;
    byte_length: number;
    encrypted?: boolean;
    corrupt?: boolean;
    malware_detected?: boolean;
    pages_manifest: RenderedPageEvidence[];
  }): HttpServiceResult<LegalSourceVersion> {
    const sv = this.sourceVersions.get(params.source_version_id);
    if (!sv || sv.document_id !== params.document_id) {
      return this.errorResponse(404, "NOT_FOUND", "Source version or document association not found");
    }
    const accessErr = this.verifyAccess(
      params.principal,
      sv.tenant_id,
      sv.workspace_id,
      sv.privacy_class,
      ["uploader", "administrator"],
      "ocr:submit"
    );
    if (accessErr) return accessErr;

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/documents/${params.document_id}/sources/${params.source_version_id}/finalize`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        stored_sha256: params.stored_sha256.toLowerCase(),
        actual_mime_type: params.actual_mime_type,
        byte_length: params.byte_length,
        page_count: params.pages_manifest.length,
      },
      execute: () => {
        if (sv.state === "ready") {
          return { status: 200, body: sv };
        }
        if (params.malware_detected) {
          sv.state = "quarantined";
          sv.quarantine_reason = "MALWARE_SIGNATURE_DETECTED";
          return this.errorResponse(422, "INVALID_FILE", "File quarantined due to malware detection");
        }
        if (params.encrypted || params.corrupt) {
          sv.state = "rejected";
          sv.quarantine_reason = params.encrypted ? "ENCRYPTED_PASSWORD_REQUIRED" : "CORRUPT_CONTAINER";
          return this.errorResponse(
            422,
            "INVALID_FILE",
            params.encrypted
              ? "Encrypted PDF requires approved secret password path before OCR"
              : "Corrupt document container cannot be rendered"
          );
        }
        const allowedMimes = new Set(["application/pdf", "image/png", "image/jpeg", "image/tiff"]);
        if (!allowedMimes.has(params.actual_mime_type)) {
          return this.errorResponse(
            415,
            "INVALID_FILE",
            `Unsupported MIME type '${params.actual_mime_type}'`
          );
        }
        if (params.byte_length <= 0 || params.byte_length > 104_857_600) {
          return this.errorResponse(413, "INVALID_FILE", "File byte_length out of allowed bounds");
        }
        if (params.stored_sha256.toLowerCase() !== sv.original_sha256) {
          return this.errorResponse(
            422,
            "INVALID_FILE",
            "Stored byte SHA-256 does not match declared expected SHA-256"
          );
        }
        const defaultPolicy = this.policies.get(DEFAULT_LEGAL_OCR_POLICY.policy_id)!;
        if (
          params.pages_manifest.length === 0 ||
          params.pages_manifest.length > defaultPolicy.max_pages_per_document
        ) {
          return this.errorResponse(
            422,
            "PAGE_LIMIT",
            `Page count (${params.pages_manifest.length}) violates policy limit (1..${defaultPolicy.max_pages_per_document})`
          );
        }

        sv.mime_type = params.actual_mime_type;
        sv.byte_length = params.byte_length;
        sv.expected_page_count = params.pages_manifest.length;
        sv.pages_manifest = params.pages_manifest.map((p) => ({ ...p }));
        sv.state = "ready";
        sv.finalized_at = new Date().toISOString();

        this.recordAudit(params.principal, sv.document_id, "source.finalized", {
          source_version_id: sv.source_version_id,
          expected_page_count: sv.expected_page_count,
        });

        return { status: 200, body: sv };
      },
    });
  }

  /**
   * `POST /api/v1/ocr/jobs`
   */
  public submitOcrJob(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    document_id: string;
    source_version_id: string;
    policy_id?: string;
    requested_capabilities?: string[];
    purpose?: string;
    routing_override_provider_id?: string;
    parent_job_id?: string | null;
    defer_worker_execution?: boolean; // Used to test queued/running/cancel/fencing races!
    simulation?: SimulatedProviderBehaviorOverride;
  }): HttpServiceResult<OCRJob> {
    if (!this.flags.ocr_v2_ingestion_enabled) {
      return this.errorResponse(503, "FEATURE_DISABLED", "ocr_v2_ingestion_enabled flag is disabled", true);
    }
    const sv = this.sourceVersions.get(params.source_version_id);
    if (!sv || sv.document_id !== params.document_id) {
      return this.errorResponse(404, "NOT_FOUND", "Document or source_version_id not found");
    }
    const accessErr = this.verifyAccess(
      params.principal,
      sv.tenant_id,
      sv.workspace_id,
      sv.privacy_class,
      ["uploader", "reviewer", "administrator"],
      "ocr:submit"
    );
    if (accessErr) return accessErr;

    if (sv.state !== "ready") {
      return this.errorResponse(
        409,
        "SOURCE_NOT_READY",
        `Source version '${sv.source_version_id}' is in state '${sv.state}'; finalize before submitting OCR job`
      );
    }

    const policy = this.policies.get(params.policy_id ?? DEFAULT_LEGAL_OCR_POLICY.policy_id);
    if (!policy) {
      return this.errorResponse(404, "NOT_FOUND", `OCR policy '${params.policy_id}' not found`);
    }

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: "POST /api/v1/ocr/jobs",
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        document_id: params.document_id,
        source_version_id: params.source_version_id,
        policy_id: policy.policy_id,
        purpose: params.purpose ?? policy.purpose,
        routing_override_provider_id: params.routing_override_provider_id ?? null,
        parent_job_id: params.parent_job_id ?? null,
      },
      execute: () => {
        if (sv.expected_page_count > policy.max_pages_per_document) {
          return this.errorResponse(
            422,
            "PAGE_LIMIT",
            `Document page count (${sv.expected_page_count}) exceeds policy max_pages_per_document (${policy.max_pages_per_document})`
          );
        }

        // Pre-validate privacy routing before reserving/dispatching
        const routeCheck = this.adapter.resolveAuthorizedOcrProvider({
          privacy_class: sv.privacy_class,
          policy,
          routing_override_provider_id: params.routing_override_provider_id,
        });
        if (!routeCheck.ok) {
          return this.errorResponse(
            routeCheck.code === "POLICY_BLOCKED" ? 403 : 503,
            routeCheck.code,
            routeCheck.message,
            routeCheck.code === "PROVIDER_UNAVAILABLE"
          );
        }

        // Reserve maximum charge (2 OCR attempts/page + native validation compute)
        const maxPerPageMicros =
          routeCheck.provider.cost_micros_per_page * policy.max_ocr_attempts_per_page + 200;
        const reservedMicros = sv.expected_page_count * maxPerPageMicros;
        const tenantKey = `${sv.tenant_id}:${sv.workspace_id}`;
        const alreadyConsumed = this.tenantConsumedMicros.get(tenantKey) ?? 0;

        if (alreadyConsumed + reservedMicros > policy.tenant_budget_ceiling_micros) {
          return this.errorResponse(
            402,
            "BUDGET_EXCEEDED",
            `Insufficient micro-unit budget: required reservation=${reservedMicros} micro-${policy.currency}, remaining=${
              policy.tenant_budget_ceiling_micros - alreadyConsumed
            }`,
            false
          );
        }

        const nowIso = new Date().toISOString();
        const jobId = this.nextId("job.ocr");
        const job: OCRJob = {
          job_id: jobId,
          parent_job_id: params.parent_job_id ?? null,
          tenant_id: sv.tenant_id,
          workspace_id: sv.workspace_id,
          document_id: sv.document_id,
          source_version_id: sv.source_version_id,
          state: "queued",
          state_revision: 1,
          policy_revision: policy.policy_revision,
          created_at: nowIso,
          updated_at: nowIso,
          extraction_version_id: null,
          progress: {
            expected_pages: sv.expected_page_count,
            completed_pages: 0,
          },
          budget: {
            reservation_id: this.nextId("resv"),
            currency: policy.currency,
            reserved_micros: reservedMicros,
            consumed_micros: 0,
          },
          error: null,
        };

        this.jobs.set(jobId, job);
        this.emitOutboxEvent(job, "ocr.job.updated");

        if (!params.defer_worker_execution) {
          this.runWorkerExtractionSync(jobId, params.routing_override_provider_id, params.simulation);
        }

        return {
          status: 202,
          body: { ...this.jobs.get(jobId)! },
        };
      },
    });
  }

  /**
   * Acquires a fenced worker lease on a `queued` job (`queued -> running`).
   */
  public acquireWorkerLease(jobId: string, workerId = "worker.rag24.thai.01"): {
    ok: boolean;
    fencing_token?: number;
    state_revision?: number;
    reason?: string;
  } {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, reason: "JOB_NOT_FOUND" };
    if (job.state !== "queued") {
      return { ok: false, reason: `INVALID_STATE_${job.state}` };
    }
    this.fencingCounter += 1;
    const token = this.fencingCounter;
    job.state = "running";
    job.state_revision += 1;
    job.updated_at = new Date().toISOString();

    this.workerLeases.set(jobId, {
      job_id: jobId,
      fencing_token: token,
      worker_id: workerId,
      leased_at_ms: Date.now(),
      expires_at_ms: Date.now() + 60_000,
      active: true,
    });
    this.emitOutboxEvent(job, "ocr.job.updated");
    return { ok: true, fencing_token: token, state_revision: job.state_revision };
  }

  /**
   * Completes a worker attempt using fencing token validation.
   * Scenario 11: Late output from a cancelled or expired lease is REJECTED for selection/publication,
   * while diagnostic evidence and incurred provider cost remain traceable!
   */
  public completeWorkerWithFencing(params: {
    job_id: string;
    fencing_token: number;
    routing_override_provider_id?: string;
    simulation?: SimulatedProviderBehaviorOverride;
    incurred_micros_override?: number;
  }): {
    accepted: boolean;
    rejected_by_fencing?: boolean;
    job: OCRJob;
    manifest?: ExtractionManifest;
  } {
    const job = this.jobs.get(params.job_id);
    if (!job) {
      throw new Error(`Job ${params.job_id} not found`);
    }
    const lease = this.workerLeases.get(params.job_id);
    const sv = this.sourceVersions.get(job.source_version_id)!;
    const policy =
      Array.from(this.policies.values()).find((p) => p.policy_revision === job.policy_revision) ??
      this.policies.get(DEFAULT_LEGAL_OCR_POLICY.policy_id)!;

    // Fencing check: reject if job is already terminal (e.g., `cancelled`) or fencing token stale/expired
    if (
      !lease ||
      !lease.active ||
      lease.fencing_token !== params.fencing_token ||
      job.state !== "running"
    ) {
      const lateMicros = params.incurred_micros_override ?? sv.expected_page_count * 3800;
      job.budget.consumed_micros += lateMicros;
      this.diagnosticLateOutputs.push({
        job_id: job.job_id,
        fencing_token: params.fencing_token,
        rejected_reason: `FENCING_REJECTED_IN_STATE_${job.state}`,
        incurred_micros: lateMicros,
        recorded_at: new Date().toISOString(),
      });
      return {
        accepted: false,
        rejected_by_fencing: true,
        job: { ...job },
      };
    }

    lease.active = false;
    const execResult = this.adapter.executeDocumentExtraction({
      document_id: job.document_id,
      job_id: job.job_id,
      privacy_class: sv.privacy_class,
      policy,
      pages_manifest: sv.pages_manifest,
      routing_override_provider_id: params.routing_override_provider_id,
      simulation: params.simulation,
    });

    const tenantKey = `${job.tenant_id}:${job.workspace_id}`;
    job.budget.consumed_micros += execResult.consumed_micros;
    this.tenantConsumedMicros.set(
      tenantKey,
      (this.tenantConsumedMicros.get(tenantKey) ?? 0) + execResult.consumed_micros
    );

    if (!execResult.ok) {
      job.state = "failed";
      job.state_revision += 1;
      job.updated_at = new Date().toISOString();
      job.error = {
        code: execResult.code,
        retryable: execResult.code === "PROVIDER_UNAVAILABLE",
        message: execResult.message,
      };
      this.emitOutboxEvent(job, "ocr.job.updated");
      return { accepted: true, job: { ...job } };
    }

    const extractionVersionId = this.nextId("extver.th");
    const semantic = extractThaiLegalAnnotationsV2({
      tenant_id: job.tenant_id,
      workspace_id: job.workspace_id,
      document_id: job.document_id,
      extraction_version_id: extractionVersionId,
      pages: execResult.pages.map((p) => ({
        page_number: p.page_number,
        raw_text: p.raw_text,
        image_sha256: p.image_sha256,
      })),
    });

    const allIssues = [...execResult.issues, ...semantic.issues];
    const extractedOrBlankPages = execResult.pages.filter(
      (p) => p.state === "extracted" || p.state === "verified_blank"
    );
    const hasUnresolvedPages = extractedOrBlankPages.length < sv.expected_page_count;
    const hasOpenBlocking = allIssues.some(
      (iss) => iss.severity === "blocking" && iss.resolution === "open"
    );

    const completeness: ExtractionManifest["completeness"] = hasUnresolvedPages
      ? "incomplete"
      : "complete";
    const quality: ExtractionManifest["quality"] =
      hasUnresolvedPages || hasOpenBlocking ? "review_required" : "passed";

    const sourceRecord = this.sources.get(sv.source_id)!;
    const createdAt = new Date().toISOString();

    const manifestDraft: Omit<ExtractionManifest, "content_digest"> = {
      contract_version: "2.0.0",
      tenant_id: job.tenant_id,
      workspace_id: job.workspace_id,
      document_id: job.document_id,
      source_version_id: sv.source_version_id,
      extraction_version_id: extractionVersionId,
      job_id: job.job_id,
      original_sha256: sv.original_sha256,
      source_metadata_ref: `srcmeta:${sourceRecord.source_id}`,
      expected_page_count: sv.expected_page_count,
      returned_page_count: extractedOrBlankPages.length,
      digest_ruleset: "ocr-digest/1",
      privacy_class: sv.privacy_class,
      policy_revision: job.policy_revision,
      created_at: createdAt,
      completeness,
      quality,
      pages_ref: `pages:${extractionVersionId}`,
      issues: allIssues,
      predecessor_extraction_version_id: null,
    };

    const contentDigest = computeOcrDigestV1(manifestDraft, execResult.pages);
    const manifest: ExtractionManifest = {
      ...manifestDraft,
      content_digest: contentDigest,
    };

    this.manifests.set(extractionVersionId, manifest);
    this.extractionPages.set(extractionVersionId, execResult.pages);
    this.annotationsByVersion.set(semantic.annotation_version, semantic.annotations);

    // Job terminal state rules (Section: Job lifecycle):
    // `succeeded` requires EVERY expected page accounted for, `completeness=complete`, `quality=passed`, and NO open blocking issue!
    job.extraction_version_id = extractionVersionId;
    job.progress.completed_pages = extractedOrBlankPages.length;
    job.state_revision += 1;
    job.updated_at = createdAt;

    if (completeness === "complete" && quality === "passed" && !hasOpenBlocking) {
      job.state = "succeeded";
      job.error = null;
    } else {
      job.state = "review_required";
      job.error = {
        code: hasUnresolvedPages ? "INCOMPLETE_OUTPUT" : "QUALITY_REVIEW_REQUIRED",
        retryable: hasUnresolvedPages,
        message: hasUnresolvedPages
          ? `Incomplete provider output: ${extractedOrBlankPages.length}/${sv.expected_page_count} pages accounted for; missing pages marked unresolved`
          : `Extraction holds ${allIssues.filter((i) => i.severity === "blocking").length} blocking legal/transcription issue(s) requiring human adjudication`,
      };
    }

    // Create initial `LegalDocumentVersion` with 4 orthogonal states
    const hasUnresolvedRefs = semantic.annotations.some(
      (a) => a.resolution_status === "unresolved_candidate"
    );
    const hasConflictRefs = semantic.annotations.some((a) => a.resolution_status === "conflict");
    const prevDocVerId = this.latestDocVersionByDocId.get(job.document_id);
    const prevDocVer = prevDocVerId ? this.documentVersions.get(prevDocVerId) : undefined;

    const docVersionId = this.nextId("docver.th");
    const docVer: LegalDocumentVersion = {
      version_id: docVersionId,
      tenant_id: job.tenant_id,
      workspace_id: job.workspace_id,
      document_id: job.document_id,
      source_id: sv.source_id,
      source_version_id: sv.source_version_id,
      extraction_version_id: extractionVersionId,
      annotation_version: semantic.annotation_version,
      normalization_ruleset: THAI_NORMALIZATION_RULESET_V2,
      workflow_revision: 1,
      transcription_status: job.state === "succeeded" ? "unreviewed" : "review_required",
      reference_status: hasConflictRefs
        ? "conflict"
        : hasUnresolvedRefs
        ? "candidate"
        : semantic.annotations.length > 0
        ? "resolved"
        : "unchecked",
      applicability_status: "not_assessed",
      publication_status: "draft",
      applicability_metadata: {
        scope: null,
        relevant_effective_from: null,
        relevant_effective_to: null,
        jurisdiction: "TH",
        evidence: null,
        curator_id: null,
        curated_at: null,
      },
      active_publication_id: prevDocVer?.active_publication_id ?? null,
      migration_audit_tag: null,
      has_resolved_material_issues: false,
      last_critical_corrector_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    };

    this.documentVersions.set(docVersionId, docVer);
    this.latestDocVersionByDocId.set(job.document_id, docVersionId);

    // Transactional outbox emission (`ocr.extraction.ready` vs `ocr.review.required`)
    this.emitOutboxEvent(job, "ocr.job.updated");
    if (job.state === "succeeded") {
      this.emitOutboxEvent(job, "ocr.extraction.ready");
    } else {
      this.emitOutboxEvent(job, "ocr.review.required");
    }

    return {
      accepted: true,
      job: { ...job },
      manifest,
    };
  }

  private runWorkerExtractionSync(
    jobId: string,
    routingOverrideProviderId?: string,
    simulation?: SimulatedProviderBehaviorOverride
  ): void {
    const lease = this.acquireWorkerLease(jobId);
    if (lease.ok && lease.fencing_token !== undefined) {
      this.completeWorkerWithFencing({
        job_id: jobId,
        fencing_token: lease.fencing_token,
        routing_override_provider_id: routingOverrideProviderId,
        simulation,
      });
    }
  }

  /**
   * `GET /api/v1/ocr/jobs/{job_id}`
   */
  public getOcrJob(params: {
    principal: OcrPrincipalContext;
    job_id: string;
  }): HttpServiceResult<OCRJob & { diagnostic_late_outputs?: unknown[] }> {
    const job = this.jobs.get(params.job_id);
    if (!job) return this.errorResponse(404, "NOT_FOUND", `Job '${params.job_id}' not found`);
    const sv = this.sourceVersions.get(job.source_version_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      job.tenant_id,
      job.workspace_id,
      sv.privacy_class,
      undefined,
      "ocr:read"
    );
    if (accessErr) return accessErr;

    const late = this.diagnosticLateOutputs.filter((d) => d.job_id === job.job_id);
    return {
      status: 200,
      body: late.length > 0 ? { ...job, diagnostic_late_outputs: late } : { ...job },
    };
  }

  public listOcrJobs(principal: OcrPrincipalContext): OCRJob[] {
    return Array.from(this.jobs.values()).filter(
      (j) => j.tenant_id === principal.tenant_id && j.workspace_id === principal.workspace_id
    );
  }

  /**
   * `POST /api/v1/ocr/jobs/{job_id}/cancel`
   */
  public cancelOcrJob(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    job_id: string;
  }): HttpServiceResult<OCRJob> {
    const job = this.jobs.get(params.job_id);
    if (!job) return this.errorResponse(404, "NOT_FOUND", `Job '${params.job_id}' not found`);
    const sv = this.sourceVersions.get(job.source_version_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      job.tenant_id,
      job.workspace_id,
      sv.privacy_class,
      ["uploader", "reviewer", "administrator"],
      "ocr:cancel"
    );
    if (accessErr) return accessErr;

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/ocr/jobs/${params.job_id}/cancel`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: { job_id: params.job_id },
      execute: () => {
        // Cancellation race: if already terminal (e.g. `succeeded`), return terminal state without deleting evidence
        if (isTerminalJobState(job.state)) {
          return { status: 200, body: { ...job } };
        }
        job.state = "cancelled";
        job.state_revision += 1;
        job.updated_at = new Date().toISOString();
        const lease = this.workerLeases.get(job.job_id);
        if (lease) {
          lease.active = false;
        }
        this.emitOutboxEvent(job, "ocr.job.updated");
        this.recordAudit(params.principal, job.document_id, "ocr.job.cancelled", {
          job_id: job.job_id,
          consumed_micros: job.budget.consumed_micros,
        });
        return { status: 200, body: { ...job } };
      },
    });
  }

  /**
   * `POST /api/v1/ocr/jobs/{job_id}/retry`
   * Creates a child job with `parent_job_id` and its own reservation; NEVER resets a terminal job!
   */
  public retryOcrJob(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    job_id: string;
    retry_scope?: "failed_or_unresolved_pages" | "full_document";
    simulation?: SimulatedProviderBehaviorOverride;
  }): HttpServiceResult<OCRJob> {
    const parentJob = this.jobs.get(params.job_id);
    if (!parentJob) {
      return this.errorResponse(404, "NOT_FOUND", `Parent job '${params.job_id}' not found`);
    }
    if (!isTerminalJobState(parentJob.state)) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        `Cannot create retry child job while parent job '${parentJob.job_id}' is still '${parentJob.state}'`
      );
    }
    return this.submitOcrJob({
      principal: params.principal,
      idempotency_key: params.idempotency_key,
      document_id: parentJob.document_id,
      source_version_id: parentJob.source_version_id,
      parent_job_id: parentJob.job_id,
      purpose: `retry:${params.retry_scope ?? "failed_or_unresolved_pages"}`,
      simulation: params.simulation,
    });
  }

  /**
   * `GET /api/v1/documents/{id}/extraction` — Compatibility route requiring `extraction_version_id`!
   */
  public getExtractionCompatibility(params: {
    principal: OcrPrincipalContext;
    document_id: string;
    extraction_version_id?: string | null;
  }): HttpServiceResult<ExtractionManifest> {
    if (!params.extraction_version_id || params.extraction_version_id.trim().length === 0) {
      return this.errorResponse(
        400,
        "VERSION_REQUIRED",
        "extraction_version_id query parameter is mandatory; ambiguous 'latest' extraction retrieval is prohibited"
      );
    }
    return this.getExtractionManifest({
      principal: params.principal,
      document_id: params.document_id,
      extraction_version_id: params.extraction_version_id,
    });
  }

  /**
   * `GET /api/v1/documents/{id}/extractions/{extraction_version_id}`
   */
  public getExtractionManifest(params: {
    principal: OcrPrincipalContext;
    document_id: string;
    extraction_version_id: string;
  }): HttpServiceResult<ExtractionManifest> {
    const manifest = this.manifests.get(params.extraction_version_id);
    if (!manifest || manifest.document_id !== params.document_id) {
      return this.errorResponse(
        404,
        "NOT_FOUND",
        `Extraction '${params.extraction_version_id}' not found for document '${params.document_id}'`
      );
    }
    const accessErr = this.verifyAccess(
      params.principal,
      manifest.tenant_id,
      manifest.workspace_id,
      manifest.privacy_class,
      ["uploader", "reviewer", "legal_editor", "publisher", "administrator", "reader"],
      "ocr:read"
    );
    if (accessErr) return accessErr;

    // Diagnostic incomplete/review_required manifests are restricted to operators & reviewers (Section 7)
    if (
      manifest.quality !== "passed" &&
      !params.principal.roles.some((r) =>
        ["uploader", "reviewer", "legal_editor", "publisher", "administrator"].includes(r)
      )
    ) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        "Diagnostic unapproved extraction is accessible only to authorized operators and reviewers"
      );
    }

    return { status: 200, body: manifest };
  }

  /**
   * `GET /api/v1/documents/{id}/extractions/{extraction_version_id}/pages`
   */
  public getExtractionPages(params: {
    principal: OcrPrincipalContext;
    document_id: string;
    extraction_version_id: string;
    cursor?: string | null;
    limit?: number;
  }): HttpServiceResult<{
    extraction_version_id: string;
    content_digest: string;
    pages: OCRPage[];
    next_cursor: string | null;
    total_returned_pages: number;
  }> {
    const manifestRes = this.getExtractionManifest({
      principal: params.principal,
      document_id: params.document_id,
      extraction_version_id: params.extraction_version_id,
    });
    if (manifestRes.status !== 200) {
      return manifestRes as HttpServiceResult<never>;
    }
    const manifest = manifestRes.body as ExtractionManifest;
    const allPages = [...(this.extractionPages.get(params.extraction_version_id) ?? [])].sort(
      (a, b) => a.page_number - b.page_number
    );

    const boundedLimit = Math.max(1, Math.min(params.limit ?? 10, 50));
    const startIdx = params.cursor ? Math.max(0, parseInt(params.cursor, 10) || 0) : 0;
    const slice = allPages.slice(startIdx, startIdx + boundedLimit);
    const nextCursor = startIdx + boundedLimit < allPages.length ? String(startIdx + boundedLimit) : null;

    return {
      status: 200,
      body: {
        extraction_version_id: manifest.extraction_version_id,
        content_digest: manifest.content_digest,
        pages: slice,
        next_cursor: nextCursor,
        total_returned_pages: allPages.length,
      },
    };
  }

  /**
   * `GET /api/v1/ocr/providers` — Policy-filtered, zero secrets!
   */
  public listProviders(params: {
    principal: OcrPrincipalContext;
    policy_id?: string;
    privacy_class?: PrivacyClass;
  }): HttpServiceResult<{
    policy_id: string;
    policy_revision: string;
    continuity_adapter_active: boolean;
    providers: OcrProviderDescriptor[];
  }> {
    const policy = this.policies.get(params.policy_id ?? DEFAULT_LEGAL_OCR_POLICY.policy_id);
    if (!policy) return this.errorResponse(404, "NOT_FOUND", "Policy not found");
    return {
      status: 200,
      body: {
        policy_id: policy.policy_id,
        policy_revision: policy.policy_revision,
        continuity_adapter_active: process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER !== "true",
        providers: this.adapter.listProvidersForPolicy(policy, params.privacy_class),
      },
    };
  }

  /**
   * `PUT /api/v1/ocr/policies/{policy_id}` (`If-Match` precondition; existing jobs retain recorded policy_revision)
   */
  public updatePolicy(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    policy_id: string;
    updates: Partial<
      Pick<
        OcrRoutingPolicy,
        | "max_pages_per_document"
        | "max_ocr_attempts_per_page"
        | "tenant_budget_ceiling_micros"
        | "preferred_thai_ocr_provider"
        | "allowed_providers_by_privacy"
      >
    >;
  }): HttpServiceResult<OcrRoutingPolicy> {
    const accessErr = this.verifyAccess(
      params.principal,
      params.principal.tenant_id,
      params.principal.workspace_id,
      "public",
      ["administrator"],
      "ocr:policy:write"
    );
    if (accessErr) return accessErr;

    const current = this.policies.get(params.policy_id);
    if (!current) return this.errorResponse(404, "NOT_FOUND", `Policy '${params.policy_id}' not found`);

    if (!params.if_match || params.if_match.trim() !== current.etag) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        `Policy If-Match mismatch: expected ${current.etag}, got ${params.if_match ?? "absent"}`
      );
    }

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `PUT /api/v1/ocr/policies/${params.policy_id}`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: params.updates,
      execute: () => {
        const nextRevNum = (parseInt(current.etag.replace(/\D+/g, ""), 10) || 1) + 1;
        const updated: OcrRoutingPolicy = {
          ...current,
          ...params.updates,
          policy_revision: `polrev.2026-11-14.v${nextRevNum}`,
          etag: `W/"polrev-${nextRevNum}"`,
          updated_at: new Date().toISOString(),
          updated_by: params.principal.principal_id,
        };
        this.policies.set(params.policy_id, updated);
        this.recordAudit(params.principal, null, "ocr.policy.updated", {
          policy_id: updated.policy_id,
          policy_revision: updated.policy_revision,
        });
        return {
          status: 200,
          headers: { ETag: updated.etag },
          body: updated,
        };
      },
    });
  }

  // ==========================================================================
  // OUTBOX, CONSUMER INBOX, WEBHOOKS & RECONCILIATION (SECTION: JOB LIFECYCLE)
  // ==========================================================================

  private emitOutboxEvent(
    job: OCRJob,
    eventType: OutboxEvent["event_type"]
  ): OutboxEvent {
    const ev: OutboxEvent = {
      event_id: this.nextId("ev.ocr"),
      event_type: eventType,
      schema_version: "2.0.0",
      tenant_id: job.tenant_id,
      workspace_id: job.workspace_id,
      job_id: job.job_id,
      state_revision: job.state_revision,
      occurred_at: new Date().toISOString(),
      extraction_version_id: job.extraction_version_id,
      trace_id: this.nextId("trc"),
      dispatched: false,
      delivery_attempts: 0,
      last_delivery_error: null,
    };
    this.outbox.set(ev.event_id, ev);
    return ev;
  }

  public buildSignedWebhookDelivery(eventId: string, targetId = "wh.reg24.internal"): {
    event: OutboxEvent;
    rawBody: string;
    signatureHeader: string;
    timestampSec: number;
  } {
    const ev = this.outbox.get(eventId);
    if (!ev) throw new Error(`Outbox event ${eventId} not found`);
    const target = this.allowlistedWebhookTargets.get(targetId);
    if (!target) throw new Error(`Webhook destination ${targetId} is not allowlisted (SSRF guard)`);

    const rawBody = canonicalizeJcsRfc8785(ev);
    const timestampSec = Math.floor(Date.now() / 1000);
    const signed = signWebhookPayloadHmacSha256({
      secret: target.secret,
      keyId: target.key_id,
      timestampSec,
      eventId: ev.event_id,
      rawBodyBytes: rawBody,
    });
    return {
      event: ev,
      rawBody,
      signatureHeader: signed.signatureHeader,
      timestampSec,
    };
  }

  /**
   * Processes an inbound signed webhook or polled outbox event into REG24's consumer inbox.
   * Scenario 5: Repeated webhook + worker crash after outbox commit -> idempotent inbox ensures
   * ONE downstream candidate record exists and zero duplicate billing occurs!
   */
  public receiveWebhookCallback(params: {
    target_id?: string;
    signature_header: string;
    raw_body: string;
    now_epoch_sec?: number;
  }): { accepted: boolean; duplicate_ignored?: boolean; staging_op_id?: string; reason?: string } {
    const target = this.allowlistedWebhookTargets.get(params.target_id ?? "wh.reg24.internal");
    if (!target) return { accepted: false, reason: "DESTINATION_NOT_ALLOWLISTED" };

    const parsed = JSON.parse(params.raw_body) as OutboxEvent;
    const verified = verifyWebhookPayloadHmacSha256({
      signatureHeader: params.signature_header,
      secretsByKeyId: { [target.key_id]: target.secret },
      eventId: parsed.event_id,
      rawBodyBytes: params.raw_body,
      nowEpochSec: params.now_epoch_sec,
    });
    if (!verified.valid) {
      return { accepted: false, reason: verified.reason };
    }

    return this.processConsumerInboxEvent(parsed);
  }

  public processConsumerInboxEvent(ev: OutboxEvent): {
    accepted: boolean;
    duplicate_ignored: boolean;
    staging_op_id: string;
  } {
    const existingByEvent = this.consumerInboxProcessed.get(ev.event_id);
    if (existingByEvent) {
      return {
        accepted: true,
        duplicate_ignored: true,
        staging_op_id: existingByEvent.staging_op_id,
      };
    }

    const outboxRecord = this.outbox.get(ev.event_id);
    if (outboxRecord) {
      outboxRecord.dispatched = true;
      outboxRecord.delivery_attempts += 1;
    }

    // Only extraction-terminal events (`ocr.extraction.ready` / `ocr.review.required`) trigger a downstream candidate staging operation
    if (ev.event_type === "ocr.job.updated" || !ev.extraction_version_id) {
      return {
        accepted: true,
        duplicate_ignored: false,
        staging_op_id: `telemetry_only:${ev.job_id}:${ev.state_revision}`,
      };
    }

    // Deduplicate by `(job_id, extraction_version_id)` and ignore older state_revision
    for (const entry of this.consumerInboxProcessed.values()) {
      if (entry.job_id === ev.job_id && entry.state_revision >= ev.state_revision) {
        this.consumerInboxProcessed.set(ev.event_id, entry);
        return {
          accepted: true,
          duplicate_ignored: true,
          staging_op_id: entry.staging_op_id,
        };
      }
    }

    const stagingOpId = `ink.${ev.job_id}.${ev.extraction_version_id}`;
    this.consumerInboxProcessed.set(ev.event_id, {
      event_id: ev.event_id,
      job_id: ev.job_id,
      state_revision: ev.state_revision,
      staging_op_id: stagingOpId,
    });

    return {
      accepted: true,
      duplicate_ignored: false,
      staging_op_id: stagingOpId,
    };
  }

  public runOutboxReconciliation(): {
    reconciled_events: number;
    unique_downstream_operations: number;
  } {
    let reconciled = 0;
    for (const ev of this.outbox.values()) {
      if (!ev.dispatched) {
        this.processConsumerInboxEvent(ev);
        ev.dispatched = true;
        reconciled += 1;
      }
    }
    const uniqueOps = new Set(
      Array.from(this.consumerInboxProcessed.values()).map((x) => x.staging_op_id)
    );
    return {
      reconciled_events: reconciled,
      unique_downstream_operations: uniqueOps.size,
    };
  }

  // ==========================================================================
  // REG24 LEGAL DOMAIN MUTATIONS (`REG-004` & `REG-005` / SECTIONS 7 & 8)
  // ==========================================================================

  public getLegalDocumentState(params: {
    principal: OcrPrincipalContext;
    document_id: string;
  }): HttpServiceResult<{
    document_id: string;
    source: LegalSourceRecord;
    current_version: LegalDocumentVersion;
    manifest: ExtractionManifest;
    annotations: LegalAnnotation[];
    corrections: LegalCorrectionRecord[];
    review_decisions: LegalReviewDecisionRecord[];
    approvals: LegalApprovalRecord[];
    active_publication: LegalPublicationManifest | null;
    publication_history: LegalPublicationManifest[];
    audit_trail: LegalAuditEvent[];
  }> {
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) {
      return this.errorResponse(404, "NOT_FOUND", `Legal document '${params.document_id}' not found in OCR v2 registry`);
    }
    const src = this.sources.get(docVer.source_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class
    );
    if (accessErr) return accessErr;

    const manifest = this.manifests.get(docVer.extraction_version_id)!;
    const annotations = this.annotationsByVersion.get(docVer.annotation_version) ?? [];
    const corrections = Array.from(this.corrections.values()).filter(
      (c) => c.document_id === params.document_id
    );
    const decisions = Array.from(this.reviewDecisions.values()).filter(
      (d) => d.document_id === params.document_id
    );
    const approvals = Array.from(this.approvals.values()).filter(
      (a) => a.document_id === params.document_id
    );
    const pubKey = `${docVer.tenant_id}:${docVer.workspace_id}:${params.document_id}`;
    const activePubId = this.activePublicationPointer.get(pubKey);
    const activePub = activePubId ? this.publications.get(activePubId) ?? null : null;
    const pubHistory = Array.from(this.publications.values()).filter(
      (p) => p.document_id === params.document_id
    );
    const audits = this.auditEvents.filter((a) => a.document_id === params.document_id);

    return {
      status: 200,
      headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
      body: {
        document_id: params.document_id,
        source: { ...src },
        current_version: { ...docVer, applicability_metadata: { ...docVer.applicability_metadata } },
        manifest: { ...manifest, issues: manifest.issues.map((i) => ({ ...i })) },
        annotations: annotations.map((a) => ({ ...a })),
        corrections,
        review_decisions: decisions,
        approvals: approvals.map((a) => ({ ...a })),
        active_publication: activePub ? { ...activePub } : null,
        publication_history: pubHistory.map((p) => ({ ...p })),
        audit_trail: audits,
      },
    };
  }

  /**
   * `POST /api/v1/legal/documents/{id}/corrections`
   * Verifies `before_text` against exact `SourceSpan` code-point offsets, preserves raw predecessor extraction,
   * creates successor immutable `extraction_version_id` (`provider_id='human'`), revalidates annotations,
   * invalidates stale approvals, and marks critical-token changes for two-person dual control!
   */
  public submitCorrection(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    document_id: string;
    extraction_version_id: string;
    source_spans: SourceSpan[];
    before_text: string;
    after_text: string;
    issue_ids: string[];
    reason: string;
  }): HttpServiceResult<{
    correction: LegalCorrectionRecord;
    successor_extraction_version_id: string;
    updated_document_version: LegalDocumentVersion;
  }> {
    if (!this.flags.ocr_v2_review_enabled) {
      return this.errorResponse(503, "FEATURE_DISABLED", "ocr_v2_review_enabled flag is disabled", true);
    }
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) return this.errorResponse(404, "NOT_FOUND", "Document version not found");

    const src = this.sources.get(docVer.source_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class,
      ["reviewer", "legal_editor"]
    );
    if (accessErr) return accessErr;

    if (params.principal.is_service_account) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        "Service accounts cannot submit human legal review corrections"
      );
    }

    const ifMatchErr = this.checkIfMatch(params.if_match, docVer.workflow_revision);
    if (ifMatchErr) return ifMatchErr;

    if (docVer.extraction_version_id !== params.extraction_version_id) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        `Stale extraction_version_id '${params.extraction_version_id}'; current version references '${docVer.extraction_version_id}'. Rebase or reload before submitting.`
      );
    }

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/legal/documents/${params.document_id}/corrections`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        extraction_version_id: params.extraction_version_id,
        source_spans: params.source_spans,
        before_text: params.before_text,
        after_text: params.after_text,
        issue_ids: params.issue_ids,
        reason: params.reason,
      },
      execute: () => {
        if (params.source_spans.length === 0) {
          return this.errorResponse(400, "VERSION_CONFLICT", "At least one SourceSpan is required");
        }
        const primarySpan = params.source_spans[0];
        const basePages = this.extractionPages.get(params.extraction_version_id);
        const baseManifest = this.manifests.get(params.extraction_version_id);
        if (!basePages || !baseManifest) {
          return this.errorResponse(404, "NOT_FOUND", "Base extraction pages not found");
        }

        const targetPage = basePages.find((p) => p.page_number === primarySpan.page_number);
        if (
          !targetPage ||
          primarySpan.raw_start === null ||
          primarySpan.raw_end === null
        ) {
          return this.errorResponse(
            400,
            "VERSION_CONFLICT",
            "Target page or code-point raw_start/raw_end missing on correction SourceSpan"
          );
        }

        const actualSlice = sliceByCodePoints(
          targetPage.raw_text,
          primarySpan.raw_start,
          primarySpan.raw_end
        );
        if (actualSlice !== params.before_text) {
          return this.errorResponse(
            409,
            "VERSION_CONFLICT",
            `SourceSpan before_text mismatch at page ${primarySpan.page_number} [${primarySpan.raw_start}, ${primarySpan.raw_end}): expected '${params.before_text}', actual '${actualSlice}'`
          );
        }

        // Build successor page text without mutating predecessor `basePages`!
        const rawCps = Array.from(targetPage.raw_text);
        const newPageRawText = [
          ...rawCps.slice(0, primarySpan.raw_start),
          ...Array.from(params.after_text),
          ...rawCps.slice(primarySpan.raw_end),
        ].join("");

        const successorExtId = this.nextId("extver.th.human");
        const nowIso = new Date().toISOString();
        const issueSet = new Set(params.issue_ids);

        const successorPages: OCRPage[] = basePages.map((pg) => {
          if (pg.page_number !== targetPage.page_number) {
            return { ...pg, blocks: [...pg.blocks], tables: [...pg.tables], issue_ids: [...pg.issue_ids] };
          }
          const norm = normalizeThaiLegalTextV2(
            newPageRawText,
            `norm.${successorExtId}.p${pg.page_number}`
          );
          const blocks = segmentStructuredBlocksFromRawText(
            pg.page_number,
            newPageRawText,
            pg.image_sha256,
            pg.blocks.some((b) => b.span.polygon !== null)
          );
          return {
            ...pg,
            raw_text: newPageRawText,
            markdown: newPageRawText,
            normalized_text: norm.normalized_text,
            normalization: {
              ruleset: norm.ruleset,
              mapping_ref: norm.mapping_ref,
            },
            blocks,
            provenance: {
              method: "human",
              attempt_id: `corr.${successorExtId}`,
              provider_id: "human",
              model_revision: "workflow-2.0.0",
              adapter_version: "reg24-correction-lineage/2.0.0",
              raw_response_ref: `pred:${baseManifest.extraction_version_id}`,
            },
          };
        });

        // Re-run deterministic Thai semantic validation on successor extraction (revalidates dependent relations!)
        const nextAnnVersion = this.nextId("annver.th");
        const revalidated = extractThaiLegalAnnotationsV2({
          tenant_id: docVer.tenant_id,
          workspace_id: docVer.workspace_id,
          document_id: docVer.document_id,
          extraction_version_id: successorExtId,
          annotation_version: nextAnnVersion,
          pages: successorPages.map((p) => ({
            page_number: p.page_number,
            raw_text: p.raw_text,
            image_sha256: p.image_sha256,
          })),
        });

        // Carry forward non-corrected issues + mark corrected issues as `corrected`
        const carriedIssues = baseManifest.issues
          .filter(
            (iss) =>
              issueSet.has(iss.issue_id) ||
              // Keep page/provider structural issues that weren't recomputed by semantic pass
              iss.code.startsWith("UNRESOLVED_") ||
              iss.code.startsWith("UNCERTAIN_TABLE_") ||
              iss.code.startsWith("NATIVE_")
          )
          .map((iss) =>
            issueSet.has(iss.issue_id)
              ? { ...iss, resolution: "corrected" as const }
              : { ...iss }
          );

        const mergedIssues = [...carriedIssues, ...revalidated.issues];
        const openBlocking = mergedIssues.some(
          (i) => i.severity === "blocking" && i.resolution === "open"
        );

        const successorDraft: Omit<ExtractionManifest, "content_digest"> = {
          ...baseManifest,
          extraction_version_id: successorExtId,
          created_at: nowIso,
          quality: openBlocking ? "review_required" : "passed",
          pages_ref: `pages:${successorExtId}`,
          issues: mergedIssues,
          predecessor_extraction_version_id: baseManifest.extraction_version_id,
        };
        const successorManifest: ExtractionManifest = {
          ...successorDraft,
          content_digest: computeOcrDigestV1(successorDraft, successorPages),
        };

        this.manifests.set(successorExtId, successorManifest);
        this.extractionPages.set(successorExtId, successorPages);
        this.annotationsByVersion.set(nextAnnVersion, revalidated.annotations);

        // Detect critical legal token edits (numerals, case IDs, sections, dates, negations)
        const criticalTokenRe =
          /[0-9๐-๙]|มาตรา|ฎีกา|พ\.ศ\.|มิให้|ห้ามมิให้|เว้นแต่|ไม่|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม/;
        const isCritical =
          criticalTokenRe.test(params.before_text) || criticalTokenRe.test(params.after_text);

        const prevAnns = this.annotationsByVersion.get(docVer.annotation_version) ?? [];
        const invalidatedIds = isCritical ? prevAnns.map((a) => a.annotation_id) : [];

        const corrRecord: LegalCorrectionRecord = {
          correction_id: this.nextId("corr.th"),
          tenant_id: docVer.tenant_id,
          workspace_id: docVer.workspace_id,
          document_id: docVer.document_id,
          base_extraction_version_id: baseManifest.extraction_version_id,
          successor_extraction_version_id: successorExtId,
          source_spans: params.source_spans,
          before_text: params.before_text,
          after_text: params.after_text,
          is_critical_token_change: isCritical,
          issue_ids: params.issue_ids,
          invalidated_annotation_ids: invalidatedIds,
          reason: params.reason,
          reviewer_principal_snapshot: {
            principal_id: params.principal.principal_id,
            roles: [...params.principal.roles],
          },
          created_at: nowIso,
        };
        this.corrections.set(corrRecord.correction_id, corrRecord);

        // Invalidate any prior approvals bound to predecessor extraction/annotation version!
        for (const app of this.approvals.values()) {
          if (app.document_id === docVer.document_id && app.status === "active") {
            app.status = "invalidated_by_edit";
          }
        }

        const hasConflictRefs = revalidated.annotations.some((a) => a.resolution_status === "conflict");
        const hasUnresolvedRefs = revalidated.annotations.some(
          (a) => a.resolution_status === "unresolved_candidate"
        );

        docVer.extraction_version_id = successorExtId;
        docVer.annotation_version = nextAnnVersion;
        docVer.workflow_revision += 1;
        docVer.updated_at = nowIso;
        docVer.transcription_status = openBlocking ? "review_required" : "ocr_verified";
        docVer.reference_status = hasConflictRefs
          ? "conflict"
          : hasUnresolvedRefs
          ? "candidate"
          : "resolved";
        if (isCritical || params.issue_ids.length > 0) {
          docVer.has_resolved_material_issues = true;
          docVer.last_critical_corrector_id = params.principal.principal_id;
        }

        this.recordAudit(params.principal, docVer.document_id, "legal.correction.created", {
          correction_id: corrRecord.correction_id,
          base_extraction_version_id: baseManifest.extraction_version_id,
          successor_extraction_version_id: successorExtId,
          is_critical_token_change: isCritical,
        });

        return {
          status: 201,
          headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
          body: {
            correction: corrRecord,
            successor_extraction_version_id: successorExtId,
            updated_document_version: { ...docVer },
          },
        };
      },
    });
  }

  /**
   * `POST /api/v1/legal/documents/{id}/review-decisions`
   */
  public submitReviewDecision(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    document_id: string;
    extraction_version_id: string;
    annotation_version: string;
    issue_ids: string[];
    disposition: LegalReviewDecisionRecord["disposition"];
    evidence: string;
    rationale: string;
    applicability_curation?: Partial<ApplicabilityCurationMetadata>;
    resolved_reference_targets?: Record<string, string>; // `annotation_id -> resolved_target_id`
  }): HttpServiceResult<{
    decision: LegalReviewDecisionRecord;
    updated_document_version: LegalDocumentVersion;
  }> {
    if (!this.flags.ocr_v2_review_enabled) {
      return this.errorResponse(503, "FEATURE_DISABLED", "ocr_v2_review_enabled flag is disabled", true);
    }
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) return this.errorResponse(404, "NOT_FOUND", "Document version not found");

    const src = this.sources.get(docVer.source_id)!;
    const requiredRoles: OcrHumanRole[] =
      params.disposition === "curate_applicability" || params.disposition === "resolve_blocking"
        ? ["legal_editor", "reviewer"]
        : ["reviewer", "legal_editor"];

    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class,
      requiredRoles
    );
    if (accessErr) return accessErr;

    if (params.principal.is_service_account) {
      return this.errorResponse(403, "ACCESS_DENIED", "Service accounts cannot adjudicate legal review issues");
    }

    const ifMatchErr = this.checkIfMatch(params.if_match, docVer.workflow_revision);
    if (ifMatchErr) return ifMatchErr;

    if (
      docVer.extraction_version_id !== params.extraction_version_id ||
      docVer.annotation_version !== params.annotation_version
    ) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        "Exact extraction_version_id or annotation_version does not match current document version"
      );
    }

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/legal/documents/${params.document_id}/review-decisions`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        extraction_version_id: params.extraction_version_id,
        annotation_version: params.annotation_version,
        issue_ids: params.issue_ids,
        disposition: params.disposition,
        evidence: params.evidence,
      },
      execute: () => {
        const manifest = this.manifests.get(docVer.extraction_version_id)!;
        const nowIso = new Date().toISOString();

        // Resolving blocking issues requires `legal_editor` role and documented evidence
        if (params.disposition === "resolve_blocking") {
          if (!params.principal.roles.includes("legal_editor")) {
            return this.errorResponse(
              403,
              "ACCESS_DENIED",
              "Resolving blocking legal/transcription issues requires role 'legal_editor'"
            );
          }
          for (const iss of manifest.issues) {
            if (params.issue_ids.includes(iss.issue_id)) {
              // Unresolved missing pages CANNOT be waived by review decision!
              if (iss.code === "UNRESOLVED_MISSING_PROVIDER_PAGE") {
                return this.errorResponse(
                  409,
                  "INCOMPLETE_OUTPUT",
                  "Missing/unresolved pages cannot be waived by review decision; retry extraction or re-upload complete source"
                );
              }
              iss.resolution = "accepted";
            }
          }
          docVer.has_resolved_material_issues = true;
          if (!docVer.last_critical_corrector_id) {
            docVer.last_critical_corrector_id = params.principal.principal_id;
          }
        } else if (params.disposition === "accept_warning") {
          for (const iss of manifest.issues) {
            if (params.issue_ids.includes(iss.issue_id) && iss.severity !== "blocking") {
              iss.resolution = "accepted";
            }
          }
        } else if (params.disposition === "reject_extraction") {
          docVer.transcription_status = "rejected";
        } else if (params.disposition === "curate_applicability") {
          if (!params.principal.roles.includes("legal_editor")) {
            return this.errorResponse(
              403,
              "ACCESS_DENIED",
              "Curating legal applicability requires role 'legal_editor'"
            );
          }
          docVer.applicability_status = "curated";
          docVer.applicability_metadata = {
            scope: params.applicability_curation?.scope ?? "General statutory force in Thailand",
            relevant_effective_from: params.applicability_curation?.relevant_effective_from ?? null,
            relevant_effective_to: params.applicability_curation?.relevant_effective_to ?? null,
            jurisdiction: params.applicability_curation?.jurisdiction ?? "TH",
            evidence: params.evidence,
            curator_id: params.principal.principal_id,
            curated_at: nowIso,
          };
        } else if (params.disposition === "resolve_reference") {
          const anns = this.annotationsByVersion.get(docVer.annotation_version) ?? [];
          for (const ann of anns) {
            const target = params.resolved_reference_targets?.[ann.annotation_id];
            if (target) {
              ann.resolution_status = "resolved";
              ann.resolved_target_id = target;
              if (ann.proposed_relation) {
                ann.proposed_relation.target_id = target;
              }
            }
          }
          const stillConflict = anns.some((a) => a.resolution_status === "conflict");
          const stillCandidate = anns.some((a) => a.resolution_status === "unresolved_candidate");
          docVer.reference_status = stillConflict
            ? "conflict"
            : stillCandidate
            ? "candidate"
            : "resolved";
        }

        const openBlocking = manifest.issues.some(
          (i) => i.severity === "blocking" && i.resolution === "open"
        );
        if (docVer.transcription_status !== "rejected" && !openBlocking && manifest.completeness === "complete") {
          docVer.transcription_status = "ocr_verified";
          manifest.quality = "passed";
        }

        const decision: LegalReviewDecisionRecord = {
          decision_id: this.nextId("rdec.th"),
          tenant_id: docVer.tenant_id,
          workspace_id: docVer.workspace_id,
          document_id: docVer.document_id,
          version_id: docVer.version_id,
          extraction_version_id: docVer.extraction_version_id,
          annotation_version: docVer.annotation_version,
          issue_ids: params.issue_ids,
          disposition: params.disposition,
          evidence: params.evidence,
          rationale: params.rationale,
          rule_revision: THAI_DETECTOR_VERSION_V2,
          actor_principal_snapshot: {
            principal_id: params.principal.principal_id,
            roles: [...params.principal.roles],
          },
          created_at: nowIso,
        };
        this.reviewDecisions.set(decision.decision_id, decision);

        docVer.workflow_revision += 1;
        docVer.updated_at = nowIso;
        this.recordAudit(params.principal, docVer.document_id, "legal.review_decision.recorded", {
          decision_id: decision.decision_id,
          disposition: params.disposition,
        });

        return {
          status: 201,
          headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
          body: {
            decision,
            updated_document_version: { ...docVer },
          },
        };
      },
    });
  }

  /**
   * `POST /api/v1/legal/documents/{id}/approvals`
   * Enforces human-only approval (blocks service accounts) + Two-Person Dual Control for critical corrections
   * and resolved material issues!
   */
  public submitApproval(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    document_id: string;
    source_version_id: string;
    extraction_version_id: string;
    annotation_version: string;
    scopes: ApprovalScope[];
    prior_decision_ids?: string[];
  }): HttpServiceResult<LegalApprovalRecord> {
    if (!this.flags.ocr_v2_review_enabled) {
      return this.errorResponse(503, "FEATURE_DISABLED", "ocr_v2_review_enabled flag is disabled", true);
    }
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) return this.errorResponse(404, "NOT_FOUND", "Document version not found");

    const src = this.sources.get(docVer.source_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class,
      ["reviewer", "legal_editor", "publisher"]
    );
    if (accessErr) return accessErr;

    // Section 7: Service accounts CANNOT impersonate a human approver!
    if (params.principal.is_service_account) {
      return this.errorResponse(
        403,
        "ACCESS_DENIED",
        "Service accounts cannot act as or impersonate a human legal approver"
      );
    }

    const ifMatchErr = this.checkIfMatch(params.if_match, docVer.workflow_revision);
    if (ifMatchErr) return ifMatchErr;

    if (
      docVer.source_version_id !== params.source_version_id ||
      docVer.extraction_version_id !== params.extraction_version_id ||
      docVer.annotation_version !== params.annotation_version
    ) {
      return this.errorResponse(
        409,
        "VERSION_CONFLICT",
        "Approval version tuple (source_version_id, extraction_version_id, annotation_version) does not match current document version"
      );
    }

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/legal/documents/${params.document_id}/approvals`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        source_version_id: params.source_version_id,
        extraction_version_id: params.extraction_version_id,
        annotation_version: params.annotation_version,
        scopes: [...params.scopes].sort(),
      },
      execute: () => {
        const manifest = this.manifests.get(docVer.extraction_version_id)!;
        const openBlocking = manifest.issues.filter(
          (i) => i.severity === "blocking" && i.resolution === "open"
        );
        if (openBlocking.length > 0 || manifest.completeness !== "complete") {
          return this.errorResponse(
            409,
            "QUALITY_REVIEW_REQUIRED",
            `Cannot approve version with ${openBlocking.length} open blocking issue(s) orcompleteness='${manifest.completeness}'`
          );
        }

        // Two-person dual control check on `ready_to_publish` when critical corrections or material issues were resolved
        if (
          params.scopes.includes("ready_to_publish") &&
          docVer.has_resolved_material_issues &&
          docVer.last_critical_corrector_id === params.principal.principal_id
        ) {
          return this.errorResponse(
            403,
            "DUAL_CONTROL_REQUIRED",
            `Two-person dual control required: critical correction/material issue was performed by '${docVer.last_critical_corrector_id}'; a distinct second authorized human approver must sign off`
          );
        }

        if (params.scopes.includes("transcription_checked")) {
          docVer.transcription_status = "ocr_verified";
        }

        const boundDigest = sha256HexLower(
          canonicalizeJcsRfc8785({
            document_id: docVer.document_id,
            version_id: docVer.version_id,
            source_version_id: docVer.source_version_id,
            extraction_version_id: docVer.extraction_version_id,
            annotation_version: docVer.annotation_version,
            manifest_content_digest: manifest.content_digest,
          })
        );

        const nowIso = new Date().toISOString();
        const approval: LegalApprovalRecord = {
          approval_id: this.nextId("appr.th"),
          tenant_id: docVer.tenant_id,
          workspace_id: docVer.workspace_id,
          document_id: docVer.document_id,
          version_id: docVer.version_id,
          source_version_id: docVer.source_version_id,
          extraction_version_id: docVer.extraction_version_id,
          annotation_version: docVer.annotation_version,
          scopes: [...params.scopes],
          prior_decision_ids: params.prior_decision_ids ?? [],
          bound_content_digest: boundDigest,
          approver_principal_snapshot: {
            principal_id: params.principal.principal_id,
            roles: [...params.principal.roles],
          },
          status: "active",
          created_at: nowIso,
        };
        this.approvals.set(approval.approval_id, approval);

        docVer.workflow_revision += 1;
        docVer.updated_at = nowIso;
        this.recordAudit(params.principal, docVer.document_id, "legal.approval.granted", {
          approval_id: approval.approval_id,
          scopes: approval.scopes,
          bound_content_digest: boundDigest,
        });

        return {
          status: 201,
          headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
          body: approval,
        };
      },
    });
  }

  /**
   * `POST /api/v1/legal/documents/{id}/publications`
   * Stages keyword chunks, vector embeddings & graph edges under immutable `publication_id`,
   * validates counts & dual-control approvals, and atomically updates `activePublicationPointer` via CAS.
   * Scenario 7: If graph or embedding staging fails, leaves previous active publication intact!
   */
  public publishDocumentVersion(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    document_id: string;
    source_version_id: string;
    extraction_version_id: string;
    annotation_version: string;
    approval_ids: string[];
    expected_previous_publication_id: string | null;
    simulate_staging_failure?: "graph_writer_unavailable" | "embedding_batch_failed";
  }): HttpServiceResult<LegalPublicationManifest> {
    if (!this.flags.ocr_v2_publication_enabled) {
      return this.errorResponse(
        503,
        "FEATURE_DISABLED",
        "ocr_v2_publication_enabled flag is disabled",
        true
      );
    }
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) return this.errorResponse(404, "NOT_FOUND", "Document version not found");

    const src = this.sources.get(docVer.source_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class,
      ["publisher", "administrator"]
    );
    if (accessErr) return accessErr;

    if (params.principal.is_service_account) {
      return this.errorResponse(403, "ACCESS_DENIED", "Service accounts cannot activate legal publication");
    }

    const ifMatchErr = this.checkIfMatch(params.if_match, docVer.workflow_revision);
    if (ifMatchErr) return ifMatchErr;

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/legal/documents/${params.document_id}/publications`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        source_version_id: params.source_version_id,
        extraction_version_id: params.extraction_version_id,
        annotation_version: params.annotation_version,
        approval_ids: [...params.approval_ids].sort(),
        expected_previous_publication_id: params.expected_previous_publication_id,
      },
      execute: () => {
        if (
          docVer.source_version_id !== params.source_version_id ||
          docVer.extraction_version_id !== params.extraction_version_id ||
          docVer.annotation_version !== params.annotation_version
        ) {
          return this.errorResponse(
            409,
            "VERSION_CONFLICT",
            "Version tuple mismatch against current LegalDocumentVersion"
          );
        }

        const manifest = this.manifests.get(docVer.extraction_version_id)!;
        const pages = this.extractionPages.get(docVer.extraction_version_id) ?? [];
        const hasUncertainPages = pages.some(
          (p) => p.state === "unresolved" || p.state === "failed"
        );
        const openBlocking = manifest.issues.some(
          (i) => i.severity === "blocking" && i.resolution === "open"
        );

        if (manifest.completeness !== "complete" || hasUncertainPages || openBlocking) {
          return this.errorResponse(
            409,
            "QUALITY_REVIEW_REQUIRED",
            "Documents with unresolved blocking issues or uncertain/missing pages cannot be published"
          );
        }

        // Validate approvals & Two-Person Dual Control
        const validApprovals: LegalApprovalRecord[] = [];
        for (const appId of params.approval_ids) {
          const app = this.approvals.get(appId);
          if (
            !app ||
            app.status !== "active" ||
            app.document_id !== docVer.document_id ||
            app.extraction_version_id !== docVer.extraction_version_id ||
            app.annotation_version !== docVer.annotation_version
          ) {
            return this.errorResponse(
              409,
              "VERSION_CONFLICT",
              `Approval '${appId}' is missing, revoked, invalidated by edit, or bound to a different extraction/annotation version`
            );
          }
          validApprovals.push(app);
        }

        const coveredScopes = new Set<ApprovalScope>();
        const distinctApprovers = new Set<string>();
        for (const a of validApprovals) {
          distinctApprovers.add(a.approver_principal_snapshot.principal_id);
          for (const s of a.scopes) coveredScopes.add(s);
        }

        if (!coveredScopes.has("transcription_checked") || !coveredScopes.has("ready_to_publish")) {
          return this.errorResponse(
            409,
            "QUALITY_REVIEW_REQUIRED",
            "Publication requires active approvals covering at least 'transcription_checked' and 'ready_to_publish'"
          );
        }

        if (docVer.has_resolved_material_issues) {
          const hasSecondDistinct = Array.from(distinctApprovers).some(
            (pid) => pid !== docVer.last_critical_corrector_id
          );
          if (!hasSecondDistinct) {
            return this.errorResponse(
              403,
              "DUAL_CONTROL_REQUIRED",
              "Publication of a document with critical corrections or resolved material issues requires a second distinct human approver"
            );
          }
        }

        // Compare-and-swap precondition check on active publication pointer
        const pointerKey = `${docVer.tenant_id}:${docVer.workspace_id}:${docVer.document_id}`;
        const currentActivePubId = this.activePublicationPointer.get(pointerKey) ?? null;
        if (currentActivePubId !== params.expected_previous_publication_id) {
          return this.errorResponse(
            409,
            "VERSION_CONFLICT",
            `CAS pointer conflict: expected previous publication '${params.expected_previous_publication_id}', actual '${currentActivePubId}'`
          );
        }

        const publicationId = this.nextId("pub.th");
        const stagingOpId = this.nextId("stg.op");
        const nowIso = new Date().toISOString();

        // Build staged keyword chunks with exact immutable page & code-point spans
        const stagedChunks: StagedKeywordChunk[] = [];
        let totalTables = 0;
        for (const pg of pages) {
          totalTables += pg.tables.length;
          if (pg.state !== "extracted" || pg.raw_text.trim().length === 0) continue;
          const rawLen = Array.from(pg.raw_text).length;
          const headingBlock = pg.blocks.find((b) => b.kind === "heading" || b.kind === "header");
          stagedChunks.push({
            chunk_id: `chk.${publicationId}.p${pg.page_number}`,
            publication_id: publicationId,
            document_id: docVer.document_id,
            version_id: docVer.version_id,
            source_version_id: docVer.source_version_id,
            extraction_version_id: docVer.extraction_version_id,
            page_number: pg.page_number,
            raw_start: 0,
            raw_end: rawLen,
            heading_context: headingBlock?.raw_text ?? src.title_th,
            raw_text: pg.raw_text,
            normalized_text: pg.normalized_text,
            citation_locator: `${src.title_th} (หน้า ${pg.page_number}, source=${docVer.source_version_id}, extraction=${docVer.extraction_version_id})`,
            privacy_class: src.privacy_class,
          });
        }

        // Build staged verified GraphRAG edges (ONLY resolved targets; unresolved `"มาตรา ๕"` candidates NEVER become verified edges!)
        const anns = this.annotationsByVersion.get(docVer.annotation_version) ?? [];
        const stagedEdges: StagedGraphEdge[] = [];
        for (const ann of anns) {
          if (
            ann.resolution_status === "resolved" &&
            ann.resolved_target_id &&
            ann.proposed_relation?.target_id &&
            ann.source_spans.length > 0
          ) {
            stagedEdges.push({
              edge_id: `gedge.${publicationId}.${ann.annotation_id}`,
              publication_id: publicationId,
              tenant_id: docVer.tenant_id,
              workspace_id: docVer.workspace_id,
              source_document_id: docVer.document_id,
              source_version_id: docVer.source_version_id,
              extraction_version_id: docVer.extraction_version_id,
              annotation_version: docVer.annotation_version,
              relation_type: ann.proposed_relation.relation_type,
              from_node_id: docVer.document_id,
              to_node_id: ann.proposed_relation.target_id,
              source_span: ann.source_spans[0],
              relationship_status: "verified_published",
              editorial_basis: `Verified OCR v2 annotation (${ann.entity_type}: ${ann.raw_value})`,
            });
          }
        }

        // Fault-injection / store failure check BEFORE CAS pointer switch (Scenario 7!)
        if (params.simulate_staging_failure) {
          const failedManifest: LegalPublicationManifest = {
            publication_id: publicationId,
            staging_operation_id: stagingOpId,
            tenant_id: docVer.tenant_id,
            workspace_id: docVer.workspace_id,
            document_id: docVer.document_id,
            version_id: docVer.version_id,
            source_version_id: docVer.source_version_id,
            extraction_version_id: docVer.extraction_version_id,
            annotation_version: docVer.annotation_version,
            chunking_revision: "thai-legal-chunker/2.0.0",
            embedding_revision: "bge-m3-thai-legal/2.0.0",
            graph_schema_revision: "reg24-neo4j-ontology/2.0.0",
            expected_artifact_counts: {
              keyword_chunks: stagedChunks.length,
              vector_embeddings: stagedChunks.length,
              graph_edges: stagedEdges.length,
              tables: totalTables,
            },
            actual_artifact_counts: {
              keyword_chunks: stagedChunks.length,
              vector_embeddings:
                params.simulate_staging_failure === "embedding_batch_failed" ? 0 : stagedChunks.length,
              graph_edges:
                params.simulate_staging_failure === "graph_writer_unavailable" ? 0 : stagedEdges.length,
              tables: totalTables,
            },
            manifest_digest: sha256HexLower(publicationId),
            approval_ids: params.approval_ids,
            previous_publication_id: currentActivePubId,
            status: "failed_staging",
            created_at: nowIso,
            activated_at: null,
            withdrawn_at: null,
            withdrawal_reason: null,
          };
          this.publications.set(publicationId, failedManifest);
          // Crucially: do NOT update `activePublicationPointer`, `stagedChunksByPub`, or `stagedEdgesByPub`!
          return this.errorResponse(
            503,
            "STAGING_FAILED",
            `Staging failed (${params.simulate_staging_failure}); active publication pointer remains at '${
              currentActivePubId ?? "none"
            }'`,
            true,
            { failed_publication_id: publicationId, active_publication_id: currentActivePubId }
          );
        }

        // Recheck approval validity immediately before pointer activation (Section 8)
        if (validApprovals.some((a) => a.status !== "active")) {
          return this.errorResponse(409, "VERSION_CONFLICT", "Approval was revoked during staging");
        }

        const pubManifest: LegalPublicationManifest = {
          publication_id: publicationId,
          staging_operation_id: stagingOpId,
          tenant_id: docVer.tenant_id,
          workspace_id: docVer.workspace_id,
          document_id: docVer.document_id,
          version_id: docVer.version_id,
          source_version_id: docVer.source_version_id,
          extraction_version_id: docVer.extraction_version_id,
          annotation_version: docVer.annotation_version,
          chunking_revision: "thai-legal-chunker/2.0.0",
          embedding_revision: "bge-m3-thai-legal/2.0.0",
          graph_schema_revision: "reg24-neo4j-ontology/2.0.0",
          expected_artifact_counts: {
            keyword_chunks: stagedChunks.length,
            vector_embeddings: stagedChunks.length,
            graph_edges: stagedEdges.length,
            tables: totalTables,
          },
          actual_artifact_counts: {
            keyword_chunks: stagedChunks.length,
            vector_embeddings: stagedChunks.length,
            graph_edges: stagedEdges.length,
            tables: totalTables,
          },
          manifest_digest: sha256HexLower(
            canonicalizeJcsRfc8785({
              publication_id: publicationId,
              chunks: stagedChunks.map((c) => c.chunk_id),
              edges: stagedEdges.map((e) => e.edge_id),
            })
          ),
          approval_ids: [...params.approval_ids],
          previous_publication_id: currentActivePubId,
          status: this.flags.shadow_mode_only ? "staging" : "active",
          created_at: nowIso,
          activated_at: this.flags.shadow_mode_only ? null : nowIso,
          withdrawn_at: null,
          withdrawal_reason: null,
        };

        this.stagedChunksByPub.set(publicationId, stagedChunks);
        this.stagedEdgesByPub.set(publicationId, stagedEdges);
        this.publications.set(publicationId, pubManifest);

        // Atomic CAS pointer activation (unless shadow_mode_only is enabled)
        if (!this.flags.shadow_mode_only) {
          if (currentActivePubId) {
            const oldPub = this.publications.get(currentActivePubId);
            if (oldPub && oldPub.status === "active") {
              oldPub.status = "superseded";
            }
          }
          this.activePublicationPointer.set(pointerKey, publicationId);
          docVer.publication_status = "published";
          docVer.active_publication_id = publicationId;
        } else {
          docVer.publication_status = "staging";
        }

        docVer.workflow_revision += 1;
        docVer.updated_at = nowIso;
        this.recordAudit(params.principal, docVer.document_id, "legal.publication.activated", {
          publication_id: publicationId,
          previous_publication_id: currentActivePubId,
          keyword_chunks: stagedChunks.length,
          graph_edges: stagedEdges.length,
        });

        return {
          status: 201,
          headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
          body: pubManifest,
        };
      },
    });
  }

  /**
   * `POST /api/v1/legal/documents/{id}/withdrawals`
   * Scenario 12: Atomically revokes active visibility, invalidates cached answers, and preserves audit history.
   */
  public withdrawPublication(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    document_id: string;
    active_publication_id: string;
    reason: string;
  }): HttpServiceResult<LegalPublicationManifest> {
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) return this.errorResponse(404, "NOT_FOUND", "Document version not found");

    const src = this.sources.get(docVer.source_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class,
      ["publisher", "administrator"]
    );
    if (accessErr) return accessErr;

    const ifMatchErr = this.checkIfMatch(params.if_match, docVer.workflow_revision);
    if (ifMatchErr) return ifMatchErr;

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/legal/documents/${params.document_id}/withdrawals`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        active_publication_id: params.active_publication_id,
        reason: params.reason,
      },
      execute: () => {
        const pointerKey = `${docVer.tenant_id}:${docVer.workspace_id}:${docVer.document_id}`;
        const currentActive = this.activePublicationPointer.get(pointerKey);
        if (currentActive !== params.active_publication_id) {
          return this.errorResponse(
            409,
            "VERSION_CONFLICT",
            `Active publication mismatch: expected '${params.active_publication_id}', actual '${
              currentActive ?? "none"
            }'`
          );
        }

        const pub = this.publications.get(params.active_publication_id)!;
        const nowIso = new Date().toISOString();
        pub.status = "withdrawn";
        pub.withdrawn_at = nowIso;
        pub.withdrawal_reason = params.reason;

        // Atomically delete active pointer & invalidate any cached answers referencing it!
        this.activePublicationPointer.delete(pointerKey);
        for (const [cacheKey, entry] of this.answerCache.entries()) {
          if (entry.publication_ids.includes(params.active_publication_id)) {
            this.answerCache.delete(cacheKey);
          }
        }

        src.status = "withdrawn";
        docVer.publication_status = "withdrawn";
        docVer.active_publication_id = null;
        docVer.workflow_revision += 1;
        docVer.updated_at = nowIso;

        this.recordAudit(params.principal, docVer.document_id, "legal.publication.withdrawn", {
          publication_id: pub.publication_id,
          reason: params.reason,
        });

        return {
          status: 200,
          headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
          body: pub,
        };
      },
    });
  }

  /**
   * `POST /api/v1/legal/documents/{id}/rollbacks`
   * Restores consistent text + graph visibility to a prior complete `publication_id` without mutating source evidence.
   */
  public rollbackPublication(params: {
    principal: OcrPrincipalContext;
    idempotency_key?: string;
    if_match?: string;
    document_id: string;
    target_publication_id: string;
    expected_active_publication_id: string | null;
    reason: string;
  }): HttpServiceResult<LegalPublicationManifest> {
    const verId = this.latestDocVersionByDocId.get(params.document_id);
    const docVer = verId ? this.documentVersions.get(verId) : undefined;
    if (!docVer) return this.errorResponse(404, "NOT_FOUND", "Document version not found");

    const src = this.sources.get(docVer.source_id)!;
    const accessErr = this.verifyAccess(
      params.principal,
      docVer.tenant_id,
      docVer.workspace_id,
      src.privacy_class,
      ["publisher", "administrator"]
    );
    if (accessErr) return accessErr;

    const ifMatchErr = this.checkIfMatch(params.if_match, docVer.workflow_revision);
    if (ifMatchErr) return ifMatchErr;

    return this.checkOrRunIdempotent({
      principal: params.principal,
      route: `POST /api/v1/legal/documents/${params.document_id}/rollbacks`,
      idempotencyKey: params.idempotency_key,
      canonicalPayload: {
        target_publication_id: params.target_publication_id,
        expected_active_publication_id: params.expected_active_publication_id,
        reason: params.reason,
      },
      execute: () => {
        const targetPub = this.publications.get(params.target_publication_id);
        if (
          !targetPub ||
          targetPub.document_id !== params.document_id ||
          targetPub.status === "failed_staging"
        ) {
          return this.errorResponse(
            404,
            "NOT_FOUND",
            `Complete rollback target publication '${params.target_publication_id}' not found`
          );
        }

        const pointerKey = `${docVer.tenant_id}:${docVer.workspace_id}:${docVer.document_id}`;
        const currentActive = this.activePublicationPointer.get(pointerKey) ?? null;
        if (currentActive !== params.expected_active_publication_id) {
          return this.errorResponse(
            409,
            "VERSION_CONFLICT",
            `Rollback CAS conflict: expected active '${params.expected_active_publication_id}', actual '${currentActive}'`
          );
        }

        // Verify underlying source version & extraction evidence are still retained
        if (
          !this.sourceVersions.has(targetPub.source_version_id) ||
          !this.manifests.has(targetPub.extraction_version_id)
        ) {
          return this.errorResponse(
            409,
            "VERSION_CONFLICT",
            "Target publication evidence is no longer retained"
          );
        }

        if (currentActive) {
          const prevActive = this.publications.get(currentActive);
          if (prevActive && prevActive.status === "active") {
            prevActive.status = "superseded";
          }
        }

        const nowIso = new Date().toISOString();
        targetPub.status = "active";
        targetPub.activated_at = nowIso;
        this.activePublicationPointer.set(pointerKey, targetPub.publication_id);

        src.status = "active";
        docVer.publication_status = "published";
        docVer.active_publication_id = targetPub.publication_id;
        docVer.workflow_revision += 1;
        docVer.updated_at = nowIso;

        this.recordAudit(params.principal, docVer.document_id, "legal.publication.rolled_back", {
          restored_publication_id: targetPub.publication_id,
          replaced_publication_id: currentActive,
          reason: params.reason,
        });

        return {
          status: 200,
          headers: { ETag: `W/"rev-${docVer.workflow_revision}"` },
          body: targetPub,
        };
      },
    });
  }

  // ==========================================================================
  // ATOMIC SNAPSHOT RETRIEVAL, CACHED ANSWERS & GRAPHRAG GATE (`REG-005`)
  // ==========================================================================

  /**
   * Captures the authoritative publication pointer snapshot ONCE per request so keyword, vector,
   * and GraphRAG traversals read the exact same immutable versions (zero mixed-version reads!).
   */
  public capturePublicationSnapshot(
    principal: OcrPrincipalContext = DEFAULT_SYSTEM_OPERATOR
  ): PublicationRetrievalSnapshot {
    const map = new Map<string, LegalPublicationManifest>();
    const prefix = `${principal.tenant_id}:${principal.workspace_id}:`;

    for (const [key, pubId] of this.activePublicationPointer.entries()) {
      if (!key.startsWith(prefix)) continue;
      const pub = this.publications.get(pubId);
      if (!pub || pub.status !== "active") continue;
      const docVer = this.documentVersions.get(pub.version_id);
      const src = docVer ? this.sources.get(docVer.source_id) : undefined;
      if (!src) continue;

      // Reauthorize current access per request (including confidential/restricted checks!)
      const accessCheck = this.verifyAccess(
        principal,
        pub.tenant_id,
        pub.workspace_id,
        src.privacy_class
      );
      if (accessCheck === null) {
        map.set(pub.document_id, pub);
      }
    }

    return {
      snapshot_id: this.nextId("snap.pub"),
      captured_at: new Date().toISOString(),
      tenant_id: principal.tenant_id,
      workspace_id: principal.workspace_id,
      active_publications_by_document: map,
    };
  }

  public searchPublishedOcrKnowledge(params: {
    query: string;
    principal?: OcrPrincipalContext;
    snapshot?: PublicationRetrievalSnapshot;
  }): {
    snapshot_id: string;
    hits: SourceLinkedSearchHit[];
    graph_edges: StagedGraphEdge[];
  } {
    const principal = params.principal ?? DEFAULT_SYSTEM_OPERATOR;
    const snap = params.snapshot ?? this.capturePublicationSnapshot(principal);
    const qNorm = normalizeThaiLegalTextV2(params.query).normalized_text.toLowerCase();
    const qTokens = qNorm.split(/\s+/).filter((t) => t.length >= 2);

    const hits: SourceLinkedSearchHit[] = [];
    const graphEdges: StagedGraphEdge[] = [];

    for (const [docId, pub] of snap.active_publications_by_document.entries()) {
      const chunks = this.stagedChunksByPub.get(pub.publication_id) ?? [];
      const edges = this.stagedEdgesByPub.get(pub.publication_id) ?? [];
      const docVer = this.documentVersions.get(pub.version_id)!;
      const src = this.sources.get(docVer.source_id)!;

      for (const chk of chunks) {
        const hayRaw = chk.raw_text.toLowerCase();
        const hayNorm = chk.normalized_text.toLowerCase();
        const matches =
          qNorm.length === 0 ||
          hayRaw.includes(params.query.toLowerCase()) ||
          hayNorm.includes(qNorm) ||
          qTokens.some((tok) => hayNorm.includes(tok) || src.title_th.toLowerCase().includes(tok));

        if (!matches) continue;

        // Scenario 10: Explicitly disclose unassessed applicability when `applicability_status !== 'curated'`!
        const applicabilityDisclosure =
          docVer.applicability_status === "curated"
            ? `Applicability curated (${docVer.applicability_metadata.scope ?? "TH"} — curator: ${
                docVer.applicability_metadata.curator_id
              })`
            : docVer.applicability_status === "disputed"
            ? "WARNING: Legal applicability is DISPUTED; do not rely on current legal force without counsel review."
            : "NOTICE: Transcription is OCR-verified from source image, but legal applicability / current force is UNASSESSED (not_assessed).";

        hits.push({
          document_id: docId,
          title_th: src.title_th,
          title_en: src.title_en,
          publication_id: pub.publication_id,
          version_id: pub.version_id,
          source_version_id: pub.source_version_id,
          extraction_version_id: pub.extraction_version_id,
          page_number: chk.page_number,
          source_span: {
            page_number: chk.page_number,
            block_id: `blk.p${chk.page_number}.1`,
            raw_start: chk.raw_start,
            raw_end: chk.raw_end,
            polygon: null,
          },
          raw_excerpt: chk.raw_text,
          normalized_excerpt: chk.normalized_text,
          citation_locator: chk.citation_locator,
          transcription_status: docVer.transcription_status,
          reference_status: docVer.reference_status,
          applicability_status: docVer.applicability_status,
          applicability_disclosure: applicabilityDisclosure,
        });
      }

      if (hits.some((h) => h.document_id === docId)) {
        graphEdges.push(...edges);
      }
    }

    return {
      snapshot_id: snap.snapshot_id,
      hits,
      graph_edges: graphEdges,
    };
  }

  public putCachedAnswer(cacheKey: string, publicationIds: string[], answer: string): void {
    this.answerCache.set(cacheKey, { publication_ids: [...publicationIds], cached_answer: answer });
  }

  public getCachedAnswer(
    cacheKey: string,
    principal: OcrPrincipalContext = DEFAULT_SYSTEM_OPERATOR
  ): string | null {
    const entry = this.answerCache.get(cacheKey);
    if (!entry) return null;
    const snap = this.capturePublicationSnapshot(principal);
    const activePubIds = new Set(
      Array.from(snap.active_publications_by_document.values()).map((p) => p.publication_id)
    );
    // Every referenced publication_id MUST still be active & authorized for this principal!
    if (entry.publication_ids.some((pid) => !activePubIds.has(pid))) {
      return null;
    }
    return entry.cached_answer;
  }

  // ==========================================================================
  // DASHBOARD, AUDIT SUMMARY, MIGRATION TAGS & BENCHMARK REPORT
  // ==========================================================================

  public getWorkspaceOverview(principal: OcrPrincipalContext = DEFAULT_SYSTEM_OPERATOR) {
    const docs = Array.from(this.latestDocVersionByDocId.entries())
      .map(([docId, verId]) => {
        const ver = this.documentVersions.get(verId)!;
        const src = this.sources.get(ver.source_id)!;
        if (
          ver.tenant_id !== principal.tenant_id ||
          ver.workspace_id !== principal.workspace_id
        ) {
          return null;
        }
        const manifest = this.manifests.get(ver.extraction_version_id)!;
        const pages = this.extractionPages.get(ver.extraction_version_id) ?? [];
        const anns = this.annotationsByVersion.get(ver.annotation_version) ?? [];
        return {
          document_id: docId,
          title_th: src.title_th,
          title_en: src.title_en,
          source_category: src.source_category,
          privacy_class: src.privacy_class,
          authority_status: src.authority_assessment.status,
          version: ver,
          manifest,
          pages_preview: pages.map((p) => ({
            page_number: p.page_number,
            state: p.state,
            provider_id: p.provenance.provider_id,
            model_revision: p.provenance.model_revision,
            raw_text: p.raw_text,
            normalized_text: p.normalized_text,
            tables: p.tables,
            blocks_count: p.blocks.length,
            combining_diagnostics: inspectThaiCombiningDiagnostics(p.raw_text),
          })),
          annotations: anns,
          open_blocking_issues: manifest.issues.filter(
            (i) => i.severity === "blocking" && i.resolution === "open"
          ).length,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      contract_version: "2.0.0",
      feature_flags: this.getFeatureFlags(),
      legacy_migration_summary: {
        legacy_audit_tag: "legacy_unverified",
        resource_master_legacy_docs: 2312,
        rd_tax_rulings_legacy_docs: 3643,
        policy_note:
          "Existing corpus records lack rendered page manifests and dual-control OCR evidence; retained with explicit 'legacy_unverified' metadata outside transcription_status.",
      },
      jobs: this.listOcrJobs(principal),
      documents: docs,
      benchmark_report: this.runGoldenFixtureBenchmark(),
    };
  }

  public runGoldenFixtureBenchmark(): ThaiOcrBenchmarkReport {
    const goldenFixtures: BenchmarkFixtureDocument[] = [
      {
        document_id: "bench.dika.2451_2568",
        family_group_id: "fam.dika.labor.2568",
        split: "held_out_test",
        source_category: "supreme_court_judgment",
        scan_condition: "clean_printed",
        expected_page_count: 2,
        returned_page_count: 2,
        hypothesis_raw_text:
          "คำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘\nโจทก์ฟ้องขอให้จำเลยจ่ายค่าชดเชยตามพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. ๒๕๔๑ มาตรา ๑๑๘ วรรคหนึ่ง (๓)",
        ground_truth_raw_text:
          "คำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘\nโจทก์ฟ้องขอให้จำเลยจ่ายค่าชดเชยตามพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. ๒๕๔๑ มาตรา ๑๑๘ วรรคหนึ่ง (๓)",
        critical_fields_hypothesis: {
          case_id: "๒๔๕๑/๒๕๖๘",
          section: "๑๑๘",
          act_year: "๒๕๔๑",
        },
        critical_fields_ground_truth: {
          case_id: "๒๔๕๑/๒๕๖๘",
          section: "๑๑๘",
          act_year: "๒๕๔๑",
        },
        predicted_citations: ["Dika:2451/2568", "inst.th.lpa.2541.sec.118"],
        ground_truth_citations: ["Dika:2451/2568", "inst.th.lpa.2541.sec.118"],
        resolved_targets_predicted: [
          { key: "sec.118", target_id: "inst.th.lpa.2541.sec.118" },
        ],
        resolved_targets_ground_truth: { "sec.118": "inst.th.lpa.2541.sec.118" },
        unsupported_hallucinated_critical_tokens: 0,
        latency_ms: 640,
        cost_micros_thb: 8000,
      },
      {
        document_id: "bench.gazette.lpa_v9",
        family_group_id: "fam.gazette.lpa.2568",
        split: "held_out_test",
        source_category: "royal_gazette",
        scan_condition: "clean_printed",
        expected_page_count: 1,
        returned_page_count: 1,
        hypothesis_raw_text:
          "ราชกิจจานุเบกษา เล่ม ๑๔๒ ตอนที่ ๑๕ ก หน้า ๑\nพระราชบัญญัติคุ้มครองแรงงาน (ฉบับที่ ๙) พ.ศ. ๒๕๖๘ มาตรา ๔ มิให้นำบทบัญญัติเดิมมาใช้บังคับ",
        ground_truth_raw_text:
          "ราชกิจจานุเบกษา เล่ม ๑๔๒ ตอนที่ ๑๕ ก หน้า ๑\nพระราชบัญญัติคุ้มครองแรงงาน (ฉบับที่ ๙) พ.ศ. ๒๕๖๘ มาตรา ๔ มิให้นำบทบัญญัติเดิมมาใช้บังคับ",
        critical_fields_hypothesis: {
          gazette_vol: "๑๔๒",
          section: "๔",
          negation: "มิให้",
        },
        critical_fields_ground_truth: {
          gazette_vol: "๑๔๒",
          section: "๔",
          negation: "มิให้",
        },
        predicted_citations: ["Gazette:v142:i15:p1", "inst.th.lpa.2541.sec.4"],
        ground_truth_citations: ["Gazette:v142:i15:p1", "inst.th.lpa.2541.sec.4"],
        resolved_targets_predicted: [
          { key: "sec.4", target_id: "inst.th.lpa.2541.sec.4" },
        ],
        resolved_targets_ground_truth: { "sec.4": "inst.th.lpa.2541.sec.4" },
        unsupported_hallucinated_critical_tokens: 0,
        tables: [
          {
            hypothesis: {
              cells: [
                {
                  row: 0,
                  column: 0,
                  row_span: 1,
                  column_span: 1,
                  raw_text: "อายุงานครบ ๑๒๐ วัน",
                  span: { page_number: 1, block_id: null, raw_start: 0, raw_end: 18, polygon: null },
                },
                {
                  row: 0,
                  column: 1,
                  row_span: 1,
                  column_span: 1,
                  raw_text: "ค่าชดเชย ๓๐ วัน",
                  span: { page_number: 1, block_id: null, raw_start: 0, raw_end: 15, polygon: null },
                },
              ],
            },
            ground_truth: {
              cells: [
                {
                  row: 0,
                  column: 0,
                  row_span: 1,
                  column_span: 1,
                  raw_text: "อายุงานครบ ๑๒๐ วัน",
                  span: { page_number: 1, block_id: null, raw_start: 0, raw_end: 18, polygon: null },
                },
                {
                  row: 0,
                  column: 1,
                  row_span: 1,
                  column_span: 1,
                  raw_text: "ค่าชดเชย ๓๐ วัน",
                  span: { page_number: 1, block_id: null, raw_start: 0, raw_end: 15, polygon: null },
                },
              ],
            },
          },
        ],
        latency_ms: 510,
        cost_micros_thb: 4000,
      },
      {
        document_id: "bench.rd.0702_9184_scan",
        family_group_id: "fam.rd.cit.2568",
        split: "held_out_test",
        source_category: "revenue_department_ruling",
        scan_condition: "challenging_scan",
        expected_page_count: 1,
        returned_page_count: 1,
        hypothesis_raw_text:
          "เลขที่หนังสือ กค 0702/9184 วันที่ 12 มีนาคม พ.ศ. 2568 เรื่อง ภาษีเงินได้นิติบุคคล ตามมาตรา 74 แห่งประมวลรัษฎากร",
        ground_truth_raw_text:
          "เลขที่หนังสือ กค 0702/9184 วันที่ 12 มีนาคม พ.ศ. 2568 เรื่อง ภาษีเงินได้นิติบุคคล ตามมาตรา 74 แห่งประมวลรัษฎากร",
        critical_fields_hypothesis: { ruling_no: "กค 0702/9184", section: "74" },
        critical_fields_ground_truth: { ruling_no: "กค 0702/9184", section: "74" },
        predicted_citations: ["กค 0702/9184", "inst.th.revenue_code.sec.74"],
        ground_truth_citations: ["กค 0702/9184", "inst.th.revenue_code.sec.74"],
        resolved_targets_predicted: [
          { key: "sec.74", target_id: "inst.th.revenue_code.sec.74" },
        ],
        resolved_targets_ground_truth: { "sec.74": "inst.th.revenue_code.sec.74" },
        unsupported_hallucinated_critical_tokens: 0,
        latency_ms: 820,
        cost_micros_thb: 4700,
      },
    ];

    return evaluateThaiOcrBenchmarkSuite(goldenFixtures);
  }

  // ==========================================================================
  // SEED REALISTIC THAI LEGAL GOLDEN FIXTURES FOR IMMEDIATE UI & API DEMO
  // ==========================================================================

  private seedGoldenFixtures(): void {
    // 1. Published Supreme Court Judgment with Thai digits & footer citation (Scenario 1)
    const dikaP1 =
      "คำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘\nระหว่าง นายสมชาย รักงาน โจทก์ กับ บริษัท ไทยอุตสาหกรรม จำกัด จำเลย\nศาลฎีกาวินิจฉัยว่า การเลิกจ้างโดยลูกจ้างมิได้กระทำความผิดตามพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. ๒๕๔๑ มาตรา ๑๑๙ นายจ้างต้องจ่ายค่าชดเชยตามมาตรา ๑๑๘ วรรคหนึ่ง (๓) อัตราค่าจ้างสุดท้ายเก้าสิบวัน ๆ ละ ๑,๒๐๐ บาท";
    const dikaP2 =
      "พิพากษายืนตามศาลแรงงานกลาง ให้จำเลยชำระค่าชดเชยพร้อมดอกเบี้ยอัตราร้อยละ ๕ ต่อปี\nอ่านคำพิพากษาเมื่อวันที่ ๑๔ พฤษภาคม พ.ศ. ๒๕๖๘\nเชิงอรรถ [1] อ้างอิงคำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘ หน้า ๒ จาก ๒";
    const dikaSha = sha256HexLower(`${dikaP1}\n${dikaP2}`);

    const regDika = this.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "seed-dika-reg",
      document_id_override: "doc.th.dika.2451_2568",
      title_th: "คำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘ (ค่าชดเชยตามมาตรา ๑๑๘ และข้อยกเว้นมาตรา ๑๑๙)",
      title_en: "Supreme Court Judgment No. 2451/2568 (Severance Pay LPA Sec. 118 & Sec. 119)",
      source_category: "supreme_court_judgment",
      privacy_class: "public",
      expected_sha256: dikaSha,
      original_url: "https://deka.supremecourt.or.th/search/2451-2568",
      publisher_asserted: "ศาลฎีกา (Supreme Court of Thailand)",
      declared_document_date: "2025-05-14",
      authority_status: "official_confirmed",
    });
    if (regDika.status === 201 && "source_version_id" in regDika.body) {
      this.finalizeSourceVersion({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-dika-fin",
        document_id: regDika.body.document_id,
        source_version_id: regDika.body.source_version_id,
        stored_sha256: dikaSha,
        actual_mime_type: "application/pdf",
        byte_length: 248_900,
        pages_manifest: [
          {
            page_number: 1,
            image_sha256: sha256HexLower("dika-p1-img"),
            width_px: 2480,
            height_px: 3508,
            rotation_degrees: 0,
            has_visible_content: true,
            blank_detector_score: 0.01,
            native_pdf_text: null, // Scanned judgment -> routes to Typhoon OCR 2 structured adapter
            rendered_reference_text: dikaP1,
          },
          {
            page_number: 2,
            image_sha256: sha256HexLower("dika-p2-img"),
            width_px: 2480,
            height_px: 3508,
            rotation_degrees: 0,
            has_visible_content: true,
            blank_detector_score: 0.02,
            native_pdf_text: null,
            rendered_reference_text: dikaP2,
          },
        ],
      });
      const jobDika = this.submitOcrJob({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-dika-job",
        document_id: regDika.body.document_id,
        source_version_id: regDika.body.source_version_id,
      });
      if (jobDika.status === 202 && "extraction_version_id" in jobDika.body && jobDika.body.extraction_version_id) {
        const state1 = this.getLegalDocumentState({
          principal: DEFAULT_SYSTEM_OPERATOR,
          document_id: regDika.body.document_id,
        });
        if (state1.status === 200 && "current_version" in state1.body) {
          const v = state1.body.current_version;
          const dec = this.submitReviewDecision({
            principal: DEFAULT_SYSTEM_OPERATOR,
            idempotency_key: "seed-dika-curate",
            if_match: String(v.workflow_revision),
            document_id: v.document_id,
            extraction_version_id: v.extraction_version_id,
            annotation_version: v.annotation_version,
            issue_ids: [],
            disposition: "curate_applicability",
            evidence: "Leading Supreme Court labor precedent on LPA Sec. 118/119",
            rationale: "Verified applicability for Thai labor termination disputes",
            applicability_curation: {
              scope: "Thai Labor Protection Act B.E. 2541 Sec. 118 & Sec. 119",
              relevant_effective_from: "2025-05-14",
              jurisdiction: "TH",
            },
          });
          const revAfterDec =
            dec.status === 201 && "updated_document_version" in dec.body
              ? dec.body.updated_document_version.workflow_revision
              : v.workflow_revision;
          const appr = this.submitApproval({
            principal: SECOND_APPROVER_PRINCIPAL,
            idempotency_key: "seed-dika-appr",
            if_match: String(revAfterDec),
            document_id: v.document_id,
            source_version_id: v.source_version_id,
            extraction_version_id: v.extraction_version_id,
            annotation_version: v.annotation_version,
            scopes: [
              "transcription_checked",
              "references_resolved",
              "applicability_curated",
              "ready_to_publish",
            ],
          });
          if (appr.status === 201 && "approval_id" in appr.body) {
            this.publishDocumentVersion({
              principal: DEFAULT_SYSTEM_OPERATOR,
              idempotency_key: "seed-dika-pub",
              if_match: String(revAfterDec + 1),
              document_id: v.document_id,
              source_version_id: v.source_version_id,
              extraction_version_id: v.extraction_version_id,
              annotation_version: v.annotation_version,
              approval_ids: [appr.body.approval_id],
              expected_previous_publication_id: null,
            });
          }
        }
      }
    }

    // 2. Historical Statute: OCR-verified transcription WITHOUT applicability curation (Scenario 10)
    const histText =
      "พระราชบัญญัติว่าด้วยโบราณสถาน โบราณวัตถุ ศิลปวัตถุ และพิพิธภัณฑสถานแห่งชาติ พ.ศ. ๒๔๙๙\nให้ไว้ ณ วันที่ ๑๒ สิงหาคม พ.ศ. ๒๔๙๙\nมาตรา ๕ ห้ามมิให้ผู้ใดซ่อมแซม แก้ไข เปลี่ยนแปลงโบราณสถานโดยมิได้รับอนุญาตเป็นหนังสือ";
    const histSha = sha256HexLower(histText);
    const regHist = this.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "seed-hist-reg",
      document_id_override: "doc.th.statute.ancient_2499",
      title_th: "พระราชบัญญัติโบราณสถานฯ พ.ศ. ๒๔๙๙ (ตรวจสอบตัวอักษร OCR แล้ว แต่ยังไม่ประเมินผลบังคับใช้ปัจจุบัน)",
      title_en: "Ancient Monuments Act B.E. 2499 (OCR-Verified Historical Text — Applicability Unassessed)",
      source_category: "statute",
      privacy_class: "public",
      expected_sha256: histSha,
      publisher_asserted: "ราชกิจจานุเบกษา",
      declared_document_date: "1956-08-12",
      authority_status: "official_confirmed",
    });
    if (regHist.status === 201 && "source_version_id" in regHist.body) {
      this.finalizeSourceVersion({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-hist-fin",
        document_id: regHist.body.document_id,
        source_version_id: regHist.body.source_version_id,
        stored_sha256: histSha,
        actual_mime_type: "application/pdf",
        byte_length: 112_400,
        pages_manifest: [
          {
            page_number: 1,
            image_sha256: sha256HexLower("hist-p1-img"),
            width_px: 2480,
            height_px: 3508,
            rotation_degrees: 0,
            has_visible_content: true,
            blank_detector_score: 0.01,
            native_pdf_text: null,
            rendered_reference_text: histText,
          },
        ],
      });
      this.submitOcrJob({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-hist-job",
        document_id: regHist.body.document_id,
        source_version_id: regHist.body.source_version_id,
      });
      const stHist = this.getLegalDocumentState({
        principal: DEFAULT_SYSTEM_OPERATOR,
        document_id: regHist.body.document_id,
      });
      if (stHist.status === 200 && "current_version" in stHist.body) {
        const v = stHist.body.current_version;
        const appr = this.submitApproval({
          principal: SECOND_APPROVER_PRINCIPAL,
          idempotency_key: "seed-hist-appr",
          if_match: String(v.workflow_revision),
          document_id: v.document_id,
          source_version_id: v.source_version_id,
          extraction_version_id: v.extraction_version_id,
          annotation_version: v.annotation_version,
          scopes: ["transcription_checked", "ready_to_publish"], // Applicability intentionally left `not_assessed`!
        });
        if (appr.status === 201 && "approval_id" in appr.body) {
          this.publishDocumentVersion({
            principal: DEFAULT_SYSTEM_OPERATOR,
            idempotency_key: "seed-hist-pub",
            if_match: String(v.workflow_revision + 1),
            document_id: v.document_id,
            source_version_id: v.source_version_id,
            extraction_version_id: v.extraction_version_id,
            annotation_version: v.annotation_version,
            approval_ids: [appr.body.approval_id],
            expected_previous_publication_id: null,
          });
        }
      }
    }

    // 3. Review Queue Item: Tax Ruling with ambiguous two-digit year AND OCR wrong section digit (`มาตรา 874` in Revenue Code) (Scenario 4)
    const rdFlawedText =
      "เลขที่หนังสือ กค 0702/9184 วันที่ 12 มี.ค. 68\nเรื่อง ภาษีเงินได้นิติบุคคล กรณีการควบรวมบริษัทตามมาตรา 874 แห่งประมวลรัษฎากร และอ้างถึง มาตรา ๕ โดยไม่ระบุชื่อกฎหมาย";
    const rdSha = sha256HexLower(rdFlawedText);
    const regRd = this.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "seed-rd-reg",
      document_id_override: "doc.th.rd.0702_9184",
      title_th: "หนังสือตอบข้อหารือกรมสรรพากร กค 0702/9184 (รอตรวจแก้เลขมาตรา 874 -> 74 และปี พ.ศ. ย่อ)",
      title_en: "Revenue Dept Ruling GorKor 0702/9184 (Blocking OCR Section Digit & Ambiguous Date in Review Queue)",
      source_category: "revenue_department_ruling",
      privacy_class: "public",
      expected_sha256: rdSha,
      publisher_asserted: "กรมสรรพากร (Revenue Department)",
      authority_status: "official_confirmed",
    });
    if (regRd.status === 201 && "source_version_id" in regRd.body) {
      this.finalizeSourceVersion({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-rd-fin",
        document_id: regRd.body.document_id,
        source_version_id: regRd.body.source_version_id,
        stored_sha256: rdSha,
        actual_mime_type: "application/pdf",
        byte_length: 96_200,
        pages_manifest: [
          {
            page_number: 1,
            image_sha256: sha256HexLower("rd-p1-img"),
            width_px: 2480,
            height_px: 3508,
            rotation_degrees: 0,
            has_visible_content: true,
            blank_detector_score: 0.01,
            native_pdf_text: null,
            rendered_reference_text: rdFlawedText,
          },
        ],
      });
      this.submitOcrJob({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-rd-job",
        document_id: regRd.body.document_id,
        source_version_id: regRd.body.source_version_id,
      });
    }

    // 4. Review Queue Item: Cross-page table with uncertain merged cells (Scenario 8 — zero fabricated geometry!)
    const tblP1 = "บัญชีอัตราอากรและสิทธิประโยชน์บัตรส่งเสริม บีโอไอ (หน้า ๑)\nหมวดกิจการดิจิทัลและคลาวด์";
    const tblP2 = "บัญชีอัตราอากรและสิทธิประโยชน์บัตรส่งเสริม บีโอไอ (ต่อ หน้า ๒)\nเงื่อนไขยกเว้นภาษีเงินได้นิติบุคคล ๘ ปี";
    const tblSha = sha256HexLower(`${tblP1}\n${tblP2}`);
    const regTbl = this.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "seed-tbl-reg",
      document_id_override: "doc.th.subreg.boi_table_2569",
      title_th: "ประกาศคณะกรรมการส่งเสริมการลงทุน บัญชีตารางข้ามหน้า (โครงสร้างเซลล์ผสานไม่แน่นอน — รอผู้ตรวจ)",
      title_en: "BOI Promotion Schedule Cross-Page Table (Uncertain Merged Cells — Blocked Pending Review)",
      source_category: "subordinate_legislation",
      privacy_class: "internal",
      expected_sha256: tblSha,
      publisher_asserted: "สำนักงานคณะกรรมการส่งเสริมการลงทุน (BOI)",
      authority_status: "official_confirmed",
    });
    if (regTbl.status === 201 && "source_version_id" in regTbl.body) {
      const p1Hash = sha256HexLower("boi-tbl-p1");
      const p2Hash = sha256HexLower("boi-tbl-p2");
      this.finalizeSourceVersion({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-tbl-fin",
        document_id: regTbl.body.document_id,
        source_version_id: regTbl.body.source_version_id,
        stored_sha256: tblSha,
        actual_mime_type: "application/pdf",
        byte_length: 184_000,
        pages_manifest: [
          {
            page_number: 1,
            image_sha256: p1Hash,
            width_px: 2480,
            height_px: 3508,
            rotation_degrees: 0,
            has_visible_content: true,
            blank_detector_score: 0.01,
            native_pdf_text: null,
            rendered_reference_text: tblP1,
          },
          {
            page_number: 2,
            image_sha256: p2Hash,
            width_px: 2480,
            height_px: 3508,
            rotation_degrees: 0,
            has_visible_content: true,
            blank_detector_score: 0.01,
            native_pdf_text: null,
            rendered_reference_text: tblP2,
          },
        ],
      });

      const tablePage1: OCRTable = {
        table_id: "tbl.boi.p1.1",
        page_number: 1,
        block_id: "blk.p1.2",
        structure_status: "partial",
        cells: [
          {
            row: 0,
            column: 0,
            row_span: 1,
            column_span: 2, // Merged header cell; polygon is explicitly `null` (never fabricated!)
            raw_text: "หมวดกิจการดิจิทัลและคลาวด์",
            span: { page_number: 1, block_id: "blk.p1.2", raw_start: 0, raw_end: 26, polygon: null },
          },
        ],
        markdown: null,
        issue_ids: [],
        continuation_to_table_id: "tbl.boi.p2.1",
      };
      const tablePage2: OCRTable = {
        table_id: "tbl.boi.p2.1",
        page_number: 2,
        block_id: "blk.p2.2",
        structure_status: "partial",
        cells: [
          {
            row: 0,
            column: 0,
            row_span: 1,
            column_span: 1,
            raw_text: "เงื่อนไขยกเว้นภาษีเงินได้นิติบุคคล ๘ ปี",
            span: { page_number: 2, block_id: "blk.p2.2", raw_start: 0, raw_end: 39, polygon: null },
          },
        ],
        markdown: null,
        issue_ids: [],
        continuation_from_table_id: "tbl.boi.p1.1",
      };

      this.submitOcrJob({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "seed-tbl-job",
        document_id: regTbl.body.document_id,
        source_version_id: regTbl.body.source_version_id,
        routing_override_provider_id: "mistral-ocr", // Provider without polygons -> verifies `polygon: null`!
        simulation: {
          ocr_page_tables_override: {
            1: [tablePage1],
            2: [tablePage2],
          },
        },
      });
    }
  }
}

export function createReg24OcrV2Service(options?: {
  seedFixtures?: boolean;
  flags?: Partial<OcrV2FeatureFlags>;
}): Reg24OcrV2Service {
  return new Reg24OcrV2Service(options);
}

export const reg24OcrV2Service = new Reg24OcrV2Service({ seedFixtures: true });
