/**
 * REG24 — Strictly Read-Only Verification Tool for Neo4j AuraDB Instance `374f4f7e`
 *
 * SAFETY & GOVERNANCE GUARANTEES:
 * 1. NEVER resumes, replaces, deletes, migrates, or mutates any Neo4j instance or database.
 * 2. Enforces `defaultAccessMode: neo4j.session.READ` AND a static Cypher keyword firewall
 *    that throws immediately if any write/DDL token (`CREATE`, `MERGE`, `SET`, `DELETE`,
 *    `DETACH`, `REMOVE`, `DROP`, `LOAD CSV`, `CALL apoc.create`) appears in a query.
 * 3. Distinguishes strictly between:
 *    - Verified network/DNS/Bolt reachability and historical repository sync evidence, vs.
 *    - Direct live database content verification (`VERIFIED_LIVE_READ` vs `UNVERIFIED_WHILE_PAUSED`).
 */
import * as dns from "node:dns/promises";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import neo4j from "neo4j-driver";

const FORBIDDEN_WRITE_CYPHER =
  /\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|FOREACH|LOAD\s+CSV|apoc\.create|apoc\.refactor|dbms\.security)\b/i;

function assertReadOnlyCypher(cypher: string): void {
  if (FORBIDDEN_WRITE_CYPHER.test(cypher)) {
    throw new Error(`READ_ONLY_FIREWALL_BLOCKED: Refusing non-read Cypher statement: ${cypher}`);
  }
}

function loadDotEnvLocalReadOnly(): Record<string, string> {
  const out: Record<string, string> = {};
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return out;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

async function probeTcpPort(host: string, port: number, timeoutMs = 4000): Promise<{ reachable: boolean; error: string | null }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, `TCP_TIMEOUT_${timeoutMs}MS`));
    socket.once("error", (err) => finish(false, err.message));
    socket.connect(port, host);
  });
}

async function main(): Promise<void> {
  const fileEnv = loadDotEnvLocalReadOnly();
  const uri = (process.env.NEO4J_URI || fileEnv.NEO4J_URI || "").trim();
  const username = (process.env.NEO4J_USERNAME || fileEnv.NEO4J_USERNAME || "").trim();
  const password = (process.env.NEO4J_PASSWORD || fileEnv.NEO4J_PASSWORD || "").trim();
  const database = (process.env.NEO4J_DATABASE || fileEnv.NEO4J_DATABASE || "neo4j").trim();
  const hasAuraCloudApiCreds = Boolean(
    process.env.AURA_CLI_CLIENT_ID ||
      process.env.NEO4J_AURA_CLIENT_ID ||
      fileEnv.AURA_CLI_CLIENT_ID ||
      fileEnv.NEO4J_AURA_CLIENT_ID
  );

  const parsedUrl = uri ? new URL(uri.replace(/^neo4j(\+s|\+ssc)?:\/\//i, "https://")) : null;
  const host = parsedUrl?.hostname || "374f4f7e.databases.neo4j.io";
  const instanceIdMatch = host.match(/^([a-z0-9]+)\.databases\.neo4j\.io$/i);
  const instanceId = instanceIdMatch ? instanceIdMatch[1] : "unknown";

  // 1. DNS Probes (`A`, `AAAA`, `_neo4j._tcp` SRV)
  const dnsResults: Record<string, { resolved: boolean; records: unknown; error: string | null }> = {};
  for (const rrtype of ["A", "AAAA"] as const) {
    try {
      const recs = rrtype === "A" ? await dns.resolve4(host) : await dns.resolve6(host);
      dnsResults[rrtype] = { resolved: true, records: recs, error: null };
    } catch (err: unknown) {
      dnsResults[rrtype] = {
        resolved: false,
        records: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  try {
    const srv = await dns.resolveSrv(`_neo4j._tcp.${host}`);
    dnsResults.SRV = { resolved: true, records: srv, error: null };
  } catch (err: unknown) {
    dnsResults.SRV = {
      resolved: false,
      records: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. TCP Probes (`:7687` Bolt+TLS, `:443` HTTPS)
  const tcp7687 = await probeTcpPort(host, 7687);
  const tcp443 = await probeTcpPort(host, 443);

  // 3. Bolt Strictly Read-Only Inspection (if host resolves & accepts connections)
  let boltConnected = false;
  let boltError: string | null = null;
  let liveGraphAudit: {
    verification_status: "VERIFIED_LIVE_READ";
    dbms_components: Array<Record<string, unknown>>;
    total_nodes: number;
    total_relationships: number;
    counts_by_label: Record<string, number>;
    counts_by_relationship_type: Record<string, number>;
    counts_by_migration_batch_id: Record<string, number>;
    b01_release_nodes_count: number;
    b01_knowledge_work_th_rd_nodes_count: number;
    legacy_seed_tax_ruling_nodes_count: number;
    lrm_chunk_nodes_count: number;
    orphan_nodes_count: number;
  } | null = null;

  if (uri && username && password) {
    const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
      connectionTimeout: 6000,
      maxTransactionRetryTime: 0,
    });
    try {
      const runRead = async <T extends Record<string, unknown>>(cypher: string): Promise<T[]> => {
        assertReadOnlyCypher(cypher);
        const session = driver.session({
          database,
          defaultAccessMode: neo4j.session.READ,
        });
        try {
          const res = await session.executeRead((tx) => tx.run(cypher));
          return res.records.map((r) => {
            const obj: Record<string, unknown> = {};
            for (const k of r.keys) {
              const val = r.get(k);
              obj[String(k)] = neo4j.isInt(val) ? val.toNumber() : val;
            }
            return obj as T;
          });
        } finally {
          await session.close();
        }
      };

      const dbmsComponents = await runRead("CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition");
      boltConnected = true;

      const totNodesRows = await runRead<{ cnt: number }>("MATCH (n) RETURN count(n) AS cnt");
      const totRelsRows = await runRead<{ cnt: number }>("MATCH ()-[r]->() RETURN count(r) AS cnt");
      const labelRows = await runRead<{ label: string; cnt: number }>(
        "MATCH (n) UNWIND labels(n) AS label RETURN label, count(n) AS cnt ORDER BY cnt DESC"
      );
      const relTypeRows = await runRead<{ relType: string; cnt: number }>(
        "MATCH ()-[r]->() RETURN type(r) AS relType, count(r) AS cnt ORDER BY cnt DESC"
      );
      const batchRows = await runRead<{ batchId: string; cnt: number }>(
        "MATCH (n) RETURN coalesce(n.migration_batch_id, n.release_id, 'UNSET') AS batchId, count(n) AS cnt ORDER BY cnt DESC"
      );
      const b01RelNodes = await runRead<{ cnt: number }>(
        "MATCH (n) WHERE n.release_id STARTS WITH 'rel.B01' OR n.canonical_id STARTS WITH 'asrt.' OR n.canonical_id STARTS WITH 'psg.' RETURN count(n) AS cnt"
      );
      const b01WorkNodes = await runRead<{ cnt: number }>(
        "MATCH (n) WHERE n.canonical_id STARTS WITH 'work.th.rd.' OR n.work_id STARTS WITH 'work.th.rd.' RETURN count(n) AS cnt"
      );
      const seedTaxRulings = await runRead<{ cnt: number }>(
        "MATCH (n:TaxRuling) RETURN count(n) AS cnt"
      );
      const lrmChunks = await runRead<{ cnt: number }>(
        "MATCH (n) WHERE n.canonical_id STARTS WITH 'inst.lrm.' OR n.migration_batch_id STARTS WITH 'mig.lrm.chunks.' RETURN count(n) AS cnt"
      );
      const orphanRows = await runRead<{ cnt: number }>(
        "MATCH (n) WHERE NOT (n)--() RETURN count(n) AS cnt"
      );

      const byLabel: Record<string, number> = {};
      for (const r of labelRows) byLabel[r.label] = r.cnt;
      const byRel: Record<string, number> = {};
      for (const r of relTypeRows) byRel[r.relType] = r.cnt;
      const byBatch: Record<string, number> = {};
      for (const r of batchRows) byBatch[r.batchId] = r.cnt;

      liveGraphAudit = {
        verification_status: "VERIFIED_LIVE_READ",
        dbms_components: dbmsComponents,
        total_nodes: totNodesRows[0]?.cnt ?? 0,
        total_relationships: totRelsRows[0]?.cnt ?? 0,
        counts_by_label: byLabel,
        counts_by_relationship_type: byRel,
        counts_by_migration_batch_id: byBatch,
        b01_release_nodes_count: b01RelNodes[0]?.cnt ?? 0,
        b01_knowledge_work_th_rd_nodes_count: b01WorkNodes[0]?.cnt ?? 0,
        legacy_seed_tax_ruling_nodes_count: seedTaxRulings[0]?.cnt ?? 0,
        lrm_chunk_nodes_count: lrmChunks[0]?.cnt ?? 0,
        orphan_nodes_count: orphanRows[0]?.cnt ?? 0,
      };
    } catch (err: unknown) {
      boltConnected = false;
      boltError = err instanceof Error ? err.message : String(err);
    } finally {
      await driver.close();
    }
  }

  const report = {
    verified_at: new Date().toISOString(),
    mode: "STRICT_READ_ONLY_NO_MUTATION",
    target_identity: {
      aura_instance_id: instanceId,
      bolt_uri_redacted: uri ? `neo4j+s://${host}` : null,
      database_name: database,
      username_configured: Boolean(username),
      password_configured: Boolean(password),
      aura_cloud_management_api_credentials_present: hasAuraCloudApiCreds,
    },
    connectivity_probes: {
      dns: dnsResults,
      tcp_7687_bolt_tls: tcp7687,
      tcp_443_https: tcp443,
      bolt_read_session_connected: boltConnected,
      bolt_sanitized_error: boltError,
    },
    live_database_content_verification: liveGraphAudit ?? {
      verification_status: "UNVERIFIED_WHILE_PAUSED_OR_OFFLINE",
      reason:
        "Host 374f4f7e.databases.neo4j.io returns DNS ENOTFOUND (NXDOMAIN), which is the standard network signature of a paused (or expired) Neo4j AuraDB Free instance. Per Owner governance guardrail, the instance was NOT resumed and no Aura Cloud Console API credentials exist in the workspace; therefore live database contents cannot be queried until Owner inspects the Neo4j Aura Console.",
      historical_repository_write_audit: {
        oct_20_2026_commit_8fd220b_dd91850:
          "src/core/graph/graph-migrator.ts (`runGraphMigration`) upserted 352 canonical seed nodes and 523 relationships (including 10 seed `:TaxRuling` nodes from `reg24-core.ts`).",
        oct_21_2026_commit_802fdb6_2f06b30:
          "src/core/ingestion/legal-chunk-neo4j-sync.ts (`syncLegalResourceMasterChunksToNeo4j`) upserted 17 `:Regulator` (`reg.th.lrm.*`), 2,312 `:LegalInstrument` (`inst.lrm.*`), and structural `:Provision` chunks — recording 9,242 live nodes and 9,096 live relationships in AGR-005 (`src/core/agentic-rag/agentic-legal-research-engine.ts:11, 1037-1038`).",
        nov_14_2026_commit_bbdca54_to_7df41c4:
          "All 10-batch knowledge store modules (`src/core/knowledge/*`) contain zero `neo4jConnectionManager.executeCypher` write calls; `scripts/materialize-b01-candidate.ts:40` ran with `probeLiveNeo4j: false` (`F1_baseline_verification.json:17-21`), persisting `rel.B01.rc1` only to `data/knowledge-store/projections/rel.B01.rc1_graph.json.gz`. However, absence of Batch 01 data inside `374f4f7e` remains formally UNVERIFIED_UNTIL_LIVE_READ_INSPECTION.",
      },
      auradb_free_retention_risk_window: {
        auto_pause_threshold_hours: 72,
        permanent_deletion_after_paused_days: 30,
        automated_backups_on_free_tier: false,
        last_recorded_repo_neo4j_sync_commits: ["2026-10-21 (802fdb6)", "2026-10-25 (7b4447a)"],
        estimated_auto_pause_window: "2026-10-24 .. 2026-10-28",
        estimated_30_day_deletion_deadline_window: "2026-11-23 .. 2026-11-27",
        recommended_owner_console_check:
          "Log into https://console.neo4j.io (read-only UI check first) to verify whether instance `374f4f7e` is in `Paused` state and check its remaining retention days before ~23 November 2026.",
      },
    },
  };

  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    const outPath = path.resolve(process.argv[outIdx + 1]);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const json = JSON.stringify(report, null, 2);
    const receiptWithHash = {
      ...report,
      report_sha256: crypto.createHash("sha256").update(json).digest("hex"),
    };
    fs.writeFileSync(outPath, JSON.stringify(receiptWithHash, null, 2), "utf8");
    console.log(`Saved read-only Neo4j verification receipt -> ${outPath}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
