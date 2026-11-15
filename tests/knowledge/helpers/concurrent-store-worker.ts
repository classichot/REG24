/**
 * Real multi-process child worker for testing cross-process locking, CAS conflict detection,
 * conflicting UAT approvals, and monotonic hash-chained WAL sequencing (`DEF-B01-07`).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../../../src/core/knowledge/store";
import { recordUatDecision } from "../../../src/core/knowledge/releases";
import type { Actor } from "../../../src/core/knowledge/contracts";

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForBarrier(barrierDir: string, workerId: string, expectedPeers: number, timeoutMs = 8000): void {
  fs.writeFileSync(path.join(barrierDir, `ready-${workerId}`), String(process.pid), "utf8");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyCount = fs.readdirSync(barrierDir).filter((f) => f.startsWith("ready-")).length;
    if (readyCount >= expectedPeers) return;
    sleepSync(5);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const dataDir = process.argv[3];
  const workerId = process.argv[4];
  const arg5 = process.argv[5] || "";
  const arg6 = process.argv[6] || "";

  const store = new DurableKnowledgeStore(dataDir);

  if (mode === "concurrent_update") {
    const barrierDir = arg5;
    const expectedPeers = Number(arg6 || "2");
    const observedRev = store.getState().store_revision;
    waitForBarrier(barrierDir, workerId, expectedPeers);

    await store.transact(
      `WORKER_WRITE_${workerId}`,
      (draft) => {
        draft.withdrawals[`marker.${workerId}`] = {
          target_id: `marker.${workerId}`,
          reason: `written_by_${workerId}_after_seeing_rev_${observedRev}`,
          withdrawn_by: `actor.${workerId}`,
          withdrawn_at: new Date().toISOString(),
          active: false,
        };
      },
      {
        actorId: `actor.${workerId}`,
        auditMeta: { worker_id: workerId, observed_rev: observedRev },
      }
    );

    process.stdout.write(JSON.stringify({ ok: true, workerId, finalRev: store.getState().store_revision }) + "\n");
    return;
  }

  if (mode === "cas_conflict") {
    const barrierDir = arg5;
    const expectedRev = Number(arg6);
    waitForBarrier(barrierDir, workerId, 2);

    try {
      await store.transact(
        `CAS_WRITE_${workerId}`,
        (draft) => {
          draft.withdrawals[`cas.${workerId}`] = {
            target_id: `cas.${workerId}`,
            reason: `cas_winner_${workerId}`,
            withdrawn_by: `actor.${workerId}`,
            withdrawn_at: new Date().toISOString(),
            active: false,
          };
        },
        {
          expectedRevision: expectedRev,
          actorId: `actor.${workerId}`,
          auditMeta: { cas_expected_rev: expectedRev },
        }
      );
      process.stdout.write(JSON.stringify({ ok: true, workerId }) + "\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(JSON.stringify({ ok: false, workerId, error: msg }) + "\n");
    }
    return;
  }

  if (mode === "conflicting_uat") {
    const barrierDir = arg5;
    const decision = arg6 as "UAT_PASS" | "UAT_FAIL";
    const rel = store.getState().releases["rel.B01.rc1"];
    const expectedReleaseRev = rel.revision;
    const manifestHash = rel.manifest_hash;
    const caseIds = store.getState().uat_cases["rel.B01.rc1"].map((c) => c.case_id);

    waitForBarrier(barrierDir, workerId, 2);

    const ownerActor: Actor = {
      actor_id: `rattaroj.${workerId}@reg24.th`,
      role: "product_owner",
      tenant_id: "PUBLIC",
      authorized_scopes: ["scope.platform.public"],
    };

    try {
      const res = await recordUatDecision(
        {
          release_id: "rel.B01.rc1",
          decision,
          expected_revision: expectedReleaseRev,
          manifest_hash: manifestHash,
          comments: `Concurrent UAT decision ${decision} from ${workerId}`,
          case_decisions: caseIds.map((cid) => ({
            case_id: cid,
            decision: decision === "UAT_PASS" ? "PASS" : "FAIL",
            comment: `Checked by ${workerId}`,
          })),
        },
        ownerActor,
        { store }
      );
      process.stdout.write(
        JSON.stringify({ ok: true, workerId, decision, user_decision: res.user_decision, rev: res.revision }) + "\n"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(JSON.stringify({ ok: false, workerId, decision, error: msg }) + "\n");
    }
    return;
  }

  if (mode === "multi_seq_stress") {
    const barrierDir = arg5;
    const iterations = Number(arg6 || "5");
    waitForBarrier(barrierDir, workerId, 4);

    for (let i = 1; i <= iterations; i++) {
      await store.transact(
        `STRESS_${workerId}_${i}`,
        (draft) => {
          draft.withdrawals[`stress.${workerId}.${i}`] = {
            target_id: `stress.${workerId}.${i}`,
            reason: `iter_${i}`,
            withdrawn_by: `actor.${workerId}`,
            withdrawn_at: new Date().toISOString(),
            active: false,
          };
        },
        {
          actorId: `actor.${workerId}`,
          auditMeta: { worker: workerId, iter: i },
        }
      );
    }
    process.stdout.write(JSON.stringify({ ok: true, workerId, iterations }) + "\n");
    return;
  }

  throw new Error(`Unknown worker mode: ${mode}`);
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.stack || err.message : String(err)) + "\n");
  process.exit(1);
});
