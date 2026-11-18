import { NextResponse } from "next/server";
import {
  commitTraceableAnswerAtomically,
  getUnifiedCitationLedgerView,
} from "../../../../../core/knowledge/claim-traceability-engine";
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

    const saved = Object.values(view.published_answers)
      .filter((a) => a.tenant_id === "PUBLIC" || a.tenant_id === actor.tenant_id)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
      .slice(0, 50)
      .map((a) => ({
        answer_id: a.answer_id,
        answer_revision: a.answer_revision,
        revision_number: a.revision_number,
        question_text: a.question_text,
        as_of_date: a.as_of_date,
        generated_at: a.generated_at,
        status: a.status,
        claims_count: a.claims.length,
        legacy_warning_th: a.legacy_warning_th,
      }));

    return NextResponse.json({ ok: true, saved_answers: saved });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "query");
    const body = (await req.json().catch(() => ({}))) as {
      traceable_answer?: TraceableAnswerEnvelope;
      question_text?: string;
    };

    if (!body.traceable_answer || !body.traceable_answer.answer_revision) {
      throw new Error("INVALID_ANSWER_400: traceable_answer is required.");
    }

    const store = getDefaultKnowledgeStore();
    const env: TraceableAnswerEnvelope = {
      ...body.traceable_answer,
      channel: "saved_answer",
    };

    const links = env.claims.flatMap((clm) =>
      clm.evidence_references.map((ref) => ({
        ...ref,
        answer_revision: env.answer_revision,
        claim_id: clm.claim_id,
        verifier_or_reviewer_id: env.verifier_metadata.verifier_version,
        ruleset_version: env.verifier_metadata.ruleset_version,
        verified_at: env.generated_at,
      }))
    );

    const committed = commitTraceableAnswerAtomically(store, env, links, {
      actor,
      question_text: body.question_text || "",
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
