/**
 * REG24 Batch 1 (`feat/b01-thai-legal-index-retrieval-rc10.2`) —
 * Hardened Real-App-Path Verification, Regression, Fresh Diagnostic Holdouts & NitiBench Recheck
 *
 * Rules strictly enforced:
 *   1. Preserves all RC10 (`6e4fde1`) and RC10.1 (`e363120`) receipts untouched; writes ONLY to `docs/batch1-rc10.2-evidence/`.
 *   2. Runs EVERY case through the REAL `queryKnowledge()` evidence-assembly path (`captureRealAppEvidenceAssemblyOnly: true`)
 *      using the single-engine TypeScript tokenizer (`ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`) and `rel.B01.rc7`.
 *   3. Scores FOUR buckets separately:
 *        - `sealed_positive_covered` (18 cases)
 *        - `sealed_negative_or_abstention` (4 cases)
 *        - `rc10_1_regressions` (H-01..H-05 preserved as known regressions, NOT fresh holdouts)
 *        - `rc10_2_fresh_diagnostic_holdouts` (8 brand-new fresh cases across all P0 routing areas)
 *   4. Separates `ranking_passed`, `actual_packet_passed`, `ranking_miss_packet_recovered`, and
 *      `final_answer_qa_status` ("NOT_RUN_PRE_LLM_CAPTURE") on EVERY case.
 *   5. Re-checks the 25-case `NitiBench-Tax` external diagnostic supplement (without tuning to it).
 *   6. Emits ZERO Windows-local paths, tokens, credentials, or client data.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes, thaiDigitsToArabic } from "../src/core/knowledge/identity";
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
const RELEASE_ID = "rel.B01.rc7";
const OUT_DIR = path.resolve(process.cwd(), "docs/batch1-rc10.2-evidence");
const NITIBENCH_CSV =
  process.env.NITIBENCH_TAX_CSV ||
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/nitibench_hf_tax.csv";

const QA_ACTOR: Actor = {
  actor_id: "qa.hardened.rc10_2@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

interface Rc102EvalCase extends HardenedEvalCase {
  bucket:
    | "SEALED_GATE"
    | "RC10_1_REGRESSION"
    | "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT";
  conversation_history?: ConversationTurnInput[];
  /** Optional assertion that an authority MUST NOT be blanket-forced as governing when irrelevant to facts. */
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

function parseNitiBenchTaxCases(store: DurableKnowledgeStore, maxCases = 25): Array<{
  case_id: string;
  question: string;
  expected_work_ids: string[];
}> {
  if (!fs.existsSync(NITIBENCH_CSV)) return [];
  const raw = fs.readFileSync(NITIBENCH_CSV, "utf8");
  const state = store.getState();
  const rows: string[][] = [];
  let curRow: string[] = [];
  let curField = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"' && raw[i + 1] === '"') {
        curField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        curField += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        curRow.push(curField);
        curField = "";
      } else if (ch === "\n") {
        curRow.push(curField.replace(/\r$/, ""));
        if (curRow.length >= 3) rows.push(curRow);
        curRow = [];
        curField = "";
      } else {
        curField += ch;
      }
    }
  }
  const cases: Array<{ case_id: string; question: string; expected_work_ids: string[] }> = [];
  for (let idx = 1; idx < rows.length && cases.length < maxCases; idx++) {
    const [question, , relevantLawsStr] = rows[idx];
    if (!question || !relevantLawsStr) continue;
    const secMatches = Array.from(
      relevantLawsStr.matchAll(/'law'\s*:\s*'ประมวลรัษฎากร'\s*,\s*'sections'\s*:\s*'([^']+)'/g)
    );
    const expectedWorkIds = new Set<string>();
    for (const m of secMatches) {
      const secKey = thaiDigitsToArabic(m[1]).trim().replace(/\s+/g, "_");
      const cand = `prov.th.rc.${secKey}`;
      if (state.works[cand]) expectedWorkIds.add(cand);
    }
    if (expectedWorkIds.size === 0) continue;
    cases.push({
      case_id: `NITI-TAX-${String(cases.length + 1).padStart(2, "0")}`,
      question: question.trim(),
      expected_work_ids: Array.from(expectedWorkIds),
    });
  }
  return cases;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const store = new DurableKnowledgeStore(STORE_DIR);
  const rc7Passages = store.getPassagesForRelease(RELEASE_ID);
  const diag = inspectReleaseProjectionDiagnostics(store, RELEASE_ID);
  const parityProbe = runTokenizerParityProbe(store, RELEASE_ID);

  // Resolve exact instrument + version + passage_ids from rel.B01.rc7
  const uRc80 = resolveExpectedUnit(rc7Passages, "prov.th.rc.80", { sectionLabel: "ประมวลรัษฎากร มาตรา 80" });
  const uRc80_1 = resolveExpectedUnit(rc7Passages, "prov.th.rc.80/1", { sectionLabel: "ประมวลรัษฎากร มาตรา 80/1" });
  const uRc81 = resolveExpectedUnit(rc7Passages, "prov.th.rc.81", { sectionLabel: "ประมวลรัษฎากร มาตรา 81" });
  const uRc82_6 = resolveExpectedUnit(rc7Passages, "prov.th.rc.82/6", { sectionLabel: "ประมวลรัษฎากร มาตรา 82/6" });
  const uRc77_2 = resolveExpectedUnit(rc7Passages, "prov.th.rc.77/2", { sectionLabel: "ประมวลรัษฎากร มาตรา 77/2" });
  const uRc83_6 = resolveExpectedUnit(rc7Passages, "prov.th.rc.83/6", { sectionLabel: "ประมวลรัษฎากร มาตรา 83/6" });
  const uRc78_1 = resolveExpectedUnit(rc7Passages, "prov.th.rc.78/1", { sectionLabel: "ประมวลรัษฎากร มาตรา 78/1" });
  const uRc42 = resolveExpectedUnit(rc7Passages, "prov.th.rc.42", { sectionLabel: "ประมวลรัษฎากร มาตรา 42" });
  const uRc48 = resolveExpectedUnit(rc7Passages, "prov.th.rc.48", { sectionLabel: "ประมวลรัษฎากร มาตรา 48" });
  const uRc50 = resolveExpectedUnit(rc7Passages, "prov.th.rc.50", { sectionLabel: "ประมวลรัษฎากร มาตรา 50" });
  const uRc54 = resolveExpectedUnit(rc7Passages, "prov.th.rc.54", { sectionLabel: "ประมวลรัษฎากร มาตรา 54" });
  const uRc3Teras = resolveExpectedUnit(rc7Passages, "prov.th.rc.3_เตรส", { sectionLabel: "ประมวลรัษฎากร มาตรา 3 เตรส" });
  const uTp4_2528 = resolveExpectedUnit(rc7Passages, "subreg.th.rd.order_tp.4_2528", { sectionLabel: "คำสั่งกรมสรรพากรที่ ท.ป. 4/2528" });
  const uRc69Bis = resolveExpectedUnit(rc7Passages, "prov.th.rc.69_ทวิ", { sectionLabel: "ประมวลรัษฎากร มาตรา 69 ทวิ" });
  const uVatLocal = resolveExpectedUnit(rc7Passages, "subreg.th.rd.vat_local_tax_guide", { sectionLabel: "แนวทางภาษีท้องถิ่น 1/9 (0.7%)" });
  const uDgVat105 = resolveExpectedUnit(rc7Passages, "subreg.th.rd.dg_vat.105", { sectionLabel: "ประกาศอธิบดีฯ VAT ฉบับที่ 105" });
  const uRd790 = resolveExpectedUnit(rc7Passages, "subreg.th.rc.royal_decree.790", {
    versionId: "ver.th.rc.royal_decree.790.v1",
    passageIdFilter: (p) => p.passage_id === "psg.rc7.rd790.sec_3_4" || p.passage_id === "psg.rc7.rd790.sec_1_2",
    sectionLabel: "พ.ร.ฎ. (ฉบับที่ 790) มาตรา 1-4",
  });
  const uRd799 = resolveExpectedUnit(rc7Passages, "subreg.th.rc.royal_decree.799", {
    versionId: "ver.th.rc.royal_decree.799.v2",
    passageIdFilter: (p) => p.passage_id === "psg.rc7.rd799.sec_3_4" || p.passage_id === "psg.rc7.rd799.sec_1_2",
    sectionLabel: "พ.ร.ฎ. (ฉบับที่ 799) มาตรา 1-4 (v2 Gazette)",
  });
  const uRd807 = resolveExpectedUnit(rc7Passages, "subreg.th.rc.royal_decree.807", {
    versionId: "ver.th.rc.royal_decree.807.v2",
    passageIdFilter: (p) => p.passage_id === "psg.rc7.rd807.sec_3_4" || p.passage_id === "psg.rc7.rd807.sec_1_2",
    sectionLabel: "พ.ร.ฎ. (ฉบับที่ 807) มาตรา 1-4 (v2 Gazette)",
  });
  const uRuling5958 = resolveExpectedUnit(rc7Passages, "work.th.rd.0702_5958_2015_04f2b49f", {
    sectionLabel: "หนังสือตอบข้อหารือ 0702/5958",
  });

  const cases: Rc102EvalCase[] = [
    // ================== 1. SEALED GATE POSITIVE (18 cases) ==================
    {
      case_id: "G-VAT-790-START",
      bucket: "SEALED_GATE",
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
      bucket: "SEALED_GATE",
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
      bucket: "SEALED_GATE",
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
      bucket: "SEALED_GATE",
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
      bucket: "SEALED_GATE",
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
      bucket: "SEALED_GATE",
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
      bucket: "SEALED_GATE",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_regime_distinction",
      question: "บริษัทไทยให้บริการออกแบบซอฟต์แวร์ในประเทศไทยแต่ส่งมอบผลของบริการให้บริษัทในประเทศญี่ปุ่นนำไปใช้ในต่างประเทศทั้งหมด เสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc80_1, uDgVat105],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
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
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
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
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
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
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
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
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
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
      temporary_decree_work_ids_requiring_date: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
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
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },

    // ================== 3. RC10.1 KNOWN REGRESSIONS (H-01..H-05 — preserved as regressions!) ==================
    {
      case_id: "H-01-VAT-790-MID",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression_vat_date",
      question: "ห้างหุ้นส่วนจำกัดขายอุปกรณ์สำนักงานให้ลูกค้าในกรุงเทพฯ และส่งมอบสินค้าในวันที่ 15 มีนาคม 2568 ต้องเก็บภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์และอ้างอิงพระราชกฤษฎีกาใด",
      applicable_date: "2025-03-15",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "H-02-VAT-807-MID",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression_vat_date",
      question: "ผู้ประกอบการจดทะเบียนให้บริการซ่อมบำรุงเครื่องจักรในไทยและรับชำระค่าบริการวันที่ 20 เมษายน 2570 ใช้ภาษีมูลค่าเพิ่มอัตราใดและพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2027-04-20",
      expected_evidence: [uRc80, uRd807, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
    {
      case_id: "H-03-GIFT-LAND-CHILD",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression_gift_property",
      question: "บิดาโอนกรรมสิทธิ์ที่ดินมูลค่าประเมิน 25,000,000 บาท ให้บุตรชอบด้วยกฎหมายโดยเสน่หาไม่มีค่าตอบแทน มีภาระภาษีเงินได้บุคคลธรรมดาและภาษีหัก ณ ที่จ่ายอย่างไร",
      applicable_date: "2026-05-01",
      expected_evidence: [uRc42, uRc48, uRc50, uRc54],
    },
    {
      case_id: "H-04-SEC-80-1-1-EXPORT-GOODS",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "rc10_1_regression_composite_id",
      question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๑) กำหนดหลักเกณฑ์การใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 0 สำหรับการส่งออกสินค้าไว้อย่างไร",
      applicable_date: null,
      expected_evidence: [uRc80_1],
      expected_exact_top1_work_id: "prov.th.rc.80/1",
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "H-05-NEG-FAKE-RULING-88888",
      bucket: "RC10_1_REGRESSION",
      suite: "LEGAL_HOLDOUT",
      case_kind: "NEGATIVE_FAKE_RULING",
      category: "rc10_1_regression_fake_ruling",
      question: "ขอสรุปแนววินิจฉัยของหนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0706/88888 เรื่องภาษีธุรกิจเฉพาะ",
      applicable_date: null,
      expected_evidence: [],
      expect_unresolved_ruling_id: "กค 0706/88888",
    },

    // ================== 4. RC10.2 FRESH DIAGNOSTIC HOLDOUTS (8 brand-new cases across all P0 categories!) ==================
    {
      case_id: "F-01-VAT-REQ-DATE-ONLY",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_request_date_paraphrase",
      question: "ร้านค้าปลีกในจังหวัดเชียงใหม่ขายเครื่องใช้ไฟฟ้าให้ลูกค้าหน้าร้าน ต้องคิดภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์และใช้พระราชกฤษฎีกาฉบับใด",
      applicable_date: "2025-05-10",
      expected_evidence: [uRc80, uRd790, uVatLocal],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
    },
    {
      case_id: "F-02-VAT-DATE-CONFLICT",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "NEGATIVE_MISSING_DATE",
      category: "fresh_date_conflict_resolution",
      question: "บริษัทในไทยรับเหมาก่อสร้างอาคารในกรุงเทพฯ และรับชำระงวดงานวันที่ 15 กันยายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์ตามพระราชกฤษฎีกาใด",
      applicable_date: "2026-10-20",
      expected_evidence: [uRc80, uVatLocal],
      temporary_decree_work_ids_requiring_date: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "F-03-EXPORT-SERVICE-FRESH",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_export_zero_rate",
      question: "บริษัทวิศวกรรมในไทยจัดทำแบบแปลนโรงงานให้ลูกค้าในประเทศเกาหลีใต้ โดยลูกค้านำแบบแปลนไปก่อสร้างในเกาหลีใต้ทั้งหมด จะได้สิทธิเสียภาษีมูลค่าเพิ่มร้อยละ 0 ตามเงื่อนไขใด",
      applicable_date: null,
      expected_evidence: [uRc80_1, uDgVat105],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "F-04-CROSSBORDER-INBOUND-FRESH",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_crossborder_pp36",
      question: "บริษัทจำกัดในไทยจ่ายค่าบริการคลาวด์ซอฟต์แวร์ให้ผู้ให้บริการในสหรัฐอเมริกา เพื่อใช้ในสำนักงานที่กรุงเทพฯ ต้องยื่นนำส่งภาษีมูลค่าเพิ่มด้วยแบบ ภ.พ.36 ตามบทบัญญัติใด",
      applicable_date: null,
      expected_evidence: [uRc77_2, uRc83_6],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "F-05-WHT-INCIDENTAL-VAT-GOVT",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_wht_incidental_vat_govt",
      question: "กรมชลประทานซึ่งเป็นหน่วยงานราชการจ่ายค่าจัดซื้อครุภัณฑ์จำนวน 200,000 บาท (ราคาก่อนภาษีมูลค่าเพิ่ม VAT 7%) ให้แก่บริษัทเอกชน หน่วยงานราชการต้องหักภาษีเงินได้ ณ ที่จ่ายในอัตราร้อยละเท่าใดและตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc69Bis, uRc50],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "F-06-WHT-INCIDENTAL-VAT-PRIVATE",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_wht_incidental_vat_private",
      question: "บริษัทเอกชนจ้างบริษัทผู้รับเหมาที่จดทะเบียนภาษีมูลค่าเพิ่มให้ปรับปรุงสำนักงาน มูลค่างาน 500,000 บาท ยังไม่รวม VAT ผู้ว่าจ้างต้องหักภาษีเงินได้ ณ ที่จ่ายตามมาตราใดและใช้ฐานเงินได้ใดคำนวณ",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc3Teras, uTp4_2528],
      forbidden_governing_work_ids: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    },
    {
      case_id: "F-07-PROP-FATHER-CHILD-UNDER-20M",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_property_no_blanket_54",
      question: "บิดาโอนกรรมสิทธิ์บ้านพร้อมที่ดินราคาประเมิน 12,000,000 บาท ให้แก่บุตรชอบด้วยกฎหมายโดยเสน่หาไม่มีค่าตอบแทน ผู้รับและผู้ให้ได้รับยกเว้นภาษีเงินได้บุคคลธรรมดาตามมาตราใด",
      applicable_date: "2026-06-15",
      expected_evidence: [uRc42],
      assert_not_forced_work_ids: ["prov.th.rc.54"],
    },
    {
      case_id: "F-08-MULTITURN-FACT-CHANGE",
      bucket: "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT",
      suite: "LEGAL_HOLDOUT",
      case_kind: "POSITIVE_COVERED",
      category: "fresh_multiturn_fact_change",
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
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
    },
  ];

  const caseSetHash = sha256Bytes(JSON.stringify(cases));
  const results: Array<{
    case_id: string;
    bucket: Rc102EvalCase["bucket"];
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

    const notForcedViolations: string[] = [];
    for (const wid of c.assert_not_forced_work_ids || []) {
      const inGoverningPacket = cap.actual_model_packet.some(
        (p) => p.work_id === wid && p.evidence_role === "governing"
      );
      if (inGoverningPacket) {
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

  const summarizeBucket = (rows: typeof results) => {
    const passed = rows.filter((r) => r.grade.passed && r.assert_not_forced_violations.length === 0).length;
    const rankingPassed = rows.filter((r) => r.grade.ranking_passed).length;
    const actualPacketPassed = rows.filter(
      (r) => r.grade.actual_packet_passed && r.assert_not_forced_violations.length === 0
    ).length;
    const rankingMissPacketRecovered = rows.filter((r) => r.grade.ranking_miss_packet_recovered).length;
    const wrongVer = rows.filter((r) => r.grade.wrong_version_substitution).length;
    const falseSub = rows.filter((r) => r.grade.false_substitution).length;
    const expiredLeak = rows.filter((r) => r.grade.expired_governing_leak).length;
    const silentMissingDate = rows.filter((r) => r.grade.silent_latest_version_on_missing_date).length;
    const p95 = percentile(rows.map((r) => r.capture.retrieval_elapsed_ms), 95);
    return {
      total: rows.length,
      overall_pre_llm_passed: `${passed}/${rows.length} (${((passed / Math.max(1, rows.length)) * 100).toFixed(1)}%)`,
      ranking_top5_passed: `${rankingPassed}/${rows.length}`,
      actual_model_packet_passed: `${actualPacketPassed}/${rows.length}`,
      ranking_miss_packet_recovered: rankingMissPacketRecovered,
      final_answer_qa_status: "NOT_RUN_PRE_LLM_CAPTURE",
      wrong_version_substitutions: wrongVer,
      false_substitutions: falseSub,
      expired_governing_leaks: expiredLeak,
      silent_latest_on_missing_date: silentMissingDate,
      p95_retrieval_latency_ms: p95,
      failures_or_recovered_misses: rows
        .filter((r) => !r.grade.passed || r.grade.ranking_miss_packet_recovered || r.assert_not_forced_violations.length > 0)
        .map((r) => ({
          case_id: r.case_id,
          ranking_passed: r.grade.ranking_passed,
          actual_packet_passed: r.grade.actual_packet_passed,
          ranking_miss_packet_recovered: r.grade.ranking_miss_packet_recovered,
          first_failing_step: r.grade.first_failing_step,
          reasons: [...r.grade.failure_reasons, ...r.assert_not_forced_violations],
        })),
    };
  };

  const sealedPos = results.filter(
    (r) => r.bucket === "SEALED_GATE" && r.grade.scoring_bucket === "POSITIVE_RETRIEVAL"
  );
  const sealedNeg = results.filter(
    (r) => r.bucket === "SEALED_GATE" && r.grade.scoring_bucket === "NEGATIVE_OR_ABSTENTION"
  );
  const rc101RegPos = results.filter(
    (r) => r.bucket === "RC10_1_REGRESSION" && r.grade.scoring_bucket === "POSITIVE_RETRIEVAL"
  );
  const rc101RegNeg = results.filter(
    (r) => r.bucket === "RC10_1_REGRESSION" && r.grade.scoring_bucket === "NEGATIVE_OR_ABSTENTION"
  );
  const freshHoldoutPos = results.filter(
    (r) => r.bucket === "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT" && r.grade.scoring_bucket === "POSITIVE_RETRIEVAL"
  );
  const freshHoldoutNeg = results.filter(
    (r) => r.bucket === "RC10_2_FRESH_DIAGNOSTIC_HOLDOUT" && r.grade.scoring_bucket === "NEGATIVE_OR_ABSTENTION"
  );

  // ================== 5. NITIBENCH-TAX 25-CASE DIAGNOSTIC RECHECK (NO TUNING!) ==================
  const nitiCases = parseNitiBenchTaxCases(store, 25);
  const nitiTraces: Array<{
    case_id: string;
    expected_work_ids: string[];
    top5_work_ids: string[];
    packet_work_ids: string[];
    all_required_in_top5: boolean;
    any_required_in_top5: boolean;
    all_required_in_packet: boolean;
    any_required_in_packet: boolean;
    elapsed_ms: number;
  }> = [];

  for (const nc of nitiCases) {
    let cap: RealAppEvidenceAssemblyCapture | null = null;
    await queryKnowledge(
      {
        question: nc.question,
        release_id: RELEASE_ID,
        applicable_date: null,
        mode: "standard",
        answer_generation_mode: "llm_grounded",
      },
      QA_ACTOR,
      {
        store,
        retrievalStrategy: "hybrid_with_graph",
        captureRealAppEvidenceAssemblyOnly: true,
        onRealAppEvidenceAssembly: (c) => {
          cap = c;
        },
      }
    );
    const c = cap as RealAppEvidenceAssemblyCapture | null;
    const top5WorkIds = Array.from(new Set((c?.retrieval_top_hits || []).slice(0, 5).map((h) => h.work_id)));
    const packetWorkIds = Array.from(new Set((c?.actual_model_packet || []).map((p) => p.work_id)));
    const allTop5 = nc.expected_work_ids.every((w) => top5WorkIds.includes(w));
    const anyTop5 = nc.expected_work_ids.some((w) => top5WorkIds.includes(w));
    const allPkt = nc.expected_work_ids.every((w) => packetWorkIds.includes(w));
    const anyPkt = nc.expected_work_ids.some((w) => packetWorkIds.includes(w));
    nitiTraces.push({
      case_id: nc.case_id,
      expected_work_ids: nc.expected_work_ids,
      top5_work_ids: top5WorkIds,
      packet_work_ids: packetWorkIds,
      all_required_in_top5: allTop5,
      any_required_in_top5: anyTop5,
      all_required_in_packet: allPkt,
      any_required_in_packet: anyPkt,
      elapsed_ms: c?.retrieval_elapsed_ms || 0,
    });
  }

  const nitiSummary = {
    evaluated_cases: nitiTraces.length,
    rc10_baseline_reference: {
      all_required_hit_at_5: "4/25 (16.0%)",
      any_required_hit_at_5: "15/25 (60.0%)",
    },
    rc10_2_current: {
      all_required_hit_at_5: `${nitiTraces.filter((t) => t.all_required_in_top5).length}/${nitiTraces.length} (${((nitiTraces.filter((t) => t.all_required_in_top5).length / Math.max(1, nitiTraces.length)) * 100).toFixed(1)}%)`,
      any_required_hit_at_5: `${nitiTraces.filter((t) => t.any_required_in_top5).length}/${nitiTraces.length} (${((nitiTraces.filter((t) => t.any_required_in_top5).length / Math.max(1, nitiTraces.length)) * 100).toFixed(1)}%)`,
      all_required_in_actual_packet: `${nitiTraces.filter((t) => t.all_required_in_packet).length}/${nitiTraces.length} (${((nitiTraces.filter((t) => t.all_required_in_packet).length / Math.max(1, nitiTraces.length)) * 100).toFixed(1)}%)`,
      any_required_in_actual_packet: `${nitiTraces.filter((t) => t.any_required_in_packet).length}/${nitiTraces.length} (${((nitiTraces.filter((t) => t.any_required_in_packet).length / Math.max(1, nitiTraces.length)) * 100).toFixed(1)}%)`,
      p95_retrieval_latency_ms: percentile(nitiTraces.map((t) => t.elapsed_ms), 95),
    },
    per_case_trace: nitiTraces,
  };

  const output = {
    schema_version: "2.1-rc10.2-hardened-real-app-verification",
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
      sealed_positive_covered: summarizeBucket(sealedPos),
      sealed_negative_or_abstention: summarizeBucket(sealedNeg),
      rc10_1_regressions_positive: summarizeBucket(rc101RegPos),
      rc10_1_regressions_negative: summarizeBucket(rc101RegNeg),
      rc10_2_fresh_diagnostic_holdouts_positive: summarizeBucket(freshHoldoutPos),
      rc10_2_fresh_diagnostic_holdouts_negative: summarizeBucket(freshHoldoutNeg),
    },
    per_case_trace: results,
  };

  const mainOutPath = path.join(OUT_DIR, "rc10_2_hardened_real_app_and_holdout_receipt.json");
  const nitiOutPath = path.join(OUT_DIR, "nitibench_diagnostic_recheck.json");
  fs.writeFileSync(mainOutPath, JSON.stringify(output, null, 2), "utf8");
  fs.writeFileSync(nitiOutPath, JSON.stringify(nitiSummary, null, 2), "utf8");

  console.log("=== 1. SEALED POSITIVE COVERED (18 cases) ===");
  console.log(JSON.stringify(output.summaries.sealed_positive_covered, null, 2));
  console.log("\n=== 2. SEALED NEGATIVE / ABSTENTION (4 cases) ===");
  console.log(JSON.stringify(output.summaries.sealed_negative_or_abstention, null, 2));
  console.log("\n=== 3. RC10.1 KNOWN REGRESSIONS (H-01..H-04 pos, H-05 neg) ===");
  console.log(JSON.stringify({
    positive: output.summaries.rc10_1_regressions_positive,
    negative: output.summaries.rc10_1_regressions_negative,
  }, null, 2));
  console.log("\n=== 4. RC10.2 FRESH DIAGNOSTIC HOLDOUTS (7 pos, 1 neg) ===");
  console.log(JSON.stringify({
    positive: output.summaries.rc10_2_fresh_diagnostic_holdouts_positive,
    negative: output.summaries.rc10_2_fresh_diagnostic_holdouts_negative,
  }, null, 2));
  console.log("\n=== 5. NITIBENCH-TAX 25-CASE DIAGNOSTIC RECHECK ===");
  console.log(JSON.stringify({
    evaluated_cases: nitiSummary.evaluated_cases,
    rc10_baseline_reference: nitiSummary.rc10_baseline_reference,
    rc10_2_current: nitiSummary.rc10_2_current,
  }, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
