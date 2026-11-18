import * as fs from "node:fs";
import * as path from "node:path";
import { NextResponse } from "next/server";
import { knowledgeApiErrorResponse, resolveServerActor } from "@/core/knowledge/http-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    resolveServerActor(req);
    const packPath = path.join(
      process.cwd(),
      "docs",
      "audit",
      "dodo-review-rc2-b02",
      "b01_rc2_legal_spotcheck_pack_30cases.json"
    );
    const raw = JSON.parse(fs.readFileSync(packPath, "utf8")) as {
      release_id: string;
      manifest_id: string;
      manifest_hash: string;
      total_cases: number;
      cases: Array<{
        spotcheck_id: string;
        stratum: string;
        question: string;
        mode?: "standard" | "exact_lookup" | "comparison";
        applicable_date: string | null;
        legal_check_focus: string;
        observed_status: string;
      }>;
    };

    return NextResponse.json(
      {
        ok: true,
        release_id: raw.release_id,
        manifest_id: raw.manifest_id,
        manifest_hash: raw.manifest_hash,
        total_cases: raw.total_cases,
        cases: raw.cases.map((c) => ({
          spotcheck_id: c.spotcheck_id,
          stratum: c.stratum,
          question: c.question,
          mode: c.mode || "standard",
          applicable_date: c.applicable_date,
          legal_check_focus: c.legal_check_focus,
          baseline_observed_status: c.observed_status,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
