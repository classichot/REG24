import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.analyzeIndustryModuleApplicability({
      industry_module: body.industry_module || "IND-ENERGY",
      business_activity: body.business_activity,
      as_of_date: body.as_of_date || "2026-10-19",
      tenant_id: body.tenant_id || "tenant.law24.prod",
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const res = reg24Core.analyzeIndustryModuleApplicability({
    industry_module: searchParams.get("industry_module") || "IND-ENERGY",
    business_activity: searchParams.get("business_activity") || undefined,
    as_of_date: searchParams.get("as_of_date") || "2026-10-19",
  });
  return NextResponse.json(res);
}
