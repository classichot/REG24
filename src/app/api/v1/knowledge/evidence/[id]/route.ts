import { NextResponse } from "next/server";
import { resolveAuthorizedEvidence } from "../../../../../../core/knowledge/evidence";
import { getDefaultKnowledgeStore } from "../../../../../../core/knowledge/store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../../core/knowledge/http-auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = resolveServerActor(req);
    const resolved = resolveAuthorizedEvidence(getDefaultKnowledgeStore(), id, actor);
    if (!resolved.allowed) {
      return NextResponse.json(
        { ok: false, error: resolved.error || "Evidence not found or restricted" },
        { status: resolved.http_status }
      );
    }
    return NextResponse.json({ ok: true, evidence: resolved }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
