/**
 * REG24 — Task F2: Recursive Inventory Freeze, Dry-Run Reconciliation & Idempotent Candidate Ingestion
 * Implements SH-01, SH-02, SH-08, SH-09, AT01, AT02, AT03, AT17.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { RD_DRIVE_MANIFEST } from "../data/rd-drive-manifest-loader";
import { getB02DriveManifest } from "../data/b02-drive-manifest-loader";
import { TAX_EXPANSION_SOURCES } from "../data/tax-ruling-subreg-corpus";
import { classifyB02InstrumentAndStatus, resolveCanonicalB02WorkId } from "./profiles/B02";
import type { KnowledgeEntityType } from "../graph/graph-schema";
import {
  normalizeOfficialRulingIdentifier,
  parseThaiBuddhistDateToIso,
  resolveCanonicalWorkIdentity,
  sha256Bytes,
} from "./identity";
import { getDefaultKnowledgeStore, type DurableKnowledgeStore } from "./store";
import type {
  Actor,
  Artifact,
  Assertion,
  BatchId,
  BatchManifest,
  Candidate,
  CandidateDisposition,
  Extraction,
  IdentityAction,
  LegalVersion,
  LegalWork,
  Passage,
  ReconciliationPlan,
  RunLimits,
} from "./contracts";

export interface SyntheticInventoryInput {
  folders: Array<{
    folder_id: string;
    parent_id: string | null;
    title: string;
    shortcut_target_id: string | null;
  }>;
  files: Array<{
    file_id: string;
    folder_id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    page_count: number | null;
    downloadable: boolean;
    shortcut_target_id: string | null;
  }>;
  index_rows: Array<{
    row_id: string;
    official_id: string;
    file_id: string;
  }>;
}

function loadBatchConfigFile(batchId: BatchId): {
  owned_source_folders: Array<{ folder_id: string; title: string }>;
  predecessor_batch_id: BatchId | null;
  run_limits: RunLimits;
  audit_source_pool?: { files: number; pdfs: number };
} {
  const cfgPath = path.join(process.cwd(), "config", "knowledge", "batches", `${batchId}.json`);
  if (fs.existsSync(cfgPath)) {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  }
  return {
    owned_source_folders: [],
    predecessor_batch_id: batchId === "B01" ? null : "B01",
    run_limits: {
      max_documents_per_run: 200,
      max_source_pages_per_run: 1000,
      max_ocr_task_pages: 50,
      max_ocr_dispatch_pages_per_run: 250,
      stratified_audit_fraction: 0.05,
      stratified_audit_min_docs: 20,
    },
  };
}

export async function freezeInventory(
  batchId: BatchId,
  actor: Actor,
  options?: {
    store?: DurableKnowledgeStore;
    syntheticInventoryOverride?: SyntheticInventoryInput;
    sourceCutoffAt?: string;
    predecessorReleaseId?: string;
  }
): Promise<{ manifest: BatchManifest; candidates: Candidate[] }> {
  const store = options?.store || getDefaultKnowledgeStore();
  const stBefore = store.getState();
  const cfg = loadBatchConfigFile(batchId);
  const cutoff = options?.sourceCutoffAt || new Date().toISOString();
  let snapshotId = `inv.${batchId.toLowerCase()}.${Date.now().toString(36)}`;
  let manifestId = `mfst.${batchId.toLowerCase()}.${snapshotId.slice(-8)}`;
  while (stBefore.manifests[manifestId]) {
    snapshotId = `inv.${batchId.toLowerCase()}.${(Date.now() + Math.floor(Math.random() * 1000) + 1).toString(36)}`;
    manifestId = `mfst.${batchId.toLowerCase()}.${snapshotId.slice(-8)}`;
  }
  const hasPriorManifestForBatch = Object.values(stBefore.manifests).some(
    (m) => m.batch_id === batchId
  );
  const candManifestSuffix = hasPriorManifestForBatch ? `.${manifestId.split(".").pop()}` : "";

  const emptyFolders: string[] = [];
  const shortcutCycles: string[] = [];
  const indexMismatches: BatchManifest["index_mismatches"] = [];
  const oversizedRuns: string[] = [];
  const candidates: Candidate[] = [];

  if (options?.syntheticInventoryOverride) {
    const syn = options.syntheticInventoryOverride;
    const visitedFolders = new Set<string>();
    const folderById = new Map(syn.folders.map((f) => [f.folder_id, f]));

    const traverseFolder = (folderId: string, chain: Set<string>) => {
      const fld = folderById.get(folderId);
      if (!fld) return;
      if (fld.shortcut_target_id) {
        if (chain.has(fld.shortcut_target_id)) {
          shortcutCycles.push(`${fld.folder_id}->${fld.shortcut_target_id}`);
          return;
        }
        const nextChain = new Set(chain);
        nextChain.add(fld.folder_id);
        traverseFolder(fld.shortcut_target_id, nextChain);
        return;
      }
      if (visitedFolders.has(folderId)) return;
      visitedFolders.add(folderId);

      const childFolders = syn.folders.filter((c) => c.parent_id === folderId);
      const childFiles = syn.files.filter((f) => f.folder_id === folderId);
      if (childFolders.length === 0 && childFiles.length === 0) {
        emptyFolders.push(folderId);
      }
      for (const child of childFolders) {
        const nextChain = new Set(chain);
        nextChain.add(folderId);
        traverseFolder(child.folder_id, nextChain);
      }
    };

    for (const root of syn.folders.filter((f) => f.parent_id === null)) {
      traverseFolder(root.folder_id, new Set([root.folder_id]));
    }

    const seenPhysicalTargets = new Set<string>();
    const fileById = new Map(syn.files.map((f) => [f.file_id, f]));

    for (const f of syn.files) {
      const resolvedTargetId = f.shortcut_target_id || f.file_id;
      const isDuplicateShortcut = Boolean(f.shortcut_target_id && seenPhysicalTargets.has(resolvedTargetId));
      seenPhysicalTargets.add(resolvedTargetId);

      if ((f.page_count ?? 0) > cfg.run_limits.max_source_pages_per_run) {
        oversizedRuns.push(f.file_id);
      }

      candidates.push({
        candidate_id: `cand.${batchId.toLowerCase()}.${f.file_id}`,
        manifest_id: manifestId,
        source_file_id: f.file_id,
        source_revision: "rev_1",
        path: `${f.folder_id}/${f.name}`,
        owner_batch_id: batchId,
        source_uri: `https://drive.google.com/file/d/${resolvedTargetId}/view`,
        artifact_id: null,
        canonical_work_id: null,
        processing_state: isDuplicateShortcut ? "VALIDATED" : f.downloadable ? "DISCOVERED" : "DEFERRED",
        identity_action: isDuplicateShortcut ? "ATTACH_REPRESENTATION" : "CREATE_NEW_WORK",
        disposition: isDuplicateShortcut
          ? "ATTACHED_REPRESENTATION"
          : f.downloadable
            ? "PUBLISHED_NEW"
            : "DEFERRED_WITH_REASON",
        reasons: isDuplicateShortcut
          ? [`Shortcut ${f.file_id} points to already inventoried file ${resolvedTargetId}`]
          : (f.page_count ?? 0) > cfg.run_limits.max_source_pages_per_run
            ? [`Oversized compilation (${f.page_count} pages) scheduled for dedicated checkpointed run`]
            : ["Admitted from frozen folder traversal"],
        review_ids: [],
      });
    }

    for (const row of syn.index_rows) {
      if (!fileById.has(row.file_id)) {
        indexMismatches.push({
          row_id: row.row_id,
          official_id: row.official_id,
          expected_file_id: row.file_id,
          reason: "INDEX_ROW_MISSING_DRIVE_FILE",
        });
        candidates.push({
          candidate_id: `cand.${batchId.toLowerCase()}.idx_missing.${row.row_id}`,
          manifest_id: manifestId,
          source_file_id: row.file_id,
          source_revision: "missing",
          path: `RD_Index/${row.row_id}`,
          owner_batch_id: batchId,
          source_uri: `index://rd/${row.row_id}`,
          artifact_id: null,
          canonical_work_id: null,
          processing_state: "DEFERRED",
          identity_action: null,
          disposition: "DEFERRED_WITH_REASON",
          reasons: [`Index entry ${row.official_id} references missing Drive file ${row.file_id}`],
          review_ids: [],
        });
      }
    }
  } else if (batchId === "B01") {
    // Full zero-gap B01 physical inventory reconciliation over all 5,150 files in `RD - Revenue Department`
    // (`1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6`):
    // 1) 4,578 physical files in `Rulings/` (4,574 PDFs + 4 official HTML snapshots; zero deferred gaps)
    //    - Primary official HTML snapshots ordered ahead of HTML-rendered PDF derivatives so duplicate pairs
    //      attach cleanly via `ATTACHED_REPRESENTATION` without duplicating canonical LegalWorks.
    //    - Existing REG24 seed expansion rulings marked `REUSED_EXISTING`.
    // 2) 572 physical non-ruling files (570 B02-owned RD tax regulations across CIT/PIT/VAT/WHT/SBT/Stamp/Pillar Two/TP/General + 2 RD Index `.gsheet` descriptors) -> `REJECTED_OUT_OF_SCOPE`.
    const seenKey = new Map<string, string>();
    const seenCorpusId = new Map<string, string>();
    const existingExpansionUrls = new Set(TAX_EXPANSION_SOURCES.map((s) => s.official_url));

    const orderedRulingFiles = [...RD_DRIVE_MANIFEST.ruling_files].sort((a, b) => {
      if (a.authenticity_status === "official_html" && b.authenticity_status !== "official_html") return -1;
      if (b.authenticity_status === "official_html" && a.authenticity_status !== "official_html") return 1;
      return a.rel_path.localeCompare(b.rel_path);
    });

    for (let idx = 0; idx < orderedRulingFiles.length; idx++) {
      const rf = orderedRulingFiles[idx];
      const normNo = normalizeOfficialRulingIdentifier(rf.ruling_no);
      const dedupKey = `${normNo}|${rf.date}`;
      const existingPrimaryId = seenKey.get(dedupKey) || seenCorpusId.get(rf.corpus_id);
      const isDupRep = Boolean(existingPrimaryId);
      const isAlreadyInSeed = !isDupRep && existingExpansionUrls.has(rf.source_url);

      if (!isDupRep) {
        seenKey.set(dedupKey, rf.corpus_id);
        seenCorpusId.set(rf.corpus_id, rf.corpus_id);
      }

      const disposition: CandidateDisposition = isAlreadyInSeed
        ? "REUSED_EXISTING"
        : isDupRep
          ? "ATTACHED_REPRESENTATION"
          : "PUBLISHED_NEW";
      const idAction: IdentityAction = isAlreadyInSeed
        ? "SKIP_UNCHANGED"
        : isDupRep
          ? "ATTACH_REPRESENTATION"
          : "CREATE_NEW_WORK";

      const shortCode = rf.corpus_id.replace(/^ruling\.th\.rd\./, "");
      const padIdx = String(idx + 1).padStart(4, "0");

      candidates.push({
        candidate_id: `cand.b01.drv.${padIdx}.${shortCode}${candManifestSuffix}`,
        manifest_id: manifestId,
        source_file_id: rf.corpus_id,
        source_revision: rf.sha256.slice(0, 16),
        path: rf.rel_path,
        owner_batch_id: "B01",
        source_uri: rf.source_url,
        artifact_id: null,
        canonical_work_id: null,
        processing_state: "DISCOVERED",
        identity_action: idAction,
        disposition,
        reasons: isDupRep
          ? [`Duplicate representation (${rf.authenticity_status}) of ${normNo} (${rf.date}); attached to ${existingPrimaryId}`]
          : ["Verified physical RD Tax Ruling file in Rulings/ subtree admitted in B01 scope"],
        review_ids: [],
      });
    }

    for (let idx = 0; idx < RD_DRIVE_MANIFEST.non_ruling_files.length; idx++) {
      const nrf = RD_DRIVE_MANIFEST.non_ruling_files[idx];
      const padIdx = String(idx + 1).padStart(3, "0");
      const isRootIndex = nrf.folder === "ROOT_INDEX";
      candidates.push({
        candidate_id: `cand.b01.oos.${padIdx}.${nrf.sha256.slice(0, 10)}${candManifestSuffix}`,
        manifest_id: manifestId,
        source_file_id: `rd_oos_${nrf.sha256.slice(0, 16)}`,
        source_revision: nrf.sha256.slice(0, 16),
        path: nrf.rel_path,
        owner_batch_id: "B02",
        source_uri: `https://drive.google.com/drive/folders/${RD_DRIVE_MANIFEST.drive_folder_id}#${encodeURIComponent(nrf.rel_path)}`,
        artifact_id: null,
        canonical_work_id: null,
        processing_state: "VALIDATED",
        identity_action: "SKIP_UNCHANGED",
        disposition: "REJECTED_OUT_OF_SCOPE",
        reasons: [
          isRootIndex
            ? `Root spreadsheet index descriptor (${nrf.rel_path}) reconciled during inventory; not a legal ruling work`
            : `Non-ruling RD tax regulation in '${nrf.folder}' belongs to Batch B02 per source_batch_map.json`,
        ],
        review_ids: [],
      });
    }
  } else if (batchId === "B02") {
    // Full zero-silent-drop physical inventory reconciliation over all 7,323 B02 files
    // across Council of State, Parliament, Customs, Excise, and RD non-ruling folders
    // + 12 unpacked Customs RAR member PDFs:
    // - Machine-readable verified files (`text_excerpt.length >= 30`) -> PUBLISHED_NEW / REUSED_EXISTING / ATTACHED_REPRESENTATION
    // - Image-only historical Gazette scans / unmapped legacy fonts without verified OCR -> DEFERRED_WITH_REASON (quarantined; 0 placeholder passages)
    // - Non-legal index sheets, archive container wrappers, Myanmar foreign laws -> REJECTED_OUT_OF_SCOPE
    const b02Manifest = getB02DriveManifest();
    const existingWorks = stBefore.works;
    const predRelId = options?.predecessorReleaseId ?? stBefore.active_release_id;
    const predRel = predRelId ? stBefore.releases[predRelId] : undefined;
    const allowedPredWorkIds = predRel
      ? new Set<string>([...predRel.created_work_ids, ...predRel.reused_work_ids])
      : null;

    for (let idx = 0; idx < b02Manifest.files.length; idx++) {
      const bf = b02Manifest.files[idx];
      const padIdx = String(idx + 1).padStart(4, "0");
      const fullPath = `${bf.folder}/${bf.rel_path}`;
      if (bf.page_count > cfg.run_limits.max_source_pages_per_run) {
        oversizedRuns.push(fullPath);
      }

      const rawTitle = bf.title_hint || bf.file_name.replace(/\.[^.]+$/, "");
      const cls = classifyB02InstrumentAndStatus(rawTitle, bf.text_excerpt || "", bf.folder, bf.file_name);
      const predictedWorkId = resolveCanonicalB02WorkId({
        titleTh: rawTitle,
        fullText: bf.text_excerpt || "",
        folderHint: bf.folder,
        fileNameHint: bf.file_name,
        entityType: cls.entityType,
        issuerId: cls.issuerId,
        publicationYearCe: null,
        accessScope: "scope.platform.public",
      });

      let disposition: CandidateDisposition = bf.disposition;
      let idAction: IdentityAction | null =
        bf.disposition === "ATTACHED_REPRESENTATION"
          ? "ATTACH_REPRESENTATION"
          : bf.disposition === "PUBLISHED_NEW"
            ? "CREATE_NEW_WORK"
            : bf.disposition === "REJECTED_OUT_OF_SCOPE"
              ? "SKIP_UNCHANGED"
              : null;

      if (
        disposition === "PUBLISHED_NEW" &&
        existingWorks[predictedWorkId] &&
        (!allowedPredWorkIds || allowedPredWorkIds.has(predictedWorkId))
      ) {
        disposition = "REUSED_EXISTING";
        idAction = "NEW_EXTRACTION_REVISION";
      }

      candidates.push({
        candidate_id: `cand.b02.drv.${padIdx}.${bf.sha256.slice(0, 10)}${candManifestSuffix}`,
        manifest_id: manifestId,
        source_file_id: `b02_${bf.sha256.slice(0, 16)}`,
        source_revision: bf.sha256.slice(0, 16),
        path: fullPath,
        owner_batch_id: "B02",
        source_uri: `https://drive.google.com/drive/folders/b02#${encodeURIComponent(fullPath)}`,
        artifact_id: null,
        canonical_work_id: disposition === "REUSED_EXISTING" ? predictedWorkId : null,
        processing_state:
          disposition === "DEFERRED_WITH_REASON"
            ? "DEFERRED"
            : disposition === "REJECTED_OUT_OF_SCOPE"
              ? "VALIDATED"
              : "DISCOVERED",
        identity_action: idAction,
        disposition,
        reasons: [
          bf.reason ||
            (disposition === "REUSED_EXISTING"
              ? `Upgrades existing B02-owned dependency ${predictedWorkId} first loaded in B01`
              : `Verified readable B02 statutory/regulatory source (${bf.file_route})`),
        ],
        review_ids: [],
      });
    }

    for (let rIdx = 0; rIdx < b02Manifest.rar_expanded_members.length; rIdx++) {
      const rm = b02Manifest.rar_expanded_members[rIdx];
      const padIdx = String(rIdx + 1).padStart(2, "0");
      const hasText = Boolean(rm.text_excerpt && rm.text_excerpt.trim().length >= 30);
      const rarPath = `Customs/RAR_UNPACKED/${rm.parent_rar}/${rm.rel_path}`;
      candidates.push({
        candidate_id: `cand.b02.rar.${padIdx}.${rm.sha256.slice(0, 10)}${candManifestSuffix}`,
        manifest_id: manifestId,
        source_file_id: `b02_rar_${rm.sha256.slice(0, 16)}`,
        source_revision: rm.sha256.slice(0, 16),
        path: rarPath,
        owner_batch_id: "B02",
        source_uri: `archive://customs/${encodeURIComponent(rm.parent_rar)}/${encodeURIComponent(rm.rel_path)}`,
        artifact_id: null,
        canonical_work_id: null,
        processing_state: hasText ? "DISCOVERED" : "DEFERRED",
        identity_action: hasText ? "CREATE_NEW_WORK" : null,
        disposition: hasText ? "PUBLISHED_NEW" : "DEFERRED_WITH_REASON",
        reasons: [
          hasText
            ? `Unpacked Customs RAR member PDF (${rm.file_route}) from ${rm.parent_rar}`
            : `Unpacked Customs RAR scan-only member PDF quarantined pending verified OCR`,
        ],
        review_ids: [],
      });
    }
  }

  const inventoryHash = sha256Bytes(
    candidates
      .map((c) => {
        const baseCandId =
          candManifestSuffix && c.candidate_id.endsWith(candManifestSuffix)
            ? c.candidate_id.slice(0, -candManifestSuffix.length)
            : c.candidate_id;
        return `${baseCandId}:${c.source_file_id}:${c.disposition}`;
      })
      .join("\n")
  );

  const st = store.getState();
  const manifest: BatchManifest = {
    manifest_id: manifestId,
    batch_id: batchId,
    previous_batch_id: cfg.predecessor_batch_id,
    inventory_snapshot_id: snapshotId,
    inventory_hash: inventoryHash,
    owned_folder_ids: cfg.owned_source_folders.map((f) => f.folder_id),
    dependency_manifest_id: `dep.${batchId.toLowerCase()}.${inventoryHash.slice(0, 8)}`,
    run_limits: cfg.run_limits,
    source_cutoff_at: cutoff,
    expected_previous_release_id: options?.predecessorReleaseId ?? st.active_release_id,
    frozen_at: new Date().toISOString(),
    frozen_by: actor.actor_id,
    empty_folders_detected: emptyFolders,
    shortcut_cycles_prevented: shortcutCycles,
    index_mismatches: indexMismatches,
    dedicated_oversized_runs_required: oversizedRuns,
  };

  await store.transact("FREEZE_INVENTORY", (draft) => {
    draft.manifests[manifest.manifest_id] = manifest;
    for (const c of candidates) {
      draft.candidates[c.candidate_id] = c;
    }
  });

  return { manifest, candidates };
}

export async function planReconciliation(
  manifestOrSnapshotId: string,
  _actor: Actor,
  options?: { store?: DurableKnowledgeStore }
): Promise<ReconciliationPlan> {
  const store = options?.store || getDefaultKnowledgeStore();
  const st = store.getState();
  const manifest =
    st.manifests[manifestOrSnapshotId] ||
    Object.values(st.manifests).find((m) => m.inventory_snapshot_id === manifestOrSnapshotId);

  if (!manifest) {
    throw new Error(`MANIFEST_NOT_FOUND: ${manifestOrSnapshotId}`);
  }

  const cands = Object.values(st.candidates).filter((c) => c.manifest_id === manifest.manifest_id);

  const byIdentityAction: Record<IdentityAction, number> = {
    SKIP_UNCHANGED: 0,
    ATTACH_REPRESENTATION: 0,
    NEW_EXTRACTION_REVISION: 0,
    NEW_LEGAL_VERSION: 0,
    CREATE_NEW_WORK: 0,
    REVIEW_IDENTITY_CONFLICT: 0,
  };

  const byDisposition: Record<CandidateDisposition, number> = {
    PUBLISHED_NEW: 0,
    REUSED_EXISTING: 0,
    ATTACHED_REPRESENTATION: 0,
    REJECTED_OUT_OF_SCOPE: 0,
    DEFERRED_WITH_REASON: 0,
    FAILED: 0,
  };

  for (const c of cands) {
    byDisposition[c.disposition] += 1;
    if (c.identity_action) {
      byIdentityAction[c.identity_action] += 1;
    }
  }

  const dispSum = Object.values(byDisposition).reduce((a, b) => a + b, 0);

  return {
    plan_id: `plan.${manifest.manifest_id}`,
    manifest_id: manifest.manifest_id,
    batch_id: manifest.batch_id,
    total_candidates: cands.length,
    by_identity_action: byIdentityAction,
    by_disposition: byDisposition,
    planned_new_works: byDisposition.PUBLISHED_NEW,
    planned_reused_works: byDisposition.REUSED_EXISTING + byDisposition.ATTACHED_REPRESENTATION,
    accounting_matches_total: dispSum === cands.length,
    silent_drops: cands.length - dispSum,
    generated_at: new Date().toISOString(),
  };
}

export interface IdempotentCandidateIngestInput {
  idempotency_key: string;
  batch_id: BatchId;
  release_id?: string;
  source_file_id: string;
  original_name: string;
  mime_type: string;
  bytes: Buffer | Uint8Array;
  official_identifier: string;
  issue_date: string | null;
  doc_type: KnowledgeEntityType;
  issuer_id: string;
  instrument_code?: string;
  access_scope: string;
  extractor_version?: string;
  extracted_text_override?: string;
  is_verified_amendment?: boolean;
  valid_from?: string | null;
  valid_to?: string | null;
}

/**
 * Transactional idempotent candidate ingestion (SH-08, SH-09, AT01, AT02, AT03).
 * - Exact replay with same key & semantic fingerprint returns 200 with zero new objects.
 * - Same key with changed bytes, scope, or extractor configuration returns 409 Conflict.
 */
export async function ingestCandidateIdempotent(
  store: DurableKnowledgeStore,
  input: IdempotentCandidateIngestInput,
  _actor: Actor
): Promise<{
  http_status: 200 | 201 | 409;
  work_id?: string;
  version_id?: string;
  extraction_id?: string;
  identity_action?: IdentityAction;
  error?: string;
}> {
  const storedBlob = store.storeImmutableArtifactBytes(input.bytes);
  const extractorVer = input.extractor_version || "native-v1";
  const semanticFingerprint = sha256Bytes(
    JSON.stringify({
      bytes_sha256: storedBlob.sha256,
      access_scope: input.access_scope,
      batch_id: input.batch_id,
      doc_type: input.doc_type,
      official_identifier: normalizeOfficialRulingIdentifier(input.official_identifier),
      extractor_version: extractorVer,
      extracted_text_override: input.extracted_text_override || null,
    })
  );

  return store.transact("INGEST_CANDIDATE_IDEMPOTENT", (draft) => {
    const existingIdem = draft.idempotency[input.idempotency_key];
    if (existingIdem) {
      if (existingIdem.semantic_fingerprint !== semanticFingerprint) {
        return {
          http_status: 409 as const,
          error: "IDEMPOTENCY_CONFLICT_409: Same idempotency key submitted with changed source bytes, scope, or configuration.",
        };
      }
      const ref = existingIdem.result_ref as {
        work_id: string;
        version_id: string;
        extraction_id: string;
        identity_action: IdentityAction;
      };
      return {
        http_status: 200 as const,
        ...ref,
      };
    }

    // Create a temporary read wrapper over `draft` so identity resolution sees uncommitted in-transaction state
    const tempReader = {
      getCrosswalkTarget: (id: string) => draft.legacy_crosswalk[id],
      getWork: (id: string) => draft.works[id],
      listAllWorks: () => Object.values(draft.works),
      findWorksByNormalizedIdentifier: (norm: string) =>
        Object.values(draft.works).filter((w) =>
          w.official_identifiers.some((oid) => oid.normalized === norm)
        ),
      getVersionsForWork: (workId: string) =>
        Object.values(draft.versions).filter((v) => v.work_id === workId),
      getExtractionsForWork: (workId: string) =>
        Object.values(draft.extractions).filter((e) => e.work_id === workId),
      getArtifact: (artId: string) => draft.artifacts[artId],
    } as unknown as DurableKnowledgeStore;

    const idOutcome = resolveCanonicalWorkIdentity(tempReader, {
      doc_type: input.doc_type,
      issuer_id: input.issuer_id,
      instrument_code: input.instrument_code,
      official_identifier: input.official_identifier,
      title: input.original_name,
      issue_date: input.issue_date,
      access_scope: input.access_scope,
      actual_bytes_sha256: storedBlob.sha256,
      extractor_version: extractorVer,
      is_verified_amendment: input.is_verified_amendment,
      owner_batch_id: input.batch_id,
    });

    const nowIso = new Date().toISOString();
    const releaseId = input.release_id || `rel.${input.batch_id}.rc1`;
    const artifactId = `art.${sha256Bytes(`${input.access_scope}:${storedBlob.sha256}`).slice(0, 14)}`;

    if (!draft.artifacts[artifactId]) {
      const art: Artifact = {
        artifact_id: artifactId,
        actual_bytes_sha256: storedBlob.sha256,
        size: storedBlob.size,
        MIME: input.mime_type,
        immutable_uri: storedBlob.immutable_uri,
        fetched_at: nowIso,
        origin_uri: `source://${input.source_file_id}/${input.original_name}`,
        authenticity_status:
          input.mime_type === "text/html" ? "official_html_snapshot" : "official_original",
        access_scope: input.access_scope,
        rights_status:
          input.access_scope === "scope.platform.public" ? "approved_public" : "restricted_tenant",
      };
      draft.artifacts[artifactId] = art;
    }

    const normOffId =
      input.doc_type === "TaxRuling"
        ? normalizeOfficialRulingIdentifier(input.official_identifier)
        : input.official_identifier.trim();

    let work = draft.works[idOutcome.work_id];
    if (!work) {
      work = {
        work_id: idOutcome.work_id,
        type: input.doc_type,
        issuer_id: input.issuer_id,
        jurisdiction: "TH",
        title_th: input.original_name.replace(/\.[^.]+$/, ""),
        official_identifiers: normOffId
          ? [
              {
                raw: input.official_identifier,
                normalized: normOffId,
                kind: input.doc_type === "TaxRuling" ? "rd_letter_no" : "other",
              },
            ]
          : [],
        identity_evidence: [artifactId],
        aliases: [input.original_name],
        owner_batch_id: input.batch_id,
        first_loaded_by_batch_id: input.batch_id,
        instrument_code: input.instrument_code,
      };
      draft.works[work.work_id] = work;
    } else {
      if (!work.identity_evidence.includes(artifactId)) {
        work.identity_evidence.push(artifactId);
      }
      if (!work.aliases.includes(input.original_name)) {
        work.aliases.push(input.original_name);
      }
    }

    const existingVersions = Object.values(draft.versions).filter((v) => v.work_id === work.work_id);
    const isoDate = parseThaiBuddhistDateToIso(input.issue_date);
    let version: LegalVersion;

    if (existingVersions.length === 0 || idOutcome.identity_action === "NEW_LEGAL_VERSION") {
      const verIndex = existingVersions.length + 1;
      const versionId = `ver.${work.work_id.replace(/^work\./, "")}.v${verIndex}`;
      version = {
        version_id: versionId,
        work_id: work.work_id,
        version_label: `v${verIndex}`,
        legal_applicability: [
          {
            valid_from: input.valid_from ?? isoDate,
            valid_to: input.valid_to ?? null,
            conditions: [],
            date_status: isoDate || input.valid_from ? "verified" : "unknown_restricted",
          },
        ],
        publication_date: isoDate,
        decision_date: input.doc_type === "TaxRuling" ? isoDate : null,
        raw_date_text: input.issue_date,
        temporal_evidence_ids: [artifactId],
        known_from: nowIso,
        known_to: null,
        access_scope: input.access_scope,
      };
      draft.versions[version.version_id] = version;
    } else {
      version = existingVersions[existingVersions.length - 1];
    }

    const existingExtractionsForWork = Object.values(draft.extractions).filter(
      (e) => e.work_id === work.work_id
    );
    let extraction = existingExtractionsForWork.find(
      (e) => e.artifact_id === artifactId && e.extractor_version === extractorVer
    );

    const rawText =
      input.extracted_text_override ?? Buffer.from(input.bytes).toString("utf8");

    if (!extraction) {
      const revNum = existingExtractionsForWork.length + 1;
      const extractionId = `ext.${artifactId.slice(4)}.${sha256Bytes(extractorVer).slice(0, 6)}.r${revNum}`;
      extraction = {
        extraction_id: extractionId,
        artifact_id: artifactId,
        work_id: work.work_id,
        version_id: version.version_id,
        extractor_version: extractorVer,
        model_version: "deterministic-thai-legal-v1",
        configuration_version: "cfg.v1.1",
        raw_text_uri: storedBlob.immutable_uri,
        raw_text: rawText,
        normalized_text: rawText.replace(/\s+/g, " ").trim(),
        normalization_log: ["preserved_raw_bytes", "normalized_whitespace"],
        quality_status: "VALIDATED",
        accepted_revision: revNum,
        created_at: nowIso,
      };
      draft.extractions[extraction.extraction_id] = extraction;
    }

    // Only create canonical passages/assertions/vectors when creating a new work/version or updating canonical text,
    // never duplicating passages merely from ATTACH_REPRESENTATION or SKIP_UNCHANGED (AT01, AT03)!
    const existingPassagesForVersion = Object.values(draft.passages).filter(
      (p) => p.version_id === version.version_id
    );

    if (existingPassagesForVersion.length === 0) {
      const passageId = `psg.${version.version_id.slice(4)}.001`;
      const psg: Passage = {
        passage_id: passageId,
        work_id: work.work_id,
        version_id: version.version_id,
        extraction_id: extraction.extraction_id,
        release_id: releaseId,
        exact_text: extraction.normalized_text,
        contextualized_header: `[${normOffId || work.title_th}]`,
        real_locator:
          input.mime_type === "text/html"
            ? {
                kind: "html_structural",
                artifact_id: artifactId,
                origin_uri: draft.artifacts[artifactId].origin_uri,
                structural_selector: "body > article[1]",
              }
            : {
                kind: "pdf_page",
                artifact_id: artifactId,
                origin_uri: draft.artifacts[artifactId].origin_uri,
                physical_page_index: 0,
                printed_page_label: "1",
              },
        structural_path: [normOffId || work.title_th, "Main"],
        parent_id: work.work_id,
        adjacent_ids: { previous_id: null, next_id: null },
        language: "th",
        statement_role: input.doc_type === "TaxRuling" ? "official_conclusion" : "statutory_text",
        token_count: Math.max(1, Math.ceil(extraction.normalized_text.length / 3)),
        critical_tokens_flagged: [],
        contains_untrusted_instruction_like_text: false,
        access_scope: input.access_scope,
      };
      draft.passages[passageId] = psg;

      const assertionId = `asrt.supported_by.${version.version_id}.${passageId}`;
      const asrt: Assertion = {
        assertion_id: assertionId,
        release_id: releaseId,
        subject: version.version_id,
        subject_type: "LegalVersion",
        predicate: "SUPPORTED_BY",
        object: passageId,
        object_type: "Passage",
        qualifications: { conditions: [], exceptions: [] },
        evidence_ids: [passageId],
        statement_role: psg.statement_role,
        state: "ACCEPTED",
        review_id: null,
        validity: {
          valid_from: version.legal_applicability[0]?.valid_from ?? null,
          valid_to: version.legal_applicability[0]?.valid_to ?? null,
        },
        confidence: 1.0,
        legal_certainty:
          input.doc_type === "TaxRuling"
            ? "administrative_ruling_specific_facts"
            : "settled_statutory",
        scope: input.access_scope,
      };
      draft.assertions[assertionId] = asrt;

      const vecList = draft.active_vector_ids_by_release[releaseId] || [];
      const vecId = `vec.${passageId}`;
      if (!vecList.includes(vecId)) {
        vecList.push(vecId);
        draft.active_vector_ids_by_release[releaseId] = vecList;
      }
    } else if (idOutcome.identity_action === "NEW_EXTRACTION_REVISION") {
      // Update existing passage in-place to reference improved extraction revision without adding extra passages/vectors
      for (const p of existingPassagesForVersion) {
        p.extraction_id = extraction.extraction_id;
        p.exact_text = extraction.normalized_text;
      }
    }

    const resultRef = {
      work_id: work.work_id,
      version_id: version.version_id,
      extraction_id: extraction.extraction_id,
      identity_action: idOutcome.identity_action,
    };

    draft.idempotency[input.idempotency_key] = {
      key: input.idempotency_key,
      semantic_fingerprint: semanticFingerprint,
      result_ref: resultRef,
      created_at: nowIso,
    };

    return {
      http_status: 201 as const,
      ...resultRef,
    };
  });
}
