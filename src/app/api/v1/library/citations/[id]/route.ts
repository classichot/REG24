import { NextRequest, NextResponse } from "next/server";
import {
  reusableLegalKnowledgeLibrary,
  type ConsumingApplicationId,
} from "@/core/library/legal-knowledge-library";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const tenantId =
    req.nextUrl.searchParams.get("tenant_id") ||
    req.headers.get("x-reg24-tenant") ||
    "tenant.law24.prod";
  const consumingApp = (req.nextUrl.searchParams.get("app") ||
    req.headers.get("x-reg24-app") ||
    "REG24") as ConsumingApplicationId;

  const citation = reusableLegalKnowledgeLibrary.getVerifiedCitationById({
    citationOrDocumentId: decodeURIComponent(id),
    tenantId,
    consumingApp,
  });

  return NextResponse.json({
    specification_id: "REG24-KL-001",
    requirement_ids: ["LIB-09", "LIB-10"],
    ...citation,
  });
}
