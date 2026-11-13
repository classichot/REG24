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

  const res = reg24OcrV2Service.publishDocumentVersion({
    principal,
    idempotency_key: idempotencyKey,
    if_match: ifMatch,
    document_id: id,
    source_version_id: String(body.source_version_id || ""),
    extraction_version_id: String(body.extraction_version_id || ""),
    annotation_version: String(body.annotation_version || ""),
    approval_ids: (body.approval_ids as string[]) || [],
    expected_previous_publication_id:
      (body.expected_previous_publication_id as string | null) ?? null,
    simulate_staging_failure: body.simulate_staging_failure as
      | "graph_writer_unavailable"
      | "embedding_batch_failed"
      | undefined,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
