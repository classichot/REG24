/**
 * REG24 — Agent-to-Agent (A2A) Protocol v1.0 Gateway Endpoint
 * Implements:
 * - REG-A2A-001 to 009 (Legacy + Core Coordinating Agent)
 * - REG24 Agent to Agent Developer Requirements Version 1.0 (23 October 2026):
 *   Public & Extended Agent Cards, 12 Versioned Skills, Evidence Passport (reg24.evidence.pack.v1),
 *   Connection Onboarding (Sandbox/Prod, Pause/Revoke), 3-Cycle Clarification, Bound Approvals,
 *   Minor-Unit THB Usage Ledger, Outbound Partner Registry, Kill Switches, and A01–A26 Conformance Suite.
 */

import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import {
  reg24A2AEngine,
  type A2AAutonomyMode,
  type A2AScope,
  type A2ASkillId,
  type A2AResearchRequestV1,
} from "@/core/a2a/reg24-a2a-engine";
import { UserRole } from "@/core/types/legal-schema";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view");
  const tenantId = searchParams.get("tenant_id") || "tenant.law24.prod";

  if (view === "agent-card") {
    return NextResponse.json(
      {
        ...reg24Core.getA2AAgentCard(),
        a2a_v1_public_card: reg24A2AEngine.getPublicAgentCard(),
      },
      { headers: { "A2A-Version": "1.0" } }
    );
  }

  if (view === "overview") {
    return NextResponse.json(
      {
        status: "ok",
        ...reg24A2AEngine.getAdminOverviewSnapshot(tenantId),
      },
      { headers: { "A2A-Version": "1.0" } }
    );
  }

  if (view === "conformance") {
    return NextResponse.json(
      {
        status: "ok",
        conformance: reg24A2AEngine.runAcceptanceConformanceSuite(),
      },
      { headers: { "A2A-Version": "1.0" } }
    );
  }

  return NextResponse.json(
    {
      protocol: "Agent-to-Agent (A2A) Protocol",
      specification_version: "1.0.0",
      discovery_endpoint: "/.well-known/agent-card.json",
      legacy_discovery_endpoint: "/.well-known/agent.json",
      agent_card: reg24Core.getA2AAgentCard(),
      a2a_v1_overview: reg24A2AEngine.getAdminOverviewSnapshot(tenantId),
      tasks: reg24Core.listA2ATasks(),
    },
    { headers: { "A2A-Version": "1.0" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const a2aVersionHeader = req.headers.get("a2a-version") || body.protocolVersion || "1.0";

    // 1. Support A2A v1.0 JSON-RPC 2.0 methods (tasks/send, tasks/get, tasks/cancel, agent/card)
    if (body.jsonrpc === "2.0") {
      const { id, method, params } = body;

      if (method === "agent/card") {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          result: {
            ...reg24Core.getA2AAgentCard(),
            a2a_v1_public_card: reg24A2AEngine.getPublicAgentCard(),
          },
        });
      }

      if (method === "tasks/send" || method === "message/send") {
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

    const action = body.action || "delegate_task";

    // 2. New A2A v1.0 Developer Specification Operations
    if (action === "message:send" || action === "submit_v1_task") {
      const connectionId = body.connectionId || "conn.cfo24.prod.01";
      const skillId = (body.skillId ||
        body.request?.skillId ||
        "reg24.legal.research.v1") as A2ASkillId;
      const requestPayload: A2AResearchRequestV1 = body.request || {
        schemaVersion: "reg24.research.request.v1",
        skillId,
        clientRequestId: body.clientRequestId || `req-${Date.now().toString(36)}`,
        question:
          body.question ||
          "บริษัทจำกัดที่ควบรวมตาม ป.พ.พ. มาตรา 1238 (A+B=A) ในปี 2569 จะได้รับยกเว้นภาษีเงินได้นิติบุคคลตามมาตรา 74 และข้อหารือกรมสรรพากร กค 0702(กม.)/462 หรือไม่?",
        authorityRef: body.authorityRef,
        compareDateTo: body.compareDateTo,
        targetPartnerApp: body.targetPartnerApp,
        jurisdiction: "TH",
        legalAsOf: body.legalAsOf || "2026-10-23",
        language: body.language || "th",
        facts: Array.isArray(body.facts)
          ? body.facts
          : [
              {
                id: "f1",
                name: "entityType",
                value: "company",
                origin: "user_supplied",
                verified: true,
              },
            ],
        documentRefs: body.documentRefs || [],
        sourcePolicy: body.sourcePolicy || "entitled_primary_and_secondary",
        execution: {
          mode: (body.autonomyMode || "draft") as A2AAutonomyMode,
          maxCostMinor: Number(body.maxCostMinor ?? 5000),
          currency: "THB",
          deadlineSeconds: Number(body.deadlineSeconds ?? 180),
          returnImmediately: Boolean(body.returnImmediately),
        },
        requestedArtifacts: body.requestedArtifacts || ["evidence_json", "summary"],
      };

      const res = reg24A2AEngine.submitTask({
        connectionId,
        protocolVersion: a2aVersionHeader,
        request: requestPayload,
      });

      return NextResponse.json(
        {
          status: res.error ? "error" : "ok",
          task: res.task,
          error: res.error,
          overview: reg24A2AEngine.getAdminOverviewSnapshot(),
        },
        { status: res.httpStatus, headers: { "A2A-Version": "1.0" } }
      );
    }

    if (action === "tasks:continue") {
      const contRes = reg24A2AEngine.continueTaskWithClarification({
        taskId: body.taskId,
        connectionId: body.connectionId || "conn.cfo24.prod.01",
        suppliedFacts: body.suppliedFacts || [
          {
            id: "f2",
            name: "transactionType",
            value: body.transactionType || "statutory_merger_ccc_1238_zero_boot",
            origin: "user_supplied",
            verified: true,
          },
        ],
      });
      return NextResponse.json({
        status: contRes.success ? "ok" : "error",
        ...contRes,
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "tasks:cancel_v1") {
      const cancelRes = reg24A2AEngine.cancelTask({
        taskId: body.taskId,
        connectionId: body.connectionId,
      });
      return NextResponse.json({
        status: cancelRes.success ? "ok" : "error",
        ...cancelRes,
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "connections:create") {
      const conn = reg24A2AEngine.createConnection({
        tenantId: body.tenantId || "tenant.law24.prod",
        clientId: body.clientId || `client.custom.${Date.now().toString(36)}`,
        organizationName: body.organizationName || "Partner Organization",
        displayName: body.displayName || "New Agent Connection",
        environment: body.environment === "production" ? "production" : "sandbox",
        autonomyMode: (body.autonomyMode || "draft") as A2AAutonomyMode,
        grantedScopes: (body.grantedScopes || [
          "legal.research",
          "authority.read",
          "evidence.verify",
          "artifacts.read",
        ]) as A2AScope[],
        spendLimitMinor: Number(body.spendLimitMinor ?? 100000),
      });
      return NextResponse.json({
        status: "ok",
        connection: conn,
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "connections:status") {
      const updated = reg24A2AEngine.updateConnectionStatus(
        body.connectionId,
        body.status
      );
      return NextResponse.json({
        status: updated ? "ok" : "error",
        connection: updated,
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "approvals:decide") {
      const dec = reg24A2AEngine.decideApproval({
        approvalId: body.approvalId,
        decision: body.decision === "reject" ? "reject" : "approve",
        approvingPrincipal: body.approvingPrincipal || "senior.reviewer@law24.co.th",
        overrideRecipientPartnerId: body.overrideRecipientPartnerId,
        overrideBudgetMinor: body.overrideBudgetMinor,
      });
      return NextResponse.json({
        ...dec,
        apiStatus: dec.success ? "ok" : "error",
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "killswitch:toggle") {
      const ks = reg24A2AEngine.setGlobalOutboundKillSwitch(Boolean(body.disabled));
      return NextResponse.json({
        status: "ok",
        ...ks,
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "evidence:verify") {
      const overview = reg24A2AEngine.getAdminOverviewSnapshot();
      const targetTask =
        overview.tasks.find((t) => t.taskId === body.taskId) || overview.tasks[0];
      const basePack = targetTask?.evidencePack;
      if (!basePack) {
        return NextResponse.json({ status: "error", error: "No Evidence Pack found." }, { status: 404 });
      }
      const packToVerify = body.tamperByte
        ? { ...basePack, summary: `${basePack.summary} [TAMPERED_BYTE]` }
        : basePack;
      const verification = reg24A2AEngine.verifyEvidencePassport(packToVerify);
      return NextResponse.json({
        status: "ok",
        verification,
      });
    }

    if (action === "watch:trigger") {
      const watchRes = reg24A2AEngine.triggerWatchSourceAmendment(
        body.subscriptionId || "watch.ccc.1238.rd462",
        body.amendmentSummary ||
          "กรมพัฒนาธุรกิจการค้าออกประกาศหลักเกณฑ์การยื่นคำขอควบรวมบริษัทจำกัดทางอิเล็กทรอนิกส์ พ.ศ. 2569"
      );
      return NextResponse.json({
        status: watchRes.success ? "ok" : "error",
        ...watchRes,
        overview: reg24A2AEngine.getAdminOverviewSnapshot(),
      });
    }

    if (action === "conformance:run") {
      return NextResponse.json({
        status: "ok",
        conformance: reg24A2AEngine.runAcceptanceConformanceSuite(),
      });
    }

    // 3. Legacy direct REST-style A2A task actions
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
