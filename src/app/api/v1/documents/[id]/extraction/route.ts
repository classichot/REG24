import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
} from "@/packages/ocr-v2";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const extractionVersionId = req.nextUrl.searchParams.get("extraction_version_id");

  const res = reg24OcrV2Service.getExtractionCompatibility({
    principal,
    document_id: id,
    extraction_version_id: extractionVersionId,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
