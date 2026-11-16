import { NextRequest, NextResponse } from "next/server";
import {
  isNeo4jPreservationWriteLockActive,
  neo4jConnectionManager,
} from "@/core/graph/neo4j-client";
import {
  rollbackMigrationBatch,
  runMigrationAndReconciliation,
} from "@/core/graph/graph-migrator";
import { NEO4J_SCHEMA_VERSION } from "@/core/graph/graph-schema";
import { getDefaultKnowledgeStore } from "@/core/knowledge/store";

/**
 * REG-NEO-003 — Graph Database Connection Health & Diagnostics API
 * GET /api/v1/infrastructure/graph/health
 *
 * Public responses strictly exclude credentials, internal URIs, or sensitive configuration.
 * Authenticated administrators (?detailed=true with x-reg24-role: Platform Administrator)
 * receive migration reconciliation and observability diagnostics.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const detailedRequested = searchParams.get("detailed") === "true";
  const roleHeader = req.headers.get("x-reg24-role") || searchParams.get("role") || "";
  const isAdmin = roleHeader === "Platform Administrator";

  const health = await neo4jConnectionManager.checkHealth();
  const knStore = getDefaultKnowledgeStore();
  const knTopo = knStore.getStorageTopology();

  // Public sanitized health payload (REG-NEO-003)
  const publicResponse = {
    requirement_id: "REG24-INFRA-NEO4J-001",
    connected: health.connected,
    availability: health.availability,
    database_engine: health.database_engine,
    environment: health.environment,
    schema_version: NEO4J_SCHEMA_VERSION,
    last_successful_query_at: health.last_successful_query_at,
    graph_data_readiness: health.graph_data_readiness,
    live_node_count: health.live_node_count,
    live_relationship_count: health.live_relationship_count,
    latency_ms: health.latency_ms,
    sanitized_error: health.sanitized_error,
    canonical_store_topology: {
      topology_mode: knTopo.topology_mode,
      cross_process_locking: knTopo.cross_process_locking,
      durable_across_cold_starts: knTopo.durable_across_cold_starts,
      durable_across_horizontal_instances: knTopo.durable_across_horizontal_instances,
      warning: knTopo.warning,
    },
    checked_at: health.checked_at,
  };

  if (!detailedRequested || !isAdmin) {
    return NextResponse.json(publicResponse, {
      status: 200,
    });
  }

  // Detailed administrator diagnostic report (never exposes credentials or raw URI)
  const reconciliation = await runMigrationAndReconciliation({
    executeLiveMigration: false,
  });
  const observability = neo4jConnectionManager.getObservabilityMetrics();
  const envCfg = neo4jConnectionManager.getEnvConfig();
  const hostMatch = envCfg.uri.match(/^[a-z0-9+.-]+:\/\/([^:/?#]+)/i);
  const rawHost = hostMatch ? hostMatch[1].toLowerCase() : null;
  const auraIdMatch = rawHost ? rawHost.match(/^([a-z0-9-]+)\.databases\.neo4j\.io$/i) : null;
  const auraId = auraIdMatch ? auraIdMatch[1].toLowerCase() : null;
  const candidateInstanceId = (searchParams.get("candidate_instance_id") || "").trim().toLowerCase();
  const maskShortId = (v: string | null) =>
    !v ? null : v.length <= 4 ? `${v[0]}***` : `${v.slice(0, 3)}***${v.slice(-2)}`;

  return NextResponse.json({
    ...publicResponse,
    admin_diagnostics: {
      authorized_role: "Platform Administrator",
      target_identity_verification: {
        configured: envCfg.configured,
        is_aura_cloud_host: Boolean(auraId),
        aura_instance_id_masked: maskShortId(auraId),
        database_name_masked: maskShortId(envCfg.database),
        matches_candidate_instance_id: candidateInstanceId
          ? auraId === candidateInstanceId
          : null,
      },
      reconciliation_report: reconciliation,
      observability_metrics: observability,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "run_diagnostics";
    const isMutatingAction = action === "rollback_batch" || action === "run_migration";
    const explicitRoleHeader = req.headers.get("x-reg24-role");
    const roleHeader = isMutatingAction
      ? explicitRoleHeader || ""
      : explicitRoleHeader || body.role || "Platform Administrator";

    if (roleHeader !== "Platform Administrator") {
      return NextResponse.json(
        {
          status: "forbidden",
          message:
            "Explicit x-reg24-role: Platform Administrator header is required to run graph diagnostics or live migrations.",
        },
        { status: 403 }
      );
    }

    if (isMutatingAction && isNeo4jPreservationWriteLockActive()) {
      return NextResponse.json(
        {
          status: "locked",
          code: "NEO4J_PRESERVATION_LOCKOUT_423",
          message:
            "Neo4j write/rollback mutations are blocked while NEO4J_PRESERVATION_READ_ONLY lock is active.",
        },
        { status: 423 }
      );
    }

    if (action === "rollback_batch" && body.batch_id) {
      const rollbackResult = await rollbackMigrationBatch(String(body.batch_id));
      return NextResponse.json({
        status: "ok",
        action: "rollback_batch",
        rollback: rollbackResult,
      });
    }

    const executeLive = action === "run_migration";
    const health = await neo4jConnectionManager.checkHealth();
    const reconciliation = await runMigrationAndReconciliation({
      executeLiveMigration: executeLive,
    });
    const observability = neo4jConnectionManager.getObservabilityMetrics();

    return NextResponse.json({
      status: "ok",
      action,
      health: {
        connected: health.connected,
        availability: health.availability,
        database_engine: health.database_engine,
        environment: health.environment,
        schema_version: health.schema_version,
        last_successful_query_at: health.last_successful_query_at,
        graph_data_readiness: health.graph_data_readiness,
        live_node_count: health.live_node_count,
        live_relationship_count: health.live_relationship_count,
        sanitized_error: health.sanitized_error,
      },
      reconciliation_report: reconciliation,
      observability_metrics: observability,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
}
