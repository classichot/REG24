/**
 * REG24 Batch 1 (`rel.B01.rc7`) — Strictly Blind Retrieval Comparison & NitiBench Miss Diagnosis
 *
 * Anti-leakage invariants:
 *   1. ZERO label leakage: `expected_work_ids` and `expected_version_ids` NEVER touch corpus selection,
 *      index construction, retrieval, or challenger pooling. They exist ONLY inside `scoreBlindResult()`.
 *   2. Same frozen, label-independent, query-independent eligible corpus for ALL 6 challenger arms:
 *        FROZEN_BLIND_CORPUS_V1 = ALL Statute (27) + ALL ProvisionVersion (545) +
 *                                 ALL SubordinateLegislation (1,176) +
 *                                 ALL TaxRuling with decision_date >= 2024-01-01 (176)
 *                               = 1,924 passages (SHA-256 hashed).
 *   3. Same tokenizer on BOTH index AND query within EVERY arm (zero mixed-engine builds).
 *   4. Also evaluates full-corpus (all 11,786 passages of `rel.B01.rc7`) for TS, PyThaiNLP, and TS+Graph.
 *   5. Hash-validated cache (`corpus_slice_sha256` + `queries_sha256`) — stale outputs are never reused.
 *   6. Diagnoses representative NitiBench-Tax misses across Coverage, Eligibility, Ranking, and Packet Assembly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256Bytes, thaiDigitsToArabic } from "../src/core/knowledge/identity";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import {
  inspectReleaseProjectionDiagnostics,
  loadGraphProjectionSnapshot,
  runTokenizerParityProbe,
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
  THAI_LEGAL_COMPOUND_TERMS,
  tokenizeThaiLegalWithDictionary,
} from "../src/core/knowledge/thai-legal-dictionary-v1";
import type { Actor, Passage } from "../src/core/knowledge/contracts";

const STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const RELEASE_ID = "rel.B01.rc7";
const PYTHON_EXE = path.resolve(process.cwd(), ".venv-nlp/Scripts/python.exe");
const PY_EVAL_SCRIPT = path.resolve(process.cwd(), "scripts/eval-blind-challengers.py");
const NITIBENCH_CSV =
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/nitibench_hf_tax.csv";
const CACHE_DIR =
  "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch";
const REPO_DOCS_DIR = path.resolve(process.cwd(), "docs/batch1-rc7");

const QA_ACTOR: Actor = {
  actor_id: "blind.eval.rc7@reg24.th",
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
  // Labels below are used ONLY inside the scorer (NEVER in corpus/pool/retrieval)!
  expected_work_ids: string[];
  expected_version_ids?: string[];
  forbidden_work_ids?: string[];
  expect_unresolved_ruling?: string | null;
  expected_exact_top1_work_id?: string | null;
}

const SEALED_GATE_CASES: EvalCase[] = [
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
    expected_work_ids: ["work.th.rd.0702_5958_2015_04f2b49f"],
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
      category: "nitibench_tax_public",
      question: question.trim(),
      applicable_date: null,
      expected_work_ids: Array.from(workIds),
    });
  }
  return cases;
}

interface InMemoryFieldedBm25 {
  passages: Passage[];
  passageById: Map<string, Passage>;
  exactPostings: Map<string, Array<[number, number]>>;
  titlePostings: Map<string, Array<[number, number]>>;
  phrasePostings: Map<string, Array<[number, number]>>;
  bodyPostings: Map<string, Array<[number, number]>>;
  exactLens: number[];
  titleLens: number[];
  phraseLens: number[];
  bodyLens: number[];
  avgExact: number;
  avgTitle: number;
  avgPhrase: number;
  avgBody: number;
}

function buildInMemoryFieldedBm25(
  store: DurableKnowledgeStore,
  passages: Passage[],
  tokenizedByPid: Record<string, { title_tokens: string[]; body_tokens: string[] }>
): InMemoryFieldedBm25 {
  const state = store.getState();
  const exactPostings = new Map<string, Array<[number, number]>>();
  const titlePostings = new Map<string, Array<[number, number]>>();
  const phrasePostings = new Map<string, Array<[number, number]>>();
  const bodyPostings = new Map<string, Array<[number, number]>>();
  const exactLens: number[] = [];
  const titleLens: number[] = [];
  const phraseLens: number[] = [];
  const bodyLens: number[] = [];

  const addToks = (
    map: Map<string, Array<[number, number]>>,
    lens: number[],
    idx: number,
    toks: string[]
  ) => {
    lens.push(toks.length);
    const tf = new Map<string, number>();
    for (const t of toks) if (t) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, c] of tf.entries()) {
      let arr = map.get(t);
      if (!arr) {
        arr = [];
        map.set(t, arr);
      }
      arr.push([idx, c]);
    }
  };

  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    const w = state.works[p.work_id];
    const headerIds = (w?.official_identifiers || []).map((o) => o.normalized).join(" ");
    const titleRaw = `${w?.title_th || ""} ${p.contextualized_header || ""} ${(p.structural_path || []).join(" ")}`;
    const exactToks = Array.from(
      new Set([
        ...extractCompositeLegalTokens(`${headerIds} ${titleRaw}`),
        ...(p.search_fields?.composite_section_tokens || []),
      ])
    );
    const negToks = [
      ...extractPreservedNegationTokens(`${titleRaw} ${p.exact_text}`),
      ...extractCompositeLegalTokens(p.exact_text),
    ];
    const pre = tokenizedByPid[p.passage_id];
    if (!pre) {
      throw new Error(`STRICT_PARITY_ERROR: missing tokenized passage ${p.passage_id} — refusing silent fallback!`);
    }
    addToks(exactPostings, exactLens, i, exactToks);
    addToks(titlePostings, titleLens, i, pre.title_tokens);
    addToks(phrasePostings, phraseLens, i, negToks);
    addToks(bodyPostings, bodyLens, i, pre.body_tokens);
  }

  const avg = (a: number[]) => Math.max(1, a.reduce((s, v) => s + v, 0) / Math.max(1, a.length));
  return {
    passages,
    passageById: new Map(passages.map((p) => [p.passage_id, p])),
    exactPostings,
    titlePostings,
    phrasePostings,
    bodyPostings,
    exactLens,
    titleLens,
    phraseLens,
    bodyLens,
    avgExact: avg(exactLens),
    avgTitle: avg(titleLens),
    avgPhrase: avg(phraseLens),
    avgBody: avg(bodyLens),
  };
}

function isPassageEligibleForDate(
  store: DurableKnowledgeStore,
  p: Passage,
  applicableDate: string | null,
  explicitWorkIds: Set<string>
): boolean {
  if (!applicableDate) return true;
  const st = store.getState();
  const ver = st.versions[p.version_id];
  const work = st.works[p.work_id];
  if (!ver || !ver.legal_applicability || ver.legal_applicability.length === 0) return true;
  if (work?.type === "TaxRuling" && explicitWorkIds.has(p.work_id)) return true;
  if (work?.type === "ProvisionVersion" && ver.is_consolidated_derived) return true;
  if (work?.type === "TaxRuling") {
    const decDate = ver.decision_date || ver.publication_date || null;
    if (decDate && decDate > applicableDate) return false;
    return true;
  }
  return ver.legal_applicability.some((win) => {
    const fromOk = !win.valid_from || applicableDate >= win.valid_from;
    const isTemporary =
      Boolean(win.is_temporary_rule) || Boolean(work?.work_id.startsWith("subreg.th.rc.royal_decree."));
    if (isTemporary && !win.valid_to) return false;
    const toOk = !win.valid_to || applicableDate <= win.valid_to;
    return fromOk && toOk;
  });
}

interface ArmQueryOutput {
  ranked_work_ids: string[];
  ranked_hits: Array<{ passage_id: string; work_id: string; version_id: string; score: number }>;
  unresolved_rulings: string[];
  elapsed_ms: number;
}

function runInMemoryBlindArm(params: {
  store: DurableKnowledgeStore;
  index: InMemoryFieldedBm25;
  question: string;
  applicableDate: string | null;
  queryTokens: string[];
  controllingWorkIds: string[];
  bgeCosineByPid?: Map<string, number> | null;
  useVerifiedGraph?: boolean;
  graphEdges?: Array<{ subject: string; predicate: string; object: string }>;
  extraQueryLatencyMs?: number;
}): ArmQueryOutput {
  const t0 = performance.now();
  const state = params.store.getState();
  const { rulingIds, sectionRefs } = extractExplicitIdentifiersFromQuery(params.question);

  const authorizedWorkIds = new Set(params.index.passages.map((p) => p.work_id));
  const explicitWorkIds = new Set<string>();
  const unresolvedRulings: string[] = [];

  for (const rId of rulingIds) {
    const withP = rId.startsWith("กค ") ? rId : `กค ${rId}`;
    const withoutP = rId.replace(/^กค\s+/, "");
    const matched = Object.values(state.works).filter(
      (w) =>
        w.type === "TaxRuling" &&
        authorizedWorkIds.has(w.work_id) &&
        w.official_identifiers.some(
          (o) => o.normalized === rId || o.normalized === withP || o.normalized === withoutP
        )
    );
    if (matched.length === 0) unresolvedRulings.push(rId);
    else for (const mw of matched) explicitWorkIds.add(mw.work_id);
  }
  for (const sRef of sectionRefs) {
    const baseMatch = sRef.match(
      /^(?:มาตรา|ข้อ)\s*([0-9]+(?:\/[0-9]+)?(?:\s*(?:อัฏฐารส|สัตตรส|เอกาทศ|ทวาทศ|จตุทศ|ปัณรส|จัตวา|เบญจ|เตรส|โสฬส|สัตต|ทวิ|ตรี|อัฐ|นว|ทศ|ฉ))?)/
    );
    const prefix = sRef.startsWith("ข้อ") ? "ข้อ" : "มาตรา";
    const normBase = baseMatch ? `${prefix} ${baseMatch[1].replace(/\s+/g, " ").trim()}` : sRef;
    for (const w of Object.values(state.works)) {
      if (!authorizedWorkIds.has(w.work_id)) continue;
      if (w.type !== "Provision" && w.type !== "ProvisionVersion" && w.type !== "Statute" && w.type !== "SubordinateLegislation") continue;
      if (w.official_identifiers.some((o) => o.normalized === sRef || o.normalized === normBase)) {
        explicitWorkIds.add(w.work_id);
      }
    }
  }

  // Same legal/temporal filter for every arm
  const eligibleIdxSet = new Set<number>();
  const passagesByWork = new Map<string, number[]>();
  for (let i = 0; i < params.index.passages.length; i++) {
    const p = params.index.passages[i];
    if (!isPassageEligibleForDate(params.store, p, params.applicableDate, explicitWorkIds)) continue;
    eligibleIdxSet.add(i);
    let arr = passagesByWork.get(p.work_id);
    if (!arr) {
      arr = [];
      passagesByWork.set(p.work_id, arr);
    }
    arr.push(i);
  }

  const scores = new Map<number, number>();
  const add = (idx: number, delta: number) => {
    if (!eligibleIdxSet.has(idx)) return;
    scores.set(idx, (scores.get(idx) || 0) + delta);
  };

  // Stage 1: Exact ID priority & Authority/Date routing (identical across all arms)
  for (const wid of explicitWorkIds) {
    for (const idx of passagesByWork.get(wid) || []) {
      const p = params.index.passages[idx];
      add(idx, p.statement_role === "official_conclusion" || p.statement_role === "statutory_text" ? 40.0 : 32.0);
    }
  }
  for (const [ci, cwid] of params.controllingWorkIds.entries()) {
    const boost = Math.max(28.0, 44.0 - ci * 1.2);
    for (const idx of passagesByWork.get(cwid) || []) {
      const p = params.index.passages[idx];
      if (p.statement_role === "statutory_text" || p.statement_role === "official_conclusion") {
        add(idx, boost);
      }
    }
  }

  // Stage 2: Fielded BM25 using THIS ARM'S exact tokenizer
  const totalDocs = Math.max(1, params.index.passages.length);
  const k1 = 1.2;
  const b = 0.75;
  const qExact = extractCompositeLegalTokens(params.question);
  const qNeg = extractPreservedNegationTokens(params.question);
  const qUnique = Array.from(new Set(params.queryTokens));

  const bm25Raw = new Map<number, number>();
  const scoreSec = (
    postings: Map<string, Array<[number, number]>>,
    lens: number[],
    avgDl: number,
    terms: string[],
    w: number
  ) => {
    for (const t of terms) {
      if (!t || t.length < 2) continue;
      const post = postings.get(t);
      if (!post || post.length === 0) continue;
      const df = post.length;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      for (const [idx, tf] of post) {
        if (!eligibleIdxSet.has(idx)) continue;
        const dl = lens[idx] || avgDl;
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / avgDl));
        bm25Raw.set(idx, (bm25Raw.get(idx) || 0) + idf * tfNorm * w);
      }
    }
  };
  scoreSec(params.index.exactPostings, params.index.exactLens, params.index.avgExact, qExact, 4.5);
  scoreSec(params.index.titlePostings, params.index.titleLens, params.index.avgTitle, qUnique, 2.8);
  scoreSec(params.index.phrasePostings, params.index.phraseLens, params.index.avgPhrase, [...qNeg, ...qExact], 2.2);
  scoreSec(params.index.bodyPostings, params.index.bodyLens, params.index.avgBody, qUnique, 1.0);

  const normDenom = Math.sqrt(Math.max(4, qUnique.length)) * 3.0;
  const bm25Top = Array.from(bm25Raw.entries())
    .map(([idx, raw]) => {
      const scaled = raw / normDenom;
      const comp = scaled <= 5.0 ? scaled : 5.0 + Math.log1p(scaled - 5.0) * 1.8;
      return { idx, s: comp };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, 40);
  bm25Top.forEach((item, r) => add(item.idx, item.s * 2.5 + (1 / (15 + r)) * 10));

  // Stage 3: Optional BGE-M3 exact cosine (only for M2/M4 arms)
  if (params.bgeCosineByPid && params.bgeCosineByPid.size > 0) {
    const vecRanked: Array<{ idx: number; sim: number }> = [];
    for (let i = 0; i < params.index.passages.length; i++) {
      if (!eligibleIdxSet.has(i)) continue;
      const sim = params.bgeCosineByPid.get(params.index.passages[i].passage_id);
      if (sim !== undefined && sim > 0.25) vecRanked.push({ idx: i, sim });
    }
    vecRanked
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 40)
      .forEach((item, r) => add(item.idx, item.sim * 4.5 + (1 / (15 + r)) * 8.0));
  }

  // Stage 4: Optional Verified Graph Links (AMENDS, MADE_UNDER, HAS_EXCEPTION, HAS_CONDITION, INTERPRETS)
  if (params.useVerifiedGraph && params.graphEdges) {
    const verifiedPreds = new Set(["AMENDS", "MADE_UNDER", "HAS_EXCEPTION", "HAS_CONDITION", "INTERPRETS"]);
    const seedWorks = new Set<string>();
    const preSorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    for (const [idx] of preSorted) {
      seedWorks.add(params.index.passages[idx].work_id);
      if (seedWorks.size >= 8) break;
    }
    const hopTargets = new Set<string>();
    for (const e of params.graphEdges) {
      if (!verifiedPreds.has(e.predicate)) continue;
      if (seedWorks.has(e.subject) && !explicitWorkIds.has(e.object)) hopTargets.add(e.object);
      if (seedWorks.has(e.object) && !explicitWorkIds.has(e.subject) && e.predicate !== "INTERPRETS") {
        hopTargets.add(e.subject);
      }
    }
    for (const twid of hopTargets) {
      for (const idx of passagesByWork.get(twid) || []) {
        add(idx, 2.6);
      }
    }
  }

  // Final rank with role multiplier & per-work deduplication for top_works
  const rankedHits = Array.from(scores.entries())
    .map(([idx, sc]) => {
      const p = params.index.passages[idx];
      const mult = p.statement_role === "official_conclusion" || p.statement_role === "statutory_text" ? 1.12 : 1.0;
      return {
        passage_id: p.passage_id,
        work_id: p.work_id,
        version_id: p.version_id,
        score: Number((sc * mult).toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score);

  const rankedWorkIds: string[] = [];
  const seenW = new Set<string>();
  for (const h of rankedHits) {
    if (!seenW.has(h.work_id)) {
      seenW.add(h.work_id);
      rankedWorkIds.push(h.work_id);
    }
  }

  const elapsedMs = performance.now() - t0 + (params.extraQueryLatencyMs || 0);
  return {
    ranked_work_ids: rankedWorkIds,
    ranked_hits: rankedHits.slice(0, 24),
    unresolved_rulings: unresolvedRulings,
    elapsed_ms: Number(elapsedMs.toFixed(2)),
  };
}

function scoreBlindResult(
  c: EvalCase,
  out: ArmQueryOutput,
  eligibleCorpusWorkIds: Set<string>
): {
  in_corpus: boolean;
  all_required_hit_at_5: boolean;
  any_hit_at_5: boolean;
  wrong_version_substitution: boolean;
  false_match: boolean;
  ranks_by_expected: Record<string, number | null>;
} {
  const inCorpus = c.expected_work_ids.every((wid) => eligibleCorpusWorkIds.has(wid));
  if (c.expect_unresolved_ruling) {
    const ok = out.unresolved_rulings.some((u) => u.includes("99999"));
    return {
      in_corpus: true,
      all_required_hit_at_5: ok,
      any_hit_at_5: ok,
      wrong_version_substitution: false,
      false_match: !ok,
      ranks_by_expected: {},
    };
  }
  const top5 = out.ranked_work_ids.slice(0, 5);
  const top5Versions = new Set(out.ranked_hits.slice(0, 12).map((h) => h.version_id));
  const ranks: Record<string, number | null> = {};
  for (const wid of c.expected_work_ids) {
    const idx = out.ranked_work_ids.indexOf(wid);
    ranks[wid] = idx >= 0 ? idx + 1 : null;
  }
  const allHit = c.expected_work_ids.every((wid) => top5.includes(wid));
  const anyHit = c.expected_work_ids.some((wid) => top5.includes(wid));
  const forbiddenHit = (c.forbidden_work_ids || []).some((fw) => top5.includes(fw));
  const versionMiss = (c.expected_version_ids || []).some((ev) => !top5Versions.has(ev));
  const exactTop1Miss = Boolean(c.expected_exact_top1_work_id && top5[0] !== c.expected_exact_top1_work_id);
  return {
    in_corpus: inCorpus,
    all_required_hit_at_5: inCorpus && allHit && !forbiddenHit && !versionMiss && !exactTop1Miss,
    any_hit_at_5: inCorpus && anyHit,
    wrong_version_substitution: forbiddenHit || (inCorpus && allHit && versionMiss),
    false_match: exactTop1Miss,
    ranks_by_expected: ranks,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Number(s[idx].toFixed(2));
}

function runPythonHashValidated(params: {
  passages: Passage[];
  queries: EvalCase[];
  store: DurableKnowledgeStore;
  cacheName: string;
  skipBge?: boolean;
  skipLatte?: boolean;
}) {
  const state = params.store.getState();
  // STRICT ANTI-LEAKAGE: ONLY passage_id/work_id/version_id/title_text/body_text and case_id/question go to Python!
  const passageRecords = params.passages.map((p) => ({
    passage_id: p.passage_id,
    work_id: p.work_id,
    version_id: p.version_id,
    title_text: `${state.works[p.work_id]?.title_th || ""} ${p.contextualized_header || ""} ${(p.structural_path || []).join(" ")}`,
    body_text: p.exact_text,
  }));
  const queryRecords = params.queries.map((q) => ({
    case_id: q.case_id,
    question: q.question,
  }));
  const corpusSliceSha256 = sha256Bytes(
    JSON.stringify(passageRecords.map((p) => [p.passage_id, p.version_id]))
  );
  const queriesSha256 = sha256Bytes(JSON.stringify(queryRecords));

  const inPath = path.join(CACHE_DIR, `_blind_${params.cacheName}_in.json`);
  const outPath = path.join(CACHE_DIR, `_blind_${params.cacheName}_out.json`);

  if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
      if (
        existing.schema_version === "2.0-blind" &&
        existing.corpus_slice_sha256 === corpusSliceSha256 &&
        existing.queries_sha256 === queriesSha256
      ) {
        console.log(`Hash-validated blind cache HIT for ${params.cacheName} (corpus=${corpusSliceSha256.slice(0, 12)}, queries=${queriesSha256.slice(0, 12)})`);
        return existing;
      }
      console.log(`Cache hash mismatch for ${params.cacheName}; rebuilding cleanly...`);
    } catch {
      // rebuild
    }
  }

  fs.writeFileSync(
    inPath,
    JSON.stringify({
      corpus_slice_sha256: corpusSliceSha256,
      queries_sha256: queriesSha256,
      legal_dictionary_terms: Array.from(THAI_LEGAL_COMPOUND_TERMS),
      passages: passageRecords,
      queries: queryRecords,
    }),
    "utf8"
  );

  const args = [PY_EVAL_SCRIPT, "--input", inPath, "--output", outPath];
  if (params.skipBge) args.push("--skip-bge");
  if (params.skipLatte) args.push("--skip-latte");

  execFileSync(PYTHON_EXE, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      HF_HOME: "D:\\Code\\REG24\\.hf-cache",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    },
  });

  const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
  if (
    parsed.corpus_slice_sha256 !== corpusSliceSha256 ||
    parsed.queries_sha256 !== queriesSha256
  ) {
    throw new Error("BLIND_OUTPUT_HASH_VALIDATION_FAILED!");
  }
  return parsed;
}

async function main() {
  const store = new DurableKnowledgeStore(STORE_DIR);
  const state = store.getState();
  const fullPassages = store.getPassagesForRelease(RELEASE_ID);
  const nitiCases = parseNitiBenchTaxCases(store, 25);
  const allCases = [...SEALED_GATE_CASES, ...nitiCases];

  const diag = inspectReleaseProjectionDiagnostics(store, RELEASE_ID);
  const parityProbe = runTokenizerParityProbe(store, RELEASE_ID);
  const graphSnap = loadGraphProjectionSnapshot(store, RELEASE_ID);
  const graphEdges = (graphSnap?.edges || []).map((e) => ({
    subject: e.subject,
    predicate: e.predicate,
    object: e.object,
  }));

  fs.mkdirSync(REPO_DOCS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPO_DOCS_DIR, "tokenizer_parity_probe_local.json"),
    JSON.stringify(parityProbe, null, 2),
    "utf8"
  );

  // =========================================================================
  // 1. CONSTRUCT 100% LABEL-INDEPENDENT, QUERY-INDEPENDENT FROZEN CORPUS
  //    ZERO reference to `expected_work_ids` or `allCases`!
  // =========================================================================
  const frozenBlindPassages = fullPassages.filter((p) => {
    const w = state.works[p.work_id];
    if (!w) return false;
    if (w.type === "Statute" || w.type === "ProvisionVersion" || w.type === "SubordinateLegislation") {
      return true;
    }
    if (w.type === "TaxRuling") {
      const v = state.versions[p.version_id];
      return Boolean(v?.decision_date && v.decision_date >= "2024-01-01");
    }
    return false;
  });
  const frozenBlindWorkIds = new Set(frozenBlindPassages.map((p) => p.work_id));
  const fullCorpusWorkIds = new Set(fullPassages.map((p) => p.work_id));

  console.log(`\n=== FROZEN BLIND CORPUS V1 (100% metadata-defined, ZERO labels/queries) ===`);
  console.log({
    full_rc7_passages: fullPassages.length,
    frozen_blind_passages: frozenBlindPassages.length,
    frozen_blind_rule:
      "work.type IN (Statute, ProvisionVersion, SubordinateLegislation) OR (work.type == TaxRuling AND decision_date >= 2024-01-01)",
    sealed_cases_total: SEALED_GATE_CASES.length,
    sealed_cases_covered_in_frozen: SEALED_GATE_CASES.filter((c) =>
      c.expected_work_ids.every((wid) => frozenBlindWorkIds.has(wid))
    ).length,
    nitibench_cases_total: nitiCases.length,
    nitibench_cases_covered_in_frozen: nitiCases.filter((c) =>
      c.expected_work_ids.every((wid) => frozenBlindWorkIds.has(wid))
    ).length,
  });

  // =========================================================================
  // 2. RUN HASH-VALIDATED PYTHON CHALLENGERS ON FROZEN BLIND CORPUS (1,924p)
  //    AND PYTHAINLP ON FULL CORPUS (11,786p)
  // =========================================================================
  const frozenPyOut = runPythonHashValidated({
    passages: frozenBlindPassages,
    queries: allCases,
    store,
    cacheName: "frozen_v1_1924p",
    skipBge: false,
    skipLatte: false,
  });

  const fullPyOut = runPythonHashValidated({
    passages: fullPassages,
    queries: allCases,
    store,
    cacheName: "full_rc7_11786p_pythainlp",
    skipBge: true,
    skipLatte: true,
  });

  // Build TS tokenized maps for BOTH frozen (1,924p) and full (11,786p) using the EXACT SAME live TS tokenizer
  const tsTokForPassage = (p: Passage) => {
    const w = state.works[p.work_id];
    const titleRaw = `${w?.title_th || ""} ${p.contextualized_header || ""} ${(p.structural_path || []).join(" ")}`;
    return {
      title_tokens: tokenizeThaiLegalWithDictionary(titleRaw, { includeDuplicates: true, expandAbbreviations: true }),
      body_tokens: tokenizeThaiLegalWithDictionary(p.exact_text, { includeDuplicates: true, expandAbbreviations: true }),
    };
  };
  const tsFrozenToks: Record<string, { title_tokens: string[]; body_tokens: string[] }> = {};
  for (const p of frozenBlindPassages) tsFrozenToks[p.passage_id] = tsTokForPassage(p);

  const idxFrozenTs = buildInMemoryFieldedBm25(store, frozenBlindPassages, tsFrozenToks);
  const idxFrozenPythai = buildInMemoryFieldedBm25(store, frozenBlindPassages, frozenPyOut.pythainlp_passages);
  const idxFrozenLatte = buildInMemoryFieldedBm25(store, frozenBlindPassages, frozenPyOut.latte_passages);
  const idxFullPythai = buildInMemoryFieldedBm25(store, fullPassages, fullPyOut.pythainlp_passages);

  // =========================================================================
  // 3. EVALUATE ALL 6 BLIND ARMS ON FROZEN CORPUS (1,924p) + FULL CORPUS ARMS
  // =========================================================================
  type FrozenArmKey =
    | "F1_TS_CONSISTENT"
    | "F2_PYTHAINLP_CONSISTENT"
    | "F3_LATTE_CONSISTENT"
    | "F4_TS_PLUS_BGEM3"
    | "F5_TS_PLUS_GRAPH"
    | "F6_TS_PLUS_BOTH";
  type FullArmKey = "FULL_TS_PROD" | "FULL_PYTHAINLP_CONSISTENT" | "FULL_TS_PLUS_GRAPH_PROD";

  const frozenArmKeys: FrozenArmKey[] = [
    "F1_TS_CONSISTENT",
    "F2_PYTHAINLP_CONSISTENT",
    "F3_LATTE_CONSISTENT",
    "F4_TS_PLUS_BGEM3",
    "F5_TS_PLUS_GRAPH",
    "F6_TS_PLUS_BOTH",
  ];
  const fullArmKeys: FullArmKey[] = [
    "FULL_TS_PROD",
    "FULL_PYTHAINLP_CONSISTENT",
    "FULL_TS_PLUS_GRAPH_PROD",
  ];

  const perCaseRecords: any[] = [];
  const latenciesFrozen: Record<FrozenArmKey, number[]> = {
    F1_TS_CONSISTENT: [],
    F2_PYTHAINLP_CONSISTENT: [],
    F3_LATTE_CONSISTENT: [],
    F4_TS_PLUS_BGEM3: [],
    F5_TS_PLUS_GRAPH: [],
    F6_TS_PLUS_BOTH: [],
  };
  const latenciesFull: Record<FullArmKey, number[]> = {
    FULL_TS_PROD: [],
    FULL_PYTHAINLP_CONSISTENT: [],
    FULL_TS_PLUS_GRAPH_PROD: [],
  };

  for (const c of allCases) {
    const ids = extractExplicitIdentifiersFromQuery(c.question);
    const ledger = buildStructuredCaseFactLedger({
      question: c.question,
      applicableDate: c.applicable_date,
      conversationHistory: [],
    });
    const analysis = analyzeLegalIssuesAndFacts({
      question: c.question,
      applicableDate: c.applicable_date,
      mode: "standard",
      explicitRulingIds: ids.rulingIds,
      conversationHistory: [],
      state,
    });

    const tsQToks = tokenizeThaiLegalWithDictionary(c.question, {
      includeDuplicates: false,
      expandAbbreviations: true,
    });
    const pythaiQToks: string[] = frozenPyOut.pythainlp_queries[c.case_id] || [];
    const latteQToks: string[] = frozenPyOut.latte_queries[c.case_id] || [];
    const bgeList: Array<{ passage_id: string; work_id: string; cosine: number }> =
      frozenPyOut.bge_top_by_case[c.case_id] || [];
    const bgeMap = new Map(bgeList.map((x) => [x.passage_id, x.cosine]));

    const frozenOut: Record<FrozenArmKey, ArmQueryOutput> = {
      F1_TS_CONSISTENT: runInMemoryBlindArm({
        store,
        index: idxFrozenTs,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: tsQToks,
        controllingWorkIds: analysis.controllingWorkIds,
      }),
      F2_PYTHAINLP_CONSISTENT: runInMemoryBlindArm({
        store,
        index: idxFrozenPythai,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: pythaiQToks,
        controllingWorkIds: analysis.controllingWorkIds,
        extraQueryLatencyMs: frozenPyOut.pythainlp_meta?.query_p95_ms || 0,
      }),
      F3_LATTE_CONSISTENT: runInMemoryBlindArm({
        store,
        index: idxFrozenLatte,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: latteQToks,
        controllingWorkIds: analysis.controllingWorkIds,
        extraQueryLatencyMs: frozenPyOut.latte_meta?.query_p95_ms || 0,
      }),
      F4_TS_PLUS_BGEM3: runInMemoryBlindArm({
        store,
        index: idxFrozenTs,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: tsQToks,
        controllingWorkIds: analysis.controllingWorkIds,
        bgeCosineByPid: bgeMap,
        extraQueryLatencyMs: frozenPyOut.bge_m3_meta?.query_embed_p95_ms || 0,
      }),
      F5_TS_PLUS_GRAPH: runInMemoryBlindArm({
        store,
        index: idxFrozenTs,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: tsQToks,
        controllingWorkIds: analysis.controllingWorkIds,
        useVerifiedGraph: true,
        graphEdges,
      }),
      F6_TS_PLUS_BOTH: runInMemoryBlindArm({
        store,
        index: idxFrozenTs,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: tsQToks,
        controllingWorkIds: analysis.controllingWorkIds,
        bgeCosineByPid: bgeMap,
        useVerifiedGraph: true,
        graphEdges,
        extraQueryLatencyMs: frozenPyOut.bge_m3_meta?.query_embed_p95_ms || 0,
      }),
    };

    // Full-corpus production TS arms (calling real live `retrieveAuthorizedKnowledge`!)
    const tProd1 = performance.now();
    const prodLexBundle = retrieveAuthorizedKnowledge(store, {
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
    const prodLexMs = performance.now() - tProd1;

    const tProd3 = performance.now();
    const prodGraphBundle = retrieveAuthorizedKnowledge(store, {
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
    const prodGraphMs = performance.now() - tProd3;

    const bundleToOut = (b: typeof prodLexBundle, ms: number): ArmQueryOutput => {
      const seen = new Set<string>();
      const works: string[] = [];
      for (const h of b.top_hits) {
        if (!seen.has(h.passage.work_id)) {
          seen.add(h.passage.work_id);
          works.push(h.passage.work_id);
        }
      }
      return {
        ranked_work_ids: works,
        ranked_hits: b.top_hits.map((h) => ({
          passage_id: h.passage.passage_id,
          work_id: h.passage.work_id,
          version_id: h.passage.version_id,
          score: h.score,
        })),
        unresolved_rulings: b.unresolved_explicit_ruling_ids,
        elapsed_ms: Number(ms.toFixed(2)),
      };
    };

    const fullOut: Record<FullArmKey, ArmQueryOutput> = {
      FULL_TS_PROD: bundleToOut(prodLexBundle, prodLexMs),
      FULL_PYTHAINLP_CONSISTENT: runInMemoryBlindArm({
        store,
        index: idxFullPythai,
        question: c.question,
        applicableDate: c.applicable_date,
        queryTokens: fullPyOut.pythainlp_queries[c.case_id] || [],
        controllingWorkIds: analysis.controllingWorkIds,
        extraQueryLatencyMs: fullPyOut.pythainlp_meta?.query_p95_ms || 0,
      }),
      FULL_TS_PLUS_GRAPH_PROD: bundleToOut(prodGraphBundle, prodGraphMs),
    };

    // Actual final evidence packet delivered to Gemini Neon (from production full-corpus TS+Graph)
    const finalPack = buildGroundedPassagePack({
      passages: prodGraphBundle.top_hits.map((h) => h.passage),
      state,
      controllingDateIso: ledger.temporal_facts.controlling_tax_point.iso_date || c.applicable_date,
      maxPassages: 24,
    });
    const packetWorkIds = Array.from(new Set(finalPack.map((p) => p.work_id)));
    const packetPass = c.expect_unresolved_ruling
      ? prodGraphBundle.unresolved_explicit_ruling_ids.some((u) => u.includes("99999"))
      : c.expected_work_ids.every((wid) => packetWorkIds.includes(wid));

    const frozenScores: Record<string, any> = {};
    for (const k of frozenArmKeys) {
      latenciesFrozen[k].push(frozenOut[k].elapsed_ms);
      frozenScores[k] = {
        ...scoreBlindResult(c, frozenOut[k], frozenBlindWorkIds),
        top5_works: frozenOut[k].ranked_work_ids.slice(0, 5),
        elapsed_ms: frozenOut[k].elapsed_ms,
      };
    }
    const fullScores: Record<string, any> = {};
    for (const k of fullArmKeys) {
      latenciesFull[k].push(fullOut[k].elapsed_ms);
      fullScores[k] = {
        ...scoreBlindResult(c, fullOut[k], fullCorpusWorkIds),
        top5_works: fullOut[k].ranked_work_ids.slice(0, 5),
        elapsed_ms: fullOut[k].elapsed_ms,
      };
    }

    // Pure BGE-M3 dense-only rank (diagnostic)
    const pureBgeWorks: string[] = [];
    for (const x of bgeList) if (!pureBgeWorks.includes(x.work_id)) pureBgeWorks.push(x.work_id);
    const pureBgeRanks: Record<string, number | null> = {};
    for (const wid of c.expected_work_ids) {
      const idx = pureBgeWorks.indexOf(wid);
      pureBgeRanks[wid] = idx >= 0 ? idx + 1 : null;
    }

    // 4-stage root cause diagnosis (Coverage -> Eligibility -> Ranking -> Packet Assembly)
    const expectedCoverageFull = c.expected_work_ids.map((wid) => ({
      work_id: wid,
      indexed_in_rc7: fullCorpusWorkIds.has(wid),
      indexed_in_frozen_blind: frozenBlindWorkIds.has(wid),
      eligible_after_filters: fullPassages.some(
        (p) => p.work_id === wid && isPassageEligibleForDate(store, p, c.applicable_date, new Set())
      ),
      in_prod_top24: fullOut.FULL_TS_PLUS_GRAPH_PROD.ranked_work_ids.includes(wid),
      in_final_packet: packetWorkIds.includes(wid),
    }));

    let rootCauseStage = "NONE";
    if (!c.expect_unresolved_ruling) {
      if (expectedCoverageFull.some((x) => !x.indexed_in_rc7)) {
        rootCauseStage = "COVERAGE";
      } else if (expectedCoverageFull.some((x) => !x.eligible_after_filters)) {
        rootCauseStage = "ELIGIBILITY";
      } else if (!fullScores.FULL_TS_PLUS_GRAPH_PROD.all_required_hit_at_5) {
        rootCauseStage = "RANKING";
      } else if (!packetPass) {
        rootCauseStage = "PACKET_ASSEMBLY";
      }
    } else if (!packetPass) {
      rootCauseStage = "EXACT_LOOKUP_ABSTENTION";
    }

    perCaseRecords.push({
      case_id: c.case_id,
      suite: c.suite,
      category: c.category,
      applicable_date: c.applicable_date,
      question_preview: c.question.slice(0, 140),
      expected_work_ids: c.expected_work_ids,
      covered_in_frozen_blind_corpus: c.expected_work_ids.every((wid) => frozenBlindWorkIds.has(wid)),
      frozen_blind_arms: frozenScores,
      full_rc7_arms: fullScores,
      pure_bge_m3_ranks: pureBgeRanks,
      final_answer_packet: {
        passage_count: finalPack.length,
        work_ids: packetWorkIds,
        all_expected_delivered: packetPass,
      },
      stage_trace: expectedCoverageFull,
      root_cause_stage: rootCauseStage,
    });
  }

  const summarizeSuite = (
    suite: "SEALED_GATE" | "NITIBENCH_TAX_SUPPLEMENT",
    mode: "frozen" | "full"
  ) => {
    const rows = perCaseRecords.filter((r) => r.suite === suite);
    const coveredRows =
      mode === "frozen" ? rows.filter((r) => r.covered_in_frozen_blind_corpus) : rows;
    const keys = mode === "frozen" ? frozenArmKeys : fullArmKeys;
    const out: Record<string, any> = {
      total_cases: rows.length,
      in_corpus_cases: coveredRows.length,
      excluded_out_of_slice_cases: rows
        .filter((r) => mode === "frozen" && !r.covered_in_frozen_blind_corpus)
        .map((r) => r.case_id),
    };
    for (const k of keys) {
      const armRows = coveredRows.map((r) =>
        mode === "frozen" ? r.frozen_blind_arms[k] : r.full_rc7_arms[k]
      );
      const allHit = armRows.filter((x) => x.all_required_hit_at_5).length;
      const anyHit = armRows.filter((x) => x.any_hit_at_5).length;
      const wrongVer = armRows.filter((x) => x.wrong_version_substitution).length;
      const falseM = armRows.filter((x) => x.false_match).length;
      const lats = armRows.map((x) => x.elapsed_ms);
      out[k] = {
        all_required_hit_at_5: `${allHit}/${coveredRows.length} (${((allHit / Math.max(1, coveredRows.length)) * 100).toFixed(1)}%)`,
        any_hit_at_5: `${anyHit}/${coveredRows.length} (${((anyHit / Math.max(1, coveredRows.length)) * 100).toFixed(1)}%)`,
        wrong_version_substitutions: wrongVer,
        false_matches: falseM,
        p95_latency_ms: percentile(lats, 95),
      };
    }
    return out;
  };

  // Representative NitiBench-Tax misses diagnosis (first 6 misses with full stage breakdown)
  const nitiMisses = perCaseRecords
    .filter((r) => r.suite === "NITIBENCH_TAX_SUPPLEMENT" && r.root_cause_stage !== "NONE")
    .slice(0, 6)
    .map((r) => ({
      case_id: r.case_id,
      question_preview: r.question_preview,
      expected_work_ids: r.expected_work_ids,
      root_cause_stage: r.root_cause_stage,
      stage_trace: r.stage_trace,
      full_ts_top5: r.full_rc7_arms.FULL_TS_PLUS_GRAPH_PROD.top5_works,
      full_ts_ranks: r.full_rc7_arms.FULL_TS_PLUS_GRAPH_PROD.ranks_by_expected,
      frozen_ts_ranks: r.frozen_blind_arms.F1_TS_CONSISTENT.ranks_by_expected,
      frozen_pythainlp_ranks: r.frozen_blind_arms.F2_PYTHAINLP_CONSISTENT.ranks_by_expected,
      frozen_latte_ranks: r.frozen_blind_arms.F3_LATTE_CONSISTENT.ranks_by_expected,
      frozen_bge_m3_fusion_ranks: r.frozen_blind_arms.F4_TS_PLUS_BGEM3.ranks_by_expected,
      pure_bge_m3_ranks: r.pure_bge_m3_ranks,
      frozen_ts_top5: r.frozen_blind_arms.F1_TS_CONSISTENT.top5_works,
      frozen_bge_m3_top5: r.frozen_blind_arms.F4_TS_PLUS_BGEM3.top5_works,
    }));

  const receipt = {
    schema_version: "2.0-strictly-blind",
    generated_at: new Date().toISOString(),
    release_id: RELEASE_ID,
    manifest_id: diag.manifest_id,
    manifest_hash: diag.manifest_hash,
    anti_leakage_attestation: {
      expected_ids_in_corpus_builder: false,
      queries_in_corpus_builder: false,
      mixed_engine_tokenizer_prohibited: true,
      cache_hash_validated: true,
      frozen_blind_corpus_rule:
        "work.type IN (Statute, ProvisionVersion, SubordinateLegislation) OR (work.type == TaxRuling AND decision_date >= 2024-01-01)",
      frozen_blind_corpus_passage_count: frozenBlindPassages.length,
      frozen_blind_corpus_sha256: frozenPyOut.corpus_slice_sha256,
      full_rc7_corpus_passage_count: fullPassages.length,
      full_rc7_corpus_sha256: fullPyOut.corpus_slice_sha256,
      queries_sha256: frozenPyOut.queries_sha256,
    },
    tokenizer_parity_probe_local: {
      runtime_platform: parityProbe.runtime_platform,
      node_version: parityProbe.node_version,
      icu_version: parityProbe.icu_version,
      tokenizer_engine: parityProbe.live_tokenizer_engine,
      tokenizer_contract_sha256: parityProbe.live_tokenizer_contract_sha256,
      legal_dictionary_sha256: parityProbe.live_legal_dictionary_sha256,
      lexical_index_sha256: parityProbe.lexical_index_sha256,
      lexical_disk_file_sha256: parityProbe.lexical_disk_file_sha256,
      contract_parity_ok: parityProbe.contract_parity_ok,
      all_probes_ok: parityProbe.all_probes_ok,
    },
    challenger_runtimes: {
      pythainlp_frozen: frozenPyOut.pythainlp_meta,
      pythainlp_full: fullPyOut.pythainlp_meta,
      latte_frozen: frozenPyOut.latte_meta,
      bge_m3_frozen: frozenPyOut.bge_m3_meta,
    },
    summaries: {
      sealed_gate_frozen_blind_1924p: summarizeSuite("SEALED_GATE", "frozen"),
      sealed_gate_full_rc7_11786p: summarizeSuite("SEALED_GATE", "full"),
      nitibench_tax_frozen_blind_1924p: summarizeSuite("NITIBENCH_TAX_SUPPLEMENT", "frozen"),
      nitibench_tax_full_rc7_11786p: summarizeSuite("NITIBENCH_TAX_SUPPLEMENT", "full"),
    },
    nitibench_representative_misses_diagnosis: nitiMisses,
    per_case_trace: perCaseRecords,
  };

  const repoOutPath = path.join(REPO_DOCS_DIR, "blind_retrieval_ablation_receipt.json");
  fs.writeFileSync(repoOutPath, JSON.stringify(receipt, null, 2), "utf8");

  console.log("\n=== SEALED GATE — FROZEN BLIND CORPUS (1,924p, ALL 6 ARMS, ZERO LABEL LEAKAGE) ===");
  console.log(JSON.stringify(receipt.summaries.sealed_gate_frozen_blind_1924p, null, 2));
  console.log("\n=== SEALED GATE — FULL RC7 CORPUS (11,786p, ZERO SUBSAMPLING) ===");
  console.log(JSON.stringify(receipt.summaries.sealed_gate_full_rc7_11786p, null, 2));
  console.log("\n=== NITIBENCH-TAX — FROZEN BLIND CORPUS (1,924p, ALL 6 ARMS) ===");
  console.log(JSON.stringify(receipt.summaries.nitibench_tax_frozen_blind_1924p, null, 2));
  console.log("\n=== NITIBENCH-TAX — FULL RC7 CORPUS (11,786p) ===");
  console.log(JSON.stringify(receipt.summaries.nitibench_tax_full_rc7_11786p, null, 2));
  console.log("\n=== NITIBENCH-TAX REPRESENTATIVE MISSES (6 CASES, 4-STAGE DIAGNOSIS) ===");
  console.log(JSON.stringify(nitiMisses, null, 2));
  console.log(`\nSaved portable repo receipt to: ${repoOutPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
