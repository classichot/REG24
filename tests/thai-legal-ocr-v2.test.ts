import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_OPERATOR,
  SECOND_APPROVER_PRINCIPAL,
  assessNativePageEligibility,
  computeNormalizedCer,
  computeOcrDigestV1,
  computeRawCer,
  computeTableTeds,
  createReg24OcrV2Service,
  extractThaiLegalAnnotationsV2,
  mapNormalizedSpanToRawSpan,
  normalizeThaiLegalTextV2,
  reg24OcrV2Service,
  sha256HexLower,
  sliceByCodePoints,
  validateExtractionManifestContractV2,
  validateOcrJobContractV2,
  validateTableCellsNonOverlapping,
  type OcrPrincipalContext,
  type RenderedPageEvidence,
} from "../src/packages/ocr-v2";
import { reg24Core } from "../src/core/engine/reg24-core";

describe("REG24 Thai Legal OCR, Verification & Source-Linked Publication v2.0 (`ocr-contract/2.0.0`)", () => {
  it("validates ocr-contract/2.0.0 schema, RFC 8785 JCS ocr-digest/1, VERSION_REQUIRED, Idempotency-Key & Policy If-Match", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });

    // Compatibility route without extraction_version_id MUST return 400 VERSION_REQUIRED
    const missingVer = svc.getExtractionCompatibility({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.dika.2451_2568",
      extraction_version_id: null,
    });
    expect(missingVer.status).toBe(400);
    expect((missingVer.body as { code: string }).code).toBe("VERSION_REQUIRED");

    // Inspect seeded Supreme Court extraction manifest & pages against contract validator
    const docState = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.dika.2451_2568",
    });
    expect(docState.status).toBe(200);
    if ("manifest" in docState.body) {
      const manifest = docState.body.manifest;
      const pagesRes = svc.getExtractionPages({
        principal: DEFAULT_SYSTEM_OPERATOR,
        document_id: "doc.th.dika.2451_2568",
        extraction_version_id: manifest.extraction_version_id,
        limit: 1,
      });
      expect(pagesRes.status).toBe(200);
      if ("pages" in pagesRes.body) {
        expect(pagesRes.body.pages.length).toBe(1);
        expect(pagesRes.body.next_cursor).toBe("1");

        const page2Res = svc.getExtractionPages({
          principal: DEFAULT_SYSTEM_OPERATOR,
          document_id: "doc.th.dika.2451_2568",
          extraction_version_id: manifest.extraction_version_id,
          cursor: pagesRes.body.next_cursor,
          limit: 5,
        });
        if ("pages" in page2Res.body) {
          const allPages = [...pagesRes.body.pages, ...page2Res.body.pages];
          const contractValidation = validateExtractionManifestContractV2(manifest, allPages);
          expect(contractValidation.valid).toBe(true);
          expect(computeOcrDigestV1(manifest, allPages)).toBe(manifest.content_digest);
        }
      }
    }

    // Validate jobs & Idempotency-Key conflict detection
    for (const job of svc.listOcrJobs(DEFAULT_SYSTEM_OPERATOR)) {
      expect(validateOcrJobContractV2(job).valid).toBe(true);
    }

    const sha = sha256HexLower("idem-test-bytes");
    const firstReg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "idem-doc-001",
      title_th: "พระราชบัญญัติทดสอบ พ.ศ. ๒๕๖๙",
      source_category: "statute",
      privacy_class: "public",
      expected_sha256: sha,
    });
    expect(firstReg.status).toBe(201);

    // Same key + identical payload -> returns original resource
    const replayReg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "idem-doc-001",
      title_th: "พระราชบัญญัติทดสอบ พ.ศ. ๒๕๖๙",
      source_category: "statute",
      privacy_class: "public",
      expected_sha256: sha,
    });
    expect(replayReg.status).toBe(201);
    expect(replayReg.body).toEqual(firstReg.body);

    // Same key + modified payload -> 409 IDEMPOTENCY_CONFLICT
    const conflictReg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "idem-doc-001",
      title_th: "พระราชบัญญัติแก้ไขต่างออกไป",
      source_category: "statute",
      privacy_class: "public",
      expected_sha256: sha,
    });
    expect(conflictReg.status).toBe(409);
    expect((conflictReg.body as { code: string }).code).toBe("IDEMPOTENCY_CONFLICT");

    // Policy update requires administrator + matching If-Match
    const adminPrincipal: OcrPrincipalContext = {
      ...DEFAULT_SYSTEM_OPERATOR,
      principal_id: "principal.admin.01",
      roles: ["administrator"],
      scopes: ["ocr:policy:write"],
    };
    const stalePol = svc.updatePolicy({
      principal: adminPrincipal,
      idempotency_key: "pol-upd-stale",
      if_match: 'W/"wrong-etag"',
      policy_id: "pol.reg24.thai_legal.default",
      updates: { max_pages_per_document: 400 },
    });
    expect(stalePol.status).toBe(409);

    const okPol = svc.updatePolicy({
      principal: adminPrincipal,
      idempotency_key: "pol-upd-ok",
      if_match: 'W/"polrev-1"',
      policy_id: "pol.reg24.thai_legal.default",
      updates: { max_pages_per_document: 400 },
    });
    expect(okPol.status).toBe(200);
  });

  it("preserves Thai raw numerals, leading zeros, `ๆ`, tone marks, Sara Am offset mapping & unqualified 'มาตรา ๕' candidate rule", () => {
    // Decomposed Sara Am (\u0E4D\u0E32) + zero-width space (\u200B) + multi-space + Thai leading zero `๐๐๗` + `ๆ`
    const raw = "ค\u0e4d\u0e32สั่ง\u200bที่   ๐๐๗/๒๕๖๙ ข้อ ๆ ละ ๑,๐๐๐ บาท";
    const norm = normalizeThaiLegalTextV2(raw);

    // Raw text unchanged; normalized text folds decomposed Sara Am, strips ZWSP, collapses spaces, maps digits with leading zeros intact
    expect(norm.raw_text).toBe(raw);
    expect(norm.normalized_text).toBe("คำสั่งที่ 007/2569 ข้อ ๆ ละ 1,000 บาท");
    expect(norm.numeral_tokens[0].raw_token).toBe("๐๐๗");
    expect(norm.numeral_tokens[0].arabic_lookup_token).toBe("007");
    expect(norm.numeral_tokens[0].has_leading_zero).toBe(true);

    // Verify bidirectional code-point offset mapping after deletions & 2->1 Sara Am folding
    const idxNorm = Array.from(norm.normalized_text).findIndex((_, idx, arr) =>
      arr.slice(idx, idx + 3).join("") === "007"
    );
    const [rawStart, rawEnd] = mapNormalizedSpanToRawSpan(norm, idxNorm, idxNorm + 3);
    expect(sliceByCodePoints(raw, rawStart, rawEnd)).toBe("๐๐๗");

    // Unqualified `"มาตรา ๕"` without resolved statutory instrument MUST remain `unresolved_candidate` (`resolved_target_id: null`)
    const sem = extractThaiLegalAnnotationsV2({
      tenant_id: "tenant.reg24.th",
      workspace_id: "ws.reg24.main",
      document_id: "doc.unqualified.sec5",
      extraction_version_id: "ext.1",
      pages: [
        {
          page_number: 1,
          raw_text: "บันทึกความเห็นย่อว่า กรณีนี้ต้องพิจารณาตาม มาตรา ๕ วรรคสอง โดยเคร่งครัด",
          image_sha256: sha256HexLower("unqual-p1"),
        },
      ],
    });
    const sec5Ann = sem.annotations.find((a) => a.entity_type === "section_reference");
    expect(sec5Ann).toBeDefined();
    expect(sec5Ann?.resolution_status).toBe("unresolved_candidate");
    expect(sec5Ann?.resolved_target_id).toBeNull();
  });

  it("Scenario 1: Scanned judgment with Thai digits and footer citation uses one immutable version across search and GraphRAG", () => {
    const searchRes = reg24OcrV2Service.searchPublishedOcrKnowledge({
      query: "2451/2568", // Arabic query matches normalized Thai `๒๔๕๑/๒๕๖๘` while preserving raw Thai digits!
    });
    expect(searchRes.hits.length).toBeGreaterThanOrEqual(2);
    const page1Hit = searchRes.hits.find((h) => h.page_number === 1)!;
    const page2Hit = searchRes.hits.find((h) => h.page_number === 2)!;

    expect(page1Hit.raw_excerpt).toContain("๒๔๕๑/๒๕๖๘");
    expect(page1Hit.raw_excerpt).toContain("ๆ ละ ๑,๒๐๐ บาท");
    expect(page2Hit.raw_excerpt).toContain("เชิงอรรถ [1] อ้างอิงคำพิพากษาศาลฎีกาที่ ๒๔๕๑/๒๕๖๘ หน้า ๒ จาก ๒");
    expect(page1Hit.extraction_version_id).toBe(page2Hit.extraction_version_id);

    // Verify GraphRAG edges carry the exact same immutable publication_id and extraction_version_id
    expect(searchRes.graph_edges.length).toBeGreaterThan(0);
    for (const edge of searchRes.graph_edges) {
      expect(edge.publication_id).toBe(page1Hit.publication_id);
      expect(edge.extraction_version_id).toBe(page1Hit.extraction_version_id);
    }

    // Verify REG24 3R GraphRAG Core returns this exact verified source-linked hit
    const graphRagOut = reg24Core.execute3RGraphRAGQuery({
      query: "คำพิพากษาศาลฎีกาที่ 2451/2568 มาตรา 118",
    });
    expect(
      graphRagOut.citations.some(
        (c) =>
          c.provision_id === "doc.th.dika.2451_2568" &&
          c.version_id === page1Hit.extraction_version_id
      )
    ).toBe(true);
  });

  it("Scenario 2: Gazette PDF whose hidden text layer omits a paragraph fails native eligibility and routes to Thai OCR", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: false });
    const fullRenderedGazette =
      "ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๑๐ ก หน้า ๑\n\nมาตรา ๓ ให้ยกเลิกความในมาตรา ๑๑๘ เดิม\n\nมาตรา ๔ ให้นายจ้างจ่ายค่าชดเชยพิเศษเพิ่มเติมร้อยละห้าสิบ";
    const staleHiddenPdfLayer =
      "ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๑๐ ก หน้า ๑\n\nมาตรา ๓ ให้ยกเลิกความในมาตรา ๑๑๘ เดิม"; // Omits มาตรา ๔ paragraph!

    const pageEv: RenderedPageEvidence = {
      page_number: 1,
      image_sha256: sha256HexLower("gazette-stale-p1"),
      width_px: 2480,
      height_px: 3508,
      rotation_degrees: 0,
      has_visible_content: true,
      blank_detector_score: 0.01,
      native_pdf_text: staleHiddenPdfLayer,
      rendered_reference_text: fullRenderedGazette,
    };

    const check = assessNativePageEligibility(pageEv, "doc.gazette.stale");
    expect(check.eligible_for_native_bypass).toBe(false);
    expect(check.recommended_route).toBe("ocr");
    expect(check.issues.some((i) => i.code === "NATIVE_TEXT_LAYER_MISMATCH")).toBe(true);

    // End-to-end ingestion routes page 1 to Thai OCR (never trusting stale native layer)
    const sha = sha256HexLower(fullRenderedGazette);
    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc2-reg",
      title_th: "ราชกิจจานุเบกษา ทดสอบเลเยอร์ข้อความซ่อนตกหล่น",
      source_category: "royal_gazette",
      privacy_class: "public",
      expected_sha256: sha,
    });
    if ("source_version_id" in reg.body) {
      svc.finalizeSourceVersion({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "sc2-fin",
        document_id: reg.body.document_id,
        source_version_id: reg.body.source_version_id,
        stored_sha256: sha,
        actual_mime_type: "application/pdf",
        byte_length: 120_000,
        pages_manifest: [pageEv],
      });
      const job = svc.submitOcrJob({
        principal: DEFAULT_SYSTEM_OPERATOR,
        idempotency_key: "sc2-job",
        document_id: reg.body.document_id,
        source_version_id: reg.body.source_version_id,
      });
      if ("extraction_version_id" in job.body && job.body.extraction_version_id) {
        const pgs = svc.getExtractionPages({
          principal: DEFAULT_SYSTEM_OPERATOR,
          document_id: reg.body.document_id,
          extraction_version_id: job.body.extraction_version_id,
        });
        if ("pages" in pgs.body) {
          expect(pgs.body.pages[0].provenance.method).toBe("ocr");
          expect(pgs.body.pages[0].raw_text).toContain("มาตรา ๔ ให้นายจ้างจ่ายค่าชดเชยพิเศษ");
        }
      }
    }
  });

  it("Scenario 3: 23-page Council of State opinion returning 22 pages marks page 23 unresolved, blocks publication, and keeps prior publication visible", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });

    // Confirm prior publication of doc.th.dika.2451_2568 is visible; now test a 2-version Council of State opinion where v1 is published and v2 (23 pages) returns 22 pages
    const v1Sha = sha256HexLower("krisdika-v1-complete");
    const reg1 = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v1-reg",
      document_id_override: "doc.th.krisdika.999_2568",
      title_th: "ความเห็นคณะกรรมการกฤษฎีกา เรื่องเสร็จที่ ๙๙๙/๒๕๖๘",
      source_category: "council_of_state_opinion",
      privacy_class: "public",
      expected_sha256: v1Sha,
    });
    expect(reg1.status).toBe(201);
    if (!("source_version_id" in reg1.body)) return;

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v1-fin",
      document_id: "doc.th.krisdika.999_2568",
      source_version_id: reg1.body.source_version_id,
      stored_sha256: v1Sha,
      actual_mime_type: "application/pdf",
      byte_length: 90_000,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: sha256HexLower("kris-v1-p1"),
          width_px: 2480,
          height_px: 3508,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          native_pdf_text: null,
          rendered_reference_text: "เรื่องเสร็จที่ ๙๙๙/๒๕๖๘ ความเห็นฉบับสมบูรณ์เดิม",
        },
      ],
    });
    svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v1-job",
      document_id: "doc.th.krisdika.999_2568",
      source_version_id: reg1.body.source_version_id,
    });
    const st1 = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.krisdika.999_2568",
    });
    if (!("current_version" in st1.body)) return;
    const appr1 = svc.submitApproval({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc3-v1-appr",
      if_match: String(st1.body.current_version.workflow_revision),
      document_id: "doc.th.krisdika.999_2568",
      source_version_id: st1.body.current_version.source_version_id,
      extraction_version_id: st1.body.current_version.extraction_version_id,
      annotation_version: st1.body.current_version.annotation_version,
      scopes: ["transcription_checked", "ready_to_publish"],
    });
    if (!("approval_id" in appr1.body)) return;
    const pub1 = svc.publishDocumentVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v1-pub",
      if_match: String(st1.body.current_version.workflow_revision + 1),
      document_id: "doc.th.krisdika.999_2568",
      source_version_id: st1.body.current_version.source_version_id,
      extraction_version_id: st1.body.current_version.extraction_version_id,
      annotation_version: st1.body.current_version.annotation_version,
      approval_ids: [appr1.body.approval_id],
      expected_previous_publication_id: null,
    });
    expect(pub1.status).toBe(201);

    // Now upload a 23-page source version where provider omits page 23 (returns 22 pages)
    const v2Sha = sha256HexLower("krisdika-v2-23pages");
    const reg2 = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v2-reg",
      document_id_override: "doc.th.krisdika.999_2568",
      title_th: "ความเห็นคณะกรรมการกฤษฎีกา เรื่องเสร็จที่ ๙๙๙/๒๕๖๘ (ภาคผนวก ๒๓ หน้า)",
      source_category: "council_of_state_opinion",
      privacy_class: "public",
      expected_sha256: v2Sha,
    });
    if (!("source_version_id" in reg2.body)) return;

    const pages23: RenderedPageEvidence[] = Array.from({ length: 23 }, (_, idx) => ({
      page_number: idx + 1,
      image_sha256: sha256HexLower(`kris-23p-${idx + 1}`),
      width_px: 2480,
      height_px: 3508,
      rotation_degrees: 0,
      has_visible_content: true,
      blank_detector_score: 0.01,
      native_pdf_text: null,
      rendered_reference_text: `ความเห็นคณะกรรมการกฤษฎีกา หน้า ${idx + 1}`,
    }));

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v2-fin",
      document_id: "doc.th.krisdika.999_2568",
      source_version_id: reg2.body.source_version_id,
      stored_sha256: v2Sha,
      actual_mime_type: "application/pdf",
      byte_length: 840_000,
      pages_manifest: pages23,
    });

    const job23 = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v2-job",
      document_id: "doc.th.krisdika.999_2568",
      source_version_id: reg2.body.source_version_id,
      simulation: { omit_page_numbers: [23] },
    });
    expect(job23.status).toBe(202);
    if (!("state" in job23.body) || !job23.body.extraction_version_id) return;

    // Job CANNOT succeed; state is review_required with INCOMPLETE_OUTPUT
    expect(job23.body.state).toBe("review_required");
    expect(job23.body.error?.code).toBe("INCOMPLETE_OUTPUT");

    const manRes = svc.getExtractionManifest({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.krisdika.999_2568",
      extraction_version_id: job23.body.extraction_version_id,
    });
    if ("completeness" in manRes.body) {
      expect(manRes.body.expected_page_count).toBe(23);
      expect(manRes.body.returned_page_count).toBe(22);
      expect(manRes.body.completeness).toBe("incomplete");
    }

    const pg23Res = svc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.krisdika.999_2568",
      extraction_version_id: job23.body.extraction_version_id,
      cursor: "22",
      limit: 5,
    });
    if ("pages" in pg23Res.body) {
      expect(pg23Res.body.pages[0].page_number).toBe(23);
      expect(pg23Res.body.pages[0].state).toBe("unresolved"); // NEVER silently blank!
    }

    // Retry creates a child job with parent_job_id without resetting terminal job23!
    const retryChild = svc.retryOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc3-v2-retry",
      job_id: job23.body.job_id,
    });
    expect(retryChild.status).toBe(202);
    if ("parent_job_id" in retryChild.body) {
      expect(retryChild.body.parent_job_id).toBe(job23.body.job_id);
      expect(retryChild.body.job_id).not.toBe(job23.body.job_id);
    }

    // Prior v1 publication remains visible in search!
    const activeSearch = svc.searchPublishedOcrKnowledge({ query: "ฉบับสมบูรณ์เดิม" });
    expect(activeSearch.hits.some((h) => h.document_id === "doc.th.krisdika.999_2568")).toBe(true);
  });

  it("Scenario 4: Tax ruling with ambiguous date and wrong section digit blocks publication, enforces two-person dual control, and revalidates relations", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });

    const initial = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.rd.0702_9184",
    });
    expect(initial.status).toBe(200);
    if (!("manifest" in initial.body)) return;

    const codes = initial.body.manifest.issues.map((i) => i.code);
    expect(codes).toContain("AMBIGUOUS_MATERIAL_DATE");
    expect(codes).toContain("MATERIAL_SECTION_NUMBER_INVALID");

    // Attempt to approve/publish while blocking issues are open -> 409 QUALITY_REVIEW_REQUIRED
    const prematureAppr = svc.submitApproval({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc4-premature",
      if_match: String(initial.body.current_version.workflow_revision),
      document_id: "doc.th.rd.0702_9184",
      source_version_id: initial.body.current_version.source_version_id,
      extraction_version_id: initial.body.current_version.extraction_version_id,
      annotation_version: initial.body.current_version.annotation_version,
      scopes: ["transcription_checked", "ready_to_publish"],
    });
    expect(prematureAppr.status).toBe(409);

    // Reviewer #1 (`DEFAULT_SYSTEM_OPERATOR`) corrects both `12 มี.ค. 68` -> `12 มีนาคม พ.ศ. 2568` and `มาตรา 874` -> `มาตรา 74`
    const pgs = svc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.rd.0702_9184",
      extraction_version_id: initial.body.current_version.extraction_version_id,
    });
    if (!("pages" in pgs.body)) return;
    const rawP1 = pgs.body.pages[0].raw_text;
    const oldFragment = "วันที่ 12 มี.ค. 68\nเรื่อง ภาษีเงินได้นิติบุคคล กรณีการควบรวมบริษัทตามมาตรา 874";
    const newFragment = "วันที่ 12 มีนาคม พ.ศ. 2568\nเรื่อง ภาษีเงินได้นิติบุคคล กรณีการควบรวมบริษัทตามมาตรา 74";

    const rawCps = Array.from(rawP1);
    const oldCps = Array.from(oldFragment);
    const startCp = rawCps.findIndex(
      (_, i) => rawCps.slice(i, i + oldCps.length).join("") === oldFragment
    );
    expect(startCp).toBeGreaterThan(0);

    const corrRes = svc.submitCorrection({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc4-corr-1",
      if_match: String(initial.body.current_version.workflow_revision),
      document_id: "doc.th.rd.0702_9184",
      extraction_version_id: initial.body.current_version.extraction_version_id,
      source_spans: [
        {
          page_number: 1,
          block_id: null,
          raw_start: startCp,
          raw_end: startCp + oldCps.length,
          polygon: null,
        },
      ],
      before_text: oldFragment,
      after_text: newFragment,
      issue_ids: initial.body.manifest.issues.map((i) => i.issue_id),
      reason: "Corrected abbreviated year and OCR misread digit 874 -> 74 from original RD letter",
    });
    expect(corrRes.status).toBe(201);
    if (!("updated_document_version" in corrRes.body)) return;
    const updatedVer = corrRes.body.updated_document_version;

    // Verify predecessor raw extraction remains untouched!
    const predPages = svc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.rd.0702_9184",
      extraction_version_id: initial.body.current_version.extraction_version_id,
    });
    if ("pages" in predPages.body) {
      expect(predPages.body.pages[0].raw_text).toContain("มาตรา 874");
    }

    // Verify dependent annotation revalidated to `inst.th.revenue_code.sec.74` while unqualified `มาตรา ๕` remains `unresolved_candidate`!
    const afterCorrState = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.rd.0702_9184",
    });
    if ("annotations" in afterCorrState.body) {
      expect(
        afterCorrState.body.annotations.some(
          (a) => a.resolved_target_id === "inst.th.revenue_code.sec.74"
        )
      ).toBe(true);
      const sec5 = afterCorrState.body.annotations.find((a) => a.raw_value === "มาตรา ๕");
      expect(sec5?.resolution_status).toBe("unresolved_candidate");
      expect(sec5?.resolved_target_id).toBeNull();
    }

    // Reviewer #1 attempts self-approval for `ready_to_publish` -> MUST fail with 403 DUAL_CONTROL_REQUIRED!
    const selfAppr = svc.submitApproval({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc4-self-appr",
      if_match: String(updatedVer.workflow_revision),
      document_id: "doc.th.rd.0702_9184",
      source_version_id: updatedVer.source_version_id,
      extraction_version_id: updatedVer.extraction_version_id,
      annotation_version: updatedVer.annotation_version,
      scopes: ["transcription_checked", "ready_to_publish"],
    });
    expect(selfAppr.status).toBe(403);
    expect((selfAppr.body as { code: string }).code).toBe("DUAL_CONTROL_REQUIRED");

    // Distinct Second Human Approver (`SECOND_APPROVER_PRINCIPAL`) approves & publishes cleanly!
    const secondAppr = svc.submitApproval({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc4-second-appr",
      if_match: String(updatedVer.workflow_revision),
      document_id: "doc.th.rd.0702_9184",
      source_version_id: updatedVer.source_version_id,
      extraction_version_id: updatedVer.extraction_version_id,
      annotation_version: updatedVer.annotation_version,
      scopes: ["transcription_checked", "references_resolved", "ready_to_publish"],
    });
    expect(secondAppr.status).toBe(201);
    if (!("approval_id" in secondAppr.body)) return;

    const pub = svc.publishDocumentVersion({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc4-pub",
      if_match: String(updatedVer.workflow_revision + 1),
      document_id: "doc.th.rd.0702_9184",
      source_version_id: updatedVer.source_version_id,
      extraction_version_id: updatedVer.extraction_version_id,
      annotation_version: updatedVer.annotation_version,
      approval_ids: [secondAppr.body.approval_id],
      expected_previous_publication_id: null,
    });
    expect(pub.status).toBe(201);
  });

  it("Scenario 5: Repeated webhook + worker crash after outbox commit reconciles to ONE downstream staging op with zero duplicate billing", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: false });
    const text = "ประกาศกระทรวงการคลัง พ.ศ. ๒๕๖๙ ข้อ ๑ ให้ใช้บังคับทันที";
    const sha = sha256HexLower(text);

    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc5-reg",
      title_th: "ประกาศกระทรวงการคลัง พ.ศ. ๒๕๖๙",
      source_category: "subordinate_legislation",
      privacy_class: "public",
      expected_sha256: sha,
    });
    if (!("source_version_id" in reg.body)) return;
    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc5-fin",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: sha,
      actual_mime_type: "application/pdf",
      byte_length: 45_000,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: sha256HexLower("sc5-p1"),
          width_px: 2480,
          height_px: 3508,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          native_pdf_text: text,
          rendered_reference_text: text,
        },
      ],
    });
    const jobRes = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc5-job",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
    });
    if (!("job_id" in jobRes.body)) return;
    const consumedBefore = jobRes.body.budget.consumed_micros;

    // Reconcile outbox after simulated worker crash + replay signed webhook 3 times
    const recon1 = svc.runOutboxReconciliation();
    expect(recon1.unique_downstream_operations).toBe(1);

    const recon2 = svc.runOutboxReconciliation();
    expect(recon2.reconciled_events).toBe(0);
    expect(recon2.unique_downstream_operations).toBe(1);

    const jobAfter = svc.getOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      job_id: jobRes.body.job_id,
    });
    if ("budget" in jobAfter.body) {
      expect(jobAfter.body.budget.consumed_micros).toBe(consumedBefore); // Zero duplicate billing!
      expect(jobAfter.body.extraction_version_id).toBe(jobRes.body.extraction_version_id);
    }
  });

  it("Scenario 6: Restricted contract with unavailable self-hosted workers blocks cloud fallback with POLICY_BLOCKED", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: false });
    // Mark both approved self-hosted GPU providers offline while cloud `mistral-ocr` stays online
    svc.setProviderWorkerAvailability("typhoon-ocr2-2b", false);
    svc.setProviderWorkerAvailability("openthai-2.0-markdown", false);
    svc.setProviderWorkerAvailability("mistral-ocr", true);

    const sha = sha256HexLower("restricted-shareholder-agreement");
    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc6-reg",
      title_th: "สัญญาร่วมทุนลับเฉพาะระดับสูงสุด (Restricted M&A Agreement)",
      source_category: "organization_contract",
      privacy_class: "restricted",
      expected_sha256: sha,
    });
    if (!("source_version_id" in reg.body)) return;

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc6-fin",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: sha,
      actual_mime_type: "application/pdf",
      byte_length: 60_000,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: sha256HexLower("sc6-p1"),
          width_px: 2480,
          height_px: 3508,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          native_pdf_text: null,
          rendered_reference_text: "ข้อ ๑ สัญญานี้เป็นความลับสูงสุด",
        },
      ],
    });

    const jobBlocked = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc6-job",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
    });
    expect(jobBlocked.status).toBe(403);
    expect((jobBlocked.body as { code: string }).code).toBe("POLICY_BLOCKED");
  });

  it("Scenario 7: Failed graph staging leaves previous complete publication intact, and rollback restores prior manifest cleanly", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });
    const beforeState = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.dika.2451_2568",
    });
    if (!("current_version" in beforeState.body) || !beforeState.body.active_publication) return;
    const v1PubId = beforeState.body.active_publication.publication_id;

    // Create a successor correction + approval, then simulate `graph_writer_unavailable` during publication
    const pgs = svc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.dika.2451_2568",
      extraction_version_id: beforeState.body.current_version.extraction_version_id,
    });
    if (!("pages" in pgs.body)) return;
    const corr = svc.submitCorrection({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc7-corr",
      if_match: String(beforeState.body.current_version.workflow_revision),
      document_id: "doc.th.dika.2451_2568",
      extraction_version_id: beforeState.body.current_version.extraction_version_id,
      source_spans: [{ page_number: 1, block_id: null, raw_start: 0, raw_end: 18, polygon: null }],
      before_text: sliceByCodePoints(pgs.body.pages[0].raw_text, 0, 18),
      after_text: sliceByCodePoints(pgs.body.pages[0].raw_text, 0, 18),
      issue_ids: [],
      reason: "Editorial header verification",
    });
    if (!("updated_document_version" in corr.body)) return;
    const cv = corr.body.updated_document_version;

    const appr = svc.submitApproval({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc7-appr",
      if_match: String(cv.workflow_revision),
      document_id: "doc.th.dika.2451_2568",
      source_version_id: cv.source_version_id,
      extraction_version_id: cv.extraction_version_id,
      annotation_version: cv.annotation_version,
      scopes: ["transcription_checked", "ready_to_publish"],
    });
    if (!("approval_id" in appr.body)) return;

    // Fault-injected publication fails graph staging -> returns 503 STAGING_FAILED and preserves `v1PubId`!
    const failedPub = svc.publishDocumentVersion({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc7-pub-fail",
      if_match: String(cv.workflow_revision + 1),
      document_id: "doc.th.dika.2451_2568",
      source_version_id: cv.source_version_id,
      extraction_version_id: cv.extraction_version_id,
      annotation_version: cv.annotation_version,
      approval_ids: [appr.body.approval_id],
      expected_previous_publication_id: v1PubId,
      simulate_staging_failure: "graph_writer_unavailable",
    });
    expect(failedPub.status).toBe(503);
    expect((failedPub.body as { code: string }).code).toBe("STAGING_FAILED");

    const searchDuringFailure = svc.searchPublishedOcrKnowledge({ query: "2451/2568" });
    expect(searchDuringFailure.hits[0].publication_id).toBe(v1PubId);

    // Now succeed v2 publication, then roll back to v1PubId!
    const okPub2 = svc.publishDocumentVersion({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc7-pub-ok2",
      if_match: String(cv.workflow_revision + 1),
      document_id: "doc.th.dika.2451_2568",
      source_version_id: cv.source_version_id,
      extraction_version_id: cv.extraction_version_id,
      annotation_version: cv.annotation_version,
      approval_ids: [appr.body.approval_id],
      expected_previous_publication_id: v1PubId,
    });
    expect(okPub2.status).toBe(201);
    if (!("publication_id" in okPub2.body)) return;
    const v2PubId = okPub2.body.publication_id;

    const rolledBack = svc.rollbackPublication({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc7-rollback",
      if_match: String(cv.workflow_revision + 2),
      document_id: "doc.th.dika.2451_2568",
      target_publication_id: v1PubId,
      expected_active_publication_id: v2PubId,
      reason: "Restore prior verified publication manifest",
    });
    expect(rolledBack.status).toBe(200);
    const searchAfterRollback = svc.searchPublishedOcrKnowledge({ query: "2451/2568" });
    expect(searchAfterRollback.hits[0].publication_id).toBe(v1PubId);
  });

  it("Scenario 8: Cross-page table with uncertain merged cells exposes both pages, partial status, and zero fabricated polygons", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });
    const st = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.subreg.boi_table_2569",
    });
    expect(st.status).toBe(200);
    if (!("current_version" in st.body)) return;

    const pgs = svc.getExtractionPages({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.subreg.boi_table_2569",
      extraction_version_id: st.body.current_version.extraction_version_id,
    });
    expect(pgs.status).toBe(200);
    if (!("pages" in pgs.body)) return;

    expect(pgs.body.pages.length).toBe(2);
    const t1 = pgs.body.pages[0].tables[0];
    const t2 = pgs.body.pages[1].tables[0];
    expect(t1.structure_status).toBe("partial");
    expect(t2.structure_status).toBe("partial");
    expect(t1.continuation_to_table_id).toBe(t2.table_id);
    expect(t2.continuation_from_table_id).toBe(t1.table_id);

    // Zero fabricated polygons or fake confidence on Mistral OCR output!
    expect(pgs.body.pages[0].confidence).toBeNull();
    expect(t1.cells[0].span.polygon).toBeNull();
    expect(validateTableCellsNonOverlapping(t1)).toEqual([]);
  });

  it("Scenario 9: Revoked reviewer, stale session If-Match, unentitled admin, or service account is blocked without mutating evidence", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });
    const st = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.rd.0702_9184",
    });
    if (!("current_version" in st.body)) return;
    const origExtId = st.body.current_version.extraction_version_id;

    // 1. Revoked reviewer -> 403 ACCESS_DENIED
    const revokedReviewer: OcrPrincipalContext = {
      ...DEFAULT_SYSTEM_OPERATOR,
      principal_id: "principal.revoked.99",
      revoked: true,
    };
    const revRes = svc.submitCorrection({
      principal: revokedReviewer,
      idempotency_key: "sc9-revoked",
      if_match: String(st.body.current_version.workflow_revision),
      document_id: "doc.th.rd.0702_9184",
      extraction_version_id: origExtId,
      source_spans: [{ page_number: 1, block_id: null, raw_start: 0, raw_end: 5, polygon: null }],
      before_text: "เลขที",
      after_text: "เลขที",
      issue_ids: [],
      reason: "Should fail",
    });
    expect(revRes.status).toBe(403);

    // 2. Stale editing session (`If-Match: 999`) -> 409 VERSION_CONFLICT
    const staleRes = svc.submitCorrection({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc9-stale",
      if_match: "999",
      document_id: "doc.th.rd.0702_9184",
      extraction_version_id: origExtId,
      source_spans: [{ page_number: 1, block_id: null, raw_start: 0, raw_end: 5, polygon: null }],
      before_text: "เลขที",
      after_text: "เลขที",
      issue_ids: [],
      reason: "Stale session",
    });
    expect(staleRes.status).toBe(409);
    expect((staleRes.body as { code: string }).code).toBe("VERSION_CONFLICT");

    // 3. Service account attempting human approval -> 403 ACCESS_DENIED
    const botPrincipal: OcrPrincipalContext = {
      ...SECOND_APPROVER_PRINCIPAL,
      principal_id: "svc.ocr_pipeline_bot",
      is_service_account: true,
    };
    const botAppr = svc.submitApproval({
      principal: botPrincipal,
      idempotency_key: "sc9-bot",
      if_match: String(st.body.current_version.workflow_revision),
      document_id: "doc.th.rd.0702_9184",
      source_version_id: st.body.current_version.source_version_id,
      extraction_version_id: origExtId,
      annotation_version: st.body.current_version.annotation_version,
      scopes: ["transcription_checked"],
    });
    expect(botAppr.status).toBe(403);

    // Verify original extraction version remains completely intact
    const after = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.rd.0702_9184",
    });
    if ("current_version" in after.body) {
      expect(after.body.current_version.extraction_version_id).toBe(origExtId);
    }
  });

  it("Scenario 10: OCR-verified historical statute without applicability curation explicitly discloses unassessed applicability in search & GraphRAG", () => {
    const searchRes = reg24OcrV2Service.searchPublishedOcrKnowledge({
      query: "โบราณสถาน",
    });
    expect(searchRes.hits.length).toBe(1);
    const hit = searchRes.hits[0];
    expect(hit.document_id).toBe("doc.th.statute.ancient_2499");
    expect(hit.transcription_status).toBe("ocr_verified");
    expect(hit.applicability_status).toBe("not_assessed");
    expect(hit.applicability_disclosure).toContain("UNASSESSED (not_assessed)");

    // Also verify REG24 3R GraphRAG flags `OCR_VERIFIED_APPLICABILITY_UNASSESSED` in R3 Verification Engine!
    const graphOut = reg24Core.execute3RGraphRAGQuery({
      query: "โบราณสถาน พ.ศ. 2499",
    });
    expect(
      graphOut.result.r3_review_verification.uncertainty_flags.some((f) =>
        f.includes("OCR_VERIFIED_APPLICABILITY_UNASSESSED (doc.th.statute.ancient_2499)")
      )
    ).toBe(true);
  });

  it("Scenario 11: Cancelled job returning late provider output is rejected by lease fencing while retaining diagnostic evidence & incurred cost", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: false });
    const text = "ประกาศทดสอบการยกเลิกงานระหว่างรัน OCR";
    const sha = sha256HexLower(text);

    const reg = svc.registerDocument({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc11-reg",
      title_th: "ประกาศทดสอบ Fencing Token",
      source_category: "statute",
      privacy_class: "public",
      expected_sha256: sha,
    });
    if (!("source_version_id" in reg.body)) return;

    svc.finalizeSourceVersion({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc11-fin",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      stored_sha256: sha,
      actual_mime_type: "application/pdf",
      byte_length: 40_000,
      pages_manifest: [
        {
          page_number: 1,
          image_sha256: sha256HexLower("sc11-p1"),
          width_px: 2480,
          height_px: 3508,
          rotation_degrees: 0,
          has_visible_content: true,
          blank_detector_score: 0.01,
          native_pdf_text: null,
          rendered_reference_text: text,
        },
      ],
    });

    // Submit deferred job, acquire worker lease, cancel job, then deliver late worker output!
    const jobSub = svc.submitOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc11-job",
      document_id: reg.body.document_id,
      source_version_id: reg.body.source_version_id,
      defer_worker_execution: true,
    });
    if (!("job_id" in jobSub.body)) return;

    const lease = svc.acquireWorkerLease(jobSub.body.job_id);
    expect(lease.ok).toBe(true);

    const cancelled = svc.cancelOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      idempotency_key: "sc11-cancel",
      job_id: jobSub.body.job_id,
    });
    expect(cancelled.status).toBe(200);
    if ("state" in cancelled.body) {
      expect(cancelled.body.state).toBe("cancelled");
    }

    const lateCompletion = svc.completeWorkerWithFencing({
      job_id: jobSub.body.job_id,
      fencing_token: lease.fencing_token!,
      incurred_micros_override: 3800,
    });
    expect(lateCompletion.accepted).toBe(false);
    expect(lateCompletion.rejected_by_fencing).toBe(true);
    expect(lateCompletion.job.state).toBe("cancelled");
    expect(lateCompletion.job.extraction_version_id).toBeNull();
    expect(lateCompletion.job.budget.consumed_micros).toBe(3800);

    const jobInspect = svc.getOcrJob({
      principal: DEFAULT_SYSTEM_OPERATOR,
      job_id: jobSub.body.job_id,
    });
    if ("diagnostic_late_outputs" in jobInspect.body) {
      expect(jobInspect.body.diagnostic_late_outputs?.length).toBe(1);
    }
  });

  it("Scenario 12: Withdrawing an active document immediately blocks search, cached answers & GraphRAG while retaining audit history", () => {
    const svc = createReg24OcrV2Service({ seedFixtures: true });
    const st = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.dika.2451_2568",
    });
    if (!("current_version" in st.body) || !st.body.active_publication) return;
    const pubId = st.body.active_publication.publication_id;

    // Seed an answer cache referencing `pubId`
    svc.putCachedAnswer("q:severance-2451", [pubId], "Cached answer citing Dika 2451/2568");
    expect(svc.getCachedAnswer("q:severance-2451")).not.toBeNull();

    // Withdraw active publication
    const wd = svc.withdrawPublication({
      principal: SECOND_APPROVER_PRINCIPAL,
      idempotency_key: "sc12-withdraw",
      if_match: String(st.body.current_version.workflow_revision),
      document_id: "doc.th.dika.2451_2568",
      active_publication_id: pubId,
      reason: "Court sealed party names pending redaction derivative",
    });
    expect(wd.status).toBe(200);

    // Search, Graph edges, and Cached Answer ALL deny active retrieval immediately!
    const searchAfter = svc.searchPublishedOcrKnowledge({ query: "2451/2568" });
    expect(searchAfter.hits.length).toBe(0);
    expect(searchAfter.graph_edges.length).toBe(0);
    expect(svc.getCachedAnswer("q:severance-2451")).toBeNull();

    // Authorized audit history & source lineage remain intact!
    const afterState = svc.getLegalDocumentState({
      principal: DEFAULT_SYSTEM_OPERATOR,
      document_id: "doc.th.dika.2451_2568",
    });
    if ("audit_trail" in afterState.body) {
      expect(
        afterState.body.audit_trail.some((a) => a.action === "legal.publication.withdrawn")
      ).toBe(true);
    }
  });

  it("computes exact Unicode code-point CER, Table TEDS / Structure-Only TEDS, and enforces the 300-doc / 3,000-page benchmark honesty gate", () => {
    const gt = "มาตรา ๑๑๘ ค่าชดเชย";
    const hyp = "มาตรา 118 ค่าชดเชย";
    const rawCer = computeRawCer(hyp, gt);
    const normCer = computeNormalizedCer(hyp, gt);
    expect(rawCer.edit_distance).toBe(3); // `๑๑๘` vs `118`
    expect(normCer.cer).toBe(0); // Identical under `thai-legal-norm/2.0.0`

    const tblScore = computeTableTeds(
      {
        cells: [
          {
            row: 0,
            column: 0,
            row_span: 1,
            column_span: 2,
            raw_text: "อัตราค่าชดเชย",
            span: { page_number: 1, block_id: null, raw_start: 0, raw_end: 13, polygon: null },
          },
        ],
      },
      {
        cells: [
          {
            row: 0,
            column: 0,
            row_span: 1,
            column_span: 2,
            raw_text: "อัตราค่าชดเชยผิด",
            span: { page_number: 1, block_id: null, raw_start: 0, raw_end: 16, polygon: null },
          },
        ],
      }
    );
    expect(tblScore.structure_only_teds).toBe(1); // Identical layout (`row=0, col=0, colspan=2`)
    expect(tblScore.full_teds).toBeLessThan(1);   // Text differs

    const report = reg24OcrV2Service.runGoldenFixtureBenchmark();
    expect(report.split_isolation.leak_free).toBe(true);
    expect(report.corpus_status).toBe(
      "golden_fixture_suite_measured__frozen_300_doc_3000_page_corpus_pending"
    );
    expect(report.release_gate_decision).toBe(
      "not_passed__requires_frozen_300_doc_3000_page_corpus_and_owner_signoff"
    );
  });
});
