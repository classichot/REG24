/**
 * REG24 — Deterministic Materializer for Batch B01 Candidate Store (`rel.B01.rc1` -> `READY_FOR_UAT`)
 *
 * Builds `data/knowledge-store/` from the verified in-repo RD corpus and B02-owned Revenue Code
 * statutory dependencies, runs the F1 baseline snapshot + isolated restore verification,
 * executes the 300-question-family benchmark + 20 bound Owner UAT prechecks, and stops strictly
 * at `READY_FOR_UAT` (`uat.owner_decision = null`, `next_batch_unlocked = false`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { captureBaselineSnapshot, restoreBaselineSnapshotIsolated } from "../src/core/knowledge/baseline";
import { validateReleaseReport, type Actor } from "../src/core/knowledge/contracts";
import { evaluateRelease } from "../src/core/knowledge/evaluation";
import { freezeInventory, planReconciliation } from "../src/core/knowledge/inventory";
import { startBatchRun } from "../src/core/knowledge/releases";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";

const ENG_LEAD: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

export async function materializeB01CandidateStore(targetDir?: string) {
  const storeDir = targetDir || path.join(process.cwd(), "data", "knowledge-store");
  if (fs.existsSync(storeDir)) {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
  fs.mkdirSync(storeDir, { recursive: true });

  const store = new DurableKnowledgeStore(storeDir);

  // 1. Capture Task F1 Baseline Snapshot & verify isolated restoration
  const baselineDir = path.join(storeDir, "baseline");
  const baselineManifest = await captureBaselineSnapshot({
    outputDir: baselineDir,
    probeLiveNeo4j: false,
  });
  const tmpRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-f1-restore-verify-"));
  const restoreCheck = await restoreBaselineSnapshotIsolated(
    baselineManifest.snapshot_uri,
    tmpRestoreDir
  );
  fs.rmSync(tmpRestoreDir, { recursive: true, force: true });
  if (!restoreCheck.checksum_matches) {
    throw new Error("F1_BASELINE_RESTORE_CHECKSUM_MISMATCH");
  }
  store.writeReportArtifact("F1_baseline_verification.json", {
    baseline: baselineManifest,
    isolated_restore_verification: {
      checksum_matches: restoreCheck.checksum_matches,
      expected_sha256: restoreCheck.expected_sha256,
      actual_sha256: restoreCheck.actual_sha256,
      restored_counts: restoreCheck.restored_counts,
    },
  });

  // 2. Freeze full 5,150-file RD inventory & generate dry-run reconciliation plan
  const frozen = await freezeInventory("B01", ENG_LEAD, { store });
  const recPlan = await planReconciliation(frozen.manifest.manifest_id, ENG_LEAD, { store });
  store.writeReportArtifact("B01_reconciliation_plan.json", recPlan);

  // 3. Stage B01 candidate release (`rel.B01.rc1`) within the 200-doc per-run ceiling
  //    (covers the full 100-ruling stratified pilot + 100 unseen holdout rulings + all UAT fixtures & duplicate pairs)
  const runReceipt = await startBatchRun(
    {
      batch_id: "B01",
      manifest_id: frozen.manifest.manifest_id,
      idempotency_key: "b01-rc1-candidate-materialization-v1.1",
      max_documents: 200,
    },
    ENG_LEAD,
    { store }
  );

  // 4. Evaluate 300-question-family benchmark + 20 bound Owner UAT cases
  const evalBundle = await evaluateRelease(
    runReceipt.release_id,
    "suite.B01.300families.v1.1",
    ENG_LEAD,
    {
      store,
      candidateBaseUrl: "https://reg24-theta.vercel.app",
    }
  );

  const check = validateReleaseReport(evalBundle.release_report, "READY_FOR_UAT");
  if (!check.valid) {
    throw new Error(`Materialized B01 report failed validation: ${check.errors.join("; ")}`);
  }

  return {
    store_dir: storeDir,
    release_report: evalBundle.release_report,
    evaluation: evalBundle.evaluation,
    uat_case_count: evalBundle.uat_cases.length,
  };
}
