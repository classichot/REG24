import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { freezeInventory, planReconciliation } from "../../src/core/knowledge/inventory";
import { startBatchRun } from "../../src/core/knowledge/releases";
import { evaluateRelease } from "../../src/core/knowledge/evaluation";
import { validateReleaseReport, type Actor } from "../../src/core/knowledge/contracts";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { resolveAuthorizedEvidence } from "../../src/core/knowledge/evidence";

const ENG_ACTOR: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const READER_ACTOR: Actor = {
  actor_id: "rattaroj@reg24.th",
  role: "product_owner",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Batch B01 — Revenue Department Tax Rulings End-to-End Suite (B01-EX, B01-GR, B01-QA, 300-Family Benchmark & 20 UAT Cases)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-b01-suite-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Executes full 5,150-file RD inventory reconciliation, 100-ruling stratified pilot, 300-family benchmark, and all 20 bound Owner UAT cases stopping strictly at READY_FOR_UAT", async () => {
    const store = new DurableKnowledgeStore(tempDir);

    // 1. Freeze live B01 inventory & reconcile the 5,150 RD parent pool
    const frozen = await freezeInventory("B01", ENG_ACTOR, { store });
    expect(frozen.candidates.length).toBe(5150);

    const plan = await planReconciliation(frozen.manifest.manifest_id, ENG_ACTOR, { store });
    expect(plan.accounting_matches_total).toBe(true);
    expect(plan.silent_drops).toBe(0);
    expect(plan.by_disposition.DEFERRED_WITH_REASON).toBe(0);
    expect(plan.by_disposition.REJECTED_OUT_OF_SCOPE).toBe(572); // 570 B02-owned RD tax regulations + 2 root RD Index sheets
    expect(plan.by_disposition.ATTACHED_REPRESENTATION).toBeGreaterThanOrEqual(7);

    // 2. Run 100-ruling stratified B01 pilot & stage candidate `rel.B01.rc1`
    const runReceipt = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: frozen.manifest.manifest_id,
        idempotency_key: "idem-b01-suite-100",
        max_documents: 100,
      },
      ENG_ACTOR,
      { store }
    );
    expect(runReceipt.release_id).toBe("rel.B01.rc1");
    expect(runReceipt.processed_candidates).toBe(100);

    // Verify idempotent replay of the exact same run key creates ZERO extra canonical works/passages/vectors!
    const countsBeforeReplay = store.getAcceptedCounts();
    const replayReceipt = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: frozen.manifest.manifest_id,
        idempotency_key: "idem-b01-suite-100",
        max_documents: 100,
      },
      ENG_ACTOR,
      { store }
    );
    expect(replayReceipt.idempotent_replay).toBe(true);
    expect(store.getAcceptedCounts()).toEqual(countsBeforeReplay);

    // 3. Evaluate 300-question-family suite (200 dev + 100 unseen holdout) & 20 bound Owner UAT cases
    const evalOut = await evaluateRelease(runReceipt.release_id, "suite.B01.300families.v1.1", ENG_ACTOR, {
      store,
      candidateBaseUrl: "https://reg24-theta.vercel.app",
    });

    expect(evalOut.evaluation.development_families).toBe(200);
    expect(evalOut.evaluation.holdout_families).toBe(100);
    expect(evalOut.evaluation.metrics.citation_resolution).toBe(1.0);
    expect(evalOut.evaluation.metrics.graph_evidence_integrity).toBe(1.0);
    expect(evalOut.evaluation.metrics.exact_identifier_lookup).toBeGreaterThanOrEqual(0.99);
    expect(evalOut.evaluation.metrics.evidence_recall_at_20).toBeGreaterThanOrEqual(0.92);
    expect(evalOut.evaluation.metrics.claim_support).toBeGreaterThanOrEqual(0.98);
    expect(evalOut.evaluation.metrics.attempted_answer_correctness).toBeGreaterThanOrEqual(0.95);
    expect(evalOut.evaluation.ablation_comparison.graph_improves_or_preserves_accuracy).toBe(true);
    expect(evalOut.evaluation.all_automated_gates_passed).toBe(true);

    // 4. Verify all 20 bound Owner UAT cases have zero bracketed placeholders, >=5 source-fidelity cases, and pass prechecks
    expect(evalOut.uat_cases.length).toBe(20);
    const fidelityCases = evalOut.uat_cases.filter((c) => c.exercises_source_fidelity);
    expect(fidelityCases.length).toBeGreaterThanOrEqual(5);

    for (const uc of evalOut.uat_cases) {
      expect(uc.question).not.toMatch(/\[[^\]]+\]/);
      expect(uc.evaluator_results?.automated_precheck_passed).toBe(true);
      expect(uc.evaluator_results?.citation_resolved).toBe(true);
      // Human Owner decision MUST remain null until Rattaroj tests and submits!
      expect(uc.owner_result).toBeNull();
    }

    // 5. Verify normal REG24 user journey: question -> grounded answer -> citation -> exact passage & locator -> related provisions
    const thaiDigitLookup = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขไทย กค ๐๗๐๒ / ๖๓๖",
        release_id: "rel.B01.rc1",
        mode: "exact_lookup",
      },
      READER_ACTOR,
      { store }
    );
    expect(thaiDigitLookup.status).toBe("ANSWERED");
    expect(thaiDigitLookup.evidence.length).toBeGreaterThan(0);
    expect(thaiDigitLookup.evidence[0].related_provisions.length).toBeGreaterThan(0);

    const drawer = resolveAuthorizedEvidence(store, thaiDigitLookup.evidence[0].passage_id, READER_ACTOR);
    expect(drawer.allowed).toBe(true);
    expect(drawer.http_status).toBe(200);
    expect(drawer.passage?.exact_text).toContain("ร้อยละ 0");

    // 6. Validate populated ReleaseReport strictly stops at READY_FOR_UAT with next_batch_unlocked=false and owner_decision=null
    const reportCheck = validateReleaseReport(evalOut.release_report, "READY_FOR_UAT");
    expect(reportCheck.errors).toEqual([]);
    expect(reportCheck.valid).toBe(true);
    expect(evalOut.release_report.template_only).toBe(false);
    expect(evalOut.release_report.status).toBe("READY_FOR_UAT");
    expect(evalOut.release_report.uat.owner_decision).toBeNull();
    expect(evalOut.release_report.next_batch_unlocked).toBe(false);
  }, 30000);
});
