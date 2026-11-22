import { NextResponse } from "next/server";
import { computeBatchTraceabilityInventoryCounts } from "../../../../../core/knowledge/claim-traceability-engine";
import { resolveActiveCitationDbTransport } from "../../../../../core/knowledge/citation-postgres-store";
import {
  resolveConfiguredProviderAndModel,
  resolveThinkingLevelForModel,
} from "../../../../../core/knowledge/grounded-llm-drafter";
import {
  knowledgeApiErrorResponse,
  resolveServerActor,
} from "../../../../../core/knowledge/http-auth";
import {
  inspectReleaseProjectionDiagnostics,
  isStrictSingleReleasePreviewMode,
  runTokenizerParityProbe,
} from "../../../../../core/knowledge/projections";
import { isDefaultGroundedLlmStagingEnabled } from "../../../../../core/knowledge/query";
import { getDefaultKnowledgeStore } from "../../../../../core/knowledge/store";
import { inspectAuthenticatedReviewerReadOnly } from "../../../../../core/knowledge/trial-gate";

export async function GET(req: Request) {
  try {
    resolveServerActor(req);
    const store = getDefaultKnowledgeStore();
    const state = store.getState();
    const topology = store.getStorageTopology();

    // Honor explicit pinned release ID (`REG24_PINNED_RELEASE_ID` or `state.active_release_id`) — NO silent UAT fallback when pinned!
    const pinnedEnvRelease = (process.env.REG24_PINNED_RELEASE_ID || "").trim() || null;
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

    const activeReleaseId = pinnedEnvRelease || state.active_release_id || fallbackCandidateRel || "rel.B01.rc6";
    const relRec = state.releases[activeReleaseId];
    const counts = computeBatchTraceabilityInventoryCounts(store, "B01", activeReleaseId);
    const reqUrl = new URL(req.url);
    const includeTokenizerProbe = reqUrl.searchParams.get("probe_tokenizer") === "1";
    const projectionDiagnostics = inspectReleaseProjectionDiagnostics(store, activeReleaseId);
    const tokenizerParityProbe = includeTokenizerProbe
      ? runTokenizerParityProbe(store, activeReleaseId)
      : undefined;
    const dbActive = Boolean(resolveActiveCitationDbTransport());
    const groundedEnabled = isDefaultGroundedLlmStagingEnabled();
    const authenticatedReviewer = await inspectAuthenticatedReviewerReadOnly(req);
    const llmConfig = resolveConfiguredProviderAndModel();
    const envThinking = (process.env.REG24_GROUNDED_LLM_THINKING_LEVEL || "").trim().toLowerCase();
    const thinkingResolved = resolveThinkingLevelForModel(
      llmConfig.requestedModel,
      envThinking === "minimal" || envThinking === "low" || envThinking === "medium" || envThinking === "high"
        ? envThinking
        : null
    );

    return NextResponse.json(
      {
        ok: true,
        authenticated_reviewer: authenticatedReviewer,
        environment: {
          vercel_env: process.env.VERCEL_ENV || "local_or_staging",
          environment_scope: process.env.REG24_TRIAL_ENV_SCOPE || "staging",
          git_branch:
            process.env.VERCEL_GIT_COMMIT_REF || "feat/b01-thai-legal-index-retrieval-rc10.3",
          git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || relRec?.code_commit || "local",
          deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
          deployment_url: process.env.VERCEL_URL || null,
          runtime_platform: process.platform,
          runtime_arch: process.arch,
          node_version: process.version,
          strict_single_release_preview: isStrictSingleReleasePreviewMode(),
          release_override_rejected_on_preview: isStrictSingleReleasePreviewMode(),
          silent_retrieval_fallback_disabled: isStrictSingleReleasePreviewMode(),
          preview_url_vs_release_clarification:
            "Vercel preview URL slugs/aliases (e.g. a custom alias or deployment subdomain created during RC3) are routing labels on Vercel and are not renamed when new commits or data manifests are pushed; the authoritative runtime corpus version is `data_version.release_id` + `data_version.manifest_hash`.",
          invite_only_trial_gate_enabled: process.env.REG24_TRIAL_INVITE_ONLY === "1",
          shared_neon_postgres_connected: dbActive,
          neon_project_id_configured: Boolean(process.env.NEON_PROJECT_ID),
          pinned_release_enforced: Boolean(pinnedEnvRelease || state.active_release_id),
        },
        data_version: {
          batch_id: "B01",
          release_id: activeReleaseId,
          release_state: relRec?.state || "READY_FOR_UAT",
          manifest_id: relRec?.manifest_id || null,
          manifest_hash: relRec?.manifest_hash || null,
          supersedes_release_id: relRec?.supersession_lineage?.supersedes_release_id || null,
          rollback_target_release_id: relRec?.rollback_target_release_id || null,
          store_topology_mode: topology.topology_mode,
          eligible_official_documents: counts.documents.eligible,
          eligible_evidence_passages: counts.passages.eligible,
          updated_at: relRec?.updated_at || null,
        },
        projections: projectionDiagnostics,
        ...(tokenizerParityProbe ? { tokenizer_parity_probe: tokenizerParityProbe } : {}),
        model_and_verifiers: {
          generation_mode: groundedEnabled ? "llm_grounded" : "baseline_deterministic",
          model_id: groundedEnabled
            ? `${llmConfig.provider}:${llmConfig.requestedModel}`
            : "reg24-deterministic-legal-graphrag-v2.0",
          thinking_level: groundedEnabled ? thinkingResolved.thinking_level : null,
          silent_fallback_disabled: groundedEnabled,
          model_policy_version: groundedEnabled
            ? "reg24-grounded-llm-legal-application-v1.1"
            : "reg24-grounded-legal-v2.0",
          claim_verifier_version: "reg24-claim-verifier-v2.1",
          calculation_verifier_version: "reg24-tax-calc-verifier-v1.0",
          ruleset_version: "th-official-traceability-2026.11.2",
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
