/**
 * REG24 — Separate Mission: Thai Tax Foundation & Practitioner Commentary Layer
 *
 * Models authoritative Thai tax practitioner commentary (starting with the focused VAT pilot
 * from *คำอธิบายประมวลรัษฎากร ภาษีสรรพากร* Volume 2, Part 1, printed May 2018, VAT chapter
 * starting at PDF page 27 / printed page `4-001`) as an isolated, non-controlling conceptual
 * navigation layer on top of REG24's primary legal store:
 *
 * 1. **Existing Graph Kept Intact**: Never mutates `data/knowledge-store` or `rel.B01.rc6`.
 *    Runs strictly via an isolated ledger (`data/foundation-vat-pilot/vat-foundation-ledger.json`)
 *    and opt-in staging flag (`enable_tax_foundation_pilot: true`).
 * 2. **Source Rights & Selective OCR Gate**: Records permitted internal R&D scope, checks native
 *    extractable PDF text first (`NATIVE_TEXT` / `NATIVE_FONT_REPAIRED`), and triggers OCR ONLY
 *    on pages that lack clean extractable Thai text (`SELECTIVE_OCR`).
 * 3. **Separate Dual Locators**: Preserves `chapter`, `section`, `printed_page` (`4-xxx`), and
 *    original `pdf_page_number` (`27+`) + `pdf_bbox` as distinct structured fields so the Legal
 *    Team can locate the exact passage in either the physical volume or the split PDF.
 * 4. **6-Element Foundation Mapping & Link Provenance**: Maps `taxpayer`, `transaction`, `tax_base`,
 *    `rate`, `conditions`, and `exceptions` to Revenue Code provisions, amendments, regulations, and
 *    rulings — recording exact source provenance for each link and strictly separating `VERIFIED_LINK`
 *    from `CANDIDATE_LINK`.
 * 5. **Non-Controlling Commentary & May 2018 Cutoff Enforcement**: Commentary is `secondary_commentary`
 *    (`usable_as_controlling_law: false`, `edition_cutoff_iso: "2018-05-31"`). Every material legal
 *    conclusion MUST be verified against the primary official source (or verified official attachment)
 *    in force on the queried date; post-May-2018 amendments automatically override commentary dates/rates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CanonicalPersistedState } from "./store";
import { hasGarbledOrPuaGlyphs } from "./font-repair";
import { sha256Bytes, thaiDigitsToArabic } from "./identity";

export const COMMENTARY_EDITION_CUTOFF_ISO = "2018-05-31";
export const VOLUME_2_PART_1_DRIVE_FILE_ID = "1PzlwWVEaJWOXJcBoEggKHMZW3B8pJJ2M";
export const SPLIT_PDF_DRIVE_FOLDER_ID = "1PhIxtwdGTvH32sgctk-Zii0UpcLensSg";

export type CommentaryExtractionMethod =
  | "NATIVE_TEXT"
  | "NATIVE_FONT_REPAIRED"
  | "SELECTIVE_OCR";

export interface CommentarySourceRightsRecord {
  source_id: string;
  work_title_th: string;
  volume_no: number;
  part_no: number;
  edition_printed_label: string; // "May 2018"
  edition_cutoff_iso: string; // "2018-05-31"
  privacy_class: "licensed_internal";
  permitted_use_confirmed: boolean;
  permitted_use_scope: "INTERNAL_RD_AND_STAGING_EVAL_ONLY";
  external_trial_exposure_allowed: false;
  usable_as_controlling_law: false;
  ocr_routing_policy: "LOCAL_ONLY" | "APPROVED_NON_TRAINING_API";
}

/**
 * Preserves chapter, section, printed page (`4-001`), and original PDF position (`page 27`)
 * as strictly separate fields so legal reviewers can jump to either locator immediately.
 */
export interface CommentaryDualLocator {
  volume_no: number;
  part_no: number;
  chapter_no: string;
  chapter_title_th: string;
  section_code: string;
  section_title_th: string;
  subsection_path: string[];
  printed_page: string; // e.g., "4-001"
  pdf_file_id: string; // e.g., "1PzlwWVEaJWOXJcBoEggKHMZW3B8pJJ2M"
  pdf_filename: string;
  pdf_page_number: number; // 1-based PDF page, e.g., 27
  pdf_bbox?: [number, number, number, number] | null;
  char_offset_start?: number;
  char_offset_end?: number;
  extraction_method: CommentaryExtractionMethod;
}

export interface TaxFoundationSixSlotFrame {
  taxpayer_th: string;
  transaction_th: string;
  tax_base_th: string;
  rate_th: string;
  conditions_th: string[];
  exceptions_th: string[];
}

export type FoundationLinkTargetKind =
  | "REVENUE_CODE_PROVISION"
  | "AMENDING_ACT"
  | "SUBORDINATE_REGULATION"
  | "TAX_RULING";

export type FoundationLinkVerificationStatus = "VERIFIED_LINK" | "CANDIDATE_LINK";

export type PostCommentaryAmendmentStatus =
  | "IN_FORCE_UNCHANGED_SINCE_2018_05"
  | "AMENDED_OR_EXTENDED_POST_2018_05"
  | "UNVERIFIED_TARGET";

export interface FoundationAuthorityLink {
  link_id: string;
  target_kind: FoundationLinkTargetKind;
  raw_authority_label_th: string;
  target_work_id: string | null;
  verified_version_id: string | null;
  verification_status: FoundationLinkVerificationStatus;
  post_2018_05_status: PostCommentaryAmendmentStatus;
  post_2018_05_override_work_ids: string[];
  post_2018_05_note_th: string | null;
  link_source_locator: CommentaryDualLocator;
  source_excerpt_sha256: string;
  link_rationale_th: string;
}

export interface TaxFoundationConceptNode {
  concept_id: string;
  domain: "VAT";
  concept_title_th: string;
  trigger_keywords_th_en: string[];
  six_slot_frame: TaxFoundationSixSlotFrame;
  decisive_fact_questions_th: string[];
  source_locator: CommentaryDualLocator;
  authority_links: FoundationAuthorityLink[];
}

export interface VatFoundationPilotLedger {
  schema_version: "reg24.tax_foundation_pilot.v1";
  mission_id: "mission.thai_tax_foundation.vat_pilot.v2p1";
  generated_at: string;
  source_intake_mode: "PHYSICAL_SPLIT_PDF_EXTRACTED" | "SCHEMA_SEED_AWAITING_SPLIT_PDF_BYTES";
  source_pdf_sha256: string | null;
  rights: CommentarySourceRightsRecord;
  page_routing_summary: {
    inspected_pdf_page_start: number;
    inspected_pdf_page_end: number;
    printed_page_start: string;
    printed_page_end: string;
    native_text_pages: number;
    font_repaired_pages: number;
    selective_ocr_pages: number;
    ocr_cost_usd_incl_tax: number;
  };
  concepts: TaxFoundationConceptNode[];
}

export interface PageTextQualityProbe {
  pdf_page_number: number;
  printed_page_detected: string | null;
  raw_char_count: number;
  thai_char_count: number;
  has_pua_or_garbled_glyphs: boolean;
  recommended_route: CommentaryExtractionMethod;
  reason: string;
}

/**
 * Inspects extracted native PDF text on a single page before any OCR is attempted.
 * Ensures OCR is invoked ONLY where native text is missing or unrepairably garbled.
 */
export function evaluateCommentaryPageTextQuality(params: {
  pdfPageNumber: number;
  rawNativeText: string;
  repairedText?: string | null;
}): PageTextQualityProbe {
  const raw = (params.rawNativeText || "").trim();
  const printedMatch = thaiDigitsToArabic(raw).match(/\b(4\s*-\s*[0-9]{3})\b/);
  const printedPage = printedMatch ? printedMatch[1].replace(/\s+/g, "") : null;

  const countThai = (s: string) => (s.match(/[\u0E00-\u0E7F]/g) || []).length;
  const rawThaiCount = countThai(raw);
  const rawHasGarbled = hasGarbledOrPuaGlyphs(raw);

  if (raw.length >= 120 && rawThaiCount >= 60 && !rawHasGarbled) {
    return {
      pdf_page_number: params.pdfPageNumber,
      printed_page_detected: printedPage,
      raw_char_count: raw.length,
      thai_char_count: rawThaiCount,
      has_pua_or_garbled_glyphs: false,
      recommended_route: "NATIVE_TEXT",
      reason: "Clean extractable Thai Unicode native text layer verified; zero OCR required.",
    };
  }

  if (params.repairedText) {
    const rep = params.repairedText.trim();
    const repThaiCount = countThai(rep);
    if (rep.length >= 120 && repThaiCount >= 60 && !hasGarbledOrPuaGlyphs(rep)) {
      return {
        pdf_page_number: params.pdfPageNumber,
        printed_page_detected: printedPage,
        raw_char_count: rep.length,
        thai_char_count: repThaiCount,
        has_pua_or_garbled_glyphs: false,
        recommended_route: "NATIVE_FONT_REPAIRED",
        reason: "Legacy Thai PUA/glyph shift deterministically repaired; zero OCR required.",
      };
    }
  }

  return {
    pdf_page_number: params.pdfPageNumber,
    printed_page_detected: printedPage,
    raw_char_count: raw.length,
    thai_char_count: rawThaiCount,
    has_pua_or_garbled_glyphs: rawHasGarbled,
    recommended_route: "SELECTIVE_OCR",
    reason:
      raw.length < 120
        ? "Image-scanned page with insufficient native text (<120 chars); selective OCR required."
        : "Unmapped garbled glyphs in native text layer; selective OCR required.",
  };
}

/**
 * Known post-May-2018 statutory amendments & subordinate extensions that MUST override or
 * supplement May 2018 commentary whenever the queried date falls after `2018-05-31`.
 */
const POST_MAY_2018_VAT_STATUTORY_UPDATES: Record<
  string,
  {
    override_work_ids: string[];
    effective_from_iso: string;
    note_th: string;
  }
> = {
  "prov.th.rc.80": {
    override_work_ids: [
      "subreg.th.rc.royal_decree.799",
      "subreg.th.rc.royal_decree.807",
      "subreg.th.rd.vat_local_tax_guide",
    ],
    effective_from_iso: "2018-10-01",
    note_th:
      "หนังสือคำอธิบายฯ พิมพ์เมื่อเดือนพฤษภาคม 2561 (ขณะใช้ พ.ร.ฎ. ฉบับที่ 646 พ.ศ. 2560); สำหรับธุรกรรมหลังเดือนพฤษภาคม 2561 ต้องตรวจสอบพระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่มฉบับที่ใช้บังคับจริงในวันเกิดความรับผิด (เช่น พ.ร.ฎ. ฉบับที่ 799 พ.ศ. 2568 และ พ.ร.ฎ. ฉบับที่ 807 พ.ศ. 2569 ถึงวันที่ 30 กันยายน 2570)",
  },
  "prov.th.rc.80/1": {
    override_work_ids: ["statute.th.rc_amendment_49_2562", "subreg.th.rd.dg_vat.105"],
    effective_from_iso: "2019-02-28",
    note_th:
      "มาตรา 80/1 (5) แก้ไขเพิ่มเติมหลังเดือนพฤษภาคม 2561 โดย พ.ร.บ. แก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 49) พ.ศ. 2562 (มีผลตั้งแต่วันที่ 28 กุมภาพันธ์ 2562 ขยายสิทธิ VAT อัตราร้อยละ 0 ให้ครอบคลุมสำนักงานเศรษฐกิจและการค้าของต่างประเทศ) และหลักเกณฑ์ส่งออกบริการตามมาตรา 80/1 (2) พิจารณาประกอบประกาศอธิบดีฯ VAT (ฉบับที่ 105) แก้ไขเพิ่มเติมถึงปัจจุบัน",
  },
  "prov.th.rc.82/13": {
    override_work_ids: ["statute.th.rc_amendment_53_2564"],
    effective_from_iso: "2021-09-01",
    note_th:
      "บริการทางอิเล็กทรอนิกส์จากต่างประเทศ (e-Service) แก้ไขเพิ่มเติมหลังเดือนพฤษภาคม 2561 โดย พ.ร.บ. แก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 53) พ.ศ. 2564 (มีผลตั้งแต่วันที่ 1 กันยายน 2564)",
  },
};

/**
 * Verifies every raw link extracted from commentary against the canonical primary-law store:
 * - Only active, non-withdrawn official works in `state.works` become `VERIFIED_LINK`.
 * - Missing, unverified, or withdrawn targets remain `CANDIDATE_LINK` and are excluded from
 *   runtime retrieval expansion until verified by the Legal Team.
 * - Automatically attaches post-May-2018 statutory amendment overrides where applicable.
 */
export function resolveFoundationLinksAgainstCanonicalStore(params: {
  rawLinks: Array<{
    target_kind: FoundationLinkTargetKind;
    raw_authority_label_th: string;
    candidate_work_id: string | null;
    link_source_locator: CommentaryDualLocator;
    source_excerpt_text: string;
    link_rationale_th: string;
  }>;
  state: CanonicalPersistedState;
}): FoundationAuthorityLink[] {
  const activeWithdrawnTargets = new Set(
    Object.values(params.state.withdrawals || {})
      .filter((w) => w.active)
      .map((w) => w.target_id)
  );

  return params.rawLinks.map((item, idx) => {
    const excerptSha = sha256Bytes(item.source_excerpt_text || item.raw_authority_label_th);
    const work = item.candidate_work_id ? params.state.works[item.candidate_work_id] : undefined;
    const isWithdrawn = Boolean(item.candidate_work_id && activeWithdrawnTargets.has(item.candidate_work_id));

    let verifiedVersionId: string | null = null;
    if (work && !isWithdrawn) {
      const matchingVersions = Object.values(params.state.versions).filter(
        (v) => v.work_id === work.work_id && !activeWithdrawnTargets.has(v.version_id)
      );
      verifiedVersionId = matchingVersions[0]?.version_id ?? null;
    }

    const isVerified = Boolean(work && !isWithdrawn && verifiedVersionId);
    const postUpdate = item.candidate_work_id
      ? POST_MAY_2018_VAT_STATUTORY_UPDATES[item.candidate_work_id]
      : undefined;

    const verifiedOverrides = (postUpdate?.override_work_ids || []).filter(
      (oid) => Boolean(params.state.works[oid]) && !activeWithdrawnTargets.has(oid)
    );

    return {
      link_id: `flnk.vat.${idx + 1}.${excerptSha.slice(0, 10)}`,
      target_kind: item.target_kind,
      raw_authority_label_th: item.raw_authority_label_th,
      target_work_id: isVerified ? work!.work_id : item.candidate_work_id,
      verified_version_id: verifiedVersionId,
      verification_status: isVerified ? "VERIFIED_LINK" : "CANDIDATE_LINK",
      post_2018_05_status: !isVerified
        ? "UNVERIFIED_TARGET"
        : postUpdate
          ? "AMENDED_OR_EXTENDED_POST_2018_05"
          : "IN_FORCE_UNCHANGED_SINCE_2018_05",
      post_2018_05_override_work_ids: verifiedOverrides,
      post_2018_05_note_th: postUpdate?.note_th ?? null,
      link_source_locator: item.link_source_locator,
      source_excerpt_sha256: excerptSha,
      link_rationale_th: item.link_rationale_th,
    };
  });
}

export interface FoundationConsultationResult {
  matched_concept_ids: string[];
  verified_controlling_work_ids: string[];
  quarantined_candidate_links: Array<{
    raw_authority_label_th: string;
    target_work_id: string | null;
  }>;
  post_2018_05_warnings_th: string[];
  missing_decisive_fact_questions_th: string[];
  structured_issue_framing_th: string | null;
  dual_locators_consulted: CommentaryDualLocator[];
}

/**
 * Loads the isolated VAT foundation ledger (`data/foundation-vat-pilot/vat-foundation-ledger.json`)
 * if present on disk. Never touches `data/knowledge-store`.
 */
export function loadIsolatedVatFoundationLedger(customPath?: string): VatFoundationPilotLedger | null {
  const targetPath =
    customPath ||
    process.env.REG24_VAT_FOUNDATION_LEDGER_PATH ||
    path.resolve(process.cwd(), "data/foundation-vat-pilot/vat-foundation-ledger.json");
  if (!fs.existsSync(targetPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8")) as VatFoundationPilotLedger;
  } catch {
    return null;
  }
}

/**
 * Consults the isolated VAT Tax Foundation Layer (`enable_tax_foundation_pilot: true`) to:
 * 1. Identify the underlying VAT legal issue & 6-slot analytical structure (`taxpayer`, `transaction`,
 *    `tax_base`, `rate`, `conditions`, `exceptions`),
 * 2. Expand ONLY `VERIFIED_LINK` primary official authorities (plus post-May-2018 enacted overrides!)
 *    while holding `CANDIDATE_LINK`s out of retrieval,
 * 3. Detect missing decisive VAT facts so REG24 asks for clarification rather than guessing.
 */
export function consultVatTaxFoundationLayer(params: {
  question: string;
  mergedUserFacts: string;
  applicableDateIso: string | null;
  ledger: VatFoundationPilotLedger | null;
  state: CanonicalPersistedState;
}): FoundationConsultationResult {
  const empty: FoundationConsultationResult = {
    matched_concept_ids: [],
    verified_controlling_work_ids: [],
    quarantined_candidate_links: [],
    post_2018_05_warnings_th: [],
    missing_decisive_fact_questions_th: [],
    structured_issue_framing_th: null,
    dual_locators_consulted: [],
  };

  const ledger = params.ledger;
  if (!ledger || !ledger.rights.permitted_use_confirmed || ledger.concepts.length === 0) {
    return empty;
  }

  const normText = thaiDigitsToArabic(`${params.mergedUserFacts} ${params.question}`)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // Only activate on VAT-related questions
  if (
    !/ภาษีมูลค่าเพิ่ม|\bvat\b|ใบกำกับภาษี|ภาษีซื้อ|ภาษีขาย|80\/1|77\/1|77\/2|79|81\/1|82\/5|83\/6|ส่งออกบริการ|แจกสินค้า|แถมสินค้า/i.test(
      normText
    )
  ) {
    return empty;
  }

  const scored = ledger.concepts
    .map((c) => {
      const hits = c.trigger_keywords_th_en.filter((kw) => normText.includes(kw.toLowerCase())).length;
      return { concept: c, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2);

  if (scored.length === 0) return empty;

  const matchedIds: string[] = [];
  const verifiedWorks = new Set<string>();
  const candidateHoldouts: Array<{ raw_authority_label_th: string; target_work_id: string | null }> = [];
  const post2018Notes = new Set<string>();
  const locators: CommentaryDualLocator[] = [];
  const framingLines: string[] = [];
  const missingFactQs: string[] = [];

  for (const { concept } of scored) {
    matchedIds.push(concept.concept_id);
    locators.push(concept.source_locator);

    for (const lnk of concept.authority_links) {
      if (
        lnk.verification_status === "VERIFIED_LINK" &&
        lnk.target_work_id &&
        params.state.works[lnk.target_work_id]
      ) {
        verifiedWorks.add(lnk.target_work_id);
        for (const ovId of lnk.post_2018_05_override_work_ids) {
          if (params.state.works[ovId]) {
            verifiedWorks.add(ovId);
          }
        }
        if (
          lnk.post_2018_05_status === "AMENDED_OR_EXTENDED_POST_2018_05" &&
          lnk.post_2018_05_note_th &&
          (!params.applicableDateIso || params.applicableDateIso > COMMENTARY_EDITION_CUTOFF_ISO)
        ) {
          post2018Notes.add(lnk.post_2018_05_note_th);
        }
      } else {
        candidateHoldouts.push({
          raw_authority_label_th: lnk.raw_authority_label_th,
          target_work_id: lnk.target_work_id,
        });
      }
    }

    const f = concept.six_slot_frame;
    framingLines.push(
      `**กรอบโครงสร้างข้อกฎหมายภาษีมูลค่าเพิ่ม (${concept.concept_title_th})**:\n` +
        `- **ผู้มีหน้าที่เสียภาษี (Taxpayer)**: ${f.taxpayer_th}\n` +
        `- **ธุรกรรมที่อยู่ในบังคับ (Transaction)**: ${f.transaction_th}\n` +
        `- **ฐานภาษี (Tax Base)**: ${f.tax_base_th}\n` +
        `- **อัตราภาษี (Rate)**: ${f.rate_th}\n` +
        `- **เงื่อนไขสำคัญ (Conditions)**: ${f.conditions_th.join("; ")}\n` +
        `- **ข้อยกเว้น/ข้อจำกัด (Exceptions)**: ${f.exceptions_th.join("; ")}`
    );

    // Check if concept defines decisive missing-fact triggers (e.g. export service without specifying where the service result is used!)
    if (
      concept.concept_id.includes("export_service") &&
      !/ใช้บริการ(?:นั้น)?(?:ทั้งหมด)?(?:ในต่างประเทศ|ที่สำนักงานใน|ในไทย|ในประเทศไทย|ที่สาขา)/.test(
        normText
      ) &&
      !/used\s+(?:entirely\s+)?(?:abroad|outside\s+thailand|in\s+thailand|in\s+singapore)/i.test(normText)
    ) {
      for (const dq of concept.decisive_fact_questions_th) {
        missingFactQs.push(dq);
      }
    }
  }

  return {
    matched_concept_ids: matchedIds,
    verified_controlling_work_ids: Array.from(verifiedWorks),
    quarantined_candidate_links: candidateHoldouts,
    post_2018_05_warnings_th: Array.from(post2018Notes),
    missing_decisive_fact_questions_th: missingFactQs,
    structured_issue_framing_th: framingLines.length > 0 ? framingLines.join("\n\n") : null,
    dual_locators_consulted: locators,
  };
}
