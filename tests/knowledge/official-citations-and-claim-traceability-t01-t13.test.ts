/**
 * REG24 — Mandatory End-to-End Fixtures T01..T13, Section 8 Acceptance Measurements
 * & Section 10 Owner's Demo Suite
 *
 * Verifies every requirement in:
 * "REG24 developer requirements — official-source citations and claim traceability"
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveDocumentedAmbiguityWithEvidence,
  commitTraceableAnswerAtomically,
  computeBatchTraceabilityInventoryCounts,
  computeCitationTraceabilityAcceptanceMetrics,
  exportTraceableAnswer,
  registerLegacyUnverifiedAnswer,
  removeOrWithdrawEligiblePassage,
  reopenSavedTraceableAnswer,
  resolveTraceableEvidenceById,
  segmentIntoAtomicClaimStatements,
  setCitationPublicationGateMode,
  validateAndBuildTraceableAnswer,
} from "../../src/core/knowledge/claim-traceability-engine";
import { sha256Bytes } from "../../src/core/knowledge/identity";
import {
  approveOfficialUrlReplacement,
  verifyOfficialLocationHealth,
} from "../../src/core/knowledge/link-health";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  onboardOfficialSourceDocument,
  submitThaiScanOcrReviewCorrection,
} from "../../src/core/knowledge/source-onboarding";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import type { Actor } from "../../src/core/knowledge/contracts";
import { POST as queryRoutePost } from "../../src/app/api/v1/knowledge/query/route";
import { GET as evidenceRouteGet } from "../../src/app/api/v1/knowledge/evidence/[id]/route";
import { POST as answersRoutePost } from "../../src/app/api/v1/knowledge/answers/route";
import { GET as savedAnswerRouteGet } from "../../src/app/api/v1/knowledge/answers/[id]/route";
import { GET as exportAnswerRouteGet } from "../../src/app/api/v1/knowledge/answers/[id]/export/route";
import { POST as mcpRoutePost } from "../../src/app/api/mcp/route";
import { POST as reportGeneratePost } from "../../src/app/api/v1/reports/generate/route";
import { POST as legalResearchPost } from "../../src/app/api/v1/legal-research/route";

const PUBLIC_READER: Actor = {
  actor_id: "reader.public@reg24.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const THAI_LEGAL_REVIEWER: Actor = {
  actor_id: "reviewer.thai.law@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public", "scope.tenant.secret_alpha"],
};

const RESTRICTED_TENANT_ACTOR: Actor = {
  actor_id: "counsel.alpha@reg24.th",
  role: "tenant_reader",
  tenant_id: "tenant.alpha",
  authorized_scopes: ["scope.platform.public", "scope.tenant.secret_alpha"],
};

describe("REG24 Official-Source Citations & Claim Traceability (T01..T13 + Owner's Demo)", () => {
  let tmpDir: string;
  let store: DurableKnowledgeStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-traceability-t01-t13-"));
    store = new DurableKnowledgeStore(tmpDir);
    setDefaultKnowledgeStoreForTesting(store);
  });

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows handle cleanup lag
    }
  });

  it("T01: Thai question answered by one text-native official PDF -> exact provision, verbatim quote, and BOTH physical PDF page & Gazette printed page labels + atomic duty/exception/deadline segmentation", async () => {
    const pdfText =
      "มาตรา 70 บริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ตั้งขึ้นตามกฎหมายของต่างประเทศ มิได้ประกอบกิจการในประเทศไทย ต้องเสียภาษีโดยให้ผู้จ่ายหักภาษีจากเงินได้พึงประเมิน เว้นแต่ดอกเบี้ยที่จ่ายจากรัฐบาลหรือสถาบันการเงินที่มีกฎหมายโดยเฉพาะของประเทศไทยจัดตั้งขึ้น และต้องนำส่งภายใน 7 วันนับแต่วันสิ้นเดือนของเดือนที่จ่ายเงินได้";

    const onboarded = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ประมวลรัษฎากร มาตรา 70",
      original_title_th: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร มาตรา 70",
      observed_url: "https://ratchakitcha.soc.go.th/documents/rc-sec-70.pdf",
      mime_type: "application/pdf",
      captured_bytes: pdfText,
      publication_date: "1991-11-03",
      effective_from: "1992-01-01",
      pinpoint_metadata: {
        volume: "108",
        issue: "ตอนที่ 201 ก",
        provision_label: "มาตรา 70 วรรคหนึ่ง",
        gazette_printed_page: "๙",
      },
      pages: [
        {
          physical_page_one_based: 12,
          printed_page_label: "๙",
          page_text_verbatim: pdfText,
        },
      ],
      passages_input: [
        {
          verbatim_text: pdfText,
          section_paragraph_path: ["ประมวลรัษฎากร", "มาตรา 70", "วรรคหนึ่ง"],
          statement_role: "statutory_text",
          physical_page_start: 12,
          physical_page_end: 12,
          printed_page_start: "๙",
          printed_page_end: "๙",
          anchors: [
            {
              anchor_kind: "pdf_page_span",
              physical_page_one_based: 12,
              printed_page_label: "๙",
              bbox_normalized: [0.1, 0.2, 0.9, 0.55],
            },
          ],
        },
      ],
    });

    expect(onboarded.doc.eligible_for_citation).toBe(true);
    expect(onboarded.passages[0].locator_replay_status).toBe("VERIFIED");

    // Verify atomic claim segmentation splits duty + exception + deadline into 3 checkable claims!
    const atomicParts = segmentIntoAtomicClaimStatements(pdfText);
    expect(atomicParts.length).toBe(3);

    const ans = await queryKnowledge(
      { question: "หลักเกณฑ์หักภาษี ณ ที่จ่ายตาม ประมวลรัษฎากร มาตรา 70 คืออะไร" },
      PUBLIC_READER,
      { store }
    );
    expect(ans.status).toBe("ANSWERED");
    const env = ans.traceable_answer!;
    expect(env.status).toBe("complete");
    expect(env.claims.length).toBe(3);

    const ref0 = env.claims[0].evidence_references[0];
    expect(ref0.official_url_with_anchor).toBe(
      "https://ratchakitcha.soc.go.th/documents/rc-sec-70.pdf#page=12"
    );
    expect(ref0.locator.physical_page_start).toBe(12);
    expect(ref0.locator.printed_page_start).toBe("๙");
    expect(ref0.locator.human_pinpoint_th).toContain("PDF หน้า 12");
    expect(ref0.locator.human_pinpoint_th).toContain("หน้าพิมพ์ ๙");

    const resolved = resolveTraceableEvidenceById(store, ref0.evidence_id, PUBLIC_READER);
    expect(resolved.ok).toBe(true);
    expect(resolved.evidence?.verbatim_quote).toBe(pdfText);
    expect(resolved.evidence?.physical_page_start).toBe(12);
    expect(resolved.evidence?.printed_page_start).toBe("๙");
  });

  it("T02: Scan with ambiguous Thai digit or missing negation -> withheld despite high model confidence until Thai human review; corrected version opens highlighted scan while original OCR remains auditable", async () => {
    const rawAmbiguousScan =
      "พระราชกฤษฎีกา (ฉบับที่ ๗๕๐) มาตรา ๔ ให้ยกเว้นภาษีเงินได้ในอัตราร้อยละ ? สำหรับกิจการเป้าหมาย (ไม ชัดเจนว่ายกเว้นหรือไม่)";

    const onboarded = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "พระราชกฤษฎีกา ฉบับที่ 750 มาตรา 4",
      original_title_th: "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร (ฉบับที่ 750)",
      observed_url: "https://ratchakitcha.soc.go.th/documents/rd-750-scan.pdf",
      mime_type: "application/pdf",
      captured_bytes: rawAmbiguousScan,
      is_scanned_material: true,
      model_confidence: 0.998, // Model confidence score alone CANNOT clear OCR ambiguity!
      suspected_missing_negation: true,
      explicit_uncertain_ocr_tokens: ["ร้อยละ ?", "ไม"],
      pages: [
        {
          physical_page_one_based: 3,
          printed_page_label: "๓",
          width_pt: 595,
          height_pt: 842,
          rotation_deg: 0,
          page_text_verbatim: rawAmbiguousScan,
        },
      ],
      passages_input: [
        {
          verbatim_text: rawAmbiguousScan,
          section_paragraph_path: ["พระราชกฤษฎีกา (ฉบับที่ 750)", "มาตรา 4"],
          statement_role: "statutory_text",
          physical_page_start: 3,
          physical_page_end: 3,
          printed_page_start: "๓",
          printed_page_end: "๓",
          anchors: [
            {
              anchor_kind: "scan_bbox_span",
              physical_page_one_based: 3,
              printed_page_label: "๓",
              bbox_normalized: [0.12, 0.25, 0.88, 0.45],
            },
          ],
        },
      ],
    });

    expect(onboarded.extraction_revision.review_status).toBe("AWAITING_THAI_REVIEW");
    expect(onboarded.passages[0].eligible_for_publication).toBe(false);
    expect(onboarded.review_queue_id).toBeTruthy();

    // Before review: claim MUST be withheld!
    const preReviewAns = await queryKnowledge(
      { question: "อัตราการยกเว้นภาษีตาม พระราชกฤษฎีกา ฉบับที่ 750 มาตรา 4 คือเท่าใด" },
      PUBLIC_READER,
      { store }
    );
    expect(preReviewAns.status).toBe("REVIEW_REQUIRED");
    expect(preReviewAns.traceable_answer?.status).toBe("insufficient");
    expect(preReviewAns.traceable_answer?.claims.length).toBe(0);
    expect(
      preReviewAns.traceable_answer?.unresolved_issues.some(
        (u) => u.reason_code === "AMBIGUOUS_OCR_AWAITING_REVIEW"
      )
    ).toBe(true);

    // Submit Thai-language reviewer correction -> creates new ExtractionRevisionRecord keeping original auditable!
    const correctedVerbatim =
      "พระราชกฤษฎีกา (ฉบับที่ ๗๕๐) มาตรา ๔ มิให้ยกเว้นภาษีเงินได้ในอัตราร้อยละ ๒๐ เว้นแต่ปฏิบัติตามเงื่อนไขที่อธิบดีประกาศกำหนด";
    const reviewed = submitThaiScanOcrReviewCorrection(store, {
      extraction_revision_id: onboarded.extraction_revision.extraction_revision_id,
      corrected_pages: [
        {
          physical_page_one_based: 3,
          corrected_text_verbatim: correctedVerbatim,
        },
      ],
      corrected_passages: [
        {
          passage_id: onboarded.passages[0].passage_id,
          corrected_verbatim_text: correctedVerbatim,
          bbox_normalized: [0.12, 0.25, 0.88, 0.46],
        },
      ],
      reviewer: THAI_LEGAL_REVIEWER,
      correction_note: "ตรวจทานต้นฉบับภาพสแกนราชกิจจานุเบกษา: แก้เป็น 'มิให้ยกเว้น' และตัวเลขไทย '๒๐'",
    });

    expect(reviewed.new_extraction_revision.parent_revision_id).toBe(
      onboarded.extraction_revision.extraction_revision_id
    );
    expect(reviewed.updated_passages[0].eligible_for_publication).toBe(true);

    const postReviewAns = await queryKnowledge(
      { question: "อัตราการยกเว้นภาษีตาม พระราชกฤษฎีกา ฉบับที่ 750 มาตรา 4 คือเท่าใด" },
      PUBLIC_READER,
      { store }
    );
    expect(postReviewAns.status).toBe("ANSWERED");
    expect(postReviewAns.traceable_answer?.status).toBe("complete");

    const resolvedScan = resolveTraceableEvidenceById(
      store,
      onboarded.passages[0].passage_id,
      PUBLIC_READER
    );
    expect(resolvedScan.ok).toBe(true);
    expect(resolvedScan.evidence?.is_scanned_material).toBe(true);
    expect(resolvedScan.evidence?.scan_pages.length).toBeGreaterThan(0);
    expect(resolvedScan.evidence?.scan_pages[0].highlight_bboxes[0]).toEqual([
      0.12, 0.25, 0.88, 0.46,
    ]);
    // Original unedited OCR remains auditable in `ocr_audit_trail`!
    expect(resolvedScan.evidence?.ocr_audit_trail.length).toBe(2);
    expect(resolvedScan.evidence?.ocr_audit_trail[1].raw_transcription).toBe(rawAmbiguousScan);
  });

  it("T03: Conclusion requiring a statute AND separate ruling -> both passages and support roles appear; removing one premise withholds dependent conclusion while preserving independent premise", async () => {
    const stat = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.rd",
      source_native_id: "มาตรา 80/1 (2)",
      original_title_th: "ประมวลรัษฎากร มาตรา 80/1 (2)",
      observed_url: "https://www.rd.go.th/5206.html",
      mime_type: "text/html",
      captured_bytes:
        "มาตรา 80/1 (2) การให้บริการที่กระทำในราชอาณาจักรและได้มีการใช้บริการนั้นในต่างประเทศ ให้ใช้อัตราภาษีร้อยละ 0",
    });

    const rul = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/1230",
      original_title_th: "ข้อหารือ กค 0702/1230 การส่งไฟล์ภาพยนตร์ไปต่างประเทศ",
      observed_url: "https://www.rd.go.th/68470.html",
      mime_type: "text/html",
      captured_bytes:
        "กค 0702/1230 วินิจฉัยว่าการอนุญาตให้ใช้ลิขสิทธิ์ภาพยนตร์แก่ผู้ซื้อในต่างประเทศทางอินเทอร์เน็ตเพื่อใช้ในต่างประเทศเพียงอย่างเดียว ได้รับสิทธิอัตราภาษีร้อยละ 0 ตามมาตรา 80/1 (2)",
    });

    const fullAns = await queryKnowledge(
      {
        question:
          "วิเคราะห์ผลทางภาษีตาม มาตรา 80/1 (2) ประกอบหนังสือตอบข้อหารือ กค 0702/1230",
      },
      PUBLIC_READER,
      { store }
    );

    const envFull = fullAns.traceable_answer!;
    expect(envFull.status).toBe("complete");
    const synthesisClaim = envFull.claims.find((c) => c.claim_type === "interpretation");
    expect(synthesisClaim).toBeDefined();
    expect(synthesisClaim!.premise_ids.length).toBe(2);
    const roles = synthesisClaim!.evidence_references.map((r) => r.support_role);
    expect(roles).toContain("statutory_premise");
    expect(roles).toContain("ruling_application");

    // Now remove/withdraw the ruling passage -> dependent conclusion MUST be withheld while statutory premise remains!
    removeOrWithdrawEligiblePassage(
      store,
      rul.passages[0].passage_id,
      THAI_LEGAL_REVIEWER,
      "Test T03 premise removal"
    );

    const afterRemoval = await queryKnowledge(
      {
        question:
          "วิเคราะห์ผลทางภาษีตาม มาตรา 80/1 (2) ประกอบหนังสือตอบข้อหารือ กค 0702/1230",
      },
      PUBLIC_READER,
      { store }
    );
    const envPartial = afterRemoval.traceable_answer!;
    expect(envPartial.status).toBe("partial");
    // Independent statutory premise survives
    expect(
      envPartial.claims.some((c) =>
        c.evidence_references.some((r) => r.evidence_id === stat.passages[0].passage_id)
      )
    ).toBe(true);
    // Dependent interpretation conclusion is WITHHELD!
    expect(envPartial.claims.some((c) => c.claim_type === "interpretation")).toBe(false);
    expect(
      envPartial.unresolved_issues.some((u) => u.reason_code === "DEPENDENT_PREMISE_WITHHELD")
    ).toBe(true);
  });

  it("T04: Same provision before and after amendment -> two as-of answers select respective versions; earlier saved answer & exported resolver still open earlier passage with separate update notice", async () => {
    const v1Text =
      "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้";
    const v1 = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ป.พ.พ. มาตรา 1097",
      original_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097",
      observed_url: "https://ratchakitcha.soc.go.th/documents/ccc-1097-v1.pdf",
      mime_type: "application/pdf",
      captured_bytes: v1Text,
      effective_from: "2008-07-01",
      effective_to: "2023-02-06",
      pages: [{ physical_page_one_based: 4, printed_page_label: "๔", page_text_verbatim: v1Text }],
    });

    // Save pre-amendment answer (before v2 is even ingested!)
    const preAns = await queryKnowledge(
      {
        question: "จำนวนผู้เริ่มก่อการตาม ป.พ.พ. มาตรา 1097",
        applicable_date: "2021-06-15",
      },
      PUBLIC_READER,
      { store, persistAnswerAtomically: true }
    );
    expect(preAns.traceable_answer?.status).toBe("complete");
    expect(preAns.traceable_answer?.claims[0].text).toContain("สามคนขึ้นไป");
    const savedPreRev = preAns.traceable_answer!.answer_revision;
    const exportedPreMd = exportTraceableAnswer(store, {
      answer: preAns.traceable_answer!,
      format: "markdown",
      actor: PUBLIC_READER,
    });
    expect(exportedPreMd.content).toContain(v1.passages[0].passage_id);

    // Now ingest the later amendment (effective 2023-02-07: >= 2 promoters)!
    const v2Text =
      "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้";
    const v2 = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ป.พ.พ. มาตรา 1097",
      original_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097",
      observed_url: "https://ratchakitcha.soc.go.th/documents/ccc-1097-v2-2565.pdf",
      mime_type: "application/pdf",
      captured_bytes: v2Text,
      effective_from: "2023-02-07",
      predecessor_version_id: v1.version.version_id,
      is_verified_amendment: true,
      pages: [{ physical_page_one_based: 2, printed_page_label: "๒", page_text_verbatim: v2Text }],
    });

    // Post-amendment as-of query selects v2 ("สองคนขึ้นไป")
    const postAns = await queryKnowledge(
      {
        question: "จำนวนผู้เริ่มก่อการตาม ป.พ.พ. มาตรา 1097",
        applicable_date: "2025-05-01",
      },
      PUBLIC_READER,
      { store }
    );
    expect(postAns.traceable_answer?.claims[0].text).toContain("สองคนขึ้นไป");
    expect(postAns.traceable_answer?.claims[0].evidence_references[0].version_id).toBe(
      v2.version.version_id
    );

    // Pre-amendment as-of query STILL selects v1 ("สามคนขึ้นไป")
    const preAgain = await queryKnowledge(
      {
        question: "จำนวนผู้เริ่มก่อการตาม ป.พ.พ. มาตรา 1097",
        applicable_date: "2021-06-15",
      },
      PUBLIC_READER,
      { store }
    );
    expect(preAgain.traceable_answer?.claims[0].text).toContain("สามคนขึ้นไป");
    expect(preAgain.traceable_answer?.claims[0].evidence_references[0].version_id).toBe(
      v1.version.version_id
    );

    // Reopen saved earlier answer -> keeps original wording & v1 version, PLUS separate update notice!
    const reopened = reopenSavedTraceableAnswer(store, savedPreRev, PUBLIC_READER);
    expect(reopened.found).toBe(true);
    expect(reopened.answer?.claims[0].text).toContain("สามคนขึ้นไป");
    expect(reopened.answer?.claims[0].evidence_references[0].version_id).toBe(
      v1.version.version_id
    );
    expect(reopened.answer?.update_notices?.length).toBeGreaterThan(0);
    expect(reopened.answer?.update_notices?.[0].latest_version_id).toBe(v2.version.version_id);

    // Exported resolver link from earlier answer still opens earlier passage verbatim!
    const resolvedV1 = resolveTraceableEvidenceById(store, v1.passages[0].passage_id, PUBLIC_READER);
    expect(resolvedV1.ok).toBe(true);
    expect(resolvedV1.evidence?.verbatim_quote).toContain("สามคนขึ้นไป");
  });

  it("T05: Official domain serves login page, homepage, or unrelated PDF with HTTP 200 -> identity check fails, zero verified citations, review queue records reason", async () => {
    const loginHtml = `<html><body><form><input type="password" name="pw"/>กรุณาเข้าสู่ระบบเพื่อดูเอกสาร</form></body></html>`;
    const rLogin = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/5551",
      original_title_th: "หนังสือตอบข้อหารือ กค 0702/5551",
      observed_url: "https://www.rd.go.th/private/5551.html",
      http_status: 200,
      mime_type: "text/html",
      captured_bytes: loginHtml,
    });
    expect(rLogin.location.identity_match_result).toBe("FAILED_LOGIN_WALL");
    expect(rLogin.doc.eligible_for_citation).toBe(false);
    expect(rLogin.review_queue_id).toBeTruthy();

    const homeHtml = `<html><body><h1>หน้าหลักกรมสรรพากร Welcome to Revenue Department</h1></body></html>`;
    const rHome = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/5552",
      original_title_th: "หนังสือตอบข้อหารือ กค 0702/5552",
      observed_url: "https://www.rd.go.th/",
      http_status: 200,
      mime_type: "text/html",
      captured_bytes: homeHtml,
    });
    expect(rHome.location.identity_match_result).toBe("FAILED_HOMEPAGE_OR_SEARCH");
    expect(rHome.doc.eligible_for_citation).toBe(false);

    const unrelatedPdfText =
      "ประกาศกรมสรรพากร เรื่อง กำหนดแบบ ภ.ง.ด.91 ประจำปีภาษี 2568 (คนละเรื่องกับ กค 0702/5553 โดยสิ้นเชิง)";
    const rUnrelated = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/9191",
      original_title_th: "หนังสือตอบข้อหารือ กค 0702/9191 เรื่องภาษีธุรกิจเฉพาะ",
      observed_url: "https://www.rd.go.th/wrong-doc-200.pdf",
      http_status: 200,
      mime_type: "application/pdf",
      captured_bytes: unrelatedPdfText,
    });
    expect(rUnrelated.location.identity_match_result).toBe("FAILED_UNRELATED_DOCUMENT");
    expect(rUnrelated.doc.eligible_for_citation).toBe(false);
    expect(rUnrelated.review_queue_id).toBeTruthy();

    // Querying must NOT publish any verified citation from quarantined T05 records!
    const qAns = await queryKnowledge(
      { question: "สรุปแนววินิจฉัย กค 0702/9191" },
      PUBLIC_READER,
      { store }
    );
    expect(qAns.traceable_answer?.claims.length).toBe(0);
    expect(qAns.traceable_answer?.status).toBe("insufficient");
  });

  it("T06: Official site offline, then moves same document -> prior answer retains pinned evidence & 'ลิงก์ทางการไม่พร้อมใช้งาน'; verified replacement restores access & preserves URL history while rejecting homepage/different-version replacements", async () => {
    const docBody =
      "ความเห็นคณะกรรมการกฤษฎีกา เรื่องเสร็จที่ 412/2567 วินิจฉัยอำนาจการออกคำสั่งทางปกครองตามกฎหมายวิธีปฏิบัติราชการทางปกครอง";
    const src = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "council_of_state_opinion",
      issuer_id: "reg.th.ocs",
      source_native_id: "เรื่องเสร็จที่ 412/2567",
      original_title_th: "ความเห็นคณะกรรมการกฤษฎีกา เรื่องเสร็จที่ 412/2567",
      observed_url: "https://www.krisdika.go.th/opinions/412-2567.pdf",
      mime_type: "application/pdf",
      captured_bytes: docBody,
    });

    const ans = await queryKnowledge(
      { question: "สรุป ความเห็นคณะกรรมการกฤษฎีกา เรื่องเสร็จที่ 412/2567" },
      PUBLIC_READER,
      { store, persistAnswerAtomically: true }
    );
    const savedRev = ans.traceable_answer!.answer_revision;

    // 1. Official site goes offline (HTTP 503)
    const offlineCheck = await verifyOfficialLocationHealth(
      store,
      src.location.location_id,
      async (url) => ({
        reachable: false,
        http_status: 503,
        final_url: url,
        redirect_chain: [],
        mime_type: "",
        body_text_or_html: "",
        body_sha256: null,
        network_error: "ECONNREFUSED_UPSTREAM_503",
      }),
      { maxRetries: 1, baseBackoffMs: 2 }
    );
    expect(offlineCheck.location.link_health).toBe("temporarily_offline");
    expect(offlineCheck.attempts).toBe(2); // Retried transient failure with backoff!

    // Resolver STILL returns HTTP 200 with pinned quote + "ลิงก์ทางการไม่พร้อมใช้งาน"!
    const resolvedDuringOutage = resolveTraceableEvidenceById(
      store,
      src.passages[0].passage_id,
      PUBLIC_READER
    );
    expect(resolvedDuringOutage.ok).toBe(true);
    expect(resolvedDuringOutage.evidence?.verbatim_quote).toBe(docBody);
    expect(resolvedDuringOutage.evidence?.official_location.link_health_label_th).toContain(
      "ลิงก์ทางการไม่พร้อมใช้งาน"
    );

    const reopenedOutage = reopenSavedTraceableAnswer(store, savedRev, PUBLIC_READER);
    expect(reopenedOutage.answer?.claims[0].evidence_references[0].link_health_notice_th).toContain(
      "ลิงก์ทางการไม่พร้อมใช้งาน"
    );

    // 2. Reject replacing with a newer/different file SHA-256!
    await expect(
      approveOfficialUrlReplacement(store, {
        location_id: src.location.location_id,
        proposed_new_official_url: "https://www.krisdika.go.th/archive/2568/412-amended.pdf",
        probe: async (u) => ({
          reachable: true,
          http_status: 200,
          final_url: u,
          redirect_chain: [],
          mime_type: "application/pdf",
          body_text_or_html: `${docBody} (แก้ไขเพิ่มเติมปี 2568)`,
          body_sha256: sha256Bytes(`${docBody} (แก้ไขเพิ่มเติมปี 2568)`),
        }),
        operator: THAI_LEGAL_REVIEWER,
        reason: "Attempted replacement with newer version must fail",
      })
    ).rejects.toThrow(/REPLACEMENT_URL_VERSION_MISMATCH_422/);

    // 3. Approve moved official URL serving the EXACT cited version SHA-256 -> restores access & preserves URL history!
    const movedUrl = "https://www.krisdika.go.th/archive/2567/opinion-412-2567.pdf";
    const replacedLoc = await approveOfficialUrlReplacement(store, {
      location_id: src.location.location_id,
      proposed_new_official_url: movedUrl,
      probe: async (u) => ({
        reachable: true,
        http_status: 200,
        final_url: u,
        redirect_chain: [],
        mime_type: "application/pdf",
        body_text_or_html: docBody,
        body_sha256: sha256Bytes(docBody),
      }),
      operator: THAI_LEGAL_REVIEWER,
      reason: "OCS migrated 2567 opinions to /archive/2567/",
    });

    expect(replacedLoc.link_health).toBe("moved_verified");
    expect(replacedLoc.exact_official_url).toBe(movedUrl);
    expect(replacedLoc.prior_urls.length).toBe(1);
    expect(replacedLoc.prior_urls[0].url).toBe("https://www.krisdika.go.th/opinions/412-2567.pdf");
  });

  it("T07: Third-party-only record or invented evidence ID -> publication gate rejects citation across web/UI, API, MCP, and export generation + creates reconciliation task", async () => {
    const tp = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "supreme_court_decision",
      issuer_id: "reg.th.supreme_court",
      source_native_id: "คำพิพากษาศาลฎีกาที่ 8812/2564",
      original_title_th: "คำพิพากษาศาลฎีกาที่ 8812/2564 (สำเนาจากบล็อกภายนอก)",
      record_type: "third_party_discovery",
      observed_url: "https://tax-blog.example.com/deka-8812-2564.html",
      mime_type: "text/html",
      captured_bytes: "คำพิพากษาศาลฎีกาที่ 8812/2564 วินิจฉัยเรื่องรายจ่ายต้องห้าม",
    });

    expect(tp.doc.eligible_for_citation).toBe(false);
    expect(tp.reconciliation_task_id).toBeTruthy();

    // 1. Validate gate rejects BOTH third-party passage ID AND invented evidence ID `epsg.invented_9999`
    const gated = validateAndBuildTraceableAnswer(store, {
      channel: "chat",
      question: "คำพิพากษาศาลฎีกาที่ 8812/2564 วินิจฉัยอย่างไร",
      as_of_date: null,
      release_id: "rel.B01.rc5",
      actor: PUBLIC_READER,
      authorized_candidate_ids: new Set([tp.passages[0].passage_id]),
      proposed_claims: [
        {
          text: "รายจ่ายดังกล่าวถือเป็นรายจ่ายได้ตามคำพิพากษาศาลฎีกาที่ 8812/2564",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "primary_authority",
              evidence_ids: [tp.passages[0].passage_id],
            },
          ],
        },
        {
          text: "ข้อกล่าวอ้างที่อ้างอิงรหัสหลักฐานปลอมที่โมเดลแต่งขึ้นเอง",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g2",
              role: "primary_authority",
              evidence_ids: ["epsg.invented_hallucinated_id_999"],
            },
          ],
        },
      ],
    });
    expect(gated.status).toBe("insufficient");
    expect(gated.claims.length).toBe(0);

    // 2. REST API `/api/v1/knowledge/query` & MCP `reg24.citations.ask_traceable` also withhold third-party-only source
    const apiReq = new Request("http://localhost/api/v1/knowledge/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "คำพิพากษาศาลฎีกาที่ 8812/2564 วินิจฉัยอย่างไร" }),
    });
    const apiRes = await queryRoutePost(apiReq);
    const apiJson = await apiRes.json();
    expect(apiJson.traceable_answer.claims.length).toBe(0);

    const mcpReq = new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mcp-t07",
        method: "tools/call",
        params: {
          name: "reg24.citations.ask_traceable",
          arguments: { question: "คำพิพากษาศาลฎีกาที่ 8812/2564 วินิจฉัยอย่างไร" },
        },
      }),
    });
    const mcpRes = await mcpRoutePost(mcpReq);
    const mcpJson = await mcpRes.json();
    expect(mcpJson.result.structuredContent.traceable_answer.claims.length).toBe(0);

    // 3. Export gate rejects any forged envelope attempting to publish an unsupported or third-party-backed claim!
    const forgedExport = exportTraceableAnswer(store, {
      answer: {
        ...gated,
        status: "complete",
        claims: [
          {
            claim_id: "clm.forged.1",
            claim_number: 1,
            text: "Forged claim citing third-party discovery copy",
            claim_type: "legal_proposition",
            claim_type_label_th: "ข้อกฎหมาย",
            premise_ids: [],
            verification_decision: "supported",
            published: true,
            withheld_explanation_th: null,
            evidence_references: [
              {
                link_id: "cel.forged",
                evidence_id: "epsg.invented_hallucinated_id_999",
                doc_id: tp.doc.doc_id,
                version_id: tp.version.version_id,
                extraction_revision_id: tp.extraction_revision.extraction_revision_id,
                support_role: "primary_authority",
                support_role_label_th: "หลักฐานหลัก",
                required_group: "g1",
                citation_label_th: "Forged",
                issuer_name_th: "ศาลฎีกา",
                source_family: "supreme_court_decision",
                source_family_label_th: "คำพิพากษาศาลฎีกา",
                record_type: "third_party_discovery",
                record_type_label_th: "สำเนาภายนอก",
                date_relied_on: null,
                official_url: tp.location.exact_official_url,
                official_url_with_anchor: tp.location.exact_official_url,
                resolver_url: `/api/v1/knowledge/evidence/epsg.invented_hallucinated_id_999`,
                locator: {
                  human_pinpoint_th: "-",
                  section_paragraph_path: [],
                  physical_page_start: null,
                  physical_page_end: null,
                  printed_page_start: null,
                  printed_page_end: null,
                  anchors: [],
                },
                verification_status: "supported",
                link_health: "verified_online",
                link_health_notice_th: null,
                last_successful_verification_at: null,
                access_permission: "public",
                access_conditions_th: null,
              },
            ],
          },
        ],
      },
      format: "markdown",
      actor: PUBLIC_READER,
    });
    expect(forgedExport.allowed).toBe(false);
  });

  it("T08: Relevant passage contains an exception that contradicts the proposed unqualified answer -> claim is withheld; same-topic citation cannot pass alone", async () => {
    const sec19Text =
      "ประมวลรัษฎากร มาตรา 19 เจ้าพนักงานประเมินมีอำนาจออกหมายเรียกภายในเวลา 2 ปี เว้นแต่ปรากฏหลักฐานว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร อธิบดีอนุมัติให้ขยายเวลาเกินกว่า 2 ปีได้แต่ไม่เกิน 5 ปี";
    const onboarded = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.rd",
      source_native_id: "มาตรา 19",
      original_title_th: "ประมวลรัษฎากร มาตรา 19",
      observed_url: "https://www.rd.go.th/5937.html",
      mime_type: "text/html",
      captured_bytes: sec19Text,
    });

    // Proposed claim asserts unqualified rule ("ห้ามขยายเวลาในทุกกรณีโดยไม่มีข้อยกเว้น") citing the same-topic Section 19 passage
    const unqualified = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "เจ้าพนักงานออกหมายเรียกเกิน 2 ปีไม่ได้ในทุกกรณีโดยไม่มีข้อยกเว้นใช่หรือไม่",
      as_of_date: null,
      release_id: "rel.B01.rc5",
      actor: PUBLIC_READER,
      authorized_candidate_ids: new Set([onboarded.passages[0].passage_id]),
      proposed_claims: [
        {
          text: "เจ้าพนักงานประเมินต้องออกหมายเรียกภายใน 2 ปี และห้ามขยายเวลาในทุกกรณีโดยไม่มีข้อยกเว้น",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "primary_authority",
              evidence_ids: [onboarded.passages[0].passage_id],
            },
          ],
        },
      ],
    });

    expect(unqualified.status).toBe("insufficient");
    expect(unqualified.claims.length).toBe(0);
    expect(unqualified.unresolved_issues[0].reason_code).toBe(
      "CONTRADICTING_EXCEPTION_UNRESOLVED"
    );

    // Properly qualified claim including the exception passes!
    const qualified = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "กำหนดเวลาออกหมายเรียกตามมาตรา 19 และข้อยกเว้นเป็นอย่างไร",
      as_of_date: null,
      release_id: "rel.B01.rc5",
      actor: PUBLIC_READER,
      authorized_candidate_ids: new Set([onboarded.passages[0].passage_id]),
      proposed_claims: [
        {
          text: "เจ้าพนักงานประเมินมีอำนาจออกหมายเรียกภายใน 2 ปี เว้นแต่มีเหตุอันควรสงสัยว่าเจตนาหลีกเลี่ยงภาษีอากร อธิบดีอนุมัติให้ขยายได้ไม่เกิน 5 ปี",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "exception_or_proviso",
              evidence_ids: [onboarded.passages[0].passage_id],
            },
          ],
        },
      ],
    });
    expect(qualified.status).toBe("complete");
    expect(qualified.claims.length).toBe(1);
  });

  it("T09: Concurrent retry, OCR rerun, reindex, and interrupted answer commit -> no duplicate version, no orphaned published claim, and stable passage IDs", async () => {
    const rawPdf = "คำสั่งกรมสรรพากร ที่ ท.ป. 4/2528 ข้อ 8 กำหนดหน้าที่หักภาษี ณ ที่จ่ายสำหรับการให้บริการ";
    const first = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.rd",
      source_native_id: "ท.ป. 4/2528 ข้อ 8",
      original_title_th: "คำสั่งกรมสรรพากร ที่ ท.ป. 4/2528",
      observed_url: "https://www.rd.go.th/3557.html",
      mime_type: "text/html",
      captured_bytes: rawPdf,
      parser_or_ocr_version: "native-v1",
    });

    // Retry identical capture -> reuses exact same version_id & passage_id (zero duplicate versions!)
    const retrySame = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.rd",
      source_native_id: "ท.ป. 4/2528 ข้อ 8",
      original_title_th: "คำสั่งกรมสรรพากร ที่ ท.ป. 4/2528",
      observed_url: "https://www.rd.go.th/3557.html",
      mime_type: "text/html",
      captured_bytes: rawPdf,
      parser_or_ocr_version: "native-v1",
    });
    expect(retrySame.idempotent_version_reused).toBe(true);
    expect(retrySame.version.version_id).toBe(first.version.version_id);
    expect(retrySame.passages[0].passage_id).toBe(first.passages[0].passage_id);

    // OCR/parser rerun on same bytes -> reuses same DocumentVersion (`version_id`), no duplicate DocumentVersion!
    const parserRerun = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.rd",
      source_native_id: "ท.ป. 4/2528 ข้อ 8",
      original_title_th: "คำสั่งกรมสรรพากร ที่ ท.ป. 4/2528",
      observed_url: "https://www.rd.go.th/3557.html",
      mime_type: "text/html",
      captured_bytes: rawPdf,
      parser_or_ocr_version: "native-v2-reindex",
    });
    expect(parserRerun.version.version_id).toBe(first.version.version_id);
    expect(parserRerun.passages[0].passage_id).toBe(first.passages[0].passage_id);

    const allDocVersions = Object.values(store.getState().citation_ledger!.versions).filter(
      (v) => v.doc_id === first.doc.doc_id
    );
    expect(allDocVersions.length).toBe(1);

    // Simulated interrupted answer commit -> zero orphaned published answers or claim_evidence_links!
    const built = validateAndBuildTraceableAnswer(store, {
      answer_id: "ans.interrupted.test",
      channel: "api",
      question: "ท.ป. 4/2528 ข้อ 8 กำหนดว่าอย่างไร",
      as_of_date: null,
      release_id: "rel.B01.rc5",
      actor: PUBLIC_READER,
      authorized_candidate_ids: new Set([first.passages[0].passage_id]),
      proposed_claims: [
        {
          text: rawPdf,
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "primary_authority",
              evidence_ids: [first.passages[0].passage_id],
            },
          ],
        },
      ],
      persist_atomically: false,
    });

    expect(() =>
      commitTraceableAnswerAtomically(
        store,
        built,
        built.claims[0].evidence_references.map((r) => ({
          ...r,
          answer_revision: built.answer_revision,
          claim_id: built.claims[0].claim_id,
          verifier_or_reviewer_id: "test",
          ruleset_version: "test",
          verified_at: built.generated_at,
        })),
        {
          actor: PUBLIC_READER,
          question_text: "ท.ป. 4/2528 ข้อ 8",
          simulate_interrupt_after_validation_for_test: true,
        }
      )
    ).toThrow(/SIMULATED_INTERRUPTED_ANSWER_COMMIT_BEFORE_WAL/);

    expect(
      store.getState().citation_ledger!.published_answers[built.answer_revision]
    ).toBeUndefined();
    expect(Object.keys(store.getState().citation_ledger!.claim_evidence_links).length).toBe(0);
  });

  it("T10: Restricted evidence and user without access -> resolver, saved answer reopen, cache headers, and export NEVER expose passage or protected artifact", async () => {
    const secretText =
      "ที่ กค 0702/ลับเฉพาะ01 บันทึกข้อหารือเฉพาะรายภายในองค์กร ลับเฉพาะลูกค้า Alpha เรื่องโครงสร้างควบรวมกิจการข้ามพรมแดน";
    const restricted = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/ลับเฉพาะ01",
      original_title_th: "บันทึกข้อหารือจำกัดสิทธิ์ กค 0702/ลับเฉพาะ01",
      access_permission: "restricted_tenant",
      access_scope: "scope.tenant.secret_alpha",
      observed_url: "https://www.rd.go.th/restricted/alpha01.pdf",
      mime_type: "application/pdf",
      captured_bytes: secretText,
    });

    // Authorized tenant actor saves an answer citing the restricted evidence
    const authorizedAns = await queryKnowledge(
      { question: "สรุป กค 0702/ลับเฉพาะ01" },
      RESTRICTED_TENANT_ACTOR,
      { store, persistAnswerAtomically: true }
    );
    expect(authorizedAns.traceable_answer?.status).toBe("complete");
    const savedSecretRev = authorizedAns.traceable_answer!.answer_revision;

    // 1. Public unauthorized caller hits resolver route -> HTTP 404 + `Cache-Control: private, no-store`, ZERO text leaked!
    const evReq = new Request(
      `http://localhost/api/v1/knowledge/evidence/${encodeURIComponent(restricted.passages[0].passage_id)}`
    );
    const evRes = await evidenceRouteGet(evReq, {
      params: Promise.resolve({ id: restricted.passages[0].passage_id }),
    });
    expect(evRes.status).toBe(404);
    expect(evRes.headers.get("Cache-Control")).toContain("no-store");
    const evBody = JSON.stringify(await evRes.json());
    expect(evBody).not.toContain("ควบรวมกิจการข้ามพรมแดน");

    // 2. Public unauthorized caller tries to reopen saved answer -> HTTP 404!
    const reopenReq = new Request(
      `http://localhost/api/v1/knowledge/answers/${encodeURIComponent(savedSecretRev)}`
    );
    const reopenRes = await savedAnswerRouteGet(reopenReq, {
      params: Promise.resolve({ id: savedSecretRev }),
    });
    expect(reopenRes.status).toBe(404);

    // 3. Public unauthorized caller tries to export -> HTTP 404, zero content!
    const expRes = exportTraceableAnswer(store, {
      answer: authorizedAns.traceable_answer!,
      format: "markdown",
      actor: PUBLIC_READER,
    });
    expect(expRes.allowed).toBe(false);
    expect(expRes.http_status).toBe(404);
    expect(expRes.content).toBe("");
  });

  it("T11: Legacy unsupported answer and newly requested export -> legacy status remains visible, original text untouched, and export preserves warning without labeling it verified", async () => {
    const legacyOriginalText =
      "ตามแนวทางเดิม บริษัทสามารถหักรายจ่ายค่าที่ปรึกษาต่างประเทศได้ตามมาตรา 65 ตรี (คำตอบบันทึกไว้ก่อนระบบผูกหลักฐาน)";
    const legacyEnv = registerLegacyUnverifiedAnswer(store, {
      answer_id: "ans.legacy.2025_001",
      question_text: "ค่าที่ปรึกษาต่างประเทศหักรายจ่ายได้หรือไม่",
      original_answer_text_th: legacyOriginalText,
      raw_legacy_citations: ["มาตรา 65 ตรี (อ้างอิงเดิมยังไม่ผูกตำแหน่งข้อความ)"],
      created_at: "2025-12-01T10:00:00.000Z",
      as_of_date: null,
      release_id: "rel.B01.rc1",
      actor: THAI_LEGAL_REVIEWER,
    });

    expect(legacyEnv.status).toBe("legacy_unverified");
    expect(legacyEnv.rendered_answer_th).toBe(legacyOriginalText);
    expect(legacyEnv.legacy_warning_th).toContain("ยังไม่ได้รับการรับรองความถูกต้อง");

    const expMd = exportTraceableAnswer(store, {
      answer: legacyEnv,
      format: "markdown",
      actor: PUBLIC_READER,
    });
    expect(expMd.allowed).toBe(true);
    expect(expMd.content).toContain("UNVERIFIED LEGACY ANSWER");
    expect(expMd.content).toContain(legacyOriginalText);
    expect(expMd.content).not.toContain("สถานะการตรวจสอบหลักฐาน: COMPLETE");

    const expWord = exportTraceableAnswer(store, {
      answer: legacyEnv,
      format: "word_doc",
      actor: PUBLIC_READER,
    });
    expect(expWord.allowed).toBe(true);
    expect(expWord.content).toContain("UNVERIFIED LEGACY ANSWER");
  });

  it("T12: HTML without fragment links AND cross-page PDF passage -> user can open official document, follow visible pinpoint, and replay all highlighted spans across pages", async () => {
    // Part A: Cross-page PDF passage spanning physical PDF pages 8..9 (printed pages ๗..๘)
    const p8 = "มาตรา 65 ทวิ การคำนวณกำไรสุทธิและขาดทุนสุทธิในส่วนนี้ ให้เป็นไปตามเงื่อนไขดังต่อไปนี้ (1) รายการที่ระบุไว้ในมาตรา 65 ตรี ไม่ให้ถือเป็นรายจ่าย";
    const p9 = "(2) ค่าสึกหรอและค่าเสื่อมราคาของทรัพย์สิน ให้หักได้ตามหลักเกณฑ์ วิธีการ เงื่อนไข และอัตราที่กำหนดโดยพระราชกฤษฎีกา";
    const crossPdf = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "มาตรา 65 ทวิ",
      original_title_th: "ประมวลรัษฎากร มาตรา 65 ทวิ (ข้ามหน้า)",
      observed_url: "https://ratchakitcha.soc.go.th/documents/rc-65-bis.pdf",
      mime_type: "application/pdf",
      captured_bytes: `${p8}\n${p9}`,
      pages: [
        { physical_page_one_based: 8, printed_page_label: "๗", page_text_verbatim: p8 },
        { physical_page_one_based: 9, printed_page_label: "๘", page_text_verbatim: p9 },
      ],
      passages_input: [
        {
          verbatim_text: `${p8}\n${p9}`,
          section_paragraph_path: ["ประมวลรัษฎากร", "มาตรา 65 ทวิ", "(1)–(2)"],
          statement_role: "statutory_text",
          physical_page_start: 8,
          physical_page_end: 9,
          printed_page_start: "๗",
          printed_page_end: "๘",
          anchors: [
            {
              anchor_kind: "pdf_page_span",
              physical_page_one_based: 8,
              printed_page_label: "๗",
              bbox_normalized: [0.1, 0.72, 0.9, 0.94],
            },
            {
              anchor_kind: "pdf_page_span",
              physical_page_one_based: 9,
              printed_page_label: "๘",
              bbox_normalized: [0.1, 0.08, 0.9, 0.32],
            },
          ],
        },
      ],
    });

    expect(crossPdf.passages[0].locator_replay_status).toBe("VERIFIED");
    expect(crossPdf.passages[0].human_pinpoint_th).toContain("PDF หน้า 8–9");
    expect(crossPdf.passages[0].human_pinpoint_th).toContain("หน้าพิมพ์ ๗–๘");

    const resolvedCross = resolveTraceableEvidenceById(
      store,
      crossPdf.passages[0].passage_id,
      PUBLIC_READER
    );
    expect(resolvedCross.ok).toBe(true);
    expect(resolvedCross.evidence?.scan_pages.length).toBe(2);
    expect(resolvedCross.evidence?.anchors.length).toBe(2);

    // Part B: Official HTML without `#fragment` links -> visible structural pinpoint + prefix/exact/suffix replay!
    const htmlPage =
      "ส่วนนำข้อเท็จจริงของผู้ขอหารือ\nแนววินิจฉัยของกรมสรรพากร กรณีบริษัทจ่ายค่าบริการให้ผู้รับในต่างประเทศ ต้องหักภาษี ณ ที่จ่ายตามมาตรา 70\nลงชื่อเจ้าหน้าที่ผู้ตอบข้อหารือ";
    const fraglessHtml = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/7788",
      original_title_th: "หนังสือตอบข้อหารือ กค 0702/7788",
      observed_url: "https://www.rd.go.th/77880.html",
      mime_type: "text/html",
      captured_bytes: htmlPage,
      passages_input: [
        {
          verbatim_text:
            "แนววินิจฉัยของกรมสรรพากร กรณีบริษัทจ่ายค่าบริการให้ผู้รับในต่างประเทศ ต้องหักภาษี ณ ที่จ่ายตามมาตรา 70",
          surrounding_before: "ส่วนนำข้อเท็จจริงของผู้ขอหารือ",
          surrounding_after: "ลงชื่อเจ้าหน้าที่ผู้ตอบข้อหารือ",
          section_paragraph_path: ["กค 0702/7788", "ย่อหน้าที่ 2 · แนววินิจฉัย"],
          statement_role: "official_conclusion",
          anchors: [
            {
              anchor_kind: "html_text_quote",
              structural_selector: "body > table > tbody > tr:nth-child(2) > p:nth-child(2)",
              exact_quote:
                "แนววินิจฉัยของกรมสรรพากร กรณีบริษัทจ่ายค่าบริการให้ผู้รับในต่างประเทศ ต้องหักภาษี ณ ที่จ่ายตามมาตรา 70",
              quote_prefix: "ส่วนนำข้อเท็จจริงของผู้ขอหารือ",
              quote_suffix: "ลงชื่อเจ้าหน้าที่ผู้ตอบข้อหารือ",
            },
          ],
          pinpoint_override: { ruling_part: "answer_conclusion" },
        },
      ],
    });
    expect(fraglessHtml.passages[0].locator_replay_status).toBe("VERIFIED");
    expect(fraglessHtml.passages[0].human_pinpoint_th).toContain("ส่วนสรุปแนววินิจฉัย");
  });

  it("T13 + Section 8 + SSE Stream + Gate Switch: Compare saved answer across UI/REST API, MCP, Research, Reports, and Exported Report -> identical claim IDs, evidence IDs, versions, and pinpoints + 100% Section 8 acceptance metrics", async () => {
    const bodyText =
      "ข้อหารือ กค 0702/636 ลงวันที่ 5 กุมภาพันธ์ 2569 วินิจฉัยว่าการขายสินค้าให้ส่วนราชการตามโครงการเงินช่วยเหลือจากต่างประเทศ ได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามมาตรา 80/1 (4)";
    onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "revenue_department_ruling",
      issuer_id: "reg.th.rd",
      source_native_id: "กค 0702/636",
      original_title_th: "หนังสือตอบข้อหารือ กค 0702/636",
      observed_url: "https://www.rd.go.th/68302.html",
      mime_type: "text/html",
      captured_bytes: bodyText,
      publication_date: "2026-02-05",
      pinpoint_metadata: { ruling_part: "answer_conclusion" },
    });

    // 1. Query via REST API `/api/v1/knowledge/query` and save via `/api/v1/knowledge/answers`
    const qReq = new Request("http://localhost/api/v1/knowledge/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "ค้นหาแนววินิจฉัย กค 0702/636",
        as_of_date: "2026-03-01",
        channel: "chat",
      }),
    });
    const qRes = await queryRoutePost(qReq);
    const qJson = await qRes.json();
    const uiApiEnvelope = qJson.traceable_answer;
    expect(uiApiEnvelope.status).toBe("complete");

    // Verify SSE streaming mode streams ONLY progress + validated claims (`Section 1`)
    const streamReq = new Request("http://localhost/api/v1/knowledge/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question: "ค้นหาแนววินิจฉัย กค 0702/636", stream: true }),
    });
    const streamRes = await queryRoutePost(streamReq);
    const sseText = await streamRes.text();
    expect(sseText).toContain("event: progress");
    expect(sseText).toContain("event: validated_claim");
    expect(sseText).toContain("event: complete");

    const saveReq = new Request("http://localhost/api/v1/knowledge/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        traceable_answer: uiApiEnvelope,
        question_text: "ค้นหาแนววินิจฉัย กค 0702/636",
      }),
    });
    const saveRes = await answersRoutePost(saveReq);
    const saveJson = await saveRes.json();
    const savedRevId = saveJson.saved_answer_revision;

    // 2. Reopen via REST API (`GET /api/v1/knowledge/answers/[id]`)
    const apiReopenRes = await savedAnswerRouteGet(
      new Request(`http://localhost/api/v1/knowledge/answers/${encodeURIComponent(savedRevId)}`),
      { params: Promise.resolve({ id: savedRevId }) }
    );
    const apiReopenJson = await apiReopenRes.json();

    // 3. Reopen via MCP (`reg24.citations.get_saved_answer`)
    const mcpReopenRes = await mcpRoutePost(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mcp-t13",
          method: "tools/call",
          params: {
            name: "reg24.citations.get_saved_answer",
            arguments: { answer_id: savedRevId },
          },
        }),
      })
    );
    const mcpReopenJson = await mcpReopenRes.json();
    const mcpEnvelope = mcpReopenJson.result.structuredContent.traceable_answer;

    // 4. Export to JSON & Markdown (`GET /api/v1/knowledge/answers/[id]/export`)
    const exportJsonRes = await exportAnswerRouteGet(
      new Request(
        `http://localhost/api/v1/knowledge/answers/${encodeURIComponent(savedRevId)}/export?format=json`
      ),
      { params: Promise.resolve({ id: savedRevId }) }
    );
    const exportedJsonEnvelope = JSON.parse(await exportJsonRes.text());

    const exportMdRes = await exportAnswerRouteGet(
      new Request(
        `http://localhost/api/v1/knowledge/answers/${encodeURIComponent(savedRevId)}/export?format=markdown`
      ),
      { params: Promise.resolve({ id: savedRevId }) }
    );
    const exportedMd = await exportMdRes.text();

    // Parity assertion across UI/API, MCP, and Export (`T13`):
    expect(mcpEnvelope.answer_revision).toBe(apiReopenJson.answer.answer_revision);
    expect(exportedJsonEnvelope.answer_revision).toBe(apiReopenJson.answer.answer_revision);
    expect(mcpEnvelope.claims[0].claim_id).toBe(apiReopenJson.answer.claims[0].claim_id);
    expect(exportedJsonEnvelope.claims[0].claim_id).toBe(apiReopenJson.answer.claims[0].claim_id);
    expect(mcpEnvelope.claims[0].evidence_references[0].evidence_id).toBe(
      apiReopenJson.answer.claims[0].evidence_references[0].evidence_id
    );
    expect(mcpEnvelope.claims[0].evidence_references[0].version_id).toBe(
      apiReopenJson.answer.claims[0].evidence_references[0].version_id
    );
    expect(mcpEnvelope.claims[0].evidence_references[0].locator.human_pinpoint_th).toBe(
      apiReopenJson.answer.claims[0].evidence_references[0].locator.human_pinpoint_th
    );
    expect(exportedMd).toContain(apiReopenJson.answer.claims[0].claim_id);
    expect(exportedMd).toContain(apiReopenJson.answer.claims[0].evidence_references[0].official_url);

    // 5. Verify Research & Reports endpoints also attach `traceable_answer`
    const repRes = await reportGeneratePost(
      new NextRequest("http://localhost/api/v1/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query_or_topic: "ค้นหาแนววินิจฉัย กค 0702/636" }),
      })
    );
    const repJson = await repRes.json();
    expect(repJson.traceable_answer?.claims.length).toBeGreaterThan(0);

    const resMission = await legalResearchPost(
      new NextRequest("http://localhost/api/v1/legal-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "ค้นหาแนววินิจฉัย กค 0702/636" }),
      })
    );
    const resMissionJson = await resMission.json();
    expect(resMissionJson.traceable_answer?.claims.length).toBeGreaterThan(0);

    // 6. Compute Section 8 Acceptance Metrics -> 100% claim coverage & 100% citation traceability!
    const metrics = computeCitationTraceabilityAcceptanceMetrics(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      evaluated_envelopes: [
        {
          case_id: "T13-POS",
          is_positive_fixture: true,
          expected_outcome: "complete",
          envelope: uiApiEnvelope,
        },
      ],
      channels_tested: ["chat", "api", "mcp", "saved_answer", "export", "report", "research"],
      actor: PUBLIC_READER,
    });
    expect(metrics.published_claim_coverage.ratio).toBe(1);
    expect(metrics.published_citation_traceability.ratio).toBe(1);
    expect(metrics.all_release_gates_passed).toBe(true);

    // Verify zero-denominator & empty-positive-fixture safety guard (`Section 8`)
    const zeroObsMetrics = computeCitationTraceabilityAcceptanceMetrics(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      evaluated_envelopes: [],
      channels_tested: ["api"],
      actor: PUBLIC_READER,
    });
    expect(zeroObsMetrics.published_claim_coverage.ratio).toBe("no_observations");
    expect(zeroObsMetrics.all_release_gates_passed).toBe(false);

    // 7. Server-side switch rollback to `generation_disabled` preserves saved answer & published IDs!
    setCitationPublicationGateMode(
      store,
      "generation_disabled",
      THAI_LEGAL_REVIEWER,
      "Test rollback switch"
    );
    const blockedNew = await queryKnowledge(
      { question: "ค้นหาแนววินิจฉัย กค 0702/636" },
      PUBLIC_READER,
      { store }
    );
    expect(blockedNew.traceable_answer?.status).toBe("insufficient");
    const stillReadableSaved = reopenSavedTraceableAnswer(store, savedRevId, PUBLIC_READER);
    expect(stillReadableSaved.found).toBe(true);
    expect(stillReadableSaved.answer?.claims[0].claim_id).toBe(uiApiEnvelope.claims[0].claim_id);
  });

  it("Section 10 Owner's Demo + Human Ambiguity Approval: Real Batch 1 Thai question -> inspect claim & locator -> save & export -> ingest later version -> reopen both outputs -> fresh as-of selects new version -> removing required passage prevents new claim publication", async () => {
    const stagingStoreDir = path.join(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
    const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-owner-demo-b01-"));
    try {
      fs.cpSync(stagingStoreDir, demoDir, { recursive: true });
      const demoStore = new DurableKnowledgeStore(demoDir);

      // Reconcile Batch 1 inventory counts (`Section 10.2`)
      const batchCounts = computeBatchTraceabilityInventoryCounts(
        demoStore,
        "B01",
        "rel.B01.rc5"
      );
      expect(batchCounts.documents.eligible).toBeGreaterThan(4500);

      // Step 1: Ask a real Batch 1 question in Thai (`กค 0702/636`)
      const b01Question = "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636";
      const initialAns = await queryKnowledge(
        {
          question: b01Question,
          release_id: "rel.B01.rc5",
          applicable_date: "2026-02-15",
          mode: "exact_lookup",
        },
        PUBLIC_READER,
        { store: demoStore, channel: "chat", persistAnswerAtomically: true }
      );
      expect(initialAns.status).toBe("ANSWERED");
      const env1 = initialAns.traceable_answer!;
      expect(env1.status).toBe("complete");
      expect(env1.claims.length).toBeGreaterThan(0);

      // Step 2: Select material claim, inspect official URL + locator, and inspect passage in REG24 resolver
      const materialClaim = env1.claims[0];
      const primaryRef = materialClaim.evidence_references[0];
      expect(primaryRef.official_url).toBe("https://www.rd.go.th/68302.html");
      expect(primaryRef.locator.human_pinpoint_th.length).toBeGreaterThan(0);

      const resolvedOriginal = resolveTraceableEvidenceById(
        demoStore,
        primaryRef.evidence_id,
        PUBLIC_READER,
        "rel.B01.rc5"
      );
      expect(resolvedOriginal.ok).toBe(true);
      const originalQuote = resolvedOriginal.evidence!.verbatim_quote;
      expect(originalQuote).toContain("80/1");

      // Step 3: Export saved answer (Markdown + PDF HTML)
      const exportedMd = exportTraceableAnswer(demoStore, {
        answer: env1,
        format: "markdown",
        actor: PUBLIC_READER,
      });
      expect(exportedMd.allowed).toBe(true);
      expect(exportedMd.content).toContain(primaryRef.evidence_id);
      expect(exportedMd.content).toContain("https://www.rd.go.th/68302.html");

      // Step 4: Ingest a later version in the test environment (effective 2027-01-01)
      const amendedText =
        "หนังสือตอบข้อหารือ กค 0702/636 (ฉบับทบทวนใหม่ปี 2570) กำหนดให้ผู้ประกอบการต้องยื่นหนังสือรับรองจากกรมความร่วมมือระหว่างประเทศก่อนใช้อัตราร้อยละ 0 ตั้งแต่วันที่ 1 มกราคม 2570";
      const laterVer = onboardOfficialSourceDocument(demoStore, {
        batch_id: "B01",
        release_id: "rel.B01.rc5",
        source_family: "revenue_department_ruling",
        issuer_id: "reg.th.rd",
        source_native_id: "กค 0702/636",
        original_title_th: "หนังสือตอบข้อหารือ กค 0702/636 (ฉบับทบทวนปี 2570)",
        observed_url: "https://www.rd.go.th/68302-rev2570.html",
        mime_type: "text/html",
        captured_bytes: amendedText,
        publication_date: "2027-01-01",
        effective_from: "2027-01-01",
        predecessor_version_id: primaryRef.version_id,
        is_verified_amendment: true,
      });

      // Step 5: Reopen saved answer & exported resolver link -> original wording is STILL inspectable + update notice shown!
      const reopenedSaved = reopenSavedTraceableAnswer(
        demoStore,
        env1.answer_revision,
        PUBLIC_READER
      );
      expect(reopenedSaved.found).toBe(true);
      expect(reopenedSaved.answer?.claims[0].evidence_references[0].version_id).toBe(
        primaryRef.version_id
      );
      expect(reopenedSaved.answer?.update_notices?.length).toBeGreaterThan(0);

      const resolvedOriginalAfterUpdate = resolveTraceableEvidenceById(
        demoStore,
        primaryRef.evidence_id,
        PUBLIC_READER,
        "rel.B01.rc5"
      );
      expect(resolvedOriginalAfterUpdate.evidence?.verbatim_quote).toBe(originalQuote);

      // Step 6: Fresh as-of query for 2027-06-01 selects the applicable NEW version!
      const fresh2027 = await queryKnowledge(
        {
          question: b01Question,
          release_id: "rel.B01.rc5",
          applicable_date: "2027-06-01",
          mode: "exact_lookup",
        },
        PUBLIC_READER,
        { store: demoStore }
      );
      expect(fresh2027.traceable_answer?.status).toBe("complete");
      expect(fresh2027.traceable_answer?.claims[0].text).toContain("ฉบับทบทวนใหม่ปี 2570");
      expect(fresh2027.traceable_answer?.claims[0].evidence_references[0].version_id).toBe(
        laterVer.version.version_id
      );

      // Step 7: Removing the required passage prevents the corresponding new claim from being published!
      removeOrWithdrawEligiblePassage(
        demoStore,
        laterVer.passages[0].passage_id,
        THAI_LEGAL_REVIEWER,
        "Owner's Demo step: remove required passage"
      );
      const afterPassageRemoved = await queryKnowledge(
        {
          question: b01Question,
          release_id: "rel.B01.rc5",
          applicable_date: "2027-06-01",
          mode: "exact_lookup",
        },
        PUBLIC_READER,
        { store: demoStore }
      );
      expect(afterPassageRemoved.traceable_answer?.status).toBe("insufficient");
      expect(afterPassageRemoved.traceable_answer?.claims.length).toBe(0);

      // Also verify human ambiguity resolution audit trail (`ANS-03`)
      const humanApproved = approveDocumentedAmbiguityWithEvidence(demoStore, {
        prior_answer_revision: env1.answer_revision,
        claim_text_th: "ผู้ประกอบการได้รับสิทธิอัตราร้อยละ 0 ตามเงื่อนไขโครงการความช่วยเหลือจากต่างประเทศใน กค 0702/636",
        claim_type: "interpretation",
        evidence_ids: [primaryRef.evidence_id],
        reviewer: THAI_LEGAL_REVIEWER,
        justification_th: "ผู้ตรวจทานกฎหมายยืนยันความสอดคล้องของถ้อยคำตามต้นฉบับ กค 0702/636",
      });
      expect(humanApproved.status).toBe("complete");
      expect(humanApproved.revision_number).toBe(2);
    } finally {
      try {
        fs.rmSync(demoDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup lag
      }
    }
  });
});
