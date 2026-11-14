import { NextResponse } from "next/server";
import { rollbackRelease } from "../../../../../../../core/knowledge/releases";
import { getDefaultKnowledgeStore } from "../../../../../../../core/knowledge/store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../../../core/knowledge/http-auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = resolveServerActor(req, { requireCsrfForMutation: true });
    const body = (await req.json().catch(() => ({}))) as { reason?: string };

    const receipt = await rollbackRelease(
      id,
      body.reason || "Operator-initiated rollback",
      actor,
      { store: getDefaultKnowledgeStore() }
    );

    return NextResponse.json({ ok: true, receipt }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
