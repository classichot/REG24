import { NextResponse } from "next/server";
import { startBatchRun } from "../../../../../../../core/knowledge/releases";
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
    const body = (await req.json().catch(() => ({}))) as {
      manifest_id?: string;
      idempotency_key?: string;
      max_documents?: number;
      ocr_dispatch_budget_pages?: number;
      projection_mode_override?: "durable_disk" | "memory_only" | "simulate_outage";
    };

    const store = getDefaultKnowledgeStore();
    const st = store.getState();
    const manifestId =
      body.manifest_id ||
      Object.values(st.manifests)
        .filter((m) => m.batch_id === batchId)
        .sort((a, b) => b.frozen_at.localeCompare(a.frozen_at))[0]?.manifest_id ||
      `mfst.${batchId.toLowerCase()}.missing`;

    if (!body.idempotency_key || typeof body.idempotency_key !== "string") {
      throw new Error("MISSING_IDEMPOTENCY_KEY_400: idempotency_key is required.");
    }

    const receipt = await startBatchRun(
      {
        batch_id: batchId,
        manifest_id: manifestId,
        idempotency_key: body.idempotency_key,
        max_documents: body.max_documents,
        ocr_dispatch_budget_pages: body.ocr_dispatch_budget_pages,
        projection_mode_override: body.projection_mode_override,
      },
      actor,
      { store }
    );

    return NextResponse.json(
      { ok: true, receipt },
      { status: receipt.idempotent_replay ? 200 : 202 }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
