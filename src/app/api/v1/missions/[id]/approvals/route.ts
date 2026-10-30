import { NextRequest, NextResponse } from "next/server";
import { reg24ApplicationService } from "@/packages/application";
import { resolveAuthFromNextRequest } from "@/packages/application/http-helper";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const auth = await resolveAuthFromNextRequest(req, body.tenant_id as string | undefined);
  const res = await reg24ApplicationService.approveMissionArtifact({
    mission_id: id,
    artifact_hash: (body.artifact_hash as string) || "",
    decision: ((body.decision as string) === "rejected" ? "rejected" : "approved"),
    permitted_external_action: body.permitted_external_action as
      | "enterprise_record_mutation"
      | "external_transmission"
      | "electronic_signature"
      | undefined,
    idempotency_key: (body.idempotency_key as string) || `IDEM-APPR-${Date.now()}`,
    auth,
  });
  return NextResponse.json(res.body, { status: res.status });
}
