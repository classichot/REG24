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
    const isConsolidatedHistoricalVatExcluded =
      EXCLUDED_CONSOLIDATED_HISTORICAL_VAT_WORK_IDS.has(p.work_id) &&
      ver?.draft_or_enacted_status !== "ENACTED_ORIGINAL";
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

function normalizeParsedDraftResponse(raw: GroundedLlmDraftResponse): GroundedLlmDraftResponse {
  return {
    ...raw,
    case_facts_used: Array.isArray(raw.case_facts_used) ? raw.case_facts_used : [],
    assumptions_th: Array.isArray(raw.assumptions_th) ? raw.assumptions_th : [],
    clarification_questions_th: Array.isArray(raw.clarification_questions_th)
      ? raw.clarification_questions_th
      : [],
    evidence_gaps_th: Array.isArray(raw.evidence_gaps_th) ? raw.evidence_gaps_th : [],
    issues: (raw.issues || []).map((iss) => ({
      ...iss,
      material_facts_relied_on: Array.isArray(iss.material_facts_relied_on)
        ? iss.material_facts_relied_on
        : [],
      governing_passage_ids: Array.isArray(iss.governing_passage_ids)
        ? iss.governing_passage_ids
        : [],
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
    })),
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
   - หากมีหลายเทิร์น ให้ยึดข้อเท็จจริงที่อัปเดตล่าสุดจากเทิร์นหลังทับค่าที่เปลี่ยนไป และคงข้อเท็จจริงเดิมที่ไม่ได้เปลี่ยนไว้
   - แยกแยะวันทำธุรกรรม (transaction date), วันที่อ้างอิงกฎหมาย (legal as-of date) และวันเกิดความรับผิดทางภาษี (controlling tax point เช่น มาตรา 78/1 (1) สำหรับบริการ) ให้ชัดเจน ห้ามสมมติวันที่เองเมื่อวันที่ขาดหายหรือคลุมเครือ
   - กรณีแบ่งรับชำระหลายงวดหรือออกใบกำกับภาษีบางส่วน (split_payment_tax_points มีหลายส่วน): ต้องแยกวิเคราะห์แต่ละส่วนเป็นประเด็นแยกกันโดยระบุวันเกิดความรับผิด จำนวนเงิน และกฎหมายที่ใช้บังคับเฉพาะส่วนนั้นตาม applicable_tax_point_dates ของแต่ละหลักฐาน หากมีการออกใบกำกับภาษีบางส่วนก่อนรับชำระ ความรับผิดของส่วนที่ออกใบกำกับภาษีแล้วเกิดขึ้น ณ วันออกใบกำกับภาษีตามมาตรา 78/1 (1) (การรับชำระเงินสำหรับยอดที่ออกใบกำกับภาษีไว้แล้วในภายหลังไม่ก่อให้เกิดภาระภาษีมูลค่าเพิ่มซ้ำอีก) ส่วนยอดคงเหลือที่ยังไม่ได้ออกใบกำกับภาษีจะเกิดความรับผิดเมื่อรับชำระเงิน หากข้อเท็จจริงไม่ระบุขอบเขตมูลค่าของใบกำกับภาษี (เต็มจำนวนหรือบางส่วน) หรือไม่ระบุการจัดสรรการชำระเงินเมื่อมียอดชำระเท่ากันหลายงวด และข้อเท็จจริงที่ขาดหายเปลี่ยนพระราชกฤษฎีกาที่ใช้บังคับ ห้ามเดาหรืออนุมานเอง ให้ตั้ง answer_status = "CONDITIONAL" ระบุข้อเท็จจริงที่ขาดหายและถามยืนยันใน clarification_questions_th พร้อมนำเสนอเงื่อนไขแยกแต่ละทางเลือกที่มีหลักฐานรองรับโดยไม่เก็บภาษีซ้ำและไม่ตัดยอดตกหล่น ห้ามนำวันที่หรือพระราชกฤษฎีกาของงวดก่อนหน้ามาใช้กับงวดที่อยู่นอกช่วงวันใช้บังคับ (excluded_tax_point_dates) และสำหรับงวดที่เกิดหลังวันสิ้นสุดพระราชกฤษฎีกาชั่วคราว (เช่น หลัง 30 กันยายน 2570) ห้ามอ้างพระราชกฤษฎีกาที่สิ้นสุดแล้วเป็นกฎหมายควบคุมและห้ามสมมติว่าจะมีพระราชกฤษฎีกาขยายเวลาลดอัตราในอนาคต ให้ระบุตามเพดานประมวลรัษฎากร มาตรา 80 เว้นแต่จะมีการตราพระราชกฤษฎีกาฉบับใหม่ก่อนวันเกิดความรับผิดของงวดนั้น
2. อ้างอิงเฉพาะ passage_id ที่มีอยู่จริงใน PASSAGE_PACK ที่ส่งให้เท่านั้น:
   - ห้ามประดิษฐ์เลขมาตรา อนุมาตรา เลขพระราชกฤษฎีกา หรือเลขหนังสือตอบข้อหารือ กค ที่ไม่ปรากฏตรงตัวในข้อความของ PASSAGE_PACK (ตรวจสอบเลขอนุมาตราให้ตรงกับ verbatim_text ของ passage ที่อ้างอิงทุกครั้ง และหากกล่าวถึงอัตรารวมภาษีท้องถิ่นร้อยละ 7 ให้ระบุ passage_id ของคู่มือ/คำแนะนำทางการเรื่องภาษีท้องถิ่นใน governing_passage_ids ด้วย)
   - ตรวจสอบช่วงเวลาใช้บังคับ (valid_from / valid_to) ของทุกกฎหมายลำดับรองและพระราชกฤษฎีกาเทียบกับวันเกิดความรับผิดทางภาษี ห้ามนำพระราชกฤษฎีกาที่อยู่นอกช่วงวันใช้บังคับ (temporal_applicability_hint = "OUT_OF_WINDOW") มาใช้เป็นกฎหมายควบคุมสำหรับธุรกรรมนั้น และห้ามเหมารวมใช้ฉบับล่าสุดเมื่อไม่มีวันที่หรือวันที่อยู่นอกช่วง
   - แยกแยะลำดับศักดิ์แหล่งอ้างอิงอย่างชัดเจน: กฎหมายแม่บท/ประมวลรัษฎากร (CONTROLLING_STATUTE), กฎหมายลำดับรอง/พระราชกฤษฎีกา/ประกาศอธิบดี (CONTROLLING_SUBORDINATE_LEGISLATION), คู่มือ/คำแนะนำ (OFFICIAL_GUIDANCE) และหนังสือตอบข้อหารือเฉพาะราย (CASE_SPECIFIC_TAX_RULING ซึ่งผูกพันเฉพาะข้อเท็จจริงและกฎหมาย ณ เวลาที่วินิจฉัย — หากเป็นข้อหารือก่อนการแก้ไขกฎหมาย พ.ศ. 2558 ให้ระบุข้อจำกัดดังกล่าวอย่างตรงไปตรงมา)
   - ห้ามนำหนังสือตอบข้อหารือที่ไม่ตรงประเภทธุรกรรม (เช่น ข้อหารือส่งออกสินค้า/รองเท้า หรือเงินชดเชยเลิกจ้าง) มาใช้ตอบแทนหลักกฎหมาย
3. แยกวิเคราะห์แต่ละประเด็นและภาระภาษีของแต่ละฝ่ายให้ครบถ้วน รวมทั้งข้อยกเว้นที่เกี่ยวข้อง:
   - สำหรับการโอนอสังหาริมทรัพย์โดยไม่มีค่าตอบแทน (เช่น ห้องชุด/ที่ดิน) ให้แยกประเด็นอย่างชัดเจนเสมอระหว่าง:
     (ก) ภาระภาษีเงินได้และการหักภาษี ณ ที่จ่ายในวันจดทะเบียนของผู้โอน (มาตรา 41 ทวิ, มาตรา 49 ทวิ ที่ใช้ราคาประเมินทุนทรัพย์ของทางราชการมิใช่ราคาตามสัญญา, มาตรา 50 (5)/(6), และข้อยกเว้นมาตรา 42 (26) เฉพาะบุตรชอบด้วยกฎหมายเท่านั้น)
     (ข) ความรับผิดกรณีหักภาษี ณ ที่จ่ายขาดตามมาตรา 54 (หากมี)
     (ค) ภาระภาษีเงินได้บุคคลธรรมดาของผู้รับโอน (ตรวจสอบขอบเขตมาตรา 42 (27) เฉพาะบุพการี ผู้สืบสันดาน หรือคู่สมรส และมาตรา 42 (28) สำหรับการให้ตามหน้าที่ธรรมจรรยาหรือตามพิธี/โอกาสแห่งขนบธรรมเนียมประเพณี และแยกให้ชัดว่าเมื่อโอนอสังหาริมทรัพย์โดยเสน่หา กฎหมายถือว่าผู้โอนเป็นผู้มีเงินได้ตามมาตรา 41 ทวิ พร้อมระบุประเด็นความเห็น/ข้อหารือหากปรากฏใน PASSAGE_PACK)
   - ห้ามสรุปตัวเลขภาษีที่คำนวณไม่ได้หากขาดข้อมูลสำคัญ (เช่น วิธีการได้มา ระยะเวลาถือครอง หรือราคาประเมินทุนทรัพย์ของทางราชการ) ให้ตั้งค่า is_computable_from_stated_facts = false, computed_tax_thb = null และระบุ missing_inputs_th ให้ชัดเจน
4. กรณีหลักฐานใน PASSAGE_PACK ครอบคลุมเพียงบางส่วน (เช่น ขาดตัวบทพระราชกฤษฎีการอบปีก่อนหน้า):
   - ให้ตอบส่วนที่มีหลักฐานรองรับอย่างแม่นยำ (เช่น มาตรา 80 แห่งประมวลรัษฎากร และระบุชัดว่าพระราชกฤษฎีกาฉบับที่ปรากฏในคลังไม่ครอบคลุมวันที่เกิดธุรกรรม) ตั้ง answer_status = "CONDITIONAL" หรือ "NEEDS_CLARIFICATION" และระบุช่องว่างหลักฐานใน evidence_gaps_th โดยห้ามเดาเลขพระราชกฤษฎีกาที่ไม่มีใน PASSAGE_PACK
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
  challengerProvider?: GroundedLlmProviderId | null;
  overrideModel?: string | null;
  thinkingLevel?: GroundedThinkingLevel | null;
  timeoutMs?: number;
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
    params.timeoutMs ?? (isGemini4Family ? 180_000 : thinking_level === "high" ? 90_000 : 60_000);
  const userPrompt = buildGroundedLlmUserPrompt({
    question: params.question,
    factLedger: params.factLedger,
    passagePack: params.passagePack,
  });

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
  const attemptStart = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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

    // Handle blocked / incomplete / empty response explicitly — NEVER pass unverified or truncated output!
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
      return {
        ok: false,
        draft: null,
        raw_output_text: outputText || null,
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
          provider_response_status: providerStatus,
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

    // NO SILENT FALLBACK TO FLASH / FLASH-LITE / OPENAI / TEMPLATES!
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
        live_provider_called: true,
        silent_fallback_disabled: true,
        provider_interaction_id: null,
        provider_response_status: null,
        failure_classification: failureClass,
        latency_ms: Date.now() - overallStart,
        input_tokens: 0,
        output_tokens: 0,
        thought_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        attempts,
        error_summary: msg.slice(0, 320),
      },
    };
  }
}
