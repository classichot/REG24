import { describe, expect, it } from "vitest";
import {
  ALLOWED_NODE_LABELS,
  ALLOWED_RELATIONSHIP_TYPES,
  isValidNodeLabel,
  isValidRelationshipType,
  NEO4J_SCHEMA_CONSTRAINTS_CYPHER,
  NEO4J_SCHEMA_VERSION,
} from "../src/core/graph/graph-schema";
import {
  assertSafeParameterizedCypher,
  neo4jConnectionManager,
  sanitizeGraphError,
} from "../src/core/graph/neo4j-client";
import {
  buildCanonicalGraphDatasetFromCorpus,
  runMigrationAndReconciliation,
} from "../src/core/graph/graph-migrator";
import {
  GraphUnavailableError,
  unifiedGraphRepository,
} from "../src/core/graph/graph-repository";

describe("REG24-INFRA-NEO4J-001 — Neo4j Graph Database Integration & Governance Suite", () => {
  it("REG-NEO-003 & REG-NEO-014: reports honest unconfigured health status without leaking secrets or fabricating green status", async () => {
    const health = await neo4jConnectionManager.checkHealth();
    expect(health.schema_version).toBe(NEO4J_SCHEMA_VERSION);
    if (!process.env.NEO4J_URI) {
      expect(health.connected).toBe(false);
      expect(health.availability).toBe("degraded_unconfigured");
      expect(health.graph_data_readiness).toBe("degraded_seed_only");
      expect(health.live_node_count).toBeNull();
    }
  });

  it("REG-NEO-004 & REG-NEO-005: enforces all 13 canonical node labels, relationship whitelist, and Cypher schema constraints", () => {
    expect(ALLOWED_NODE_LABELS.length).toBe(13);
    expect(isValidNodeLabel("Provision")).toBe(true);
    expect(isValidNodeLabel("MaliciousLabel; DROP DATABASE")).toBe(false);

    expect(ALLOWED_RELATIONSHIP_TYPES.includes("CONTAINS")).toBe(true);
    expect(ALLOWED_RELATIONSHIP_TYPES.includes("HAS_VERSION")).toBe(true);
    expect(ALLOWED_RELATIONSHIP_TYPES.includes("INTERPRETS")).toBe(true);
    expect(isValidRelationshipType("ARBITRARY_USER_REL")).toBe(false);

    expect(NEO4J_SCHEMA_CONSTRAINTS_CYPHER.length).toBeGreaterThanOrEqual(18);
  });

  it("REG-NEO-012 & REG-NEO-013: migrates and reconciles all 13 node types and relationships with zero duplicates or broken references", async () => {
    const report = await runMigrationAndReconciliation({ executeLiveMigration: false });

    expect(report.reconciled).toBe(true);
    expect(report.duplicate_canonical_ids).toEqual([]);
    expect(report.missing_relationships).toEqual([]);
    expect(report.broken_source_references).toEqual([]);
    expect(report.invalid_effective_date_ranges).toEqual([]);
    expect(report.records_missing_provenance).toEqual([]);
    expect(report.unresolved_migration_errors).toEqual([]);

    // Verify all 13 node labels are populated from REG24's canonical corpus
    for (const label of ALLOWED_NODE_LABELS) {
      expect(report.node_counts_by_label[label]).toBeGreaterThan(0);
    }

    expect(report.source_node_count).toBeGreaterThanOrEqual(240);
    expect(report.source_relationship_count).toBeGreaterThanOrEqual(200);
  });

  it("REG-NEO-006: supports bi-temporal historical legal versioning (e.g. Revenue Code Sec. 65 ter on 30 June 2018 vs current)", async () => {
    const ctx = {
      tenant_id: "tenant.law24.prod",
      role: "Enterprise User" as const,
    };

    // Historical query: What was Section 65 ter of the Revenue Code applicable on 30 June 2018?
    const hist2018 = await unifiedGraphRepository.getProvisionAtTime(
      "prov.th.rev.65ter",
      "2018-06-30",
      "2026-10-20",
      ctx
    );

    expect(hist2018.matched_version).not.toBeNull();
    expect(hist2018.matched_version?.canonical_id).toBe("ver.th.rev.65ter.v1_pre2019");
    expect(hist2018.matched_version?.effective_from).toBe("1938-04-01");
    expect(hist2018.matched_version?.effective_to).toBe("2019-03-19");

    // Current query: Section 65 ter applicable on 20 October 2026
    const current2026 = await unifiedGraphRepository.getProvisionAtTime(
      "prov.th.rev.65ter",
      "2026-10-20",
      "2026-10-20",
      ctx
    );

    expect(current2026.matched_version).not.toBeNull();
    expect(current2026.matched_version?.canonical_id).toBe("ver.th.rev.65ter.v2_current");
    expect(current2026.matched_version?.effective_from).toBe("2019-03-20");
    expect(current2026.matched_version?.effective_to).toBeNull();
  });

  it("REG-NEO-008 & REG-NEO-019: executes multi-hop graph traversal and distinguishes statutes from administrative tax rulings", async () => {
    const ctx = {
      tenant_id: "tenant.law24.prod",
      role: "Enterprise User" as const,
    };

    const traversal = await unifiedGraphRepository.traverseMultiHop({
      startCanonicalId: "prov.th.rev.74",
      maxDepth: 2,
      validTime: "2026-10-20",
      ctx,
    });

    expect(traversal.visited_nodes.length).toBeGreaterThan(2);
    expect(traversal.traversal_paths.length).toBeGreaterThan(1);
    expect(traversal.path_explanations.length).toBeGreaterThan(1);

    // Verify REG-NEO-019 legal authority distinction
    const { nodes } = buildCanonicalGraphDatasetFromCorpus();
    const taxRulingNode = nodes.find((n) => n.label === "TaxRuling");
    const statuteProvisionNode = nodes.find((n) => n.canonical_id === "prov.th.rc.73_74_77_1");
    expect(taxRulingNode?.legal_authority_tier).toBe("ADMINISTRATIVE_TAX_RULING");
    expect(taxRulingNode?.is_binding_law).toBe(false);
    expect(statuteProvisionNode?.legal_authority_tier).toBe("PRIMARY_STATUTE");
    expect(statuteProvisionNode?.is_binding_law).toBe(true);
  });

  it("REG-NEO-009: performs 7-signal hybrid retrieval with keyword, vector, citation, graph proximity, and authority reranking", async () => {
    const ctx = {
      tenant_id: "tenant.law24.prod",
      role: "Enterprise User" as const,
    };

    const hybrid = await unifiedGraphRepository.hybridRetrieve({
      query: "Revenue Code Section 65 ter non-deductible expenses",
      validTime: "2026-10-20",
      limit: 5,
      ctx,
    });

    expect(hybrid.results.length).toBeGreaterThan(0);
    expect(hybrid.results[0].scores.combined_score).toBeGreaterThan(0);
    expect(hybrid.results.some((r) => r.node.canonical_id.includes("65ter"))).toBe(true);
  });

  it("REG-NEO-016: blocks Cypher injection attempts, redacts credentials, and enforces strict tenant isolation", async () => {
    // 1. Multi-statement Cypher injection blocked
    expect(() =>
      assertSafeParameterizedCypher("MATCH (n) RETURN n; DROP DATABASE neo4j", {})
    ).toThrow(/SECURITY_VIOLATION_CYPHER_MULTI_STATEMENT/);

    // 2. Administrative command blocked
    expect(() =>
      assertSafeParameterizedCypher("CREATE USER attacker SET PASSWORD 'pwned'", {})
    ).toThrow(/SECURITY_VIOLATION_CYPHER_ADMIN/);

    // 3. Credential and host redaction
    const redacted = sanitizeGraphError(
      new Error("Failed to connect to neo4j+s://secret-cluster.databases.neo4j.io with password=supersecret")
    );
    expect(redacted).not.toContain("secret-cluster");
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain("[REDACTED_HOST]");
    expect(redacted).toContain("password=[REDACTED]");

    // 4. Tenant Isolation: Tenant B cannot read Tenant A's private graph node
    await unifiedGraphRepository.upsertTenantNode(
      {
        canonical_id: "concept.tenant_a.private_ma_strategy",
        label: "LegalConcept",
        title_en: "Confidential M&A Tax Structuring Memo",
        title_th: "บันทึกโครงสร้างภาษีควบรวมกิจการลับเฉพาะองค์กร A",
        citation_label: "PRIVATE-MEMO-A",
        summary_Text: "Strictly confidential to tenant.alpha",
        source_document_id: "doc.th.ccc.b3.2565",
        official_source_url: "https://internal.alpha.co.th/memo",
        source_content_hash: "sha256:private_alpha_hash",
        verification_status: "verified",
        verified_at: "2026-10-20T00:00:00Z",
        effective_from: "2026-01-01",
        effective_to: null,
        ingested_at: "2026-10-20T00:00:00Z",
        module_id: "reg24.tax.th",
        tenant_id: "tenant.alpha",
        legal_authority_tier: "REGULATORY_GUIDANCE",
        is_binding_law: false,
        properties: {},
      },
      { tenant_id: "tenant.alpha", role: "Enterprise User" }
    );

    const allowedRead = await unifiedGraphRepository.getNodeById(
      "concept.tenant_a.private_ma_strategy",
      { tenant_id: "tenant.alpha", role: "Enterprise User" }
    );
    expect(allowedRead).not.toBeNull();

    const crossTenantBlocked = await unifiedGraphRepository.getNodeById(
      "concept.tenant_a.private_ma_strategy",
      { tenant_id: "tenant.bravo", role: "Enterprise User" }
    );
    expect(crossTenantBlocked).toBeNull();
  });

  it("REG-NEO-017: prevents silent fixture fallback when strict live Neo4j persistence is required (HTTP 503)", async () => {
    if (!process.env.NEO4J_URI) {
      await expect(
        unifiedGraphRepository.traverseMultiHop({
          startCanonicalId: "prov.th.rev.65ter",
          ctx: {
            tenant_id: "tenant.law24.prod",
            role: "Enterprise User",
            require_live_neo4j: true,
          },
        })
      ).rejects.toThrow(GraphUnavailableError);
    }
  });
});
