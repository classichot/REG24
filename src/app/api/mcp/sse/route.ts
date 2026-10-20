/**
 * REG24 — Legacy SSE Compatibility MCP Endpoint (/api/mcp/sse)
 * PRD: REG24-UNIVERSAL-MCP-001 (Section 1 & Section 2A)
 *
 * Provides Server-Sent Events (SSE) compatibility for:
 * - Alibaba Cloud Qwen Model Studio Responses API (which specifies SSE for remote MCP)
 * - Older MCP clients requiring SSE endpoint discovery (`event: endpoint` + JSON-RPC 2.0 messages)
 */

import { NextRequest, NextResponse } from "next/server";
import { universalMcpGateway, UNIVERSAL_MCP_10_TOOLS_CATALOG } from "@/core/mcp/universal-mcp-gateway";

export async function GET(req: NextRequest) {
  const accept = req.headers.get("accept") || "";
  const format = req.nextUrl.searchParams.get("format");

  // If requested by browser or JSON inspector without text/event-stream, return structured SSE gateway descriptor
  if (format === "json" || !accept.includes("text/event-stream")) {
    return NextResponse.json({
      protocol: "Model Context Protocol (MCP) — Legacy SSE Compatibility Transport",
      prd_id: "REG24-UNIVERSAL-MCP-001",
      specification_version: "2026-07-28 (SSE Backward-Compatible)",
      target_providers: ["Alibaba Qwen (Model Studio Responses API)", "Legacy MCP SSE Clients"],
      live_sse_endpoint: "https://reg24-theta.vercel.app/api/mcp/sse",
      proposed_custom_domain_sse: "https://mcp.reg24.ai/sse",
      message_post_endpoint: "https://reg24-theta.vercel.app/api/mcp",
      universal_tools_count: UNIVERSAL_MCP_10_TOOLS_CATALOG.length,
      tools: UNIVERSAL_MCP_10_TOOLS_CATALOG,
      snapshot: universalMcpGateway.getGatewaySnapshot(),
    });
  }

  // Stream standard MCP SSE handshake events (`endpoint` + `ready`)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: /api/mcp\n\n`)
      );
      controller.enqueue(
        encoder.encode(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {
              server: "reg24-universal-mcp-sse",
              protocolVersion: "2026-07-28",
              toolsCount: UNIVERSAL_MCP_10_TOOLS_CATALOG.length,
            },
          })}\n\n`
        )
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
