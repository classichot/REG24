import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService, type BeastModeEagerness } from "@/packages/application";
import { resolveAuthFromNextRequest } from "@/packages/application/http-helper";
import { runSection20ReleaseEvaluationSuite } from "@/packages/evaluations";
import { SECTION_10_SERVICE_CATALOGUE } from "@/packages/contracts";

export async function GET(req: NextRequest) {
  const auth = await resolveAuthFromNextRequest(req);
  const evaluation = await runSection20ReleaseEvaluationSuite();
  const surfaces = reg24ApplicationService.getFourCoreSurfacesState(auth.tenant_id);

  return NextResponse.json({
    spec_version: "REG24 Infrastructure Developer Requirements v1.0 (30 October 2026)",
    headless_core_status: "ACTIVE_HEADLESS",
    section_10_catalogue: SECTION_10_SERVICE_CATALOGUE,
    four_core_surfaces: surfaces.surfaces,
    evaluation_report: evaluation,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as string;

  if (action === "set_beast_mode") {
    const mode = (body.eagerness as BeastModeEagerness) || "Extrovert";
    const cfg = reg24ApplicationService.setBeastMode(mode);
    return NextResponse.json({ status: "ok", beast_mode: cfg });
  }

  if (action === "calculate_deadline") {
    const res = reg24ApplicationService.calculateDeadline({
      jurisdiction: (body.jurisdiction as string) || "TH",
      trigger_date_iso: (body.trigger_date_iso as string) || "2026-04-10",
      statutory_days: Number(body.statutory_days ?? 3),
      rule_pack_id: (body.rule_pack_id as string) || "RULEPACK-TH-CIVIL-2026",
    });
    return NextResponse.json({ status: "ok", deadline: res });
  }

  const evaluation = await runSection20ReleaseEvaluationSuite();
  return NextResponse.json({ status: "ok", evaluation });
}
