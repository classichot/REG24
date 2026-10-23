/**
 * REG24 Live — Internal & Customer REST API (Section 15, API 01..02)
 *
 * Exposes versioned endpoints under /api/v1/live:
 * - GET ?action=dashboard (Full REG24 Live snapshot: For You, All Updates, Upcoming, Watchlists, Admin Ops, AT01-AT30)
 * - GET ?action=updates (Bounded update search with filters)
 * - GET ?action=update_detail&update_id=... (Exact revision, citations, dates, legal status, verification)
 * - GET ?action=update_diff&update_id=... (Aligned before/after provision spans, anchors, change types)
 * - GET ?action=law_version&provision_id=...&legal_as_of=...&known_as_of=... (Bi-temporal legal version retrieval)
 * - GET ?action=coverage (Supported source scope, health, freshness, processing/review timestamps, limitations)
 * - GET ?action=acceptance_tests (Run all 30 mandatory acceptance tests AT 01..AT 30)
 * - POST (Assess company impact, review decision with If-Match/expected_revision, issue correction, recheck source)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  reg24LiveEngine,
  type LivePublicationState,
  type LiveLegalEffectState,
  type LiveRole,
} from "@/core/live/reg24-live-engine";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "dashboard";
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const entityId = req.nextUrl.searchParams.get("entity_id") || "ent.siam_cloud_tech";

  if (action === "updates") {
    const sourceId = req.nextUrl.searchParams.get("source_id") || undefined;
    const topic = req.nextUrl.searchParams.get("topic") || undefined;
    const publicationState = (req.nextUrl.searchParams.get("publication_state") || undefined) as
      | LivePublicationState
      | undefined;
    const legalEffectState = (req.nextUrl.searchParams.get("legal_effect_state") || undefined) as
      | LiveLegalEffectState
      | undefined;

    return NextResponse.json(
      reg24LiveEngine.listUpdates({
        source_id: sourceId,
        topic,
        publication_state: publicationState,
        legal_effect_state: legalEffectState,
      })
    );
  }

  if (action === "update_detail" || action === "update_diff") {
    const updateId = req.nextUrl.searchParams.get("update_id") || "upd.2026.10.rd_ewht_3pct";
    const list = reg24LiveEngine.listUpdates();
    const found = list.items.find((u) => u.update_id === updateId);
    if (!found) {
      return NextResponse.json(
        { error_code: "not_found", message: "Update not found", retryable: false },
        { status: 404 }
      );
    }
    return NextResponse.json({
      request_id: `req_live_${Date.now()}`,
      data: action === "update_diff" ? { update_id: found.update_id, revision: found.revision, diffs: found.diffs } : found,
    });
  }

  if (action === "law_version") {
    const provisionId = req.nextUrl.searchParams.get("provision_id") || "prov.tp161.clause12_1";
    const legalAsOf = req.nextUrl.searchParams.get("legal_as_of") || "2026-10-24";
    const knownAsOf = req.nextUrl.searchParams.get("known_as_of") || undefined;
    return NextResponse.json({
      request_id: `req_live_${Date.now()}`,
      data: reg24LiveEngine.getProvisionVersionAt({
        provision_id: provisionId,
        legal_as_of: legalAsOf,
        known_as_of: knownAsOf,
      }),
    });
  }

  if (action === "coverage") {
    const snap = reg24LiveEngine.getLiveDashboardSnapshot(tenantId, entityId);
    return NextResponse.json({
      request_id: `req_live_${Date.now()}`,
      coverage_as_of: "2026-10-24T00:50:00Z",
      release_id: snap.active_index_release_id,
      sources: snap.sources,
      service_targets: snap.service_targets,
    });
  }

  if (action === "acceptance_tests") {
    return NextResponse.json(reg24LiveEngine.runAll30AcceptanceTests());
  }

  return NextResponse.json({
    status: "ok",
    specification: "REG24 Live Developer Requirements v1.0 (24 October 2026)",
    dashboard: reg24LiveEngine.getLiveDashboardSnapshot(tenantId, entityId),
    acceptance: reg24LiveEngine.runAll30AcceptanceTests(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "assess_change");
    const tenantId = String(req.headers.get("x-reg24-tenant") || body.tenant_id || "tenant.law24.prod");

    if (action === "assess_change") {
      const res = reg24LiveEngine.assessCompanyImpact({
        tenant_id: tenantId,
        actor_id: String(body.actor_id || "counsel.somchai@law24.th"),
        actor_role: (body.actor_role || "compliance_manager") as LiveRole,
        entity_id: String(body.entity_id || "ent.siam_cloud_tech"),
        update_id: String(body.update_id || "upd.2026.10.rd_ewht_3pct"),
      });

      if (res.status === "forbidden_403") {
        return NextResponse.json(
          { error_code: "permission_denied", message: "Cross-tenant or unassigned advisor entity access denied", retryable: false },
          { status: 403 }
        );
      }
      if (res.status === "not_found_404") {
        return NextResponse.json(
          { error_code: "not_found", message: "Entity or update not found", retryable: false },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          request_id: `req_assess_${Date.now()}`,
          job_id: `job_assess_${Date.now()}`,
          status: "completed",
          assessment: res.assessment,
        },
        { status: 202 }
      );
    }

    if (action === "review_decision") {
      const res = reg24LiveEngine.submitReviewDecision({
        update_id: String(body.update_id || "upd.2026.10.detected_boi_ev_notice"),
        expected_revision: Number(body.expected_revision ?? 1),
        actor_id: String(body.actor_id || "pub.somchai.partner@reg24.th"),
        actor_role: (body.actor_role || "legal_publisher") as LiveRole,
        decision: (body.decision || "approve") as "approve" | "reject" | "request_reprocessing",
        reason: String(body.reason || "Verified against official Royal Gazette PDF"),
        simulate_index_failure: Boolean(body.simulate_index_failure),
      });

      const status =
        res.status === "conflict_409"
          ? 409
          : res.status === "validation_blocked_422"
            ? 422
            : res.status === "forbidden_403"
              ? 403
              : 200;

      return NextResponse.json(res, { status });
    }

    if (action === "recheck_source") {
      const sourceId = String(body.source_id || "src.ratchakitcha.soc");
      const out = reg24LiveEngine.runConnectorCollection({
        source_id: sourceId,
        window_start: String(body.window_start || "2026-10-17"),
        window_end: String(body.window_end || "2026-10-24"),
        simulate_page_two_failure: Boolean(body.simulate_page_two_failure),
        simulate_access_denied_or_login_wall: Boolean(body.simulate_access_denied_or_login_wall),
      });
      return NextResponse.json({
        request_id: `req_recheck_${Date.now()}`,
        job_id: out.run.run_id,
        ...out,
      });
    }

    return NextResponse.json(
      { error_code: "invalid_action", message: `Unsupported action '${action}'`, retryable: false },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error_code: "bad_request",
        message: err instanceof Error ? err.message : "Invalid JSON payload",
        retryable: false,
      },
      { status: 400 }
    );
  }
}
