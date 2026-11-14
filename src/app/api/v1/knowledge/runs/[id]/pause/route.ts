import { NextResponse } from "next/server";
import { KnowledgeJobManager } from "../../../../../../../core/knowledge/jobs";
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
    if (actor.role === "reader" || actor.role === "tenant_reader") {
      throw new Error("FORBIDDEN_403: Insufficient role to pause batch job.");
    }
    const body = (await req.json().catch(() => ({}))) as {
      fencing_token?: number;
      reason?: string;
    };
    const jobMgr = new KnowledgeJobManager(getDefaultKnowledgeStore());
    const paused = jobMgr.pauseJob(id, body.fencing_token, body.reason || `Paused by ${actor.actor_id}`);
    return NextResponse.json({ ok: true, job: paused }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
