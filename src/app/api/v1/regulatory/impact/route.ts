import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sim = reg24Core.simulateSharedProvisionAmendment(body.provision_id || "prov.th.ccc.1097");
    const changes = reg24Core.executeMCPTool("reg24.get_regulatory_changes", {
      module_ids: body.module_ids,
    });
    return NextResponse.json({
      status: "ok",
      amendment_impact_simulation: sim,
      regulatory_changes: changes.result,
    });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET() {
  const changes = reg24Core.executeMCPTool("reg24.get_regulatory_changes", {});
  return NextResponse.json({
    status: "ok",
    regulatory_changes: changes.result,
  });
}
