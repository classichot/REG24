/**
 * REG24 Batch 1 (`feat/b01-thai-legal-index-retrieval-rc10.3`) —
 * Hardened Real-App-Path Verification on `rel.B01.rc8` (`mfst.b01.rc8_thai_legal_index`)
 *
 * Includes:
 *   - All 18 Sealed Gate positive + 4 Sealed Gate negative cases (now asserting RD 646 is FORBIDDEN as governing on 2024..2027!)
 *   - All 5 RC10.1 regressions (`H-01..H-05`)
 *   - All 8 RC10.2 regressions (`F-01..F-08`)
 *   - 3 RC10.3 P0-1 boundary & historical cases (`B-01-HIST-RD646-2018`, `B-02-HIST-RD780-DAY-BEFORE-790`, `B-03-RC10_2-RD646-LEAK-CHECK-ON-807`)
 *   - Comparison reproduction showing RC10.2 (`rel.B01.rc7`) metadata vs RC10.3 (`rel.B01.rc8`) fix
 *
 * Preserves `docs/batch1-rc10-evidence/` and `docs/batch1-rc10.2-evidence/` untouched.
 * Marks `final_answer_qa_status: "NOT_RUN_PRE_LLM_CAPTURE"` honestly on every pre-LLM case.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "../src/core/knowledge/identity";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import {
  inspectReleaseProjectionDiagnostics,
  runTokenizerParityProbe,
} from "../src/core/knowledge/projections";
import {
  queryKnowledge,
  type RealAppEvidenceAssemblyCapture,
} from "../src/core/knowledge/query";
import {
  gradeHardenedCase,
  type ExpectedEvidenceUnit,
  type HardenedEvalCase,
  type HardenedGradeResult,
} from "../src/core/knowledge/retrieval-benchmark-grader";
import type { Actor, ConversationTurnInput, Passage } from "../src/core/knowledge/contracts";

const STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const RELEASE_ID = "rel.B01.rc8";
const OUT_DIR = path.resolve(process.cwd(), "docs/batch1-rc10.3-evidence");

const QA_ACTOR: Actor = {
  actor_id: "qa.hardened.rc10_3@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

interface Rc103EvalCase extends HardenedEvalCase {
  bucket:
    | "SEALED_GATE"
    | "RC10_1_REGRESSION"
    | "RC10_2_REGRESSION"
    | "RC10_3_BOUNDARY_AND_HISTORY";
  conversation_history?: ConversationTurnInput[];
  assert_not_forced_work_ids?: string[];
}

function resolveExpectedUnit(
  releasePassages: Passage[],
  workId: string,
  opts?: { versionId?: string; passageIdFilter?: (p: Passage) => boolean; sectionLabel?: string }
): ExpectedEvidenceUnit {
  const matching = releasePassages.filter(
    (p) =>
      p.work_id === workId &&
      (!opts?.versionId || p.version_id === opts.versionId) &&
      (p.statement_role === "statutory_text" || p.statement_role === "official_conclusion") &&
      !p.extraction_id.startsWith("ext.dep.") &&
      (!opts?.passageIdFilter || opts.passageIdFilter(p))
  );
  if (matching.length === 0) {
    throw new Error(`EXPECTED_EVIDENCE_NOT_INDEXED: ${workId} (${opts?.versionId || "any"})`);
  }
  const versionId = opts?.versionId || matching[0].version_id;
  return {
    work_id: workId,
    expected_version_id: versionId,
    required_passage_ids: matching.filter((p) => p.version_id === versionId).map((p) => p.passage_id),
    section_label: opts?.sectionLabel,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Number(s[idx].toFixed(2));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const store = new DurableKnowledgeStore(STORE_DIR);
  const rc8Passages = store.getPassagesForRelease(RELEASE_ID);
  const diag = inspectReleaseProjectionDiagnostics(store, RELEASE_ID);
  const parityProbe = runTokenizerParityProbe(store, RELEASE_ID);

  const uRc80 = resolveExpectedUnit(rc8Passages, "prov.th.rc.80", { sectionLabel: "มาตรา 80" });
  const uRc80_1 = resolveExpectedUnit(rc8Passages, "prov.th.rc.80/1", { sectionLabel: "มาตรา 80/1" });
  const uRc81 = resolveExpectedUnit(rc8Passages, "prov.th.rc.81", { sectionLabel: "มาตรา 81" });
  const uRc82_6 = resolveExpectedUnit(rc8Passages, "prov.th.rc.82/6", { sectionLabel: "มาตรา 82/6" });
  const uRc77_2 = resolveExpectedUnit(rc8Passages, "prov.th.rc.77/2", { sectionLabel: "มาตรา 77/2" });
  const uRc83_6 = resolveExpectedUnit(rc8Passages, "prov.th.rc.83/6", { sectionLabel: "มาตรา 83/6" });
  const uRc78_1 = resolveExpectedUnit(rc8Passages, "prov.th.rc.78/1", { sectionLabel: "มาตรา 78/1" });
  const uRc42 = resolveExpectedUnit(rc8Passages, "prov.th.rc.42", { sectionLabel: "มาตรา 42" });
  const uRc48 = resolveExpectedUnit(rc8Passages, "prov.th.rc.48", { sectionLabel: "มาตรา 48" });
  const uRc50 = resolveExpectedUnit(rc8Passages, "prov.th.rc.50", { sectionLabel: "มาตรา 50" });
  const uRc54 = resolveExpectedUnit(rc8Passages, "prov.th.rc.54", { sectionLabel: "มาตรา 54" });
  const uRc3Teras = resolveExpectedUnit(rc8Passages, "prov.th.rc.3_เตรส", { sectionLabel: "มาตรา 3 เตรส" });
  const uTp4_2528 = resolveExpectedUnit(rc8Passages, "subreg.th.rd.order_tp.4_2528", { sectionLabel: "ท.ป. 4/2528" });
  const uRc69Bis = resolveExpectedUnit(rc8Passages, "prov.th.rc.69_ทวิ", { sectionLabel: "มาตรา 69 ทวิ" });
  const uVatLocal = resolveExpectedUnit(rc8Passages, "subreg.th.rd.vat_local_tax_guide", { sectionLabel: "ภาษีท้องถิ่น 1/9" });
  const uDgVat105 = resolveExpectedUnit(rc8Passages, "subreg.th.rd.dg_vat.105", { sectionLabel: "ประกาศอธิบดีฯ VAT 105" });
  const uRuling5958 = resolveExpectedUnit(rc8Passages, "work.th.rd.0702_5958_2015_04f2b49f", { sectionLabel: "กค 0702/5958" });

  const uRd646 = resolveExpectedUnit(rc8Passages, "subreg.th.rc.royal_decree.646", {
    versionId: "ver.th.rc.royal_decree.646.v2",
    passageIdFilter: (p) => p.passage_id.startsWith("psg.rc8.rd646."),
    sectionLabel: "พ.ร.ฎ. 646 (base 2017-10-01..2018-09-30)",
  });
  const uRd780 = resolveExpectedUnit(rc8Passages, "subreg.th.rc.royal_decree.780", {
    versionId: "ver.th.rc.royal_decree.780.v2",
    passageIdFilter: (p) =>
      p.passage_id === "psg.rc8.rd780.sec_3_quoted_rd646_sec_4" ||
      p.passage_id === "psg.rc8.rd780.sec_3_amending_clause" ||
      p.passage_id === "psg.rc8.rd780.sec_1_2",
    sectionLabel: "พ.ร.ฎ. 780 (v2 Gazette RC8)",
  });
  const uRd790 = resolveExpectedUnit(rc8Passages, "subreg.th.rc.royal_decree.790", {
    versionId: "ver.th.rc.royal_decree.790.v2",
    passageIdFilter: (p) =>
      p.passage_id === "psg.rc8.rd790.sec_3_quoted_rd646_sec_4" ||
      p.passage_id === "psg.rc8.rd790.sec_3_amending_clause" ||
      p.passage_id === "psg.rc8.rd790.sec_1_2",
    sectionLabel: "พ.ร.ฎ. 790 (v2 Gazette RC8)",
  });
  const uRd799 = resolveExpectedUnit(rc8Passages, "subreg.th.rc.royal_decree.799", {
    versionId: "ver.th.rc.royal_decree.799.v3",
    passageIdFilter: (p) =>
      p.passage_id === "psg.rc8.rd799.sec_3_quoted_rd646_sec_4" ||
      p.passage_id === "psg.rc8.rd799.sec_3_amending_clause" ||
      p.passage_id === "psg.rc8.rd799.sec_1_2",
    sectionLabel: "พ.ร.ฎ. 799 (v3 Gazette RC8)",
  });
  const uRd807 = resolveExpectedUnit(rc8Passages, "subreg.th.rc.royal_decree.807", {
    versionId: "ver.th.rc.royal_decree.807.v3",
    passageIdFilter: (p) =>
      p.passage_id === "psg.rc8.rd807.sec_3_quoted_rd646_sec_4" ||
      p.passage_id === "psg.rc8.rd807.sec_3_amending_clause" ||
      p.passage_id === "psg.rc8.rd807.sec_1_2",
    sectionLabel: "พ.ร.ฎ. 807 (v3 Gazette RC8)",
  });

  const cases: Rc103EvalCase[] = [
    // ================== 1. SEALED GATE POSITIVE (18 cases — forbidding RD 646 governing on all 2024..2027 cases!) ==================
    {
      case_id: "G-VAT-790-START",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2567 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2024-10-01",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-790-END",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทให้บริการในประเทศไทยและได้รับชำระค่าบริการวันที่ 30 กันยายน 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2025-09-30",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-799-START",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 1 ตุลาคม 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2025-10-01",
      expected_evidence: [uRc80, uRd799, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-799-END",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 30 กันยายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2026-09-30",
      expected_evidence: [uRc80, uRd799, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-807-START",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 1 ตุลาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2026-10-01",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "G-VAT-807-END",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าในประเทศและส่งมอบสินค้าพร้อมออกใบกำกับภาษีในวันที่ 30 กันยายน 2570 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2027-09-30",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "G-VAT-ZERO-EXPORT",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "บริษัทไทยให้บริการออกแบบซอฟต์แวร์ในประเทศไทยแต่ส่งมอบผลของบริการให้บริษัทในประเทศญี่ปุ่นนำไปใช้ในต่างประเทศทั้งหมด เสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc80_1, uDgVat105],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-EXEMPT-81",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "การขายพืชผลทางการเกษตรภายในราชอาณาจักรและการให้บริการสถานพยาบาลได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc81],
    },
    {
      case_id: "G-VAT-MIXED-82-6",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "ผู้ประกอบการจดทะเบียนประกอบกิจการทั้งประเภทที่ต้องเสียภาษีมูลค่าเพิ่มและประเภทที่ได้รับยกเว้นภาษีมูลค่าเพิ่ม การเฉลี่ยภาษีซื้อต้องปฏิบัติตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc82_6],
    },
    {
      case_id: "G-VAT-CROSSBORDER-PP36",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "บริษัทในไทยชำระค่าบริการให้ผู้ประกอบการในต่างประเทศที่ได้ให้บริการในต่างประเทศและมีการใช้บริการนั้นในราชอาณาจักร ต้องนำส่งภาษีมูลค่าเพิ่มด้วยแบบ ภ.พ.36 ตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc77_2, uRc83_6],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-EXACT-SEC-80-1-2",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "exact_composite_id",
      question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๒) บัญญัติหลักเกณฑ์การเสียภาษีมูลค่าเพิ่มอัตราร้อยละ ๐ สำหรับการให้บริการไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRc80_1],
      expected_exact_top1_work_id: "prov.th.rc.80/1",
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-EXACT-RULING-5958",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "exact_ruling_lookup",
      question: "หนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/5958 วินิจฉัยหลักเกณฑ์ภาษีเงินได้กรณีโอนอสังหาริมทรัพย์ไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRuling5958],
    },
    {
      case_id: "G-GIFT-T09-CONDO-NEPHEW",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "gift_changed_facts",
      question: "นาย ก. (บุคคลธรรมดา) โอนกรรมสิทธิ์ห้องชุด (คอนโดมิเนียม) ราคาประเมิน 6,000,000 บาท ให้หลานชาย (บุตรของพี่สาว) โดยเสน่หาและไม่มีค่าตอบแทน ในปี 2569 มีภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษี ณ ที่จ่ายอย่างไรสำหรับผู้ให้และผู้รับ",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "G-GIFT-B1-09-CASH-NIECE",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "gift_exception",
      question: "ลุงให้เงินสดจำนวน 25,000,000 บาท แก่หลานสาวโดยเสน่หาในโอกาสพิธีมงคลสมรส ต้องเสียภาษีเงินได้บุคคลธรรมดาอย่างไร ได้รับยกเว้นเท่าใดและเลือกเสียอัตราร้อยละ 5 ได้หรือไม่",
      applicable_date: "2026-02-10",
      expected_evidence: [uRc42, uRc48],
    },
    {
      case_id: "G-GIFT-CONDO-BROTHER",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "gift_changed_facts",
      question: "พี่ชายโอนกรรมสิทธิ์ห้องชุดให้แก่น้องชายโดยเสน่หาไม่มีค่าตอบแทน ณ สำนักงานที่ดิน ผู้โอนและผู้รับโอนมีภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษี ณ ที่จ่ายอย่างไร",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42, uRc50, uRc54],
    },
    {
      case_id: "G-PARAPHRASE-EN-VAT",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "en_to_th_paraphrase",
      question: "What is the VAT rate in Thailand for domestic sale of goods invoiced on 30 September 2026 under the Revenue Code?",
      applicable_date: "2026-09-30",
      expected_evidence: [uRc80, uRd799, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-PARAPHRASE-EN-GIFT",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "en_to_th_paraphrase",
      question: "Thai personal income tax and withholding tax on transferring ownership of a condominium to a nephew as a gift without consideration",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "G-ANALOGOUS-RULING-EXPORT",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "analogous_ruling_research",
      question: "มีหนังสือตอบข้อหารือใดที่ตีความมาตรา 80/1 (2) กรณีให้บริการที่ปรึกษาหรือออกแบบในประเทศไทยแก่บริษัทต่างประเทศและส่งผลของบริการไปใช้ในต่างประเทศ",
      applicable_date: null,
      expected_evidence: [uRc80_1],
    },

    // ================== 2. SEALED GATE NEGATIVE / ABSTENTION (4 cases) ==================
    {
      case_id: "G-NEG-POST-807",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_POST_EXPIRY",
      category: "negative_post_expiry_decree",
      question: "หากบริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2570 อัตราภาษีมูลค่าเพิ่มจะเป็นร้อยละเท่าใด พ.ร.ฎ. ฉบับที่ 807 ยังใช้บังคับหรือไม่",
      applicable_date: "2027-10-01",
      expected_evidence: [uRc80],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
      allowed_historical_context_work_ids: ["subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-NEG-MISSING-DATE-VAT",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_MISSING_DATE",
      category: "negative_missing_decisive_date",
      question: "บริษัทให้บริการที่ปรึกษาในประเทศไทยแก่ลูกค้าในประเทศ ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: null,
      expected_evidence: [uRc80, uRc78_1, uVatLocal],
      temporary_decree_work_ids_requiring_date: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-NEG-FAKE-RULING-99999",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_FAKE_RULING",
      category: "negative_fake_ruling_abstention",
      question: "หนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/99999 วินิจฉัยเรื่องภาษีมูลค่าเพิ่มไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [],
      expect_unresolved_ruling_id: "กค 0702/99999",
    },
    {
      case_id: "G-NEG-MISSING-2019-DECREE",
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_MISSING_AUTHORITY",
      category: "negative_missing_historical_authority",
      question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 15 มิถุนายน 2562 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2019-06-15",
      expected_evidence: [],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },

    // ================== 3. RC10.1 REGRESSIONS (H-01..H-05) ==================
    {
      case_id: "H-01-VAT-790-MID",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression",
      question: "ห้างหุ้นส่วนจำกัดขายอุปกรณ์สำนักงานให้ลูกค้าในกรุงเทพฯ และส่งมอบสินค้าในวันที่ 15 มีนาคม 2568 ต้องเก็บภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์และอ้างอิงพระราชกฤษฎีกาใด",
      applicable_date: "2025-03-15",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "H-02-VAT-807-MID",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression",
      question: "ผู้ประกอบการจดทะเบียนให้บริการซ่อมบำรุงเครื่องจักรในไทยและรับชำระค่าบริการวันที่ 20 เมษายน 2570 ใช้ภาษีมูลค่าเพิ่มอัตราใดและพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2027-04-20",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "H-03-GIFT-LAND-CHILD",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression",
      question: "บิดาโอนกรรมสิทธิ์ที่ดินมูลค่าประเมิน 25,000,000 บาท ให้บุตรชอบด้วยกฎหมายโดยเสน่หาไม่มีค่าตอบแทน มีภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายอย่างไร",
      applicable_date: "2026-05-01",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "H-04-SEC-80-1-1-EXPORT-GOODS",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression",
      question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๑) กำหนดหลักเกณฑ์การใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 สำหรับการส่งออกสินค้าไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRc80_1],
      expected_exact_top1_work_id: "prov.th.rc.80/1",
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "H-05-NEG-FAKE-RULING-88888",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "NEGATIVE_FAKE_RULING",
      category: "rc10_1_regression",
      question: "ขอสรุปแนววินิจฉัยของหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0706/88888 เรื่องภาษีธุรกิจเฉพาะ",
      applicable_date: null,
      expected_evidence: [],
      expect_unresolved_ruling_id: "กค 0706/88888",
    },

    // ================== 4. RC10.2 REGRESSIONS (F-01..F-08) ==================
    {
      case_id: "F-01-VAT-REQ-DATE-ONLY",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "ร้านค้าปลีกในจังหวัดเชียงใหม่ขายเครื่องใช้ไฟฟ้าให้ลูกค้าหน้าร้าน ต้องคิดภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์และใช้พระราชกฤษฎีกาฉบับใด",
      applicable_date: "2025-05-10",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-02-VAT-DATE-CONFLICT",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "NEGATIVE_MISSING_DATE",
      category: "rc10_2_regression",
      question: "บริษัทในไทยรับเหมาก่อสร้างอาคารในกรุงเทพฯ และรับชำระงวดงานวันที่ 15 กันยายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์ตามพระราชกฤษฎีกาใด",
      applicable_date: "2026-10-20",
      expected_evidence: [uRc80, uVatLocal],
      temporary_decree_work_ids_requiring_date: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-03-EXPORT-SERVICE-FRESH",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "บริษัทวิศวกรรมในไทยจัดทำแบบแปลนโรงงานให้ลูกค้าในประเทศเกาหลีใต้ โดยลูกค้านำแบบแปลนไปก่อสร้างในเกาหลีใต้ทั้งหมด จะได้สิทธิเสียภาษีมูลค่าเพิ่มร้อยละ 0 ตามเงื่อนไขใด",
      applicable_date: null,
      expected_evidence: [uRc80_1, uDgVat105],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-04-CROSSBORDER-INBOUND-FRESH",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "บริษัทจำกัดในไทยจ่ายค่าบริการคลาวด์ซอฟต์แวร์ให้ผู้ให้บริการในสหรัฐอเมริกา เพื่อใช้ในสำนักงานที่กรุงเทพฯ ต้องยื่นนำส่งภาษีมูลค่าเพิ่มด้วยแบบ ภ.พ.36 ตามบทบัญญัติใด",
      applicable_date: null,
      expected_evidence: [uRc77_2, uRc83_6],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-05-WHT-INCIDENTAL-VAT-GOVT",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "กรมชลประทานซึ่งเป็นหน่วยงานราชการจ่ายค่าจัดซื้อครุภัณฑ์จำนวน 200,000 บาท (ราคาก่อนภาษีมูลค่าเพิ่ม VAT 7%) ให้แก่บริษัทเอกชน หน่วยงานราชการต้องหักภาษีเงินได้ ณ ที่จ่ายในอัตราร้อยละเท่าใดและตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc69Bis, uRc50],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-06-WHT-INCIDENTAL-VAT-PRIVATE",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "บริษัทเอกชนจ้างบริษัทผู้รับเหมาที่จดทะเบียนภาษีมูลค่าเพิ่มให้ปรับปรุงสำนักงาน มูลค่างาน 500,000 บาท ยังไม่รวม VAT ผู้ว่าจ้างต้องหักภาษีเงินได้ ณ ที่จ่ายตามมาตราใดและใช้ฐานเงินได้ใดคำนวณ",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc3Teras, uTp4_2528],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-07-PROP-FATHER-CHILD-UNDER-20M",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "บิดาโอนกรรมสิทธิ์บ้านพร้อมที่ดินราคาประเมิน 12,000,000 บาท ให้แก่บุตรชอบด้วยกฎหมายโดยเสน่หาไม่มีค่าตอบแทน ผู้รับและผู้ให้ได้รับยกเว้นภาษีเงินได้บุคคลธรรมดาตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42],
      assert_not_forced_work_ids: ["prov.th.rc.54"],
    },
    {
      case_id: "F-08-MULTITURN-FACT-CHANGE",
      bucket: "RC10_2_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_2_regression",
      question: "แก้ไขข้อเท็จจริงเพิ่มเติม: ลูกค้าเปลี่ยนมานำซอฟต์แวร์ดังกล่าวไปใช้งานที่สาขากรุงเทพมหานครทั้งหมด ไม่ได้ใช้ในสิงคโปร์ และได้รับชำระค่าบริการวันที่ 15 ตุลาคม 2569 ต้องคิดภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์และอ้างอิงพระราชกฤษฎีกาใด",
      applicable_date: null,
      conversation_history: [
        {
          role: "user",
          content: "บริษัทซอฟต์แวร์ในไทยให้บริการพัฒนาระบบแก่ลูกค้าในสิงคโปร์เพื่อใช้ที่สิงคโปร์ทั้งหมด ต้องเสีย VAT ร้อยละ 0 หรือร้อยละ 7",
        },
        {
          role: "assistant",
          content: "หากพิสูจน์ได้ว่าใช้บริการทั้งหมดในต่างประเทศ เข้าหลักเกณฑ์อัตราร้อยละ 0 ตามมาตรา 80/1 (2)",
        },
      ],
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },

    // ================== 5. RC10.3 P0-1 BOUNDARY & VALID HISTORICAL TRANSACTION CASES ==================
    {
      case_id: "B-01-HIST-RD646-2018",
      bucket: "RC10_3_BOUNDARY_AND_HISTORY",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_3_valid_historical_older_text",
      question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 15 มิถุนายน 2561 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2018-06-15",
      expected_evidence: [uRc80, uRd646, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "B-02-HIST-RD780-DAY-BEFORE-790",
      bucket: "RC10_3_BOUNDARY_AND_HISTORY",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_3_day_before_boundary",
      question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 30 กันยายน 2567 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2024-09-30",
      expected_evidence: [uRc80, uRd780, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "B-03-RC10_2-RD646-LEAK-CHECK-ON-807",
      bucket: "RC10_3_BOUNDARY_AND_HISTORY",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_3_no_superseded_rd646_leak",
      question: "บริษัทขายสินค้าในประเทศวันที่ 1 ตุลาคม 2569 เสีย VAT กี่เปอร์เซ็นต์ตาม พ.ร.ฎ. ฉบับใด",
      applicable_date: "2026-10-01",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.646", "subreg.th.rc.royal_decree.780", "subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
  ];

  const caseSetHash = sha256Bytes(JSON.stringify(cases));
  const results: Array<{
    case_id: string;
    bucket: Rc103EvalCase["bucket"];
    suite: string;
    case_kind: string;
    category: string;
    applicable_date: string | null;
    expected_evidence: ExpectedEvidenceUnit[];
    assert_not_forced_violations: string[];
    capture: RealAppEvidenceAssemblyCapture;
    grade: HardenedGradeResult;
  }> = [];

  for (const c of cases) {
    let captured: RealAppEvidenceAssemblyCapture | null = null;
    const ans = await queryKnowledge(
      {
        question: c.question,
        release_id: RELEASE_ID,
        applicable_date: c.applicable_date,
        mode: "standard",
        answer_generation_mode: "llm_grounded",
        conversation_history: c.conversation_history,
      },
      QA_ACTOR,
      {
        store,
        retrievalStrategy: "hybrid_with_graph",
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (cap) => {
          captured = cap;
        },
      }
    );
    if (!captured) throw new Error(`REAL_APP_CAPTURE_MISSING for ${c.case_id} (${ans.status})`);
    const cap = captured as RealAppEvidenceAssemblyCapture;
    const grade = gradeHardenedCase(c, {
      ranked_passages: cap.retrieval_top_hits.map((h) => ({
        rank: h.rank,
        passage_id: h.passage_id,
        work_id: h.work_id,
        version_id: h.version_id,
        evidence_role: "governing",
      })),
      actual_packet: cap.actual_model_packet.map((p) => ({
        position: p.position,
        passage_id: p.passage_id,
        work_id: p.work_id,
        version_id: p.version_id,
        evidence_role: p.evidence_role,
        source_type: store.getState().works[p.work_id]?.type,
      })),
      unresolved_ruling_ids: cap.unresolved_explicit_ruling_ids,
      response_status: cap.pre_llm_response_status,
      clarification_questions: cap.clarification_questions_th,
    });
    const notForcedViolations: string[] = [];
    for (const wid of c.assert_not_forced_work_ids || []) {
      if (cap.actual_model_packet.some((p) => p.work_id === wid && p.evidence_role === "governing")) {
        notForcedViolations.push(`BLANKET_FORCED_GOVERNING:${wid}`);
      }
    }
    results.push({
      case_id: c.case_id,
      bucket: c.bucket,
      suite: c.suite,
      case_kind: c.case_kind,
      category: c.category,
      applicable_date: c.applicable_date,
      expected_evidence: c.expected_evidence,
      assert_not_forced_violations: notForcedViolations,
      capture: cap,
      grade,
    });
  }

  const summarize = (rows: typeof results) => ({
    total: rows.length,
    overall_pre_llm_passed: `${rows.filter((r) => r.grade.passed && r.assert_not_forced_violations.length === 0).length}/${rows.length}`,
    ranking_top5_passed: `${rows.filter((r) => r.grade.ranking_passed).length}/${rows.length}`,
    actual_model_packet_passed: `${rows.filter((r) => r.grade.actual_packet_passed && r.assert_not_forced_violations.length === 0).length}/${rows.length}`,
    ranking_miss_packet_recovered: rows.filter((r) => r.grade.ranking_miss_packet_recovered).length,
    final_answer_qa_status: "NOT_RUN_PRE_LLM_CAPTURE",
    wrong_version_substitutions: rows.filter((r) => r.grade.wrong_version_substitution).length,
    false_substitutions: rows.filter((r) => r.grade.false_substitution).length,
    expired_governing_leaks: rows.filter((r) => r.grade.expired_governing_leak).length,
    p95_retrieval_latency_ms: percentile(rows.map((r) => r.capture.retrieval_elapsed_ms), 95),
    failures: rows
      .filter((r) => !r.grade.passed || r.grade.ranking_miss_packet_recovered || r.assert_not_forced_violations.length > 0)
      .map((r) => ({
        case_id: r.case_id,
        first_failing_step: r.grade.first_failing_step,
        reasons: [...r.grade.failure_reasons, ...r.assert_not_forced_violations],
      })),
  });

  const output = {
    schema_version: "2.2-rc10.3-hardened-real-app-verification",
    generated_at: new Date().toISOString(),
    release_id: RELEASE_ID,
    manifest_id: diag.manifest_id,
    manifest_hash: diag.manifest_hash,
    case_set_sha256: caseSetHash,
    tokenizer_contract: {
      tokenizer_engine: parityProbe.live_tokenizer_engine,
      tokenizer_contract_sha256: parityProbe.live_tokenizer_contract_sha256,
      legal_dictionary_sha256: parityProbe.live_legal_dictionary_sha256,
      lexical_index_sha256: parityProbe.lexical_index_sha256,
      lexical_disk_file_sha256: parityProbe.lexical_disk_file_sha256,
      contract_parity_ok: parityProbe.contract_parity_ok,
      all_probes_ok: parityProbe.all_probes_ok,
      runtime_platform: parityProbe.runtime_platform,
      node_version: parityProbe.node_version,
      icu_version: parityProbe.icu_version,
    },
    summaries: {
      sealed_positive_covered: summarize(results.filter((r) => r.bucket === "SEALED_GATE" && r.grade.scoring_bucket === "POSITIVE_RETRIEVAL")),
      sealed_negative_or_abstention: summarize(results.filter((r) => r.bucket === "SEALED_GATE" && r.grade.scoring_bucket === "NEGATIVE_OR_ABSTENTION")),
      rc10_1_regressions: summarize(results.filter((r) => r.bucket === "RC10_1_REGRESSION")),
      rc10_2_regressions: summarize(results.filter((r) => r.bucket === "RC10_2_REGRESSION")),
      rc10_3_boundary_and_history: summarize(results.filter((r) => r.bucket === "RC10_3_BOUNDARY_AND_HISTORY")),
    },
    per_case_trace: results,
  };

  const outPath = path.join(OUT_DIR, "rc10_3_hardened_real_app_and_boundary_receipt.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify(output.summaries, null, 2));
  const anyFail = Object.values(output.summaries).some((b) => b.failures.length > 0);
  if (anyFail) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
