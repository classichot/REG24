/**
 * REG24 — Agent-to-Agent (A2A) Protocol v1.0 Gateway Endpoint (REG-A2A-001 to 009)
 * Complementary to MCP (/api/mcp):
 * - MCP = Agent-to-Tool (statutory lookup & rule execution)
 * - A2A = Agent-to-Agent (multi-domain legal task delegation to reg24.legal_task_agent)
 */

import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { UserRole } from "@/core/types/legal-schema";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view");

  if (view === "agent-card") {
    return NextResponse.json(reg24Core.getA2AAgentCard());
  }

  return NextResponse.json({
    protocol: "Agent-to-Agent (A2A) Protocol",
    specification_version: "1.0.0",
    discovery_endpoint: "/.well-known/agent.json",
    agent_card: reg24Core.getA2AAgentCard(),
    tasks: reg24Core.listA2ATasks(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Support A2A v1.0 JSON-RPC 2.0 methods (tasks/send, tasks/get, tasks/cancel, agent/card)
    if (body.jsonrpc === "2.0") {
      const { id, method, params } = body;

      if (method === "agent/card") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: reg24Core.getA2AAgentCard(),
        });
      }

      if (method === "tasks/send") {
        const task = reg24Core.delegateA2ATask({
          objective:
            params?.objective ||
            params?.message?.parts?.[0]?.text ||
            "Can a foreign investor establish a company in Thailand, obtain BOI promotion, employ foreign specialists and receive corporate income tax incentives?",
          delegating_agent_id: params?.delegating_agent_id || "agent.law24.orchestrator",
          tenant_id: params?.tenant_id || "tenant.law24.prod",
          scoped_role: (params?.scoped_role as UserRole) || "Legal Reviewer",
          as_of_date: params?.as_of_date || "2026-10-18",
          facts: params?.facts,
          async_mode: Boolean(params?.async_mode),
        });

        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: task,
        });
      }

      if (method === "tasks/get") {
        const task = reg24Core.getA2ATask(params?.task_id || "");
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: task || { error: "Task not found" },
        });
      }

      if (method === "tasks/cancel") {
        const canceled = reg24Core.cancelA2ATask(params?.task_id || "");
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: canceled,
        });
      }
    }

    // Direct REST-style A2A task actions
    const action = body.action || "delegate_task";
    if (action === "cancel_task") {
      const res = reg24Core.cancelA2ATask(body.task_id);
      return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
    }
    if (action === "complete_async_task") {
      const res = reg24Core.completeAsyncA2ATask(body.task_id);
      return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
    }

    const task = reg24Core.delegateA2ATask({
      objective:
        body.objective ||
        "Can a foreign investor establish a company in Thailand, obtain BOI promotion, employ foreign specialists and receive corporate income tax incentives?",
      delegating_agent_id: body.delegating_agent_id || "agent.law24.orchestrator",
      tenant_id: body.tenant_id || "tenant.law24.prod",
      scoped_role: (body.scoped_role as UserRole) || "Legal Reviewer",
      as_of_date: body.as_of_date || "2026-10-18",
      facts: body.facts,
      async_mode: Boolean(body.async_mode),
    });

    return NextResponse.json({
      success: true,
      task,
      snapshot: reg24Core.getDashboardSnapshot(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Invalid A2A request payload",
      },
      { status: 400 }
    );
  }
}
