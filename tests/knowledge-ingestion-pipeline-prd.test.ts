import { describe, it, expect } from "vitest";
import {
  knowledgeIngestionPipeline,
  KnowledgeIngestionPipelineService,
  DEFAULT_ADMISSION_LIMITS,
} from "../src/core/ingestion/knowledge-ingestion-pipeline";

describe("REG24 Knowledge Ingestion Pipeline Developer Requirements v1.0 (24 October 2026)", () => {
  it("executes all 8 stages automatically from a single upload and emits an immutable ReleaseManifest and Knowledge Receipt (Sections 1, 2, 11, 21)", () => {
    const svc = new KnowledgeIngestionPipelineService();
    const res = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      access_scope_kind: "platform_corpus",
      original_name: "พระราชกฤษฎีกา_812_มาตรการภาษีคาร์บอน.pdf",
      media_type: "application/pdf",
      byte_count: 112000,
      page_count: 5,
      source_authenticity: "verified_against_registered_source",
      rights_status: "approved_public_distribution",
      auto_publish_allowed: true,
      raw_text:
        "มาตรา 1 พระราชกฤษฎีกานี้เรียกว่า พระราชกฤษฎีกา (ฉบับที่ 812) พ.ศ. 2569\nมาตรา 65 ให้หักรายจ่ายได้สองเท่าสำหรับโครงการลดก๊าซเรือนกระจก",
      published_on: "2026-10-24",
      effective_from: "2026-10-25",
    });

    expect(res.status).toBe("accepted");
    expect(res.job?.stages.map((s) => s.stage_name)).toEqual([
      "stage_1_receive",
      "stage_2_identify",
      "stage_3_extract",
      "stage_4_register",
      "stage_5_chunk",
      "stage_6_index",
      "stage_7_update_neo4j",
      "stage_8_validate_and_publish",
    ]);
    expect(res.job?.stages.every((s) => s.status === "succeeded")).toBe(true);
    expect(res.job?.publication_state).toBe("published");
    expect(res.job?.release_manifest?.release_id).toBeDefined();
    expect(res.job?.knowledge_receipt.documents_added).toBe(1);
    expect(res.job?.knowledge_receipt.legal_units_and_chunks_created).toBeGreaterThanOrEqual(2);
  });

  it("produces legal structure-aware chunks conforming to the Section 13.1 schema with zero-based page_index and deterministic IDs (Stage 5 C01..C06)", () => {
    const snap = knowledgeIngestionPipeline.getPipelineDashboardSnapshot();
    const firstJob = snap.jobs[0];
    const firstChunk = firstJob.chunks[0];

    expect(firstChunk.chunk_id).toMatch(/^chk_/);
    expect(firstChunk.version_id).toBe(firstJob.version_id);
    expect(firstChunk.processing_generation_id).toBe(firstJob.processing_generation_id);
    expect(firstChunk.access_scope_id).toBe(firstJob.intake_receipt.access_scope_id);
    expect(firstChunk.extraction_revision_id).toBe(firstJob.extraction_revision_id);
    expect(Array.isArray(firstChunk.legal_path)).toBe(true);
    expect(firstChunk.locator.page_index).toBe(0);
    expect(firstChunk.chunker_version).toBe("legal_structure_v1");
    expect(DEFAULT_ADMISSION_LIMITS.target_chunk_tokens_min).toBe(400);
    expect(DEFAULT_ADMISSION_LIMITS.target_chunk_tokens_max).toBe(900);
  });

  it("enforces Stage 1 security guards against SSRF, executables/macros, and admission limits (R03..R05, AT20)", () => {
    const svc = new KnowledgeIngestionPipelineService();

    const ssrf = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "metadata.pdf",
      media_type: "application/pdf",
      byte_count: 2048,
      source_uri: "http://169.254.169.254/latest/meta-data/iam",
      raw_text: "test",
    });
    expect(ssrf.status).toBe("rejected");
    expect(ssrf.error_code).toBe("SOURCE_FETCH_BLOCKED");

    const macro = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "payload.docm",
      media_type: "application/vnd.ms-word.document.macroEnabled.12",
      byte_count: 4096,
      raw_text: "vbaProject.bin",
    });
    expect(macro.status).toBe("rejected");
    expect(macro.error_code).toBe("MALICIOUS_OR_MACRO_CONTENT");

    const oversized = svc.ingestSource({
      submitted_by: "counsel.somchai@law24.th",
      tenant_id: "tenant.law24.prod",
      workspace_id: "ws.law24.tax",
      original_name: "huge.pdf",
      media_type: "application/pdf",
      byte_count: 150 * 1024 * 1024, // 150 MiB > 100 MiB limit
      raw_text: "test",
    });
    expect(oversized.status).toBe("rejected");
    expect(oversized.http_status).toBe(413);
    expect(oversized.error_code).toBe("ADMISSION_LIMIT_EXCEEDED");
  });

  it("passes all 24 mandatory Acceptance Tests (AT01 through AT24) in Section 19", () => {
    const report = knowledgeIngestionPipeline.runAll24AcceptanceTests();
    expect(report.totalTests).toBe(24);
    expect(report.passedCount).toBe(24);
    expect(report.all24Passed).toBe(true);
  });
});
