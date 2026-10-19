import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenant_id") || "tenant.law24.prod";
  const profile = reg24Core.getEnterpriseTenantProfile(tenantId);
  const dq = reg24Core.getSection24DataQualityDashboard();
  const snap = reg24Core.getDashboardSnapshot();
  return NextResponse.json({
    status: "ok",
    enterprise_profile: profile,
    vibe24_ecosystem_targets: snap.vibe24EcosystemTargets,
    section24_data_quality_dashboard: dq,
  });
}
