import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_OPERATOR,
  SECOND_APPROVER_PRINCIPAL,
  createReg24OcrV2Service,
  parseTyphoonV2StructuredResponse,
  sha256HexLower,
  validateExtractionManifestContractV2,
} from "../src/packages/ocr-v2";

// Verbatim live `typhoon-ocr-v2` response captured from `https://api.opentyphoon.ai/v1/chat/completions`
// (`response_id: "chatcmpl-83e9a241acf424ce"`, `system_fingerprint: "vllm-0.33.0-9030f50b"`) on genuine
// scanned page `PILOT-01` (`1984_MR_5` Petroleum Income Tax Ministerial Regulation No. 5 B.E. 2527, p.1)
const REAL_PILOT01_PDF_SHA256 = "1341f3c4e400c1875264f1be06b56ce70c2e80d2d1eb3643364bdf07d856d1c6";
const REAL_PILOT01_IMAGE_SHA256 = "adea5f66413786209c369d604d1ef2b3f9e1b253fb758f88059ada1d99ccc11d";
const REAL_PILOT01_RESPONSE_SHA256 = "773c1c25aa26beb905b659e4b54cc26ed317f86c6a36ca07f943bc47bda38e5f";
const REAL_PILOT01_TYPHOON_V2_JSON = JSON.stringify([
  { bbox: [68, 80, 340, 90], category: "header", text: "/ รวมกฎหมายภาษี / พระราชบัญญัติภาษีเงินได้ปิโตรเลียม / กฎกระทรวง" },
  {
    bbox: [345, 137, 653, 211],
    category: "title",
    text: "กฎกระทรวง\nฉบับที่ 5 (พ.ศ. 2527)\nออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม\nพ.ศ. 2514",
  },
  {
    bbox: [80, 257, 914, 292],
    category: "text",
    text: "อาศัยอำนาจตามความในมาตรา 19มาตรา 33 และมาตรา 45 แห่งพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514 รัฐมนตรีว่าการกระทรวงการคลังออกกฎกระทรวงไว้ดังต่อไปนี้",
  },
  {
    bbox: [80, 296, 908, 332],
    category: "text",
    text: "ข้อ 1 การหักภาษี ณ ที่จ่ายของบริษัทผู้รับโอนซึ่งเป็นผู้จ่ายเงินได้ตามมาตรา 21 ให้บริษัทผู้รับโอนคำนวณหักไว้ทุกคราวที่จ่ายเงินได้ในอัตราร้อยละ 50 ของเงินได้หลังจากหักต้นทุนตามข้อ 2 แล้ว",
  },
  { bbox: [115, 336, 409, 351], category: "text", text: "ข้อ 2 การหักต้นทุนจากเงินได้ตามข้อ 1 ให้หักได้ดังนี้" },
  {
    bbox: [80, 357, 909, 393],
    category: "text",
    text: "(1) การโอนกิจการปิโตรเลียมก่อนวันเริ่มรอบระยะเวลาบัญชีแรก ให้หักต้นทุนได้เท่าจำนวนรายจ่ายเฉพาะส่วนที่เกี่ยวข้องกับการปิโตรเลียมที่โอนของบริษัทผู้โอนที่เกิดขึ้นก่อนวันเริ่มรอบระยะเวลาบัญชีแรกจนถึงวันที่โอน",
  },
  {
    bbox: [80, 398, 901, 433],
    category: "text",
    text: "(2) การโอนกิจการปิโตรเลียมในหรือหลังวันเริ่มรอบระยะเวลาบัญชีแรก ให้หักต้นทุนได้เท่าผลขาดทุนประจำปีคงเหลือตามมาตรา 28 (1) เฉพาะส่วนที่เกี่ยวข้องกับการปิโตรเลียมที่โอนของบริษัทผู้โอนในรอบระยะเวลาบัญชีที่โอน",
  },
  {
    bbox: [80, 437, 898, 473],
    category: "text",
    text: "ข้อ 3 บริษัทผู้โอนต้องแจ้งจำนวนรายจ่ายหรือผลขาดทุนตามข้อ 2 (1) หรือ (2) แล้วแต่กรณีให้แก่บริษัทผู้รับโอนในวันที่โอน ในกรณีที่บริษัทผู้โอนมิได้ปฏิบัติดังกล่าว ให้ถือว่าบริษัทผู้โอนไม่มีรายจ่ายหรือผลขาดทุน",
  },
  { bbox: [115, 478, 611, 493], category: "text", text: "ข้อ 4 ให้บริษัทผู้รับโอนนำส่งภาษีที่หักไว้ตามข้อ 1 ตามแบบที่อธิบดีกรมสรรพากรกำหนด" },
  { bbox: [396, 538, 600, 553], category: "text", text: "ให้ไว้ ณ วันที่ 14 มีนาคม พ.ศ. 2527" },
  { bbox: [441, 560, 556, 574], category: "text", text: "สมหมาย ฮุนตระกูล" },
  { bbox: [406, 579, 592, 594], category: "text", text: "รัฐมนตรีว่าการกระทรวงการคลัง" },
  { bbox: [334, 617, 666, 632], category: "text", text: "(รจ. ฉบับพิเศษ เล่ม 101 ตอนที่ 37 วันที่ 22 มีนาคม 2527)" },
  { bbox: [81, 683, 259, 697], category: "footer", text: "ปรับปรุงล่าสุด: 10-03-2005" },
]);

describe("Requirement 3, 4 & 5 — Real Typhoon V2 Execution, Disable Switch, Simulated Isolation & Failure Handling", () => {
  const prevDisableEnv = process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER;

  afterEach(() => {
    if (prevDisableEnv === undefined) {
      delete process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER;
    } else {
      process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER = prevDisableEnv;
    }
  });

  it("enforces OCR_V2_DISABLE_CONTINUITY_ADAPTER=true across both submitOcrJob and deferred fenced worker execution", () => {
    process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER = "true";
    const svc = createReg24OcrV2Service({ seedFixtures: false });

    const provList = svc.listProviders({ principal: DEFAULT_SYSTEM_OPERATOR });
    expect(provList.status).toBe(200);
    if ("continuity_adapter_active" in provList.body) {
      expect(provList.body.continuity_adapter_active).toBe(false);
    }

    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "dis-reg-1",
      title_th: "กฎกระทรวงทดสอบปิดอะแดปเตอร์จำลอง",
      source_category: "subordinate_legislation",
      privacy_class: "public",
      expected_sha256: REAL_PILOT01_PDF_SHA256,
    });
    expect(reg.status).toBe(201);
    if (!("source_version_id" in reg.body)) throw new Error("unexpected");

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "dis-fin-1",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: REAL_PILOT01_PDF_SHA256,
      actual_mime_type: "application/pdf",
      byte_length: 653474,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: REAL_PILOT01_IMAGE_SHA256,
          width_px: 1696,
          height_px: 2400,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          rendered_reference_text: "MUST NEVER BE RETURNED WHEN CONTINUITY ADAPTER IS DISABLED",
          native_pdf_text: "",
        },
      ],
    });

    // 1) Synchronous submit without real_provider_pages MUST fail 503 FEATURE_DISABLED
    const blockedSync = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "dis-job-sync",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
    });
    expect(blockedSync.status).toBe(503);
    expect((blockedSync.body as { code: string }).code).toBe("FEATURE_DISABLED");

    // 2) Deferred worker execution without real_provider_pages MUST ALSO fail FEATURE_DISABLED inside completeWorkerWithFencing!
    const deferred = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "dis-job-def",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      defer_worker_execution: true,
    });
    expect(deferred.status).toBe(202);
    if (!("job_id" in deferred.body)) throw new Error("unexpected");
    const lease = svc.acquireWorkerLease(deferred.body.job_id);
    expect(lease.ok).toBe(true);
    const completed = svc.completeWorkerWithFencing({
      job_id: deferred.body.job_id,
      fencing_token: lease.fencing_token!,
    });
    expect(completed.job.state).toBe("failed");
    expect(completed.job.error?.code).toBe("FEATURE_DISABLED");
  });

  it("removes hardcoded 0.984 confidence, labels simulated fixtures explicitly, and blocks simulated text from production publication", () => {
    // Production-posture service (`seedFixtures: false` -> `allowSimulatedTestFixtures: false`)
    const prodSvc = createReg24OcrV2Service({ seedFixtures: false });
    const pdfSha = sha256HexLower("sim-isolation-pdf");
    const imgSha = sha256HexLower("sim-isolation-img");

    const reg = prodSvc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sim-reg-1",
      title_th: "ประกาศทดสอบแยกผลจำลอง",
      source_category: "subordinate_legislation",
      privacy_class: "public",
      expected_sha256: pdfSha,
    });
    if (!("source_version_id" in reg.body)) throw new Error("unexpected");

    prodSvc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sim-fin-1",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: pdfSha,
      actual_mime_type: "application/pdf",
      byte_length: 12000,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: imgSha,
          width_px: 1600,
          height_px: 2200,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          rendered_reference_text: "ข้อความอ้างอิงจำลองสำหรับการทดสอบ",
          native_pdf_text: "",
        },
      ],
    });

    const jobRes = prodSvc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sim-job-1",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
    });
    if (!("extraction_version_id" in jobRes.body) || !jobRes.body.extraction_version_id) {
      throw new Error("expected extraction");
    }

    const pagesRes = prodSvc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: reg.body.document_id,
      extraction_version_id: jobRes.body.extraction_version_id,
    });
    if (!("pages" in pagesRes.body)) throw new Error("expected pages");
    const pg = pagesRes.body.pages[0];
    expect(pg.confidence).toBeNull(); // NEVER hardcoded 0.984!
    expect(pg.provenance.is_simulated).toBe(true);
    expect(pg.provenance.usable_as_verified_text).toBe(false);
    expect(pg.provenance.adapter_version).toBe("rag24-simulated-continuity-fixture/2.0.0");

    // Attempt to approve & publish simulated fixture in production-posture service MUST fail 403 POLICY_BLOCKED!
    const state = prodSvc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: reg.body.document_id,
    });
    if (!("current_version" in state.body)) throw new Error("expected state");
    const dv = state.body.current_version;

    const app = prodSvc.submitApproval({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sim-app-1",
      if_match: String(dv.workflow_revision),
      document_id: reg.body.document_id,
      source_version_id: dv.source_version_id,
      extraction_version_id: dv.extraction_version_id,
      annotation_version: dv.annotation_version,
      scopes: ["transcription_checked", "ready_to_publish"],
    });
    if (!("approval_id" in app.body)) throw new Error("expected approval");

    const stateAfterApp = prodSvc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: reg.body.document_id,
    });
    if (!("current_version" in stateAfterApp.body)) throw new Error("expected state");

    const pubAttempt = prodSvc.publishDocumentVersion({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sim-pub-1",
      if_match: String(stateAfterApp.body.current_version.workflow_revision),
      document_id: reg.body.document_id,
      source_version_id: dv.source_version_id,
      extraction_version_id: dv.extraction_version_id,
      annotation_version: dv.annotation_version,
      approval_ids: [app.body.approval_id],
      expected_previous_publication_id: null,
    });
    expect(pubAttempt.status).toBe(403);
    expect((pubAttempt.body as { code: string }).code).toBe("POLICY_BLOCKED");
  });

  it("blocks hosted api.opentyphoon.ai (`typhoon-ocr-v2-hosted`) on confidential & restricted documents while allowing self-hosted `typhoon-ocr2-2b`", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: false });
    const confSha = sha256HexLower("confidential-tax-memo");
    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "conf-reg-1",
      title_th: "บันทึกข้อหารือภาษีภายในองค์กร (ลับ)",
      source_category: "organization_contract",
      privacy_class: "confidential",
      expected_sha256: confSha,
    });
    if (!("source_version_id" in reg.body)) throw new Error("unexpected");

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "conf-fin-1",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: confSha,
      actual_mime_type: "application/pdf",
      byte_length: 8192,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: sha256HexLower("conf-p1"),
          width_px: 1654,
          height_px: 2339,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.02,
          native_pdf_text: "",
        },
      ],
    });

    const hostedAttempt = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "conf-hosted-blocked",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      routing_override_provider_id: "typhoon-ocr-v2-hosted",
    });
    expect(hostedAttempt.status).toBe(403);
    expect((hostedAttempt.body as { code: string }).code).toBe("POLICY_BLOCKED");
  });

  it("executes genuine scanned PILOT-01 (`1984_MR_5`) end-to-end with OCR_V2_DISABLE_CONTINUITY_ADAPTER=true into versioned staging & source-linked retrieval", () => {
    process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER = "true";
    const svc = createReg24OcrV2Service({
      seedFixtures: false,
      flags: { shadow_mode_only: true, ocr_v2_disable_continuity_adapter: true },
    });

    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "real-p01-reg",
      title_th: "กฎกระทรวง ฉบับที่ 5 (พ.ศ. 2527) ออกตามความในพระราชบัญญัติภาษีเงินได้ปิโตรเลียม พ.ศ. 2514",
      title_en: "Ministerial Regulation No. 5 (B.E. 2527) under Petroleum Income Tax Act B.E. 2514",
      source_category: "subordinate_legislation",
      privacy_class: "public",
      expected_sha256: REAL_PILOT01_PDF_SHA256,
    });
    expect(reg.status).toBe(201);
    if (!("source_version_id" in reg.body)) throw new Error("unexpected");

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "real-p01-fin",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: REAL_PILOT01_PDF_SHA256,
      actual_mime_type: "application/pdf",
      byte_length: 653474,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: REAL_PILOT01_IMAGE_SHA256,
          width_px: 1696,
          height_px: 2400,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          native_pdf_text: "",
        },
      ],
    });

    const jobRes = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "real-p01-job",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      routing_override_provider_id: "typhoon-ocr-v2-hosted",
      real_provider_pages: {
        1: {
          provider_id: "typhoon-ocr-v2-hosted",
          model_revision: "typhoon-ocr-v2@vllm-0.33.0-9030f50b",
          raw_response_content: REAL_PILOT01_TYPHOON_V2_JSON,
          raw_response_sha256: REAL_PILOT01_RESPONSE_SHA256,
          raw_response_ref: "opentyphoon:chatcmpl-83e9a241acf424ce",
          format: "typhoon_v2_json",
        },
      },
    });
    expect(jobRes.status).toBe(202);
    if (!("extraction_version_id" in jobRes.body) || !jobRes.body.extraction_version_id) {
      throw new Error("expected real extraction");
    }

    const docState = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: reg.body.document_id,
    });
    if (!("manifest" in docState.body)) throw new Error("expected manifest");
    expect(docState.body.manifest.execution_mode).toBe("real_ocr");
    expect(docState.body.manifest.usable_as_verified_text).toBe(true);

    const pagesRes = svc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: reg.body.document_id,
      extraction_version_id: docState.body.manifest.extraction_version_id,
    });
    if (!("pages" in pagesRes.body)) throw new Error("expected pages");
    const page1 = pagesRes.body.pages[0];

    expect(validateExtractionManifestContractV2(docState.body.manifest, pagesRes.body.pages).valid).toBe(true);
    expect(page1.provenance.is_simulated).toBe(false);
    expect(page1.provenance.usable_as_verified_text).toBe(true);
    expect(page1.provenance.raw_response_sha256).toBe(REAL_PILOT01_RESPONSE_SHA256);
    expect(page1.confidence).toBeNull();
    // Preserves header + footer + real normalized bbox polygon (`[68,80,340,90]` -> `[0.068,0.08,0.34,0.09]`)
    expect(page1.blocks[0].kind).toBe("header");
    expect(page1.blocks[0].span.polygon?.points[0]).toEqual([0.068, 0.08]);
    expect(page1.blocks[page1.blocks.length - 1].kind).toBe("footer");
    expect(page1.raw_text).toContain("รจ. ฉบับพิเศษ เล่ม 101 ตอนที่ 37 วันที่ 22 มีนาคม 2527");

    // Approve transcription & stage into versioned shadow/staging release (`status === "staging"`)
    const dv = docState.body.current_version;
    const appRes = svc.submitApproval({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "real-p01-app",
      if_match: String(dv.workflow_revision),
      document_id: reg.body.document_id,
      source_version_id: dv.source_version_id,
      extraction_version_id: dv.extraction_version_id,
      annotation_version: dv.annotation_version,
      scopes: ["transcription_checked", "ready_to_publish"],
    });
    if (!("approval_id" in appRes.body)) throw new Error("expected approval");

    const docAfterApp = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: reg.body.document_id,
    });
    if (!("current_version" in docAfterApp.body)) throw new Error("expected state");

    // OCR approval sets transcription_status='ocr_verified', NEVER applicability_status='curated'!
    expect(docAfterApp.body.current_version.transcription_status).toBe("ocr_verified");
    expect(docAfterApp.body.current_version.applicability_status).toBe("not_assessed");

    const pubRes = svc.publishDocumentVersion({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "real-p01-pub",
      if_match: String(docAfterApp.body.current_version.workflow_revision),
      document_id: reg.body.document_id,
      source_version_id: dv.source_version_id,
      extraction_version_id: dv.extraction_version_id,
      annotation_version: dv.annotation_version,
      approval_ids: [appRes.body.approval_id],
      expected_previous_publication_id: null,
    });
    expect(pubRes.status).toBe(201);
    if (!("status" in pubRes.body)) throw new Error("expected publication");
    expect(pubRes.body.status).toBe("staging"); // Isolated staging, NOT production active!
  });

  it("handles malformed provider JSON, merged HTML Gazette tables, and dual-OCR negation disagreements (`มิใช่` vs `มีใช้`) safely", () => {
    // 1) Malformed / truncated JSON from provider -> blocking issue, never silently blank!
    const badJson = parseTyphoonV2StructuredResponse({
      documentId: "doc.bad.json",
      pageNumber: 1,
      imageSha256: REAL_PILOT01_IMAGE_SHA256,
      rawContent: '[{"bbox":[80,100,900,200],"category":"text","text":"มาตรา ๑',
    });
    expect(badJson.issues.some((i) => i.code === "MALFORMED_PROVIDER_JSON_OUTPUT" && i.severity === "blocking")).toBe(
      true
    );

    // 2) Merged Gazette HTML tariff table (`PILOT-06` pattern) -> `partial` structure + blocking review gate
    const tblParsed = parseTyphoonV2StructuredResponse({
      documentId: "doc.tbl.gazette",
      pageNumber: 1,
      imageSha256: REAL_PILOT01_IMAGE_SHA256,
      rawContent: JSON.stringify([
        {
          bbox: [120, 505, 885, 860],
          category: "table",
          text: '<table><tr><th rowspan="3">ประเภทที่</th><th rowspan="3">รายการ</th><th colspan="3">อัตราภาษี</th></tr><tr><th rowspan="2">ตามมูลค่า ร้อยละ</th><th colspan="2">ตามปริมาณ</th></tr><tr><th>หน่วย</th><th>หน่วยละ-บาท</th></tr><tr><td>๐๑.๐๕</td><td>(๘) น้ำมันดีเซลกำมะถันไม่เกินร้อยละ ๐.๐๐๕</td><td>๐</td><td>ลิตร</td><td>๐</td></tr></table>',
        },
      ]),
    });
    expect(tblParsed.tables.length).toBe(1);
    expect(tblParsed.tables[0].structure_status).toBe("partial");
    expect(tblParsed.issues.some((i) => i.code === "UNCERTAIN_TABLE_STRUCTURE_MERGED_CELLS")).toBe(true);

    // 3) Dual-OCR statutory negation disagreement (`PILOT-08` empirical catch: `ที่มีใช้ธนาคาร` vs `ที่มิใช่ธนาคาร`)
    const svc = createReg24OcrV2Service({ seedFixtures: false });
    const p8Sha = sha256HexLower("pilot-08-mr-186");
    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "p08-reg",
      title_th: "กฎกระทรวง ฉบับที่ 186 (พ.ศ. 2534)",
      source_category: "subordinate_legislation",
      privacy_class: "public",
      expected_sha256: p8Sha,
    });
    if (!("source_version_id" in reg.body)) throw new Error("unexpected");
    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "p08-fin",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: p8Sha,
      actual_mime_type: "application/pdf",
      byte_length: 120000,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: REAL_PILOT01_IMAGE_SHA256,
          width_px: 1375,
          height_px: 2042,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          native_pdf_text: "",
        },
      ],
    });

    const p8Job = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "p08-job",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      real_provider_pages: {
        1: {
          provider_id: "typhoon-ocr2-2b",
          model_revision: "3ea2e5e3d92bf999a64e82a92b11c7b73eae45b0",
          raw_response_content: JSON.stringify([
            {
              bbox: [60, 280, 880, 420],
              category: "text",
              text: "บริษัทหรือห้างหุ้นส่วนนิติบุคคลอื่นที่มีใช้ธนาคาร ในกรณีหนี้ไม่เกิน ๑๐๐,๐๐๐ บาท เว้นแต่กรณีตามข้อ ๕ (๒)",
            },
          ]),
          raw_response_sha256: sha256HexLower("p08-v2"),
          format: "typhoon_v2_json",
          secondary_comparison_text:
            "บริษัทหรือห้างหุ้นส่วนนิติบุคคลอื่นที่มิใช่ธนาคาร ในกรณีหนี้ไม่เกิน ๑๐๐,๐๐๐ บาท เว้นแต่กรณีตามข้อ ๕ (๒)",
        },
      },
    });
    expect(p8Job.status).toBe(202);
    if (!("state" in p8Job.body)) throw new Error("unexpected");
    expect(p8Job.body.state).toBe("review_required"); // Automatically routed to human review due to `มิใช่` vs `มีใช้`!
  });
});
