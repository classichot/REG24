import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET() {
  return NextResponse.json(reg24Core.getDashboardSnapshot());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, payload } = body;

    switch (action) {
      case "install_module": {
        const res = reg24Core.installDynamicModule(payload);
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "set_module_state": {
        const res = reg24Core.setModuleLifecycleState(
          payload.module_id,
          payload.state,
          payload.new_version
        );
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "rollback_module": {
        const res = reg24Core.rollbackModuleVersion(payload.module_id);
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "uninstall_module": {
        const res = reg24Core.uninstallModuleSafely(payload.module_id);
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "approve_rule": {
        const res = reg24Core.approveDraftRule(
          payload.rule_id,
          payload.reviewer_name || "Dr. Somchai Nitikorn (Legal Reviewer)",
          payload.reviewer_role || "Legal Reviewer"
        );
        return NextResponse.json({ ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "simulate_amendment": {
        const res = reg24Core.simulateSharedProvisionAmendment(
          payload?.provision_id || "prov.th.ccc.1097"
        );
        return NextResponse.json({ success: true, ...res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "run_3r_graphrag": {
        const res = reg24Core.execute3RGraphRAGQuery({
          query: payload?.query || "Can a company terminate an employee without severance pay?",
          as_of_date: payload?.as_of_date || "2026-10-18",
          known_at_date: payload?.known_at_date || "2026-10-18",
          facts: payload?.facts,
        });
        return NextResponse.json({ success: true, graphrag_3r: res, snapshot: reg24Core.getDashboardSnapshot() });
      }
      case "reset_seed": {
        reg24Core.resetToSeed();
        return NextResponse.json({ success: true, snapshot: reg24Core.getDashboardSnapshot() });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process platform action" },
      { status: 400 }
    );
  }
}
