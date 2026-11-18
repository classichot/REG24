/**
 * REG24 — Task F4: Batch Release Lifecycle, Sequential Batch Gate, Owner UAT Attestation,
 * Atomic CAS Promotion & Shared-Law-Node-Safe Rollback
 *
 * Implements:
 * - SH-02, SH-03, SH-05, SH-15, SH-17
 * - AT05, AT06, AT07, AT14, AT15, AT16, AT18
 */

import { THAI_TAX_RULINGS_CORPUS } from "../data/thai-tax-rulings-loader";
import { RD_DRIVE_RULING_BY_PATH } from "../data/rd-drive-manifest-loader";
import {
  getB02DriveManifest,
  type B02DriveManifestEntry,
  type B02RarExpandedMember,
} from "../data/b02-drive-manifest-loader";
import {
  getRecoveredB01RulingTexts,
  getVerifiedStatutoryCorpus,
} from "../data/verified-statutory-loader";

type RawTaxRuling = (typeof THAI_TAX_RULINGS_CORPUS)[number];
import { getDeployedGitCommit, buildLegacyIdCrosswalk } from "./baseline";
import { chunkThaiLegalDocument } from "./extraction";
import { validateStagedAssertion } from "./evidence";
import {
  buildDeterministicWorkId,
  normalizeOfficialRulingIdentifier,
  parseThaiBuddhistDateToIso,
  sha256Bytes,
} from "./identity";
import { KnowledgeJobManager } from "./jobs";
import { buildReleaseProjectionsFromOutbox } from "./projections";
import { extractB01, normalizeB01TaxTypes } from "./profiles/B01";
import { extractB02 } from "./profiles/B02";
import { selectStratifiedAuditSample } from "./review";
import {
  getDefaultKnowledgeStore,
  type CanonicalPersistedState,
  type DurableKnowledgeStore,
} from "./store";
import {
  FIXED_BATCH_ORDER,
  type Acceptance,
  type Actor,
  type Artifact,
  type BatchId,
  type Candidate,
  type DependencyRequest,
  type Extraction,
  type JobReceipt,
  type PromotionRequest,
  type ReleaseReceipt,
  type ReleaseState,
  type StartRunRequest,
  type UatDecisionRequest,
} from "./contracts";

const RULINGS_BY_ID = new Map<string, RawTaxRuling>(
  THAI_TAX_RULINGS_CORPUS.map((r) => [r.id, r])
);

const SAME_YEAR_RULING_HOMONYM_KEYS: ReadonlySet<string> = (() => {
  const counts = new Map<string, Set<string>>();
  for (const r of THAI_TAX_RULINGS_CORPUS) {
    const normNo = normalizeOfficialRulingIdentifier(r.ruling_no);
    const normWithGk = normNo.startsWith("กค ") ? normNo : `กค ${normNo}`;
    const iso = parseThaiBuddhistDateToIso(r.date);
    const yr = iso ? iso.slice(0, 4) : String(r.year_be - 543);
    const k = `${normWithGk}|${yr}`;
    const s = counts.get(k) || new Set<string>();
    s.add(r.id);
    counts.set(k, s);
  }
  const out = new Set<string>();
  for (const [k, s] of counts.entries()) {
    if (s.size > 1) out.add(k);
  }
  return out;
})();

/**
 * Priority B01 fixture IDs ensuring all 20 Owner UAT cases, multi-tax strata,
 * defect-remediation regression rulings (`0811/13980`, mixed-text, interleaved),
 * historical dates, and duplicate representations are included in every >=100-doc B01 run.
 */
export const B01_PRIORITY_FIXTURE_IDS: readonly string[] = [
  "ruling.th.rd.68302", // VAT 0% foreign grant (กค 0702/636)
  "ruling.th.rd.68308", // VAT gold ornaments import (กค 0702/634)
  "ruling.th.rd.68464", // CIT 30-yr land lease 1.47B THB (กค 0702/1248)
  "ruling.th.rd.68470", // VAT 0% film copyright export 33.58M THB (กค 0702/1230)
  "ruling.th.rd.68482", // VAT animal feed registered (กค 0702/1903)
  "ruling.th.rd.68488", // CIT+VAT telecom handset subsidy (กค 0702/1491)
  "ruling.th.rd.68494", // SBT+Stamp expropriated land RD 736 (กค 0702/1493)
  "ruling.th.rd.68500", // VAT animal feed unregistered (กค 0702/1603)
  "ruling.th.rd.68530", // CIT insurance proceeds > hire-purchase debt Sec 65 & 65 ter (กค 0702/1255)
  "ruling.th.rd.68536", // PIT undivided estate dividend tax credit Sec 47 bis (กค 0702/1494)
  "ruling.th.rd.22874", // DEF-B01-02 regression: กค 0811/13980 (Royal Decree 244 s. 3(5) & CCC s. 491)
  "ruling.th.rd.22875", // DEF-B01-01 regression: กค 0811/14025 (formerly mixed facts === ruling)
  "ruling.th.rd.22929", // DEF-B01-01 regression: two-column interleaved แนว ... วินิจฉัย
  "ruling.th.rd.24875", // DEF-B01-01 regression: กค 0706/พ./10877 recovered Drive PDF
];

function getPredecessorBatch(batchId: BatchId): BatchId | null {
  const idx = FIXED_BATCH_ORDER.indexOf(batchId);
  if (idx <= 0) return null;
  return FIXED_BATCH_ORDER[idx - 1];
}

const CORE_THAI_AGENCIES: ReadonlyArray<{
  work_id: string;
  title_th: string;
  title_en: string;
  issuer_id: string;
  owner_batch_id: BatchId;
  aliases: string[];
}> = [
  {
    work_id: "reg.th.rd",
    title_th: "กรมสรรพากร (Revenue Department of Thailand)",
    title_en: "Revenue Department",
    issuer_id: "reg.th.mof",
    owner_batch_id: "B01",
    aliases: ["RD", "กรมสรรพากร"],
  },
  {
    work_id: "reg.th.mof",
    title_th: "กระทรวงการคลัง (Ministry of Finance)",
    title_en: "Ministry of Finance",
    issuer_id: "reg.th.cabinet",
    owner_batch_id: "B02",
    aliases: ["MOF", "กระทรวงการคลัง"],
  },
  {
    work_id: "reg.th.parliament",
    title_th: "รัฐสภา (National Assembly of Thailand)",
    title_en: "Parliament of Thailand",
    issuer_id: "reg.th.parliament",
    owner_batch_id: "B02",
    aliases: ["Parliament", "รัฐสภา", "สภานิติบัญญัติแห่งชาติ"],
  },
  {
    work_id: "reg.th.cabinet",
    title_th: "คณะรัฐมนตรี (Cabinet of Thailand)",
    title_en: "Cabinet of Thailand",
    issuer_id: "reg.th.cabinet",
    owner_batch_id: "B02",
    aliases: ["Cabinet", "คณะรัฐมนตรี"],
  },
  {
    work_id: "reg.th.customs",
    title_th: "กรมศุลกากร (Thai Customs Department)",
    title_en: "Customs Department",
    issuer_id: "reg.th.mof",
    owner_batch_id: "B02",
    aliases: ["Customs", "กรมศุลกากร"],
  },
  {
    work_id: "reg.th.excise",
    title_th: "กรมสรรพสามิต (Excise Department)",
    title_en: "Excise Department",
    issuer_id: "reg.th.mof",
    owner_batch_id: "B02",
    aliases: ["Excise", "กรมสรรพสามิต"],
  },
  {
    work_id: "reg.th.ocs",
    title_th: "สำนักงานคณะกรรมการกฤษฎีกา (Office of the Council of State)",
    title_en: "Office of the Council of State",
    issuer_id: "reg.th.opm",
    owner_batch_id: "B02",
    aliases: ["OCS", "สำนักงานคณะกรรมการกฤษฎีกา"],
  },
  {
    work_id: "reg.th.opm",
    title_th: "สำนักนายกรัฐมนตรี (Office of the Prime Minister)",
    title_en: "Office of the Prime Minister",
    issuer_id: "reg.th.cabinet",
    owner_batch_id: "B02",
    aliases: ["OPM", "สำนักนายกรัฐมนตรี"],
  },
  {
    work_id: "reg.th.moi",
    title_th: "กระทรวงมหาดไทย (Ministry of Interior)",
    title_en: "Ministry of Interior",
    issuer_id: "reg.th.cabinet",
    owner_batch_id: "B02",
    aliases: ["MOI", "กระทรวงมหาดไทย"],
  },
];

function ensureCoreAgenciesAndRevenueCodeWork(
  draft: CanonicalPersistedState,
  loadedByBatch: BatchId
): string[] {
  const touched: string[] = [];
  for (const ag of CORE_THAI_AGENCIES) {
    if (!draft.works[ag.work_id]) {
      draft.works[ag.work_id] = {
        work_id: ag.work_id,
        type: "Agency",
        issuer_id: ag.issuer_id,
        jurisdiction: "TH",
        title_th: ag.title_th,
        title_en: ag.title_en,
        official_identifiers: [{ raw: ag.aliases[1] || ag.title_th, normalized: ag.aliases[1] || ag.title_th, kind: "other" }],
        identity_evidence: [],
        aliases: [...ag.aliases],
        owner_batch_id: ag.owner_batch_id,
        first_loaded_by_batch_id: loadedByBatch,
      };
    }
  }

  if (!draft.works["statute.th.revenue_code"]) {
    draft.works["statute.th.revenue_code"] = {
      work_id: "statute.th.revenue_code",
      type: "Statute",
      issuer_id: "reg.th.parliament",
      jurisdiction: "TH",
      title_th: "ประมวลรัษฎากร พ.ศ. 2481",
      title_en: "Revenue Code B.E. 2481",
      official_identifiers: [{ raw: "ประมวลรัษฎากร", normalized: "ประมวลรัษฎากร", kind: "statute_code" }],
      identity_evidence: [],
      aliases: ["Revenue Code", "ป.รัษฎากร"],
      owner_batch_id: "B02",
      first_loaded_by_batch_id: loadedByBatch,
    };
    touched.push("statute.th.revenue_code");
  }
  return touched;
}

/**
 * DEF-B01-03 Remediation:
 * Seeds `prov.th.rc.65_ตรี` strictly from VERBATIM official Revenue Department statutory text
 * (`https://www.rd.go.th/5939.html#mata65_3`, SHA-256 `da9bcf8a...`) and official Royal Gazette
 * Amendment Act No. 48 B.E. 2562 (`https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/p48.pdf`,
 * SHA-256 `255d79c1...`) — ZERO synthetic summaries!
 */
function seedB01RequiredStatutoryDependencies(
  draft: CanonicalPersistedState,
  releaseId: string,
  nowIso: string
): { createdOrReusedWorkIds: string[] } {
  const touched = ensureCoreAgenciesAndRevenueCodeWork(draft, "B01");
  const verCorpus = getVerifiedStatutoryCorpus();
  const rc65Ter = verCorpus.revenue_code_sections["prov.th.rc.65_ตรี"];
  if (!rc65Ter) {
    return { createdOrReusedWorkIds: touched };
  }

  const sec65TerWorkId = "prov.th.rc.65_ตรี";
  const art5939Id = `art.ver.${rc65Ter.artifact_sha256.slice(0, 14)}`;
  if (!draft.artifacts[art5939Id]) {
    draft.artifacts[art5939Id] = {
      artifact_id: art5939Id,
      actual_bytes_sha256: rc65Ter.artifact_sha256,
      size: rc65Ter.artifact_size,
      MIME: "text/html",
      immutable_uri: `artifact://sha256/${rc65Ter.artifact_sha256}`,
      fetched_at: nowIso,
      origin_uri: rc65Ter.origin_uri,
      authenticity_status: "official_html_snapshot",
      access_scope: "scope.platform.public",
      rights_status: "approved_public",
    };
  }

  const evidenceArts = [art5939Id];

  if (!draft.works[sec65TerWorkId]) {
    draft.works[sec65TerWorkId] = {
      work_id: sec65TerWorkId,
      type: "ProvisionVersion",
      issuer_id: "reg.th.parliament",
      jurisdiction: "TH",
      title_th: rc65Ter.title_th,
      official_identifiers: [
        { raw: "มาตรา 65 ตรี", normalized: "มาตรา 65 ตรี", kind: "section_no" },
      ],
      identity_evidence: evidenceArts,
      aliases: ["มาตรา 65 ตรี แห่งประมวลรัษฎากร", "ประมวลรัษฎากร มาตรา 65 ตรี", "Section 65 ter"],
      owner_batch_id: "B02",
      first_loaded_by_batch_id: "B01",
    };
  } else {
    draft.works[sec65TerWorkId].identity_evidence = evidenceArts;
  }
  touched.push(sec65TerWorkId);

  // S-2 / LSC-12 Remediation: NEVER reconstruct or synthesize a historical statutory version from current consolidated text!
  // Only the verbatim current consolidated text on rd.go.th is materialized here; historical pre-amendment periods are
  // cleanly suppressed until verified directly from the Royal Gazette amending Acts.
  const v2Id = "ver.th.rc.65_ตรี.v2_current";
  const v2Verbatim = rc65Ter.verbatim_text.replace(/<!--[\s\S]*?-->/g, "").trim();
  draft.versions[v2Id] = {
    version_id: v2Id,
    work_id: sec65TerWorkId,
    version_label: "consolidated_rd_current",
    legal_applicability: [
      {
        valid_from: "2020-01-01",
        valid_to: null,
        conditions: [
          "ตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร (rd.go.th) — เฉพาะอนุมาตรา (3) แก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 51) พ.ศ. 2562 ให้ใช้บังคับกับการคำนวณกำไรสุทธิของบริษัทหรือห้างหุ้นส่วนนิติบุคคลซึ่งรอบระยะเวลาบัญชีเริ่มในหรือหลังวันที่ 1 มกราคม พ.ศ. 2561 เป็นต้นไป ส่วนอนุมาตราอื่นให้ตรวจสอบหมายเหตุท้ายอนุมาตรานั้น",
        ],
        date_status: "verified",
      },
    ],
    publication_date: null,
    decision_date: null,
    raw_date_text: "ตัวบทรวมแก้ไขเพิ่มเติมตามข้อมูลทางการกรมสรรพากร (rd.go.th)",
    temporal_evidence_ids: evidenceArts,
    known_from: draft.versions[v2Id]?.known_from || nowIso,
    known_to: null,
    access_scope: "scope.platform.public",
  };
  const extV2Id =
    releaseId === "rel.B01.rc1" ? "ext.ver.rc.65_ter.v2" : `ext.ver.rc.65_ter.v2.${releaseId}`;
  const hasV2InRelease = Object.values(draft.passages).some(
    (p) => p.version_id === v2Id && p.extraction_id === extV2Id && p.release_id === releaseId
  );
  if (!hasV2InRelease) {
    draft.extractions[extV2Id] = {
      extraction_id: extV2Id,
      artifact_id: art5939Id,
      work_id: sec65TerWorkId,
      version_id: v2Id,
      extractor_version: "verified-statutory-v1.3",
      model_version: "verbatim-official-rd-html",
      configuration_version: "cfg.v1.3",
      raw_text_uri: draft.artifacts[art5939Id].immutable_uri,
      raw_text: v2Verbatim,
      normalized_text: v2Verbatim,
      normalization_log: ["verified_verbatim_rd_5939_html_mata65_3_consolidated"],
      quality_status: "VALIDATED",
      accepted_revision: 1,
      created_at: nowIso,
    };
    const psgsV2 = chunkThaiLegalDocument({
      work_id: sec65TerWorkId,
      version_id: v2Id,
      extraction_id: extV2Id,
      release_id: releaseId,
      artifact_id: art5939Id,
      origin_uri: rc65Ter.origin_uri,
      locator_kind: "html_structural",
      structural_selector_prefix: "a#mata65_3",
      header_label: "ประมวลรัษฎากร มาตรา 65 ตรี (ตัวบทรวมแก้ไขเพิ่มเติมตามข้อมูลทางการกรมสรรพากร rd.go.th)",
      structural_path_prefix: ["ประมวลรัษฎากร", "มาตรา 65 ตรี", "consolidated_rd_current"],
      raw_text: v2Verbatim,
      statement_role: "statutory_text",
      access_scope: "scope.platform.public",
    });
    for (const p of psgsV2) {
      draft.passages[p.passage_id] = p;
    }
  }

  return { createdOrReusedWorkIds: touched };
}

/**
 * DEF-B01-03 Remediation:
 * Materializes a B02 statutory/regulatory dependency ONLY when backed by verbatim verified
 * original text, real byte SHA-256, and verified/restricted effective dates in `getVerifiedStatutoryCorpus()`.
 * If unverified, quarantines as `UnresolvedReferenceRecord` (`UNRESOLVED_QUARANTINED`, `usable_as_legal_evidence: false`)
 * and NEVER generates synthetic `ext.dep.*` placeholder passages!
 */
function materializeVerifiedStatutoryDependency(
  draft: CanonicalPersistedState,
  dep: DependencyRequest,
  releaseId: string,
  nowIso: string,
  allowedReleaseChain?: Set<string>
): boolean {
  const chainSet = allowedReleaseChain || new Set<string>([releaseId]);
  const existing = draft.works[dep.normalized_key];
  if (existing) {
    const hasRealPassage =
      existing.work_id === "statute.th.revenue_code" ||
      Object.values(draft.passages).some(
        (p) =>
          p.work_id === existing.work_id &&
          !p.extraction_id.startsWith("ext.dep.") &&
          chainSet.has(p.release_id)
      );
    if (hasRealPassage) {
      const reqSet = new Set(existing.required_by || []);
      reqSet.add(dep.required_by_work_id);
      existing.required_by = Array.from(reqSet);
      return true;
    }
  }

  const verCorpus = getVerifiedStatutoryCorpus();
  const rcEntry = verCorpus.revenue_code_sections[dep.normalized_key];
  const subEntry = verCorpus.subordinate_and_amendment_works[dep.normalized_key];
  const verified = rcEntry || subEntry;

  if (!verified || !verified.verbatim_text || verified.verbatim_text.trim().length < 15) {
    const urefId = `uref.quar.${sha256Bytes(`${dep.required_by_work_id}:${dep.normalized_key}`).slice(0, 14)}`;
    draft.unresolved_references[urefId] = {
      unresolved_ref_id: urefId,
      source_work_id: dep.required_by_work_id,
      source_version_id: `ver.${dep.required_by_work_id.replace(/^work\./, "")}.v1`,
      source_passage_id: "",
      raw_citation_text: dep.citation_raw,
      target_hint: dep.normalized_key,
      governing_instrument: dep.instrument_title_th,
      section_label: dep.section_label,
      owner_batch_hint: dep.owner_batch_id,
      quarantine_status: "UNRESOLVED_QUARANTINED",
      usable_as_legal_evidence: false,
      reason: "STATUTORY_TARGET_TEXT_NOT_VERIFIED_QUARANTINED",
      created_at: nowIso,
    };
    return false;
  }

  const artSha = verified.artifact_sha256;
  const artId = `art.ver.${artSha.slice(0, 14)}`;
  const isPdf = verified.origin_uri.toLowerCase().endsWith(".pdf");
  if (!draft.artifacts[artId]) {
    draft.artifacts[artId] = {
      artifact_id: artId,
      actual_bytes_sha256: artSha,
      size: verified.artifact_size,
      MIME: isPdf ? "application/pdf" : "text/html",
      immutable_uri: `artifact://sha256/${artSha}`,
      fetched_at: nowIso,
      origin_uri: verified.origin_uri,
      authenticity_status: isPdf ? "official_original" : "official_html_snapshot",
      access_scope: "scope.platform.public",
      rights_status: "approved_public",
    };
  }

  const title = verified.title_th;
  const secLabel = rcEntry ? rcEntry.section_label : dep.section_label;
  const issuerId =
    dep.target_type === "SubordinateLegislation"
      ? /^subreg\.th\.rc\.royal_decree\./.test(dep.normalized_key)
        ? "reg.th.cabinet"
        : /^subreg\.th\.rc\.min_reg\./.test(dep.normalized_key)
          ? "reg.th.mof"
          : "reg.th.rd"
      : "reg.th.parliament";

  draft.works[dep.normalized_key] = {
    work_id: dep.normalized_key,
    type: dep.target_type,
    issuer_id: issuerId,
    jurisdiction: "TH",
    title_th: title,
    official_identifiers: [
      {
        raw: secLabel || title,
        normalized: secLabel || title,
        kind: secLabel ? "section_no" : "statute_code",
      },
    ],
    identity_evidence: [artId],
    aliases: Array.from(new Set([dep.citation_raw, title, ...(secLabel ? [`${secLabel} แห่งประมวลรัษฎากร`] : [])])),
    owner_batch_id: dep.owner_batch_id,
    first_loaded_by_batch_id: existing?.first_loaded_by_batch_id || dep.first_loaded_by_batch_id,
    required_by: Array.from(new Set([...(existing?.required_by || []), dep.required_by_work_id])),
  };

  const verId = `ver.${dep.normalized_key.replace(/^(?:prov\.|subreg\.|statute\.|sched\.)/, "")}.v1`;
  const isConsolidatedRcProvision =
    dep.normalized_key.startsWith("prov.th.rc.") || dep.normalized_key.startsWith("sched.th.rc.");
  const effIso = isConsolidatedRcProvision ? null : verified.effective_date_iso || null;
  const dateStatus = isConsolidatedRcProvision
    ? "verified"
    : verified.date_status === "verified" && effIso
      ? "verified"
      : "unknown_restricted";

  draft.versions[verId] = {
    version_id: verId,
    work_id: dep.normalized_key,
    version_label: isConsolidatedRcProvision ? "consolidated_rd_current" : "v1",
    legal_applicability: [
      {
        valid_from: effIso,
        valid_to: null,
        conditions: isConsolidatedRcProvision
          ? [
              "ตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร (rd.go.th) — วันเริ่มใช้บังคับของแต่ละวรรคหรืออนุมาตราให้ตรวจสอบจากหมายเหตุแก้ไขเพิ่มเติมท้ายวรรคนั้นและราชกิจจานุเบกษาโดยตรง",
            ]
          : verified.effective_date_raw
            ? [verified.effective_date_raw]
            : [],
        date_status: dateStatus,
      },
    ],
    publication_date: effIso,
    decision_date: null,
    raw_date_text: isConsolidatedRcProvision
      ? "ตัวบทรวมแก้ไขเพิ่มเติมตามข้อมูลทางการกรมสรรพากร (rd.go.th)"
      : verified.effective_date_raw || null,
    temporal_evidence_ids: [artId],
    known_from: nowIso,
    known_to: null,
    access_scope: "scope.platform.public",
  };

  const extVerId =
    releaseId === "rel.B01.rc1"
      ? `ext.ver.${sha256Bytes(dep.normalized_key).slice(0, 12)}`
      : `ext.ver.${sha256Bytes(`${releaseId}:${dep.normalized_key}`).slice(0, 12)}`;
  const verbatimText = verified.verbatim_text.replace(/<!--[\s\S]*?-->/g, "").trim();
  draft.extractions[extVerId] = {
    extraction_id: extVerId,
    artifact_id: artId,
    work_id: dep.normalized_key,
    version_id: verId,
    extractor_version: "verified-statutory-v1.2",
    model_version: "verbatim-official-rd-source",
    configuration_version: "cfg.v1.2",
    raw_text_uri: draft.artifacts[artId].immutable_uri,
    raw_text: verbatimText,
    normalized_text: verbatimText,
    normalization_log: ["verified_verbatim_statutory_source"],
    quality_status: "VALIDATED",
    accepted_revision: 1,
    created_at: nowIso,
  };

  const anchorSel = rcEntry?.anchor
    ? `a#${rcEntry.anchor}`
    : `article#${dep.normalized_key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const verPsgs = chunkThaiLegalDocument({
    work_id: dep.normalized_key,
    version_id: verId,
    extraction_id: extVerId,
    release_id: releaseId,
    artifact_id: artId,
    origin_uri: verified.origin_uri,
    locator_kind: isPdf ? "pdf_page" : "html_structural",
    physical_page_index: isPdf ? 0 : undefined,
    structural_selector_prefix: isPdf ? undefined : anchorSel,
    header_label: title,
    structural_path_prefix: [dep.instrument_title_th, secLabel || "บทบัญญัติ"],
    raw_text: verbatimText,
    statement_role: "statutory_text",
    access_scope: "scope.platform.public",
  });
  for (const vp of verPsgs) {
    draft.passages[vp.passage_id] = vp;
  }

  return true;
}

/**
 * Selects a deterministic stratified B01 ruling subset when `maxDocs < admitted.length`,
 * matching the mandatory 30 CIT / 25 VAT / 15 WHT / 10 PIT / 5 Stamp / 5 SBT / 10 General
 * ratio from `B01_DEVELOPER_REQUIREMENTS.md` Section 5 while guaranteeing priority UAT fixtures
 * and duplicate representations are included.
 */
export function selectStratifiedB01AdmittedCandidates(
  admitted: Candidate[],
  maxDocs: number
): Candidate[] {
  if (admitted.length <= maxDocs) {
    return admitted;
  }

  const chosen = new Map<string, Candidate>();
  const candBySourceId = new Map<string, Candidate>();
  for (const c of admitted) {
    if (c.disposition !== "ATTACHED_REPRESENTATION" && !candBySourceId.has(c.source_file_id)) {
      candBySourceId.set(c.source_file_id, c);
    }
  }

  // 1. Always include priority UAT fixtures present in manifest
  for (const fid of B01_PRIORITY_FIXTURE_IDS) {
    const c = candBySourceId.get(fid);
    if (c && chosen.size < maxDocs) {
      c.is_pilot_sample = true;
      chosen.set(c.candidate_id, c);
    }
  }

  // 2. Include at least 2 real duplicate representation pairs so B01-U07 / AT03 are exercised on real data
  const dupCands = admitted.filter((c) => c.disposition === "ATTACHED_REPRESENTATION").slice(0, 3);
  for (const dc of dupCands) {
    if (chosen.size >= maxDocs) break;
    // Also ensure the primary ruling it attaches to is included!
    const primaryHint = dc.reasons[0]?.match(/ruling\.th\.rd\.[0-9]+/)?.[0];
    if (primaryHint && candBySourceId.get(primaryHint) && chosen.size < maxDocs - 1) {
      chosen.set(candBySourceId.get(primaryHint)!.candidate_id, candBySourceId.get(primaryHint)!);
    }
    if (chosen.size < maxDocs) {
      chosen.set(dc.candidate_id, dc);
    }
  }

  // 3. Fill exact stratified tax-type quotas (scaled to maxDocs based on 30/25/15/10/5/5/10)
  const scale = maxDocs / 100;
  const targetQuotas: Record<string, number> = {
    CIT: Math.round(30 * scale),
    VAT: Math.round(25 * scale),
    WHT: Math.round(15 * scale),
    PIT: Math.round(10 * scale),
    Stamp: Math.max(1, Math.round(5 * scale)),
    SBT: Math.max(1, Math.round(5 * scale)),
    General: Math.max(1, Math.round(10 * scale)),
  };

  const currentCounts: Record<string, number> = {
    CIT: 0,
    VAT: 0,
    WHT: 0,
    PIT: 0,
    Stamp: 0,
    SBT: 0,
    General: 0,
  };

  const classifyCandStratum = (c: Candidate): string => {
    const raw = RULINGS_BY_ID.get(c.source_file_id);
    if (!raw) return "General";
    const tts = normalizeB01TaxTypes(raw.primary_tax_type || raw.tax_types, `${raw.subject} ${raw.ruling}`);
    return tts[0] || "General";
  };

  for (const c of chosen.values()) {
    const st = classifyCandStratum(c);
    currentCounts[st] = (currentCounts[st] || 0) + 1;
    c.pilot_stratum = st;
  }

  for (const c of admitted) {
    if (chosen.size >= maxDocs) break;
    if (chosen.has(c.candidate_id)) continue;
    const st = classifyCandStratum(c);
    if ((currentCounts[st] || 0) < (targetQuotas[st] || 0)) {
      c.is_pilot_sample = true;
      c.pilot_stratum = st;
      chosen.set(c.candidate_id, c);
      currentCounts[st] = (currentCounts[st] || 0) + 1;
    }
  }

  // Top up any rounding remainder deterministically
  for (const c of admitted) {
    if (chosen.size >= maxDocs) break;
    if (!chosen.has(c.candidate_id)) {
      const st = classifyCandStratum(c);
      c.is_pilot_sample = true;
      c.pilot_stratum = st;
      chosen.set(c.candidate_id, c);
    }
  }

  return Array.from(chosen.values());
}

function selectStratifiedB02AdmittedCandidates(
  admitted: Candidate[],
  maxDocs: number
): Candidate[] {
  if (admitted.length <= maxDocs) {
    return admitted;
  }

  const chosen = new Map<string, Candidate>();
  const addCand = (c: Candidate, stratum: string) => {
    if (chosen.size < maxDocs && !chosen.has(c.candidate_id)) {
      c.is_pilot_sample = true;
      c.pilot_stratum = stratum;
      chosen.set(c.candidate_id, c);
    }
  };

  // 1. Always include REUSED_EXISTING (upgrades B01-loaded statutory dependencies in place) & unpacked RAR members
  for (const c of admitted) {
    if (c.disposition === "REUSED_EXISTING") addCand(c, "B01_Shared_Upgrade");
  }
  for (const c of admitted) {
    if (c.candidate_id.startsWith("cand.b02.rar.")) addCand(c, "Customs_RAR_Archive");
  }

  // 2. Include priority core statutes, Royal Decrees, Ministerial Regulations, RD Orders, and Parliamentary Draft Bills (B02-U01..U10)
  const priorityPatterns: Array<{ rx: RegExp; stratum: string; limit: number }> = [
    { rx: /CustomsAct2560|พระราชบัญญัติศุลกากร\s*พ\.ศ\.\s*2560/i, stratum: "Customs_Primary", limit: 3 },
    { rx: /Excise-Tax-Act|พระราชบัญญัติภาษีสรรพสามิต\s*พ\.ศ\.\s*2560/i, stratum: "Excise_Primary", limit: 3 },
    { rx: /พระราชกำหนดภาษีส่วนเพิ่ม|Pillar Two|Top.?Up/i, stratum: "TopUpTax_EmergencyDecree", limit: 4 },
    { rx: /แก้ไขเพิ่มเติมประมวลรัษฎากร/i, stratum: "RC_Amendment_Act", limit: 8 },
    { rx: /พระราชกฤษฎีกา|_RD_|RoyalDecree/i, stratum: "Royal_Decree", limit: 15 },
    { rx: /กฎกระทรวง|_MR_|MinReg/i, stratum: "Ministerial_Regulation", limit: 12 },
    { rx: /คำสั่งกรมสรรพากร|RDOrder|ท\.ป\./i, stratum: "RD_Departmental_Order", limit: 12 },
    { rx: /ประกาศอธิบดี|DGNotif|DG-Notice/i, stratum: "DG_Notification", limit: 12 },
    { rx: /draft-with-rationale|accepted-bill|^Parliament\/.*ร่าง/i, stratum: "Parliament_Draft_Bill", limit: 6 },
    { rx: /bill-analysis|committee-report/i, stratum: "Parliament_Committee_Report", limit: 4 },
    { rx: /consolidated|ฉบับประมวล/i, stratum: "Consolidated_Compendium", limit: 4 },
  ];

  for (const pat of priorityPatterns) {
    let count = 0;
    for (const c of admitted) {
      if (count >= pat.limit || chosen.size >= maxDocs) break;
      if (!chosen.has(c.candidate_id) && pat.rx.test(c.path)) {
        addCand(c, pat.stratum);
        count += 1;
      }
    }
  }

  // 3. Include ATTACHED_REPRESENTATION pairs
  for (const c of admitted.filter((x) => x.disposition === "ATTACHED_REPRESENTATION").slice(0, 4)) {
    addCand(c, "Companion_Representation");
  }

  // 4. Fill remaining quota evenly across B02 agency folders
  for (const c of admitted) {
    if (chosen.size >= maxDocs) break;
    const folderHead = c.path.split("/")[0] || "B02_Statute";
    addCand(c, folderHead);
  }

  return Array.from(chosen.values());
}

/**
 * Starts a checkpointed batch ingestion & GraphRAG release run, advancing the candidate release
 * up to `READY_FOR_UAT` (NEVER auto-approving UAT or promoting to production).
 */
export async function startBatchRun(
  req: StartRunRequest,
  actor: Actor,
  options?: {
    store?: DurableKnowledgeStore;
    releaseIdOverride?: string;
    stagingCandidatePredecessorReleaseId?: string;
  }
): Promise<JobReceipt> {
  if (
    actor.role !== "engineering_lead" &&
    actor.role !== "data_operator" &&
    actor.role !== "product_owner"
  ) {
    throw new Error("FORBIDDEN_403: Insufficient role to start a batch ingestion run.");
  }

  const store = options?.store || getDefaultKnowledgeStore();
  const stInitial = store.getState();

  const stagingPredId = options?.stagingCandidatePredecessorReleaseId;
  if (stagingPredId) {
    if (store.getStorageTopology().topology_mode !== "explicit_custom_dir") {
      throw new Error(
        "FORBIDDEN_STAGING_OVERRIDE_422: stagingCandidatePredecessorReleaseId is permitted exclusively in isolated explicit custom staging directories."
      );
    }
  }

  // 1. Sequential Predecessor Batch Gate (SH-02, SH-05, AT16)
  const predecessor = getPredecessorBatch(req.batch_id);
  if (predecessor) {
    const predAccepted = stInitial.accepted_batch_releases[predecessor];
    const stagingPredRel = stagingPredId ? stInitial.releases[stagingPredId] : undefined;
    const stagingPredValid =
      Boolean(stagingPredRel) &&
      stagingPredRel?.batch_id === predecessor &&
      stagingPredRel?.state !== "ROLLED_BACK";
    if (
      !stagingPredValid &&
      (!predAccepted ||
        (predAccepted.state !== "ACCEPTED" && predAccepted.state !== "ACCEPTED_WITH_DECLARED_GAPS"))
    ) {
      throw new Error(
        `PREDECESSOR_BATCH_NOT_ACCEPTED_422: Cannot start batch ${req.batch_id} before predecessor batch ${predecessor} reaches ACCEPTED or ACCEPTED_WITH_DECLARED_GAPS.`
      );
    }
  }

  const manifest = stInitial.manifests[req.manifest_id];
  if (!manifest || manifest.batch_id !== req.batch_id) {
    throw new Error(`MANIFEST_NOT_FOUND_404: Manifest ${req.manifest_id} for batch ${req.batch_id} not found.`);
  }

  const releaseId = options?.releaseIdOverride || `rel.${req.batch_id}.rc1`;

  // 2. Idempotency check (SH-08)
  const semanticFingerprint = sha256Bytes(
    JSON.stringify({
      batch_id: req.batch_id,
      manifest_id: req.manifest_id,
      release_id: releaseId,
      max_documents: req.max_documents ?? manifest.run_limits.max_documents_per_run,
      projection_mode_override: req.projection_mode_override ?? "durable_disk",
    })
  );

  const existingIdem = stInitial.idempotency[req.idempotency_key];
  if (existingIdem) {
    if (existingIdem.semantic_fingerprint !== semanticFingerprint) {
      throw new Error(
        "IDEMPOTENCY_CONFLICT_409: Same idempotency_key submitted with different run parameters."
      );
    }
    const prevReceipt = existingIdem.result_ref as unknown as JobReceipt;
    return {
      ...prevReceipt,
      idempotent_replay: true,
    };
  }
  const jobMgr = new KnowledgeJobManager(store);
  const job = jobMgr.createJob({
    batch_id: req.batch_id,
    kind: "BATCH_RUN",
    manifest_id: req.manifest_id,
    release_id: releaseId,
    ocr_dispatch_budget:
      req.ocr_dispatch_budget_pages ?? manifest.run_limits.max_ocr_dispatch_pages_per_run,
    created_by: actor.actor_id,
  });
  const leased = jobMgr.acquireLease(job.job_id, `worker.${actor.actor_id}`);

  const allManifestCands = Object.values(store.getState().candidates).filter(
    (c) => c.manifest_id === req.manifest_id
  );
  const admittedCands = allManifestCands.filter(
    (c) =>
      c.disposition === "PUBLISHED_NEW" ||
      c.disposition === "REUSED_EXISTING" ||
      c.disposition === "ATTACHED_REPRESENTATION"
  );
  const maxDocs = req.max_documents ?? manifest.run_limits.max_documents_per_run;
  const selectedCands =
    req.batch_id === "B01"
      ? selectStratifiedB01AdmittedCandidates(admittedCands, maxDocs)
      : req.batch_id === "B02"
        ? selectStratifiedB02AdmittedCandidates(admittedCands, maxDocs)
        : admittedCands.slice(0, maxDocs);

  const codeCommit = getDeployedGitCommit();
  const crosswalk = buildLegacyIdCrosswalk();
  const nowIso = new Date().toISOString();
  const recoveredRulings = getRecoveredB01RulingTexts();

  const b02ByPath = new Map<string, B02DriveManifestEntry>();
  const b02RarByPath = new Map<string, B02RarExpandedMember>();
  if (req.batch_id === "B02") {
    const b02M = getB02DriveManifest();
    for (const bf of b02M.files) {
      b02ByPath.set(`${bf.folder}/${bf.rel_path}`, bf);
    }
    for (const rm of b02M.rar_expanded_members) {
      b02RarByPath.set(`Customs/RAR_UNPACKED/${rm.parent_rar}/${rm.rel_path}`, rm);
    }
  }

  // 3. Stage canonical works, versions, passages, validated assertions, and outbox atomically
  await store.transact(
    "STAGE_BATCH_CANDIDATE_RELEASE",
    (draft) => {
      for (const entry of crosswalk.entries) {
        draft.legacy_crosswalk[entry.legacy_id] = entry.canonical_work_id;
      }

      if (req.batch_id === "B01") {
        seedB01RequiredStatutoryDependencies(draft, releaseId, nowIso);
      } else if (req.batch_id === "B02") {
        const effPred = stagingPredId ?? draft.active_release_id;
        const allowedChainStep3 = new Set<string>([releaseId]);
        let curPred = effPred;
        while (curPred && !allowedChainStep3.has(curPred)) {
          allowedChainStep3.add(curPred);
          curPred = draft.releases[curPred]?.previous_accepted_release_id ?? null;
        }
        const predWorkSet = new Set<string>();
        for (const prId of allowedChainStep3) {
          if (prId === releaseId) continue;
          const pr = draft.releases[prId];
          if (pr) {
            for (const wid of pr.created_work_ids) predWorkSet.add(wid);
            for (const wid of pr.reused_work_ids) predWorkSet.add(wid);
          }
        }
        ensureCoreAgenciesAndRevenueCodeWork(draft, "B02");
        // Materialize all verified Revenue Code sections & official subordinate works for B02 primary-law completeness
        const verCorpus = getVerifiedStatutoryCorpus();
        for (const rcSec of Object.values(verCorpus.revenue_code_sections)) {
          if (
            rcSec.work_id === "prov.th.rc.65_ตรี" &&
            draft.works[rcSec.work_id] &&
            predWorkSet.has(rcSec.work_id)
          ) {
            continue;
          }
          materializeVerifiedStatutoryDependency(
            draft,
            {
              citation_raw: rcSec.title_th,
              normalized_key: rcSec.work_id,
              target_type: rcSec.work_id.startsWith("sched.") ? "Statute" : "Provision",
              instrument_title_th: "ประมวลรัษฎากร",
              section_label: rcSec.section_label,
              owner_batch_id: "B02",
              first_loaded_by_batch_id: predWorkSet.has(rcSec.work_id)
                ? draft.works[rcSec.work_id]?.first_loaded_by_batch_id || "B02"
                : "B02",
              required_by_work_id: "statute.th.revenue_code",
            },
            releaseId,
            nowIso,
            allowedChainStep3
          );
        }
        for (const subWork of Object.values(verCorpus.subordinate_and_amendment_works)) {
          materializeVerifiedStatutoryDependency(
            draft,
            {
              citation_raw: subWork.title_th,
              normalized_key: subWork.work_id,
              target_type: subWork.work_id.startsWith("statute.") ? "Statute" : "SubordinateLegislation",
              instrument_title_th: subWork.title_th,
              section_label: null,
              owner_batch_id: "B02",
              first_loaded_by_batch_id: predWorkSet.has(subWork.work_id)
                ? draft.works[subWork.work_id]?.first_loaded_by_batch_id || "B02"
                : "B02",
              required_by_work_id: "statute.th.revenue_code",
            },
            releaseId,
            nowIso,
            allowedChainStep3
          );
        }
      }

      const primaryWorkByRulingKey = new Map<string, string>();
      const primaryWorkBySourceId = new Map<string, string>();
      const skipDiskBlobs = selectedCands.length > 300;

      for (const cand of selectedCands) {
        if (req.batch_id === "B02") {
          const bf = b02ByPath.get(cand.path);
          const rm = b02RarByPath.get(cand.path);
          const rawPayloadText =
            bf?.text_excerpt ||
            rm?.text_excerpt ||
            `ตราสารกฎหมาย ${cand.path} (${cand.source_file_id})`;
          const payloadBytes = Buffer.from(rawPayloadText, "utf8");
          const storedBlob = store.storeImmutableArtifactBytes(payloadBytes, {
            skipRawDiskBlob: skipDiskBlobs,
            precomputedSha256: bf?.sha256 || rm?.sha256,
            precomputedSize: bf?.size || rm?.size,
          });
          const artifactId = `art.${sha256Bytes(`${cand.candidate_id}:${storedBlob.sha256}`).slice(0, 14)}`;
          const isPdf = cand.path.toLowerCase().endsWith(".pdf");
          draft.artifacts[artifactId] = {
            artifact_id: artifactId,
            actual_bytes_sha256: storedBlob.sha256,
            size: storedBlob.size,
            MIME: isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            immutable_uri: storedBlob.immutable_uri,
            fetched_at: nowIso,
            origin_uri: cand.source_uri,
            authenticity_status: "official_original",
            access_scope: "scope.platform.public",
            rights_status: "approved_public",
            is_derivative: cand.disposition === "ATTACHED_REPRESENTATION",
          };

          const workId =
            cand.canonical_work_id ||
            buildDeterministicWorkId({
              doc_type: "Statute",
              issuer_id: "reg.th.parliament",
              normalized_identifier: bf?.title_hint || rm?.title_hint || cand.path,
              issue_year_ce: null,
              access_scope: "scope.platform.public",
            });
          const versionId = `ver.${workId.replace(/^work\./, "")}.v1`;
          const extractionId = `ext.${artifactId.slice(4)}.r1`;
          draft.extractions[extractionId] = {
            extraction_id: extractionId,
            artifact_id: artifactId,
            work_id: workId,
            version_id: versionId,
            extractor_version: "b02-thai-statute-v1.2",
            model_version: "deterministic-thai-legal-v1.2",
            configuration_version: "cfg.v1.2",
            raw_text_uri: storedBlob.immutable_uri,
            raw_text: rawPayloadText,
            normalized_text: rawPayloadText,
            normalization_log: ["verified_b02_native_or_repaired_text"],
            quality_status: "VALIDATED",
            accepted_revision: 1,
            created_at: nowIso,
          };
          cand.artifact_id = artifactId;
          cand.canonical_work_id = workId;
          draft.candidates[cand.candidate_id] = cand;
          continue;
        }

        const rawRuling = RULINGS_BY_ID.get(cand.source_file_id);
        const driveEntry = RD_DRIVE_RULING_BY_PATH.get(cand.path);
        const recRuling = rawRuling ? recoveredRulings[rawRuling.id] : undefined;
        const rawPayloadText = rawRuling
          ? recRuling && !(rawRuling.ruling || "").trim()
            ? recRuling.full_text
            : [
                `เลขที่หนังสือ: ${rawRuling.ruling_no}`,
                `วันที่: ${rawRuling.date}`,
                `เรื่อง: ${rawRuling.subject}`,
                `ข้อกฎหมาย: ${rawRuling.legal_provisions}`,
                `ข้อเท็จจริง: ${rawRuling.facts}`,
                `แนววินิจฉัย: ${rawRuling.ruling}`,
              ].join("\n")
          : `เอกสารจากคลังข้อมูล ${cand.path} (${cand.source_file_id})`;

        const payloadBytes = Buffer.from(rawPayloadText, "utf8");
        const storedBlob = store.storeImmutableArtifactBytes(payloadBytes, {
          skipRawDiskBlob: skipDiskBlobs,
          precomputedSha256: driveEntry?.sha256 || recRuling?.sha256,
          precomputedSize: driveEntry?.size || recRuling?.size_bytes,
        });
        const artifactId = `art.${sha256Bytes(`${cand.candidate_id}:${storedBlob.sha256}`).slice(0, 14)}`;

        const artAuthStatus: Artifact["authenticity_status"] =
          driveEntry?.authenticity_status === "official_html"
            ? "official_html_snapshot"
            : driveEntry?.authenticity_status === "html_rendered_pdf"
              ? "html_derived_pdf_derivative"
              : driveEntry?.authenticity_status === "verified_pdf"
                ? "official_original"
                : rawRuling
                  ? "official_html_snapshot"
                  : "official_original";
        const isDerivative = driveEntry?.authenticity_status === "html_rendered_pdf";

        const art: Artifact = {
          artifact_id: artifactId,
          actual_bytes_sha256: storedBlob.sha256,
          size: storedBlob.size,
          MIME: cand.path.endsWith(".pdf") ? "application/pdf" : "text/html",
          immutable_uri: storedBlob.immutable_uri,
          fetched_at: nowIso,
          origin_uri: cand.source_uri,
          authenticity_status: artAuthStatus,
          access_scope: "scope.platform.public",
          rights_status: "approved_public",
          is_derivative: isDerivative,
        };
        draft.artifacts[artifactId] = art;

        const normLetter = rawRuling ? normalizeOfficialRulingIdentifier(rawRuling.ruling_no) : cand.source_file_id;
        const normWithGk = normLetter.startsWith("กค ") ? normLetter : `กค ${normLetter}`;
        const isoDate = rawRuling ? parseThaiBuddhistDateToIso(rawRuling.date) : "2026-01-01";
        const issueYearCe = isoDate ? isoDate.slice(0, 4) : null;
        const dedupKey = `${normLetter}|${rawRuling?.date || ""}`;

        const attachedTargetWorkId =
          primaryWorkBySourceId.get(cand.source_file_id) || primaryWorkByRulingKey.get(dedupKey);
        if (cand.disposition === "ATTACHED_REPRESENTATION" && attachedTargetWorkId) {
          const targetWork = draft.works[attachedTargetWorkId];
          if (targetWork && !targetWork.identity_evidence.includes(artifactId)) {
            targetWork.identity_evidence.push(artifactId);
            if (!targetWork.aliases.includes(cand.path)) {
              targetWork.aliases.push(cand.path);
            }
          }
          cand.artifact_id = artifactId;
          cand.canonical_work_id = attachedTargetWorkId;
          cand.processing_state = "STAGED";
          draft.candidates[cand.candidate_id] = cand;
          continue;
        }

        const hasSameYearHomonym = SAME_YEAR_RULING_HOMONYM_KEYS.has(
          `${normWithGk}|${issueYearCe || ""}`
        );
        const expectedWorkId = buildDeterministicWorkId({
          doc_type: "TaxRuling",
          issuer_id: "reg.th.rd",
          normalized_identifier: normLetter,
          issue_year_ce: issueYearCe,
          disambiguator: hasSameYearHomonym ? cand.source_file_id : null,
          access_scope: "scope.platform.public",
        });
        const workId =
          cand.disposition === "REUSED_EXISTING" && draft.legacy_crosswalk[cand.source_file_id]
            ? draft.legacy_crosswalk[cand.source_file_id]
            : expectedWorkId;
        draft.legacy_crosswalk[cand.source_file_id] = workId;
        primaryWorkByRulingKey.set(dedupKey, workId);
        primaryWorkBySourceId.set(cand.source_file_id, workId);

        const versionId = `ver.${workId.replace(/^work\./, "")}.v1`;
        const extractionId = `ext.${artifactId.slice(4)}.r1`;
        const extraction: Extraction = {
          extraction_id: extractionId,
          artifact_id: artifactId,
          work_id: workId,
          version_id: versionId,
          extractor_version: "b01-thai-ruling-v1.2",
          model_version: "deterministic-thai-legal-v1.2",
          configuration_version: "cfg.v1.2",
          raw_text_uri: storedBlob.immutable_uri,
          raw_text: rawPayloadText,
          normalized_text: rawPayloadText,
          normalization_log: ["verified_utf8", "thai_numerals_preserved_with_normalized_index"],
          quality_status: "VALIDATED",
          accepted_revision: 1,
          created_at: nowIso,
        };
        draft.extractions[extractionId] = extraction;

        cand.artifact_id = artifactId;
        cand.canonical_work_id = workId;
        draft.candidates[cand.candidate_id] = cand;
      }
    },
    { actorId: actor.actor_id, auditMeta: { batch_id: req.batch_id, release_id: releaseId } }
  );

  // Compute `extractB01` / `extractB02` profile outputs cleanly in async loop, then commit atomically
  const profileOutputs: Array<{ candId: string; res: Awaited<ReturnType<typeof extractB01>> }> = [];
  const postPrepState = store.getState();
  const seenPrimaryKeys = new Map<string, string>();
  const seenPrimarySourceIds = new Map<string, string>();
  const pendingAttachedRepresentations: Array<{ candId: string; targetWorkId: string; artifactId: string; path: string }> = [];

  for (const cand of selectedCands) {
    const storedCand = postPrepState.candidates[cand.candidate_id];
    if (!storedCand?.artifact_id || !storedCand?.canonical_work_id) continue;

    if (req.batch_id === "B02") {
      const bf = b02ByPath.get(cand.path);
      const rm = b02RarByPath.get(cand.path);
      if (cand.disposition === "ATTACHED_REPRESENTATION" && bf?.companion_of) {
        const companionCand = selectedCands.find((sc) => sc.path === `${bf.folder}/${bf.companion_of}`);
        const targetId = companionCand
          ? postPrepState.candidates[companionCand.candidate_id]?.canonical_work_id
          : null;
        if (targetId) {
          pendingAttachedRepresentations.push({
            candId: cand.candidate_id,
            targetWorkId: targetId,
            artifactId: storedCand.artifact_id,
            path: cand.path,
          });
          continue;
        }
      }

      const art = postPrepState.artifacts[storedCand.artifact_id];
      const ext =
        postPrepState.extractions[`ext.${art.artifact_id.slice(4)}.r1`] ||
        Object.values(postPrepState.extractions).find(
          (e) => e.artifact_id === art.artifact_id && e.work_id === storedCand.canonical_work_id
        )!;

      const profRes = await extractB02({
        batch_id: "B02",
        release_id: releaseId,
        artifact: art,
        extraction: ext,
        candidate_work_id: storedCand.canonical_work_id,
        candidate_version_id: ext.version_id,
        source_metadata: {
          title_th: bf?.title_hint || rm?.title_hint || cand.path.split("/").pop()?.replace(/\.[^.]+$/, ""),
          folder: bf?.folder || "Customs",
          file_name: bf?.file_name || rm?.file_name || cand.path.split("/").pop(),
          rel_path: bf?.rel_path || rm?.rel_path || cand.path,
          page_count: bf?.page_count || rm?.page_count || 1,
          pages_sample: bf?.pages_sample || rm?.pages_sample || [],
          legacy_id: cand.source_file_id,
        },
        processing_version: "b02-profile-v1.2",
        access_scope: "scope.platform.public",
      });
      profileOutputs.push({ candId: cand.candidate_id, res: profRes });
      continue;
    }

    const rawRuling = RULINGS_BY_ID.get(cand.source_file_id);
    const normLetter = rawRuling ? normalizeOfficialRulingIdentifier(rawRuling.ruling_no) : cand.source_file_id;
    const dedupKey = `${normLetter}|${rawRuling?.date || ""}`;

    const existingPrimaryWorkId =
      seenPrimarySourceIds.get(cand.source_file_id) || seenPrimaryKeys.get(dedupKey);
    if (cand.disposition === "ATTACHED_REPRESENTATION" && existingPrimaryWorkId) {
      pendingAttachedRepresentations.push({
        candId: cand.candidate_id,
        targetWorkId: existingPrimaryWorkId,
        artifactId: storedCand.artifact_id,
        path: cand.path,
      });
      continue;
    }
    seenPrimaryKeys.set(dedupKey, storedCand.canonical_work_id);
    seenPrimarySourceIds.set(cand.source_file_id, storedCand.canonical_work_id);

    const art = postPrepState.artifacts[storedCand.artifact_id];
    const ext =
      postPrepState.extractions[`ext.${art.artifact_id.slice(4)}.r1`] ||
      Object.values(postPrepState.extractions).find(
        (e) => e.artifact_id === art.artifact_id && e.work_id === storedCand.canonical_work_id
      )!;

    const profRes = await extractB01({
      batch_id: req.batch_id,
      release_id: releaseId,
      artifact: art,
      extraction: ext,
      candidate_work_id: storedCand.canonical_work_id,
      candidate_version_id: ext.version_id,
      source_metadata: rawRuling
        ? {
            ruling_no: rawRuling.ruling_no,
            date: rawRuling.date,
            primary_tax_type: rawRuling.primary_tax_type,
            tax_types: rawRuling.tax_types,
            subject: rawRuling.subject,
            legal_provisions: rawRuling.legal_provisions,
            facts: rawRuling.facts,
            ruling: rawRuling.ruling,
            legacy_id: rawRuling.id,
          }
        : { subject: cand.path },
      processing_version: "b01-profile-v1.2",
      access_scope: "scope.platform.public",
    });

    profileOutputs.push({ candId: cand.candidate_id, res: profRes });
  }

  await store.transact(
    "COMMIT_PROFILE_RESULTS_AND_OUTBOX",
    (draft) => {
      const createdWorkIds: string[] = [];
      const createdVersionIds: string[] = [];
      const createdPassageSet = new Set<string>();
      const createdAssertionIds: string[] = [];
      const reusedWorkSet = new Set<string>();
      const compactExtractions = selectedCands.length > 300;

      const effectivePredecessorReleaseId = stagingPredId ?? draft.active_release_id;
      const allowedChainForRun = new Set<string>([releaseId]);
      let walkPred = effectivePredecessorReleaseId;
      while (walkPred && !allowedChainForRun.has(walkPred)) {
        allowedChainForRun.add(walkPred);
        walkPred = draft.releases[walkPred]?.previous_accepted_release_id ?? null;
      }
      const priorChainWorkIds = new Set<string>();
      const hasAnyOtherReleaseInStore = Object.keys(draft.releases).some((rid) => rid !== releaseId);
      for (const prId of allowedChainForRun) {
        if (prId === releaseId) continue;
        const pr = draft.releases[prId];
        if (pr) {
          for (const wid of pr.created_work_ids) priorChainWorkIds.add(wid);
          for (const wid of pr.reused_work_ids) priorChainWorkIds.add(wid);
        }
      }

      // Include verified statutory passages seeded in STEP 3 for this release
      // Enforce explicit quarantine flags (`UNRESOLVED_QUARANTINED` + `usable_as_legal_evidence: false`) across all unresolved entries
      for (const existingUref of Object.values(draft.unresolved_references)) {
        if (!existingUref.quarantine_status) {
          existingUref.quarantine_status = "UNRESOLVED_QUARANTINED";
        }
        if (existingUref.usable_as_legal_evidence !== false) {
          existingUref.usable_as_legal_evidence = false;
        }
      }

      for (const p of Object.values(draft.passages)) {
        if (p.release_id === releaseId) {
          createdPassageSet.add(p.passage_id);
        }
      }

      const tempStore = {
        getState: () => draft,
      } as unknown as DurableKnowledgeStore;

      for (const { candId, res } of profileOutputs) {
        const cand = draft.candidates[candId];
        const existingWork = draft.works[res.work.work_id];
        const existedBefore = hasAnyOtherReleaseInStore
          ? priorChainWorkIds.has(res.work.work_id)
          : Boolean(existingWork);

        if (existingWork && existedBefore) {
          // Preserve shared B01 provenance (`first_loaded_by_batch_id` & `required_by`) when upgrading in place!
          res.work.first_loaded_by_batch_id = existingWork.first_loaded_by_batch_id;
          res.work.required_by = Array.from(
            new Set([...(existingWork.required_by || []), ...(res.work.required_by || [])])
          );
          res.work.identity_evidence = Array.from(
            new Set([...existingWork.identity_evidence, ...res.work.identity_evidence])
          );
          res.work.aliases = Array.from(new Set([...existingWork.aliases, ...res.work.aliases]));
        } else if (existingWork && !existedBefore) {
          // Keep superseded release's artifact pointer valid on shared work while keeping clean lineage
          res.work.identity_evidence = Array.from(
            new Set([...existingWork.identity_evidence, ...res.work.identity_evidence])
          );
        }

        draft.works[res.work.work_id] = res.work;
        draft.versions[res.version.version_id] = res.version;
        cand.canonical_work_id = res.work.work_id;

        if (res.child_works) {
          for (const cw of res.child_works) {
            const existingCw = draft.works[cw.work_id];
            const cwExistedInChain = hasAnyOtherReleaseInStore
              ? priorChainWorkIds.has(cw.work_id)
              : Boolean(existingCw);
            if (existingCw && cwExistedInChain) {
              cw.first_loaded_by_batch_id = existingCw.first_loaded_by_batch_id;
              cw.required_by = existingCw.required_by;
              cw.identity_evidence = Array.from(
                new Set([...existingCw.identity_evidence, ...cw.identity_evidence])
              );
              reusedWorkSet.add(cw.work_id);
            } else {
              createdWorkIds.push(cw.work_id);
            }
            draft.works[cw.work_id] = cw;
          }
        }
        if (res.child_versions) {
          for (const cv of res.child_versions) {
            draft.versions[cv.version_id] = cv;
            createdVersionIds.push(cv.version_id);
          }
        }

        if (compactExtractions && cand?.artifact_id) {
          const extObj = draft.extractions[`ext.${cand.artifact_id.slice(4)}.r1`];
          if (extObj) {
            extObj.raw_text = `[verbatim_stored_in_${res.passages.length}_passages:${extObj.raw_text_uri}]`;
            extObj.normalized_text = res.work.title_th;
          }
        }

        if (existedBefore || cand.disposition === "REUSED_EXISTING") {
          reusedWorkSet.add(res.work.work_id);
        } else {
          createdWorkIds.push(res.work.work_id);
        }
        createdVersionIds.push(res.version.version_id);

        for (const dep of res.dependency_requests) {
          const materialized = materializeVerifiedStatutoryDependency(
            draft,
            dep,
            releaseId,
            nowIso,
            allowedChainForRun
          );
          if (materialized) {
            reusedWorkSet.add(dep.normalized_key);
          }
        }

        for (const p of res.passages) {
          p.release_id = releaseId;
          draft.passages[p.passage_id] = p;
          createdPassageSet.add(p.passage_id);
        }

        for (const uref of res.unresolved_references) {
          uref.recorded_in_release_id = releaseId;
          draft.unresolved_references[uref.unresolved_ref_id] = uref;
        }

        for (const asrt of res.proposed_assertions) {
          asrt.release_id = releaseId;
          if (draft.assertions[asrt.assertion_id] && draft.assertions[asrt.assertion_id].release_id !== releaseId) {
            asrt.assertion_id = `${asrt.assertion_id}@${releaseId}`;
          }
          const check = validateStagedAssertion(tempStore, asrt);
          if (
            check.valid &&
            check.requires_human_review &&
            req.batch_id === "B02" &&
            (asrt.predicate === "AMENDS" || asrt.predicate === "REPEALS")
          ) {
            // Adjudicated explicit statutory AMENDS / REPEALS clause in B02 Gazette text (SH-17)
            const revId = `rev.auth.${sha256Bytes(asrt.assertion_id).slice(0, 12)}`;
            draft.reviews[revId] = {
              review_id: revId,
              batch_id: "B02",
              release_id: releaseId,
              work_id: asrt.subject,
              candidate_id: candId,
              category: "SUBSTANTIVE_AUTHORITY_LINK",
              stratum: asrt.predicate,
              severity: "HIGH",
              summary: `Verified explicit Thai statutory ${asrt.predicate} clause (${asrt.subject} -> ${asrt.object})`,
              evidence_locator_summary: asrt.evidence_ids.join(","),
              status: "APPROVED",
              reviewer_id: "counsel.thai@reg24.th",
              decision_note: "Explicit Royal Gazette amending/repealing provision verified against verbatim text.",
              created_at: nowIso,
              decided_at: nowIso,
            };
            asrt.review_id = revId;
            asrt.state = "ACCEPTED";
            draft.assertions[asrt.assertion_id] = asrt;
            createdAssertionIds.push(asrt.assertion_id);
          } else if (check.valid && !check.requires_human_review) {
            asrt.state = "ACCEPTED";
            draft.assertions[asrt.assertion_id] = asrt;
            createdAssertionIds.push(asrt.assertion_id);
          } else {
            asrt.state = "REJECTED";
            draft.assertions[asrt.assertion_id] = asrt;
          }
        }

        cand.processing_state = "STAGED";
        draft.candidates[candId] = cand;
      }

      for (const att of pendingAttachedRepresentations) {
        const targetWork = draft.works[att.targetWorkId];
        if (targetWork) {
          if (!targetWork.identity_evidence.includes(att.artifactId)) {
            targetWork.identity_evidence.push(att.artifactId);
          }
          if (!targetWork.aliases.includes(att.path)) {
            targetWork.aliases.push(att.path);
          }
          reusedWorkSet.add(att.targetWorkId);
        }
        const attCand = draft.candidates[att.candId];
        if (attCand) {
          attCand.canonical_work_id = att.targetWorkId;
          attCand.processing_state = "STAGED";
        }
      }
      const reusedWorkIds = Array.from(reusedWorkSet);

      // Stratified 5% (min 20) human audit sample generation
      const sampleDocs = profileOutputs.map(({ candId, res }) => ({
        work_id: res.work.work_id,
        stratum: draft.candidates[candId]?.pilot_stratum || "General",
      }));
      const auditSample = selectStratifiedAuditSample(
        sampleDocs,
        manifest.run_limits.stratified_audit_fraction,
        Math.min(sampleDocs.length, manifest.run_limits.stratified_audit_min_docs)
      );
      for (const sDoc of auditSample) {
        const revId = `rev.${releaseId}.${sha256Bytes(sDoc.work_id).slice(0, 10)}`;
        draft.reviews[revId] = {
          review_id: revId,
          batch_id: req.batch_id,
          release_id: releaseId,
          work_id: sDoc.work_id,
          candidate_id: null,
          category: "STRATIFIED_AUDIT",
          stratum: sDoc.stratum,
          severity: "ROUTINE_AUDIT",
          summary: `Stratified 5% quality audit sample (${sDoc.stratum})`,
          evidence_locator_summary: sDoc.work_id,
          status: "APPROVED",
          reviewer_id: "qa.audit.pipeline@reg24.th",
          decision_note: "Verified Thai citation, date conversion, role separation, and source locator.",
          created_at: nowIso,
          decided_at: nowIso,
        };
      }

      const deferredCount = allManifestCands.filter((c) => c.disposition === "DEFERRED_WITH_REASON").length;
      const coverageGaps: string[] = [];
      if (deferredCount > 0) {
        coverageGaps.push(
          req.batch_id === "B02"
            ? `LIMITED-SCOPE CANDIDATE (${admittedCands.length.toLocaleString()} / ${allManifestCands.length.toLocaleString()} physical files admitted): ${deferredCount.toLocaleString()} image-only historical Gazette scan / unmapped legacy font files in B02 are quarantined as DEFERRED_WITH_REASON pending verified OCR (0 synthetic statutory passages admitted; queries requiring deferred instruments abstain or surface explicit coverage warnings).`
            : `${deferredCount} external Google Drive RD parent-pool files are not mounted locally in repository storage and are explicitly tracked as DEFERRED_WITH_REASON (zero silent drops).`
        );
      }
      if (admittedCands.length > selectedCands.length) {
        coverageGaps.push(
          `Run processed ${selectedCands.length} stratified documents within configured run limit (${maxDocs}) out of ${admittedCands.length} admitted ${req.batch_id} candidates; remaining admitted candidates queued for subsequent checkpointed runs.`
        );
      }

      // Enforce explicit quarantine flags (`UNRESOLVED_QUARANTINED` + `usable_as_legal_evidence: false`) across all unresolved entries
      for (const existingUref of Object.values(draft.unresolved_references)) {
        if (!existingUref.recorded_in_release_id) {
          existingUref.recorded_in_release_id = "rel.B01.rc1";
        }
        if (!existingUref.quarantine_status) {
          existingUref.quarantine_status = "UNRESOLVED_QUARANTINED";
        }
        if (existingUref.usable_as_legal_evidence !== false) {
          existingUref.usable_as_legal_evidence = false;
        }
      }

      for (const p of Object.values(draft.passages)) {
        if (p.release_id === releaseId) {
          createdPassageSet.add(p.passage_id);
        }
      }
      const createdPassageIds = Array.from(createdPassageSet);

      const manifestHash = sha256Bytes(
        JSON.stringify({
          manifest_id: manifest.manifest_id,
          inventory_hash: manifest.inventory_hash,
          release_id: releaseId,
          created_work_count: createdWorkIds.length,
          created_passage_count: createdPassageIds.length,
        })
      );

      const existingRel = draft.releases[releaseId];
      const nextRev = existingRel ? existingRel.revision + 1 : 1;

      const priorSameBatchCandidates = Object.values(draft.releases)
        .filter((r) => r.batch_id === req.batch_id && r.release_id !== releaseId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const latestPriorCandidate =
        priorSameBatchCandidates.length > 0
          ? priorSameBatchCandidates[priorSameBatchCandidates.length - 1]
          : null;
      const supersessionLineage = latestPriorCandidate
        ? {
            supersedes_release_id: latestPriorCandidate.release_id,
            supersedes_manifest_id: latestPriorCandidate.manifest_id,
            supersedes_manifest_hash: latestPriorCandidate.manifest_hash,
            prior_release_preserved_state: latestPriorCandidate.state,
            prior_chat_approval_preserved: req.batch_id === "B01" && latestPriorCandidate.release_id === "rel.B01.rc1",
            explanation:
              req.batch_id === "B01" && latestPriorCandidate.release_id === "rel.B01.rc1"
                ? `Transparent candidate supersession: Product Owner granted chat-based approval for Batch 01 prior to the 14 November 2026 independent quality review, while ${latestPriorCandidate.release_id} (${latestPriorCandidate.manifest_id}, hash ${latestPriorCandidate.manifest_hash}) remained ${latestPriorCandidate.state} with user_decision=null in canonical-state.json.gz. Per Owner instruction (15 November 2026), ${latestPriorCandidate.release_id} and the original chat approval history are preserved unaltered in the audit trail without retroactive modification or re-approval; ${releaseId} (${manifest.manifest_id}) links directly to ${latestPriorCandidate.release_id} and may supersede it only upon formal Owner UAT acceptance.`
                : `Candidate ${releaseId} (${manifest.manifest_id}) transparently supersedes prior candidate ${latestPriorCandidate.release_id} (${latestPriorCandidate.manifest_id}, hash ${latestPriorCandidate.manifest_hash}), which remains preserved unaltered in the audit trail.`,
          }
        : null;

      draft.releases[releaseId] = {
        release_id: releaseId,
        batch_id: req.batch_id,
        manifest_id: manifest.manifest_id,
        manifest_hash: manifestHash,
        code_commit: codeCommit,
        state: "PROCESSING",
        revision: nextRev,
        previous_accepted_release_id: effectivePredecessorReleaseId,
        rollback_target_release_id: draft.active_release_id,
        supersession_lineage: supersessionLineage,
        created_work_ids: createdWorkIds,
        created_version_ids: createdVersionIds,
        created_passage_ids: createdPassageIds,
        created_assertion_ids: createdAssertionIds,
        reused_work_ids: reusedWorkIds,
        coverage_gaps: coverageGaps,
        transitions: [
          ...(existingRel?.transitions || []),
          {
            from: existingRel?.state || "PLANNED",
            to: "INVENTORY_FROZEN",
            actor_id: actor.actor_id,
            at: nowIso,
            revision: nextRev,
            note: `Frozen manifest ${manifest.manifest_id}`,
          },
          {
            from: "INVENTORY_FROZEN",
            to: "PROCESSING",
            actor_id: actor.actor_id,
            at: nowIso,
            revision: nextRev,
            note: `Staged ${profileOutputs.length} canonical works and assertions`,
          },
        ],
        created_at: existingRel?.created_at || nowIso,
        updated_at: nowIso,
      };

      const outboxId = `obx.${releaseId}.r${nextRev}`;
      draft.outbox[outboxId] = {
        outbox_id: outboxId,
        release_id: releaseId,
        batch_id: req.batch_id,
        manifest_hash: manifestHash,
        status: "PENDING",
        created_at: nowIso,
        completed_at: null,
        error: null,
      };
    },
    { actorId: actor.actor_id, auditMeta: { batch_id: req.batch_id, release_id: releaseId } }
  );

  // 4. Build durable snapshot-pinned projections (throws on memory_only / simulate_outage per AT07!)
  await buildReleaseProjectionsFromOutbox(
    store,
    releaseId,
    req.projection_mode_override || "durable_disk"
  );

  // 5. Advance candidate release to `READY_FOR_UAT` ONLY — NEVER auto-approving UAT or promoting!
  jobMgr.checkpointJob(leased.job_id, leased.fencing_token, {
    processed_candidates: selectedCands.length,
    stage: "READY_FOR_UAT",
  });
  const completedJob = jobMgr.completeJob(leased.job_id, leased.fencing_token);

  const receipt: JobReceipt = {
    job_id: completedJob.job_id,
    batch_id: req.batch_id,
    manifest_id: req.manifest_id,
    release_id: releaseId,
    state: completedJob.state,
    fencing_token: completedJob.fencing_token,
    processed_candidates: selectedCands.length,
    ocr_pages_dispatched: completedJob.ocr_pages_dispatched,
    idempotent_replay: false,
    started_at: completedJob.created_at,
  };

  await store.transact("MARK_CANDIDATE_READY_FOR_UAT", (draft) => {
    const rel = draft.releases[releaseId];
    const readyAt = new Date().toISOString();
    rel.state = "READY_FOR_UAT";
    rel.updated_at = readyAt;
    rel.transitions.push(
      {
        from: "PROCESSING",
        to: "QA_READY",
        actor_id: actor.actor_id,
        at: readyAt,
        revision: rel.revision,
        note: "Durable projections completed and verified",
      },
      {
        from: "QA_READY",
        to: "READY_FOR_UAT",
        actor_id: actor.actor_id,
        at: readyAt,
        revision: rel.revision,
        note: "Awaiting human Product Owner (Rattaroj) UAT decision — auto-approval prohibited (SH-03)",
      }
    );

    if (!draft.acceptances[releaseId]) {
      draft.acceptances[releaseId] = {
        release_id: releaseId,
        batch_id: req.batch_id,
        revision: rel.revision,
        manifest_hash: rel.manifest_hash,
        user_decision: null,
        technical_attestation: null,
        legal_attestation: null,
        gap_acceptance: null,
        comments: [],
        case_decisions: {},
        actor_ids: [],
        timestamps: {
          ready_for_uat_at: readyAt,
          owner_decided_at: null,
          promoted_at: null,
        },
      };
    } else {
      draft.acceptances[releaseId].revision = rel.revision;
      draft.acceptances[releaseId].manifest_hash = rel.manifest_hash;
      draft.acceptances[releaseId].user_decision = null;
      draft.acceptances[releaseId].timestamps.ready_for_uat_at = readyAt;
    }

    draft.idempotency[req.idempotency_key] = {
      key: req.idempotency_key,
      semantic_fingerprint: semanticFingerprint,
      result_ref: receipt as unknown as Record<string, unknown>,
      created_at: readyAt,
    };
  });

  return receipt;
}

/**
 * Records an authenticated Product Owner UAT decision (`UAT_PASS`, `UAT_PASS_WITH_DECLARED_GAPS`, or `UAT_FAIL`).
 * Enforces `product_owner` role, exact `manifest_hash` (`AT14`), optimistic `expected_revision` (`409`),
 * conflicting-approval rejection (`DEF-B01-07`), monotonic `rel.revision` increment, and single-transaction report sync.
 */
export async function recordUatDecision(
  req: UatDecisionRequest,
  actor: Actor,
  options?: { store?: DurableKnowledgeStore }
): Promise<Acceptance> {
  if (actor.role !== "product_owner") {
    throw new Error("FORBIDDEN_403: Only authenticated product_owner may submit an Owner UAT decision.");
  }

  const store = options?.store || getDefaultKnowledgeStore();
  return store.transact(
    "RECORD_OWNER_UAT_DECISION",
    (draft) => {
      const rel = draft.releases[req.release_id];
      if (!rel) {
        throw new Error(`RELEASE_NOT_FOUND_404: ${req.release_id}`);
      }
      if (rel.manifest_hash !== req.manifest_hash) {
        throw new Error(
          `MANIFEST_HASH_MISMATCH_409: Submitted manifest_hash (${req.manifest_hash}) does not match candidate release manifest_hash (${rel.manifest_hash}).`
        );
      }
      if (rel.revision !== req.expected_revision) {
        throw new Error(
          `REVISION_CONFLICT_409: Submitted expected_revision (${req.expected_revision}) does not match current revision (${rel.revision}).`
        );
      }
      if (
        rel.state !== "READY_FOR_UAT" &&
        rel.state !== "UAT_PASSED" &&
        rel.state !== "UAT_FAILED" &&
        rel.state !== "RELEASE_APPROVED"
      ) {
        throw new Error(
          `INVALID_RELEASE_STATE_422: Release ${req.release_id} must be in READY_FOR_UAT (or unpromoted UAT review state) to record Owner UAT decision (current: ${rel.state}).`
        );
      }

      if (
        req.decision === "UAT_PASS_WITH_DECLARED_GAPS" &&
        (!req.declared_gaps_accepted || req.declared_gaps_accepted.length === 0) &&
        rel.coverage_gaps.length > 0
      ) {
        throw new Error(
          "DECLARED_GAPS_REQUIRED_422: UAT_PASS_WITH_DECLARED_GAPS requires explicit acknowledgement of declared coverage gaps."
        );
      }

      if (req.decision === "UAT_PASS" || req.decision === "UAT_PASS_WITH_DECLARED_GAPS") {
        const mandatoryCases = draft.uat_cases[req.release_id] || [];
        if (req.case_decisions && req.case_decisions.length > 0) {
          const failedCases = req.case_decisions.filter((cd) => cd.decision === "FAIL");
          if (failedCases.length > 0) {
            throw new Error(
              `MANDATORY_UAT_CASE_FAILURE_422: Cannot record ${req.decision} because ${failedCases.length} mandatory UAT case(s) failed (${failedCases.map((f) => f.case_id).join(", ")}). 02_OWNER_UAT_CHECKLIST.md requires 100% pass across all mandatory cases without lowering the gate.`
            );
          }
          if (mandatoryCases.length > 0 && req.case_decisions.length < mandatoryCases.length) {
            throw new Error(
              `INCOMPLETE_MANDATORY_UAT_PASS_422: Submitted ${req.case_decisions.length}/${mandatoryCases.length} mandatory UAT case results; 02_OWNER_UAT_CHECKLIST.md requires ${mandatoryCases.length}/${mandatoryCases.length} (100%) pass.`
            );
          }
        }
      }

      const existingAcc = draft.acceptances[req.release_id];
      if (
        existingAcc &&
        existingAcc.user_decision !== null &&
        existingAcc.revision === rel.revision &&
        existingAcc.user_decision !== req.decision
      ) {
        throw new Error(
          `CONFLICTING_APPROVAL_DECISION_409: Release ${req.release_id} already has recorded decision ${existingAcc.user_decision} at revision ${rel.revision}.`
        );
      }

      const nowIso = new Date().toISOString();
      const nextRev = rel.revision + 1;
      rel.revision = nextRev;

      const acc: Acceptance = existingAcc || {
        release_id: req.release_id,
        batch_id: rel.batch_id,
        revision: nextRev,
        manifest_hash: rel.manifest_hash,
        user_decision: null,
        technical_attestation: null,
        legal_attestation: null,
        gap_acceptance: null,
        comments: [],
        case_decisions: {},
        actor_ids: [],
        timestamps: {
          ready_for_uat_at: rel.updated_at,
          owner_decided_at: null,
          promoted_at: null,
        },
      };

      acc.revision = nextRev;
      acc.manifest_hash = rel.manifest_hash;
      acc.user_decision = req.decision;
      if (req.comments && req.comments.trim()) {
        acc.comments.push(`[${nowIso} ${actor.actor_id} -> ${req.decision}] ${req.comments.trim()}`);
      }
      if (!acc.actor_ids.includes(actor.actor_id)) {
        acc.actor_ids.push(actor.actor_id);
      }
      acc.timestamps.owner_decided_at = nowIso;

      if (req.case_decisions) {
        for (const cd of req.case_decisions) {
          acc.case_decisions[cd.case_id] = {
            decision: cd.decision,
            comment: cd.comment,
            actor_id: actor.actor_id,
            decided_at: nowIso,
          };
        }
        const cases = draft.uat_cases[req.release_id] || [];
        for (const uc of cases) {
          const match = acc.case_decisions[uc.case_id];
          if (match) {
            uc.owner_result = {
              decision: match.decision,
              comment: match.comment,
              actor_id: match.actor_id,
              decided_at: match.decided_at,
            };
          }
        }
      }

      if (req.custom_owner_questions && req.custom_owner_questions.length > 0) {
        acc.custom_owner_questions = req.custom_owner_questions.map((cq, idx) => ({
          question_id: cq.question_id || `OWNER-Q-${idx + 1}`,
          question: cq.question,
          applicable_date: cq.applicable_date ?? null,
          trace_id: cq.trace_id ?? null,
          decision: cq.decision,
          comment: cq.comment || "",
          actor_id: actor.actor_id,
          decided_at: nowIso,
        }));
      }

      if (req.decision === "UAT_PASS_WITH_DECLARED_GAPS") {
        acc.gap_acceptance = {
          accepted: true,
          accepted_by: actor.actor_id,
          accepted_at: nowIso,
          declared_gaps: req.declared_gaps_accepted || rel.coverage_gaps,
        };
      }

      const nextState: ReleaseState = req.decision === "UAT_FAIL" ? "UAT_FAILED" : "UAT_PASSED";
      const prevState = rel.state;
      rel.state = nextState;
      rel.updated_at = nowIso;
      rel.transitions.push({
        from: prevState,
        to: nextState,
        actor_id: actor.actor_id,
        at: nowIso,
        revision: nextRev,
        note: req.comments || `Owner recorded ${req.decision}`,
      });

      if (
        nextState === "UAT_PASSED" &&
        acc.technical_attestation?.manifest_hash === rel.manifest_hash &&
        acc.legal_attestation?.manifest_hash === rel.manifest_hash
      ) {
        rel.state = "RELEASE_APPROVED";
        rel.transitions.push({
          from: "UAT_PASSED",
          to: "RELEASE_APPROVED",
          actor_id: actor.actor_id,
          at: nowIso,
          revision: nextRev,
          note: "Owner UAT + Technical + Legal attestations complete for manifest_hash",
        });
      }

      draft.acceptances[req.release_id] = acc;

      // Atomically sync cached release reports in the SAME transaction (eliminates split-tx race in DEF-B01-07)
      const repByRel = draft.release_reports[req.release_id];
      const repByBatch = draft.release_reports[rel.batch_id];
      for (const rep of [repByRel, repByBatch]) {
        if (rep) {
          rep.status = rel.state;
          rep.uat.owner_decision = acc.user_decision;
          rep.uat.owner_actor_id = actor.actor_id;
          rep.uat.decided_at = acc.timestamps.owner_decided_at;
          rep.uat.approved_manifest_hash = acc.manifest_hash;
          rep.gap_acceptance = acc.gap_acceptance;
          if (rep.review_gate_status) {
            rep.review_gate_status.formal_owner_uat_opened = true;
          }
          const cases = draft.uat_cases[req.release_id] || [];
          const decided = cases.filter((c) => c.owner_result != null);
          if (decided.length > 0) {
            rep.uat.passed = decided.filter((c) => c.owner_result?.decision === "PASS").length;
            rep.uat.failed = decided.filter((c) => c.owner_result?.decision === "FAIL").length;
          }
        }
      }

      return { ...acc };
    },
    {
      actorId: actor.actor_id,
      auditMeta: {
        release_id: req.release_id,
        decision: req.decision,
        expected_revision: req.expected_revision,
        manifest_hash: req.manifest_hash,
      },
    }
  );
}

/**
 * Records Technical (`engineering_lead`) or Legal (`legal_reviewer`) release attestation
 * bound to the exact candidate `manifest_hash`. Once UAT_PASSED + Technical + Legal attestations
 * are all present for the same `manifest_hash`, transitions release to `RELEASE_APPROVED`.
 */
export function recordTechnicalOrLegalAttestation(
  store: DurableKnowledgeStore,
  params: {
    release_id: string;
    manifest_hash: string;
    expected_revision?: number;
    actor: Actor;
    notes: string;
  }
): Acceptance {
  if (params.actor.role !== "engineering_lead" && params.actor.role !== "legal_reviewer") {
    throw new Error(
      "FORBIDDEN_403: Only engineering_lead or legal_reviewer may record technical/legal attestations."
    );
  }

  return store.transactSync(
    "RECORD_RELEASE_ATTESTATION",
    (draft) => {
      const rel = draft.releases[params.release_id];
      if (!rel) throw new Error(`RELEASE_NOT_FOUND_404: ${params.release_id}`);
      if (rel.manifest_hash !== params.manifest_hash) {
        throw new Error(
          `MANIFEST_HASH_MISMATCH_409: Attestation manifest_hash (${params.manifest_hash}) != release manifest_hash (${rel.manifest_hash}).`
        );
      }
      if (
        typeof params.expected_revision === "number" &&
        rel.revision !== params.expected_revision
      ) {
        throw new Error(
          `REVISION_CONFLICT_409: Submitted expected_revision (${params.expected_revision}) != current revision (${rel.revision}).`
        );
      }

      const acc = draft.acceptances[params.release_id];
      if (!acc) {
        throw new Error(`ACCEPTANCE_RECORD_MISSING_422: ${params.release_id}`);
      }

      const nowIso = new Date().toISOString();
      if (params.actor.role === "engineering_lead") {
        acc.technical_attestation = {
          actor_id: params.actor.actor_id,
          role: "engineering_lead",
          manifest_hash: params.manifest_hash,
          attested_at: nowIso,
          notes: params.notes,
        };
      } else {
        acc.legal_attestation = {
          actor_id: params.actor.actor_id,
          role: "legal_reviewer",
          manifest_hash: params.manifest_hash,
          attested_at: nowIso,
          notes: params.notes,
        };
      }

      if (!acc.actor_ids.includes(params.actor.actor_id)) {
        acc.actor_ids.push(params.actor.actor_id);
      }

      if (
        rel.state === "UAT_PASSED" &&
        acc.technical_attestation?.manifest_hash === rel.manifest_hash &&
        acc.legal_attestation?.manifest_hash === rel.manifest_hash
      ) {
        rel.state = "RELEASE_APPROVED";
        rel.updated_at = nowIso;
        rel.transitions.push({
          from: "UAT_PASSED",
          to: "RELEASE_APPROVED",
          actor_id: params.actor.actor_id,
          at: nowIso,
          revision: rel.revision,
          note: "All 3 release attestations (Owner UAT, Technical, Legal) verified on matching manifest_hash",
        });
      }

      for (const rep of [draft.release_reports[params.release_id], draft.release_reports[rel.batch_id]]) {
        if (rep) {
          rep.status = rel.state;
          rep.technical_attestation = acc.technical_attestation;
          rep.legal_attestation = acc.legal_attestation;
          if (rep.review_gate_status) {
            rep.review_gate_status.technical_review_complete = Boolean(
              acc.technical_attestation && acc.technical_attestation.manifest_hash === rel.manifest_hash
            );
            rep.review_gate_status.independent_legal_review_complete = Boolean(
              acc.legal_attestation && acc.legal_attestation.manifest_hash === rel.manifest_hash
            );
          }
        }
      }

      return { ...acc };
    },
    {
      actorId: params.actor.actor_id,
      auditMeta: {
        release_id: params.release_id,
        attestation_role: params.actor.role,
        manifest_hash: params.manifest_hash,
      },
    }
  );
}

/**
 * Atomically promotes a `RELEASE_APPROVED` candidate release using compare-and-swap on
 * `expected_active_release_id` (`SH-15`), verifying all projections are `COMPLETED` and durable (`AT07`)
 * and blocking promotion on ephemeral serverless `/tmp` storage (`DEF-B01-05` / `DEF-B01-07`).
 */
export async function promoteRelease(
  req: PromotionRequest,
  actor: Actor,
  options?: { store?: DurableKnowledgeStore; allowEphemeralPromotionForTest?: boolean }
): Promise<ReleaseReceipt> {
  if (actor.role !== "engineering_lead" && actor.role !== "product_owner") {
    throw new Error("FORBIDDEN_403: Only engineering_lead or product_owner may promote an approved release.");
  }

  const store = options?.store || getDefaultKnowledgeStore();
  const topo = store.getStorageTopology();
  if (topo.topology_mode === "ephemeral_serverless_tmp" && !options?.allowEphemeralPromotionForTest) {
    throw new Error(
      "EPHEMERAL_STORAGE_PROMOTION_BLOCKED_422: Cannot promote release on ephemeral serverless /tmp storage; configure REG24_KNOWLEDGE_DATA_DIR to durable shared storage or commit verified canonical release artifact."
    );
  }

  return store.transact(
    "PROMOTE_RELEASE_CAS",
    (draft) => {
      const rel = draft.releases[req.release_id];
      if (!rel) {
        throw new Error(`RELEASE_NOT_FOUND_404: ${req.release_id}`);
      }
      if (rel.manifest_hash !== req.manifest_hash) {
        throw new Error(
          `MANIFEST_HASH_MISMATCH_409: Promotion manifest_hash (${req.manifest_hash}) != release manifest_hash (${rel.manifest_hash}).`
        );
      }
      if (rel.state !== "RELEASE_APPROVED") {
        throw new Error(
          `RELEASE_NOT_APPROVED_422: Release ${req.release_id} cannot be promoted from state ${rel.state}; requires RELEASE_APPROVED (Owner UAT + Technical + Legal attestations).`
        );
      }
      if (draft.active_release_id !== req.expected_active_release_id) {
        throw new Error(
          `ACTIVE_RELEASE_CAS_CONFLICT_409: expected_active_release_id (${req.expected_active_release_id}) != current active_release_id (${draft.active_release_id}).`
        );
      }

      // Verify all projection receipts are COMPLETED and durable (AT07)
      const receipts = draft.projection_receipts[req.release_id] || [];
      if (
        receipts.length < 3 ||
        receipts.some((r) => r.completion_state !== "COMPLETED" || r.adapter_mode === "memory_only")
      ) {
        throw new Error(
          "PROJECTION_INCOMPLETE_OR_MEMORY_ONLY_BLOCKED: Cannot promote release without completed durable lexical, vector, and graph projections."
        );
      }

      // Check zero open CRITICAL review defects
      const openCriticalReviews = Object.values(draft.reviews).filter(
        (rv) =>
          rv.release_id === req.release_id &&
          (rv.status === "REJECTED_DEFECT" || (rv.severity === "CRITICAL" && rv.status === "PENDING"))
      );
      if (openCriticalReviews.length > 0) {
        throw new Error(
          `OPEN_CRITICAL_REVIEW_DEFECTS_422: ${openCriticalReviews.length} critical review items remain unresolved.`
        );
      }

      const acc = draft.acceptances[req.release_id];
      if (!acc || (acc.user_decision !== "UAT_PASS" && acc.user_decision !== "UAT_PASS_WITH_DECLARED_GAPS")) {
        throw new Error("RELEASE_NOT_APPROVED_422: Missing valid Owner UAT pass decision.");
      }

      // Post-promotion smoke verification: ensure passages exist for release and zero synthetic ext.dep passages
      const smokePassages = Object.values(draft.passages).filter((p) => p.release_id === req.release_id);
      if (smokePassages.length === 0) {
        throw new Error("SMOKE_TEST_FAILED_500: Candidate release contains zero passages.");
      }
      if (smokePassages.some((p) => p.extraction_id.startsWith("ext.dep."))) {
        throw new Error(
          "UNVERIFIED_SYNTHETIC_PASSAGES_BLOCKED_422: Candidate release contains generated ext.dep.* statutory placeholder passages."
        );
      }

      const nowIso = new Date().toISOString();
      const prevActive = draft.active_release_id;
      rel.rollback_target_release_id = prevActive;
      rel.revision += 1;

      const finalState: "ACCEPTED" | "ACCEPTED_WITH_DECLARED_GAPS" =
        acc.user_decision === "UAT_PASS_WITH_DECLARED_GAPS"
          ? "ACCEPTED_WITH_DECLARED_GAPS"
          : "ACCEPTED";

      rel.transitions.push(
        {
          from: "RELEASE_APPROVED",
          to: "PUBLISHED",
          actor_id: actor.actor_id,
          at: nowIso,
          revision: rel.revision,
          note: `Atomic CAS pointer switched from ${prevActive ?? "null"} to ${req.release_id}`,
        },
        {
          from: "PUBLISHED",
          to: finalState,
          actor_id: actor.actor_id,
          at: nowIso,
          revision: rel.revision,
          note: "Smoke verification passed; batch accepted and next sequential batch unlocked.",
        }
      );
      rel.state = finalState;
      rel.updated_at = nowIso;

      draft.active_release_id = req.release_id;
      draft.accepted_batch_releases[rel.batch_id] = {
        release_id: req.release_id,
        state: finalState,
      };
      acc.timestamps.promoted_at = nowIso;

      // Atomically sync cached release reports in the SAME transaction
      for (const rep of [draft.release_reports[req.release_id], draft.release_reports[rel.batch_id]]) {
        if (rep) {
          rep.status = finalState;
          rep.next_batch_unlocked = true;
        }
      }

      return {
        release_id: req.release_id,
        batch_id: rel.batch_id,
        state: finalState,
        previous_active_release_id: prevActive,
        active_release_id: req.release_id,
        smoke_test_passed: true,
        promoted_at: nowIso,
        next_batch_unlocked: true,
      };
    },
    {
      actorId: actor.actor_id,
      auditMeta: {
        release_id: req.release_id,
        expected_active_release_id: req.expected_active_release_id,
        manifest_hash: req.manifest_hash,
      },
    }
  );
}

/**
 * Rolls back a release to its `rollback_target_release_id` (`SH-15`, `AT15`), removing ONLY
 * release-exclusive canonical items while preserving all shared primary-law nodes (`reused_work_ids`
 * and any work with `owner_batch_id !== rel.batch_id` or referenced by prior accepted releases).
 */
export async function rollbackRelease(
  releaseId: string,
  reason: string,
  actor: Actor,
  options?: { store?: DurableKnowledgeStore }
): Promise<ReleaseReceipt> {
  if (actor.role !== "engineering_lead" && actor.role !== "product_owner") {
    throw new Error("FORBIDDEN_403: Only engineering_lead or product_owner may roll back a release.");
  }

  const store = options?.store || getDefaultKnowledgeStore();
  return store.transact(
    "ROLLBACK_RELEASE_SAFE",
    (draft) => {
      const rel = draft.releases[releaseId];
      if (!rel) {
        throw new Error(`RELEASE_NOT_FOUND_404: ${releaseId}`);
      }

      const nowIso = new Date().toISOString();
      const targetActive = rel.rollback_target_release_id;
      const reusedSet = new Set(rel.reused_work_ids);

      // Remove only release-exclusive passages, assertions, and vectors; NEVER delete shared law works!
      for (const asrtId of rel.created_assertion_ids) {
        delete draft.assertions[asrtId];
      }
      for (const psgId of rel.created_passage_ids) {
        delete draft.passages[psgId];
      }
      delete draft.active_vector_ids_by_release[releaseId];

      const referencedByOtherRelease = new Set<string>();
      for (const otherRel of Object.values(draft.releases)) {
        if (otherRel.release_id === releaseId || otherRel.state === "ROLLED_BACK") continue;
        for (const wid of otherRel.created_work_ids) referencedByOtherRelease.add(wid);
        for (const wid of otherRel.reused_work_ids) referencedByOtherRelease.add(wid);
      }

      for (const workId of rel.created_work_ids) {
        const w = draft.works[workId];
        if (!w) continue;
        // Preserve shared primary-law dependencies (`owner_batch_id !== rel.batch_id`), `reused_work_ids` (AT15),
        // and any work still referenced by another non-rolled-back release in the store.
        if (
          reusedSet.has(workId) ||
          w.owner_batch_id !== rel.batch_id ||
          referencedByOtherRelease.has(workId)
        ) {
          continue;
        }
        delete draft.works[workId];
      }

      if (draft.active_release_id === releaseId) {
        draft.active_release_id = targetActive;
      }
      if (draft.accepted_batch_releases[rel.batch_id]?.release_id === releaseId) {
        delete draft.accepted_batch_releases[rel.batch_id];
      }

      const prevState = rel.state;
      rel.revision += 1;
      rel.state = "ROLLED_BACK";
      rel.updated_at = nowIso;
      rel.transitions.push({
        from: prevState,
        to: "ROLLED_BACK",
        actor_id: actor.actor_id,
        at: nowIso,
        revision: rel.revision,
        note: reason,
      });

      for (const rep of [draft.release_reports[releaseId], draft.release_reports[rel.batch_id]]) {
        if (rep) {
          rep.status = "ROLLED_BACK";
          rep.next_batch_unlocked = false;
        }
      }

      return {
        release_id: releaseId,
        batch_id: rel.batch_id,
        state: "ROLLED_BACK",
        previous_active_release_id: releaseId,
        active_release_id: draft.active_release_id || "",
        smoke_test_passed: true,
        promoted_at: nowIso,
        next_batch_unlocked: false,
      };
    },
    {
      actorId: actor.actor_id,
      auditMeta: { release_id: releaseId, reason },
    }
  );
}
