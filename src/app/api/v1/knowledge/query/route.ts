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
import type { TraceablePublicationChannel } from "../../../../../core/knowledge/citation-contracts";
import type { ConversationTurnInput } from "../../../../../core/knowledge/contracts";
import { saveOrReviseAnswerServerVerified } from "../../../../../core/knowledge/claim-traceability-engine";

export async function POST(req: Request) {
  try {
    // Server-supplied tenant & scope ONLY — client JSON fields (`tenant_id`, `authorized_scopes`) are ignored (SH-16 / AT08)
    const actor = resolveServerActor(req);
    const gate = await enforceTrialAccessAndRateLimit(req, actor, "query");
    const body = (await req.json().catch(() => ({}))) as {
      question?: string;
      release_id?: string;
      applicable_date?: string | null;
      as_of_date?: string | null;
      mode?: "standard" | "exact_lookup" | "comparison";
      comparison_work_ids?: string[];
      conversation_history?: ConversationTurnInput[];
      attachment_doc_ids?: string[];
      channel?: TraceablePublicationChannel;
      persist_answer?: boolean;
      stream?: boolean;
    };

    if (!body.question || typeof body.question !== "string" || !body.question.trim()) {
      throw new Error("EMPTY_QUESTION_400: question is required.");
    }

    const store = getDefaultKnowledgeStore();
    const qClean = body.question.trim();
    const effectiveAsOf = body.applicable_date ?? body.as_of_date ?? null;
    const answer = await queryKnowledge(
      {
        question: qClean,
        release_id: body.release_id,
        applicable_date: effectiveAsOf,
        mode: body.mode,
        comparison_work_ids: body.comparison_work_ids,
        conversation_history: body.conversation_history,
        attachment_doc_ids: body.attachment_doc_ids,
      },
      actor,
      {
        store,
        channel: body.channel || "api",
        persistAnswerAtomically: Boolean(body.persist_answer),
      }
    );

    if (
      body.persist_answer &&
      answer.traceable_answer &&
      (answer.traceable_answer.status === "complete" ||
        answer.traceable_answer.status === "partial")
    ) {
      const pgSaved = await saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: answer.traceable_answer,
        question_text: qClean,
        revision_reason: "Persisted verified answer from query endpoint",
        actor,
      });
      answer.traceable_answer = pgSaved;
    }

    const relRec = store.getState().releases[answer.release_id];
    const auditStatus = await appendTrialAuditEvent(store, {
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

    const headers: Record<string, string> = {
      "x-reg24-ratelimit-backend": gate.rateLimitBackend,
      "x-reg24-ratelimit-remaining": String(gate.remainingInWindow),
      "x-reg24-audit-status": auditStatus.backend,
    };
    if (auditStatus.error) {
      headers["x-reg24-audit-error"] = auditStatus.error.slice(0, 200);
    }

    const wantsStream =
      body.stream === true ||
      (req.headers.get("accept") || "").toLowerCase().includes("text/event-stream");

    if (wantsStream && answer.traceable_answer) {
      // Section 1 Release Invariant: Stream progress or ALREADY VALIDATED claim groups ONLY!
      const env = answer.traceable_answer;
      const sseLines: string[] = [];
      sseLines.push(
        `event: progress\ndata: ${JSON.stringify({ stage: "retrieval_and_claim_validation_complete", as_of_date: env.as_of_date })}\n\n`
      );
      for (const validatedClaim of env.claims) {
        sseLines.push(
          `event: validated_claim\ndata: ${JSON.stringify(validatedClaim)}\n\n`
        );
      }
      sseLines.push(
        `event: complete\ndata: ${JSON.stringify({ ok: true, traceable_answer: env, audit_status: auditStatus })}\n\n`
      );
      return new Response(sseLines.join(""), {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        answer,
        traceable_answer: answer.traceable_answer || null,
        execution_provenance: answer.execution_provenance || null,
        audit_status: auditStatus,
      },
      { status: 200, headers }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
