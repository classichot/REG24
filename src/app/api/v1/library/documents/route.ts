import { NextRequest, NextResponse } from "next/server";
import {
  reusableLegalKnowledgeLibrary,
  type ConsumingApplicationId,
} from "@/core/library/legal-knowledge-library";

export async function GET(req: NextRequest) {
  const tenantId =
    req.nextUrl.searchParams.get("tenant_id") ||
    req.headers.get("x-reg24-tenant") ||
    "tenant.law24.prod";
  const consumingApp = (req.nextUrl.searchParams.get("app") ||
    req.headers.get("x-reg24-app") ||
    "REG24") as ConsumingApplicationId;

  const snapshot = reusableLegalKnowledgeLibrary.getLibrarySnapshot(tenantId, consumingApp);
  return NextResponse.json({
    status: "ok",
    specification_id: "REG24-KL-001",
    requirement_ids: ["LIB-01", "LIB-05", "LIB-06", "LIB-10", "LIB-15"],
    library: snapshot,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = reusableLegalKnowledgeLibrary.registerAndIngestDocument({
      tenantId: body.tenantId || body.tenant_id || "tenant.law24.prod",
      title: body.title || "Untitled Legal Commentary",
      titleTh: body.titleTh || body.title_th,
      authors: Array.isArray(body.authors)
        ? body.authors
        : body.author
        ? [String(body.author)]
        : ["Legal Scholar"],
      publisher: body.publisher,
      edition: body.edition,
      publicationDate: body.publicationDate || body.publication_date,
      sourceType: body.sourceType || body.source_type || "textbook",
      sourceFormat: body.sourceFormat || body.source_format || "SEARCHABLE_PDF",
      legalTopics: body.legalTopics || body.legal_topics,
      citedProvisions: body.citedProvisions || body.cited_provisions,
      rightsHolder: body.rightsHolder || body.rights_holder,
      rightsVerified: body.rightsVerified ?? body.rights_verified ?? true,
      sampleTextTh: body.sampleTextTh || body.sample_text_th,
      sampleTextEn: body.sampleTextEn || body.sample_text_en,
      pageStart: Number(body.pageStart || body.page_start || 1),
      pageEnd: Number(body.pageEnd || body.page_end || 24),
    });

    return NextResponse.json({
      status: "ok",
      specification_id: "REG24-KL-001",
      requirement_ids: ["LIB-01", "LIB-02", "LIB-03", "LIB-04", "LIB-05", "LIB-10"],
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Invalid document registration payload",
      },
      { status: 400 }
    );
  }
}
