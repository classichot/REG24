import { NextResponse } from "next/server";
import { sha256Bytes } from "../../../../../core/knowledge/identity";
import {
  appendAuditEventToPostgres,
  persistCitationSourceBundleToPostgres,
} from "../../../../../core/knowledge/citation-postgres-store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import { onboardVerifiedOfficialAttachment } from "../../../../../core/knowledge/source-onboarding";
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
      publication_date?: string | null;
      effective_from?: string | null;
      effective_to?: string | null;
      applicability_rule_th?: string | null;
      mime_type?: string;
      attachment_text?: string;
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
    const onboarded = onboardVerifiedOfficialAttachment(store, {
      release_id: body.release_id || "rel.B01.rc5",
      issuer_id: body.issuer_id || "reg.th.soc_ratchakitcha",
      source_family: body.source_family || "gazette_enactment",
      source_native_id: body.source_native_id,
      original_title_th: body.original_title_th,
      official_origin_url: body.official_origin_url ?? null,
      royal_gazette_ref: body.royal_gazette_ref ?? null,
      publication_date: body.publication_date ?? null,
      effective_from: body.effective_from ?? null,
      effective_to: body.effective_to ?? null,
      applicability_rule_th: body.applicability_rule_th ?? null,
      mime_type: body.mime_type || "application/pdf",
      attachment_bytes_or_text: body.attachment_text,
      section_label: body.section_label ?? null,
      paragraph_label: body.paragraph_label ?? null,
      physical_page_one_based: body.physical_page_one_based ?? null,
      printed_page_label: body.printed_page_label ?? null,
      passage_excerpt_th: body.passage_excerpt_th ?? null,
      actor,
    });

    await persistCitationSourceBundleToPostgres({
      doc: onboarded.doc,
      version: onboarded.version,
      location: onboarded.location,
      extraction: onboarded.extraction_revision,
      passages: onboarded.passages,
    });

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
      doc_id: onboarded.doc.doc_id,
      version_id: onboarded.version.version_id,
      passage_id: onboarded.passages[0]?.passage_id || null,
      official_url: onboarded.location.exact_official_url,
      effective_from: onboarded.version.effective_from,
      effective_to: onboarded.version.effective_to,
      human_pinpoint_th: onboarded.passages[0]?.human_pinpoint_th || "",
      verification_checks: {
        origin_verified: true,
        applicable_version_verified: true,
        section_or_page_verified: true,
      },
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
