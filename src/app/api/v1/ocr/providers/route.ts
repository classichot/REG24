import { NextRequest, NextResponse } from "next/server";
import {
  reg24OcrV2Service,
  resolveOcrPrincipalFromHeaders,
  type PrivacyClass,
} from "@/packages/ocr-v2";

export async function GET(req: NextRequest) {
  const principal = resolveOcrPrincipalFromHeaders(req.headers);
  const policyId = req.nextUrl.searchParams.get("policy_id") ?? undefined;
  const privacyClass =
    (req.nextUrl.searchParams.get("privacy_class") as PrivacyClass | null) ?? undefined;

  const res = reg24OcrV2Service.listProviders({
    principal,
    policy_id: policyId,
    privacy_class: privacyClass,
  });

  return NextResponse.json(res.body, { status: res.status, headers: res.headers });
}
