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
import {
  assertFollowUpConversationIntegrity,
  saveOrReviseAnswerServerVerified,
} from "../../../../../core/knowledge/claim-traceability-engine";
import {
  assertReleaseProjectionArtifactsReady,
  isStrictSingleReleasePreviewMode,
} from "../../../../../core/knowledge/projections";

// Allow up to 300s on Vercel Fluid Compute / Serverless so live Gemini 4 Neon @ low (30–90s)
// + cold-start hydration + Neon Postgres persistence never hit a 60s timeout cutoff.
export const maxDuration = 300;

export async function POST(req: Request) {
  const reqStartedAt = performance.now();
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
      conversation_id?: string | null;
      prior_saved_answer_revision?: string | null;
      reopened_from_revision?: string | null;
      attachment_doc_ids?: string[];
      channel?: TraceablePublicationChannel;
      persist_answer?: boolean;
      save_operation_key?: string | null;
      stream?: boolean;
      qa_synthetic_fixture?: "RC1_REJECTED_CALC" | null;
      answer_generation_mode?: "llm_grounded" | "baseline_deterministic" | null;
      challenger_provider?: "google-gemini" | "openai" | null;
      override_model?: string | null;
      thinking_level?: "minimal" | "low" | "medium" | "high" | null;
    };

    if (!body.question || typeof body.question !== "string" || !body.question.trim()) {
      throw new Error("EMPTY_QUESTION_400: question is required.");
    }

    const store = getDefaultKnowledgeStore();
    const state = store.getState();
    const pinnedActiveRelease =
      (process.env.REG24_PINNED_RELEASE_ID || "").trim() || state.active_release_id || null;
    const requestedReleaseOverride =
      typeof body.release_id === "string" && body.release_id.trim() ? body.release_id.trim() : null;

    if (requestedReleaseOverride) {
      // RC8-only protected Preview guard: reject any request release_id override that selects
      // another or unbundled release, and never silently fall back to an alternate retrieval path.
      if (isStrictSingleReleasePreviewMode()) {
        if (!pinnedActiveRelease || requestedReleaseOverride !== pinnedActiveRelease) {
          throw new Error(
            `RELEASE_OVERRIDE_REJECTED_400: This protected Preview is pinned strictly to '${pinnedActiveRelease || "rel.B01.rc8"}' and does not ship older comparison indexes; request release_id override '${requestedReleaseOverride}' is rejected. Use a separately verified deployment for comparison or rollback.`
          );
        }
      } else {
        if (!state.releases[requestedReleaseOverride]) {
          throw new Error(
            `UNKNOWN_RELEASE_ID_400: Requested release_id '${requestedReleaseOverride}' does not exist in canonical store.`
          );
        }
        if (pinnedActiveRelease && requestedReleaseOverride !== pinnedActiveRelease) {
          // Even outside Preview, if the active release uses packaged projections and the requested
          // override release is missing its lexical/graph projection artifacts, reject cleanly instead of silent fallback!
          let activeHasProjections = false;
          try {
            assertReleaseProjectionArtifactsReady(store, pinnedActiveRelease);
            activeHasProjections = true;
          } catch {
            activeHasProjections = false;
          }
          if (activeHasProjections) {
            try {
              assertReleaseProjectionArtifactsReady(store, requestedReleaseOverride);
            } catch {
              throw new Error(
                `UNBUNDLED_RELEASE_OVERRIDE_REJECTED_400: Requested release_id '${requestedReleaseOverride}' does not have packaged lexical/graph projection artifacts in this build. Silent retrieval fallback is prohibited.`
              );
            }
          }
        }
      }
    }

    if (isStrictSingleReleasePreviewMode() && pinnedActiveRelease) {
      assertReleaseProjectionArtifactsReady(store, pinnedActiveRelease);
    }

    // Defect 1 Hard Server-Side Guard: immediately reject (400/403) any follow-up write whose parent revision
    // (`reopened_from_revision` or `prior_saved_answer_revision`) belongs to a different `conversation_id`
    // or whose `conversation_history` mixes turns from another matter BEFORE calling the LLM!
    await assertFollowUpConversationIntegrity(store, actor, {
      conversation_id: body.conversation_id ?? null,
      prior_saved_answer_revision: body.prior_saved_answer_revision ?? null,
      reopened_from_revision: body.reopened_from_revision ?? null,
      conversation_history: body.conversation_history,
    });

    const qClean = body.question.trim();
    const effectiveAsOf = body.applicable_date ?? body.as_of_date ?? null;
    const wantsStream =
      body.stream === true ||
      (req.headers.get("accept") || "").toLowerCase().includes("text/event-stream");

    const executeQueryPipeline = async () => {
      // IMPORTANT: Keep `persistAnswerAtomically: false` during `queryKnowledge` so unpersisted in-memory
      // envelope generation NEVER pre-populates `r1` ahead of `saveOrReviseAnswerServerVerified`, and
      // keep `enable_tax_foundation_pilot: false` so the VAT book pilot remains strictly OFF on staging!
      const queryStartedAt = performance.now();
      const answer = await queryKnowledge(
        {
          question: qClean,
          release_id: isStrictSingleReleasePreviewMode()
            ? pinnedActiveRelease ?? undefined
            : requestedReleaseOverride ?? undefined,
          applicable_date: effectiveAsOf,
          mode: body.mode,
          comparison_work_ids: body.comparison_work_ids,
          conversation_history: body.conversation_history,
          conversation_id: body.conversation_id ?? null,
          prior_saved_answer_revision: body.prior_saved_answer_revision ?? null,
          attachment_doc_ids: body.attachment_doc_ids,
          enable_tax_foundation_pilot: false,
          qa_synthetic_fixture:
            process.env.VERCEL_ENV !== "production" ? body.qa_synthetic_fixture ?? null : null,
          answer_generation_mode:
            process.env.VERCEL_ENV !== "production" ? body.answer_generation_mode ?? null : null,
          challenger_provider:
            process.env.VERCEL_ENV !== "production" ? body.challenger_provider ?? null : null,
          override_model:
            process.env.VERCEL_ENV !== "production" ? body.override_model ?? null : null,
          thinking_level:
            process.env.VERCEL_ENV !== "production" ? body.thinking_level ?? null : null,
        },
        actor,
        {
          store,
          channel: body.channel || "api",
          persistAnswerAtomically: false,
        }
      );
      const queryMs = Math.round((performance.now() - queryStartedAt) * 100) / 100;

      let persistMs = 0;
      if (
        body.persist_answer &&
        answer.traceable_answer &&
        (answer.traceable_answer.status === "complete" ||
          answer.traceable_answer.status === "partial" ||
          answer.traceable_answer.status === "insufficient")
      ) {
        const persistStartedAt = performance.now();
        // STRICT PER-CLAIM CALCULATION BINDING (ZERO CROSS-CLAIM POOLING!):
        // Bind each server-verified calculation strictly to its OWN claim_id (and exact source_versions).
        // A separate unsupported claim that reuses a verified number from another claim MUST stay blocked!
        const trustedCalcTokensByClaimId: Record<string, string[]> = {};
        const trustedCalcsByClaimId: Record<string, NonNullable<typeof answer.claims[number]["bound_calculation"]>> = {};
        for (const tc of answer.traceable_answer.claims || []) {
          // Match strictly to the exact owning GroundedAnswer claim (same claim_id or atomic segment prefix of THAT claim only!)
          const owningClaim = (answer.claims || []).find(
            (gc) =>
              gc.claim_id === tc.claim_id ||
              (Boolean(gc.claim_id) && tc.claim_id.startsWith(`${gc.claim_id}.p`))
          );
          if (tc.bound_calculation) {
            trustedCalcsByClaimId[tc.claim_id] = tc.bound_calculation;
            trustedCalcTokensByClaimId[tc.claim_id] = Array.from(
              new Set([
                ...(tc.bound_calculation.verified_numeric_tokens || []),
                ...(owningClaim?.verified_calculation_numeric_tokens || []),
              ])
            );
            continue;
          }
          if (owningClaim?.bound_calculation) {
            trustedCalcsByClaimId[tc.claim_id] = {
              ...owningClaim.bound_calculation,
              claim_id: tc.claim_id,
            };
            trustedCalcTokensByClaimId[tc.claim_id] = Array.from(
              new Set([
                ...(owningClaim.bound_calculation.verified_numeric_tokens || []),
                ...(owningClaim.verified_calculation_numeric_tokens || []),
              ])
            );
          } else if (
            Array.isArray(owningClaim?.verified_calculation_numeric_tokens) &&
            owningClaim.verified_calculation_numeric_tokens.length > 0
          ) {
            trustedCalcTokensByClaimId[tc.claim_id] =
              owningClaim.verified_calculation_numeric_tokens;
          }
        }

        const isFollowUpSave =
          Array.isArray(body.conversation_history) &&
          body.conversation_history.some((t) => t.role === "user" && Boolean(t.content?.trim()));

        const querySaveOpKey =
          (typeof body.save_operation_key === "string" && body.save_operation_key.trim()) ||
          req.headers.get("idempotency-key")?.trim() ||
          req.headers.get("x-idempotency-key")?.trim() ||
          null;

        const pgSaved = await saveOrReviseAnswerServerVerified(store, {
          submitted_envelope: {
            ...answer.traceable_answer,
            execution_provenance: answer.execution_provenance ?? null,
          },
          grounded_answer_snapshot: answer,
          question_text: qClean,
          revision_reason: isFollowUpSave
            ? "Persisted follow-up verified answer from query endpoint"
            : "Persisted initial verified answer from query endpoint",
          save_operation_key: querySaveOpKey,
          actor,
          query_persistence_context: {
            conversation_id: body.conversation_id ?? null,
            prior_saved_answer_revision: body.prior_saved_answer_revision ?? null,
            reopened_from_revision: body.reopened_from_revision ?? null,
            conversation_history: body.conversation_history,
            trusted_calculation_tokens_by_claim_id:
              Object.keys(trustedCalcTokensByClaimId).length > 0
                ? trustedCalcTokensByClaimId
                : undefined,
            trusted_calculations_by_claim_id:
              Object.keys(trustedCalcsByClaimId).length > 0
                ? trustedCalcsByClaimId
                : undefined,
          },
        });
        answer.traceable_answer = pgSaved;
        if (answer.llm_audit_trace && typeof answer.llm_audit_trace === "object") {
          answer.llm_audit_trace = {
            ...answer.llm_audit_trace,
            final_answer_revision_id: pgSaved.answer_revision || null,
          };
        }
        persistMs = Math.round((performance.now() - persistStartedAt) * 100) / 100;
      }

      const auditStartedAt = performance.now();
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
      const auditMs = Math.round((performance.now() - auditStartedAt) * 100) / 100;
      const totalMs = Math.round((performance.now() - reqStartedAt) * 100) / 100;

      const headers: Record<string, string> = {
        "x-reg24-ratelimit-backend": gate.rateLimitBackend,
        "x-reg24-ratelimit-remaining": String(gate.remainingInWindow),
        "x-reg24-audit-status": auditStatus.backend,
        "x-reg24-stage-timing-ms": `query=${queryMs};persist=${persistMs};audit=${auditMs};total=${totalMs}`,
      };
      if (auditStatus.error) {
        headers["x-reg24-audit-error"] = auditStatus.error.slice(0, 200);
      }

      return {
        answer,
        auditStatus,
        stageTimingMs: { query: queryMs, persist: persistMs, audit: auditMs, total: totalMs },
        headers,
      };
    };

    if (wantsStream) {
      // Incremental SSE stream: flush response headers and initial progress immediately (<200ms)
      // plus 8s keepalive heartbeats so browser / proxy / HTTP-1.1 connections NEVER drop while
      // live Gemini 4 Neon @ low + verification + Neon persistence run.
      // Section 1 Release Invariant: NEVER stream unvalidated LLM tokens — emit `validated_claim`
      // and `complete` ONLY AFTER full server verification and atomic persistence succeed!
      const encoder = new TextEncoder();
      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false;
          const sendEvent = (event: string, payload: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
              );
            } catch {
              closed = true;
            }
          };

          sendEvent("progress", {
            stage: "accepted",
            started_at: new Date().toISOString(),
          });

          const heartbeatTimer = setInterval(() => {
            sendEvent("heartbeat", {
              stage: "processing",
              elapsed_ms: Math.round(performance.now() - reqStartedAt),
            });
          }, 8000);

          try {
            const { answer, auditStatus, stageTimingMs } = await executeQueryPipeline();
            const env = answer.traceable_answer || null;
            sendEvent("progress", {
              stage: "retrieval_and_claim_validation_complete",
              as_of_date: env?.as_of_date ?? answer.applicable_date ?? null,
              stage_timing_ms: stageTimingMs,
            });
            for (const validatedClaim of env?.claims || []) {
              sendEvent("validated_claim", validatedClaim);
            }
            sendEvent("complete", {
              ok: true,
              answer,
              traceable_answer: env,
              execution_provenance: answer.execution_provenance || null,
              audit_status: auditStatus,
              stage_timing_ms: stageTimingMs,
            });
          } catch (err) {
            const errResp = knowledgeApiErrorResponse(err);
            let errBody: Record<string, unknown> = {
              ok: false,
              error: err instanceof Error ? err.message : "INTERNAL_QUERY_ERROR",
            };
            try {
              errBody = (await errResp.json()) as Record<string, unknown>;
            } catch {
              // keep fallback error body
            }
            sendEvent("error", {
              ...errBody,
              ok: false,
              http_status: errResp.status,
            });
          } finally {
            clearInterval(heartbeatTimer);
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                // already closed
              }
            }
          }
        },
      });

      return new Response(sseStream, {
        status: 200,
        headers: {
          "x-reg24-ratelimit-backend": gate.rateLimitBackend,
          "x-reg24-ratelimit-remaining": String(gate.remainingInWindow),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const { answer, auditStatus, headers } = await executeQueryPipeline();

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
