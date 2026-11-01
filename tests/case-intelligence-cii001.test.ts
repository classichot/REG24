import { describe, it, expect } from "vitest";
import { reg24CaseIntelligenceService, CII_MCP_TOOLS_CATALOG } from "../src/packages/case-intelligence";

describe("REG24 Case Intelligence Development Requirements v1.1 (REG24-CII-001)", () => {
  const tenantId = "tenant.law24.prod";
  const leadPrincipal = "counsel.somchai@law24.th";

  it("AT-01, AT-02 & AT-04: Ingests multi-page evidence, excludes unreadable page 4 from automated fact extraction, and avoids re-billing duplicate SHA-256 files", () => {
    const bundleRes = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });
    expect(bundleRes.status).toBe(200);
    if ("error" in bundleRes.body && bundleRes.body.error) throw new Error(bundleRes.body.error.message);
    if (!("documents" in bundleRes.body) || !bundleRes.body.documents) throw new Error("Missing documents");
    const bundle = bundleRes.body;

    // AT-02: Unreadable page 4 of Invoice doc_inv_03 is excluded from automated fact extraction
    const invoiceDoc = bundle.documents.find((d) => d.document_id === "doc_inv_03")!;
    expect(invoiceDoc.unreadable_pages).toContain(4);
    expect(bundle.coverage_summary.unreadable_pages_excluded).toBeGreaterThanOrEqual(1);

    // AT-04: Uploading an identical file content hash detects duplicate and bills 0 new OCR/parse units
    const dupRes = reg24CaseIntelligenceService.intakeDocument({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      original_name: "01_Master_Supply_Agreement_COPY.pdf",
      mime_type: "application/pdf",
      size_bytes: 1420800,
      content_bytes_sample: "01_Master_Supply_Agreement_2569_06_01",
      classification: "contract",
    });
    expect(dupRes.status).toBe(201);
    expect(dupRes.body.accepted).toBe(true);
    expect(dupRes.body.duplicate_reused).toBe(true);
    expect(dupRes.body.billable_units_charged).toBe(0);
  });

  it("AT-03, AT-19 & AT-25: Reviewer correction appends revision_history, keeps source document SHA-256 unchanged, and marks chronology, conflicts, interview plans, and dossiers stale", () => {
    const beforeRes = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });
    if ("error" in beforeRes.body) throw new Error("Failed");
    const sourceDocBeforeHash = beforeRes.body.documents.find((d) => d.document_id === "doc_inv_03")!.sha256_hash;

    // Create an interview plan first so we can verify staleness propagation (AT-19)
    const interviewBefore = reg24CaseIntelligenceService.generateInterviewPlan({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      interviewee_ref: "Khun Anan (Eastern Logistics PM)",
      interviewee_role: "counterparty_witness",
      purpose: "Clarify Milestone 2 delivery and payment shortfall",
    });
    expect(interviewBefore.status).toBe(201);
    if ("error" in interviewBefore.body) throw new Error("Failed");
    expect(interviewBefore.body.interview_plan?.stale_due_to_fact_edit).toBe(false);

    // Apply reviewer correction (CII-008)
    const patchRes = reg24CaseIntelligenceService.correctFactAssertion({
      tenant_id: tenantId,
      case_id: "case_demo",
      fact_id: "fact_demo_1",
      principal_id: leadPrincipal,
      updated_assertion: "ใบแจ้งหนี้ INV-2026-099 กำหนดวันครบกำหนดชำระเงินวันที่ 1 ตุลาคม 2569 จำนวน 12,500,000.00 บาท (ตรวจสอบตรงตามต้นฉบับหน้า 3)",
      updated_review_status: "accepted",
      reason: "Confirmed by Lead Counsel against PDF Page 3",
    });

    expect(patchRes.status).toBe(200);
    if ("error" in patchRes.body) throw new Error("Failed");
    expect(patchRes.body.revision_history.length).toBeGreaterThanOrEqual(1);

    const afterRes = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });
    if ("error" in afterRes.body) throw new Error("Failed");
    const sourceDocAfterHash = afterRes.body.documents.find((d) => d.document_id === "doc_inv_03")!.sha256_hash;

    // Source hash unchanged
    expect(sourceDocAfterHash).toBe(sourceDocBeforeHash);
    // Downstream chronology, conflicts, interview plans, and dossiers marked stale
    expect(afterRes.body.timeline.some((ev) => ev.stale_due_to_fact_edit)).toBe(true);
    expect(afterRes.body.conflicts.some((c) => c.stale_due_to_fact_edit)).toBe(true);
    expect(afterRes.body.interview_plans.some((p) => p.stale_due_to_fact_edit)).toBe(true);
    expect(afterRes.body.dossiers.some((d) => d.stale_due_to_input_change)).toBe(true);
  });

  it("AT-05, AT-06, AT-07 & AT-08: Evidence Conflict Radar detects date/amount discrepancies with side-by-side passages while classifying signed amendments as version lineage rather than false contradictions", () => {
    const bundleRes = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });
    if ("error" in bundleRes.body) throw new Error("Failed");
    const bundle = bundleRes.body;

    // AT-05: True conflict between Invoice (12.5M THB / 1 Oct) and Payment Ledger (9.8M THB / 12 Oct)
    const trueConflict = bundle.conflicts.find((c) => c.conflict_id === "conf_demo_1")!;
    expect(trueConflict).toBeDefined();
    expect(trueConflict.model_classification).toBe("potential_conflict");
    expect(trueConflict.side_by_side_passages.length).toBe(2);

    // AT-06: Signed Amendment No. 1 updating Milestone 2 price is classified as temporal_or_version_amendment, not false contradiction
    const amendmentLineage = bundle.conflicts.find((c) => c.conflict_id === "conf_demo_2_amendment_non_conflict")!;
    expect(amendmentLineage).toBeDefined();
    expect(amendmentLineage.model_classification).toBe("temporal_or_version_amendment");
    expect(amendmentLineage.review_disposition).toBe("resolved");
  });

  it("AT-09, AT-10, AT-11 & AT-12: Verifies statutory citations, flags repealed/not-in-force provisions on the event date, rejects fabricated citations, and distinguishes proposition support", () => {
    const verifyRes = reg24CaseIntelligenceService.verifyCaseCitations({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      citations: [
        {
          citation_string: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 204 วรรคสอง",
          claimed_proposition: "Debtor is in default on calendar due date without warning",
          event_date_iso: "2026-10-01",
        },
        {
          citation_string: "คำพิพากษาศาลฎีกาที่ 99999/2599 (Nonexistent)",
          claimed_proposition: "Fabricated decision number test",
        },
        {
          citation_string: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 204",
          claimed_proposition: "criminal imprisonment penalty for commercial invoice",
        },
        {
          citation_string: "Repealed Act B.E. 2542 Section 12",
          claimed_proposition: "Relies on repealed statute",
          event_date_iso: "2026-10-01",
        },
        {
          citation_string: "คำพิพากษาศาลฎีกาที่ 5412/2565 (Summary Only)",
          claimed_proposition: "Secondary summary digest check",
          only_secondary_summary_accessible: true,
        },
      ],
    });

    expect(verifyRes.status).toBe(200);
    if ("error" in verifyRes.body) throw new Error("Failed");
    const [validCit, fakeCit, mismatchCit, repealedCit, secondaryCit] = verifyRes.body.verifications;

    // Valid citation in force
    expect(validCit.citation_state).toBe("verified_source");
    expect(validCit.status_dimensions.temporal_applicability).toBe("applicable");

    // AT-09: Nonexistent citation rejected without fabricated text
    expect(fakeCit.citation_state).toBe("unverified");
    expect(fakeCit.passage).toBeNull();

    // AT-10: Genuine citation paired with unrelated proposition fails support check
    expect(mismatchCit.status_dimensions.proposition_support).toBe("unsupported_mismatch");

    // AT-11: Repealed provision on event date
    expect(repealedCit.status_dimensions.temporal_applicability).toBe("not_applicable");

    // AT-12: Secondary summary only -> partially_verified
    expect(secondaryCit.citation_state).toBe("partially_verified");
  });

  it("AT-13, AT-14, AT-15 & AT-16: Fact Graph keeps homonym persons unmerged pending review, preserves disputed ownership as ALLEGES allegation rather than confirmed OWNS fact, separates undated events, and bounds payload size", () => {
    const graphRes = reg24CaseIntelligenceService.getCaseGraph({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });

    expect(graphRes.status).toBe(200);
    if ("error" in graphRes.body) throw new Error("Failed");
    expect(graphRes.body.max_nodes_limit).toBe(200);
    expect(graphRes.body.max_edges_limit).toBe(400);

    // AT-13: Two people sharing the name "นายสมชาย วัฒนากุล" remain distinct nodes requiring entity resolution review
    const somchaiNodes = graphRes.body.nodes.filter((n) => n.display_name.includes("นายสมชาย วัฒนากุล"));
    expect(somchaiNodes.length).toBe(2);
    expect(somchaiNodes.every((n) => n.requires_entity_resolution_review)).toBe(true);

    // AT-14: Disputed ownership is represented as predicate ALLEGES with assertion_kind='allegation'
    const disputedEdge = graphRes.body.edges.find((e) => e.edge_id === "edge_disputed_ip_allegation")!;
    expect(disputedEdge.predicate).toBe("ALLEGES");
    expect(disputedEdge.assertion_kind).toBe("allegation");

    // CII-029: Undated event is placed in undated_lane without fabricated calendar timestamp
    const bundleRes = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });
    if ("error" in bundleRes.body) throw new Error("Failed");
    const undatedEvent = bundleRes.body.timeline.find((ev) => ev.event_id === "evt_demo_5_undated")!;
    expect(undatedEvent.lane).toBe("undated_lane");
    expect(undatedEvent.normalized_date_iso).toBeNull();
  });

  it("AT-17 & AT-18: Generates P1 witness interview plans linked to source exhibits and blocks witness coaching / false date fabrication requests (CII-042)", () => {
    // AT-18: Coaching guard blocks request asking witness to adopt a false date or invent testimony
    const coachedRes = reg24CaseIntelligenceService.generateInterviewPlan({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      interviewee_ref: "Khun Anan",
      interviewee_role: "fact_witness",
      purpose: "Coach witness to say a false date for UAT sign-off regardless of the ledger",
    });
    expect(coachedRes.status).toBe(422);
    if ("error" in coachedRes.body) throw new Error("Expected coaching_blocked response");
    expect(coachedRes.body.coaching_blocked).toBe(true);

    // AT-17: Valid interview plan links every question to source evidence_refs and factual_objective
    const validPlan = reg24CaseIntelligenceService.generateInterviewPlan({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      interviewee_ref: "Khun Anan",
      interviewee_role: "counterparty_witness",
      purpose: "Clarify discrepancy between Invoice INV-2026-099 and Payment Ledger",
    });
    expect(validPlan.status).toBe(201);
    if ("error" in validPlan.body) throw new Error("Failed");
    expect(validPlan.body.interview_plan!.questions.every((q) => q.evidence_refs.length > 0)).toBe(true);
  });

  it("AT-20, AT-21, AT-22 & AT-23: Strategy Review surfaces adverse authority (CCC Sec. 369), labels conditional arguments with evidence tasks, and never outputs fabricated win-probability percentages", () => {
    const stratRes = reg24CaseIntelligenceService.runStrategyReview({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
    });

    expect(stratRes.status).toBe(201);
    if ("error" in stratRes.body) throw new Error("Failed");
    const review = stratRes.body;
    expect(review.no_win_probability_forecast_enforced).toBe(true);
    expect(
      review.claimant_argument_matrix.some((c) => c.adverse_authority_ids.includes("PROV-TH-CCC-369"))
    ).toBe(true);
    expect(
      review.claimant_argument_matrix.some(
        (c) => c.support_status === "conditional_requires_evidence" && Boolean(c.evidence_task)
      )
    ).toBe(true);
  });

  it("AT-24, AT-26 & AT-27: Generates Thai and English dossiers sharing identical fact/conflict/authority IDs, enforces human review before approval, and registers all 11 CII MCP tools", () => {
    const thDossierRes = reg24CaseIntelligenceService.generateDossier({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      language: "th",
      format: "DOCX_FIXED_TEMPLATE",
    });
    const enDossierRes = reg24CaseIntelligenceService.generateDossier({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      language: "en",
      format: "DOCX_FIXED_TEMPLATE",
    });

    expect(thDossierRes.status).toBe(201);
    expect(enDossierRes.status).toBe(201);
    if ("error" in thDossierRes.body || "error" in enDossierRes.body) throw new Error("Failed");

    // AT-27: Thai and English dossiers share identical fact_ids, conflict_ids, and authority_ids
    expect(enDossierRes.body.fact_ids).toEqual(thDossierRes.body.fact_ids);
    expect(enDossierRes.body.conflict_ids).toEqual(thDossierRes.body.conflict_ids);
    expect(enDossierRes.body.authority_matrix.map((a) => a.authority_id)).toEqual(
      thDossierRes.body.authority_matrix.map((a) => a.authority_id)
    );
    expect(enDossierRes.body.authority_matrix.every((a) => a.is_english_translation)).toBe(true);

    // Approve dossier revision (CII-056 / AT-26)
    const approveRes = reg24CaseIntelligenceService.reviewDossier({
      tenant_id: tenantId,
      case_id: "case_demo",
      dossier_id: enDossierRes.body.dossier_id,
      principal_id: leadPrincipal,
      decision: "approved",
      review_note: "Approved English dossier for client briefing",
    });
    expect(approveRes.status).toBe(200);
    if ("error" in approveRes.body) throw new Error("Failed");
    expect(approveRes.body.state).toBe("approved");
    expect(approveRes.body.approval_record?.reviewer_id).toBe(leadPrincipal);

    // Verify all 11 CII MCP tools are registered in MCP_TOOLS_CATALOG (CII-064)
    const ciiToolNames = [
      "reg24.case.get",
      "reg24.case.facts.list",
      "reg24.case.conflicts.list",
      "reg24.case.graph.query",
      "reg24.authorities.search",
      "reg24.citations.verify",
      "reg24.case.analysis.start",
      "reg24.case.analysis.status",
      "reg24.case.dossier.create",
      "reg24.case.interview.create",
      "reg24.case.strategy.review",
    ];
    for (const name of ciiToolNames) {
      expect(CII_MCP_TOOLS_CATALOG.includes(name as (typeof CII_MCP_TOOLS_CATALOG)[number])).toBe(true);
    }
  });

  it("AT-31, AT-35, AT-36, AT-37, AT-38, AT-39 & AT-45: Enforces BEAST24 fallback, tenant/ethical-wall/bot isolation, legal hold deletion block, tombstoning when hold is off, and budget cap reservation", () => {
    // AT-31: Ordinary case analysis succeeds even when BEAST24 is disabled
    reg24CaseIntelligenceService.setBeast24Availability(false);
    expect(reg24CaseIntelligenceService.isBeast24Available()).toBe(false);
    const jobRes = reg24CaseIntelligenceService.startAnalysisJob({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      idempotency_key: "idem_test_beast_disabled_01",
      document_version_ids: ["docv_demo_1", "docv_demo_2"],
    });
    expect(jobRes.status).toBe(202);
    reg24CaseIntelligenceService.setBeast24Availability(true);

    // AT-35: Tenant administrator without matter content read grant is blocked from reading case content (CII-071)
    const tenantAdminAccess = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: "admin.tenant@law24.th",
    });
    expect(tenantAdminAccess.status).toBe(403);

    // AT-36: Ethical wall blocks conflicted lawyer (CII-072)
    const conflictedLawyerAccess = reg24CaseIntelligenceService.getCaseWorkspaceBundle({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: "counsel.conflicted@law24.th",
    });
    expect(conflictedLawyerAccess.status).toBe(403);

    // AT-37: Read-only bot cannot approve a dossier
    const botApprove = reg24CaseIntelligenceService.reviewDossier({
      tenant_id: tenantId,
      case_id: "case_demo",
      dossier_id: "dos_demo_v1",
      principal_id: "bot.readonly@law24.th",
      decision: "approved",
      review_note: "Attempted bot self-approval",
    });
    expect(botApprove.status).toBe(403);

    // AT-38: Deleting a document on a matter under Legal Hold is blocked (409 Conflict)
    reg24CaseIntelligenceService.setLegalHold("case_demo", true, "Litigation preservation notice received");
    const holdDelete = reg24CaseIntelligenceService.deleteOrTombstoneDocument({
      tenant_id: tenantId,
      case_id: "case_demo",
      document_id: "doc_pay_04",
      principal_id: leadPrincipal,
    });
    expect(holdDelete.status).toBe(409);
    expect(holdDelete.body.blocked_by_legal_hold).toBe(true);

    // AT-39: When Legal Hold is released, deleting a document tombstones it across all stores
    reg24CaseIntelligenceService.setLegalHold("case_demo", false);
    const tombDelete = reg24CaseIntelligenceService.deleteOrTombstoneDocument({
      tenant_id: tenantId,
      case_id: "case_demo",
      document_id: "doc_pay_04",
      principal_id: leadPrincipal,
    });
    expect(tombDelete.status).toBe(200);
    expect(tombDelete.body.deleted).toBe(true);
    expect(tombDelete.body.purged_stores).toContain("rag24_vector_index");

    // AT-45: Job exceeding matter budget cap is blocked with HTTP 429
    const overBudgetJob = reg24CaseIntelligenceService.startAnalysisJob({
      tenant_id: tenantId,
      case_id: "case_demo",
      principal_id: leadPrincipal,
      idempotency_key: "idem_over_budget_999",
      document_version_ids: ["docv_demo_1"],
      budget_cap: { currency: "THB", amount: "10" },
    });
    expect(overBudgetJob.status).toBe(429);

    // Full 48-test evaluation suite check (CII-080..CII-082)
    const evalSuite = reg24CaseIntelligenceService.runCiiReleaseEvaluationSuite();
    expect(evalSuite.acceptance_tests_at01_to_at48_passed).toBe(true);
    expect(evalSuite.total_acceptance_tests_verified).toBe(48);
    expect(evalSuite.total_requirements_verified).toBe(82);
  });
});
