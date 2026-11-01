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

  return NextResponse.json({
    specification_id: "REG24-CII-001",
    case_id: id,
    facts: bundle.body.facts,
    issues: bundle.body.issues,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const tenantId = body.tenant_id || req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
    const principalId = body.principal_id || req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

    const res = reg24CaseIntelligenceService.correctFactAssertion({
      tenant_id: tenantId,
      case_id: id,
      fact_id: String(body.fact_id || "fact_demo_1"),
      principal_id: principalId,
      expected_revision: typeof body.expected_revision === "number" ? body.expected_revision : undefined,
      updated_assertion: String(body.updated_assertion || body.updated_statement_th || "แก้ไขและยืนยันข้อเท็จจริงโดยทนายความผู้รับผิดชอบ"),
      updated_iso_date: body.updated_iso_date,
      updated_review_status: body.updated_review_status || "accepted",
      reason: String(body.reason || "Verified against PDF page span SHA-256 hash"),
    });

    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: String(err) } }, { status: 400 });
  }
}
