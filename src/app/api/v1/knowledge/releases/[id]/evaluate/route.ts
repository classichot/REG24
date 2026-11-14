import { NextResponse } from "next/server";
import { evaluateRelease } from "../../../../../../../core/knowledge/evaluation";
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
      throw new Error("FORBIDDEN_403: Insufficient role to trigger release evaluation.");
    }
    const body = (await req.json().catch(() => ({}))) as { suite_id?: string };
    const out = await evaluateRelease(
      id,
      body.suite_id || "suite.B01.300families.v1.1",
      actor,
      { store: getDefaultKnowledgeStore() }
    );
    return NextResponse.json({ ok: true, ...out }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
