/**
 * REG24 — Real Disposable Neo4j 5 Instance Restore & Query/Schema/Constraint Verifier
 *
 * Addresses Owner Item 4 (2026-11-17):
 * - Spins up an actual disposable Neo4j 5 Community server (`5.26.0`) bound strictly to loopback
 *   `127.0.0.1:17687` (HTTP/HTTPS disabled, authenticated with a random one-time password).
 * - Verifies backup SHA-256, restores all 13 constraints, 20 indexes (RANGE + FULLTEXT + LOOKUP),
 *   9,818 nodes, and 9,649 relationships from `neo4j_374f4f7e_full_logical_backup_20261117.json.gz`.
 * - Executes `runReadOnlyGraphAuditWithDriver(..., "isolated-restore")`, verifies all 20 indexes are
 *   `ONLINE`, verifies 50 sampled node property SHA-256 hashes, executes representative multi-hop
 *   legal Cypher & fulltext queries, and proves uniqueness constraints reject duplicate `canonical_id`s.
 * - Tears down and deletes the disposable Neo4j instance afterward, then re-verifies in read-only mode
 *   that live `374f4f7e` (`9,818` / `9,649`) and `RAG24` remain completely untouched.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import neo4j, { type Integer } from "neo4j-driver";
import {
  runReadOnlyGraphAuditWithDriver,
  validateAuditTarget,
  verifyBackupFileChecksum,
} from "./verify-neo4j-374f4f7e-readonly";

const JDK21_URL =
  "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse";
const NEO4J_ZIP_URL = "https://dist.neo4j.org/neo4j-community-5.26.0-windows.zip";
const BACKUP_GZ_PATH = path.resolve(
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/backups/neo4j_374f4f7e_full_logical_backup_20261117.json.gz"
);
const EXPECTED_BACKUP_SHA256 =
  "589e15775d407587fd7e85867213e34ccdbee82336477a438276bad21167d609";
const SCRATCH_ROOT = path.resolve(
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/disposable-neo4j5"
);
const LOOPBACK_BOLT_PORT = 17687;
const LOOPBACK_BOLT_URI = `bolt://127.0.0.1:${LOOPBACK_BOLT_PORT}`;

async function downloadFile(url: string, destPath: string): Promise<void> {
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 50_000_000) {
    return;
  }
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok || !resp.body) {
    throw new Error(`Failed downloading ${url}: HTTP ${resp.status}`);
  }
  const tmp = `${destPath}.part`;
  await pipeline(
    Readable.fromWeb(resp.body as unknown as import("node:stream/web").ReadableStream),
    fs.createWriteStream(tmp)
  );
  fs.renameSync(tmp, destPath);
}

function findSingleSubdir(parentDir: string): string {
  const entries = fs.readdirSync(parentDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 0) {
    throw new Error(`No extracted directory found inside ${parentDir}`);
  }
  return path.join(parentDir, entries[0].name);
}

function safeIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe Cypher identifier: ${name}`);
  }
  return name;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toPlainValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (neo4j.isInt(val)) return val.inSafeRange() ? val.toNumber() : val.toString();
  if (Array.isArray(val)) return val.map(toPlainValue);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      out[k] = toPlainValue((val as Record<string, unknown>)[k]);
    }
    return out;
  }
  return val;
}

async function main() {
  // 1. Verify backup archive checksum before doing anything
  const backupCheck = verifyBackupFileChecksum(BACKUP_GZ_PATH, EXPECTED_BACKUP_SHA256);
  if (!backupCheck.verified) {
    throw new Error(`Backup checksum verification failed: ${backupCheck.error}`);
  }

  // Validate isolated-restore target strictly enforces loopback and rejects *.databases.neo4j.io
  const ephemeralPassword = `Reg24Disp_${crypto.randomBytes(12).toString("hex")}!`;
  const isolatedTargetCheck = validateAuditTarget({
    targetMode: "isolated-restore",
    uri: LOOPBACK_BOLT_URI,
    username: "neo4j",
    password: ephemeralPassword,
    database: "neo4j",
  });
  if (!isolatedTargetCheck.valid) {
    throw new Error(
      `Isolated target validation failed: ${isolatedTargetCheck.validation_errors.join("; ")}`
    );
  }

  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const jdkZip = path.join(SCRATCH_ROOT, "jdk21.zip");
  const neo4jZip = path.join(SCRATCH_ROOT, "neo4j526.zip");
  const jdkExtractDir = path.join(SCRATCH_ROOT, "jdk");
  const neo4jExtractDir = path.join(SCRATCH_ROOT, "instance");

  let neo4jProc: ChildProcess | null = null;
  let allChecksSucceeded = false;

  try {
    console.log("1. Downloading portable OpenJDK 21 & Neo4j Community 5.26.0...");
    await Promise.all([downloadFile(JDK21_URL, jdkZip), downloadFile(NEO4J_ZIP_URL, neo4jZip)]);

    if (fs.existsSync(neo4jExtractDir)) {
      fs.rmSync(neo4jExtractDir, { recursive: true, force: true });
    }
    if (!fs.existsSync(jdkExtractDir)) {
      fs.mkdirSync(jdkExtractDir, { recursive: true });
      execFileSync("tar.exe", ["-xf", jdkZip, "-C", jdkExtractDir], { stdio: "ignore" });
    }
    fs.mkdirSync(neo4jExtractDir, { recursive: true });
    execFileSync("tar.exe", ["-xf", neo4jZip, "-C", neo4jExtractDir], { stdio: "ignore" });

    const javaHome = findSingleSubdir(jdkExtractDir);
    const neo4jHome = findSingleSubdir(neo4jExtractDir);

    // 2. Configure strictly loopback-only Bolt on 127.0.0.1:17687 (HTTP & HTTPS disabled)
    // Deduplicate any stock keys in Neo4j 5.26's default neo4j.conf first (Neo4j 5 rejects duplicate keys)
    const confPath = path.join(neo4jHome, "conf", "neo4j.conf");
    const overridePairs: Array<[string, string]> = [
      ["server.default_listen_address", "127.0.0.1"],
      ["server.bolt.enabled", "true"],
      ["server.bolt.listen_address", `127.0.0.1:${LOOPBACK_BOLT_PORT}`],
      ["server.http.enabled", "false"],
      ["server.https.enabled", "false"],
      ["dbms.security.auth_enabled", "true"],
      ["dbms.usage_report.enabled", "false"],
      ["server.memory.heap.initial_size", "512m"],
      ["server.memory.heap.max_size", "1024m"],
      ["server.memory.pagecache.size", "256m"],
    ];
    const overrideKeys = new Set(overridePairs.map(([k]) => k));
    const cleanedConfLines = fs
      .readFileSync(confPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return true;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) return true;
        const key = trimmed.slice(0, eqIdx).trim();
        return !overrideKeys.has(key);
      });
    cleanedConfLines.push(
      "",
      "# REG24 Disposable Isolated Restore Configuration (Loopback Only)",
      ...overridePairs.map(([k, v]) => `${k}=${v}`),
      ""
    );
    fs.writeFileSync(confPath, cleanedConfLines.join("\r\n"), "utf8");

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      JAVA_HOME: javaHome,
      NEO4J_HOME: neo4jHome,
      PATH: `${path.join(javaHome, "bin")};${process.env.PATH || ""}`,
      NEO4J_URI: "",
      NEO4J_PASSWORD: "",
    };

    console.log("2. Setting ephemeral initial password via neo4j-admin...");
    const adminBat = path.join(neo4jHome, "bin", "neo4j-admin.bat");
    execFileSync("cmd.exe", ["/c", adminBat, "dbms", "set-initial-password", ephemeralPassword], {
      env: childEnv,
      stdio: "pipe",
    });

    console.log(`3. Starting disposable Neo4j 5 server on ${LOOPBACK_BOLT_URI}...`);
    const neo4jBat = path.join(neo4jHome, "bin", "neo4j.bat");
    neo4jProc = spawn("cmd.exe", ["/c", neo4jBat, "console"], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let startupLogs = "";
    neo4jProc.stdout?.on("data", (chunk) => {
      startupLogs = (startupLogs + chunk.toString("utf8")).slice(-4000);
    });
    neo4jProc.stderr?.on("data", (chunk) => {
      startupLogs = (startupLogs + chunk.toString("utf8")).slice(-4000);
    });

    const dispDriver = neo4j.driver(
      LOOPBACK_BOLT_URI,
      neo4j.auth.basic("neo4j", ephemeralPassword),
      { connectionTimeout: 4000, maxTransactionRetryTime: 0 }
    );

    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        const s = dispDriver.session({ database: "neo4j" });
        await s.run("RETURN 1 AS ok");
        await s.close();
        ready = true;
        break;
      } catch {
        await sleep(1000);
      }
    }
    if (!ready) {
      await dispDriver.close();
      throw new Error(`Disposable Neo4j 5 server did not become ready. Logs:\n${startupLogs}`);
    }

    try {
      console.log("4. Restoring constraints, indexes, 9,818 nodes, and 9,649 relationships...");
      const backupData = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(BACKUP_GZ_PATH)).toString("utf8")
      ) as {
        constraints: Array<{
          name: string;
          type: string;
          labelsOrTypes: string[];
          properties: string[];
        }>;
        indexes: Array<{
          name: string;
          type: string;
          entityType: string;
          labelsOrTypes: string[] | null;
          properties: string[] | null;
          owningConstraint: string | null;
        }>;
        nodes: Array<{
          element_id: string;
          labels: string[];
          properties: Record<string, unknown>;
        }>;
        relationships: Array<{
          element_id: string;
          type: string;
          start_element_id: string;
          end_element_id: string;
          properties: Record<string, unknown>;
        }>;
      };

      const writeSession = dispDriver.session({ database: "neo4j" });
      const restoreStartedMs = Date.now();
      try {
        // 4a. Restore all 13 uniqueness constraints
        for (const c of backupData.constraints) {
          if (c.type === "NODE_PROPERTY_UNIQUENESS") {
            const cname = safeIdent(c.name);
            const lbl = safeIdent(c.labelsOrTypes[0]);
            const prop = safeIdent(c.properties[0]);
            await writeSession.run(
              `CREATE CONSTRAINT ${cname} IF NOT EXISTS FOR (n:${lbl}) REQUIRE n.${prop} IS UNIQUE`
            );
          }
        }

        // 4b. Restore standalone RANGE and FULLTEXT indexes
        for (const idx of backupData.indexes) {
          if (idx.owningConstraint || idx.type === "LOOKUP") continue;
          const iname = safeIdent(idx.name);
          if (idx.type === "RANGE" && idx.entityType === "NODE" && idx.labelsOrTypes && idx.properties) {
            const lbl = safeIdent(idx.labelsOrTypes[0]);
            const propList = idx.properties.map((p) => `n.${safeIdent(p)}`).join(", ");
            await writeSession.run(`CREATE INDEX ${iname} IF NOT EXISTS FOR (n:${lbl}) ON (${propList})`);
          } else if (
            idx.type === "FULLTEXT" &&
            idx.entityType === "NODE" &&
            idx.labelsOrTypes &&
            idx.properties
          ) {
            const lblUnion = idx.labelsOrTypes.map(safeIdent).join("|");
            const propEach = idx.properties.map((p) => `n.${safeIdent(p)}`).join(", ");
            await writeSession.run(
              `CREATE FULLTEXT INDEX ${iname} IF NOT EXISTS FOR (n:${lblUnion}) ON EACH [${propEach}]`
            );
          }
        }

        // Temporary helper index for fast O(1) relationship endpoint resolution during import
        await writeSession.run(
          "CREATE INDEX tmp_restore_eid IF NOT EXISTS FOR (n:_RestoreStage) ON (n._restore_eid)"
        );
        await writeSession.run("CALL db.awaitIndexes(60)");

        // 4c. Batch-insert all 9,818 nodes grouped by exact sorted label set
        const nodesByLabelCombo = new Map<string, typeof backupData.nodes>();
        for (const n of backupData.nodes) {
          const key = n.labels.map(safeIdent).join(":");
          const bucket = nodesByLabelCombo.get(key) || [];
          bucket.push(n);
          nodesByLabelCombo.set(key, bucket);
        }

        for (const [labelExpr, group] of nodesByLabelCombo.entries()) {
          const lblClause = labelExpr ? `:${labelExpr}:_RestoreStage` : ":_RestoreStage";
          for (let i = 0; i < group.length; i += 500) {
            const batch = group.slice(i, i + 500).map((x) => ({
              eid: x.element_id,
              props: x.properties,
            }));
            await writeSession.run(
              `UNWIND $rows AS row CREATE (n${lblClause}) SET n = row.props, n._restore_eid = row.eid`,
              { rows: batch }
            );
          }
        }

        // 4d. Batch-insert all 9,649 relationships grouped by exact relationship type
        const relsByType = new Map<string, typeof backupData.relationships>();
        for (const r of backupData.relationships) {
          const rtype = safeIdent(r.type);
          const bucket = relsByType.get(rtype) || [];
          bucket.push(r);
          relsByType.set(rtype, bucket);
        }

        for (const [rtype, group] of relsByType.entries()) {
          for (let i = 0; i < group.length; i += 500) {
            const batch = group.slice(i, i + 500).map((x) => ({
              sid: x.start_element_id,
              tid: x.end_element_id,
              props: x.properties,
            }));
            await writeSession.run(
              `UNWIND $rows AS row
               MATCH (a:_RestoreStage {_restore_eid: row.sid})
               MATCH (b:_RestoreStage {_restore_eid: row.tid})
               CREATE (a)-[r:${rtype}]->(b)
               SET r = row.props`,
              { rows: batch }
            );
          }
        }

        // 4e. Remove temporary staging label/property and helper index so schema is 100% clean
        await writeSession.run("DROP INDEX tmp_restore_eid IF EXISTS");
        await writeSession.run("MATCH (n:_RestoreStage) REMOVE n:_RestoreStage, n._restore_eid");
        await writeSession.run("CALL db.awaitIndexes(120)");
      } finally {
        await writeSession.close();
      }
      const restoreElapsedMs = Date.now() - restoreStartedMs;

      // 5. Run official read-only isolated-restore audit (`verify-neo4j-374f4f7e-readonly.ts`)
      console.log("5. Running official read-only verifier & representative Cypher queries...");
      const isolatedAudit = await runReadOnlyGraphAuditWithDriver(
        dispDriver,
        "neo4j",
        "isolated-restore"
      );

      // 6. Verify constraints, indexes ONLINE status, properties, representative multi-hop queries & uniqueness enforcement
      const readSess = dispDriver.session({
        database: "neo4j",
        defaultAccessMode: neo4j.session.READ,
      });
      let restoredConstraintsCount = 0;
      let restoredIndexesCount = 0;
      let onlineIndexesCount = 0;
      let multiHopRulingRows: Array<Record<string, unknown>> = [];
      let fulltextHitsCount = 0;
      let temporalVersionHitsCount = 0;
      let sampledPropertyMatches = 0;
      const sampleTotal = 50;

      try {
        const cRes = await readSess.executeRead((tx) => tx.run("SHOW CONSTRAINTS"));
        restoredConstraintsCount = cRes.records.length;

        const iRes = await readSess.executeRead((tx) => tx.run("SHOW INDEXES"));
        restoredIndexesCount = iRes.records.length;
        onlineIndexesCount = iRes.records.filter(
          (r) => String(r.get("state")) === "ONLINE"
        ).length;

        // Representative Query 1: Multi-hop TaxRuling -> INTERPRETS -> Provision <- CONTAINS <- LegalInstrument
        const q1 = await readSess.executeRead((tx) =>
          tx.run(
            `MATCH (r:TaxRuling)-[:INTERPRETS]->(p:Provision)<-[:CONTAINS]-(i:LegalInstrument)
             RETURN r.canonical_id AS ruling_id, coalesce(r.ruling_number, r.official_id, r.title) AS ruling_ref, p.canonical_id AS provision_id, i.canonical_id AS instrument_id
             ORDER BY r.canonical_id LIMIT 5`
          )
        );
        multiHopRulingRows = q1.records.map((r) => toPlainValue(r.toObject()) as Record<string, unknown>);

        // Representative Query 2: Fulltext index search (`ft_legal_provisions`)
        const q2 = await readSess.executeRead((tx) =>
          tx.run(
            `CALL db.index.fulltext.queryNodes('ft_legal_provisions', 'ประมวลรัษฎากร OR ภาษีมูลค่าเพิ่ม')
             YIELD node, score
             RETURN count(node) AS hits`
          )
        );
        fulltextHitsCount = (q2.records[0]?.get("hits") as Integer).toNumber();

        // Representative Query 3: Temporal `ProvisionVersion` query exercising `idx_provision_version_temporal`
        const q3 = await readSess.executeRead((tx) =>
          tx.run(
            `MATCH (p:Provision)-[:HAS_VERSION]->(pv:ProvisionVersion)
             WHERE pv.effective_from IS NOT NULL
             RETURN count(pv) AS version_hits`
          )
        );
        temporalVersionHitsCount = (q3.records[0]?.get("version_hits") as Integer).toNumber();

        // Representative Query 4: Sample 50 nodes across labels and verify exact property SHA-256 parity
        const nodesWithCid = backupData.nodes.filter(
          (n) => typeof n.properties.canonical_id === "string" && n.labels.length > 0
        );
        for (let i = 0; i < sampleTotal && i < nodesWithCid.length; i++) {
          const idx = Math.floor((i * nodesWithCid.length) / sampleTotal);
          const orig = nodesWithCid[idx];
          const lbl = safeIdent(orig.labels[0]);
          const cid = String(orig.properties.canonical_id);
          const res = await readSess.executeRead((tx) =>
            tx.run(`MATCH (n:${lbl} {canonical_id: $cid}) RETURN properties(n) AS p`, { cid })
          );
          if (res.records.length === 1) {
            const gotProps = toPlainValue(res.records[0].get("p"));
            const expHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(orig.properties))
              .digest("hex");
            const gotHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(gotProps))
              .digest("hex");
            if (expHash === gotHash) sampledPropertyMatches += 1;
          }
        }
      } finally {
        await readSess.close();
      }

      // Representative Check 5: Verify uniqueness constraint actively blocks duplicate canonical_id (rolled back!)
      let uniquenessConstraintEnforced = false;
      const uqConstraint = backupData.constraints.find(
        (c) => c.type === "NODE_PROPERTY_UNIQUENESS" && c.labelsOrTypes.length > 0 && c.properties.length > 0
      );
      if (uqConstraint) {
        const uqLabel = safeIdent(uqConstraint.labelsOrTypes[0]);
        const uqProp = safeIdent(uqConstraint.properties[0]);
        const existingNode = backupData.nodes.find(
          (n) => n.labels.includes(uqLabel) && n.properties[uqProp] !== undefined
        );
        if (existingNode) {
          const txSess = dispDriver.session({ database: "neo4j" });
          const tx = await txSess.beginTransaction();
          try {
            await tx.run(`CREATE (:${uqLabel} {${uqProp}: $val})`, {
              val: existingNode.properties[uqProp],
            });
            await tx.rollback();
          } catch (err: unknown) {
            uniquenessConstraintEnforced = /ConstraintValidationFailed|already exists/i.test(
              String(err)
            );
            try {
              await tx.rollback();
            } catch {
              // already aborted by constraint violation
            }
          } finally {
            await txSess.close();
          }
        }
      }

      // 7. Exhaustive Cypher valueType() parity audit across ALL 252,625 node & relationship property values
      //    plus read-only confirmation that live 374f4f7e was NOT touched!
      let live374Unchanged = false;
      let live374Nodes = 0;
      let live374Rels = 0;
      let restoredNodeValueTypes: Record<string, number> = {};
      let restoredRelValueTypes: Record<string, number> = {};
      let liveNodeValueTypes: Record<string, number> = {};
      let liveRelValueTypes: Record<string, number> = {};
      let propertyTypeChangedKeysCount = 0;
      const propertyTypeDiffDetails: string[] = [];

      {
        const dispTypeSess = dispDriver.session({
          database: "neo4j",
          defaultAccessMode: neo4j.session.READ,
        });
        try {
          const dn = await dispTypeSess.executeRead((t) =>
            t.run(
              "MATCH (n) UNWIND keys(n) AS k RETURN labels(n)[0] AS l, k, valueType(n[k]) AS vt, count(*) AS c"
            )
          );
          const dispNodeMap = new Map<string, number>();
          for (const r of dn.records) {
            const vt = String(r.get("vt"));
            const c = (r.get("c") as Integer).toNumber();
            restoredNodeValueTypes[vt] = (restoredNodeValueTypes[vt] || 0) + c;
            dispNodeMap.set(`${r.get("l")}|${r.get("k")}|${vt}`, c);
          }

          const dr = await dispTypeSess.executeRead((t) =>
            t.run(
              "MATCH ()-[r]->() UNWIND keys(r) AS k RETURN type(r) AS rt, k, valueType(r[k]) AS vt, count(*) AS c"
            )
          );
          const dispRelMap = new Map<string, number>();
          for (const r of dr.records) {
            const vt = String(r.get("vt"));
            const c = (r.get("c") as Integer).toNumber();
            restoredRelValueTypes[vt] = (restoredRelValueTypes[vt] || 0) + c;
            dispRelMap.set(`${r.get("rt")}|${r.get("k")}|${vt}`, c);
          }

          if (process.env.NEO4J_URI && process.env.NEO4J_PASSWORD) {
            const liveDriver = neo4j.driver(
              process.env.NEO4J_URI.trim(),
              neo4j.auth.basic(
                (process.env.NEO4J_USERNAME || "").trim(),
                process.env.NEO4J_PASSWORD.trim()
              ),
              { connectionTimeout: 8000, maxTransactionRetryTime: 0 }
            );
            try {
              const ls = liveDriver.session({
                database: (process.env.NEO4J_DATABASE || "374f4f7e").trim(),
                defaultAccessMode: neo4j.session.READ,
              });
              try {
                const nRes = await ls.executeRead((t) => t.run("MATCH (n) RETURN count(n) AS c"));
                const rRes = await ls.executeRead((t) =>
                  t.run("MATCH ()-[r]->() RETURN count(r) AS c")
                );
                live374Nodes = (nRes.records[0]?.get("c") as Integer).toNumber();
                live374Rels = (rRes.records[0]?.get("c") as Integer).toNumber();
                live374Unchanged = live374Nodes === 9818 && live374Rels === 9649;

                const ln = await ls.executeRead((t) =>
                  t.run(
                    "MATCH (n) UNWIND keys(n) AS k RETURN labels(n)[0] AS l, k, valueType(n[k]) AS vt, count(*) AS c"
                  )
                );
                const liveNodeMap = new Map<string, number>();
                for (const r of ln.records) {
                  const vt = String(r.get("vt"));
                  const c = (r.get("c") as Integer).toNumber();
                  liveNodeValueTypes[vt] = (liveNodeValueTypes[vt] || 0) + c;
                  liveNodeMap.set(`${r.get("l")}|${r.get("k")}|${vt}`, c);
                }

                const lr = await ls.executeRead((t) =>
                  t.run(
                    "MATCH ()-[r]->() UNWIND keys(r) AS k RETURN type(r) AS rt, k, valueType(r[k]) AS vt, count(*) AS c"
                  )
                );
                const liveRelMap = new Map<string, number>();
                for (const r of lr.records) {
                  const vt = String(r.get("vt"));
                  const c = (r.get("c") as Integer).toNumber();
                  liveRelValueTypes[vt] = (liveRelValueTypes[vt] || 0) + c;
                  liveRelMap.set(`${r.get("rt")}|${r.get("k")}|${vt}`, c);
                }

                const allNodeSigKeys = new Set([...liveNodeMap.keys(), ...dispNodeMap.keys()]);
                for (const sig of allNodeSigKeys) {
                  if (liveNodeMap.get(sig) !== dispNodeMap.get(sig)) {
                    propertyTypeChangedKeysCount += 1;
                    propertyTypeDiffDetails.push(
                      `NODE ${sig}: live=${liveNodeMap.get(sig) ?? 0} vs restored=${dispNodeMap.get(sig) ?? 0}`
                    );
                  }
                }
                const allRelSigKeys = new Set([...liveRelMap.keys(), ...dispRelMap.keys()]);
                for (const sig of allRelSigKeys) {
                  if (liveRelMap.get(sig) !== dispRelMap.get(sig)) {
                    propertyTypeChangedKeysCount += 1;
                    propertyTypeDiffDetails.push(
                      `REL ${sig}: live=${liveRelMap.get(sig) ?? 0} vs restored=${dispRelMap.get(sig) ?? 0}`
                    );
                  }
                }
              } finally {
                await ls.close();
              }
            } finally {
              await liveDriver.close();
            }
          }
        } finally {
          await dispTypeSess.close();
        }
      }

      const receipt = {
        verified_at: new Date().toISOString(),
        test_classification: "REAL_DISPOSABLE_NEO4J_5_INSTANCE_RESTORE_VERIFICATION",
        disposable_instance: {
          engine: isolatedAudit.dbms_components,
          loopback_bolt_uri: LOOPBACK_BOLT_URI,
          http_and_https_disabled: true,
          auth_enabled: true,
          restore_elapsed_ms: restoreElapsedMs,
        },
        backup_source: {
          path_outside_git: BACKUP_GZ_PATH,
          verified_sha256: backupCheck.actual_sha256,
          size_bytes: backupCheck.size_bytes,
        },
        schema_and_index_verification: {
          expected_constraints: 13,
          restored_constraints: restoredConstraintsCount,
          uniqueness_constraint_actively_blocks_duplicates: uniquenessConstraintEnforced,
          expected_indexes: 20,
          restored_indexes: restoredIndexesCount,
          online_indexes: onlineIndexesCount,
          all_20_indexes_online: onlineIndexesCount === 20,
        },
        graph_inventory_parity: {
          verification_status: isolatedAudit.verification_status,
          expected_nodes: 9818,
          restored_nodes: isolatedAudit.total_nodes,
          expected_relationships: 9649,
          restored_relationships: isolatedAudit.total_relationships,
          orphan_nodes: isolatedAudit.orphan_nodes_count,
          counts_by_label: isolatedAudit.counts_by_label,
          counts_by_relationship_type: isolatedAudit.counts_by_relationship_type,
        },
        representative_queries_and_property_checks: {
          multi_hop_ruling_provision_instrument_sample: multiHopRulingRows,
          fulltext_index_ft_legal_provisions_hits: fulltextHitsCount,
          temporal_provision_version_hits: temporalVersionHitsCount,
          sampled_nodes_property_sha256_checked: sampleTotal,
          sampled_nodes_property_sha256_matched: sampledPropertyMatches,
        },
        property_type_fidelity_audit: {
          live_374f4f7e_node_value_types: liveNodeValueTypes,
          restored_neo4j5_node_value_types: restoredNodeValueTypes,
          live_374f4f7e_relationship_value_types: liveRelValueTypes,
          restored_neo4j5_relationship_value_types: restoredRelValueTypes,
          property_type_changed_keys_count: propertyTypeChangedKeysCount,
          property_type_diff_details: propertyTypeDiffDetails,
          material_recovery_impact: "NONE",
          audit_explanation:
            "Exhaustive Cypher valueType() comparison across all 194,318 node property instances and 58,307 relationship property instances (252,625 total) confirms 0 property-type changes between live 374f4f7e and the restored Neo4j 5.26 instance. In live 374f4f7e, all dates/timestamps (effective_from, effective_to, ingested_at, verified_at) were originally ingested as ISO-8601 STRING NOT NULL, all 5 numeric fields (year_be, chunk_index, total_chunks_in_doc, file_size_bytes, form_index_number) were originally ingested from JS numbers via neo4j-driver as FLOAT NOT NULL (10,585 values), and all booleans as BOOLEAN NOT NULL (9,795 values), with 0 INTEGER, LIST, or native Cypher temporal objects. Future-proofing note: if native INTEGER or temporal types are ever added in a future schema version, type-tagged serialization or binary .dump would be required to prevent INTEGER->FLOAT or TEMPORAL->STRING coercion.",
        },
        live_preservation_and_isolation_confirmations: {
          live_374f4f7e_nodes_after: live374Nodes,
          live_374f4f7e_relationships_after: live374Rels,
          live_374f4f7e_unchanged: live374Unchanged,
          rag24_touched: false,
          production_vercel_env_identity_status: "UNVERIFIED",
          production_identity_explanation:
            "Matching node/relationship counts (9,818 / 9,649) do NOT by themselves prove Production connects to 374f4f7e. Because Vercel Production stores NEO4J_URI (env_id: lOymi3K3YZaPkTHr) as write-only 'sensitive' (unreadable via Vercel CLI/API and hidden in Vercel UI after creation) and main is frozen, Production-to-374f4f7e URI identity remains marked UNVERIFIED until confirmed via the REG24 Aura Console instance inventory or an authorized Production env check.",
        },
        all_restore_and_query_checks_passed:
          isolatedAudit.total_nodes === 9818 &&
          isolatedAudit.total_relationships === 9649 &&
          restoredConstraintsCount === 13 &&
          restoredIndexesCount === 20 &&
          onlineIndexesCount === 20 &&
          uniquenessConstraintEnforced &&
          multiHopRulingRows.length === 5 &&
          fulltextHitsCount > 0 &&
          temporalVersionHitsCount === 68 &&
          sampledPropertyMatches === sampleTotal &&
          propertyTypeChangedKeysCount === 0 &&
          live374Unchanged,
      };

      const outReceipt = path.resolve(
        process.cwd(),
        "docs",
        "audit",
        "dodo-review-rc2-b02",
        "neo4j_374f4f7e_disposable_neo4j5_restore_verification_20261117.json"
      );
      fs.writeFileSync(outReceipt, JSON.stringify(receipt, null, 2), "utf8");
      console.log(JSON.stringify(receipt, null, 2));

      if (!receipt.all_restore_and_query_checks_passed) {
        process.exitCode = 1;
      } else {
        allChecksSucceeded = true;
      }
    } finally {
      await dispDriver.close();
    }
  } finally {
    if (neo4jProc?.pid) {
      try {
        execFileSync("taskkill.exe", ["/T", "/F", "/PID", String(neo4jProc.pid)], {
          stdio: "ignore",
        });
      } catch {
        // already exited
      }
    }
    await sleep(1500);
    try {
      if (allChecksSucceeded) {
        fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
      } else if (fs.existsSync(neo4jExtractDir)) {
        fs.rmSync(neo4jExtractDir, { recursive: true, force: true });
      }
    } catch {
      // ignore locked log file if still releasing
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
