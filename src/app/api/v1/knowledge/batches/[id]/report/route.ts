import { NextResponse } from "next/server";
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
    const dependencyManifest = store.readReportArtifact(`${batchId}_dependency_manifest.json`);
    const extractionBenchmark = store.readReportArtifact(`${batchId}_extraction_benchmark_report.json`);

    const batchGateBoard = FIXED_BATCH_ORDER.map((bid, idx) => {
      const pred = idx === 0 ? null : FIXED_BATCH_ORDER[idx - 1];
      const predAcc = pred ? st.accepted_batch_releases[pred] : null;
      const unlocked =
        idx === 0 ||
        predAcc?.state === "ACCEPTED" ||
        predAcc?.state === "ACCEPTED_WITH_DECLARED_GAPS";
      const curAcc = st.accepted_batch_releases[bid];
      const curRel = Object.values(st.releases).find((r) => r.batch_id === bid);

      return {
        batch_id: bid,
        predecessor_batch_id: pred,
        unlocked,
        status: curAcc?.state || curRel?.state || "PLANNED",
        release_id: curAcc?.release_id || curRel?.release_id || null,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        batch_id: batchId,
        active_release_id: st.active_release_id,
        release_record: releaseRecord,
        report: bundle.report,
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
