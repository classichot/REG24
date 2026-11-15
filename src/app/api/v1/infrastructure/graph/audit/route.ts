import { NextRequest, NextResponse } from "next/server";
import {
  analyzeCrossModuleCorporateScenario,
  getGraphExpansionPrdSnapshot,
  verifyLiveProductionGraphAudit,
} from "@/core/graph/graph-expansion-prd";
import { isNeo4jPreservationWriteLockActive } from "@/core/graph/neo4j-client";
import { runMigrationAndReconciliation } from "@/core/graph/graph-migrator";

/**
 * REG24 — Legal Knowledge Graph Infrastructure Expansion & Live Audit API
 * Implements DEV-001 through DEV-028
 * GET & POST /api/v1/infrastructure/graph/audit
 */
export async function GET() {
  const snapshot = await getGraphExpansionPrdSnapshot();
  return NextResponse.json(snapshot);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "verify_live_audit";
    const actorRole =
      req.headers.get("x-reg24-role") || body.role || "Platform Administrator";

    if (action === "verify_live_audit") {
      const audit = await verifyLiveProductionGraphAudit();
      return NextResponse.json({
        status: "ok",
        action,
        audit,
      });
    }

    if (action === "sync_and_audit_neo4j") {
      const explicitRoleHeader = req.headers.get("x-reg24-role") || "";
      if (explicitRoleHeader !== "Platform Administrator") {
        return NextResponse.json(
          {
            status: "forbidden",
            message:
              "Explicit x-reg24-role: Platform Administrator header is required to run live Neo4j sync.",
          },
          { status: 403 }
        );
      }
      if (isNeo4jPreservationWriteLockActive()) {
        return NextResponse.json(
          {
            status: "locked",
            code: "NEO4J_PRESERVATION_LOCKOUT_423",
            message:
              "Neo4j write sync is blocked while NEO4J_PRESERVATION_READ_ONLY lock is active.",
          },
          { status: 423 }
        );
      }
      const migration = await runMigrationAndReconciliation({
        executeLiveMigration: true,
      });
      const snapshot = await getGraphExpansionPrdSnapshot();
      return NextResponse.json({
        status: "ok",
        action,
        migration,
        snapshot,
      });
    }

    if (action === "analyze_cross_module") {
      const analysis = analyzeCrossModuleCorporateScenario(body.scenario_query);
      return NextResponse.json({
        status: "ok",
        action,
        analysis,
      });
    }

    return NextResponse.json(
      { status: "error", message: `Unsupported action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", message }, { status: 400 });
  }
}
