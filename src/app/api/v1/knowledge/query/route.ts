import { NextResponse } from "next/server";
import { sha256Bytes } from "../../../../../core/knowledge/identity";
import { queryKnowledge } from "../../../../../core/knowledge/query";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";
import {
  appendTrialAuditEvent,
  enforceTrialAccessAndRateLimit,
} from "../../../../../core/knowledge/trial-gate";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";

export async function POST(req: Request) {
  try {
    // Server-supplied tenant & scope ONLY — client JSON fields (`tenant_id`, `authorized_scopes`) are ignored (SH-16 / AT08)
    const actor = resolveServerActor(req);
    const gate = enforceTrialAccessAndRateLimit(req, actor, "query");
    const body = (await req.json().catch(() => ({}))) as {
      question?: string;
      release_id?: string;
      applicable_date?: string | null;
      mode?: "standard" | "exact_lookup" | "comparison";
      comparison_work_ids?: string[];
    };

    if (!body.question || typeof body.question !== "string" || !body.question.trim()) {
      throw new Error("EMPTY_QUESTION_400: question is required.");
    }

    const store = getDefaultKnowledgeStore();
    const qClean = body.question.trim();
    const answer = await queryKnowledge(
      {
        question: qClean,
        release_id: body.release_id,
        applicable_date: body.applicable_date ?? null,
        mode: body.mode,
        comparison_work_ids: body.comparison_work_ids,
      },
      actor,
      { store }
    );

    const relRec = store.getState().releases[answer.release_id];
    await appendTrialAuditEvent(store, {
      audit_id: `aud.q.${answer.trace_id}`,
      event_type: "TRIAL_QUERY",
      recorded_at: new Date().toISOString(),
      actor_id: actor.actor_id,
      actor_role: actor.role,
      invite_fingerprint: gate.inviteFingerprint,
      release_id: answer.release_id,
      manifest_hash: relRec?.manifest_hash || null,
      trace_id: answer.trace_id,
      question_sha256: sha256Bytes(qClean),
      question_text: qClean,
      applicable_date: answer.applicable_date,
      mode: body.mode || "standard",
      answer_status: answer.status,
      cited_passage_ids: answer.evidence.map((e) => e.passage_id),
      cited_work_ids: Array.from(new Set(answer.evidence.map((e) => e.work_id))),
      coverage_warnings_count: answer.coverage_warnings.length,
      latency_ms: answer.latency_ms,
    });

    return NextResponse.json({ ok: true, answer }, { status: 200 });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
