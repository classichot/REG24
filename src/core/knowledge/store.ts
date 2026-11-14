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
import type {
  Acceptance,
  Artifact,
  Assertion,
  BatchId,
  BatchManifest,
  Candidate,
  EvaluationReport,
  Extraction,
  LegalVersion,
  LegalWork,
  Passage,
  ProjectionReceipt,
  ReleaseReport,
  ReleaseState,
  UATCase,
  UnresolvedReferenceRecord,
} from "./contracts";

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

export class DurableKnowledgeStore {
  public readonly dataDir: string;
  private readonly stateFilePath: string;
  private readonly stateGzFilePath: string;
  private readonly walFilePath: string;
  private readonly artifactsDir: string;
  private readonly reportsDir: string;
  private state: CanonicalPersistedState;
  private cachedMtimeMs = -1;
  private cachedFileSize = -1;
  private releasePassagesCache = new Map<string, Passage[]>();
  private releaseAssertionsCache = new Map<string, Assertion[]>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(customDataDir?: string) {
    this.dataDir = this.resolveWritableDataDir(customDataDir);
    this.stateFilePath = path.join(this.dataDir, "canonical-state.json");
    this.stateGzFilePath = path.join(this.dataDir, "canonical-state.json.gz");
    this.walFilePath = path.join(this.dataDir, "wal.jsonl");
    this.artifactsDir = path.join(this.dataDir, "artifacts");
    this.reportsDir = path.join(this.dataDir, "reports");

    fs.mkdirSync(this.artifactsDir, { recursive: true });
    fs.mkdirSync(this.reportsDir, { recursive: true });

    this.state = this.loadFromDisk();
  }

  private resolveWritableDataDir(customDataDir?: string): string {
    if (customDataDir) {
      fs.mkdirSync(customDataDir, { recursive: true });
      return customDataDir;
    }
    const envDir = process.env.REG24_KNOWLEDGE_DATA_DIR;
    if (envDir) {
      fs.mkdirSync(envDir, { recursive: true });
      return envDir;
    }

    const repoDir = path.join(process.cwd(), "data", "knowledge-store");
    try {
      fs.mkdirSync(repoDir, { recursive: true });
      const probeFile = path.join(repoDir, `.write-probe-${process.pid}`);
      fs.writeFileSync(probeFile, "ok", "utf8");
      fs.unlinkSync(probeFile);
      return repoDir;
    } catch {
      // Read-only serverless deployment (e.g. Vercel /var/task): seed /tmp from committed data/knowledge-store
      const tmpFallback = path.join(os.tmpdir(), "reg24-knowledge-store");
      const hasTmpState =
        fs.existsSync(path.join(tmpFallback, "canonical-state.json")) ||
        fs.existsSync(path.join(tmpFallback, "canonical-state.json.gz"));
      if (!hasTmpState && fs.existsSync(repoDir)) {
        fs.cpSync(repoDir, tmpFallback, { recursive: true, force: true });
      } else {
        fs.mkdirSync(tmpFallback, { recursive: true });
      }
      return tmpFallback;
    }
  }

  public reloadFromDisk(): CanonicalPersistedState {
    this.cachedMtimeMs = -1;
    this.cachedFileSize = -1;
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
      if (
        !forceReload &&
        this.state &&
        st.mtimeMs === this.cachedMtimeMs &&
        st.size === this.cachedFileSize
      ) {
        return this.state;
      }
      const raw = active.gzipped
        ? zlib.gunzipSync(fs.readFileSync(active.filePath)).toString("utf8")
        : fs.readFileSync(active.filePath, "utf8");
      const parsed = JSON.parse(raw) as CanonicalPersistedState;
      this.cachedMtimeMs = st.mtimeMs;
      this.cachedFileSize = st.size;
      this.releasePassagesCache.clear();
      this.releaseAssertionsCache.clear();
      this.state = parsed;
      return parsed;
    }
    const initial = createEmptyState();
    this.atomicPersist(initial, "INIT_STORE", {});
    return initial;
  }

  private atomicPersist(
    nextState: CanonicalPersistedState,
    op: string,
    meta: Record<string, unknown>
  ): void {
    nextState.store_revision += 1;
    const walEntry = JSON.stringify({
      seq: nextState.store_revision,
      at: new Date().toISOString(),
      op,
      meta,
    });
    fs.appendFileSync(this.walFilePath, `${walEntry}\n`, "utf8");

    const serialized = JSON.stringify(nextState);
    const useGzip = serialized.length > 12_000_000;
    const targetPath = useGzip ? this.stateGzFilePath : this.stateFilePath;
    const stalePath = useGzip ? this.stateFilePath : this.stateGzFilePath;

    const tmpFile = `${targetPath}.tmp.${process.pid}.${nextState.store_revision}.${Math.random().toString(36).slice(2, 7)}`;
    if (useGzip) {
      fs.writeFileSync(tmpFile, zlib.gzipSync(Buffer.from(serialized, "utf8"), { level: 6 }));
    } else {
      fs.writeFileSync(tmpFile, serialized, "utf8");
    }
    fs.renameSync(tmpFile, targetPath);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }
    const st = fs.statSync(targetPath);
    this.cachedMtimeMs = st.mtimeMs;
    this.cachedFileSize = st.size;
    this.releasePassagesCache.clear();
    this.releaseAssertionsCache.clear();
  }

  /**
   * Serializes concurrent mutations within/across async workers and reloads latest disk state
   * before applying the transactional mutator (SH-08 / AT01).
   */
  public async transact<T>(
    opName: string,
    mutator: (draft: CanonicalPersistedState) => T
  ): Promise<T> {
    let result!: T;
    const run = this.writeChain.then(() => {
      const latest = this.loadFromDisk();
      result = mutator(latest);
      this.atomicPersist(latest, opName, {});
      this.state = latest;
    });
    // Ensure writeChain never stays rejected
    this.writeChain = run.catch(() => undefined);
    await run;
    return result;
  }

  public transactSync<T>(
    opName: string,
    mutator: (draft: CanonicalPersistedState) => T
  ): T {
    const latest = this.loadFromDisk();
    const res = mutator(latest);
    this.atomicPersist(latest, opName, {});
    this.state = latest;
    return res;
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

  public getPassagesForRelease(releaseId: string): Passage[] {
    const st = this.getState();
    const cacheKey = `${st.store_revision}:${releaseId}`;
    const hit = this.releasePassagesCache.get(cacheKey);
    if (hit) return hit;

    // Cumulative: include passages from prior accepted releases + this release
    const allowedReleases = new Set<string>([releaseId]);
    for (const acc of Object.values(st.accepted_batch_releases)) {
      if (acc?.release_id) allowedReleases.add(acc.release_id);
    }
    const res = Object.values(st.passages).filter((p) => allowedReleases.has(p.release_id));
    this.releasePassagesCache.set(cacheKey, res);
    return res;
  }

  public getAcceptedAssertionsForRelease(releaseId: string): Assertion[] {
    const st = this.getState();
    const cacheKey = `${st.store_revision}:${releaseId}`;
    const hit = this.releaseAssertionsCache.get(cacheKey);
    if (hit) return hit;

    const allowedReleases = new Set<string>([releaseId]);
    for (const acc of Object.values(st.accepted_batch_releases)) {
      if (acc?.release_id) allowedReleases.add(acc.release_id);
    }
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
