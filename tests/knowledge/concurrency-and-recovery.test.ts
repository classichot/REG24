import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";
import { DurableKnowledgeStore, type WalCommitEntry } from "../../src/core/knowledge/store";
import { sha256Bytes } from "../../src/core/knowledge/identity";
import { freezeInventory, planReconciliation } from "../../src/core/knowledge/inventory";
import {
  promoteRelease,
  recordTechnicalOrLegalAttestation,
  recordUatDecision,
  startBatchRun,
} from "../../src/core/knowledge/releases";
import { evaluateRelease } from "../../src/core/knowledge/evaluation";
import type { Actor } from "../../src/core/knowledge/contracts";

const WORKER_TS = path.resolve(process.cwd(), "tests/knowledge/helpers/concurrent-store-worker.ts");
let compiledWorkerCjs = "";

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

function spawnWorker(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [compiledWorkerCjs, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      try {
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch {
        reject(new Error(`Invalid JSON from worker: ${stdout} / ${stderr}`));
      }
    });
  });
}

describe("DEF-B01-07, DEF-B01-05 & DEF-B01-06 — Cross-Process Concurrency, CAS Conflict, WAL Hash-Chain, Crash Recovery & Topology Guard", () => {
  let tempDir: string;

  beforeAll(() => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-worker-bundle-"));
    compiledWorkerCjs = path.join(buildDir, "concurrent-store-worker.cjs");
    esbuild.buildSync({
      entryPoints: [WORKER_TS],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: compiledWorkerCjs,
    });
  });

  afterAll(() => {
    if (compiledWorkerCjs && fs.existsSync(path.dirname(compiledWorkerCjs))) {
      fs.rmSync(path.dirname(compiledWorkerCjs), { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-concurrency-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("DEF-B01-07 (1): Two separate OS processes reading the same revision and writing concurrently preserve BOTH updates with ZERO lost updates across 5 consecutive runs", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    await store.transact("INIT_SEED", (d) => {
      d.withdrawals["seed"] = {
        target_id: "seed",
        reason: "initial_seed",
        withdrawn_by: "test",
        withdrawn_at: new Date().toISOString(),
        active: false,
      };
    });
    const revBeforeRounds = store.getState().store_revision;

    for (let round = 1; round <= 5; round++) {
      const barrierDir = fs.mkdtempSync(path.join(os.tmpdir(), `reg24-bar-r${round}-`));
      try {
        const [resA, resB] = await Promise.all([
          spawnWorker(["concurrent_update", tempDir, `r${round}_procA`, barrierDir, "2"]),
          spawnWorker(["concurrent_update", tempDir, `r${round}_procB`, barrierDir, "2"]),
        ]);
        expect(resA.ok).toBe(true);
        expect(resB.ok).toBe(true);
      } finally {
        fs.rmSync(barrierDir, { recursive: true, force: true });
      }
    }

    const finalState = store.getState();
    // revBeforeRounds + 5 rounds * 2 processes (10) = ALL 10 concurrent markers preserved!
    expect(finalState.store_revision).toBe(revBeforeRounds + 10);
    for (let round = 1; round <= 5; round++) {
      expect(finalState.withdrawals[`marker.r${round}_procA`]).toBeDefined();
      expect(finalState.withdrawals[`marker.r${round}_procB`]).toBeDefined();
    }

    // Verify WAL has strictly unique monotonic sequence numbers (1..N)
    const walEntries = store.readWalEntries();
    expect(walEntries.length).toBe(revBeforeRounds + 10);
    expect(walEntries.map((w) => w.seq)).toEqual(
      Array.from({ length: revBeforeRounds + 10 }, (_, idx) => idx + 1)
    );
  }, 45000);

  it("DEF-B01-07 (2): Stale `expectedRevision` CAS and two-process conflicting UAT approval decisions (`UAT_PASS` vs `UAT_FAIL`) deterministically reject the stale caller with 409 Conflict and keep report/release atomic", async () => {
    const store = new DurableKnowledgeStore(tempDir);

    // Part A: Direct store-level optimistic CAS conflict across 2 OS processes
    await store.transact("SEED_CAS", (d) => {
      d.withdrawals["cas.seed"] = {
        target_id: "cas.seed",
        reason: "seed",
        withdrawn_by: "test",
        withdrawn_at: new Date().toISOString(),
        active: false,
      };
    });
    const baseRev = store.getState().store_revision;
    const casBarrier = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-cas-bar-"));
    try {
      const [casA, casB] = await Promise.all([
        spawnWorker(["cas_conflict", tempDir, "casA", casBarrier, String(baseRev)]),
        spawnWorker(["cas_conflict", tempDir, "casB", casBarrier, String(baseRev)]),
      ]);
      const successes = [casA, casB].filter((r) => r.ok === true);
      const conflicts = [casA, casB].filter((r) => r.ok === false);
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(1);
      expect(String(conflicts[0].error)).toContain("STALE_REVISION_CONFLICT_409");
    } finally {
      fs.rmSync(casBarrier, { recursive: true, force: true });
    }

    // Part B: Two OS processes racing conflicting Owner UAT decisions (`UAT_PASS` vs `UAT_FAIL`) on `rel.B01.rc1`
    const frozen = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(frozen.manifest.manifest_id, ENG_ACTOR, { store });
    await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: frozen.manifest.manifest_id,
        idempotency_key: "idem-conflicting-uat",
        max_documents: 30,
      },
      ENG_ACTOR,
      { store }
    );
    await evaluateRelease("rel.B01.rc1", "suite.B01.300families.v1.1", ENG_ACTOR, { store });

    const uatBarrier = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-uat-bar-"));
    try {
      const [uatPassProc, uatFailProc] = await Promise.all([
        spawnWorker(["conflicting_uat", tempDir, "ownerPass", uatBarrier, "UAT_PASS"]),
        spawnWorker(["conflicting_uat", tempDir, "ownerFail", uatBarrier, "UAT_FAIL"]),
      ]);

      const uatWinners = [uatPassProc, uatFailProc].filter((r) => r.ok === true);
      const uatLosers = [uatPassProc, uatFailProc].filter((r) => r.ok === false);
      expect(uatWinners.length).toBe(1);
      expect(uatLosers.length).toBe(1);
      expect(String(uatLosers[0].error)).toMatch(/409/);

      // Verify release record, acceptance record, and release_report are 100% consistent with the single winning decision!
      const st = store.getState();
      const rel = st.releases["rel.B01.rc1"];
      const acc = st.acceptances["rel.B01.rc1"];
      const rep = st.release_reports["B01"];
      const winDecision = uatWinners[0].decision;
      expect(acc.user_decision).toBe(winDecision);
      expect(rep.uat.owner_decision).toBe(winDecision);
      expect(rep.status).toBe(rel.state);
    } finally {
      fs.rmSync(uatBarrier, { recursive: true, force: true });
    }
  }, 60000);

  it("DEF-B01-07 (3): Four concurrent OS processes x 5 commits (20 multi-process commits) produce strictly unique monotonic WAL `seq` numbers and an unbroken SHA-256 hash chain", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    const baseRev = store.getState().store_revision;
    const barrierDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-stress4-"));
    try {
      const results = await Promise.all([
        spawnWorker(["multi_seq_stress", tempDir, "W1", barrierDir, "5"]),
        spawnWorker(["multi_seq_stress", tempDir, "W2", barrierDir, "5"]),
        spawnWorker(["multi_seq_stress", tempDir, "W3", barrierDir, "5"]),
        spawnWorker(["multi_seq_stress", tempDir, "W4", barrierDir, "5"]),
      ]);
      for (const r of results) {
        expect(r.ok).toBe(true);
      }
    } finally {
      fs.rmSync(barrierDir, { recursive: true, force: true });
    }

    const st = store.getState();
    expect(st.store_revision).toBe(baseRev + 20);
    for (const w of ["W1", "W2", "W3", "W4"]) {
      for (let i = 1; i <= 5; i++) {
        expect(st.withdrawals[`stress.${w}.${i}`]).toBeDefined();
      }
    }

    const wal = store.readWalEntries();
    expect(wal.length).toBe(baseRev + 20);
    expect(wal.map((e) => e.seq)).toEqual(Array.from({ length: baseRev + 20 }, (_, idx) => idx + 1));

    const workerWal = wal.slice(baseRev);
    expect(workerWal.length).toBe(20);
    for (let i = 0; i < wal.length; i++) {
      const entry = wal[i];
      expect(entry.next_state_sha256).toMatch(/^[0-9a-f]{64}$/);
      if (i > 0) {
        expect(entry.prev_state_sha256).toBe(wal[i - 1].next_state_sha256);
      }
    }
    for (const entry of workerWal) {
      expect(entry.actor_id).toMatch(/^actor\.W[1-4]$/);
    }
  }, 45000);

  it("DEF-B01-07 (4): Recovers cleanly from a simulated mid-commit crash (committed WAL + staged snapshot while canonical-state lags), cleans `.tmp.*` orphans, and reclaims dead-PID locks", async () => {
    const store1 = new DurableKnowledgeStore(tempDir);
    await store1.transact("COMMIT_1", (d) => {
      d.withdrawals["k1"] = {
        target_id: "k1",
        reason: "v1",
        withdrawn_by: "test",
        withdrawn_at: new Date().toISOString(),
        active: false,
      };
    });
    const beforeCrashRev = store1.getState().store_revision;
    const nextCrashRev = beforeCrashRev + 1;

    // Snapshot canonical-state.json at `beforeCrashRev`
    const canonicalPath = path.join(tempDir, "canonical-state.json");
    const prevBytes = fs.readFileSync(canonicalPath, "utf8");
    const prevSha = sha256Bytes(prevBytes);

    // Construct a valid `nextCrashRev` staged snapshot inside `.staged-commits` + committed WAL entry, while leaving canonical-state.json lagging!
    const nextObj = JSON.parse(prevBytes);
    nextObj.store_revision = nextCrashRev;
    nextObj.withdrawals["k2_recovered"] = {
      target_id: "k2_recovered",
      reason: "recovered_from_staged_commit",
      withdrawn_by: "crash_test",
      withdrawn_at: new Date().toISOString(),
      active: false,
    };
    const nextBytes = JSON.stringify(nextObj);
    const nextSha = sha256Bytes(nextBytes);

    const stagedFileName = `commit-${nextCrashRev}.json`;
    const stagedPath = path.join(tempDir, ".staged-commits", stagedFileName);
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.writeFileSync(stagedPath, nextBytes, "utf8");

    const crashedWalEntry: WalCommitEntry = {
      seq: nextCrashRev,
      prev_seq: beforeCrashRev,
      op: "COMMIT_CRASHED_BEFORE_RENAME",
      at: new Date().toISOString(),
      pid: 99999999,
      actor_id: "crash_test",
      prev_state_sha256: prevSha,
      next_state_sha256: nextSha,
      staged_file: stagedFileName,
      meta: { crash_simulation: true },
    };
    fs.appendFileSync(path.join(tempDir, "wal.jsonl"), JSON.stringify(crashedWalEntry) + "\n", "utf8");

    // Plant an orphan `.tmp.999999` file and a dead-PID `store.lock`
    const orphanTmp = path.join(tempDir, "canonical-state.json.tmp.999999");
    fs.writeFileSync(orphanTmp, "{partial-corrupt-bytes", "utf8");
    fs.writeFileSync(
      path.join(tempDir, "store.lock"),
      JSON.stringify({ pid: 99999999, token: "dead-lock", created_at_ms: Date.now() - 5000 }),
      "utf8"
    );

    // Open a brand-new DurableKnowledgeStore on `tempDir` -> must reclaim dead lock, auto-recover `nextCrashRev`, and delete staged & orphan files!
    const recoveredStore = new DurableKnowledgeStore(tempDir);
    const recState = recoveredStore.getState();
    expect(recState.store_revision).toBe(nextCrashRev);
    expect(recState.withdrawals["k1"]).toBeDefined();
    expect(recState.withdrawals["k2_recovered"]?.reason).toBe("recovered_from_staged_commit");
    expect(fs.existsSync(orphanTmp)).toBe(false);
    expect(fs.existsSync(stagedPath)).toBe(false);

    // Confirm subsequent transaction succeeds cleanly
    await recoveredStore.transact("COMMIT_POST_RECOVERY", (d) => {
      d.withdrawals["k3_after_recovery"] = {
        target_id: "k3_after_recovery",
        reason: "post_recovery_ok",
        withdrawn_by: "test",
        withdrawn_at: new Date().toISOString(),
        active: false,
      };
    });
    expect(recoveredStore.getState().store_revision).toBe(nextCrashRev + 1);
    expect(fs.existsSync(path.join(tempDir, "store.lock"))).toBe(false);
  });

  it("DEF-B01-07 (5) & DEF-B01-05: Enforces multi-instance read-after-write cache invalidation AND blocks production promotion on ephemeral serverless `/tmp` storage", async () => {
    const instanceA = new DurableKnowledgeStore(tempDir);
    const instanceB = new DurableKnowledgeStore(tempDir);

    await instanceA.transact("WRITE_FROM_A", (d) => {
      d.withdrawals["shared.item.1"] = {
        target_id: "shared.item.1",
        reason: "from_A",
        withdrawn_by: "A",
        withdrawn_at: new Date().toISOString(),
        active: false,
      };
    });

    const revAfterFirstWrite = instanceB.getState().store_revision;
    expect(instanceB.getState().withdrawals["shared.item.1"]?.reason).toBe("from_A");

    // Now instanceA writes again while instanceB already holds a warm in-memory cache!
    await instanceA.transact("SECOND_WRITE_FROM_A", (d) => {
      d.withdrawals["shared.item.2"] = {
        target_id: "shared.item.2",
        reason: "from_A_second",
        withdrawn_by: "A",
        withdrawn_at: new Date().toISOString(),
        active: false,
      };
    });

    // `instanceB.getState()` MUST detect the updated `wal.jsonl` size/mtime and immediately return the new revision!
    const stateFromB = instanceB.getState();
    expect(stateFromB.store_revision).toBe(revAfterFirstWrite + 1);
    expect(stateFromB.withdrawals["shared.item.2"]?.reason).toBe("from_A_second");

    // Verify `EPHEMERAL_STORAGE_PROMOTION_BLOCKED_422` when running on unconfigured serverless `/tmp`
    const frozen = await freezeInventory("B01", ENG_ACTOR, { store: instanceA });
    await planReconciliation(frozen.manifest.manifest_id, ENG_ACTOR, { store: instanceA });
    await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: frozen.manifest.manifest_id,
        idempotency_key: "idem-ephemeral-guard",
        max_documents: 25,
      },
      ENG_ACTOR,
      { store: instanceA }
    );
    const ev = await evaluateRelease("rel.B01.rc1", "suite.B01.300families.v1.1", ENG_ACTOR, { store: instanceA });
    const mHash = instanceA.getState().releases["rel.B01.rc1"].manifest_hash;
    await recordUatDecision(
      {
        release_id: "rel.B01.rc1",
        decision: "UAT_PASS",
        expected_revision: instanceA.getState().releases["rel.B01.rc1"].revision,
        manifest_hash: mHash,
        comments: "Owner OK",
        case_decisions: ev.uat_cases.map((c) => ({ case_id: c.case_id, decision: "PASS", comment: "OK" })),
      },
      OWNER_ACTOR,
      { store: instanceA }
    );
    recordTechnicalOrLegalAttestation(instanceA, {
      release_id: "rel.B01.rc1",
      manifest_hash: mHash,
      actor: ENG_ACTOR,
      notes: "Tech OK",
    });
    recordTechnicalOrLegalAttestation(instanceA, {
      release_id: "rel.B01.rc1",
      manifest_hash: mHash,
      actor: LEGAL_ACTOR,
      notes: "Legal OK",
    });

    const origGetTopo = instanceA.getStorageTopology.bind(instanceA);
    instanceA.getStorageTopology = () => ({
      ...origGetTopo(),
      topology_mode: "ephemeral_serverless_tmp",
      durable_across_cold_starts: false,
      durable_across_horizontal_instances: false,
      warning: "Simulated Vercel /tmp ephemeral fallback",
    });

    await expect(
      promoteRelease(
        {
          release_id: "rel.B01.rc1",
          expected_active_release_id: null,
          manifest_hash: mHash,
        },
        ENG_ACTOR,
        { store: instanceA }
      )
    ).rejects.toThrow(/EPHEMERAL_STORAGE_PROMOTION_BLOCKED_422/);
  }, 45000);
});
