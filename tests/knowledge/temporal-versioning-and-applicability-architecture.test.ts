import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { getVerifiedStatutoryCorpus } from "../../src/core/data/verified-statutory-loader";
import type { Actor } from "../../src/core/knowledge/contracts";
import { extractB02 } from "../../src/core/knowledge/profiles/B02";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import {
  extractAmendmentLedgerFromStatutoryText,
  extractBalancedParentheticalSpans,
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
});
