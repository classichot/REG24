import { NextRequest, NextResponse } from "next/server";
import { neo4jConnectionManager } from "@/core/graph/neo4j-client";
import {
  rollbackMigrationBatch,
  runMigrationAndReconciliation,
} from "@/core/graph/graph-migrator";
import { NEO4J_SCHEMA_VERSION } from "@/core/graph/graph-schema";

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
    checked_at: health.checked_at,
  };

  if (!detailedRequested || !isAdmin) {
    return NextResponse.json(publicResponse, {
      status: 200,
    });
  }

  // Detailed administrator diagnostic report
  const reconciliation = await runMigrationAndReconciliation({
    executeLiveMigration: false,
  });
  const observability = neo4jConnectionManager.getObservabilityMetrics();

  return NextResponse.json({
    ...publicResponse,
    admin_diagnostics: {
      authorized_role: "Platform Administrator",
      reconciliation_report: reconciliation,
      observability_metrics: observability,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const roleHeader =
      req.headers.get("x-reg24-role") || body.role || "Platform Administrator";

    if (roleHeader !== "Platform Administrator") {
      return NextResponse.json(
        {
          status: "forbidden",
          message: "Only Platform Administrator can run graph diagnostics or migrations.",
        },
        { status: 403 }
      );
    }

    const action = body.action || "run_diagnostics";

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
