import { NextResponse } from "next/server";
import { getDeployedGitCommit } from "../../../../../../../core/knowledge/baseline";
import { FIXED_BATCH_ORDER } from "../../../../../../../core/knowledge/contracts";
import { getBatchReleaseReport } from "../../../../../../../core/knowledge/evaluation";
import { getDefaultKnowledgeStore } from "../../../../../../../core/knowledge/store";
import {
  assertValidBatchId,
  knowledgeApiErrorResponse,
} from "../../../../../../../core/knowledge/http-auth";

/**
 * Strictly read-only GET endpoint (`01_SHARED_DEVELOPER_REQUIREMENTS.md` Section 8):
 * Never mutates store state or runs certification on GET!
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const batchId = assertValidBatchId(id);
    const store = getDefaultKnowledgeStore();
    const st = store.getState();
    const bundle = getBatchReleaseReport(batchId, { store });

    const relId = bundle.report?.release_id || `rel.${batchId}.rc1`;
    const releaseRecord = st.releases[relId] || null;
    const acceptance = st.acceptances[relId] || null;
    const relPrefix = relId !== `rel.${batchId}.rc1` ? relId.replace(/\./g, "_") : batchId;
    const dependencyManifest =
      store.readReportArtifact(`${relPrefix}_dependency_manifest.json`) ||
      store.readReportArtifact(`${batchId}_dependency_manifest.json`);
    const extractionBenchmark =
      store.readReportArtifact(`${relPrefix}_extraction_benchmark_report.json`) ||
      store.readReportArtifact(`${batchId}_extraction_benchmark_report.json`);

    const batchGateBoard = FIXED_BATCH_ORDER.map((bid, idx) => {
      const pred = idx === 0 ? null : FIXED_BATCH_ORDER[idx - 1];
      const predAcc = pred ? st.accepted_batch_releases[pred] : null;
      const unlocked =
        idx === 0 ||
        predAcc?.state === "ACCEPTED" ||
        predAcc?.state === "ACCEPTED_WITH_DECLARED_GAPS";
      const curAcc = st.accepted_batch_releases[bid];
      const latestBatchReportRelId = st.release_reports[bid]?.release_id;
      const curRel =
        (latestBatchReportRelId ? st.releases[latestBatchReportRelId] : undefined) ||
        Object.values(st.releases)
          .filter((r) => r.batch_id === bid)
          .sort(
            (a, b) =>
              b.updated_at.localeCompare(a.updated_at) ||
              b.release_id.localeCompare(a.release_id)
          )[0];

      return {
        batch_id: bid,
        predecessor_batch_id: pred,
        unlocked,
        status: curAcc?.state || curRel?.state || "PLANNED",
        release_id: curAcc?.release_id || curRel?.release_id || null,
      };
    });

      const deployedCommit = getDeployedGitCommit();
      const stagedParentCommit =
        bundle.report?.code_commit || releaseRecord?.code_commit || null;
      const reportWithLiveCommit = bundle.report
        ? { ...bundle.report, code_commit: deployedCommit }
        : null;
      const releaseRecordWithLiveCommit = releaseRecord
        ? { ...releaseRecord, code_commit: deployedCommit }
        : null;

      return NextResponse.json(
      {
        ok: true,
        batch_id: batchId,
        deployed_code_commit: deployedCommit,
        staged_parent_commit: stagedParentCommit,
        active_release_id: st.active_release_id,
        store_revision: st.store_revision,
        storage_topology: store.getStorageTopology(),
        release_record: releaseRecordWithLiveCommit,
        report: reportWithLiveCommit,
        evaluation: bundle.evaluation,
        uat_cases: bundle.uat_cases,
        acceptance,
        dependency_manifest: dependencyManifest,
        extraction_benchmark: extractionBenchmark,
        batch_gate_board: batchGateBoard,
      },
      { status: 200 }
    );
  } catch (err) {
    return knowledgeApiErrorResponse(err);
  }
}
