import { NextRequest, NextResponse } from "next/server";
import {
  reusableLegalKnowledgeLibrary,
  type ConsumingApplicationId,
} from "@/core/library/legal-knowledge-library";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const documentId =
    body.documentId || body.document_id || "doc.kl.tax.treatise.2026.ed9";
  const tenantId =
    body.tenantId ||
    body.tenant_id ||
    req.headers.get("x-reg24-tenant") ||
    "tenant.law24.prod";
  const consumingApp = (body.consumingApp ||
    body.consuming_app ||
    req.headers.get("x-reg24-app") ||
    "LAW24") as ConsumingApplicationId;
  const requestedOperation =
    body.requestedOperation ||
    body.requested_operation ||
    ("EXCERPT_DISPLAY" as "SEARCH" | "EXCERPT_DISPLAY" | "FULL_TEXT_EXPORT" | "CROSS_APP_REUSE");

  const check = reusableLegalKnowledgeLibrary.checkAccessPermission({
    documentId,
    tenantId,
    consumingApp,
    requestedOperation,
  });

  return NextResponse.json({
    status: check.allowed ? "ok" : "blocked_permission",
    specification_id: "REG24-KL-001",
    requirement_ids: ["LIB-10", "LIB-14"],
    ...check,
  });
}
