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
    documents: bundle.body.documents,
    coverage_summary: bundle.body.coverage_summary,
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const tenantId = body.tenant_id || req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
    const principalId = body.principal_id || req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

    const res = reg24CaseIntelligenceService.intakeDocument({
      tenant_id: tenantId,
      case_id: id,
      principal_id: principalId,
      original_name: String(body.original_name || body.filename || "Uploaded_Evidence.pdf"),
      mime_type: String(body.mime_type || "application/pdf"),
      size_bytes: Number(body.size_bytes ?? 24500),
      content_bytes_sample: String(body.content_bytes_sample || body.raw_text || "Sample document content"),
      classification: body.classification,
      has_embedded_macros: Boolean(body.has_embedded_macros),
    });

    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: String(err) } }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const documentId = req.nextUrl.searchParams.get("document_id") || "";
  const tenantId = req.headers.get("x-reg24-tenant") || "tenant.law24.prod";
  const principalId = req.headers.get("x-reg24-principal") || "counsel.somchai@law24.th";

  const res = reg24CaseIntelligenceService.deleteOrTombstoneDocument({
    tenant_id: tenantId,
    case_id: id,
    document_id: documentId,
    principal_id: principalId,
  });

  return NextResponse.json(res.body, { status: res.status });
}
