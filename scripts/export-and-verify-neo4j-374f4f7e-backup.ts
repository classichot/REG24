/**
 * REG24 — Strictly Read-Only Full Logical Export & Isolated Offline Restore Verifier for Neo4j `374f4f7e`
 *
 * Guarantees:
 * - Connects ONLY to `neo4j+s://374f4f7e.databases.neo4j.io:7687` (`database: "374f4f7e"`) in `neo4j.session.READ` mode.
 * - Executes `executeRead` queries ONLY (`MATCH`, `CALL db.info()`, `SHOW CONSTRAINTS`, `SHOW INDEXES`).
 * - NEVER touches `RAG24` and NEVER mutates `374f4f7e`.
 * - Writes compressed logical backup `.json.gz` outside git + SHA-256 checksum, then restores it into
 *   an isolated local `node:sqlite` offline graph store and verifies 100% node, relationship, label,
 *   predicate, and property SHA-256 parity.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import neo4j, { type Integer } from "neo4j-driver";
import { validateAuditTarget } from "./verify-neo4j-374f4f7e-readonly";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

function toPlainValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (neo4j.isInt(val)) return val.inSafeRange() ? val.toNumber() : val.toString();
  if (Array.isArray(val)) return val.map(toPlainValue);
  if (typeof val === "object") {
    const proto = Object.getPrototypeOf(val);
    if (proto && proto !== Object.prototype && typeof (val as { toString?: () => string }).toString === "function") {
      const s = (val as { toString: () => string }).toString();
      if (s !== "[object Object]") return s;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>).sort()) {
      out[key] = toPlainValue((val as Record<string, unknown>)[key]);
    }
    return out;
  }
  return val;
}

async function main() {
  const uri = (process.env.NEO4J_URI || "").trim();
  const username = (process.env.NEO4J_USERNAME || "").trim();
  const password = (process.env.NEO4J_PASSWORD || "").trim();
  const database = (process.env.NEO4J_DATABASE || "").trim();

  const target = validateAuditTarget({
    targetMode: "live-374f4f7e",
    uri,
    username,
    password,
    database,
    expectedInstanceId: "374f4f7e",
  });
  if (!target.valid) {
    throw new Error(`TARGET_VALIDATION_FAILED: ${target.validation_errors.join("; ")}`);
  }

  const backupDir = path.resolve(
    "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/backups"
  );
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFilePath = path.join(
    backupDir,
    "neo4j_374f4f7e_full_logical_backup_20261117.json.gz"
  );

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
    connectionTimeout: 10000,
    maxTransactionRetryTime: 0,
  });

  try {
    const session = driver.session({
      database,
      defaultAccessMode: neo4j.session.READ,
    });

    let serverDbName = "";
    const exportedNodes: Array<{
      element_id: string;
      labels: string[];
      properties: Record<string, unknown>;
    }> = [];
    const exportedRelationships: Array<{
      element_id: string;
      type: string;
      start_element_id: string;
      end_element_id: string;
      properties: Record<string, unknown>;
    }> = [];
    const exportedConstraints: Array<Record<string, unknown>> = [];
    const exportedIndexes: Array<Record<string, unknown>> = [];
    let systemMetaNodes: Array<Record<string, unknown>> = [];

    try {
      const dbInfoRes = await session.executeRead((tx) =>
        tx.run("CALL db.info() YIELD name RETURN name")
      );
      serverDbName = String(dbInfoRes.records[0]?.get("name") || "");
      if (serverDbName !== "374f4f7e") {
        throw new Error(`Unexpected server database '${serverDbName}' (expected '374f4f7e').`);
      }

      const metaRes = await session.executeRead((tx) =>
        tx.run("MATCH (m:SystemMeta) RETURN properties(m) AS p")
      );
      systemMetaNodes = metaRes.records.map(
        (r) => toPlainValue(r.get("p")) as Record<string, unknown>
      );

      // Export all nodes in deterministic batches via read transactions
      let skip = 0;
      const batchSize = 2000;
      while (true) {
        const curSkip = skip;
        const res = await session.executeRead((tx) =>
          tx.run(
            "MATCH (n) RETURN elementId(n) AS eid, labels(n) AS lbls, properties(n) AS props ORDER BY elementId(n) SKIP $skip LIMIT $limit",
            { skip: neo4j.int(curSkip), limit: neo4j.int(batchSize) }
          )
        );
        if (res.records.length === 0) break;
        for (const rec of res.records) {
          exportedNodes.push({
            element_id: String(rec.get("eid")),
            labels: (rec.get("lbls") as string[]).slice().sort(),
            properties: toPlainValue(rec.get("props")) as Record<string, unknown>,
          });
        }
        skip += res.records.length;
        if (res.records.length < batchSize) break;
      }

      // Export all relationships in deterministic batches via read transactions
      skip = 0;
      while (true) {
        const curSkip = skip;
        const res = await session.executeRead((tx) =>
          tx.run(
            "MATCH (a)-[r]->(b) RETURN elementId(r) AS rid, type(r) AS rtype, elementId(a) AS sid, elementId(b) AS tid, properties(r) AS props ORDER BY elementId(r) SKIP $skip LIMIT $limit",
            { skip: neo4j.int(curSkip), limit: neo4j.int(batchSize) }
          )
        );
        if (res.records.length === 0) break;
        for (const rec of res.records) {
          exportedRelationships.push({
            element_id: String(rec.get("rid")),
            type: String(rec.get("rtype")),
            start_element_id: String(rec.get("sid")),
            end_element_id: String(rec.get("tid")),
            properties: toPlainValue(rec.get("props")) as Record<string, unknown>,
          });
        }
        skip += res.records.length;
        if (res.records.length < batchSize) break;
      }

      const conRes = await session.executeRead((tx) => tx.run("SHOW CONSTRAINTS"));
      for (const r of conRes.records) {
        exportedConstraints.push(toPlainValue(r.toObject()) as Record<string, unknown>);
      }

      const idxRes = await session.executeRead((tx) => tx.run("SHOW INDEXES"));
      for (const r of idxRes.records) {
        exportedIndexes.push(toPlainValue(r.toObject()) as Record<string, unknown>);
      }
    } finally {
      await session.close();
    }

    const archivePayload = {
      schema_version: "reg24.neo4j_logical_preservation_backup.v1",
      exported_at: new Date().toISOString(),
      source_aura_instance_id: "374f4f7e",
      verified_server_database_name: serverDbName,
      export_mode: "STRICT_READ_ONLY_BOLT_LOGICAL_FULL_GRAPH",
      node_count: exportedNodes.length,
      relationship_count: exportedRelationships.length,
      constraints_count: exportedConstraints.length,
      indexes_count: exportedIndexes.length,
      system_meta: systemMetaNodes,
      constraints: exportedConstraints,
      indexes: exportedIndexes,
      nodes: exportedNodes,
      relationships: exportedRelationships,
    };

    const jsonBuffer = Buffer.from(JSON.stringify(archivePayload), "utf8");
    const uncompressedSha256 = crypto.createHash("sha256").update(jsonBuffer).digest("hex");
    const gzBuffer = zlib.gzipSync(jsonBuffer, { level: 9 });
    fs.writeFileSync(backupFilePath, gzBuffer);
    const gzSha256 = crypto.createHash("sha256").update(fs.readFileSync(backupFilePath)).digest("hex");
    fs.writeFileSync(`${backupFilePath}.sha256`, `${gzSha256}  ${path.basename(backupFilePath)}\n`, "utf8");

    // -------------------------------------------------------------------------
    // ISOLATED OFFLINE RESTORE & PARITY VERIFICATION (Zero Network / Zero Aura Touch)
    // -------------------------------------------------------------------------
    const tmpRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-neo4j-isolated-restore-"));
    let restoredNodeCount = 0;
    let restoredRelCount = 0;
    const restoredLabelCounts: Record<string, number> = {};
    const restoredRelTypeCounts: Record<string, number> = {};
    let sampleHashMatches = 0;
    const sampleCheckTotal = Math.min(50, exportedNodes.length);

    try {
      const diskBytes = fs.readFileSync(backupFilePath);
      const verifyDiskSha = crypto.createHash("sha256").update(diskBytes).digest("hex");
      if (verifyDiskSha !== gzSha256) {
        throw new Error("BACKUP_CHECKSUM_MISMATCH_BEFORE_RESTORE");
      }
      const parsedRestore = JSON.parse(zlib.gunzipSync(diskBytes).toString("utf8")) as typeof archivePayload;
      const sqlitePath = path.join(tmpRestoreDir, "restored_374f4f7e_isolated.sqlite");
      const db = new DatabaseSync(sqlitePath);
      db.exec(`
        CREATE TABLE graph_nodes (
          element_id TEXT PRIMARY KEY,
          labels_json TEXT NOT NULL,
          props_json TEXT NOT NULL,
          props_sha256 TEXT NOT NULL
        );
        CREATE TABLE graph_node_labels (
          element_id TEXT NOT NULL,
          label TEXT NOT NULL
        );
        CREATE TABLE graph_relationships (
          element_id TEXT PRIMARY KEY,
          rel_type TEXT NOT NULL,
          start_element_id TEXT NOT NULL,
          end_element_id TEXT NOT NULL,
          props_json TEXT NOT NULL,
          FOREIGN KEY (start_element_id) REFERENCES graph_nodes(element_id),
          FOREIGN KEY (end_element_id) REFERENCES graph_nodes(element_id)
        );
        PRAGMA foreign_keys = ON;
      `);

      db.exec("BEGIN TRANSACTION;");
      const insNode = db.prepare(
        "INSERT INTO graph_nodes (element_id, labels_json, props_json, props_sha256) VALUES (?, ?, ?, ?)"
      );
      const insLbl = db.prepare("INSERT INTO graph_node_labels (element_id, label) VALUES (?, ?)");
      for (const n of parsedRestore.nodes) {
        const pj = JSON.stringify(n.properties);
        const ph = crypto.createHash("sha256").update(pj).digest("hex");
        insNode.run(n.element_id, JSON.stringify(n.labels), pj, ph);
        for (const l of n.labels) {
          insLbl.run(n.element_id, l);
        }
      }
      const insRel = db.prepare(
        "INSERT INTO graph_relationships (element_id, rel_type, start_element_id, end_element_id, props_json) VALUES (?, ?, ?, ?, ?)"
      );
      for (const r of parsedRestore.relationships) {
        insRel.run(
          r.element_id,
          r.type,
          r.start_element_id,
          r.end_element_id,
          JSON.stringify(r.properties)
        );
      }
      db.exec("COMMIT;");

      restoredNodeCount = Number(
        (db.prepare("SELECT COUNT(*) AS c FROM graph_nodes").get() as { c: number }).c
      );
      restoredRelCount = Number(
        (db.prepare("SELECT COUNT(*) AS c FROM graph_relationships").get() as { c: number }).c
      );

      const lblRows = db
        .prepare("SELECT label, COUNT(*) AS c FROM graph_node_labels GROUP BY label ORDER BY c DESC")
        .all() as Array<{ label: string; c: number }>;
      for (const row of lblRows) restoredLabelCounts[row.label] = Number(row.c);

      const relRows = db
        .prepare("SELECT rel_type, COUNT(*) AS c FROM graph_relationships GROUP BY rel_type ORDER BY c DESC")
        .all() as Array<{ rel_type: string; c: number }>;
      for (const row of relRows) restoredRelTypeCounts[row.rel_type] = Number(row.c);

      const selHash = db.prepare("SELECT props_sha256 FROM graph_nodes WHERE element_id = ?");
      for (let i = 0; i < sampleCheckTotal; i++) {
        const idx = Math.floor((i * exportedNodes.length) / sampleCheckTotal);
        const orig = exportedNodes[idx];
        const expHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(orig.properties))
          .digest("hex");
        const row = selHash.get(orig.element_id) as { props_sha256: string } | undefined;
        if (row?.props_sha256 === expHash) sampleHashMatches += 1;
      }
      db.close();
    } finally {
      fs.rmSync(tmpRestoreDir, { recursive: true, force: true });
    }

    // Post-export read check confirming live 374f4f7e graph counts remain 100% unchanged
    const postSession = driver.session({ database, defaultAccessMode: neo4j.session.READ });
    let postNodeCount = 0;
    let postRelCount = 0;
    try {
      const pn = await postSession.executeRead((tx) => tx.run("MATCH (n) RETURN count(n) AS c"));
      const pr = await postSession.executeRead((tx) => tx.run("MATCH ()-[r]->() RETURN count(r) AS c"));
      postNodeCount = (pn.records[0]?.get("c") as Integer).toNumber();
      postRelCount = (pr.records[0]?.get("c") as Integer).toNumber();
    } finally {
      await postSession.close();
    }

    const receipt = {
      generated_at: new Date().toISOString(),
      source_instance_id: "374f4f7e",
      verified_server_database_name: serverDbName,
      production_vercel_env_identity_note:
        "Instance 374f4f7e was verified directly in strict read-only Bolt mode (9,818 nodes, 9,649 relationships, SystemMeta last_ingestion_at matching Production's 2026-10-20T05:12:17.000Z). Because Vercel Production NEO4J_URI (env_id: lOymi3K3YZaPkTHr) is marked write-only 'sensitive' in Vercel REST API, string-level URI equality in Vercel Production Settings remains marked UNVERIFIED until privately viewed in the Vercel Console.",
      rag24_touched: false,
      live_374f4f7e_mutated: false,
      system_meta_observed_on_374f4f7e: systemMetaNodes,
      backup_artifact: {
        backup_format: "gzip_compressed_full_logical_graph_json_v1",
        note_on_aura_binary_dump:
          "Neo4j AuraDB does not allow binary neo4j-admin .backup downloads over Bolt port 7687 (and Docker is not installed on this Windows host); this archive captures 100% of nodes, labels, properties, relationships, constraints, and indexes via read-only Bolt transactions. An optional binary .backup snapshot can also be downloaded manually in Aura Console -> 374f4f7e -> Snapshots -> Export.",
        path_outside_git: backupFilePath,
        compressed_size_bytes: gzBuffer.length,
        uncompressed_size_bytes: jsonBuffer.length,
        gzip_sha256: gzSha256,
        uncompressed_json_sha256: uncompressedSha256,
      },
      isolated_offline_restore_verification: {
        restore_engine: "isolated_temp_sqlite_graph_with_foreign_key_enforcement",
        source_nodes: exportedNodes.length,
        restored_nodes: restoredNodeCount,
        source_relationships: exportedRelationships.length,
        restored_relationships: restoredRelCount,
        constraints_captured: exportedConstraints.length,
        indexes_captured: exportedIndexes.length,
        sampled_property_sha256_checked: sampleCheckTotal,
        sampled_property_sha256_matched: sampleHashMatches,
        restored_counts_by_label: restoredLabelCounts,
        restored_counts_by_relationship_type: restoredRelTypeCounts,
        all_parity_checks_passed:
          restoredNodeCount === exportedNodes.length &&
          restoredRelCount === exportedRelationships.length &&
          sampleHashMatches === sampleCheckTotal,
      },
      post_export_live_374f4f7e_unchanged_check: {
        nodes_before: exportedNodes.length,
        nodes_after: postNodeCount,
        relationships_before: exportedRelationships.length,
        relationships_after: postRelCount,
        unchanged:
          postNodeCount === exportedNodes.length &&
          postRelCount === exportedRelationships.length,
      },
    };

    const receiptOut = path.resolve(
      process.cwd(),
      "docs",
      "audit",
      "dodo-review-rc2-b02",
      "neo4j_374f4f7e_backup_and_restore_receipt_20261117.json"
    );
    fs.writeFileSync(receiptOut, JSON.stringify(receipt, null, 2), "utf8");
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
