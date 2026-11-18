import { NextResponse } from "next/server";
import { getUnifiedCitationLedgerView } from "../../../../../core/knowledge/claim-traceability-engine";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import { sha256Bytes } from "../../../../../core/knowledge/identity";
import {
  approveOfficialUrlReplacement,
  verifyOfficialLocationHealth,
  type HttpProbeResult,
} from "../../../../../core/knowledge/link-health";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";

async function defaultLiveHttpProbe(url: string): Promise<HttpProbeResult> {
  const redirectChain: string[] = [];
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (resp.url && resp.url !== url) {
      redirectChain.push(resp.url);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const mime = resp.headers.get("content-type") || "application/octet-stream";
    return {
      reachable: true,
      http_status: resp.status,
      final_url: resp.url || url,
      redirect_chain: redirectChain,
      mime_type: mime,
      body_text_or_html: buf.toString("utf8"),
      body_sha256: sha256Bytes(buf),
    };
  } catch (err) {
    return {
      reachable: false,
      http_status: null,
      final_url: url,
      redirect_chain: redirectChain,
      mime_type: "",
      body_text_or_html: "",
      body_sha256: null,
      network_error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: Request) {
  try {
    resolveServerActor(req);
    const store = getDefaultKnowledgeStore();
    const view = getUnifiedCitationLedgerView(store);
    const allPrimary = Object.values(view.locations).filter(
      (l) => l.is_active_primary && l.role !== "third_party_discovery"
    );
    const reachable = allPrimary.filter(
      (l) => l.link_health === "verified_online" || l.link_health === "moved_verified"
    );
    const failed = allPrimary.filter(
      (l) => l.link_health !== "verified_online" && l.link_health !== "moved_verified"
    );

    return NextResponse.json({
      ok: true,
      checked_at: new Date().toISOString(),
      total_locations: allPrimary.length,
      verified_reachable_count: reachable.length,
      failed_count: failed.length,
      failed_locations: failed.map((f) => ({
        location_id: f.location_id,
        doc_id: f.doc_id,
        url: f.exact_official_url,
        link_health: f.link_health,
        last_successful_verified_at: f.last_successful_verified_at,
        cause: f.failure_reason,
      })),
    });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = resolveServerActor(req);
    const body = (await req.json().catch(() => ({}))) as {
      action?: "verify" | "approve_replacement";
      location_id?: string;
      proposed_new_official_url?: string;
      reason?: string;
    };

    if (!body.location_id) {
      throw new Error("MISSING_LOCATION_ID_400: location_id is required.");
    }

    const store = getDefaultKnowledgeStore();
    if (body.action === "approve_replacement") {
      if (!body.proposed_new_official_url) {
        throw new Error("MISSING_URL_400: proposed_new_official_url is required.");
      }
      const updated = await approveOfficialUrlReplacement(store, {
        location_id: body.location_id,
        proposed_new_official_url: body.proposed_new_official_url,
        probe: defaultLiveHttpProbe,
        operator: actor,
        reason: body.reason || "Operator verified moved official URL matches pinned version",
      });
      return NextResponse.json({ ok: true, location: updated });
    }

    const verified = await verifyOfficialLocationHealth(
      store,
      body.location_id,
      defaultLiveHttpProbe,
      { actorId: actor.actor_id }
    );
    return NextResponse.json({ ok: true, result: verified });
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
