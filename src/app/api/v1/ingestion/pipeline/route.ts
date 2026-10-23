/**
 * REG24 — 8-Stage Knowledge Ingestion Pipeline REST API (Section 14)
 *
 * Implements:
 * - GET ?action=dashboard (8-stage jobs, review queue, tombstones, embedding config, AT01-AT24 certification)
 * - GET ?action=job&job_id=... (Detailed job status, 8 stages, chunks, Neo4j assertions, release manifest, Knowledge Receipt)
 * - GET ?action=reviews (Open review queue filtered by scope)
 * - GET ?action=citation&document_id=...&version_id=... (Resolve citation with ACL & WithdrawalTombstone enforcement)
 * - GET ?action=acceptance_tests (Run all 24 mandatory acceptance tests AT01..AT24)
 * - POST (action=ingest_upload | url_import | review_decision | cancel_job | withdraw_document)
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
  const snap = knowledgeIngestionPipeline.getPipelineDashboardSnapshot(tenantId);

  if (action === "job") {
    const jobId = req.nextUrl.searchParams.get("job_id") || "";
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
    const scopeId = req.nextUrl.searchParams.get("scope_id") || `scope.${tenantId}.ws.law24.tax`;
    const res = knowledgeIngestionPipeline.resolveCitationWithAccessAndWithdrawalCheck({
      document_id: documentId,
      version_id: versionId,
      caller_scope_ids: ["scope.platform.public", scopeId],
    });
    return NextResponse.json(res, { status: res.http_status });
  }

  if (action === "acceptance_tests") {
    return NextResponse.json(knowledgeIngestionPipeline.runAll24AcceptanceTests());
  }

  return NextResponse.json({
    status: "ok",
    specification: "REG24 Knowledge Ingestion Pipeline v1.0 (24 October 2026)",
    dashboard: snap,
    acceptance: knowledgeIngestionPipeline.runAll24AcceptanceTests(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "ingest_upload");
    const tenantId = String(req.headers.get("x-reg24-tenant") || body.tenant_id || "tenant.law24.prod");
    const idempotencyKey =
      req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);

    if (action === "ingest_upload" || action === "url_import") {
      const res = knowledgeIngestionPipeline.ingestSource({
        submitted_by: String(body.submitted_by || "counsel.somchai@law24.th"),
        tenant_id: tenantId,
        workspace_id: String(body.workspace_id || "ws.law24.tax"),
        access_scope_kind: (body.access_scope_kind || "workspace") as AccessScopeKind,
        original_name: String(body.original_name || "uploaded_legal_document.pdf"),
        media_type: String(body.media_type || "application/pdf"),
        byte_count: Number(body.byte_count ?? 45000),
        page_count: Number(body.page_count ?? 4),
        source_uri: body.source_uri ? String(body.source_uri) : null,
        source_authenticity: (body.source_authenticity || "user_supplied") as SourceAuthenticity,
        rights_status: (body.rights_status || "approved_internal_use") as RightsStatus,
        raw_text: String(
          body.raw_text ||
            "มาตรา 1 เอกสารกฎหมายที่นำเข้าผ่านระบบ REG24 Knowledge Ingestion Pipeline\nมาตรา 65 การคำนวณกำไรสุทธิเพื่อเสียภาษีเงินได้นิติบุคคล"
        ),
        published_on: body.published_on ? String(body.published_on) : "2026-10-24",
        effective_from: body.effective_from ? String(body.effective_from) : "2026-10-24",
        auto_publish_allowed: body.auto_publish_allowed !== false,
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
      const res = knowledgeIngestionPipeline.submitReviewTaskDecision({
        review_id: String(body.review_id || ""),
        expected_revision: Number(body.expected_revision ?? 1),
        reviewer_id: String(body.reviewer_id || "reviewer.legal@reg24.th"),
        decision: (body.decision || "approve") as "approve" | "correct" | "reject",
        corrected_value: body.corrected_value ? String(body.corrected_value) : undefined,
        reason: String(body.reason || "Reviewed and verified against original source page"),
      });

      const status =
        res.status === "conflict_409" ? 409 : res.status === "not_found_404" ? 404 : 200;
      return NextResponse.json(res, { status });
    }

    if (action === "cancel_job") {
      const res = knowledgeIngestionPipeline.cancelOrPauseJob({
        job_id: String(body.job_id || ""),
        mode: (body.mode || "cancel") as "cancel" | "budget_pause",
        stale_worker_fencing_token:
          typeof body.stale_worker_fencing_token === "number"
            ? body.stale_worker_fencing_token
            : undefined,
      });
      return NextResponse.json(res);
    }

    if (action === "withdraw_document") {
      const tomb = knowledgeIngestionPipeline.withdrawDocument({
        document_id: String(body.document_id || ""),
        withdrawn_by: String(body.withdrawn_by || "admin.platform@reg24.th"),
        reason: String(body.reason || "Authoritative withdrawal requested"),
      });
      return NextResponse.json({
        status: tomb ? "withdrawn" : "not_found",
        tombstone: tomb,
      });
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
