import { NextRequest, NextResponse } from "next/server";
import { reg24CaseIntelligenceService } from "@/packages/case-intelligence";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const principalId = req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

  const res = reg24CaseIntelligenceService.getCaseGraph({
    tenant_id: tenantId,
    case_id: id,
    principal_id: principalId,
  });

  return NextResponse.json(res.body, { status: res.status });
}
