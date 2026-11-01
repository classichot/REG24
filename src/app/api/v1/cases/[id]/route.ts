import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { reg24CaseIntelligenceService } from "@/packages/case-intelligence";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const principalId = req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

  // Check if this is a REG24 CII 001 Matter (e.g., case_demo or case_*)
  if (decodedId.startsWith("case_")) {
    const bundle = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: decodedId,
      principal_id: principalId,
    });
    return NextResponse.json(bundle.body, { status: bundle.status });
  }

  const res = reg24Core.getLegalCaseById(decodedId);
  if (!res.found) {
    return NextResponse.json(
      {
        found: false,
        error: `Canonical LegalCase '${id}' not found. REG24 never fabricates unverified cases.`,
      },
      { status: 404 }
    );
  }
  return NextResponse.json(res);
}
