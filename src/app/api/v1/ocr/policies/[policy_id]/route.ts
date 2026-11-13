import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
} from "@/packages/ocr-v2";

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ policy_id: string }> }
) {
  const { policy_id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const body = (await req.json()) as Record<string, unknown>;
  const idempotencyKey =
    req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);
  const ifMatch = req.headers.get("if-match") ?? undefined;

  const res = reg24OcrV2Service.updatePolicy({
    principal,
    idempotency_key: idempotencyKey,
    if_match: ifMatch,
    policy_id,
    updates: body,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
