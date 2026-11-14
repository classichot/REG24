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
      throw new Error("FORBIDDEN_403: Insufficient role to resume batch job.");
    }
    const body = (await req.json().catch(() => ({}))) as { fencing_token?: number };
    const jobMgr = new KnowledgeJobManager(getDefaultKnowledgeStore());
    const resumed = jobMgr.resumeJob(id, `api.${actor.actor_id}`, body.fencing_token);
    return NextResponse.json({ ok: true, job: resumed }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
