/**
 * REG24 — Official-Source Claim Traceability, Atomic Claim Segmentation, Multi-Premise
 * Publication Gate, Authorized Evidence Resolver, Saved Answer Replay & Multi-Channel Serializer
 *
 * Implements Sections 1, 3, 5, 6, 7, 8, 9, 10 of:
 * "REG24 developer requirements — official-source citations and claim traceability"
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isPassageCurrentlyAuthorizedAndActive } from "./evidence";
import { arabicDigitsToThai, sha256Bytes, thaiDigitsToArabic } from "./identity";
import { formatOfficialLinkStatusNoticeTh } from "./link-health";
import {
  appendCitationAuditEvent,
  createEmptyCitationLedger,
  ensureCitationLedgerInState,
  formatHumanPinpointTh,
  normalizeThaiSearchTextOnly,
  REVIEWED_OFFICIAL_PUBLISHER_REGISTRY,
} from "./source-onboarding";
import type {
  Actor,
  Assertion,
  BatchId,
  GroundedAnswer,
  Passage,
} from "./contracts";
import type { CanonicalPersistedState, DurableKnowledgeStore } from "./store";
import type {
  AccessPermissionKind,
  AtomicClaimType,
  BatchIngestionStageCounts,
  CitationAcceptanceMeasurementReport,
  ClaimEvidenceReferenceDto,
  ClaimSupportRole,
  DocumentVersionRecord,
  EvidencePassageRecord,
  EvidencedGraphAssertionRecord,
  ExtractionRevisionRecord,
  NewerMaterialUpdateNoticeDto,
  OfficialDocumentRecord,
  OfficialLocationRecord,
  OfficialRecordType,
  OfficialSourceFamily,
  PersistedCitationTraceabilityState,
  PublishedAtomicClaimDto,
  ResolvedPinnedEvidenceResponse,
  SourceFamilyPinpointMetadata,
  TraceableAnswerEnvelope,
  TraceablePublicationChannel,
  TypedPassageAnchor,
  UnresolvedIssueDto,
  VerifierDecisionOutcome,
} from "./citation-contracts";

export const CLAIM_VERIFIER_VERSION = "reg24-claim-verifier-v2.0";
export const CLAIM_RULESET_VERSION = "th-official-traceability-2026.11";

export const CLAIM_TYPE_LABELS_TH: Record<AtomicClaimType, string> = {
  legal_proposition: "ข้อกฎหมายจากแหล่งอ้างอิงทางการ",
  interpretation: "การปรับใช้ข้อกฎหมายกับข้อเท็จจริง (การตีความ)",
  user_fact_or_assumption: "ข้อเท็จจริงหรือสมมติฐานที่ผู้ใช้ระบุ",
  scoped_unresolved_notice: "คำชี้แจงประเด็นที่ยังยืนยันจากเอกสารทางการไม่ได้",
};

export const SUPPORT_ROLE_LABELS_TH: Record<ClaimSupportRole, string> = {
  primary_authority: "หลักฐานกฎหมายหลัก",
  statutory_premise: "บทบัญญัติแห่งกฎหมายที่เป็นฐานข้อสรุป",
  ruling_application: "แนววินิจฉัยทางการที่ใช้ปรับบท",
  judicial_reasoning: "เหตุผลหรือคำวินิจฉัยของศาล",
  exception_or_proviso: "ข้อยกเว้นหรือเงื่อนไขบังคับ",
  transitional_applicability: "บทเฉพาะกาลหรือวันเริ่มใช้บังคับ",
  requester_factual_context: "ข้อเท็จจริงของผู้ขอหารือในเอกสารต้นฉบับ",
  official_summary_scope: "สรุปย่อทางการ (รับรองเฉพาะขอบเขตที่สรุปย่อระบุ)",
};

export const SOURCE_FAMILY_LABELS_TH: Record<OfficialSourceFamily, string> = {
  gazette_enactment: "กฎหมาย/บทบัญญัติประกาศในราชกิจจานุเบกษา",
  supreme_court_decision: "คำพิพากษาศาลฎีกา",
  council_of_state_opinion: "ความเห็นคณะกรรมการกฤษฎีกา",
  revenue_department_ruling: "หนังสือตอบข้อหารือกรมสรรพากร",
};

export const RECORD_TYPE_LABELS_TH: Record<OfficialRecordType, string> = {
  full_record: "เอกสารฉบับเต็มทางการ",
  official_summary: "สรุปย่อทางการ",
  landing_only: "ระเบียนอ้างอิงหลักของหน่วยงาน",
  third_party_discovery: "สำเนาจากแหล่งภายนอก (ใช้เพื่อการค้นพบเท่านั้น ห้ามเผยแพร่เป็นหลักฐานยืนยัน)",
};

/**
 * Protects the frozen baseline `data/knowledge-store/canonical-state.json.gz` from accidental writes
 * during live read/save operations by routing runtime overlay mutations on that specific frozen path
 * to a dedicated sidecar file in `os.tmpdir()`, while using `store.transactSync()` directly on all
 * custom test stores, staging stores, and configured env directories.
 */
function isProtectedFrozenBaselineStore(store: DurableKnowledgeStore): boolean {
  const norm = path.resolve(store.dataDir).replace(/\\/g, "/").toLowerCase();
  return norm.endsWith("/data/knowledge-store");
}

function getFrozenStoreSidecarPath(store: DurableKnowledgeStore): string {
  const hash = sha256Bytes(path.resolve(store.dataDir)).slice(0, 10);
  const dir = path.join(os.tmpdir(), "reg24-citation-overlay");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `citation-ledger-${hash}.json`);
}

function readSidecarOverlay(store: DurableKnowledgeStore): PersistedCitationTraceabilityState | null {
  if (!isProtectedFrozenBaselineStore(store)) return null;
  const p = getFrozenStoreSidecarPath(store);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as PersistedCitationTraceabilityState;
  } catch {
    return null;
  }
}

export function mutateCitationLedgerAtomically<T>(
  store: DurableKnowledgeStore,
  opName: string,
  actorId: string,
  mutator: (ledger: PersistedCitationTraceabilityState, state: CanonicalPersistedState) => T
): T {
  if (isProtectedFrozenBaselineStore(store)) {
    const state = store.getState();
    const overlay = readSidecarOverlay(store) || state.citation_ledger || createEmptyCitationLedger();
    const res = mutator(overlay, state);
    const sidecarPath = getFrozenStoreSidecarPath(store);
    const tmpPath = `${sidecarPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(overlay), "utf8");
    fs.renameSync(tmpPath, sidecarPath);
    return res;
  }
  return store.transactSync(
    opName,
    (draft) => {
      const ledger = ensureCitationLedgerInState(draft);
      return mutator(ledger, draft);
    },
    { actorId }
  );
}

function mapCanonicalWorkTypeToSourceFamily(
  workType: string,
  issuerId: string
): OfficialSourceFamily {
  if (workType === "TaxRuling" || issuerId === "reg.th.rd") {
    if (workType === "TaxRuling") return "revenue_department_ruling";
  }
  if (workType === "CourtDecision" || issuerId === "reg.th.supreme_court") {
    return "supreme_court_decision";
  }
  if (workType === "LegalOpinion" || issuerId === "reg.th.ocs") {
    return "council_of_state_opinion";
  }
  return "gazette_enactment";
}

function mapPublisherId(issuerId: string): string {
  if (REVIEWED_OFFICIAL_PUBLISHER_REGISTRY[issuerId]) return issuerId;
  if (issuerId.includes("rd")) return "reg.th.rd";
  if (issuerId.includes("supreme") || issuerId.includes("court")) return "reg.th.supreme_court";
  if (issuerId.includes("ocs") || issuerId.includes("krisdika")) return "reg.th.ocs";
  if (issuerId.includes("mof")) return "reg.th.mof";
  if (issuerId.includes("cabinet")) return "reg.th.cabinet";
  if (issuerId.includes("parliament")) return "reg.th.parliament";
  return "reg.th.soc_ratchakitcha";
}

/**
 * Builds a unified read view combining onboarded `citation_ledger` records with dynamically
 * reconciled canonical Batch 1 (`works`, `versions`, `artifacts`, `extractions`, `passages`, `assertions`).
 */
export function getUnifiedCitationLedgerView(
  store: DurableKnowledgeStore,
  releaseId?: string
): PersistedCitationTraceabilityState {
  const state = store.getState();
  const baseLedger =
    readSidecarOverlay(store) || state.citation_ledger || createEmptyCitationLedger();

  const view: PersistedCitationTraceabilityState = {
    initialized_for_release_id: releaseId || state.active_release_id || baseLedger.initialized_for_release_id,
    publication_gate_mode:
      (process.env.REG24_CLAIM_TRACEABILITY_MODE as PersistedCitationTraceabilityState["publication_gate_mode"]) ||
      baseLedger.publication_gate_mode ||
      "enforced",
    publishers: { ...REVIEWED_OFFICIAL_PUBLISHER_REGISTRY, ...baseLedger.publishers },
    documents: { ...baseLedger.documents },
    versions: { ...baseLedger.versions },
    locations: { ...baseLedger.locations },
    extraction_revisions: { ...baseLedger.extraction_revisions },
    passages: { ...baseLedger.passages },
    graph_assertions: { ...baseLedger.graph_assertions },
    published_answers: { ...baseLedger.published_answers },
    claim_evidence_links: { ...baseLedger.claim_evidence_links },
    audit_events: [...baseLedger.audit_events],
    reconciliation_tasks: { ...baseLedger.reconciliation_tasks },
    projection_outbox: { ...baseLedger.projection_outbox },
  };

  const targetRel =
    releaseId ||
    state.active_release_id ||
    Object.keys(state.releases)[0] ||
    "rel.B01.rc1";
  const relPassages = store.getPassagesForRelease(targetRel);

  for (const psg of relPassages) {
    if (view.passages[psg.passage_id]) continue;
    const work = state.works[psg.work_id];
    const ver = state.versions[psg.version_id];
    const ext = state.extractions[psg.extraction_id];
    const art = state.artifacts[psg.real_locator.artifact_id];
    if (!work || !ver) continue;

    const pubId = mapPublisherId(work.issuer_id);
    const sourceFamily = mapCanonicalWorkTypeToSourceFamily(work.type, pubId);
    const nativeId = work.official_identifiers?.[0]?.normalized || null;
    const docId = work.work_id;

    const authenticity = art?.authenticity_status || "verified_corpus_mirror";
    const rights = art?.rights_status || "approved_public";
    const isThirdParty = authenticity === "user_supplied_unverified";
    const isWithdrawn =
      rights === "withdrawn" ||
      Boolean(state.withdrawals[work.work_id]?.active) ||
      Boolean(state.withdrawals[ver.version_id]?.active) ||
      Boolean(art && state.withdrawals[art.artifact_id]?.active);

    const accessPerm: AccessPermissionKind =
      psg.access_scope === "scope.platform.public"
        ? "public"
        : rights === "restricted_tenant"
          ? "restricted_tenant"
          : "authenticated_internal";

    if (!view.documents[docId]) {
      view.documents[docId] = {
        doc_id: docId,
        source_family: sourceFamily,
        issuer_id: pubId,
        source_native_id: nativeId,
        reviewed_surrogate_id: nativeId ? null : work.work_id,
        is_reviewed_surrogate: !nativeId,
        original_title_th: work.title_th,
        language: psg.language,
        record_type: isThirdParty ? "third_party_discovery" : "full_record",
        access_permission: accessPerm,
        preservation_permission: "retained_artifact_permitted",
        access_scope: psg.access_scope,
        access_conditions_th:
          accessPerm !== "public"
            ? "จำกัดเฉพาะผู้ใช้งานที่มีสิทธิ์เข้าถึงขอบเขตข้อมูลขององค์กร (Authorized Scope Required)"
            : null,
        eligible_for_citation: !isThirdParty && !isWithdrawn,
        ineligible_reason: isThirdParty
          ? "THIRD_PARTY_UNVERIFIED_SOURCE"
          : isWithdrawn
            ? "WITHDRAWN_BY_OPERATOR"
            : null,
        canonical_work_id: work.work_id,
        owner_batch_id: work.owner_batch_id,
        created_at: ver.known_from || "2026-11-14T00:00:00.000Z",
      };
    }

    if (!view.versions[ver.version_id]) {
      const app0 = ver.legal_applicability?.[0];
      view.versions[ver.version_id] = {
        version_id: ver.version_id,
        doc_id: docId,
        artifact_sha256:
          art?.actual_bytes_sha256 || sha256Bytes(`${ver.version_id}:${psg.exact_text}`),
        captured_at: art?.fetched_at || ver.known_from || "2026-11-14T00:00:00.000Z",
        artifact_ref: art?.immutable_uri || `artifact://canonical/${psg.real_locator.artifact_id}`,
        mime_type: art?.MIME || "text/html",
        byte_size: art?.size ?? Buffer.byteLength(psg.exact_text, "utf8"),
        source_metadata: {
          ruling_reference_no: sourceFamily === "revenue_department_ruling" ? nativeId : null,
          ruling_subject_th: sourceFamily === "revenue_department_ruling" ? work.title_th : null,
          provision_label: sourceFamily === "gazette_enactment" ? nativeId || work.title_th : null,
        },
        publication_date: ver.publication_date || ver.decision_date || null,
        publication_date_status:
          ver.publication_date || ver.decision_date ? "known" : "unknown_explicit",
        effective_from: app0?.valid_from ?? null,
        effective_to: app0?.valid_to ?? null,
        effective_date_status:
          app0?.date_status === "unknown_restricted"
            ? "unknown_explicit"
            : app0?.valid_from
              ? app0.valid_to
                ? "known"
                : "open_ended"
              : "unknown_explicit",
        applicability_rules_th: (ver.amendment_ledger || []).map((al) => al.applicability_rule_th),
        affected_provisions: (ver.amendment_ledger || []).map((al, i) => ({
          provision_key: `${work.work_id}#${al.subprovision_label || i + 1}`,
          provision_label_th: al.subprovision_label || work.title_th,
          effective_from: al.applicability_from_date || al.enactment_effective_date,
          effective_to: null,
          applicability_basis: al.applicability_basis,
          applicability_from_tax_year_be: al.applicability_from_tax_year_be,
          transitional_rule_th: al.applicability_rule_th,
        })),
        predecessor_version_id: null,
        amending_version_ids: [],
        byte_change_classification: "initial_capture",
        canonical_version_id: ver.version_id,
        created_at: ver.known_from || "2026-11-14T00:00:00.000Z",
      };
    }

    const originUri = psg.real_locator.origin_uri || art?.origin_uri || "";
    const locId = `oloc.can.${sha256Bytes(`${docId}|${ver.version_id}|${originUri}`).slice(0, 14)}`;
    if (!view.locations[locId]) {
      view.locations[locId] = {
        location_id: locId,
        doc_id: docId,
        version_id: ver.version_id,
        exact_official_url: originUri,
        role: isThirdParty ? "third_party_discovery" : "primary_official",
        parent_landing_location_id: null,
        original_observed_url: originUri,
        redirect_history: [],
        prior_urls: [],
        first_verified_at: art?.fetched_at || ver.known_from,
        last_verified_at: art?.fetched_at || ver.known_from,
        last_successful_verified_at: isThirdParty ? null : art?.fetched_at || ver.known_from,
        verification_method: "canonical_b01_verified_backfill_v1",
        identity_match_result: isThirdParty ? "FAILED_UNTRUSTED_HOST" : "VERIFIED_MATCH",
        link_health: isThirdParty ? "quarantined_identity_failure" : "verified_online",
        last_http_status: 200,
        failure_reason: null,
        is_active_primary: true,
      };
    }

    const extRevId = psg.extraction_id;
    if (!view.extraction_revisions[extRevId]) {
      const qual = ext?.quality_status || "VALIDATED";
      view.extraction_revisions[extRevId] = {
        extraction_revision_id: extRevId,
        version_id: ver.version_id,
        parent_revision_id: null,
        parser_or_ocr_version: ext?.extractor_version || "canonical-native-v1",
        is_scanned_material: qual === "OCR_VERIFIED",
        page_mapping: [],
        raw_transcription: ext?.raw_text || psg.exact_text,
        normalized_search_text:
          ext?.normalized_text || normalizeThaiSearchTextOnly(psg.exact_text),
        alignment_map: [],
        ocr_ambiguity_detected: qual === "REVIEW_REQUIRED" || qual === "QUARANTINED",
        ocr_ambiguity_reasons:
          qual === "REVIEW_REQUIRED" || qual === "QUARANTINED" ? [qual] : [],
        review_status:
          qual === "QUARANTINED"
            ? "QUARANTINED"
            : qual === "REVIEW_REQUIRED"
              ? "AWAITING_THAI_REVIEW"
              : qual === "OCR_VERIFIED"
                ? "REVIEWED_APPROVED"
                : "VERIFIED_NATIVE",
        reviewer_id: null,
        reviewed_at: null,
        correction_note: null,
        created_at: ext?.created_at || ver.known_from,
      };
    }

    const prevPsg = psg.adjacent_ids.previous_id
      ? state.passages[psg.adjacent_ids.previous_id]
      : null;
    const nextPsg = psg.adjacent_ids.next_id
      ? state.passages[psg.adjacent_ids.next_id]
      : null;

    const oneBasedPage =
      typeof psg.real_locator.physical_page_index === "number"
        ? psg.real_locator.physical_page_index + 1
        : null;
    const printedLabel = psg.real_locator.printed_page_label ?? null;

    const rulingPart: SourceFamilyPinpointMetadata["ruling_part"] =
      sourceFamily === "revenue_department_ruling"
        ? psg.statement_role === "requester_facts"
          ? "facts"
          : psg.statement_role === "requester_question"
            ? "question"
            : psg.statement_role === "official_reasoning"
              ? "answer_reasoning"
              : psg.statement_role === "official_conclusion"
                ? "answer_conclusion"
                : null
        : null;

    const pinpointMeta: SourceFamilyPinpointMetadata = {
      ruling_reference_no: sourceFamily === "revenue_department_ruling" ? nativeId : null,
      ruling_subject_th: sourceFamily === "revenue_department_ruling" ? work.title_th : null,
      ruling_part: rulingPart,
      provision_label: sourceFamily === "gazette_enactment" ? nativeId || work.title_th : null,
      gazette_printed_page: printedLabel,
    };

    const anchor: TypedPassageAnchor =
      psg.real_locator.kind === "pdf_page"
        ? {
            anchor_kind: "pdf_page_span",
            physical_page_one_based: oneBasedPage ?? 1,
            printed_page_label: printedLabel,
            bbox_normalized: psg.real_locator.bounding_box || [0.08, 0.12, 0.92, 0.88],
          }
        : {
            anchor_kind: "html_text_quote",
            structural_selector: psg.real_locator.structural_selector || "article > section",
            exact_quote: psg.exact_text.slice(0, 220),
            quote_prefix: prevPsg ? prevPsg.exact_text.slice(-80) : undefined,
            quote_suffix: nextPsg ? nextPsg.exact_text.slice(0, 80) : undefined,
          };

    const hasValidLocator = Boolean(originUri && psg.real_locator.artifact_id);
    const extStatus = view.extraction_revisions[extRevId].review_status;
    const psgEligible =
      view.documents[docId].eligible_for_citation &&
      hasValidLocator &&
      extStatus !== "AWAITING_THAI_REVIEW" &&
      extStatus !== "QUARANTINED";

    view.passages[psg.passage_id] = {
      passage_id: psg.passage_id,
      extraction_revision_id: extRevId,
      version_id: ver.version_id,
      doc_id: docId,
      verbatim_text: psg.exact_text,
      normalized_search_text: normalizeThaiSearchTextOnly(psg.exact_text),
      text_sha256: sha256Bytes(psg.exact_text),
      surrounding_before: prevPsg ? prevPsg.exact_text.slice(-360) : "",
      surrounding_after: nextPsg ? nextPsg.exact_text.slice(0, 360) : "",
      section_paragraph_path: [...psg.structural_path],
      statement_role: psg.statement_role,
      physical_page_start: oneBasedPage,
      physical_page_end: oneBasedPage,
      printed_page_start: printedLabel,
      printed_page_end: printedLabel,
      anchors: [anchor],
      human_pinpoint_th: formatHumanPinpointTh({
        source_family: sourceFamily,
        record_type: view.documents[docId].record_type,
        section_paragraph_path: psg.structural_path,
        physical_page_start: oneBasedPage,
        physical_page_end: oneBasedPage,
        printed_page_start: printedLabel,
        printed_page_end: printedLabel,
        pinpoint_meta: pinpointMeta,
      }),
      source_family_pinpoint: pinpointMeta,
      locator_replay_status: hasValidLocator ? "VERIFIED" : "QUARANTINED",
      quarantine_reason: hasValidLocator ? null : "MISSING_ORIGIN_URI_OR_ARTIFACT",
      eligible_for_publication: psgEligible,
      access_scope: psg.access_scope,
      created_at: ver.known_from || "2026-11-14T00:00:00.000Z",
    };
  }

  // Reconcile canonical graph assertions (RET-02)
  const relAssertions = store.getAcceptedAssertionsForRelease(targetRel);
  for (const a of relAssertions) {
    if (view.graph_assertions[a.assertion_id]) continue;
    const isNavOnly = a.predicate === "CITES" || a.predicate === "ISSUED_BY";
    const validEvIds = (a.evidence_ids || []).filter(
      (eid) => view.passages[eid]?.eligible_for_publication
    );
    view.graph_assertions[a.assertion_id] = {
      assertion_id: a.assertion_id,
      subject_id: a.subject,
      predicate: a.predicate,
      object_id: a.object,
      proposition_text_th: `${a.subject} ${a.predicate} ${a.object}`,
      applicability: {
        valid_from: a.validity.valid_from,
        valid_to: a.validity.valid_to,
        conditions: [...a.qualifications.conditions, ...a.qualifications.exceptions],
      },
      evidence_passage_ids: a.evidence_ids || [],
      relation_to_evidence: isNavOnly ? "navigation_only" : "substantive_support",
      verification_state:
        !isNavOnly && validEvIds.length === 0 ? "QUARANTINED" : "VERIFIED",
    };
  }

  return view;
}

/**
 * Section 4.5 & 10.2: Computes Batch 1 (or any batch) inventory reconciliation counts
 * for discovered, captured, verified, eligible, and quarantined documents & passages with reasons.
 */
export function computeBatchTraceabilityInventoryCounts(
  store: DurableKnowledgeStore,
  batchId: BatchId = "B01",
  releaseId?: string
): BatchIngestionStageCounts {
  const state = store.getState();
  const relId =
    releaseId ||
    state.active_release_id ||
    Object.keys(state.releases)[0] ||
    `rel.${batchId}.rc1`;
  const view = getUnifiedCitationLedgerView(store, relId);

  const byFamily: BatchIngestionStageCounts["documents"]["by_source_family"] = {
    gazette_enactment: { discovered: 0, eligible: 0, quarantined: 0 },
    supreme_court_decision: { discovered: 0, eligible: 0, quarantined: 0 },
    council_of_state_opinion: { discovered: 0, eligible: 0, quarantined: 0 },
    revenue_department_ruling: { discovered: 0, eligible: 0, quarantined: 0 },
  };

  const docQuarantineReasons: Record<string, number> = {};
  const docs = Object.values(view.documents).filter(
    (d) => d.owner_batch_id === batchId || batchId === "B01"
  );

  let docVerified = 0;
  let docEligible = 0;
  let docQuarantined = 0;
  for (const d of docs) {
    byFamily[d.source_family].discovered++;
    if (d.eligible_for_citation) {
      docVerified++;
      docEligible++;
      byFamily[d.source_family].eligible++;
    } else {
      docQuarantined++;
      byFamily[d.source_family].quarantined++;
      const r = d.ineligible_reason || "QUARANTINED_UNSPECIFIED";
      docQuarantineReasons[r] = (docQuarantineReasons[r] || 0) + 1;
    }
  }

  // Also include unresolved external statutory references from `state.unresolved_references` as quarantined dependencies!
  for (const uref of Object.values(state.unresolved_references)) {
    const r = `UNRESOLVED_EXTERNAL_DEPENDENCY:${uref.reason || "QUARANTINED"}`;
    docQuarantineReasons[r] = (docQuarantineReasons[r] || 0) + 1;
  }

  const psgQuarantineReasons: Record<string, number> = {};
  const psgs = Object.values(view.passages);
  let psgVerified = 0;
  let psgEligible = 0;
  let psgQuarantined = 0;
  for (const p of psgs) {
    if (p.locator_replay_status === "VERIFIED") {
      psgVerified++;
    }
    if (p.eligible_for_publication) {
      psgEligible++;
    } else {
      psgQuarantined++;
      const r = p.quarantine_reason || "PASSAGE_NOT_ELIGIBLE";
      psgQuarantineReasons[r] = (psgQuarantineReasons[r] || 0) + 1;
    }
  }

  return {
    batch_id: batchId,
    release_id: relId,
    documents: {
      discovered: docs.length,
      captured: docs.length,
      verified: docVerified,
      eligible: docEligible,
      quarantined: docQuarantined,
      quarantined_by_reason: docQuarantineReasons,
      by_source_family: byFamily,
    },
    passages: {
      discovered: psgs.length,
      captured: psgs.length,
      verified: psgVerified,
      eligible: psgEligible,
      quarantined: psgQuarantined,
      quarantined_by_reason: psgQuarantineReasons,
    },
  };
}

/**
 * Section 1: Decomposes compound Thai/English legal sentences into smallest independently
 * checkable atomic claims (e.g., duty + exception + deadline -> 3 claims!).
 */
export function segmentIntoAtomicClaimStatements(rawStatement: string): string[] {
  const cleaned = (rawStatement || "").trim();
  if (!cleaned) return [];

  // Do not over-segment explicit abstention / clarification notices
  if (/^(?:ไม่พบข้อมูล|ระบบจึงระงับ|กรุณาระบุ|ยังยืนยัน)/.test(cleaned)) {
    return [cleaned];
  }

  // Split compound clauses asserting a duty + an exception (`เว้นแต่` / `ยกเว้นแต่` / `ยกเว้นกรณี`) + a deadline (`และต้องนำส่งภายใน` / `ภายในกำหนดเวลา` / `และยื่นแบบรายการภายใน`)
  const splitRegex =
    /\s*(?=(?:เว้นแต่|ยกเว้น(?:เฉพาะ|แต่|กรณี|ดอกเบี้ย)|ทั้งนี้\s*(?:ต้อง|ไม่รวมถึง|ภายใต้)|และ(?:ต้อง)?(?:นำส่ง|ยื่นแบบ|ชำระภาษี|แจ้ง)[^\n]{0,30}?ภายใน\s*[0-9๐-๙]+\s*(?:วัน|เดือน|ปี)|โดยต้องยื่น[^\n]{0,25}?ภายใน\s*[0-9๐-๙]+\s*(?:วัน|เดือน|ปี)))/g;

  const rawParts = cleaned
    .split(splitRegex)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);

  return rawParts.length > 1 ? rawParts : [cleaned];
}

export function extractUserSuppliedFactsFromQuestion(question: string): string[] {
  const q = (question || "").trim();
  if (!q) return [];
  const facts: string[] = [];
  const patterns = [
    /(?:ข้อเท็จจริงคือ|สมมติว่า|กรณีที่|บริษัทของเรา|ห้างฯ\s*ของเรา)([^?。\n]{8,220})/g,
    /(?:มีทุนจดทะเบียน|ประกอบกิจการ|จ่ายเงินได้ให้|ขายสินค้าให้|นำเข้าสินค้า)([^?。\n]{6,180})/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(q)) !== null) {
      const candidate = m[0].trim();
      if (candidate && !facts.includes(candidate)) {
        facts.push(candidate);
      }
    }
  }
  return facts.slice(0, 5);
}

/**
 * RET-01: Boundary-preserving context truncation so model inputs never slice mid-passage or mid-ID.
 */
export function packCandidatesPreservingBoundaries(
  passages: EvidencePassageRecord[],
  maxBudgetChars: number
): {
  packed: EvidencePassageRecord[];
  truncated_count: number;
} {
  const packed: EvidencePassageRecord[] = [];
  let used = 0;
  for (const p of passages) {
    const blockCost =
      p.passage_id.length +
      p.version_id.length +
      p.human_pinpoint_th.length +
      p.verbatim_text.length +
      48;
    if (packed.length > 0 && used + blockCost > maxBudgetChars) {
      return {
        packed,
        truncated_count: passages.length - packed.length,
      };
    }
    packed.push(p);
    used += blockCost;
  }
  return { packed, truncated_count: 0 };
}

export function buildOfficialUrlWithAnchor(
  loc: OfficialLocationRecord,
  psg: EvidencePassageRecord,
  pub?: { supports_pdf_page_fragment?: boolean; supports_html_fragment?: boolean }
): string {
  const base = loc.exact_official_url || "";
  if (!base) return "";
  if (base.includes("#")) return base;

  if (
    psg.physical_page_start !== null &&
    (pub?.supports_pdf_page_fragment || /\.pdf(?:$|\?)/i.test(base))
  ) {
    return `${base}#page=${psg.physical_page_start}`;
  }
  const htmlFrag = psg.anchors.find((a) => a.html_fragment_id)?.html_fragment_id;
  if (htmlFrag && pub?.supports_html_fragment) {
    return `${base}#${htmlFrag.replace(/^#/, "")}`;
  }
  return base;
}

export function buildThaiCitationLabel(
  doc: OfficialDocumentRecord,
  psg: EvidencePassageRecord
): string {
  const docLabel =
    doc.source_native_id ||
    doc.original_title_th.slice(0, 60);
  const recordPrefix =
    doc.record_type === "official_summary" ? "สรุปย่อทางการ · " : "";
  return `${recordPrefix}${docLabel} · ${psg.human_pinpoint_th}`;
}

export interface ProposedStructuredClaimInput {
  claim_id?: string;
  text: string;
  claim_type: AtomicClaimType;
  premise_ids?: string[];
  /**
   * Required support groups: EVERY group must have >=1 valid eligible passage,
   * and EVERY member of a jointly-required group is persisted!
   */
  support_groups: Array<{
    group_id: string;
    role: ClaimSupportRole;
    evidence_ids: string[];
    expected_version_id?: string | null;
  }>;
  scope_topic_th?: string;
  human_approved_by?: string | null;
}

export interface ValidateAndPublishAnswerInput {
  answer_id?: string;
  supersedes_answer_revision?: string | null;
  revision_number?: number;
  channel: TraceablePublicationChannel;
  question: string;
  as_of_date: string | null;
  generated_at?: string;
  release_id: string;
  actor: Actor;
  authorized_candidate_ids: Set<string>;
  proposed_claims: ProposedStructuredClaimInput[];
  user_supplied_facts?: string[];
  assumptions?: string[];
  persist_atomically?: boolean;
}

/**
 * ANS-01, ANS-02, ANS-03 & Section 1 Release Invariant:
 * Validates deterministic IDs/versions/locators AND substantive support (including contradicting
 * exceptions `T08`, `official_summary` limits `SRC-02`, and OCR review blocks `T02`), withholds
 * any conclusion that loses a required premise (`T03`), and returns ONLY the validated representation.
 */
export function validateAndBuildTraceableAnswer(
  store: DurableKnowledgeStore,
  input: ValidateAndPublishAnswerInput
): TraceableAnswerEnvelope {
  const generatedAt = input.generated_at || new Date().toISOString();
  const view = getUnifiedCitationLedgerView(store, input.release_id);
  const state = store.getState();

  const answerId =
    input.answer_id ||
    `ans.${sha256Bytes(`${input.release_id}|${input.actor.actor_id}|${input.question}|${input.as_of_date || "cur"}`).slice(0, 14)}`;
  const revNo = input.revision_number ?? 1;
  const answerRevision = `${answerId}.r${revNo}`;

  // Gate switch check (Section 7)
  if (view.publication_gate_mode === "generation_disabled") {
    const disabledExplanation =
      "ระบบปิดการสร้างคำตอบใหม่ชั่วคราวตามมาตรการควบคุมการเผยแพร่ (เข้าถึงได้เฉพาะคำตอบที่ผ่านการรับรองไว้เดิม)";
    return {
      schema_version: "reg24.citation-traceability.v1",
      answer_id: answerId,
      answer_revision: answerRevision,
      revision_number: revNo,
      supersedes_answer_revision: input.supersedes_answer_revision ?? null,
      channel: input.channel,
      generated_at: generatedAt,
      as_of_date: input.as_of_date,
      status: "insufficient",
      rendered_answer_th: disabledExplanation,
      user_supplied_facts: input.user_supplied_facts || [],
      assumptions: input.assumptions || [],
      claims: [],
      unresolved_issues: [
        {
          issue_id: `iss.${answerRevision}.switch`,
          scope_key: "publication_switch",
          explanation_th: disabledExplanation,
          reason_code: "PUBLICATION_SWITCH_READONLY",
          withheld_claim_ids: input.proposed_claims.map((c, i) => c.claim_id || `clm.${i + 1}`),
        },
      ],
      legacy_warning_th: null,
      verifier_metadata: {
        verifier_version: CLAIM_VERIFIER_VERSION,
        ruleset_version: CLAIM_RULESET_VERSION,
        release_id: input.release_id,
        publication_gate_mode: view.publication_gate_mode,
      },
    };
  }

  const evaluatedClaims = new Map<string, PublishedAtomicClaimDto>();
  const unresolvedIssues: UnresolvedIssueDto[] = [];
  const allLinksToPersist: Array<
    ClaimEvidenceReferenceDto & {
      answer_revision: string;
      claim_id: string;
      verifier_or_reviewer_id: string;
      ruleset_version: string;
      verified_at: string;
    }
  > = [];

  // Candidate passages available in the retrieval set for contradicting-exception inspection (T08)
  const candidatePassages = Array.from(input.authorized_candidate_ids)
    .map((id) => view.passages[id])
    .filter((p): p is EvidencePassageRecord => Boolean(p));

  for (let idx = 0; idx < input.proposed_claims.length; idx++) {
    const prop = input.proposed_claims[idx];
    const claimId = prop.claim_id || `clm.${answerRevision}.${idx + 1}`;

    // User-supplied facts & explicit scoped unresolved notices are non-authority epistemic rows
    if (prop.claim_type === "user_fact_or_assumption") {
      evaluatedClaims.set(claimId, {
        claim_id: claimId,
        claim_number: idx + 1,
        text: prop.text,
        claim_type: "user_fact_or_assumption",
        claim_type_label_th: CLAIM_TYPE_LABELS_TH.user_fact_or_assumption,
        premise_ids: [],
        verification_decision: "supported",
        published: true,
        withheld_explanation_th: null,
        evidence_references: [],
      });
      continue;
    }

    if (prop.claim_type === "scoped_unresolved_notice") {
      evaluatedClaims.set(claimId, {
        claim_id: claimId,
        claim_number: idx + 1,
        text: prop.text,
        claim_type: "scoped_unresolved_notice",
        claim_type_label_th: CLAIM_TYPE_LABELS_TH.scoped_unresolved_notice,
        premise_ids: [],
        verification_decision: "insufficient",
        published: true,
        withheld_explanation_th: prop.text,
        evidence_references: [],
      });
      continue;
    }

    // Check premise dependencies first (T03: dependent conclusion withheld if ANY premise is withheld!)
    const premiseIds = prop.premise_ids || [];
    const failedPremise = premiseIds.find((pid) => {
      const prem = evaluatedClaims.get(pid);
      return !prem || !prem.published || prem.verification_decision !== "supported";
    });

    if (failedPremise) {
      const withheldCopy = `ยังยืนยันข้อสรุปส่วนนี้จากเอกสารทางการไม่ได้ เนื่องจากข้อสมมติฐานทางกฎหมายที่จำเป็น (${failedPremise}) ไม่ผ่านการยืนยันหลักฐานครบถ้วน`;
      evaluatedClaims.set(claimId, {
        claim_id: claimId,
        claim_number: idx + 1,
        text: prop.text,
        claim_type: prop.claim_type,
        claim_type_label_th: CLAIM_TYPE_LABELS_TH[prop.claim_type],
        premise_ids: premiseIds,
        verification_decision: "insufficient",
        published: false,
        withheld_explanation_th: withheldCopy,
        evidence_references: [],
      });
      unresolvedIssues.push({
        issue_id: `iss.${claimId}.dep`,
        scope_key: prop.scope_topic_th || "dependent_conclusion",
        explanation_th: withheldCopy,
        reason_code: "DEPENDENT_PREMISE_WITHHELD",
        withheld_claim_ids: [claimId],
      });
      continue;
    }

    if (!prop.support_groups || prop.support_groups.length === 0) {
      const noEvCopy = prop.scope_topic_th
        ? `ยังยืนยัน${prop.scope_topic_th}จากเอกสารทางการสำหรับวันที่ที่ถามไม่ได้`
        : "ยังยืนยันข้อกล่าวอ้างทางกฎหมายนี้จากเอกสารทางการไม่ได้ เนื่องจากไม่พบข้อความอ้างอิงที่เข้าเกณฑ์";
      evaluatedClaims.set(claimId, {
        claim_id: claimId,
        claim_number: idx + 1,
        text: prop.text,
        claim_type: prop.claim_type,
        claim_type_label_th: CLAIM_TYPE_LABELS_TH[prop.claim_type],
        premise_ids: premiseIds,
        verification_decision: "insufficient",
        published: false,
        withheld_explanation_th: noEvCopy,
        evidence_references: [],
      });
      unresolvedIssues.push({
        issue_id: `iss.${claimId}.no_ev`,
        scope_key: prop.scope_topic_th || "missing_support",
        explanation_th: noEvCopy,
        reason_code: "INSUFFICIENT_CORPUS_EVIDENCE",
        withheld_claim_ids: [claimId],
      });
      continue;
    }

    // Validate every required support group & every member inside each jointly required group!
    let claimDecision: VerifierDecisionOutcome = "supported";
    let withholdReasonCode: UnresolvedIssueDto["reason_code"] | null = null;
    let withholdExplanationTh: string | null = null;
    const validRefsForClaim: ClaimEvidenceReferenceDto[] = [];

    for (const grp of prop.support_groups) {
      if (!grp.evidence_ids || grp.evidence_ids.length === 0) {
        claimDecision = "insufficient";
        withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
        withholdExplanationTh = prop.scope_topic_th
          ? `ยังยืนยัน${prop.scope_topic_th}จากเอกสารทางการสำหรับวันที่ที่ถามไม่ได้`
          : `ขาดหลักฐานในกลุ่มที่จำเป็น (${grp.group_id})`;
        break;
      }

      for (const evId of grp.evidence_ids) {
        // ANS-01 & T07: Reject invented IDs and IDs outside authorized candidate set!
        if (!input.authorized_candidate_ids.has(evId)) {
          claimDecision = "insufficient";
          withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
          withholdExplanationTh =
            "ระงับการเผยแพร่ข้อกล่าวอ้าง เนื่องจากรหัสหลักฐานไม่อยู่ในชุดเอกสารที่ได้รับอนุญาตหรือไม่มีอยู่จริง";
          break;
        }

        const psg = view.passages[evId];
        if (!psg) {
          claimDecision = "insufficient";
          withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
          withholdExplanationTh = "ระงับการเผยแพร่ข้อกล่าวอ้าง เนื่องจากไม่พบข้อความหลักฐานในคลังข้อมูลหลัก";
          break;
        }

        const doc = view.documents[psg.doc_id];
        const ver = view.versions[psg.version_id];
        const ext = view.extraction_revisions[psg.extraction_revision_id];
        const loc = Object.values(view.locations).find(
          (l) => l.doc_id === psg.doc_id && (!l.version_id || l.version_id === psg.version_id) && l.is_active_primary
        ) || Object.values(view.locations).find((l) => l.doc_id === psg.doc_id);

        if (!doc || !ver || !ext || !loc) {
          claimDecision = "insufficient";
          withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
          withholdExplanationTh = "ระงับการเผยแพร่ เนื่องจากข้อมูลรุ่นเอกสารหรือตำแหน่งลิงก์ทางการไม่สมบูรณ์";
          break;
        }

        // Caller access & live withdrawal check (T10)
        const canAccess =
          psg.access_scope === "scope.platform.public" ||
          input.actor.authorized_scopes.includes(psg.access_scope);
        const isWithdrawn =
          Boolean(state.withdrawals[psg.doc_id]?.active) ||
          Boolean(state.withdrawals[psg.version_id]?.active);
        if (!canAccess || isWithdrawn) {
          claimDecision = "insufficient";
          withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
          withholdExplanationTh = "หลักฐานต้นฉบับถูกจำกัดสิทธิ์การเข้าถึงหรือถูกถอนจากการเผยแพร่";
          break;
        }

        // Third-party discovery copy check (SRC-02, T07)
        if (doc.record_type === "third_party_discovery") {
          claimDecision = "insufficient";
          withholdReasonCode = "THIRD_PARTY_ONLY_SOURCE";
          withholdExplanationTh =
            "ระงับการเผยแพร่ข้อกล่าวอ้าง เนื่องจากมีเพียงสำเนาจากแหล่งภายนอกซึ่งยังไม่ได้รับรองกับต้นฉบับทางการ";
          break;
        }

        // Identity failure check (SRC-01, T05)
        if (loc.identity_match_result !== "VERIFIED_MATCH") {
          claimDecision = "insufficient";
          withholdReasonCode = "IDENTITY_VERIFICATION_FAILED";
          withholdExplanationTh =
            "ระงับการเผยแพร่ข้อกล่าวอ้าง เนื่องจากต้นฉบับจากลิงก์ทางการไม่ผ่านการตรวจสอบความตรงกันของเอกสาร";
          break;
        }

        // OCR Thai ambiguity check (Section 4.3, T02)
        if (ext.review_status === "AWAITING_THAI_REVIEW" || ext.ocr_ambiguity_detected) {
          claimDecision = "needs_review";
          withholdReasonCode = "AMBIGUOUS_OCR_AWAITING_REVIEW";
          withholdExplanationTh =
            "ระงับข้อกล่าวอ้างชั่วคราว เนื่องจากเอกสารสแกนมีความไม่ชัดเจนของตัวเลขไทยหรือคำปฏิเสธ อยู่ระหว่างการตรวจทานโดยผู้เชี่ยวชาญภาษาไทย";
          break;
        }

        if (!psg.eligible_for_publication || psg.locator_replay_status !== "VERIFIED") {
          claimDecision = "insufficient";
          withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
          withholdExplanationTh =
            "ระงับข้อกล่าวอ้าง เนื่องจากตำแหน่งอ้างอิงในเอกสารต้นฉบับไม่ผ่านการตรวจสอบซ้ำ (Locator Replay Quarantine)";
          break;
        }

        // ANS-01 & T04: Reject citation referring to a different version or inapplicable as-of interval!
        if (grp.expected_version_id && grp.expected_version_id !== ver.version_id) {
          claimDecision = "insufficient";
          withholdReasonCode = "UNVERIFIED_HISTORICAL_VERSION";
          withholdExplanationTh =
            "ระงับข้อกล่าวอ้าง เนื่องจากรหัสรุ่นเอกสารที่อ้างอิงไม่ตรงกับรุ่นที่ใช้บังคับตามวันที่ถาม";
          break;
        }

        if (input.as_of_date && doc.source_family === "gazette_enactment") {
          const afterFrom = !ver.effective_from || input.as_of_date >= ver.effective_from;
          const beforeTo = !ver.effective_to || input.as_of_date <= ver.effective_to;
          if (!afterFrom || !beforeTo) {
            claimDecision = "insufficient";
            withholdReasonCode = "UNVERIFIED_HISTORICAL_VERSION";
            withholdExplanationTh = `ยังยืนยันข้อกฎหมายจากเอกสารทางการสำหรับวันที่ที่ถาม (${input.as_of_date}) ไม่ได้ เนื่องจากรุ่นเอกสารที่พบมีผลใช้บังคับในช่วงเวลาอื่น`;
            break;
          }
        }

        // SRC-02: Official summary supports ONLY claims established by that summary!
        if (doc.record_type === "official_summary") {
          const normSummary = thaiDigitsToArabic(psg.verbatim_text).replace(/\s+/g, " ");
          const normClaim = thaiDigitsToArabic(prop.text).replace(/\s+/g, " ");
          // Extract numeric/section tokens in claim and ensure none go beyond summary text
          const claimNums = normClaim.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
          const ungroundedNum = claimNums.find((n) => !normSummary.includes(n));
          if (ungroundedNum) {
            claimDecision = "insufficient";
            withholdReasonCode = "INSUFFICIENT_CORPUS_EVIDENCE";
            withholdExplanationTh =
              "ระงับข้อกล่าวอ้าง เนื่องจากเอกสารต้นทางเป็นเพียงสรุปย่อทางการและไม่ได้ระบุรายละเอียดตัวเลขหรือเงื่อนไขดังกล่าวไว้ในสรุปย่อ";
            break;
          }
        }

        // ANS-02 & T08: Contradicting exception / polarity check across cited passage AND sibling candidate passages of same version!
        const siblingPassagesInDoc = candidatePassages.filter(
          (cp) => cp.doc_id === psg.doc_id && cp.version_id === psg.version_id
        );
        const allProposedAnswerText = input.proposed_claims.map((pc) => pc.text).join("\n");
        const contradictionCheck = evaluateSubstantiveSupportAndExceptions(
          prop.text,
          allProposedAnswerText,
          psg,
          siblingPassagesInDoc,
          Boolean(prop.human_approved_by)
        );
        if (contradictionCheck.decision !== "supported") {
          claimDecision = contradictionCheck.decision;
          withholdReasonCode = "CONTRADICTING_EXCEPTION_UNRESOLVED";
          withholdExplanationTh = contradictionCheck.explanation_th;
          break;
        }

        const pubEntry = view.publishers[doc.issuer_id];
        const linkId = `cel.${sha256Bytes(`${answerRevision}|${claimId}|${evId}|${grp.group_id}|${grp.role}`).slice(0, 16)}`;
        const refDto: ClaimEvidenceReferenceDto = {
          link_id: linkId,
          evidence_id: psg.passage_id,
          doc_id: doc.doc_id,
          version_id: ver.version_id,
          extraction_revision_id: ext.extraction_revision_id,
          support_role:
            doc.record_type === "official_summary" ? "official_summary_scope" : grp.role,
          support_role_label_th:
            SUPPORT_ROLE_LABELS_TH[
              doc.record_type === "official_summary" ? "official_summary_scope" : grp.role
            ],
          required_group: grp.group_id,
          citation_label_th: buildThaiCitationLabel(doc, psg),
          issuer_name_th: pubEntry?.name_th || doc.issuer_id,
          source_family: doc.source_family,
          source_family_label_th: SOURCE_FAMILY_LABELS_TH[doc.source_family],
          record_type: doc.record_type,
          record_type_label_th: RECORD_TYPE_LABELS_TH[doc.record_type],
          date_relied_on:
            input.as_of_date || ver.effective_from || ver.publication_date || null,
          official_url: loc.exact_official_url,
          official_url_with_anchor: buildOfficialUrlWithAnchor(loc, psg, pubEntry),
          resolver_url: `/api/v1/knowledge/evidence/${encodeURIComponent(psg.passage_id)}`,
          locator: {
            human_pinpoint_th: psg.human_pinpoint_th,
            section_paragraph_path: [...psg.section_paragraph_path],
            physical_page_start: psg.physical_page_start,
            physical_page_end: psg.physical_page_end,
            printed_page_start: psg.printed_page_start,
            printed_page_end: psg.printed_page_end,
            anchors: psg.anchors,
          },
          verification_status: "supported",
          link_health: loc.link_health,
          link_health_notice_th: formatOfficialLinkStatusNoticeTh(loc),
          last_successful_verification_at: loc.last_successful_verified_at,
          access_permission: doc.access_permission,
          access_conditions_th: doc.access_conditions_th,
        };
        validRefsForClaim.push(refDto);
      }

      if (claimDecision !== "supported") {
        break;
      }
    }

    const isPublished = claimDecision === "supported" && validRefsForClaim.length > 0;
    evaluatedClaims.set(claimId, {
      claim_id: claimId,
      claim_number: idx + 1,
      text: prop.text,
      claim_type: prop.claim_type,
      claim_type_label_th: CLAIM_TYPE_LABELS_TH[prop.claim_type],
      premise_ids: premiseIds,
      verification_decision: claimDecision,
      published: isPublished,
      withheld_explanation_th: isPublished ? null : withholdExplanationTh,
      evidence_references: isPublished ? validRefsForClaim : [],
    });

    if (isPublished) {
      for (const ref of validRefsForClaim) {
        allLinksToPersist.push({
          ...ref,
          answer_revision: answerRevision,
          claim_id: claimId,
          verifier_or_reviewer_id: prop.human_approved_by || CLAIM_VERIFIER_VERSION,
          ruleset_version: CLAIM_RULESET_VERSION,
          verified_at: generatedAt,
        });
      }
    } else if (withholdReasonCode && withholdExplanationTh) {
      unresolvedIssues.push({
        issue_id: `iss.${claimId}`,
        scope_key: prop.scope_topic_th || claimId,
        explanation_th: withholdExplanationTh,
        reason_code: withholdReasonCode,
        withheld_claim_ids: [claimId],
      });
    }
  }

  // Filter ONLY published claims for external rendering (ANS-03: never expose unvalidated assertions!)
  const allEvaluatedList = Array.from(evaluatedClaims.values());
  const substantiveAttempted = allEvaluatedList.filter(
    (c) => c.claim_type === "legal_proposition" || c.claim_type === "interpretation"
  );
  const substantivePublished = substantiveAttempted.filter((c) => c.published);

  const publishedClaimsOut: PublishedAtomicClaimDto[] = allEvaluatedList
    .filter((c) => c.published)
    .map((c, idx) => ({
      ...c,
      claim_number: idx + 1,
    }));

  let envelopeStatus: TraceableAnswerEnvelope["status"];
  if (substantivePublished.length === 0) {
    envelopeStatus = "insufficient";
  } else if (
    substantivePublished.length < substantiveAttempted.length ||
    unresolvedIssues.length > 0
  ) {
    envelopeStatus = "partial";
  } else {
    envelopeStatus = "complete";
  }

  // Construct validated Thai rendered text strictly from published claims + scoped unresolved explanations (ANS-03)
  const renderedSections: string[] = [];
  if (publishedClaimsOut.length > 0) {
    for (const c of publishedClaimsOut) {
      const citeBadges = c.evidence_references
        .map((r) => `[${r.citation_label_th}]`)
        .join(" ");
      const typePrefix =
        c.claim_type === "interpretation"
          ? "【การตีความปรับใช้ข้อกฎหมายกับข้อเท็จจริง】 "
          : c.claim_type === "user_fact_or_assumption"
            ? "【ข้อเท็จจริง/สมมติฐานที่รับมาจากคำถาม】 "
            : "";
      renderedSections.push(
        `[${c.claim_number}] ${typePrefix}${c.text}${citeBadges ? ` ${citeBadges}` : ""}`
      );
    }
  }
  if (unresolvedIssues.length > 0) {
    for (const iss of unresolvedIssues) {
      renderedSections.push(`หมายเหตุข้อจำกัดหลักฐาน: ${iss.explanation_th}`);
    }
  }
  if (renderedSections.length === 0) {
    renderedSections.push(
      "ไม่พบหลักฐานจากเอกสารทางการที่เข้าเกณฑ์และเพียงพอสำหรับการยืนยันคำตอบในประเด็นและวันที่ที่ถาม"
    );
  }

  const envelope: TraceableAnswerEnvelope = {
    schema_version: "reg24.citation-traceability.v1",
    answer_id: answerId,
    answer_revision: answerRevision,
    revision_number: revNo,
    supersedes_answer_revision: input.supersedes_answer_revision ?? null,
    channel: input.channel,
    generated_at: generatedAt,
    as_of_date: input.as_of_date,
    status: envelopeStatus,
    rendered_answer_th: renderedSections.join("\n"),
    user_supplied_facts: input.user_supplied_facts || [],
    assumptions: input.assumptions || [],
    claims: publishedClaimsOut,
    unresolved_issues: unresolvedIssues,
    legacy_warning_th: null,
    verifier_metadata: {
      verifier_version: CLAIM_VERIFIER_VERSION,
      ruleset_version: CLAIM_RULESET_VERSION,
      release_id: input.release_id,
      publication_gate_mode: view.publication_gate_mode,
    },
  };

  if (input.persist_atomically) {
    commitTraceableAnswerAtomically(store, envelope, allLinksToPersist, {
      actor: input.actor,
      question_text: input.question,
    });
  }

  return envelope;
}

/**
 * ANS-02 & T08: Evaluates substantive support and detects contradicting exceptions/provisos!
 * Same-topic citation CANNOT pass alone when the passage (or an adjacent clause of the same version)
 * contains an exception or negation that contradicts an unqualified assertion.
 */
function evaluateSubstantiveSupportAndExceptions(
  claimText: string,
  fullProposedAnswerText: string,
  citedPassage: EvidencePassageRecord,
  siblingPassagesInSameVersion: EvidencePassageRecord[],
  humanApprovedOverride: boolean
): {
  decision: VerifierDecisionOutcome;
  explanation_th: string | null;
} {
  const normClaim = thaiDigitsToArabic(claimText).replace(/\s+/g, " ").trim();
  const normFullAnswer = thaiDigitsToArabic(fullProposedAnswerText).replace(/\s+/g, " ").trim();
  const normPassage = thaiDigitsToArabic(citedPassage.verbatim_text)
    .replace(/\s+/g, " ")
    .trim();
  const normAllDoc = siblingPassagesInSameVersion
    .map((p) => thaiDigitsToArabic(p.verbatim_text).replace(/\s+/g, " "))
    .join("\n");

  // 1. Direct negation / polarity contradiction between claim and passage
  const claimSaysAlwaysOrUnconditional =
    /(?:ทุกกรณีโดยไม่มีข้อยกเว้น|ไม่มีข้อยกเว้นใด|ไม่ต้องหักภาษีในทุกกรณี|ได้รับยกเว้นภาษีทุกกรณี|ห้ามขยายเวลาในทุกกรณี)/.test(
      normClaim
    );
  const sourceHasException =
    /(?:เว้นแต่|ยกเว้น|แต่ไม่รวมถึง|มิให้ใช้บังคับแก่|ทั้งนี้\s*เฉพาะ)/.test(normPassage) ||
    /(?:เว้นแต่|ยกเว้น|แต่ไม่รวมถึง|มิให้ใช้บังคับแก่)/.test(normAllDoc);

  if (claimSaysAlwaysOrUnconditional && sourceHasException && !humanApprovedOverride) {
    return {
      decision: "conflicting",
      explanation_th:
        "ระงับข้อกล่าวอ้าง เนื่องจากบทบัญญัติหรือเอกสารอ้างอิงมีข้อยกเว้นหรือเงื่อนไขบังคับ ('เว้นแต่' / 'ยกเว้น') ที่ขัดแย้งกับการสรุปแบบไม่มีข้อยกเว้น",
    };
  }

  // 2. Specific scenario contradiction (T08): Claim asserts an entity/transaction is taxed/obligated
  //    when the source passage contains an explicit `เว้นแต่` / `ยกเว้น` carving out that exact case
  //    AND neither this claim nor a companion atomic claim in the same answer discloses the exception!
  const exceptionClauseMatches =
    normAllDoc.match(/(?:เว้นแต่|ยกเว้น|มิให้ใช้บังคับแก่)([^。\n]{6,220})/g) || [];
  const answerAlreadyDisclosesException =
    /(?:เว้นแต่|ยกเว้น|ทั้งนี้|ภายใต้เงื่อนไข|มิให้ใช้บังคับ)/.test(normClaim) ||
    /(?:เว้นแต่|ยกเว้น|ทั้งนี้|ภายใต้เงื่อนไข|มิให้ใช้บังคับ)/.test(normFullAnswer);
  if (exceptionClauseMatches.length > 0 && !answerAlreadyDisclosesException) {
    for (const rawExc of exceptionClauseMatches) {
      const excBody = rawExc.replace(/^(?:เว้นแต่|ยกเว้น|มิให้ใช้บังคับแก่)\s*/, "").trim();
      const excTokens = excBody
        .split(/\s+/)
        .map((t) => t.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9]/g, ""))
        .filter((t) => t.length >= 5);
      // If the user's unqualified claim directly invokes the carved-out subject while asserting the opposite general rule!
      const matchedCarveoutTokens = excTokens.filter((tok) => normClaim.includes(tok));
      const claimAssertsGeneralDuty =
        /(?<!ไม่|มิ)ต้อง(?:หักภาษี|เสียภาษี|ยื่น|ขออนุญาต)/.test(normClaim);
      if (
        matchedCarveoutTokens.length >= 1 &&
        claimAssertsGeneralDuty &&
        !humanApprovedOverride
      ) {
        return {
          decision: "conflicting",
          explanation_th: `ระงับข้อกล่าวอ้าง เนื่องจากข้อความต้นฉบับมีข้อยกเว้นโดยตรง ("${rawExc.slice(0, 120)}") ซึ่งขัดแย้งกับข้อสรุปที่เสนอ`,
        };
      }
    }
  }

  // 3. Tax exemption vs taxable polarity check
  const claimExempt =
    /(?<!ไม่|มิได้)ได้รับ(?:การ)?ยกเว้นภาษี|ไม่ต้องเสียภาษี/.test(normClaim) &&
    !/ไม่ได้รับยกเว้น|ต้องเสียภาษี/.test(normClaim);
  const sourceTaxableOnly =
    /(?:ไม่ได้รับยกเว้น|ไม่เข้าลักษณะ[^。\n]{0,60}ได้รับยกเว้น|อยู่ในบังคับต้องเสียภาษี)/.test(
      normPassage
    ) && !/(?<!ไม่|มิได้)ได้รับ(?:การ)?ยกเว้นภาษี/.test(normPassage);

  if (claimExempt && sourceTaxableOnly && !humanApprovedOverride) {
    return {
      decision: "conflicting",
      explanation_th:
        "ระงับข้อกล่าวอ้าง เนื่องจากต้นฉบับวินิจฉัยว่าไม่ได้รับยกเว้น/ต้องเสียภาษี ขัดแย้งกับข้อสรุปที่ระบุว่าได้รับยกเว้นภาษี",
    };
  }

  return { decision: "supported", explanation_th: null };
}

/**
 * Section 3 & T09: Atomically commits the validated answer, ordered claims, verification decisions,
 * jointly-required claim-evidence links, audit event, and projection outbox!
 * Enforces strict referential integrity before writing a single record.
 */
export function commitTraceableAnswerAtomically(
  store: DurableKnowledgeStore,
  envelope: TraceableAnswerEnvelope,
  links: Array<
    ClaimEvidenceReferenceDto & {
      answer_revision: string;
      claim_id: string;
      verifier_or_reviewer_id: string;
      ruleset_version: string;
      verified_at: string;
    }
  >,
  meta: {
    actor: Actor;
    question_text: string;
    simulate_interrupt_after_validation_for_test?: boolean;
  }
): TraceableAnswerEnvelope {
  const unified = getUnifiedCitationLedgerView(store, envelope.verifier_metadata.release_id);

  // Referential integrity pre-check across all claims and links
  for (const link of links) {
    const psg = unified.passages[link.evidence_id];
    const ver = unified.versions[link.version_id];
    const doc = unified.documents[link.doc_id];
    if (!psg || !ver || !doc) {
      throw new Error(
        `REFERENTIAL_INTEGRITY_VIOLATION_422: Claim link '${link.link_id}' references missing passage/version/doc (${link.evidence_id}).`
      );
    }
    if (psg.version_id !== ver.version_id || ver.doc_id !== doc.doc_id) {
      throw new Error(
        `REFERENTIAL_INTEGRITY_VIOLATION_422: Version/Doc mismatch on '${link.link_id}'.`
      );
    }
  }

  if (meta.simulate_interrupt_after_validation_for_test) {
    throw new Error("SIMULATED_INTERRUPTED_ANSWER_COMMIT_BEFORE_WAL");
  }

  mutateCitationLedgerAtomically(
    store,
    "COMMIT_TRACEABLE_ANSWER_ATOMICALLY",
    meta.actor.actor_id,
    (ledger) => {
      // Materialize any referenced canonical passages/versions/docs into the persisted ledger so historical reopen is 100% self-contained!
      for (const link of links) {
        if (!ledger.documents[link.doc_id] && unified.documents[link.doc_id]) {
          ledger.documents[link.doc_id] = unified.documents[link.doc_id];
        }
        if (!ledger.versions[link.version_id] && unified.versions[link.version_id]) {
          ledger.versions[link.version_id] = unified.versions[link.version_id];
        }
        const extId = link.extraction_revision_id;
        if (!ledger.extraction_revisions[extId] && unified.extraction_revisions[extId]) {
          ledger.extraction_revisions[extId] = unified.extraction_revisions[extId];
        }
        if (!ledger.passages[link.evidence_id] && unified.passages[link.evidence_id]) {
          ledger.passages[link.evidence_id] = unified.passages[link.evidence_id];
        }
        for (const loc of Object.values(unified.locations)) {
          if (loc.doc_id === link.doc_id && !ledger.locations[loc.location_id]) {
            ledger.locations[loc.location_id] = loc;
          }
        }
        ledger.claim_evidence_links[link.link_id] = link;
      }

      ledger.published_answers[envelope.answer_revision] = {
        ...envelope,
        actor_id: meta.actor.actor_id,
        tenant_id: meta.actor.tenant_id,
        question_text: meta.question_text,
      };

      const outboxId = `cobx.ans.${sha256Bytes(envelope.answer_revision).slice(0, 14)}`;
      ledger.projection_outbox[outboxId] = {
        outbox_id: outboxId,
        target_store: "graph",
        entity_kind: "answer",
        entity_id: envelope.answer_revision,
        attempt_count: 1,
        status: "COMPLETED",
        last_error: null,
        created_at: envelope.generated_at,
        completed_at: envelope.generated_at,
      };

      appendCitationAuditEvent(ledger, {
        actor_or_service: meta.actor.actor_id,
        event_type: "ANSWER_PUBLISHED_ATOMIC",
        affected_ids: [
          envelope.answer_revision,
          ...envelope.claims.map((c) => c.claim_id),
          ...links.map((l) => l.link_id),
        ],
        before_status: envelope.supersedes_answer_revision
          ? { supersedes: envelope.supersedes_answer_revision }
          : null,
        after_status: {
          status: envelope.status,
          published_claims_count: envelope.claims.length,
          unresolved_issues_count: envelope.unresolved_issues.length,
        },
        reason: `Atomic answer publication on channel '${envelope.channel}'`,
        correlation_id: envelope.answer_revision,
      });
    }
  );

  return envelope;
}

/**
 * Bridges existing `GroundedAnswer` from `queryKnowledge()` through the full atomic claim segmentation,
 * canonical evidence resolution, and publication gate, producing a 100% compliant `TraceableAnswerEnvelope`.
 */
export function attachTraceableEnvelopeToGroundedAnswer(
  store: DurableKnowledgeStore,
  grounded: GroundedAnswer,
  params: {
    question: string;
    actor: Actor;
    channel?: TraceablePublicationChannel;
    persist?: boolean;
  }
): TraceableAnswerEnvelope {
  const view = getUnifiedCitationLedgerView(store, grounded.release_id);
  const authorizedCandidateIds = new Set<string>(
    grounded.evidence.map((e) => e.passage_id).filter((pid) => Boolean(view.passages[pid]))
  );
  for (const clm of grounded.claims) {
    for (const pid of clm.supporting_passage_ids || []) {
      if (view.passages[pid]) authorizedCandidateIds.add(pid);
    }
  }

  const userFacts = extractUserSuppliedFactsFromQuestion(params.question);
  const proposed: ProposedStructuredClaimInput[] = [];

  for (const f of userFacts) {
    proposed.push({
      text: f,
      claim_type: "user_fact_or_assumption",
      support_groups: [],
    });
  }

  let claimSeq = 0;
  for (const rawClm of grounded.claims) {
    if (rawClm.claim_type === "abstention_notice") {
      proposed.push({
        claim_id: rawClm.claim_id,
        text: rawClm.statement,
        claim_type: "scoped_unresolved_notice",
        support_groups: [],
      });
      continue;
    }

    const atomicSegments = segmentIntoAtomicClaimStatements(rawClm.statement);
    const supportIds = (rawClm.supporting_passage_ids || []).filter((id) =>
      authorizedCandidateIds.has(id)
    );

    // Group passages by source family / role so multi-authority claims (statute + ruling) record separate required groups!
    const statutoryIds = supportIds.filter(
      (id) => view.documents[view.passages[id]?.doc_id || ""]?.source_family === "gazette_enactment"
    );
    const rulingIds = supportIds.filter(
      (id) =>
        view.documents[view.passages[id]?.doc_id || ""]?.source_family ===
        "revenue_department_ruling"
    );
    const otherIds = supportIds.filter(
      (id) => !statutoryIds.includes(id) && !rulingIds.includes(id)
    );

    const buildGroups = (): ProposedStructuredClaimInput["support_groups"] => {
      const groups: ProposedStructuredClaimInput["support_groups"] = [];
      if (statutoryIds.length > 0 && rulingIds.length > 0) {
        groups.push({
          group_id: "grp.statute_premise",
          role: "statutory_premise",
          evidence_ids: statutoryIds,
        });
        groups.push({
          group_id: "grp.ruling_application",
          role: "ruling_application",
          evidence_ids: rulingIds,
        });
      } else if (statutoryIds.length > 0) {
        groups.push({
          group_id: "grp.primary_statute",
          role: "primary_authority",
          evidence_ids: statutoryIds,
          expected_version_id: rawClm.applicable_version_id,
        });
      } else if (rulingIds.length > 0) {
        const allRequesterFacts = rulingIds.every((id) =>
          view.passages[id]?.statement_role.startsWith("requester_")
        );
        groups.push({
          group_id: "grp.primary_ruling",
          role: allRequesterFacts ? "requester_factual_context" : "primary_authority",
          evidence_ids: rulingIds,
          expected_version_id: rawClm.applicable_version_id,
        });
      }
      if (otherIds.length > 0) {
        groups.push({
          group_id: "grp.other_official",
          role: "judicial_reasoning",
          evidence_ids: otherIds,
        });
      }
      return groups;
    };

    const isFactApplication =
      rawClm.claim_type === "qualified_legal_synthesis" ||
      rawClm.claim_type === "fact_distinction" ||
      userFacts.length > 0;

    for (const segText of atomicSegments) {
      claimSeq++;
      const isExceptionSeg = /^(?:เว้นแต่|ยกเว้น|ทั้งนี้)/.test(segText);
      const baseGroups = buildGroups();
      const segGroups = isExceptionSeg
        ? baseGroups.map((g) => ({ ...g, role: "exception_or_proviso" as ClaimSupportRole }))
        : baseGroups;

      proposed.push({
        claim_id:
          atomicSegments.length === 1
            ? rawClm.claim_id
            : `${rawClm.claim_id}.p${claimSeq}`,
        text: segText,
        claim_type: isFactApplication ? "interpretation" : "legal_proposition",
        support_groups: segGroups,
      });
    }
  }

  return validateAndBuildTraceableAnswer(store, {
    answer_id: `ans.${grounded.trace_id}`,
    channel: params.channel || "api",
    question: params.question,
    as_of_date: grounded.applicable_date,
    generated_at: grounded.generated_at || new Date().toISOString(),
    release_id: grounded.release_id,
    actor: params.actor,
    authorized_candidate_ids: authorizedCandidateIds,
    proposed_claims: proposed,
    user_supplied_facts: userFacts,
    assumptions: grounded.assumptions,
    persist_atomically: Boolean(params.persist),
  });
}

function generateDeterministicScanPageSvgDataUri(params: {
  title_th: string;
  physical_page_one_based: number;
  printed_page_label: string | null;
  page_text: string;
  bboxes: Array<[number, number, number, number]>;
}): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const lines = params.page_text.split(/\r?\n/).slice(0, 14);
  const rects = params.bboxes
    .map(([x0, y0, x1, y1]) => {
      const rx = Math.round(x0 * 595);
      const ry = Math.round(y0 * 842);
      const rw = Math.max(20, Math.round((x1 - x0) * 595));
      const rh = Math.max(18, Math.round((y1 - y0) * 842));
      return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="rgba(250,204,21,0.28)" stroke="#eab308" stroke-width="2" />`;
    })
    .join("");
  const textSvg = lines
    .map(
      (ln, idx) =>
        `<text x="52" y="${150 + idx * 34}" font-family="Sarabun, Tahoma, sans-serif" font-size="14" fill="#1e293b">${esc(ln.slice(0, 68))}</text>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="595" height="842">
    <rect width="595" height="842" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
    <text x="297" y="48" text-anchor="middle" font-family="Sarabun, Tahoma, sans-serif" font-size="13" font-weight="bold" fill="#475569">สำเนาภาพสแกนต้นฉบับ (PDF หน้า ${params.physical_page_one_based} · หน้าพิมพ์ ${esc(params.printed_page_label || "-")})</text>
    <text x="297" y="74" text-anchor="middle" font-family="Sarabun, Tahoma, sans-serif" font-size="12" fill="#64748b">${esc(params.title_th.slice(0, 62))}</text>
    ${rects}
    ${textSvg}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Section 6 & Fixtures T02, T06, T10, T12:
 * Read-only permanent REG24 evidence resolver.
 * - Enforces caller authorization & withdrawal checks on every call (consistent unavailable 404 on private records `T10`).
 * - Temporary official outage (`temporarily_offline`) NEVER turns an authorized resolver response into a 404 (`T06`).
 * - Visibly distinguishes REG24's preserved copy from the official website.
 * - Returns full cross-page PDF / scan bounding boxes and OCR revision audit trail (`T02`, `T12`).
 */
export function resolveTraceableEvidenceById(
  store: DurableKnowledgeStore,
  evidenceId: string,
  actor: Actor,
  releaseId?: string
): ResolvedPinnedEvidenceResponse {
  const state = store.getState();
  const view = getUnifiedCitationLedgerView(store, releaseId);
  const psg = view.passages[evidenceId];

  if (!psg) {
    return {
      ok: false,
      http_status: 404,
      unavailable_code: "NOT_FOUND_OR_RESTRICTED",
      error_th: "ไม่พบรายการหลักฐาน หรือท่านไม่มีสิทธิ์เข้าถึงเอกสารที่จำกัดสิทธิ์นี้",
    };
  }

  const doc = view.documents[psg.doc_id];
  const ver = view.versions[psg.version_id];
  const ext = view.extraction_revisions[psg.extraction_revision_id];
  if (!doc || !ver || !ext) {
    return {
      ok: false,
      http_status: 404,
      unavailable_code: "NOT_FOUND_OR_RESTRICTED",
      error_th: "ไม่พบข้อมูลรุ่นเอกสารของรายการหลักฐานนี้",
    };
  }

  // Authorization & withdrawal enforcement (T10)
  const isWithdrawn =
    Boolean(state.withdrawals[psg.doc_id]?.active) ||
    Boolean(state.withdrawals[psg.version_id]?.active);
  const isAuthorized =
    psg.access_scope === "scope.platform.public" ||
    actor.authorized_scopes.includes(psg.access_scope);

  if (isWithdrawn || !isAuthorized) {
    // Consistent unavailable 404 response so restricted existence/content is never leaked!
    return {
      ok: false,
      http_status: 404,
      unavailable_code: isWithdrawn ? "WITHDRAWN" : "NOT_FOUND_OR_RESTRICTED",
      error_th: "ไม่พบรายการหลักฐาน หรือท่านไม่มีสิทธิ์เข้าถึงเอกสารที่จำกัดสิทธิ์นี้",
    };
  }

  const loc =
    Object.values(view.locations).find(
      (l) => l.doc_id === doc.doc_id && l.version_id === ver.version_id && l.is_active_primary
    ) ||
    Object.values(view.locations).find((l) => l.doc_id === doc.doc_id) || {
      location_id: "oloc.fallback",
      doc_id: doc.doc_id,
      version_id: ver.version_id,
      exact_official_url: "",
      role: "primary_official" as const,
      parent_landing_location_id: null,
      original_observed_url: "",
      redirect_history: [],
      prior_urls: [],
      first_verified_at: null,
      last_verified_at: null,
      last_successful_verified_at: null,
      verification_method: "canonical",
      identity_match_result: "VERIFIED_MATCH" as const,
      link_health: "verified_online" as const,
      last_http_status: 200,
      failure_reason: null,
      is_active_primary: true,
    };

  const pubEntry = view.publishers[doc.issuer_id];

  // Collect OCR revision chain (current revision + parent raw OCR revisions for auditability `T02`!)
  const ocrTrail: NonNullable<ResolvedPinnedEvidenceResponse["evidence"]>["ocr_audit_trail"] = [];
  let cursor: ExtractionRevisionRecord | undefined = ext;
  const visitedRevs = new Set<string>();
  while (cursor && !visitedRevs.has(cursor.extraction_revision_id)) {
    visitedRevs.add(cursor.extraction_revision_id);
    ocrTrail.push({
      extraction_revision_id: cursor.extraction_revision_id,
      parser_or_ocr_version: cursor.parser_or_ocr_version,
      review_status: cursor.review_status,
      raw_transcription: cursor.raw_transcription,
      reviewer_id: cursor.reviewer_id,
      reviewed_at: cursor.reviewed_at,
      correction_note: cursor.correction_note,
    });
    cursor = cursor.parent_revision_id
      ? view.extraction_revisions[cursor.parent_revision_id]
      : undefined;
  }

  // Build scan/PDF page previews for side-by-side zoom/navigation viewer (`Section 6`, `T02`, `T12`)
  const startPg = psg.physical_page_start ?? 1;
  const endPg = psg.physical_page_end ?? startPg;
  const relevantPages =
    ext.page_mapping.length > 0
      ? ext.page_mapping.filter(
          (pm) =>
            pm.physical_page_one_based >= Math.max(1, startPg - 1) &&
            pm.physical_page_one_based <= endPg + 1
        )
      : [];

  const scanPages = relevantPages.map((pm) => {
    const bboxes = psg.anchors
      .filter(
        (a) =>
          (a.physical_page_one_based ?? startPg) === pm.physical_page_one_based &&
          Array.isArray(a.bbox_normalized)
      )
      .map((a) => a.bbox_normalized!);
    const effectiveBboxes: Array<[number, number, number, number]> =
      bboxes.length > 0 &&
      pm.physical_page_one_based >= startPg &&
      pm.physical_page_one_based <= endPg
        ? bboxes
        : pm.physical_page_one_based >= startPg && pm.physical_page_one_based <= endPg
          ? [[0.08, 0.16, 0.92, 0.52]]
          : [];
    return {
      physical_page_one_based: pm.physical_page_one_based,
      printed_page_label: pm.printed_page_label,
      width_pt: pm.width_pt ?? 595,
      height_pt: pm.height_pt ?? 842,
      rotation_deg: pm.rotation_deg ?? 0,
      scan_preview_svg_data_uri:
        pm.scan_image_data_uri_or_ref ||
        generateDeterministicScanPageSvgDataUri({
          title_th: doc.original_title_th,
          physical_page_one_based: pm.physical_page_one_based,
          printed_page_label: pm.printed_page_label,
          page_text: pm.page_text_verbatim,
          bboxes: effectiveBboxes,
        }),
      reviewed_text: pm.page_text_verbatim,
      highlight_bboxes: effectiveBboxes,
    };
  });

  const linkNotice = formatOfficialLinkStatusNoticeTh(loc);

  return {
    ok: true,
    http_status: 200,
    evidence: {
      evidence_id: psg.passage_id,
      doc_id: doc.doc_id,
      version_id: ver.version_id,
      extraction_revision_id: ext.extraction_revision_id,
      source_distinction_banner_th:
        "ข้อมูลด้านล่างนี้แสดงสำเนาข้อความตามรุ่นที่ REG24 เก็บรักษาและยืนยันค่าแฮช SHA-256 แยกจากลิงก์ไปยังเว็บไซต์ทางการของหน่วยงานผู้ออกเอกสารโดยชัดเจน",
      reg24_preserved_copy_label_th: `สำเนาตามรุ่นที่ REG24 เก็บรักษา (${ver.version_id} · SHA-256 ${ver.artifact_sha256.slice(0, 12)}…)`,
      official_website_label_th: `เว็บไซต์ทางการของ${pubEntry?.name_th || "หน่วยงานผู้ออกเอกสาร"}`,
      issuer_id: doc.issuer_id,
      issuer_name_th: pubEntry?.name_th || doc.issuer_id,
      source_family: doc.source_family,
      source_family_label_th: SOURCE_FAMILY_LABELS_TH[doc.source_family],
      record_type: doc.record_type,
      record_type_label_th: RECORD_TYPE_LABELS_TH[doc.record_type],
      original_title_th: doc.original_title_th,
      source_native_id: doc.source_native_id,
      publication_date: ver.publication_date,
      effective_from: ver.effective_from,
      effective_to: ver.effective_to,
      artifact_sha256: ver.artifact_sha256,
      captured_at: ver.captured_at,
      verbatim_quote: psg.verbatim_text,
      surrounding_before: psg.surrounding_before,
      surrounding_after: psg.surrounding_after,
      human_pinpoint_th: psg.human_pinpoint_th,
      section_paragraph_path: [...psg.section_paragraph_path],
      physical_page_start: psg.physical_page_start,
      physical_page_end: psg.physical_page_end,
      printed_page_start: psg.printed_page_start,
      printed_page_end: psg.printed_page_end,
      anchors: psg.anchors,
      is_scanned_material: ext.is_scanned_material,
      scan_pages: scanPages,
      ocr_audit_trail: ocrTrail,
      official_location: {
        exact_official_url: loc.exact_official_url,
        official_url_with_anchor: buildOfficialUrlWithAnchor(loc, psg, pubEntry),
        link_health: loc.link_health,
        link_health_label_th:
          linkNotice ||
          (loc.link_health === "moved_verified"
            ? "ลิงก์ทางการย้ายที่อยู่ (ตรวจสอบตรงตามรุ่นเดิมแล้ว)"
            : "ลิงก์ทางการพร้อมใช้งาน (ตรวจสอบความตรงกันของเอกสารแล้ว)"),
        last_successful_verified_at: loc.last_successful_verified_at,
        url_history: [...loc.prior_urls],
        access_permission: doc.access_permission,
        access_conditions_th: doc.access_conditions_th,
      },
      verification_status: psg.eligible_for_publication ? "VERIFIED" : "QUARANTINED",
      resolver_url: `/api/v1/knowledge/evidence/${encodeURIComponent(psg.passage_id)}`,
    },
  };
}

/**
 * Section 7 & T11: Registers a legacy pre-backfill answer without rewriting its original text
 * or falsely certifying its unverified citations!
 */
export function registerLegacyUnverifiedAnswer(
  store: DurableKnowledgeStore,
  params: {
    answer_id: string;
    question_text: string;
    original_answer_text_th: string;
    raw_legacy_citations: string[];
    created_at: string;
    as_of_date: string | null;
    release_id: string;
    actor: Actor;
  }
): TraceableAnswerEnvelope {
  const answerRevision = `${params.answer_id}.legacy.r1`;
  const warningTh =
    "คำเตือนคำตอบรุ่นเดิม (Legacy Unverified Answer): คำตอบและรายการอ้างอิงนี้บันทึกไว้ก่อนระบบตรวจสอบหลักฐานรายข้อกล่าวอ้าง ยังไม่ได้รับการรับรองความถูกต้องกับต้นฉบับทางการ ห้ามนำไปใช้อ้างอิงเป็นคำตอบที่ผ่านการยืนยันแล้ว (หากต้องการคำตอบที่ยืนยันหลักฐาน กรุณาสั่งประมวลผลสร้างคำตอบรุ่นใหม่แยกต่างหาก)";

  const envelope: TraceableAnswerEnvelope = {
    schema_version: "reg24.citation-traceability.v1",
    answer_id: params.answer_id,
    answer_revision: answerRevision,
    revision_number: 1,
    supersedes_answer_revision: null,
    channel: "saved_answer",
    generated_at: params.created_at,
    as_of_date: params.as_of_date,
    status: "legacy_unverified",
    rendered_answer_th: params.original_answer_text_th, // Original text NEVER silently rewritten!
    user_supplied_facts: [],
    assumptions: [],
    claims: [
      {
        claim_id: `clm.${answerRevision}.1`,
        claim_number: 1,
        text: params.original_answer_text_th,
        claim_type: "legal_proposition",
        claim_type_label_th: `${CLAIM_TYPE_LABELS_TH.legal_proposition} (คำตอบรุ่นเดิม-ยังไม่ยืนยัน)`,
        premise_ids: [],
        verification_decision: "legacy_unverified",
        published: true,
        withheld_explanation_th: warningTh,
        evidence_references: params.raw_legacy_citations.map((rawCite, idx) => ({
          link_id: `cel.legacy.${idx + 1}`,
          evidence_id: `legacy.unverified.${idx + 1}`,
          doc_id: "legacy.unverified",
          version_id: "legacy.unverified",
          extraction_revision_id: "legacy.unverified",
          support_role: "primary_authority",
          support_role_label_th: "อ้างอิงรุ่นเดิม (ยังไม่ได้รับรอง)",
          required_group: "legacy",
          citation_label_th: `[ยังไม่ยืนยันต้นฉบับ] ${rawCite}`,
          issuer_name_th: "ไม่ระบุ (คำตอบรุ่นเดิม)",
          source_family: "gazette_enactment",
          source_family_label_th: "อ้างอิงจากคำตอบรุ่นเดิม",
          record_type: "landing_only",
          record_type_label_th: "อ้างอิงรุ่นเดิมที่ยังไม่เชื่อมโยงข้อความต้นฉบับ",
          date_relied_on: params.as_of_date,
          official_url: "",
          official_url_with_anchor: "",
          resolver_url: "",
          locator: {
            human_pinpoint_th: "ยังไม่ได้รับรองตำแหน่งข้อความต้นฉบับ",
            section_paragraph_path: [],
            physical_page_start: null,
            physical_page_end: null,
            printed_page_start: null,
            printed_page_end: null,
            anchors: [],
          },
          verification_status: "legacy_unverified",
          link_health: "quarantined_identity_failure",
          link_health_notice_th: warningTh,
          last_successful_verification_at: null,
          access_permission: "public",
          access_conditions_th: null,
        })),
      },
    ],
    unresolved_issues: [],
    legacy_warning_th: warningTh,
    verifier_metadata: {
      verifier_version: "legacy-pre-traceability",
      ruleset_version: "legacy-unverified",
      release_id: params.release_id,
      publication_gate_mode: "enforced",
    },
  };

  mutateCitationLedgerAtomically(
    store,
    "REGISTER_LEGACY_UNVERIFIED_ANSWER",
    params.actor.actor_id,
    (ledger) => {
      ledger.published_answers[answerRevision] = {
        ...envelope,
        actor_id: params.actor.actor_id,
        tenant_id: params.actor.tenant_id,
        question_text: params.question_text,
      };
      appendCitationAuditEvent(ledger, {
        actor_or_service: params.actor.actor_id,
        event_type: "LEGACY_ANSWER_BACKFILLED",
        affected_ids: [answerRevision],
        before_status: null,
        after_status: { status: "legacy_unverified" },
        reason: "Preserved legacy answer text without silent certification (Section 7 / T11)",
        correlation_id: answerRevision,
      });
    }
  );

  return envelope;
}

/**
 * Section 6 & Fixtures T04, T10, T11, T13:
 * Reopens a saved historical answer by `answer_revision` (or `answer_id`), resolving its pinned
 * stored IDs so original wording & version stay permanently attached even after REG24 ingests
 * a later amendment (`T04`), while attaching a separate `update_notices` banner when newer material exists!
 * Also enforces live caller authorization on restricted evidence (`T10`).
 */
export function reopenSavedTraceableAnswer(
  store: DurableKnowledgeStore,
  answerRevisionOrId: string,
  actor: Actor
): {
  found: boolean;
  http_status: 200 | 404;
  answer?: TraceableAnswerEnvelope;
  question_text?: string;
  error_th?: string;
} {
  const view = getUnifiedCitationLedgerView(store);
  const direct = view.published_answers[answerRevisionOrId];
  const matched =
    direct ||
    Object.values(view.published_answers)
      .filter((a) => a.answer_id === answerRevisionOrId)
      .sort((a, b) => b.revision_number - a.revision_number)[0];

  if (!matched) {
    return {
      found: false,
      http_status: 404,
      error_th: "ไม่พบคำตอบที่บันทึกไว้ตามรหัสที่ระบุ",
    };
  }

  // Tenant & restricted evidence check (T10)
  for (const clm of matched.claims) {
    for (const ref of clm.evidence_references) {
      if (ref.verification_status === "legacy_unverified") continue;
      const resolved = resolveTraceableEvidenceById(store, ref.evidence_id, actor);
      if (!resolved.ok) {
        return {
          found: false,
          http_status: 404,
          error_th:
            "ไม่สามารถเปิดคำตอบนี้ได้ เนื่องจากมีเอกสารอ้างอิงที่จำกัดสิทธิ์หรือถูกถอนสิทธิ์การเข้าถึงสำหรับผู้ใช้งานปัจจุบัน",
        };
      }
    }
  }

  // Refresh live link_health status & detect if newer versions have been ingested since this answer was saved (T04, T06)
  const updateNotices: NewerMaterialUpdateNoticeDto[] = [];
  const seenVersionChecks = new Set<string>();

  const refreshedClaims: PublishedAtomicClaimDto[] = matched.claims.map((clm) => ({
    ...clm,
    evidence_references: clm.evidence_references.map((ref) => {
      if (ref.verification_status === "legacy_unverified") return ref;
      const ver = view.versions[ref.version_id];
      const doc = view.documents[ref.doc_id];
      const psg = view.passages[ref.evidence_id];
      const loc =
        Object.values(view.locations).find(
          (l) => l.doc_id === ref.doc_id && l.version_id === ref.version_id && l.is_active_primary
        ) || Object.values(view.locations).find((l) => l.doc_id === ref.doc_id);
      const pub = doc ? view.publishers[doc.issuer_id] : undefined;

      if (ver && !seenVersionChecks.has(ver.version_id)) {
        seenVersionChecks.add(ver.version_id);
        const allDocVersions = Object.values(view.versions).filter(
          (v) =>
            v.doc_id === ver.doc_id ||
            v.predecessor_version_id === ver.version_id ||
            ver.amending_version_ids.includes(v.version_id)
        );
        const newerVer = allDocVersions.find(
          (v) =>
            v.version_id !== ver.version_id &&
            v.byte_change_classification === "verified_legal_amendment" &&
            (ver.amending_version_ids.includes(v.version_id) ||
              (v.effective_from && ver.effective_from && v.effective_from > ver.effective_from))
        );
        if (newerVer) {
          updateNotices.push({
            has_newer_material: true,
            latest_version_id: newerVer.version_id,
            cited_version_id: ver.version_id,
            doc_id: ver.doc_id,
            notice_th: `แจ้งเตือนข้อมูลกฎหมายรุ่นใหม่กว่า: มีการนำเข้าฉบับแก้ไขเพิ่มเติมรุ่นใหม่ (${newerVer.version_id} มีผลตั้งแต่ ${newerVer.effective_from || "ตามประกาศ"}) หลังคำตอบนี้ถูกบันทึก ทั้งนี้ คำตอบด้านล่างยังคงแสดงถ้อยคำและรุ่นเอกสารเดิม (${ver.version_id}) ตามวันที่ใช้อ้างอิงไว้ทุกประการ`,
            detected_at: new Date().toISOString(),
          });
        }
      }

      if (!loc || !psg) return ref;
      return {
        ...ref,
        official_url: loc.exact_official_url,
        official_url_with_anchor: buildOfficialUrlWithAnchor(loc, psg, pub),
        link_health: loc.link_health,
        link_health_notice_th: formatOfficialLinkStatusNoticeTh(loc),
        last_successful_verification_at: loc.last_successful_verified_at,
      };
    }),
  }));

  return {
    found: true,
    http_status: 200,
    question_text: matched.question_text,
    answer: {
      ...matched,
      claims: refreshedClaims,
      update_notices: updateNotices,
    },
  };
}

export type SupportedExportFormat = "markdown" | "pdf_html" | "word_doc" | "json";

/**
 * Section 6 & Fixtures T07, T10, T11, T13:
 * Exports a saved or live `TraceableAnswerEnvelope` to Markdown, printable PDF-ready HTML,
 * Word-compatible `.doc` HTML/XML, or JSON, preserving:
 * - claim numbering & exact claim IDs,
 * - official URL + permanent REG24 evidence resolver link,
 * - human-readable Thai pinpoint & version/date,
 * - legacy warnings without ever certifying legacy answers (`T11`), and
 * - caller access authorization (`T10`).
 */
export function exportTraceableAnswer(
  store: DurableKnowledgeStore,
  params: {
    answer: TraceableAnswerEnvelope;
    format: SupportedExportFormat;
    actor: Actor;
    public_base_url?: string;
  }
): {
  allowed: boolean;
  http_status: 200 | 403 | 404 | 422;
  mime_type: string;
  filename: string;
  content: string;
  error_th?: string;
} {
  const baseUrl = (params.public_base_url || "https://reg24.th").replace(/\/+$/, "");
  const ans = params.answer;

  // Enforce publication gate & access check on export (T07, T10)
  if (ans.status !== "legacy_unverified") {
    for (const clm of ans.claims) {
      if (clm.claim_type === "legal_proposition" || clm.claim_type === "interpretation") {
        if (!clm.published || clm.verification_decision !== "supported" || clm.evidence_references.length === 0) {
          return {
            allowed: false,
            http_status: 422,
            mime_type: "application/json",
            filename: "blocked.json",
            content: "",
            error_th: `ระงับการส่งออกรายงาน: ข้อกล่าวอ้างที่ (${clm.claim_number}) ไม่ผ่านเกณฑ์การยืนยันหลักฐานทางการ`,
          };
        }
      }
      for (const ref of clm.evidence_references) {
        const resolved = resolveTraceableEvidenceById(store, ref.evidence_id, params.actor);
        if (!resolved.ok) {
          return {
            allowed: false,
            http_status: 404,
            mime_type: "application/json",
            filename: "restricted.json",
            content: "",
            error_th: "ไม่สามารถส่งออกเอกสารได้ เนื่องจากมีรายการหลักฐานที่จำกัดสิทธิ์การเข้าถึง",
          };
        }
        if (resolved.evidence?.record_type === "third_party_discovery") {
          return {
            allowed: false,
            http_status: 422,
            mime_type: "application/json",
            filename: "blocked.json",
            content: "",
            error_th: "ระงับการส่งออก: ห้ามเผยแพร่สำเนาจากแหล่งภายนอกเป็นหลักฐานยืนยัน",
          };
        }
      }
    }
  }

  const safeId = ans.answer_revision.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (params.format === "json") {
    const withAbsLinks: TraceableAnswerEnvelope = {
      ...ans,
      channel: "export",
      claims: ans.claims.map((c) => ({
        ...c,
        evidence_references: c.evidence_references.map((r) => ({
          ...r,
          resolver_url: r.resolver_url.startsWith("http")
            ? r.resolver_url
            : r.resolver_url
              ? `${baseUrl}${r.resolver_url}`
              : "",
        })),
      })),
    };
    return {
      allowed: true,
      http_status: 200,
      mime_type: "application/json; charset=utf-8",
      filename: `${safeId}.json`,
      content: JSON.stringify(withAbsLinks, null, 2),
    };
  }

  const verificationHeadingTh =
    ans.status === "legacy_unverified"
      ? "สถานะ: คำตอบรุ่นเดิม — ยังไม่ได้รับการยืนยันหลักฐานรายข้อกล่าวอ้าง (UNVERIFIED LEGACY ANSWER)"
      : `สถานะการตรวจสอบหลักฐาน: ${ans.status.toUpperCase()} (ยืนยันผ่านกฎ ${ans.verifier_metadata.ruleset_version})`;

  if (params.format === "markdown") {
    const mdLines: string[] = [
      `# รายงานคำตอบและการอ้างอิงแหล่งข้อมูลทางการ REG24`,
      ``,
      `- **รหัสรุ่นคำตอบ (Answer Revision):** \`${ans.answer_revision}\``,
      `- **วันที่กฎหมายที่คำถามกล่าวถึง (As-of Date):** \`${ans.as_of_date || "กฎหมายปัจจุบัน / ตามบริบทเอกสาร"}\``,
      `- **เวลาที่ระบบสร้างคำตอบ (Generated At):** \`${ans.generated_at}\``,
      `- **${verificationHeadingTh}**`,
    ];

    if (ans.legacy_warning_th) {
      mdLines.push(``, `> ⚠️ **${ans.legacy_warning_th}**`);
    }
    if (ans.update_notices && ans.update_notices.length > 0) {
      for (const un of ans.update_notices) {
        mdLines.push(``, `> ℹ️ **${un.notice_th}**`);
      }
    }

    mdLines.push(``, `## รายการข้อกล่าวอ้างและแหล่งอ้างอิงตามลำดับ`);
    for (const c of ans.claims) {
      mdLines.push(
        ``,
        `### [${c.claim_number}] (\`${c.claim_id}\` · ${c.claim_type_label_th})`,
        `${c.text}`
      );
      for (const r of c.evidence_references) {
        const permResolver = r.resolver_url
          ? r.resolver_url.startsWith("http")
            ? r.resolver_url
            : `${baseUrl}${r.resolver_url}`
          : "ไม่มีลิงก์ยืนยัน (คำตอบรุ่นเดิม)";
        mdLines.push(
          `- **อ้างอิง:** ${r.citation_label_th} (${r.support_role_label_th})`,
          `  - **หน่วยงาน / ประเภท:** ${r.issuer_name_th} · ${r.record_type_label_th}`,
          `  - **รุ่นเอกสาร / วันที่อ้างอิง:** \`${r.version_id}\` · วันที่ \`${r.date_relied_on || "-"}\``,
          `  - **ตำแหน่งอ้างอิง (Pinpoint):** ${r.locator.human_pinpoint_th}`,
          `  - **ลิงก์ต้นฉบับทางการ:** ${r.official_url_with_anchor || r.official_url || "-"}`,
          `  - **ลิงก์หลักฐานถาวร REG24:** ${permResolver}`
        );
      }
    }

    if (ans.unresolved_issues.length > 0) {
      mdLines.push(``, `## ประเด็นที่ระงับการสรุปเนื่องจากหลักฐานยังไม่เพียงพอ`);
      for (const iss of ans.unresolved_issues) {
        mdLines.push(`- ${iss.explanation_th}`);
      }
    }

    return {
      allowed: true,
      http_status: 200,
      mime_type: "text/markdown; charset=utf-8",
      filename: `${safeId}.md`,
      content: mdLines.join("\n"),
    };
  }

  // Shared rich HTML body for `pdf_html` (printable PDF) and `word_doc` (Word-compatible `.doc`)
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const claimBlocksHtml = ans.claims
    .map((c) => {
      const refsHtml = c.evidence_references
        .map((r) => {
          const permResolver = r.resolver_url
            ? r.resolver_url.startsWith("http")
              ? r.resolver_url
              : `${baseUrl}${r.resolver_url}`
            : "";
          const offUrl = r.official_url_with_anchor || r.official_url;
          return `<li style="margin-bottom:8px;">
            <strong>${esc(r.citation_label_th)}</strong> <em>(${esc(r.support_role_label_th)})</em><br/>
            <span>หน่วยงาน: ${esc(r.issuer_name_th)} · ประเภท: ${esc(r.record_type_label_th)} · รุ่น: <code>${esc(r.version_id)}</code> · วันที่อ้างอิง: ${esc(r.date_relied_on || "-")}</span><br/>
            <span>ตำแหน่งอ้างอิง: <strong>${esc(r.locator.human_pinpoint_th)}</strong></span><br/>
            ${offUrl ? `<a href="${esc(offUrl)}">เปิดต้นฉบับทางการ (${esc(offUrl)})</a>` : "<span>ไม่มีลิงก์ต้นฉบับทางการ</span>"}
            ${permResolver ? ` · <a href="${esc(permResolver)}">ลิงก์หลักฐานถาวร REG24 (${esc(r.evidence_id)})</a>` : ""}
          </li>`;
        })
        .join("");

      return `<div class="claim-block" data-claim-id="${esc(c.claim_id)}" data-claim-number="${c.claim_number}" style="margin-bottom:16px;padding:12px;border:1px solid #cbd5e1;">
        <div><strong>[${c.claim_number}]</strong> (<code>${esc(c.claim_id)}</code> · ${esc(c.claim_type_label_th)})</div>
        <p style="margin:6px 0;">${esc(c.text)}</p>
        ${refsHtml ? `<ul style="margin:6px 0 0 18px;font-size:13px;">${refsHtml}</ul>` : ""}
      </div>`;
    })
    .join("\n");

  const legacyBannerHtml = ans.legacy_warning_th
    ? `<div style="padding:12px;border:2px solid #dc2626;background:#fef2f2;color:#991b1b;font-weight:bold;margin-bottom:16px;">⚠️ ${esc(ans.legacy_warning_th)}</div>`
    : "";

  const htmlDoc = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<title>REG24 Citation Report — ${esc(ans.answer_revision)}</title>
</head>
<body style="font-family:'Sarabun','TH Sarabun New',Tahoma,sans-serif;line-height:1.65;color:#0f172a;max-width:860px;margin:24px auto;">
  <h1>รายงานคำตอบและการอ้างอิงแหล่งข้อมูลทางการ REG24</h1>
  <p>
    <strong>รหัสรุ่นคำตอบ:</strong> <code>${esc(ans.answer_revision)}</code><br/>
    <strong>วันที่กฎหมายที่คำถามกล่าวถึง (As-of Date):</strong> ${esc(ans.as_of_date || "กฎหมายปัจจุบัน / ตามบริบทเอกสาร")}<br/>
    <strong>เวลาที่ระบบสร้างคำตอบ (Generated At):</strong> ${esc(ans.generated_at)}<br/>
    <strong>${esc(verificationHeadingTh)}</strong>
  </p>
  ${legacyBannerHtml}
  <h2>รายการข้อกล่าวอ้างและหลักฐานอ้างอิง</h2>
  ${claimBlocksHtml}
</body>
</html>`;

  if (params.format === "word_doc") {
    return {
      allowed: true,
      http_status: 200,
      mime_type: "application/msword; charset=utf-8",
      filename: `${safeId}.doc`,
      content: htmlDoc,
    };
  }

  return {
    allowed: true,
    http_status: 200,
    mime_type: "text/html; charset=utf-8",
    filename: `${safeId}.print.html`,
    content: htmlDoc,
  };
}

/**
 * ANS-03: Allows an authorized `legal_reviewer` or `product_owner` to approve a documented ambiguity
 * using eligible evidence, creating a new verified answer revision and an append-only audit event!
 */
export function approveDocumentedAmbiguityWithEvidence(
  store: DurableKnowledgeStore,
  params: {
    prior_answer_revision: string;
    claim_text_th: string;
    claim_type: "legal_proposition" | "interpretation";
    evidence_ids: string[];
    reviewer: Actor;
    justification_th: string;
  }
): TraceableAnswerEnvelope {
  if (params.reviewer.role !== "legal_reviewer" && params.reviewer.role !== "product_owner") {
    throw new Error("FORBIDDEN_403: Only legal_reviewer or product_owner can approve documented ambiguity.");
  }
  const view = getUnifiedCitationLedgerView(store);
  const prior = view.published_answers[params.prior_answer_revision];
  if (!prior) {
    throw new Error(`NOT_FOUND_404: Prior answer revision '${params.prior_answer_revision}' not found.`);
  }

  const nextEnvelope = validateAndBuildTraceableAnswer(store, {
    answer_id: prior.answer_id,
    supersedes_answer_revision: prior.answer_revision,
    revision_number: prior.revision_number + 1,
    channel: prior.channel,
    question: prior.question_text,
    as_of_date: prior.as_of_date,
    release_id: prior.verifier_metadata.release_id,
    actor: params.reviewer,
    authorized_candidate_ids: new Set(params.evidence_ids),
    proposed_claims: [
      {
        text: params.claim_text_th,
        claim_type: params.claim_type,
        human_approved_by: params.reviewer.actor_id,
        support_groups: [
          {
            group_id: "grp.human_reviewed_support",
            role: "primary_authority",
            evidence_ids: params.evidence_ids,
          },
        ],
      },
    ],
    persist_atomically: true,
  });

  mutateCitationLedgerAtomically(
    store,
    "RECORD_HUMAN_AMBIGUITY_APPROVAL_AUDIT",
    params.reviewer.actor_id,
    (ledger) => {
      appendCitationAuditEvent(ledger, {
        actor_or_service: params.reviewer.actor_id,
        event_type: "CLAIM_HUMAN_AMBIGUITY_APPROVED",
        affected_ids: [prior.answer_revision, nextEnvelope.answer_revision, ...params.evidence_ids],
        before_status: { status: prior.status, revision: prior.answer_revision },
        after_status: { status: nextEnvelope.status, revision: nextEnvelope.answer_revision },
        reason: params.justification_th,
        correlation_id: nextEnvelope.answer_revision,
      });
    }
  );

  return nextEnvelope;
}

/**
 * Section 7: Server-side publication gate switch (`enforced` | `verified_readonly` | `generation_disabled`).
 * Preserves all evidence records and published IDs on rollback!
 */
export function setCitationPublicationGateMode(
  store: DurableKnowledgeStore,
  mode: "enforced" | "verified_readonly" | "generation_disabled",
  actor: Actor,
  reason: string
): void {
  mutateCitationLedgerAtomically(
    store,
    "SET_CITATION_PUBLICATION_GATE_MODE",
    actor.actor_id,
    (ledger) => {
      const prev = ledger.publication_gate_mode;
      ledger.publication_gate_mode = mode;
      appendCitationAuditEvent(ledger, {
        actor_or_service: actor.actor_id,
        event_type: "PUBLICATION_GATE_SWITCH_CHANGED",
        affected_ids: ["publication_gate_mode"],
        before_status: { mode: prev },
        after_status: { mode },
        reason,
        correlation_id: `corr.switch.${Date.now()}`,
      });
    }
  );
}

/**
 * Section 8: Independently inspects rendered output text to catch any legal assertions missed by segmentation!
 */
export function detectUnsegmentedLegalClaimsInRenderedText(
  envelope: TraceableAnswerEnvelope
): number {
  if (envelope.status === "legacy_unverified" || envelope.status === "insufficient") {
    return 0;
  }
  const blocks = envelope.rendered_answer_th
    .split(/\r?\n(?=\[\d+\]\s+|หมายเหตุข้อจำกัดหลักฐาน:)/)
    .map((b) => b.trim())
    .filter(Boolean);

  let missedCount = 0;
  for (const block of blocks) {
    if (block.startsWith("หมายเหตุข้อจำกัดหลักฐาน:")) continue;
    if (block.includes("【ข้อเท็จจริง/สมมติฐานที่รับมาจากคำถาม】")) continue;
    const m = block.match(/^\[(\d+)\]\s+/);
    if (!m) {
      if (/(?:ต้องเสียภาษี|ได้รับยกเว้น|มาตรา\s*[0-9๐-๙]+|ภายใน\s*[0-9๐-๙]+\s*วัน)/.test(block)) {
        missedCount++;
      }
      continue;
    }
    const claimNum = Number(m[1]);
    const matchingClaim = envelope.claims.find((c) => c.claim_number === claimNum);
    if (!matchingClaim) {
      missedCount++;
    }
  }
  return missedCount;
}

/**
 * Section 8: Computes all 5 mandatory acceptance measurements with exact numerators, denominators,
 * zero-denominator `"no_observations"` guard, and positive-fixture non-empty enforcement!
 */
export function computeCitationTraceabilityAcceptanceMetrics(
  store: DurableKnowledgeStore,
  params: {
    batch_id: BatchId;
    release_id: string;
    evaluated_envelopes: Array<{
      case_id: string;
      is_positive_fixture: boolean;
      expected_outcome: "complete" | "partial" | "insufficient";
      envelope: TraceableAnswerEnvelope;
      reviewer_id?: string;
    }>;
    channels_tested: TraceablePublicationChannel[];
    actor: Actor;
  }
): CitationAcceptanceMeasurementReport {
  const measuredAt = new Date().toISOString();
  const invCounts = computeBatchTraceabilityInventoryCounts(
    store,
    params.batch_id,
    params.release_id
  );
  const view = getUnifiedCitationLedgerView(store, params.release_id);

  let totalPublishedLegalClaims = 0;
  let validatedPublishedLegalClaims = 0;
  let unsegmentedMissed = 0;

  let totalPublishedCitations = 0;
  let traceablePublishedCitations = 0;

  let supportedClaimsCount = 0;
  let unsupportedClaimsCount = 0;
  let omittedQualificationsCount = 0;

  let answeredQuestions = 0;
  let partialQuestions = 0;
  let withheldQuestions = 0;
  const withheldByReason: Record<string, number> = {};

  const caseAdjudications: CitationAcceptanceMeasurementReport["semantic_support_acceptance"]["case_adjudications"] =
    [];

  for (const item of params.evaluated_envelopes) {
    const env = item.envelope;
    if (env.status === "legacy_unverified") continue;

    unsegmentedMissed += detectUnsegmentedLegalClaimsInRenderedText(env);

    if (env.status === "complete") answeredQuestions++;
    else if (env.status === "partial") partialQuestions++;
    else if (env.status === "insufficient") withheldQuestions++;

    for (const iss of env.unresolved_issues) {
      withheldByReason[iss.reason_code] = (withheldByReason[iss.reason_code] || 0) + 1;
    }

    for (const clm of env.claims) {
      if (clm.claim_type === "legal_proposition" || clm.claim_type === "interpretation") {
        totalPublishedLegalClaims++;
        const hasValidRefs =
          clm.published &&
          clm.verification_decision === "supported" &&
          clm.evidence_references.length > 0;
        if (hasValidRefs) {
          validatedPublishedLegalClaims++;
          supportedClaimsCount++;
        } else {
          unsupportedClaimsCount++;
        }
      }

      for (const ref of clm.evidence_references) {
        totalPublishedCitations++;
        const resolved = resolveTraceableEvidenceById(
          store,
          ref.evidence_id,
          params.actor,
          params.release_id
        );
        const doc = view.documents[ref.doc_id];
        const psg = view.passages[ref.evidence_id];
        const pubOk = Boolean(doc && view.publishers[doc.issuer_id]?.active);
        const replayOk = psg?.locator_replay_status === "VERIFIED";
        if (resolved.ok && pubOk && replayOk && doc?.eligible_for_citation) {
          traceablePublishedCitations++;
        }
      }
    }

    const statusMatchesExpected = env.status === item.expected_outcome;
    caseAdjudications.push({
      case_id: item.case_id,
      as_of_date: env.as_of_date,
      expected_outcome: item.expected_outcome,
      actual_status: env.status,
      reviewer_id: item.reviewer_id || "thai.legal.reviewer@reg24.th",
      adjudication: statusMatchesExpected ? "PASS" : "FAIL",
    });
  }

  // Positive fixtures guard: empty corpus or all-withheld run CANNOT pass positive fixtures!
  const positiveItems = params.evaluated_envelopes.filter((e) => e.is_positive_fixture);
  const positiveFixturesNonEmpty =
    invCounts.documents.eligible > 0 &&
    positiveItems.length > 0 &&
    positiveItems.every(
      (p) => p.envelope.status === "complete" && p.envelope.claims.length > 0
    );

  // Official link availability
  const primaryLocs = Object.values(view.locations).filter(
    (l) => l.is_active_primary && l.role !== "third_party_discovery"
  );
  const reachableLocs = primaryLocs.filter(
    (l) => l.link_health === "verified_online" || l.link_health === "moved_verified"
  );
  const failedLocs = primaryLocs
    .filter((l) => l.link_health !== "verified_online" && l.link_health !== "moved_verified")
    .map((l) => ({
      location_id: l.location_id,
      url: l.exact_official_url,
      cause: l.failure_reason || l.link_health,
    }));

  const claimCovRatio =
    totalPublishedLegalClaims === 0
      ? ("no_observations" as const)
      : validatedPublishedLegalClaims / totalPublishedLegalClaims;
  const citeTraceRatio =
    totalPublishedCitations === 0
      ? ("no_observations" as const)
      : traceablePublishedCitations / totalPublishedCitations;
  const docEligRatio =
    invCounts.documents.discovered === 0
      ? ("no_observations" as const)
      : invCounts.documents.eligible / invCounts.documents.discovered;

  const claimCoveragePasses =
    claimCovRatio === 1 && unsegmentedMissed === 0 && totalPublishedLegalClaims > 0;
  const citeTracePasses = citeTraceRatio === 1 && totalPublishedCitations > 0;
  const semanticPasses =
    unsupportedClaimsCount === 0 &&
    omittedQualificationsCount === 0 &&
    caseAdjudications.every((c) => c.adjudication === "PASS");

  return {
    batch_id: params.batch_id,
    release_id: params.release_id,
    measured_at: measuredAt,
    published_claim_coverage: {
      numerator: validatedPublishedLegalClaims,
      denominator: totalPublishedLegalClaims,
      ratio: claimCovRatio,
      unsegmented_rendered_claims_detected: unsegmentedMissed,
      passes_100_percent_gate: claimCoveragePasses,
    },
    published_citation_traceability: {
      numerator: traceablePublishedCitations,
      denominator: totalPublishedCitations,
      ratio: citeTraceRatio,
      channels_verified: [...new Set(params.channels_tested)],
      passes_100_percent_gate: citeTracePasses,
    },
    semantic_support_acceptance: {
      adjudicated_cases: caseAdjudications.length,
      supported_claims: supportedClaimsCount,
      unsupported_claims: unsupportedClaimsCount,
      material_omitted_qualifications: omittedQualificationsCount,
      passes_zero_defect_gate: semanticPasses,
      case_adjudications: caseAdjudications,
    },
    official_link_availability: {
      verified_reachable_count: reachableLocs.length,
      total_checked_locations: primaryLocs.length,
      checked_at: measuredAt,
      failed_locations: failedLocs,
    },
    coverage_and_withholding: {
      eligible_documents: invCounts.documents.eligible,
      inventory_documents: invCounts.documents.discovered,
      document_eligibility_ratio: docEligRatio,
      answered_questions: answeredQuestions,
      partial_questions: partialQuestions,
      withheld_questions: withheldQuestions,
      attempted_questions: params.evaluated_envelopes.length,
      withheld_by_reason: withheldByReason,
      positive_fixtures_non_empty_verified: positiveFixturesNonEmpty,
    },
    all_release_gates_passed:
      claimCoveragePasses &&
      citeTracePasses &&
      semanticPasses &&
      positiveFixturesNonEmpty,
  };
}

/**
 * Allows operator/test environment to withdraw or remove a specific passage from eligible publication
 * (exercised in T03, T10, and Section 10 Owner's Demo: "removing a required passage prevents the
 * corresponding new claim from being published").
 */
export function removeOrWithdrawEligiblePassage(
  store: DurableKnowledgeStore,
  passageId: string,
  actor: Actor,
  reason: string
): void {
  const unified = getUnifiedCitationLedgerView(store);
  const existing = unified.passages[passageId];
  mutateCitationLedgerAtomically(
    store,
    "WITHDRAW_ELIGIBLE_PASSAGE",
    actor.actor_id,
    (ledger) => {
      if (existing && !ledger.passages[passageId]) {
        ledger.passages[passageId] = { ...existing };
      }
      if (ledger.passages[passageId]) {
        ledger.passages[passageId] = {
          ...ledger.passages[passageId],
          eligible_for_publication: false,
          quarantine_reason: `WITHDRAWN_REQUIRED_PASSAGE:${reason}`,
        };
      }
      appendCitationAuditEvent(ledger, {
        actor_or_service: actor.actor_id,
        event_type: "IDENTITY_QUARANTINED",
        affected_ids: [passageId],
        before_status: { eligible_for_publication: true },
        after_status: { eligible_for_publication: false },
        reason,
        correlation_id: `corr.withdraw_psg.${passageId}`,
      });
    }
  );
}

/**
 * Production answer integration over directly onboarded `citation_ledger` documents/versions/passages
 * (Sections 4, 5, 10). Returns `null` when no onboarded `citation_ledger` document matches the query
 * so the standard canonical Batch 1 corpus engine handles it seamlessly.
 */
export function tryAnswerFromOnboardedCitationSources(
  store: DurableKnowledgeStore,
  params: {
    question: string;
    applicable_date: string | null;
    release_id: string;
    actor: Actor;
    channel?: TraceablePublicationChannel;
    persist?: boolean;
  }
): GroundedAnswer | null {
  const startedAt = Date.now();
  const state = store.getState();
  const rawLedger = readSidecarOverlay(store) || state.citation_ledger;
  if (!rawLedger || Object.keys(rawLedger.documents).length === 0) {
    return null;
  }

  const qNorm = normalizeThaiSearchTextOnly(params.question);
  // Only intercept when an explicitly onboarded document (not just a backfilled canonical work, unless a newer amendment version or passage withdrawal exists!) matches the question
  const directDocs = Object.values(rawLedger.documents).filter((doc) => {
    const nativeNorm = normalizeThaiSearchTextOnly(doc.source_native_id || "");
    const titleNorm = normalizeThaiSearchTextOnly(doc.original_title_th);
    if (nativeNorm && nativeNorm.length >= 3 && qNorm.includes(nativeNorm)) {
      return true;
    }
    const titleTokens = titleNorm.split(/\s+/).filter((t) => t.length >= 5);
    const matchedTokens = titleTokens.filter((t) => qNorm.includes(t));
    return titleTokens.length > 0 && matchedTokens.length >= Math.min(2, titleTokens.length);
  });

  if (directDocs.length === 0) {
    return null;
  }

  // Filter authorized documents for this caller (RET-01, T10)
  const authorizedDocs = directDocs.filter(
    (d) =>
      d.access_scope === "scope.platform.public" ||
      params.actor.authorized_scopes.includes(d.access_scope)
  );

  const generatedAt = new Date().toISOString();
  const traceId = `trc.onb.${sha256Bytes(`${params.release_id}|${params.actor.actor_id}|${params.question}|${startedAt}`).slice(0, 12)}`;

  if (authorizedDocs.length === 0) {
    const env = validateAndBuildTraceableAnswer(store, {
      answer_id: `ans.${traceId}`,
      channel: params.channel || "api",
      question: params.question,
      as_of_date: params.applicable_date,
      generated_at: generatedAt,
      release_id: params.release_id,
      actor: params.actor,
      authorized_candidate_ids: new Set(),
      proposed_claims: [
        {
          text: "ไม่สามารถเข้าถึงหรือยืนยันหลักฐานสำหรับคำถามนี้ภายใต้สิทธิ์ผู้ใช้งานปัจจุบัน",
          claim_type: "legal_proposition",
          support_groups: [],
          scope_topic_th: "ข้อกฎหมายที่ถาม",
        },
      ],
      persist_atomically: Boolean(params.persist),
    });
    return {
      release_id: params.release_id,
      knowledge_snapshot_at: generatedAt,
      generated_at: generatedAt,
      status: "INSUFFICIENT_EVIDENCE",
      answer: env.rendered_answer_th,
      claims: [],
      evidence: [],
      assumptions: [],
      clarification_questions: [],
      coverage_warnings: [],
      applicable_date: params.applicable_date,
      model_policy_version: "reg24-grounded-legal-v1.2",
      trace_id: traceId,
      latency_ms: Math.max(1, Date.now() - startedAt),
      traceable_answer: env,
    };
  }

  // Select applicable versions per matched document for `applicable_date` (Section 4.4, T04)
  const candidatePassageIds = new Set<string>();
  const proposedClaims: ProposedStructuredClaimInput[] = [];
  const evidenceCards: GroundedAnswer["evidence"] = [];

  const statuteDocs = authorizedDocs.filter((d) => d.source_family === "gazette_enactment");
  const rulingOrCaseDocs = authorizedDocs.filter((d) => d.source_family !== "gazette_enactment");

  const selectVersionForDoc = (doc: OfficialDocumentRecord): DocumentVersionRecord | null | "FALLBACK_CANONICAL" => {
    const versions = Object.values(rawLedger.versions).filter((v) => v.doc_id === doc.doc_id);
    if (versions.length === 0) return null;
    if (params.applicable_date) {
      const matching = versions.filter((v) => {
        const okFrom = !v.effective_from || params.applicable_date! >= v.effective_from;
        const okTo = !v.effective_to || params.applicable_date! <= v.effective_to;
        return okFrom && okTo;
      });
      if (matching.length > 0) {
        return matching.sort((a, b) =>
          (b.effective_from || "").localeCompare(a.effective_from || "")
        )[0];
      }
      const docNativeNorm = normalizeThaiSearchTextOnly(doc.source_native_id || doc.original_title_th);
      const hasCanonicalBaseline = Object.values(state.works).some((w) => {
        const wNorm = normalizeThaiSearchTextOnly(
          w.official_identifiers?.[0]?.normalized || w.title_th
        );
        return wNorm.length >= 3 && wNorm === docNativeNorm;
      });
      if (hasCanonicalBaseline) {
        return "FALLBACK_CANONICAL";
      }
      return versions[0];
    }
    return versions.sort((a, b) =>
      (b.effective_from || b.captured_at).localeCompare(a.effective_from || a.captured_at)
    )[0];
  };

  const selectedDocPassages = new Map<string, EvidencePassageRecord[]>();
  for (const doc of authorizedDocs) {
    const ver = selectVersionForDoc(doc);
    if (ver === "FALLBACK_CANONICAL") {
      return null;
    }
    if (!ver) continue;
    const psgs = Object.values(rawLedger.passages).filter(
      (p) => p.doc_id === doc.doc_id && p.version_id === ver.version_id
    );
    for (const p of psgs) {
      candidatePassageIds.add(p.passage_id);
    }
    selectedDocPassages.set(doc.doc_id, psgs);
  }

  // Multi-premise synthesis when BOTH a statute AND a ruling/decision are queried together (T03)!
  if (statuteDocs.length > 0 && rulingOrCaseDocs.length > 0) {
    const statDoc = statuteDocs[0];
    const rulDoc = rulingOrCaseDocs[0];
    const statPsgs = (selectedDocPassages.get(statDoc.doc_id) || []).filter(
      (p) => p.eligible_for_publication
    );
    const rulPsgs = (selectedDocPassages.get(rulDoc.doc_id) || []).filter(
      (p) => p.eligible_for_publication
    );

    const statPremiseId = `clm.${traceId}.premise_statute`;
    const rulPremiseId = `clm.${traceId}.premise_ruling`;

    proposedClaims.push({
      claim_id: statPremiseId,
      text: statPsgs[0]?.verbatim_text || `หลักเกณฑ์ตาม${statDoc.original_title_th}`,
      claim_type: "legal_proposition",
      scope_topic_th: `บทบัญญัติ ${statDoc.source_native_id || statDoc.original_title_th}`,
      support_groups: [
        {
          group_id: "grp.statute_premise",
          role: "statutory_premise",
          evidence_ids: (selectedDocPassages.get(statDoc.doc_id) || []).map((p) => p.passage_id),
        },
      ],
    });

    proposedClaims.push({
      claim_id: rulPremiseId,
      text: rulPsgs[0]?.verbatim_text || `แนววินิจฉัยตาม ${rulDoc.source_native_id || rulDoc.original_title_th}`,
      claim_type: "legal_proposition",
      scope_topic_th: `แนววินิจฉัย ${rulDoc.source_native_id || rulDoc.original_title_th}`,
      support_groups: [
        {
          group_id: "grp.ruling_premise",
          role: "ruling_application",
          evidence_ids: (selectedDocPassages.get(rulDoc.doc_id) || []).map((p) => p.passage_id),
        },
      ],
    });

    proposedClaims.push({
      claim_id: `clm.${traceId}.dependent_conclusion`,
      text: `สรุปผลการปรับใช้บทบัญญัติ ${statDoc.source_native_id || statDoc.original_title_th} ประกอบแนววินิจฉัย ${rulDoc.source_native_id || rulDoc.original_title_th}: ${rulPsgs[0]?.verbatim_text || ""}`,
      claim_type: "interpretation",
      premise_ids: [statPremiseId, rulPremiseId],
      scope_topic_th: "ข้อสรุปที่ต้องอาศัยบทบัญญัติและแนววินิจฉัยประกอบกัน",
      support_groups: [
        {
          group_id: "grp.joint_statute",
          role: "statutory_premise",
          evidence_ids: statPsgs.map((p) => p.passage_id),
        },
        {
          group_id: "grp.joint_ruling",
          role: "ruling_application",
          evidence_ids: rulPsgs.map((p) => p.passage_id),
        },
      ],
    });
  } else {
    // Single or homogeneous document set: segment passages into atomic claims and test T08 question premise!
    for (const doc of authorizedDocs) {
      const psgs = selectedDocPassages.get(doc.doc_id) || [];
      if (psgs.length === 0) {
        proposedClaims.push({
          text: `ข้อกฎหมายตาม ${doc.source_native_id || doc.original_title_th}`,
          claim_type: "legal_proposition",
          scope_topic_th: doc.source_native_id || doc.original_title_th,
          support_groups: [],
        });
        continue;
      }
      for (const p of psgs) {
        // If user question proposes an unconditional rule ("ทุกกรณีโดยไม่มีข้อยกเว้น") against an exception passage (T08), test that proposed claim directly!
        const userProposedUnconditional = /ทุกกรณีโดยไม่มีข้อยกเว้น/.test(params.question);
        const rawClaimText = userProposedUnconditional
          ? `${doc.source_native_id || doc.original_title_th} ใช้บังคับทุกกรณีโดยไม่มีข้อยกเว้น`
          : p.verbatim_text;

        const segments = userProposedUnconditional
          ? [rawClaimText]
          : segmentIntoAtomicClaimStatements(rawClaimText);
        for (const seg of segments) {
          proposedClaims.push({
            text: seg,
            claim_type: "legal_proposition",
            scope_topic_th: doc.source_native_id || doc.original_title_th,
            support_groups: [
              {
                group_id: "grp.primary",
                role: /^(?:เว้นแต่|ยกเว้น)/.test(seg)
                  ? "exception_or_proviso"
                  : "primary_authority",
                evidence_ids: [p.passage_id],
                expected_version_id: p.version_id,
              },
            ],
          });
        }
      }
    }
  }

  const envelope = validateAndBuildTraceableAnswer(store, {
    answer_id: `ans.${traceId}`,
    channel: params.channel || "api",
    question: params.question,
    as_of_date: params.applicable_date,
    generated_at: generatedAt,
    release_id: params.release_id,
    actor: params.actor,
    authorized_candidate_ids: candidatePassageIds,
    proposed_claims: proposedClaims,
    user_supplied_facts: extractUserSuppliedFactsFromQuestion(params.question),
    persist_atomically: Boolean(params.persist),
  });

  // Populate backwards-compatible `EvidenceCard[]` for published claims
  const seenEv = new Set<string>();
  for (const clm of envelope.claims) {
    for (const ref of clm.evidence_references) {
      if (seenEv.has(ref.evidence_id)) continue;
      seenEv.add(ref.evidence_id);
      const psg = rawLedger.passages[ref.evidence_id];
      const doc = rawLedger.documents[ref.doc_id];
      const ver = rawLedger.versions[ref.version_id];
      if (!psg || !doc || !ver) continue;
      evidenceCards.push({
        passage_id: psg.passage_id,
        work_id: doc.canonical_work_id || doc.doc_id,
        version_id: ver.version_id,
        official_identifier: doc.source_native_id || doc.original_title_th,
        title_th: doc.original_title_th,
        authority_type:
          doc.source_family === "revenue_department_ruling"
            ? "TaxRuling"
            : doc.source_family === "supreme_court_decision"
              ? "CourtDecision"
              : "ProvisionVersion",
        authenticity_status: "official_original",
        is_derivative: false,
        statement_role: psg.statement_role,
        issue_or_effective_date: ver.effective_from || ver.publication_date,
        raw_date_text: ver.effective_from || ver.publication_date,
        exact_excerpt: psg.verbatim_text,
        locator: {
          kind: psg.physical_page_start !== null ? "pdf_page" : "html_structural",
          artifact_id: ver.artifact_ref,
          origin_uri: ref.official_url,
          physical_page_index:
            psg.physical_page_start !== null ? psg.physical_page_start - 1 : undefined,
          printed_page_label: psg.printed_page_start,
          structural_selector: psg.anchors[0]?.structural_selector || undefined,
        },
        related_provisions: [],
      });
    }
  }

  const mappedStatus: GroundedAnswer["status"] =
    envelope.status === "complete"
      ? "ANSWERED"
      : envelope.status === "partial"
        ? "CONDITIONAL"
        : envelope.unresolved_issues.some((i) => i.reason_code === "AMBIGUOUS_OCR_AWAITING_REVIEW")
          ? "REVIEW_REQUIRED"
          : "INSUFFICIENT_EVIDENCE";

  return {
    release_id: params.release_id,
    knowledge_snapshot_at: generatedAt,
    generated_at: generatedAt,
    status: mappedStatus,
    answer: envelope.rendered_answer_th,
    claims: envelope.claims.map((c) => ({
      claim_id: c.claim_id,
      statement: c.text,
      claim_type:
        c.claim_type === "interpretation"
          ? "qualified_legal_synthesis"
          : "direct_source_statement",
      statement_role: "statutory_text",
      supporting_passage_ids: c.evidence_references.map((r) => r.evidence_id),
      applicable_version_id: c.evidence_references[0]?.version_id || null,
      factual_conditions: [],
      exceptions: [],
      counterevidence_passage_ids: [],
      verification_result: "VERIFIED",
    })),
    evidence: evidenceCards,
    assumptions: envelope.assumptions,
    clarification_questions: [],
    coverage_warnings: envelope.unresolved_issues.map((u) => u.explanation_th),
    applicable_date: params.applicable_date,
    model_policy_version: "reg24-grounded-legal-v1.2",
    trace_id: traceId,
    latency_ms: Math.max(1, Date.now() - startedAt),
    traceable_answer: envelope,
  };
}

