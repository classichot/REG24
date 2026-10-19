import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";
import { CoreLegalDomainCode } from "@/core/types/legal-schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = reg24Core.extractStructuredObligations({
      industry: body.industry || body.industry_module,
      legal_domain: body.legal_domain as CoreLegalDomainCode | undefined,
    });
    return NextResponse.json({ status: "ok", ...res });
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const res = reg24Core.extractStructuredObligations({
    industry: searchParams.get("industry") || undefined,
    legal_domain: (searchParams.get("legal_domain") as CoreLegalDomainCode) || undefined,
  });
  return NextResponse.json({ status: "ok", ...res });
}
