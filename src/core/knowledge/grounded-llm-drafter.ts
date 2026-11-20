/**
 * REG24 — Grounded LLM Legal Application Drafter (Requirements 1.2, 1.3 & 2)
 *
 * Replaces prewritten legal-conclusion templates behind a staging-only flag by invoking
 * a real generative provider (Google Gemini via the official `@google/genai` Interactions API)
 * grounded strictly on:
 *   1. The structured Case Fact Ledger (`StructuredCaseFactLedger`)
 *   2. Exact official passages retrieved (or supplied in controlled comparisons) with full
 *      instrument, provision, version, authority tier, effective dates, and pinpoint metadata.
 *
 * Guarantees:
 * - Zero prewritten legal conclusion fallback if the model is unavailable or fails verification.
 * - Full auditable provider invocation metadata (actual model, interaction ID, prompt version,
 *   token usage, latency, estimated cost, and attempt log).
 */

import { GoogleGenAI } from "@google/genai";
import type { StructuredCaseFactLedger } from "./case-fact-ledger";
import {
  isNavigationOrBoilerplatePassageText,
  resolveVerifiedOfficialUrlForDoc,
} from "./claim-traceability-engine";
import type { Passage } from "./contracts";
import type { CanonicalPersistedState } from "./store";

export const GROUNDED_LLM_PROMPT_VERSION = "reg24-grounded-llm-legal-application-v1.0";

export type AuthorityHierarchyTier =
  | "CONTROLLING_STATUTE"
  | "CONTROLLING_SUBORDINATE_LEGISLATION"
  | "OFFICIAL_GUIDANCE"
  | "CASE_SPECIFIC_TAX_RULING";

export interface GroundedPassagePackItem {
  passage_id: string;
  work_id: string;
  version_id: string;
  official_identifier: string;
  title_th: string;
  source_type: string;
  authority_tier: AuthorityHierarchyTier;
  effective_dates: {
    valid_from: string | null;
    valid_to: string | null;
    decision_date: string | null;
    publication_date: string | null;
    raw_date_text: string | null;
    temporal_applicability_hint: "IN_WINDOW" | "OUT_OF_WINDOW" | "NO_FIXED_END_DATE" | "DATE_UNKNOWN";
  };
  pinpoint: string;
  official_url: string | null;
  representation_kind: "official_scan_pdf" | "verified_official_transcript";
  verbatim_text: string;
}

export interface LlmProposedCalculation {
  formula_description_th: string;
  tax_base_thb: number | null;
  exempt_amount_thb: number | null;
  taxable_amount_thb: number | null;
  rate_pct: number | null;
  computed_tax_thb: number | null;
  is_computable_from_stated_facts: boolean;
  missing_inputs_th: string[];
  steps_th: string[];
}

export interface LlmDraftedIssue {
  issue_id: string;
  issue_title_th: string;
  party_or_scope_th: string;
  conclusion_th: string;
  material_facts_relied_on: string[];
  governing_passage_ids: string[];
  application_explanation_th: string;
  authority_distinction_note_th: string;
  proposed_calculation: LlmProposedCalculation | null;
  missing_facts_or_uncertainties_th: string[];
}

export interface GroundedLlmDraftResponse {
  answer_status: "ANSWERED" | "CONDITIONAL" | "NEEDS_CLARIFICATION" | "INSUFFICIENT_EVIDENCE";
  overall_summary_th: string;
  case_facts_used: Array<{
    fact_label_th: string;
    original_fact_th: string;
    source_turn: number;
    legal_significance_th: string;
  }>;
  issues: LlmDraftedIssue[];
  assumptions_th: string[];
  clarification_questions_th: string[];
  evidence_gaps_th: string[];
}

export interface ProviderAttemptRecord {
  model: string;
  status: "succeeded" | "error";
  http_status?: number | null;
  latency_ms: number;
  error_message?: string | null;
}

export interface ProviderInvocationAudit {
  provider: "google-gemini";
  api_surface: "interactions-v1beta";
  requested_model: string;
  actual_model_invoked: string | null;
  prompt_version: string;
  live_provider_called: boolean;
  provider_interaction_id: string | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  attempts: ProviderAttemptRecord[];
  error_summary: string | null;
}

const KNOWN_DECREE_WINDOWS: Record<string, { valid_from: string; valid_to: string }> = {
  "subreg.th.rc.royal_decree.799": { valid_from: "2025-10-01", valid_to: "2026-09-30" },
  "subreg.th.rc.royal_decree.807": { valid_from: "2026-10-01", valid_to: "2027-09-30" },
};

const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-4-argon": { input: 1.25, output: 10.0 },
};

function classifyAuthorityTier(workType: string | undefined, workId: string): AuthorityHierarchyTier {
  if (workType === "TaxRuling") return "CASE_SPECIFIC_TAX_RULING";
  if (workType === "Guidance" || workId.includes(".guide.") || workId.includes("tax_guide")) {
    return "OFFICIAL_GUIDANCE";
  }
  if (
    workType === "SubordinateLegislation" ||
    workId.startsWith("subreg.") ||
    workId.includes("royal_decree") ||
    workId.includes("dg_vat") ||
    workId.includes("min_reg")
  ) {
    return "CONTROLLING_SUBORDINATE_LEGISLATION";
  }
  return "CONTROLLING_STATUTE";
}

function evaluateTemporalHint(
  validFrom: string | null,
  validTo: string | null,
  controllingDateIso: string | null
): GroundedPassagePackItem["effective_dates"]["temporal_applicability_hint"] {
  if (!controllingDateIso) return "DATE_UNKNOWN";
  if (!validFrom && !validTo) return "NO_FIXED_END_DATE";
  if (validFrom && controllingDateIso < validFrom) return "OUT_OF_WINDOW";
  if (validTo && controllingDateIso > validTo) return "OUT_OF_WINDOW";
  return validTo ? "IN_WINDOW" : "NO_FIXED_END_DATE";
}

export function buildGroundedPassagePack(params: {
  passages: Passage[];
  state: CanonicalPersistedState;
  controllingDateIso: string | null;
  maxPassages?: number;
}): GroundedPassagePackItem[] {
  const maxPassages = params.maxPassages ?? 28;
  const seen = new Set<string>();
  const out: GroundedPassagePackItem[] = [];

  for (const p of params.passages) {
    if (seen.has(p.passage_id)) continue;
    if (p.extraction_id.startsWith("ext.dep.")) continue;
    if (isNavigationOrBoilerplatePassageText(p.exact_text)) continue;
    seen.add(p.passage_id);

    const work = params.state.works[p.work_id];
    const ver = params.state.versions[p.version_id];
    const art = params.state.artifacts[p.real_locator.artifact_id];

    const knownWindow = KNOWN_DECREE_WINDOWS[p.work_id];
    const validFrom = knownWindow?.valid_from || ver?.legal_applicability?.[0]?.valid_from || null;
    const validTo = knownWindow?.valid_to || ver?.legal_applicability?.[0]?.valid_to || null;
    const resolvedUrl =
      resolveVerifiedOfficialUrlForDoc(p.work_id, p.real_locator.origin_uri) || null;
    const isPdf =
      Boolean(resolvedUrl && /\.pdf(?:$|\?)/i.test(resolvedUrl)) ||
      art?.MIME === "application/pdf";

    out.push({
      passage_id: p.passage_id,
      work_id: p.work_id,
      version_id: p.version_id,
      official_identifier:
        work?.official_identifiers[0]?.normalized || work?.title_th || p.work_id,
      title_th: work?.title_th || p.contextualized_header || p.work_id,
      source_type: work?.type || "Statute",
      authority_tier: classifyAuthorityTier(work?.type, p.work_id),
      effective_dates: {
        valid_from: validFrom,
        valid_to: validTo,
        decision_date: ver?.decision_date || null,
        publication_date: ver?.publication_date || null,
        raw_date_text: ver?.raw_date_text || null,
        temporal_applicability_hint: evaluateTemporalHint(
          validFrom,
          validTo,
          params.controllingDateIso
        ),
      },
      pinpoint:
        p.structural_path.filter(Boolean).join(" > ") ||
        p.contextualized_header ||
        p.passage_id,
      official_url: resolvedUrl,
      representation_kind: isPdf ? "official_scan_pdf" : "verified_official_transcript",
      verbatim_text: p.exact_text.slice(0, 1500),
    });

    if (out.length >= maxPassages) break;
  }

  return out;
}

const GROUNDED_LLM_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answer_status: {
      type: "string",
      enum: ["ANSWERED", "CONDITIONAL", "NEEDS_CLARIFICATION", "INSUFFICIENT_EVIDENCE"],
    },
    overall_summary_th: { type: "string" },
    case_facts_used: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fact_label_th: { type: "string" },
          original_fact_th: { type: "string" },
          source_turn: { type: "integer" },
          legal_significance_th: { type: "string" },
        },
        required: ["fact_label_th", "original_fact_th", "source_turn", "legal_significance_th"],
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue_id: { type: "string" },
          issue_title_th: { type: "string" },
          party_or_scope_th: { type: "string" },
          conclusion_th: { type: "string" },
          material_facts_relied_on: { type: "array", items: { type: "string" } },
          governing_passage_ids: { type: "array", items: { type: "string" } },
          application_explanation_th: { type: "string" },
          authority_distinction_note_th: { type: "string" },
          proposed_calculation: {
            type: ["object", "null"],
            properties: {
              formula_description_th: { type: "string" },
              tax_base_thb: { type: ["number", "null"] },
              exempt_amount_thb: { type: ["number", "null"] },
              taxable_amount_thb: { type: ["number", "null"] },
              rate_pct: { type: ["number", "null"] },
              computed_tax_thb: { type: ["number", "null"] },
              is_computable_from_stated_facts: { type: "boolean" },
              missing_inputs_th: { type: "array", items: { type: "string" } },
              steps_th: { type: "array", items: { type: "string" } },
            },
            required: [
              "formula_description_th",
              "tax_base_thb",
              "exempt_amount_thb",
              "taxable_amount_thb",
              "rate_pct",
              "computed_tax_thb",
              "is_computable_from_stated_facts",
              "missing_inputs_th",
              "steps_th",
            ],
          },
          missing_facts_or_uncertainties_th: { type: "array", items: { type: "string" } },
        },
        required: [
          "issue_id",
          "issue_title_th",
          "party_or_scope_th",
          "conclusion_th",
          "material_facts_relied_on",
          "governing_passage_ids",
          "application_explanation_th",
          "authority_distinction_note_th",
          "proposed_calculation",
          "missing_facts_or_uncertainties_th",
        ],
      },
    },
    assumptions_th: { type: "array", items: { type: "string" } },
    clarification_questions_th: { type: "array", items: { type: "string" } },
    evidence_gaps_th: { type: "array", items: { type: "string" } },
  },
  required: [
    "answer_status",
    "overall_summary_th",
    "case_facts_used",
    "issues",
    "assumptions_th",
    "clarification_questions_th",
    "evidence_gaps_th",
  ],
};

const GROUNDED_SYSTEM_INSTRUCTION = `คุณคือทนายความและผู้เชี่ยวชาญกฎหมายภาษีอากรไทยของระบบ REG24 มีหน้าที่วิเคราะห์และปรับใช้บทบัญญัติกฎหมายกับข้อเท็จจริงของผู้ใช้อย่างเคร่งครัดตามหลักฐานต้นฉบับที่ได้รับเท่านั้น (Grounded Legal Application)

กฎบังคับเด็ดขาด (ห้ามฝ่าฝืน):
1. คงข้อเท็จจริงต้นฉบับของผู้ใช้ไว้ทุกประการ:
   - ห้ามเปลี่ยนชื่อทรัพย์สินหรือคู่กรณีให้เพี้ยนจากคำถาม เช่น หากผู้ใช้ถามเรื่อง "ห้องชุด" ให้ระบุว่าเป็น "ห้องชุด (ซึ่งจัดเป็นอสังหาริมทรัพย์)" ห้ามเปลี่ยนเป็น "ที่ดิน" โดยพลการ หากผู้ใช้ระบุ "หลานชาย (บุตรชายของน้องสาว)" ห้ามเปลี่ยนเป็น "หลานสาว"
   - หากมีหลายเทิร์น ให้ยึดข้อเท็จจริงที่อัปเดตล่าสุดจากเทิร์นหลังทับค่าที่เปลี่ยนไป และคงข้อเท็จจริงเดิมที่ไม่ได้เปลี่ยนไว้
   - แยกแยะวันทำธุรกรรม (transaction date), วันที่อ้างอิงกฎหมาย (legal as-of date) และวันเกิดความรับผิดทางภาษี (controlling tax point เช่น มาตรา 78/1 (1) สำหรับบริการ) ให้ชัดเจน ห้ามสมมติวันที่เองเมื่อวันที่ขาดหายหรือคลุมเครือ
2. อ้างอิงเฉพาะ passage_id ที่มีอยู่จริงใน PASSAGE_PACK ที่ส่งให้เท่านั้น:
   - ห้ามประดิษฐ์เลขมาตรา อนุมาตรา เลขพระราชกฤษฎีกา หรือเลขหนังสือตอบข้อหารือ กค ที่ไม่ปรากฏตรงตัวในข้อความของ PASSAGE_PACK (ตรวจสอบเลขอนุมาตราให้ตรงกับ verbatim_text ของ passage ที่อ้างอิงทุกครั้ง และหากกล่าวถึงอัตรารวมภาษีท้องถิ่นร้อยละ 7 ให้ระบุ passage_id ของคู่มือ/คำแนะนำทางการเรื่องภาษีท้องถิ่นใน governing_passage_ids ด้วย)
   - ตรวจสอบช่วงเวลาใช้บังคับ (valid_from / valid_to) ของทุกกฎหมายลำดับรองและพระราชกฤษฎีกาเทียบกับวันเกิดความรับผิดทางภาษี ห้ามนำพระราชกฤษฎีกาที่อยู่นอกช่วงวันใช้บังคับ (temporal_applicability_hint = "OUT_OF_WINDOW") มาใช้เป็นกฎหมายควบคุมสำหรับธุรกรรมนั้น และห้ามเหมารวมใช้ฉบับล่าสุดเมื่อไม่มีวันที่หรือวันที่อยู่นอกช่วง
   - แยกแยะลำดับศักดิ์แหล่งอ้างอิงอย่างชัดเจน: กฎหมายแม่บท/ประมวลรัษฎากร (CONTROLLING_STATUTE), กฎหมายลำดับรอง/พระราชกฤษฎีกา/ประกาศอธิบดี (CONTROLLING_SUBORDINATE_LEGISLATION), คู่มือ/คำแนะนำ (OFFICIAL_GUIDANCE) และหนังสือตอบข้อหารือเฉพาะราย (CASE_SPECIFIC_TAX_RULING ซึ่งผูกพันเฉพาะข้อเท็จจริงและกฎหมาย ณ เวลาที่วินิจฉัย — หากเป็นข้อหารือก่อนการแก้ไขกฎหมาย พ.ศ. 2558 ให้ระบุข้อจำกัดดังกล่าวอย่างตรงไปตรงมา)
   - ห้ามนำหนังสือตอบข้อหารือที่ไม่ตรงประเภทธุรกรรม (เช่น ข้อหารือส่งออกสินค้า/รองเท้า หรือเงินชดเชยเลิกจ้าง) มาใช้ตอบแทนหลักกฎหมาย
3. แยกวิเคราะห์แต่ละประเด็นและภาระภาษีของแต่ละฝ่ายให้ครบถ้วน:
   - สำหรับการโอนอสังหาริมทรัพย์โดยไม่มีค่าตอบแทน (เช่น ห้องชุด/ที่ดิน) ให้แยกประเด็นอย่างชัดเจนเสมอระหว่าง:
     (ก) ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายในวันจดทะเบียนของผู้โอน (มาตรา 41 ทวิ, มาตรา 49 ทวิ ที่ใช้ราคาประเมินทุนทรัพย์ของทางราชการมิใช่ราคาตามสัญญา, มาตรา 50 (5)/(6), และข้อยกเว้นมาตรา 42 (26) เฉพาะบุตรชอบด้วยกฎหมายเท่านั้น)
     (ข) ความรับผิดกรณีหักภาษี ณ ที่จ่ายขาดตามมาตรา 54 (หากมี)
     (ค) ภาระภาษีเงินได้บุคคลธรรมดาของผู้รับโอน (ตรวจสอบขอบเขตมาตรา 42 (27) เฉพาะบุพการี ผู้สืบสันดาน หรือคู่สมรส และมาตรา 42 (28) สำหรับการให้ตามหน้าที่ธรรมจรรยาหรือตามพิธี/โอกาสแห่งขนบธรรมเนียมประเพณี และแยกให้ชัดว่าเมื่อโอนอสังหาริมทรัพย์โดยเสน่หา กฎหมายถือว่าผู้โอนเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ พร้อมระบุประเด็นความเห็น/ข้อหารือหากปรากฏใน PASSAGE_PACK)
   - ห้ามสรุปตัวเลขภาษีที่คำนวณไม่ได้หากขาดข้อมูลสำคัญ (เช่น วิธีการได้มา ระยะเวลาถือครอง หรือราคาประเมินทุนทรัพย์ของทางราชการ) ให้ตั้งค่า is_computable_from_stated_facts = false, computed_tax_thb = null และระบุ missing_inputs_th ให้ชัดเจน
4. กรณีหลักฐานใน PASSAGE_PACK ครอบคลุมเพียงบางส่วน (เช่น ขาดตัวบทพระราชกฤษฎีการอบปีก่อนหน้า):
   - ให้ตอบส่วนที่มีหลักฐานรองรับอย่างแม่นยำ (เช่น มาตรา 80 แห่งประมวลรัษฎากร และระบุชัดว่าพระราชกฤษฎีกาฉบับที่ปรากฏในคลังไม่ครอบคลุมวันที่เกิดธุรกรรม) ตั้ง answer_status = "CONDITIONAL" หรือ "NEEDS_CLARIFICATION" และระบุช่องว่างหลักฐานใน evidence_gaps_th โดยห้ามเดาเลขพระราชกฤษฎีกาที่ไม่มีใน PASSAGE_PACK
5. เขียนคำตอบภาษาไทยที่เป็นมืออาชีพ กระชับ ชัดเจน นำบทบัญญัติมาปรับใช้กับข้อเท็จจริงโดยตรง ห้ามคัดลอกตัวบทกฎหมายทั้งดุ้นมาแปะแทนการวิเคราะห์
6. ส่งคืนเป็น JSON ที่ตรงตาม schema ที่กำหนดเท่านั้น`;

export function resolveConfiguredGeminiModels(): {
  requestedModel: string;
  candidateModels: string[];
  retiredDefaultNote: string | null;
} {
  const explicitStaging = (process.env.REG24_GROUNDED_LLM_MODEL || "").trim();
  const envBalanced = (process.env.GEMINI_BALANCED_MODEL || "").trim();
  const backupModel = (process.env.REG24_GROUNDED_LLM_BACKUP_MODEL || "gemini-3.5-flash").trim();

  let retiredDefaultNote: string | null = null;
  let primary = explicitStaging || envBalanced || "gemini-3.5-flash-lite";

  // Measured live evidence:
  // 1) Configured legacy Gemini 2.5/2.0/1.5 endpoints return HTTP 404 ("is no longer available to new users").
  // 2) gemini-3.8-flash currently returns HTTP 503 high-demand / >45s hangs on this API key;
  //    gemini-3.5-flash-lite responds in ~10-20s reliably with structured JSON (and REG24_GROUNDED_LLM_MODEL
  //    allows switching to gemini-3.8-flash or gemini-3.5-flash via staging env var with zero code changes).
  if (/^gemini-(?:1\.5|2\.0|2\.5)-/i.test(primary)) {
    retiredDefaultNote = `Configured legacy model '${primary}' returns HTTP 404 from Google Gemini API; upgraded to live Interactions API model 'gemini-3.5-flash-lite' (backup 'gemini-3.5-flash').`;
    primary = "gemini-3.5-flash-lite";
  }

  const candidates = [primary];
  if (backupModel && !candidates.includes(backupModel)) {
    candidates.push(backupModel);
  }
  return { requestedModel: primary, candidateModels: candidates, retiredDefaultNote };
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_PRICING_USD_PER_1M[model] || { input: 0.3, output: 2.5 };
  const cost = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  return Number(cost.toFixed(6));
}

function extractOutputTextFromInteraction(interaction: unknown): string {
  const obj = interaction as Record<string, unknown> | null;
  if (!obj) return "";
  if (typeof obj.output_text === "string" && obj.output_text.trim()) {
    return obj.output_text.trim();
  }
  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Record<string, unknown>;
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      const texts = step.content
        .map((c: Record<string, unknown>) => (typeof c?.text === "string" ? c.text : ""))
        .filter(Boolean);
      if (texts.length > 0) return texts.join("\n").trim();
    }
  }
  const outputs = Array.isArray(obj.outputs) ? obj.outputs : [];
  for (let i = outputs.length - 1; i >= 0; i--) {
    const out = outputs[i] as Record<string, unknown>;
    if (typeof out?.text === "string" && out.text.trim()) return out.text.trim();
  }
  return "";
}

export function buildGroundedLlmUserPrompt(params: {
  question: string;
  factLedger: StructuredCaseFactLedger;
  passagePack: GroundedPassagePackItem[];
}): string {
  const payload = {
    active_user_question: params.question,
    structured_case_fact_ledger: {
      turn_count: params.factLedger.turn_count,
      is_new_conversation: params.factLedger.is_new_conversation,
      user_turns: params.factLedger.user_turns.map((t) => ({
        turn_number: t.turn_number,
        raw_text: t.raw_text,
        explicit_applicable_date: t.explicit_applicable_date,
      })),
      material_facts: params.factLedger.material_facts,
      overrides: params.factLedger.overrides,
      temporal_facts: params.factLedger.temporal_facts,
      explicitly_unknown_facts_th: params.factLedger.explicitly_unknown_facts_th,
      questions_asked_th: params.factLedger.questions_asked_th,
    },
    PASSAGE_PACK: params.passagePack.map((p) => ({
      passage_id: p.passage_id,
      official_identifier: p.official_identifier,
      title_th: p.title_th,
      authority_tier: p.authority_tier,
      source_type: p.source_type,
      version_id: p.version_id,
      effective_dates: p.effective_dates,
      pinpoint: p.pinpoint,
      verbatim_text: p.verbatim_text,
    })),
  };

  return (
    "กรุณาวิเคราะห์คำถามทางกฎหมายภาษีอากรด้านล่างโดยยึดข้อเท็จจริงจาก `structured_case_fact_ledger` และอ้างอิงเฉพาะ `passage_id` จาก `PASSAGE_PACK` เท่านั้น:\n\n" +
    JSON.stringify(payload, null, 2)
  );
}

export async function draftGroundedLegalAnswerWithLlm(params: {
  question: string;
  factLedger: StructuredCaseFactLedger;
  passagePack: GroundedPassagePackItem[];
  overrideModel?: string;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  draft: GroundedLlmDraftResponse | null;
  invocation_audit: ProviderInvocationAudit;
  raw_output_text: string | null;
}> {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();

  const modelPlan = resolveConfiguredGeminiModels();
  const requestedModel = params.overrideModel || modelPlan.requestedModel;
  const candidates = params.overrideModel
    ? [params.overrideModel]
    : modelPlan.candidateModels;
  const timeoutMs = params.timeoutMs ?? 60_000;
  const overallStart = Date.now();
  const attempts: ProviderAttemptRecord[] = [];

  if (!apiKey) {
    return {
      ok: false,
      draft: null,
      raw_output_text: null,
      invocation_audit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: requestedModel,
        actual_model_invoked: null,
        prompt_version: GROUNDED_LLM_PROMPT_VERSION,
        live_provider_called: false,
        provider_interaction_id: null,
        latency_ms: Date.now() - overallStart,
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        attempts: [],
        error_summary: "GEMINI_API_KEY is not configured in the environment.",
      },
    };
  }

  const userPrompt = buildGroundedLlmUserPrompt({
    question: params.question,
    factLedger: params.factLedger,
    passagePack: params.passagePack,
  });

  const client = new GoogleGenAI({ apiKey });

  for (let mIdx = 0; mIdx < candidates.length; mIdx++) {
    const model = candidates[mIdx];
    const perModelTimeoutMs =
      mIdx === 0 && candidates.length > 1 ? Math.min(timeoutMs, 60_000) : Math.max(timeoutMs, 45_000);
    const thinkingLevel = model.includes("3.8") ? "low" : "minimal";
    // Allow 1 fast retry only on explicit HTTP 429/503 (never waste another full timeout cycle on an already timed-out model)
    for (let retry = 0; retry < 2; retry++) {
      const attemptStart = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), perModelTimeoutMs);
        let interaction: Awaited<ReturnType<typeof client.interactions.create>>;
        try {
          interaction = await client.interactions.create(
            {
              model,
              store: false,
              system_instruction: GROUNDED_SYSTEM_INSTRUCTION,
              input: userPrompt,
              generation_config: {
                temperature: 0.0,
                max_output_tokens: 4096,
                thinking_level: thinkingLevel,
              },
              response_format: {
                type: "text",
                mime_type: "application/json",
                schema: GROUNDED_LLM_RESPONSE_SCHEMA,
              } as unknown as Record<string, unknown>,
            },
            { signal: controller.signal }
          );
        } finally {
          clearTimeout(timer);
        }

        const attemptLatency = Date.now() - attemptStart;
        const outputText = extractOutputTextFromInteraction(interaction);
        const parsed = JSON.parse(outputText) as GroundedLlmDraftResponse;

        if (!parsed || !Array.isArray(parsed.issues)) {
          throw new Error("Model returned JSON missing required 'issues' array.");
        }

        const usage = (interaction as unknown as Record<string, unknown>)?.usage as
          | Record<string, number>
          | undefined;
        const inputTokens = Number(usage?.total_input_tokens ?? usage?.input_tokens ?? 0);
        const outputTokens = Number(usage?.total_output_tokens ?? usage?.output_tokens ?? 0);
        const thoughtTokens = Number(usage?.total_thought_tokens ?? usage?.thought_tokens ?? 0);
        const totalTokens = Number(
          usage?.total_tokens ?? inputTokens + outputTokens + thoughtTokens
        );
        const interactionId =
          typeof (interaction as unknown as Record<string, unknown>)?.id === "string"
            ? String((interaction as unknown as Record<string, unknown>).id)
            : `int.nostore.${Date.now().toString(36)}`;

        attempts.push({
          model,
          status: "succeeded",
          http_status: 200,
          latency_ms: attemptLatency,
        });

        return {
          ok: true,
          draft: parsed,
          raw_output_text: outputText,
          invocation_audit: {
            provider: "google-gemini",
            api_surface: "interactions-v1beta",
            requested_model: requestedModel,
            actual_model_invoked: model,
            prompt_version: GROUNDED_LLM_PROMPT_VERSION,
            live_provider_called: true,
            provider_interaction_id: interactionId,
            latency_ms: Date.now() - overallStart,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            thought_tokens: thoughtTokens,
            total_tokens: totalTokens,
            estimated_cost_usd: estimateCostUsd(model, inputTokens, outputTokens + thoughtTokens),
            attempts,
            error_summary: null,
          },
        };
      } catch (err) {
        const attemptLatency = Date.now() - attemptStart;
        const msg = err instanceof Error ? err.message : String(err);
        const statusMatch = msg.match(/\b(429|500|502|503|504|400|404)\b/);
        const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
        attempts.push({
          model,
          status: "error",
          http_status: httpStatus,
          latency_ms: attemptLatency,
          error_message: msg.slice(0, 300),
        });

        const isRetryableHttp = httpStatus === 429 || (httpStatus === 503 && mIdx === candidates.length - 1);
        if (isRetryableHttp && retry === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        break;
      }
    }
  }

  return {
    ok: false,
    draft: null,
    raw_output_text: null,
    invocation_audit: {
      provider: "google-gemini",
      api_surface: "interactions-v1beta",
      requested_model: requestedModel,
      actual_model_invoked: null,
      prompt_version: GROUNDED_LLM_PROMPT_VERSION,
      live_provider_called: attempts.length > 0,
      provider_interaction_id: null,
      latency_ms: Date.now() - overallStart,
      input_tokens: 0,
      output_tokens: 0,
      thought_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      attempts,
      error_summary:
        attempts[attempts.length - 1]?.error_message || "All LLM provider invocation attempts failed.",
    },
  };
}
