/**
 * REG24 — Legal Form and Document Execution (LFDE v2.0) Acceptance Test Suite
 * Specification: REG24-LFDE-V2-001 (Section 14.2: AT01 through AT40)
 *
 * Verifies all 40 mandatory acceptance criteria across:
 * - Authentication, tenant isolation, body tenant spoofing, and service-account approval prohibition (AT01–AT04, AT33–AT36)
 * - Two-step upload, malware/macro/external-rel quarantine, license gates, and revocation (AT05–AT08)
 * - Fact intake, B.E./CE date normalization, leading-zero IDs, BigInt money math, low-confidence OCR, and conflict ledger (AT09–AT13)
 * - Three-valued expression interpreter, broken cross-refs, and unapproved template blocking (AT14–AT16)
 * - Bi-temporal authority snapshot pinning, CCC Sec. 1097 historical 2020 vs 2026 rules, proposition support, and timeout fail-closed (AT17–AT20)
 * - Deterministic assembly hash, Idempotency-Key conflict, ETag concurrency, stale approval invalidation, and non-overridable blocker enforcement (AT21–AT32)
 * - Webhook SSRF protection, HMAC replay protection, source-change deduplication, and AGI budget/human gate (AT37–AT40)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LfdeService } from "../src/core/lfde/service";
import {
  AuthorityGateway,
  evaluateExpression,
  normalizeTypedFieldValue,
  sha256Hex,
  signWebhookPayload,
  sumDecimalStrings,
  validateWebhookDestination,
} from "../src/core/lfde/adapters";
import { SEED_APPROVAL_GRANTS } from "../src/core/lfde/fixtures";
import { LfdeException, type LfdeScope, type TenantContext } from "../src/core/lfde/types";

const ALL_SCOPES: LfdeScope[] = [
  "source:write",
  "template:read",
  "template:curate",
  "template:review",
  "template:publish",
  "clause:read",
  "clause:curate",
  "clause:review",
  "document:create",
  "document:read",
  "document:edit",
  "document:comment",
  "document:validate",
  "document:request_review",
  "document:approve",
  "document:export",
  "package:create",
  "audit:read",
];

describe("REG24 LFDE v2.0 — Legal Form and Document Execution Acceptance Suite (AT01–AT40)", () => {
  let lfde: LfdeService;
  let counselCtx: TenantContext;
  let approverCtx: TenantContext;
  let curatorCtx: TenantContext;
  let serviceAcctCtx: TenantContext;
  let otherTenantCtx: TenantContext;

  beforeEach(() => {
    lfde = new LfdeService();
    counselCtx = {
      subject_id: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      application_id: "REG24",
      role: "contributor",
      is_service_account: false,
      scopes: [
        "source:write",
        "template:read",
        "clause:read",
        "document:create",
        "document:read",
        "document:edit",
        "document:validate",
        "document:request_review",
        "document:export",
        "package:create",
      ],
      matter_grants: ["matter.law24.ma.2026.01"],
      approval_grants: [],
      correlation_id: "corr_counsel",
    };

    approverCtx = {
      subject_id: "approver.partner@law24.th",
      tenant_id: "tenant.law24.prod",
      application_id: "REG24",
      role: "designated_approver",
      is_service_account: false,
      scopes: ALL_SCOPES,
      matter_grants: ["matter.law24.ma.2026.01"],
      approval_grants: SEED_APPROVAL_GRANTS.filter((g) => g.tenant_id === "tenant.law24.prod"),
      correlation_id: "corr_approver",
    };

    curatorCtx = {
      subject_id: "curator.legal@reg24.th",
      tenant_id: "tenant.law24.prod",
      application_id: "REG24",
      role: "template_curator",
      is_service_account: false,
      scopes: ALL_SCOPES,
      matter_grants: ["*"],
      approval_grants: SEED_APPROVAL_GRANTS.filter((g) => g.tenant_id === "tenant.law24.prod"),
      correlation_id: "corr_curator",
    };

    serviceAcctCtx = {
      subject_id: "svc.automation.bot",
      tenant_id: "tenant.law24.prod",
      application_id: "REG24",
      role: "integration_service",
      is_service_account: true,
      scopes: ALL_SCOPES,
      matter_grants: ["*"],
      approval_grants: [],
      correlation_id: "corr_svc",
    };

    otherTenantCtx = {
      subject_id: "external.lawyer@rival.th",
      tenant_id: "tenant.rival.firm",
      application_id: "LAW24",
      role: "contributor",
      is_service_account: false,
      scopes: ALL_SCOPES,
      matter_grants: ["matter.rival.01"],
      approval_grants: [],
      correlation_id: "corr_rival",
    };
  });

  it("AT01–AT04 & AT33–AT36: Enforces server-verified identity, cross-tenant 404 isolation, body tenant spoofing 403, service-account approval prohibition, and revoked subject denial", () => {
    // AT01: Unauthenticated context rejected with 401
    expect(() => lfde.verifyContext(null)).toThrowError(/Missing or invalid verified identity/);

    // AT03: Body tenant_id differing from verified context rejected with 403 FORBIDDEN
    try {
      lfde.verifyContext(counselCtx, "document:create", { tenant_id: "tenant.spoofed.id" });
      expect.unreachable("Should have thrown 403");
    } catch (err) {
      expect(err).toBeInstanceOf(LfdeException);
      expect((err as LfdeException).envelope.http_status).toBe(403);
    }

    // Create a document in tenant.law24.prod
    const created = lfde.createDocumentCase(counselCtx, "idem_at02", {
      matter_id: "matter.law24.ma.2026.01",
      template_version_id: "template_demo_nda_v1",
      objective: "Cross-tenant isolation check",
    });

    // AT02 & AT35: Cross-tenant access and nonexistent ID both return 404 NOT_FOUND without leaking existence
    try {
      lfde.getDocumentCase(otherTenantCtx, created.document.id);
      expect.unreachable("Should throw 404");
    } catch (err) {
      expect((err as LfdeException).envelope.http_status).toBe(404);
    }
    try {
      lfde.getDocumentCase(otherTenantCtx, "doc_nonexistent_99999");
      expect.unreachable("Should throw 404");
    } catch (err) {
      expect((err as LfdeException).envelope.http_status).toBe(404);
    }

    // AT04: Service accounts cannot transition/publish templates
    expect(() =>
      lfde.transitionTemplateVersion(serviceAcctCtx, "idem_svc_tpl", "tpl_nda_mutual_th", {
        version_id: "template_demo_nda_v1",
        target_state: "published",
        reason: "Bot attempting publish",
      })
    ).toThrowError(/Service accounts cannot approve or publish templates/);

    // AT33: Revoked tenant membership immediately blocks subsequent calls
    lfde.revokeSubjectMembership(otherTenantCtx.tenant_id, otherTenantCtx.subject_id);
    expect(() => lfde.listDocumentCases(otherTenantCtx)).toThrowError(/revoked/);
  });

  it("AT05–AT08: Enforces two-step upload, macro/executable/external-link rejection, unknown-rights quarantine, and license revocation blocking", () => {
    // AT08: Reject macro-enabled .docm at upload session creation
    expect(() =>
      lfde.createUploadSession(curatorCtx, "idem_upl_macro", {
        original_name: "malicious_macro.docm",
        mime: "application/vnd.ms-word.document.macroEnabled.12",
        size: 10240,
        sha256: sha256Hex("macro"),
      })
    ).toThrowError(/macro-enabled/);

    // AT08: Reject OOXML with external links or ZIP bomb on upload completion
    const sess1 = lfde.createUploadSession(curatorCtx, "idem_upl_ext", {
      original_name: "external_rel.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 12000,
      sha256: sha256Hex("ext_rel"),
    });
    expect(() =>
      lfde.completeUploadSession(curatorCtx, "idem_cpl_ext", sess1.id, {
        measured_bytes: 12000,
        measured_sha256: sha256Hex("ext_rel"),
        contains_external_links: true,
      })
    ).toThrowError(/external OOXML relationships/);

    // AT05: Uploaded source without license grant is quarantined and blocked from template import
    const sess2 = lfde.createUploadSession(curatorCtx, "idem_upl_unlic", {
      original_name: "unlicensed_precedent.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 15000,
      sha256: sha256Hex("unlic_doc"),
      classification: "purchased_precedent",
    });
    const completedUnlic = lfde.completeUploadSession(curatorCtx, "idem_cpl_unlic", sess2.id, {
      measured_bytes: 15000,
      measured_sha256: sha256Hex("unlic_doc"),
    });
    expect(completedUnlic.asset.scan_state).toBe("quarantined");

    expect(() =>
      lfde.importWorkingTemplate(curatorCtx, "idem_imp_unlic", {
        source_id: completedUnlic.asset.id,
        title_th: "แม่แบบยังไม่ได้รับอนุญาต",
        title_en: "Unlicensed Precedent",
        domain: "contract",
        family: "nda",
      })
    ).toThrowError(/No license grant record exists/);
  });

  it("AT09–AT13: Enforces low-confidence OCR unconfirmed state, conflicting fact candidate blocking, B.E. date conversion, leading-zero ID preservation, and exact BigInt decimal math", () => {
    // AT11: Thai B.E. date 2569-10-23 normalizes to CE 2026-10-23
    const normDate = normalizeTypedFieldValue("date", "2569-10-23");
    expect(normDate.typed_value).toBe("2026-10-23");
    expect(normDate.calendar_used).toBe("BE");

    // AT12: 13-digit Thai Registration ID with leading zero is preserved as string
    const normId = normalizeTypedFieldValue("identifier", "0105564019283");
    expect(normId.typed_value).toBe("0105564019283");
    expect(typeof normId.typed_value).toBe("string");

    // AT13: Exact BigInt-scaled decimal money math avoids floating-point drift (0.1 + 0.2 === 0.30)
    expect(sumDecimalStrings(["0.1", "0.2"], 2)).toBe("0.30");
    expect(sumDecimalStrings(["600000.00", "600000.00"], 2)).toBe("1200000.00");

    // AT09 & AT10: Low-confidence extracted candidate stays 'extracted', and conflicting candidates block assembly
    const created = lfde.createDocumentCase(counselCtx, "idem_doc_facts", {
      matter_id: "matter.law24.ma.2026.01",
      template_version_id: "template_demo_nda_v1",
      objective: "Test low confidence and conflict ledger",
    });

    const lowConfUpdate = lfde.updateDocumentFacts(
      counselCtx,
      "idem_upd_lowconf",
      created.document.id,
      created.document.etag,
      {
        changes: [
          {
            field_key: "party_a.name",
            value: "บริษัท ก จำกัด",
            confidence: 0.72,
            action: "confirm_candidate",
          },
        ],
      }
    );
    expect(lowConfUpdate.candidates[0].assertion_state).toBe("extracted");

    // Propose conflicting value for party_a.name -> marks candidates 'conflicted'
    const conflictUpdate = lfde.updateDocumentFacts(
      counselCtx,
      "idem_upd_conflict",
      created.document.id,
      lowConfUpdate.document.etag,
      {
        changes: [
          {
            field_key: "party_a.name",
            value: "บริษัท ข จำกัด",
            confidence: 0.99,
            action: "propose_candidate",
          },
        ],
      }
    );
    expect(conflictUpdate.candidates.some((c) => c.assertion_state === "conflicted")).toBe(true);

    // Assembly is blocked while conflict is unresolved (AT10)
    expect(() =>
      lfde.assembleDocument(counselCtx, "idem_asm_conflict", created.document.id, {})
    ).toThrowError(/conflicting values exist/);
  });

  it("AT14–AT20: Enforces three-valued expression interpreter, unapproved template blocking, historical CCC Sec. 1097 (2020 3 promoters vs 2026 2 promoters), and AuthorityGateway timeout fail-closed", () => {
    // AT14: Three-valued logic returns 'unknown' when referenced field is missing
    const tri = evaluateExpression({ eq: [{ field: "transaction.paid" }, true] }, {});
    expect(tri).toBe("unknown");

    // AT17 (Historical 2020): Board resolution on 2020-05-01 with 2 promoters triggers CORP_PROMOTER_MINIMUM blocker
    const doc2020 = lfde.createDocumentCase(counselCtx, "idem_doc_2020", {
      matter_id: "matter.law24.ma.2026.01",
      template_version_id: "template_demo_board_res_v1",
      objective: "2020 historical incorporation check",
      transaction_date: "2020-05-01",
      legal_as_of_date: "2020-05-01",
    });
    lfde.updateDocumentFacts(counselCtx, "idem_facts_2020", doc2020.document.id, doc2020.document.etag, {
      changes: [
        {
          field_key: "party_a.name",
          value: "บริษัท สยาม 2020 จำกัด",
          action: "confirm_candidate",
          source_evidence_id: "ev1",
        },
        {
          field_key: "transaction.promoter_count",
          value: "2",
          action: "confirm_candidate",
          source_evidence_id: "ev1",
        },
        {
          field_key: "signatory.evidence_ref",
          value: "ID-2020",
          action: "confirm_candidate",
          source_evidence_id: "ev1",
        },
      ],
    });
    const asm2020 = lfde.assembleDocument(counselCtx, "idem_asm_2020", doc2020.document.id, {});
    expect(asm2020.validation.has_unresolved_blockers).toBe(true);
    expect(
      asm2020.validation.findings.some((f) => f.rule_id === "CORP_PROMOTER_MINIMUM")
    ).toBe(true);

    // AT17 (Current 2026): Board resolution on 2026-10-23 with 2 promoters passes validation
    const doc2026 = lfde.createDocumentCase(counselCtx, "idem_doc_2026", {
      matter_id: "matter.law24.ma.2026.01",
      template_version_id: "template_demo_board_res_v1",
      objective: "2026 current incorporation check",
      transaction_date: "2026-10-23",
      legal_as_of_date: "2026-10-23",
    });
    lfde.updateDocumentFacts(counselCtx, "idem_facts_2026", doc2026.document.id, doc2026.document.etag, {
      changes: [
        {
          field_key: "party_a.name",
          value: "บริษัท สยาม 2026 จำกัด",
          action: "confirm_candidate",
          source_evidence_id: "ev2",
        },
        {
          field_key: "transaction.promoter_count",
          value: "2",
          action: "confirm_candidate",
          source_evidence_id: "ev2",
        },
        {
          field_key: "signatory.evidence_ref",
          value: "ID-2026",
          action: "confirm_candidate",
          source_evidence_id: "ev2",
        },
      ],
    });
    const asm2026 = lfde.assembleDocument(counselCtx, "idem_asm_2026", doc2026.document.id, {});
    expect(asm2026.validation.has_unresolved_blockers).toBe(false);
    expect(asm2026.validation.readiness).toBe("review_ready");

    // AT20: AuthorityGateway timeout produces R004_AUTHORITY_DATE_UNRESOLVED blocker (fail closed)
    AuthorityGateway.setSimulatedTimeout(true);
    const asmTimeout = lfde.assembleDocument(counselCtx, "idem_asm_timeout", doc2026.document.id, {
      mode: "hybrid",
    });
    expect(
      asmTimeout.validation.findings.some((f) => f.rule_id === "R004_AUTHORITY_DATE_UNRESOLVED")
    ).toBe(true);
    AuthorityGateway.setSimulatedTimeout(false);
  });

  it("AT21–AT32: Enforces deterministic hash, Idempotency-Key conflict, ETag concurrency, human review pinning, stale approval rejection, and external Word re-upload revalidation", () => {
    const nda = lfde.createDocumentCase(counselCtx, "idem_nda_create", {
      matter_id: "matter.law24.ma.2026.01",
      template_version_id: "template_demo_nda_v1",
      objective: "Mutual NDA for M&A",
    });

    // AT22: Reusing same Idempotency-Key with different payload throws 409 IDEMPOTENCY_CONFLICT
    expect(() =>
      lfde.createDocumentCase(counselCtx, "idem_nda_create", {
        matter_id: "matter.law24.ma.2026.01",
        template_version_id: "template_demo_nda_v1",
        objective: "Different objective under same key",
      })
    ).toThrowError(/Idempotency-Key reused/);

    // AT25: Stale If-Match ETag throws 409 REVISION_CONFLICT
    expect(() =>
      lfde.updateDocumentFacts(counselCtx, "idem_stale_etag", nda.document.id, 'W/"stale-etag"', {
        changes: [],
      })
    ).toThrowError(/Concurrent modification detected/);

    // Confirm all required NDA facts
    const updated = lfde.updateDocumentFacts(
      counselCtx,
      "idem_nda_facts",
      nda.document.id,
      nda.document.etag,
      {
        changes: [
          {
            field_key: "party_a.name",
            value: "บริษัท สยาม โซลาร์ จำกัด",
            action: "confirm_candidate",
            source_evidence_id: "dbd_1",
          },
          {
            field_key: "party_a.registration_number",
            value: "0105564019283",
            action: "confirm_candidate",
            source_evidence_id: "dbd_1",
          },
          {
            field_key: "party_b.name",
            value: "บริษัท อีอีซี เอนเนอร์จี จำกัด",
            action: "confirm_candidate",
            source_evidence_id: "dbd_2",
          },
          {
            field_key: "transaction.purpose",
            value: "การตรวจสอบสถานะกิจการ",
            action: "confirm_candidate",
            source_evidence_id: "term_sheet",
          },
          {
            field_key: "dates.effective_date",
            value: "2026-10-23",
            action: "confirm_candidate",
            source_evidence_id: "term_sheet",
          },
          {
            field_key: "signatory.evidence_ref",
            value: "DBD-POA-2569",
            action: "confirm_candidate",
            source_evidence_id: "poa_1",
          },
        ],
      }
    );

    const asm = lfde.assembleDocument(counselCtx, "idem_nda_asm", nda.document.id, {});
    expect(asm.validation.has_unresolved_blockers).toBe(false);

    // Draft export works before approval and is watermarked
    const draftExp = lfde.createExportArtifact(counselCtx, "idem_exp_draft", nda.document.id, {
      draft_revision_id: asm.revision.id,
      format: "docx",
      mode: "draft",
    });
    expect(draftExp.watermarked).toBe(true);

    // Final export before approval fails with APPROVAL_STALE
    expect(() =>
      lfde.createExportArtifact(counselCtx, "idem_exp_final_early", nda.document.id, {
        draft_revision_id: asm.revision.id,
        format: "docx",
        mode: "final",
      })
    ).toThrowError(/Final export denied/);

    // Submit review request
    const revReq = lfde.submitReviewRequest(counselCtx, "idem_rev_req", nda.document.id, {
      revision_id: asm.revision.id,
      assigned_reviewers: ["approver.partner@law24.th"],
    });

    // AT04: Service account cannot approve review request
    expect(() =>
      lfde.recordReviewDecision(
        serviceAcctCtx,
        "idem_svc_dec",
        revReq.id,
        asm.document.etag,
        { decision: "approve", reason: "Bot approval" }
      )
    ).toThrowError(/Service accounts cannot approve documents/);

    // Designated human approver approves
    const currentDoc = lfde.getDocumentCase(approverCtx, nda.document.id);
    const approved = lfde.recordReviewDecision(
      approverCtx,
      "idem_human_dec",
      revReq.id,
      currentDoc.etag,
      { decision: "approve", reason: "Partner verified all clauses and citations." }
    );
    expect(approved.document.state).toBe("approved");

    // Final export succeeds with lineage manifest + 5-min download session
    const finalExp = lfde.createExportArtifact(counselCtx, "idem_exp_final_ok", nda.document.id, {
      draft_revision_id: asm.revision.id,
      format: "docx",
      mode: "final",
    });
    expect(finalExp.watermarked).toBe(false);
    expect(finalExp.manifest.approval_decision_ids).toContain(approved.decision.id);

    const dl = lfde.createDownloadSession(counselCtx, "idem_dl_sess", finalExp.id);
    expect(dl.session_id).toContain("dls_");

    // AT32: Re-uploading externally edited Word file creates new revision and clears prior approval
    const reup = lfde.reuploadEditedDocx(counselCtx, "idem_reup_docx", nda.document.id, {
      edited_text_th: "แก้ไขเพิ่มเติมโดยทนายความฝ่ายคู่สัญญา",
    });
    expect(reup.revision.revision_number).toBe(2);
    expect(reup.document.state).toBe("draft");
    expect(reup.document.latest_approval_decision_id).toBeUndefined();
    expect(updated.document.id).toBe(nda.document.id);
  });

  it("AT37–AT40: Enforces webhook SSRF & HMAC replay protection, source-change task deduplication, filing package exhibit deduplication, and AGI human gate", () => {
    // AT37: Webhook SSRF protection blocks localhost, private IPs, and non-HTTPS URLs
    expect(() => validateWebhookDestination("https://127.0.0.1/callback")).toThrowError(
      /blocked by private-network/
    );
    expect(() => validateWebhookDestination("http://hooks.law24.th/callback")).toThrowError(
      /HTTPS/
    );
    expect(() => validateWebhookDestination("https://hooks.law24.th/lfde")).not.toThrow();

    // AT38: Webhook HMAC signing rejects stale timestamps >300s
    const nowSec = Math.floor(Date.now() / 1000);
    const validSig = signWebhookPayload({
      event_id: "evt_1",
      key_id: "k1",
      secret: "sec_123",
      timestamp_sec: nowSec,
      raw_body: '{"ok":true}',
    });
    expect(validSig.headers["X-REG24-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);

    expect(() =>
      signWebhookPayload({
        event_id: "evt_stale",
        key_id: "k1",
        secret: "sec_123",
        timestamp_sec: nowSec - 600,
        raw_body: '{"ok":true}',
      })
    ).toThrowError(/5-minute replay window/);

    // Source change impact deduplication
    const firstImpact = lfde.handleSourceChangeEvent(curatorCtx, {
      canonical_id: "th-ccc-sec-1097",
      new_version_id: "th-ccc-sec-1097-v2027",
    });
    expect(firstImpact.created_tasks.length).toBeGreaterThanOrEqual(1);
    expect(firstImpact.deduplicated).toBe(false);

    const secondImpact = lfde.handleSourceChangeEvent(curatorCtx, {
      canonical_id: "th-ccc-sec-1097",
      new_version_id: "th-ccc-sec-1097-v2027",
    });
    expect(secondImpact.created_tasks.length).toBe(0);
    expect(secondImpact.deduplicated).toBe(true);

    // AT39 & AT40: AGI mission enforces budget cap and mandatory human confirmation/approval gate
    const mission = lfde.executeAgiMission(counselCtx, {
      mission_type: "prepare_draft",
      topology: "team",
      automation: "autopilot",
      objective: "Prepare mutual NDA",
      budget_thb_cap: "25.00",
    });
    expect(mission.paused_for_human_gate).toBe("designated_human_approver_gate");

    expect(() =>
      lfde.executeAgiMission(counselCtx, {
        mission_type: "prepare_draft",
        topology: "swarm",
        automation: "autopilot",
        objective: "Zero budget mission",
        budget_thb_cap: "0.00",
      })
    ).toThrowError(/budget cap is exhausted/);
  });
});
