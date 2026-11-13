import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type RenderedPageEvidence,
} from "@/packages/ocr-v2";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; source_version_id: string }> }
) {
  const { id, source_version_id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const body = (await req.json()) as Record<string, unknown>;
  const idempotencyKey =
    req.headers.get("idempotency-key") || (body.idempotency_key as string | undefined);

  const res = reg24OcrV2Service.finalizeSourceVersion({
    principal,
    idempotency_key: idempotencyKey,
    document_id: id,
    source_version_id,
    stored_sha256: String(body.stored_sha256 || ""),
    actual_mime_type: String(body.actual_mime_type || "application/pdf"),
    byte_length: Number(body.byte_length || 0),
    encrypted: Boolean(body.encrypted),
    corrupt: Boolean(body.corrupt),
    malware_detected: Boolean(body.malware_detected),
    pages_manifest: (body.pages_manifest as RenderedPageEvidence[]) || [],
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
