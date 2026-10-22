import { NextRequest, NextResponse } from "next/server";
import { reusableLegalKnowledgeLibrary } from "@/core/library/legal-knowledge-library";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const action =
      body.action ||
      ("APPROVE_PUBLISH" as
        | "APPROVE_PUBLISH"
        | "QUARANTINE"
        | "REVOKE_LICENSE"
        | "REPROCESS_OCR_CHUNKS");

    const res = reusableLegalKnowledgeLibrary.processOrModerateDocument({
      documentId: id,
      action,
      actor: body.actor || "Platform Administrator",
    });

    return NextResponse.json({
      specification_id: "REG24-KL-001",
      requirement_ids: ["LIB-02", "LIB-03", "LIB-04", "LIB-10"],
      ...res,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Failed to process library document",
      },
      { status: 400 }
    );
  }
}
