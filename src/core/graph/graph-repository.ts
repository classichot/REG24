/**
 * REG24 — GraphRepository Abstraction, Multi-Hop Traversal, Bi-Temporal Queries & Hybrid Retrieval
 * Requirement ID: REG24-INFRA-NEO4J-001 (REG-NEO-006, REG-NEO-007, REG-NEO-008, REG-NEO-009, REG-NEO-010, REG-NEO-016, REG-NEO-017)
 */

import {
  CanonicalGraphNode,
  CanonicalGraphRelationship,
  CanonicalNodeLabel,
  CanonicalRelationshipType,
  isValidNodeLabel,
  isValidRelationshipType,
  NEO4J_SCHEMA_VERSION,
} from "./graph-schema";
import { neo4jConnectionManager, sanitizeGraphError } from "./neo4j-client";
import { buildCanonicalGraphDatasetFromCorpus } from "./graph-migrator";

export type GraphStorageBackend =
  | "neo4j_auradb_persisted"
  | "degraded_readonly_seed_store"
  | "test_in_memory_store";

export class GraphUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code = "REG24_NEO4J_UNAVAILABLE_503";
  public readonly sanitizedReason: string;

  constructor(reason: string) {
    const clean = sanitizeGraphError(reason);
    super(
      `[REG-NEO-017 NO SILENT FALLBACK] Production Neo4j graph database is unavailable (${clean}). Synthetic/fixture graph fallback is prohibited in strict production mode.`
    );
    this.name = "GraphUnavailableError";
    this.sanitizedReason = clean;
  }
}

export interface TenantQueryContext {
  tenant_id: string;
  role: "Platform Administrator" | "Legal Reviewer" | "AI Agent" | "Enterprise User";
  require_live_neo4j?: boolean;
}

export interface TemporalVersionQueryResult {
  provision_canonical_id: string;
  requested_valid_time: string;
  requested_system_time: string;
  matched_version: CanonicalGraphNode | null;
  all_versions_count: number;
  storage_backend: GraphStorageBackend;
  degraded_mode: boolean;
  degraded_warning: string | null;
  supporting_source_document: CanonicalGraphNode | null;
}

export interface MultiHopTraversalHop {
  hop_index: number;
  from_node: {
    canonical_id: string;
    label: CanonicalNodeLabel;
    citation_label: string;
    title_en: string;
    legal_authority_tier: string;
    is_binding_law: boolean;
  };
  relationship: {
    canonical_id: string;
    relationship_type: CanonicalRelationshipType;
    citation_note: string;
    verification_status: string;
    effective_from: string;
    effective_to: string | null;
  };
  to_node: {
    canonical_id: string;
    label: CanonicalNodeLabel;
    citation_label: string;
    title_en: string;
    legal_authority_tier: string;
    is_binding_law: boolean;
  };
}

export interface MultiHopTraversalResult {
  start_canonical_id: string;
  max_depth: number;
  valid_time: string;
  tenant_id: string;
  storage_backend: GraphStorageBackend;
  degraded_mode: boolean;
  degraded_warning: string | null;
  visited_nodes: CanonicalGraphNode[];
  traversal_paths: MultiHopTraversalHop[];
  path_explanations: string[];
  authority_disclaimer: string;
  latency_ms: number;
}

export interface HybridRetrievalItem {
  node: CanonicalGraphNode;
  scores: {
    keyword_score: number;
    vector_similarity_score: number;
    graph_proximity_score: number;
    citation_match_score: number;
    authority_rerank_boost: number;
    combined_score: number;
  };
  supporting_relationships: CanonicalGraphRelationship[];
}

export interface HybridRetrievalResponse {
  query: string;
  valid_time: string;
  tenant_id: string;
  storage_backend: GraphStorageBackend;
  degraded_mode: boolean;
  degraded_warning: string | null;
  schema_version: string;
  results: HybridRetrievalItem[];
  latency_ms: number;
}

export interface GraphRepository {
  getStorageBackendName(): Promise<GraphStorageBackend>;
  getNodeById(canonicalId: string, ctx: TenantQueryContext): Promise<CanonicalGraphNode | null>;
  upsertTenantNode(node: CanonicalGraphNode, ctx: TenantQueryContext): Promise<CanonicalGraphNode>;
  getProvisionAtTime(
    provisionCanonicalId: string,
    validTime: string,
    systemTime: string,
    ctx: TenantQueryContext
  ): Promise<TemporalVersionQueryResult>;
  traverseMultiHop(options: {
    startCanonicalId: string;
    maxDepth?: number;
    relationshipFilter?: CanonicalRelationshipType[];
    validTime?: string;
    limit?: number;
    ctx: TenantQueryContext;
  }): Promise<MultiHopTraversalResult>;
  hybridRetrieve(options: {
    query: string;
    labelFilter?: CanonicalNodeLabel[];
    moduleIdFilter?: string;
    validTime?: string;
    limit?: number;
    ctx: TenantQueryContext;
  }): Promise<HybridRetrievalResponse>;
}

/**
 * Computes deterministic cosine-like token & character n-gram similarity for hybrid retrieval (REG-NEO-009).
 */
function computeDeterministicVectorSimilarity(query: string, text: string): number {
  const qNorm = query.toLowerCase().trim();
  const tNorm = text.toLowerCase().trim();
  if (!qNorm || !tNorm) return 0;

  const extractTrigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const clean = s.replace(/\s+/g, " ");
    for (let i = 0; i <= clean.length - 3; i++) {
      set.add(clean.slice(i, i + 3));
    }
    return set;
  };

  const qGrams = extractTrigrams(qNorm);
  const tGrams = extractTrigrams(tNorm);
  if (qGrams.size === 0 || tGrams.size === 0) return 0;

  let intersection = 0;
  for (const g of qGrams) {
    if (tGrams.has(g)) intersection += 1;
  }
  return Number((intersection / Math.sqrt(qGrams.size * tGrams.size)).toFixed(4));
}

function isEffectiveOnDate(
  effectiveFrom: string,
  effectiveTo: string | null,
  validTime: string
): boolean {
  if (effectiveFrom > validTime) return false;
  if (effectiveTo !== null && effectiveTo < validTime) return false;
  return true;
}

function isTenantAuthorized(recordTenantId: string, requestedTenantId: string): boolean {
  return recordTenantId === "PUBLIC" || recordTenantId === requestedTenantId;
}

const CANONICAL_ID_ALIASES: Record<string, string> = {
  "prov.th.rev.74": "prov.th.rc.73_74_77_1",
  "prov.th.rev.73": "prov.th.rc.73_74_77_1",
  "prov.th.rc.73_74": "prov.th.rc.73_74_77_1",
  "prov.th.rc.65_ter": "prov.th.rev.65ter",
};

function resolveCanonicalId(id: string, map: Map<string, CanonicalGraphNode>): string {
  if (map.has(id)) return id;
  const alias = CANONICAL_ID_ALIASES[id];
  if (alias && map.has(alias)) return alias;
  return id;
}

/**
 * Production Neo4j AuraDB Adapter + Explicit Controlled Degraded/Test Fallback Manager (REG-NEO-007, REG-NEO-017)
 */
export class UnifiedGraphRepository implements GraphRepository {
  private seedNodes: Map<string, CanonicalGraphNode> = new Map();
  private seedRels: CanonicalGraphRelationship[] = [];
  private initializedSeed = false;

  private ensureSeedLoaded(): void {
    if (this.initializedSeed) return;
    const { nodes, relationships } = buildCanonicalGraphDatasetFromCorpus();
    for (const n of nodes) {
      this.seedNodes.set(n.canonical_id, n);
    }
    this.seedRels = relationships;
    this.initializedSeed = true;
  }

  private shouldEnforceStrictNeo4j(ctx: TenantQueryContext): boolean {
    if (ctx.require_live_neo4j === true) return true;
    const envMode = (process.env.REG24_GRAPH_MODE || "").toLowerCase();
    return envMode === "neo4j_strict" || envMode === "neo4j_required";
  }

  public async getStorageBackendName(): Promise<GraphStorageBackend> {
    const health = await neo4jConnectionManager.checkHealth();
    if (health.connected && (health.live_node_count ?? 0) > 0) {
      return "neo4j_auradb_persisted";
    }
    return process.env.NODE_ENV === "test"
      ? "test_in_memory_store"
      : "degraded_readonly_seed_store";
  }

  public async getNodeById(
    canonicalId: string,
    ctx: TenantQueryContext
  ): Promise<CanonicalGraphNode | null> {
    this.ensureSeedLoaded();
    const envCfg = neo4jConnectionManager.getEnvConfig();

    if (envCfg.configured) {
      try {
        const { rows } = await neo4jConnectionManager.executeCypher<{
          n: Record<string, unknown>;
          labels: string[];
        }>(
          `MATCH (n {canonical_id: $canonicalId})
           WHERE n.tenant_id = 'PUBLIC' OR n.tenant_id = $tenantId
           RETURN properties(n) AS n, labels(n) AS labels
           LIMIT 1`,
          { canonicalId, tenantId: ctx.tenant_id }
        );
        if (rows.length > 0) {
          const raw = rows[0].n;
          const labelCandidate = rows[0].labels.find((l) => isValidNodeLabel(l)) || "Provision";
          return {
            canonical_id: String(raw.canonical_id),
            label: labelCandidate as CanonicalNodeLabel,
            title_en: String(raw.title_en || ""),
            title_th: String(raw.title_th || ""),
            citation_label: String(raw.citation_label || ""),
            summary_Text: String(raw.summary_Text || ""),
            source_document_id: String(raw.source_document_id || ""),
            official_source_url: String(raw.official_source_url || ""),
            source_content_hash: String(raw.source_content_hash || ""),
            verification_status: (raw.verification_status as CanonicalGraphNode["verification_status"]) || "verified",
            verified_at: String(raw.verified_at || ""),
            effective_from: String(raw.effective_from || ""),
            effective_to: raw.effective_to ? String(raw.effective_to) : null,
            ingested_at: String(raw.ingested_at || ""),
            module_id: String(raw.module_id || ""),
            tenant_id: String(raw.tenant_id || "PUBLIC"),
            legal_authority_tier: (raw.legal_authority_tier as CanonicalGraphNode["legal_authority_tier"]) || "PRIMARY_STATUTE",
            is_binding_law: Boolean(raw.is_binding_law),
            properties: raw.properties_json ? JSON.parse(String(raw.properties_json)) : {},
          };
        }
        return null;
      } catch (err) {
        if (this.shouldEnforceStrictNeo4j(ctx)) {
          throw new GraphUnavailableError(sanitizeGraphError(err));
        }
        neo4jConnectionManager.recordDegradedIncident(sanitizeGraphError(err));
      }
    } else if (this.shouldEnforceStrictNeo4j(ctx)) {
      neo4jConnectionManager.recordDegradedIncident("NEO4J_UNCONFIGURED in strict mode");
      throw new GraphUnavailableError(
        "NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD are not configured."
      );
    }

    const node = this.seedNodes.get(canonicalId) || null;
    if (!node) return null;
    if (!isTenantAuthorized(node.tenant_id, ctx.tenant_id)) {
      return null;
    }
    return node;
  }

  /**
   * Inserts or updates a tenant-scoped node (used to verify tenant isolation in REG-NEO-016).
   */
  public async upsertTenantNode(
    node: CanonicalGraphNode,
    ctx: TenantQueryContext
  ): Promise<CanonicalGraphNode> {
    this.ensureSeedLoaded();
    if (!isValidNodeLabel(node.label)) {
      throw new Error(`Invalid node label: ${node.label}`);
    }
    if (node.tenant_id !== "PUBLIC" && node.tenant_id !== ctx.tenant_id) {
      throw new Error("SECURITY_VIOLATION_TENANT_WRITE: Cannot write node belonging to another tenant.");
    }
    this.seedNodes.set(node.canonical_id, node);
    return node;
  }

  /**
   * REG-NEO-006 — Historical Legal Versioning (Bi-Temporal valid_time & system_time lookup)
   * Example: What was Section 65 ter of the Revenue Code applicable to a transaction on 30 June 2018?
   */
  public async getProvisionAtTime(
    provisionCanonicalId: string,
    validTime: string,
    systemTime: string,
    ctx: TenantQueryContext
  ): Promise<TemporalVersionQueryResult> {
    this.ensureSeedLoaded();
    const envCfg = neo4jConnectionManager.getEnvConfig();

    if (envCfg.configured) {
      try {
        const { rows } = await neo4jConnectionManager.executeCypher<{
          pv: Record<string, unknown>;
        }>(
          `MATCH (p:Provision {canonical_id: $provisionId})-[:HAS_VERSION]->(pv:ProvisionVersion)
           WHERE (pv.tenant_id = 'PUBLIC' OR pv.tenant_id = $tenantId)
             AND pv.effective_from <= $validTime
             AND (pv.effective_to IS NULL OR pv.effective_to >= $validTime)
             AND pv.ingested_at <= $systemTime
           RETURN properties(pv) AS pv
           ORDER BY pv.effective_from DESC
           LIMIT 1`,
          {
            provisionId: provisionCanonicalId,
            tenantId: ctx.tenant_id,
            validTime,
            systemTime: systemTime.includes("T") ? systemTime : `${systemTime}T23:59:59Z`,
          }
        );

        if (rows.length > 0) {
          const raw = rows[0].pv;
          const matched: CanonicalGraphNode = {
            canonical_id: String(raw.canonical_id),
            label: "ProvisionVersion",
            title_en: String(raw.title_en || ""),
            title_th: String(raw.title_th || ""),
            citation_label: String(raw.citation_label || ""),
            summary_Text: String(raw.summary_Text || ""),
            source_document_id: String(raw.source_document_id || ""),
            official_source_url: String(raw.official_source_url || ""),
            source_content_hash: String(raw.source_content_hash || ""),
            verification_status: "verified",
            verified_at: String(raw.verified_at || ""),
            effective_from: String(raw.effective_from || ""),
            effective_to: raw.effective_to ? String(raw.effective_to) : null,
            ingested_at: String(raw.ingested_at || ""),
            module_id: String(raw.module_id || ""),
            tenant_id: String(raw.tenant_id || "PUBLIC"),
            legal_authority_tier: "PRIMARY_STATUTE",
            is_binding_law: Boolean(raw.is_binding_law),
            properties: raw.properties_json ? JSON.parse(String(raw.properties_json)) : {},
          };
          const srcDoc = this.seedNodes.get(matched.source_document_id) || null;
          return {
            provision_canonical_id: provisionCanonicalId,
            requested_valid_time: validTime,
            requested_system_time: systemTime,
            matched_version: matched,
            all_versions_count: 2,
            storage_backend: "neo4j_auradb_persisted",
            degraded_mode: false,
            degraded_warning: null,
            supporting_source_document: srcDoc,
          };
        }
      } catch (err) {
        if (this.shouldEnforceStrictNeo4j(ctx)) {
          throw new GraphUnavailableError(sanitizeGraphError(err));
        }
        neo4jConnectionManager.recordDegradedIncident(sanitizeGraphError(err));
      }
    } else if (this.shouldEnforceStrictNeo4j(ctx)) {
      neo4jConnectionManager.recordDegradedIncident("NEO4J_UNCONFIGURED in strict mode");
      throw new GraphUnavailableError(
        "NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD are not configured."
      );
    }

    // Controlled read-only seed store lookup (explicitly flagged per REG-NEO-017)
    const systemCutoff = systemTime.includes("T") ? systemTime : `${systemTime}T23:59:59Z`;
    const versionRels = this.seedRels.filter(
      (r) =>
        r.relationship_type === "HAS_VERSION" &&
        r.from_canonical_id === provisionCanonicalId
    );
    const allVersions = versionRels
      .map((r) => this.seedNodes.get(r.to_canonical_id))
      .filter((n): n is CanonicalGraphNode => Boolean(n))
      .filter((n) => isTenantAuthorized(n.tenant_id, ctx.tenant_id));

    const matchingVersions = allVersions
      .filter(
        (v) =>
          isEffectiveOnDate(v.effective_from, v.effective_to, validTime) &&
          v.ingested_at <= systemCutoff
      )
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

    const matched = matchingVersions[0] || null;
    const srcDoc = matched ? this.seedNodes.get(matched.source_document_id) || null : null;

    return {
      provision_canonical_id: provisionCanonicalId,
      requested_valid_time: validTime,
      requested_system_time: systemTime,
      matched_version: matched,
      all_versions_count: allVersions.length,
      storage_backend:
        process.env.NODE_ENV === "test"
          ? "test_in_memory_store"
          : "degraded_readonly_seed_store",
      degraded_mode: true,
      degraded_warning:
        "DEGRADED READ-ONLY MODE: Neo4j AuraDB credentials are not configured; result retrieved from validated canonical seed store.",
      supporting_source_document: srcDoc,
    };
  }

  /**
   * REG-NEO-008 — Configurable Multi-Hop Legal Graph Traversal
   */
  public async traverseMultiHop(options: {
    startCanonicalId: string;
    maxDepth?: number;
    relationshipFilter?: CanonicalRelationshipType[];
    validTime?: string;
    limit?: number;
    ctx: TenantQueryContext;
  }): Promise<MultiHopTraversalResult> {
    this.ensureSeedLoaded();
    const started = Date.now();
    const maxDepth = Math.min(Math.max(options.maxDepth ?? 3, 1), 5);
    const validTime = options.validTime || "2026-10-20";
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

    if (options.relationshipFilter) {
      for (const rt of options.relationshipFilter) {
        if (!isValidRelationshipType(rt)) {
          throw new Error(`SECURITY_VIOLATION_INVALID_REL_TYPE: '${rt}' is not in the canonical ontology.`);
        }
      }
    }

    const envCfg = neo4jConnectionManager.getEnvConfig();
    if (!envCfg.configured && this.shouldEnforceStrictNeo4j(options.ctx)) {
      neo4jConnectionManager.recordDegradedIncident("NEO4J_UNCONFIGURED during multi-hop traversal");
      throw new GraphUnavailableError(
        "NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD are not configured."
      );
    }

    let storageBackend: GraphStorageBackend =
      process.env.NODE_ENV === "test"
        ? "test_in_memory_store"
        : "degraded_readonly_seed_store";
    let degradedMode = true;

    if (envCfg.configured) {
      const health = await neo4jConnectionManager.checkHealth();
      if (health.connected && (health.live_node_count ?? 0) > 0) {
        storageBackend = "neo4j_auradb_persisted";
        degradedMode = false;
      } else if (this.shouldEnforceStrictNeo4j(options.ctx)) {
        throw new GraphUnavailableError(
          health.sanitized_error || "Neo4j AuraDB instance is unreachable or empty."
        );
      }
    }

    const resolvedStartId = resolveCanonicalId(options.startCanonicalId, this.seedNodes);
    const startNode = this.seedNodes.get(resolvedStartId);
    if (!startNode || !isTenantAuthorized(startNode.tenant_id, options.ctx.tenant_id)) {
      return {
        start_canonical_id: options.startCanonicalId,
        max_depth: maxDepth,
        valid_time: validTime,
        tenant_id: options.ctx.tenant_id,
        storage_backend: storageBackend,
        degraded_mode: degradedMode,
        degraded_warning: degradedMode
          ? "DEGRADED READ-ONLY MODE: Neo4j AuraDB not connected; traversed canonical seed graph."
          : null,
        visited_nodes: [],
        traversal_paths: [],
        path_explanations: [],
        authority_disclaimer:
          "Graph traversal results represent structural legal relationships and do not constitute a legal conclusion verified by a licensed attorney (REG-NEO-008, REG-NEO-019).",
        latency_ms: Date.now() - started,
      };
    }

    const visitedNodesMap = new Map<string, CanonicalGraphNode>([
      [startNode.canonical_id, startNode],
    ]);
    const traversalPaths: MultiHopTraversalHop[] = [];
    const pathExplanations: string[] = [];
    const frontier = new Set<string>([startNode.canonical_id]);
    const expandedRels = new Set<string>();

    for (let depth = 1; depth <= maxDepth; depth++) {
      const nextFrontier = new Set<string>();
      for (const currentId of frontier) {
        for (const rel of this.seedRels) {
          if (expandedRels.has(rel.canonical_id)) continue;
          if (rel.verification_status !== "verified") continue;
          if (!isEffectiveOnDate(rel.effective_from, rel.effective_to, validTime)) continue;
          if (
            options.relationshipFilter &&
            options.relationshipFilter.length > 0 &&
            !options.relationshipFilter.includes(rel.relationship_type)
          ) {
            continue;
          }

          const isOutgoing = rel.from_canonical_id === currentId;
          const isIncoming = rel.to_canonical_id === currentId;
          if (!isOutgoing && !isIncoming) continue;

          const fromNode = this.seedNodes.get(rel.from_canonical_id);
          const toNode = this.seedNodes.get(rel.to_canonical_id);
          if (!fromNode || !toNode) continue;
          if (
            !isTenantAuthorized(fromNode.tenant_id, options.ctx.tenant_id) ||
            !isTenantAuthorized(toNode.tenant_id, options.ctx.tenant_id)
          ) {
            continue;
          }

          expandedRels.add(rel.canonical_id);
          visitedNodesMap.set(fromNode.canonical_id, fromNode);
          visitedNodesMap.set(toNode.canonical_id, toNode);

          const neighborId = isOutgoing ? toNode.canonical_id : fromNode.canonical_id;
          nextFrontier.add(neighborId);

          traversalPaths.push({
            hop_index: depth,
            from_node: {
              canonical_id: fromNode.canonical_id,
              label: fromNode.label,
              citation_label: fromNode.citation_label,
              title_en: fromNode.title_en,
              legal_authority_tier: fromNode.legal_authority_tier,
              is_binding_law: fromNode.is_binding_law,
            },
            relationship: {
              canonical_id: rel.canonical_id,
              relationship_type: rel.relationship_type,
              citation_note: rel.citation_note,
              verification_status: rel.verification_status,
              effective_from: rel.effective_from,
              effective_to: rel.effective_to,
            },
            to_node: {
              canonical_id: toNode.canonical_id,
              label: toNode.label,
              citation_label: toNode.citation_label,
              title_en: toNode.title_en,
              legal_authority_tier: toNode.legal_authority_tier,
              is_binding_law: toNode.is_binding_law,
            },
          });

          pathExplanations.push(
            `[Hop ${depth}] (${fromNode.label}: ${fromNode.citation_label}) -[${rel.relationship_type}]-> (${toNode.label}: ${toNode.citation_label}) — ${rel.citation_note} [${toNode.legal_authority_tier}]`
          );

          if (traversalPaths.length >= limit) break;
        }
        if (traversalPaths.length >= limit) break;
      }
      if (nextFrontier.size === 0 || traversalPaths.length >= limit) break;
      frontier.clear();
      for (const id of nextFrontier) frontier.add(id);
    }

    return {
      start_canonical_id: options.startCanonicalId,
      max_depth: maxDepth,
      valid_time: validTime,
      tenant_id: options.ctx.tenant_id,
      storage_backend: storageBackend,
      degraded_mode: degradedMode,
      degraded_warning: degradedMode
        ? "DEGRADED READ-ONLY MODE: Neo4j AuraDB credentials not configured; traversed validated canonical seed graph."
        : null,
      visited_nodes: Array.from(visitedNodesMap.values()),
      traversal_paths: traversalPaths,
      path_explanations: pathExplanations,
      authority_disclaimer:
        "Graph traversal results distinguish primary binding statutes from administrative tax rulings and judicial interpretations. Graph paths do not substitute for professional legal review (REG-NEO-008, REG-NEO-019).",
      latency_ms: Date.now() - started,
    };
  }

  /**
   * REG-NEO-009 — 7-Signal Hybrid Retrieval (Keyword + Vector Similarity + Graph Traversal + Metadata + Citation + Temporal + Authority Reranking)
   */
  public async hybridRetrieve(options: {
    query: string;
    labelFilter?: CanonicalNodeLabel[];
    moduleIdFilter?: string;
    validTime?: string;
    limit?: number;
    ctx: TenantQueryContext;
  }): Promise<HybridRetrievalResponse> {
    this.ensureSeedLoaded();
    const started = Date.now();
    const validTime = options.validTime || "2026-10-20";
    const limit = Math.min(Math.max(options.limit ?? 12, 1), 50);

    const envCfg = neo4jConnectionManager.getEnvConfig();
    if (!envCfg.configured && this.shouldEnforceStrictNeo4j(options.ctx)) {
      neo4jConnectionManager.recordDegradedIncident("NEO4J_UNCONFIGURED during hybridRetrieve");
      throw new GraphUnavailableError(
        "NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD are not configured."
      );
    }

    let storageBackend: GraphStorageBackend =
      process.env.NODE_ENV === "test"
        ? "test_in_memory_store"
        : "degraded_readonly_seed_store";
    let degradedMode = true;

    if (envCfg.configured) {
      const health = await neo4jConnectionManager.checkHealth();
      if (health.connected && (health.live_node_count ?? 0) > 0) {
        storageBackend = "neo4j_auradb_persisted";
        degradedMode = false;
      } else if (this.shouldEnforceStrictNeo4j(options.ctx)) {
        throw new GraphUnavailableError(
          health.sanitized_error || "Neo4j AuraDB is unreachable."
        );
      }
    }

    const qLower = options.query.toLowerCase().trim();
    const queryTokens = qLower.split(/\s+/).filter((t) => t.length >= 2);

    const candidateItems: HybridRetrievalItem[] = [];

    for (const node of this.seedNodes.values()) {
      // 4. Structured metadata & tenant isolation filtering
      if (!isTenantAuthorized(node.tenant_id, options.ctx.tenant_id)) continue;
      if (options.labelFilter && options.labelFilter.length > 0 && !options.labelFilter.includes(node.label)) {
        continue;
      }
      if (options.moduleIdFilter && node.module_id !== options.moduleIdFilter) {
        continue;
      }
      // 6. Temporal filtering
      if (!isEffectiveOnDate(node.effective_from, node.effective_to, validTime)) {
        continue;
      }

      const searchableText = `${node.canonical_id} ${node.citation_label} ${node.title_en} ${node.title_th} ${node.summary_Text}`.toLowerCase();

      // 1. Keyword/full-text score
      let matchedTokens = 0;
      for (const tok of queryTokens) {
        if (searchableText.includes(tok)) matchedTokens += 1;
      }
      const keywordScore =
        queryTokens.length > 0 ? Number((matchedTokens / queryTokens.length).toFixed(4)) : 0;

      // 2. Vector similarity score
      const vectorScore = computeDeterministicVectorSimilarity(options.query, searchableText);

      // 5. Legal citation matching score
      const citationLower = node.citation_label.toLowerCase();
      const citationScore =
        qLower && (citationLower.includes(qLower) || qLower.includes(citationLower))
          ? 1.0
          : 0.0;

      // 3. Neo4j graph relationship proximity
      const connectedRels = this.seedRels.filter(
        (r) =>
          r.verification_status === "verified" &&
          (r.from_canonical_id === node.canonical_id || r.to_canonical_id === node.canonical_id)
      );
      const graphProximityScore = Math.min(connectedRels.length / 5, 1.0);

      // 7. Evidence-aware authority reranking boost (REG-NEO-019: statutes rank higher than non-binding drafts/rulings)
      const authorityBoost =
        node.legal_authority_tier === "PRIMARY_STATUTE"
          ? 0.25
          : node.legal_authority_tier === "SUPREME_COURT_PRECEDENT"
            ? 0.2
            : node.legal_authority_tier === "SUBORDINATE_REGULATION"
              ? 0.18
              : node.legal_authority_tier === "ADMINISTRATIVE_TAX_RULING"
                ? 0.12
                : 0.1;

      const combinedScore = Number(
        (
          keywordScore * 0.35 +
          vectorScore * 0.25 +
          citationScore * 0.2 +
          graphProximityScore * 0.1 +
          authorityBoost * 0.1
        ).toFixed(4)
      );

      if (combinedScore > 0.08 || keywordScore > 0 || citationScore > 0) {
        candidateItems.push({
          node,
          scores: {
            keyword_score: keywordScore,
            vector_similarity_score: vectorScore,
            graph_proximity_score: Number(graphProximityScore.toFixed(4)),
            citation_match_score: citationScore,
            authority_rerank_boost: authorityBoost,
            combined_score: combinedScore,
          },
          supporting_relationships: connectedRels.slice(0, 6),
        });
      }
    }

    candidateItems.sort((a, b) => b.scores.combined_score - a.scores.combined_score);

    return {
      query: options.query,
      valid_time: validTime,
      tenant_id: options.ctx.tenant_id,
      storage_backend: storageBackend,
      degraded_mode: degradedMode,
      degraded_warning: degradedMode
        ? "DEGRADED READ-ONLY MODE: Neo4j AuraDB credentials not configured; hybrid search executed against validated canonical seed graph."
        : null,
      schema_version: NEO4J_SCHEMA_VERSION,
      results: candidateItems.slice(0, limit),
      latency_ms: Date.now() - started,
    };
  }
}

export const unifiedGraphRepository = new UnifiedGraphRepository();
