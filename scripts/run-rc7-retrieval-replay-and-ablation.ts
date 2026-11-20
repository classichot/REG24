/**
 * REG24 Batch 1 RC7 — First Handoff Retrieval Replay & 5-Way Ablation Harness
 *
 * Compares on the EXACT SAME `rel.B01.rc7` corpus (`mfst.b01.rc7_thai_legal_index`),
 * locked sealed Batch 1 gate cases, AND NitiBench-Tax supplement (`hf_tax.csv`):
 *   - M1_BASE_PYTHAINLP:   Exact + Fielded BM25 (PyThaiNLP 5.4.0 newmm + reg24-th-legal-dict-v1.0)
 *   - M1_CHALLENGER_LATTE: Exact + Fielded BM25 (OpenThai 2.0 LATTE WordSeg Lite ONNX INT8) [tokenizer variable ONLY]
 *   - M2_BASE_PLUS_BGEM3:  M1 + BAAI/bge-m3 ONNX exact cosine (1024d, title+heading+text)
 *   - M3_BASE_PLUS_GRAPH:  M1 + Verified Graph Links (AMENDS/MADE_UNDER/HAS_EXCEPTION/HAS_CONDITION/INTERPRETS)
 *   - M4_BASE_PLUS_BOTH:   M1 + BGE-M3 + Verified Graph Links
 *
 * Also captures the EXACT final evidence packet delivered to Gemini Neon (`buildGroundedPassagePack`)
 * WITHOUT tuning Gemini or masking any coverage gaps!
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import {
  inspectReleaseProjectionDiagnostics,
  loadLexicalProjectionSnapshot,
} from "../src/core/knowledge/projections";
import {
  extractExplicitIdentifiersFromQuery,
  retrieveAuthorizedKnowledge,
} from "../src/core/knowledge/retrieval";
import { analyzeLegalIssuesAndFacts } from "../src/core/knowledge/legal-issue-fact-analyzer";
import { buildStructuredCaseFactLedger } from "../src/core/knowledge/case-fact-ledger";
import { buildGroundedPassagePack } from "../src/core/knowledge/grounded-llm-drafter";
import {
  extractCompositeLegalTokens,
  extractPreservedNegationTokens,
} from "../src/core/knowledge/thai-legal-dictionary-v1";
import type { Actor, Passage } from "../src/core/knowledge/contracts";

const STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const RELEASE_ID = "rel.B01.rc7";
const PYTHON_EXE = path.resolve(process.cwd(), ".venv-nlp/Scripts/python.exe");
const PY_EVAL_SCRIPT = path.resolve(process.cwd(), "scripts/eval-bge-m3-and-latte-slice.py");
const NITIBENCH_CSV =
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/nitibench_hf_tax.csv";
const OUT_DIR =
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch";

const QA_ACTOR: Actor = {
  actor_id: "eval.rc7@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

interface EvalCase {
  case_id: string;
  suite: "SEALED_GATE" | "NITIBENCH_TAX_SUPPLEMENT";
  category: string;
  question: string;
  applicable_date: string | null;
  expected_work_ids: string[];
  expected_version_ids?: string[];
  forbidden_work_ids?: string[];
  expect_unresolved_ruling?: string | null;
  expected_exact_top1_work_id?: string | null;
}

const SEALED_GATE_CASES: EvalCase[] = [
  // --- VAT Effective-Date Boundaries (790, 799, 807 both endpoints + post-expiry + missing date) ---
  {
    case_id: "G-VAT-790-START",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2567 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามกฎหมายใด",
    applicable_date: "2024-10-01",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.790", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.790.v1"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "G-VAT-790-END",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "บริษัทให้บริการในประเทศไทยและได้รับชำระค่าบริการวันที่ 30 กันยายน 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
    applicable_date: "2025-09-30",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.790", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.790.v1"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "G-VAT-799-START",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 1 ตุลาคม 2568 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
    applicable_date: "2025-10-01",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.799", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.799.v2"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "G-VAT-799-END",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 30 กันยายน 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
    applicable_date: "2026-09-30",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.799", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.799.v2"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "G-VAT-807-START",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "บริษัทขายสินค้าและออกใบกำกับภาษีในวันที่ 1 ตุลาคม 2569 ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามกฎหมายใด",
    applicable_date: "2026-10-01",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.807.v2"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
  },
  {
    case_id: "G-VAT-807-END",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "บริษัทขายสินค้าในประเทศและส่งมอบสินค้าพร้อมออกใบกำกับภาษีในวันที่ 30 กันยายน 2570 ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามกฎหมายใด",
    applicable_date: "2027-09-30",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.807", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.807.v2"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
  },
  {
    case_id: "G-VAT-POST-807",
    suite: "SEALED_GATE",
    category: "vat_effective_date",
    question: "หากบริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ 1 ตุลาคม 2570 อัตราภาษีมูลค่าเพิ่มจะเป็นร้อยละเท่าใด พ.ร.ฎ. ฉบับที่ 807 ยังใช้บังคับหรือไม่",
    applicable_date: "2027-10-01",
    expected_work_ids: ["prov.th.rc.80"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
  },
  {
    case_id: "G-VAT-NO-DATE",
    suite: "SEALED_GATE",
    category: "vat_missing_date",
    question: "บริษัทให้บริการที่ปรึกษาในประเทศไทยแก่ลูกค้าในประเทศ ต้องเรียกเก็บภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด",
    applicable_date: null,
    expected_work_ids: ["prov.th.rc.80", "prov.th.rc.78/1", "subreg.th.rd.vat_local_tax_guide"],
  },
  // --- Distinct VAT Regimes (Zero-Rate, Exemption, Mixed-Use, Cross-Border) ---
  {
    case_id: "G-VAT-ZERO-EXPORT",
    suite: "SEALED_GATE",
    category: "vat_regime_distinction",
    question: "บริษัทไทยให้บริการออกแบบซอฟต์แวร์ในประเทศไทยแต่ส่งมอบผลของบริการให้บริษัทในประเทศญี่ปุ่นนำไปใช้ในต่างประเทศทั้งหมด เสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.80/1", "subreg.th.rd.dg_vat.105"],
  },
  {
    case_id: "G-VAT-EXEMPT-81",
    suite: "SEALED_GATE",
    category: "vat_regime_distinction",
    question: "การขายพืชผลทางการเกษตรภายในราชอาณาจักรและการให้บริการสถานพยาบาลได้รับยกเว้นภาษีมูลค่าเพิ่มตามมาตราใด",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.81"],
  },
  {
    case_id: "G-VAT-MIXED-82-6",
    suite: "SEALED_GATE",
    category: "vat_regime_distinction",
    question: "ผู้ประกอบการจดทะเบียนประกอบกิจการทั้งประเภทที่ต้องเสียภาษีมูลค่าเพิ่มและประเภทที่ได้รับยกเว้นภาษีมูลค่าเพิ่ม การเฉลี่ยภาษีซื้อต้องปฏิบัติตามมาตราใด",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.82/6"],
  },
  {
    case_id: "G-VAT-CROSSBORDER-PP36",
    suite: "SEALED_GATE",
    category: "vat_regime_distinction",
    question: "บริษัทในไทยชำระค่าบริการให้ผู้ประกอบการในต่างประเทศที่ได้ให้บริการในต่างประเทศและมีการใช้บริการนั้นในราชอาณาจักร ต้องนำส่งภาษีมูลค่าเพิ่มด้วยแบบ ภ.พ.36 ตามมาตราใด",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.77/2", "prov.th.rc.83/6"],
  },
  // --- Exact Lookup & Composite Identifier Disambiguation ---
  {
    case_id: "G-EXACT-SEC-80-1-2",
    suite: "SEALED_GATE",
    category: "exact_composite_id",
    question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๒) บัญญัติหลักเกณฑ์การเสียภาษีมูลค่าเพิ่มอัตราร้อยละ ๐ สำหรับการให้บริการไว้อย่างไร",
    applicable_date: null,
    expected_work_ids: ["prov.th.rc.80/1"],
    expected_exact_top1_work_id: "prov.th.rc.80/1",
  },
  {
    case_id: "G-EXACT-RULING-5958",
    suite: "SEALED_GATE",
    category: "exact_ruling_lookup",
    question: "หนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/5958 วินิจฉัยหลักเกณฑ์ภาษีเงินได้กรณีโอนอสังหาริมทรัพย์ไว้อย่างไร",
    applicable_date: null,
    expected_work_ids: ["work.th.rd.gk_0702_5958_2018_c7beea34"],
  },
  {
    case_id: "G-EXACT-RULING-FAKE",
    suite: "SEALED_GATE",
    category: "exact_ruling_abstention",
    question: "หนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/99999 วินิจฉัยเรื่องภาษีมูลค่าเพิ่มไว้อย่างไร",
    applicable_date: null,
    expected_work_ids: [],
    expect_unresolved_ruling: "กค 0702/99999",
  },
  // --- Gift / Property Transfer, Exceptions & Changed Facts ---
  {
    case_id: "G-GIFT-T09-CONDO-NEPHEW",
    suite: "SEALED_GATE",
    category: "gift_changed_facts",
    question: "นาย ก. (บุคคลธรรมดา) โอนกรรมสิทธิ์ห้องชุด (คอนโดมิเนียม) ราคาประเมิน 6,000,000 บาท ให้หลานชาย (บุตรของพี่สาว) โดยเสน่หาและไม่มีค่าตอบแทน ในปี 2569 มีภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษี ณ ที่จ่ายอย่างไรสำหรับผู้ให้และผู้รับ",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.42", "prov.th.rc.48", "prov.th.rc.50", "prov.th.rc.54"],
  },
  {
    case_id: "G-GIFT-B1-09-CASH-NIECE",
    suite: "SEALED_GATE",
    category: "gift_exception",
    question: "ลุงให้เงินสดจำนวน 25,000,000 บาท แก่หลานสาวโดยเสน่หาในโอกาสพิธีมงคลสมรส ต้องเสียภาษีเงินได้บุคคลธรรมดาอย่างไร ได้รับยกเว้นเท่าใดและเลือกเสียอัตราร้อยละ 5 ได้หรือไม่",
    applicable_date: "2026-02-10",
    expected_work_ids: ["prov.th.rc.42", "prov.th.rc.48"],
  },
  {
    case_id: "G-GIFT-CONDO-BROTHER",
    suite: "SEALED_GATE",
    category: "gift_changed_facts",
    question: "พี่ชายโอนกรรมสิทธิ์ห้องชุดให้แก่น้องชายโดยเสน่หาไม่มีค่าตอบแทน ณ สำนักงานที่ดิน ผู้โอนและผู้รับโอนมีภาระภาษีเงินได้บุคคลธรรมดาและการหักภาษี ณ ที่จ่ายอย่างไร",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.42", "prov.th.rc.50", "prov.th.rc.54"],
  },
  // --- English-to-Thai Paraphrases & Analogous Ruling Research ---
  {
    case_id: "G-PARAPHRASE-EN-VAT",
    suite: "SEALED_GATE",
    category: "en_to_th_paraphrase",
    question: "What is the VAT rate in Thailand for domestic sale of goods invoiced on 30 September 2026 under the Revenue Code?",
    applicable_date: "2026-09-30",
    expected_work_ids: ["prov.th.rc.80", "subreg.th.rc.royal_decree.799", "subreg.th.rd.vat_local_tax_guide"],
    expected_version_ids: ["ver.th.rc.royal_decree.799.v2"],
    forbidden_work_ids: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
  },
  {
    case_id: "G-PARAPHRASE-EN-GIFT",
    suite: "SEALED_GATE",
    category: "en_to_th_paraphrase",
    question: "Thai personal income tax and withholding tax on transferring ownership of a condominium to a nephew as a gift without consideration",
    applicable_date: "2026-06-15",
    expected_work_ids: ["prov.th.rc.42", "prov.th.rc.48", "prov.th.rc.50", "prov.th.rc.54"],
  },
  {
    case_id: "G-ANALOGOUS-RULING-EXPORT",
    suite: "SEALED_GATE",
    category: "analogous_ruling_research",
    question: "มีหนังสือตอบข้อหารือใดที่ตีความมาตรา 80/1 (2) กรณีให้บริการที่ปรึกษาหรือออกแบบในประเทศไทยแก่บริษัทต่างประเทศและส่งผลของบริการไปใช้ในต่างประเทศ",
    applicable_date: null,
    expected_work_ids: ["prov.th.rc.80/1"],
  },
];

function parseNitiBenchTaxCases(store: DurableKnowledgeStore, maxCases = 25): EvalCase[] {
  if (!fs.existsSync(NITIBENCH_CSV)) return [];
  const raw = fs.readFileSync(NITIBENCH_CSV, "utf8");
  const state = store.getState();
  // Robust simple CSV parser handling quoted multiline fields
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
  const cases: EvalCase[] = [];
  for (let idx = 1; idx < rows.length && cases.length < maxCases; idx++) {
    const [question, , relevantLawsStr] = rows[idx];
    if (!question || !relevantLawsStr) continue;
    // Parse NitiBench-Tax format: [{'law': 'ประมวลรัษฎากร', 'sections': '80/1'}, ...]
    const secMatches = Array.from(
      relevantLawsStr.matchAll(/'law'\s*:\s*'ประมวลรัษฎากร'\s*,\s*'sections'\s*:\s*'([^']+)'/g)
    );
    const workIds = new Set<string>();
    for (const m of secMatches) {
      const secKey = m[1].trim().replace(/\s+/g, "_");
      const wid = `prov.th.rc.${secKey}`;
      if (state.works[wid]) workIds.add(wid);
    }
    if (workIds.size === 0) continue;
    cases.push({
      case_id: `NITI-TAX-${String(cases.length + 1).padStart(2, "0")}`,
      suite: "NITIBENCH_TAX_SUPPLEMENT",
      category: "nitibench_tax",
      question: question.trim().slice(0, 600),
      applicable_date: null,
      expected_work_ids: Array.from(workIds).slice(0, 4),
    });
  }
  return cases;
}

function scoreLatteFieldedBm25(
  caseItem: EvalCase,
  eligiblePassages: Passage[],
  lattePassages: Record<string, { title_tokens: string[]; body_tokens: string[] }>,
  latteQueryTokens: string[],
  controllingWorkIds: string[],
  explicitWorkIds: Set<string>
): Array<{ passage: Passage; score: number }> {
  const N = Math.max(1, eligiblePassages.length);
  const k1 = 1.2;
  const b = 0.75;
  const qExact = new Set(extractCompositeLegalTokens(caseItem.question));
  const qNeg = new Set(extractPreservedNegationTokens(caseItem.question));
  const qTerms = Array.from(new Set(latteQueryTokens));

  const dfTitle = new Map<string, number>();
  const dfBody = new Map<string, number>();
  let sumTitleLen = 0;
  let sumBodyLen = 0;
  for (const p of eligiblePassages) {
    const lp = lattePassages[p.passage_id];
    if (!lp) continue;
    sumTitleLen += lp.title_tokens.length;
    sumBodyLen += lp.body_tokens.length;
    for (const t of new Set(lp.title_tokens)) dfTitle.set(t, (dfTitle.get(t) || 0) + 1);
    for (const t of new Set(lp.body_tokens)) dfBody.set(t, (dfBody.get(t) || 0) + 1);
  }
  const avgTitle = Math.max(1, sumTitleLen / N);
  const avgBody = Math.max(1, sumBodyLen / N);
  const ctrlIndex = new Map<string, number>();
  controllingWorkIds.forEach((wid, idx) => ctrlIndex.set(wid, idx));

  const scored: Array<{ passage: Passage; score: number }> = [];
  for (const p of eligiblePassages) {
    const lp = lattePassages[p.passage_id];
    if (!lp) continue;
    let s = 0;
    if (explicitWorkIds.has(p.work_id)) {
      s += p.statement_role === "statutory_text" || p.statement_role === "official_conclusion" ? 40.0 : 32.0;
    }
    const cIdx = ctrlIndex.get(p.work_id);
    if (cIdx !== undefined && (p.statement_role === "statutory_text" || p.statement_role === "official_conclusion")) {
      s += Math.max(28.0, 44.0 - cIdx * 1.2);
    }
    const titleTf = new Map<string, number>();
    for (const t of lp.title_tokens) titleTf.set(t, (titleTf.get(t) || 0) + 1);
    const bodyTf = new Map<string, number>();
    for (const t of lp.body_tokens) bodyTf.set(t, (bodyTf.get(t) || 0) + 1);

    let bm25 = 0;
    for (const qt of qExact) {
      if (titleTf.has(qt)) bm25 += 12.0;
      else if (bodyTf.has(qt)) bm25 += 4.5;
    }
    for (const qt of qNeg) {
      if (bodyTf.has(qt)) bm25 += 2.2;
    }
    for (const qt of qTerms) {
      const tfT = titleTf.get(qt) || 0;
      if (tfT > 0) {
        const df = dfTitle.get(qt) || 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        bm25 += idf * ((tfT * (k1 + 1)) / (tfT + k1 * (1 - b + (b * lp.title_tokens.length) / avgTitle))) * 2.8;
      }
      const tfB = bodyTf.get(qt) || 0;
      if (tfB > 0) {
        const df = dfBody.get(qt) || 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        bm25 += idf * ((tfB * (k1 + 1)) / (tfB + k1 * (1 - b + (b * lp.body_tokens.length) / avgBody))) * 1.0;
      }
    }
    const normDenom = Math.sqrt(Math.max(4, qTerms.length)) * 3.0;
    const scaled = bm25 / normDenom;
    const compressed = scaled <= 5.0 ? scaled : 5.0 + Math.log1p(scaled - 5.0) * 1.8;
    s += compressed * 2.5;
    if (p.statement_role === "statutory_text" || p.statement_role === "official_conclusion") {
      s *= 1.12;
    }
    if (s > 0) scored.push({ passage: p, score: Number(s.toFixed(4)) });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Number(sorted[idx].toFixed(2));
}

async function main() {
  const store = new DurableKnowledgeStore(STORE_DIR);
  const state = store.getState();

  // Fix exact ruling work_id for กค 0702/5958 dynamically from canonical store
  const r5958 = Object.values(state.works).find(
    (w) => w.type === "TaxRuling" && w.official_identifiers.some((o) => o.normalized.includes("0702/5958"))
  );
  const r5958Case = SEALED_GATE_CASES.find((c) => c.case_id === "G-EXACT-RULING-5958");
  if (r5958 && r5958Case) {
    r5958Case.expected_work_ids = [r5958.work_id];
    r5958Case.expected_exact_top1_work_id = r5958.work_id;
  }

  const nitiCases = parseNitiBenchTaxCases(store, 25);
  const allCases = [...SEALED_GATE_CASES, ...nitiCases];
  console.log(`Evaluating ${SEALED_GATE_CASES.length} sealed gate cases + ${nitiCases.length} NitiBench-Tax supplement cases on ${RELEASE_ID}`);

  const projDiag = inspectReleaseProjectionDiagnostics(store, RELEASE_ID);
  const lexSnap = loadLexicalProjectionSnapshot(store, RELEASE_ID);
  console.log("Projection diagnostics:", JSON.stringify({
    release_id: projDiag.release_id,
    manifest_id: projDiag.manifest_id,
    manifest_hash: projDiag.manifest_hash?.slice(0, 16),
    lexical: projDiag.lexical,
    vector: projDiag.vector,
    graph: projDiag.graph,
  }, null, 2));

  // Build Batch 1 evaluation slice for LATTE + BGE-M3 exact-cosine challenger
  // Include ALL expected passages + ALL top-15 M1/M3 retrieved passages per case (~300–450 unique passages)
  const rc7Passages = store.getPassagesForRelease(RELEASE_ID);
  const rc7PassageById = new Map(rc7Passages.map((p) => [p.passage_id, p]));
  const slicePassageMap = new Map<string, Passage>();

  const preM1: Record<string, { bundle: ReturnType<typeof retrieveAuthorizedKnowledge>; elapsedMs: number; analysis: ReturnType<typeof analyzeLegalIssuesAndFacts> }> = {};
  const preM3: Record<string, { bundle: ReturnType<typeof retrieveAuthorizedKnowledge>; elapsedMs: number }> = {};

  for (const c of allCases) {
    const ids = extractExplicitIdentifiersFromQuery(c.question);
    const analysis = analyzeLegalIssuesAndFacts({
      question: c.question,
      applicableDate: c.applicable_date,
      mode: "standard",
      explicitRulingIds: ids.rulingIds,
      conversationHistory: [],
      state,
    });
    const t0 = performance.now();
    const b1 = retrieveAuthorizedKnowledge(store, {
      question: c.question,
      release_id: RELEASE_ID,
      actor: QA_ACTOR,
      applicable_date: c.applicable_date,
      controlling_work_ids: analysis.controllingWorkIds,
      incidental_premise_section_ids: analysis.incidentalPremiseSectionIds,
      demote_rulings_before_iso: analysis.demoteRulingsIssuedBeforeIso,
      strategy: "exact_lexical",
      max_passages: 24,
    });
    const m1Ms = performance.now() - t0;
    preM1[c.case_id] = { bundle: b1, elapsedMs: m1Ms, analysis };

    const t1 = performance.now();
    const b3 = retrieveAuthorizedKnowledge(store, {
      question: c.question,
      release_id: RELEASE_ID,
      actor: QA_ACTOR,
      applicable_date: c.applicable_date,
      controlling_work_ids: analysis.controllingWorkIds,
      incidental_premise_section_ids: analysis.incidentalPremiseSectionIds,
      demote_rulings_before_iso: analysis.demoteRulingsIssuedBeforeIso,
      strategy: "hybrid_with_graph",
      strict_verified_graph_only: true,
      max_passages: 24,
    });
    const m3Ms = performance.now() - t1;
    preM3[c.case_id] = { bundle: b3, elapsedMs: m3Ms };

    for (const h of b1.top_hits.slice(0, 12)) slicePassageMap.set(h.passage.passage_id, h.passage);
    for (const h of b3.top_hits.slice(0, 12)) slicePassageMap.set(h.passage.passage_id, h.passage);
    for (const wid of c.expected_work_ids) {
      for (const p of rc7Passages) {
        if (p.work_id === wid) slicePassageMap.set(p.passage_id, p);
      }
    }
  }
  // Ensure all key VAT/Gift statutes & decrees are in the slice even if not retrieved by BM25
  for (const wid of [
    "subreg.th.rc.royal_decree.780",
    "subreg.th.rc.royal_decree.790",
    "subreg.th.rc.royal_decree.799",
    "subreg.th.rc.royal_decree.807",
    "subreg.th.rc.royal_decree.646",
    "subreg.th.rd.vat_local_tax_guide",
    "prov.th.rc.80",
    "prov.th.rc.80/1",
    "prov.th.rc.81",
    "prov.th.rc.82/6",
    "prov.th.rc.77/2",
    "prov.th.rc.83/6",
    "prov.th.rc.78",
    "prov.th.rc.78/1",
    "prov.th.rc.42",
    "prov.th.rc.48",
    "prov.th.rc.50",
    "prov.th.rc.54",
  ]) {
    for (const p of rc7Passages) {
      if (p.work_id === wid) slicePassageMap.set(p.passage_id, p);
    }
  }

  const slicePassages = Array.from(slicePassageMap.values());
  console.log(`Exporting Batch 1 evaluation slice (${slicePassages.length} passages) to Python LATTE + BGE-M3 ONNX...`);

  const pyInPath = path.join(OUT_DIR, "_rc7_ablation_slice_in.json");
  const pyOutPath = path.join(OUT_DIR, "_rc7_ablation_slice_out.json");
  fs.writeFileSync(
    pyInPath,
    JSON.stringify({
      passages: slicePassages.map((p) => ({
        passage_id: p.passage_id,
        work_id: p.work_id,
        version_id: p.version_id,
        title_text: `${state.works[p.work_id]?.title_th || ""} ${p.contextualized_header || ""}`,
        body_text: p.exact_text,
      })),
      queries: allCases.map((c) => ({ case_id: c.case_id, question: c.question })),
    }),
    "utf8"
  );

  if (!(process.env.REUSE_PY_OUT === "1" && fs.existsSync(pyOutPath))) {
    execFileSync(PYTHON_EXE, [PY_EVAL_SCRIPT, "--input", pyInPath, "--output", pyOutPath], {
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        HF_HOME: "D:\\Code\\REG24\\.hf-cache",
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      },
    });
  } else {
    console.log("Reusing freshly computed LATTE + BGE-M3 ONNX slice output:", pyOutPath);
  }

  const pyOut = JSON.parse(fs.readFileSync(pyOutPath, "utf8")) as {
    latte_meta: { model: string; version: string; total_ms: number; query_p95_ms: number };
    bge_m3_meta: {
      model: string;
      runtime: string;
      dimensions: number;
      slice_passage_count: number;
      passage_embed_total_ms: number;
      query_embed_p95_ms: number;
    };
    latte_passages: Record<string, { title_tokens: string[]; body_tokens: string[] }>;
    latte_queries: Record<string, string[]>;
    bge_top_by_case: Record<string, Array<{ passage_id: string; work_id: string; version_id: string; cosine: number }>>;
  };

  // Fuse M2 (M1 + BGE-M3) and M4 (M3 + BGE-M3) while preserving authority/date filter & exact-ID priority!
  const evaluateMethodRanks = (
    c: EvalCase,
    rankedWorkVer: Array<{ work_id: string; version_id: string; passage_id: string }>,
    unresolvedRulings: string[]
  ) => {
    const workRanks: Record<string, number | null> = {};
    // Deduplicate work_id order for clean distinct-authority rank
    const uniqueWorks: string[] = [];
    const seenW = new Set<string>();
    for (const item of rankedWorkVer) {
      if (!seenW.has(item.work_id)) {
        seenW.add(item.work_id);
        uniqueWorks.push(item.work_id);
      }
    }
    for (const ew of c.expected_work_ids) {
      const idx = uniqueWorks.indexOf(ew);
      workRanks[ew] = idx >= 0 ? idx + 1 : null;
    }

    const top5Works = new Set(uniqueWorks.slice(0, 5));
    const top10Works = new Set(uniqueWorks.slice(0, 10));
    const allReqTop5 =
      c.expected_work_ids.length > 0
        ? c.expected_work_ids.every((ew) => top5Works.has(ew))
        : Boolean(c.expect_unresolved_ruling && unresolvedRulings.includes(c.expect_unresolved_ruling));
    const anyHitTop5 =
      c.expected_work_ids.length > 0
        ? c.expected_work_ids.some((ew) => top5Works.has(ew))
        : Boolean(c.expect_unresolved_ruling && unresolvedRulings.includes(c.expect_unresolved_ruling));

    const wrongVersionHits = (c.forbidden_work_ids || []).filter((fw) => top5Works.has(fw));
    const expectedVersionHit =
      !c.expected_version_ids ||
      c.expected_version_ids.every((ev) => rankedWorkVer.slice(0, 12).some((x) => x.version_id === ev));
    const exactTop1Ok = !c.expected_exact_top1_work_id || uniqueWorks[0] === c.expected_exact_top1_work_id;
    const falseMatch80For80_1 =
      c.case_id === "G-EXACT-SEC-80-1-2" && uniqueWorks[0] === "prov.th.rc.80";

    return {
      work_ranks: workRanks,
      top5_works: uniqueWorks.slice(0, 5),
      all_required_in_top5: allReqTop5 && expectedVersionHit && wrongVersionHits.length === 0 && exactTop1Ok,
      any_hit_in_top5: anyHitTop5,
      all_required_in_top10:
        c.expected_work_ids.length > 0
          ? c.expected_work_ids.every((ew) => top10Works.has(ew))
          : allReqTop5,
      wrong_version_substitutions: wrongVersionHits,
      expected_version_matched: expectedVersionHit,
      exact_top1_ok: exactTop1Ok,
      false_match: falseMatch80For80_1 || wrongVersionHits.length > 0,
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perCaseResults: any[] = [];
  const methodLatencies: Record<string, number[]> = {
    M1_BASE_PYTHAINLP: [],
    M1_CHALLENGER_LATTE: [],
    M2_BASE_PLUS_BGEM3: [],
    M3_BASE_PLUS_GRAPH: [],
    M4_BASE_PLUS_BOTH: [],
  };

  for (const c of allCases) {
    const { bundle: b1, elapsedMs: m1Ms, analysis } = preM1[c.case_id];
    const { bundle: b3, elapsedMs: m3Ms } = preM3[c.case_id];

    // Check indexed coverage in rel.B01.rc7
    const coveredMap: Record<string, boolean> = {};
    for (const ew of c.expected_work_ids) {
      coveredMap[ew] = rc7Passages.some((p) => p.work_id === ew);
    }
    const allCovered = Object.values(coveredMap).every(Boolean);

    // Filter slice passages by the EXACT same temporal eligibility as production retrieval
    const b1AllowedSet = new Set(
      rc7Passages
        .filter((p) => {
          if (!c.applicable_date) return true;
          const ver = state.versions[p.version_id];
          if (!ver || !ver.legal_applicability?.length) return true;
          if (ver.is_consolidated_derived) return true;
          const isTemp =
            ver.covered_transaction_period?.is_temporary_rule === true ||
            /^subreg\.th\.rc\.royal_decree\.(780|790|799|807)$/.test(p.work_id);
          return ver.legal_applicability.some((iv) => {
            if ((iv.is_temporary_rule || isTemp) && !iv.valid_to) return false;
            return (!iv.valid_from || c.applicable_date! >= iv.valid_from) && (!iv.valid_to || c.applicable_date! <= iv.valid_to);
          });
        })
        .map((p) => p.passage_id)
    );

    const tLatte0 = performance.now();
    const eligibleSlice = slicePassages.filter((p) => b1AllowedSet.has(p.passage_id));
    const explicitHitWorkIds = new Set(
      b1.top_hits
        .filter((h) => h.match_sources.includes("exact_id"))
        .map((h) => h.passage.work_id)
    );
    const latteHits = scoreLatteFieldedBm25(
      c,
      eligibleSlice,
      pyOut.latte_passages,
      pyOut.latte_queries[c.case_id] || [],
      analysis.controllingWorkIds,
      explicitHitWorkIds
    );
    const latteMs = performance.now() - tLatte0 + pyOut.latte_meta.query_p95_ms;

    // Fuse BGE-M3 dense scores (strictly preserving temporal filter & exact-ID priority!)
    const bgeHits = (pyOut.bge_top_by_case[c.case_id] || []).filter((x) => b1AllowedSet.has(x.passage_id));
    const fuseWithBge = (baseBundle: ReturnType<typeof retrieveAuthorizedKnowledge>) => {
      const fused = new Map<string, { passage: Passage; score: number }>();
      for (const h of baseBundle.top_hits) {
        fused.set(h.passage.passage_id, { passage: h.passage, score: h.score });
      }
      bgeHits.forEach((bh, idx) => {
        const p = rc7PassageById.get(bh.passage_id);
        if (!p) return;
        const rrf = 1 / (20 + idx);
        const bgeDelta = bh.cosine * 2.6 + rrf * 7;
        const cur = fused.get(bh.passage_id);
        if (cur) cur.score += bgeDelta;
        else fused.set(bh.passage_id, { passage: p, score: bgeDelta });
      });
      return Array.from(fused.values())
        .sort((a, b) => b.score - a.score)
        .map((x) => ({
          work_id: x.passage.work_id,
          version_id: x.passage.version_id,
          passage_id: x.passage.passage_id,
        }));
    };

    const m1Ranked = b1.top_hits.map((h) => ({
      work_id: h.passage.work_id,
      version_id: h.passage.version_id,
      passage_id: h.passage.passage_id,
    }));
    const latteRanked = latteHits.slice(0, 24).map((h) => ({
      work_id: h.passage.work_id,
      version_id: h.passage.version_id,
      passage_id: h.passage.passage_id,
    }));
    const m2Ranked = fuseWithBge(b1);
    const m3Ranked = b3.top_hits.map((h) => ({
      work_id: h.passage.work_id,
      version_id: h.passage.version_id,
      passage_id: h.passage.passage_id,
    }));
    const m4Ranked = fuseWithBge(b3);

    methodLatencies.M1_BASE_PYTHAINLP.push(m1Ms);
    methodLatencies.M1_CHALLENGER_LATTE.push(latteMs);
    methodLatencies.M2_BASE_PLUS_BGEM3.push(m1Ms + pyOut.bge_m3_meta.query_embed_p95_ms);
    methodLatencies.M3_BASE_PLUS_GRAPH.push(m3Ms);
    methodLatencies.M4_BASE_PLUS_BOTH.push(m3Ms + pyOut.bge_m3_meta.query_embed_p95_ms);

    // Build EXACT final evidence packet delivered to Gemini Neon (using M3 production retrieval + fact ledger)
    const factLedger = buildStructuredCaseFactLedger({
      question: c.question,
      applicableDate: c.applicable_date,
      conversationHistory: [],
    });
    const packetPassages = b3.top_hits.map((h) => h.passage);
    const modelPack = buildGroundedPassagePack({
      passages: packetPassages,
      state,
      controllingDateIso: factLedger.temporal_facts.controlling_tax_point.iso_date || c.applicable_date,
      maxPassages: 24,
    });
    const deliveredWorkIds = Array.from(new Set(modelPack.map((mp) => mp.work_id)));
    const deliveredVersionIds = Array.from(new Set(modelPack.map((mp) => mp.version_id)));
    const allExpectedInModelPacket =
      c.expected_work_ids.length > 0
        ? c.expected_work_ids.every((ew) => deliveredWorkIds.includes(ew)) &&
          (!c.expected_version_ids || c.expected_version_ids.every((ev) => deliveredVersionIds.includes(ev)))
        : Boolean(c.expect_unresolved_ruling && b3.unresolved_explicit_ruling_ids.includes(c.expect_unresolved_ruling));

    const evalM1 = evaluateMethodRanks(c, m1Ranked, b1.unresolved_explicit_ruling_ids);
    const evalLatte = evaluateMethodRanks(c, latteRanked, b1.unresolved_explicit_ruling_ids);
    const evalM2 = evaluateMethodRanks(c, m2Ranked, b1.unresolved_explicit_ruling_ids);
    const evalM3 = evaluateMethodRanks(c, m3Ranked, b3.unresolved_explicit_ruling_ids);
    const evalM4 = evaluateMethodRanks(c, m4Ranked, b3.unresolved_explicit_ruling_ids);

    // Determine FIRST STAGE THAT FAILED (if any) on the production M3 path
    let firstStageFailed = "NONE";
    if (!allCovered) firstStageFailed = "1_CORPUS_COVERAGE_GAP";
    else if (evalM3.wrong_version_substitutions.length > 0) firstStageFailed = "2_TEMPORAL_OR_VERSION_FILTER";
    else if (!evalM3.all_required_in_top5) firstStageFailed = "3_RETRIEVAL_RANKING_TOP5";
    else if (!allExpectedInModelPacket) firstStageFailed = "4_EVIDENCE_PACKET_ASSEMBLY";

    perCaseResults.push({
      case_id: c.case_id,
      suite: c.suite,
      category: c.category,
      applicable_date: c.applicable_date,
      expected_work_ids: c.expected_work_ids,
      expected_version_ids: c.expected_version_ids || [],
      indexed_coverage: coveredMap,
      all_covered: allCovered,
      methods: {
        M1_BASE_PYTHAINLP: evalM1,
        M1_CHALLENGER_LATTE: evalLatte,
        M2_BASE_PLUS_BGEM3: evalM2,
        M3_BASE_PLUS_GRAPH: evalM3,
        M4_BASE_PLUS_BOTH: evalM4,
      },
      bge_m3_pure_top5_works: Array.from(new Set(bgeHits.map((x) => x.work_id))).slice(0, 5),
      model_evidence_packet: {
        passage_count: modelPack.length,
        delivered_work_ids: deliveredWorkIds,
        delivered_version_ids: deliveredVersionIds,
        all_expected_delivered: allExpectedInModelPacket,
        unresolved_rulings_reported: b3.unresolved_explicit_ruling_ids,
      },
      first_stage_failed: firstStageFailed,
    });
  }

  const summarizeSuite = (suiteName: "SEALED_GATE" | "NITIBENCH_TAX_SUPPLEMENT") => {
    const subset = perCaseResults.filter((r) => r.suite === suiteName);
    const methods = [
      "M1_BASE_PYTHAINLP",
      "M1_CHALLENGER_LATTE",
      "M2_BASE_PLUS_BGEM3",
      "M3_BASE_PLUS_GRAPH",
      "M4_BASE_PLUS_BOTH",
    ] as const;
    const summary: Record<string, unknown> = { total_cases: subset.length };
    for (const m of methods) {
      const allReqCount = subset.filter((r) => r.methods[m].all_required_in_top5).length;
      const anyHitCount = subset.filter((r) => r.methods[m].any_hit_in_top5).length;
      const wrongVerCount = subset.reduce((acc, r) => acc + r.methods[m].wrong_version_substitutions.length, 0);
      const falseMatchCount = subset.filter((r) => r.methods[m].false_match).length;
      summary[m] = {
        all_required_hit_at_5: `${allReqCount}/${subset.length} (${((allReqCount / Math.max(1, subset.length)) * 100).toFixed(1)}%)`,
        any_hit_at_5: `${anyHitCount}/${subset.length} (${((anyHitCount / Math.max(1, subset.length)) * 100).toFixed(1)}%)`,
        wrong_version_substitutions: wrongVerCount,
        false_matches: falseMatchCount,
        p95_latency_ms: p95(methodLatencies[m]),
      };
    }
    const packetAllDelivered = subset.filter((r) => r.model_evidence_packet.all_expected_delivered).length;
    summary.final_evidence_packet_delivered = `${packetAllDelivered}/${subset.length} (${((packetAllDelivered / Math.max(1, subset.length)) * 100).toFixed(1)}%)`;
    summary.failures = subset
      .filter((r) => r.first_stage_failed !== "NONE")
      .map((r) => ({ case_id: r.case_id, first_stage_failed: r.first_stage_failed, top5_M3: r.methods.M3_BASE_PLUS_GRAPH.top5_works }));
    return summary;
  };

  const fullReport = {
    generated_at: new Date().toISOString(),
    release_id: RELEASE_ID,
    manifest_id: projDiag.manifest_id,
    manifest_hash: projDiag.manifest_hash,
    projection_diagnostics: projDiag,
    lexical_index_schema_version: lexSnap?.schema_version,
    latte_meta: pyOut.latte_meta,
    bge_m3_meta: pyOut.bge_m3_meta,
    sealed_gate_summary: summarizeSuite("SEALED_GATE"),
    nitibench_tax_supplement_summary: summarizeSuite("NITIBENCH_TAX_SUPPLEMENT"),
    per_case_results: perCaseResults,
  };

  const outJsonPath = path.join(OUT_DIR, "rc7_retrieval_ablation_and_replay.json");
  fs.writeFileSync(outJsonPath, JSON.stringify(fullReport, null, 2), "utf8");
  console.log("\n=== SEALED GATE SUMMARY ===");
  console.log(JSON.stringify(fullReport.sealed_gate_summary, null, 2));
  console.log("\n=== NITIBENCH-TAX SUPPLEMENT SUMMARY ===");
  console.log(JSON.stringify(fullReport.nitibench_tax_supplement_summary, null, 2));
  console.log("\nSaved full ablation & replay receipt to:", outJsonPath);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
