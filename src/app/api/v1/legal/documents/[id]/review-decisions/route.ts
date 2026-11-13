import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type ApplicabilityCurationMetadata,
  type LegalReviewDecisionRecord,
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

  const res = reg24OcrV2Service.submitReviewDecision({
    principal,
    idempotency_key: idempotencyKey,
    if_match: ifMatch,
    document_id: id,
    extraction_version_id: String(body.extraction_version_id || ""),
    annotation_version: String(body.annotation_version || ""),
    issue_ids: (body.issue_ids as string[]) || [],
    disposition:
      (body.disposition as LegalReviewDecisionRecord["disposition"]) || "accept_warning",
    evidence: String(body.evidence || ""),
    rationale: String(body.rationale || ""),
    applicability_curation: body.applicability_curation as
      | Partial<ApplicabilityCurationMetadata>
      | undefined,
    resolved_reference_targets: body.resolved_reference_targets as
      | Record<string, string>
      | undefined,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
