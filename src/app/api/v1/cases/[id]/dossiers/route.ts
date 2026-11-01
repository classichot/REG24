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
    dossiers: bundle.body.dossiers,
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const tenantId = body.tenant_id || req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
    const principalId = body.principal_id || req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

    if (body.action === "review" && body.dossier_id) {
      const reviewRes = reg24CaseIntelligenceService.reviewDossier({
        tenant_id: tenantId,
        case_id: id,
        dossier_id: String(body.dossier_id),
        principal_id: principalId,
        decision: body.decision === "in_review" ? "in_review" : "approved",
        review_note: String(body.review_note || "Reviewed and approved by counsel"),
      });
      return NextResponse.json(reviewRes.body, { status: reviewRes.status });
    }

    const genRes = reg24CaseIntelligenceService.generateDossier({
      tenant_id: tenantId,
      case_id: id,
      principal_id: principalId,
      language: body.language === "en" ? "en" : "th",
      format: body.format || "DOCX_FIXED_TEMPLATE",
    });

    return NextResponse.json(genRes.body, { status: genRes.status });
  } catch (err) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: String(err) } }, { status: 400 });
  }
}
