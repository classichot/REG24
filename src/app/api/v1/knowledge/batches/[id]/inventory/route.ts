import { NextResponse } from "next/server";
import { freezeInventory } from "../../../../../../../core/knowledge/inventory";
import { KnowledgeJobManager } from "../../../../../../../core/knowledge/jobs";
import { getDefaultKnowledgeStore } from "../../../../../../../core/knowledge/store";
import {
  assertValidBatchId,
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../../../core/knowledge/http-auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const batchId = assertValidBatchId(id);
    const actor = resolveServerActor(req, { requireCsrfForMutation: true });
    if (
      actor.role !== "engineering_lead" &&
      actor.role !== "data_operator" &&
      actor.role !== "product_owner"
    ) {
      throw new Error("FORBIDDEN_403: Insufficient role to freeze batch inventory.");
    }

    const store = getDefaultKnowledgeStore();
    const jobMgr = new KnowledgeJobManager(store);
    const job = jobMgr.createJob({
      batch_id: batchId,
      kind: "INVENTORY_DISCOVERY",
      created_by: actor.actor_id,
    });
    const leased = jobMgr.acquireLease(job.job_id, `api.${actor.actor_id}`);

    const frozen = await freezeInventory(batchId, actor, { store });
    jobMgr.checkpointJob(leased.job_id, leased.fencing_token, {
      manifest_id: frozen.manifest.manifest_id,
      total_candidates: frozen.candidates.length,
    });
    jobMgr.completeJob(leased.job_id, leased.fencing_token);

    return NextResponse.json(
      {
        ok: true,
        job_id: leased.job_id,
        manifest: frozen.manifest,
        total_candidates: frozen.candidates.length,
      },
      { status: 202 }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
