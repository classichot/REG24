import { NextResponse } from "next/server";
import {
  getUnifiedCitationLedgerView,
  saveOrReviseAnswerServerVerified,
} from "../../../../../core/knowledge/claim-traceability-engine";
import { listSavedAnswersSummaryFromPostgres } from "../../../../../core/knowledge/citation-postgres-store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";
import { enforceTrialAccessAndRateLimit } from "../../../../../core/knowledge/trial-gate";
import type { TraceableAnswerEnvelope } from "../../../../../core/knowledge/citation-contracts";

export async function GET(req: Request) {
  try {
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "query");
    const store = getDefaultKnowledgeStore();
    const view = getUnifiedCitationLedgerView(store);

    const pgList = (await listSavedAnswersSummaryFromPostgres(actor)) || [];
    const seenRevs = new Set<string>(pgList.map((p) => p.answer_revision));

    const localSaved = Object.values(view.published_answers)
      .filter(
        (a) =>
          !seenRevs.has(a.answer_revision) &&
          (a.tenant_id === "PUBLIC" || a.tenant_id === actor.tenant_id)
      )
      .map((a) => ({
        answer_id: a.answer_id,
        answer_revision: a.answer_revision,
        revision_number: a.revision_number,
        owner_actor_id: a.owner_actor_id || a.actor_id,
        question_text: a.question_text,
        as_of_date: a.as_of_date,
        generated_at: a.generated_at,
        status: a.status,
        claims_count: a.claims.length,
        legacy_warning_th: a.legacy_warning_th,
      }));

    const merged = [...pgList, ...localSaved]
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
      .slice(0, 50);

    return NextResponse.json({ ok: true, saved_answers: merged });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "query");
    const body = (await req.json().catch(() => ({}))) as {
      traceable_answer?: Partial<TraceableAnswerEnvelope>;
      question_text?: string;
      revision_reason?: string;
    };

    if (!body.traceable_answer) {
      throw new Error("INVALID_ANSWER_400: traceable_answer is required.");
    }

    const store = getDefaultKnowledgeStore();
    const committed = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: body.traceable_answer,
      question_text: body.question_text || "",
      revision_reason: body.revision_reason,
      actor,
    });

    return NextResponse.json({
      ok: true,
      saved_answer_revision: committed.answer_revision,
      answer: committed,
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
