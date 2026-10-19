import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.citation || body.case_number) {
      const caseRes = reg24Core.verifyCaseCitation({
        citation: body.citation || body.case_number,
        statute_section: body.statute_section,
        quote: body.quote,
        claimed_overruled: body.claimed_overruled,
      });
      return NextResponse.json(caseRes);
    }
    const statRes = reg24Core.executeMCPTool("reg24.verify_citation", {
      provision_id: body.provision_id || "prov.th.ccc.1097",
      as_of_date: body.as_of_date || "2026-10-19",
    });
    return NextResponse.json(statRes);
  } catch (err) {
    return NextResponse.json({ status: "error", message: String(err) }, { status: 400 });
  }
}
