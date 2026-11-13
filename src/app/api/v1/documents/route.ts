import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type LegalSourceCategory,
  type PrivacyClass,
} from "@/packages/ocr-v2";

export async function GET(req: NextRequest) {
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const q = req.nextUrl.searchParams.get("q");
  if (q !== null) {
    const searchOut = reg24OcrV2Service.searchPublishedOcrKnowledge({
      query: q,
      principal,
    });
    return NextResponse.json(searchOut, { status: 200 });
  }
  return NextResponse.json(reg24OcrV2Service.getWorkspaceOverview(principal), {
    status: 200,
  });
}

export async function POST(req: NextRequest) {
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const body = (await req.json()) as Record<string, unknown>;
  const idempotencyKey =
    req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);

  const res = reg24OcrV2Service.registerDocument({
    principal,
    idempotency_key: idempotencyKey,
    title_th: String(body.title_th || ""),
    title_en: body.title_en ? String(body.title_en) : undefined,
    source_category: (body.source_category as LegalSourceCategory) || "statute",
    privacy_class: (body.privacy_class as PrivacyClass) || "public",
    expected_sha256: String(body.expected_sha256 || ""),
    original_url: (body.original_url as string | null) ?? null,
    publisher_asserted: body.publisher_asserted ? String(body.publisher_asserted) : undefined,
    declared_document_date: (body.declared_document_date as string | null) ?? null,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
