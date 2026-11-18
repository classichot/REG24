/**
 * REG24 — End-to-End Evidence Generator for Durable Statutory Versioning & Temporal Applicability Architecture
 *
 * Produces `docs/audit/dodo-review-rc2-b02/legal_version_architecture_e2e_evidence_20261118.json`
 * for Dodo & Product Owner's Legal Team review.
 * Security (S-8): Never writes `_vercel_share` tokens or secret URLs into the output receipt.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getVerifiedStatutoryCorpus } from "../src/core/data/verified-statutory-loader";
import type { Actor } from "../src/core/knowledge/contracts";
import { queryKnowledge } from "../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { extractAmendmentLedgerFromStatutoryText } from "../src/core/knowledge/temporal-versioning";

const REVIEW_ACTOR: Actor = {
  actor_id: "legal.verification@7ladvisory.com",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

interface E2ECaseSpec {
  case_id: string;
  category:
    | "1_original_and_alternative_wording_containment"
    | "2_amendment_boundaries_start_vs_end_vs_enactment"
    | "3_missing_relevant_date_clarification"
    | "4_historical_document_lookup_vs_period_law";
  language: "th" | "en";
  question: string;
  applicable_date?: string | null;
  mode?: "standard" | "exact_lookup" | "comparison";
  expected_status_in: string[];
  expected_citations_include?: string[];
  must_contain_substrings: string[];
}

const E2E_CASES: E2ECaseSpec[] = [
  {
    case_id: "LV-01",
    category: "1_original_and_alternative_wording_containment",
    language: "th",
    question:
      "ประมวลรัษฎากร มาตรา 65 ตรี สำหรับรอบระยะเวลาบัญชี ณ วันที่ 2018-06-30 ใช้บทบัญญัติรุ่นใดบังคับ",
    applicable_date: "2018-06-30",
    expected_status_in: ["INSUFFICIENT_EVIDENCE"],
    must_contain_substrings: [
      "ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง",
      "2018-01-01",
      "p51.pdf",
    ],
  },
  {
    case_id: "LV-02",
    category: "1_original_and_alternative_wording_containment",
    language: "th",
    question:
      "ในปี 2560 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท สามารถนำมาหักเป็นรายจ่ายในการคำนวณกำไรสุทธิได้ไหม",
    expected_status_in: ["INSUFFICIENT_EVIDENCE"],
    must_contain_substrings: [
      "ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง",
      "1 มกราคม พ.ศ. 2561",
    ],
  },
  {
    case_id: "LV-03",
    category: "1_original_and_alternative_wording_containment",
    language: "en",
    question:
      "Can a Thai company deduct a 50,000 baht donation to a political party for its fiscal year ended 30 June 2018?",
    expected_status_in: ["INSUFFICIENT_EVIDENCE"],
    must_contain_substrings: [
      "ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง",
      "2017-07-01",
      "p51.pdf",
    ],
  },
  {
    case_id: "LV-04",
    category: "1_original_and_alternative_wording_containment",
    language: "en",
    question:
      "Did selling goods to a foreign economic and trade office in Thailand on 15 January 2019 qualify for 0% VAT?",
    expected_status_in: ["INSUFFICIENT_EVIDENCE"],
    must_contain_substrings: [
      "ไม่พบข้อมูลตัวบทย้อนหลังที่ผ่านการรับรอง",
      "2019-02-28",
      "p49.pdf",
    ],
  },
  {
    case_id: "LV-05",
    category: "2_amendment_boundaries_start_vs_end_vs_enactment",
    language: "th",
    question:
      "บริษัทมีรอบระยะเวลาบัญชีเริ่มวันที่ 1 กรกฎาคม 2560 ถึงวันที่ 30 มิถุนายน 2561 บริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
    expected_status_in: ["INSUFFICIENT_EVIDENCE"],
    must_contain_substrings: ["2017-07-01", "2018-01-01", "p51.pdf"],
  },
  {
    case_id: "LV-06",
    category: "2_amendment_boundaries_start_vs_end_vs_enactment",
    language: "th",
    question:
      "บริษัทตั้งใหม่มีรอบระยะเวลาบัญชีเริ่มวันที่ 1 กุมภาพันธ์ 2561 ถึงวันที่ 30 มิถุนายน 2561 บริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
    expected_status_in: ["ANSWERED", "CONDITIONAL"],
    expected_citations_include: ["prov.th.rc.65_ตรี", "statute.th.rc_amendment_51_2562"],
    must_contain_substrings: ["2018-02-01", "2019-04-17", "p51.pdf"],
  },
  {
    case_id: "LV-07",
    category: "2_amendment_boundaries_start_vs_end_vs_enactment",
    language: "en",
    question:
      "Our Thai company has an accounting period from 1 January 2018 to 31 December 2018 and donated 50,000 THB to a political party. Is it deductible?",
    expected_status_in: ["ANSWERED", "CONDITIONAL"],
    expected_citations_include: ["prov.th.rc.65_ตรี", "statute.th.rc_amendment_51_2562"],
    must_contain_substrings: ["2018-01-01", "p51.pdf"],
  },
  {
    case_id: "LV-08",
    category: "2_amendment_boundaries_start_vs_end_vs_enactment",
    language: "th",
    question:
      "เมื่อวันที่ 28 กุมภาพันธ์ 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ เสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามมาตรา 80/1 (5) ได้หรือไม่",
    expected_status_in: ["ANSWERED", "CONDITIONAL"],
    expected_citations_include: ["prov.th.rc.80/1", "statute.th.rc_amendment_49_2562"],
    must_contain_substrings: ["2019-02-28", "p49.pdf"],
  },
  {
    case_id: "LV-09",
    category: "3_missing_relevant_date_clarification",
    language: "th",
    question:
      "บริษัทบริจาคเงินให้พรรคการเมือง 40,000 บาท สามารถนำมาหักเป็นรายจ่ายในการคำนวณกำไรสุทธิได้หรือไม่",
    expected_status_in: ["NEEDS_CLARIFICATION"],
    expected_citations_include: ["prov.th.rc.65_ตรี", "statute.th.rc_amendment_51_2562"],
    must_contain_substrings: ["NEEDS_CLARIFICATION", "p51.pdf"],
  },
  {
    case_id: "LV-10",
    category: "3_missing_relevant_date_clarification",
    language: "en",
    question: "Can our Thai company deduct a 40,000 THB donation to a political party?",
    expected_status_in: ["NEEDS_CLARIFICATION"],
    expected_citations_include: ["prov.th.rc.65_ตรี", "statute.th.rc_amendment_51_2562"],
    must_contain_substrings: ["NEEDS_CLARIFICATION", "p51.pdf"],
  },
  {
    case_id: "LV-11",
    category: "4_historical_document_lookup_vs_period_law",
    language: "en",
    question: "Please find Revenue Department ruling GorKor 0811(KorMor.03)/366",
    expected_status_in: ["ANSWERED", "CONDITIONAL"],
    expected_citations_include: ["prov.th.rc.19"],
    must_contain_substrings: [
      "บันทึกกองกฎหมาย",
      "ภายในเวลาสองปี",
      "ไม่เกิน 5 ปีนับแต่วันที่ได้ยื่นรายการ",
    ],
  },
  {
    case_id: "LV-12",
    category: "4_historical_document_lookup_vs_period_law",
    language: "th",
    question:
      "ในปี 2540 บริษัทนำเข้าสารเสริมสำหรับสัตว์จากต่างประเทศ ได้รับยกเว้นภาษีมูลค่าเพิ่มหรือไม่",
    expected_status_in: ["INSUFFICIENT_EVIDENCE"],
    must_contain_substrings: ["2540", "ระงับการนำแนววินิจฉัย"],
  },
];

async function main() {
  const protectedPath = path.resolve(
    process.cwd(),
    "data",
    "knowledge-store",
    "canonical-state.json.gz"
  );
  const protectedSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(protectedPath))
    .digest("hex");
  if (
    protectedSha256 !==
    "08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9"
  ) {
    throw new Error(`Protected canonical-state.json.gz SHA-256 mismatch: ${protectedSha256}`);
  }

  const previewDir = path.resolve(
    process.cwd(),
    "data",
    "knowledge-store-b01-rc2-staging"
  );
  const store = new DurableKnowledgeStore(previewDir);
  const verCorpus = getVerifiedStatutoryCorpus();

  let amendedRcSectionsCount = 0;
  let totalParsedAmendmentNotes = 0;
  for (const [wid, sec] of Object.entries(verCorpus.revenue_code_sections)) {
    const ledger = extractAmendmentLedgerFromStatutoryText(wid, sec.verbatim_text);
    if (ledger.length > 0) {
      amendedRcSectionsCount += 1;
      totalParsedAmendmentNotes += ledger.length;
    }
  }

  const results = [];
  let allPassed = true;

  for (const spec of E2E_CASES) {
    const res = await queryKnowledge(
      {
        question: spec.question,
        release_id: "rel.B01.rc5",
        applicable_date: spec.applicable_date ?? null,
        mode: spec.mode ?? "standard",
      },
      REVIEW_ACTOR,
      { store }
    );

    const statusOk = spec.expected_status_in.includes(res.status);
    const citationsWorkIds = res.evidence.map((e) => e.work_id);
    const citationsOk = (spec.expected_citations_include || []).every((w) =>
      citationsWorkIds.includes(w)
    );
    const substringsOk = spec.must_contain_substrings.every((s) => res.answer.includes(s));
    const s1CitationGateOk = res.evidence.every((ec) => {
      const bare = ec.official_identifier.replace(/^กค\s+/, "").trim();
      return (
        res.answer.includes(ec.official_identifier) ||
        (bare.length >= 4 && res.answer.includes(bare)) ||
        res.answer.includes(ec.title_th)
      );
    });

    const passed = statusOk && citationsOk && substringsOk && s1CitationGateOk;
    if (!passed) allPassed = false;

    results.push({
      case_id: spec.case_id,
      category: spec.category,
      language: spec.language,
      question: spec.question,
      applicable_date: spec.applicable_date ?? null,
      observed_status: res.status,
      clarification_questions: res.clarification_questions,
      cited_works: res.evidence.map((e) => ({
        work_id: e.work_id,
        version_id: e.version_id,
        official_identifier: e.official_identifier,
        origin_uri: e.locator.origin_uri,
      })),
      checks: {
        status_ok: statusOk,
        expected_citations_ok: citationsOk,
        required_substrings_ok: substringsOk,
        s1_citation_gate_ok: s1CitationGateOk,
        passed,
      },
      answer_excerpt: res.answer.slice(0, 520),
    });
  }

  const receipt = {
    schema_version: "reg24.legal_version_architecture_e2e_evidence.v1",
    generated_at: new Date().toISOString(),
    release_id: "rel.B01.rc5",
    protected_rc1_sha256: protectedSha256,
    protected_rc1_untouched: true,
    verified_gazette_amending_acts: [
      {
        work_id: "statute.th.rc_amendment_51_2562",
        title_th: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 51) พ.ศ. 2562",
        origin_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p51.pdf",
        artifact_sha256:
          verCorpus.subordinate_and_amendment_works["statute.th.rc_amendment_51_2562"]
            ?.artifact_sha256,
        gazette_publication_date: "2019-04-16",
        enactment_effective_date: "2019-04-17",
        s65_ter_3_applicability_basis: "ACCOUNTING_PERIOD_START",
        s65_ter_3_applicability_from: "2018-01-01",
      },
      {
        work_id: "statute.th.rc_amendment_49_2562",
        title_th: "พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 49) พ.ศ. 2562",
        origin_uri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p49.pdf",
        artifact_sha256:
          verCorpus.subordinate_and_amendment_works["statute.th.rc_amendment_49_2562"]
            ?.artifact_sha256,
        gazette_publication_date: "2019-02-27",
        enactment_effective_date: "2019-02-28",
        s80_1_5_applicability_basis: "TRANSACTION_OR_EVENT_DATE",
        s80_1_5_applicability_from: "2019-02-28",
      },
    ],
    corpus_wide_amendment_ledger_coverage: {
      amended_revenue_code_sections_parsed: amendedRcSectionsCount,
      total_parenthetical_amendment_notes_parsed: totalParsedAmendmentNotes,
      unverified_historical_provisions_contained: true,
    },
    e2e_summary: {
      total_cases: results.length,
      passed_cases: results.filter((r) => r.checks.passed).length,
      all_passed: allPassed,
    },
    cases: results,
  };

  const outPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    "legal_version_architecture_e2e_evidence_20261118.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        all_passed: receipt.e2e_summary.all_passed,
        passed_cases: `${receipt.e2e_summary.passed_cases}/${receipt.e2e_summary.total_cases}`,
        amended_rc_sections_parsed: amendedRcSectionsCount,
        total_amendment_notes_parsed: totalParsedAmendmentNotes,
      },
      null,
      2
    )
  );
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
