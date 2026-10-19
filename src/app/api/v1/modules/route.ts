import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenant_id") || undefined;
  return NextResponse.json({
    status: "ok",
    p0_legal_modules: reg24Core.listModules(false),
    core_legal_domains: reg24Core.listCoreLegalDomains(),
    industry_modules: reg24Core.listIndustryModules(tenantId),
  });
}
