import { NextResponse } from "next/server";
import { resolveAuthorizedEvidence } from "../../../../../../core/knowledge/evidence";
import { sha256Bytes } from "../../../../../../core/knowledge/identity";
import { getDefaultKnowledgeStore } from "../../../../../../core/knowledge/store";
import {
  appendTrialAuditEvent,
  enforceTrialAccessAndRateLimit,
} from "../../../../../../core/knowledge/trial-gate";
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
    const gate = enforceTrialAccessAndRateLimit(req, actor, "citation_open");
    const store = getDefaultKnowledgeStore();
    const resolved = resolveAuthorizedEvidence(store, id, actor);
    await appendTrialAuditEvent(store, {
      audit_id: `aud.ev.${sha256Bytes(`${actor.actor_id}:${id}:${Date.now()}`).slice(0, 14)}`,
      event_type: "TRIAL_CITATION_OPEN",
      recorded_at: new Date().toISOString(),
      actor_id: actor.actor_id,
      actor_role: actor.role,
      invite_fingerprint: gate.inviteFingerprint,
      passage_id: id,
      work_id: resolved.passage?.work_id || null,
      official_identifier: resolved.official_identifier || null,
      origin_uri: resolved.locator?.origin_uri || null,
      http_status: resolved.http_status,
    });
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
