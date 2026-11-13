import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
} from "@/packages/ocr-v2";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; extraction_version_id: string }> }
) {
  const { id, extraction_version_id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);

  const res = reg24OcrV2Service.getExtractionManifest({
    principal,
    document_id: id,
    extraction_version_id,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
