/**
 * REG24 — Durable Disk-Backed Transactional Canonical Store
 *
 * Persists canonical knowledge objects, jobs, leases, idempotency fingerprints,
 * outbox events, release state transitions, and projection generations to disk
 * using an append-only WAL (`wal.jsonl`) and atomic rename snapshots (`canonical-state.json`).
 *
 * Supports:
 * - Crash/restart persistence verification across fresh instances (AT01, AT06, AT15, AT24)
 * - Multi-worker optimistic concurrency & file reload before commit
 * - Read-only serverless filesystem fallback (seeds `/tmp/reg24-knowledge-store` from `data/knowledge-store`)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";
import { sha256Bytes } from "./identity";
import {
  FIXED_BATCH_ORDER,
  type Acceptance,
  type Artifact,
  type Assertion,
  type BatchId,
  type BatchManifest,
  type Candidate,
  type EvaluationReport,
  type Extraction,
  type LegalVersion,
  type LegalWork,
  type Passage,
  type ProjectionReceipt,
  type ReleaseReport,
  type ReleaseState,
  type UATCase,
  type UnresolvedReferenceRecord,
} from "./contracts";
import type { PersistedCitationTraceabilityState } from "./citation-contracts";

export interface IdempotencyRecord {
  key: string;
  semantic_fingerprint: string;
  result_ref: Record<string, unknown>;
  created_at: string;
}

export interface DurableJobState {
  job_id: string;
  batch_id: BatchId;
  manifest_id: string | null;
  release_id: string | null;
  kind: "INVENTORY_DISCOVERY" | "BATCH_RUN" | "OCR_PAGE_TASK" | "EVALUATION";
  state: "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
  lease_owner: string | null;
  fencing_token: number;
  lease_expires_at: string | null;
  checkpoint: Record<string, unknown>;
  ocr_pages_dispatched: number;
  ocr_dispatch_budget: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface OutboxRecord {
  outbox_id: string;
  release_id: string;
  batch_id: BatchId;
  manifest_hash: string;
  status: "PENDING" | "DISPATCHED" | "COMPLETED" | "FAILED";
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

export interface SupersessionLineage {
  supersedes_release_id: string;
  supersedes_manifest_id: string;
  supersedes_manifest_hash: string;
  prior_release_preserved_state: ReleaseState;
  prior_chat_approval_preserved: boolean;
  explanation: string;
}

export interface ReleaseRecord {
  release_id: string;
  batch_id: BatchId;
  manifest_id: string;
  manifest_hash: string;
  code_commit: string;
  state: ReleaseState;
  revision: number;
  previous_accepted_release_id: string | null;
  rollback_target_release_id: string | null;
  supersession_lineage?: SupersessionLineage | null;
  created_work_ids: string[];
  created_version_ids: string[];
  created_passage_ids: string[];
  created_assertion_ids: string[];
  reused_work_ids: string[];
  coverage_gaps: string[];
  transitions: Array<{
    from: ReleaseState | null;
    to: ReleaseState;
    actor_id: string;
    at: string;
    revision: number;
    note: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface ReviewQueueItem {
  review_id: string;
  batch_id: BatchId;
  release_id: string | null;
  work_id: string | null;
  candidate_id: string | null;
  category:
    | "CRITICAL_PILOT_EVIDENCE"
    | "AMBIGUOUS_IDENTITY"
    | "CRITICAL_TOKEN_UNCERTAINTY"
    | "SUBSTANTIVE_AUTHORITY_LINK"
    | "STRATIFIED_AUDIT"
    | "QUERY_ESCALATION";
  stratum: string;
  severity: "CRITICAL" | "HIGH" | "ROUTINE_AUDIT";
  summary: string;
  evidence_locator_summary: string;
  status: "PENDING" | "APPROVED" | "CORRECTED" | "REJECTED_DEFECT";
  reviewer_id: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface WithdrawalRestriction {
  target_id: string; // work_id or artifact_id
  reason: string;
  withdrawn_by: string;
  withdrawn_at: string;
  active: boolean;
}

export interface CanonicalPersistedState {
  schema_version: "1.1";
  store_revision: number;
  active_release_id: string | null;
  accepted_batch_releases: Partial<Record<BatchId, { release_id: string; state: "ACCEPTED" | "ACCEPTED_WITH_DECLARED_GAPS" }>>;
  legacy_crosswalk: Record<string, string>; // legacy_id -> canonical_work_id
  manifests: Record<string, BatchManifest>;
  candidates: Record<string, Candidate>;
  artifacts: Record<string, Artifact>;
  works: Record<string, LegalWork>;
  versions: Record<string, LegalVersion>;
  extractions: Record<string, Extraction>;
  passages: Record<string, Passage>;
  assertions: Record<string, Assertion>;
  unresolved_references: Record<string, UnresolvedReferenceRecord>;
  jobs: Record<string, DurableJobState>;
  idempotency: Record<string, IdempotencyRecord>;
  outbox: Record<string, OutboxRecord>;
  releases: Record<string, ReleaseRecord>;
  projection_receipts: Record<string, ProjectionReceipt[]>;
  uat_cases: Record<string, UATCase[]>; // release_id -> UATCase[]
  acceptances: Record<string, Acceptance>; // release_id -> Acceptance
  evaluations: Record<string, EvaluationReport>; // release_id -> EvaluationReport
  release_reports: Record<string, ReleaseReport>; // batch_id or release_id -> ReleaseReport
  reviews: Record<string, ReviewQueueItem>;
  withdrawals: Record<string, WithdrawalRestriction>;
  active_vector_ids_by_release: Record<string, string[]>;
  citation_ledger?: PersistedCitationTraceabilityState;
}

function createEmptyState(): CanonicalPersistedState {
  return {
    schema_version: "1.1",
    store_revision: 0,
    active_release_id: null,
    accepted_batch_releases: {},
    legacy_crosswalk: {},
    manifests: {},
    candidates: {},
    artifacts: {},
    works: {},
    versions: {},
    extractions: {},
    passages: {},
    assertions: {},
    unresolved_references: {},
    jobs: {},
    idempotency: {},
    outbox: {},
    releases: {},
    projection_receipts: {},
    uat_cases: {},
    acceptances: {},
    evaluations: {},
    release_reports: {},
    reviews: {},
    withdrawals: {},
    active_vector_ids_by_release: {},
  };
}

export interface TransactOptions {
  expectedRevision?: number;
  actorId?: string;
  auditMeta?: Record<string, unknown>;
}

export interface WalCommitEntry {
  seq: number;
  prev_seq: number;
  at: string;
  pid: number;
  actor_id: string;
  op: string;
  prev_state_sha256: string;
  next_state_sha256: string;
  staged_file?: string;
  meta: Record<string, unknown>;
}

export interface StorageTopologyInfo {
  topology_mode:
    | "explicit_custom_dir"
    | "configured_env_dir"
    | "local_repo_locked_fs"
    | "ephemeral_serverless_tmp";
  data_dir: string;
  cross_process_locking: "os_excl_lockfile_with_wal_cas";
  durable_across_cold_starts: boolean;
  durable_across_horizontal_instances: boolean;
  warning: string | null;
}

const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function sleepSyncMs(ms: number): void {
  Atomics.wait(SLEEP_ARRAY, 0, 0, Math.max(1, ms));
}

function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === "EPERM";
  }
}

export class DurableKnowledgeStore {
  public readonly dataDir: string;
  private readonly topologyInfo: StorageTopologyInfo;
  private readonly stateFilePath: string;
  private readonly stateGzFilePath: string;
  private readonly walFilePath: string;
  private readonly lockFilePath: string;
  private readonly stagedDir: string;
  private readonly artifactsDir: string;
  private readonly reportsDir: string;
  private state: CanonicalPersistedState;
  private cachedMtimeMs = -1;
  private cachedFileSize = -1;
  private cachedWalSize = -1;
  private releasePassagesCache = new Map<string, Passage[]>();
  private releaseAssertionsCache = new Map<string, Assertion[]>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(customDataDir?: string) {
    const resolved = this.resolveWritableDataDir(customDataDir);
    this.dataDir = resolved.dir;
    this.topologyInfo = resolved.topology;
    this.stateFilePath = path.join(this.dataDir, "canonical-state.json");
    this.stateGzFilePath = path.join(this.dataDir, "canonical-state.json.gz");
    this.walFilePath = path.join(this.dataDir, "wal.jsonl");
    this.lockFilePath = path.join(this.dataDir, "store.lock");
    this.stagedDir = path.join(this.dataDir, ".staged-commits");
    this.artifactsDir = path.join(this.dataDir, "artifacts");
    this.reportsDir = path.join(this.dataDir, "reports");

    fs.mkdirSync(this.stagedDir, { recursive: true });
    fs.mkdirSync(this.artifactsDir, { recursive: true });
    fs.mkdirSync(this.reportsDir, { recursive: true });

    this.recoverPendingCommitsIfNeeded();
    this.state = this.loadFromDisk(true);
  }

  public getStorageTopology(): StorageTopologyInfo {
    return { ...this.topologyInfo };
  }

  private resolveWritableDataDir(customDataDir?: string): {
    dir: string;
    topology: StorageTopologyInfo;
  } {
    if (customDataDir) {
      fs.mkdirSync(customDataDir, { recursive: true });
      return {
        dir: customDataDir,
        topology: {
          topology_mode: "explicit_custom_dir",
          data_dir: customDataDir,
          cross_process_locking: "os_excl_lockfile_with_wal_cas",
          durable_across_cold_starts: true,
          durable_across_horizontal_instances: true,
          warning: null,
        },
      };
    }
    const envDir = process.env.REG24_KNOWLEDGE_DATA_DIR;
    if (envDir) {
      fs.mkdirSync(envDir, { recursive: true });
      return {
        dir: envDir,
        topology: {
          topology_mode: "configured_env_dir",
          data_dir: envDir,
          cross_process_locking: "os_excl_lockfile_with_wal_cas",
          durable_across_cold_starts: true,
          durable_across_horizontal_instances: true,
          warning: null,
        },
      };
    }

    const usePreviewB01Rc2 =
      process.env.VERCEL_ENV === "preview" ||
      process.env.REG24_USE_B01_RC2_PREVIEW_STORE === "1";
    const previewRepoDir = path.join(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
    const defaultRepoDir = path.join(process.cwd(), "data", "knowledge-store");
    const selectPreviewStore = usePreviewB01Rc2 && fs.existsSync(previewRepoDir);
    const repoDir = selectPreviewStore ? previewRepoDir : defaultRepoDir;
    try {
      fs.mkdirSync(repoDir, { recursive: true });
      const probeFile = path.join(repoDir, `.write-probe-${process.pid}-${Math.random().toString(36).slice(2, 6)}`);
      fs.writeFileSync(probeFile, "ok", "utf8");
      fs.unlinkSync(probeFile);
      return {
        dir: repoDir,
        topology: {
          topology_mode: "local_repo_locked_fs",
          data_dir: repoDir,
          cross_process_locking: "os_excl_lockfile_with_wal_cas",
          durable_across_cold_starts: true,
          durable_across_horizontal_instances: false,
          warning: null,
        },
      };
    } catch {
      // Read-only serverless deployment (e.g. Vercel /var/task): seed /tmp from committed store snapshot
      const tmpDirName = selectPreviewStore
        ? "reg24-knowledge-store-b01-rc2-preview"
        : "reg24-knowledge-store";
      const tmpFallback = path.join(os.tmpdir(), tmpDirName);
      const hasTmpState =
        fs.existsSync(path.join(tmpFallback, "canonical-state.json")) ||
        fs.existsSync(path.join(tmpFallback, "canonical-state.json.gz"));
      if (!hasTmpState && fs.existsSync(repoDir)) {
        fs.cpSync(repoDir, tmpFallback, { recursive: true, force: true });
      } else {
        fs.mkdirSync(tmpFallback, { recursive: true });
      }
      return {
        dir: tmpFallback,
        topology: {
          topology_mode: "ephemeral_serverless_tmp",
          data_dir: tmpFallback,
          cross_process_locking: "os_excl_lockfile_with_wal_cas",
          durable_across_cold_starts: false,
          durable_across_horizontal_instances: false,
          warning:
            "Runtime filesystem is read-only (/var/task); writes land in ephemeral container /tmp and do NOT persist across serverless cold starts or separate warm instances.",
        },
      };
    }
  }

  private tryAcquireLockOnce(token: string, staleMs = 30_000): boolean {
    try {
      const fd = fs.openSync(this.lockFilePath, "wx");
      const payload = JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        token,
        acquired_at: Date.now(),
      });
      fs.writeSync(fd, payload, undefined, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      return true;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw err;
      // Inspect existing lock to detect dead PID or expired lease
      try {
        const raw = fs.readFileSync(this.lockFilePath, "utf8");
        const parsed = JSON.parse(raw) as { pid?: number; host?: string; acquired_at?: number };
        const age = Date.now() - (parsed.acquired_at || 0);
        const sameHostDead =
          parsed.host === os.hostname() && parsed.pid ? !isProcessAlive(parsed.pid) : false;
        if (sameHostDead || age > staleMs) {
          const deadPath = `${this.lockFilePath}.stale.${process.pid}.${Date.now()}`;
          try {
            fs.renameSync(this.lockFilePath, deadPath);
            fs.unlinkSync(deadPath);
          } catch {
            // Another process already cleaned up the stale lock
          }
        }
      } catch {
        // Lock might have been released mid-read or still being written (<1ms); check mtime fallback
        try {
          const st = fs.statSync(this.lockFilePath);
          if (Date.now() - st.mtimeMs > staleMs) {
            fs.unlinkSync(this.lockFilePath);
          }
        } catch {
          // Ignore
        }
      }
      return false;
    }
  }

  private releaseLock(token: string): void {
    try {
      if (!fs.existsSync(this.lockFilePath)) return;
      const raw = fs.readFileSync(this.lockFilePath, "utf8");
      const parsed = JSON.parse(raw) as { token?: string };
      if (!parsed.token || parsed.token === token) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch {
      // Ignore if already removed
    }
  }

  private acquireLockSync(timeoutMs = 30_000): string {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.tryAcquireLockOnce(token)) return token;
      const jitter = 8 + Math.floor(Math.random() * 18);
      sleepSyncMs(jitter);
    }
    throw new Error(`STORE_LOCK_TIMEOUT_409: Timed out acquiring exclusive store lock at ${this.lockFilePath}`);
  }

  private async acquireLockAsync(timeoutMs = 30_000): Promise<string> {
    const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.tryAcquireLockOnce(token)) return token;
      const jitter = 8 + Math.floor(Math.random() * 18);
      await new Promise((r) => setTimeout(r, jitter));
    }
    throw new Error(`STORE_LOCK_TIMEOUT_409: Timed out acquiring exclusive store lock at ${this.lockFilePath}`);
  }

  public readWalEntries(): WalCommitEntry[] {
    if (!fs.existsSync(this.walFilePath)) return [];
    const raw = fs.readFileSync(this.walFilePath, "utf8");
    const out: WalCommitEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as WalCommitEntry);
      } catch {
        // Ignore torn trailing line on simulated hard power-off before newline
      }
    }
    return out;
  }

  private readLastWalSeq(): number {
    const entries = this.readWalEntries();
    let maxSeq = 0;
    for (const e of entries) {
      if (typeof e.seq === "number" && e.seq > maxSeq) maxSeq = e.seq;
    }
    return maxSeq;
  }

  /**
   * Crash/Restart Recovery:
   * - If a process wrote a staged snapshot AND committed its WAL entry (`seq = K`),
   *   but crashed before swapping `canonical-state.json[.gz]`, roll forward the committed staged file!
   * - Clean up any uncommitted `.tmp.*` or orphan staged files.
   */
  public recoverPendingCommitsIfNeeded(): void {
    const token = this.acquireLockSync();
    try {
      const entries = this.readWalEntries();
      const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
      const active = this.resolveActiveStateDiskPath();

      let currentRev = -1;
      if (active) {
        try {
          const raw = active.gzipped
            ? zlib.gunzipSync(fs.readFileSync(active.filePath)).toString("utf8")
            : fs.readFileSync(active.filePath, "utf8");
          currentRev = (JSON.parse(raw) as CanonicalPersistedState).store_revision ?? 0;
        } catch {
          currentRev = -1;
        }
      }

      if (lastEntry && lastEntry.staged_file && lastEntry.seq > currentRev) {
        const stagedPath = path.join(this.stagedDir, lastEntry.staged_file);
        if (fs.existsSync(stagedPath)) {
          const isGz = stagedPath.endsWith(".gz");
          const targetPath = isGz ? this.stateGzFilePath : this.stateFilePath;
          const stalePath = isGz ? this.stateFilePath : this.stateGzFilePath;
          fs.copyFileSync(stagedPath, `${targetPath}.recover.${process.pid}`);
          fs.renameSync(`${targetPath}.recover.${process.pid}`, targetPath);
          if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
        }
      }

      // Clean orphan .tmp.* files in dataDir and consumed staged files
      for (const fn of fs.readdirSync(this.dataDir)) {
        if (fn.includes(".tmp.") || fn.includes(".recover.")) {
          try {
            fs.unlinkSync(path.join(this.dataDir, fn));
          } catch {
            // Ignore
          }
        }
      }
      if (fs.existsSync(this.stagedDir)) {
        for (const fn of fs.readdirSync(this.stagedDir)) {
          try {
            fs.unlinkSync(path.join(this.stagedDir, fn));
          } catch {
            // Ignore
          }
        }
      }
    } finally {
      this.releaseLock(token);
    }
  }

  public reloadFromDisk(): CanonicalPersistedState {
    this.cachedMtimeMs = -1;
    this.cachedFileSize = -1;
    this.cachedWalSize = -1;
    this.releasePassagesCache.clear();
    this.releaseAssertionsCache.clear();
    this.state = this.loadFromDisk(true);
    return this.state;
  }

  private resolveActiveStateDiskPath(): { filePath: string; gzipped: boolean } | null {
    const hasGz = fs.existsSync(this.stateGzFilePath);
    const hasPlain = fs.existsSync(this.stateFilePath);
    if (hasGz && hasPlain) {
      const stGz = fs.statSync(this.stateGzFilePath);
      const stPlain = fs.statSync(this.stateFilePath);
      return stGz.mtimeMs >= stPlain.mtimeMs
        ? { filePath: this.stateGzFilePath, gzipped: true }
        : { filePath: this.stateFilePath, gzipped: false };
    }
    if (hasGz) return { filePath: this.stateGzFilePath, gzipped: true };
    if (hasPlain) return { filePath: this.stateFilePath, gzipped: false };
    return null;
  }

  private loadFromDisk(forceReload = false): CanonicalPersistedState {
    const active = this.resolveActiveStateDiskPath();
    if (active) {
      const st = fs.statSync(active.filePath);
      const walSize = fs.existsSync(this.walFilePath) ? fs.statSync(this.walFilePath).size : 0;
      if (
        !forceReload &&
        this.state &&
        st.mtimeMs === this.cachedMtimeMs &&
        st.size === this.cachedFileSize &&
        walSize === this.cachedWalSize
      ) {
        return this.state;
      }
      const raw = active.gzipped
        ? zlib.gunzipSync(fs.readFileSync(active.filePath)).toString("utf8")
        : fs.readFileSync(active.filePath, "utf8");
      const parsed = JSON.parse(raw) as CanonicalPersistedState;
      this.cachedMtimeMs = st.mtimeMs;
      this.cachedFileSize = st.size;
      this.cachedWalSize = walSize;
      this.releasePassagesCache.clear();
      this.releaseAssertionsCache.clear();
      this.state = parsed;
      return parsed;
    }

    const token = this.acquireLockSync();
    try {
      // Double-check under lock in case another process just initialized the store!
      const recheck = this.resolveActiveStateDiskPath();
      if (recheck) {
        const raw = recheck.gzipped
          ? zlib.gunzipSync(fs.readFileSync(recheck.filePath)).toString("utf8")
          : fs.readFileSync(recheck.filePath, "utf8");
        const parsed = JSON.parse(raw) as CanonicalPersistedState;
        this.state = parsed;
        return parsed;
      }
      const initial = createEmptyState();
      this.atomicPersistLocked(initial, 0, "INIT_STORE", "system", {});
      return initial;
    } finally {
      this.releaseLock(token);
    }
  }

  private atomicPersistLocked(
    nextState: CanonicalPersistedState,
    prevRevision: number,
    op: string,
    actorId: string,
    meta: Record<string, unknown>,
    prevShaHint?: string
  ): void {
    const walEntries = this.readWalEntries();
    const lastWalEntry = walEntries.length > 0 ? walEntries[walEntries.length - 1] : null;
    const lastWalSeq = walEntries.reduce((mx, e) => (typeof e.seq === "number" && e.seq > mx ? e.seq : mx), 0);
    const nextSeq = Math.max(prevRevision, lastWalSeq) + 1;
    nextState.store_revision = nextSeq;

    const serialized = JSON.stringify(nextState);
    const nextSha = sha256Bytes(serialized);
    const prevSha = lastWalEntry?.next_state_sha256 || prevShaHint || "";
    const useGzip = serialized.length > 4_000_000;
    const stagedName = `commit-${nextSeq}${useGzip ? ".json.gz" : ".json"}`;
    const stagedPath = path.join(this.stagedDir, stagedName);

    // 1. Write durable staged snapshot first and fsync before appending WAL commit record
    const payloadBuf = useGzip
      ? zlib.gzipSync(Buffer.from(serialized, "utf8"), { level: 6 })
      : Buffer.from(serialized, "utf8");
    const sfd = fs.openSync(stagedPath, "w");
    fs.writeSync(sfd, payloadBuf);
    fs.fsyncSync(sfd);
    fs.closeSync(sfd);

    // 2. Append strictly monotonic WAL commit entry with full audit envelope and fsync
    const walEntryObj: WalCommitEntry = {
      seq: nextSeq,
      prev_seq: prevRevision,
      at: new Date().toISOString(),
      pid: process.pid,
      actor_id: actorId,
      op,
      prev_state_sha256: prevSha,
      next_state_sha256: nextSha,
      staged_file: stagedName,
      meta: {
        ...meta,
        active_release_id: nextState.active_release_id,
      },
    };
    const wfd = fs.openSync(this.walFilePath, "a");
    fs.writeSync(wfd, `${JSON.stringify(walEntryObj)}\n`, undefined, "utf8");
    fs.fsyncSync(wfd);
    fs.closeSync(wfd);

    // 3. Atomically swap staged snapshot into canonical-state.json[.gz]
    const targetPath = useGzip ? this.stateGzFilePath : this.stateFilePath;
    const stalePath = useGzip ? this.stateFilePath : this.stateGzFilePath;
    fs.renameSync(stagedPath, targetPath);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }

    const st = fs.statSync(targetPath);
    const walStat = fs.statSync(this.walFilePath);
    this.cachedMtimeMs = st.mtimeMs;
    this.cachedFileSize = st.size;
    this.cachedWalSize = walStat.size;
    this.releasePassagesCache.clear();
    this.releaseAssertionsCache.clear();
  }

  /**
   * Serializes concurrent mutations BOTH within the current Node process (`writeChain`) AND
   * across separate OS processes (`store.lock`), enforcing optional optimistic concurrency
   * (`expectedRevision` -> `STALE_REVISION_CONFLICT_409`) and unique monotonic WAL sequencing.
   */
  public async transact<T>(
    opName: string,
    mutator: (draft: CanonicalPersistedState) => T,
    opts?: TransactOptions
  ): Promise<T> {
    let result!: T;
    const run = this.writeChain.then(async () => {
      const token = await this.acquireLockAsync();
      try {
        const latest = this.loadFromDisk(true);
        const prevRev = latest.store_revision;
        if (typeof opts?.expectedRevision === "number" && prevRev !== opts.expectedRevision) {
          throw new Error(
            `STALE_REVISION_CONFLICT_409: Expected store_revision=${opts.expectedRevision}, actual=${prevRev} for ${opName}.`
          );
        }
        const prevSha = sha256Bytes(
          JSON.stringify({
            rev: prevRev,
            active: latest.active_release_id,
            releases: Object.keys(latest.releases).length,
          })
        );
        result = mutator(latest);
        this.atomicPersistLocked(
          latest,
          prevRev,
          opName,
          opts?.actorId || "system",
          opts?.auditMeta || {},
          prevSha
        );
        this.state = latest;
      } finally {
        this.releaseLock(token);
      }
    });
    // Ensure writeChain never stays rejected
    this.writeChain = run.catch(() => undefined);
    await run;
    return result;
  }

  public transactSync<T>(
    opName: string,
    mutator: (draft: CanonicalPersistedState) => T,
    opts?: TransactOptions
  ): T {
    const token = this.acquireLockSync();
    try {
      const latest = this.loadFromDisk(true);
      const prevRev = latest.store_revision;
      if (typeof opts?.expectedRevision === "number" && prevRev !== opts.expectedRevision) {
        throw new Error(
          `STALE_REVISION_CONFLICT_409: Expected store_revision=${opts.expectedRevision}, actual=${prevRev} for ${opName}.`
        );
      }
      const prevSha = sha256Bytes(
        JSON.stringify({
          rev: prevRev,
          active: latest.active_release_id,
          releases: Object.keys(latest.releases).length,
        })
      );
      const res = mutator(latest);
      this.atomicPersistLocked(
        latest,
        prevRev,
        opName,
        opts?.actorId || "system",
        opts?.auditMeta || {},
        prevSha
      );
      this.state = latest;
      return res;
    } finally {
      this.releaseLock(token);
    }
  }

  public storeImmutableArtifactBytes(
    bytes: Buffer | Uint8Array,
    opts?: { skipRawDiskBlob?: boolean; precomputedSha256?: string; precomputedSize?: number }
  ): {
    sha256: string;
    immutable_uri: string;
    size: number;
  } {
    const buf = Buffer.from(bytes);
    const sha256 = opts?.precomputedSha256 || sha256Bytes(buf);
    const size = opts?.precomputedSize ?? buf.byteLength;
    if (!opts?.skipRawDiskBlob) {
      const blobPath = path.join(this.artifactsDir, `${sha256}.bin`);
      if (!fs.existsSync(blobPath)) {
        fs.writeFileSync(blobPath, buf);
      }
    }
    return {
      sha256,
      immutable_uri: `artifact://sha256/${sha256}`,
      size,
    };
  }

  public readArtifactBytes(sha256: string): Buffer | null {
    const blobPath = path.join(this.artifactsDir, `${sha256}.bin`);
    if (!fs.existsSync(blobPath)) return null;
    return fs.readFileSync(blobPath);
  }

  public writeReportArtifact(fileName: string, payload: unknown): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(this.reportsDir, safeName);
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
    return `report://knowledge/${safeName}`;
  }

  public readReportArtifact<T = unknown>(uriOrName: string): T | null {
    const safeName = uriOrName.replace(/^report:\/\/knowledge\//, "").replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(this.reportsDir, safeName);
    if (!fs.existsSync(targetPath)) return null;
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as T;
  }

  // Read helpers (reload latest disk state for cross-instance consistency)
  public getState(): CanonicalPersistedState {
    return this.loadFromDisk();
  }

  public getCrosswalkTarget(legacyId: string): string | undefined {
    return this.getState().legacy_crosswalk[legacyId];
  }

  public getWork(workId: string): LegalWork | undefined {
    return this.getState().works[workId];
  }

  public listAllWorks(): LegalWork[] {
    return Object.values(this.getState().works);
  }

  public findWorksByNormalizedIdentifier(normalizedId: string): LegalWork[] {
    return Object.values(this.getState().works).filter((w) =>
      w.official_identifiers.some((id) => id.normalized === normalizedId)
    );
  }

  public upsertWork(work: LegalWork): void {
    this.transactSync("UPSERT_WORK", (s) => {
      s.works[work.work_id] = work;
    });
  }

  public getArtifact(artifactId: string): Artifact | undefined {
    return this.getState().artifacts[artifactId];
  }

  public getVersionsForWork(workId: string): LegalVersion[] {
    return Object.values(this.getState().versions).filter((v) => v.work_id === workId);
  }

  public getExtractionsForWork(workId: string): Extraction[] {
    return Object.values(this.getState().extractions).filter((e) => e.work_id === workId);
  }

  private resolveAllowedReleaseChain(st: CanonicalPersistedState, releaseId: string): Set<string> {
    const allowedReleases = new Set<string>([releaseId]);
    const rel = st.releases[releaseId];
    if (rel) {
      let prev = rel.previous_accepted_release_id;
      while (prev && !allowedReleases.has(prev)) {
        allowedReleases.add(prev);
        prev = st.releases[prev]?.previous_accepted_release_id ?? null;
      }
      return allowedReleases;
    }
    // Fallback before release record is persisted: include only strictly earlier batches
    const m = /^rel\.(B\d{2})\./.exec(releaseId);
    const targetIdx = m ? FIXED_BATCH_ORDER.indexOf(m[1] as BatchId) : -1;
    for (const [bId, acc] of Object.entries(st.accepted_batch_releases)) {
      if (!acc?.release_id) continue;
      const bIdx = FIXED_BATCH_ORDER.indexOf(bId as BatchId);
      if (targetIdx === -1 || (bIdx !== -1 && bIdx < targetIdx)) {
        allowedReleases.add(acc.release_id);
      }
    }
    return allowedReleases;
  }

  public getPassagesForRelease(releaseId: string): Passage[] {
    const st = this.getState();
    const cacheKey = `${st.store_revision}:${releaseId}`;
    const hit = this.releasePassagesCache.get(cacheKey);
    if (hit) return hit;

    // Cumulative over ancestor chain, hiding earlier dependency stubs once authoritative passages arrive
    // AND hiding any prior version explicitly superseded by a newer verified version in `allowedReleases`
    // (preserves clean rollback when querying the older releaseId directly!).
    const allowedReleases = this.resolveAllowedReleaseChain(st, releaseId);
    const raw = Object.values(st.passages).filter((p) => allowedReleases.has(p.release_id));
    const upgradedWorkIds = new Set<string>();
    const supersededVersionIds = new Set<string>();
    for (const p of raw) {
      if (!p.extraction_id.startsWith("ext.dep.")) {
        upgradedWorkIds.add(p.work_id);
      }
      const ver = st.versions[p.version_id];
      if (ver?.supersedes_version_ids) {
        for (const supVerId of ver.supersedes_version_ids) {
          supersededVersionIds.add(supVerId);
        }
      }
    }
    const seenPassageIds = new Set<string>();
    const res = raw.filter((p) => {
      if (p.extraction_id.startsWith("ext.dep.") && upgradedWorkIds.has(p.work_id)) {
        return false;
      }
      if (supersededVersionIds.has(p.version_id)) {
        return false;
      }
      if (seenPassageIds.has(p.passage_id)) {
        return false;
      }
      seenPassageIds.add(p.passage_id);
      return true;
    });
    this.releasePassagesCache.set(cacheKey, res);
    return res;
  }

  public getAcceptedAssertionsForRelease(releaseId: string): Assertion[] {
    const st = this.getState();
    const cacheKey = `${st.store_revision}:${releaseId}`;
    const hit = this.releaseAssertionsCache.get(cacheKey);
    if (hit) return hit;

    const allowedReleases = this.resolveAllowedReleaseChain(st, releaseId);
    const res = Object.values(st.assertions).filter(
      (a) => a.state === "ACCEPTED" && allowedReleases.has(a.release_id)
    );
    this.releaseAssertionsCache.set(cacheKey, res);
    return res;
  }

  public getAcceptedCounts(): {
    works: number;
    versions: number;
    extractions: number;
    passages: number;
    accepted_assertions: number;
    active_vectors: number;
  } {
    const st = this.getState();
    const activeVecSet = new Set<string>();
    for (const ids of Object.values(st.active_vector_ids_by_release)) {
      for (const id of ids) activeVecSet.add(id);
    }
    return {
      works: Object.keys(st.works).length,
      versions: Object.keys(st.versions).length,
      extractions: Object.keys(st.extractions).length,
      passages: Object.keys(st.passages).length,
      accepted_assertions: Object.values(st.assertions).filter((a) => a.state === "ACCEPTED").length,
      active_vectors: activeVecSet.size,
    };
  }
}

let defaultStoreSingleton: DurableKnowledgeStore | null = null;

export function getDefaultKnowledgeStore(): DurableKnowledgeStore {
  if (!defaultStoreSingleton) {
    defaultStoreSingleton = new DurableKnowledgeStore();
  }
  return defaultStoreSingleton;
}

export function setDefaultKnowledgeStoreForTesting(store: DurableKnowledgeStore | null): void {
  defaultStoreSingleton = store;
}
