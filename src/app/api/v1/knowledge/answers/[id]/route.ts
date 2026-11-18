import { NextResponse } from "next/server";
import {
  approveDocumentedAmbiguityWithEvidence,
  hydratePostgresSourcesIntoStore,
  reopenSavedTraceableAnswerWithPostgres,
} from "../../../../../../core/knowledge/claim-traceability-engine";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../../core/knowledge/http-auth";
import { getDefaultKnowledgeStore } from "../../../../../../core/knowledge/store";
import { enforceTrialAccessAndRateLimit } from "../../../../../../core/knowledge/trial-gate";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "citation_open");
    const store = getDefaultKnowledgeStore();

    const res = await reopenSavedTraceableAnswerWithPostgres(store, decodeURIComponent(id), actor);
    if (!res.found || !res.answer) {
      return NextResponse.json(
        { ok: false, error: res.error_th || "Saved answer not found or restricted" },
        {
          status: res.http_status,
          headers: { "Cache-Control": "private, no-store" },
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        question_text: res.question_text || "",
        answer: res.answer,
        revision_history: res.answer.revision_history || [],
        audit_events: res.audit_events || [],
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "query");
    const body = (await req.json().catch(() => ({}))) as {
      claim_text_th?: string;
      claim_type?: "legal_proposition" | "interpretation";
      evidence_ids?: string[];
      justification_th?: string;
    };

    if (!body.claim_text_th || !Array.isArray(body.evidence_ids) || body.evidence_ids.length === 0) {
      throw new Error("INVALID_APPROVAL_400: claim_text_th and evidence_ids are required.");
    }

    const store = getDefaultKnowledgeStore();
    await hydratePostgresSourcesIntoStore(store, actor);
    const approved = approveDocumentedAmbiguityWithEvidence(store, {
      prior_answer_revision: decodeURIComponent(id),
      claim_text_th: body.claim_text_th,
      claim_type: body.claim_type || "legal_proposition",
      evidence_ids: body.evidence_ids,
      reviewer: actor,
      justification_th: body.justification_th || "Human reviewer ambiguity resolution backed by official evidence",
    });

    return NextResponse.json({ ok: true, answer: approved });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
