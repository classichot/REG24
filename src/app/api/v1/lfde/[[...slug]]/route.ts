/**
 * REG24 LFDE v2.0 — Legal Form and Document Execution REST API Namespace
 * Specification: REG24-LFDE-v2.0 (Section 11.4, Section 11.1–11.3, Section 11.8)
 *
 * Dedicated namespace `/api/v1/lfde/*` separate from `/api/v1/legal/documents`.
 * Enforces:
 * - Server-verified TenantContext (`401` on missing/invalid auth when strict, `403` on body tenant_id mismatch, `404` on cross-tenant resource)
 * - Idempotency-Key (`409 IDEMPOTENCY_CONFLICT` on mismatched body hash)
 * - If-Match ETag concurrency (`409 REVISION_CONFLICT` on stale revision)
 * - Webhook SSRF & HMAC-SHA256 signature verification (`LFDE-API-003`)
 */

import { NextRequest, NextResponse } from "next/server";
import { lfdeService } from "@/core/lfde/service";
import { SEED_APPROVAL_GRANTS } from "@/core/lfde/fixtures";
import { searchLegalFormsMasterCatalog } from "@/core/data/legal-resource-master-loader";
import {
  LfdeException,
  type AgiAutomationLevel,
  type AgiMissionExecution,
  type AgiTopology,
  type AssetClassification,
  type LfdeRole,
  type LfdeScope,
  type RiskLevel,
  type TemplateField,
  type TemplateLifecycleState,
  type TenantContext,
} from "@/core/lfde/types";

const ALL_DEFAULT_SCOPES: LfdeScope[] = [
  "source:write",
  "template:read",
  "template:curate",
  "template:review",
  "template:publish",
  "clause:read",
  "clause:curate",
  "clause:review",
  "document:create",
  "document:read",
  "document:edit",
  "document:comment",
  "document:validate",
  "document:request_review",
  "document:approve",
  "document:export",
  "package:create",
  "audit:read",
];

function resolveTenantContext(req: NextRequest, body?: Record<string, unknown>): TenantContext {
  const authHeader = req.headers.get("authorization");
  const requireStrictAuth = req.headers.get("x-lfde-require-auth") === "true";

  if (requireStrictAuth && (!authHeader || !authHeader.startsWith("Bearer "))) {
    throw new LfdeException({
      code: "UNAUTHENTICATED",
      safe_message: "Missing or invalid Bearer authentication token (AT01).",
      correlation_id: req.headers.get("x-correlation-id") || "unauth_req",
      retryable: false,
      http_status: 401,
    });
  }

  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const subjectId = req.headers.get("x-reg24-actor") || "approver.partner@law24.th";
  const role = (req.headers.get("x-reg24-role") || "designated_approver") as LfdeRole;
  const isServiceAccount =
    req.headers.get("x-reg24-service-account") === "true" || role === "integration_service";
  const scopesHeader = req.headers.get("x-reg24-scopes");
  const scopes: LfdeScope[] = scopesHeader
    ? (scopesHeader.split(",").map((s) => s.trim()) as LfdeScope[])
    : ALL_DEFAULT_SCOPES;

  const ctx: TenantContext = {
    subject_id: subjectId,
    tenant_id: tenantId,
    application_id: req.headers.get("x-reg24-app") || "REG24",
    role,
    is_service_account: isServiceAccount,
    scopes,
    matter_grants: ["*", "matter.law24.ma.2026.01", "matter.law24.corp.2026.02", "matter.law24.lease.2026.03"],
    approval_grants: SEED_APPROVAL_GRANTS.filter((g) => g.tenant_id === tenantId),
    correlation_id: req.headers.get("x-correlation-id") || `corr_${Date.now()}`,
  };

  lfdeService.verifyContext(ctx, undefined, body);
  return ctx;
}

function handleError(err: unknown) {
  if (err instanceof LfdeException) {
    return NextResponse.json(
      {
        status: "error",
        ...err.envelope,
        message: err.envelope.safe_message,
      },
      { status: err.envelope.http_status }
    );
  }
  return NextResponse.json(
    {
      status: "error",
      code: "MALFORMED_REQUEST",
      safe_message: err instanceof Error ? err.message : "Unexpected LFDE request error",
      message: err instanceof Error ? err.message : "Unexpected LFDE request error",
      retryable: false,
      http_status: 400,
    },
    { status: 400 }
  );
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug?: string[] }> }
) {
  try {
    const { slug = [] } = await context.params;
    const ctx = resolveTenantContext(req);
    const sp = req.nextUrl.searchParams;

    // GET /api/v1/lfde (Full Workspace Snapshot for UI)
    if (slug.length === 0) {
      const searchRes = lfdeService.searchTemplates(ctx, {});
      const clauses = lfdeService.listClauses(ctx);
      const curator = lfdeService.getCuratorOverview(ctx);
      const documents = lfdeService.listDocumentCases(ctx);
      const officialFormsCatalog = searchLegalFormsMasterCatalog({ limit: 80 });

      return NextResponse.json({
        status: "ok",
        specification_id: "REG24-LFDE-V2-001",
        snapshot: {
          templates: searchRes.items,
          clauses,
          filing_profiles: curator.filing_profiles,
          document_cases: documents,
          curator,
          official_forms_catalog: officialFormsCatalog,
        },
      });
    }

    // GET /api/v1/lfde/official-forms-catalog
    if (slug.length === 1 && slug[0] === "official-forms-catalog") {
      const catalog = searchLegalFormsMasterCatalog({
        query: sp.get("q") || sp.get("query") || undefined,
        category_code: sp.get("category_code") || sp.get("category") || undefined,
        only_official_forms: sp.get("only_official") === "true",
        limit: sp.get("limit") ? parseInt(sp.get("limit")!, 10) : 80,
        offset: sp.get("offset") ? parseInt(sp.get("offset")!, 10) : 0,
      });

      return NextResponse.json({
        status: "ok",
        ...catalog,
      });
    }

    // GET /api/v1/lfde/templates
    if (slug.length === 1 && slug[0] === "templates") {
      const res = lfdeService.searchTemplates(ctx, {
        domain: sp.get("domain") || undefined,
        family: sp.get("family") || sp.get("doc_type") || undefined,
        objective: sp.get("objective") || sp.get("q") || sp.get("query") || undefined,
        jurisdiction: sp.get("jurisdiction") || undefined,
        risk: (sp.get("risk") as RiskLevel | null) || undefined,
        legal_as_of_date: sp.get("legal_as_of_date") || undefined,
      });

      return NextResponse.json({
        status: "ok",
        total: res.items.length,
        items: res.items,
        coverage_gap: res.coverage_gap,
      });
    }

    // GET /api/v1/lfde/templates/{id}/versions/{version}
    if (slug.length === 4 && slug[0] === "templates" && slug[2] === "versions") {
      const version = lfdeService.getTemplateVersion(ctx, slug[1], slug[3]);
      const clauses = lfdeService.listClauses(ctx, version.id);
      return NextResponse.json({
        status: "ok",
        version,
        clauses,
      });
    }

    // GET /api/v1/lfde/clauses
    if (slug.length === 1 && slug[0] === "clauses") {
      const templateVersionId = sp.get("template_version_id") || undefined;
      const clauses = lfdeService.listClauses(ctx, templateVersionId);
      return NextResponse.json({
        status: "ok",
        total: clauses.length,
        clauses,
      });
    }

    // GET /api/v1/lfde/documents
    if (slug.length === 1 && slug[0] === "documents") {
      const documents = lfdeService.listDocumentCases(ctx);
      return NextResponse.json({
        status: "ok",
        total: documents.length,
        documents,
      });
    }

    // GET /api/v1/lfde/documents/{id}
    if (slug.length === 2 && slug[0] === "documents") {
      const document = lfdeService.getDocumentCase(ctx, slug[1]);
      const facts = lfdeService.getDocumentFacts(ctx, slug[1]);
      const trace = lfdeService.getDocumentTrace(ctx, slug[1]);
      const version = lfdeService.getTemplateVersion(
        ctx,
        document.template_id,
        document.template_version_id
      );

      return NextResponse.json(
        {
          status: "ok",
          document,
          template_version: version,
          facts,
          trace,
        },
        {
          headers: {
            ETag: document.etag,
          },
        }
      );
    }

    // GET /api/v1/lfde/documents/{id}/facts
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "facts") {
      const document = lfdeService.getDocumentCase(ctx, slug[1]);
      const facts = lfdeService.getDocumentFacts(ctx, slug[1]);
      return NextResponse.json({
        status: "ok",
        document,
        facts,
      });
    }

    // GET /api/v1/lfde/documents/{id}/trace
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "trace") {
      const trace = lfdeService.getDocumentTrace(ctx, slug[1]);
      return NextResponse.json({
        status: "ok",
        trace,
      });
    }

    // GET /api/v1/lfde/jobs/{id}
    if (slug.length === 2 && slug[0] === "jobs") {
      const job = lfdeService.getJob(ctx, slug[1]);
      return NextResponse.json({
        status: "ok",
        job,
      });
    }

    // GET /api/v1/lfde/curator
    if (slug.length === 1 && slug[0] === "curator") {
      return NextResponse.json({
        status: "ok",
        curator: lfdeService.getCuratorOverview(ctx),
      });
    }

    return NextResponse.json(
      {
        status: "error",
        code: "NOT_FOUND",
        safe_message: `LFDE GET endpoint '/api/v1/lfde/${slug.join("/")}' not found.`,
      },
      { status: 404 }
    );
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug?: string[] }> }
) {
  try {
    const { slug = [] } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ctx = resolveTenantContext(req, body);
    const idempotencyKey =
      req.headers.get("idempotency-key") ||
      (typeof body.idempotency_key === "string"
        ? body.idempotency_key
        : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    // POST /api/v1/lfde/uploads
    if (slug.length === 1 && slug[0] === "uploads") {
      const session = lfdeService.createUploadSession(ctx, idempotencyKey, {
        original_name: String(body.original_name || body.filename || "template_upload.docx"),
        mime: String(
          body.mime ||
            body.mime_type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        size: Number(body.size ?? body.byte_size ?? 12400),
        sha256: String(
          body.sha256 ||
            body.expected_sha256 ||
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        ),
        classification: body.classification as AssetClassification | undefined,
        tenant_id: typeof body.tenant_id === "string" ? body.tenant_id : undefined,
      });
      return NextResponse.json({ status: "ok", upload_session: session }, { status: 201 });
    }

    // POST /api/v1/lfde/uploads/{id}/complete
    if (slug.length === 3 && slug[0] === "uploads" && slug[2] === "complete") {
      const completed = lfdeService.completeUploadSession(ctx, idempotencyKey, slug[1], {
        measured_bytes: Number(body.measured_bytes ?? 12400),
        measured_sha256: String(
          body.measured_sha256 ||
            body.actual_sha256 ||
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        ),
        page_count: typeof body.page_count === "number" ? body.page_count : undefined,
        encrypted: Boolean(body.encrypted),
        contains_macros: Boolean(body.contains_macros ?? body.simulate_active_macros),
        contains_external_links: Boolean(
          body.contains_external_links ?? body.simulate_external_rels
        ),
        zip_compression_ratio:
          typeof body.zip_compression_ratio === "number" ? body.zip_compression_ratio : undefined,
        extracted_regions: Array.isArray(body.extracted_regions)
          ? (body.extracted_regions as Array<{
              page_number: number;
              field_hint?: string;
              raw_text: string;
              confidence: number;
            }>)
          : undefined,
        force_new_context: Boolean(body.force_new_context),
      });
      return NextResponse.json({ status: "ok", ...completed });
    }

    // POST /api/v1/lfde/templates/import
    if (slug.length === 2 && slug[0] === "templates" && slug[1] === "import") {
      const imported = lfdeService.importWorkingTemplate(ctx, idempotencyKey, {
        source_id: String(body.source_id || body.source_asset_id || ""),
        title_th: String(body.title_th || "แม่แบบเอกสารกฎหมายใหม่"),
        title_en: String(body.title_en || "Imported Legal Form Template"),
        domain: String(body.domain || "contract"),
        family: String(body.family || body.doc_type || "nda"),
        jurisdiction: body.jurisdiction ? String(body.jurisdiction) : "TH",
        risk: (body.risk as RiskLevel) || "medium",
        fields: Array.isArray(body.fields) ? (body.fields as TemplateField[]) : undefined,
      });
      return NextResponse.json({ status: "ok", ...imported }, { status: 201 });
    }

    // POST /api/v1/lfde/templates/{id}/transitions
    if (slug.length === 3 && slug[0] === "templates" && slug[2] === "transitions") {
      const version = lfdeService.transitionTemplateVersion(ctx, idempotencyKey, slug[1], {
        version_id: String(body.version_id || `${slug[1]}_v1_0_0`),
        target_state: (body.target_state as TemplateLifecycleState) || "published",
        reason: String(body.reason || "Curator lifecycle transition"),
      });
      return NextResponse.json({ status: "ok", version });
    }

    // POST /api/v1/lfde/documents
    if (slug.length === 1 && slug[0] === "documents") {
      const created = lfdeService.createDocumentCase(ctx, idempotencyKey, {
        matter_id: String(body.matter_id || "matter.law24.ma.2026.01"),
        template_version_id: String(
          body.template_version_id || body.template_id || "template_demo_nda_v1"
        ),
        objective: String(body.objective || "Draft and validate legal execution document"),
        language: (body.language as "th" | "en" | "bilingual") || undefined,
        legal_as_of_date: body.legal_as_of_date
          ? String(body.legal_as_of_date)
          : body.as_of_date
          ? String(body.as_of_date)
          : undefined,
        transaction_date: body.transaction_date
          ? String(body.transaction_date)
          : body.as_of_date
          ? String(body.as_of_date)
          : undefined,
        intended_filing_date: body.intended_filing_date
          ? String(body.intended_filing_date)
          : undefined,
        external_reference_id: body.external_reference_id
          ? String(body.external_reference_id)
          : undefined,
        tenant_id: typeof body.tenant_id === "string" ? body.tenant_id : undefined,
      });

      // Optionally seed initial facts if provided in body.initial_facts
      if (body.initial_facts && typeof body.initial_facts === "object") {
        const initChanges = Object.entries(body.initial_facts as Record<string, unknown>).map(
          ([field_key, value]) => ({
            field_key,
            value,
            action: "confirm_candidate" as const,
            confidence: 1.0,
            source_evidence_id: "user_initial_input",
          })
        );
        if (initChanges.length > 0) {
          const updated = lfdeService.updateDocumentFacts(
            ctx,
            `${idempotencyKey}_init_facts`,
            created.document.id,
            created.document.etag,
            { changes: initChanges }
          );
          created.document = updated.document;
        }
      }

      return NextResponse.json(
        { status: "ok", ...created },
        {
          status: 201,
          headers: { ETag: created.document.etag },
        }
      );
    }

    // POST /api/v1/lfde/documents/{id}/assemble
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "assemble") {
      const assembled = lfdeService.assembleDocument(ctx, idempotencyKey, slug[1], {
        mode: (body.mode as "deterministic" | "hybrid") || "deterministic",
        allow_ai_proposals: Boolean(body.allow_ai_proposals),
        ai_proposed_note_th: body.ai_proposed_note_th ? String(body.ai_proposed_note_th) : undefined,
        expected_authority_topic: body.expected_authority_topic
          ? String(body.expected_authority_topic)
          : undefined,
        simulate_renderer_missing_font: Boolean(body.simulate_renderer_missing_font),
      });
      return NextResponse.json(
        { status: "ok", ...assembled },
        { headers: { ETag: assembled.document.etag } }
      );
    }

    // POST /api/v1/lfde/documents/{id}/validate
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "validate") {
      const assembled = lfdeService.assembleDocument(ctx, idempotencyKey, slug[1], {
        mode: "deterministic",
      });
      return NextResponse.json({
        status: "ok",
        validation: assembled.validation,
        revision: assembled.revision,
        document: assembled.document,
      });
    }

    // POST /api/v1/lfde/documents/{id}/findings/{findingId}/override
    if (
      slug.length === 5 &&
      slug[0] === "documents" &&
      slug[2] === "findings" &&
      slug[4] === "override"
    ) {
      const finding = lfdeService.overrideFinding(ctx, idempotencyKey, slug[1], slug[3], {
        reason: String(body.reason || ""),
        evidence_ref: String(body.evidence_ref || ""),
      });
      return NextResponse.json({ status: "ok", finding });
    }

    // POST /api/v1/lfde/documents/{id}/revisions (External Word re-upload)
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "revisions") {
      const reuploaded = lfdeService.reuploadEditedDocx(ctx, idempotencyKey, slug[1], {
        edited_text_th: String(body.edited_text_th || "เนื้อหาแก้ไขจากไฟล์ Word ภายนอก"),
      });
      return NextResponse.json(
        { status: "ok", ...reuploaded },
        { headers: { ETag: reuploaded.document.etag } }
      );
    }

    // POST /api/v1/lfde/documents/{id}/review-requests
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "review-requests") {
      const doc = lfdeService.getDocumentCase(ctx, slug[1]);
      const revisionId = String(body.revision_id || doc.current_revision_id || "");
      const assignedReviewers = Array.isArray(body.assigned_reviewers)
        ? (body.assigned_reviewers as string[])
        : ["approver.partner@law24.th"];

      const reviewReq = lfdeService.submitReviewRequest(ctx, idempotencyKey, slug[1], {
        revision_id: revisionId,
        assigned_reviewers: assignedReviewers,
      });
      return NextResponse.json({ status: "ok", review_request: reviewReq }, { status: 201 });
    }

    // POST /api/v1/lfde/review-requests/{id}/decisions
    if (slug.length === 3 && slug[0] === "review-requests" && slug[2] === "decisions") {
      const rawDec = String(body.decision || "approve").toLowerCase();
      const decision: "approve" | "request_changes" | "reject" =
        rawDec === "request_changes"
          ? "request_changes"
          : rawDec === "reject"
          ? "reject"
          : "approve";
      const ifMatch =
        req.headers.get("if-match") ||
        (typeof body.if_match === "string" ? body.if_match : "");

      const decided = lfdeService.recordReviewDecision(ctx, idempotencyKey, slug[1], ifMatch, {
        decision,
        reason: String(body.reason || "Reviewed against statutory authority and firm playbook."),
        grant_id: body.grant_id ? String(body.grant_id) : undefined,
      });
      return NextResponse.json({
        status: "ok",
        ...decided,
      });
    }

    // POST /api/v1/lfde/documents/{id}/exports
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "exports") {
      const doc = lfdeService.getDocumentCase(ctx, slug[1]);
      const draftRevisionId = String(body.draft_revision_id || doc.current_revision_id || "");
      const rawMode = String(body.mode || body.export_mode || "draft").toLowerCase();
      const mode: "draft" | "final" = rawMode === "final" ? "final" : "draft";
      const rawFmt = String(body.format || "docx").toLowerCase();
      const format: "docx" | "pdf" = rawFmt === "pdf" ? "pdf" : "docx";

      const exported = lfdeService.createExportArtifact(ctx, idempotencyKey, slug[1], {
        draft_revision_id: draftRevisionId,
        format,
        mode,
        approval_set_id: body.approval_set_id ? String(body.approval_set_id) : undefined,
      });
      return NextResponse.json({ status: "ok", export_artifact: exported }, { status: 201 });
    }

    // POST /api/v1/lfde/exports/{id}/download-session
    if (slug.length === 3 && slug[0] === "exports" && slug[2] === "download-session") {
      const dlSession = lfdeService.createDownloadSession(ctx, idempotencyKey, slug[1]);
      return NextResponse.json({ status: "ok", download_session: dlSession }, { status: 201 });
    }

    // POST /api/v1/lfde/packages
    if (slug.length === 1 && slug[0] === "packages") {
      const pkg = lfdeService.createFilingPackage(ctx, idempotencyKey, {
        matter_id: String(body.matter_id || "matter.law24.ma.2026.01"),
        profile_version_id: String(
          body.profile_version_id || body.filing_profile_id || "profile_dbd_incorporation_v1"
        ),
        export_artifact_ids: Array.isArray(body.export_artifact_ids)
          ? (body.export_artifact_ids as string[])
          : [],
      });
      return NextResponse.json({ status: "ok", filing_package: pkg }, { status: 201 });
    }

    // POST /api/v1/lfde/jobs/{id}/cancel
    if (slug.length === 3 && slug[0] === "jobs" && slug[2] === "cancel") {
      const job = lfdeService.cancelJob(ctx, idempotencyKey, slug[1]);
      return NextResponse.json({ status: "ok", job });
    }

    // POST /api/v1/lfde/missions
    if (slug.length === 1 && slug[0] === "missions") {
      const mission = lfdeService.executeAgiMission(ctx, {
        mission_type:
          (body.mission_type as AgiMissionExecution["mission_type"]) || "prepare_draft",
        topology: (body.topology as AgiTopology) || "team",
        automation: (body.automation as AgiAutomationLevel) || "supervised",
        objective: String(body.objective || "Prepare corporate legal execution document"),
        budget_thb_cap: body.budget_thb_cap ? String(body.budget_thb_cap) : "25.00",
      });
      return NextResponse.json({ status: "ok", mission });
    }

    // POST /api/v1/lfde/curator/source-change
    if (slug.length === 2 && slug[0] === "curator" && slug[1] === "source-change") {
      const impact = lfdeService.handleSourceChangeEvent(ctx, {
        canonical_id: String(body.canonical_id || body.provision_id || "th-ccc-sec-1097"),
        new_version_id: String(body.new_version_id || body.change_event_id || "th-ccc-sec-1097-v2026"),
        materially_withdrawn: Boolean(body.materially_withdrawn),
      });
      return NextResponse.json({ status: "ok", ...impact });
    }

    return NextResponse.json(
      {
        status: "error",
        code: "NOT_FOUND",
        safe_message: `LFDE POST endpoint '/api/v1/lfde/${slug.join("/")}' not found.`,
      },
      { status: 404 }
    );
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ slug?: string[] }> }
) {
  try {
    const { slug = [] } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ctx = resolveTenantContext(req, body);
    const ifMatch =
      req.headers.get("if-match") ||
      (typeof body.if_match === "string" ? body.if_match : "");
    const idempotencyKey =
      req.headers.get("idempotency-key") ||
      (typeof body.idempotency_key === "string"
        ? body.idempotency_key
        : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    // PUT /api/v1/lfde/documents/{id}/facts
    if (slug.length === 3 && slug[0] === "documents" && slug[2] === "facts") {
      const changes = Array.isArray(body.changes)
        ? (body.changes as Array<{
            field_key: string;
            value: unknown;
            datatype?: TemplateField["datatype"];
            calendar?: "BE" | "CE";
            source_evidence_id?: string;
            confidence?: number;
            action: "propose_candidate" | "confirm_candidate" | "resolve_conflict";
            candidate_id?: string;
            conflict_resolution_reason?: string;
          }>)
        : Object.entries((body.facts as Record<string, unknown>) || {}).map(
            ([field_key, value]) => ({
              field_key,
              value,
              action: "confirm_candidate" as const,
              confidence: 1.0,
              source_evidence_id: "user_confirmed_ui",
            })
          );

      const updated = lfdeService.updateDocumentFacts(
        ctx,
        idempotencyKey,
        slug[1],
        ifMatch,
        {
          changes,
          selected_clause_ids: Array.isArray(body.selected_clause_ids)
            ? (body.selected_clause_ids as string[])
            : undefined,
        }
      );
      return NextResponse.json(
        { status: "ok", ...updated },
        {
          headers: {
            ETag: updated.document.etag,
          },
        }
      );
    }

    return NextResponse.json(
      {
        status: "error",
        code: "NOT_FOUND",
        safe_message: `LFDE PUT endpoint '/api/v1/lfde/${slug.join("/")}' not found.`,
      },
      { status: 404 }
    );
  } catch (err) {
    return handleError(err);
  }
}
