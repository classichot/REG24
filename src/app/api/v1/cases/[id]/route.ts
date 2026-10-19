import { NextRequest, NextResponse } from "next/server";
import { reg24Core } from "@/core/engine/reg24-core";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const res = reg24Core.getLegalCaseById(decodeURIComponent(id));
  if (!res.found) {
    return NextResponse.json(
      {
        found: false,
        error: `Canonical LegalCase '${id}' not found. REG24 never fabricates unverified cases.`,
      },
      { status: 404 }
    );
  }
  return NextResponse.json(res);
}
