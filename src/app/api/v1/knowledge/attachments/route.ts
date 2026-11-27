import { NextResponse } from "next/server";
import { sha256Bytes } from "../../../../../core/knowledge/identity";
import {
  appendAuditEventToPostgres,
  persistCitationSourceBundleToPostgres,
  resolveActiveCitationDbTransport,
} from "../../../../../core/knowledge/citation-postgres-store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import {
  onboardVerifiedOfficialAttachmentAsync,
} from "../../../../../core/knowledge/source-onboarding";
import { isStrictSingleReleasePreviewMode } from "../../../../../core/knowledge/projections";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";
import { enforceTrialAccessAndRateLimit } from "../../../../../core/knowledge/trial-gate";
import type { OfficialSourceFamily } from "../../../../../core/knowledge/citation-contracts";

export async function POST(req: Request) {
  try {
    const actor = resolveServerActor(req);
    await enforceTrialAccessAndRateLimit(req, actor, "query");
    const body = (await req.json().catch(() => ({}))) as {
      issuer_id?: string;
      source_family?: OfficialSourceFamily;
      source_native_id?: string;
      original_title_th?: string;
      official_origin_url?: string | null;
      royal_gazette_ref?: string | null;
      enactment_date?: string | null;
      publication_date?: string | null;
      effective_from?: string | null;
      effective_to?: string | null;
      applicability_rule_th?: string | null;
      mime_type?: string;
      attachment_text?: string;
      expected_artifact_sha256?: string | null;
      section_label?: string | null;
      paragraph_label?: string | null;
      physical_page_one_based?: number | null;
      printed_page_label?: string | null;
      passage_excerpt_th?: string | null;
      release_id?: string;
    };

    if (!body.source_native_id || !body.original_title_th || !body.attachment_text) {
      throw new Error(
        "INVALID_ATTACHMENT_400: source_native_id, original_title_th, and attachment_text are required."
      );
    }

    const store = getDefaultKnowledgeStore();
    const pinnedActiveRelease =
      (process.env.REG24_PINNED_RELEASE_ID || "").trim() ||
      store.getState().active_release_id ||
      "rel.B01.rc8";
    const requestedRelease =
      typeof body.release_id === "string" && body.release_id.trim() ? body.release_id.trim() : null;
    if (
      isStrictSingleReleasePreviewMode() &&
      requestedRelease &&
      requestedRelease !== pinnedActiveRelease
    ) {
      throw new Error(
        `RELEASE_OVERRIDE_REJECTED_400: This protected Preview is pinned strictly to '${pinnedActiveRelease}'; attachment release_id override '${requestedRelease}' is rejected.`
      );
    }
    if (isStrictSingleReleasePreviewMode()) {
      // Newly uploaded official PDFs stay out of governing evidence on protected Preview until
      // separate publication_date, effective_from, and Neon persistence checks all pass!
      if (!body.publication_date?.trim() || !body.effective_from?.trim()) {
        throw new Error(
          "UNVERIFIED_ATTACHMENT_DATES_422: Newly uploaded official PDFs require BOTH separate publication_date and effective_from (YYYY-MM-DD) before entering governing evidence."
        );
      }
    }
    const onboarded = await onboardVerifiedOfficialAttachmentAsync(store, {
      release_id: requestedRelease || pinnedActiveRelease,
      issuer_id: body.issuer_id || "reg.th.soc_ratchakitcha",
      source_family: body.source_family || "gazette_enactment",
      source_native_id: body.source_native_id,
      original_title_th: body.original_title_th,
      official_origin_url: body.official_origin_url ?? null,
      royal_gazette_ref: body.royal_gazette_ref ?? null,
      enactment_date: body.enactment_date ?? null,
      publication_date: body.publication_date ?? null,
      effective_from: body.effective_from ?? null,
      effective_to: body.effective_to ?? null,
      applicability_rule_th: body.applicability_rule_th ?? null,
      mime_type: body.mime_type || "application/pdf",
      attachment_bytes_or_text: body.attachment_text,
      expected_artifact_sha256: body.expected_artifact_sha256 ?? null,
      section_label: body.section_label ?? null,
      paragraph_label: body.paragraph_label ?? null,
      physical_page_one_based: body.physical_page_one_based ?? null,
      printed_page_label: body.printed_page_label ?? null,
      passage_excerpt_th: body.passage_excerpt_th ?? null,
      actor,
    });

    if (!onboarded.verified || !onboarded.doc.eligible_for_citation) {
      const reasons = onboarded.trusted_source_verification.mismatch_reasons;
      return NextResponse.json(
        {
          ok: false,
          verified: false,
          eligible_for_citation: false,
          doc_id: onboarded.doc.doc_id,
          error: `UNVERIFIED_ATTACHMENT_TRUSTED_SOURCE_422: ${
            reasons.join(" | ") ||
            "Attachment could not be verified against a trusted publisher copy or reviewed canonical record; excluded from governing evidence."
          }`,
          trusted_source_verification: onboarded.trusted_source_verification,
        },
        { status: 422 }
      );
    }

    const pgPersisted = await persistCitationSourceBundleToPostgres({
      doc: onboarded.doc,
      version: onboarded.version,
      location: onboarded.location,
      extraction: onboarded.extraction_revision,
      passages: onboarded.passages,
    });
    if (isStrictSingleReleasePreviewMode()) {
      if (!pgPersisted.persisted) {
        throw new Error(
          "ATTACHMENT_NEON_PERSISTENCE_REQUIRED_503: Newly uploaded official PDF could not be durably persisted to Neon PostgreSQL; withheld from governing evidence."
        );
      }
      const db = resolveActiveCitationDbTransport();
      const rb = db
        ? await db<{ c: string }>(
            `SELECT COUNT(*)::text AS c FROM citation_evidence_passage WHERE version_id = $1`,
            [onboarded.version.version_id]
          )
        : null;
      const persistedPassageCount = Number(rb?.rows?.[0]?.c || 0);
      if (persistedPassageCount < onboarded.passages.length) {
        throw new Error(
          `ATTACHMENT_NEON_READBACK_FAILED_503: Durable Neon readback for newly uploaded PDF version '${onboarded.version.version_id}' returned ${persistedPassageCount}/${onboarded.passages.length} passages; withheld from governing evidence.`
        );
      }
    }

    await appendAuditEventToPostgres({
      audit_id: `caud.att.${sha256Bytes(`${onboarded.doc.doc_id}:${Date.now()}`).slice(0, 14)}`,
      actor_or_service: actor.actor_id,
      recorded_at: new Date().toISOString(),
      event_type: "OFFICIAL_ATTACHMENT_VERIFIED",
      affected_ids: [
        onboarded.doc.doc_id,
        onboarded.version.version_id,
        ...onboarded.passages.map((p) => p.passage_id),
      ],
      before_status: null,
      after_status: {
        record_type: onboarded.doc.record_type,
        effective_from: onboarded.version.effective_from,
        eligible_for_citation: onboarded.doc.eligible_for_citation,
      },
      reason: `Verified official attachment '${body.source_native_id}' (origin + applicable version + section/page)`,
      correlation_id: onboarded.version.version_id,
    });

    return NextResponse.json({
      ok: true,
      verified: true,
      doc_id: onboarded.doc.doc_id,
      version_id: onboarded.version.version_id,
      passage_id: onboarded.passages[0]?.passage_id || null,
      official_url: onboarded.location.exact_official_url,
      enactment_date:
        typeof onboarded.version.source_metadata?.enactment_date === "string"
          ? onboarded.version.source_metadata.enactment_date
          : null,
      publication_date: onboarded.version.publication_date,
      effective_from: onboarded.version.effective_from,
      effective_to: onboarded.version.effective_to,
      official_artifact_sha256:
        typeof onboarded.version.source_metadata?.official_artifact_sha256 === "string"
          ? onboarded.version.source_metadata.official_artifact_sha256
          : null,
      human_pinpoint_th: onboarded.passages[0]?.human_pinpoint_th || "",
      verification_checks: {
        origin_verified: true,
        applicable_version_verified: true,
        section_or_page_verified: true,
      },
      trusted_source_verification: onboarded.trusted_source_verification,
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
