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

  const perm = reusableLegalKnowledgeLibrary.checkAccessPermission({
    documentId: id,
    tenantId,
    consumingApp,
    requestedOperation: "EXCERPT_DISPLAY",
  });

  const snapshot = reusableLegalKnowledgeLibrary.getLibrarySnapshot(tenantId, consumingApp);
  const doc = snapshot.commentaries.find((d) => d.id === id);

  if (!doc) {
    return NextResponse.json(
      { status: "not_found", error: `Document '${id}' not found.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    status: perm.allowed ? "ok" : "restricted_quarantined",
    specification_id: "REG24-KL-001",
    permission_check: perm,
    document: doc,
    versions: snapshot.versions.filter((v) => v.documentId === id),
    ocr_pages: perm.allowed ? snapshot.ocrPages.filter((p) => p.documentId === id) : [],
    chunks: perm.allowed ? snapshot.hierarchicalChunks.filter((c) => c.documentId === id) : [],
    opinions: perm.allowed ? snapshot.opinions.filter((o) => o.documentId === id) : [],
  });
}
