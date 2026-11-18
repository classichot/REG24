/**
 * REG24 — Official Link Verification, Outage Resilience & Verified URL Replacement Engine
 *
 * Implements Section 7 & Fixtures T05, T06 of:
 * "REG24 developer requirements — official-source citations and claim traceability"
 * - Verifies redirects, document identity, soft 404s, and replacement files with backoff
 * - Displays "ลิงก์ทางการไม่พร้อมใช้งาน" with last successful verification timestamp during outages
 * - Never silently replaces a historical official URL with a homepage or newer version
 * - Approves replacement URLs ONLY after matching the cited version's SHA-256 or verified content,
 *   preserving full prior URL history and operator audit events
 */

import { sha256Bytes } from "./identity";
import {
  appendCitationAuditEvent,
  ensureCitationLedgerInState,
  verifyCapturedOfficialIdentity,
} from "./source-onboarding";
import type { Actor } from "./contracts";
import type { DurableKnowledgeStore } from "./store";
import type { OfficialLocationRecord } from "./citation-contracts";

export interface HttpProbeResult {
  reachable: boolean;
  http_status: number | null;
  final_url: string;
  redirect_chain: string[];
  mime_type: string;
  body_text_or_html: string;
  body_sha256: string | null;
  network_error?: string | null;
}

export type OfficialLinkProbeTransport = (url: string) => Promise<HttpProbeResult>;

export function formatOfficialLinkStatusNoticeTh(
  loc: Pick<OfficialLocationRecord, "link_health" | "last_successful_verified_at">
): string | null {
  if (loc.link_health === "temporarily_offline") {
    const lastOk = loc.last_successful_verified_at
      ? ` (ตรวจสอบสำเร็จล่าสุดเมื่อ ${loc.last_successful_verified_at})`
      : "";
    return `ลิงก์ทางการไม่พร้อมใช้งาน${lastOk} — ท่านยังสามารถตรวจสอบข้อความต้นฉบับตามรุ่นที่ REG24 เก็บรักษาไว้ได้ตามปกติ`;
  }
  if (loc.link_health === "quarantined_identity_failure") {
    return "ลิงก์ทางการไม่ผ่านการตรวจสอบความตรงกันของเอกสารต้นฉบับ (ระงับการใช้เป็นลิงก์ยืนยันอัตโนมัติ)";
  }
  if (loc.link_health === "moved_verified") {
    return "ลิงก์ทางการมีการย้ายที่อยู่และผ่านการตรวจสอบความตรงกันของรุ่นเอกสารแล้ว (เก็บรักษาประวัติ URL เดิมครบถ้วน)";
  }
  return null;
}

/**
 * Verifies an OfficialLocationRecord with configurable retry backoff for transient failures (Section 7, T06).
 * - Transient network / 5xx outage -> marks `temporarily_offline`, preserves `last_successful_verified_at`,
 *   and NEVER deletes or invalidates REG24's pinned version!
 * - Redirect to homepage / login / soft-404 / replacement file with different version -> marks
 *   `quarantined_identity_failure` and queues operator review without silently overwriting historical URL!
 */
export async function verifyOfficialLocationHealth(
  store: DurableKnowledgeStore,
  locationId: string,
  probe: OfficialLinkProbeTransport,
  opts?: {
    maxRetries?: number;
    baseBackoffMs?: number;
    actorId?: string;
  }
): Promise<{
  location: OfficialLocationRecord;
  attempts: number;
  operator_review_required: boolean;
  reason: string;
}> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseBackoffMs = opts?.baseBackoffMs ?? 15;
  const actorId = opts?.actorId || "link-verifier.service@reg24.th";

  const initialState = store.getState();
  const initialLedger = initialState.citation_ledger;
  const existingLoc = initialLedger?.locations[locationId];
  if (!existingLoc) {
    throw new Error(`NOT_FOUND_404: OfficialLocation '${locationId}' not found.`);
  }
  const doc = initialLedger!.documents[existingLoc.doc_id];
  const pinnedVer = existingLoc.version_id ? initialLedger!.versions[existingLoc.version_id] : null;

  let attempts = 0;
  let lastProbe: HttpProbeResult | null = null;
  while (attempts <= maxRetries) {
    attempts++;
    lastProbe = await probe(existingLoc.exact_official_url);
    const isTransient =
      !lastProbe.reachable ||
      lastProbe.http_status === null ||
      lastProbe.http_status === 429 ||
      lastProbe.http_status >= 500;
    if (!isTransient || attempts > maxRetries) {
      break;
    }
    await new Promise((r) => setTimeout(r, baseBackoffMs * Math.pow(2, attempts - 1)));
  }

  const probeRes = lastProbe!;
  const checkedAt = new Date().toISOString();

  return store.transactSync(
    "VERIFY_OFFICIAL_LOCATION_HEALTH",
    (state) => {
      const ledger = ensureCitationLedgerInState(state);
      const loc = ledger.locations[locationId];
      const beforeSnap = {
        link_health: loc.link_health,
        exact_official_url: loc.exact_official_url,
        last_successful_verified_at: loc.last_successful_verified_at,
      };

      let operatorReviewRequired = false;
      let reason = "Official link verified online and matches pinned document identity.";

      // Case 1: Temporary outage / offline / 5xx / 404 when server down (T06)
      if (
        !probeRes.reachable ||
        probeRes.http_status === null ||
        probeRes.http_status >= 500 ||
        probeRes.http_status === 404 ||
        probeRes.http_status === 503
      ) {
        loc.last_verified_at = checkedAt;
        loc.last_http_status = probeRes.http_status;
        loc.link_health = "temporarily_offline";
        loc.failure_reason =
          probeRes.network_error || `HTTP_${probeRes.http_status ?? "OFFLINE"}`;
        operatorReviewRequired = true;
        reason = `Official URL temporarily unavailable (${loc.failure_reason}); pinned REG24 evidence remains intact.`;
      } else {
        // Check identity & detect homepage redirect / soft 404 / replacement file!
        const idCheck = verifyCapturedOfficialIdentity({
          issuer_id: doc.issuer_id,
          source_family: doc.source_family,
          observed_url: loc.exact_official_url,
          final_url: probeRes.final_url || loc.exact_official_url,
          http_status: probeRes.http_status,
          mime_type: probeRes.mime_type,
          expected_native_id: doc.source_native_id,
          expected_title_th: doc.original_title_th,
          captured_text_or_html: probeRes.body_text_or_html,
          registry: ledger.publishers,
        });

        const replacedWithDifferentFile =
          Boolean(pinnedVer && probeRes.body_sha256) &&
          probeRes.body_sha256 !== pinnedVer!.artifact_sha256;

        if (!idCheck.passed || replacedWithDifferentFile) {
          loc.last_verified_at = checkedAt;
          loc.last_http_status = probeRes.http_status;
          loc.identity_match_result = !idCheck.passed
            ? idCheck.identity_match_result
            : "FAILED_UNRELATED_DOCUMENT";
          loc.link_health = "quarantined_identity_failure";
          loc.failure_reason = !idCheck.passed
            ? idCheck.failure_reason
            : `REPLACEMENT_FILE_DETECTED:Remote SHA-256 '${probeRes.body_sha256?.slice(0, 12)}' differs from cited version SHA-256 '${pinnedVer!.artifact_sha256.slice(0, 12)}'; silent replacement blocked.`;
          operatorReviewRequired = true;
          reason = loc.failure_reason || "Identity or version mismatch detected on live URL.";
        } else {
          loc.last_verified_at = checkedAt;
          loc.last_successful_verified_at = checkedAt;
          loc.last_http_status = probeRes.http_status;
          loc.redirect_history = [...probeRes.redirect_chain];
          loc.identity_match_result = "VERIFIED_MATCH";
          loc.link_health = loc.prior_urls.length > 0 ? "moved_verified" : "verified_online";
          loc.failure_reason = null;
        }
      }

      if (operatorReviewRequired) {
        const revId = `rev.link.${sha256Bytes(`${locationId}|${checkedAt}`).slice(0, 12)}`;
        state.reviews[revId] = {
          review_id: revId,
          batch_id: doc.owner_batch_id,
          release_id: state.active_release_id,
          work_id: doc.canonical_work_id,
          candidate_id: null,
          category: "AMBIGUOUS_IDENTITY",
          stratum: "link_verification",
          severity: "HIGH",
          summary: `Official link check requires operator attention for '${doc.source_native_id || doc.original_title_th}': ${reason}`,
          evidence_locator_summary: loc.exact_official_url,
          status: "PENDING",
          reviewer_id: null,
          decision_note: null,
          created_at: checkedAt,
          decided_at: null,
        };
      }

      appendCitationAuditEvent(ledger, {
        actor_or_service: actorId,
        event_type: "OFFICIAL_LINK_HEALTH_UPDATED",
        affected_ids: [loc.location_id, loc.doc_id, ...(loc.version_id ? [loc.version_id] : [])],
        before_status: beforeSnap,
        after_status: {
          link_health: loc.link_health,
          last_http_status: loc.last_http_status,
          last_successful_verified_at: loc.last_successful_verified_at,
        },
        reason,
        correlation_id: `corr.link.${locationId}.${attempts}`,
      });

      return {
        location: { ...loc },
        attempts,
        operator_review_required: operatorReviewRequired,
        reason,
      };
    },
    { actorId }
  );
}

/**
 * Section 7 & T06: Approves a moved/replacement official URL ONLY after verifying it serves
 * the exact cited version (`artifact_sha256` match + official publisher identity match).
 * Rejects homepages and newer amended versions! Preserves full `prior_urls` history.
 */
export async function approveOfficialUrlReplacement(
  store: DurableKnowledgeStore,
  params: {
    location_id: string;
    proposed_new_official_url: string;
    probe: OfficialLinkProbeTransport;
    operator: Actor;
    reason: string;
  }
): Promise<OfficialLocationRecord> {
  if (
    params.operator.role !== "data_operator" &&
    params.operator.role !== "engineering_lead" &&
    params.operator.role !== "legal_reviewer" &&
    params.operator.role !== "product_owner"
  ) {
    throw new Error("FORBIDDEN_403: Operator role required to approve official URL replacement.");
  }

  const st0 = store.getState();
  const ledger0 = st0.citation_ledger;
  const loc0 = ledger0?.locations[params.location_id];
  if (!loc0) {
    throw new Error(`NOT_FOUND_404: OfficialLocation '${params.location_id}' not found.`);
  }
  const doc0 = ledger0!.documents[loc0.doc_id];
  const ver0 = loc0.version_id ? ledger0!.versions[loc0.version_id] : null;
  if (!ver0) {
    throw new Error("VERSION_REQUIRED_400: Cannot verify replacement URL without a pinned DocumentVersion.");
  }

  const probeRes = await params.probe(params.proposed_new_official_url);
  if (!probeRes.reachable || !probeRes.http_status || probeRes.http_status < 200 || probeRes.http_status >= 300) {
    throw new Error(
      `REPLACEMENT_URL_UNREACHABLE_400: Proposed URL '${params.proposed_new_official_url}' returned HTTP ${probeRes.http_status ?? "ERR"}.`
    );
  }

  const idCheck = verifyCapturedOfficialIdentity({
    issuer_id: doc0.issuer_id,
    source_family: doc0.source_family,
    observed_url: params.proposed_new_official_url,
    final_url: probeRes.final_url || params.proposed_new_official_url,
    http_status: probeRes.http_status,
    mime_type: probeRes.mime_type,
    expected_native_id: doc0.source_native_id,
    expected_title_th: doc0.original_title_th,
    captured_text_or_html: probeRes.body_text_or_html,
    registry: ledger0!.publishers,
  });

  if (!idCheck.passed) {
    throw new Error(
      `REPLACEMENT_URL_IDENTITY_REJECTED_422: ${idCheck.identity_match_result} — ${idCheck.failure_reason}`
    );
  }

  if (!probeRes.body_sha256 || probeRes.body_sha256 !== ver0.artifact_sha256) {
    throw new Error(
      `REPLACEMENT_URL_VERSION_MISMATCH_422: Proposed URL SHA-256 '${probeRes.body_sha256 || "none"}' does not match cited version '${ver0.version_id}' SHA-256 '${ver0.artifact_sha256}'. Never replace a historical URL with a newer/different version.`
    );
  }

  const approvedAt = new Date().toISOString();
  return store.transactSync(
    "APPROVE_OFFICIAL_URL_REPLACEMENT",
    (state) => {
      const ledger = ensureCitationLedgerInState(state);
      const loc = ledger.locations[params.location_id];
      const previousUrl = loc.exact_official_url;

      loc.prior_urls.push({
        url: previousUrl,
        replaced_at: approvedAt,
        reason: params.reason,
        approved_by: params.operator.actor_id,
      });
      loc.exact_official_url = probeRes.final_url || params.proposed_new_official_url;
      loc.redirect_history = [...probeRes.redirect_chain];
      loc.last_verified_at = approvedAt;
      loc.last_successful_verified_at = approvedAt;
      loc.last_http_status = probeRes.http_status;
      loc.identity_match_result = "VERIFIED_MATCH";
      loc.link_health = "moved_verified";
      loc.failure_reason = null;

      appendCitationAuditEvent(ledger, {
        actor_or_service: params.operator.actor_id,
        event_type: "OFFICIAL_URL_REPLACEMENT_APPROVED",
        affected_ids: [loc.location_id, loc.doc_id, ver0.version_id],
        before_status: { exact_official_url: previousUrl },
        after_status: {
          exact_official_url: loc.exact_official_url,
          link_health: loc.link_health,
          prior_urls_count: loc.prior_urls.length,
        },
        reason: params.reason,
        correlation_id: `corr.url_replace.${loc.location_id}`,
      });

      return { ...loc, prior_urls: [...loc.prior_urls] };
    },
    { actorId: params.operator.actor_id }
  );
}
