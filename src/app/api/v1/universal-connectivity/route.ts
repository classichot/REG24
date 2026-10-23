/**
 * REG24 — Universal AI Connectivity REST & Bridge Facade (Section 5.4, 8, 9, 10, 11, 12, 13, 15)
 *
 * Implements the REST facade over the shared UniversalAIConnectivityService:
 * - GET ?action=dashboard (Full Connect Your AI snapshot: 7 named providers + extension path, 11 tools, connections, usage, benchmark)
 * - GET ?action=health_live (/health/live)
 * - GET ?action=health_ready (/health/ready)
 * - GET ?action=tools (/v1/tools)
 * - GET ?action=provider_capabilities&provider=grok (/v1/provider-capabilities)
 * - GET ?action=connections (/v1/connections)
 * - GET ?action=certification (Run all 36 acceptance tests AT01..AT36)
 * - POST (Execute canonical tools, test connection health, revoke connection, parallel bridge calls, failover check)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  universalAIConnectivityEngine,
  UNIVERSAL_PROVIDER_PROFILES,
  CANONICAL_11_TOOLS_CATALOG,
  type CanonicalToolName,
  type UniversalProviderId,
} from "@/core/mcp/universal-ai-connectivity-engine";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "dashboard";
  const snapshot = universalAIConnectivityEngine.getConnectivitySnapshot();

  if (action === "health_live") {
    return NextResponse.json({
      status: "ok",
      probe: "liveness",
      service: "reg24-universal-ai-connectivity",
      timestamp: new Date().toISOString(),
    });
  }

  if (action === "health_ready") {
    return NextResponse.json({
      status: "ready",
      probe: "readiness",
      providers_certified: UNIVERSAL_PROVIDER_PROFILES.filter((p) => p.status === "certified").length,
      canonical_tools_count: CANONICAL_11_TOOLS_CATALOG.length,
      timestamp: new Date().toISOString(),
    });
  }

  if (action === "tools") {
    return NextResponse.json({
      specification: "REG24 Universal AI Connectivity v1.0",
      total_tools: CANONICAL_11_TOOLS_CATALOG.length,
      tools: CANONICAL_11_TOOLS_CATALOG,
    });
  }

  if (action === "provider_capabilities") {
    const provider = (req.nextUrl.searchParams.get("provider") || "claude") as UniversalProviderId;
    return NextResponse.json({
      provider,
      profile: UNIVERSAL_PROVIDER_PROFILES.find((p) => p.provider_id === provider) || null,
      projected_tools: universalAIConnectivityEngine.projectToolsForProvider(provider),
    });
  }

  if (action === "connections") {
    const tenantId = req.nextUrl.searchParams.get("tenant_id") || undefined;
    return NextResponse.json({
      connections: tenantId
        ? snapshot.connections.filter((c) => c.tenant_id === tenantId)
        : snapshot.connections,
    });
  }

  if (action === "certification") {
    return NextResponse.json(universalAIConnectivityEngine.runAll36AcceptanceTests());
  }

  // Default: full dashboard snapshot for Connect your AI UI
  return NextResponse.json({
    status: "ok",
    specification: "REG24 Universal AI Connectivity v1.0 (24 October 2026)",
    dashboard: snapshot,
    certification: universalAIConnectivityEngine.runAll36AcceptanceTests(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "execute_tool");

    if (action === "execute_tool") {
      const connectionId = String(
        body.connection_id ||
          req.headers.get("x-reg24-connection-id") ||
          "uconn.claude.law24.01"
      );
      const toolName = String(body.tool_name || "search") as CanonicalToolName;
      const args = (body.arguments || body.input || {}) as Record<string, unknown>;
      const idempotencyKey =
        body.idempotency_key ||
        req.headers.get("idempotency-key") ||
        (args.request_key as string | undefined);

      const envelope = universalAIConnectivityEngine.executeCanonicalTool({
        connection_id: connectionId,
        tool_name: toolName,
        arguments: args,
        protocol_profile: body.protocol_profile,
        idempotency_key: idempotencyKey ? String(idempotencyKey) : undefined,
        max_response_bytes:
          typeof body.max_response_bytes === "number" ? body.max_response_bytes : undefined,
      });

      const httpStatus =
        envelope.status === "failed"
          ? envelope.error?.code === "authentication_required" ||
            envelope.error?.code === "token_expired"
            ? 401
            : envelope.error?.code === "permission_denied"
              ? 403
              : envelope.error?.code === "resource_not_found"
                ? 404
                : envelope.error?.code === "idempotency_conflict"
                  ? 409
                  : envelope.error?.code === "rate_limit_exceeded"
                    ? 429
                    : 400
          : 200;

      return NextResponse.json(envelope, { status: httpStatus });
    }

    if (action === "test_connection") {
      const connectionId = String(body.connection_id || "uconn.claude.law24.01");
      return NextResponse.json(
        universalAIConnectivityEngine.runConnectionHealthTest(connectionId)
      );
    }

    if (action === "revoke_connection") {
      const connectionId = String(body.connection_id || "");
      const revoked = universalAIConnectivityEngine.revokeConnection(connectionId);
      return NextResponse.json({
        status: "ok",
        connection: revoked,
      });
    }

    if (action === "parallel_bridge") {
      const connectionId = String(body.connection_id || "uconn.deepseek.bridge.03");
      const calls = Array.isArray(body.calls) ? body.calls : [];
      return NextResponse.json({
        status: "ok",
        results: universalAIConnectivityEngine.executeParallelBridgeCalls({
          connection_id: connectionId,
          calls,
        }),
      });
    }

    if (action === "resolve_failover") {
      const connectionId = String(body.connection_id || "uconn.claude.law24.01");
      return NextResponse.json(
        universalAIConnectivityEngine.resolveModelFailover({
          connection_id: connectionId,
          primary_provider_unavailable: Boolean(body.primary_provider_unavailable ?? true),
        })
      );
    }

    if (action === "run_certification") {
      return NextResponse.json(universalAIConnectivityEngine.runAll36AcceptanceTests());
    }

    return NextResponse.json(
      {
        status: "error",
        message: `Unsupported action '${action}'`,
      },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Invalid request payload",
      },
      { status: 400 }
    );
  }
}
