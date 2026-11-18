import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { freezeInventory, planReconciliation } from "../../src/core/knowledge/inventory";
import {
  promoteRelease,
  recordTechnicalOrLegalAttestation,
  recordUatDecision,
  rollbackRelease,
  startBatchRun,
} from "../../src/core/knowledge/releases";
import { evaluateRelease } from "../../src/core/knowledge/evaluation";
import { runBlindSourceToAnswerValidation } from "../../src/core/knowledge/blind-audit";
import { validateReleaseReport, type Actor } from "../../src/core/knowledge/contracts";

const ENG_ACTOR: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const LEGAL_ACTOR: Actor = {
  actor_id: "legal.counsel@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const OWNER_ACTOR: Actor = {
  actor_id: "rattaroj@reg24.th",
  role: "product_owner",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Batch B02 — Statutes & Tax Framework Isolated Staging, Blind Validation & Persistence/Rollback Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-b02-suite-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Reconciles 7,335 B02 candidates (7,323 files + 12 Customs RAR members), stages B02 after B01 in isolated tempDir, passes 20 B02 UAT + 26 blind gold cases, persists across store restarts, and preserves shared B01 statutory dependencies on B02 rollback", async () => {
    const store = new DurableKnowledgeStore(tempDir);

    // 1. Stage & accept B01 inside isolated tempDir so B02 sequential gate unlocks cleanly in staging
    const fB01 = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(fB01.manifest.manifest_id, ENG_ACTOR, { store });
    const rB01 = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: fB01.manifest.manifest_id,
        idempotency_key: "idem-b02suite-b01",
        max_documents: 100,
      },
      ENG_ACTOR,
      { store }
    );
    const evB01 = await evaluateRelease(rB01.release_id, "suite.B01.300families.v1.1", ENG_ACTOR, { store });
    const mHashB01 = store.getState().releases[rB01.release_id].manifest_hash;
    await recordUatDecision(
      {
        release_id: rB01.release_id,
        decision: "UAT_PASS",
        expected_revision: store.getState().releases[rB01.release_id].revision,
        manifest_hash: mHashB01,
        comments: "Isolated staging test sign-off",
        case_decisions: evB01.uat_cases.map((c) => ({ case_id: c.case_id, decision: "PASS", comment: "OK" })),
      },
      OWNER_ACTOR,
      { store }
    );
    recordTechnicalOrLegalAttestation(store, {
      release_id: rB01.release_id,
      manifest_hash: mHashB01,
      actor: ENG_ACTOR,
      notes: "Isolated staging tech attestation",
    });
    recordTechnicalOrLegalAttestation(store, {
      release_id: rB01.release_id,
      manifest_hash: mHashB01,
      actor: LEGAL_ACTOR,
      notes: "Isolated staging legal attestation",
    });
    await promoteRelease(
      {
        release_id: rB01.release_id,
        expected_active_release_id: null,
        manifest_hash: mHashB01,
      },
      ENG_ACTOR,
      { store }
    );

    // 2. Freeze B02 inventory (7,323 physical files + 12 unpacked Customs RAR members = 7,335)
    const fB02 = await freezeInventory("B02", ENG_ACTOR, { store });
    expect(fB02.candidates.length).toBe(7335);

    const planB02 = await planReconciliation(fB02.manifest.manifest_id, ENG_ACTOR, { store });
    expect(planB02.accounting_matches_total).toBe(true);
    expect(planB02.silent_drops).toBe(0);
    expect(planB02.by_disposition.REJECTED_OUT_OF_SCOPE).toBe(36);
    expect(planB02.by_disposition.DEFERRED_WITH_REASON).toBeGreaterThanOrEqual(5270);

    // 3. Stage B02 pilot (`max_documents: 120`) and verify idempotent replay
    const rB02 = await startBatchRun(
      {
        batch_id: "B02",
        manifest_id: fB02.manifest.manifest_id,
        idempotency_key: "idem-b02-pilot-120",
        max_documents: 120,
      },
      ENG_ACTOR,
      { store }
    );
    expect(rB02.release_id).toBe("rel.B02.rc1");

    const countsAfterB02 = store.getAcceptedCounts();
    const replayB02 = await startBatchRun(
      {
        batch_id: "B02",
        manifest_id: fB02.manifest.manifest_id,
        idempotency_key: "idem-b02-pilot-120",
        max_documents: 120,
      },
      ENG_ACTOR,
      { store }
    );
    expect(replayB02.idempotent_replay).toBe(true);
    expect(store.getAcceptedCounts()).toEqual(countsAfterB02);

    // 4. Evaluate B02 release & 20 bound B02 Owner UAT cases (`B02-U01A`..`B02-U10B`)
    const evB02 = await evaluateRelease(rB02.release_id, "suite.B02.300families.v1.0", ENG_ACTOR, { store });
    expect(evB02.uat_cases.length).toBe(20);
    expect(evB02.evaluation.metrics.citation_resolution).toBe(1.0);
    expect(evB02.evaluation.metrics.graph_evidence_integrity).toBe(1.0);
    expect(evB02.evaluation.all_automated_gates_passed).toBe(true);
    expect(evB02.release_report.status).toBe("READY_FOR_UAT");
    expect(evB02.release_report.uat.owner_decision).toBeNull();
    const repVal = validateReleaseReport(evB02.release_report, "READY_FOR_UAT");
    expect(repVal.errors).toEqual([]);

    for (const uc of evB02.uat_cases) {
      expect(
        uc.evaluator_results?.automated_precheck_passed,
        `${uc.case_id} [q=${uc.question}] [req=${JSON.stringify(uc.required_evidence)}]: ${JSON.stringify(uc.evaluator_results)}`
      ).toBe(true);
      expect(uc.owner_result).toBeNull();
    }

    // 5. Run Independent Blind Source-to-Answer Validation (all 26 B01+B02 blind gold cases!)
    const blindB02 = await runBlindSourceToAnswerValidation(rB02.release_id, LEGAL_ACTOR, { store });
    expect(blindB02.total_cases).toBe(26);
    expect(blindB02.case_results.filter((c) => !c.overall_passed)).toEqual([]);
    expect(blindB02.overall_accuracy).toBe(1.0);
    expect(blindB02.synthetic_placeholder_citations_detected).toBe(0);

    // 6. DEF-B01-06: Verify cold restart persistence on disk + shared-law-node-safe rollback
    const restartedStore = new DurableKnowledgeStore(tempDir);
    expect(restartedStore.getState().store_revision).toBe(store.getState().store_revision);
    expect(restartedStore.getState().releases["rel.B02.rc1"].manifest_hash).toBe(
      store.getState().releases["rel.B02.rc1"].manifest_hash
    );

    // Promote B02 in isolated tempDir, then roll back B02 -> shared `prov.th.rc.65_ตรี` & `prov.th.rc.80/1` required by B01 MUST survive!
    const relB02Rec = restartedStore.getState().releases["rel.B02.rc1"];
    const mHashB02 = relB02Rec.manifest_hash;
    await recordUatDecision(
      {
        release_id: "rel.B02.rc1",
        decision: "UAT_PASS_WITH_DECLARED_GAPS",
        declared_gaps_accepted: relB02Rec.coverage_gaps,
        expected_revision: relB02Rec.revision,
        manifest_hash: mHashB02,
        comments: "Staging rollback verification",
        case_decisions: evB02.uat_cases.map((c) => ({ case_id: c.case_id, decision: "PASS", comment: "OK" })),
      },
      OWNER_ACTOR,
      { store: restartedStore }
    );
    recordTechnicalOrLegalAttestation(restartedStore, {
      release_id: "rel.B02.rc1",
      manifest_hash: mHashB02,
      actor: ENG_ACTOR,
      notes: "OK",
    });
    recordTechnicalOrLegalAttestation(restartedStore, {
      release_id: "rel.B02.rc1",
      manifest_hash: mHashB02,
      actor: LEGAL_ACTOR,
      notes: "OK",
    });
    await promoteRelease(
      {
        release_id: "rel.B02.rc1",
        expected_active_release_id: "rel.B01.rc1",
        manifest_hash: mHashB02,
      },
      ENG_ACTOR,
      { store: restartedStore }
    );

    const rbOut = await rollbackRelease(
      "rel.B02.rc1",
      "Isolated staging rollback safety verification",
      ENG_ACTOR,
      { store: restartedStore }
    );
    expect(rbOut.active_release_id).toBe("rel.B01.rc1");
    expect(restartedStore.getState().works["prov.th.rc.65_ตรี"]).toBeDefined();
    expect(restartedStore.getState().works["prov.th.rc.80/1"]).toBeDefined();
  }, 60000);
});
