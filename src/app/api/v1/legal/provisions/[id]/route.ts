import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const asOfDate = searchParams.get("as_of_date") || "2026-10-19";
  const res = reg24Core.executeMCPTool("reg24.get_provision", {
    provision_id: id,
    as_of_date: asOfDate,
    known_at_date: asOfDate,
  });
  return NextResponse.json(res);
}
