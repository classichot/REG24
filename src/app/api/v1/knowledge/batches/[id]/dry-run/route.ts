import { NextResponse } from "next/server";
import { planReconciliation } from "../../../../../../../core/knowledge/inventory";
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
    const body = (await req.json().catch(() => ({}))) as { manifest_id?: string };

    const store = getDefaultKnowledgeStore();
    const st = store.getState();
    const manifestId =
      body.manifest_id ||
      Object.values(st.manifests)
        .filter((m) => m.batch_id === batchId)
        .sort((a, b) => b.frozen_at.localeCompare(a.frozen_at))[0]?.manifest_id;

    if (!manifestId) {
      throw new Error(`MANIFEST_NOT_FOUND_404: No frozen manifest found for ${batchId}.`);
    }

    const plan = await planReconciliation(manifestId, actor, { store });
    return NextResponse.json({ ok: true, plan }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
