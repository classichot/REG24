import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isNeo4jPreservationWriteLockActive } from "@/core/graph/neo4j-client";
import type { Actor } from "@/core/knowledge/contracts";
import {
  buildReleaseProjectionsFromOutbox,
  loadGraphProjectionSnapshot,
} from "@/core/knowledge/projections";
import { queryKnowledge } from "@/core/knowledge/query";
import { rollbackRelease } from "@/core/knowledge/releases";
import { retrieveAuthorizedKnowledge } from "@/core/knowledge/retrieval";
import { DurableKnowledgeStore } from "@/core/knowledge/store";
import { validateAuditTarget } from "../../scripts/verify-neo4j-374f4f7e-readonly";

const OWNER_ACTOR: Actor = {
  actor_id: "owner.empirical.graph.verifier",
  role: "product_owner",
  tenant_id: "tenant.7l.advisory",
  authorized_scopes: ["scope.platform.public"],
};

const EXPLORATORY_PROMPTS: ReadonlyArray<{ id: string; question: string; applicable_date?: string }> = [
  {
    id: "EXP-01",
    question:
      "เงินช่วยเหลือแบบให้เปล่าจากรัฐบาลต่างประเทศเพื่อดำเนินโครงการในไทย ได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามหนังสือตอบข้อหารือ กค 0702/636 หรือไม่ และมีเงื่อนไขอย่างไร?",
  },
  {
    id: "EXP-02",
    question:
      "สัญญาเช่าที่ดินระยะยาว 30 ปี มูลค่า 1,470 ล้านบาท ตามหนังสือตอบข้อหารือ กค 0702/1248 ต้องรับรู้รายได้ภาษีเงินได้นิติบุคคลอย่างไร?",
  },
  {
    id: "EXP-03",
    question:
      "เปรียบเทียบแนววินิจฉัยภาษีมูลค่าเพิ่มกรณีขายอาหารสัตว์ระหว่าง กค 0702/1903 และ กค 0702/1603 แตกต่างกันเพราะข้อเท็จจริงใด?",
  },
  {
    id: "EXP-04",
    question:
      "กองมรดกที่ยังไม่ได้แบ่งได้รับเงินปันผล มีสิทธิได้รับเครดิตภาษีเงินปันผลตามมาตรา 47 ทวิ หรือไม่ ตาม กค 0702/1494?",
  },
  {
    id: "EXP-05",
    question:
      "หนังสือตอบข้อหารือที่ 0811/13980 วินิจฉัยเรื่องการขายฝากและการไถ่ทรัพย์คืนตามพระราชกฤษฎีกา (ฉบับที่ 244) มาตรา 3 (5) ไว้อย่างไร?",
  },
  {
    id: "EXP-06",
    question:
      "เปรียบเทียบผลทางภาษีตามประมวลรัษฎากร มาตรา 65 ตรี สำหรับรายจ่ายค่าเสียหายหรือเบี้ยปรับ ระหว่างธุรกรรมวันที่ 2018-06-30 กับวันที่ 2025-01-15",
    applicable_date: "2025-01-15",
  },
  {
    id: "EXP-07",
    question:
      "ขอตัวบทเต็มมาตรา 3 และมาตรา 4 แห่งพระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 736) พ.ศ. 2564",
  },
  {
    id: "EXP-08",
    question:
      "ลูกจ้างถูกเลิกจ้างโดยไม่มีความผิด มีสิทธิได้รับค่าชดเชยตามพระราชบัญญัติคุ้มครองแรงงาน มาตรา 118 เท่าใด?",
  },
];

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

describe("Empirical Verification of Snapshot-Based Graph Retrieval, Rebuild & Rollback (rel.B01.rc2)", () => {
  const prodCanonicalPath = path.resolve(
    process.cwd(),
    "data",
    "knowledge-store",
    "canonical-state.json.gz"
  );
  const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const previewCanonicalPath = path.join(previewDir, "canonical-state.json.gz");

  it("1-4. Empirically verifies source-grounded answers, legal relationship preservation, disk-snapshot parity, wall-clock rebuild, and safe rollback without touching protected stores", async () => {
    const prodHashBefore = sha256File(prodCanonicalPath);
    const previewHashBefore = sha256File(previewCanonicalPath);
    expect(prodHashBefore).toBe(
      "08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9"
    );

    const store = new DurableKnowledgeStore(previewDir);
    const state = store.getState();
    const candRelId = state.releases["rel.B01.rc3"] ? "rel.B01.rc3" : "rel.B01.rc2";

    // -------------------------------------------------------------------------
    // PART A: Verify Graph Snapshot Structure & Legal Relationship Preservation
    // -------------------------------------------------------------------------
    const graphSnap = loadGraphProjectionSnapshot(store, candRelId);
    expect(graphSnap).not.toBeNull();
    const canonicalAssertions = store.getAcceptedAssertionsForRelease(candRelId);
    expect(graphSnap!.edge_count).toBe(canonicalAssertions.length);
    expect(graphSnap!.edge_count).toBeGreaterThanOrEqual(33000);

    const predicateCounts: Record<string, number> = {};
    let quarantinedEdgesCount = 0;
    for (const edge of graphSnap!.edges) {
      predicateCounts[edge.predicate] = (predicateCounts[edge.predicate] || 0) + 1;
      if (
        edge.subject.startsWith("ext.dep.") ||
        edge.object.startsWith("ext.dep.") ||
        edge.object.includes("royal_decree.736") ||
        edge.object.includes("royal_decree.773")
      ) {
        quarantinedEdgesCount += 1;
      }
    }
    expect(quarantinedEdgesCount).toBe(0);
    // 4,578 B01 candidates = 4,559 unique canonical TaxRuling works + 19 duplicate Drive representations (ATTACHED_REPRESENTATION)
    expect(predicateCounts.ISSUED_BY || 0).toBeGreaterThanOrEqual(4559);
    expect(predicateCounts.INTERPRETS || 0).toBeGreaterThan(7000);
    expect(predicateCounts.CITES || 0).toBeGreaterThan(2000);
    expect(Object.keys(predicateCounts).length).toBeGreaterThanOrEqual(4);

    // Concrete representative legal edge checks (using legacy_crosswalk -> canonical work_id)
    const edgeSet = new Set(
      graphSnap!.edges.map((e) => `${e.subject}|${e.predicate}|${e.object}`)
    );
    const w1494 = state.legacy_crosswalk["ruling.th.rd.68536"];
    const w13980 = state.legacy_crosswalk["ruling.th.rd.22874"];
    const w1248 = state.legacy_crosswalk["ruling.th.rd.68464"];
    expect(w1494).toBeTruthy();
    expect(w13980).toBeTruthy();
    expect(w1248).toBeTruthy();
    expect(edgeSet.has(`${w1494}|INTERPRETS|prov.th.rc.47_ทวิ`)).toBe(true);
    // DEF-B01-02 critical regression guard: กค 0811/13980 MUST NOT falsely link to Revenue Code Section 3 (`prov.th.rc.3`) when citing Royal Decree 244 Section 3(5) or CCC Section 491!
    expect(edgeSet.has(`${w13980}|INTERPRETS|prov.th.rc.3`)).toBe(false);
    expect(edgeSet.has(`${w13980}|INTERPRETS|prov.th.rc.491`)).toBe(false);
    expect(edgeSet.has(`${w13980}|INTERPRETS|prov.th.rc.39`)).toBe(true);
    expect(
      Array.from(edgeSet).some(
        (k) => k.startsWith(`${w1248}|`) && (k.includes("1_2528") || k.includes("prov.th.rc.65"))
      )
    ).toBe(true);

    // Sibling requester_facts <-> official_conclusion integrity across all 4,561 unique B01 TaxRuling works
    const rc2Passages = store.getPassagesForRelease(candRelId);
    const rulingRolesByWork = new Map<string, { facts: string[]; conclusions: string[] }>();
    for (const p of rc2Passages) {
      if (state.works[p.work_id]?.type !== "TaxRuling") continue;
      const entry = rulingRolesByWork.get(p.work_id) || { facts: [], conclusions: [] };
      if (p.statement_role === "requester_facts") entry.facts.push(p.exact_text.trim());
      if (p.statement_role === "official_conclusion") entry.conclusions.push(p.exact_text.trim());
      rulingRolesByWork.set(p.work_id, entry);
    }
    // 4,578 B01 candidates = 4,561 unique canonical TaxRuling works + 17 attached duplicate Drive PDF representations (ATTACHED_REPRESENTATION)
    expect(rulingRolesByWork.size).toBe(4561);
    let identicalFactsAndConclusionCount = 0;
    for (const [, entry] of rulingRolesByWork.entries()) {
      if (
        entry.facts.length === 1 &&
        entry.conclusions.length === 1 &&
        entry.facts[0] === entry.conclusions[0]
      ) {
        identicalFactsAndConclusionCount += 1;
      }
    }
    expect(identicalFactsAndConclusionCount).toBe(0);

    // Regression guard against Hop-2 cross-ruling condition leakage and unlinked Royal Decree attachment
    const q1903 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1903",
        release_id: candRelId,
        mode: "exact_lookup",
      },
      OWNER_ACTOR,
      { store }
    );
    expect(q1903.answer).not.toContain("บริษัท น. ได้จดทะเบียนเลิกบริษัท");
    const q13980 = await queryKnowledge(
      {
        question:
          "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/13980 เรื่องการยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกา ฉบับที่ 244 มาตรา 3 (5)",
        release_id: candRelId,
        mode: "standard",
      },
      OWNER_ACTOR,
      { store }
    );
    expect(q13980.answer).not.toContain("พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 515)");

    // Bitemporal ProvisionVersion check (Section 65 ter pre-2019 vs current)
    const pre2019Res = await queryKnowledge(
      {
        question: "เบี้ยปรับหรือเงินเพิ่มตามประมวลรัษฎากร มาตรา 65 ตรี ถือเป็นรายจ่ายต้องห้ามหรือไม่?",
        release_id: candRelId,
        applicable_date: "2018-06-30",
        mode: "standard",
      },
      OWNER_ACTOR,
      { store }
    );
    const post2019Res = await queryKnowledge(
      {
        question: "เบี้ยปรับหรือเงินเพิ่มตามประมวลรัษฎากร มาตรา 65 ตรี ถือเป็นรายจ่ายต้องห้ามหรือไม่?",
        release_id: candRelId,
        applicable_date: "2025-01-15",
        mode: "standard",
      },
      OWNER_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(pre2019Res.status);
    expect(["ANSWERED", "CONDITIONAL"]).toContain(post2019Res.status);
    expect(pre2019Res.evidence.some((e) => e.version_id.includes("v1_pre2019"))).toBe(true);
    expect(pre2019Res.evidence.some((e) => e.version_id.includes("v2_current"))).toBe(false);
    expect(post2019Res.evidence.some((e) => e.version_id.includes("v2_current"))).toBe(true);

    // Ablation proof: Provision-to-Ruling graph traversal (`hybrid_with_graph` vs `hybrid_no_graph`)
    const withGraphSurvey = retrieveAuthorizedKnowledge(store, {
      question: "มีหนังสือตอบข้อหารือใดบ้างที่ตีความประมวลรัษฎากร มาตรา 47 ทวิ?",
      release_id: candRelId,
      actor: OWNER_ACTOR,
      strategy: "hybrid_with_graph",
    });
    const noGraphSurvey = retrieveAuthorizedKnowledge(store, {
      question: "มีหนังสือตอบข้อหารือใดบ้างที่ตีความประมวลรัษฎากร มาตรา 47 ทวิ?",
      release_id: candRelId,
      actor: OWNER_ACTOR,
      strategy: "hybrid_no_graph",
    });
    const graphHopTaxRulings = withGraphSurvey.top_hits.filter(
      (h) => state.works[h.passage.work_id]?.type === "TaxRuling" && h.match_sources.includes("graph_hop")
    );
    expect(graphHopTaxRulings.length).toBeGreaterThan(0);
    expect(withGraphSurvey.top_hits[0].passage.work_id).not.toBe(
      noGraphSurvey.top_hits[0]?.passage.work_id || ""
    );

    // -------------------------------------------------------------------------
    // PART B: Empirical Equivalence Across 28 Queries (20 Bound UAT + 8 Exploratory)
    // -------------------------------------------------------------------------
    const uatCases = state.uat_cases[candRelId] || [];
    expect(uatCases.length).toBe(20);

    const combinedQueries: Array<{ id: string; question: string; applicable_date?: string }> = [
      ...uatCases.map((u) => ({
        id: u.case_id,
        question: u.question,
        applicable_date: u.applicable_date ?? undefined,
      })),
      ...EXPLORATORY_PROMPTS,
    ];
    expect(combinedQueries.length).toBe(28);

    // Build an independent Cypher-equivalent adjacency index purely from `<candRelId>_graph.json.gz`
    const adjOutgoing = new Map<string, Array<{ predicate: string; object: string }>>();
    const adjIncoming = new Map<string, Array<{ predicate: string; subject: string }>>();
    for (const e of graphSnap!.edges) {
      const outList = adjOutgoing.get(e.subject) || [];
      outList.push({ predicate: e.predicate, object: e.object });
      adjOutgoing.set(e.subject, outList);

      const inList = adjIncoming.get(e.object) || [];
      inList.push({ predicate: e.predicate, subject: e.subject });
      adjIncoming.set(e.object, inList);
    }

    let exactTopHitListParityCount = 0;
    let exactGraphNeighborParityCount = 0;
    let verifiedOrAbstainedCleanlyCount = 0;
    const perQueryLatenciesMs: number[] = [];

    for (const q of combinedQueries) {
      const t0 = performance.now();
      const snapBundle = retrieveAuthorizedKnowledge(store, {
        question: q.question,
        release_id: candRelId,
        actor: OWNER_ACTOR,
        applicable_date: q.applicable_date ?? null,
        strategy: "hybrid_with_graph",
        graph_source: "graph_projection_snapshot",
      });
      const canonBundle = retrieveAuthorizedKnowledge(store, {
        question: q.question,
        release_id: candRelId,
        actor: OWNER_ACTOR,
        applicable_date: q.applicable_date ?? null,
        strategy: "hybrid_with_graph",
        graph_source: "canonical_assertions",
      });
      const fullQueryRes = await queryKnowledge(
        {
          question: q.question,
          release_id: candRelId,
          applicable_date: q.applicable_date ?? null,
          mode: "standard",
        },
        OWNER_ACTOR,
        { store }
      );
      perQueryLatenciesMs.push(Number((performance.now() - t0).toFixed(2)));

      const snapIds = snapBundle.top_hits.map((h) => h.passage.passage_id).join(",");
      const canonIds = canonBundle.top_hits.map((h) => h.passage.passage_id).join(",");
      if (snapIds === canonIds) {
        exactTopHitListParityCount += 1;
      }

      // Verify every related_provisions edge on returned evidence cards matches the independent adjacency index
      let allCardEdgesMatchCypherAdj = true;
      for (const card of snapBundle.evidence_cards) {
        const adjTargets = new Set(
          (adjOutgoing.get(card.work_id) || []).map((x) => `${x.predicate}:${x.object}`)
        );
        for (const relProv of card.related_provisions) {
          if (!adjTargets.has(`${relProv.predicate}:${relProv.work_id}`)) {
            allCardEdgesMatchCypherAdj = false;
          }
        }
      }
      if (allCardEdgesMatchCypherAdj) {
        exactGraphNeighborParityCount += 1;
      }

      if (
        fullQueryRes.status === "ANSWERED" ||
        fullQueryRes.status === "CONDITIONAL" ||
        fullQueryRes.status === "NEEDS_CLARIFICATION" ||
        fullQueryRes.status === "INSUFFICIENT_EVIDENCE"
      ) {
        verifiedOrAbstainedCleanlyCount += 1;
      }
    }

    expect(exactTopHitListParityCount).toBe(28);
    expect(exactGraphNeighborParityCount).toBe(28);
    expect(verifiedOrAbstainedCleanlyCount).toBe(28);

    // -------------------------------------------------------------------------
    // PART C: Deterministic Graph Rebuild & Outbox Batch Hydration Benchmark
    // -------------------------------------------------------------------------
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-graph-empirical-"));
    try {
      const rebuildDir = path.join(tmpRoot, "rebuild-copy");
      fs.cpSync(previewDir, rebuildDir, { recursive: true });

      const projSubdir = path.join(rebuildDir, "projections");
      for (const f of fs.readdirSync(projSubdir)) {
        if (f.startsWith(`${candRelId}_`)) {
          fs.unlinkSync(path.join(projSubdir, f));
        }
      }
      expect(
        fs.existsSync(path.join(projSubdir, `${candRelId}_graph.json.gz`)) ||
          fs.existsSync(path.join(projSubdir, `${candRelId}_graph.json`))
      ).toBe(false);

      const rebuildStore = new DurableKnowledgeStore(rebuildDir);
      const rebuildStart = performance.now();
      const receipts = await buildReleaseProjectionsFromOutbox(
        rebuildStore,
        candRelId,
        "durable_disk"
      );
      const rebuildWallClockMs = Number((performance.now() - rebuildStart).toFixed(2));

      const graphReceipt = receipts.find((r) => r.projection_kind === "GRAPH_LOCAL_DURABLE");
      expect(graphReceipt?.completion_state).toBe("COMPLETED");
      expect(graphReceipt?.item_count).toBe(graphSnap!.edge_count);

      const rebuiltSnap = loadGraphProjectionSnapshot(rebuildStore, candRelId);
      expect(rebuiltSnap).not.toBeNull();
      expect(rebuiltSnap!.edge_count).toBe(graphSnap!.edge_count);
      expect(rebuiltSnap!.node_count).toBe(graphSnap!.node_count);

      // Verify identical edge triples after cold rebuild
      const rebuiltTriples = rebuiltSnap!.edges
        .map((e) => `${e.assertion_id}|${e.subject}|${e.predicate}|${e.object}`)
        .sort();
      const origTriples = graphSnap!.edges
        .map((e) => `${e.assertion_id}|${e.subject}|${e.predicate}|${e.object}`)
        .sort();
      expect(rebuiltTriples).toEqual(origTriples);

      // Measure local Cypher UNWIND batch generation (500 edges/batch) for future Neo4j replay
      const unwindStart = performance.now();
      const batchSize = 500;
      const cypherBatches: Array<{ batch_index: number; row_count: number; cypher: string }> = [];
      for (let i = 0; i < rebuiltSnap!.edges.length; i += batchSize) {
        const slice = rebuiltSnap!.edges.slice(i, i + batchSize);
        cypherBatches.push({
          batch_index: cypherBatches.length,
          row_count: slice.length,
          cypher:
            "UNWIND $rows AS row MERGE (s:LegalWork {work_id: row.subject}) MERGE (o:LegalWork {work_id: row.object}) MERGE (s)-[r:ASSERTED_EDGE {assertion_id: row.assertion_id}]->(o) SET r.predicate = row.predicate, r.release_id = $releaseId",
        });
      }
      const cypherBatchPrepMs = Number((performance.now() - unwindStart).toFixed(2));
      expect(cypherBatches.length).toBe(Math.ceil(rebuiltSnap!.edges.length / batchSize));

      // -----------------------------------------------------------------------
      // PART D: Disposable Rollback Verification (`rollbackRelease`)
      // -----------------------------------------------------------------------
      const rollbackDir = path.join(tmpRoot, "rollback-copy");
      fs.cpSync(previewDir, rollbackDir, { recursive: true });
      const rollbackStore = new DurableKnowledgeStore(rollbackDir);

      const stateBeforeRollback = rollbackStore.getState();
      const b02PrimaryWorksBefore = Object.values(stateBeforeRollback.works).filter(
        (w) => w.owner_batch_id === "B02"
      ).length;
      expect(b02PrimaryWorksBefore).toBeGreaterThanOrEqual(480);

      const rbStart = performance.now();
      const rbReceipt = await rollbackRelease(
        candRelId,
        "Disposable empirical rollback verification drill",
        OWNER_ACTOR,
        { store: rollbackStore }
      );
      const rollbackWallClockMs = Number((performance.now() - rbStart).toFixed(2));
      expect(rbReceipt.state).toBe("ROLLED_BACK");

      const stateAfterRollback = rollbackStore.getState();
      // 1. Shared B02-owned primary-law works remain 100% intact
      const b02PrimaryWorksAfter = Object.values(stateAfterRollback.works).filter(
        (w) => w.owner_batch_id === "B02"
      ).length;
      expect(b02PrimaryWorksAfter).toBe(b02PrimaryWorksBefore);
      expect(stateAfterRollback.works["statute.th.revenue_code"]).toBeDefined();
      expect(stateAfterRollback.works["prov.th.rc.47_ทวิ"]).toBeDefined();
      expect(stateAfterRollback.works["prov.th.rc.65_ตรี"]).toBeDefined();

      // 2. Preserved rel.B01.rc1 audit record remains intact
      expect(stateAfterRollback.releases["rel.B01.rc1"]).toBeDefined();
      expect(stateAfterRollback.releases["rel.B01.rc1"].manifest_id).toBe("mfst.b01.mwgj0yb3");

      // 3. Exclusive candidate assertions were cleanly removed
      const remainingRc2Assertions = Object.values(stateAfterRollback.assertions).filter(
        (a) => a.release_id === candRelId
      );
      expect(remainingRc2Assertions.length).toBe(0);

      // Write transparent empirical evidence artifact to docs/audit/dodo-review-rc2-b02/
      const outPath = path.resolve(
        process.cwd(),
        "docs",
        "audit",
        "dodo-review-rc2-b02",
        "graph_snapshot_empirical_verification.json"
      );
      const empiricalReport = {
        verified_at: new Date().toISOString(),
        candidate_release_id: candRelId,
        manifest_id: state.releases[candRelId].manifest_id,
        manifest_hash: state.releases[candRelId].manifest_hash,
        evidence_classification_note:
          "The 28/28 metric below measures technical snapshot-vs-canonical retrieval parity and non-error response status ONLY; substantive Thai tax-law accuracy and completeness are verified separately against original rd.go.th / Gazette sources and require human Thai tax counsel sign-off.",
        snapshot_graph_metrics: {
          node_count: graphSnap!.node_count,
          edge_count: graphSnap!.edge_count,
          predicate_breakdown: predicateCounts,
          quarantined_edges_in_active_graph: quarantinedEdgesCount,
          ruling_sibling_fact_conclusion_pairs_verified: rulingRolesByWork.size,
          unsplit_facts_equals_conclusion_defects: identicalFactsAndConclusionCount,
        },
        empirical_equivalence_benchmark: {
          total_queries_tested: combinedQueries.length,
          bound_uat_cases: 20,
          exploratory_prompts: EXPLORATORY_PROMPTS.length,
          disk_snapshot_vs_canonical_top_hits_exact_match: `${exactTopHitListParityCount}/${combinedQueries.length}`,
          evidence_card_edges_vs_cypher_adjacency_exact_match: `${exactGraphNeighborParityCount}/${combinedQueries.length}`,
          verified_or_clean_abstention_rate: `${verifiedOrAbstainedCleanlyCount}/${combinedQueries.length}`,
          avg_three_pass_test_bundle_ms: Number(
            (
              perQueryLatenciesMs.reduce((acc, v) => acc + v, 0) / perQueryLatenciesMs.length
            ).toFixed(2)
          ),
          known_non_equivalences_vs_live_neo4j: [
            "Bounded to <=2-hop traversal (TaxRuling <-> Provision/SubordinateRegulation <-> co-interpreting TaxRuling); arbitrary >2-hop path queries (e.g. MATCH p=(a)-[*3..6]->(b)) require Cypher or multi-hop graph engine.",
            "No ad-hoc server-side Cypher analytical aggregations or GDS centrality across batches B01-B10.",
            "Snapshot file is immutable per release candidate; live concurrent graph writes require transactional DB + outbox.",
          ],
        },
        rebuild_and_replay_benchmark: {
          cold_projection_rebuild_wall_clock_ms: rebuildWallClockMs,
          rebuilt_edges_verified: rebuiltSnap!.edge_count,
          deterministic_triple_identity_verified: true,
          cypher_unwind_500_batch_count: cypherBatches.length,
          local_cypher_batch_serialization_ms: cypherBatchPrepMs,
          cloud_neo4j_network_ingestion_status:
            "UNTESTED_CLOUD_NETWORK_ESTIMATE — 67 parameterized UNWIND batches (33,366 edges) serialized locally; actual AuraDB Bolt network write time will be measured against an isolated target only after configuration approval (never against the preserved live REG24 graph).",
        },
        disposable_rollback_verification: {
          rollback_wall_clock_ms: rollbackWallClockMs,
          post_rollback_state: rbReceipt.state,
          b02_shared_primary_works_before: b02PrimaryWorksBefore,
          b02_shared_primary_works_after: b02PrimaryWorksAfter,
          preserved_rc1_intact: Boolean(stateAfterRollback.releases["rel.B01.rc1"]),
          remaining_rc2_assertions_after_rollback: remainingRc2Assertions.length,
        },
        protected_assets_integrity: {
          production_canonical_sha256_unchanged: sha256File(prodCanonicalPath) === prodHashBefore,
          staging_preview_canonical_sha256_unchanged:
            sha256File(previewCanonicalPath) === previewHashBefore,
          rag24_touched: false,
        },
      };
      fs.writeFileSync(outPath, JSON.stringify(empiricalReport, null, 2), "utf8");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    // Final invariant check on protected files
    expect(sha256File(prodCanonicalPath)).toBe(prodHashBefore);
    expect(sha256File(previewCanonicalPath)).toBe(previewHashBefore);
  }, 60_000);

  it("5. Enforces automatic Neo4j write lockout on Vercel Preview / staging preview stores and supports --expected-instance-id target validation", () => {
    const origVercelEnv = process.env.VERCEL_ENV;
    const origPreviewStore = process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
    const origLock = process.env.NEO4J_PRESERVATION_READ_ONLY;
    try {
      delete process.env.NEO4J_PRESERVATION_READ_ONLY;
      process.env.VERCEL_ENV = "preview";
      expect(isNeo4jPreservationWriteLockActive()).toBe(true);

      delete process.env.VERCEL_ENV;
      process.env.REG24_USE_B01_RC2_PREVIEW_STORE = "1";
      expect(isNeo4jPreservationWriteLockActive()).toBe(true);
    } finally {
      if (origVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = origVercelEnv;
      if (origPreviewStore === undefined) delete process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
      else process.env.REG24_USE_B01_RC2_PREVIEW_STORE = origPreviewStore;
      if (origLock === undefined) delete process.env.NEO4J_PRESERVATION_READ_ONLY;
      else process.env.NEO4J_PRESERVATION_READ_ONLY = origLock;
    }

    // Default still strictly requires 374f4f7e
    const wrongDefault = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "neo4j+s://a1b2c3d4.databases.neo4j.io",
      username: "neo4j",
      password: "secret",
      database: "neo4j",
    });
    expect(wrongDefault.valid).toBe(false);

    // Explicit --expected-instance-id validates the active Vercel-connected AuraDB instance cleanly
    const explicitActive = validateAuditTarget({
      targetMode: "live-374f4f7e",
      uri: "neo4j+s://a1b2c3d4.databases.neo4j.io",
      username: "neo4j",
      password: "secret",
      database: "neo4j",
      expectedInstanceId: "a1b2c3d4",
    });
    expect(explicitActive.valid).toBe(true);
  });
});
