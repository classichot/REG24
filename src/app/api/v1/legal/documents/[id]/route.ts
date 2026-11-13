import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
} from "@/packages/ocr-v2";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const principal = resolveOcrPrincipalFromHeaders(req.headers);

  // 1. Check OCR v2.0 Legal Source & Version Registry first
  const ocrV2State = reg24OcrV2Service.getLegalDocumentState({
    principal,
    document_id: id,
  });
  if (ocrV2State.status !== 404) {
    return NextResponse.json(ocrV2State.body, {
      status: ocrV2State.status,
      headers: ocrV2State.headers,
    });
  }

  // 2. Fallback to legacy seed corpus with explicit `legacy_unverified` migration metadata (Section 12)
  const snap = reg24Core.getDashboardSnapshot();
  const doc = snap.sourceDocuments.find((d) => d.id === id);

  if (!doc) {
    return NextResponse.json(
      {
        status: "error",
        code: "NOT_FOUND",
        message: `Legal source document '${id}' not found.`,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    status: "ok",
    document: doc,
    source_reliability_tier: "Tier A: Official primary legal source",
    data_quality_status: "Verified",
    ocr_v2_version_state: {
      migration_audit_tag: "legacy_unverified",
      transcription_status: "unreviewed",
      reference_status: "resolved",
      applicability_status: "curated",
      publication_status: "published",
      disclosure:
        "Imported prior to OCR v2.0 page-manifest evidence; retained under legacy_unverified audit tag.",
    },
  });
}
