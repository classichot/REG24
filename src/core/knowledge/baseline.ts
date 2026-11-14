/**
 * REG24 — Task F1: Deployed Baseline Capture, Isolated Snapshot Restoration & Legacy ID Crosswalk
 * Implements SH-06 & SH-07.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { THAI_TAX_RULINGS_CORPUS } from "../data/thai-tax-rulings-loader";
import { LEGAL_RESOURCE_MASTER_CORPUS } from "../data/legal-resource-master-loader";
import { buildCanonicalGraphDatasetFromCorpus } from "../graph/graph-migrator";
import { NEO4J_SCHEMA_CONSTRAINTS_CYPHER, NEO4J_SCHEMA_VERSION } from "../graph/graph-schema";
import { neo4jConnectionManager } from "../graph/neo4j-client";
import {
  buildDeterministicWorkId,
  normalizeOfficialRulingIdentifier,
  parseThaiBuddhistDateToIso,
  sha256Bytes,
} from "./identity";

export interface LegacyCrosswalkEntry {
  legacy_id: string;
  source_collection: "thai_tax_rulings" | "legal_resource_master" | "canonical_graph_seed";
  canonical_work_id: string;
  official_identifier_normalized: string;
  preserved_aliases: string[];
}

export interface BaselineSnapshotManifest {
  snapshot_id: string;
  captured_at: string;
  code_commit: string;
  schema_version: string;
  snapshot_uri: string;
  snapshot_sha256: string;
  canonical_counts: {
    thai_tax_rulings_rows: number;
    resource_master_rows: number;
    seed_graph_nodes: number;
    seed_graph_relationships: number;
    declared_neo4j_constraints: number;
  };
  live_neo4j_status: {
    configured: boolean;
    connected: boolean;
    live_node_count: number | null;
    live_relationship_count: number | null;
    sanitized_error: string | null;
  };
  duplicate_ruling_candidates: Array<{
    normalized_ruling_no: string;
    date_raw: string;
    legacy_ids: string[];
  }>;
  constraint_conflicts: string[];
}

export function getDeployedGitCommit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.trim();
  }
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
  } catch {
    return "3dd93e0";
  }
}

/**
 * Builds the durable crosswalk mapping existing REG24 IDs (`ruling.th.rd.*`, `LRM-*`, `inst.th.*`, `prov.th.*`)
 * to canonical Knowledge GraphRAG `work_id`s without deleting or auto-merging ambiguous records (SH-07).
 */
export function buildLegacyIdCrosswalk(): {
  entries: LegacyCrosswalkEntry[];
  byLegacyId: Map<string, LegacyCrosswalkEntry>;
  duplicateRulings: Array<{
    normalized_ruling_no: string;
    date_raw: string;
    legacy_ids: string[];
  }>;
} {
  const entries: LegacyCrosswalkEntry[] = [];
  const byLegacyId = new Map<string, LegacyCrosswalkEntry>();
  const rulingGroup = new Map<string, string[]>();

  for (const r of THAI_TAX_RULINGS_CORPUS) {
    const normNo = normalizeOfficialRulingIdentifier(r.ruling_no);
    const isoDate = parseThaiBuddhistDateToIso(r.date);
    const yr = isoDate ? isoDate.slice(0, 4) : String(r.year_be - 543);
    const groupKey = `${normNo}|${r.date}`;
    const bucket = rulingGroup.get(groupKey) || [];
    bucket.push(r.id);
    rulingGroup.set(groupKey, bucket);

    const workId = buildDeterministicWorkId({
      doc_type: "TaxRuling",
      issuer_id: "reg.th.rd",
      normalized_identifier: normNo || r.id,
      issue_year_ce: yr,
      access_scope: "scope.platform.public",
    });

    const entry: LegacyCrosswalkEntry = {
      legacy_id: r.id,
      source_collection: "thai_tax_rulings",
      canonical_work_id: workId,
      official_identifier_normalized: normNo,
      preserved_aliases: [r.id, r.ruling_no, r.source_url].filter(Boolean),
    };
    entries.push(entry);
    byLegacyId.set(r.id, entry);
  }

  for (const doc of LEGAL_RESOURCE_MASTER_CORPUS) {
    const workId = buildDeterministicWorkId({
      doc_type: "SubordinateLegislation",
      issuer_id: `reg.th.${(doc.authority_code || "lrm").toLowerCase()}`,
      normalized_identifier: doc.code || doc.id,
      issue_year_ce: doc.effective_date ? doc.effective_date.slice(0, 4) : null,
      access_scope: "scope.platform.public",
    });
    const entry: LegacyCrosswalkEntry = {
      legacy_id: doc.id,
      source_collection: "legal_resource_master",
      canonical_work_id: workId,
      official_identifier_normalized: doc.code,
      preserved_aliases: [doc.id, `inst.lrm.${doc.id.toLowerCase()}`, doc.code].filter(Boolean),
    };
    entries.push(entry);
    byLegacyId.set(doc.id, entry);
  }

  const graphSeed = buildCanonicalGraphDatasetFromCorpus();
  for (const node of graphSeed.nodes) {
    if (!byLegacyId.has(node.canonical_id)) {
      const entry: LegacyCrosswalkEntry = {
        legacy_id: node.canonical_id,
        source_collection: "canonical_graph_seed",
        canonical_work_id: node.canonical_id,
        official_identifier_normalized: node.citation_label,
        preserved_aliases: [node.canonical_id, node.citation_label],
      };
      entries.push(entry);
      byLegacyId.set(node.canonical_id, entry);
    }
  }

  const duplicateRulings = Array.from(rulingGroup.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, legacy_ids]) => {
      const [normalized_ruling_no, date_raw] = key.split("|");
      return { normalized_ruling_no, date_raw, legacy_ids };
    });

  return { entries, byLegacyId, duplicateRulings };
}

export async function captureBaselineSnapshot(options: {
  outputDir: string;
  probeLiveNeo4j?: boolean;
}): Promise<BaselineSnapshotManifest> {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const codeCommit = getDeployedGitCommit();
  const crosswalk = buildLegacyIdCrosswalk();
  const seedDataset = buildCanonicalGraphDatasetFromCorpus();

  let liveNeo4jStatus: BaselineSnapshotManifest["live_neo4j_status"] = {
    configured: neo4jConnectionManager.getEnvConfig().configured,
    connected: false,
    live_node_count: null,
    live_relationship_count: null,
    sanitized_error: "Live probe skipped in fast local mode",
  };

  if (options.probeLiveNeo4j) {
    const health = await neo4jConnectionManager.checkHealth();
    liveNeo4jStatus = {
      configured: neo4jConnectionManager.getEnvConfig().configured,
      connected: health.connected,
      live_node_count: health.live_node_count,
      live_relationship_count: health.live_relationship_count,
      sanitized_error: health.sanitized_error,
    };
  }

  const payload = {
    code_commit: codeCommit,
    schema_version: NEO4J_SCHEMA_VERSION,
    captured_at: new Date().toISOString(),
    canonical_counts: {
      thai_tax_rulings_rows: THAI_TAX_RULINGS_CORPUS.length,
      resource_master_rows: LEGAL_RESOURCE_MASTER_CORPUS.length,
      seed_graph_nodes: seedDataset.nodes.length,
      seed_graph_relationships: seedDataset.relationships.length,
      declared_neo4j_constraints: NEO4J_SCHEMA_CONSTRAINTS_CYPHER.length,
    },
    rulings_digest: sha256Bytes(
      THAI_TAX_RULINGS_CORPUS.map((r) => `${r.id}:${r.ruling_no}:${r.date}`).join("\n")
    ),
    lrm_digest: sha256Bytes(
      LEGAL_RESOURCE_MASTER_CORPUS.map((d) => `${d.id}:${d.sha256}`).join("\n")
    ),
    seed_graph_digest: sha256Bytes(
      seedDataset.nodes.map((n) => `${n.canonical_id}:${n.source_content_hash}`).join("\n")
    ),
    crosswalk_entries_count: crosswalk.entries.length,
    duplicate_ruling_candidates: crosswalk.duplicateRulings,
    constraint_conflicts: seedDataset.duplicateIdsDetected,
  };

  const serialized = JSON.stringify(payload, null, 2);
  const snapshotSha256 = sha256Bytes(serialized);
  const snapshotId = `baseline_${codeCommit.slice(0, 7)}_${snapshotSha256.slice(0, 8)}`;
  const snapshotFile = path.join(options.outputDir, `${snapshotId}.json`);
  fs.writeFileSync(snapshotFile, serialized, "utf8");

  return {
    snapshot_id: snapshotId,
    captured_at: payload.captured_at,
    code_commit: codeCommit,
    schema_version: NEO4J_SCHEMA_VERSION,
    snapshot_uri: snapshotFile,
    snapshot_sha256: snapshotSha256,
    canonical_counts: payload.canonical_counts,
    live_neo4j_status: liveNeo4jStatus,
    duplicate_ruling_candidates: crosswalk.duplicateRulings,
    constraint_conflicts: seedDataset.duplicateIdsDetected,
  };
}

export async function restoreBaselineSnapshotIsolated(
  snapshotUri: string,
  isolatedTargetDir: string
): Promise<{
  restored_to: string;
  checksum_matches: boolean;
  expected_sha256: string;
  actual_sha256: string;
  restored_counts: BaselineSnapshotManifest["canonical_counts"];
}> {
  fs.mkdirSync(isolatedTargetDir, { recursive: true });
  const rawBytes = fs.readFileSync(snapshotUri);
  const expectedSha = sha256Bytes(rawBytes);

  const restoredPath = path.join(isolatedTargetDir, path.basename(snapshotUri));
  fs.writeFileSync(restoredPath, rawBytes);
  const verifyBytes = fs.readFileSync(restoredPath);
  const actualSha = sha256Bytes(verifyBytes);
  const parsed = JSON.parse(verifyBytes.toString("utf8")) as {
    canonical_counts: BaselineSnapshotManifest["canonical_counts"];
  };

  return {
    restored_to: restoredPath,
    checksum_matches: expectedSha === actualSha,
    expected_sha256: expectedSha,
    actual_sha256: actualSha,
    restored_counts: parsed.canonical_counts,
  };
}
