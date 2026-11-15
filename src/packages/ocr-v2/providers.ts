/**
 * RAG24 Decoupled OCR Client, Pinned Provider Registry & Continuity Adapter (`REG-002`, Sections 1, 9, 13)
 *
 * Implements:
 * - Pinned Thai OCR candidate providers (OpenThai2.0-OCR-Markdown, Typhoon OCR 2 2B structured full-JSON adapter,
 *   Mistral OCR, Native PDF validator, Human correction workflow)
 * - Zero secret disclosure on provider listing
 * - Strict privacy routing (`restricted` -> approved self-hosted workers ONLY; unavailable self-hosted worker -> `POLICY_BLOCKED`, never cloud fallback)
 * - Documented Continuity Adapter (`ADR-OCR-001`) with retirement flag `OCR_V2_DISABLE_CONTINUITY_ADAPTER`
 */

import {
  OCRBlock,
  OCRBlockKind,
  OCRIssue,
  OCRPage,
  OCRTable,
  PrivacyClass,
  RenderedPageEvidence,
  SourceSpan,
} from "./contract";
import {
  THAI_DETECTOR_VERSION_V2,
  assessNativePageEligibility,
  buildCodePointIndexMap,
  normalizeThaiLegalTextV2,
} from "./thai-normalizer";
import {
  compareDualOcrPassages,
  parseTyphoonV2StructuredResponse,
} from "./typhoon-v2-parser";

export interface OcrProviderDescriptor {
  provider_id: string;
  display_name: string;
  upstream_model_id: string;
  model_revision: string;
  adapter_version: string;
  execution_boundary: "self_hosted_approved" | "cloud_allowlisted" | "deterministic_local" | "human_workflow";
  allowed_privacy_classes: PrivacyClass[];
  capabilities: {
    thai_printed_legal: boolean;
    english_bilingual: boolean;
    tables: boolean;
    headers_footers_footnotes: boolean;
    bounding_polygons: "supported" | "optional_model_dependent" | "none";
    calibrated_confidence: "supported" | "uncalibrated_raw" | "none";
    handwriting: "unsupported_flagged";
  };
  cost_micros_per_page: number;
  currency: "THB";
  worker_available: boolean;
  caution_notes: string[];
}

export interface OcrRoutingPolicy {
  policy_id: string;
  policy_revision: string;
  etag: string;
  purpose: string;
  currency: "THB";
  max_pages_per_document: number;
  max_ocr_attempts_per_page: number; // Default proposed ceiling: 2
  max_document_remediation_cycles: number; // Default proposed ceiling: 1
  tenant_budget_ceiling_micros: number;
  allowed_providers_by_privacy: Record<PrivacyClass, string[]>;
  preferred_thai_ocr_provider: string;
  comparison_thai_ocr_provider: string | null;
  updated_at: string;
  updated_by: string;
}

export const PINNED_OCR_PROVIDERS: OcrProviderDescriptor[] = [
  {
    provider_id: "openthai-2.0-markdown",
    display_name: "OpenThai 2.0 OCR Text/Markdown (Pinned Local ONNX CPU)",
    upstream_model_id: "iapp/OpenThai2.0-OCR-Text",
    model_revision: "39fa41bdd49f067ba41b1d9de79c06ab506d67d4",
    adapter_version: "rag24-openthai-adapter/2.0.0",
    execution_boundary: "self_hosted_approved",
    allowed_privacy_classes: ["public", "internal", "confidential", "restricted"],
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: false,
      headers_footers_footnotes: true,
      bounding_polygons: "supported",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 4500,
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Pinned offline ONNX weights verified on local worker (39fa41bdd49f067ba41b1d9de79c06ab506d67d4).",
      "Lower accuracy on complex Gazette tables and historical handset scans; use Typhoon OCR 2 as primary.",
    ],
  },
  {
    provider_id: "typhoon-ocr2-2b",
    display_name: "Typhoon OCR 2 (2B) — Pinned Self-Hosted Open Weights",
    upstream_model_id: "typhoon-ai/typhoon-ocr2-2b",
    model_revision: "3ea2e5e3d92bf999a64e82a92b11c7b73eae45b0",
    adapter_version: "rag24-typhoon-structured-json/2.0.0",
    execution_boundary: "self_hosted_approved",
    allowed_privacy_classes: ["public", "internal", "confidential", "restricted"],
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: true,
      headers_footers_footnotes: true,
      bounding_polygons: "supported",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 3800,
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Pinned Apache-2.0 open weights (HuggingFace commit 3ea2e5e3d92bf999a64e82a92b11c7b73eae45b0); distinct from hosted api.opentyphoon.ai.",
      "Preserves header, footer, and page_footnote JSON elements and maps 0..1000 bbox coordinates to normalized polygons.",
    ],
  },
  {
    provider_id: "typhoon-ocr-v2-hosted",
    display_name: "Typhoon OCR V2 Hosted API (api.opentyphoon.ai — Public Docs Only)",
    upstream_model_id: "typhoon-ocr-v2",
    model_revision: "typhoon-ocr-v2@vllm-0.33.0-9030f50b",
    adapter_version: "rag24-typhoon-hosted-v2/2.0.0",
    execution_boundary: "cloud_allowlisted",
    allowed_privacy_classes: ["public"], // Strictly PUBLIC ONLY: api.opentyphoon.ai retains prompts for model improvement (non-ZDR)!
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: true,
      headers_footers_footnotes: true,
      bounding_polygons: "supported",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 3800,
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Public research showcase endpoint (2 req/s, 20 req/min); inputs may be used for model improvement.",
      "Strictly prohibited for internal, confidential, and restricted documents (use self-hosted typhoon-ocr2-2b instead).",
    ],
  },
  {
    provider_id: "gemini-3.8-flash-ocr",
    display_name: "Google Gemini 3.8 Flash Multimodal Fallback (store=false)",
    upstream_model_id: "gemini-3.8-flash",
    model_revision: "gemini-3.8-flash@api-rev-2026-05-20",
    adapter_version: "rag24-gemini-interactions-ocr/2.0.0",
    execution_boundary: "cloud_allowlisted",
    allowed_privacy_classes: ["public", "internal"], // Confidential requires verified paid/Vertex ZDR project; never restricted!
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: true,
      headers_footers_footnotes: true,
      bounding_polygons: "none",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 18500,
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Selective fallback / dual-OCR cross-checker for flagged pages (store=false, thinking_level='low').",
      "May return HTTP 400 recitation block on memorized portal texts; never used as sole primary OCR.",
    ],
  },
  {
    provider_id: "mistral-ocr",
    display_name: "Mistral OCR (Allowlisted Cloud API)",
    upstream_model_id: "mistral-ocr-2511",
    model_revision: "mistral-ocr-2511-pinned",
    adapter_version: "rag24-mistral-ocr-adapter/2.0.0",
    execution_boundary: "cloud_allowlisted",
    allowed_privacy_classes: ["public", "internal", "confidential"], // NEVER restricted!
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: true,
      headers_footers_footnotes: true,
      bounding_polygons: "none",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 35000,
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Block geometry and token confidence remain null when omitted by pinned API response; never synthesized.",
      "Prohibited for PrivacyClass='restricted'.",
    ],
  },
  {
    provider_id: "native",
    display_name: "Deterministic Native PDF Extractor (Per-Page Validated)",
    upstream_model_id: "pdfium-thai-validator",
    model_revision: "pdfium-thai-2.0.0",
    adapter_version: "rag24-native-pdf/2.0.0",
    execution_boundary: "deterministic_local",
    allowed_privacy_classes: ["public", "internal", "confidential", "restricted"],
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: false,
      headers_footers_footnotes: true,
      bounding_polygons: "supported",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 200, // Measured compute per Section 9
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Eligible only after per-page validation against rendered coverage, PUA glyphs, U+FFFD, and Thai combining sequences.",
    ],
  },
  {
    provider_id: "human",
    display_name: "REG24 Human Reviewer Correction Workflow",
    upstream_model_id: "reg24-human-review",
    model_revision: "workflow-2.0.0",
    adapter_version: "reg24-correction-lineage/2.0.0",
    execution_boundary: "human_workflow",
    allowed_privacy_classes: ["public", "internal", "confidential", "restricted"],
    capabilities: {
      thai_printed_legal: true,
      english_bilingual: true,
      tables: true,
      headers_footers_footnotes: true,
      bounding_polygons: "optional_model_dependent",
      calibrated_confidence: "none",
      handwriting: "unsupported_flagged",
    },
    cost_micros_per_page: 0,
    currency: "THB",
    worker_available: true,
    caution_notes: [
      "Creates immutable successor extraction_version_id while retaining raw predecessor extraction.",
    ],
  },
];

export const DEFAULT_LEGAL_OCR_POLICY: OcrRoutingPolicy = {
  policy_id: "pol.reg24.thai_legal.default",
  policy_revision: "polrev.2026-11-15.v2",
  etag: 'W/"polrev-1"',
  purpose: "thai_legal_source_linked_publication",
  currency: "THB",
  max_pages_per_document: 500,
  max_ocr_attempts_per_page: 2,
  max_document_remediation_cycles: 1,
  tenant_budget_ceiling_micros: 50_000_000, // 50 THB micro-units default test ceiling
  allowed_providers_by_privacy: {
    public: [
      "native",
      "typhoon-ocr2-2b",
      "typhoon-ocr-v2-hosted",
      "gemini-3.8-flash-ocr",
      "openthai-2.0-markdown",
      "mistral-ocr",
    ],
    internal: ["native", "typhoon-ocr2-2b", "gemini-3.8-flash-ocr", "openthai-2.0-markdown", "mistral-ocr"],
    confidential: ["native", "typhoon-ocr2-2b", "openthai-2.0-markdown", "mistral-ocr"],
    restricted: ["native", "typhoon-ocr2-2b", "openthai-2.0-markdown"], // Strictly self-hosted!
  },
  preferred_thai_ocr_provider: "typhoon-ocr2-2b",
  comparison_thai_ocr_provider: "gemini-3.8-flash-ocr",
  updated_at: "2026-11-15T00:00:00Z",
  updated_by: "principal.policy_admin.01",
};

export interface RealProviderPageExtractionInput {
  provider_id: string;
  model_revision: string;
  adapter_version?: string;
  raw_response_content: string;
  raw_response_sha256: string;
  raw_response_ref?: string;
  format: "typhoon_v2_json" | "markdown_or_text";
  secondary_comparison_text?: string;
  measured_confidence?: {
    value: number;
    scale: string;
    meaning: string;
    calibration_id: string | null;
  } | null;
}

export interface SimulatedProviderBehaviorOverride {
  /** Simulate provider omitting pages (e.g., Scenario 3: 23-page opinion returning 22 pages) */
  omit_page_numbers?: number[];
  /** Simulate custom OCR raw text per page */
  ocr_page_text_override?: Record<number, string>;
  /** Simulate structured tables per page */
  ocr_page_tables_override?: Record<number, OCRTable[]>;
  /** Simulate handwritten / seal annotation detected on page */
  handwritten_seal_pages?: number[];
}

/**
 * Splits structured Thai page text into `OCRBlock[]` preserving `header`, `heading`, `paragraph`,
 * `footnote`, and `footer` elements with exact zero-based Unicode code-point `SourceSpan` offsets.
 */
export function segmentStructuredBlocksFromRawText(
  pageNumber: number,
  rawText: string,
  imageSha256: string,
  includeSyntheticPolygons: boolean
): OCRBlock[] {
  if (rawText.length === 0) return [];
  const cpMap = buildCodePointIndexMap(rawText);
  const blocks: OCRBlock[] = [];
  const lines = rawText.split("\n");

  let cursorUtf16 = 0;
  let order = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const startUtf16 = cursorUtf16;
    const endUtf16 = cursorUtf16 + line.length;
    cursorUtf16 = endUtf16 + 1; // +1 for `\n`

    if (line.trim().length === 0) continue;

    let kind: OCRBlockKind = "paragraph";
    const trimmed = line.trim();
    if (order === 0 && /^(?:หน้า\s*[0-9๐-๙]+|ราชกิจจานุเบกษา|สำเนาคู่ฉบับ)/.test(trimmed)) {
      kind = "header";
    } else if (/^(?:เชิงอรรถ|หมายเหตุท้ายหน้า|\[\d+\]|\([๑-๙]\)\s*อ้างอิง)/.test(trimmed)) {
      kind = "footnote";
    } else if (idx === lines.length - 1 && /(?:หน้า\s*[0-9๐-๙]+\s*จาก|คำพิพากษาศาลฎีกาที่|เล่ม\s*[0-9๐-๙]+\s*ตอน)/.test(trimmed)) {
      kind = "footer";
    } else if (/^(?:มาตรา\s*[0-9๐-๙]+|หมวด\s*[0-9๐-๙]+|คำพิพากษาศาลฎีกาที่|เรื่องเสร็จที่)/.test(trimmed)) {
      kind = "heading";
    }

    const rawStart = cpMap.utf16ToCodePoint[startUtf16];
    const rawEnd = cpMap.utf16ToCodePoint[endUtf16];
    const yTop = Math.min(0.92, Number((0.06 + order * 0.08).toFixed(4)));
    const yBot = Math.min(0.98, Number((yTop + 0.06).toFixed(4)));

    const span: SourceSpan = {
      page_number: pageNumber,
      block_id: `blk.p${pageNumber}.${order + 1}`,
      raw_start: rawStart,
      raw_end: rawEnd,
      // Only providers that genuinely emit polygons include normalized coordinates; otherwise `null`!
      polygon: includeSyntheticPolygons
        ? {
            points: [
              [0.08, yTop],
              [0.92, yTop],
              [0.92, yBot],
              [0.08, yBot],
            ],
            units: "normalized",
            origin: "top_left",
            rotation_degrees: 0,
            image_sha256: imageSha256,
          }
        : null,
    };

    blocks.push({
      block_id: `blk.p${pageNumber}.${order + 1}`,
      kind,
      reading_order: order,
      raw_text: line,
      span,
    });
    order += 1;
  }

  return blocks;
}

/**
 * RAG24 Continuity Adapter (`ADR-OCR-001`) — Executes page-by-page eligibility & OCR extraction
 * under identical `ocr-contract/2.0.0` rules, privacy boundaries, and micro-unit cost accounting.
 */
export class Rag24ContinuityAdapter {
  private providers: Map<string, OcrProviderDescriptor> = new Map();

  constructor(seedProviders: OcrProviderDescriptor[] = PINNED_OCR_PROVIDERS) {
    for (const p of seedProviders) {
      this.providers.set(p.provider_id, {
        ...p,
        allowed_privacy_classes: [...p.allowed_privacy_classes],
        caution_notes: [...p.caution_notes],
        capabilities: { ...p.capabilities },
      });
    }
  }

  public listProvidersForPolicy(
    policy: OcrRoutingPolicy,
    privacyClass?: PrivacyClass
  ): OcrProviderDescriptor[] {
    const all = Array.from(this.providers.values());
    if (!privacyClass) return all;
    const allowedSet = new Set(policy.allowed_providers_by_privacy[privacyClass] ?? []);
    return all.filter(
      (p) =>
        p.provider_id === "human" ||
        (allowedSet.has(p.provider_id) && p.allowed_privacy_classes.includes(privacyClass))
    );
  }

  public getProvider(providerId: string): OcrProviderDescriptor | undefined {
    return this.providers.get(providerId);
  }

  public setProviderWorkerAvailability(providerId: string, available: boolean): void {
    const p = this.providers.get(providerId);
    if (p) {
      p.worker_available = available;
    }
  }

  /**
   * Selects an authorized OCR provider for a given `PrivacyClass` and `OcrRoutingPolicy`.
   * Enforces Section 9: Restricted sources NEVER fall back to cloud providers (`POLICY_BLOCKED`).
   */
  public resolveAuthorizedOcrProvider(params: {
    privacy_class: PrivacyClass;
    policy: OcrRoutingPolicy;
    routing_override_provider_id?: string;
  }):
    | { ok: true; provider: OcrProviderDescriptor }
    | { ok: false; code: "POLICY_BLOCKED" | "PROVIDER_UNAVAILABLE"; message: string } {
    const allowedByPolicy = new Set(
      params.policy.allowed_providers_by_privacy[params.privacy_class] ?? []
    );

    if (params.routing_override_provider_id) {
      const override = this.providers.get(params.routing_override_provider_id);
      if (!override) {
        return {
          ok: false,
          code: "PROVIDER_UNAVAILABLE",
          message: `Requested provider '${params.routing_override_provider_id}' is not registered`,
        };
      }
      if (
        !allowedByPolicy.has(override.provider_id) ||
        !override.allowed_privacy_classes.includes(params.privacy_class) ||
        (params.privacy_class === "restricted" &&
          override.execution_boundary !== "self_hosted_approved")
      ) {
        return {
          ok: false,
          code: "POLICY_BLOCKED",
          message: `Provider '${override.provider_id}' (${override.execution_boundary}) is prohibited for privacy_class='${params.privacy_class}'`,
        };
      }
      if (!override.worker_available) {
        return {
          ok: false,
          code: params.privacy_class === "restricted" ? "POLICY_BLOCKED" : "PROVIDER_UNAVAILABLE",
          message: `Approved provider '${override.provider_id}' worker is unavailable and fallback outside boundary is prohibited`,
        };
      }
      return { ok: true, provider: override };
    }

    // Evaluate candidate chain in policy order (excluding `native` and `human`)
    const orderedIds = [
      params.policy.preferred_thai_ocr_provider,
      ...Array.from(allowedByPolicy).filter(
        (id) => id !== "native" && id !== params.policy.preferred_thai_ocr_provider
      ),
    ];

    let sawBoundaryBlockedCloudCandidate = false;
    let sawUnavailableSelfHosted = false;

    for (const pid of orderedIds) {
      const candidate = this.providers.get(pid);
      if (!candidate || candidate.provider_id === "native") continue;

      if (
        !allowedByPolicy.has(candidate.provider_id) ||
        !candidate.allowed_privacy_classes.includes(params.privacy_class)
      ) {
        sawBoundaryBlockedCloudCandidate = true;
        continue;
      }
      if (
        params.privacy_class === "restricted" &&
        candidate.execution_boundary !== "self_hosted_approved"
      ) {
        sawBoundaryBlockedCloudCandidate = true;
        continue;
      }
      if (!candidate.worker_available) {
        if (candidate.execution_boundary === "self_hosted_approved") {
          sawUnavailableSelfHosted = true;
        }
        continue;
      }
      return { ok: true, provider: candidate };
    }

    if (params.privacy_class === "restricted" || sawBoundaryBlockedCloudCandidate || sawUnavailableSelfHosted) {
      return {
        ok: false,
        code: "POLICY_BLOCKED",
        message:
          params.privacy_class === "restricted"
            ? "Self-hosted approved OCR workers are unavailable; cloud fallback is strictly blocked for PrivacyClass='restricted'"
            : "No policy-authorized OCR worker is currently available within the allowed privacy boundary",
      };
    }

    return {
      ok: false,
      code: "PROVIDER_UNAVAILABLE",
      message: "All configured OCR providers are currently unavailable",
    };
  }

  /**
   * Executes deterministic per-page native eligibility + Thai OCR adapter pipeline.
   */
  public executeDocumentExtraction(params: {
    document_id: string;
    job_id: string;
    privacy_class: PrivacyClass;
    policy: OcrRoutingPolicy;
    pages_manifest: RenderedPageEvidence[];
    routing_override_provider_id?: string;
    disable_continuity_adapter?: boolean;
    real_provider_pages?: Record<number, RealProviderPageExtractionInput>;
    simulation?: SimulatedProviderBehaviorOverride;
  }):
    | {
        ok: true;
        pages: OCRPage[];
        issues: OCRIssue[];
        consumed_micros: number;
        selected_ocr_provider_id: string | null;
        execution_mode: "real_ocr" | "native_only" | "simulated_continuity_fixture";
        usable_as_verified_text: boolean;
      }
    | {
        ok: false;
        code: "POLICY_BLOCKED" | "PROVIDER_UNAVAILABLE" | "FEATURE_DISABLED" | "RATE_LIMITED";
        message: string;
        consumed_micros: number;
      } {
    const continuityDisabled =
      params.disable_continuity_adapter === true ||
      process.env.OCR_V2_DISABLE_CONTINUITY_ADAPTER === "true";

    const pages: OCRPage[] = [];
    const issues: OCRIssue[] = [];
    let consumedMicros = 0;
    let selectedOcrProvider: OcrProviderDescriptor | null = null;
    let usedRealOcr = false;
    let usedSimulatedFixture = false;

    const nativeProvider = this.providers.get("native")!;
    const omitSet = new Set(params.simulation?.omit_page_numbers ?? []);
    const handwrittenSet = new Set(params.simulation?.handwritten_seal_pages ?? []);

    for (const pageEv of params.pages_manifest) {
      const realPage = params.real_provider_pages?.[pageEv.page_number];

      if (omitSet.has(pageEv.page_number)) {
        if (continuityDisabled) {
          return {
            ok: false,
            code: "FEATURE_DISABLED",
            message: "OCR_V2_DISABLE_CONTINUITY_ADAPTER=true blocks simulated provider overrides",
            consumed_micros: consumedMicros,
          };
        }
        usedSimulatedFixture = true;
        const unresolvedIssueId = `iss.${params.document_id}.p${pageEv.page_number}.missing_page`;
        issues.push({
          issue_id: unresolvedIssueId,
          code: "UNRESOLVED_MISSING_PROVIDER_PAGE",
          severity: "blocking",
          page_number: pageEv.page_number,
          block_id: null,
          message: `Page ${pageEv.page_number} of ${params.pages_manifest.length} was absent from provider output; marked unresolved (never silently blank)`,
          evidence_refs: [`img:${pageEv.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });

        const emptyNorm = normalizeThaiLegalTextV2("", `norm.${params.job_id}.p${pageEv.page_number}`);
        pages.push({
          page_number: pageEv.page_number,
          state: "unresolved",
          image_sha256: pageEv.image_sha256,
          raw_text: "",
          markdown: null,
          normalized_text: emptyNorm.normalized_text,
          normalization: {
            ruleset: emptyNorm.ruleset,
            mapping_ref: emptyNorm.mapping_ref,
          },
          blocks: [],
          tables: [],
          provenance: {
            method: "ocr",
            attempt_id: `att.${params.job_id}.p${pageEv.page_number}.1`,
            provider_id: selectedOcrProvider?.provider_id ?? params.policy.preferred_thai_ocr_provider,
            model_revision: selectedOcrProvider?.model_revision ?? "unresolved",
            adapter_version: "rag24-simulated-continuity-fixture/2.0.0",
            raw_response_ref: null,
            is_simulated: true,
            usable_as_verified_text: false,
          },
          confidence: null,
          issue_ids: [unresolvedIssueId],
        });
        continue;
      }

      const eligibility = assessNativePageEligibility(pageEv, params.document_id);
      consumedMicros += nativeProvider.cost_micros_per_page;

      if (
        !realPage &&
        !params.routing_override_provider_id &&
        eligibility.eligible_for_native_bypass &&
        !params.simulation?.ocr_page_text_override?.[pageEv.page_number] &&
        !params.simulation?.ocr_page_tables_override?.[pageEv.page_number]
      ) {
        const rawText = pageEv.has_visible_content ? (pageEv.native_pdf_text ?? "") : "";
        const norm = normalizeThaiLegalTextV2(rawText, `norm.${params.job_id}.p${pageEv.page_number}`);
        const blocks = segmentStructuredBlocksFromRawText(
          pageEv.page_number,
          rawText,
          pageEv.image_sha256,
          true
        );

        pages.push({
          page_number: pageEv.page_number,
          state: pageEv.has_visible_content ? "extracted" : "verified_blank",
          image_sha256: pageEv.image_sha256,
          raw_text: rawText,
          markdown: rawText || null,
          normalized_text: norm.normalized_text,
          normalization: {
            ruleset: norm.ruleset,
            mapping_ref: norm.mapping_ref,
          },
          blocks,
          tables: [],
          provenance: {
            method: "native",
            attempt_id: `att.${params.job_id}.p${pageEv.page_number}.native`,
            provider_id: "native",
            model_revision: nativeProvider.model_revision,
            adapter_version: nativeProvider.adapter_version,
            raw_response_ref: `evraw:${params.job_id}:p${pageEv.page_number}:native`,
            is_simulated: false,
            usable_as_verified_text: true,
          },
          confidence: null,
          issue_ids: [],
        });
        continue;
      }

      for (const natIss of eligibility.issues) {
        issues.push({
          ...natIss,
          severity: natIss.code === "NATIVE_TEXT_LAYER_MISMATCH" ? "warning" : natIss.severity,
          message: `${natIss.message} — bypassed stale native layer and routed page ${pageEv.page_number} to Thai OCR`,
        });
      }

      // Enforce `OCR_V2_DISABLE_CONTINUITY_ADAPTER`: block simulated/reference-text OCR when no real provider payload is supplied!
      if (!realPage && continuityDisabled) {
        return {
          ok: false,
          code: "FEATURE_DISABLED",
          message: `OCR_V2_DISABLE_CONTINUITY_ADAPTER=true: continuity fixture adapter is disabled and no real OCR worker output was supplied for page ${pageEv.page_number}`,
          consumed_micros: consumedMicros,
        };
      }

      if (!selectedOcrProvider) {
        const resolved = this.resolveAuthorizedOcrProvider({
          privacy_class: params.privacy_class,
          policy: params.policy,
          routing_override_provider_id: realPage?.provider_id ?? params.routing_override_provider_id,
        });
        if (!resolved.ok) {
          return {
            ok: false,
            code: resolved.code,
            message: resolved.message,
            consumed_micros: consumedMicros,
          };
        }
        selectedOcrProvider = resolved.provider;
      }

      consumedMicros += selectedOcrProvider.cost_micros_per_page;
      const pageIssueIds: string[] = eligibility.issues.map((i) => i.issue_id);

      let rawText = "";
      let markdownText: string | null = null;
      let blocks: OCRBlock[] = [];
      let pageTables: OCRTable[] = [];

      if (realPage) {
        usedRealOcr = true;
        if (realPage.format === "typhoon_v2_json") {
          const parsedV2 = parseTyphoonV2StructuredResponse({
            documentId: params.document_id,
            pageNumber: pageEv.page_number,
            imageSha256: pageEv.image_sha256,
            rawContent: realPage.raw_response_content,
            keepHeaderFooter: true,
          });
          rawText = parsedV2.raw_text;
          markdownText = parsedV2.markdown;
          blocks = parsedV2.blocks;
          pageTables = parsedV2.tables;
          for (const pIss of parsedV2.issues) {
            issues.push(pIss);
            pageIssueIds.push(pIss.issue_id);
          }
        } else {
          rawText = realPage.raw_response_content;
          markdownText = realPage.raw_response_content;
          blocks = segmentStructuredBlocksFromRawText(
            pageEv.page_number,
            rawText,
            pageEv.image_sha256,
            false // Never synthesize fake polygons for non-bbox models!
          );
        }

        if (realPage.secondary_comparison_text) {
          const dualIssues = compareDualOcrPassages({
            documentId: params.document_id,
            pageNumber: pageEv.page_number,
            imageSha256: pageEv.image_sha256,
            primaryText: rawText,
            secondaryText: realPage.secondary_comparison_text,
          });
          for (const dIss of dualIssues) {
            issues.push(dIss);
            pageIssueIds.push(dIss.issue_id);
          }
        }
      } else {
        usedSimulatedFixture = true;
        rawText =
          params.simulation?.ocr_page_text_override?.[pageEv.page_number] ??
          pageEv.rendered_reference_text ??
          pageEv.native_pdf_text ??
          "";
        markdownText = rawText;
        const supportsPolygons = selectedOcrProvider.capabilities.bounding_polygons === "supported";
        blocks = segmentStructuredBlocksFromRawText(
          pageEv.page_number,
          rawText,
          pageEv.image_sha256,
          supportsPolygons
        );
        pageTables = (params.simulation?.ocr_page_tables_override?.[pageEv.page_number] ?? []).map(
          (tbl) => {
            const tblIssueIds = [...tbl.issue_ids];
            if (tbl.structure_status === "partial" || tbl.structure_status === "unsupported") {
              const tblIssId = `iss.${params.document_id}.p${pageEv.page_number}.tbl_${tbl.table_id}`;
              if (!tblIssueIds.includes(tblIssId)) {
                tblIssueIds.push(tblIssId);
              }
              issues.push({
                issue_id: tblIssId,
                code: "UNCERTAIN_TABLE_STRUCTURE_MERGED_CELLS",
                severity: "blocking",
                page_number: pageEv.page_number,
                block_id: tbl.block_id,
                message: `Table '${tbl.table_id}' on page ${pageEv.page_number} has ${tbl.structure_status} structure (merged/cross-page cells); critical cell values blocked until reviewed`,
                evidence_refs: [`img:${pageEv.image_sha256}`],
                detector_version: THAI_DETECTOR_VERSION_V2,
                resolution: "open",
              });
              pageIssueIds.push(tblIssId);
            }
            return { ...tbl, issue_ids: tblIssueIds };
          }
        );
      }

      const norm = normalizeThaiLegalTextV2(rawText, `norm.${params.job_id}.p${pageEv.page_number}`);

      for (const anom of norm.combining_anomalies) {
        const issId = `iss.${params.document_id}.p${pageEv.page_number}.cp_${anom.code_point_index}`;
        issues.push({
          issue_id: issId,
          code: anom.code,
          severity: anom.code === "PDF_PRIVATE_USE_GLYPH" || anom.code === "UNICODE_REPLACEMENT_CHAR" ? "blocking" : "warning",
          page_number: pageEv.page_number,
          block_id: null,
          message: anom.message,
          evidence_refs: [`img:${pageEv.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
        pageIssueIds.push(issId);
      }

      if (handwrittenSet.has(pageEv.page_number)) {
        const hwId = `iss.${params.document_id}.p${pageEv.page_number}.handwriting`;
        issues.push({
          issue_id: hwId,
          code: "UNSUPPORTED_HANDWRITING_OR_SEAL",
          severity: "warning",
          page_number: pageEv.page_number,
          block_id: null,
          message: `Page ${pageEv.page_number} contains official seal or handwritten endorsement preserved as image evidence`,
          evidence_refs: [`img:${pageEv.image_sha256}`],
          detector_version: THAI_DETECTOR_VERSION_V2,
          resolution: "open",
        });
        pageIssueIds.push(hwId);
      }

      // Never represent a hardcoded score as measured confidence! `confidence` is `null` unless genuinely measured.
      const confidence = realPage?.measured_confidence ?? null;
      const pageFailedInvalid = blocks.length === 0 && pageIssueIds.some((id) => id.endsWith(".invalid_typhoon_json"));

      pages.push({
        page_number: pageEv.page_number,
        state: pageFailedInvalid ? "failed" : "extracted",
        image_sha256: pageEv.image_sha256,
        raw_text: rawText,
        markdown: markdownText,
        normalized_text: norm.normalized_text,
        normalization: {
          ruleset: norm.ruleset,
          mapping_ref: norm.mapping_ref,
        },
        blocks,
        tables: pageTables,
        provenance: realPage
          ? {
              method: "ocr",
              attempt_id: `att.${params.job_id}.p${pageEv.page_number}.1`,
              provider_id: selectedOcrProvider.provider_id,
              model_revision: realPage.model_revision || selectedOcrProvider.model_revision,
              adapter_version: realPage.adapter_version ?? selectedOcrProvider.adapter_version,
              raw_response_ref:
                realPage.raw_response_ref ??
                `evraw:${params.job_id}:p${pageEv.page_number}:${selectedOcrProvider.provider_id}:${realPage.raw_response_sha256.slice(0, 16)}`,
              raw_response_sha256: realPage.raw_response_sha256,
              is_simulated: false,
              usable_as_verified_text: !pageFailedInvalid,
            }
          : {
              method: "ocr",
              attempt_id: `att.${params.job_id}.p${pageEv.page_number}.1`,
              provider_id: selectedOcrProvider.provider_id,
              model_revision: selectedOcrProvider.model_revision,
              adapter_version: "rag24-simulated-continuity-fixture/2.0.0",
              raw_response_ref: `simulated-fixture:${params.job_id}:p${pageEv.page_number}`,
              raw_response_sha256: null,
              is_simulated: true,
              usable_as_verified_text: false,
            },
        confidence,
        issue_ids: pageIssueIds,
      });
    }

    const executionMode = usedSimulatedFixture
      ? "simulated_continuity_fixture"
      : usedRealOcr
        ? "real_ocr"
        : "native_only";

    return {
      ok: true,
      pages,
      issues,
      consumed_micros: consumedMicros,
      selected_ocr_provider_id: selectedOcrProvider?.provider_id ?? null,
      execution_mode: executionMode,
      usable_as_verified_text: !usedSimulatedFixture,
    };
  }
}
