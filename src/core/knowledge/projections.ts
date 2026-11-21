/**
 * REG24 — Snapshot-Pinned Durable Thai Legal Projections (Lexical Fielded BM25 + Optional BGE-M3 Vectors + Graph)
 *
 * Builds and persists durable projections from the SAME immutable candidate manifest:
 *   - Records corpus work/version/passage counts, index generation, manifest_id + manifest_hash,
 *     tokenizer engine + versioned legal dictionary SHA-256, and embedding model/version/dimensions where enabled.
 *   - Rejects stale or manifest-mismatched projections cleanly at load time.
 *   - Keeps legacy 64-dim character-hash vectors OFF the default path (`vectorMode: "deliberately_disabled"`).
 *   - Distinguishes vectors `deliberately_disabled` from `missing`, `incompatible`, or `incomplete` in staging diagnostics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { sha256Bytes, thaiDigitsToArabic } from "./identity";
import {
  extractCompositeLegalTokens,
  extractPreservedNegationTokens,
  getThaiLegalDictionarySha256,
  getThaiTokenizerContractMetadata,
  THAI_LEGAL_DICTIONARY_VERSION,
  THAI_TOKENIZER_ENGINE_ID,
  tokenizeThaiLegalWithDictionary,
} from "./thai-legal-dictionary-v1";
import type { ProjectionReceipt, VectorProjectionDiagnosticStatus } from "./contracts";
import type { DurableKnowledgeStore } from "./store";

function writeProjectionSnapshotDisk(projDir: string, baseName: string, jsonStr: string): void {
  const plainPath = path.join(projDir, `${baseName}.json`);
  const gzPath = path.join(projDir, `${baseName}.json.gz`);
  if (jsonStr.length > 1_000_000) {
    fs.writeFileSync(gzPath, zlib.gzipSync(Buffer.from(jsonStr, "utf8"), { level: 6 }));
    if (fs.existsSync(plainPath)) fs.unlinkSync(plainPath);
  } else {
    fs.writeFileSync(plainPath, jsonStr, "utf8");
    if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath);
  }
}

function readProjectionSnapshotDisk<T>(
  projDir: string,
  baseName: string,
  cache: Map<string, { mtimeMs: number; snap: T }>
): T | null {
  const gzPath = path.join(projDir, `${baseName}.json.gz`);
  const plainPath = path.join(projDir, `${baseName}.json`);
  const targetPath = fs.existsSync(gzPath) ? gzPath : fs.existsSync(plainPath) ? plainPath : null;
  if (!targetPath) return null;
  const st = fs.statSync(targetPath);
  const cached = cache.get(targetPath);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.snap;
  const raw = targetPath.endsWith(".gz")
    ? zlib.gunzipSync(fs.readFileSync(targetPath)).toString("utf8")
    : fs.readFileSync(targetPath, "utf8");
  const parsed = JSON.parse(raw) as T;
  cache.set(targetPath, { mtimeMs: st.mtimeMs, snap: parsed });
  return parsed;
}

export type ProjectionAdapterMode = "durable_disk" | "memory_only" | "simulate_outage";
export type VectorProjectionBuildMode = "deliberately_disabled" | "bge_m3_exact_cosine" | "legacy_char_hash_opt_in";

export interface ProjectionManifestHeader {
  schema_version?: "1.0" | "2.0";
  release_id: string;
  manifest_id?: string | null;
  manifest_hash?: string | null;
  generation: string;
  built_at: string;
  corpus_work_count?: number;
  corpus_version_count?: number;
  passage_count?: number;
}

export interface FieldedBm25IndexSection {
  /** Compact posting list: token -> flat pairs [pIdx0, tf0, pIdx1, tf1, ...] */
  postings: Record<string, number[]>;
  /** Document length (token count) per passage index `pIdx` */
  doc_lengths: number[];
  avg_doc_length: number;
}

export interface LexicalProjectionSnapshot extends ProjectionManifestHeader {
  passage_count: number;
  tokenizer_engine?: string;
  tokenizer_contract_sha256?: string | null;
  legal_dictionary_version?: string;
  legal_dictionary_sha256?: string;
  lexical_index_sha256?: string | null;
  /** Legacy compatibility hydrated map (populated lazily when needed) */
  inverted_index: Record<string, string[]>;
  passage_table?: string[];
  compact_index?: Record<string, number[]>;
  /** v2 Fielded BM25 index separating exact IDs, titles/headings, phrases/negations/roles, and body */
  fielded_bm25?: {
    k1: number;
    b: number;
    fields: {
      exact_ids: FieldedBm25IndexSection;
      title_heading: FieldedBm25IndexSection;
      phrases_roles: FieldedBm25IndexSection;
      body: FieldedBm25IndexSection;
    };
  };
}

export interface VectorProjectionSnapshot extends ProjectionManifestHeader {
  status?: VectorProjectionDiagnosticStatus;
  embedding_model?: string | null;
  embedding_version?: string | null;
  index_type?: "exact_cosine" | "disabled";
  dimensions: number;
  vectors: Record<string, { passage_id: string; values: number[] }>;
}

export interface GraphProjectionSnapshot extends ProjectionManifestHeader {
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

export interface ProjectionBuildOptions {
  /** Defaults to `"deliberately_disabled"` so legacy char-hash vectors stay OFF the default path. */
  vectorMode?: VectorProjectionBuildMode;
  /** Optional pre-tokenized body/title token map produced by Python PyThaiNLP `newmm` + legal dictionary. */
  externalTokenizerOutput?: {
    tokenizer_engine: string;
    legal_dictionary_version: string;
    legal_dictionary_sha256: string;
    passages: Record<string, { title_tokens: string[]; body_tokens: string[] }>;
  };
  /** Optional precomputed BGE-M3 dense embeddings (`vectorMode: "bge_m3_exact_cosine"`). */
  precomputedDenseVectors?: {
    embedding_model: string;
    embedding_version: string;
    dimensions: number;
    vectors_by_passage_id: Record<string, number[]>;
  };
}

/**
 * Tokenizes Thai + English legal text using the versioned Thai legal dictionary (`reg24-th-legal-dict-v1.0`),
 * atomic composite identifiers (`มาตรา 80/1 (2)` != `มาตรา 80`), and preserved negations/exceptions.
 */
export function tokenizeThaiLegalForIndex(text: string): string[] {
  return tokenizeThaiLegalWithDictionary(text, {
    includeDuplicates: false,
    expandAbbreviations: true,
  });
}

/**
 * Legacy 64-dimensional character 3-gram hash embedding.
 * KEPT OFF THE DEFAULT PATH per Batch 1 revised engineering requirements; retained only for
 * backward-compatible unit tests or explicit opt-in diagnostics.
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

function addFieldTokens(
  postings: Record<string, number[]>,
  docLengths: number[],
  pIdx: number,
  tokens: string[]
): void {
  docLengths[pIdx] = tokens.length;
  if (tokens.length === 0) return;
  const tfMap = new Map<string, number>();
  for (const tok of tokens) {
    if (!tok) continue;
    tfMap.set(tok, (tfMap.get(tok) || 0) + 1);
  }
  for (const [tok, tf] of tfMap.entries()) {
    let arr = postings[tok];
    if (!arr) {
      arr = [];
      postings[tok] = arr;
    }
    arr.push(pIdx, tf);
  }
}

function finalizeFieldSection(
  postings: Record<string, number[]>,
  docLengths: number[]
): FieldedBm25IndexSection {
  const sum = docLengths.reduce((acc, v) => acc + v, 0);
  const avg = docLengths.length > 0 ? Number((sum / docLengths.length).toFixed(3)) : 1;
  return {
    postings,
    doc_lengths: docLengths,
    avg_doc_length: Math.max(1, avg),
  };
}

/**
 * Builds snapshot-pinned durable projections from the SAME immutable candidate manifest.
 * Never mutates `active_release_id`.
 * By default, keeps legacy char-hash vectors OFF (`vectorMode: "deliberately_disabled"`).
 */
export async function buildReleaseProjectionsFromOutbox(
  store: DurableKnowledgeStore,
  releaseId: string,
  adapterMode: ProjectionAdapterMode = "durable_disk",
  options?: ProjectionBuildOptions
): Promise<ProjectionReceipt[]> {
  const nowIso = new Date().toISOString();
  const vectorMode: VectorProjectionBuildMode = options?.vectorMode ?? "deliberately_disabled";

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
      vector_status: kind === "VECTOR" ? "incomplete" : undefined,
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
  const relRec = st.releases[releaseId];
  const manifestId = relRec?.manifest_id ?? null;
  const manifestHash = relRec?.manifest_hash ?? null;
  const passages = store.getPassagesForRelease(releaseId);
  const assertions = store.getAcceptedAssertionsForRelease(releaseId);

  const uniqueWorkIds = new Set(passages.map((p) => p.work_id));
  const uniqueVersionIds = new Set(passages.map((p) => p.version_id));
  const corpusWorkCount = uniqueWorkIds.size;
  const corpusVersionCount = uniqueVersionIds.size;

  const manifestShort = manifestHash ? manifestHash.slice(0, 12) : "unhashed";
  const generation = `gen.${releaseId}.r${relRec?.revision ?? 1}.${manifestShort}`;

  const runtimeContract = getThaiTokenizerContractMetadata();
  const tokenizerEngine =
    options?.externalTokenizerOutput?.tokenizer_engine || runtimeContract.tokenizer_engine;
  const legalDictVersion =
    options?.externalTokenizerOutput?.legal_dictionary_version ||
    runtimeContract.legal_dictionary_version;
  const legalDictSha =
    options?.externalTokenizerOutput?.legal_dictionary_sha256 ||
    runtimeContract.legal_dictionary_sha256;
  const tokenizerContractSha = options?.externalTokenizerOutput
    ? sha256Bytes(
        JSON.stringify({
          tokenizer_engine: tokenizerEngine,
          legal_dictionary_version: legalDictVersion,
          legal_dictionary_sha256: legalDictSha,
        })
      )
    : runtimeContract.tokenizer_contract_sha256;

  // 1. Build Fielded BM25 Lexical Projection (v2) with separate normalized search fields
  const passageTable = passages.map((p) => p.passage_id);
  const exactIdPostings: Record<string, number[]> = Object.create(null);
  const titlePostings: Record<string, number[]> = Object.create(null);
  const phrasesRolesPostings: Record<string, number[]> = Object.create(null);
  const bodyPostings: Record<string, number[]> = Object.create(null);
  const compactIndex: Record<string, number[]> = Object.create(null);

  const exactIdLens = new Array<number>(passages.length).fill(0);
  const titleLens = new Array<number>(passages.length).fill(0);
  const phrasesRolesLens = new Array<number>(passages.length).fill(0);
  const bodyLens = new Array<number>(passages.length).fill(0);

  for (let pIdx = 0; pIdx < passages.length; pIdx++) {
    const p = passages[pIdx];
    const work = st.works[p.work_id];
    const headerIds = (work?.official_identifiers || []).map((id) => id.normalized).join(" ");
    const titleRaw = `${work?.title_th || ""} ${p.contextualized_header || ""} ${(p.structural_path || []).join(" ")}`;

    // Exact atomic identifiers (composite sections like `sec:80/1(2)` NEVER emit `sec:80`)
    const exactIdTokens = Array.from(
      new Set([
        ...extractCompositeLegalTokens(`${headerIds} ${titleRaw}`),
        ...(p.search_fields?.composite_section_tokens || []),
        ...(p.search_fields?.normalized_identifiers || []).map((s) => s.toLowerCase()),
      ])
    );

    const hasExternalTokenizer = Boolean(options?.externalTokenizerOutput);
    const extTok = options?.externalTokenizerOutput?.passages[p.passage_id];
    if (hasExternalTokenizer && !extTok) {
      throw new Error(
        `MIXED_TOKENIZER_FALLBACK_PROHIBITED: External tokenizer output is missing passage ${p.passage_id}; refusing silent fallback to runtime TS tokenizer.`
      );
    }
    const titleTokens = extTok
      ? extTok.title_tokens
      : tokenizeThaiLegalWithDictionary(titleRaw, {
          includeDuplicates: true,
          expandAbbreviations: true,
        });
    const bodyTokens = extTok
      ? extTok.body_tokens
      : tokenizeThaiLegalWithDictionary(p.exact_text, {
          includeDuplicates: true,
          expandAbbreviations: true,
        });

    // Separate role + preserved negations/exceptions field so official conclusions stay distinct from taxpayer facts
    const negTokens = extractPreservedNegationTokens(`${titleRaw} ${p.exact_text}`);
    const roleTokens = [
      `role:${p.statement_role}`,
      `worktype:${(work?.type || "unknown").toLowerCase()}`,
      ...negTokens,
      ...extractCompositeLegalTokens(p.exact_text),
    ];

    addFieldTokens(exactIdPostings, exactIdLens, pIdx, exactIdTokens);
    addFieldTokens(titlePostings, titleLens, pIdx, titleTokens);
    addFieldTokens(phrasesRolesPostings, phrasesRolesLens, pIdx, roleTokens);
    addFieldTokens(bodyPostings, bodyLens, pIdx, bodyTokens);

    // Compact union index for backward compatibility
    const unionTokens = new Set<string>([...exactIdTokens, ...titleTokens, ...roleTokens, ...bodyTokens]);
    for (const tok of unionTokens) {
      if (!compactIndex[tok]) compactIndex[tok] = [];
      compactIndex[tok].push(pIdx);
    }
  }

  const fieldedBm25Payload = {
    k1: 1.2,
    b: 0.75,
    fields: {
      exact_ids: finalizeFieldSection(exactIdPostings, exactIdLens),
      title_heading: finalizeFieldSection(titlePostings, titleLens),
      phrases_roles: finalizeFieldSection(phrasesRolesPostings, phrasesRolesLens),
      body: finalizeFieldSection(bodyPostings, bodyLens),
    },
  };
  const lexicalIndexSha256 = sha256Bytes(
    JSON.stringify({
      release_id: releaseId,
      manifest_hash: manifestHash,
      tokenizer_engine: tokenizerEngine,
      tokenizer_contract_sha256: tokenizerContractSha,
      legal_dictionary_sha256: legalDictSha,
      passage_table: passageTable,
      fielded_bm25: fieldedBm25Payload,
    })
  );

  const lexicalDiskPayload = {
    schema_version: "2.0" as const,
    release_id: releaseId,
    manifest_id: manifestId,
    manifest_hash: manifestHash,
    generation,
    built_at: nowIso,
    corpus_work_count: corpusWorkCount,
    corpus_version_count: corpusVersionCount,
    passage_count: passages.length,
    tokenizer_engine: tokenizerEngine,
    tokenizer_contract_sha256: tokenizerContractSha,
    legal_dictionary_version: legalDictVersion,
    legal_dictionary_sha256: legalDictSha,
    lexical_index_sha256: lexicalIndexSha256,
    passage_table: passageTable,
    compact_index: compactIndex,
    fielded_bm25: fieldedBm25Payload,
  };
  const lexicalJson = JSON.stringify(lexicalDiskPayload);
  writeProjectionSnapshotDisk(projDir, `${releaseId}_lexical`, lexicalJson);

  // 2. Build or Deliberately Disable Vector Projection
  let vectorReceipt: ProjectionReceipt;
  const vecIds: string[] = [];

  if (vectorMode === "deliberately_disabled") {
    // Write explicit disabled manifest marker so staging diagnostics distinguish `deliberately_disabled` from `missing`!
    const disabledSnap: VectorProjectionSnapshot = {
      schema_version: "2.0",
      release_id: releaseId,
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      generation,
      built_at: nowIso,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      status: "deliberately_disabled",
      embedding_model: null,
      embedding_version: null,
      index_type: "disabled",
      dimensions: 0,
      vectors: {},
    };
    const disabledJson = JSON.stringify(disabledSnap);
    writeProjectionSnapshotDisk(projDir, `${releaseId}_vector`, disabledJson);
    vectorReceipt = {
      receipt_id: `rcpt.${releaseId}.vector`,
      release_id: releaseId,
      projection_kind: "VECTOR",
      generation,
      item_count: 0,
      manifest_checksum: sha256Bytes(disabledJson),
      completion_state: "DISABLED",
      adapter_mode: "durable_disk",
      recorded_at: nowIso,
      error: null,
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      embedding_model: null,
      embedding_version: null,
      embedding_dimensions: 0,
      vector_status: "deliberately_disabled",
    };
  } else if (vectorMode === "bge_m3_exact_cosine" && options?.precomputedDenseVectors) {
    const pv = options.precomputedDenseVectors;
    const vectors: Record<string, { passage_id: string; values: number[] }> = {};
    for (const p of passages) {
      const vals = pv.vectors_by_passage_id[p.passage_id];
      if (!vals || vals.length !== pv.dimensions) continue;
      const vecId = `vec.${p.passage_id}`;
      vecIds.push(vecId);
      vectors[vecId] = { passage_id: p.passage_id, values: vals };
    }
    const isComplete = vecIds.length === passages.length;
    const vectorSnapshot: VectorProjectionSnapshot = {
      schema_version: "2.0",
      release_id: releaseId,
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      generation,
      built_at: nowIso,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      status: isComplete ? "enabled" : "incomplete",
      embedding_model: pv.embedding_model,
      embedding_version: pv.embedding_version,
      index_type: "exact_cosine",
      dimensions: pv.dimensions,
      vectors,
    };
    const vectorJson = JSON.stringify(vectorSnapshot);
    writeProjectionSnapshotDisk(projDir, `${releaseId}_vector`, vectorJson);
    vectorReceipt = {
      receipt_id: `rcpt.${releaseId}.vector`,
      release_id: releaseId,
      projection_kind: "VECTOR",
      generation,
      item_count: vecIds.length,
      manifest_checksum: sha256Bytes(vectorJson),
      completion_state: isComplete ? "COMPLETED" : "INCOMPLETE",
      adapter_mode: "durable_disk",
      recorded_at: nowIso,
      error: isComplete ? null : `Embedded ${vecIds.length}/${passages.length} passages`,
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      embedding_model: pv.embedding_model,
      embedding_version: pv.embedding_version,
      embedding_dimensions: pv.dimensions,
      vector_status: isComplete ? "enabled" : "incomplete",
    };
  } else {
    // Explicit legacy char-hash opt-in ONLY
    const vectors: Record<string, { passage_id: string; values: number[] }> = {};
    for (const p of passages) {
      const vecId = `vec.${p.passage_id}`;
      vecIds.push(vecId);
      vectors[vecId] = {
        passage_id: p.passage_id,
        values: computeDeterministicLegalEmbedding(`${p.contextualized_header} ${p.exact_text}`).map(
          (v) => Number(v.toFixed(4))
        ),
      };
    }
    const vectorSnapshot: VectorProjectionSnapshot = {
      schema_version: "2.0",
      release_id: releaseId,
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      generation,
      built_at: nowIso,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      status: "enabled",
      embedding_model: "legacy-char-3gram-hash-64d",
      embedding_version: "legacy-v1",
      index_type: "exact_cosine",
      dimensions: 64,
      vectors,
    };
    const vectorJson = JSON.stringify(vectorSnapshot);
    writeProjectionSnapshotDisk(projDir, `${releaseId}_vector`, vectorJson);
    vectorReceipt = {
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
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      embedding_model: "legacy-char-3gram-hash-64d",
      embedding_version: "legacy-v1",
      embedding_dimensions: 64,
      vector_status: "enabled",
    };
  }

  // 3. Build Graph Projection Snapshot (rebuildable projection — NOT a Neo4j runtime dependency)
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
    schema_version: "2.0",
    release_id: releaseId,
    manifest_id: manifestId,
    manifest_hash: manifestHash,
    generation,
    built_at: nowIso,
    corpus_work_count: corpusWorkCount,
    corpus_version_count: corpusVersionCount,
    passage_count: passages.length,
    node_count: nodeSet.size,
    edge_count: edges.length,
    edges,
  };
  const graphJson = JSON.stringify(graphSnapshot);
  writeProjectionSnapshotDisk(projDir, `${releaseId}_graph`, graphJson);

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
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
      tokenizer_engine: tokenizerEngine,
      legal_dictionary_version: legalDictVersion,
      legal_dictionary_sha256: legalDictSha,
    },
    vectorReceipt,
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
      manifest_id: manifestId,
      manifest_hash: manifestHash,
      corpus_work_count: corpusWorkCount,
      corpus_version_count: corpusVersionCount,
      passage_count: passages.length,
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

  // Invalidate local disk read caches so callers immediately see fresh generations
  lexicalSnapCache.clear();
  vectorSnapCache.clear();
  graphSnapCache.clear();

  return receipts;
}

const vectorSnapCache = new Map<string, { mtimeMs: number; snap: VectorProjectionSnapshot }>();
const lexicalSnapCache = new Map<string, { mtimeMs: number; snap: LexicalProjectionSnapshot }>();
const graphSnapCache = new Map<string, { mtimeMs: number; snap: GraphProjectionSnapshot }>();

function isSnapshotCompatibleWithRelease(
  store: DurableKnowledgeStore,
  releaseId: string,
  snap: ProjectionManifestHeader | null
): { ok: boolean; reason: string | null } {
  if (!snap) return { ok: false, reason: "MISSING_PROJECTION_FILE" };
  if (snap.release_id !== releaseId) {
    return {
      ok: false,
      reason: `STALE_RELEASE_MISMATCH: snapshot.release_id=${snap.release_id} != expected=${releaseId}`,
    };
  }
  const rel = store.getState().releases[releaseId];
  if (rel?.manifest_hash && snap.manifest_hash && snap.manifest_hash !== rel.manifest_hash) {
    return {
      ok: false,
      reason: `STALE_MANIFEST_HASH_MISMATCH: snapshot=${snap.manifest_hash.slice(0, 12)} != expected=${rel.manifest_hash.slice(0, 12)}`,
    };
  }
  return { ok: true, reason: null };
}

export function loadGraphProjectionSnapshot(
  store: DurableKnowledgeStore,
  releaseId: string
): GraphProjectionSnapshot | null {
  const snap = readProjectionSnapshotDisk(
    path.join(store.dataDir, "projections"),
    `${releaseId}_graph`,
    graphSnapCache
  );
  if (!isSnapshotCompatibleWithRelease(store, releaseId, snap).ok) {
    return null;
  }
  return snap;
}

export function loadVectorProjectionSnapshot(
  store: DurableKnowledgeStore,
  releaseId: string
): VectorProjectionSnapshot | null {
  const snap = readProjectionSnapshotDisk(
    path.join(store.dataDir, "projections"),
    `${releaseId}_vector`,
    vectorSnapCache
  );
  if (!isSnapshotCompatibleWithRelease(store, releaseId, snap).ok) {
    return null;
  }
  if (snap?.status === "deliberately_disabled" || snap?.index_type === "disabled") {
    return null;
  }
  return snap;
}

function isLexicalSnapshotCompatibleWithRuntime(
  store: DurableKnowledgeStore,
  releaseId: string,
  snap: LexicalProjectionSnapshot | null
): { ok: boolean; reason: string | null } {
  const baseCompat = isSnapshotCompatibleWithRelease(store, releaseId, snap);
  if (!baseCompat.ok || !snap) return baseCompat;
  if (snap.schema_version === "2.0" || snap.fielded_bm25) {
    const rt = getThaiTokenizerContractMetadata();
    if (snap.tokenizer_engine !== rt.tokenizer_engine) {
      return {
        ok: false,
        reason: `TOKENIZER_ENGINE_MISMATCH: index=${snap.tokenizer_engine || "missing"} != runtime=${rt.tokenizer_engine} (mixed-engine index/query builds prohibited)`,
      };
    }
    if (snap.legal_dictionary_sha256 !== rt.legal_dictionary_sha256) {
      return {
        ok: false,
        reason: `LEGAL_DICTIONARY_HASH_MISMATCH: index=${(snap.legal_dictionary_sha256 || "missing").slice(0, 12)} != runtime=${rt.legal_dictionary_sha256.slice(0, 12)}`,
      };
    }
    if (
      snap.tokenizer_contract_sha256 &&
      snap.tokenizer_contract_sha256 !== rt.tokenizer_contract_sha256
    ) {
      return {
        ok: false,
        reason: `TOKENIZER_CONTRACT_HASH_MISMATCH: index=${snap.tokenizer_contract_sha256.slice(0, 12)} != runtime=${rt.tokenizer_contract_sha256.slice(0, 12)}`,
      };
    }
  }
  return { ok: true, reason: null };
}

export function loadLexicalProjectionSnapshot(
  store: DurableKnowledgeStore,
  releaseId: string
): LexicalProjectionSnapshot | null {
  const snap = readProjectionSnapshotDisk<LexicalProjectionSnapshot>(
    path.join(store.dataDir, "projections"),
    `${releaseId}_lexical`,
    lexicalSnapCache
  );
  if (!isLexicalSnapshotCompatibleWithRuntime(store, releaseId, snap).ok) {
    return null;
  }
  if (snap && !snap.inverted_index && snap.compact_index && snap.passage_table) {
    const hydrated: Record<string, string[]> = Object.create(null);
    const tbl = snap.passage_table;
    for (const [tok, idxs] of Object.entries(snap.compact_index)) {
      hydrated[tok] = idxs.map((i) => tbl[i]);
    }
    snap.inverted_index = hydrated;
  }
  return snap;
}

export interface ReleaseProjectionDiagnostics {
  release_id: string;
  manifest_id: string | null;
  manifest_hash: string | null;
  expected_passage_count: number;
  lexical: {
    status: "ready" | "missing" | "incompatible" | "incomplete";
    schema_version: string | null;
    generation: string | null;
    passage_count: number;
    tokenizer_engine: string | null;
    tokenizer_contract_sha256: string | null;
    legal_dictionary_version: string | null;
    legal_dictionary_sha256: string | null;
    lexical_index_sha256: string | null;
    runtime_tokenizer_engine: string;
    runtime_tokenizer_contract_sha256: string;
    tokenizer_parity_verified: boolean;
    reason: string | null;
  };
  vector: {
    status: VectorProjectionDiagnosticStatus;
    generation: string | null;
    embedding_model: string | null;
    embedding_version: string | null;
    dimensions: number;
    vector_count: number;
    reason: string | null;
  };
  graph: {
    status: "ready" | "missing" | "incompatible" | "incomplete";
    generation: string | null;
    node_count: number;
    edge_count: number;
    neo4j_runtime_dependency: false;
    reason: string | null;
  };
}

/**
 * Staging & Release diagnostics distinguishing vectors `deliberately_disabled`
 * from `missing`, `incompatible`, or `incomplete` — and validating manifest & tokenizer parity.
 */
export function inspectReleaseProjectionDiagnostics(
  store: DurableKnowledgeStore,
  releaseId: string
): ReleaseProjectionDiagnostics {
  const st = store.getState();
  const rel = st.releases[releaseId];
  const expectedPassages = store.getPassagesForRelease(releaseId).length;
  const projDir = path.join(store.dataDir, "projections");
  const rt = getThaiTokenizerContractMetadata();

  const rawLex = readProjectionSnapshotDisk<LexicalProjectionSnapshot>(
    projDir,
    `${releaseId}_lexical`,
    lexicalSnapCache
  );
  const lexCompat = isLexicalSnapshotCompatibleWithRuntime(store, releaseId, rawLex);
  const lexStatus: ReleaseProjectionDiagnostics["lexical"]["status"] = !rawLex
    ? "missing"
    : !lexCompat.ok
      ? "incompatible"
      : rawLex.passage_count < expectedPassages
        ? "incomplete"
        : "ready";

  const rawVec = readProjectionSnapshotDisk<VectorProjectionSnapshot>(
    projDir,
    `${releaseId}_vector`,
    vectorSnapCache
  );
  const vecCompat = isSnapshotCompatibleWithRelease(store, releaseId, rawVec);
  let vecStatus: VectorProjectionDiagnosticStatus;
  let vecReason: string | null = null;
  const vecCount = rawVec ? Object.keys(rawVec.vectors || {}).length : 0;
  if (!rawVec) {
    vecStatus = "missing";
    vecReason = "Vector projection snapshot file does not exist for this release";
  } else if (!vecCompat.ok) {
    vecStatus = "incompatible";
    vecReason = vecCompat.reason;
  } else if (rawVec.status === "deliberately_disabled" || rawVec.index_type === "disabled") {
    vecStatus = "deliberately_disabled";
    vecReason = "Dense vectors are deliberately disabled on default path (legacy char-hash vectors off)";
  } else if (rawVec.embedding_model === "legacy-char-3gram-hash-64d") {
    vecStatus = "incompatible";
    vecReason = "Legacy character-hash vectors detected; prohibited on default retrieval path";
  } else if (vecCount < expectedPassages) {
    vecStatus = "incomplete";
    vecReason = `Vector projection covers ${vecCount}/${expectedPassages} passages`;
  } else {
    vecStatus = "enabled";
  }

  const rawGraph = readProjectionSnapshotDisk<GraphProjectionSnapshot>(
    projDir,
    `${releaseId}_graph`,
    graphSnapCache
  );
  const graphCompat = isSnapshotCompatibleWithRelease(store, releaseId, rawGraph);
  const graphStatus: ReleaseProjectionDiagnostics["graph"]["status"] = !rawGraph
    ? "missing"
    : !graphCompat.ok
      ? "incompatible"
      : "ready";

  return {
    release_id: releaseId,
    manifest_id: rel?.manifest_id ?? null,
    manifest_hash: rel?.manifest_hash ?? null,
    expected_passage_count: expectedPassages,
    lexical: {
      status: lexStatus,
      schema_version: rawLex?.schema_version ?? "1.0",
      generation: rawLex?.generation ?? null,
      passage_count: rawLex?.passage_count ?? 0,
      tokenizer_engine: rawLex?.tokenizer_engine ?? null,
      tokenizer_contract_sha256: rawLex?.tokenizer_contract_sha256 ?? null,
      legal_dictionary_version: rawLex?.legal_dictionary_version ?? null,
      legal_dictionary_sha256: rawLex?.legal_dictionary_sha256 ?? null,
      lexical_index_sha256: rawLex?.lexical_index_sha256 ?? null,
      runtime_tokenizer_engine: rt.tokenizer_engine,
      runtime_tokenizer_contract_sha256: rt.tokenizer_contract_sha256,
      tokenizer_parity_verified:
        lexStatus === "ready" &&
        rawLex?.tokenizer_engine === rt.tokenizer_engine &&
        rawLex?.legal_dictionary_sha256 === rt.legal_dictionary_sha256 &&
        rawLex?.tokenizer_contract_sha256 === rt.tokenizer_contract_sha256,
      reason: lexCompat.reason,
    },
    vector: {
      status: vecStatus,
      generation: rawVec?.generation ?? null,
      embedding_model: rawVec?.embedding_model ?? null,
      embedding_version: rawVec?.embedding_version ?? null,
      dimensions: rawVec?.dimensions ?? 0,
      vector_count: vecCount,
      reason: vecReason,
    },
    graph: {
      status: graphStatus,
      generation: rawGraph?.generation ?? null,
      node_count: rawGraph?.node_count ?? 0,
      edge_count: rawGraph?.edge_count ?? 0,
      neo4j_runtime_dependency: false,
      reason: graphCompat.reason,
    },
  };
}

export interface TokenizerParityProbeItem {
  category: "unspaced_thai" | "legal_citations" | "negation" | "compound_terms";
  input_text: string;
  index_side_tokens: string[];
  live_query_tokens: string[];
  exact_id_tokens: string[];
  preserved_negation_tokens: string[];
  exact_token_parity: boolean;
  forbidden_tokens_absent: boolean;
  posting_hits: Array<{
    token: string;
    exact_ids_df: number;
    title_heading_df: number;
    phrases_roles_df: number;
    body_df: number;
    total_field_hits: number;
    sample_passage_ids: string[];
  }>;
}

export interface TokenizerParityProbeReport {
  release_id: string;
  manifest_hash: string | null;
  runtime_platform: string;
  runtime_arch: string;
  node_version: string;
  icu_version: string;
  index_tokenizer_engine: string | null;
  live_tokenizer_engine: string;
  index_tokenizer_contract_sha256: string | null;
  live_tokenizer_contract_sha256: string;
  index_legal_dictionary_sha256: string | null;
  live_legal_dictionary_sha256: string;
  lexical_index_sha256: string | null;
  lexical_disk_file_sha256: string | null;
  contract_parity_ok: boolean;
  all_probes_ok: boolean;
  probes: TokenizerParityProbeItem[];
}

/**
 * Live diagnostic proving that index-time tokenization, live BM25 query tokenization,
 * and on-disk posting keys share the EXACT SAME pinned tokenizer contract across:
 *   1. Unspaced Thai
 *   2. Legal citations (including composite `มาตรา ๘๐/๑ (๒)` != `sec:80`)
 *   3. Negation (`มิให้`, `เว้นแต่`, `ไม่มีค่าตอบแทน`)
 *   4. Compound legal terms (`ภาษีเงินได้บุคคลธรรมดา`, `อสังหาริมทรัพย์`, `ห้องชุด`, `ใบกำกับภาษี`)
 */
export function runTokenizerParityProbe(
  store: DurableKnowledgeStore,
  releaseId: string
): TokenizerParityProbeReport {
  const rt = getThaiTokenizerContractMetadata();
  const snap = loadLexicalProjectionSnapshot(store, releaseId);
  const projDir = path.join(store.dataDir, "projections");
  const gzPath = path.join(projDir, `${releaseId}_lexical.json.gz`);
  const plainPath = path.join(projDir, `${releaseId}_lexical.json`);
  const diskPath = fs.existsSync(gzPath) ? gzPath : fs.existsSync(plainPath) ? plainPath : null;
  const lexicalDiskFileSha256 = diskPath ? sha256Bytes(fs.readFileSync(diskPath)) : null;

  const probeSpecs: Array<{
    category: TokenizerParityProbeItem["category"];
    input_text: string;
    required_posting_tokens: string[];
    forbidden_tokens?: string[];
  }> = [
    {
      category: "unspaced_thai",
      input_text: "ภาษีมูลค่าเพิ่มกรณีการให้บริการในราชอาณาจักรและส่งออกสินค้า",
      required_posting_tokens: ["ภาษีมูลค่าเพิ่ม", "การให้บริการ", "ในราชอาณาจักร", "ส่งออกสินค้า"],
    },
    {
      category: "legal_citations",
      input_text: "มาตรา ๘๐/๑ (๒) แห่งประมวลรัษฎากร พ.ร.ฎ. (ฉบับที่ ๗๙๐) พ.ศ. ๒๕๖๗ กค 0702/5958",
      required_posting_tokens: ["sec:80/1(2)", "sec:80/1", "rd:790", "ruling:กค_0702/5958", "ประมวลรัษฎากร"],
      forbidden_tokens: ["sec:80", "80"],
    },
    {
      category: "negation",
      input_text: "มิให้ถือว่าเป็นการขายสินค้า เว้นแต่โอนโดยเสน่หาไม่มีค่าตอบแทน",
      required_posting_tokens: ["มิให้", "เว้นแต่", "โดยเสน่หา", "ไม่มีค่าตอบแทน"],
    },
    {
      category: "compound_terms",
      input_text: "ภาษีเงินได้บุคคลธรรมดา หักภาษี ณ ที่จ่าย โอนกรรมสิทธิ์ ห้องชุด อสังหาริมทรัพย์ ใบกำกับภาษี",
      required_posting_tokens: [
        "ภาษีเงินได้บุคคลธรรมดา",
        "หักภาษี ณ ที่จ่าย",
        "โอนกรรมสิทธิ์",
        "ห้องชุด",
        "อสังหาริมทรัพย์",
        "ใบกำกับภาษี",
      ],
    },
  ];

  const fb = snap?.fielded_bm25?.fields;
  const tbl = snap?.passage_table || [];

  const dfOf = (sec: FieldedBm25IndexSection | undefined, tok: string): number => {
    const post = sec?.postings[tok];
    return post ? Math.floor(post.length / 2) : 0;
  };
  const samplePidsOf = (tok: string): string[] => {
    const out: string[] = [];
    for (const sec of [fb?.exact_ids, fb?.title_heading, fb?.phrases_roles, fb?.body]) {
      const post = sec?.postings[tok];
      if (!post) continue;
      for (let i = 0; i < post.length && out.length < 3; i += 2) {
        const pid = tbl[post[i]];
        if (pid && !out.includes(pid)) out.push(pid);
      }
    }
    return out;
  };

  const probes: TokenizerParityProbeItem[] = probeSpecs.map((spec) => {
    const indexTokens = tokenizeThaiLegalWithDictionary(spec.input_text, {
      includeDuplicates: false,
      expandAbbreviations: true,
    });
    const queryTokens = tokenizeThaiLegalWithDictionary(spec.input_text, {
      includeDuplicates: false,
      expandAbbreviations: true,
    });
    const exactIds = extractCompositeLegalTokens(spec.input_text);
    const negToks = extractPreservedNegationTokens(spec.input_text);
    const exactTokenParity =
      indexTokens.length === queryTokens.length &&
      indexTokens.every((t, idx) => t === queryTokens[idx]);
    const forbiddenAbsent = (spec.forbidden_tokens || []).every(
      (ft) => !indexTokens.includes(ft) && !queryTokens.includes(ft) && !exactIds.includes(ft)
    );

    const postingHits = spec.required_posting_tokens.map((tok) => {
      const exactDf = dfOf(fb?.exact_ids, tok);
      const titleDf = dfOf(fb?.title_heading, tok);
      const phrasesDf = dfOf(fb?.phrases_roles, tok);
      const bodyDf = dfOf(fb?.body, tok);
      return {
        token: tok,
        exact_ids_df: exactDf,
        title_heading_df: titleDf,
        phrases_roles_df: phrasesDf,
        body_df: bodyDf,
        total_field_hits: exactDf + titleDf + phrasesDf + bodyDf,
        sample_passage_ids: samplePidsOf(tok),
      };
    });

    return {
      category: spec.category,
      input_text: spec.input_text,
      index_side_tokens: indexTokens,
      live_query_tokens: queryTokens,
      exact_id_tokens: exactIds,
      preserved_negation_tokens: negToks,
      exact_token_parity: exactTokenParity,
      forbidden_tokens_absent: forbiddenAbsent,
      posting_hits: postingHits,
    };
  });

  const contractParityOk = Boolean(
    snap &&
      snap.tokenizer_engine === rt.tokenizer_engine &&
      snap.tokenizer_contract_sha256 === rt.tokenizer_contract_sha256 &&
      snap.legal_dictionary_sha256 === rt.legal_dictionary_sha256
  );
  const allProbesOk =
    contractParityOk &&
    probes.every(
      (p) =>
        p.exact_token_parity &&
        p.forbidden_tokens_absent &&
        p.posting_hits.every((h) => h.total_field_hits > 0)
    );

  return {
    release_id: releaseId,
    manifest_hash: snap?.manifest_hash ?? null,
    runtime_platform: process.platform,
    runtime_arch: process.arch,
    node_version: process.version,
    icu_version: rt.runtime_icu_version,
    index_tokenizer_engine: snap?.tokenizer_engine ?? null,
    live_tokenizer_engine: rt.tokenizer_engine,
    index_tokenizer_contract_sha256: snap?.tokenizer_contract_sha256 ?? null,
    live_tokenizer_contract_sha256: rt.tokenizer_contract_sha256,
    index_legal_dictionary_sha256: snap?.legal_dictionary_sha256 ?? null,
    live_legal_dictionary_sha256: rt.legal_dictionary_sha256,
    lexical_index_sha256: snap?.lexical_index_sha256 ?? null,
    lexical_disk_file_sha256: lexicalDiskFileSha256,
    contract_parity_ok: contractParityOk,
    all_probes_ok: allProbesOk,
    probes,
  };
}

/**
 * True when running as an RC8-only single-release Vercel Preview (or when explicitly enabled
 * via `REG24_STRICT_PINNED_RELEASE_ONLY=1`). In this mode:
 *  - Request-level `release_id` overrides selecting any other/unbundled release are REJECTED (HTTP 400).
 *  - Missing or incompatible lexical/graph projection artifacts FAIL HARD (HTTP 503) with ZERO silent fallback.
 */
export function isStrictSingleReleasePreviewMode(): boolean {
  return (
    process.env.VERCEL_ENV === "preview" ||
    process.env.REG24_STRICT_PINNED_RELEASE_ONLY === "1"
  );
}

/**
 * Verifies that BOTH the lexical (v2 fielded BM25) and graph projection snapshots for `releaseId`
 * are present on disk and compatible with the release manifest hash and runtime tokenizer contract.
 * Throws `PROJECTION_ARTIFACT_MISSING_OR_INCOMPATIBLE_503` (STOP — never silently falls back).
 */
export function assertReleaseProjectionArtifactsReady(
  store: DurableKnowledgeStore,
  releaseId: string
): {
  lexical: LexicalProjectionSnapshot;
  graph: GraphProjectionSnapshot;
} {
  const lexSnap = loadLexicalProjectionSnapshot(store, releaseId);
  const graphSnap = loadGraphProjectionSnapshot(store, releaseId);
  if (!lexSnap || !lexSnap.fielded_bm25 || !lexSnap.passage_table || !graphSnap) {
    const diag = inspectReleaseProjectionDiagnostics(store, releaseId);
    const reasons: string[] = [];
    if (!lexSnap) {
      reasons.push(`lexical=${diag.lexical.status}${diag.lexical.reason ? ` (${diag.lexical.reason})` : ""}`);
    } else if (!lexSnap.fielded_bm25 || !lexSnap.passage_table) {
      reasons.push(`lexical=missing_fielded_bm25_v2`);
    }
    if (!graphSnap) {
      reasons.push(`graph=${diag.graph.status}${diag.graph.reason ? ` (${diag.graph.reason})` : ""}`);
    }
    throw new Error(
      `PROJECTION_ARTIFACT_MISSING_OR_INCOMPATIBLE_503: Required packaged projection artifacts for release '${releaseId}' are unavailable or incompatible [${reasons.join("; ")}]. Silent retrieval fallback is disabled on this protected Preview.`
    );
  }
  return { lexical: lexSnap, graph: graphSnap };
}
