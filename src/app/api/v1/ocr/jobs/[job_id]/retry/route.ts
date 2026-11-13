import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type SimulatedProviderBehaviorOverride,
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

  const res = reg24OcrV2Service.retryOcrJob({
    principal,
    idempotency_key: idempotencyKey,
    job_id,
    retry_scope: body.retry_scope as "failed_or_unresolved_pages" | "full_document" | undefined,
    simulation: body.simulation as SimulatedProviderBehaviorOverride | undefined,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
