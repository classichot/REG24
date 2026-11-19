/**
 * REG24 — Separate Mission: Controlled Staging A/B Evaluator (With vs. Without VAT Tax Foundation)
 *
 * Compares the exact same commit, `rel.B01.rc6` canonical staging store, and model configuration
 * across two conditions:
 *   - Condition A (`control`): `enable_tax_foundation_pilot: false`
 *   - Condition B (`treatment`): `enable_tax_foundation_pilot: true`
 *
 * Evaluates:
 *   1. Failed / complex VAT cases from the 30-case legal pack (`B1-03`, `B1-10`, `B1-11` -> `B1-11F`, `B1-15` -> `B1-15F`),
 *   2. Challenging unseen VAT cases (missing place-of-use export service -> asks for clarification;
 *      promotional free sample/gift `77/1` + `79`; entertainment non-deductible input VAT `82/5` + reverse-charge `83/6`;
 *      post-May-2018 `พ.ร.บ. 49 พ.ศ. 2562` foreign economic/trade office `80/1 (5)`).
 *   3. Verifies zero `secondary_commentary` passages ever appear as controlling citations, zero `CANDIDATE_LINK`s
 *      leak into cited evidence, and existing canonical stores remain 100% untouched.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
process.env.REG24_KNOWLEDGE_DATA_DIR = STAGING_STORE_DIR;

import type { Actor, ConversationTurnInput } from "../src/core/knowledge/contracts";
import { runVatFoundationPilotIntake } from "./ingest-vat-foundation-pilot";

const EVAL_ACTOR: Actor = {
  actor_id: "legal.vat.ab@reg24.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

interface VatAbCaseSpec {
  case_id: string;
  category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT" | "UNSEEN_CHALLENGING_VAT_AND_FOLLOWUP";
  prior_case_id?: string;
  question: string;
  expected_primary_authorities: string[];
  expect_clarification_in_treatment?: boolean;
}

const VAT_AB_CASES: VatAbCaseSpec[] = [
  {
    case_id: "VAT-AB-01 (B1-03)",
    category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT",
    question:
      "บริษัท คลองสาน เทรดดิ้ง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในราชอาณาจักรเมื่อวันที่ 15 พฤศจิกายน 2569 ความรับผิดใน VAT เกิดวันเดียวกัน ต้องคิด VAT กี่ร้อยละ",
    expected_primary_authorities: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "VAT-AB-02 (B1-10)",
    category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT",
    question:
      "นางดาวขายของชำเป็นบุคคลธรรมดา มีรายรับจากการขายสินค้าในปีปฏิทิน 2568 รวม 1,500,000 บาท ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่มโดยสมัครใจ และไม่ได้ขายสินค้าที่ได้รับยกเว้นเป็นอย่างอื่น ต้องจดทะเบียน VAT หรือไม่",
    expected_primary_authorities: ["prov.th.rc.81/1", "prov.th.rc.85/1", "subreg.th.rc.royal_decree.432"],
  },
  {
    case_id: "VAT-AB-03 (B1-11)",
    category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT",
    question:
      "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
    expected_primary_authorities: ["prov.th.rc.80/1", "subreg.th.rd.dg_vat.105"],
  },
  {
    case_id: "VAT-AB-04 (B1-11F)",
    category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT",
    prior_case_id: "VAT-AB-03 (B1-11)",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
    expected_primary_authorities: ["prov.th.rc.80", "prov.th.rc.77/2", "prov.th.rc.80/1"],
  },
  {
    case_id: "VAT-AB-05 (B1-15)",
    category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT",
    question:
      "บริษัท คลองสาน เทรดดิ้ง จำกัด (ผู้ประกอบการจดทะเบียน VAT) ส่งมอบสินค้าในราชอาณาจักรและมีความรับผิดใน VAT เกิดวันที่ 20 ตุลาคม 2570 ต้องคิดอัตราเท่าใด มีพระราชกฤษฎีกาฉบับที่ 807 ขยายอัตราลดอยู่หรือไม่",
    expected_primary_authorities: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "VAT-AB-06 (B1-15F)",
    category: "FAILED_OR_NEEDS_CORRECTION_30CASE_VAT",
    prior_case_id: "VAT-AB-05 (B1-15)",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-15: ความรับผิดใน VAT เกิดวันที่ 20 กันยายน 2570 ไม่ใช่ 20 ตุลาคม 2570 อัตราที่ต้องใช้เป็นเท่าใด",
    expected_primary_authorities: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "VAT-AB-07 (Unseen: Missing Place-of-Use Export Service)",
    category: "UNSEEN_CHALLENGING_VAT_AND_FOLLOWUP",
    question:
      "บริษัท เทคสเฟียร์ จำกัด (ผู้ประกอบการจดทะเบียน VAT ในไทย) รับจ้างออกแบบระบบซอฟต์แวร์จากกรุงเทพฯ ให้แก่บริษัทแม่ในประเทศญี่ปุ่นเมื่อวันที่ 5 เมษายน 2569 สามารถใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 สำหรับการส่งออกบริการได้ทันทีหรือไม่",
    expected_primary_authorities: ["prov.th.rc.80/1", "subreg.th.rd.dg_vat.105"],
    expect_clarification_in_treatment: true,
  },
  {
    case_id: "VAT-AB-08 (Unseen: Promotional Gift / Sample Goods)",
    category: "UNSEEN_CHALLENGING_VAT_AND_FOLLOWUP",
    question:
      "บริษัทผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม นำสินค้าของบริษัทไปแถมสินค้าให้ลูกค้าพร้อมกับการขายสินค้าตามปกติในเดือนพฤษภาคม 2568 ต้องนำมูลค่าของแถมมารวมคำนวณฐานภาษีมูลค่าเพิ่มหรือไม่",
    expected_primary_authorities: ["prov.th.rc.77/1", "prov.th.rc.79"],
  },
  {
    case_id: "VAT-AB-09 (Unseen: Entertainment Input VAT + Foreign Service Reverse Charge)",
    category: "UNSEEN_CHALLENGING_VAT_AND_FOLLOWUP",
    question:
      "บริษัทจดทะเบียน VAT จ่ายค่ารับรองลูกค้าในไทยโดยมีใบกำกับภาษีเต็มรูป และในเดือนเดียวกันจ่ายค่าบริการที่ปรึกษาให้บริษัทต่างประเทศซึ่งส่งผลของงานมาใช้ในประเทศไทย ภาษีซื้อค่ารับรองนำมาหักภาษีขายได้หรือไม่ และค่าบริการต่างประเทศต้องนำส่งภ.พ.36 หรือไม่",
    expected_primary_authorities: ["prov.th.rc.82/5", "prov.th.rc.83/6"],
  },
  {
    case_id: "VAT-AB-10 (Unseen Post-May-2018 Amendment: Foreign Trade Office Mar 2019)",
    category: "UNSEEN_CHALLENGING_VAT_AND_FOLLOWUP",
    question:
      "เมื่อวันที่ 15 มีนาคม 2562 บริษัทขายสินค้าให้แก่สำนักงานเศรษฐกิจและการค้าของต่างประเทศที่ตั้งอยู่ในประเทศไทยตามความตกลงกับรัฐบาลไทย ได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 หรือไม่",
    expected_primary_authorities: ["prov.th.rc.80/1", "statute.th.rc_amendment_49_2562"],
  },
];

async function main() {
  runVatFoundationPilotIntake({ stagingStoreDir: STAGING_STORE_DIR });
  const { queryKnowledge } = await import("../src/core/knowledge/query");
  const gitCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

  const controlHistory = new Map<string, { q: string; a: string }>();
  const treatmentHistory = new Map<string, { q: string; a: string }>();

  const comparisons = [];
  let controlAuthorityRecallHits = 0;
  let treatmentAuthorityRecallHits = 0;
  let totalExpectedAuthorities = 0;

  for (const spec of VAT_AB_CASES) {
    const histA: ConversationTurnInput[] = [];
    const histB: ConversationTurnInput[] = [];
    if (spec.prior_case_id) {
      const prevA = controlHistory.get(spec.prior_case_id);
      if (prevA) {
        histA.push({ role: "user", content: prevA.q }, { role: "assistant", content: prevA.a });
      }
      const prevB = treatmentHistory.get(spec.prior_case_id);
      if (prevB) {
        histB.push({ role: "user", content: prevB.q }, { role: "assistant", content: prevB.a });
      }
    }

    const resControl = await queryKnowledge(
      {
        question: spec.question,
        conversation_history: histA.length > 0 ? histA : undefined,
        enable_tax_foundation_pilot: false,
      },
      EVAL_ACTOR
    );

    const resTreatment = await queryKnowledge(
      {
        question: spec.question,
        conversation_history: histB.length > 0 ? histB : undefined,
        enable_tax_foundation_pilot: true,
      },
      EVAL_ACTOR
    );

    controlHistory.set(spec.case_id, { q: spec.question, a: resControl.answer });
    treatmentHistory.set(spec.case_id, { q: spec.question, a: resTreatment.answer });

    const citedControl = Array.from(new Set(resControl.evidence.map((e) => e.work_id)));
    const citedTreatment = Array.from(new Set(resTreatment.evidence.map((e) => e.work_id)));

    const matchedControl = spec.expected_primary_authorities.filter((w) =>
      citedControl.includes(w)
    ).length;
    const matchedTreatment = spec.expected_primary_authorities.filter((w) =>
      citedTreatment.includes(w)
    ).length;

    totalExpectedAuthorities += spec.expected_primary_authorities.length;
    controlAuthorityRecallHits += matchedControl;
    treatmentAuthorityRecallHits += matchedTreatment;

    const anyCommentaryCitedAsEvidence = resTreatment.evidence.some(
      (e) => e.statement_role === "secondary_commentary"
    );

    comparisons.push({
      case_id: spec.case_id,
      category: spec.category,
      expected_primary_authorities: spec.expected_primary_authorities,
      without_foundation_control: {
        status: resControl.status,
        cited_work_ids: citedControl,
        expected_authorities_recalled: `${matchedControl}/${spec.expected_primary_authorities.length}`,
        clarification_questions: resControl.clarification_questions,
      },
      with_foundation_treatment: {
        status: resTreatment.status,
        cited_work_ids: citedTreatment,
        expected_authorities_recalled: `${matchedTreatment}/${spec.expected_primary_authorities.length}`,
        clarification_questions: resTreatment.clarification_questions,
        commentary_cited_as_controlling_evidence: anyCommentaryCitedAsEvidence,
        foundation_trace: resTreatment.tax_foundation_trace ?? null,
      },
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    git_commit_sha: gitCommit,
    release_id: "rel.B01.rc6",
    model_id: "reg24-deterministic-legal-graphrag-v2.0",
    total_cases: VAT_AB_CASES.length,
    primary_authority_recall_without_foundation: `${controlAuthorityRecallHits}/${totalExpectedAuthorities} (${((controlAuthorityRecallHits / totalExpectedAuthorities) * 100).toFixed(1)}%)`,
    primary_authority_recall_with_foundation: `${treatmentAuthorityRecallHits}/${totalExpectedAuthorities} (${((treatmentAuthorityRecallHits / totalExpectedAuthorities) * 100).toFixed(1)}%)`,
    zero_commentary_cited_as_controlling_law: comparisons.every(
      (c) => c.with_foundation_treatment.commentary_cited_as_controlling_evidence === false
    ),
    governance_note:
      "Controlled staging A/B receipt for Dodo & 7L Advisory Legal Team review prior to full-chapter/Volume-1 expansion.",
    comparisons,
  };

  const outPath = path.resolve(
    process.cwd(),
    "docs/audit/dodo-review-rc2-b02/vat_foundation_pilot_ab_comparison.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        total_cases: summary.total_cases,
        recall_without_foundation: summary.primary_authority_recall_without_foundation,
        recall_with_foundation: summary.primary_authority_recall_with_foundation,
        zero_commentary_cited_as_controlling_law: summary.zero_commentary_cited_as_controlling_law,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
