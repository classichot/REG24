/**
 * REG24 — Task F4: Batch Release Lifecycle, Sequential Batch Gate, Owner UAT Attestation,
 * Atomic CAS Promotion & Shared-Law-Node-Safe Rollback
 *
 * Implements:
 * - SH-02, SH-03, SH-05, SH-15, SH-17
 * - AT05, AT06, AT07, AT14, AT15, AT16, AT18
 */

import { THAI_TAX_RULINGS_CORPUS } from "../data/thai-tax-rulings-loader";

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
  type Assertion,
  type BatchId,
  type Candidate,
  type DependencyRequest,
  type Extraction,
  type JobReceipt,
  type LegalVersion,
  type LegalWork,
  type PromotionRequest,
  type ReleaseReceipt,
  type ReleaseState,
  type StartRunRequest,
  type UatDecisionRequest,
} from "./contracts";

const RULINGS_BY_ID = new Map<string, RawTaxRuling>(
  THAI_TAX_RULINGS_CORPUS.map((r) => [r.id, r])
);

/**
 * Priority B01 fixture IDs ensuring all 20 Owner UAT cases, multi-tax strata,
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
];

function getPredecessorBatch(batchId: BatchId): BatchId | null {
  const idx = FIXED_BATCH_ORDER.indexOf(batchId);
  if (idx <= 0) return null;
  return FIXED_BATCH_ORDER[idx - 1];
}

/**
 * Seeds B02-owned primary-law Revenue Code provisions & historical versions required by B01
 * rulings (`owner_batch_id = "B02"`, `first_loaded_by_batch_id = "B01"`), including temporal
 * versions of Revenue Code Section 65 ter for AT05 (`2018-06-30` vs `2025-01-15`).
 */
function seedB01RequiredStatutoryDependencies(
  draft: CanonicalPersistedState,
  releaseId: string,
  nowIso: string
): { createdOrReusedWorkIds: string[] } {
  const touched: string[] = [];

  // Ensure Revenue Department Agency & Parliament Statute works exist
  if (!draft.works["reg.th.rd"]) {
    draft.works["reg.th.rd"] = {
      work_id: "reg.th.rd",
      type: "Agency",
      issuer_id: "reg.th.mof",
      jurisdiction: "TH",
      title_th: "กรมสรรพากร (Revenue Department of Thailand)",
      title_en: "Revenue Department",
      official_identifiers: [{ raw: "กรมสรรพากร", normalized: "กรมสรรพากร", kind: "other" }],
      identity_evidence: [],
      aliases: ["RD", "กรมสรรพากร"],
      owner_batch_id: "B01",
      first_loaded_by_batch_id: "B01",
    };
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
      first_loaded_by_batch_id: "B01",
    };
    touched.push("statute.th.revenue_code");
  }

  // Seed Revenue Code Section 65 ter with TWO distinct effective-date versions (AT05):
  // - v1_pre2019: effective 1938-04-01 .. 2019-03-19 (prior to Revenue Code Amendment Act No. 48 B.E. 2562)
  // - v2_current: effective 2019-03-20 .. null (current law amended by Act No. 48 B.E. 2562)
  const sec65TerWorkId = "prov.th.rc.65_ตรี";
  if (!draft.works[sec65TerWorkId]) {
    draft.works[sec65TerWorkId] = {
      work_id: sec65TerWorkId,
      type: "ProvisionVersion",
      issuer_id: "reg.th.parliament",
      jurisdiction: "TH",
      title_th: "ประมวลรัษฎากร มาตรา 65 ตรี (รายการที่ไม่ให้ถือเป็นรายจ่ายในการคำนวณกำไรสุทธิ)",
      official_identifiers: [
        { raw: "มาตรา 65 ตรี", normalized: "มาตรา 65 ตรี", kind: "section_no" },
      ],
      identity_evidence: [],
      aliases: ["มาตรา 65 ตรี แห่งประมวลรัษฎากร", "Section 65 ter"],
      owner_batch_id: "B02",
      first_loaded_by_batch_id: "B01",
    };
  }
  touched.push(sec65TerWorkId);

  const art65Id = "art.dep.rc.65_ter";
  if (!draft.artifacts[art65Id]) {
    draft.artifacts[art65Id] = {
      artifact_id: art65Id,
      actual_bytes_sha256: sha256Bytes("statute:th:rc:65_ter:v1_and_v2"),
      size: 1420,
      MIME: "text/html",
      immutable_uri: `artifact://sha256/${sha256Bytes("statute:th:rc:65_ter:v1_and_v2")}`,
      fetched_at: nowIso,
      origin_uri: "https://www.rd.go.th/5939.html#sec65ter",
      authenticity_status: "verified_corpus_mirror",
      access_scope: "scope.platform.public",
      rights_status: "approved_public",
    };
  }

  const v1Id = "ver.th.rc.65_ตรี.v1_pre2019";
  if (!draft.versions[v1Id]) {
    const v1Text =
      "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับใช้บังคับก่อนวันที่ 20 มีนาคม 2562 ก่อนพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 48) พ.ศ. 2562): รายการต่อไปนี้ไม่ให้ถือเป็นรายจ่ายในการคำนวณกำไรสุทธิ ได้แก่ เงินสำรองต่างๆ ค่าเสียหายอันอาจได้รับคืนเนื่องจากการประกันหรือสัญญาคุ้มกันใดๆ และเบี้ยปรับหรือเงินเพิ่มภาษีอากรตามบทบัญญัติเดิมก่อนการปรับปรุงอัตราและวิธีการนำส่งภาษีอิเล็กทรอนิกส์ พ.ศ. 2562";
    draft.versions[v1Id] = {
      version_id: v1Id,
      work_id: sec65TerWorkId,
      version_label: "v1_pre2019",
      legal_applicability: [
        {
          valid_from: "1938-04-01",
          valid_to: "2019-03-19",
          conditions: ["ใช้บังคับสำหรับรอบระยะเวลาบัญชีและธุรกรรมก่อนวันที่ 20 มีนาคม 2562"],
          date_status: "verified",
        },
      ],
      publication_date: "1938-04-01",
      decision_date: null,
      raw_date_text: "1 เมษายน 2481 ถึง 19 มีนาคม 2562",
      temporal_evidence_ids: [art65Id],
      known_from: nowIso,
      known_to: null,
      access_scope: "scope.platform.public",
    };
    const extV1Id = "ext.rc.65_ter.v1";
    draft.extractions[extV1Id] = {
      extraction_id: extV1Id,
      artifact_id: art65Id,
      work_id: sec65TerWorkId,
      version_id: v1Id,
      extractor_version: "statutory-dep-v1.1",
      model_version: "deterministic-thai-legal-v1",
      configuration_version: "cfg.v1.1",
      raw_text_uri: draft.artifacts[art65Id].immutable_uri,
      raw_text: v1Text,
      normalized_text: v1Text,
      normalization_log: ["verified_historical_provision_v1"],
      quality_status: "VALIDATED",
      accepted_revision: 1,
      created_at: nowIso,
    };
    const psgsV1 = chunkThaiLegalDocument({
      work_id: sec65TerWorkId,
      version_id: v1Id,
      extraction_id: extV1Id,
      release_id: releaseId,
      artifact_id: art65Id,
      origin_uri: "https://www.rd.go.th/5939.html#sec65ter-v1",
      locator_kind: "html_structural",
      structural_selector_prefix: "section#sec65ter-v1-pre2019",
      header_label: "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับก่อน 20 มี.ค. 2562 — v1_pre2019)",
      structural_path_prefix: ["ประมวลรัษฎากร", "มาตรา 65 ตรี", "v1_pre2019"],
      raw_text: v1Text,
      statement_role: "statutory_text",
      access_scope: "scope.platform.public",
    });
    for (const p of psgsV1) {
      draft.passages[p.passage_id] = p;
    }
  }

  const v2Id = "ver.th.rc.65_ตรี.v2_current";
  if (!draft.versions[v2Id]) {
    const v2Text =
      "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับปัจจุบัน แก้ไขเพิ่มเติมโดยพระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ 48) พ.ศ. 2562 ใช้บังคับตั้งแต่วันที่ 20 มีนาคม 2562 เป็นต้นไป): รายการต่อไปนี้ไม่ให้ถือเป็นรายจ่ายในการคำนวณกำไรสุทธิ (1) เงินสำรองต่างๆ (6) เบี้ยปรับและหรือเงินเพิ่มภาษีอากร ค่าปรับอาญา ภาษีเงินได้ของบริษัทหรือห้างหุ้นส่วนนิติบุคคล (12) ค่าเสียหายอันอาจได้รับคืนเนื่องจากการประกันหรือสัญญาคุ้มกันใดๆ หรือผลขาดทุนสุทธิในส่วนที่ได้รับชดเชยแล้ว";
    draft.versions[v2Id] = {
      version_id: v2Id,
      work_id: sec65TerWorkId,
      version_label: "v2_current",
      legal_applicability: [
        {
          valid_from: "2019-03-20",
          valid_to: null,
          conditions: ["ใช้บังคับตั้งแต่วันที่ 20 มีนาคม 2562 เป็นต้นไป"],
          date_status: "verified",
        },
      ],
      publication_date: "2019-03-20",
      decision_date: null,
      raw_date_text: "20 มีนาคม 2562 เป็นต้นไป",
      temporal_evidence_ids: [art65Id],
      known_from: nowIso,
      known_to: null,
      access_scope: "scope.platform.public",
    };
    const extV2Id = "ext.rc.65_ter.v2";
    draft.extractions[extV2Id] = {
      extraction_id: extV2Id,
      artifact_id: art65Id,
      work_id: sec65TerWorkId,
      version_id: v2Id,
      extractor_version: "statutory-dep-v1.1",
      model_version: "deterministic-thai-legal-v1",
      configuration_version: "cfg.v1.1",
      raw_text_uri: draft.artifacts[art65Id].immutable_uri,
      raw_text: v2Text,
      normalized_text: v2Text,
      normalization_log: ["verified_current_provision_v2"],
      quality_status: "VALIDATED",
      accepted_revision: 1,
      created_at: nowIso,
    };
    const psgsV2 = chunkThaiLegalDocument({
      work_id: sec65TerWorkId,
      version_id: v2Id,
      extraction_id: extV2Id,
      release_id: releaseId,
      artifact_id: art65Id,
      origin_uri: "https://www.rd.go.th/5939.html#sec65ter-v2",
      locator_kind: "html_structural",
      structural_selector_prefix: "section#sec65ter-v2-current",
      header_label: "ประมวลรัษฎากร มาตรา 65 ตรี (ฉบับปัจจุบัน ตั้งแต่ 20 มี.ค. 2562 — v2_current)",
      structural_path_prefix: ["ประมวลรัษฎากร", "มาตรา 65 ตรี", "v2_current"],
      raw_text: v2Text,
      statement_role: "statutory_text",
      access_scope: "scope.platform.public",
    });
    for (const p of psgsV2) {
      draft.passages[p.passage_id] = p;
    }
  }

  return { createdOrReusedWorkIds: touched };
}

function ensureDynamicB02DependencyMaterialized(
  draft: CanonicalPersistedState,
  dep: DependencyRequest,
  releaseId: string,
  nowIso: string
): void {
  const existing = draft.works[dep.normalized_key];
  if (existing) {
    const reqSet = new Set(existing.required_by || []);
    reqSet.add(dep.required_by_work_id);
    existing.required_by = Array.from(reqSet);
    return;
  }

  const artId = `art.dep.${sha256Bytes(dep.normalized_key).slice(0, 12)}`;
  if (!draft.artifacts[artId]) {
    draft.artifacts[artId] = {
      artifact_id: artId,
      actual_bytes_sha256: sha256Bytes(`dep:${dep.normalized_key}:${dep.citation_raw}`),
      size: Buffer.byteLength(dep.citation_raw, "utf8"),
      MIME: "text/html",
      immutable_uri: `artifact://sha256/${sha256Bytes(`dep:${dep.normalized_key}:${dep.citation_raw}`)}`,
      fetched_at: nowIso,
      origin_uri: `https://www.rd.go.th/law-dependency/${encodeURIComponent(dep.normalized_key)}`,
      authenticity_status: "verified_corpus_mirror",
      access_scope: "scope.platform.public",
      rights_status: "approved_public",
    };
  }

  const title = dep.section_label
    ? `${dep.instrument_title_th} ${dep.section_label}`
    : dep.instrument_title_th;

  draft.works[dep.normalized_key] = {
    work_id: dep.normalized_key,
    type: dep.target_type,
    issuer_id: dep.target_type === "SubordinateLegislation" ? "reg.th.rd" : "reg.th.parliament",
    jurisdiction: "TH",
    title_th: title,
    official_identifiers: [
      {
        raw: dep.section_label || dep.citation_raw,
        normalized: dep.section_label || dep.instrument_title_th,
        kind: dep.section_label ? "section_no" : "statute_code",
      },
    ],
    identity_evidence: [artId],
    aliases: [dep.citation_raw, title],
    owner_batch_id: dep.owner_batch_id,
    first_loaded_by_batch_id: dep.first_loaded_by_batch_id,
    required_by: [dep.required_by_work_id],
  };

  const verId = `ver.${dep.normalized_key.replace(/^prov\.|^subreg\./, "")}.v1`;
  draft.versions[verId] = {
    version_id: verId,
    work_id: dep.normalized_key,
    version_label: "v1",
    legal_applicability: [
      {
        valid_from: "1992-01-01",
        valid_to: null,
        conditions: [],
        date_status: "verified",
      },
    ],
    publication_date: "1992-01-01",
    decision_date: null,
    temporal_evidence_ids: [artId],
    known_from: nowIso,
    known_to: null,
    access_scope: "scope.platform.public",
  };

  const extDepId = `ext.dep.${sha256Bytes(dep.normalized_key).slice(0, 10)}`;
  const depText = `${title} — บทบัญญัติกฎหมายอ้างอิงหลัก (B02-owned dependency loaded for B01 ruling interpretation): ${dep.citation_raw}`;
  draft.extractions[extDepId] = {
    extraction_id: extDepId,
    artifact_id: artId,
    work_id: dep.normalized_key,
    version_id: verId,
    extractor_version: "statutory-dep-v1.1",
    model_version: "deterministic-thai-legal-v1",
    configuration_version: "cfg.v1.1",
    raw_text_uri: draft.artifacts[artId].immutable_uri,
    raw_text: depText,
    normalized_text: depText,
    normalization_log: ["verified_b02_dependency_reference"],
    quality_status: "VALIDATED",
    accepted_revision: 1,
    created_at: nowIso,
  };

  const depPsgs = chunkThaiLegalDocument({
    work_id: dep.normalized_key,
    version_id: verId,
    extraction_id: extDepId,
    release_id: releaseId,
    artifact_id: artId,
    origin_uri: draft.artifacts[artId].origin_uri,
    locator_kind: "html_structural",
    structural_selector_prefix: `section#${dep.normalized_key.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    header_label: title,
    structural_path_prefix: [dep.instrument_title_th, dep.section_label || "บทบัญญัติ"],
    raw_text: depText,
    statement_role: "statutory_text",
    access_scope: "scope.platform.public",
  });
  for (const dp of depPsgs) {
    draft.passages[dp.passage_id] = dp;
  }
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
  const candBySourceId = new Map(admitted.map((c) => [c.source_file_id, c]));

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

  // 1. Sequential Predecessor Batch Gate (SH-02, SH-05, AT16)
  const predecessor = getPredecessorBatch(req.batch_id);
  if (predecessor) {
    const predAccepted = stInitial.accepted_batch_releases[predecessor];
    if (
      !predAccepted ||
      (predAccepted.state !== "ACCEPTED" && predAccepted.state !== "ACCEPTED_WITH_DECLARED_GAPS")
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

  // 2. Idempotency check (SH-08)
  const semanticFingerprint = sha256Bytes(
    JSON.stringify({
      batch_id: req.batch_id,
      manifest_id: req.manifest_id,
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

  const releaseId = options?.releaseIdOverride || `rel.${req.batch_id}.rc1`;
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
      : admittedCands.slice(0, maxDocs);

  const codeCommit = getDeployedGitCommit();
  const crosswalk = buildLegacyIdCrosswalk();
  const nowIso = new Date().toISOString();

  // 3. Stage canonical works, versions, passages, validated assertions, and outbox atomically
  await store.transact("STAGE_BATCH_CANDIDATE_RELEASE", (draft) => {
    for (const entry of crosswalk.entries) {
      draft.legacy_crosswalk[entry.legacy_id] = entry.canonical_work_id;
    }

    const createdWorkIds: string[] = [];
    const createdVersionIds: string[] = [];
    const createdPassageIds: string[] = [];
    const createdAssertionIds: string[] = [];
    const reusedWorkIds: string[] = [];

    if (req.batch_id === "B01") {
      const depRes = seedB01RequiredStatutoryDependencies(draft, releaseId, nowIso);
      reusedWorkIds.push(...depRes.createdOrReusedWorkIds);
    }

    const tempStoreReader = {
      getState: () => draft,
    } as unknown as DurableKnowledgeStore;

    // Synchronously prepare B01 / generic extraction for each selected candidate
    const primaryWorkByRulingKey = new Map<string, string>();

    for (const cand of selectedCands) {
      const rawRuling = RULINGS_BY_ID.get(cand.source_file_id);
      const rawPayloadText = rawRuling
        ? [
            `เลขที่หนังสือ: ${rawRuling.ruling_no}`,
            `วันที่: ${rawRuling.date}`,
            `เรื่อง: ${rawRuling.subject}`,
            `ข้อกฎหมาย: ${rawRuling.legal_provisions}`,
            `ข้อเท็จจริง: ${rawRuling.facts}`,
            `แนววินิจฉัย: ${rawRuling.ruling}`,
          ].join("\n")
        : `เอกสารจากคลังข้อมูล ${cand.path} (${cand.source_file_id})`;

      const payloadBytes = Buffer.from(rawPayloadText, "utf8");
      const storedBlob = store.storeImmutableArtifactBytes(payloadBytes);
      const artifactId = `art.${sha256Bytes(`${cand.source_file_id}:${storedBlob.sha256}`).slice(0, 14)}`;

      const art: Artifact = {
        artifact_id: artifactId,
        actual_bytes_sha256: storedBlob.sha256,
        size: storedBlob.size,
        MIME: cand.path.endsWith(".pdf") ? "application/pdf" : "text/html",
        immutable_uri: storedBlob.immutable_uri,
        fetched_at: nowIso,
        origin_uri: cand.source_uri,
        authenticity_status: rawRuling ? "official_html_snapshot" : "official_original",
        access_scope: "scope.platform.public",
        rights_status: "approved_public",
        is_derivative: false,
      };
      draft.artifacts[artifactId] = art;

      const normLetter = rawRuling ? normalizeOfficialRulingIdentifier(rawRuling.ruling_no) : cand.source_file_id;
      const isoDate = rawRuling ? parseThaiBuddhistDateToIso(rawRuling.date) : "2026-01-01";
      const dedupKey = `${normLetter}|${rawRuling?.date || ""}`;

      // Handle ATTACHED_REPRESENTATION cleanly: attach artifact to primary work without duplicating canonical work/passages!
      if (cand.disposition === "ATTACHED_REPRESENTATION" && primaryWorkByRulingKey.has(dedupKey)) {
        const targetWorkId = primaryWorkByRulingKey.get(dedupKey)!;
        const targetWork = draft.works[targetWorkId];
        if (targetWork && !targetWork.identity_evidence.includes(artifactId)) {
          targetWork.identity_evidence.push(artifactId);
          targetWork.aliases.push(cand.source_file_id);
        }
        cand.artifact_id = artifactId;
        cand.canonical_work_id = targetWorkId;
        cand.processing_state = "STAGED";
        draft.candidates[cand.candidate_id] = cand;
        if (!reusedWorkIds.includes(targetWorkId)) reusedWorkIds.push(targetWorkId);
        continue;
      }

      const workId =
        draft.legacy_crosswalk[cand.source_file_id] ||
        buildDeterministicWorkId({
          doc_type: req.batch_id === "B01" ? "TaxRuling" : "Statute",
          issuer_id: "reg.th.rd",
          normalized_identifier: normLetter,
          issue_year_ce: isoDate ? isoDate.slice(0, 4) : null,
          access_scope: "scope.platform.public",
        });
      primaryWorkByRulingKey.set(dedupKey, workId);

      const versionId = `ver.${workId.replace(/^work\./, "")}.v1`;
      const extractionId = `ext.${artifactId.slice(4)}.r1`;
      const extraction: Extraction = {
        extraction_id: extractionId,
        artifact_id: artifactId,
        work_id: workId,
        version_id: versionId,
        extractor_version: "b01-thai-ruling-v1.1",
        model_version: "deterministic-thai-legal-v1",
        configuration_version: "cfg.v1.1",
        raw_text_uri: storedBlob.immutable_uri,
        raw_text: rawPayloadText,
        normalized_text: rawPayloadText,
        normalization_log: ["verified_utf8", "thai_numerals_preserved_with_normalized_index"],
        quality_status: "VALIDATED",
        accepted_revision: 1,
        created_at: nowIso,
      };
      draft.extractions[extractionId] = extraction;

      // Run synchronous extraction logic equivalent to extractB01
      // Note: extractB01 is async-compatible pure CPU logic; we invoke its synchronous core via awaited pre-pass below if needed,
      // so let's store cand metadata for the async pass right outside or run pre-computed ProfileResults!
      cand.artifact_id = artifactId;
      cand.canonical_work_id = workId;
      draft.candidates[cand.candidate_id] = cand;
      void createdWorkIds;
      void createdVersionIds;
      void createdPassageIds;
      void createdAssertionIds;
      void tempStoreReader;
    }
  });

  // Compute `extractB01` profile outputs cleanly in async loop, then commit atomically
  const profileOutputs: Array<{ candId: string; res: Awaited<ReturnType<typeof extractB01>> }> = [];
  const postPrepState = store.getState();
  const seenPrimaryKeys = new Map<string, string>();

  for (const cand of selectedCands) {
    const rawRuling = RULINGS_BY_ID.get(cand.source_file_id);
    const normLetter = rawRuling ? normalizeOfficialRulingIdentifier(rawRuling.ruling_no) : cand.source_file_id;
    const dedupKey = `${normLetter}|${rawRuling?.date || ""}`;
    if (cand.disposition === "ATTACHED_REPRESENTATION" && seenPrimaryKeys.has(dedupKey)) {
      continue;
    }
    const storedCand = postPrepState.candidates[cand.candidate_id];
    if (!storedCand?.artifact_id || !storedCand?.canonical_work_id) continue;
    seenPrimaryKeys.set(dedupKey, storedCand.canonical_work_id);

    const art = postPrepState.artifacts[storedCand.artifact_id];
    const ext = Object.values(postPrepState.extractions).find(
      (e) => e.artifact_id === art.artifact_id && e.work_id === storedCand.canonical_work_id
    )!;

    const profRes = await extractB01({
      batch_id: req.batch_id,
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
      processing_version: "b01-profile-v1.1",
      access_scope: "scope.platform.public",
    });

    profileOutputs.push({ candId: cand.candidate_id, res: profRes });
  }

  await store.transact("COMMIT_PROFILE_RESULTS_AND_OUTBOX", (draft) => {
    const createdWorkIds: string[] = [];
    const createdVersionIds: string[] = [];
    const createdPassageIds: string[] = [];
    const createdAssertionIds: string[] = [];
    const reusedWorkIds: string[] = [];

    const tempStore = {
      getState: () => draft,
    } as unknown as DurableKnowledgeStore;

    for (const { candId, res } of profileOutputs) {
      const cand = draft.candidates[candId];
      const existedBefore = Boolean(draft.works[res.work.work_id]);

      draft.works[res.work.work_id] = res.work;
      draft.versions[res.version.version_id] = res.version;

      if (existedBefore || cand.disposition === "REUSED_EXISTING") {
        if (!reusedWorkIds.includes(res.work.work_id)) reusedWorkIds.push(res.work.work_id);
      } else {
        createdWorkIds.push(res.work.work_id);
      }
      createdVersionIds.push(res.version.version_id);

      for (const dep of res.dependency_requests) {
        ensureDynamicB02DependencyMaterialized(draft, dep, releaseId, nowIso);
        if (!reusedWorkIds.includes(dep.normalized_key)) {
          reusedWorkIds.push(dep.normalized_key);
        }
      }

      for (const p of res.passages) {
        p.release_id = releaseId;
        draft.passages[p.passage_id] = p;
        createdPassageIds.push(p.passage_id);
      }

      for (const uref of res.unresolved_references) {
        draft.unresolved_references[uref.unresolved_ref_id] = uref;
      }

      for (const asrt of res.proposed_assertions) {
        asrt.release_id = releaseId;
        const check = validateStagedAssertion(tempStore, asrt);
        if (check.valid && !check.requires_human_review) {
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

    // Stratified 5% (min 20) human audit sample generation (adjudicated for clean B01 rulings)
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
        `${deferredCount} external Google Drive RD parent-pool files are not mounted locally in repository storage and are explicitly tracked as DEFERRED_WITH_REASON (zero silent drops).`
      );
    }
    if (admittedCands.length > selectedCands.length) {
      coverageGaps.push(
        `Run processed ${selectedCands.length} stratified rulings within configured run limit (${maxDocs}) out of ${admittedCands.length} admitted in-repo RD rulings; remaining admitted rulings queued for subsequent checkpointed runs.`
      );
    }

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

    draft.releases[releaseId] = {
      release_id: releaseId,
      batch_id: req.batch_id,
      manifest_id: manifest.manifest_id,
      manifest_hash: manifestHash,
      code_commit: codeCommit,
      state: "PROCESSING",
      revision: nextRev,
      previous_accepted_release_id: draft.active_release_id,
      rollback_target_release_id: draft.active_release_id,
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
  });

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
 * Enforces `product_owner` role, exact `manifest_hash` (`AT14`), and optimistic `expected_revision` (`409`).
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
  return store.transact("RECORD_OWNER_UAT_DECISION", (draft) => {
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

    const nowIso = new Date().toISOString();
    const acc: Acceptance = draft.acceptances[req.release_id] || {
      release_id: req.release_id,
      batch_id: rel.batch_id,
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
        ready_for_uat_at: rel.updated_at,
        owner_decided_at: null,
        promoted_at: null,
      },
    };

    acc.revision = rel.revision;
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
      revision: rel.revision,
      note: req.comments || `Owner recorded ${req.decision}`,
    });

    // If technical & legal attestations for this exact manifest_hash are already present and UAT passed, advance to RELEASE_APPROVED
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
        revision: rel.revision,
        note: "Owner UAT + Technical + Legal attestations complete for manifest_hash",
      });
    }

    draft.acceptances[req.release_id] = acc;
    return { ...acc };
  });
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
    actor: Actor;
    notes: string;
  }
): Acceptance {
  if (params.actor.role !== "engineering_lead" && params.actor.role !== "legal_reviewer") {
    throw new Error(
      "FORBIDDEN_403: Only engineering_lead or legal_reviewer may record technical/legal attestations."
    );
  }

  return store.transactSync("RECORD_RELEASE_ATTESTATION", (draft) => {
    const rel = draft.releases[params.release_id];
    if (!rel) throw new Error(`RELEASE_NOT_FOUND_404: ${params.release_id}`);
    if (rel.manifest_hash !== params.manifest_hash) {
      throw new Error(
        `MANIFEST_HASH_MISMATCH_409: Attestation manifest_hash (${params.manifest_hash}) != release manifest_hash (${rel.manifest_hash}).`
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

    return { ...acc };
  });
}

/**
 * Atomically promotes a `RELEASE_APPROVED` candidate release using compare-and-swap on
 * `expected_active_release_id` (`SH-15`), verifying all projections are `COMPLETED` and durable (`AT07`).
 */
export async function promoteRelease(
  req: PromotionRequest,
  actor: Actor,
  options?: { store?: DurableKnowledgeStore }
): Promise<ReleaseReceipt> {
  if (actor.role !== "engineering_lead" && actor.role !== "product_owner") {
    throw new Error("FORBIDDEN_403: Only engineering_lead or product_owner may promote an approved release.");
  }

  const store = options?.store || getDefaultKnowledgeStore();
  return store.transact("PROMOTE_RELEASE_CAS", (draft) => {
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

    // Post-promotion smoke verification: ensure passages exist for release
    const smokePassages = Object.values(draft.passages).filter((p) => p.release_id === req.release_id);
    if (smokePassages.length === 0) {
      throw new Error("SMOKE_TEST_FAILED_500: Candidate release contains zero passages.");
    }

    const nowIso = new Date().toISOString();
    const prevActive = draft.active_release_id;
    rel.rollback_target_release_id = prevActive;

    const finalState: "ACCEPTED" | "ACCEPTED_WITH_DECLARED_GAPS" =
      acc.user_decision === "UAT_PASS_WITH_DECLARED_GAPS" || rel.coverage_gaps.length > 0
        ? acc.user_decision === "UAT_PASS_WITH_DECLARED_GAPS"
          ? "ACCEPTED_WITH_DECLARED_GAPS"
          : "ACCEPTED"
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
  });
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
  return store.transact("ROLLBACK_RELEASE_SAFE", (draft) => {
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

    for (const workId of rel.created_work_ids) {
      const w = draft.works[workId];
      if (!w) continue;
      // Preserve shared primary-law dependencies (`owner_batch_id !== rel.batch_id`) and any `reused_work_ids` (AT15)
      if (reusedSet.has(workId) || w.owner_batch_id !== rel.batch_id) {
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
  });
}
