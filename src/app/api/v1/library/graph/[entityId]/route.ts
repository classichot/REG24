import { NextRequest, NextResponse } from "next/server";
import {
  reusableLegalKnowledgeLibrary,
  type ConsumingApplicationId,
} from "@/core/library/legal-knowledge-library";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ entityId: string }> }
) {
  const { entityId } = await context.params;
  const tenantId =
    req.nextUrl.searchParams.get("tenant_id") ||
    req.headers.get("x-reg24-tenant") ||
    "tenant.law24.prod";
  const consumingApp = (req.nextUrl.searchParams.get("app") ||
    req.headers.get("x-reg24-app") ||
    "REG24") as ConsumingApplicationId;
  const includeUnverified =
    req.nextUrl.searchParams.get("include_unverified") === "true";

  const graph = reusableLegalKnowledgeLibrary.getKnowledgeGraphForEntity({
    entityId: decodeURIComponent(entityId),
    tenantId,
    consumingApp,
    includeUnverifiedAiEdges: includeUnverified,
  });

  return NextResponse.json({
    status: "ok",
    specification_id: "REG24-KL-001",
    requirement_ids: ["LIB-07", "LIB-10"],
    ...graph,
  });
}
