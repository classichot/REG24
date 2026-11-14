/**
 * REG24 — 8-Stage Knowledge Ingestion Pipeline REST API (Cleaned per SH-10 & Section 8)
 *
 * Security & Integrity Rules (SH-10):
 * - GET requests are strictly read-only and NEVER execute mutations or "certify" production via demo tests.
 * - POST requests validate all required inputs and NEVER fabricate fallback legal text, dates,
 *   submitter identities, or default reviewer approvals.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  knowledgeIngestionPipeline,
  type AccessScopeKind,
  type SourceAuthenticity,
  type RightsStatus,
} from "@/core/ingestion/knowledge-ingestion-pipeline";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "dashboard";
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";

  // SH-10 & Section 8: GET must not run mutations or certify production by executing demo tests
  if (action === "acceptance_tests") {
    return NextResponse.json(
      {
        code: "METHOD_NOT_ALLOWED",
        message:
          "GET requests cannot execute simulated acceptance suites or certify production state (SH-10 / Section 8). Run automated Vitest suites or POST /api/v1/knowledge/releases/{id}/evaluate against a pinned candidate release.",
        retryable: false,
      },
      { status: 405 }
    );
  }

  const snap = knowledgeIngestionPipeline.getPipelineDashboardSnapshot(tenantId);

  if (action === "job") {
    const jobId = req.nextUrl.searchParams.get("job_id") || "";
    if (!jobId) {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Missing required query parameter 'job_id'", retryable: false },
        { status: 400 }
      );
    }
    const found = snap.jobs.find((j) => j.job_id === jobId);
    if (!found) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Ingestion job not found", retryable: false },
        { status: 404 }
      );
    }
    return NextResponse.json({
      request_id: `req_ing_${Date.now()}`,
      job: found,
    });
  }

  if (action === "reviews") {
    return NextResponse.json({
      request_id: `req_rev_${Date.now()}`,
      open_reviews: snap.open_reviews,
    });
  }

  if (action === "citation") {
    const documentId = req.nextUrl.searchParams.get("document_id") || "";
    const versionId = req.nextUrl.searchParams.get("version_id") || "";
    if (!documentId || !versionId) {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Both 'document_id' and 'version_id' are required", retryable: false },
        { status: 400 }
      );
    }
    const scopeId = req.nextUrl.searchParams.get("scope_id") || `scope.${tenantId}.ws.law24.tax`;
    const res = knowledgeIngestionPipeline.resolveCitationWithAccessAndWithdrawalCheck({
      document_id: documentId,
      version_id: versionId,
      caller_scope_ids: ["scope.platform.public", scopeId],
    });
    return NextResponse.json(res, { status: res.http_status });
  }

  return NextResponse.json({
    status: "ok",
    specification: "REG24 Knowledge Ingestion Pipeline v1.1 (SH-10 Hardened)",
    persistence_mode: "in_memory_staging_service",
    production_certified: false,
    dashboard: snap,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const action = String(body.action || "");
    const authenticatedActor = req.headers.get("x-reg24-actor") || body.submitted_by || body.reviewer_id || body.withdrawn_by;
    const tenantId = String(req.headers.get("x-reg24-tenant") || body.tenant_id || "").trim();
    const idempotencyKey =
      req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);

    if (!action) {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Missing required 'action' field" },
        { status: 400 }
      );
    }

    if (action === "ingest_upload" || action === "url_import") {
      const submittedBy = typeof body.submitted_by === "string" ? body.submitted_by.trim() : "";
      const originalName = typeof body.original_name === "string" ? body.original_name.trim() : "";
      const rawText = typeof body.raw_text === "string" ? body.raw_text : "";
      const byteCount = Number(body.byte_count);

      // SH-10: Never invent fallback text, fallback dates, or default actor identities!
      if (!submittedBy || !tenantId || !originalName || !rawText.trim() || !Number.isFinite(byteCount) || byteCount <= 0) {
        return NextResponse.json(
          {
            code: "VALIDATION_FAILED",
            message:
              "SH-10 validation failed: 'submitted_by', 'tenant_id', 'original_name', non-empty 'raw_text', and positive 'byte_count' are mandatory. Fabricated fallback text and dates are prohibited.",
          },
          { status: 400 }
        );
      }

      const res = knowledgeIngestionPipeline.ingestSource({
        submitted_by: submittedBy,
        tenant_id: tenantId,
        workspace_id: String(body.workspace_id || "ws.default").trim(),
        access_scope_kind: (body.access_scope_kind || "workspace") as AccessScopeKind,
        original_name: originalName,
        media_type: String(body.media_type || "application/pdf"),
        byte_count: byteCount,
        page_count: typeof body.page_count === "number" ? body.page_count : undefined,
        source_uri: body.source_uri ? String(body.source_uri) : null,
        source_authenticity: (body.source_authenticity || "unverified") as SourceAuthenticity,
        rights_status: (body.rights_status || "pending_review") as RightsStatus,
        raw_text: rawText,
        // SH-10: Absent dates stay explicitly null (unknown), never replaced with upload/current date!
        published_on: typeof body.published_on === "string" && body.published_on.trim() ? body.published_on.trim() : null,
        effective_from: typeof body.effective_from === "string" && body.effective_from.trim() ? body.effective_from.trim() : null,
        effective_to: typeof body.effective_to === "string" && body.effective_to.trim() ? body.effective_to.trim() : null,
        auto_publish_allowed: body.auto_publish_allowed === true,
        has_mixed_scan_pages: Boolean(body.has_mixed_scan_pages),
        simulate_critical_ocr_token_uncertainty: Boolean(body.simulate_critical_ocr_token_uncertainty),
        simulate_corrupt_or_encrypted: Boolean(body.simulate_corrupt_or_encrypted),
        simulate_malicious_or_macro: Boolean(body.simulate_malicious_or_macro),
        simulate_projection_failure: Boolean(body.simulate_projection_failure),
        idempotency_key: idempotencyKey,
      });

      return NextResponse.json(res, { status: res.http_status });
    }

    if (action === "review_decision") {
      const reviewId = typeof body.review_id === "string" ? body.review_id.trim() : "";
      const reviewerId = typeof body.reviewer_id === "string" ? body.reviewer_id.trim() : "";
      const decision = body.decision;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const expectedRevision = Number(body.expected_revision);

      // SH-10: Never supply a default reviewer identity or default "approve" decision!
      if (
        !reviewId ||
        !reviewerId ||
        !reason ||
        !Number.isInteger(expectedRevision) ||
        (decision !== "approve" && decision !== "correct" && decision !== "reject")
      ) {
        return NextResponse.json(
          {
            code: "VALIDATION_FAILED",
            message:
              "SH-10 validation failed: explicit 'review_id', authenticated 'reviewer_id', 'expected_revision', valid 'decision' (approve|correct|reject), and 'reason' are required.",
          },
          { status: 400 }
        );
      }

      const res = knowledgeIngestionPipeline.submitReviewTaskDecision({
        review_id: reviewId,
        expected_revision: expectedRevision,
        reviewer_id: reviewerId,
        decision,
        corrected_value: typeof body.corrected_value === "string" ? body.corrected_value : undefined,
        reason,
      });

      const status =
        res.status === "conflict_409" ? 409 : res.status === "not_found_404" ? 404 : 200;
      return NextResponse.json(res, { status });
    }

    if (action === "cancel_job") {
      const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
      if (!jobId || !authenticatedActor) {
        return NextResponse.json(
          { code: "VALIDATION_FAILED", message: "'job_id' and actor identity are required" },
          { status: 400 }
        );
      }
      const res = knowledgeIngestionPipeline.cancelOrPauseJob({
        job_id: jobId,
        mode: (body.mode || "cancel") as "cancel" | "budget_pause",
        stale_worker_fencing_token:
          typeof body.stale_worker_fencing_token === "number"
            ? body.stale_worker_fencing_token
            : undefined,
      });
      return NextResponse.json(res);
    }

    if (action === "withdraw_document") {
      const docId = typeof body.document_id === "string" ? body.document_id.trim() : "";
      const withdrawnBy = typeof body.withdrawn_by === "string" ? body.withdrawn_by.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!docId || !withdrawnBy || !reason) {
        return NextResponse.json(
          {
            code: "VALIDATION_FAILED",
            message: "SH-10 validation failed: 'document_id', 'withdrawn_by', and 'reason' are required.",
          },
          { status: 400 }
        );
      }
      const tomb = knowledgeIngestionPipeline.withdrawDocument({
        document_id: docId,
        withdrawn_by: withdrawnBy,
        reason,
      });
      return NextResponse.json(
        {
          status: tomb ? "withdrawn" : "not_found",
          tombstone: tomb,
        },
        { status: tomb ? 200 : 404 }
      );
    }

    return NextResponse.json(
      { code: "INVALID_ACTION", message: `Unsupported action '${action}'` },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        code: "BAD_REQUEST",
        message: err instanceof Error ? err.message : "Invalid JSON payload",
      },
      { status: 400 }
    );
  }
}
