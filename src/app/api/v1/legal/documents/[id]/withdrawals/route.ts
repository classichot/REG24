import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
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

  const res = reg24OcrV2Service.withdrawPublication({
    principal,
    idempotency_key: idempotencyKey,
    if_match: ifMatch,
    document_id: id,
    active_publication_id: String(body.active_publication_id || ""),
    reason: String(body.reason || ""),
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
