import { describe, it, expect } from "vitest";
import { reusableLegalKnowledgeLibrary } from "../src/core/library/legal-knowledge-library";

describe("REG24-KL-001 Expert Legal Commentary Intelligence & Reusable Legal Knowledge Library", () => {
  it("LIB-01, LIB-05, LIB-06, LIB-15: enforces strict separation between binding authority and secondary opinions", () => {
    const snapshot = reusableLegalKnowledgeLibrary.getLibrarySnapshot("tenant.law24.prod", "REG24");

    expect(snapshot.specificationId).toBe("REG24-KL-001");
    expect(snapshot.kpis.totalLibraryDocuments).toBe(248);
    expect(snapshot.kpis.connected24SeriesApps).toEqual(["REG24", "LAW24", "TP24", "ACC24", "CFO24"]);
    expect(snapshot.commentaries.every((d) => d.authorityClass === "secondary_opinion")).toBe(true);
    expect(snapshot.opinions.every((o) => o.isBindingAuthority === false)).toBe(true);
    expect(snapshot.hierarchicalChunks.every((c) => c.isBindingAuthority === false)).toBe(true);
  });

  it("LIB-02, LIB-03, LIB-04: supports bulk PDF ingestion, Thai OCR page/footnote preservation, and lifecycle transitions", () => {
    const registered = reusableLegalKnowledgeLibrary.registerAndIngestDocument({
      tenantId: "tenant.law24.prod",
      title: "Thai Transfer Pricing & Intra-Group Services Commentary (2026 Special Edition)",
      titleTh: "คำอธิบายภาษีการกำหนดราคาโอนและค่าบริการภายในกลุ่มบริษัท (พ.ศ. 2569)",
      authors: ["Assoc. Prof. Dr. Nattapong Sriwong"],
      publisher: "Chulalongkorn Tax Law Review Press",
      edition: "1st Edition (2026)",
      publicationDate: "2026-07-01",
      sourceType: "textbook",
      sourceFormat: "SEARCHABLE_PDF",
      legalTopics: ["Transfer Pricing Section 71 bis", "Management Fees", "Section 65 ter"],
      citedProvisions: ["prov.th.rev.65ter", "prov.th.rev.70"],
      rightsHolder: "Chulalongkorn Tax Law Review Press",
      rightsVerified: true,
      sampleTextTh:
        "การพิสูจน์ค่าธรรมเนียมการบริหารจัดการตามมาตรา 65 ตรี (13) และมาตรา 71 ทวิ ต้องมีหลักฐานการให้บริการจริงและผลประโยชน์โดยตรงต่อผู้เสียภาษีในไทย",
      sampleTextEn:
        "Substantiating management fees under Section 65 ter (13) and Section 71 bis requires concrete service deliverables and direct benefit to the Thai taxpayer.",
      pageStart: 10,
      pageEnd: 28,
    });

    expect(registered.document.authorityClass).toBe("secondary_opinion");
    expect(registered.document.corpusPartition).toBe("SECONDARY_OPINION_CORPUS");
    expect(registered.document.lifecycleStatus).toBe("PUBLISHED");
    expect(registered.license.status).toBe("ACTIVE");
    expect(registered.ingestionJob.transitions.length).toBeGreaterThanOrEqual(1);
    expect(registered.document.ocrConfidence).toBeGreaterThanOrEqual(98.0);
  });

  it("LIB-10: blocks unlicensed/quarantined documents and prompt-injection payloads from retrieval", () => {
    const quarantinedResult = reusableLegalKnowledgeLibrary.registerAndIngestDocument({
      tenantId: "tenant.law24.prod",
      title: "Unlicensed Scanned Tax Notebook",
      authors: ["Unknown"],
      sourceType: "article",
      rightsVerified: false,
    });

    expect(quarantinedResult.document.lifecycleStatus).toBe("QUARANTINED");
    expect(quarantinedResult.license.status).toBe("QUARANTINED");

    const accessCheck = reusableLegalKnowledgeLibrary.checkAccessPermission({
      documentId: quarantinedResult.document.id,
      tenantId: "tenant.law24.prod",
      consumingApp: "TP24",
      requestedOperation: "SEARCH",
    });
    expect(accessCheck.allowed).toBe(false);

    const answer = reusableLegalKnowledgeLibrary.searchAndSynthesizeAuthorityAwareAnswer({
      query: "Management Fee Section 65 ter",
      tenantId: "tenant.law24.prod",
      consumingApp: "TP24",
    });

    const leakedQuarantined = answer.expertCommentary.some(
      (c) => c.commentaryId === quarantinedResult.document.id
    );
    expect(leakedQuarantined).toBe(false);
    expect(answer.permissionAudit.zeroUnauthorizedDisclosures).toBe(true);
  });

  it("LIB-08: detects potentially outdated commentary published before statutory amendments", () => {
    const freshness = reusableLegalKnowledgeLibrary.checkLegalFreshness({
      documentOrOpinionId: "doc.kl.tax.treatise.2017.ed6",
    });

    expect(freshness.potentiallyOutdatedCount).toBe(1);
    expect(freshness.assessments[0].temporalStatus).toBe("POTENTIALLY_OUTDATED");
    expect(freshness.assessments[0].isSafeForCurrentLawWithoutWarning).toBe(false);
    expect(freshness.assessments[0].supersededByEdition).toContain("doc.kl.tax.treatise.2026.ed9");
  });

  it("LIB-09 & RET-01: produces 6-part authority-aware legal answer with page-level citations and non-binding safeguard", () => {
    const answer = reusableLegalKnowledgeLibrary.searchAndSynthesizeAuthorityAwareAnswer({
      query: "Management Fee deductibility Section 65 ter 71 bis",
      tenantId: "tenant.law24.prod",
      consumingApp: "REG24",
      includeOutdatedHistorical: true,
    });

    expect(answer.legalConclusion.authoritySeparationGuarantee).toContain(
      "never override authoritative sources"
    );
    expect(answer.applicableAuthorities.length).toBeGreaterThan(0);
    expect(answer.expertCommentary.length).toBeGreaterThan(0);
    expect(
      answer.expertCommentary.every(
        (op) => op.visualBadgeLabel === "SECONDARY OPINION • NON-BINDING PERSUASIVE COMMENTARY"
      )
    ).toBe(true);
    expect(answer.alternativePositions.length).toBeGreaterThanOrEqual(2);
    expect(answer.practicalImplications.length).toBeGreaterThan(0);
    expect(answer.verifiedCitations.length).toBeGreaterThan(0);
  });

  it("LIB-07, LIB-11, LIB-12, LIB-13, LIB-14: supports Graph RAG, Opinion Comparison, and Verified Citations", () => {
    const comparison = reusableLegalKnowledgeLibrary.compareLegalOpinions(
      "issue.kl.tax.management_fee_deductibility"
    );
    expect(comparison.relatedProvisions.length).toBeGreaterThan(0);
    expect(comparison.secondaryOpinionsCompared.length).toBeGreaterThanOrEqual(3);
    expect(comparison.authorityHierarchyRuleNotice).toContain("Primary Legislation");

    const graph = reusableLegalKnowledgeLibrary.getKnowledgeGraphForEntity({
      entityId: "prov.th.rev.65ter",
      tenantId: "tenant.law24.prod",
      consumingApp: "REG24",
    });
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.supportedNodeTypes).toContain("Commentary");
    expect(graph.supportedRelationships).toContain("INTERPRETS");

    const citation = reusableLegalKnowledgeLibrary.getVerifiedCitationById({
      citationOrDocumentId: "doc.kl.tax.treatise.2026.ed9",
      tenantId: "tenant.law24.prod",
      consumingApp: "LAW24",
    });
    expect(citation.status).toBe("ok");
    if (citation.status === "ok" && citation.pageProvenance) {
      expect(citation.isBindingAuthority).toBe(false);
      expect(citation.pageProvenance.printedPageStart).toBe("214");
      expect(citation.immutableContentHash).toContain("sha256:");
    }
  });

  it("KL-ACC-01..KL-ACC-06: passes all 6 release acceptance gates", () => {
    const gates = reusableLegalKnowledgeLibrary.runAcceptanceGates();
    expect(gates.length).toBe(6);
    expect(gates.every((g) => g.passed)).toBe(true);
  });
});
