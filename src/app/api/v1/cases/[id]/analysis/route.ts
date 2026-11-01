import { NextRequest, NextResponse } from "next/server";
import { reg24CaseIntelligenceService } from "@/packages/case-intelligence";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id || req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
    const principalId = body.principal_id || req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";
    const idempotencyKey =
      req.headers.get("idempotency-key") ||
      body.idempotency_key ||
      `idem_${id}_${Date.now()}`;

    const res = reg24CaseIntelligenceService.startAnalysisJob({
      tenant_id: tenantId,
      case_id: id,
      principal_id: principalId,
      idempotency_key: String(idempotencyKey),
      document_version_ids: Array.isArray(body.document_version_ids)
        ? body.document_version_ids
        : ["docv_demo_1", "docv_demo_2", "docv_demo_3", "docv_demo_4"],
      language: body.language,
      jurisdiction: body.jurisdiction,
      legal_as_of: body.legal_as_of,
      modules: body.modules,
      budget_cap: body.budget_cap,
      requested_provider: body.requested_provider,
      simulate_provider_outage: Boolean(body.simulate_provider_outage),
    });

    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: String(err) } }, { status: 400 });
  }
}
