import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await resolveAuthFromNextRequest(req);
  const res = await reg24ApplicationService.getMission(id, auth);
  return NextResponse.json(res.body, { status: res.status });
}
