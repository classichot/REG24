import { NextRequest, NextResponse } from "next/server";
import { reg24CaseIntelligenceService } from "@/packages/case-intelligence";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const principalId = req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

  const bundle = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
    tenant_id: tenantId,
    case_id: id,
    principal_id: principalId,
  });

  if (bundle.status !== 200 || "error" in bundle.body) {
    return NextResponse.json(bundle.body, { status: bundle.status });
  }

  const timeline = bundle.body.timeline;
  return NextResponse.json({
    specification_id: "REG24-CII-001",
    case_id: id,
    timeline,
    chronological_lane: timeline.filter((e) => e.lane === "chronological"),
    undated_lane: timeline.filter((e) => e.lane === "undated_lane"),
  });
}
