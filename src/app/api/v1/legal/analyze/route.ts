import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.analyzeCorporateCommercialLegalQuestion({
      query: body.query || "Analyze the legal requirements for acquiring a Thai solar power company.",
      as_of_date: body.as_of_date || "2026-10-19",
      industry_module: body.industry_module,
      legal_domains: body.legal_domains,
      research_mode: body.research_mode,
      tenant_id: body.tenant_id || "tenant.law24.prod",
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query =
    searchParams.get("q") ||
    searchParams.get("query") ||
    "Analyze the legal requirements for acquiring a Thai solar power company.";
  const res = reg24Core.analyzeCorporateCommercialLegalQuestion({
    query,
    as_of_date: searchParams.get("as_of_date") || "2026-10-19",
    industry_module: searchParams.get("industry_module") || undefined,
  });
  return NextResponse.json(res);
}
