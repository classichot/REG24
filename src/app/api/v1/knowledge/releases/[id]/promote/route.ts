import { NextResponse } from "next/server";
import { promoteRelease } from "../../../../../../../core/knowledge/releases";
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
    const body = (await req.json().catch(() => ({}))) as {
      manifest_hash?: string;
      expected_active_release_id?: string | null;
    };

    if (!body.manifest_hash) {
      throw new Error("MISSING_MANIFEST_HASH_400: manifest_hash is required.");
    }

    const store = getDefaultKnowledgeStore();
    const receipt = await promoteRelease(
      {
        release_id: id,
        manifest_hash: body.manifest_hash,
        expected_active_release_id: body.expected_active_release_id ?? null,
      },
      actor,
      { store }
    );

    await store.transact("SYNC_REPORT_PROMOTED_STATUS", (draft) => {
      const rel = draft.releases[id];
      const repByRel = draft.release_reports[id];
      const repByBatch = rel ? draft.release_reports[rel.batch_id] : undefined;
      for (const rep of [repByRel, repByBatch]) {
        if (rep && rel) {
          rep.status = rel.state;
          rep.next_batch_unlocked = receipt.next_batch_unlocked;
        }
      }
    });

    return NextResponse.json({ ok: true, receipt }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
