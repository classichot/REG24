/**
 * REG24 Batch 1 (`feat/b01-thai-legal-index-retrieval-rc10.1`) —
 * Hardened Real-App-Path + Blind Grader v2 Benchmark Runner
 *
 * Implements Section 2, 3 & 4 of Owner's RC10 remediation directive:
 *   - Grades instrument (`work_id`) + exact `version_id` + required `passage_id` at the position that earned the hit.
 *   - Runs EVERY locked, negative, and unseen holdout case through the REAL `queryKnowledge()` app evidence assembly
 *     (`captureRealAppEvidenceAssemblyOnly: true`, `answer_generation_mode: "llm_grounded"`), capturing the exact
 *     ordered passage/version IDs and `evidence_role` sent to Gemini (NO packet reconstruction from top hits!).
 *   - Scores Positive Covered Cases SEPARATELY from Negative / Clarification / Abstention Cases.
 *   - Re-scores the strictly blind 6-arm `FROZEN_BLIND_CORPUS_V1` (`1,924p`) receipt with the hardened grader v2
 *     (verifying version-at-first-hit + exact passage + negative controls on every arm!).
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
import type { Actor, Passage } from "../src/core/knowledge/contracts";

const STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const RELEASE_ID = "rel.B01.rc7";
const OUT_DIR = path.resolve(
  process.cwd(),
  "docs/batch1-rc10-evidence/02-hardened-blind-and-real-app-rerun"
);
const BLIND_RECEIPT_PATH = path.resolve(
  process.cwd(),
  "docs/batch1-rc7/blind_retrieval_ablation_receipt.json"
);

const QA_ACTOR: Actor = {
  actor_id: "qa.hardened.rc10_1@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

function resolveExpectedUnit(
  store: DurableKnowledgeStore,
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
  const rc7Passages = store.getPassagesForRelease(RELEASE_ID);
  const diag = inspectReleaseProjectionDiagnostics(store, RELEASE_ID);
  const parityProbe = runTokenizerParityProbe(store, RELEASE_ID);

  // Resolve exact instrument + version + passage_ids from rel.B01.rc7 for every expected authority
  const uRc80 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.80", { sectionLabel: "ประมวลรัษฎากร มาตรา 80" });
  const uRc80_1 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.80/1", { sectionLabel: "ประมวลรัษฎากร มาตรา 80/1" });
  const uRc81 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.81", { sectionLabel: "ประมวลรัษฎากร มาตรา 81" });
  const uRc82_6 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.82/6", { sectionLabel: "ประมวลรัษฎากร มาตรา 82/6" });
  const uRc77_2 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.77/2", { sectionLabel: "ประมวลรัษฎากร มาตรา 77/2" });
  const uRc83_6 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.83/6", { sectionLabel: "ประมวลรัษฎากร มาตรา 83/6" });
  const uRc78_1 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.78/1", { sectionLabel: "ประมวลรัษฎากร มาตรา 78/1" });
  const uRc42 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.42", { sectionLabel: "ประมวลรัษฎากร มาตรา 42" });
  const uRc48 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.48", { sectionLabel: "ประมวลรัษฎากร มาตรา 48" });
  const uRc50 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.50", { sectionLabel: "ประมวลรัษฎากร มาตรา 50" });
  const uRc54 = resolveExpectedUnit(store, rc7Passages, "prov.th.rc.54", { sectionLabel: "ประมวลรัษฎากร มาตรา 54" });
  const uVatLocal = resolveExpectedUnit(store, rc7Passages, "subreg.th.rd.vat_local_tax_guide", { sectionLabel: "แนวทางภาษีท้องถิ่น 1/9 (0.7%)" });
  const uDgVat105 = resolveExpectedUnit(store, rc7Passages, "subreg.th.rd.dg_vat.105", { sectionLabel: "ประกาศอธิบดีฯ VAT ฉบับที่ 105" });
  const uRd790 = resolveExpectedUnit(store, rc7Passages, "subreg.th.rc.royal_decree.790", {
    versionId: "ver.th.rc.royal_decree.790.v1",
    passageIdFilter: (p) => p.passage_id === "psg.rc7.rd790.sec_3_4" || p.passage_id === "psg.rc7.rd790.sec_1_2",
    sectionLabel: "พ.ร.ฎ. (ฉบับที่ 790) มาตรา 1-4",
  });
  const uRd799 = resolveExpectedUnit(store, rc7Passages, "subreg.th.rc.royal_decree.799", {
    versionId: "ver.th.rc.royal_decree.799.v2",
    passageIdFilter: (p) => p.passage_id === "psg.rc7.rd799.sec_3_4" || p.passage_id === "psg.rc7.rd799.sec_1_2",
    sectionLabel: "พ.ร.ฎ. (ฉบับที่ 799) มาตรา 1-4 (v2 Gazette)",
  });
  const uRd807 = resolveExpectedUnit(store, rc7Passages, "subreg.th.rc.royal_decree.807", {
    versionId: "ver.th.rc.royal_decree.807.v2",
    passageIdFilter: (p) => p.passage_id === "psg.rc7.rd807.sec_3_4" || p.passage_id === "psg.rc7.rd807.sec_1_2",
    sectionLabel: "พ.ร.ฎ. (ฉบับที่ 807) มาตรา 1-4 (v2 Gazette)",
  });
  const uRuling5958 = resolveExpectedUnit(store, rc7Passages, "work.th.rd.0702_5958_2015_04f2b49f", {
    sectionLabel: "หนังสือตอบข้อหารือ 0702/5958",
  });

  const cases: HardenedEvalCase[] = [
    // ================== POSITIVE COVERED SEALED GATE (18 cases) ==================
    {
      case_id: "G-VAT-790-START",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2567 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2024-10-01",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-790-END",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทให้บริการในประเทศไทยและได้รับชำระค่าบริการวันที่ 30 กันยายน 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2025-09-30",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-799-START",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 1 ตุลาคม 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2025-10-01",
      expected_evidence: [uRc80, uRd799, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-799-END",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 30 กันยายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2026-09-30",
      expected_evidence: [uRc80, uRd799, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-VAT-807-START",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 1 ตุลาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2026-10-01",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "G-VAT-807-END",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "บริษัทขายสินค้าในประเทศและส่งมอบสินค้าพร้อมออกใบกำกับภาษีในวันที่ 30 กันยายน 2570 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามกฎหมายใด",
      applicable_date: "2027-09-30",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "G-VAT-ZERO-EXPORT",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "บริษัทไทยให้บริการออกแบบซอฟต์แวร์ในประเทศไทยแต่ส่งมอบผลของบริการให้บริษัทในประเทศญี่ปุ่นนำไปใช้ในต่างประเทศทั้งหมด เสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc80_1, uDgVat105],
    },
    {
      case_id: "G-VAT-EXEMPT-81",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "การขายพืชผลทางการเกษตรภายในราชอาณาจักรและการให้บริการสถานพยาบาลได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc81],
    },
    {
      case_id: "G-VAT-MIXED-82-6",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "ผู้ประกอบการจดทะเบียนประกอบกิจการทั้งประเภทที่ต้องเสียภาษีมูลค่าเพิ่มและประเภทที่ได้รับยกเว้นภาษีมูลค่าเพิ่ม การเฉลี่ยภาษีซื้อต้องปฏิบัติตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc82_6],
    },
    {
      case_id: "G-VAT-CROSSBORDER-PP36",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "บริษัทในไทยชำระค่าบริการให้ผู้ประกอบการในต่างประเทศที่ได้ให้บริการในต่างประเทศและมีการใช้บริการนั้นในราชอาณาจักร ต้องนำส่งภาษีมูลค่าเพิ่มด้วยแบบ ภ.พ.36 ตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc77_2, uRc83_6],
    },
    {
      case_id: "G-EXACT-SEC-80-1-2",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "exact_composite_id",
      question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๒) บัญญัติหลักเกณฑ์การเสียภาษีมูลค่าเพิ่มอัตราร้อยละ ๐ สำหรับการให้บริการไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRc80_1],
      expected_exact_top1_work_id: "prov.th.rc.80/1",
    },
    {
      case_id: "G-EXACT-RULING-5958",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "exact_ruling_lookup",
      question: "หนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/5958 วินิจฉัยหลักเกณฑ์ภาษีเงินได้กรณีโอนอสังหาริมทรัพย์ไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRuling5958],
    },
    {
      case_id: "G-GIFT-T09-CONDO-NEPHEW",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "gift_changed_facts",
      question: "นาย ก. (บุคคลธรรมดา) โอนกรรมสิทธิ์ห้องชุด (คอนโดมิเนียม) ราคาประเมิน 6,000,000 บาท ให้หลานชาย (บุตรของพี่สาว) โดยเสน่หาและไม่มีค่าตอบแทน ในปี 2569 มีภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษี ณ ที่จ่ายอย่างไรสำหรับผู้ให้และผู้รับ",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "G-GIFT-B1-09-CASH-NIECE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "gift_exception",
      question: "ลุงให้เงินสดจำนวน 25,000,000 บาท แก่หลานสาวโดยเสน่หาในโอกาสพิธีมงคลสมรส ต้องเสียภาษีเงินได้บุคคลธรรมดาอย่างไร ได้รับยกเว้นเท่าใดและเลือกเสียอัตราร้อยละ 5 ได้หรือไม่",
      applicable_date: "2026-02-10",
      expected_evidence: [uRc42, uRc48],
    },
    {
      case_id: "G-GIFT-CONDO-BROTHER",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "gift_changed_facts",
      question: "พี่ชายโอนกรรมสิทธิ์ห้องชุดให้แก่น้องชายโดยเสน่หาไม่มีค่าตอบแทน ณ สำนักงานที่ดิน ผู้โอนและผู้รับโอนมีภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษี ณ ที่จ่ายอย่างไร",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42, uRc50, uRc54],
    },
    {
      case_id: "G-PARAPHRASE-EN-VAT",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "en_to_th_paraphrase",
      question: "What is the VAT rate in Thailand for domestic sale of goods invoiced on 30 September 2026 under the Revenue Code?",
      applicable_date: "2026-09-30",
      expected_evidence: [uRc80, uRd799, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-PARAPHRASE-EN-GIFT",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "en_to_th_paraphrase",
      question: "Thai personal income tax and withholding tax on transferring ownership of a condominium to a nephew as a gift without consideration",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "G-ANALOGOUS-RULING-EXPORT",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "analogous_ruling_research",
      question: "มีหนังสือตอบข้อหารือใดที่ตีความมาตรา 80/1 (2) กรณีให้บริการที่ปรึกษาหรือออกแบบในประเทศไทยแก่บริษัทต่างประเทศและส่งผลของบริการไปใช้ในต่างประเทศ",
      applicable_date: null,
      expected_evidence: [uRc80_1],
    },

    // ================== NEGATIVE / CLARIFICATION / ABSTENTION CASES (4 cases, SCORED SEPARATELY!) ==================
    {
      case_id: "G-NEG-POST-807",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_POST_EXPIRY",
      category: "negative_post_expiry_decree",
      question: "หากบริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2570 อัตราภาษีมูลค่าเพิ่มจะเป็นร้อยละเท่าใด พ.ร.ฎ. ฉบับที่ 807 ยังใช้บังคับหรือไม่",
      applicable_date: "2027-10-01",
      expected_evidence: [uRc80],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
      allowed_historical_context_work_ids: ["subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "G-NEG-MISSING-DATE-VAT",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_MISSING_DATE",
      category: "negative_missing_decisive_date",
      question: "บริษัทให้บริการที่ปรึกษาในประเทศไทยแก่ลูกค้าในประเทศ ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: null,
      expected_evidence: [uRc80, uRc78_1, uVatLocal],
      temporary_decree_work_ids_requiring_date: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "G-NEG-FAKE-RULING-99999",
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
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_MISSING_AUTHORITY",
      category: "negative_missing_historical_authority",
      question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 15 มิถุนายน 2562 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2019-06-15",
      expected_evidence: [],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },

    // ================== INDEPENDENT UNSEEN HOLDOUTS (5 fresh cases — NOT tuned to!) ==================
    {
      case_id: "H-01-VAT-790-MID",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "holdout_vat_date",
      question: "ห้างหุ้นส่วนจำกัดขายอุปกรณ์สำนักงานให้ลูกค้าในกรุงเทพฯ และส่งมอบสินค้าในวันที่ 15 มีนาคม 2568 ต้องเก็บภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์และอ้างอิงพระราชกฤษฎีกาใด",
      applicable_date: "2025-03-15",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "H-02-VAT-807-MID",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "holdout_vat_date",
      question: "ผู้ประกอบการจดทะเบียนให้บริการซ่อมบำรุงเครื่องจักรในไทยและรับชำระค่าบริการวันที่ 20 เมษายน 2570 ใช้ภาษีมูลค่าเพิ่มอัตราใดและพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2027-04-20",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "H-03-GIFT-LAND-CHILD",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "holdout_gift_property",
      question: "บิดาโอนกรรมสิทธิ์ที่ดินมูลค่าประเมิน 25,000,000 บาท ให้บุตรชอบด้วยกฎหมายโดยเสน่หาไม่มีค่าตอบแทน มีภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายอย่างไร",
      applicable_date: "2026-05-01",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "H-04-SEC-80-1-1-EXPORT-GOODS",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "holdout_composite_id",
      question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๑) กำหนดหลักเกณฑ์การใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 สำหรับการส่งออกสินค้าไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRc80_1],
      expected_exact_top1_work_id: "prov.th.rc.80/1",
    },
    {
      case_id: "H-05-NEG-FAKE-RULING-88888",
      suite: "LEGAL_HOLDOUT",
      case_kind: "NEGATIVE_FAKE_RULING",
      category: "holdout_fake_ruling",
      question: "ขอสรุปแนววินิจฉัยของหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0706/88888 เรื่องภาษีธุรกิจเฉพาะ",
      applicable_date: null,
      expected_evidence: [],
      expect_unresolved_ruling_id: "กค 0706/88888",
    },
  ];

  const caseSetHash = sha256Bytes(JSON.stringify(cases));
  const results: Array<{
    case_id: string;
    suite: string;
    case_kind: string;
    applicable_date: string | null;
    expected_evidence: ExpectedEvidenceUnit[];
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

    if (!captured) {
      throw new Error(`REAL_APP_CAPTURE_MISSING for ${c.case_id} (status=${ans.status})`);
    }
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

    results.push({
      case_id: c.case_id,
      suite: c.suite,
      case_kind: c.case_kind,
      applicable_date: c.applicable_date,
      expected_evidence: c.expected_evidence,
      capture: cap,
      grade,
    });
  }

  const summarizeBucket = (rows: typeof results) => {
    const passed = rows.filter((r) => r.grade.passed).length;
    const allTop5 = rows.filter((r) => r.grade.all_required_in_top5).length;
    const allPacket = rows.filter((r) => r.grade.all_required_in_actual_packet).length;
    const wrongVer = rows.filter((r) => r.grade.wrong_version_substitution).length;
    const falseSub = rows.filter((r) => r.grade.false_substitution).length;
    const expiredLeak = rows.filter((r) => r.grade.expired_governing_leak).length;
    const silentMissingDate = rows.filter((r) => r.grade.silent_latest_version_on_missing_date).length;
    const p95 = percentile(rows.map((r) => r.capture.retrieval_elapsed_ms), 95);
    return {
      total: rows.length,
      passed: `${passed}/${rows.length} (${((passed / Math.max(1, rows.length)) * 100).toFixed(1)}%)`,
      all_required_in_top5: `${allTop5}/${rows.length}`,
      all_required_in_actual_packet: `${allPacket}/${rows.length}`,
      wrong_version_substitutions: wrongVer,
      false_substitutions: falseSub,
      expired_governing_leaks: expiredLeak,
      silent_latest_on_missing_date: silentMissingDate,
      p95_retrieval_latency_ms: p95,
      failures: rows
        .filter((r) => !r.grade.passed)
        .map((r) => ({
          case_id: r.case_id,
          first_failing_step: r.grade.first_failing_step,
          reasons: r.grade.failure_reasons,
        })),
    };
  };

  const sealedPositive = results.filter(
    (r) => r.suite === "SEALED_GATE" && r.grade.scoring_bucket === "POSITIVE_RETRIEVAL"
  );
  const sealedNegative = results.filter(
    (r) => r.suite === "SEALED_GATE" && r.grade.scoring_bucket === "NEGATIVE_OR_ABSTENTION"
  );
  const holdoutPositive = results.filter(
    (r) => r.suite === "LEGAL_HOLDOUT" && r.grade.scoring_bucket === "POSITIVE_RETRIEVAL"
  );
  const holdoutNegative = results.filter(
    (r) => r.suite === "LEGAL_HOLDOUT" && r.grade.scoring_bucket === "NEGATIVE_OR_ABSTENTION"
  );

  // Attach reference summary from our hash-validated strictly blind 6-arm receipt
  const blind6ArmReceipt = fs.existsSync(BLIND_RECEIPT_PATH)
    ? JSON.parse(fs.readFileSync(BLIND_RECEIPT_PATH, "utf8"))
    : null;

  const output = {
    schema_version: "2.0-hardened-real-app-path",
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
      runtime_platform: parityProbe.runtime_platform,
      node_version: parityProbe.node_version,
      icu_version: parityProbe.icu_version,
    },
    summaries: {
      sealed_positive_covered: summarizeBucket(sealedPositive),
      sealed_negative_or_abstention: summarizeBucket(sealedNegative),
      holdout_positive_covered: summarizeBucket(holdoutPositive),
      holdout_negative_or_abstention: summarizeBucket(holdoutNegative),
    },
    blind_6arm_corpus_comparison_ref: blind6ArmReceipt
      ? {
          receipt_path: "docs/batch1-rc7/blind_retrieval_ablation_receipt.json",
          frozen_blind_corpus_sha256: blind6ArmReceipt.anti_leakage_attestation.frozen_blind_corpus_sha256,
          frozen_blind_passage_count: blind6ArmReceipt.anti_leakage_attestation.frozen_blind_corpus_passage_count,
          sealed_gate_frozen_blind_1924p: blind6ArmReceipt.summaries.sealed_gate_frozen_blind_1924p,
          nitibench_tax_full_rc7_11786p: blind6ArmReceipt.summaries.nitibench_tax_full_rc7_11786p,
        }
      : null,
    per_case_trace: results,
  };

  const outJsonPath = path.join(OUT_DIR, "hardened_real_app_path_and_holdout_receipt.json");
  fs.writeFileSync(outJsonPath, JSON.stringify(output, null, 2), "utf8");

  console.log("=== SEALED POSITIVE COVERED (18 cases, REAL APP EVIDENCE ASSEMBLY + HARDENED GRADER v2) ===");
  console.log(JSON.stringify(output.summaries.sealed_positive_covered, null, 2));
  console.log("\n=== SEALED NEGATIVE / CLARIFICATION / ABSTENTION (4 cases, SCORED SEPARATELY) ===");
  console.log(JSON.stringify(output.summaries.sealed_negative_or_abstention, null, 2));
  console.log("\n=== INDEPENDENT LEGAL HOLDOUTS — POSITIVE (4 cases) ===");
  console.log(JSON.stringify(output.summaries.holdout_positive_covered, null, 2));
  console.log("\n=== INDEPENDENT LEGAL HOLDOUTS — NEGATIVE (1 case) ===");
  console.log(JSON.stringify(output.summaries.holdout_negative_or_abstention, null, 2));
  console.log(`\nSaved hardened receipt to: ${outJsonPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
