import { NextResponse } from "next/server";
import { computeBatchTraceabilityInventoryCounts } from "../../../../../core/knowledge/claim-traceability-engine";
import { resolveActiveCitationDbTransport } from "../../../../../core/knowledge/citation-postgres-store";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";

export async function GET(req: Request) {
  try {
    resolveServerActor(req);
    const store = getDefaultKnowledgeStore();
    const state = store.getState();
    const topology = store.getStorageTopology();

    const fallbackCandidateRel = Object.values(state.releases)
      .filter(
        (r) =>
          r.state === "READY_FOR_UAT" ||
          r.state === "ACCEPTED" ||
          r.state === "ACCEPTED_WITH_DECLARED_GAPS"
      )
      .sort(
        (a, b) =>
          b.updated_at.localeCompare(a.updated_at) ||
          b.release_id.localeCompare(a.release_id)
      )[0]?.release_id;

    const activeReleaseId = state.active_release_id || fallbackCandidateRel || "rel.B01.rc5";
    const relRec = state.releases[activeReleaseId];
    const counts = computeBatchTraceabilityInventoryCounts(store, "B01", activeReleaseId);
    const dbActive = Boolean(resolveActiveCitationDbTransport());

    return NextResponse.json(
      {
        ok: true,
        environment: {
          vercel_env: process.env.VERCEL_ENV || "local_or_staging",
          environment_scope: process.env.REG24_TRIAL_ENV_SCOPE || "staging",
          git_branch:
            process.env.VERCEL_GIT_COMMIT_REF || "review/b01-rc2-b02-rc1-staging",
          git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || relRec?.code_commit || "local",
          invite_only_trial_gate_enabled: process.env.REG24_TRIAL_INVITE_ONLY === "1",
          shared_neon_postgres_connected: dbActive,
          neon_project_id_configured: Boolean(process.env.NEON_PROJECT_ID),
        },
        data_version: {
          batch_id: "B01",
          release_id: activeReleaseId,
          release_state: relRec?.state || "READY_FOR_UAT",
          manifest_id: relRec?.manifest_id || null,
          manifest_hash: relRec?.manifest_hash || null,
          store_topology_mode: topology.topology_mode,
          eligible_official_documents: counts.documents.eligible,
          eligible_evidence_passages: counts.passages.eligible,
          updated_at: relRec?.updated_at || null,
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
