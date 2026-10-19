import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { AgentAutonomyLevel, AgentOperatingMode } from "@/core/types/legal-schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mission = reg24Core.executeAgentMissionV2({
      objective: body.objective || "Analyze the legal requirements for acquiring a Thai solar power company.",
      operating_mode: (body.operating_mode as AgentOperatingMode) || "Team-Agent",
      autonomy_level: (body.autonomy_level as AgentAutonomyLevel) || "Supervised",
      industry_module: body.industry_module || "IND-ENERGY",
      budget_limit_usd: body.budget_limit_usd ?? 10.0,
      tenant_id: body.tenant_id || "tenant.law24.prod",
      attempt_unauthorized_external_filing: Boolean(body.attempt_unauthorized_external_filing),
    });
    return NextResponse.json({ status: "ok", mission });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET() {
  const snap = reg24Core.getDashboardSnapshot();
  return NextResponse.json({
    status: "ok",
    agent_registry: snap.legalAgentRegistryV2,
    missions: snap.agentMissionsV2,
  });
}
