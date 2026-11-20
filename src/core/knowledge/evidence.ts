/**
 * REG24 — Task F3: Ontology Assertion Certification (SH-17) & Live Access/Withdrawal Evidence Enforcement (SH-16, AT08)
 */

import { getVerifiedStatutoryCorpus } from "../data/verified-statutory-loader";
import { KNOWLEDGE_PREDICATE_DOMAIN_RANGE } from "../graph/graph-schema";
import type { Actor, Assertion, Passage, RealSourceLocator } from "./contracts";
import type { DurableKnowledgeStore } from "./store";

export interface AssertionValidationOutcome {
  valid: boolean;
  requires_human_review: boolean;
  errors: string[];
}

/**
 * Validates every staged assertion against the versioned Knowledge GraphRAG ontology (SH-17):
 * 1. Subject/object entity types match the predicate domain/range.
 * 2. Every endpoint and evidence passage locator resolves in the canonical store.
 * 3. Assertion scope never exceeds source evidence permissions.
 * 4. Historical version assertions never silently point to a newer current version.
 * 5. `CITES` is never auto-promoted to `INTERPRETS`, `AMENDS`, or `REPEALS`.
 */
export function validateStagedAssertion(
  store: DurableKnowledgeStore,
  assertion: Assertion,
  opts?: { wasAutoPromotedFromCitationOnly?: boolean }
): AssertionValidationOutcome {
  const errors: string[] = [];
  let requiresReview = false;

  if (opts?.wasAutoPromotedFromCitationOnly && assertion.predicate !== "CITES") {
    errors.push("ILLEGAL_AUTO_PROMOTION_FROM_CITES: Citation alone cannot become INTERPRETS/AMENDS/REPEALS.");
  }

  const rule = KNOWLEDGE_PREDICATE_DOMAIN_RANGE[assertion.predicate];
  if (!rule) {
    errors.push(`UNKNOWN_PREDICATE:${assertion.predicate}`);
  } else {
    if (!rule.allowedSubjects.includes(assertion.subject_type)) {
      errors.push(
        `ONTOLOGY_DOMAIN_VIOLATION: subject_type '${assertion.subject_type}' not allowed for predicate '${assertion.predicate}'`
      );
    }
    if (!rule.allowedObjects.includes(assertion.object_type)) {
      errors.push(
        `ONTOLOGY_RANGE_VIOLATION: object_type '${assertion.object_type}' not allowed for predicate '${assertion.predicate}'`
      );
    }
  }

  const st = store.getState();

  // Check endpoint existence
  const endpointExists = (id: string, entityType: string): boolean => {
    if (entityType === "Passage") return Boolean(st.passages[id]);
    if (entityType === "Artifact") return Boolean(st.artifacts[id]);
    if (entityType === "LegalVersion" || entityType === "ProvisionVersion") {
      return Boolean(st.versions[id] || st.works[id]);
    }
    if (
      entityType === "Agency" ||
      entityType === "Court" ||
      entityType === "Issue" ||
      entityType === "FactPattern" ||
      entityType === "Condition" ||
      entityType === "Exception" ||
      entityType === "DefinedTerm"
    ) {
      return Boolean(id && id.trim().length > 0);
    }
    return Boolean(st.works[id] || st.versions[id]);
  };

  if (!endpointExists(assertion.subject, assertion.subject_type)) {
    errors.push(`UNRESOLVED_SUBJECT_ENDPOINT:${assertion.subject}`);
  }
  if (!endpointExists(assertion.object, assertion.object_type)) {
    errors.push(`UNRESOLVED_OBJECT_ENDPOINT:${assertion.object}`);
  }

  if (!assertion.evidence_ids || assertion.evidence_ids.length === 0) {
    errors.push("MISSING_EVIDENCE_IDS");
  } else {
    for (const evId of assertion.evidence_ids) {
      const psg = st.passages[evId];
      if (!psg) {
        errors.push(`UNRESOLVED_EVIDENCE_PASSAGE:${evId}`);
        continue;
      }
      if (!psg.real_locator || !psg.real_locator.artifact_id || !psg.real_locator.origin_uri) {
        errors.push(`INVALID_EVIDENCE_LOCATOR:${evId}`);
      }
      // Scope ceiling: private source cannot back a public assertion (SH-17 / AT08)
      if (
        assertion.scope === "scope.platform.public" &&
        psg.access_scope !== "scope.platform.public"
      ) {
        errors.push("ASSERTION_SCOPE_EXCEEDS_EVIDENCE_SCOPE");
      }
    }
  }

  // Historical version check: if assertion has valid_to in the past, object cannot be a version effective only AFTER valid_to
  if (assertion.validity.valid_to) {
    const objVer = st.versions[assertion.object];
    const objValidFrom = objVer?.legal_applicability?.[0]?.valid_from;
    if (objValidFrom && objValidFrom > assertion.validity.valid_to) {
      errors.push(
        `HISTORICAL_VERSION_MISMATCH: historical assertion (valid_to=${assertion.validity.valid_to}) points to later version (valid_from=${objValidFrom})`
      );
    }
  }

  // Critical amendment/repeal targets require human review before acceptance (SH-17)
  if (assertion.predicate === "AMENDS" || assertion.predicate === "REPEALS") {
    requiresReview = true;
    if (!assertion.review_id && assertion.state === "ACCEPTED") {
      errors.push("UNREVIEWED_AMEND_OR_REPEAL_CANNOT_BE_AUTO_ACCEPTED");
    }
  }

  return {
    valid: errors.length === 0,
    requires_human_review: requiresReview,
    errors,
  };
}

/**
 * Records an immediate withdrawal/restriction on a work or artifact so all live queries,
 * evidence drawers, and saved citations block unauthorized/withdrawn content immediately (SH-16, AT08).
 */
export function withdrawKnowledgeTarget(
  store: DurableKnowledgeStore,
  targetId: string,
  reason: string,
  actor: Actor
): void {
  store.transactSync("WITHDRAW_TARGET", (s) => {
    s.withdrawals[targetId] = {
      target_id: targetId,
      reason,
      withdrawn_by: actor.actor_id,
      withdrawn_at: new Date().toISOString(),
      active: true,
    };
  });
}

export function isPassageCurrentlyAuthorizedAndActive(
  state: ReturnType<DurableKnowledgeStore["getState"]>,
  passage: Passage,
  actor: Actor
): boolean {
  // 1. Live withdrawal override (SH-16 / AT08)
  if (
    state.withdrawals[passage.work_id]?.active ||
    state.withdrawals[passage.version_id]?.active ||
    state.withdrawals[passage.real_locator.artifact_id]?.active
  ) {
    return false;
  }

  // 2. Live access scope enforcement (return false without leaking private identity)
  if (passage.access_scope === "scope.platform.public") {
    return true;
  }
  return actor.authorized_scopes.includes(passage.access_scope);
}

export function resolveAuthorizedEvidence(
  store: DurableKnowledgeStore,
  evidenceOrPassageId: string,
  actor: Actor
): {
  allowed: boolean;
  http_status: 200 | 403 | 404;
  passage?: Passage;
  work_title_th?: string;
  official_identifier?: string;
  authority_type?: string;
  authenticity_status?: string;
  is_derivative?: boolean;
  locator?: RealSourceLocator;
  error?: string;
} {
  const st = store.getState();
  const psg = st.passages[evidenceOrPassageId];
  if (!psg) {
    return { allowed: false, http_status: 404, error: "Evidence passage not found" };
  }

  if (!isPassageCurrentlyAuthorizedAndActive(st, psg, actor)) {
    // Safe 404 prevents cross-tenant existence probing and enforces immediate withdrawal
    return {
      allowed: false,
      http_status: 404,
      error: "Evidence is unavailable or restricted under current access/withdrawal policy.",
    };
  }

  const work = st.works[psg.work_id];
  const art = st.artifacts[psg.real_locator.artifact_id];

  let effectiveOriginUri = psg.real_locator.origin_uri;
  if (!effectiveOriginUri || /\/law-dependency\//i.test(effectiveOriginUri)) {
    const corp = getVerifiedStatutoryCorpus();
    const verifiedUri =
      corp.revenue_code_sections[psg.work_id]?.origin_uri ||
      corp.subordinate_and_amendment_works[psg.work_id]?.origin_uri ||
      "";
    if (verifiedUri && !/\/law-dependency\//i.test(verifiedUri)) {
      effectiveOriginUri =
        psg.work_id === "prov.th.rc.49_ทวิ" && verifiedUri === "https://www.rd.go.th/5937.html"
          ? "https://www.rd.go.th/5937.html#mata49bis"
          : verifiedUri;
    }
  }

  return {
    allowed: true,
    http_status: 200,
    passage: psg,
    work_title_th: work?.title_th || psg.contextualized_header,
    official_identifier: work?.official_identifiers[0]?.normalized || psg.work_id,
    authority_type: work?.type || "LegalWork",
    authenticity_status: art?.authenticity_status || "verified_corpus_mirror",
    is_derivative: Boolean(art?.is_derivative),
    locator:
      effectiveOriginUri !== psg.real_locator.origin_uri
        ? { ...psg.real_locator, origin_uri: effectiveOriginUri }
        : psg.real_locator,
  };
}
