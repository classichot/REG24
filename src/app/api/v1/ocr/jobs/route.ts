import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type SimulatedProviderBehaviorOverride,
} from "@/packages/ocr-v2";

export async function GET(req: NextRequest) {
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  return NextResponse.json({
    contract_version: "2.0.0",
    jobs: reg24OcrV2Service.listOcrJobs(principal),
  });
}

export async function POST(req: NextRequest) {
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const body = (await req.json()) as Record<string, unknown>;
  const idempotencyKey =
    req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);

  const res = reg24OcrV2Service.submitOcrJob({
    principal,
    idempotency_key: idempotencyKey,
    document_id: String(body.document_id || ""),
    source_version_id: String(body.source_version_id || ""),
    policy_id: body.policy_id ? String(body.policy_id) : undefined,
    requested_capabilities: body.requested_capabilities as string[] | undefined,
    purpose: body.purpose ? String(body.purpose) : undefined,
    routing_override_provider_id: body.routing_override_provider_id
      ? String(body.routing_override_provider_id)
      : undefined,
    simulation: body.simulation as SimulatedProviderBehaviorOverride | undefined,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
