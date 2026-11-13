import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type SourceSpan,
} from "@/packages/ocr-v2";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const body = (await req.json()) as Record<string, unknown>;
  const idempotencyKey =
    req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);
  const ifMatch = req.headers.get("if-match") ?? undefined;

  const res = reg24OcrV2Service.submitCorrection({
    principal,
    idempotency_key: idempotencyKey,
    if_match: ifMatch,
    document_id: id,
    extraction_version_id: String(body.extraction_version_id || ""),
    source_spans: (body.source_spans as SourceSpan[]) || [],
    before_text: String(body.before_text ?? ""),
    after_text: String(body.after_text ?? ""),
    issue_ids: (body.issue_ids as string[]) || [],
    reason: String(body.reason || ""),
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
