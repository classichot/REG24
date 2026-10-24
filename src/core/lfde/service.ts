/**
 * REG24 Legal Form and Document Execution Engine (LFDE v2.0)
 * Application Service Layer — Shared across REG24 UI, REST (/api/v1/lfde) & MCP (/api/mcp)
 */

import {
  AgiAutomationLevel,
  AgiMissionExecution,
  AgiTopology,
  ApprovalGrant,
  AssembledBlock,
  AssetClassification,
  AuthoritySnapshot,
  ClauseVersion,
  DocumentCase,
  DownloadSession,
  DraftRevision,
  ExportArtifact,
  ExtractedRegionSpan,
  FactCandidate,
  FactSnapshot,
  FilingPackage,
  FilingProfileVersion,
  LfdeAuditEvent,
  LfdeErrorCode,
  LfdeException,
  LfdeJob,
  LfdeScope,
  LicensedOperation,
  LicenseGrant,
  LineageManifest,
  ReviewComment,
  ReviewDecision,
  ReviewRequest,
  RiskLevel,
  SourceAsset,
  Template,
  TemplateField,
  TemplateLifecycleState,
  TemplateVersion,
  TenantContext,
  ValidationFinding,
  ValidationRun,
  WorkflowTask,
} from "./types";
import {
  AuthorityGateway,
  evaluateExpression,
  formatDecimalExact,
  normalizeTypedFieldValue,
  RightsGateway,
  sha256Hex,
  signWebhookPayload,
  sumDecimalStrings,
  validateExpressionSchema,
  validateWebhookDestination,
} from "./adapters";
import {
  SEED_APPROVAL_GRANTS,
  SEED_CLAUSE_VERSIONS,
  SEED_FILING_PROFILES,
  SEED_LICENSE_GRANTS,
  SEED_SOURCE_ASSETS,
  SEED_TEMPLATE_VERSIONS,
  SEED_TEMPLATES,
} from "./fixtures";
import {
  LEGAL_FORMS_MASTER_CATALOG,
  type LegalFormsCatalogRecord,
} from "../data/legal-resource-master-loader";

interface UploadSessionRecord {
  id: string;
  tenant_id: string;
  created_by: string;
  original_name: string;
  declared_mime: string;
  declared_size: number;
  expected_sha256: string;
  storage_key: string;
  classification: AssetClassification;
  completed: boolean;
  created_at: string;
}

interface IdempotencyRecord {
  key: string;
  payload_hash: string;
  result: unknown;
  created_at: string;
}

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const CRITICAL_CONFIDENCE_FIELDS = new Set([
  "party_a.name",
  "party_b.name",
  "party_a.registration_number",
  "party_b.registration_number",
  "transaction.fee",
  "dates.effective_date",
  "signatory.evidence_ref",
]);

export class LfdeService {
  private uploadSessions = new Map<string, UploadSessionRecord>();
  private sourceAssets = new Map<string, SourceAsset>();
  private licenseGrants = new Map<string, LicenseGrant>();
  private templates = new Map<string, Template>();
  private templateVersions = new Map<string, TemplateVersion>();
  private clauseVersions = new Map<string, ClauseVersion>();
  private authoritySnapshots = new Map<string, AuthoritySnapshot>();
  private documentCases = new Map<string, DocumentCase>();
  private factCandidates = new Map<string, FactCandidate[]>();
  private factSnapshots = new Map<string, FactSnapshot>();
  private draftRevisions = new Map<string, DraftRevision>();
  private validationRuns = new Map<string, ValidationRun>();
  private reviewComments = new Map<string, ReviewComment[]>();
  private reviewRequests = new Map<string, ReviewRequest>();
  private reviewDecisions = new Map<string, ReviewDecision[]>();
  private exportArtifacts = new Map<string, ExportArtifact>();
  private downloadSessions = new Map<string, DownloadSession>();
  private filingProfiles = new Map<string, FilingProfileVersion>();
  private filingPackages = new Map<string, FilingPackage>();
  private jobs = new Map<string, LfdeJob>();
  private workflowTasks = new Map<string, WorkflowTask>();
  private auditEvents: LfdeAuditEvent[] = [];
  private approvalGrants = new Map<string, ApprovalGrant>();
  private idempotencyStore = new Map<string, IdempotencyRecord>();
  private revokedSubjects = new Set<string>();

  constructor() {
    this.seedInitialCatalog();
  }

  public resetAndSeed(): void {
    this.uploadSessions.clear();
    this.sourceAssets.clear();
    this.licenseGrants.clear();
    this.templates.clear();
    this.templateVersions.clear();
    this.clauseVersions.clear();
    this.authoritySnapshots.clear();
    this.documentCases.clear();
    this.factCandidates.clear();
    this.factSnapshots.clear();
    this.draftRevisions.clear();
    this.validationRuns.clear();
    this.reviewComments.clear();
    this.reviewRequests.clear();
    this.reviewDecisions.clear();
    this.exportArtifacts.clear();
    this.downloadSessions.clear();
    this.filingProfiles.clear();
    this.filingPackages.clear();
    this.jobs.clear();
    this.workflowTasks.clear();
    this.auditEvents = [];
    this.approvalGrants.clear();
    this.idempotencyStore.clear();
    this.revokedSubjects.clear();
    AuthorityGateway.setSimulatedTimeout(false);
    this.seedInitialCatalog();
  }

  private seedInitialCatalog(): void {
    for (const a of SEED_SOURCE_ASSETS) this.sourceAssets.set(a.id, { ...a });
    for (const g of SEED_LICENSE_GRANTS) this.licenseGrants.set(g.id, { ...g });
    for (const c of SEED_CLAUSE_VERSIONS) this.clauseVersions.set(c.id, { ...c });
    for (const tv of SEED_TEMPLATE_VERSIONS) {
      this.templateVersions.set(tv.id, JSON.parse(JSON.stringify(tv)));
    }
    for (const t of SEED_TEMPLATES) this.templates.set(t.id, { ...t, entitled_tenants: [...t.entitled_tenants] });
    for (const fp of SEED_FILING_PROFILES) this.filingProfiles.set(fp.id, { ...fp });
    for (const ag of SEED_APPROVAL_GRANTS) this.approvalGrants.set(ag.grant_id, { ...ag });
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 2: AUTHORIZATION, TENANT ISOLATION & AUDIT (LFDE-AC-001..004)
     ════════════════════════════════════════════════════════════════════════ */

  public verifyContext(
    ctx: TenantContext | null | undefined,
    requiredScope?: LfdeScope,
    bodyPayload?: Record<string, unknown>
  ): TenantContext {
    if (!ctx || !ctx.subject_id || !ctx.tenant_id) {
      throw new LfdeException({
        code: "UNAUTHENTICATED",
        safe_message: "Missing or invalid verified identity context (AT01).",
        correlation_id: ctx?.correlation_id || "unauth",
        retryable: false,
        http_status: 401,
      });
    }

    if (this.revokedSubjects.has(`${ctx.tenant_id}:${ctx.subject_id}`)) {
      throw new LfdeException({
        code: "FORBIDDEN",
        safe_message: "Tenant membership for subject has been revoked (LFDE-AC-004, AT33).",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 403,
      });
    }

    // AT03: Body tenant_id or client-supplied role must never override or differ from verified context
    if (bodyPayload) {
      if (
        typeof bodyPayload.tenant_id === "string" &&
        bodyPayload.tenant_id !== ctx.tenant_id
      ) {
        this.appendAudit(ctx, "auth.tenant_mismatch_denied", "tenant", String(bodyPayload.tenant_id), "rest");
        throw new LfdeException({
          code: "FORBIDDEN",
          safe_message: "Request body tenant_id conflicts with verified server membership (AT03).",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 403,
        });
      }
      if ("approver_role" in bodyPayload || "override_role" in bodyPayload) {
        throw new LfdeException({
          code: "FORBIDDEN",
          safe_message: "Client-supplied role elevation in request body is forbidden.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 403,
        });
      }
    }

    if (requiredScope && !ctx.scopes.includes(requiredScope)) {
      this.appendAudit(ctx, `auth.scope_denied:${requiredScope}`, "scope", requiredScope, "rest");
      throw new LfdeException({
        code: "FORBIDDEN",
        safe_message: `Insufficient permission: missing required scope '${requiredScope}'.`,
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 403,
      });
    }

    return ctx;
  }

  public revokeSubjectMembership(tenantId: string, subjectId: string): void {
    this.revokedSubjects.add(`${tenantId}:${subjectId}`);
  }

  public registerApprovalGrant(grant: ApprovalGrant): void {
    this.approvalGrants.set(grant.grant_id, { ...grant });
  }

  public registerLicenseGrant(grant: LicenseGrant): void {
    this.licenseGrants.set(grant.id, { ...grant });
  }

  public updateLicenseGrantStatus(
    grantId: string,
    status: LicenseGrant["status"],
    validTo?: string
  ): void {
    const g = this.licenseGrants.get(grantId);
    if (g) {
      g.status = status;
      if (validTo) g.valid_to = validTo;
      g.version += 1;
    }
  }

  private appendAudit(
    ctx: TenantContext,
    action: string,
    target_type: string,
    target_id: string,
    origin: LfdeAuditEvent["origin"] = "rest",
    before_hash?: string,
    after_hash?: string
  ): LfdeAuditEvent {
    const prevSig =
      this.auditEvents.length > 0
        ? this.auditEvents[this.auditEvents.length - 1].checkpoint_signature
        : "GENESIS_LFDE_V2";
    const ts = new Date().toISOString();
    const evId = `aud_${this.auditEvents.length + 1}_${sha256Hex(`${ctx.tenant_id}:${action}:${target_id}:${ts}`).slice(0, 8)}`;
    const checkpoint_signature = sha256Hex(
      `${prevSig}|${evId}|${ctx.tenant_id}|${ctx.subject_id}|${action}|${target_id}|${after_hash || ""}`
    );
    const ev: LfdeAuditEvent = {
      id: evId,
      tenant_id: ctx.tenant_id,
      actor_id: ctx.subject_id,
      delegated_actor_id: ctx.delegated_user_id,
      application_id: ctx.application_id,
      action,
      target_type,
      target_id,
      before_hash,
      after_hash,
      policy_version: "lfde-policy-v2.0",
      correlation_id: ctx.correlation_id,
      origin,
      timestamp: ts,
      checkpoint_signature,
    };
    this.auditEvents.push(ev);
    return ev;
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 11.4: IDEMPOTENCY & ETAG CONCURRENCY (AT22, AT25)
     ════════════════════════════════════════════════════════════════════════ */

  public executeIdempotent<T>(
    ctx: TenantContext,
    operation: string,
    idempotencyKey: string | undefined,
    payload: unknown,
    fn: () => T
  ): T {
    if (!idempotencyKey || !idempotencyKey.trim()) {
      throw new LfdeException({
        code: "MALFORMED_REQUEST",
        safe_message: "Idempotency-Key header is required for all LFDE mutations.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 400,
      });
    }
    const scopedKey = `${ctx.tenant_id}:${ctx.subject_id}:${operation}:${idempotencyKey.trim()}`;
    const payloadHash = sha256Hex(JSON.stringify(payload ?? {}));
    const existing = this.idempotencyStore.get(scopedKey);
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new LfdeException({
          code: "IDEMPOTENCY_CONFLICT",
          safe_message: "Idempotency-Key reused with a different request payload (AT22).",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 409,
        });
      }
      return existing.result as T;
    }
    const result = fn();
    this.idempotencyStore.set(scopedKey, {
      key: scopedKey,
      payload_hash: payloadHash,
      result,
      created_at: new Date().toISOString(),
    });
    return result;
  }

  private assertEtagMatch(ctx: TenantContext, currentEtag: string, ifMatchHeader?: string): void {
    if (!ifMatchHeader) {
      throw new LfdeException({
        code: "REVISION_CONFLICT",
        safe_message: "If-Match ETag header is required for concurrent state updates.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 409,
      });
    }
    if (ifMatchHeader !== currentEtag) {
      throw new LfdeException({
        code: "REVISION_CONFLICT",
        safe_message: `Concurrent modification detected: expected ETag ${currentEtag}, received ${ifMatchHeader} (AT25).`,
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 409,
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 3: UPLOAD, QUARANTINE, EXTRACTION & DUPLICATE HANDLING (AT05..AT09)
     ════════════════════════════════════════════════════════════════════════ */

  public createUploadSession(
    ctx: TenantContext,
    idempotencyKey: string,
    input: {
      original_name: string;
      mime: string;
      size: number;
      sha256: string;
      classification?: AssetClassification;
      tenant_id?: string;
    }
  ): UploadSessionRecord {
    this.verifyContext(ctx, "source:write", input as Record<string, unknown>);
    return this.executeIdempotent(ctx, "create_upload", idempotencyKey, input, () => {
      // Max 25 MiB default limit (Section 3.1)
      if (input.size > 25 * 1024 * 1024) {
        throw new LfdeException({
          code: "UPLOAD_TOO_LARGE",
          safe_message: "File exceeds default 25 MiB intake limit.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 413,
        });
      }

      const lowerName = input.original_name.toLowerCase();
      if (
        lowerName.endsWith(".exe") ||
        lowerName.endsWith(".bat") ||
        lowerName.endsWith(".docm") ||
        lowerName.endsWith(".xlsm") ||
        input.mime.includes("macroEnabled")
      ) {
        throw new LfdeException({
          code: "MALICIOUS_CONTENT_DETECTED",
          safe_message: "Executable and macro-enabled formats (.docm/.xlsm/.exe) are rejected (AT08).",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 415,
        });
      }

      const id = `upl_${sha256Hex(`${ctx.tenant_id}:${input.sha256}:${Date.now()}`).slice(0, 12)}`;
      const session: UploadSessionRecord = {
        id,
        tenant_id: ctx.tenant_id,
        created_by: ctx.subject_id,
        original_name: input.original_name,
        declared_mime: input.mime,
        declared_size: input.size,
        expected_sha256: input.sha256,
        storage_key: `s3://reg24-lfde-private/${ctx.tenant_id}/uploads/${id}`,
        classification: input.classification ?? "unknown",
        completed: false,
        created_at: new Date().toISOString(),
      };
      this.uploadSessions.set(id, session);
      this.appendAudit(ctx, "upload.session_created", "upload_session", id);
      return session;
    });
  }

  public completeUploadSession(
    ctx: TenantContext,
    idempotencyKey: string,
    sessionId: string,
    input: {
      measured_bytes: number;
      measured_sha256: string;
      page_count?: number;
      encrypted?: boolean;
      contains_macros?: boolean;
      contains_external_links?: boolean;
      zip_compression_ratio?: number;
      extracted_regions?: Array<{
        page_number: number;
        field_hint?: string;
        raw_text: string;
        confidence: number;
      }>;
      force_new_context?: boolean;
    }
  ): { asset: SourceAsset; deduplicated: boolean } {
    this.verifyContext(ctx, "source:write");
    const session = this.uploadSessions.get(sessionId);
    if (!session || session.tenant_id !== ctx.tenant_id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Upload session not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }

    return this.executeIdempotent(ctx, `complete_upload:${sessionId}`, idempotencyKey, input, () => {
      if (input.encrypted) {
        throw new LfdeException({
          code: "UNSUPPORTED_MEDIA_TYPE",
          safe_message: "Encrypted PDF/DOCX rejected. Please provide an unlocked copy (Section 3.1).",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      if ((input.page_count ?? 1) > 300) {
        throw new LfdeException({
          code: "UPLOAD_TOO_LARGE",
          safe_message: "PDF exceeds default 300-page intake limit.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 413,
        });
      }

      if (
        input.contains_macros ||
        input.contains_external_links ||
        (input.zip_compression_ratio ?? 1) > 80
      ) {
        throw new LfdeException({
          code: "MALICIOUS_CONTENT_DETECTED",
          safe_message:
            "Asset rejected during security scan: macros, external OOXML relationships, or ZIP decompression bomb detected (AT08).",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      if (input.measured_sha256 !== session.expected_sha256) {
        throw new LfdeException({
          code: "MALFORMED_REQUEST",
          safe_message: "Measured SHA-256 checksum does not match upload session declaration.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      // LFDE-003: Same tenant + same SHA-256 returns existing asset reference unless force_new_context
      if (!input.force_new_context) {
        for (const existing of this.sourceAssets.values()) {
          if (existing.tenant_id === ctx.tenant_id && existing.sha256 === input.measured_sha256) {
            return { asset: existing, deduplicated: true };
          }
        }
      }

      // Check if tenant has active license grant for this source; if not, quarantine (LFDE-LIC-001, AT05)
      const spans: ExtractedRegionSpan[] = (input.extracted_regions || []).map((r, idx) => {
        const isCriticalField = r.field_hint ? CRITICAL_CONFIDENCE_FIELDS.has(r.field_hint) : true;
        const threshold = isCriticalField ? 0.95 : 0.9;
        return {
          span_id: `span_${idx + 1}`,
          page_number: r.page_number,
          field_hint: r.field_hint,
          raw_text: r.raw_text,
          normalized_text: r.raw_text.trim(),
          confidence: r.confidence,
          bbox: [0, 0, 100, 20],
          ocr_engine_version: "reg24-thai-ocr-v2.4",
          language: "th",
          requires_human_confirmation: r.confidence < threshold || isCriticalField,
        };
      });

      const assetId = `src_${sha256Hex(`${ctx.tenant_id}:${input.measured_sha256}:${Date.now()}`).slice(0, 12)}`;
      const matchingGrants = Array.from(this.licenseGrants.values()).filter(
        (g) => g.source_id === assetId
      );
      const hasParseRights =
        matchingGrants.length > 0 &&
        RightsGateway.evaluateOperationRights(ctx, matchingGrants, "parse").allowed;

      const asset: SourceAsset = {
        id: assetId,
        tenant_id: ctx.tenant_id,
        kind: session.classification,
        original_name: session.original_name,
        mime: session.declared_mime,
        size: input.measured_bytes,
        page_count: input.page_count ?? 1,
        sha256: input.measured_sha256,
        storage_ref: session.storage_key,
        scan_state: hasParseRights ? "parsed" : "quarantined",
        parse_state: hasParseRights ? "completed" : "pending",
        privacy: "confidential",
        extracted_spans: spans,
        warnings: hasParseRights
          ? []
          : ["Asset quarantined: rights are unverified/unknown (LFDE-LIC-001, AT05)."],
        created_at: new Date().toISOString(),
        created_by: ctx.subject_id,
      };

      session.completed = true;
      this.sourceAssets.set(assetId, asset);
      this.appendAudit(ctx, "upload.completed", "source_asset", assetId, "rest", undefined, asset.sha256);
      return { asset, deduplicated: false };
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 4: TEMPLATE REGISTRY, CURATOR LIFECYCLE & RECOMMENDATIONS
     ════════════════════════════════════════════════════════════════════════ */

  public importWorkingTemplate(
    ctx: TenantContext,
    idempotencyKey: string,
    input: {
      source_id: string;
      title_th: string;
      title_en: string;
      domain: string;
      family: string;
      jurisdiction?: string;
      risk?: RiskLevel;
      fields?: TemplateField[];
    }
  ): { template: Template; version: TemplateVersion } {
    this.verifyContext(ctx, "template:curate", input as Record<string, unknown>);
    return this.executeIdempotent(ctx, "import_template", idempotencyKey, input, () => {
      const asset = this.sourceAssets.get(input.source_id);
      if (!asset || (asset.tenant_id !== ctx.tenant_id && asset.tenant_id !== "platform.catalog")) {
        throw new LfdeException({
          code: "NOT_FOUND",
          safe_message: "Source asset not found.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 404,
        });
      }

      // LFDE-IN-004: Secondary commentary cannot be converted into an approved legal template
      if (asset.kind === "secondary_commentary") {
        throw new LfdeException({
          code: "RIGHTS_DENIED",
          safe_message:
            "Secondary commentary / textbook cannot be converted into a legal template (LFDE-IN-004).",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      const grants = this.getGrantsForSource(asset.id);
      const parseCheck = RightsGateway.evaluateOperationRights(ctx, grants, "parse");
      if (!parseCheck.allowed) {
        // Create rights review task & block (LFDE-LIC-001, AT05)
        this.createWorkflowTask(
          ctx.tenant_id,
          "rights_review",
          asset.id,
          `rights_block:${asset.id}`,
          `Rights review required for ${asset.original_name}`,
          "curator.legal@reg24.th",
          [asset.id]
        );
        throw new LfdeException({
          code: "RIGHTS_UNVERIFIED",
          safe_message: parseCheck.reason,
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      // Validate all field expressions on import (Appendix A1)
      for (const f of input.fields || []) {
        if (f.required_when !== undefined) {
          validateExpressionSchema(f.required_when);
        }
      }

      const tplId = `tpl_${sha256Hex(`${ctx.tenant_id}:${input.title_th}:${Date.now()}`).slice(0, 10)}`;
      const verId = `${tplId}_v1_0_0`;
      const version: TemplateVersion = {
        id: verId,
        template_id: tplId,
        semver: "1.0.0",
        title_th: input.title_th,
        title_en: input.title_en,
        domain: input.domain,
        family: input.family,
        intended_task_th: input.title_th,
        intended_task_en: input.title_en,
        source_classification: asset.kind === "unknown" ? "purchased_precedent" : asset.kind,
        source_id: asset.id,
        jurisdiction: input.jurisdiction || "TH",
        language: "th",
        risk: input.risk || "medium",
        effective_from: new Date().toISOString().slice(0, 10),
        state: "classified",
        fields: input.fields || [],
        blocks: [
          {
            block_id: "blk_imported_1",
            type: "heading",
            title_th: input.title_th,
            title_en: input.title_en,
            template_text_th: input.title_th,
            field_refs: [],
            origin: "source_span",
            mandatory_by_rule: true,
          },
        ],
        allowed_clause_ids: [],
        authority_refs: ["th-ccc-sec-354"],
        renderer_profile_id: "render_th_sarabun_a4_v1",
        content_hash: sha256Hex(`${verId}:${asset.sha256}`),
        certification_checklist_passed: true,
      };

      const template: Template = {
        id: tplId,
        owner_type: "tenant_private",
        tenant_id: ctx.tenant_id,
        domain: input.domain,
        family: input.family,
        title_th: input.title_th,
        title_en: input.title_en,
        catalog_state: "classified",
        working_version_id: verId,
        entitled_tenants: [ctx.tenant_id],
        is_court_or_agency_form: asset.kind === "official_form",
        created_at: new Date().toISOString(),
        created_by: ctx.subject_id,
      };

      this.templateVersions.set(verId, version);
      this.templates.set(tplId, template);
      this.appendAudit(ctx, "template.imported", "template", tplId, "rest", undefined, version.content_hash);
      return { template, version };
    });
  }

  public transitionTemplateVersion(
    ctx: TenantContext,
    idempotencyKey: string,
    templateId: string,
    input: {
      version_id: string;
      target_state: TemplateLifecycleState;
      reason: string;
    }
  ): TemplateVersion {
    this.verifyContext(ctx);
    return this.executeIdempotent(
      ctx,
      `tpl_transition:${templateId}:${input.version_id}:${input.target_state}`,
      idempotencyKey,
      input,
      () => {
        if (ctx.is_service_account || ctx.role === "integration_service") {
          this.appendAudit(ctx, "template.transition_denied_service_account", "template_version", input.version_id);
          throw new LfdeException({
            code: "FORBIDDEN",
            safe_message: "Service accounts cannot approve or publish templates (LFDE-AC-002, AT04).",
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 403,
          });
        }

        const tpl = this.templates.get(templateId);
        const ver = this.templateVersions.get(input.version_id);
        if (!tpl || !ver || ver.template_id !== tpl.id) {
          throw new LfdeException({
            code: "NOT_FOUND",
            safe_message: "Template version not found.",
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 404,
          });
        }

        const grants = this.getGrantsForSource(ver.source_id);
        const cur = ver.state;
        const next = input.target_state;

        // Appendix B: State transition guards
        if (cur === "classified" && next === "legal_review") {
          const check = RightsGateway.evaluateOperationRights(ctx, grants, "parse");
          if (!check.allowed) {
            throw new LfdeException({
              code: "RIGHTS_DENIED",
              safe_message: check.reason,
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 422,
            });
          }
          ver.state = "legal_review";
        } else if (cur === "legal_review" && next === "approved") {
          if (!ctx.scopes.includes("template:review")) {
            throw new LfdeException({
              code: "FORBIDDEN",
              safe_message: "Requires 'template:review' scope.",
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 403,
            });
          }
          ver.state = "approved";
          ver.reviewer_decision_id = `tpl_rev_${Date.now()}`;
        } else if (cur === "approved" && next === "published") {
          if (!ctx.scopes.includes("template:publish")) {
            throw new LfdeException({
              code: "FORBIDDEN",
              safe_message: "Requires separate 'template:publish' grant (LFDE-AC-002).",
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 403,
            });
          }
          const pubRights = RightsGateway.evaluateOperationRights(ctx, grants, "template_publish");
          if (!pubRights.allowed) {
            throw new LfdeException({
              code: "RIGHTS_DENIED",
              safe_message: pubRights.reason,
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 422,
            });
          }
          ver.state = "published";
          ver.published_by = ctx.subject_id;
          ver.published_at = new Date().toISOString();
          tpl.catalog_state = "published";
          tpl.published_version_id = ver.id;
        } else if (next === "withdrawn") {
          ver.state = "withdrawn";
          ver.withdrawn_reason = input.reason;
          tpl.catalog_state = "withdrawn";
        } else {
          throw new LfdeException({
            code: "INVALID_TRANSITION",
            safe_message: `Illegal template version transition from '${cur}' to '${next}' (Appendix B).`,
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 409,
          });
        }

        this.appendAudit(ctx, `template.transition:${next}`, "template_version", ver.id);
        return ver;
      }
    );
  }

  public searchTemplates(
    ctx: TenantContext,
    filters?: {
      domain?: string;
      family?: string;
      objective?: string;
      jurisdiction?: string;
      risk?: RiskLevel;
      legal_as_of_date?: string;
    }
  ): {
    items: Array<{
      template: Template;
      version: TemplateVersion;
      scores: {
        intent_match_score: number;
        extraction_confidence: number;
        verification_status: "verified" | "unknown";
      };
      explanation_th: string;
      explanation_en: string;
    }>;
    coverage_gap?: {
      detected: boolean;
      message_th: string;
      message_en: string;
    };
  } {
    this.verifyContext(ctx, "template:read");
    const items: Array<{
      template: Template;
      version: TemplateVersion;
      scores: {
        intent_match_score: number;
        extraction_confidence: number;
        verification_status: "verified" | "unknown";
      };
      explanation_th: string;
      explanation_en: string;
    }> = [];

    const q = (filters?.objective || "").toLowerCase();

    for (const tpl of this.templates.values()) {
      // Filter for authorization and entitlements BEFORE ranking (LFDE-TPL-002)
      const entitled =
        tpl.entitled_tenants.includes("*") || tpl.entitled_tenants.includes(ctx.tenant_id);
      if (!entitled) continue;

      // AT16: Unapproved or withdrawn templates must never be recommended
      if (tpl.catalog_state !== "published" || !tpl.published_version_id) continue;
      const ver = this.templateVersions.get(tpl.published_version_id);
      if (!ver || ver.state !== "published") continue;

      if (filters?.domain && tpl.domain !== filters.domain) continue;
      if (filters?.family && tpl.family !== filters.family) continue;
      if (filters?.jurisdiction && ver.jurisdiction !== filters.jurisdiction) continue;
      if (filters?.risk && ver.risk !== filters.risk) continue;

      if (q) {
        const hay = `${ver.title_th} ${ver.title_en} ${ver.domain} ${ver.family} ${ver.intended_task_th} ${ver.intended_task_en}`.toLowerCase();
        if (
          !hay.includes(q) &&
          !(q.includes("nda") && ver.family === "nda") &&
          !(q.includes("ความลับ") && ver.family === "nda") &&
          !(q.includes("บริการ") && ver.family === "service_agreement") &&
          !(q.includes("service") && ver.family === "service_agreement") &&
          !(q.includes("เช่า") && ver.family === "lease") &&
          !(q.includes("lease") && ver.family === "lease") &&
          !(q.includes("ประชุม") && ver.family === "company_resolution")
        ) {
          continue;
        }
      }

      items.push({
        template: tpl,
        version: ver,
        scores: {
          intent_match_score: q ? 0.94 : 0.88,
          extraction_confidence: 0.98,
          verification_status: "verified",
        },
        explanation_th: `${ver.intended_task_th} · เขตอำนาจศาล ${ver.jurisdiction} · ระดับความเสี่ยง ${ver.risk.toUpperCase()}`,
        explanation_en: `${ver.intended_task_en} · Jurisdiction ${ver.jurisdiction} · Risk ${ver.risk.toUpperCase()}`,
      });
    }

    if (items.length === 0) {
      return {
        items: [],
        coverage_gap: {
          detected: true,
          message_th:
            "ไม่พบแม่แบบที่ผ่านการรับรองสำหรับวัตถุประสงค์นี้ ระบบแสดงช่องว่างความครอบคลุม (Coverage Gap) แทนการสร้างเอกสารที่ไม่ได้รับอนุมัติ",
          message_en:
            "No eligible approved template matches this scope. Explicit coverage gap returned rather than a fabricated form (Section 4.2).",
        },
      };
    }

    return { items: items.slice(0, 20) };
  }

  public ensureCatalogFormTemplateVersion(
    catalogIdOrVersionId: string,
    tenantId = "tenant.law24.prod"
  ): TemplateVersion | undefined {
    const existing = this.templateVersions.get(catalogIdOrVersionId);
    if (existing) return existing;

    const norm = catalogIdOrVersionId.trim().toLowerCase();
    const form: LegalFormsCatalogRecord | undefined = LEGAL_FORMS_MASTER_CATALOG.find(
      (f) =>
        f.id.toLowerCase() === norm ||
        f.code.toLowerCase() === norm ||
        (f.form_index_code || "").toLowerCase() === norm ||
        `template_${f.id.toLowerCase()}_v1` === norm ||
        (f.form_index_code && `template_${f.form_index_code.toLowerCase()}_v1` === norm)
    );
    if (!form) return undefined;

    const verId = form.form_index_code || form.id;
    if (this.templateVersions.has(verId)) {
      return this.templateVersions.get(verId);
    }

    const srcId = "src_asset_lform_master_2024_v41";
    const tplId = `tpl_${verId.toLowerCase()}`;

    const rawFields =
      form.fillable_fields && form.fillable_fields.length > 0
        ? form.fillable_fields.slice(0, 6)
        : ["โจทก์/ผู้ยื่น", "จำเลย/ผู้คัดค้าน", "รายละเอียดคำขอ"];

    const fields: TemplateField[] = [
      {
        version_id: verId,
        field_key: "party_a.name",
        label_th: rawFields[0] || "ชื่อผู้ยื่นคำร้อง / โจทก์",
        label_en: "Primary Party / Applicant Name",
        group: "parties",
        datatype: "text",
        required_when: true,
        evidence_policy: "human_confirmed",
        privacy_class: "confidential",
        format_profile: "plain_text",
        confirmation_policy: "always",
        why_needed_th: "ระบุตัวตนผู้ยื่นคำร้องหรือโจทก์ตามแบบพิมพ์",
        why_needed_en: "Identifies the applicant or plaintiff in the official form.",
      },
      {
        version_id: verId,
        field_key: "party_b.name",
        label_th: rawFields[1] || "ชื่อคู่กรณี / จำเลย / หน่วยงาน",
        label_en: "Counterparty / Respondent / Authority",
        group: "parties",
        datatype: "text",
        required_when: true,
        evidence_policy: "human_confirmed",
        privacy_class: "confidential",
        format_profile: "plain_text",
        confirmation_policy: "always",
        why_needed_th: "ระบุตัวตนคู่กรณีหรือจำเลยตามแบบพิมพ์",
        why_needed_en: "Identifies the respondent or counterparty in the official form.",
      },
      {
        version_id: verId,
        field_key: "signatory.evidence_ref",
        label_th: "เอกสารอ้างอิงอำนาจลงนาม / ใบแต่งทนายความ / ทะเบียนนิติบุคคล",
        label_en: "Signatory Authority / Counsel Appointment Reference",
        group: "signatures",
        datatype: "text",
        required_when: true,
        evidence_policy: "human_confirmed",
        privacy_class: "confidential",
        format_profile: "plain_text",
        confirmation_policy: "always",
        why_needed_th: "ระบุหลักฐานอำนาจลงนามหรือใบแต่งทนายความ",
        why_needed_en: "References signatory authority or counsel appointment.",
      },
    ];

    const bodyText =
      form.extracted_form_text ||
      `แบบฟอร์มมาตรฐาน ${form.title} (${form.authority_th})`;

    const version: TemplateVersion = {
      id: verId,
      template_id: tplId,
      semver: "4.1.0",
      title_th: `[${form.form_index_code || form.id}] ${form.title} (${form.category_folder})`,
      title_en: `[${form.form_index_code || form.id}] ${form.title} (${form.category_description_en})`,
      domain: form.category_code.toLowerCase(),
      family: "official_court_agency_form",
      intended_task_th: `กรอกและประกอบร่างแบบฟอร์ม ${form.title} (${form.authority_th}) สำหรับใช้งานภายในองค์กร`,
      intended_task_en: `Draft official form ${form.title} (${form.category_description_en}) — Internal Own-Use Only`,
      source_classification: "official_form",
      source_id: srcId,
      jurisdiction: "TH",
      language: "th",
      risk: "medium",
      effective_from: "2024-01-01",
      state: "published",
      strict_layout_lock: true,
      lform_catalog_id: form.form_index_code || form.id,
      drive_url: form.drive_url,
      fields,
      blocks: [
        {
          block_id: `blk_${verId.toLowerCase()}_header`,
          type: "heading",
          title_th: `${form.title} — ${form.authority_th}`,
          title_en: `${form.title} — ${form.category_description_en}`,
          template_text_th: `[แบบพิมพ์มาตรฐาน L FORM 2024 V.4.1 | รหัสสารบัญ ${form.form_index_code || form.id} | อนุญาตให้ใช้เฉพาะภายในองค์กร ห้ามเผยแพร่ภายนอก]\nหน่วยงาน/ศาล: ${form.authority_th}\nคู่ความฝ่ายที่ 1: {{party_a.name}} | คู่ความฝ่ายที่ 2: {{party_b.name}}\nหลักฐานผู้ลงนาม: {{signatory.evidence_ref}}`,
          template_text_en: `[Official Form ${form.form_index_code || form.id} — Internal Own-Use Only]\nAuthority: ${form.category_description_en}\nParty A: {{party_a.name}} | Party B: {{party_b.name}}\nSignatory Ref: {{signatory.evidence_ref}}`,
          field_refs: ["party_a.name", "party_b.name", "signatory.evidence_ref"],
          origin: "source_span",
          mandatory_by_rule: true,
        },
        {
          block_id: `blk_${verId.toLowerCase()}_body`,
          type: "heading",
          title_th: "ข้อความและช่องกรอกตามแบบพิมพ์ต้นฉบับ (Extracted Form Structure)",
          title_en: "Extracted Official Form Structure & Clauses",
          template_text_th: bodyText,
          template_text_en: bodyText,
          field_refs: [],
          origin: "source_span",
          mandatory_by_rule: true,
        },
      ],
      allowed_clause_ids: [],
      authority_refs: ["th-ccc-sec-1097"],
      renderer_profile_id: "render_th_sarabun_a4_v1",
      content_hash: form.sha256,
      certification_checklist_passed: true,
      published_by: "curator.legal@reg24.th",
      published_at: "2026-10-25T00:00:00Z",
    };

    const template: Template = {
      id: tplId,
      owner_type: "tenant_private",
      tenant_id: tenantId,
      domain: form.category_code.toLowerCase(),
      family: "official_court_agency_form",
      title_th: version.title_th,
      title_en: version.title_en,
      catalog_state: "published",
      published_version_id: verId,
      working_version_id: verId,
      entitled_tenants: [tenantId],
      is_court_or_agency_form: true,
      created_at: "2026-10-25T00:00:00Z",
      created_by: "curator.legal@reg24.th",
    };

    this.templates.set(tplId, template);
    this.templateVersions.set(verId, version);
    return version;
  }

  public getTemplateVersion(
    ctx: TenantContext,
    templateId: string,
    versionId: string
  ): TemplateVersion {
    this.verifyContext(ctx, "template:read");
    if (!this.templateVersions.has(versionId)) {
      this.ensureCatalogFormTemplateVersion(versionId, ctx.tenant_id);
    }
    const ver = this.templateVersions.get(versionId);
    const tpl = ver ? this.templates.get(ver.template_id) || this.templates.get(templateId) : undefined;
    if (
      !tpl ||
      !ver ||
      (!tpl.entitled_tenants.includes("*") && !tpl.entitled_tenants.includes(ctx.tenant_id))
    ) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Template version not found or not entitled.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }
    return ver;
  }

  public listClauses(ctx: TenantContext, templateVersionId?: string): ClauseVersion[] {
    this.verifyContext(ctx, "clause:read");
    const list = Array.from(this.clauseVersions.values()).filter(
      (c) => c.approval_status === "approved"
    );
    if (!templateVersionId) return list;
    return list.filter((c) => c.compatible_templates.includes(templateVersionId));
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 7: ADAPTIVE FACT INTAKE, DOCUMENT CREATION & ASSEMBLY
     ════════════════════════════════════════════════════════════════════════ */

  public createDocumentCase(
    ctx: TenantContext,
    idempotencyKey: string,
    input: {
      matter_id: string;
      template_version_id: string;
      objective: string;
      language?: "th" | "en" | "bilingual";
      legal_as_of_date?: string;
      transaction_date?: string;
      intended_filing_date?: string;
      external_reference_id?: string;
      tenant_id?: string;
    }
  ): {
    document: DocumentCase;
    required_fact_keys: string[];
    permitted_actions: string[];
  } {
    this.verifyContext(ctx, "document:create", input as Record<string, unknown>);
    return this.executeIdempotent(ctx, "create_document", idempotencyKey, input, () => {
      if (
        !ctx.matter_grants.includes("*") &&
        !ctx.matter_grants.includes(input.matter_id)
      ) {
        throw new LfdeException({
          code: "FORBIDDEN",
          safe_message: `Subject is not authorized for matter '${input.matter_id}'.`,
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 403,
        });
      }

      const ver =
        this.templateVersions.get(input.template_version_id) ||
        this.ensureCatalogFormTemplateVersion(input.template_version_id, ctx.tenant_id);
      if (!ver) {
        throw new LfdeException({
          code: "NOT_FOUND",
          safe_message: "Template version not found.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 404,
        });
      }

      // AT16: Block draft creation from unapproved or withdrawn templates
      if (ver.state !== "published") {
        throw new LfdeException({
          code: "INVALID_TRANSITION",
          safe_message: `Template version '${ver.id}' is in state '${ver.state}' and cannot be used for new draft generation (AT16).`,
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      // Evaluate license rights for draft_generate (LFDE-LIC-002, AT07)
      const grants = this.getGrantsForSource(ver.source_id);
      const genRights = RightsGateway.evaluateOperationRights(ctx, grants, "draft_generate");
      if (!genRights.allowed) {
        throw new LfdeException({
          code: "RIGHTS_DENIED",
          safe_message: genRights.reason,
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      const docId = `doc_${sha256Hex(`${ctx.tenant_id}:${input.matter_id}:${Date.now()}:${Math.random()}`).slice(0, 12)}`;
      const nowIso = new Date().toISOString();
      const today = nowIso.slice(0, 10);

      const doc: DocumentCase = {
        id: docId,
        tenant_id: ctx.tenant_id,
        matter_id: input.matter_id,
        template_id: ver.template_id,
        template_version_id: ver.id,
        title_th: ver.title_th,
        title_en: ver.title_en,
        objective: input.objective,
        language: input.language || ver.language,
        state: "collecting_facts",
        readiness: "incomplete",
        selected_clause_ids: ver.blocks
          .map((b) => b.clause_id)
          .filter((cid): cid is string => Boolean(cid)),
        legal_dates: {
          transaction_date: input.transaction_date || today,
          legal_as_of_date: input.legal_as_of_date || today,
          drafting_date: today,
          intended_filing_date: input.intended_filing_date,
        },
        external_reference_id: input.external_reference_id,
        application_id: ctx.application_id,
        lock_version: 1,
        etag: `W/"doc-${docId}-v1"`,
        status_advisories: [],
        created_at: nowIso,
        created_by: ctx.subject_id,
        updated_at: nowIso,
      };

      this.documentCases.set(docId, doc);
      this.factCandidates.set(docId, []);
      this.reviewComments.set(docId, []);
      this.reviewDecisions.set(docId, []);
      this.appendAudit(ctx, "document.created", "document", docId, "rest", undefined, doc.etag);

      return {
        document: doc,
        required_fact_keys: ver.fields.map((f) => f.field_key),
        permitted_actions: ["update_facts", "assemble", "validate"],
      };
    });
  }

  public getDocumentCase(ctx: TenantContext, documentId: string): DocumentCase {
    this.verifyContext(ctx, "document:read");
    const doc = this.documentCases.get(documentId);
    // AT02 & AT35: Cross-tenant or nonexistent ID returns 404 without leaking existence
    if (
      !doc ||
      doc.tenant_id !== ctx.tenant_id ||
      (!ctx.matter_grants.includes("*") && !ctx.matter_grants.includes(doc.matter_id))
    ) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Document case not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }
    return doc;
  }

  public listDocumentCases(ctx: TenantContext): DocumentCase[] {
    this.verifyContext(ctx, "document:read");
    return Array.from(this.documentCases.values())
      .filter(
        (d) =>
          d.tenant_id === ctx.tenant_id &&
          (ctx.matter_grants.includes("*") || ctx.matter_grants.includes(d.matter_id))
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  public getDocumentFacts(ctx: TenantContext, documentId: string): FactCandidate[] {
    const doc = this.getDocumentCase(ctx, documentId);
    return this.factCandidates.get(doc.id) || [];
  }

  public updateDocumentFacts(
    ctx: TenantContext,
    idempotencyKey: string,
    documentId: string,
    ifMatchHeader: string,
    input: {
      changes: Array<{
        field_key: string;
        value: unknown;
        datatype?: TemplateField["datatype"];
        calendar?: "BE" | "CE";
        source_evidence_id?: string;
        confidence?: number;
        action: "propose_candidate" | "confirm_candidate" | "resolve_conflict";
        candidate_id?: string;
        conflict_resolution_reason?: string;
      }>;
      selected_clause_ids?: string[];
    }
  ): {
    document: DocumentCase;
    candidates: FactCandidate[];
  } {
    this.verifyContext(ctx, "document:edit");
    const doc = this.getDocumentCase(ctx, documentId);
    this.assertEtagMatch(ctx, doc.etag, ifMatchHeader);

    return this.executeIdempotent(
      ctx,
      `update_facts:${documentId}:${doc.lock_version}`,
      idempotencyKey,
      input,
      () => {
        const ver = this.templateVersions.get(doc.template_version_id)!;
        const list = this.factCandidates.get(doc.id) || [];

        for (const ch of input.changes) {
          const fieldDef = ver.fields.find((f) => f.field_key === ch.field_key);
          const dt = ch.datatype || fieldDef?.datatype || "text";
          const normalized = normalizeTypedFieldValue(dt, ch.value, {
            calendar: ch.calendar,
            rounding: fieldDef?.constraints?.rounding,
            currency: fieldDef?.constraints?.currency,
          });

          const conf = ch.confidence ?? 1.0;
          const isCrit = CRITICAL_CONFIDENCE_FIELDS.has(ch.field_key);
          const minConf = isCrit ? 0.95 : 0.9;

          if (ch.action === "confirm_candidate" && ch.candidate_id) {
            const target = list.find((c) => c.id === ch.candidate_id && c.case_id === doc.id);
            if (!target) {
              throw new LfdeException({
                code: "NOT_FOUND",
                safe_message: `Candidate ${ch.candidate_id} not found on this document case.`,
                correlation_id: ctx.correlation_id,
                retryable: false,
                http_status: 404,
              });
            }
            const targetHash = sha256Hex(JSON.stringify(target.typed_value));
            const submittedHash = sha256Hex(JSON.stringify(normalized.typed_value));
            if (targetHash !== submittedHash) {
              // Appendix A3: Mismatch creates a proposed new value rather than falsely confirming the old one
              const newCand: FactCandidate = {
                id: `cand_${list.length + 1}_${Date.now()}`,
                tenant_id: ctx.tenant_id,
                case_id: doc.id,
                field_key: ch.field_key,
                typed_value: normalized.typed_value,
                original_representation: normalized.original_representation,
                calendar_used: normalized.calendar_used,
                source_evidence_id: ch.source_evidence_id,
                confidence: conf,
                assertion_state: "asserted",
                asserted_by: ctx.subject_id,
                created_at: new Date().toISOString(),
              };
              list.push(newCand);
            } else {
              target.assertion_state = "confirmed";
              target.confirmed_by = ctx.subject_id;
              target.confirmed_at = new Date().toISOString();
              target.confirmed_value_hash = targetHash;
            }
          } else if (ch.action === "resolve_conflict") {
            if (!ch.conflict_resolution_reason || !ch.source_evidence_id) {
              throw new LfdeException({
                code: "FACTS_INCOMPLETE",
                safe_message: "Conflict resolution requires both reason and evidence reference (LFDE-FACT-001).",
                correlation_id: ctx.correlation_id,
                retryable: false,
                http_status: 422,
              });
            }
            // Mark prior candidates for this field as superseded/asserted and confirm the resolved one
            for (const existing of list) {
              if (existing.field_key === ch.field_key) {
                existing.assertion_state = "asserted";
              }
            }
            const valHash = sha256Hex(JSON.stringify(normalized.typed_value));
            list.push({
              id: `cand_${list.length + 1}_${Date.now()}`,
              tenant_id: ctx.tenant_id,
              case_id: doc.id,
              field_key: ch.field_key,
              typed_value: normalized.typed_value,
              original_representation: normalized.original_representation,
              calendar_used: normalized.calendar_used,
              source_evidence_id: ch.source_evidence_id,
              confidence: 1.0,
              assertion_state: "confirmed",
              asserted_by: ctx.subject_id,
              confirmed_by: ctx.subject_id,
              confirmed_at: new Date().toISOString(),
              confirmed_value_hash: valHash,
              conflict_reason: ch.conflict_resolution_reason,
              created_at: new Date().toISOString(),
            });
          } else {
            // Propose or confirm new candidate
            // Check if another active candidate for the same field_key has a different value -> conflict (AT10)
            const existingForField = list.filter((c) => c.field_key === ch.field_key);
            const valHash = sha256Hex(JSON.stringify(normalized.typed_value));
            const hasDisagreement = existingForField.some(
              (c) => sha256Hex(JSON.stringify(c.typed_value)) !== valHash
            );

            let state: FactCandidate["assertion_state"] = "asserted";
            if (hasDisagreement && ch.action === "propose_candidate") {
              state = "conflicted";
              for (const ex of existingForField) {
                ex.assertion_state = "conflicted";
              }
            } else if (ch.action === "confirm_candidate") {
              // AT09: Low-confidence extracted text cannot be silently confirmed without explicit confirmation
              if (conf < minConf && !ch.source_evidence_id) {
                state = "extracted";
              } else {
                state = "confirmed";
              }
            } else if (conf < minConf) {
              state = "extracted";
            }

            list.push({
              id: `cand_${list.length + 1}_${Date.now()}`,
              tenant_id: ctx.tenant_id,
              case_id: doc.id,
              field_key: ch.field_key,
              typed_value: normalized.typed_value,
              original_representation: normalized.original_representation,
              calendar_used: normalized.calendar_used,
              source_evidence_id: ch.source_evidence_id,
              confidence: conf,
              assertion_state: state,
              asserted_by: ctx.subject_id,
              confirmed_by: state === "confirmed" ? ctx.subject_id : undefined,
              confirmed_at: state === "confirmed" ? new Date().toISOString() : undefined,
              confirmed_value_hash: state === "confirmed" ? valHash : undefined,
              created_at: new Date().toISOString(),
            });
          }
        }

        if (input.selected_clause_ids) {
          doc.selected_clause_ids = [...input.selected_clause_ids];
        }

        this.factCandidates.set(doc.id, list);

        // AT26: Editing facts or clauses after review/approval invalidates previous validation & approval
        if (
          doc.state === "review_ready" ||
          doc.state === "in_review" ||
          doc.state === "approved"
        ) {
          doc.state = "collecting_facts";
          doc.readiness = "incomplete";
          if (doc.latest_review_request_id) {
            const rr = this.reviewRequests.get(doc.latest_review_request_id);
            if (rr) rr.state = "stale";
          }
        }

        doc.lock_version += 1;
        doc.etag = `W/"doc-${doc.id}-v${doc.lock_version}"`;
        doc.updated_at = new Date().toISOString();

        this.appendAudit(ctx, "document.facts_updated", "document", doc.id, "rest", undefined, doc.etag);
        return { document: doc, candidates: list };
      }
    );
  }

  public assembleDocument(
    ctx: TenantContext,
    idempotencyKey: string,
    documentId: string,
    input: {
      mode?: "deterministic" | "hybrid";
      allow_ai_proposals?: boolean;
      ai_proposed_note_th?: string;
      expected_authority_topic?: string;
      simulate_renderer_missing_font?: boolean;
    }
  ): {
    job: LfdeJob;
    revision: DraftRevision;
    validation: ValidationRun;
    document: DocumentCase;
  } {
    this.verifyContext(ctx, "document:edit");
    const doc = this.getDocumentCase(ctx, documentId);

    return this.executeIdempotent(
      ctx,
      `assemble:${documentId}:${doc.lock_version}:${JSON.stringify(input)}`,
      idempotencyKey,
      input,
      () => {
        const ver = this.templateVersions.get(doc.template_version_id)!;

        // Re-evaluate rights at worker execution time (LFDE-AC-004, AT07)
        const sourceIds = new Set<string>([ver.source_id]);
        for (const cid of doc.selected_clause_ids) {
          const cv = this.clauseVersions.get(cid);
          if (cv) sourceIds.add(cv.source_id);
        }
        const allGrants: LicenseGrant[] = [];
        for (const sid of sourceIds) {
          allGrants.push(...this.getGrantsForSource(sid));
        }

        const rightCheck = RightsGateway.evaluateOperationRights(ctx, allGrants, "draft_generate");
        if (!rightCheck.allowed) {
          throw new LfdeException({
            code: "RIGHTS_DENIED",
            safe_message: rightCheck.reason,
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 422,
          });
        }

        const candidates = this.factCandidates.get(doc.id) || [];

        // Check for unresolved fact conflicts (AT10)
        const conflicted = candidates.filter((c) => c.assertion_state === "conflicted");
        if (conflicted.length > 0) {
          throw new LfdeException({
            code: "FACT_CONFLICT",
            safe_message: `Cannot finalize assembly while conflicting values exist for field '${conflicted[0].field_key}' (AT10).`,
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 422,
          });
        }

        // Check mutually exclusive clauses (Appendix D Rule R005)
        for (const cid of doc.selected_clause_ids) {
          const cv = this.clauseVersions.get(cid);
          if (cv?.mutually_exclusive_with) {
            const clash = cv.mutually_exclusive_with.find((ex) =>
              doc.selected_clause_ids.includes(ex)
            );
            if (clash) {
              throw new LfdeException({
                code: "MALFORMED_REQUEST",
                safe_message: `Rule R005 OPTIONAL_CLAUSE_CONFLICT: Clause '${cid}' and '${clash}' are mutually exclusive.`,
                correlation_id: ctx.correlation_id,
                retryable: false,
                http_status: 422,
              });
            }
          }
        }

        // Build frozen FactSnapshot from confirmed candidates
        const resolvedValues: FactSnapshot["resolved_values"] = {};
        const plainFacts: Record<string, unknown> = {};
        const includedIds: string[] = [];

        for (const c of candidates) {
          if (c.assertion_state === "confirmed") {
            const valStr =
              typeof c.typed_value === "object" && c.typed_value !== null && "amount" in c.typed_value
                ? String((c.typed_value as { amount: string }).amount)
                : String(c.typed_value ?? "");
            resolvedValues[c.field_key] = {
              typed_value: c.typed_value,
              original_representation: c.original_representation,
              confirmed_by: c.confirmed_by,
              confirmed_at: c.confirmed_at,
              value_hash: c.confirmed_value_hash || sha256Hex(valStr),
            };
            plainFacts[c.field_key] =
              typeof c.typed_value === "object" && c.typed_value !== null && "amount" in c.typed_value
                ? (c.typed_value as { amount: string }).amount
                : c.typed_value;
            includedIds.push(c.id);
          }
        }

        const factSnapContentHash = sha256Hex(
          JSON.stringify(
            Object.keys(resolvedValues)
              .sort()
              .map((k) => [k, resolvedValues[k].value_hash])
          )
        );
        const factSnap: FactSnapshot = {
          id: `fsnap_${factSnapContentHash.slice(0, 12)}`,
          tenant_id: ctx.tenant_id,
          case_id: doc.id,
          included_candidate_ids: includedIds,
          resolved_values: resolvedValues,
          content_hash: factSnapContentHash,
          created_at: new Date().toISOString(),
        };
        this.factSnapshots.set(factSnap.id, factSnap);

        // Resolve AuthoritySnapshot via REG24 AuthorityGateway (Section 6)
        const authSnap = AuthorityGateway.resolve({
          tenant_id: ctx.tenant_id,
          canonical_ids: ver.authority_refs,
          legal_as_of_date: doc.legal_dates.legal_as_of_date,
          transaction_date: doc.legal_dates.transaction_date,
          drafting_date: doc.legal_dates.drafting_date,
          intended_filing_date: doc.legal_dates.intended_filing_date,
          expected_topic: input.expected_authority_topic,
        });
        this.authoritySnapshots.set(authSnap.id, authSnap);

        // Assemble blocks deterministically
        const assembledBlocks: AssembledBlock[] = [];
        const visibleBlockIds = new Set<string>();

        ver.blocks.forEach((blk, idx) => {
          const vis = evaluateExpression(blk.visible_when, plainFacts);
          if (vis === "false") return;

          visibleBlockIds.add(blk.block_id);
          let textTh = blk.template_text_th;
          let textEn = blk.template_text_en || blk.template_text_th;

          for (const fk of blk.field_refs) {
            const val = plainFacts[fk];
            const replacement = val !== undefined && val !== null && val !== "" ? String(val) : `[[MISSING:${fk}]]`;
            textTh = textTh.replace(new RegExp(`\\{\\{${fk}\\}\\}`, "g"), replacement);
            textEn = textEn.replace(new RegExp(`\\{\\{${fk}\\}\\}`, "g"), replacement);
          }

          // If block has a selected clause override
          let activeClauseId = blk.clause_id;
          for (const selCid of doc.selected_clause_ids) {
            const cv = this.clauseVersions.get(selCid);
            if (cv && blk.clause_id && cv.clause_id.startsWith("clause.nda.survival") && blk.block_id === "blk_nda_survival") {
              activeClauseId = selCid;
              textTh = cv.text_th;
              textEn = cv.text_en;
            }
          }

          assembledBlocks.push({
            block_id: blk.block_id,
            number_label: `${idx + 1}`,
            type: blk.type,
            title_th: blk.title_th,
            title_en: blk.title_en,
            rendered_text_th: textTh,
            rendered_text_en: textEn,
            origin: blk.origin,
            field_refs: blk.field_refs,
            clause_version_id: activeClauseId,
            authority_refs: blk.authority_refs || [],
            mandatory_by_rule: Boolean(blk.mandatory_by_rule),
          });
        });

        // Deterministic canonical tree hash (AT21)
        const canonicalTreePayload = JSON.stringify({
          template_version_id: ver.id,
          fact_hash: factSnap.content_hash,
          selected_clauses: [...doc.selected_clause_ids].sort(),
          blocks: assembledBlocks.map((b) => ({
            id: b.block_id,
            th: b.rendered_text_th,
            clause: b.clause_version_id,
          })),
        });
        const contentHash = sha256Hex(canonicalTreePayload);

        const existingRevs = Array.from(this.draftRevisions.values()).filter(
          (r) => r.case_id === doc.id
        );
        const revNum = existingRevs.length + 1;
        const revId = `rev_${doc.id}_n${revNum}_${contentHash.slice(0, 8)}`;

        const revision: DraftRevision = {
          id: revId,
          tenant_id: ctx.tenant_id,
          case_id: doc.id,
          revision_number: revNum,
          parent_revision_id: doc.current_revision_id,
          template_version_id: ver.id,
          fact_snapshot_id: factSnap.id,
          authority_snapshot_id: authSnap.id,
          selected_clause_version_ids: [...doc.selected_clause_ids],
          assembled_blocks: assembledBlocks,
          content_hash: contentHash,
          renderer_profile_id: ver.renderer_profile_id,
          docx_fingerprint: sha256Hex(`docx:${contentHash}:${ver.renderer_profile_id}`),
          pdf_fingerprint: sha256Hex(`pdf:${contentHash}:${ver.renderer_profile_id}`),
          accepted_ai_proposal_hashes: input.ai_proposed_note_th
            ? [sha256Hex(input.ai_proposed_note_th)]
            : [],
          created_at: new Date().toISOString(),
          created_by: ctx.subject_id,
        };
        this.draftRevisions.set(revId, revision);
        doc.current_revision_id = revId;

        const validation = this.runLayeredValidation(ctx, doc, revision, ver, plainFacts, visibleBlockIds, authSnap, {
          simulateMissingFont: input.simulate_renderer_missing_font,
        });

        const jobId = `job_asm_${revId}`;
        const job: LfdeJob = {
          id: jobId,
          tenant_id: ctx.tenant_id,
          operation_key: `assemble:${revId}`,
          type: "assemble",
          target_id: doc.id,
          state: "succeeded",
          stage: "completed",
          percent: 100,
          attempts: 1,
          input_hash: factSnap.content_hash,
          result_ref: revId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.jobs.set(jobId, job);

        this.appendAudit(ctx, "document.assembled", "draft_revision", revId, "worker", undefined, contentHash);
        return { job, revision, validation, document: doc };
      }
    );
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 8.1 & APPENDIX D: LAYERED VALIDATION ENGINE (R001..R006)
     ════════════════════════════════════════════════════════════════════════ */

  public runLayeredValidation(
    ctx: TenantContext,
    doc: DocumentCase,
    revision: DraftRevision,
    ver: TemplateVersion,
    plainFacts: Record<string, unknown>,
    visibleBlockIds: Set<string>,
    authSnap: AuthoritySnapshot,
    options?: { simulateMissingFont?: boolean }
  ): ValidationRun {
    const runId = `val_${revision.id}_${Date.now()}`;
    const findings: ValidationFinding[] = [];

    // 1. Check required fields & unknown condition dependencies (AT11, AT14, R001, R003)
    for (const f of ver.fields) {
      const reqEval = evaluateExpression(f.required_when, plainFacts);
      if (reqEval === "unknown") {
        findings.push({
          finding_id: `fnd_${findings.length + 1}`,
          run_id: runId,
          rule_id: "SCH_CONDITION_UNKNOWN",
          rule_version: "1.0.0",
          layer: "Schema",
          severity: "blocker",
          target_block_or_field: f.field_key,
          explanation_th: `เงื่อนไขการแสดงผลของฟิลด์ '${f.label_th}' มีสถานะเป็น UNKNOWN เนื่องจากยังไม่ได้ระบุฟิลด์ต้นทาง (AT14)`,
          explanation_en: `Required condition for field '${f.field_key}' evaluated to UNKNOWN due to missing dependency (AT14).`,
          remediation_th: "กรุณาระบุข้อมูลฟิลด์เงื่อนไขต้นทางให้ครบถ้วน",
          remediation_en: "Provide the missing condition dependency field.",
          evidence_refs: [],
          overridable: false,
          state: "open",
        });
      } else if (reqEval === "true") {
        const val = plainFacts[f.field_key];
        if (val === undefined || val === null || val === "") {
          const isPartyName = f.field_key === "party_a.name" || f.field_key === "party_b.name";
          const isSignatory = f.field_key === "signatory.evidence_ref";
          findings.push({
            finding_id: `fnd_${findings.length + 1}`,
            run_id: runId,
            rule_id: isPartyName
              ? "R001_REQUIRED_PARTY_NAME"
              : isSignatory
              ? "R003_SIGNATORY_EVIDENCE_MISSING"
              : "FACT_REQUIRED_MISSING",
            rule_version: "1.0.0",
            layer: isPartyName || isSignatory ? "Facts" : "Schema",
            severity: "blocker",
            target_block_or_field: f.field_key,
            explanation_th: `ยังไม่ได้ระบุและยืนยันข้อมูลที่จำเป็น: ${f.label_th} (${f.why_needed_th})`,
            explanation_en: `Missing required confirmed fact: ${f.field_key} (${f.why_needed_en}) (AT11).`,
            remediation_th: `กรุณากรอกและกดยืนยันข้อมูลในฟิลด์ ${f.label_th}`,
            remediation_en: `Enter and confirm '${f.field_key}'.`,
            evidence_refs: [],
            overridable: false,
            state: "open",
          });
        }
      }
    }

    // 2. Rule R002 PAYMENT_TOTAL_MISMATCH (Exact decimal sum check, AT13)
    if (
      plainFacts["transaction.paid"] === true &&
      plainFacts["transaction.fee"] &&
      plainFacts["transaction.installment_1"] &&
      plainFacts["transaction.installment_2"]
    ) {
      const totalFee = formatDecimalExact(String(plainFacts["transaction.fee"]), 2, "HALF_UP");
      const instSum = sumDecimalStrings(
        [
          String(plainFacts["transaction.installment_1"]),
          String(plainFacts["transaction.installment_2"]),
        ],
        2,
        "HALF_UP"
      );
      if (totalFee !== instSum) {
        findings.push({
          finding_id: `fnd_${findings.length + 1}`,
          run_id: runId,
          rule_id: "R002_PAYMENT_TOTAL_MISMATCH",
          rule_version: "1.0.0",
          layer: "Consistency",
          severity: "blocker",
          target_block_or_field: "transaction.fee",
          explanation_th: `ผลรวมค่าบริการรายงวด (${instSum} บาท) ไม่ตรงกับค่าบริการรวมทั้งสิ้น (${totalFee} บาท)`,
          explanation_en: `Installment sum (${instSum} THB) does not equal Total Service Fee (${totalFee} THB) (Rule R002).`,
          remediation_th: "ปรับปรุงยอดเงินงวดที่ 1 และงวดที่ 2 ให้เท่ากับยอดรวม",
          remediation_en: "Reconcile installment amounts with the total service fee.",
          evidence_refs: ["transaction.fee", "transaction.installment_1", "transaction.installment_2"],
          overridable: false,
          state: "open",
        });
      }
    }

    // 3. Historical vs Current CCC Sec. 1097 Promoter count check (AT17)
    if (ver.id === "template_demo_board_res_v1" && plainFacts["transaction.promoter_count"] !== undefined) {
      const count = Number(plainFacts["transaction.promoter_count"]);
      const isHistoricalPre2023 = doc.legal_dates.transaction_date < "2023-02-07";
      const minRequired = isHistoricalPre2023 ? 3 : 2;
      if (count < minRequired) {
        findings.push({
          finding_id: `fnd_${findings.length + 1}`,
          run_id: runId,
          rule_id: "CORP_PROMOTER_MINIMUM",
          rule_version: "1.0.0",
          layer: "Authority",
          severity: "blocker",
          target_block_or_field: "transaction.promoter_count",
          explanation_th: `ธุรกรรม ณ วันที่ ${doc.legal_dates.transaction_date} ต้องมีผู้เริ่มก่อการอย่างน้อย ${minRequired} คน ตาม ป.พ.พ. มาตรา 1097 ที่ใช้บังคับในขณะนั้น (ระบุไว้ ${count} คน)`,
          explanation_en: `Transaction on ${doc.legal_dates.transaction_date} requires at least ${minRequired} promoters under applicable CCC Sec. 1097 version (got ${count}) (AT17).`,
          remediation_th: `ระบุจำนวนผู้เริ่มก่อการอย่างน้อย ${minRequired} คน`,
          remediation_en: `Provide at least ${minRequired} promoters.`,
          evidence_refs: ["th-ccc-sec-1097"],
          overridable: false,
          state: "open",
        });
      }
    }

    // 4. Cross-references & Annex targets (LFDE-SCH-002, AT15, R006)
    for (const blk of ver.blocks) {
      if (!visibleBlockIds.has(blk.block_id)) continue;
      for (const refId of blk.cross_refs || []) {
        if (!visibleBlockIds.has(refId)) {
          findings.push({
            finding_id: `fnd_${findings.length + 1}`,
            run_id: runId,
            rule_id: "SCH_BROKEN_CROSS_REFERENCE",
            rule_version: "1.0.0",
            layer: "Clauses",
            severity: "blocker",
            target_block_or_field: blk.block_id,
            explanation_th: `บล็อก '${blk.block_id}' อ้างอิงไปยังบล็อก '${refId}' ที่ถูกซ่อนหรือไม่มีอยู่จริง (AT15)`,
            explanation_en: `Block '${blk.block_id}' references hidden or non-existent block '${refId}' (AT15).`,
            remediation_th: "แก้ไขการอ้างอิงข้อสัญญาหรือเปิดใช้งานบล็อกปลายทาง",
            remediation_en: "Update cross-reference or enable the target block.",
            evidence_refs: [blk.block_id, refId],
            overridable: false,
            state: "open",
          });
        }
      }
      if (blk.annex_target_id && !visibleBlockIds.has(blk.annex_target_id)) {
        findings.push({
          finding_id: `fnd_${findings.length + 1}`,
          run_id: runId,
          rule_id: "R006_ANNEX_REFERENCE_MISSING",
          rule_version: "1.0.0",
          layer: "Procedure",
          severity: "blocker",
          target_block_or_field: blk.block_id,
          explanation_th: `อ้างอิงเอกสารแนบท้าย '${blk.annex_target_id}' แต่ไม่พบเอกสารแนบท้ายในชุดเอกสาร (กฎ R006)`,
          explanation_en: `Reference points to missing annex '${blk.annex_target_id}' (Rule R006).`,
          remediation_th: "แนบเอกสารแนบท้ายหรือลบการอ้างอิง",
          remediation_en: "Attach the referenced annex or remove the reference.",
          evidence_refs: [blk.block_id],
          overridable: false,
          state: "open",
        });
      }
    }

    // 5. Authority verification status & proposition support (R004, AT18, AT20)
    if (authSnap.status !== "verified") {
      findings.push({
        finding_id: `fnd_${findings.length + 1}`,
        run_id: runId,
        rule_id: "R004_AUTHORITY_DATE_UNRESOLVED",
        rule_version: "1.0.0",
        layer: "Authority",
        severity: "blocker",
        target_block_or_field: "authority_snapshot",
        explanation_th: `ไม่สามารถยืนยันตัวบทกฎหมายอ้างอิงได้ (${authSnap.status}): ${authSnap.findings.join("; ")}`,
        explanation_en: `Authority verification state is '${authSnap.status}': ${authSnap.findings.join("; ")} (Rule R004, AT20).`,
        remediation_th: "ตรวจสอบแหล่งอ้างอิงกฎหมายหรือรอการเชื่อมต่อบริการกราฟกฎหมาย",
        remediation_en: "Refresh authority snapshot or resolve withdrawn provision.",
        evidence_refs: authSnap.canonical_ids,
        overridable: false,
        state: "open",
      });
    }

    for (const prov of authSnap.provisions) {
      if (!prov.supports_proposition) {
        findings.push({
          finding_id: `fnd_${findings.length + 1}`,
          run_id: runId,
          rule_id: "AUT_PROPOSITION_UNSUPPORTED",
          rule_version: "1.0.0",
          layer: "Authority",
          severity: "high",
          target_block_or_field: prov.canonical_id,
          explanation_th: `พบตัวบท ${prov.title_th} แต่เนื้อหาไม่รองรับข้อกล่าวอ้างของแม่แบบนี้โดยตรง (AT18)`,
          explanation_en: `Cited provision ${prov.version_id} exists but does not support the stated proposition (AT18).`,
          remediation_th: "ให้ผู้ตรวจทานกฎหมายตรวจสอบและอนุมัติพร้อมเหตุผลอ้างอิง",
          remediation_en: "Route to legal reviewer for semantic support verification.",
          evidence_refs: [prov.version_id],
          overridable: true,
          state: "open",
        });
      }
    }

    // 6. Renderer verification (AT30)
    const hasSignatureBlock = revision.assembled_blocks.some((b) => b.type === "signature");
    if (options?.simulateMissingFont || !hasSignatureBlock) {
      findings.push({
        finding_id: `fnd_${findings.length + 1}`,
        run_id: runId,
        rule_id: "RENDER_QA_FAILURE",
        rule_version: "1.0.0",
        layer: "Rendering",
        severity: "blocker",
        target_block_or_field: "renderer_manifest",
        explanation_th:
          "การตรวจสอบการเรนเดอร์ล้มเหลว: ฟอนต์ภาษาไทยที่ได้รับอนุญาตหรือบล็อกช่องลงนามขาดหาย (AT30)",
        explanation_en:
          "Render validation failed: required licensed Thai font or signature block missing from output manifest (AT30).",
        remediation_th: "ตรวจสอบโปรไฟล์การเรนเดอร์และบล็อกช่องลงนาม",
        remediation_en: "Restore required font and signature block in renderer profile.",
        evidence_refs: [revision.renderer_profile_id],
        overridable: false,
        state: "open",
      });
    }

    const hasNonOverridableBlockers = findings.some(
      (f) => f.severity === "blocker" && !f.overridable && f.state === "open"
    );
    const hasUnresolvedBlockers = findings.some(
      (f) => (f.severity === "blocker" || f.severity === "high") && f.state === "open"
    );

    const readiness: ValidationRun["readiness"] = hasUnresolvedBlockers
      ? "incomplete"
      : "review_ready";

    const run: ValidationRun = {
      id: runId,
      tenant_id: ctx.tenant_id,
      case_id: doc.id,
      revision_id: revision.id,
      ruleset_version: "lfde-rules-2026.10",
      input_hash: revision.content_hash,
      findings,
      has_non_overridable_blockers: hasNonOverridableBlockers,
      has_unresolved_blockers: hasUnresolvedBlockers,
      readiness,
      completed_at: new Date().toISOString(),
    };

    this.validationRuns.set(runId, run);
    doc.latest_validation_run_id = runId;
    doc.state = hasUnresolvedBlockers ? "validation_failed" : "review_ready";
    doc.readiness = readiness;
    doc.lock_version += 1;
    doc.etag = `W/"doc-${doc.id}-v${doc.lock_version}"`;
    doc.updated_at = new Date().toISOString();

    return run;
  }

  public overrideFinding(
    ctx: TenantContext,
    idempotencyKey: string,
    documentId: string,
    findingId: string,
    input: {
      reason: string;
      evidence_ref: string;
    }
  ): ValidationFinding {
    this.verifyContext(ctx, "document:approve");
    const doc = this.getDocumentCase(ctx, documentId);
    if (!doc.latest_validation_run_id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "No validation run found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }
    const run = this.validationRuns.get(doc.latest_validation_run_id)!;
    const finding = run.findings.find((f) => f.finding_id === findingId);
    if (!finding) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Finding not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }

    return this.executeIdempotent(ctx, `override:${findingId}`, idempotencyKey, input, () => {
      // LFDE-REV-001 & AT28: Non-overridable blockers cannot be waived
      if (!finding.overridable) {
        this.appendAudit(ctx, "validation.override_denied", "finding", findingId);
        throw new LfdeException({
          code: "FORBIDDEN",
          safe_message: `Finding '${finding.rule_id}' is a non-overridable blocker and cannot be waived (LFDE-REV-001, AT28).`,
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      if (!input.reason.trim() || !input.evidence_ref.trim()) {
        throw new LfdeException({
          code: "MALFORMED_REQUEST",
          safe_message: "Overriding a finding requires an explicit reason and cited evidence reference.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 422,
        });
      }

      // Preserve underlying finding and append override decision (LFDE-REV-001)
      finding.state = "overridden";
      finding.override_decision = {
        reviewer_id: ctx.subject_id,
        grant_id: ctx.approval_grants[0]?.grant_id || "reviewer_grant",
        reason: input.reason,
        evidence_ref: input.evidence_ref,
        decided_at: new Date().toISOString(),
      };

      run.has_unresolved_blockers = run.findings.some(
        (f) => (f.severity === "blocker" || f.severity === "high") && f.state === "open"
      );
      if (!run.has_unresolved_blockers) {
        run.readiness = "review_ready";
        doc.state = "review_ready";
        doc.readiness = "review_ready";
      }

      this.appendAudit(ctx, "validation.finding_overridden", "finding", findingId);
      return finding;
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 8.2: PINNED REVIEW REQUESTS & SCOPED APPROVAL TRANSACTIONS
     ════════════════════════════════════════════════════════════════════════ */

  public submitReviewRequest(
    ctx: TenantContext,
    idempotencyKey: string,
    documentId: string,
    input: {
      revision_id: string;
      assigned_reviewers: string[];
    }
  ): ReviewRequest {
    this.verifyContext(ctx, "document:request_review");
    const doc = this.getDocumentCase(ctx, documentId);
    const rev = this.draftRevisions.get(input.revision_id);
    if (!rev || rev.case_id !== doc.id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Draft revision not found for this document.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }

    return this.executeIdempotent(
      ctx,
      `review_req:${documentId}:${rev.id}`,
      idempotencyKey,
      input,
      () => {
        const valRun = doc.latest_validation_run_id
          ? this.validationRuns.get(doc.latest_validation_run_id)
          : undefined;
        if (!valRun || valRun.revision_id !== rev.id || valRun.has_unresolved_blockers) {
          throw new LfdeException({
            code: "FACTS_INCOMPLETE",
            safe_message: "Cannot submit for review while unresolved blockers exist on this revision.",
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 422,
          });
        }

        const reqId = `revreq_${rev.id}_${Date.now()}`;
        const req: ReviewRequest = {
          id: reqId,
          tenant_id: ctx.tenant_id,
          case_id: doc.id,
          revision_id: rev.id,
          revision_hash: rev.content_hash,
          fact_snapshot_id: rev.fact_snapshot_id,
          authority_snapshot_id: rev.authority_snapshot_id,
          validation_run_id: valRun.id,
          docx_fingerprint: rev.docx_fingerprint,
          pdf_fingerprint: rev.pdf_fingerprint,
          renderer_profile_id: rev.renderer_profile_id,
          policy_version: "lfde-approval-policy-v2.0",
          assigned_reviewers: input.assigned_reviewers,
          state: "pending",
          created_at: new Date().toISOString(),
          created_by: ctx.subject_id,
        };

        this.reviewRequests.set(reqId, req);
        doc.latest_review_request_id = reqId;
        doc.state = "in_review";
        doc.lock_version += 1;
        doc.etag = `W/"doc-${doc.id}-v${doc.lock_version}"`;
        doc.updated_at = new Date().toISOString();

        this.appendAudit(ctx, "review.submitted", "review_request", reqId, "rest", undefined, rev.content_hash);
        return req;
      }
    );
  }

  public recordReviewDecision(
    ctx: TenantContext,
    idempotencyKey: string,
    reviewRequestId: string,
    ifMatchHeader: string,
    input: {
      decision: "approve" | "request_changes" | "reject";
      reason: string;
      grant_id?: string;
    }
  ): {
    decision: ReviewDecision;
    document: DocumentCase;
  } {
    this.verifyContext(ctx);
    // AT04: Service tokens cannot approve documents
    if (ctx.is_service_account || ctx.role === "integration_service") {
      this.appendAudit(ctx, "review.service_account_approval_denied", "review_request", reviewRequestId);
      throw new LfdeException({
        code: "FORBIDDEN",
        safe_message: "Service accounts cannot approve documents (LFDE-AC-002, AT04).",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 403,
      });
    }

    if (!ctx.scopes.includes("document:approve")) {
      throw new LfdeException({
        code: "FORBIDDEN",
        safe_message: "Subject lacks 'document:approve' scope.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 403,
      });
    }

    const req = this.reviewRequests.get(reviewRequestId);
    if (!req || req.tenant_id !== ctx.tenant_id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Review request not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }

    const doc = this.getDocumentCase(ctx, req.case_id);
    this.assertEtagMatch(ctx, doc.etag, ifMatchHeader);

    return this.executeIdempotent(
      ctx,
      `review_decision:${reviewRequestId}:${ctx.subject_id}`,
      idempotencyKey,
      input,
      () => {
        // LFDE-REV-002 & AT26/AT27: Verify revision is still current and not stale
        if (req.state === "stale" || doc.current_revision_id !== req.revision_id) {
          throw new LfdeException({
            code: "APPROVAL_STALE",
            safe_message:
              "Document revision or inputs changed after review submission; revalidation required (LFDE-REV-002, AT26/AT27).",
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 409,
          });
        }

        const ver = this.templateVersions.get(doc.template_version_id)!;
        const nowIso = new Date().toISOString();

        // LFDE-AC-003 & AT29: Check qualifying non-expired ApprovalGrant
        const candidateGrants = [
          ...ctx.approval_grants,
          ...Array.from(this.approvalGrants.values()).filter(
            (g) => g.tenant_id === ctx.tenant_id && g.subject_id === ctx.subject_id
          ),
        ];
        const matchingGrant = input.grant_id
          ? candidateGrants.find((g) => g.grant_id === input.grant_id)
          : candidateGrants[0];

        if (input.decision === "approve") {
          if (!matchingGrant) {
            throw new LfdeException({
              code: "FORBIDDEN",
              safe_message: "Approver lacks an explicit approval grant for this tenant (LFDE-AC-002).",
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 403,
            });
          }

          if (matchingGrant.revoked || nowIso < matchingGrant.valid_from || nowIso > matchingGrant.valid_to) {
            throw new LfdeException({
              code: "FORBIDDEN",
              safe_message: `Approver grant '${matchingGrant.grant_id}' has expired or been revoked (AT29). Reassignment path remains available.`,
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 403,
            });
          }

          if (
            RISK_ORDER[ver.risk] > RISK_ORDER[matchingGrant.risk_ceiling] ||
            (!matchingGrant.document_categories.includes(ver.domain) &&
              !matchingGrant.document_categories.includes(ver.family))
          ) {
            throw new LfdeException({
              code: "FORBIDDEN",
              safe_message: `Approver grant ceiling (${matchingGrant.risk_ceiling}) or category does not cover template risk (${ver.risk}).`,
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 403,
            });
          }

          // Self-approval disabled for high-risk categories (LFDE-AC-003)
          if (ver.risk === "high" && doc.created_by === ctx.subject_id) {
            throw new LfdeException({
              code: "FORBIDDEN",
              safe_message: "Self-approval is disabled for high-risk document categories (LFDE-AC-003).",
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 403,
            });
          }
        }

        const decId = `revdec_${reviewRequestId}_${Date.now()}`;
        const decision: ReviewDecision = {
          id: decId,
          tenant_id: ctx.tenant_id,
          request_id: req.id,
          case_id: doc.id,
          revision_id: req.revision_id,
          reviewer_id: ctx.subject_id,
          reviewer_grant_id: matchingGrant?.grant_id || "reviewer_scope",
          decision: input.decision,
          reason: input.reason,
          revision_hash: req.revision_hash,
          decided_at: nowIso,
        };

        const list = this.reviewDecisions.get(doc.id) || [];
        list.push(decision);
        this.reviewDecisions.set(doc.id, list);

        if (input.decision === "approve") {
          req.state = "approved";
          doc.state = "approved";
          doc.readiness = "export_ready";
          doc.latest_approval_decision_id = decId;
        } else if (input.decision === "request_changes") {
          req.state = "changes_requested";
          doc.state = "changes_requested";
          doc.readiness = "complete";
        } else {
          req.state = "rejected";
          doc.state = "validation_failed";
          doc.readiness = "incomplete";
        }

        doc.lock_version += 1;
        doc.etag = `W/"doc-${doc.id}-v${doc.lock_version}"`;
        doc.updated_at = nowIso;

        this.appendAudit(
          ctx,
          `review.decision:${input.decision}`,
          "review_decision",
          decId,
          "rest",
          undefined,
          req.revision_hash
        );
        return { decision, document: doc };
      }
    );
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 7.4, 8.2 & 13.1: EXPORT ARTIFACT & REVOCABLE DOWNLOAD SESSION
     ════════════════════════════════════════════════════════════════════════ */

  public createExportArtifact(
    ctx: TenantContext,
    idempotencyKey: string,
    documentId: string,
    input: {
      draft_revision_id: string;
      format: "docx" | "pdf";
      mode: "draft" | "final";
      approval_set_id?: string;
    }
  ): ExportArtifact {
    this.verifyContext(ctx, "document:export");
    const doc = this.getDocumentCase(ctx, documentId);
    const rev = this.draftRevisions.get(input.draft_revision_id);
    if (!rev || rev.case_id !== doc.id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Draft revision not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }

    return this.executeIdempotent(
      ctx,
      `export:${documentId}:${rev.id}:${input.mode}:${input.format}`,
      idempotencyKey,
      input,
      () => {
        const ver = this.templateVersions.get(doc.template_version_id)!;

        // Re-evaluate licensing rights for export_distribute (LFDE-LIC-002, AT06, AT07)
        const sourceIds = new Set<string>([ver.source_id]);
        for (const cid of rev.selected_clause_version_ids) {
          const cv = this.clauseVersions.get(cid);
          if (cv) sourceIds.add(cv.source_id);
        }
        const grants: LicenseGrant[] = [];
        for (const sid of sourceIds) grants.push(...this.getGrantsForSource(sid));

        const opRequired: LicensedOperation =
          input.mode === "final" ? "export_distribute" : "draft_generate";
        const rightCheck = RightsGateway.evaluateOperationRights(ctx, grants, opRequired);
        if (!rightCheck.allowed) {
          throw new LfdeException({
            code: "RIGHTS_DENIED",
            safe_message: rightCheck.reason,
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 422,
          });
        }

        if (input.mode === "final") {
          // AT27: Final export recomputes gate eligibility; old approval for a superseded revision fails with APPROVAL_STALE
          if (doc.current_revision_id !== rev.id || doc.state !== "approved") {
            throw new LfdeException({
              code: "APPROVAL_STALE",
              safe_message:
                "Final export denied: requested revision is not the currently approved revision (AT27).",
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 409,
            });
          }

          const decisions = (this.reviewDecisions.get(doc.id) || []).filter(
            (d) => d.revision_id === rev.id && d.decision === "approve"
          );
          if (decisions.length === 0) {
            throw new LfdeException({
              code: "APPROVAL_STALE",
              safe_message: "No valid approval decision exists for the requested revision.",
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 409,
            });
          }

          // Re-verify authority freshness & withdrawal at finalization (Section 6.3)
          const freshAuth = AuthorityGateway.resolve({
            tenant_id: ctx.tenant_id,
            canonical_ids: ver.authority_refs,
            legal_as_of_date: doc.legal_dates.legal_as_of_date,
            transaction_date: doc.legal_dates.transaction_date,
            drafting_date: doc.legal_dates.drafting_date,
            intended_filing_date: doc.legal_dates.intended_filing_date,
          });
          if (freshAuth.status !== "verified") {
            throw new LfdeException({
              code: "AUTHORITY_UNKNOWN",
              safe_message: `Final export blocked: critical cited authority verification is '${freshAuth.status}' (${freshAuth.findings.join("; ")}).`,
              correlation_id: ctx.correlation_id,
              retryable: false,
              http_status: 422,
            });
          }
        }

        const expId = `exp_${rev.id}_${input.mode}_${input.format}_${Date.now()}`;
        const artifactHash =
          input.format === "docx" ? rev.docx_fingerprint : rev.pdf_fingerprint;

        const statusLabel =
          input.mode === "draft" ? "draft" : "approved for export";

        const manifest: LineageManifest = {
          manifest_id: `man_${expId}`,
          case_id: doc.id,
          revision_id: rev.id,
          template_version_id: rev.template_version_id,
          clause_version_ids: rev.selected_clause_version_ids,
          fact_snapshot_id: rev.fact_snapshot_id,
          authority_snapshot_ids: [rev.authority_snapshot_id],
          validation_run_id: doc.latest_validation_run_id || "val_none",
          approval_decision_ids:
            input.mode === "final" && doc.latest_approval_decision_id
              ? [doc.latest_approval_decision_id]
              : [],
          license_decision_snapshot: rightCheck.grant_versions.join(","),
          accepted_model_proposal_hashes: rev.accepted_ai_proposal_hashes,
          model_and_prompt_versions: ["gemini-2.5-pro:lfde-prompt-v2.0"],
          assembly_build: "lfde-assembler-2.0.0",
          renderer_build: "lfde-renderer-ooxml-2.0.0",
          artifact_sha256: artifactHash,
          status_label: statusLabel,
          generated_at: new Date().toISOString(),
        };

        const artifact: ExportArtifact = {
          id: expId,
          tenant_id: ctx.tenant_id,
          case_id: doc.id,
          revision_id: rev.id,
          mode: input.mode,
          format: input.format,
          status_label: statusLabel,
          watermarked: input.mode === "draft",
          object_ref: `s3://reg24-lfde-private/${ctx.tenant_id}/exports/${expId}.${input.format}`,
          sha256: artifactHash,
          approval_decision_ids: manifest.approval_decision_ids,
          manifest,
          created_at: new Date().toISOString(),
          created_by: ctx.subject_id,
        };

        this.exportArtifacts.set(expId, artifact);
        this.appendAudit(ctx, `export.completed:${input.mode}`, "export_artifact", expId, "rest", undefined, artifactHash);
        return artifact;
      }
    );
  }

  public createDownloadSession(
    ctx: TenantContext,
    idempotencyKey: string,
    exportId: string
  ): DownloadSession {
    this.verifyContext(ctx, "document:export");
    const exp = this.exportArtifacts.get(exportId);
    if (!exp || exp.tenant_id !== ctx.tenant_id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Export artifact not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }

    return this.executeIdempotent(ctx, `dl_session:${exportId}`, idempotencyKey, {}, () => {
      // LFDE-AC-004 & LFDE-SEC-001: Re-verify rights and membership when download session is minted
      const doc = this.getDocumentCase(ctx, exp.case_id);
      const ver = this.templateVersions.get(doc.template_version_id)!;
      const grants = this.getGrantsForSource(ver.source_id);
      const op: LicensedOperation =
        exp.mode === "final" ? "export_distribute" : "draft_generate";
      const rightCheck = RightsGateway.evaluateOperationRights(ctx, grants, op);
      if (!rightCheck.allowed) {
        throw new LfdeException({
          code: "RIGHTS_DENIED",
          safe_message: rightCheck.reason,
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 403,
        });
      }

      const sessId = `dls_${sha256Hex(`${exportId}:${ctx.subject_id}:${Date.now()}`).slice(0, 14)}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5-minute default expiry (LFDE-SEC-001)
      const session: DownloadSession = {
        session_id: sessId,
        tenant_id: ctx.tenant_id,
        export_id: exportId,
        subject_id: ctx.subject_id,
        expires_at: expiresAt,
        revoked: false,
      };
      this.downloadSessions.set(sessId, session);
      this.appendAudit(ctx, "export.download_session_minted", "download_session", sessId);
      return session;
    });
  }

  /**
   * Section 7.4 & AT32: Re-uploading an externally edited Word file creates a new revision
   * and never inherits prior REG24 approval.
   */
  public reuploadEditedDocx(
    ctx: TenantContext,
    idempotencyKey: string,
    documentId: string,
    input: {
      edited_text_th: string;
    }
  ): {
    revision: DraftRevision;
    document: DocumentCase;
  } {
    this.verifyContext(ctx, "document:edit");
    const doc = this.getDocumentCase(ctx, documentId);
    return this.executeIdempotent(ctx, `reupload_docx:${documentId}`, idempotencyKey, input, () => {
      const existingRevs = Array.from(this.draftRevisions.values()).filter(
        (r) => r.case_id === doc.id
      );
      const revNum = existingRevs.length + 1;
      const contentHash = sha256Hex(`external_docx:${doc.id}:${revNum}:${input.edited_text_th}`);
      const revId = `rev_${doc.id}_n${revNum}_ext_${contentHash.slice(0, 6)}`;

      const revision: DraftRevision = {
        id: revId,
        tenant_id: ctx.tenant_id,
        case_id: doc.id,
        revision_number: revNum,
        parent_revision_id: doc.current_revision_id,
        template_version_id: doc.template_version_id,
        fact_snapshot_id: "fsnap_external_edit",
        authority_snapshot_id: "auth_snap_external_edit",
        selected_clause_version_ids: [...doc.selected_clause_ids],
        assembled_blocks: [
          {
            block_id: "blk_external_word_edit",
            number_label: "1",
            type: "paragraph",
            title_th: "เนื้อหาที่แก้ไขจากไฟล์ Word ภายนอก (ต้องผ่านการตรวจสอบและอนุมัติใหม่)",
            title_en: "Externally Edited Word Content (Requires Re-Validation & Approval)",
            rendered_text_th: input.edited_text_th,
            rendered_text_en: input.edited_text_th,
            origin: "user_text",
            field_refs: [],
            authority_refs: [],
            mandatory_by_rule: false,
          },
        ],
        content_hash: contentHash,
        renderer_profile_id: "render_th_sarabun_a4_v1",
        docx_fingerprint: sha256Hex(`docx:${contentHash}`),
        pdf_fingerprint: sha256Hex(`pdf:${contentHash}`),
        accepted_ai_proposal_hashes: [],
        created_at: new Date().toISOString(),
        created_by: ctx.subject_id,
      };

      this.draftRevisions.set(revId, revision);
      doc.current_revision_id = revId;
      doc.state = "draft";
      doc.readiness = "incomplete";
      doc.latest_approval_decision_id = undefined;
      if (doc.latest_review_request_id) {
        const rr = this.reviewRequests.get(doc.latest_review_request_id);
        if (rr) rr.state = "stale";
      }
      doc.lock_version += 1;
      doc.etag = `W/"doc-${doc.id}-v${doc.lock_version}"`;
      doc.updated_at = new Date().toISOString();

      this.appendAudit(ctx, "document.external_docx_reuploaded", "draft_revision", revId, "rest", undefined, contentHash);
      return { revision, document: doc };
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     SECTION 6.3, 9 & 11.6: SOURCE CHANGE IMPACT, FILING PACKAGES & JOBS
     ════════════════════════════════════════════════════════════════════════ */

  public handleSourceChangeEvent(
    ctx: TenantContext,
    event: {
      canonical_id: string;
      new_version_id: string;
      materially_withdrawn?: boolean;
    }
  ): { created_tasks: WorkflowTask[]; deduplicated: boolean } {
    this.verifyContext(ctx);
    if (event.materially_withdrawn) {
      AuthorityGateway.markAuthorityWithdrawn(event.canonical_id, true);
    }

    const createdTasks: WorkflowTask[] = [];
    let deduplicated = false;

    for (const ver of this.templateVersions.values()) {
      if (ver.authority_refs.includes(event.canonical_id)) {
        const dedupKey = `impact:${event.canonical_id}:${event.new_version_id}:${ver.id}`;
        const existing = Array.from(this.workflowTasks.values()).find(
          (t) => t.dedup_key === dedupKey
        );
        if (existing) {
          deduplicated = true;
          continue;
        }
        const task = this.createWorkflowTask(
          ctx.tenant_id,
          "source_change_impact",
          ver.id,
          dedupKey,
          `Source change impact review: ${event.canonical_id} -> ${event.new_version_id} on template ${ver.id}`,
          "legal.ops@reg24.th",
          [event.canonical_id, ver.id]
        );
        createdTasks.push(task);
      }
    }

    return { created_tasks: createdTasks, deduplicated };
  }

  public createFilingPackage(
    ctx: TenantContext,
    idempotencyKey: string,
    input: {
      matter_id: string;
      profile_version_id: string;
      export_artifact_ids: string[];
    }
  ): FilingPackage {
    this.verifyContext(ctx, "package:create");
    return this.executeIdempotent(ctx, "create_package", idempotencyKey, input, () => {
      const profile = this.filingProfiles.get(input.profile_version_id);
      if (!profile) {
        throw new LfdeException({
          code: "NOT_FOUND",
          safe_message: "Filing profile version not found.",
          correlation_id: ctx.correlation_id,
          retryable: false,
          http_status: 404,
        });
      }

      const exhibitIndex: FilingPackage["exhibit_index"] = [];
      const seenHashes = new Set<string>();
      const duplicateWarnings: string[] = [];
      const memberRevisionIds: string[] = [];

      input.export_artifact_ids.forEach((aid, idx) => {
        const art = this.exportArtifacts.get(aid);
        if (!art || art.tenant_id !== ctx.tenant_id || art.mode !== "final") {
          throw new LfdeException({
            code: "APPROVAL_STALE",
            safe_message: `Artifact '${aid}' is not an approved final export in this tenant.`,
            correlation_id: ctx.correlation_id,
            retryable: false,
            http_status: 422,
          });
        }
        if (seenHashes.has(art.sha256)) {
          duplicateWarnings.push(
            `Exhibit ${idx + 1} (${aid}) has identical SHA-256 to a prior exhibit in this package (LFDE-PKG-001).`
          );
        }
        seenHashes.add(art.sha256);
        memberRevisionIds.push(art.revision_id);
        exhibitIndex.push({
          exhibit_no: `EX-${String(idx + 1).padStart(2, "0")}`,
          title: `Approved Export ${art.id} (${art.format.toUpperCase()})`,
          artifact_id: art.id,
          sha256: art.sha256,
          page_range: "1-5",
        });
      });

      const pkgId = `pkg_${sha256Hex(`${ctx.tenant_id}:${input.matter_id}:${Date.now()}`).slice(0, 12)}`;
      const pkg: FilingPackage = {
        id: pkgId,
        tenant_id: ctx.tenant_id,
        matter_id: input.matter_id,
        profile_version_id: profile.id,
        member_revision_ids: memberRevisionIds,
        exhibit_index: exhibitIndex,
        duplicate_exhibit_warnings: duplicateWarnings,
        checklist: [
          {
            item_key: "approved_revisions_pinned",
            label_th: "เอกสารหลักผ่านการอนุมัติและล็อกเลขแฮช SHA-256 แล้ว",
            label_en: "Primary documents approved with pinned SHA-256 hashes",
            passed: true,
          },
          {
            item_key: "human_signature_required",
            label_th: profile.signature_requirements_th,
            label_en: profile.signature_requirements_en,
            passed: true,
          },
        ],
        status_label: "prepared for human submission",
        manifest_sha256: sha256Hex(JSON.stringify(exhibitIndex)),
        created_at: new Date().toISOString(),
        created_by: ctx.subject_id,
      };

      this.filingPackages.set(pkgId, pkg);
      this.appendAudit(ctx, "package.created", "filing_package", pkgId, "rest", undefined, pkg.manifest_sha256);
      return pkg;
    });
  }

  public getJob(ctx: TenantContext, jobId: string): LfdeJob {
    this.verifyContext(ctx);
    const job = this.jobs.get(jobId);
    if (!job || job.tenant_id !== ctx.tenant_id) {
      throw new LfdeException({
        code: "NOT_FOUND",
        safe_message: "Job not found.",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 404,
      });
    }
    return job;
  }

  public cancelJob(ctx: TenantContext, idempotencyKey: string, jobId: string): LfdeJob {
    const job = this.getJob(ctx, jobId);
    return this.executeIdempotent(ctx, `cancel_job:${jobId}`, idempotencyKey, {}, () => {
      job.state = "canceled";
      job.stage = "canceled_by_user";
      job.updated_at = new Date().toISOString();
      this.appendAudit(ctx, "job.canceled", "job", jobId);
      return job;
    });
  }

  public getDocumentTrace(
    ctx: TenantContext,
    documentId: string
  ): {
    document: DocumentCase;
    plain_timeline: Array<{ step: string; label_th: string; label_en: string; done: boolean }>;
    revisions: DraftRevision[];
    validation_runs: ValidationRun[];
    review_decisions: ReviewDecision[];
    exports: ExportArtifact[];
    audit_events: LfdeAuditEvent[];
  } {
    const doc = this.getDocumentCase(ctx, documentId);
    const revisions = Array.from(this.draftRevisions.values()).filter((r) => r.case_id === doc.id);
    const validation_runs = Array.from(this.validationRuns.values()).filter(
      (v) => v.case_id === doc.id
    );
    const review_decisions = this.reviewDecisions.get(doc.id) || [];
    const exports = Array.from(this.exportArtifacts.values()).filter((e) => e.case_id === doc.id);
    const audit_events = this.auditEvents.filter(
      (a) =>
        a.tenant_id === ctx.tenant_id &&
        (a.target_id === doc.id ||
          revisions.some((r) => r.id === a.target_id) ||
          exports.some((e) => e.id === a.target_id))
    );

    const hasConfirmedFacts = (this.factCandidates.get(doc.id) || []).some(
      (c) => c.assertion_state === "confirmed"
    );

    return {
      document: doc,
      plain_timeline: [
        {
          step: "uploaded",
          label_th: "เลือกแม่แบบและตั้งค่าคดีแล้ว",
          label_en: "Template selected & matter initialized",
          done: true,
        },
        {
          step: "facts_confirmed",
          label_th: "ยืนยันข้อเท็จจริงสำคัญแล้ว",
          label_en: "Critical facts confirmed",
          done: hasConfirmedFacts,
        },
        {
          step: "draft_generated",
          label_th: "ประกอบร่างเอกสารและล็อกแฮชแล้ว",
          label_en: "Draft assembled & hashed",
          done: revisions.length > 0,
        },
        {
          step: "issues_checked",
          label_th: "ตรวจสอบกฎความถูกต้องและตัวบทกฎหมายแล้ว",
          label_en: "Rules & legal authority validated",
          done: validation_runs.some((v) => !v.has_unresolved_blockers),
        },
        {
          step: "reviewed",
          label_th: "ผู้ตรวจทานกฎหมายอนุมัติแล้ว",
          label_en: "Approved by designated legal reviewer",
          done: doc.state === "approved",
        },
        {
          step: "exported",
          label_th: "สร้างไฟล์ส่งออกพร้อมใบรายการแหล่งอ้างอิงแล้ว",
          label_en: "Exported with SHA-256 lineage manifest",
          done: exports.some((e) => e.mode === "final"),
        },
      ],
      revisions,
      validation_runs,
      review_decisions,
      exports,
      audit_events,
    };
  }

  public executeAgiMission(
    ctx: TenantContext,
    input: {
      mission_type: AgiMissionExecution["mission_type"];
      topology: AgiTopology;
      automation: AgiAutomationLevel;
      objective: string;
      budget_thb_cap?: string;
    }
  ): AgiMissionExecution {
    this.verifyContext(ctx);
    const cap = formatDecimalExact(input.budget_thb_cap || "25.00", 2, "HALF_UP");
    if (Number(cap) <= 0) {
      throw new LfdeException({
        code: "BUDGET_EXCEEDED",
        safe_message: "Mission budget cap is exhausted (Appendix C).",
        correlation_id: ctx.correlation_id,
        retryable: false,
        http_status: 429,
      });
    }

    const stages =
      input.automation === "draft"
        ? ["intent_parse", "template_candidate_ranking"]
        : input.automation === "supervised"
        ? ["intent_parse", "template_candidate_ranking", "fact_ledger_prep", "paused_before_clause_commit"]
        : [
            "intent_parse",
            "template_candidate_ranking",
            "fact_ledger_prep",
            "deterministic_assembly_precheck",
            "paused_for_mandatory_human_approval",
          ];

    return {
      mission_id: `agi_lfde_${Date.now()}`,
      mission_type: input.mission_type,
      topology: input.topology,
      automation: input.automation,
      budget_thb_cap: cap,
      spent_thb: "1.85",
      completed_stages: stages,
      paused_for_human_gate:
        input.automation === "supervised"
          ? "human_clause_and_fact_confirmation"
          : "designated_human_approver_gate",
      output_summary_th: `ดำเนินการภารกิจ LFDE (${input.mission_type}) ในโหมด ${input.topology.toUpperCase()} / ${input.automation.toUpperCase()} สำเร็จ โดยหยุดรอการยืนยันและอนุมัติจากมนุษย์ตามเกตบังคับ`,
      output_summary_en: `Executed LFDE mission (${input.mission_type}) under ${input.topology.toUpperCase()} / ${input.automation.toUpperCase()} policy; paused at mandatory human confirmation/approval gate.`,
      hard_boundary_notice:
        "No AGI mode permits agents to approve their own output, bypass a denied license, or submit filings externally (Appendix C).",
    };
  }

  public getCuratorOverview(ctx: TenantContext): {
    source_assets: SourceAsset[];
    license_grants: LicenseGrant[];
    templates: Template[];
    template_versions: TemplateVersion[];
    filing_profiles: FilingProfileVersion[];
    workflow_tasks: WorkflowTask[];
  } {
    this.verifyContext(ctx);
    return {
      source_assets: Array.from(this.sourceAssets.values()).filter(
        (a) => a.tenant_id === ctx.tenant_id || a.tenant_id === "platform.catalog"
      ),
      license_grants: Array.from(this.licenseGrants.values()).filter(
        (g) => g.tenant_id === ctx.tenant_id || g.tenant_id === "platform.catalog"
      ),
      templates: Array.from(this.templates.values()).filter(
        (t) =>
          t.tenant_id === ctx.tenant_id ||
          t.entitled_tenants.includes("*") ||
          t.entitled_tenants.includes(ctx.tenant_id)
      ),
      template_versions: Array.from(this.templateVersions.values()),
      filing_profiles: Array.from(this.filingProfiles.values()),
      workflow_tasks: Array.from(this.workflowTasks.values()).filter(
        (w) => w.tenant_id === ctx.tenant_id
      ),
    };
  }

  public verifyWebhookDispatch(
    ctx: TenantContext,
    destinationUrl: string,
    eventId: string,
    payload: Record<string, unknown>,
    timestampSec = Math.floor(Date.now() / 1000)
  ) {
    this.verifyContext(ctx);
    validateWebhookDestination(destinationUrl);
    const rawBody = JSON.stringify(payload);
    return signWebhookPayload({
      event_id: eventId,
      key_id: "reg24_wh_key_2026",
      secret: "whsec_reg24_lfde_v2",
      timestamp_sec: timestampSec,
      raw_body: rawBody,
    });
  }

  private getGrantsForSource(sourceId: string): LicenseGrant[] {
    return Array.from(this.licenseGrants.values()).filter((g) => g.source_id === sourceId);
  }

  private createWorkflowTask(
    tenantId: string,
    type: WorkflowTask["type"],
    targetId: string,
    dedupKey: string,
    title: string,
    assignedTo: string,
    dependencyRefs: string[]
  ): WorkflowTask {
    const id = `wft_${sha256Hex(`${tenantId}:${dedupKey}`).slice(0, 12)}`;
    const task: WorkflowTask = {
      id,
      tenant_id: tenantId,
      type,
      target_id: targetId,
      dedup_key: dedupKey,
      title,
      assigned_to: assignedTo,
      state: "open",
      dependency_refs: dependencyRefs,
      created_at: new Date().toISOString(),
    };
    this.workflowTasks.set(id, task);
    return task;
  }
}

export const lfdeService = new LfdeService();
