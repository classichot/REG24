/**
 * REG24 — Official Neo4j AuraDB Driver & Connection Lifecycle Manager
 * Requirement ID: REG24-INFRA-NEO4J-001 (REG-NEO-001, REG-NEO-002, REG-NEO-003, REG-NEO-016, REG-NEO-020)
 *
 * Server-side only. Never import in client components or expose credentials.
 */

import neo4j, { Driver, Session, Record as Neo4jRecord } from "neo4j-driver";
import { NEO4J_SCHEMA_VERSION } from "./graph-schema";

export interface Neo4jEnvironmentConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
  environment: "production" | "staging" | "development" | "test";
  configured: boolean;
}

export interface Neo4jObservabilityMetrics {
  connection_attempts: number;
  connection_failures: number;
  total_queries_executed: number;
  failed_cypher_statements: number;
  blocked_cypher_injections: number;
  degraded_mode_incidents: number;
  last_successful_query_at: string | null;
  last_error_at: string | null;
  last_sanitized_error: string | null;
  recent_latencies_ms: number[];
  p50_latency_ms: number;
  p95_latency_ms: number;
}

export interface Neo4jHealthReport {
  connected: boolean;
  availability: "healthy" | "degraded_unconfigured" | "unreachable";
  database_engine: string;
  environment: string;
  database_name: string;
  schema_version: string;
  last_successful_query_at: string | null;
  graph_data_readiness: "ready_persisted" | "empty_needs_migration" | "degraded_seed_only";
  live_node_count: number | null;
  live_relationship_count: number | null;
  latency_ms: number | null;
  sanitized_error: string | null;
  checked_at: string;
}

/**
 * Sanitizes error strings so database credentials, internal IPs, or connection URIs
 * are never leaked in health responses or logs (REG-NEO-003, REG-NEO-016).
 */
export function sanitizeGraphError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/neo4j(\+s|\+ssc)?:\/\/[^\s"']+/gi, "neo4j+s://[REDACTED_HOST]")
    .replace(/bolt(\+s|\+ssc)?:\/\/[^\s"']+/gi, "bolt+s://[REDACTED_HOST]")
    .replace(/password\s*[=:]\s*[^\s,;]+/gi, "password=[REDACTED]");
}

/**
 * Guards against unrestricted arbitrary Cypher execution or prompt/document injection
 * attempting multi-statement execution or administrative schema drops (REG-NEO-016).
 */
export function assertSafeParameterizedCypher(
  cypher: string,
  params: Record<string, unknown>,
  allowSchemaDdl = false
): void {
  const trimmed = cypher.trim();
  // Reject multi-statement semicolon chaining
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("SECURITY_VIOLATION_CYPHER_MULTI_STATEMENT: Semicolon-chained Cypher statements are forbidden.");
  }

  // Reject destructive administrative commands unless explicitly running schema DDL
  const destructivePattern = /\b(DROP\s+DATABASE|STOP\s+DATABASE|CREATE\s+USER|ALTER\s+USER|SHOW\s+USERS|GRANT\s+|DENY\s+|REVOKE\s+|LOAD\s+CSV|APOC\.Periodic\.commit)\b/i;
  if (destructivePattern.test(trimmed)) {
    throw new Error("SECURITY_VIOLATION_CYPHER_ADMIN: Unauthorized administrative Cypher command blocked.");
  }

  if (!allowSchemaDdl && /\b(DROP\s+CONSTRAINT|DROP\s+INDEX|DETACH\s+DELETE\s+\(n\))\b/i.test(trimmed)) {
    throw new Error("SECURITY_VIOLATION_CYPHER_DDL: Schema or full-graph deletion blocked outside controlled migration.");
  }

  // Validate parameter values do not exceed safe bounds
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === "string" && val.length > 50_000) {
      throw new Error(`SECURITY_VIOLATION_PARAM_OVERFLOW: Parameter '${key}' exceeds maximum safe length.`);
    }
  }
}

class Neo4jConnectionManager {
  private driver: Driver | null = null;
  private activeConfigHash: string | null = null;
  private metrics: Neo4jObservabilityMetrics = {
    connection_attempts: 0,
    connection_failures: 0,
    total_queries_executed: 0,
    failed_cypher_statements: 0,
    blocked_cypher_injections: 0,
    degraded_mode_incidents: 0,
    last_successful_query_at: null,
    last_error_at: null,
    last_sanitized_error: null,
    recent_latencies_ms: [],
    p50_latency_ms: 0,
    p95_latency_ms: 0,
  };

  /**
   * Reads environment variables dynamically to support secret rotation without code changes (REG-NEO-002).
   */
  public getEnvConfig(): Neo4jEnvironmentConfig {
    const uri = (process.env.NEO4J_URI || "").trim();
    const username = (process.env.NEO4J_USERNAME || "").trim();
    const password = (process.env.NEO4J_PASSWORD || "").trim();
    const database = (process.env.NEO4J_DATABASE || "neo4j").trim();
    const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
    const reg24Env = (process.env.REG24_ENV || nodeEnv).toLowerCase();

    const environment: Neo4jEnvironmentConfig["environment"] =
      reg24Env === "production"
        ? "production"
        : reg24Env === "staging"
          ? "staging"
          : reg24Env === "test"
            ? "test"
            : "development";

    const configured = Boolean(uri && username && password);
    return { uri, username, password, database, environment, configured };
  }

  /**
   * Initializes or rotates the pooled Neo4j Driver instance (REG-NEO-002).
   */
  public getOrCreateDriver(): Driver | null {
    const cfg = this.getEnvConfig();
    if (!cfg.configured) {
      return null;
    }

    const configHash = `${cfg.uri}|${cfg.username}|${cfg.password.length}|${cfg.database}`;
    if (this.driver && this.activeConfigHash === configHash) {
      return this.driver;
    }

    // Close previous driver if credentials rotated
    if (this.driver) {
      this.driver.close().catch(() => undefined);
      this.driver = null;
    }

    this.metrics.connection_attempts += 1;
    try {
      this.driver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.username, cfg.password), {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 8_000,
        connectionTimeout: 6_000,
        maxTransactionRetryTime: 12_000,
        disableLosslessIntegers: true,
      });
      this.activeConfigHash = configHash;
      return this.driver;
    } catch (err) {
      this.recordError(err, true);
      return null;
    }
  }

  private recordLatency(ms: number): void {
    this.metrics.recent_latencies_ms.push(ms);
    if (this.metrics.recent_latencies_ms.length > 200) {
      this.metrics.recent_latencies_ms.shift();
    }
    const sorted = [...this.metrics.recent_latencies_ms].sort((a, b) => a - b);
    const p50Idx = Math.floor(sorted.length * 0.5);
    const p95Idx = Math.floor(sorted.length * 0.95);
    this.metrics.p50_latency_ms = sorted[p50Idx] ?? ms;
    this.metrics.p95_latency_ms = sorted[p95Idx] ?? ms;
  }

  public recordError(err: unknown, isConnectionFailure = false): void {
    const sanitized = sanitizeGraphError(err);
    if (isConnectionFailure) {
      this.metrics.connection_failures += 1;
    } else {
      this.metrics.failed_cypher_statements += 1;
    }
    if (sanitized.includes("SECURITY_VIOLATION_")) {
      this.metrics.blocked_cypher_injections += 1;
    }
    this.metrics.last_error_at = new Date().toISOString();
    this.metrics.last_sanitized_error = sanitized;
  }

  public recordDegradedIncident(reason: string): void {
    this.metrics.degraded_mode_incidents += 1;
    this.metrics.last_error_at = new Date().toISOString();
    this.metrics.last_sanitized_error = sanitizeGraphError(reason);
  }

  public getObservabilityMetrics(): Neo4jObservabilityMetrics {
    return {
      ...this.metrics,
      recent_latencies_ms: [...this.metrics.recent_latencies_ms],
    };
  }

  /**
   * Executes a parameterized Cypher query with session lifecycle management and timeout control.
   */
  public async executeCypher<T = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
    options: { write?: boolean; timeoutMs?: number; allowSchemaDdl?: boolean } = {}
  ): Promise<{ records: Neo4jRecord[]; rows: T[]; latencyMs: number }> {
    try {
      assertSafeParameterizedCypher(cypher, params, options.allowSchemaDdl);
    } catch (secErr) {
      this.recordError(secErr, false);
      throw secErr;
    }

    const cfg = this.getEnvConfig();
    const driver = this.getOrCreateDriver();
    if (!driver) {
      const unconfiguredErr = new Error(
        "NEO4J_UNCONFIGURED: NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD environment variables are not set."
      );
      this.recordError(unconfiguredErr, true);
      throw unconfiguredErr;
    }

    const session: Session = driver.session({
      database: cfg.database,
      defaultAccessMode: options.write ? neo4j.session.WRITE : neo4j.session.READ,
    });

    const started = Date.now();
    try {
      const result = await session.run(cypher, params, {
        timeout: options.timeoutMs ?? 8_000,
      });
      const latencyMs = Date.now() - started;
      this.metrics.total_queries_executed += 1;
      this.metrics.last_successful_query_at = new Date().toISOString();
      this.recordLatency(latencyMs);

      const rows: T[] = result.records.map((rec) => rec.toObject() as T);
      return { records: result.records, rows, latencyMs };
    } catch (err) {
      this.recordError(err, false);
      throw err;
    } finally {
      await session.close();
    }
  }

  /**
   * Performs a genuine live health and readiness check against Neo4j AuraDB (REG-NEO-003, REG-NEO-014).
   * Never fabricates a green connection status if Neo4j is unconfigured or unreachable.
   */
  public async checkHealth(): Promise<Neo4jHealthReport> {
    const cfg = this.getEnvConfig();
    const checkedAt = new Date().toISOString();

    if (!cfg.configured) {
      return {
        connected: false,
        availability: "degraded_unconfigured",
        database_engine: "Neo4j AuraDB (Credentials Not Configured)",
        environment: cfg.environment,
        database_name: cfg.database,
        schema_version: NEO4J_SCHEMA_VERSION,
        last_successful_query_at: this.metrics.last_successful_query_at,
        graph_data_readiness: "degraded_seed_only",
        live_node_count: null,
        live_relationship_count: null,
        latency_ms: null,
        sanitized_error:
          "NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD are not set in environment variables. Operating in explicit read-only seed mode.",
        checked_at: checkedAt,
      };
    }

    try {
      const { rows, latencyMs } = await this.executeCypher<{
        nodeCount: number;
        relCount: number;
      }>(
        `MATCH (n)
         WITH count(n) AS nodeCount
         OPTIONAL MATCH ()-[r]->()
         RETURN nodeCount, count(r) AS relCount`,
        {},
        { timeoutMs: 5_000 }
      );

      const nodeCount = Number(rows[0]?.nodeCount ?? 0);
      const relCount = Number(rows[0]?.relCount ?? 0);

      return {
        connected: true,
        availability: "healthy",
        database_engine: "Neo4j AuraDB",
        environment: cfg.environment,
        database_name: cfg.database,
        schema_version: NEO4J_SCHEMA_VERSION,
        last_successful_query_at: this.metrics.last_successful_query_at,
        graph_data_readiness: nodeCount > 0 ? "ready_persisted" : "empty_needs_migration",
        live_node_count: nodeCount,
        live_relationship_count: relCount,
        latency_ms: latencyMs,
        sanitized_error: null,
        checked_at: checkedAt,
      };
    } catch (err) {
      const sanitized = sanitizeGraphError(err);
      return {
        connected: false,
        availability: "unreachable",
        database_engine: "Neo4j AuraDB",
        environment: cfg.environment,
        database_name: cfg.database,
        schema_version: NEO4J_SCHEMA_VERSION,
        last_successful_query_at: this.metrics.last_successful_query_at,
        graph_data_readiness: "degraded_seed_only",
        live_node_count: null,
        live_relationship_count: null,
        latency_ms: null,
        sanitized_error: sanitized,
        checked_at: checkedAt,
      };
    }
  }
}

export const neo4jConnectionManager = new Neo4jConnectionManager();
