import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as postQueryRoute } from "../../src/app/api/v1/knowledge/query/route";
import { getVerifiedStatutoryCorpus } from "../../src/core/data/verified-statutory-loader";
import type { Actor } from "../../src/core/knowledge/contracts";
import { sha256Bytes } from "../../src/core/knowledge/identity";
import { extractB02 } from "../../src/core/knowledge/profiles/B02";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import { setCustomTrialAuditSink, type TrialAuditEvent } from "../../src/core/knowledge/trial-gate";
import {
  extractAmendmentLedgerFromStatutoryText,
  extractBalancedParentheticalSpans,
  parseFlexibleMonthYearToRange,
  parseFlexibleThaiOrEnglishDateToIso,
} from "../../src/core/knowledge/temporal-versioning";

const LEGAL_REVIEW_ACTOR: Actor = {
  actor_id: "legal.team@7ladvisory.com",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const PREVIEW_STORE_DIR = path.resolve(
  process.cwd(),
  "data",
  "knowledge-store-b01-rc2-staging"
);
const TARGET_RELEASE_ID = "rel.B01.rc5";

function assertS1CitationGate(res: Awaited<ReturnType<typeof queryKnowledge>>, label: string) {
  for (const ec of res.evidence) {
    expect(ec.locator.origin_uri, `${label}: origin_uri`).toMatch(/^https?:\/\//);
    expect(ec.passage_id.includes("ext.dep."), `${label}: no synthetic ext.dep.`).toBe(false);
    const bare = ec.official_identifier.replace(/^กค\s+/, "").trim();
    const inBody =
      res.answer.includes(ec.official_identifier) ||
      (bare.length >= 4 && res.answer.includes(bare)) ||
      res.answer.includes(ec.title_th);
    expect(
      inBody,
      `${label}: citation '${ec.official_identifier}' must appear in answer body`
    ).toBe(true);
  }
}

describe("REG24 Durable Statutory Versioning, Temporal Applicability & Multi-Batch Architecture", () => {
  it("1. Structured amendment_ledger & Royal Gazette provenance across B01 and B02 (balanced parentheses, distinct enactment date vs accounting-period start)", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);
    const state = store.getState();

    // 1a. Balanced-parenthesis parser handles nested `(ฉบับที่ 51)` notes cleanly across all amended Revenue Code sections
    const verCorpus = getVerifiedStatutoryCorpus();
    let totalAmendedSections = 0;
    let totalLedgerEntries = 0;
    for (const [workId, sec] of Object.entries(verCorpus.revenue_code_sections)) {
      const spans = extractBalancedParentheticalSpans(sec.verbatim_text);
      expect(spans.length).toBeGreaterThanOrEqual(0);
      const ledger = extractAmendmentLedgerFromStatutoryText(workId, sec.verbatim_text);
      if (ledger.length > 0) {
        totalAmendedSections += 1;
        totalLedgerEntries += ledger.length;
      }
    }
    expect(totalAmendedSections).toBeGreaterThanOrEqual(150);
    expect(totalLedgerEntries).toBeGreaterThanOrEqual(280);

    // 1b. Verify persisted `ver.th.rc.65_ตรี.v2_current` separates Royal Gazette enactment (`2019-04-17`) from `ACCOUNTING_PERIOD_START` (`2018-01-01`)
    const ver65Ter = state.versions["ver.th.rc.65_ตรี.v2_current"];
    expect(ver65Ter).toBeDefined();
    expect(ver65Ter.is_consolidated_derived).toBe(true);
    expect(ver65Ter.legal_applicability[0].valid_from).toBeNull();
    expect(ver65Ter.legal_applicability[0].applicability_basis).toBe(
      "CONSOLIDATED_MULTI_AMENDMENT"
    );

    const item65Ter3 = ver65Ter.amendment_ledger?.find((x) => x.subprovision_label === "(3)");
    expect(item65Ter3).toBeDefined();
    expect(item65Ter3?.amending_work_id).toBe("statute.th.rc_amendment_51_2562");
    expect(item65Ter3?.amending_source_uri).toBe(
      "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p51.pdf"
    );
    expect(item65Ter3?.gazette_publication_date).toBe("2019-04-16");
    expect(item65Ter3?.enactment_effective_date).toBe("2019-04-17");
    expect(item65Ter3?.applicability_basis).toBe("ACCOUNTING_PERIOD_START");
    expect(item65Ter3?.applicability_from_date).toBe("2018-01-01");
    expect(item65Ter3?.enactment_effective_date).not.toBe(item65Ter3?.applicability_from_date);
    // Unreviewed scanned 1991 Emergency Decree No. 16 (`prk16.pdf`) remains contained (`pre_amendment_verified_version_id: null`)
    expect(item65Ter3?.pre_amendment_verified_version_id).toBeNull();
    expect(item65Ter3?.pre_amendment_source_uri).toBe(
      "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/prk16.pdf"
    );

    // 1c. Verify `prov.th.rc.80/1` `(5)` stores Act No. 49 B.E. 2562 (`p49.pdf`, `2019-02-28` `TRANSACTION_OR_EVENT_DATE`)
    const ver80_1 = state.versions["ver.th.rc.80/1.v1"];
    const item80_1_5 = ver80_1?.amendment_ledger?.find((x) => x.subprovision_label === "(5)");
    expect(item80_1_5).toBeDefined();
    expect(item80_1_5?.amending_work_id).toBe("statute.th.rc_amendment_49_2562");
    expect(item80_1_5?.amending_source_uri).toBe(
      "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p49.pdf"
    );
    expect(item80_1_5?.gazette_publication_date).toBe("2019-02-27");
    expect(item80_1_5?.enactment_effective_date).toBe("2019-02-28");
    expect(item80_1_5?.applicability_basis).toBe("TRANSACTION_OR_EVENT_DATE");
    expect(item80_1_5?.applicability_from_date).toBe("2019-02-28");

    // 1d. Verify Royal Gazette Amending Acts (`p49.pdf` & `p51.pdf`) and `AMENDS` edges are materialized in staging store
    expect(state.works["statute.th.rc_amendment_51_2562"]).toBeDefined();
    expect(state.works["statute.th.rc_amendment_49_2562"]).toBeDefined();
    const amendsAssertions = Object.values(state.assertions).filter(
      (a) => a.predicate === "AMENDS" && a.state === "ACCEPTED"
    );
    expect(
      amendsAssertions.some(
        (a) =>
          a.subject === "statute.th.rc_amendment_51_2562" && a.object === "prov.th.rc.65_ตรี"
      )
    ).toBe(true);
    expect(
      amendsAssertions.some(
        (a) => a.subject === "statute.th.rc_amendment_49_2562" && a.object === "prov.th.rc.80/1"
      )
    ).toBe(true);

    // 1e. Multi-Batch (`B02`) Parity: `extractB02()` populates `amendment_ledger` identically on consolidated statutory texts
    const sampleText = verCorpus.revenue_code_sections["prov.th.rc.65_ตรี"].verbatim_text;
    const b02Sample = await extractB02({
      artifact: {
        artifact_id: "art.test.b02.5939",
        origin_uri: "https://www.rd.go.th/5939.html#mata65_3",
        immutable_uri: "https://www.rd.go.th/5939.html#mata65_3",
        actual_bytes_sha256: verCorpus.revenue_code_sections["prov.th.rc.65_ตรี"].artifact_sha256,
        MIME: "text/html",
        size: verCorpus.revenue_code_sections["prov.th.rc.65_ตรี"].artifact_size,
        fetched_at: "2026-11-18T00:00:00.000Z",
        authenticity_status: "official_html_snapshot",
        is_derivative: false,
        access_scope: "scope.platform.public",
        rights_status: "approved_public",
      },
      extraction: {
        extraction_id: "ext.test.b02.5939",
        artifact_id: "art.test.b02.5939",
        work_id: "prov.th.rc.65_ตรี",
        version_id: "ver.test.b02.5939",
        extractor_version: "b02-test",
        model_version: "native",
        configuration_version: "cfg.v1",
        raw_text_uri: "https://www.rd.go.th/5939.html#mata65_3",
        raw_text: sampleText,
        normalized_text: sampleText,
        normalization_log: [],
        quality_status: "VALIDATED",
        accepted_revision: 1,
        created_at: "2026-11-18T00:00:00.000Z",
      },
      release_id: "rel.B02.test",
      batch_id: "B02",
      candidate_work_id: "prov.th.rc.65_ตรี",
      candidate_version_id: "ver.test.b02.5939",
      processing_version: "b02.v1",
      access_scope: "scope.platform.public",
      source_metadata: {
        title_th: "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับรวมแก้ไขเพิ่มเติม)",
        folder: "ประมวลรัษฎากร",
        file_name: "5939.html",
      },
    });
    expect((b02Sample.version.amendment_ledger?.length || 0)).toBeGreaterThanOrEqual(5);
    expect(
      b02Sample.version.amendment_ledger?.some(
        (x) => x.applicability_basis === "ACCOUNTING_PERIOD_START"
      )
    ).toBe(true);
  });

  it("2. Original Issue (LSC-12) & Alternative Thai + English Wording (With and Without Section Numbers): Contains unverified historical versions cleanly", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);

    const historicalContainmentCases: Array<{
      label: string;
      question: string;
      applicable_date?: string | null;
    }> = [
      {
        label: "Original LSC-12 (explicit section + point-in-time 2018-06-30)",
        question:
          "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2018-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
        applicable_date: "2018-06-30",
      },
      {
        label: "Descriptive Thai WITHOUT section number (year B.E. 2560 political donation)",
        question:
          "ในปี 2560 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท สามารถนำมาหักเป็นรายจ่ายในการคำนวณกำไรสุทธิได้ไหม",
      },
      {
        label: "Colloquial Thai WITHOUT section number (FY closed 31 Mar B.E. 2561 straddling cutoff)",
        question:
          "งบปีที่สิ้นสุด 31 มี.ค. 61 บริษัทจ่ายเงินสนับสนุนพรรคการเมืองห้าหมื่นบาท หักค่าใช้จ่ายนิติบุคคลได้หรือเปล่า",
      },
      {
        label: "Descriptive English WITHOUT section number (FY ended 30 June 2018 political party donation)",
        question:
          "Can a Thai company deduct a 50,000 baht donation to a political party for its fiscal year ended 30 June 2018?",
      },
      {
        label: "English WITH Section 65 ter (3)(a) reference in 2017",
        question:
          "Under Section 65 ter (3)(a) of the Revenue Code, could a corporate taxpayer deduct a political party contribution in 2017?",
      },
      {
        label: "Descriptive Thai WITHOUT section number on s.80/1(5) before 28 Feb 2019",
        question:
          "เมื่อวันที่ 15 มกราคม 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศในประเทศไทย ได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 หรือไม่",
      },
      {
        label: "Descriptive English WITHOUT section number on s.80/1(5) before 28 Feb 2019",
        question:
          "Did selling goods to a foreign economic and trade office in Thailand on 15 January 2019 qualify for 0% VAT?",
      },
    ];

    for (const tc of historicalContainmentCases) {
      const res = await queryKnowledge(
        {
          question: tc.question,
          release_id: TARGET_RELEASE_ID,
          applicable_date: tc.applicable_date ?? null,
        },
        LEGAL_REVIEW_ACTOR,
        { store }
      );
      expect(res.status, tc.label).toBe("INSUFFICIENT_EVIDENCE");
      expect(res.evidence, tc.label).toEqual([]);
      // Must NEVER claim the post-amendment deduction / 0% VAT applied to the earlier period
      expect(res.answer, tc.label).toContain("ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง");
    }
  });

  it("3. Amendment Boundaries: Accounting-period start vs end vs Gazette enactment date (Act No. 51) & exact transaction effective date (Act No. 49)", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);

    // Boundary 3A: Standard 12m FY `1 Jul 2017 – 30 Jun 2018` (`starts < 2018-01-01`) -> CONTAINED (`INSUFFICIENT_EVIDENCE`)
    const fyPreCutoff = await queryKnowledge(
      {
        question:
          "บริษัทมีรอบระยะเวลาบัญชีเริ่มวันที่ 1 กรกฎาคม 2560 ถึงวันที่ 30 มิถุนายน 2561 บริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายตามมาตรา 65 ตรี ได้หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(fyPreCutoff.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(fyPreCutoff.evidence).toEqual([]);
    expect(fyPreCutoff.answer).toContain("2017-07-01");
    expect(fyPreCutoff.answer).toContain("2018-01-01");
    expect(fyPreCutoff.answer).toContain("p51.pdf");

    // Boundary 3B: Short FY `1 Feb 2018 – 30 Jun 2018` (SAME end date `30 Jun 2018`, but `starts = 2018-02-01 >= 2018-01-01`!) -> ALLOWED WITH PROOF (`p51.pdf`)
    const shortFyPostCutoff = await queryKnowledge(
      {
        question:
          "บริษัทตั้งใหม่มีรอบระยะเวลาบัญชีเริ่มวันที่ 1 กุมภาพันธ์ 2561 ถึงวันที่ 30 มิถุนายน 2561 บริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(shortFyPostCutoff.status);
    expect(shortFyPostCutoff.answer).toContain("2018-02-01");
    expect(shortFyPostCutoff.answer).toContain("2019-04-17");
    expect(shortFyPostCutoff.answer).toContain("p51.pdf");
    expect(shortFyPostCutoff.evidence.some((e) => e.work_id === "prov.th.rc.65_ตรี")).toBe(true);
    expect(
      shortFyPostCutoff.evidence.some((e) => e.work_id === "statute.th.rc_amendment_51_2562")
    ).toBe(true);
    assertS1CitationGate(shortFyPostCutoff, "Boundary 3B short FY Thai");

    // Boundary 3C: Calendar FY `1 Jan 2018 – 31 Dec 2018` in English (BEFORE `2019-04-17` Gazette date, yet `starts == 2018-01-01`!) -> ALLOWED WITH PROOF (`p51.pdf`)
    const cal2018En = await queryKnowledge(
      {
        question:
          "Our Thai company has an accounting period from 1 January 2018 to 31 December 2018 and donated 50,000 THB to a political party. Is it deductible?",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(cal2018En.status);
    expect(cal2018En.answer).toContain("2018-01-01");
    expect(cal2018En.answer).toContain("p51.pdf");
    expect(cal2018En.evidence.some((e) => e.work_id === "prov.th.rc.65_ตรี")).toBe(true);
    expect(
      cal2018En.evidence.some((e) => e.work_id === "statute.th.rc_amendment_51_2562")
    ).toBe(true);
    assertS1CitationGate(cal2018En, "Boundary 3C calendar 2018 English");

    // Boundary 3D: Section 80/1 (5) on `2019-02-27` (Gazette publication day, 1 day BEFORE effective date) vs `2019-02-28` (effective date)
    const vatDayBefore = await queryKnowledge(
      {
        question:
          "เมื่อวันที่ 27 กุมภาพันธ์ 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามมาตรา 80/1 (5) ได้หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(vatDayBefore.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(vatDayBefore.evidence).toEqual([]);
    expect(vatDayBefore.answer).toContain("2019-02-28");
    expect(vatDayBefore.answer).toContain("p49.pdf");

    const vatEffectiveDay = await queryKnowledge(
      {
        question:
          "เมื่อวันที่ 28 กุมภาพันธ์ 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามมาตรา 80/1 (5) ได้หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(vatEffectiveDay.status);
    expect(vatEffectiveDay.answer).toContain("2019-02-28");
    expect(vatEffectiveDay.answer).toContain("p49.pdf");
    expect(vatEffectiveDay.evidence.some((e) => e.work_id === "prov.th.rc.80/1")).toBe(true);
    expect(
      vatEffectiveDay.evidence.some((e) => e.work_id === "statute.th.rc_amendment_49_2562")
    ).toBe(true);
    assertS1CitationGate(vatEffectiveDay, "Boundary 3D s.80/1(5) effective day");
  });

  it("4. Missing Relevant Date Detection: Prompts for actual accounting-period start date or transaction date when material to amendment applicability", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);

    const missingDateTh = await queryKnowledge(
      {
        question:
          "บริษัทบริจาคเงินให้พรรคการเมือง 40,000 บาท สามารถนำมาหักเป็นรายจ่ายในการคำนวณกำไรสุทธิได้หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(missingDateTh.status).toBe("NEEDS_CLARIFICATION");
    expect(missingDateTh.clarification_questions.length).toBeGreaterThan(0);
    expect(missingDateTh.clarification_questions[0]).toContain("วันเริ่มต้นและวันสิ้นสุดของรอบระยะเวลาบัญชีจริง");
    expect(missingDateTh.answer).toContain("p51.pdf");
    assertS1CitationGate(missingDateTh, "Missing date Thai political donation");

    const missingDateEn = await queryKnowledge(
      {
        question: "Can our Thai company deduct a 40,000 THB donation to a political party?",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(missingDateEn.status).toBe("NEEDS_CLARIFICATION");
    expect(missingDateEn.clarification_questions.length).toBeGreaterThan(0);
    expect(missingDateEn.clarification_questions[0]).toContain("2018-01-01");
    assertS1CitationGate(missingDateEn, "Missing date English political donation");

    // Mid-year ambiguous year (`ในปี 2562`) on s.80/1(5) amended `2019-02-28` -> asks exact date within B.E. 2562!
    const midYearAmbiguous = await queryKnowledge(
      {
        question:
          "ในปี 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ ได้สิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(midYearAmbiguous.status).toBe("NEEDS_CLARIFICATION");
    expect(midYearAmbiguous.clarification_questions[0]).toContain("2019-02-28");
    assertS1CitationGate(midYearAmbiguous, "Mid-year ambiguous B.E. 2562 s.80/1(5)");
  });

  it("5. Distinguishes Historical Ruling Lookup vs Period-Law Query, Preserves Exceptions (s.19 5-year extension), and Enforces Citation Gate", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);

    // 5A. Historical document lookup in English (`GorKor 0811(KorMor.03)/366`) -> Renders 2545 memo + Section 19 up-to-5-year DG extension exception
    const lookupMemoEn = await queryKnowledge(
      {
        question: "Please find Revenue Department ruling GorKor 0811(KorMor.03)/366",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(lookupMemoEn.status);
    expect(lookupMemoEn.answer).toContain("บันทึกกองกฎหมาย");
    expect(lookupMemoEn.answer).toContain("ภายในเวลาสองปี");
    expect(lookupMemoEn.answer).toContain("ไม่เกิน 5 ปีนับแต่วันที่ได้ยื่นรายการ");
    expect(lookupMemoEn.answer).toContain("อธิบดีกรมสรรพากร");
    expect(
      lookupMemoEn.evidence.some((e) => e.official_identifier.includes("0811(กม.03)/366"))
    ).toBe(true);
    expect(lookupMemoEn.evidence.some((e) => e.work_id === "prov.th.rc.19")).toBe(true);
    assertS1CitationGate(lookupMemoEn, "Historical memo lookup English");

    // 5B. Historical ruling lookup (`กค 0811/11340` from B.E. 2542) -> Shown in full with >10-year currency warning + [sic] note
    const lookup2542 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0811/11340",
        release_id: TARGET_RELEASE_ID,
        mode: "exact_lookup",
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(lookup2542.status).toBe("ANSWERED");
    expect(lookup2542.answer).toContain("เกินกว่า 10 ปี");
    expect(lookup2542.answer).toContain("[sic]");
    assertS1CitationGate(lookup2542, "Historical ruling lookup 2542");

    // 5C. English quarantined Royal Decree No. 736 period query -> Contained (`INSUFFICIENT_EVIDENCE`), never fabricated
    const rd736En = await queryKnowledge(
      {
        question: "Did Royal Decree No. 736 apply to land expropriation in 2018?",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(rd736En.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(rd736En.evidence).toEqual([]);

    // 5D. Period-law anachronism guard: Asking for applicable law in B.E. 2540 (1997) where nearest ruling (`กค 0702/1903`) relies on B.E. 2558 Animal Feed Quality Control Act -> Contained (`INSUFFICIENT_EVIDENCE`), while explicit lookup of `กค 0702/1903` succeeds!
    const period1997 = await queryKnowledge(
      {
        question:
          "ในปี 2540 บริษัทนำเข้าสารเสริมสำหรับสัตว์จากต่างประเทศ ได้รับยกเว้นภาษีมูลค่าเพิ่มหรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(period1997.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(period1997.evidence).toEqual([]);
    expect(period1997.answer).toContain("2540");
    expect(period1997.answer).toContain("ระงับการนำแนววินิจฉัย");

    const explicit1903 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1903",
        release_id: TARGET_RELEASE_ID,
        mode: "exact_lookup",
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(explicit1903.status).toBe("ANSWERED");
    expect(explicit1903.evidence.some((e) => e.official_identifier.includes("0702/1903"))).toBe(
      true
    );
    assertS1CitationGate(explicit1903, "Explicit lookup 0702/1903");
  });

  it("6. Dodo Finding A — Alternative Date & Period Formats (Slash, Dot, Dash, B.E. YYYY-MM-DD, Month+Year, Split FY, 2-Digit Years, Thai+CE)", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);

    // 6A. Direct unit checks across diverse Thai & English date formats
    expect(parseFlexibleThaiOrEnglishDateToIso("30/06/2561")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("30/06/61")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("30-06-2018")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("30.06.2018")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("06/30/2018")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("2561-06-30")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("2561/06/30")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("30 มิถุนายน 2018")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("30 มิย 61")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("30-Jun-2018")).toBe("2018-06-30");
    expect(parseFlexibleThaiOrEnglishDateToIso("15-Jan-19")).toBe("2019-01-15");
    expect(parseFlexibleMonthYearToRange("พฤษภาคม 2560")).toEqual({
      startIso: "2017-05-01",
      endIso: "2017-05-31",
      yearCe: 2017,
      month: 5,
    });
    expect(parseFlexibleMonthYearToRange("June 2018")).toEqual({
      startIso: "2018-06-01",
      endIso: "2018-06-30",
      yearCe: 2018,
      month: 6,
    });

    // 6B. End-to-end containment across alternative pre-amendment / straddling date formats
    const altHistoricalCases: Array<{
      label: string;
      question: string;
      applicable_date?: string | null;
    }> = [
      {
        label: "Slash B.E. date in prose (30/06/2561)",
        question:
          "รอบระยะเวลาบัญชีสิ้นสุด 30/06/2561 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
      },
      {
        label: "Buddhist-year YYYY-MM-DD in API applicable_date (2561-06-30)",
        question: "ประมวลรัษฎากร มาตรา 65 ตรี ใช้บังคับอย่างไรสำหรับรอบระยะเวลาบัญชีนี้",
        applicable_date: "2561-06-30",
      },
      {
        label: "Slash B.E. date in API applicable_date (30/06/2561)",
        question: "ประมวลรัษฎากร มาตรา 65 ตรี ใช้บังคับอย่างไร",
        applicable_date: "30/06/2561",
      },
      {
        label: "Thai Month + Year without day (ในเดือนพฤษภาคม 2560)",
        question:
          "ในเดือนพฤษภาคม 2560 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักรายจ่ายนิติบุคคลได้ไหม",
      },
      {
        label: "English Month + Year without day (In May 2017)",
        question:
          "In May 2017, our Thai company donated 50,000 THB to a political party. Is it deductible?",
      },
      {
        label: "Split fiscal year FY 2017/18",
        question:
          "For FY 2017/18, could a Thai company deduct a 50,000 THB political party contribution?",
      },
      {
        label: "Compact FY2017 without space",
        question: "Could a Thai company deduct a political party donation in FY2017?",
      },
      {
        label: "Two-digit Thai B.E. year (ในปี 60)",
        question: "ในปี 60 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
      },
      {
        label: "Dot C.E. date on s.80/1(5) (27.02.2019)",
        question:
          "เมื่อวันที่ 27.02.2019 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ ได้สิทธิ VAT 0% หรือไม่",
      },
    ];

    for (const tc of altHistoricalCases) {
      const res = await queryKnowledge(
        {
          question: tc.question,
          release_id: TARGET_RELEASE_ID,
          applicable_date: tc.applicable_date ?? null,
        },
        LEGAL_REVIEW_ACTOR,
        { store }
      );
      expect(res.status, tc.label).toBe("INSUFFICIENT_EVIDENCE");
      expect(res.evidence, tc.label).toEqual([]);
      expect(res.answer, tc.label).toContain("ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง");
    }

    // 6C. Post-cutoff alternative date formats (`01/02/2561 - 30/06/2561` & `28/02/2562`) -> Verified with Royal Gazette proof!
    const slashShortFyOk = await queryKnowledge(
      {
        question:
          "บริษัทมีรอบระยะเวลาบัญชี 01/02/2561 - 30/06/2561 บริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(["ANSWERED", "CONDITIONAL"]).toContain(slashShortFyOk.status);
    expect(slashShortFyOk.evidence.some((e) => e.work_id === "prov.th.rc.65_ตรี")).toBe(true);
    expect(
      slashShortFyOk.evidence.some((e) => e.work_id === "statute.th.rc_amendment_51_2562")
    ).toBe(true);
    assertS1CitationGate(slashShortFyOk, "Slash short FY 01/02/2561 - 30/06/2561");

    // 6D. Mid-month straddle (`ในเดือนกุมภาพันธ์ 2562` on s.80/1(5) effective `2019-02-28`) -> NEEDS_CLARIFICATION
    const feb2562Straddle = await queryKnowledge(
      {
        question:
          "ในเดือนกุมภาพันธ์ 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ ได้สิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 หรือไม่",
        release_id: TARGET_RELEASE_ID,
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(feb2562Straddle.status).toBe("NEEDS_CLARIFICATION");
    expect(feb2562Straddle.clarification_questions[0]).toContain("2019-02-28");
    assertS1CitationGate(feb2562Straddle, "Mid-month straddle Feb 2562");
  });

  it("7. Dodo Finding B — Questions That Include a Ruling Number: Enforces period-law containment while preserving genuine historical ruling lookups", async () => {
    const store = new DurableKnowledgeStore(PREVIEW_STORE_DIR);

    const mixedRulingAndHistoricalPeriodCases: Array<{
      label: string;
      question: string;
      mode?: "standard" | "exact_lookup" | "comparison";
      applicable_date?: string | null;
    }> = [
      {
        label: "Ruling กค 0702/1903 (2567) applied to historical import on 15/03/2540",
        question:
          "ตามหนังสือตอบข้อหารือ กค 0702/1903 หากบริษัทนำเข้าสารเสริมสำหรับสัตว์เมื่อวันที่ 15/03/2540 จะได้รับยกเว้นภาษีมูลค่าเพิ่มหรือไม่",
      },
      {
        label: "English ruling GorKor 0702/1903 applied to May 1997 import",
        question:
          "Can we apply ruling GorKor 0702/1903 to an animal feed supplement import in May 1997?",
      },
      {
        label: "Ruling กค 0811(กม.03)/366 combined with s.65 ter political donation on 30/06/2561",
        question:
          "อ้างอิง กค 0811(กม.03)/366 สำหรับรอบระยะเวลาบัญชีสิ้นสุด 30/06/2561 บริษัทหักเงินบริจาคพรรคการเมืองตามมาตรา 65 ตรี ได้หรือไม่",
      },
      {
        label: "English ruling GK 0702/1494 combined with FY 2017/18 political donation",
        question:
          "Under ruling GK 0702/1494 and Section 65 ter, could our company deduct a 50,000 THB political party donation for FY 2017/18?",
      },
      {
        label: "exact_lookup mode with ruling กค 0702/1494 + historical May 2560 political donation",
        question:
          "ตาม กค 0702/1494 ในเดือนพฤษภาคม 2560 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักรายจ่ายได้ไหม",
        mode: "exact_lookup",
      },
      {
        label: "Old ruling กค 0811/11340 (B.E. 2542) asked to establish applicable law in B.E. 2558",
        question:
          "ตามหนังสือตอบข้อหารือ กค 0811/11340 ในปี 2558 กฎหมายเรื่องการโอนหุ้นใช้บังคับอย่างไร",
      },
      {
        label: "Comparison of two rulings (กค 0702/1903 vs กค 0702/634) for imports in B.E. 2540",
        question:
          "เปรียบเทียบ กค 0702/1903 กับ กค 0702/634 สำหรับการนำเข้าในปี 2540 ว่าเสียภาษีมูลค่าเพิ่มอย่างไร",
        mode: "comparison",
      },
      {
        label: "Comparison of Section 65 ter between 30/06/2561 and 15/01/2568",
        question:
          "เปรียบเทียบมาตรา 65 ตรี กรณีบริจาคพรรคการเมือง ระหว่างรอบบัญชีสิ้นสุด 30/06/2561 กับ 15/01/2568",
        mode: "comparison",
      },
    ];

    for (const rc of mixedRulingAndHistoricalPeriodCases) {
      const res = await queryKnowledge(
        {
          question: rc.question,
          release_id: TARGET_RELEASE_ID,
          mode: rc.mode ?? "standard",
          applicable_date: rc.applicable_date ?? null,
        },
        LEGAL_REVIEW_ACTOR,
        { store }
      );
      expect(res.status, rc.label).toBe("INSUFFICIENT_EVIDENCE");
      expect(res.evidence, rc.label).toEqual([]);
      expect(res.answer, rc.label).toMatch(/ไม่พบข้อมูล|หลักฐานไม่เพียงพอ/);
    }

    // Confirm genuine homonym & dated historical ruling lookups STILL answer cleanly!
    const homonym2555 = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636 ปี 2555",
        release_id: TARGET_RELEASE_ID,
        mode: "exact_lookup",
      },
      LEGAL_REVIEW_ACTOR,
      { store }
    );
    expect(homonym2555.status).toBe("ANSWERED");
    expect(homonym2555.answer).toContain("23 มกราคม 2555");
    assertS1CitationGate(homonym2555, "Homonym lookup 0702/636 year 2555");
  });

  it("8. Full HTTP Answer Flow, Invite-Only Gate & Audit Verification (POST /api/v1/knowledge/query)", async () => {
    const prevInviteOnly = process.env.REG24_TRIAL_INVITE_ONLY;
    const prevAllowedHashes = process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256;
    const validInviteCode = "INV-7L-TRIAL-20NOV-TEST";
    const validInviteSha = sha256Bytes(validInviteCode);
    const capturedAudits: TrialAuditEvent[] = [];

    try {
      setDefaultKnowledgeStoreForTesting(new DurableKnowledgeStore(PREVIEW_STORE_DIR));
      setCustomTrialAuditSink({
        append: (ev) => {
          capturedAudits.push(ev);
        },
      });
      process.env.REG24_TRIAL_INVITE_ONLY = "1";
      process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256 = validInviteSha;

      // 8A. Uninvited caller is rejected fail-closed with 401/403
      const unauthReq = new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/1903" }),
      });
      const unauthRes = await postQueryRoute(unauthReq);
      expect([401, 403]).toContain(unauthRes.status);

      // 8B. Invited caller asking unsupported historical-law question (ruling + slash date) -> HTTP 200, INSUFFICIENT_EVIDENCE, 0 citations, audited
      const histReq = new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reg24-trial-invite": validInviteCode,
        },
        body: JSON.stringify({
          question:
            "อ้างอิง กค 0811(กม.03)/366 สำหรับรอบระยะเวลาบัญชีสิ้นสุด 30/06/2561 บริษัทหักเงินบริจาคพรรคการเมืองตามมาตรา 65 ตรี ได้หรือไม่",
          release_id: TARGET_RELEASE_ID,
        }),
      });
      const histRes = await postQueryRoute(histReq);
      expect(histRes.status).toBe(200);
      expect(histRes.headers.get("x-reg24-audit-status")).toBe("custom_sink");
      expect(histRes.headers.get("x-reg24-ratelimit-backend")).toBeTruthy();
      const histJson = (await histRes.json()) as {
        ok: boolean;
        answer: { status: string; evidence: unknown[]; answer: string };
        audit_status: { persisted_durable: boolean };
      };
      expect(histJson.ok).toBe(true);
      expect(histJson.audit_status.persisted_durable).toBe(true);
      expect(histJson.answer.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(histJson.answer.evidence).toEqual([]);
      expect(histJson.answer.answer).toContain("ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง");

      // 8C. Invited caller asking verified post-cutoff period (`01/02/2561 - 30/06/2561`) -> HTTP 200, ANSWERED/CONDITIONAL, co-cites statute + Gazette p51.pdf
      const okReq = new Request("http://localhost/api/v1/knowledge/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-reg24-trial-invite": validInviteCode,
        },
        body: JSON.stringify({
          question:
            "บริษัทมีรอบระยะเวลาบัญชี 01/02/2561 - 30/06/2561 บริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
          release_id: TARGET_RELEASE_ID,
        }),
      });
      const okRes = await postQueryRoute(okReq);
      expect(okRes.status).toBe(200);
      const okJson = (await okRes.json()) as {
        ok: boolean;
        answer: { status: string; evidence: Array<{ work_id: string }> };
      };
      expect(["ANSWERED", "CONDITIONAL"]).toContain(okJson.answer.status);
      expect(okJson.answer.evidence.some((e) => e.work_id === "prov.th.rc.65_ตรี")).toBe(true);
      expect(
        okJson.answer.evidence.some((e) => e.work_id === "statute.th.rc_amendment_51_2562")
      ).toBe(true);
      expect(capturedAudits.length).toBe(2);
    } finally {
      setCustomTrialAuditSink(null);
      setDefaultKnowledgeStoreForTesting(null);
      if (prevInviteOnly === undefined) delete process.env.REG24_TRIAL_INVITE_ONLY;
      else process.env.REG24_TRIAL_INVITE_ONLY = prevInviteOnly;
      if (prevAllowedHashes === undefined) delete process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256;
      else process.env.REG24_TRIAL_ALLOWED_INVITE_SHA256 = prevAllowedHashes;
    }
  });
});
