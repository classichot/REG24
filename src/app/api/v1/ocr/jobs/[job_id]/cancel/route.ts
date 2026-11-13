import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
} from "@/packages/ocr-v2";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const idempotencyKey =
    req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);

  const res = reg24OcrV2Service.cancelOcrJob({
    principal,
    idempotency_key: idempotencyKey,
    job_id,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
