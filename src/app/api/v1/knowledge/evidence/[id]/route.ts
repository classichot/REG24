import { NextResponse } from "next/server";
import { resolveTraceableEvidenceWithPostgres } from "../../../../../../core/knowledge/claim-traceability-engine";
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
    const decodedId = decodeURIComponent(id);
    const actor = resolveServerActor(req);
    const gate = await enforceTrialAccessAndRateLimit(req, actor, "citation_open");
    const store = getDefaultKnowledgeStore();

    const pinnedEnvRel = (process.env.REG24_PINNED_RELEASE_ID || "").trim() || undefined;
    const activeReleaseId = pinnedEnvRel || store.getState().active_release_id || undefined;
    const pinned = await resolveTraceableEvidenceWithPostgres(
      store,
      decodedId,
      actor,
      activeReleaseId
    );
    const legacyResolved = resolveAuthorizedEvidence(store, decodedId, actor);

    const effectiveAllowed = pinned.ok || legacyResolved.allowed;
    const effectiveStatus = effectiveAllowed ? 200 : pinned.http_status;
    const authoritativeOriginUri =
      pinned.evidence?.official_location.official_url_with_anchor ||
      pinned.evidence?.official_location.exact_official_url ||
      legacyResolved.locator?.origin_uri ||
      null;

    const auditStatus = await appendTrialAuditEvent(store, {
      audit_id: `aud.ev.${sha256Bytes(`${actor.actor_id}:${decodedId}:${Date.now()}`).slice(0, 14)}`,
      event_type: "TRIAL_CITATION_OPEN",
      recorded_at: new Date().toISOString(),
      actor_id: actor.actor_id,
      actor_role: actor.role,
      invite_fingerprint: gate.inviteFingerprint,
      passage_id: decodedId,
      work_id: pinned.evidence?.doc_id || legacyResolved.passage?.work_id || null,
      official_identifier:
        pinned.evidence?.source_native_id || legacyResolved.official_identifier || null,
      origin_uri: authoritativeOriginUri,
      http_status: effectiveStatus,
    });

    const headers: Record<string, string> = {
      "x-reg24-ratelimit-backend": gate.rateLimitBackend,
      "x-reg24-ratelimit-remaining": String(gate.remainingInWindow),
      "x-reg24-audit-status": auditStatus.backend,
      "Cache-Control": "private, no-store",
    };
    if (auditStatus.error) {
      headers["x-reg24-audit-error"] = auditStatus.error.slice(0, 200);
    }

    if (!effectiveAllowed) {
      return NextResponse.json(
        {
          ok: false,
          unavailable_code: pinned.unavailable_code || "NOT_FOUND_OR_RESTRICTED",
          error:
            pinned.error_th ||
            legacyResolved.error ||
            "Evidence not found or restricted",
          audit_status: auditStatus,
        },
        { status: 404, headers }
      );
    }

    // Backwards-compatible `evidence` object enriched with full `pinned_evidence` contract (Section 6)
    // Always synchronize `origin_uri` to the verified official URL from `pinned_evidence` so answer card,
    // API `evidence.locator.origin_uri`, and `pinned_evidence.official_location` point to the exact same official URL.
    const compatEvidence = legacyResolved.allowed
      ? {
          ...legacyResolved,
          locator: legacyResolved.locator
            ? {
                ...legacyResolved.locator,
                origin_uri: authoritativeOriginUri || legacyResolved.locator.origin_uri,
              }
            : legacyResolved.locator,
        }
      : {
          allowed: true,
          http_status: 200 as const,
          passage: {
            passage_id: pinned.evidence!.evidence_id,
            work_id: pinned.evidence!.doc_id,
            version_id: pinned.evidence!.version_id,
            exact_text: pinned.evidence!.verbatim_quote,
            contextualized_header: pinned.evidence!.original_title_th,
            statement_role: "statutory_text",
            structural_path: pinned.evidence!.section_paragraph_path,
            critical_tokens_flagged: [],
          },
          work_title_th: pinned.evidence!.original_title_th,
          official_identifier:
            pinned.evidence!.source_native_id || pinned.evidence!.original_title_th,
          authority_type: pinned.evidence!.source_family,
          authenticity_status: "official_original",
          is_derivative: false,
          locator: {
            kind: pinned.evidence!.physical_page_start !== null ? "pdf_page" : "html_structural",
            artifact_id: pinned.evidence!.version_id,
            origin_uri: pinned.evidence!.official_location.exact_official_url,
            physical_page_index:
              pinned.evidence!.physical_page_start !== null
                ? pinned.evidence!.physical_page_start - 1
                : undefined,
            printed_page_label: pinned.evidence!.printed_page_start,
          },
        };

    return NextResponse.json(
      {
        ok: true,
        evidence: compatEvidence,
        pinned_evidence: pinned.evidence || null,
        audit_status: auditStatus,
      },
      { status: 200, headers }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
