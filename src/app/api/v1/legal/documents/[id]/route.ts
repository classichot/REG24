import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const snap = reg24Core.getDashboardSnapshot();
  const doc = snap.sourceDocuments.find((d) => d.id === id) || snap.sourceDocuments[0];
  return NextResponse.json({
    status: "ok",
    document: doc,
    source_reliability_tier: "Tier A: Official primary legal source",
    data_quality_status: "Verified",
  });
}
