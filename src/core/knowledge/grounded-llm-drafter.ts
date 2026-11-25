/**
 * REG24 — Provider-Neutral Grounded LLM Legal Application Drafter
 * (Gemini 4 Neon Staging Candidate + Separate OpenAI Responses Challenger)
 *
 * Implements:
 * - Primary staging reasoning model: `REG24_GROUNDED_LLM_MODEL=gemini-4-neon` via Google Gemini
 *   Interactions API (`@google/genai`), starting at `thinking_level: "high"` (never sending
 *   unsupported `"minimal"` to Gemini 4 or 3.8 models, and sizing `max_output_tokens: 16384`
 *   so thinking tokens do not truncate structured JSON).
 * - Strict NO SILENT FALLBACK: on 429, timeout, invalid output, blocked/incomplete response,
 *   or unavailable model, never silently switches to Flash, Flash-Lite, OpenAI, or prewritten
 *   legal-conclusion templates.
 * - Separate opt-in challenger adapter for OpenAI Responses API (`gpt-6.2-astra`) sharing the
 *   exact same provider-neutral JSON schema (invoked only when explicitly requested, never as
 *   an automatic fallback).
 * - Full auditable provider invocation metadata: `requested_model`, `resolved_model`, pinned
 *   `thinking_level` / `temperature` / `max_output_tokens`, `failure_classification`, exact
 *   token usage, latency, estimated cost, and attempt log.
 */

import { GoogleGenAI } from "@google/genai";
import type { StructuredCaseFactLedger } from "./case-fact-ledger";
import {
  isNavigationOrBoilerplatePassageText,
  resolveVerifiedOfficialUrlForDoc,
} from "./claim-traceability-engine";
import type { Passage } from "./contracts";
import type { CanonicalPersistedState } from "./store";

export const GROUNDED_LLM_PROMPT_VERSION = "reg24-grounded-llm-legal-application-v1.1";

export type GroundedLlmProviderId = "google-gemini" | "openai";
export type GroundedThinkingLevel = "minimal" | "low" | "medium" | "high";

export type ProviderFailureClassification =
  | "NONE"
  | "RATE_LIMIT_429_FREE_TIER"
  | "TIMEOUT"
  | "INVALID_OUTPUT"
  | "BLOCKED_OR_INCOMPLETE"
  | "PROVIDER_UNAVAILABLE"
  | "MISSING_CREDENTIALS";

export type AuthorityHierarchyTier =
  | "CONTROLLING_STATUTE"
  | "CONTROLLING_SUBORDINATE_LEGISLATION"
  | "OFFICIAL_GUIDANCE"
  | "CASE_SPECIFIC_TAX_RULING";

export type GroundedEvidenceRole =
  | "governing"
  | "conditional_branch_authority"
  | "historical_or_excluded_context"
  | "contextual_ruling_or_guidance";

export interface GroundedPassagePackItem {
  passage_id: string;
  work_id: string;
  version_id: string;
  official_identifier: string;
  title_th: string;
  source_type: string;
  authority_tier: AuthorityHierarchyTier;
  evidence_role: GroundedEvidenceRole;
  /** Per-tax-point validity: exact tax-point ISO dates for which this passage is in force (governing). */
  applicable_tax_point_dates?: string[];
  /** Per-tax-point validity: exact tax-point ISO dates for which this passage is OUT_OF_WINDOW / expired. */
  excluded_tax_point_dates?: string[];
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
  provider: GroundedLlmProviderId;
  model: string;
  thinking_level: GroundedThinkingLevel;
  status: "succeeded" | "error";
  http_status?: number | null;
  latency_ms: number;
  error_message?: string | null;
}

export interface ProviderInvocationAudit {
  provider: GroundedLlmProviderId;
  api_surface: "interactions-v1beta" | "openai-responses-v1";
  requested_model: string;
  resolved_model: string | null;
  /** Back-compat alias equal to resolved_model || (live success ? requested_model : null). */
  actual_model_invoked: string | null;
  pinned_settings: {
    thinking_level: GroundedThinkingLevel;
    thinking_level_note: string | null;
    temperature: number;
    max_output_tokens: number;
    timeout_ms: number;
    store: false;
  };
  prompt_version: string;
  live_provider_called: boolean;
  silent_fallback_disabled: true;
  provider_interaction_id: string | null;
  provider_response_status: string | null;
  failure_classification: ProviderFailureClassification;
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
  "subreg.th.rc.royal_decree.646": { valid_from: "2017-10-01", valid_to: "2018-09-30" },
  "subreg.th.rc.royal_decree.780": { valid_from: "2023-10-01", valid_to: "2024-09-30" },
  "subreg.th.rc.royal_decree.790": { valid_from: "2024-10-01", valid_to: "2025-09-30" },
  "subreg.th.rc.royal_decree.799": { valid_from: "2025-10-01", valid_to: "2026-09-30" },
  "subreg.th.rc.royal_decree.807": { valid_from: "2026-10-01", valid_to: "2027-09-30" },
};

/**
 * Consolidated-derived historical VAT decrees (e.g. current consolidated RD 646 PDF) must NEVER
 * enter the model evidence packet as `governing` historical proof until their original Gazette
 * text and complete intervening amendment chain are independently verified.
 */
const EXCLUDED_CONSOLIDATED_HISTORICAL_VAT_WORK_IDS = new Set<string>([
  "subreg.th.rc.royal_decree.646",
]);

const MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "gemini-4-neon": { input: 1.25, output: 10.0 },
  "gemini-4-argon": { input: 1.25, output: 10.0 },
  "gemini-3.8-flash": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "gpt-6.2-astra": { input: 2.0, output: 8.0 },
};

/**
 * Model-specific thinking/reasoning level resolver:
 * - Gemini 4 family (`gemini-4-neon`, `gemini-4-argon`, etc.): does NOT support `"minimal"`;
 *   defaults explicitly to `"low"` in REG24 staging (RC10.3 P0-3) and allows `"low" | "medium" | "high"`.
 * - Gemini 3.8 & 3.1 Pro: does NOT support `"minimal"`; allows `"low" | "medium" | "high"`.
 * - Gemini 3.5/3.6 Flash / Flash-Lite (benchmark models): supports `"minimal" | "low" | "medium" | "high"`.
 * - OpenAI Responses challenger (`gpt-6.2-astra`): maps `"minimal"` -> `"low"`, supports `"low" | "medium" | "high"`.
 */
export function resolveThinkingLevelForModel(
  model: string,
  requestedLevel?: GroundedThinkingLevel | null
): {
  thinking_level: GroundedThinkingLevel;
  max_output_tokens: number;
  note: string | null;
} {
  const m = (model || "").toLowerCase();
  const isGemini4 = m.startsWith("gemini-4-") || m.includes("neon") || m.includes("argon");
  const isGemini38OrPro = m.startsWith("gemini-3.8-") || m.includes("3.1-pro") || m.includes("3-pro");
  const isOpenAi = m.startsWith("gpt-") || m.includes("o1") || m.startsWith("o3") || m.startsWith("o4");
  const supportsMinimal = !isGemini4 && !isGemini38OrPro && !isOpenAi;

  let chosen: GroundedThinkingLevel;
  let note: string | null = null;

  if (requestedLevel) {
    if (requestedLevel === "minimal" && !supportsMinimal) {
      chosen = "low";
      note = `Model '${model}' does not support thinking_level='minimal'; normalized to '${chosen}'.`;
    } else {
      chosen = requestedLevel;
    }
  } else if (isGemini4) {
    chosen = "low";
  } else if (isOpenAi) {
    chosen = "high";
  } else if (isGemini38OrPro) {
    chosen = "medium";
  } else {
    chosen = "minimal";
  }

  // Per Gemini Thinking docs, `max_output_tokens` includes thought tokens: always allocate 16384
  // for Gemini 4 models (at any level) and for high/medium thinking so reasoning never truncates JSON.
  const maxOutputTokens = isGemini4 || chosen === "high" || chosen === "medium" ? 16384 : 4096;
  return { thinking_level: chosen, max_output_tokens: maxOutputTokens, note };
}

export function resolveConfiguredProviderAndModel(params?: {
  challengerProvider?: GroundedLlmProviderId | null;
  overrideModel?: string | null;
}): {
  provider: GroundedLlmProviderId;
  requestedModel: string;
  retiredDefaultNote: string | null;
} {
  const envProvider = (process.env.REG24_GROUNDED_LLM_PROVIDER || "").trim().toLowerCase();
  const provider: GroundedLlmProviderId =
    params?.challengerProvider === "openai" || (!params?.challengerProvider && envProvider === "openai")
      ? "openai"
      : "google-gemini";

  if (provider === "openai") {
    const model =
      (params?.overrideModel || "").trim() ||
      (process.env.REG24_OPENAI_CHALLENGER_MODEL || "").trim() ||
      "gpt-6.2-astra";
    return { provider: "openai", requestedModel: model, retiredDefaultNote: null };
  }

  const explicitOverride = (params?.overrideModel || "").trim();
  const envStagingModel = (process.env.REG24_GROUNDED_LLM_MODEL || "").trim();
  let primary = explicitOverride || envStagingModel || "gemini-4-neon";
  let retiredDefaultNote: string | null = null;

  if (/^gemini-(?:1\.5|2\.0|2\.5)-/i.test(primary)) {
    retiredDefaultNote = `Configured legacy model '${primary}' returns HTTP 404 from Google Gemini API; pinned staging primary is 'gemini-4-neon'.`;
    primary = "gemini-4-neon";
  }

  return { provider: "google-gemini", requestedModel: primary, retiredDefaultNote };
}

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
  explicitWorkIds?: Set<string>;
  historicalContextWorkIds?: Set<string>;
  splitPaymentTaxPointDates?: string[];
}): GroundedPassagePackItem[] {
  const maxPassages = params.maxPassages ?? 28;
  const seen = new Set<string>();
  const out: GroundedPassagePackItem[] = [];

  // RC10.3 P0-1: Universal packet-level predecessor & superseded-base-text guard.
  // Build sets of works that are explicitly superseded or amended by an in-window governing work in this packet
  // so a graph-expanded predecessor or superseded base text can NEVER become `governing` merely because it is linked!
  const candidateWorkIds = new Set(params.passages.map((p) => p.work_id));
  const supersededOrAmendedHistoricalWorkIds = new Set<string>();
  const acceptedAssertions = Object.values(params.state.assertions || {}).filter(
    (a) => a.state === "ACCEPTED"
  );
  if (params.controllingDateIso) {
    for (const a of acceptedAssertions) {
      if (a.predicate !== "SUPERSEDES" && a.predicate !== "AMENDS" && a.predicate !== "REPEALS") {
        continue;
      }
      if (!candidateWorkIds.has(a.subject) || !candidateWorkIds.has(a.object)) continue;
      // Check if the amending/superseding subject itself applies on `controllingDateIso`
      const subjPsg = params.passages.find((p) => p.work_id === a.subject);
      const subjVer = subjPsg ? params.state.versions[subjPsg.version_id] : undefined;
      const subjWin = KNOWN_DECREE_WINDOWS[a.subject];
      const subjFrom = subjWin?.valid_from || subjVer?.legal_applicability?.[0]?.valid_from || null;
      const subjTo = subjWin?.valid_to || subjVer?.legal_applicability?.[0]?.valid_to || null;
      const subjHint = evaluateTemporalHint(subjFrom, subjTo, params.controllingDateIso);
      if (subjHint === "IN_WINDOW" || subjHint === "NO_FIXED_END_DATE") {
        // When an amending/superseding instrument governs on `controllingDateIso`, its predecessor / superseded base text
        // may appear ONLY as `historical_or_excluded_context` unless its own verified window also covers `controllingDateIso`
        // AND it is NOT a consolidated derivative superseded by the amending decree!
        const objPsg = params.passages.find((p) => p.work_id === a.object);
        const objVer = objPsg ? params.state.versions[objPsg.version_id] : undefined;
        const objWin = KNOWN_DECREE_WINDOWS[a.object];
        const objFrom = objWin?.valid_from || objVer?.legal_applicability?.[0]?.valid_from || null;
        const objTo = objWin?.valid_to || objVer?.legal_applicability?.[0]?.valid_to || null;
        const objHint = evaluateTemporalHint(objFrom, objTo, params.controllingDateIso);
        const objWork = params.state.works[a.object];
        const isObjTemporarySubreg =
          objWork?.type === "SubordinateLegislation" &&
          (objVer?.legal_applicability?.[0]?.is_temporary_rule === true ||
            /^subreg\.th\.rc\.royal_decree\./.test(a.object));
        if (
          a.predicate === "SUPERSEDES" ||
          a.predicate === "REPEALS" ||
          objHint === "OUT_OF_WINDOW" ||
          (isObjTemporarySubreg &&
            (objVer?.is_consolidated_derived === true ||
              objVer?.draft_or_enacted_status === "CONSOLIDATED_DERIVED"))
        ) {
          supersededOrAmendedHistoricalWorkIds.add(a.object);
        }
      }
    }
  }

  for (const p of params.passages) {
    if (seen.has(p.passage_id)) continue;
    if (p.extraction_id.startsWith("ext.dep.")) continue;
    if (isNavigationOrBoilerplatePassageText(p.exact_text)) continue;
    seen.add(p.passage_id);

    const work = params.state.works[p.work_id];
    const ver = params.state.versions[p.version_id];
    const art = params.state.artifacts[p.real_locator.artifact_id];

    const knownWindow = KNOWN_DECREE_WINDOWS[p.work_id];
    const validFrom = ver?.legal_applicability?.[0]?.valid_from || knownWindow?.valid_from || null;
    const validTo = ver?.legal_applicability?.[0]?.valid_to || knownWindow?.valid_to || null;
    const resolvedUrl =
      resolveVerifiedOfficialUrlForDoc(p.work_id, p.real_locator.origin_uri) || null;
    const isPdf =
      Boolean(resolvedUrl && /\.pdf(?:$|\?)/i.test(resolvedUrl)) ||
      art?.MIME === "application/pdf";
    const isTemporaryDecree = Boolean(
      ver?.legal_applicability?.[0]?.is_temporary_rule ||
        p.work_id.startsWith("subreg.th.rc.royal_decree.")
    );
    const splitDates = params.splitPaymentTaxPointDates || [];
    const evaluatedTaxPoints =
      splitDates.length >= 2
        ? splitDates
        : params.controllingDateIso
          ? [params.controllingDateIso]
          : [];
    const applicableTaxPointDates: string[] = [];
    const excludedTaxPointDates: string[] = [];
    for (const tpDate of evaluatedTaxPoints) {
      const h = evaluateTemporalHint(validFrom, validTo, tpDate);
      if (h === "OUT_OF_WINDOW") {
        excludedTaxPointDates.push(tpDate);
      } else if (h === "IN_WINDOW" || h === "NO_FIXED_END_DATE") {
        applicableTaxPointDates.push(tpDate);
      }
    }
    const isInWindowForAnyTaxPoint =
      evaluatedTaxPoints.length > 0 && applicableTaxPointDates.length > 0;
    const isConsolidatedHistoricalVatExcluded =
      EXCLUDED_CONSOLIDATED_HISTORICAL_VAT_WORK_IDS.has(p.work_id) &&
      ver?.draft_or_enacted_status !== "ENACTED_ORIGINAL" &&
      !isInWindowForAnyTaxPoint;
    const temporalHint =
      splitDates.length >= 2
        ? applicableTaxPointDates.length > 0
          ? isTemporaryDecree
            ? "IN_WINDOW"
            : "NO_FIXED_END_DATE"
          : isTemporaryDecree
            ? "OUT_OF_WINDOW"
            : "NO_FIXED_END_DATE"
        : evaluateTemporalHint(validFrom, validTo, params.controllingDateIso);
    // Assign authority and validity PER TAX POINT: never allow a later expired portion's
    // `historicalContextWorkIds` to override an earlier portion's active `governing` authority!
    const isHistoricalOnlyForAllTaxPoints =
      Boolean(params.historicalContextWorkIds?.has(p.work_id)) && !isInWindowForAnyTaxPoint;
    const isSupersededOrHistory =
      isConsolidatedHistoricalVatExcluded ||
      temporalHint === "OUT_OF_WINDOW" ||
      isHistoricalOnlyForAllTaxPoints ||
      (supersededOrAmendedHistoricalWorkIds.has(p.work_id) && !isInWindowForAnyTaxPoint);

    let evidenceRole: GroundedEvidenceRole;
    if (isSupersededOrHistory) {
      evidenceRole = "historical_or_excluded_context";
    } else if (temporalHint === "DATE_UNKNOWN" && isTemporaryDecree) {
      evidenceRole = "conditional_branch_authority";
    } else if (work?.type === "TaxRuling" && !params.explicitWorkIds?.has(p.work_id)) {
      evidenceRole = "contextual_ruling_or_guidance";
    } else {
      evidenceRole = "governing";
    }

    out.push({
      passage_id: p.passage_id,
      work_id: p.work_id,
      version_id: p.version_id,
      official_identifier:
        work?.official_identifiers[0]?.normalized || work?.title_th || p.work_id,
      title_th: work?.title_th || p.contextualized_header || p.work_id,
      source_type: work?.type || "Statute",
      authority_tier: classifyAuthorityTier(work?.type, p.work_id),
      evidence_role: evidenceRole,
      ...(evaluatedTaxPoints.length > 0
        ? {
            applicable_tax_point_dates: applicableTaxPointDates,
            excluded_tax_point_dates: excludedTaxPointDates,
          }
        : {}),
      effective_dates: {
        valid_from: validFrom,
        valid_to: validTo,
        decision_date: ver?.decision_date || null,
        publication_date: ver?.publication_date || null,
        raw_date_text: ver?.raw_date_text || null,
        temporal_applicability_hint: temporalHint,
      },
      pinpoint:
        p.structural_path.filter(Boolean).join(" > ") ||
        p.contextualized_header ||
        p.passage_id,
      official_url: resolvedUrl,
      representation_kind: isPdf ? "official_scan_pdf" : "verified_official_transcript",
      verbatim_text: p.exact_text.slice(0, 1800),
    });

    if (out.length >= maxPassages) break;
  }

  return out;
}

/**
 * Provider-neutral JSON Schema for structured legal application output.
 * Uses clean single-type declarations (avoiding multi-type union arrays like `["number", "null"]`
 * which degrade constrained-decoding latency on Gemini 4 models); absent optional numeric fields
 * are normalized to `null` after JSON parsing. `buildOpenAiStrictSchema` adapts this cleanly for
 * OpenAI Responses API `strict: true` mode.
 */
export const GROUNDED_LLM_RESPONSE_SCHEMA = {
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
            type: "object",
            properties: {
              formula_description_th: { type: "string" },
              tax_base_thb: { type: "number" },
              exempt_amount_thb: { type: "number" },
              taxable_amount_thb: { type: "number" },
              rate_pct: { type: "number" },
              computed_tax_thb: { type: "number" },
              is_computable_from_stated_facts: { type: "boolean" },
              missing_inputs_th: { type: "array", items: { type: "string" } },
              steps_th: { type: "array", items: { type: "string" } },
            },
            required: [
              "formula_description_th",
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

function stripUngroundedSbtLocalTaxGloss(
  text: string,
  hasGoverningSbt33InPack: boolean
): string {
  if (!text || hasGoverningSbt33InPack) return text;
  if (!/ภาษีธุรกิจเฉพาะ|91\/2|91\/6/.test(text)) return text;
  let cleaned = text;
  // Remove parenthetical municipal local-tax 3.3% / 0.3% glosses when the pack only contains § 91/6 (3) 3.0%
  cleaned = cleaned.replace(
    /\s*\([^()\n]{0,90}(?:3\.3|0\.3)[^()\n]{0,90}\)/g,
    ""
  );
  // If phrasing wrote "ร้อยละ 3.0 รวมภาษีท้องถิ่นเป็นร้อยละ 3.3" without parentheses, keep only the statutory 3.0%
  cleaned = cleaned.replace(
    /(ร้อยละ\s*3(?:\.0)?)\s*(?:ซึ่ง|โดย)?(?:เมื่อ)?รวมภาษีท้องถิ่น[^.,;\n]{0,60}?3\.3\s*%?/g,
    "$1"
  );
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function normalizeParsedDraftResponse(
  raw: GroundedLlmDraftResponse,
  passagePack?: GroundedPassagePackItem[]
): GroundedLlmDraftResponse {
  const packById = new Map((passagePack || []).map((p) => [p.passage_id, p]));
  const hasGoverningSbt33InPack = (passagePack || []).some(
    (p) => p.evidence_role === "governing" && /(?<![0-9.])3\.3(?![0-9])/.test(p.verbatim_text || "")
  );
  return {
    ...raw,
    case_facts_used: Array.isArray(raw.case_facts_used) ? raw.case_facts_used : [],
    assumptions_th: Array.isArray(raw.assumptions_th) ? raw.assumptions_th : [],
    clarification_questions_th: Array.isArray(raw.clarification_questions_th)
      ? raw.clarification_questions_th
      : [],
    evidence_gaps_th: Array.isArray(raw.evidence_gaps_th) ? raw.evidence_gaps_th : [],
    issues: (raw.issues || []).map((iss) => {
      const govIds = Array.isArray(iss.governing_passage_ids) ? iss.governing_passage_ids : [];
      const cites91_6 = govIds.some((pid) => {
        const w = packById.get(pid)?.work_id || "";
        return w === "prov.th.rc.91_6" || w === "prov.th.rc.91/6";
      });
      const conc = cites91_6
        ? stripUngroundedSbtLocalTaxGloss(iss.conclusion_th || "", hasGoverningSbt33InPack)
        : iss.conclusion_th;
      const appExp = cites91_6
        ? stripUngroundedSbtLocalTaxGloss(
            iss.application_explanation_th || "",
            hasGoverningSbt33InPack
          )
        : iss.application_explanation_th;
      return {
        ...iss,
        conclusion_th: conc,
        application_explanation_th: appExp,
        material_facts_relied_on: Array.isArray(iss.material_facts_relied_on)
          ? iss.material_facts_relied_on
          : [],
        governing_passage_ids: govIds,
        missing_facts_or_uncertainties_th: Array.isArray(iss.missing_facts_or_uncertainties_th)
          ? iss.missing_facts_or_uncertainties_th
          : [],
        proposed_calculation: iss.proposed_calculation
          ? {
              formula_description_th: iss.proposed_calculation.formula_description_th || "",
              tax_base_thb:
                typeof iss.proposed_calculation.tax_base_thb === "number"
                  ? iss.proposed_calculation.tax_base_thb
                  : null,
              exempt_amount_thb:
                typeof iss.proposed_calculation.exempt_amount_thb === "number"
                  ? iss.proposed_calculation.exempt_amount_thb
                  : null,
              taxable_amount_thb:
                typeof iss.proposed_calculation.taxable_amount_thb === "number"
                  ? iss.proposed_calculation.taxable_amount_thb
                  : null,
              rate_pct:
                typeof iss.proposed_calculation.rate_pct === "number"
                  ? iss.proposed_calculation.rate_pct
                  : null,
              computed_tax_thb:
                typeof iss.proposed_calculation.computed_tax_thb === "number"
                  ? iss.proposed_calculation.computed_tax_thb
                  : null,
              is_computable_from_stated_facts: Boolean(
                iss.proposed_calculation.is_computable_from_stated_facts
              ),
              missing_inputs_th: Array.isArray(iss.proposed_calculation.missing_inputs_th)
                ? iss.proposed_calculation.missing_inputs_th
                : [],
              steps_th: Array.isArray(iss.proposed_calculation.steps_th)
                ? iss.proposed_calculation.steps_th
                : [],
            }
          : null,
      };
    }),
  };
}

export function buildOpenAiStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const walk = (node: Record<string, unknown>) => {
    const t = node.type;
    if (t === "object" || (Array.isArray(t) && t.includes("object"))) {
      node.additionalProperties = false;
      if (node.properties && typeof node.properties === "object") {
        const props = node.properties as Record<string, Record<string, unknown>>;
        const reqSet = new Set<string>(Array.isArray(node.required) ? (node.required as string[]) : []);
        // OpenAI `strict: true` requires EVERY property key in `required`, using `["<type>", "null"]` for optional fields.
        for (const [k, v] of Object.entries(props)) {
          if (!reqSet.has(k) && typeof v.type === "string") {
            v.type = [v.type, "null"];
          }
          walk(v);
        }
        node.required = Object.keys(props);
      }
    }
    if (node.items && typeof node.items === "object") {
      walk(node.items as Record<string, unknown>);
    }
  };
  walk(clone);
  return clone;
}

const GROUNDED_SYSTEM_INSTRUCTION = `คุณคือทนายความและผู้เชี่ยวชาญกฎหมายภาษีอากรไทยของระบบ REG24 มีหน้าที่วิเคราะห์และปรับใช้บทบัญญัติกฎหมายกับข้อเท็จจริงของผู้ใช้อย่างเคร่งครัดตามหลักฐานต้นฉบับที่ได้รับเท่านั้น (Grounded Legal Application)

กฎบังคับเด็ดขาด (ห้ามฝ่าฝืน):
1. คงข้อเท็จจริงต้นฉบับของผู้ใช้ไว้ทุกประการ:
   - ห้ามเปลี่ยนชื่อทรัพย์สินหรือคู่กรณีให้เพี้ยนจากคำถาม เช่น หากผู้ใช้ถามเรื่อง "ห้องชุด" ให้ระบุว่าเป็น "ห้องชุด (ซึ่งจัดเป็นอสังหาริมทรัพย์)" ห้ามเปลี่ยนเป็น "ที่ดิน" โดยพลการ หากผู้ใช้ระบุ "หลานชาย (บุตรชายของน้องสาว)" ห้ามเปลี่ยนเป็น "หลานสาว"
   - หากมีหลายเทิร์น ให้ยึดข้อเท็จจริงที่อัปเดตล่าสุดจากเทิร์นหลังทับค่าที่เปลี่ยนไป และคงข้อเท็จจริงเดิมที่ไม่ได้เปลี่ยนไว้ เมื่อเทิร์นหลังแก้ไขมูลค่าหรือฐานภาษี ให้คำนวณและระบุเฉพาะตัวเลขภาษีและยอดรวมทั้งสิ้นจากฐานภาษีใหม่ล่าสุดเท่านั้น (ห้ามนำตัวเลขภาษีเดิมที่ถูกแก้ไขทับแล้ว หรือคำเปรียบเทียบเช่น "2 เท่า" มาปะปนในข้อสรุปของประเด็นคำนวณใหม่)
   - แยกแยะวันทำธุรกรรม (transaction date), วันที่อ้างอิงกฎหมาย (legal as-of date) และวันเกิดความรับผิดทางภาษี (controlling tax point เช่น มาตรา 78/1 (1) สำหรับบริการ) ให้ชัดเจน ห้ามสมมติวันที่เองเมื่อวันที่ขาดหายหรือคลุมเครือ
   - กรณีแบ่งรับชำระหลายงวดหรือออกใบกำกับภาษีบางส่วน (split_payment_tax_points มีหลายส่วน): ต้องแยกวิเคราะห์แต่ละส่วนเป็นประเด็นแยกกันโดยระบุวันเกิดความรับผิด จำนวนเงิน และกฎหมายที่ใช้บังคับเฉพาะส่วนนั้นตาม applicable_tax_point_dates ของแต่ละหลักฐาน หากมีการออกใบกำกับภาษีบางส่วนก่อนรับชำระ ความรับผิดของส่วนที่ออกใบกำกับภาษีแล้วเกิดขึ้น ณ วันออกใบกำกับภาษีตามมาตรา 78/1 (1) (การรับชำระเงินสำหรับยอดที่ออกใบกำกับภาษีไว้แล้วในภายหลังไม่ก่อให้เกิดภาระภาษีมูลค่าเพิ่มซ้ำอีก) ส่วนยอดคงเหลือที่ยังไม่ได้ออกใบกำกับภาษีจะเกิดความรับผิดเมื่อรับชำระเงิน หากข้อเท็จจริงไม่ระบุขอบเขตมูลค่าของใบกำกับภาษี (เต็มจำนวนหรือบางส่วน) หรือไม่ระบุการจัดสรรการชำระเงินเมื่อมียอดชำระเท่ากันหลายงวด และข้อเท็จจริงที่ขาดหายเปลี่ยนพระราชกฤษฎีกาที่ใช้บังคับ ห้ามเดาหรืออนุมานเอง ให้ตั้ง answer_status = "CONDITIONAL" ระบุข้อเท็จจริงที่ขาดหายและถามยืนยันใน clarification_questions_th พร้อมนำเสนอเงื่อนไขแยกแต่ละทางเลือกที่มีหลักฐานรองรับโดยไม่เก็บภาษีซ้ำและไม่ตัดยอดตกหล่น ห้ามนำวันที่หรือพระราชกฤษฎีกาของงวดก่อนหน้ามาใช้กับงวดที่อยู่นอกช่วงวันใช้บังคับ (excluded_tax_point_dates) และสำหรับงวดที่เกิดหลังวันสิ้นสุดพระราชกฤษฎีกาชั่วคราว (เช่น หลัง 30 กันยายน 2570) ห้ามอ้างพระราชกฤษฎีกาที่สิ้นสุดแล้วเป็นกฎหมายควบคุมและห้ามสมมติว่าจะมีพระราชกฤษฎีกาขยายเวลาลดอัตราในอนาคต ให้ระบุตามเพดานประมวลรัษฎากร มาตรา 80 เว้นแต่จะมีการตราพระราชกฤษฎีกาฉบับใหม่ก่อนวันเกิดความรับผิดของงวดนั้น
2. อ้างอิงเฉพาะ passage_id ที่มีอยู่จริงใน PASSAGE_PACK และถูกผูกไว้ใน governing_passage_ids ของประเด็นนั้นเท่านั้น:
   - ห้ามประดิษฐ์เลขมาตรา อนุมาตรา เลขพระราชกฤษฎีกา เลขคำสั่งกรมสรรพากร (ท.ป./ป.) หรือเลขหนังสือตอบข้อหารือ กค ที่ไม่ปรากฏตรงตัวในข้อความของ passage ที่อ้างอิงใน governing_passage_ids และ **ห้ามนำหนังสือตอบข้อหารือ กค กฎหมายลำดับรอง หรือคำสั่งใดๆ (รวมถึงข้อหารือเก่าใน PASSAGE_PACK ที่ไม่ได้ใช้เป็นหลักฐานควบคุมใน governing_passage_ids) ไปกล่าวถึงลอยๆ ใน authority_distinction_note_th, overall_summary_th, issue_title_th, assumptions_th, missing_facts_or_uncertainties_th หรือ case_facts_used เด็ดขาด** ทุกแหล่งอ้างอิงที่เอ่ยชื่อในคำตอบทุกช่องต้องมี passage_id รองรับอยู่ใน governing_passage_ids ของประเด็นนั้นเสมอ (ตรวจสอบเลขอนุมาตราให้ตรงกับ verbatim_text ของ passage ที่อ้างอิงทุกครั้ง; หากกล่าวถึงอัตรารวมภาษีท้องถิ่นของ VAT ร้อยละ 7 ให้ระบุ passage_id ของคู่มือ/คำแนะนำทางการเรื่องภาษีท้องถิ่นใน governing_passage_ids ด้วย; สำหรับภาษีธุรกิจเฉพาะ หากไม่มีตัวบทภาษีท้องถิ่นใน PASSAGE_PACK ห้ามระบุอัตรารวมร้อยละ 3.3 ให้ระบุเฉพาะอัตราตามตัวบทประมวลรัษฎากร มาตรา 91/6 (3) คือร้อยละ 3.0 เท่านั้น; และห้ามระบุตัวเลขเบี้ยปรับหรือเงินเพิ่ม เช่น 6 เท่า หากไม่มีตัวบทมาตรานั้นใน PASSAGE_PACK)
   - ตรวจสอบช่วงเวลาใช้บังคับ (valid_from / valid_to) ของทุกกฎหมายลำดับรองและพระราชกฤษฎีกาเทียบกับวันเกิดความรับผิดทางภาษี ห้ามนำพระราชกฤษฎีกาที่อยู่นอกช่วงวันใช้บังคับ (temporal_applicability_hint = "OUT_OF_WINDOW") มาใช้เป็นกฎหมายควบคุมสำหรับธุรกรรมนั้น และห้ามเหมารวมใช้ฉบับล่าสุดเมื่อไม่มีวันที่หรือวันที่อยู่นอกช่วง
   - แยกแยะลำดับศักดิ์แหล่งอ้างอิงเฉพาะรายการที่ผูกไว้ใน governing_passage_ids ของประเด็นนั้นอย่างชัดเจน: กฎหมายแม่บท/ประมวลรัษฎากร (CONTROLLING_STATUTE), กฎหมายลำดับรอง/พระราชกฤษฎีกา/ประกาศอธิบดี (CONTROLLING_SUBORDINATE_LEGISLATION), คู่มือ/คำแนะนำ (OFFICIAL_GUIDANCE) และหนังสือตอบข้อหารือเฉพาะราย (CASE_SPECIFIC_TAX_RULING — กล่าวถึงเฉพาะเมื่อจำเป็นต้องใช้ passage_id ของข้อหารือนั้นใน governing_passage_ids เท่านั้น ห้ามดึงข้อหารือก่อนปี พ.ศ. 2558 เช่นข้อหารือตามกฎกระทรวงเดิมที่ไม่เกี่ยวข้องกับการคำนวณตามมาตรา 42 (26) มาเปรียบเทียบประกอบโดยไม่ได้ผูกหลักฐาน)
   - ห้ามนำหนังสือตอบข้อหารือที่ไม่ตรงประเภทธุรกรรม (เช่น ข้อหารือส่งออกสินค้า/รองเท้า หรือเงินชดเชยเลิกจ้าง) มาใช้ตอบแทนหลักกฎหมาย
3. แยกวิเคราะห์แต่ละประเด็นและตอบทุกคำถามย่อยของผู้ใช้ให้ครบถ้วนโดยแยกภาระภาษีของแต่ละฝ่ายชัดเจน:
   - หากผู้ใช้ถามหลายประเด็นในเทิร์นเดียวหรือในเทิร์นถามต่อ (ไม่ว่าจะเรียงลำดับคำถามอย่างไรหรือใช้ถ้อยคำใด เช่น ถามทั้งวิธีการหักค่าใช้จ่ายในการคำนวณภาษีหัก ณ ที่จ่าย และถามเรื่องภาษีธุรกิจเฉพาะควบคู่กัน): **ต้องสร้างรายการใน issues[] แยกตอบทุกประเด็นคำถามโดยตรงให้ครบทุกข้อ ห้ามตอบเพียงประเด็นเดียวแล้วกล่าวพาดพิงอีกประเด็นเพียงสั้นๆ**
   - สำหรับการโอนอสังหาริมทรัพย์โดยไม่มีค่าตอบแทนหรือให้โดยเสน่หา (เช่น ที่ดิน ห้องชุด บ้านเดี่ยวพร้อมที่ดิน อาคารพาณิชย์) ให้ใช้โครงสร้างแยกประเด็นมาตรฐานเดียวกันทุกกรณีเสมอ (ไม่ว่าความสัมพันธ์หรือถ้อยคำจะเปลี่ยนไปอย่างไร):
     (ก) ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายในวันจดทะเบียนโอนกรรมสิทธิ์ของผู้โอน: ประมวลรัษฎากร มาตรา 41 ทวิ กำหนดให้ถือว่าผู้โอนเป็นผู้มีเงินได้พึงประเมิน, มาตรา 49 ทวิ กำหนดให้ใช้ราคาประเมินทุนทรัพย์เพื่อเรียกเก็บค่าธรรมเนียมจดทะเบียนสิทธิและนิติกรรมตามประมวลกฎหมายที่ดินเป็นฐานคำนวณ (ไม่ใช่ราคาที่ระบุในสัญญาให้), มาตรา 42 (26) และมาตรา 50 (6) ยกเว้นเฉพาะกรณีบิดาหรือมารดาโอนอสังหาริมทรัพย์ให้แก่บุตรชอบด้วยกฎหมายซึ่งไม่รวมถึงบุตรบุญธรรม เฉพาะส่วนที่ไม่เกิน 20,000,000 บาทตลอดปีภาษี (หากราคาประเมินทุนทรัพย์ไม่เกิน 20,000,000 บาท รวมถึงกรณีเทิร์นถามต่อเปลี่ยนผู้รับโอนเป็นบุตรชอบด้วยกฎหมาย ต้องแยกประเด็นผู้โอนเป็น 1 รายการใน issues[] เสมอ โดยสรุปว่าผู้โอนได้รับยกเว้นทั้งจำนวนและไม่ต้องหักภาษี ณ ที่จ่าย 0 บาท พร้อมส่ง proposed_calculation ที่ตั้ง is_computable_from_stated_facts = true, tax_base_thb = ราคาประเมินทุนทรัพย์, exempt_amount_thb = ราคาประเมินทุนทรัพย์, taxable_amount_thb = 0, rate_pct = 5, computed_tax_thb = 0 และแยกประเด็นผู้รับโอนเป็นอีก 1 รายการใน issues[] ต่างหากเสมอ; ส่วนกรณีเกิน 20,000,000 บาท เสียและหักภาษี ณ ที่จ่ายร้อยละ 5 เฉพาะส่วนที่เกินตามมาตรา 48 (4/1) และมาตรา 50 (6); และหากเป็นสามีภริยาที่จดทะเบียนสมรสร่วมกันโอนอสังหาริมทรัพย์อันเป็นสินสมรสให้บุตรชอบด้วยกฎหมาย เมื่อมีแนววินิจฉัย กค 0702/3889 อยู่ใน PASSAGE_PACK ให้อ้างอิงเลขที่หนังสือตอบข้อหารือ กค 0702/3889 และใส่ passage_id ของ กค 0702/3889 ใน governing_passage_ids ควบคู่ด้วยเสมอ); หากผู้รับโอนเป็นบุตรบุญธรรม หลาน บุตรของหลาน หรือบุคคลอื่น จะไม่ได้รับยกเว้นตามมาตรา 42 (26) และต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียนตามมาตรา 50 (6) ประกอบมาตรา 50 (5) (ก) และมาตรา 48 (4) (ก) (กรณีอสังหาริมทรัพย์อันเป็นมรดกหรือได้รับจากการให้โดยเสน่หา) หรือมาตรา 50 (6) ประกอบมาตรา 50 (5) (ข) และมาตรา 48 (4) (ข) โดยหักค่าใช้จ่ายเป็นการเหมาตามที่กำหนดโดยพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 หารด้วยจำนวนปีที่ถือครอง คำนวณภาษีตามอัตราภาษีเงินได้แล้วคูณด้วยจำนวนปีที่ถือครอง (กรณีอสังหาริมทรัพย์ที่ได้มาโดยทางอื่นนอกจาก (ก) เช่น ได้มาโดยการซื้อ — พร้อมผูก passage_id ของมาตรา 50 (5), 50 (6) และมาตรา 48 (4) ใน governing_passage_ids และระบุชัดเจนว่าขาดข้อมูลใดจึงยังคำนวณเป็นตัวเงินสุดท้ายไม่ได้ เช่น วันเดือนปีที่ได้มา/จำนวนปีที่ถือครอง ได้ที่ดินและสิ่งปลูกสร้างมาพร้อมกันหรือไม่ และตารางอัตราค่าใช้จ่ายเหมาตาม พ.ร.ฎ. 165 ไม่ได้รวมอยู่ในชุดหลักฐาน โดยห้ามเดาปีที่ได้มาและห้ามนำตัวเลขภาษีของเทิร์นก่อนหน้ามาแสดงซ้ำ)
     (ข) ความรับผิดกรณีหักภาษีเงินได้ ณ ที่จ่ายและนำส่งไม่ครบถ้วนตามมาตรา 54: เมื่อธุรกรรมนั้นมีหน้าที่ต้องหักภาษีเงินได้ ณ ที่จ่ายในวันจดทะเบียน (เช่น โอนให้ผู้รับที่ไม่ใช่บุตรชอบด้วยกฎหมาย หรือโอนให้บุตรชอบด้วยกฎหมายในส่วนที่เกิน 20,000,000 บาท) ต้องแยกประเด็นอธิบายความรับผิดร่วมตามมาตรา 54 เสมอพร้อมอ้างอิง passage_id ของมาตรา 54 (และหากกล่าวอ้างถึงมาตรา 50 (5) (ก)/(ข) หรือมาตรา 50 (6) ในประเด็นมาตรา 54 ให้ใส่ passage_id ของมาตรา 50 ส่วนนั้นควบคู่ใน governing_passage_ids ด้วยทุกครั้ง); แต่หากธุรกรรมได้รับยกเว้นเต็มจำนวนจนไม่มีหน้าที่ต้องหักภาษี ณ ที่จ่าย (เช่น โอนให้บุตรชอบด้วยกฎหมายไม่เกิน 20,000,000 บาท) ห้ามใส่มาตรา 54 แบบเหมารวม
     (ค) ภาระภาษีเงินได้บุคคลธรรมดาของผู้รับโอนอสังหาริมทรัพย์ — แยกสองกรณีอย่างเคร่งครัด:
         - กรณีที่ 1: บิดาหรือมารดาโอนอสังหาริมทรัพย์โดยไม่มีค่าตอบแทนให้แก่ "บุตรชอบด้วยกฎหมาย" (ไม่รวมถึงบุตรบุญธรรม): ให้สรุปชัดเจนว่า บุตรชอบด้วยกฎหมายผู้รับโอนไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา (ไม่มีภาระภาษีเงินได้บุคคลธรรมดาและไม่ต้องนำมูลค่าอสังหาริมทรัพย์ที่ได้รับโอนมารวมคำนวณเพื่อเสียภาษีเงินได้) โดยอ้างอิงประมวลรัษฎากร มาตรา 41 ทวิ และมาตรา 42 (26) (ทั้งนี้ไม่ต้องส่ง proposed_calculation คือตั้ง proposed_calculation = null และไม่เขียนเป็นตัวเลข 0 บาท; หากข้อเท็จจริงทุกประเด็นครบถ้วนให้ตั้ง answer_status = "ANSWERED" ได้)
         - กรณีที่ 2: ผู้รับโอนอสังหาริมทรัพย์มิใช่บุตรชอบด้วยกฎหมายของผู้โอน (เช่น บุตรบุญธรรม หลานสาว หลานชาย บุตรของหลาน พี่น้อง บุคคลอื่น หรือคำว่า "หลาน" ยังคลุมเครือ): ห้ามสรุปว่าผู้รับโอน "ไม่ต้องเสียภาษี", "ไม่มีภาระภาษีเงินได้", "ไม่ต้องนำมารวมคำนวณ" หรือระบุจำนวนเงินภาษีของผู้รับโอนเป็นตัวเลขใดๆ รวมถึงห้ามระบุ 0 หรือ 0 บาท เด็ดขาด! ให้คงสถานะไม่ชี้ขาดและชี้แจงข้อจำกัดตามตัวบทใน PASSAGE_PACK ว่า มาตรา 41 ทวิ เป็นบทบัญญัติกำหนดฝั่งผู้โอน และมาตรา 42 (26) กำหนดข้อยกเว้นเฉพาะกรณีโอนอสังหาริมทรัพย์ให้บุตรชอบด้วยกฎหมาย ส่วนตัวบทมาตรา 41 ทวิ และมาตรา 42 (26)-(28) ในชุดหลักฐานที่ตรวจสอบแล้วไม่ได้บัญญัติสรุปภาระภาษีเงินได้บุคคลธรรมดาหรือวงเงินยกเว้นเฉพาะฝั่งผู้รับโอนอสังหาริมทรัพย์กรณีนี้ไว้โดยตรง (หากคำถามระบุ "หลานสาว/หลานชาย" โดยไม่ระบุสายโลหิต หรือเป็นการให้ในงานบวชของบุคคลอื่น ให้ชี้แจงความกำกวมของข้อเท็จจริงและขอบเขตถ้อยคำตามมาตรา 42 (27)-(28) ประกอบด้วย) จึงไม่อาจระบุภาระภาษีเงินได้ของผู้รับโอนเป็นตัวเลขใดๆ ได้ (รวมถึงห้ามระบุ 0 บาท) ตั้ง proposed_calculation = null และตั้ง answer_status = "CONDITIONAL"
     (ง) ภาษีธุรกิจเฉพาะสำหรับการโอนอสังหาริมทรัพย์ (เมื่อมีตัวบทมาตรา 91/2 (6) และพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 ใน PASSAGE_PACK และข้อเท็จจริงระบุวิธีได้มาหรือระยะเวลาถือครอง เช่น ได้รับมรดก หรือซื้อมาภายใน/เกิน 5 ปี): ให้วิเคราะห์ประเด็นภาษีธุรกิจเฉพาะควบคู่กันอย่างกระชับพร้อมใส่ passage_id ของมาตรา 91/2 และพระราชกฤษฎีกา (ฉบับที่ 342) ใน governing_passage_ids ด้วย (เช่น อสังหาริมทรัพย์ที่ผู้โอนได้รับมาโดยทางมรดกไม่อยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะตามมาตรา 91/2 (6) ประกอบพระราชกฤษฎีกา (ฉบับที่ 342) พ.ศ. 2541 มาตรา 4 (6) (ข) หรือกรณีบิดามารดาโอนให้บุตรชอบด้วยกฎหมายแต่ไม่รวมถึงบุตรบุญธรรมตามมาตรา 4 (6) (ง))
   - สำหรับการให้สังหาริมทรัพย์หรือเงินสด (เช่น มอบเงินสดหรือโอนเงินสดผ่านธนาคารให้บิดา/มารดาซึ่งเป็นบุพการี): ใช้มาตรา 42 (27) (ยกเว้นส่วนที่ไม่เกิน 20,000,000 บาทตลอดปีภาษี) และมาตรา 48 (6) (ส่วนที่เกิน 20,000,000 บาท เลือกเสียภาษีอัตราร้อยละ 5 ได้); สำหรับผู้โอนและธนาคารในการโอนเงินสดให้โดยเสน่หา ธนาคารไม่มีหน้าที่หักภาษีเงินได้ ณ ที่จ่ายตามมาตรา 50 และธุรกรรมโอนเงินสดผ่านธนาคารไม่อยู่ในบัญชีอัตราอากรแสตมป์ที่ต้องเสียอากรแสตมป์ตามมาตรา 103 และมาตรา 104 (สำหรับประเด็นที่ไม่มีหน้าที่หักภาษี ณ ที่จ่ายหรือไม่อยู่ในบังคับต้องเสียอากรแสตมป์ ห้ามส่ง proposed_calculation หรือให้ตั้ง is_computable_from_stated_facts = false, computed_tax_thb = null และห้ามเขียนสรุปเป็นตัวเลข 0 บาท; และหากแยกประเด็นภาระภาษีเงินได้บุคคลธรรมดาของผู้รับเงินสดตามมาตรา 42 (27) และมาตรา 48 (6) ออกต่างหากแล้ว ในประเด็นผู้รับเงินสดห้ามกล่าวซ้ำคำว่า "หักภาษี ณ ที่จ่าย" หรือ "อากรแสตมป์" เพื่อไม่ให้ปะปนข้ามหมวดภาษี)
   - ห้ามสรุปตัวเลขภาษีที่คำนวณไม่ได้หากขาดข้อมูลสำคัญ (เช่น วิธีการได้มา ระยะเวลาถือครอง หรือราคาประเมินทุนทรัพย์ของทางราชการ) ให้ตั้งค่า is_computable_from_stated_facts = false, computed_tax_thb = null และระบุ missing_inputs_th ให้ชัดเจน
4. กรณีหลักฐานใน PASSAGE_PACK ครอบคลุมเพียงบางส่วน หรือมีการอ้างอิงข้ามตัวบท:
   - หากตัวบทแม่บทใน PASSAGE_PACK กล่าวถึงพระราชกฤษฎีกาเพียงในวงเล็บอ้างอิง เช่น "( ดูพระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529 )" ในมาตรา 50 (5) (ข) หรือมาตรา 48 (4) (ข) โดยไม่มีตัวบทมาตราของพระราชกฤษฎีกาฉบับนั้นแยกอยู่ใน PASSAGE_PACK ห้ามประดิษฐ์เลขมาตราของพระราชกฤษฎีกานั้น (เช่น ห้ามเขียน "พระราชกฤษฎีกา (ฉบับที่ 165) มาตรา 4") ให้ระบุชื่อ "พระราชกฤษฎีกา (ฉบับที่ 165) พ.ศ. 2529" ตามที่อ้างในมาตรา 50 (5) (ข) / มาตรา 48 (4) (ข) และระบุใน evidence_gaps_th ว่าตารางอัตราค่าใช้จ่ายเหมาตามจำนวนปีถือครองในพระราชกฤษฎีกาดังกล่าวไม่ได้รวมอยู่ในชุดหลักฐานที่ส่งให้
   - หาก special_constraints ในข้อมูลคำขอระบุ unresolved_explicit_ruling_ids (ผู้ใช้ถามยืนยันเลขที่หนังสือตอบข้อหารือ กค ที่ไม่พบใน PASSAGE_PACK) หรือ pre_cutoff_vat_coverage_constraint (ธุรกรรม VAT ก่อนวันที่ 1 ตุลาคม 2566 ซึ่งอยู่นอกขอบเขตพระราชกฤษฎีกาลดอัตรา VAT ที่รับรองต้นฉบับแล้วในคลังรุ่นนี้): ต้องตั้ง answer_status = "INSUFFICIENT_EVIDENCE", issues = [] และชี้แจงข้อจำกัดใน overall_summary_th และ evidence_gaps_th โดยห้ามเดาอัตราภาษี ห้ามคำนวณตัวเลขภาษี และห้ามนำบทบัญญัติอื่นมาสรุปยืนยันแทนข้อหารือที่ไม่มีต้นฉบับ หากระบุ needs_vat_date_clarification หรือตั้ง answer_status = "NEEDS_CLARIFICATION" ให้ถามวันรับชำระเงินและวันออกใบกำกับภาษีใน clarification_questions_th ตั้ง proposed_calculation = null ทุกประเด็น และห้ามระบุตัวเลขภาษีที่คำนวณสมมติไว้ล่วงหน้าในข้อความเด็ดขาด
   - กรณีอื่นๆ ที่หลักฐานครอบคลุมบางส่วน ให้ตอบเฉพาะส่วนที่มีหลักฐานรองรับ ตั้ง answer_status = "CONDITIONAL" หรือ "NEEDS_CLARIFICATION" และระบุช่องว่างหลักฐานใน evidence_gaps_th โดยห้ามเดาเลขพระราชกฤษฎีกาที่ไม่มีใน PASSAGE_PACK
5. เขียนคำตอบภาษาไทยที่เป็นมืออาชีพ กระชับ ชัดเจน นำบทบัญญัติมาปรับใช้กับข้อเท็จจริงโดยตรง ห้ามคัดลอกตัวบทกฎหมายทั้งดุ้นมาแปะแทนการวิเคราะห์
6. ส่งคืนเป็น JSON ที่ตรงตาม schema ที่กำหนดเท่านั้น`;

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_PRICING_USD_PER_1M[model] || { input: 1.25, output: 10.0 };
  const cost = (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  return Number(cost.toFixed(6));
}

function classifyProviderFailure(
  httpStatus: number | null,
  message: string
): ProviderFailureClassification {
  const m = (message || "").toLowerCase();
  if (httpStatus === 429 || /rate limit|quota|free tier|limit:\s*0/.test(m)) {
    return "RATE_LIMIT_429_FREE_TIER";
  }
  if (/abort|timeout|timed out/.test(m)) return "TIMEOUT";
  if (/invalid json|missing required|syntaxerror|unexpected token/.test(m)) {
    return "INVALID_OUTPUT";
  }
  if (/blocked|safety|incomplete|content_filter|refusal/.test(m)) {
    return "BLOCKED_OR_INCOMPLETE";
  }
  return "PROVIDER_UNAVAILABLE";
}

function extractOutputTextFromGeminiInteraction(interaction: unknown): {
  text: string;
  resolvedModel: string | null;
  status: string | null;
} {
  const obj = interaction as Record<string, unknown> | null;
  if (!obj) return { text: "", resolvedModel: null, status: null };
  const resolvedModel = typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : null;
  const status = typeof obj.status === "string" && obj.status.trim() ? obj.status.trim() : null;

  if (typeof obj.output_text === "string" && obj.output_text.trim()) {
    return { text: obj.output_text.trim(), resolvedModel, status };
  }
  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Record<string, unknown>;
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      const texts = step.content
        .map((c: Record<string, unknown>) => (typeof c?.text === "string" ? c.text : ""))
        .filter(Boolean);
      if (texts.length > 0) return { text: texts.join("\n").trim(), resolvedModel, status };
    }
  }
  const outputs = Array.isArray(obj.outputs) ? obj.outputs : [];
  for (let i = outputs.length - 1; i >= 0; i--) {
    const out = outputs[i] as Record<string, unknown>;
    if (typeof out?.text === "string" && out.text.trim()) {
      return { text: out.text.trim(), resolvedModel, status };
    }
  }
  return { text: "", resolvedModel, status };
}

export interface GroundedLlmSpecialConstraints {
  unresolved_explicit_ruling_ids?: string[];
  pre_cutoff_vat_coverage_constraint?: {
    controlling_date_iso: string;
    raw_date_text: string;
    verified_vat_window_start_iso: "2023-10-01";
  } | null;
  needs_vat_date_clarification?: boolean;
  rd646_original_sec4_limitation?: boolean;
}

export function buildGroundedLlmUserPrompt(params: {
  question: string;
  factLedger: StructuredCaseFactLedger;
  passagePack: GroundedPassagePackItem[];
  specialConstraints?: GroundedLlmSpecialConstraints;
}): string {
  const hasSbtInPack = params.passagePack.some(
    (p) =>
      p.work_id === "prov.th.rc.91_6" ||
      p.work_id === "prov.th.rc.91/6" ||
      p.work_id === "subreg.th.rc.royal_decree.342"
  );
  const hasGoverningSbt33 = params.passagePack.some(
    (p) => p.evidence_role === "governing" && /(?<![0-9.])3\.3(?![0-9])/.test(p.verbatim_text || "")
  );
  const hasGoverningRd646 =
    Boolean(params.specialConstraints?.rd646_original_sec4_limitation) ||
    params.passagePack.some(
      (p) => p.work_id === "subreg.th.rc.royal_decree.646" && p.evidence_role === "governing"
    );
  const packGroundingReminders: string[] = [];
  if (hasSbtInPack && !hasGoverningSbt33) {
    packGroundingReminders.push(
      "สำหรับประเด็นภาษีธุรกิจเฉพาะ: ตัวบทกฎหมายบังคับใน PASSAGE_PACK (มาตรา 91/6 (3)) บัญญัติเฉพาะอัตราร้อยละ 3.0 โดยไม่มีตัวบทกฎหมายจัดสรรภาษีท้องถิ่นร้อยละ 0.3 / 3.3 เป็น governing statute ดังนั้นห้ามเขียนตัวเลข 3.3, 3.3% หรือ 0.3% ใน conclusion_th หรือ application_explanation_th เด็ดขาด ให้ระบุเฉพาะอัตราร้อยละ 3.0 ตามมาตรา 91/6 (3) เท่านั้น"
    );
  }
  if (hasGoverningRd646) {
    packGroundingReminders.push(
      "สำหรับวันเกิดความรับผิดในช่วง 1 ตุลาคม 2560 ถึง 30 กันยายน 2561 (2017-10-01 ถึง 2018-09-30): ให้ตั้ง answer_status = 'CONDITIONAL' สรุปคำตอบแบบจำกัดขอบเขตว่าใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 7.0 (ร้อยละ 6.3 ตามพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 รวมภาษีท้องถิ่นร้อยละ 0.7 ตามคู่มือกรมสรรพากร) พร้อมคำนวณภาษีขายและยอดรวมทั้งสิ้นตามฐานค่าบริการที่ระบุในโจทย์ และต้องระบุหมายเหตุข้อจำกัดไว้ทั้งในคำอธิบายและใน evidence_gaps_th อย่างชัดเจนว่า 'ตัวบทมาตรา 4 ฉบับแรกเริ่มตามราชกิจจานุเบกษาของพระราชกฤษฎีกา (ฉบับที่ 646) พ.ศ. 2560 ไม่ได้แยกอยู่ในคลังหลักฐาน (คลังมีเฉพาะไฟล์ประมวลของกรมสรรพากรซึ่งแสดงข้อความมาตรา 4 ที่แก้ไขเพิ่มเติมในภายหลัง)'"
    );
  }
  if (params.specialConstraints?.needs_vat_date_clarification) {
    packGroundingReminders.push(
      "สำหรับคำถามที่ยังไม่ระบุวันเกิดความรับผิดทางภาษีมูลค่าเพิ่ม (needs_vat_date_clarification = true): ให้ตั้ง answer_status = 'NEEDS_CLARIFICATION', สร้าง issues เพียง 1 ประเด็นกระชับเพื่อระบุหลักเกณฑ์วันเกิดความรับผิดตามมาตรา 78/1 (1) (สำหรับบริการ) หรือมาตรา 78 (สำหรับขายสินค้า) ประกอบเพดานอัตราตามมาตรา 80 และการลดอัตราเป็นการชั่วคราวตามช่วงเวลาของพระราชกฤษฎีกาใน PASSAGE_PACK โดยตั้ง proposed_calculation = null (ห้ามคำนวณตัวเลขภาษีตายตัวและห้ามเขียนแจกแจงซ้ำซ้อนยาวเกินความจำเป็น) พร้อมถามวันรับชำระเงินและวันออกใบกำกับภาษีอย่างชัดเจนใน clarification_questions_th"
    );
  }
  if (params.passagePack.some((p) => p.work_id === "prov.th.rc.47")) {
    packGroundingReminders.push(
      "สำหรับคำถามสิทธิหักลดหย่อนตามประมวลรัษฎากร มาตรา 47: ให้อ้างอิง passage_id ของมาตรา 47 ที่ระบุรายการลดหย่อนนั้นโดยตรง (เช่น psg.e4ec78f644930e สำหรับมาตรา 47 (1) (ก) ผู้มีเงินได้ 60,000 บาท, (ข) สามีหรือภริยา 60,000 บาท, (ค) (1) บุตรชอบด้วยกฎหมายคนละ 30,000 บาท และบวกเพิ่มอีกคนละ 30,000 บาทเฉพาะบุตรชอบด้วยกฎหมายตั้งแต่คนที่สองเป็นต้นไปที่เกิดในหรือหลังปี พ.ศ. 2561 เท่านั้น — หากบุตรเกิดก่อนปี พ.ศ. 2561 ห้ามบวกเพิ่ม 30,000 บาท) แสดงรายละเอียดแต่ละรายการและผลรวมค่าลดหย่อนใน conclusion_th และ application_explanation_th ให้ครบถ้วน และหากโจทย์ถามเฉพาะยอดรวมค่าลดหย่อนโดยไม่ได้ถามภาษีที่ต้องชำระตามอัตราก้าวหน้า ให้ตั้ง proposed_calculation = null"
    );
  }
  const payload = {
    active_user_question: params.question,
    ...(params.specialConstraints ? { special_constraints: params.specialConstraints } : {}),
    ...(packGroundingReminders.length > 0
      ? { pack_grounding_reminders_th: packGroundingReminders }
      : {}),
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
      work_id: p.work_id,
      official_identifier: p.official_identifier,
      title_th: p.title_th,
      authority_tier: p.authority_tier,
      evidence_role: p.evidence_role,
      ...(p.applicable_tax_point_dates
        ? {
            applicable_tax_point_dates: p.applicable_tax_point_dates,
            excluded_tax_point_dates: p.excluded_tax_point_dates || [],
          }
        : {}),
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

/**
 * Separate Challenger Adapter: OpenAI Responses API (`gpt-6.2-astra`).
 * Invoked ONLY when explicitly selected via `challengerProvider: "openai"` or
 * `REG24_GROUNDED_LLM_PROVIDER=openai`. NEVER called as an automatic fallback!
 */
async function invokeOpenAiResponsesChallenger(params: {
  model: string;
  thinkingLevel: GroundedThinkingLevel;
  maxOutputTokens: number;
  timeoutMs: number;
  userPrompt: string;
  thinkingNote: string | null;
}): Promise<{
  ok: boolean;
  draft: GroundedLlmDraftResponse | null;
  invocation_audit: ProviderInvocationAudit;
  raw_output_text: string | null;
}> {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  const overallStart = Date.now();
  const pinnedSettings = {
    thinking_level: params.thinkingLevel,
    thinking_level_note: params.thinkingNote,
    temperature: 0.0,
    max_output_tokens: params.maxOutputTokens,
    timeout_ms: params.timeoutMs,
    store: false as const,
  };

  if (!apiKey) {
    return {
      ok: false,
      draft: null,
      raw_output_text: null,
      invocation_audit: {
        provider: "openai",
        api_surface: "openai-responses-v1",
        requested_model: params.model,
        resolved_model: null,
        actual_model_invoked: null,
        pinned_settings: pinnedSettings,
        prompt_version: GROUNDED_LLM_PROMPT_VERSION,
        live_provider_called: false,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: null,
        failure_classification: "MISSING_CREDENTIALS",
        latency_ms: Date.now() - overallStart,
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        attempts: [],
        error_summary: "OPENAI_API_KEY is not configured in the staging environment.",
      },
    };
  }

  const attempts: ProviderAttemptRecord[] = [];
  const attemptStart = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        store: false,
        instructions: GROUNDED_SYSTEM_INSTRUCTION,
        input: params.userPrompt,
        reasoning: {
          effort: params.thinkingLevel === "minimal" ? "low" : params.thinkingLevel,
        },
        max_output_tokens: params.maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "reg24_grounded_legal_draft",
            strict: true,
            schema: buildOpenAiStrictSchema(GROUNDED_LLM_RESPONSE_SCHEMA),
          },
        },
      }),
    });
    clearTimeout(timer);

    const attemptLatency = Date.now() - attemptStart;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errMsg = String(
        (body?.error as Record<string, unknown>)?.message || `OpenAI Responses API HTTP ${res.status}`
      );
      attempts.push({
        provider: "openai",
        model: params.model,
        thinking_level: params.thinkingLevel,
        status: "error",
        http_status: res.status,
        latency_ms: attemptLatency,
        error_message: errMsg.slice(0, 300),
      });
      return {
        ok: false,
        draft: null,
        raw_output_text: null,
        invocation_audit: {
          provider: "openai",
          api_surface: "openai-responses-v1",
          requested_model: params.model,
          resolved_model: typeof body.model === "string" ? body.model : null,
          actual_model_invoked: null,
          pinned_settings: pinnedSettings,
          prompt_version: GROUNDED_LLM_PROMPT_VERSION,
          live_provider_called: true,
          silent_fallback_disabled: true,
          provider_interaction_id: typeof body.id === "string" ? body.id : null,
          provider_response_status: typeof body.status === "string" ? body.status : null,
          failure_classification: classifyProviderFailure(res.status, errMsg),
          latency_ms: Date.now() - overallStart,
          input_tokens: 0,
          output_tokens: 0,
          thought_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          attempts,
          error_summary: errMsg.slice(0, 300),
        },
      };
    }

    const respStatus = typeof body.status === "string" ? body.status : "completed";
    const resolvedModel = typeof body.model === "string" ? body.model : params.model;
    const outputText =
      typeof body.output_text === "string" && body.output_text.trim()
        ? body.output_text.trim()
        : Array.isArray(body.output)
          ? (body.output as Array<Record<string, unknown>>)
              .flatMap((item) =>
                Array.isArray(item.content)
                  ? (item.content as Array<Record<string, unknown>>)
                      .map((c) => (typeof c.text === "string" ? c.text : ""))
                      .filter(Boolean)
                  : []
              )
              .join("\n")
              .trim()
          : "";

    if (respStatus !== "completed" || !outputText) {
      const msg = `OpenAI Responses returned status='${respStatus}' with incomplete or empty output.`;
      attempts.push({
        provider: "openai",
        model: params.model,
        thinking_level: params.thinkingLevel,
        status: "error",
        http_status: res.status,
        latency_ms: attemptLatency,
        error_message: msg,
      });
      return {
        ok: false,
        draft: null,
        raw_output_text: outputText || null,
        invocation_audit: {
          provider: "openai",
          api_surface: "openai-responses-v1",
          requested_model: params.model,
          resolved_model: resolvedModel,
          actual_model_invoked: resolvedModel,
          pinned_settings: pinnedSettings,
          prompt_version: GROUNDED_LLM_PROMPT_VERSION,
          live_provider_called: true,
          silent_fallback_disabled: true,
          provider_interaction_id: typeof body.id === "string" ? body.id : null,
          provider_response_status: respStatus,
          failure_classification: "BLOCKED_OR_INCOMPLETE",
          latency_ms: Date.now() - overallStart,
          input_tokens: 0,
          output_tokens: 0,
          thought_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          attempts,
          error_summary: msg,
        },
      };
    }

    const parsed = normalizeParsedDraftResponse(JSON.parse(outputText) as GroundedLlmDraftResponse);
    if (!parsed || !Array.isArray(parsed.issues)) {
      throw new Error("Invalid JSON output: missing required 'issues' array.");
    }
    const usage = (body.usage || {}) as Record<string, unknown>;
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const thoughtTokens = Number(
      (usage.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens ?? 0
    );
    const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens);

    attempts.push({
      provider: "openai",
      model: params.model,
      thinking_level: params.thinkingLevel,
      status: "succeeded",
      http_status: res.status,
      latency_ms: attemptLatency,
    });

    return {
      ok: true,
      draft: parsed,
      raw_output_text: outputText,
      invocation_audit: {
        provider: "openai",
        api_surface: "openai-responses-v1",
        requested_model: params.model,
        resolved_model: resolvedModel,
        actual_model_invoked: resolvedModel,
        pinned_settings: pinnedSettings,
        prompt_version: GROUNDED_LLM_PROMPT_VERSION,
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: typeof body.id === "string" ? body.id : null,
        provider_response_status: respStatus,
        failure_classification: "NONE",
        latency_ms: Date.now() - overallStart,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        thought_tokens: thoughtTokens,
        total_tokens: totalTokens,
        estimated_cost_usd: estimateCostUsd(resolvedModel, inputTokens, outputTokens),
        attempts,
        error_summary: null,
      },
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const attemptLatency = Date.now() - attemptStart;
    attempts.push({
      provider: "openai",
      model: params.model,
      thinking_level: params.thinkingLevel,
      status: "error",
      http_status: null,
      latency_ms: attemptLatency,
      error_message: msg.slice(0, 300),
    });
    return {
      ok: false,
      draft: null,
      raw_output_text: null,
      invocation_audit: {
        provider: "openai",
        api_surface: "openai-responses-v1",
        requested_model: params.model,
        resolved_model: null,
        actual_model_invoked: null,
        pinned_settings: pinnedSettings,
        prompt_version: GROUNDED_LLM_PROMPT_VERSION,
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: null,
        failure_classification: classifyProviderFailure(null, msg),
        latency_ms: Date.now() - overallStart,
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        attempts,
        error_summary: msg.slice(0, 300),
      },
    };
  }
}

export async function draftGroundedLegalAnswerWithLlm(params: {
  question: string;
  factLedger: StructuredCaseFactLedger;
  passagePack: GroundedPassagePackItem[];
  specialConstraints?: GroundedLlmSpecialConstraints;
  challengerProvider?: GroundedLlmProviderId | null;
  overrideModel?: string | null;
  thinkingLevel?: GroundedThinkingLevel | null;
  timeoutMs?: number;
  mockInvokerForTesting?: (args: {
    question: string;
    userPrompt: string;
    requestedModel: string;
    thinkingLevel: GroundedThinkingLevel;
    specialConstraints?: GroundedLlmSpecialConstraints;
  }) => Promise<GroundedLlmDraftResponse> | GroundedLlmDraftResponse;
}): Promise<{
  ok: boolean;
  draft: GroundedLlmDraftResponse | null;
  invocation_audit: ProviderInvocationAudit;
  raw_output_text: string | null;
}> {
  const { provider, requestedModel } = resolveConfiguredProviderAndModel({
    challengerProvider: params.challengerProvider,
    overrideModel: params.overrideModel,
  });

  const envThinking = (process.env.REG24_GROUNDED_LLM_THINKING_LEVEL || "").trim().toLowerCase() as
    | GroundedThinkingLevel
    | "";
  const requestedThinking: GroundedThinkingLevel | null =
    params.thinkingLevel ||
    (envThinking === "minimal" ||
    envThinking === "low" ||
    envThinking === "medium" ||
    envThinking === "high"
      ? envThinking
      : null);

  const { thinking_level, max_output_tokens, note: thinkingNote } = resolveThinkingLevelForModel(
    requestedModel,
    requestedThinking
  );

  // Give Gemini 4 reasoning models enough synchronous budget (180s default, safely inside route maxDuration=300s)
  // so complex multi-branch conditional VAT reasoning at low/high isn't prematurely aborted at 120s.
  const isGemini4Family = /^gemini-4(?:\b|-)/i.test(requestedModel);
  const timeoutMs =
    params.timeoutMs ?? (isGemini4Family ? 240_000 : thinking_level === "high" ? 90_000 : 60_000);
  const userPrompt = buildGroundedLlmUserPrompt({
    question: params.question,
    factLedger: params.factLedger,
    passagePack: params.passagePack,
    specialConstraints: params.specialConstraints,
  });

  if (params.mockInvokerForTesting && process.env.VERCEL_ENV !== "production") {
    const mockStart = Date.now();
    const rawDraft = await params.mockInvokerForTesting({
      question: params.question,
      userPrompt,
      requestedModel,
      thinkingLevel: thinking_level,
      specialConstraints: params.specialConstraints,
    });
    const normalized = normalizeParsedDraftResponse(rawDraft, params.passagePack);
    const rawText = JSON.stringify(normalized);
    return {
      ok: true,
      draft: normalized,
      raw_output_text: rawText,
      invocation_audit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: requestedModel,
        resolved_model: requestedModel,
        actual_model_invoked: requestedModel,
        pinned_settings: {
          thinking_level,
          thinking_level_note: thinkingNote,
          temperature: 0.0,
          max_output_tokens,
          timeout_ms: timeoutMs,
          store: false,
        },
        prompt_version: GROUNDED_LLM_PROMPT_VERSION,
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: "mock.interaction.test",
        provider_response_status: "completed",
        failure_classification: "NONE",
        latency_ms: Math.max(1, Date.now() - mockStart),
        input_tokens: 512,
        output_tokens: 256,
        thought_tokens: 64,
        total_tokens: 832,
        estimated_cost_usd: 0.0038,
        attempts: [
          {
            provider: "google-gemini",
            model: requestedModel,
            thinking_level,
            status: "succeeded",
            http_status: 200,
            latency_ms: Math.max(1, Date.now() - mockStart),
          },
        ],
        error_summary: null,
      },
    };
  }

  // Separate explicit OpenAI Responses API challenger path (never triggered automatically as fallback!)
  if (provider === "openai") {
    return invokeOpenAiResponsesChallenger({
      model: requestedModel,
      thinkingLevel: thinking_level,
      maxOutputTokens: max_output_tokens,
      timeoutMs,
      userPrompt,
      thinkingNote,
    });
  }

  // Primary Google Gemini Interactions API path — SINGLE PINNED MODEL, ZERO SILENT SWITCH TO FLASH/FLASH-LITE!
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();
  const overallStart = Date.now();
  const pinnedSettings = {
    thinking_level,
    thinking_level_note: thinkingNote,
    temperature: 0.0,
    max_output_tokens,
    timeout_ms: timeoutMs,
    store: false as const,
  };

  if (!apiKey) {
    return {
      ok: false,
      draft: null,
      raw_output_text: null,
      invocation_audit: {
        provider: "google-gemini",
        api_surface: "interactions-v1beta",
        requested_model: requestedModel,
        resolved_model: null,
        actual_model_invoked: null,
        pinned_settings: pinnedSettings,
        prompt_version: GROUNDED_LLM_PROMPT_VERSION,
        live_provider_called: false,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: null,
        failure_classification: "MISSING_CREDENTIALS",
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

  const client = new GoogleGenAI({ apiKey });
  const attempts: ProviderAttemptRecord[] = [];
  const maxSameModelAttempts = 2;
  let lastFailureClass: ProviderFailureClassification = "PROVIDER_UNAVAILABLE";
  let lastErrorMsg = "Unknown provider failure";
  let lastResolvedModel: string | null = null;
  let lastInteractionId: string | null = null;
  let lastProviderStatus: string | null = null;
  let lastRawOutputText: string | null = null;

  for (let attemptIdx = 0; attemptIdx < maxSameModelAttempts; attemptIdx++) {
    const elapsedMs = Date.now() - overallStart;
    const remainingBudgetMs = timeoutMs - elapsedMs;
    if (attemptIdx > 0 && remainingBudgetMs < 55_000) {
      break;
    }
    const perAttemptTimeoutMs =
      attemptIdx === 0 && timeoutMs >= 200_000
        ? Math.min(remainingBudgetMs, 115_000)
        : Math.max(20_000, remainingBudgetMs);
    const attemptStart = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), perAttemptTimeoutMs);
      let interaction: Awaited<ReturnType<typeof client.interactions.create>>;
      try {
        interaction = await client.interactions.create(
          {
            model: requestedModel,
            store: false,
            system_instruction: GROUNDED_SYSTEM_INSTRUCTION,
            input: userPrompt,
            generation_config: {
              temperature: 0.0,
              max_output_tokens,
              thinking_level,
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
      const {
        text: outputText,
        resolvedModel,
        status: providerStatus,
      } = extractOutputTextFromGeminiInteraction(interaction);
      const effectiveModel = resolvedModel || requestedModel;
      const interactionId =
        typeof (interaction as unknown as Record<string, unknown>)?.id === "string"
          ? String((interaction as unknown as Record<string, unknown>).id)
          : null;

      // Handle blocked / incomplete / empty response: allow 1 same-model retry when budget permits, NEVER switch models!
      if (
        (providerStatus &&
          providerStatus !== "completed" &&
          providerStatus !== "COMPLETED") ||
        !outputText
      ) {
        const msg = `Provider returned status='${providerStatus || "empty"}' without complete output.`;
        attempts.push({
          provider: "google-gemini",
          model: requestedModel,
          thinking_level,
          status: "error",
          http_status: 200,
          latency_ms: attemptLatency,
          error_message: msg,
        });
        lastFailureClass = "BLOCKED_OR_INCOMPLETE";
        lastErrorMsg = msg;
        lastResolvedModel = resolvedModel;
        lastInteractionId = interactionId;
        lastProviderStatus = providerStatus;
        lastRawOutputText = outputText || null;
        continue;
      }

      const parsed = normalizeParsedDraftResponse(
        JSON.parse(outputText) as GroundedLlmDraftResponse,
        params.passagePack
      );
      if (!parsed || !Array.isArray(parsed.issues)) {
        throw new Error("Invalid JSON output: missing required 'issues' array.");
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

      attempts.push({
        provider: "google-gemini",
        model: requestedModel,
        thinking_level,
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
          resolved_model: resolvedModel,
          actual_model_invoked: effectiveModel,
          pinned_settings: pinnedSettings,
          prompt_version: GROUNDED_LLM_PROMPT_VERSION,
          live_provider_called: true,
          silent_fallback_disabled: true,
          provider_interaction_id: interactionId,
          provider_response_status: providerStatus || "completed",
          failure_classification: "NONE",
          latency_ms: Date.now() - overallStart,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          thought_tokens: thoughtTokens,
          total_tokens: totalTokens,
          estimated_cost_usd: estimateCostUsd(effectiveModel, inputTokens, outputTokens + thoughtTokens),
          attempts,
          error_summary: null,
        },
      };
    } catch (err) {
      const attemptLatency = Date.now() - attemptStart;
      const msg = err instanceof Error ? err.message : String(err);
      const statusMatch = msg.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
      const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
      const failureClass = classifyProviderFailure(httpStatus, msg);

      attempts.push({
        provider: "google-gemini",
        model: requestedModel,
        thinking_level,
        status: "error",
        http_status: httpStatus,
        latency_ms: attemptLatency,
        error_message: msg.slice(0, 320),
      });

      lastFailureClass = failureClass;
      lastErrorMsg = msg.slice(0, 320);

      // Retry SAME pinned model once only on transient incomplete / JSON / 5xx / per-attempt timeout (never on 401/403/404/429)
      const isRetryableSameModel =
        failureClass === "BLOCKED_OR_INCOMPLETE" ||
        failureClass === "INVALID_OUTPUT" ||
        failureClass === "TIMEOUT" ||
        (failureClass === "PROVIDER_UNAVAILABLE" &&
          (httpStatus === null || httpStatus >= 500));
      if (!isRetryableSameModel) {
        break;
      }
    }
  }

  // NO SILENT FALLBACK TO FLASH / FLASH-LITE / OPENAI / TEMPLATES!
  return {
    ok: false,
    draft: null,
    raw_output_text: lastRawOutputText,
    invocation_audit: {
      provider: "google-gemini",
      api_surface: "interactions-v1beta",
      requested_model: requestedModel,
      resolved_model: lastResolvedModel,
      actual_model_invoked: lastResolvedModel || requestedModel,
      pinned_settings: pinnedSettings,
      prompt_version: GROUNDED_LLM_PROMPT_VERSION,
      live_provider_called: true,
      silent_fallback_disabled: true,
      provider_interaction_id: lastInteractionId,
      provider_response_status: lastProviderStatus,
      failure_classification: lastFailureClass,
      latency_ms: Date.now() - overallStart,
      input_tokens: 0,
      output_tokens: 0,
      thought_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      attempts,
      error_summary: lastErrorMsg,
    },
  };
}
