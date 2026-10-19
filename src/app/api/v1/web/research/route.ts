import { NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "snapshot";
  const tenantId = searchParams.get("tenant_id") || "tenant.law24.prod";

  if (action === "search") {
    const res = reg24Core.searchWebLegalAuthorities({
      query: searchParams.get("query") || undefined,
      document_category: (searchParams.get("document_category") as never) || "ALL",
      legal_domain: (searchParams.get("legal_domain") as never) || "ALL",
      authority: searchParams.get("authority") || undefined,
      effective_date: searchParams.get("effective_date") || undefined,
      tenant_id: tenantId,
    });
    return NextResponse.json(res);
  }

  if (action === "session") {
    const sessionId = searchParams.get("session_id") || "websess.th.solar_dd.001";
    const res = reg24Core.getWebResearchSession({
      session_id: sessionId,
      requesting_tenant_id: tenantId,
    });
    return NextResponse.json(res, { status: res.status === "forbidden" ? 403 : 200 });
  }

  if (action === "temporal_compare") {
    const res = reg24Core.compareWebTemporalProvisions({
      provision_id: searchParams.get("provision_id") || undefined,
      queried_as_of_date: searchParams.get("queried_as_of_date") || undefined,
      comparison_target_date: searchParams.get("comparison_target_date") || undefined,
    });
    return NextResponse.json(res);
  }

  return NextResponse.json(reg24Core.getWebResearchWorkspaceSnapshot(tenantId));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action || "execute_research";

    if (action === "execute_research") {
      const res = reg24Core.executeWebLegalResearch(body);
      return NextResponse.json(
        {
          ...res,
          snapshot: reg24Core.getDashboardSnapshot(),
        },
        { status: res.status === "forbidden" ? 403 : 200 }
      );
    }

    if (action === "cancel_or_retry_deep_research") {
      const res = reg24Core.cancelWebDeepResearchJob(body);
      return NextResponse.json({
        ...res,
        snapshot: reg24Core.getDashboardSnapshot(),
      });
    }

    if (action === "search_authorities") {
      const res = reg24Core.searchWebLegalAuthorities(body);
      return NextResponse.json(res);
    }

    if (action === "compare_temporal") {
      const res = reg24Core.compareWebTemporalProvisions(body);
      return NextResponse.json(res);
    }

    if (action === "manage_session") {
      const res = reg24Core.manageWebResearchSession(body);
      return NextResponse.json({
        ...res,
        snapshot: reg24Core.getDashboardSnapshot(),
      });
    }

    if (action === "export_session") {
      const res = reg24Core.exportWebResearchSession(body);
      return NextResponse.json(res);
    }

    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process Web Research request" },
      { status: 500 }
    );
  }
}
