/**
 * REG24 — Task F2: Durable Job Queue, Worker Leases, Fencing Tokens & OCR Dispatch Budgets
 * Implements SH-08, Section 6 & 03_OCR_AUDIT_ADJUSTMENTS.md Section 6 (AT24).
 */

import { sha256Bytes } from "./identity";
import type { BatchId } from "./contracts";
import type { DurableJobState, DurableKnowledgeStore } from "./store";

export class KnowledgeJobManager {
  constructor(private readonly store: DurableKnowledgeStore) {}

  public createJob(params: {
    batch_id: BatchId;
    kind: DurableJobState["kind"];
    manifest_id?: string | null;
    release_id?: string | null;
    ocr_dispatch_budget?: number;
    created_by: string;
  }): DurableJobState {
    const now = new Date().toISOString();
    const jobId = `job.${params.batch_id.toLowerCase()}.${sha256Bytes(`${params.batch_id}:${params.kind}:${now}:${Math.random()}`).slice(0, 10)}`;

    const record: DurableJobState = {
      job_id: jobId,
      batch_id: params.batch_id,
      manifest_id: params.manifest_id ?? null,
      release_id: params.release_id ?? null,
      kind: params.kind,
      state: "QUEUED",
      lease_owner: null,
      fencing_token: 0,
      lease_expires_at: null,
      checkpoint: {},
      ocr_pages_dispatched: 0,
      ocr_dispatch_budget: params.ocr_dispatch_budget ?? 250,
      created_by: params.created_by,
      created_at: now,
      updated_at: now,
      error: null,
    };

    this.store.transactSync("CREATE_JOB", (s) => {
      s.jobs[jobId] = record;
    });
    return record;
  }

  public acquireLease(
    jobId: string,
    workerId: string,
    leaseDurationMs = 5 * 60 * 1000
  ): DurableJobState {
    return this.store.transactSync("ACQUIRE_JOB_LEASE", (s) => {
      const job = s.jobs[jobId];
      if (!job) {
        throw new Error(`JOB_NOT_FOUND: ${jobId}`);
      }
      job.fencing_token += 1;
      job.lease_owner = workerId;
      job.lease_expires_at = new Date(Date.now() + leaseDurationMs).toISOString();
      if (job.state === "QUEUED" || job.state === "PAUSED") {
        job.state = "RUNNING";
      }
      job.updated_at = new Date().toISOString();
      return { ...job };
    });
  }

  public checkpointJob(
    jobId: string,
    fencingToken: number,
    checkpointPatch: Record<string, unknown>,
    ocrPagesDelta = 0
  ): DurableJobState {
    return this.store.transactSync("CHECKPOINT_JOB", (s) => {
      const job = s.jobs[jobId];
      if (!job) {
        throw new Error(`JOB_NOT_FOUND: ${jobId}`);
      }
      if (fencingToken !== job.fencing_token) {
        throw new Error(
          `STALE_WORKER_FENCING_TOKEN: worker presented token ${fencingToken}, current token is ${job.fencing_token}`
        );
      }

      const nextOcrDispatched = job.ocr_pages_dispatched + ocrPagesDelta;
      job.checkpoint = { ...job.checkpoint, ...checkpointPatch };
      job.ocr_pages_dispatched = nextOcrDispatched;
      job.updated_at = new Date().toISOString();

      // Audit adjustment Section 6: 250 OCR-invoked-page dispatch budget pauses dispatch safely at checkpoint
      if (nextOcrDispatched >= job.ocr_dispatch_budget && ocrPagesDelta > 0) {
        job.state = "PAUSED";
        job.checkpoint.pause_reason = "OCR_DISPATCH_BUDGET_REACHED_250_PAGES";
      }

      return { ...job };
    });
  }

  public pauseJob(jobId: string, fencingToken?: number, reason = "OPERATOR_PAUSED"): DurableJobState {
    return this.store.transactSync("PAUSE_JOB", (s) => {
      const job = s.jobs[jobId];
      if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
      if (typeof fencingToken === "number" && fencingToken < job.fencing_token) {
        throw new Error(
          `STALE_WORKER_FENCING_TOKEN: cannot pause with stale token ${fencingToken} < ${job.fencing_token}`
        );
      }
      job.fencing_token += 1;
      job.state = "PAUSED";
      job.checkpoint = { ...job.checkpoint, pause_reason: reason };
      job.updated_at = new Date().toISOString();
      return { ...job };
    });
  }

  public resumeJob(jobId: string, workerId: string, fencingToken?: number): DurableJobState {
    return this.store.transactSync("RESUME_JOB", (s) => {
      const job = s.jobs[jobId];
      if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
      if (typeof fencingToken === "number" && fencingToken < job.fencing_token) {
        throw new Error(
          `STALE_WORKER_FENCING_TOKEN: cannot resume with stale token ${fencingToken} < ${job.fencing_token}`
        );
      }
      job.fencing_token += 1;
      job.lease_owner = workerId;
      job.state = "RUNNING";
      job.updated_at = new Date().toISOString();
      return { ...job };
    });
  }

  public completeJob(jobId: string, fencingToken: number): DurableJobState {
    return this.store.transactSync("COMPLETE_JOB", (s) => {
      const job = s.jobs[jobId];
      if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
      if (fencingToken !== job.fencing_token) {
        throw new Error(`STALE_WORKER_FENCING_TOKEN: ${fencingToken} !== ${job.fencing_token}`);
      }
      job.state = "COMPLETED";
      job.updated_at = new Date().toISOString();
      return { ...job };
    });
  }

  public getJob(jobId: string): DurableJobState | undefined {
    return this.store.getState().jobs[jobId];
  }

  /**
   * Splits a multi-page PDF's OCR demand into resumable <= 50-page tasks (Audit Section 6).
   */
  public planResumableOcrPageWindows(
    pageIndicesNeedingOcr: number[],
    maxPagesPerTask = 50
  ): Array<{ window_index: number; page_indices: number[] }> {
    const sorted = [...new Set(pageIndicesNeedingOcr)].sort((a, b) => a - b);
    const windows: Array<{ window_index: number; page_indices: number[] }> = [];
    for (let i = 0; i < sorted.length; i += maxPagesPerTask) {
      windows.push({
        window_index: windows.length,
        page_indices: sorted.slice(i, i + maxPagesPerTask),
      });
    }
    return windows;
  }
}
