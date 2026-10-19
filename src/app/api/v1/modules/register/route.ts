import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.module_id && String(body.module_id).startsWith("IND-")) {
      const res = reg24Core.registerIndustryModule({
        module_id: body.module_id,
        module_name: body.module_name,
        module_name_th: body.module_name_th,
        priority: body.priority,
        legal_domains: body.legal_domains || ["LEG-CORP", "LEG-TAX"],
        regulators: body.regulators || ["DBD", "RD"],
        business_activities: body.business_activities || ["general_commercial_operations"],
        agents: body.agents,
        workflows: body.workflows,
        output_types: body.output_types,
      });
      return NextResponse.json(res, { status: res.success ? 200 : 400 });
    }

    const dynRes = reg24Core.installDynamicModule({
      module_id: body.module_id || "reg24.custom.th",
      display_name: body.display_name || body.module_name || "Custom Legal Module",
    });
    return NextResponse.json(dynRes, { status: dynRes.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}
