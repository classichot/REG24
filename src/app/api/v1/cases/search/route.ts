import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || searchParams.get("query") || "";
  const court = searchParams.get("court") || undefined;
  const domainPack = searchParams.get("domain_pack") || undefined;
  const statute = searchParams.get("statute") || undefined;
  const verificationStatus = (searchParams.get("verification_status") || undefined) as
    | "unverified"
    | "machine_verified"
    | "human_verified"
    | undefined;

  const res = reg24Core.searchLegalCases({
    query,
    filters: {
      court,
      domain_pack: domainPack,
      statute_or_section: statute,
      verification_status: verificationStatus,
    },
  });

  return NextResponse.json(res);
}
