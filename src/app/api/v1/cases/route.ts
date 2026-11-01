import { NextRequest, NextResponse } from "next/server";
import { reg24CaseIntelligenceService } from "@/packages/case-intelligence";

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const principalId = req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";
  const matters = reg24CaseIntelligenceService.listMatters(tenantId, principalId);
  return NextResponse.json({
    specification_id: "REG24-CII-001",
    version: "1.1",
    total: matters.length,
    matters,
    evaluation_gate: reg24CaseIntelligenceService.runCiiReleaseEvaluationSuite(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tenantId = body.tenant_id || req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
    const principalId = body.principal_id || req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";
    const res = reg24CaseIntelligenceService.createMatter({
      tenant_id: tenantId,
      principal_id: principalId,
      matter_ref: String(body.matter_ref || `MTR-${Date.now()}`),
      title: String(body.title || "New Commercial Dispute Matter"),
      client_ref: String(body.client_ref || "CLI-DEFAULT"),
      case_type: body.case_type,
      jurisdiction: body.jurisdiction,
      default_language: body.default_language,
      confidentiality: body.confidentiality,
      required_region: body.required_region,
      allowed_providers: body.allowed_providers,
      budget_cap_thb: body.budget_cap_thb,
    });
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: String(err) } }, { status: 400 });
  }
}
