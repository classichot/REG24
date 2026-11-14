/**
 * REG24 — Task F4: Outbox-Driven Snapshot-Pinned Durable Projections (SH-08, SH-15, AT06, AT07)
 *
 * Builds and persists durable Lexical, Vector, and Graph projections for a candidate release
 * from the canonical store outbox. Rejects memory-only or outage projection modes from
 * advancing or publishing a release (AT07), and supports crash-safe idempotent replay (AT06).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes, thaiDigitsToArabic } from "./identity";
import type { ProjectionReceipt } from "./contracts";
import type { DurableKnowledgeStore } from "./store";

export type ProjectionAdapterMode = "durable_disk" | "memory_only" | "simulate_outage";

export interface LexicalProjectionSnapshot {
  release_id: string;
  generation: string;
  built_at: string;
  passage_count: number;
  inverted_index: Record<string, string[]>; // token -> passage_id[]
}

export interface VectorProjectionSnapshot {
  release_id: string;
  generation: string;
  built_at: string;
  dimensions: number;
  vectors: Record<string, { passage_id: string; values: number[] }>; // vec_id -> vector
}

export interface GraphProjectionSnapshot {
  release_id: string;
  generation: string;
  built_at: string;
  node_count: number;
  edge_count: number;
  edges: Array<{
    assertion_id: string;
    subject: string;
    subject_type: string;
    predicate: string;
    object: string;
    object_type: string;
    evidence_ids: string[];
    valid_from: string | null;
    valid_to: string | null;
    scope: string;
  }>;
}

/**
 * Tokenizes Thai + English legal text into normalized words, Thai compound bigrams,
 * and section/ruling tokens for deterministic BM25/lexical indexing.
 */
export function tokenizeThaiLegalForIndex(text: string): string[] {
  const clean = thaiDigitsToArabic(text || "")
    .toLowerCase()
    .replace(/[^\u0E00-\u0E7Fa-z0-9/.()]+/g, " ")
    .trim();
  if (!clean) return [];

  const rawParts = clean.split(/\s+/).filter((t) => t.length >= 1);
  const tokens = new Set<string>();

  for (const part of rawParts) {
    tokens.add(part);
    // Add sliding 4-char & 6-char Thai character n-grams because Thai lacks spaces between words
    if (/[\u0E00-\u0E7F]/.test(part) && part.length >= 4) {
      const stripped = part.replace(/[()]/g, "");
      for (let i = 0; i <= stripped.length - 4; i += 2) {
        tokens.add(stripped.slice(i, i + 4));
      }
      for (let i = 0; i <= stripped.length - 6; i += 3) {
        tokens.add(stripped.slice(i, i + 6));
      }
    }
  }
  return Array.from(tokens);
}

/**
 * Deterministic L2-normalized 64-dimensional feature-hashed embedding over Thai/English
 * character 3-grams and legal tokens so hybrid vector similarity works offline and reproducibly.
 */
export function computeDeterministicLegalEmbedding(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const norm = thaiDigitsToArabic(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!norm) return vec;

  for (let i = 0; i <= Math.max(0, norm.length - 3); i++) {
    const gram = norm.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < gram.length; j++) {
      h ^= gram.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  let sqSum = 0;
  for (const v of vec) sqSum += v * v;
  const mag = Math.sqrt(sqSum);
  if (mag > 0) {
    for (let i = 0; i < dims; i++) {
      vec[i] = Number((vec[i] / mag).toFixed(6));
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Builds snapshot-pinned durable projections from canonical store state and marks pending outbox
 * entries for `releaseId` completed. Never mutates `active_release_id`.
 */
export async function buildReleaseProjectionsFromOutbox(
  store: DurableKnowledgeStore,
  releaseId: string,
  adapterMode: ProjectionAdapterMode = "durable_disk"
): Promise<ProjectionReceipt[]> {
  const nowIso = new Date().toISOString();

  if (adapterMode === "memory_only" || adapterMode === "simulate_outage") {
    const failedReceipts: ProjectionReceipt[] = (
      ["LEXICAL", "VECTOR", "GRAPH_LOCAL_DURABLE"] as const
    ).map((kind) => ({
      receipt_id: `rcpt.${releaseId}.${kind.toLowerCase()}.blocked`,
      release_id: releaseId,
      projection_kind: kind,
      generation: `gen.${releaseId}.blocked`,
      item_count: 0,
      manifest_checksum: "none",
      completion_state: adapterMode === "simulate_outage" ? "FAILED" : "INCOMPLETE",
      adapter_mode: adapterMode === "memory_only" ? "memory_only" : "durable_disk",
      recorded_at: nowIso,
      error:
        adapterMode === "memory_only"
          ? "PROJECTION_INCOMPLETE_OR_MEMORY_ONLY_BLOCKED: Memory-only adapter is prohibited from release certification."
          : "PROJECTION_INCOMPLETE_OR_MEMORY_ONLY_BLOCKED: Simulated projection target outage.",
    }));

    await store.transact("RECORD_BLOCKED_PROJECTION_ATTEMPT", (draft) => {
      draft.projection_receipts[releaseId] = failedReceipts;
      for (const ob of Object.values(draft.outbox)) {
        if (ob.release_id === releaseId) {
          ob.status = "FAILED";
          ob.error = failedReceipts[0].error;
        }
      }
    });

    throw new Error(failedReceipts[0].error!);
  }

  const projDir = path.join(store.dataDir, "projections");
  fs.mkdirSync(projDir, { recursive: true });

  const st = store.getState();
  const passages = store.getPassagesForRelease(releaseId);
  const assertions = store.getAcceptedAssertionsForRelease(releaseId);

  const generation = `gen.${releaseId}.r${st.releases[releaseId]?.revision ?? 1}`;

  // 1. Build Lexical Snapshot
  const inverted: Record<string, string[]> = {};
  for (const p of passages) {
    const work = st.works[p.work_id];
    const headerIds = (work?.official_identifiers || []).map((id) => id.normalized).join(" ");
    const toks = tokenizeThaiLegalForIndex(
      `${headerIds} ${p.contextualized_header} ${p.exact_text}`
    );
    for (const tok of toks) {
      if (!inverted[tok]) inverted[tok] = [];
      inverted[tok].push(p.passage_id);
    }
  }
  const lexicalSnapshot: LexicalProjectionSnapshot = {
    release_id: releaseId,
    generation,
    built_at: nowIso,
    passage_count: passages.length,
    inverted_index: inverted,
  };
  const lexicalJson = JSON.stringify(lexicalSnapshot);
  fs.writeFileSync(path.join(projDir, `${releaseId}_lexical.json`), lexicalJson, "utf8");

  // 2. Build Vector Snapshot
  const vectors: Record<string, { passage_id: string; values: number[] }> = {};
  const vecIds: string[] = [];
  for (const p of passages) {
    const vecId = `vec.${p.passage_id}`;
    vecIds.push(vecId);
    vectors[vecId] = {
      passage_id: p.passage_id,
      values: computeDeterministicLegalEmbedding(`${p.contextualized_header} ${p.exact_text}`),
    };
  }
  const vectorSnapshot: VectorProjectionSnapshot = {
    release_id: releaseId,
    generation,
    built_at: nowIso,
    dimensions: 64,
    vectors,
  };
  const vectorJson = JSON.stringify(vectorSnapshot);
  fs.writeFileSync(path.join(projDir, `${releaseId}_vector.json`), vectorJson, "utf8");

  // 3. Build Graph Snapshot
  const nodeSet = new Set<string>();
  const edges = assertions.map((a) => {
    nodeSet.add(a.subject);
    nodeSet.add(a.object);
    return {
      assertion_id: a.assertion_id,
      subject: a.subject,
      subject_type: a.subject_type,
      predicate: a.predicate,
      object: a.object,
      object_type: a.object_type,
      evidence_ids: a.evidence_ids,
      valid_from: a.validity.valid_from,
      valid_to: a.validity.valid_to,
      scope: a.scope,
    };
  });
  const graphSnapshot: GraphProjectionSnapshot = {
    release_id: releaseId,
    generation,
    built_at: nowIso,
    node_count: nodeSet.size,
    edge_count: edges.length,
    edges,
  };
  const graphJson = JSON.stringify(graphSnapshot);
  fs.writeFileSync(path.join(projDir, `${releaseId}_graph.json`), graphJson, "utf8");

  const receipts: ProjectionReceipt[] = [
    {
      receipt_id: `rcpt.${releaseId}.lexical`,
      release_id: releaseId,
      projection_kind: "LEXICAL",
      generation,
      item_count: passages.length,
      manifest_checksum: sha256Bytes(lexicalJson),
      completion_state: "COMPLETED",
      adapter_mode: "durable_disk",
      recorded_at: nowIso,
      error: null,
    },
    {
      receipt_id: `rcpt.${releaseId}.vector`,
      release_id: releaseId,
      projection_kind: "VECTOR",
      generation,
      item_count: vecIds.length,
      manifest_checksum: sha256Bytes(vectorJson),
      completion_state: "COMPLETED",
      adapter_mode: "durable_disk",
      recorded_at: nowIso,
      error: null,
    },
    {
      receipt_id: `rcpt.${releaseId}.graph`,
      release_id: releaseId,
      projection_kind: "GRAPH_LOCAL_DURABLE",
      generation,
      item_count: edges.length,
      manifest_checksum: sha256Bytes(graphJson),
      completion_state: "COMPLETED",
      adapter_mode: "durable_disk",
      recorded_at: nowIso,
      error: null,
    },
  ];

  await store.transact("COMMIT_RELEASE_PROJECTIONS", (draft) => {
    draft.projection_receipts[releaseId] = receipts;
    draft.active_vector_ids_by_release[releaseId] = Array.from(new Set(vecIds));
    for (const ob of Object.values(draft.outbox)) {
      if (ob.release_id === releaseId) {
        ob.status = "COMPLETED";
        ob.completed_at = nowIso;
        ob.error = null;
      }
    }
  });

  return receipts;
}

const vectorSnapCache = new Map<string, { mtimeMs: number; snap: VectorProjectionSnapshot }>();

export function loadVectorProjectionSnapshot(
  store: DurableKnowledgeStore,
  releaseId: string
): VectorProjectionSnapshot | null {
  const filePath = path.join(store.dataDir, "projections", `${releaseId}_vector.json`);
  if (!fs.existsSync(filePath)) return null;
  const st = fs.statSync(filePath);
  const cached = vectorSnapCache.get(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.snap;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as VectorProjectionSnapshot;
  vectorSnapCache.set(filePath, { mtimeMs: st.mtimeMs, snap: parsed });
  return parsed;
}
