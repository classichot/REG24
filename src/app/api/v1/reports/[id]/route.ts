import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const report = reg24Core.getResearchStudioReport(id);
  return NextResponse.json({ status: "ok", report });
}
