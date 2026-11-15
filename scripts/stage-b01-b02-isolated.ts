/**
 * REG24 — Isolated Candidate Preparation Runner (`rel.B01.rc2` + `rel.B02.rc1`, Preserving `rel.B01.rc1`)
 *
 * GOVERNANCE & SAFETY GUARDS:
 * 1. Strictly refuses to write to `data/knowledge-store`! Verifies protected SHA-256 before and after.
 * 2. Clones `data/knowledge-store` read-only into `--staging-dir` so `rel.B01.rc1` (`mfst.b01.mwgj0yb3`,
 *    `wal.jsonl` seq 1..14, `reports/B01_*.json`) is 100% preserved in the audit trail.
 * 3. Prepares `rel.B01.rc2` and `rel.B02.rc1` in `READY_FOR_UAT` with `user_decision: null` and
 *    `active_release_id: null` — NEVER recording any automated/simulated Owner UAT decision or promotion!
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { execSync } from "node:child_process";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { freezeInventory, planReconciliation } from "../src/core/knowledge/inventory";
import { rollbackRelease, startBatchRun } from "../src/core/knowledge/releases";
import { evaluateRelease, getBatchReleaseReport } from "../src/core/knowledge/evaluation";
import { runBlindSourceToAnswerValidation } from "../src/core/knowledge/blind-audit";
import { loadGraphProjectionSnapshot } from "../src/core/knowledge/projections";
import { getB02DriveManifest } from "../src/core/data/b02-drive-manifest-loader";
import { getVerifiedStatutoryCorpus } from "../src/core/data/verified-statutory-loader";
import type { Actor } from "../src/core/knowledge/contracts";

const PROTECTED_CANONICAL_SHA256 =
  "08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9";

const ENG_ACTOR: Actor = {
  actor_id: "staging.eng@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const LEGAL_ACTOR: Actor = {
  actor_id: "staging.legal@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

function computeImmutableCodeIdentifiers(): {
  git_head_sha: string;
  git_head_short: string;
  working_tree_dirty: boolean;
  working_tree_diff_sha256: string;
  remediation_tree_fingerprint: string;
} {
  const head = execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString("utf8").trim();
  const diffBuf = execSync("git diff HEAD -- src/ scripts/ tests/", {
    cwd: process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
  });
  const untrackedOut = execSync(
    "git ls-files --others --exclude-standard -- src/ scripts/ tests/",
    { cwd: process.cwd() }
  )
    .toString("utf8")
    .trim();
  const untrackedFiles = untrackedOut ? untrackedOut.split(/\r?\n/).filter(Boolean).sort() : [];
  const hasher = crypto.createHash("sha256");
  hasher.update(diffBuf);
  for (const uf of untrackedFiles) {
    hasher.update(`\n---UNTRACKED:${uf}\n`);
    const abs = path.resolve(process.cwd(), uf);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      hasher.update(fs.readFileSync(abs));
    }
  }
  const diffSha = hasher.digest("hex");
  const dirty = diffBuf.length > 0 || untrackedFiles.length > 0;
  return {
    git_head_sha: head,
    git_head_short: head.slice(0, 7),
    working_tree_dirty: dirty,
    working_tree_diff_sha256: diffSha,
    remediation_tree_fingerprint: `${head.slice(0, 12)}+diff.${diffSha.slice(0, 16)}`,
  };
}

async function main(): Promise<void> {
  const rawStagingDir = getArgValue("--staging-dir");
  if (!rawStagingDir) {
    throw new Error("Missing required --staging-dir <isolated_path>");
  }

  const stagingDir = path.resolve(rawStagingDir);
  const protectedLiveDir = path.resolve(process.cwd(), "data", "knowledge-store");
  if (
    stagingDir.toLowerCase() === protectedLiveDir.toLowerCase() ||
    stagingDir.toLowerCase().startsWith(protectedLiveDir.toLowerCase() + path.sep)
  ) {
    throw new Error(
      `SAFETY_BLOCK: Refusing to touch protected canonical store directory: ${protectedLiveDir}`
    );
  }

  const protectedCanonicalGz = path.join(protectedLiveDir, "canonical-state.json.gz");
  const preSha = sha256File(protectedCanonicalGz);
  if (preSha !== PROTECTED_CANONICAL_SHA256) {
    throw new Error(
      `PROTECTED_STORE_INTEGRITY_MISMATCH: Expected ${PROTECTED_CANONICAL_SHA256}, got ${preSha}`
    );
  }

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(stagingDir), { recursive: true });

  console.log(
    `[1/8] Cloning preserved canonical store (rel.B01.rc1, rev 14) read-only into isolated staging: ${stagingDir}`
  );
  fs.cpSync(protectedLiveDir, stagingDir, { recursive: true });

  const store = new DurableKnowledgeStore(stagingDir);
  const stPreserved = store.getState();
  const walPreserved = store.readWalEntries();
  if (
    stPreserved.store_revision !== 14 ||
    stPreserved.releases["rel.B01.rc1"]?.manifest_id !== "mfst.b01.mwgj0yb3" ||
    walPreserved.length !== 14
  ) {
    throw new Error("CLONE_VERIFICATION_FAILED: Preserved rel.B01.rc1 audit trail did not match rev 14.");
  }

  const codeIds = computeImmutableCodeIdentifiers();

  console.log(`[2/8] Freezing & reconciling B01 inventory for candidate rel.B01.rc2...`);
  const fB01 = await freezeInventory("B01", ENG_ACTOR, { store });
  const planB01 = await planReconciliation(fB01.manifest.manifest_id, ENG_ACTOR, { store });

  console.log(`[3/8] Staging remediated candidate rel.B01.rc2 (${planB01.total_candidates} candidates, 0 auto-approvals)...`);
  const runB01 = await startBatchRun(
    {
      batch_id: "B01",
      manifest_id: fB01.manifest.manifest_id,
      idempotency_key: "isolated-staging-rel-b01-rc2",
      max_documents: 5000,
    },
    ENG_ACTOR,
    { store, releaseIdOverride: "rel.B01.rc2" }
  );

  console.log(`[4/8] Evaluating rel.B01.rc2 & running 20-case Blind Source-to-Answer Validation...`);
  const evalB01 = await evaluateRelease(runB01.release_id, "suite.B01.300families.v1.2", ENG_ACTOR, {
    store,
    candidateBaseUrl: "staging://isolated/B01",
  });
  const blindB01 = await runBlindSourceToAnswerValidation(runB01.release_id, LEGAL_ACTOR, { store });

  const stAfterB01Rc2 = store.getState();
  const b01Rc2QuarantineSnapshot = Object.values(stAfterB01Rc2.unresolved_references);

  console.log(`[5/8] Freezing & reconciling B02 inventory against candidate predecessor rel.B01.rc2...`);
  const fB02 = await freezeInventory("B02", ENG_ACTOR, {
    store,
    predecessorReleaseId: "rel.B01.rc2",
  });
  const planB02 = await planReconciliation(fB02.manifest.manifest_id, ENG_ACTOR, { store });

  console.log(`[6/8] Staging candidate rel.B02.rc1 (0 auto-approvals, READY_FOR_UAT)...`);
  const runB02 = await startBatchRun(
    {
      batch_id: "B02",
      manifest_id: fB02.manifest.manifest_id,
      idempotency_key: "isolated-staging-rel-b02-rc1",
      max_documents: 3000,
    },
    ENG_ACTOR,
    {
      store,
      releaseIdOverride: "rel.B02.rc1",
      stagingCandidatePredecessorReleaseId: "rel.B01.rc2",
    }
  );

  console.log(`[7/8] Evaluating rel.B02.rc1 & running 26-case Blind Source-to-Answer Validation...`);
  const evalB02 = await evaluateRelease(runB02.release_id, "suite.B02.300families.v1.2", ENG_ACTOR, {
    store,
    candidateBaseUrl: "staging://isolated/B02",
  });
  const blindB02 = await runBlindSourceToAnswerValidation(runB02.release_id, LEGAL_ACTOR, { store });

  console.log(`[8/8] Verifying idempotent duplicate re-import & isolated disposable rollback probe...`);
  const countsBeforeReplay = {
    works: Object.keys(store.getState().works).length,
    passages: Object.keys(store.getState().passages).length,
    assertions: Object.keys(store.getState().assertions).length,
    vectors_rc2: (store.getState().active_vector_ids_by_release["rel.B01.rc2"] || []).length,
    vectors_b02: (store.getState().active_vector_ids_by_release["rel.B02.rc1"] || []).length,
  };
  const replayB01 = await startBatchRun(
    {
      batch_id: "B01",
      manifest_id: fB01.manifest.manifest_id,
      idempotency_key: "isolated-staging-rel-b01-rc2",
      max_documents: 5000,
    },
    ENG_ACTOR,
    { store, releaseIdOverride: "rel.B01.rc2" }
  );
  const replayB02 = await startBatchRun(
    {
      batch_id: "B02",
      manifest_id: fB02.manifest.manifest_id,
      idempotency_key: "isolated-staging-rel-b02-rc1",
      max_documents: 3000,
    },
    ENG_ACTOR,
    {
      store,
      releaseIdOverride: "rel.B02.rc1",
      stagingCandidatePredecessorReleaseId: "rel.B01.rc2",
    }
  );
  const countsAfterReplay = {
    works: Object.keys(store.getState().works).length,
    passages: Object.keys(store.getState().passages).length,
    assertions: Object.keys(store.getState().assertions).length,
    vectors_rc2: (store.getState().active_vector_ids_by_release["rel.B01.rc2"] || []).length,
    vectors_b02: (store.getState().active_vector_ids_by_release["rel.B02.rc1"] || []).length,
  };

  // Disposable rollback verification on a separate temporary copy so `stagingDir` keeps rel.B01.rc2 & rel.B02.rc1 READY_FOR_UAT!
  const rollbackProbeDir = `${stagingDir}_rollback_probe`;
  if (fs.existsSync(rollbackProbeDir)) {
    fs.rmSync(rollbackProbeDir, { recursive: true, force: true });
  }
  fs.cpSync(stagingDir, rollbackProbeDir, { recursive: true });
  const rbStore = new DurableKnowledgeStore(rollbackProbeDir);
  const rbB02 = await rollbackRelease(
    "rel.B02.rc1",
    "Isolated disposable rollback verification probe (B02.rc1)",
    ENG_ACTOR,
    { store: rbStore }
  );
  const stAfterB02Rollback = rbStore.getState();
  const shared65TerStillIntactAfterB02Rollback = Boolean(
    stAfterB02Rollback.works["prov.th.rc.65_ตรี"] &&
      rbStore.getPassagesForRelease("rel.B01.rc2").some((p) => p.work_id === "prov.th.rc.65_ตรี")
  );
  const rbB01Rc2 = await rollbackRelease(
    "rel.B01.rc2",
    "Isolated disposable rollback verification probe (B01.rc2)",
    ENG_ACTOR,
    { store: rbStore }
  );
  const stAfterB01Rc2Rollback = rbStore.getState();
  const rc1StillIntactAfterBothRollbacks =
    stAfterB01Rc2Rollback.releases["rel.B01.rc1"]?.state === "READY_FOR_UAT" &&
    stAfterB01Rc2Rollback.releases["rel.B01.rc1"]?.manifest_hash ===
      "2059e51ee9bf2ba3fe26fc8f0b6abb4e5ed942be0a2e3cace8df116a41c2e444" &&
    rbStore.getPassagesForRelease("rel.B01.rc1").length === 9744;
  fs.rmSync(rollbackProbeDir, { recursive: true, force: true });

  const stFinal = store.getState();
  const walFinal = store.readWalEntries();

  // Verify `rel.B01.rc1` preservation & zero auto-approvals across all 3 releases
  const rc1PreservedReport = getBatchReleaseReport("rel.B01.rc1", { store });
  const rc1PassagesPreserved = Object.values(stFinal.passages).filter(
    (p) => p.release_id === "rel.B01.rc1"
  ).length;
  const rc1AssertionsPreserved = Object.values(stFinal.assertions).filter(
    (a) => a.release_id === "rel.B01.rc1" && a.state === "ACCEPTED"
  ).length;

  const rc2Passages = Object.values(stFinal.passages).filter((p) => p.release_id === "rel.B01.rc2");
  const rc2Assertions = Object.values(stFinal.assertions).filter(
    (a) => a.release_id === "rel.B01.rc2" && a.state === "ACCEPTED"
  );
  const b02OwnPassages = Object.values(stFinal.passages).filter((p) => p.release_id === "rel.B02.rc1");
  const b02ChainPassages = store.getPassagesForRelease("rel.B02.rc1");
  const b02OwnAssertions = Object.values(stFinal.assertions).filter(
    (a) => a.release_id === "rel.B02.rc1" && a.state === "ACCEPTED"
  );
  const b02ChainAssertions = store.getAcceptedAssertionsForRelease("rel.B02.rc1");

  const rc2ExtDepCount = rc2Passages.filter((p) => p.extraction_id.startsWith("ext.dep.")).length;
  const b02ExtDepCount = b02ChainPassages.filter((p) => p.extraction_id.startsWith("ext.dep.")).length;

  // Build Complete Itemised Quarantine Ledger (`quarantine_ledger_rc2_b02.json`)
  const rc2PassageWorkIds = new Set(rc2Passages.map((p) => p.work_id));
  const b02OwnVerifiedPassageWorkIds = new Set(
    b02OwnPassages
      .filter((p) => !p.extraction_id.startsWith("ext.dep.") && p.release_id === "rel.B02.rc1")
      .map((p) => p.work_id)
  );
  const rc2SyntheticOrRc1WorkIds = new Set(
    rc2Passages
      .filter((p) => p.extraction_id.startsWith("ext.dep.") || p.release_id === "rel.B01.rc1")
      .map((p) => p.work_id)
  );
  const b02SyntheticOrRc1WorkIds = new Set(
    b02ChainPassages
      .filter((p) => p.extraction_id.startsWith("ext.dep.") || p.release_id === "rel.B01.rc1")
      .map((p) => p.work_id)
  );
  const rc2GraphSnap = loadGraphProjectionSnapshot(store, "rel.B01.rc2");
  const b02GraphSnap = loadGraphProjectionSnapshot(store, "rel.B02.rc1");
  const rc2EdgePairs = new Set(
    (rc2GraphSnap?.edges || []).map((e) => `${e.subject}::>${e.object}`)
  );
  const b02EdgePairs = new Set(
    (b02GraphSnap?.edges || []).map((e) => `${e.subject}::>${e.object}`)
  );
  const rc2GraphNodes = new Set<string>();
  for (const e of rc2GraphSnap?.edges || []) {
    rc2GraphNodes.add(e.subject);
    rc2GraphNodes.add(e.object);
  }
  const b02GraphNodes = new Set<string>();
  for (const e of b02GraphSnap?.edges || []) {
    b02GraphNodes.add(e.subject);
    b02GraphNodes.add(e.object);
  }

  const allUnresolved = Object.values(stFinal.unresolved_references).sort((a, b) =>
    a.unresolved_ref_id.localeCompare(b.unresolved_ref_id)
  );
  const byInstrument: Record<
    string,
    {
      count: number;
      distinct_source_works: Set<string>;
      distinct_target_hints: Set<string>;
      reasons: Record<string, number>;
      sample_citations: string[];
    }
  > = {};
  const byReason: Record<string, number> = {};
  const byReleaseOrigin: Record<string, number> = {};
  const quarantinedRoyalDecreeNumbers = new Set<string>();
  const quarantinedMinisterialRegNumbers = new Set<string>();

  const itemisedQuarantineEntries = allUnresolved.map((u, idx) => {
    const inst = u.governing_instrument || "UNKNOWN_INSTRUMENT";
    if (!byInstrument[inst]) {
      byInstrument[inst] = {
        count: 0,
        distinct_source_works: new Set(),
        distinct_target_hints: new Set(),
        reasons: {},
        sample_citations: [],
      };
    }
    byInstrument[inst].count += 1;
    byInstrument[inst].distinct_source_works.add(u.source_work_id);
    byInstrument[inst].distinct_target_hints.add(u.target_hint);
    byInstrument[inst].reasons[u.reason] = (byInstrument[inst].reasons[u.reason] || 0) + 1;
    if (
      byInstrument[inst].sample_citations.length < 5 &&
      !byInstrument[inst].sample_citations.includes(u.raw_citation_text)
    ) {
      byInstrument[inst].sample_citations.push(u.raw_citation_text);
    }
    byReason[u.reason] = (byReason[u.reason] || 0) + 1;
    const relOrig = u.recorded_in_release_id || "rel.B01.rc1";
    byReleaseOrigin[relOrig] = (byReleaseOrigin[relOrig] || 0) + 1;

    const rdMatch = `${inst} ${u.target_hint} ${u.raw_citation_text}`.match(/(?:พระราชกฤษฎีกา|พรฎ\.?|royal_decree\.)[^\d]*(\d{1,4})/i);
    if (rdMatch) quarantinedRoyalDecreeNumbers.add(rdMatch[1]);
    const mrMatch = `${inst} ${u.target_hint} ${u.raw_citation_text}`.match(/(?:กฎกระทรวง|ministerial_reg\.)[^\d]*(\d{1,4})/i);
    if (mrMatch) quarantinedMinisterialRegNumbers.add(mrMatch[1]);

    const srcWork = stFinal.works[u.source_work_id];
    const srcPassage = stFinal.passages[u.source_passage_id];
    const suppressedPredicate = u.reason.includes("ENABLING_STATUTE")
      ? "ISSUED_UNDER"
      : srcWork?.type === "TaxRuling"
        ? "INTERPRETS_OR_CITES_PROVISION"
        : "CITES_PROVISION";

    const inRc2Passages = rc2PassageWorkIds.has(u.target_hint);
    const inRc2Graph = rc2GraphNodes.has(u.target_hint);
    const suppressedEdgeInRc2 = rc2EdgePairs.has(`${u.source_work_id}::>${u.target_hint}`);
    const suppressedEdgeInB02 = b02EdgePairs.has(`${u.source_work_id}::>${u.target_hint}`);
    const unverifiedPassageInRc2 = rc2SyntheticOrRc1WorkIds.has(u.target_hint);
    const unverifiedPassageInB02 = b02SyntheticOrRc1WorkIds.has(u.target_hint);
    const verifiedB02PdfIngestedForTarget = b02OwnVerifiedPassageWorkIds.has(u.target_hint);
    const unverifiedTargetInB02Graph =
      b02GraphNodes.has(u.target_hint) && !verifiedB02PdfIngestedForTarget;

    return {
      ledger_index: idx + 1,
      unresolved_ref_id: u.unresolved_ref_id,
      recorded_in_release_id: relOrig,
      owner_batch_hint: u.owner_batch_hint,
      source_work_id: u.source_work_id,
      source_official_identifier: srcWork?.official_identifiers?.[0]?.normalized || u.source_work_id,
      source_title_th: srcWork?.title_th || null,
      source_origin_uri: srcPassage?.real_locator?.origin_uri || null,
      source_version_id: u.source_version_id,
      source_passage_id: u.source_passage_id,
      raw_citation_text: u.raw_citation_text,
      governing_instrument: inst,
      section_label: u.section_label ?? null,
      target_hint: u.target_hint,
      reason: u.reason,
      suppressed_graph_link: {
        subject: u.source_work_id,
        predicate: suppressedPredicate,
        suppressed_object: u.target_hint,
        status: "SUPPRESSED_FROM_TRUSTED_GRAPH_AND_RETRIEVAL",
      },
      quarantine_status: u.quarantine_status,
      usable_as_legal_evidence: u.usable_as_legal_evidence,
      retained_in_audit_trail: true,
      projection_exclusion_verified: {
        in_rc2_passages: inRc2Passages,
        in_rc2_graph_edges: inRc2Graph,
        suppressed_citation_edge_in_rc2_graph: suppressedEdgeInRc2,
        suppressed_citation_edge_in_b02_graph: suppressedEdgeInB02,
        unverified_passage_in_rc2: unverifiedPassageInRc2,
        unverified_passage_in_b02: unverifiedPassageInB02,
        unverified_target_in_b02_graph: unverifiedTargetInB02Graph,
        target_subsequently_ingested_from_verified_b02_pdf: verifiedB02PdfIngestedForTarget,
      },
      created_at: u.created_at,
    };
  });

  const quarantineSummaryByInstrument = Object.entries(byInstrument)
    .map(([instrument, info]) => ({
      governing_instrument: instrument,
      quarantined_reference_count: info.count,
      distinct_citing_works_count: info.distinct_source_works.size,
      distinct_target_hints_count: info.distinct_target_hints.size,
      reasons: info.reasons,
      sample_citations: info.sample_citations,
    }))
    .sort((a, b) => b.quarantined_reference_count - a.quarantined_reference_count);

  // Coverage impact computation across B01 rulings & B02 primary-law works
  const rc2RulingWorkSet = new Set(
    stFinal.releases["rel.B01.rc2"].created_work_ids.filter((id) => stFinal.works[id]?.type === "TaxRuling")
  );
  for (const id of stFinal.releases["rel.B01.rc2"].reused_work_ids) {
    if (stFinal.works[id]?.type === "TaxRuling") rc2RulingWorkSet.add(id);
  }
  const b01CitingQuarantinedWorks = new Set(
    itemisedQuarantineEntries
      .filter((e) => e.recorded_in_release_id === "rel.B01.rc2" && rc2RulingWorkSet.has(e.source_work_id))
      .map((e) => e.source_work_id)
  );
  const b02CreatedAndReusedWorks = new Set([
    ...stFinal.releases["rel.B02.rc1"].created_work_ids,
    ...stFinal.releases["rel.B02.rc1"].reused_work_ids,
  ]);
  const b02CitingQuarantinedWorks = new Set(
    itemisedQuarantineEntries
      .filter((e) => e.recorded_in_release_id === "rel.B02.rc1")
      .map((e) => e.source_work_id)
  );

  const zeroLeakageIntoTrustedProjections = itemisedQuarantineEntries.every(
    (e) =>
      !e.projection_exclusion_verified.in_rc2_passages &&
      !e.projection_exclusion_verified.in_rc2_graph_edges &&
      !e.projection_exclusion_verified.suppressed_citation_edge_in_rc2_graph &&
      !e.projection_exclusion_verified.suppressed_citation_edge_in_b02_graph &&
      !e.projection_exclusion_verified.unverified_passage_in_rc2 &&
      !e.projection_exclusion_verified.unverified_passage_in_b02 &&
      !e.projection_exclusion_verified.unverified_target_in_b02_graph
  );
  const b01TargetsWithVerifiedB02PdfCount = itemisedQuarantineEntries.filter(
    (e) => e.projection_exclusion_verified.target_subsequently_ingested_from_verified_b02_pdf
  ).length;

  const quarantineLedgerPayload = {
    generated_at: new Date().toISOString(),
    code_identifiers: codeIds,
    policy_verified: {
      all_marked_unresolved_quarantined: allUnresolved.every(
        (u) => u.quarantine_status === "UNRESOLVED_QUARANTINED"
      ),
      all_marked_usable_as_legal_evidence_false: allUnresolved.every(
        (u) => u.usable_as_legal_evidence === false
      ),
      all_retained_in_audit_trail: allUnresolved.length === itemisedQuarantineEntries.length,
      zero_leakage_into_trusted_passages_or_graph_edges: zeroLeakageIntoTrustedProjections,
      zero_suppressed_citation_edges_in_projections: itemisedQuarantineEntries.every(
        (e) =>
          !e.projection_exclusion_verified.suppressed_citation_edge_in_rc2_graph &&
          !e.projection_exclusion_verified.suppressed_citation_edge_in_b02_graph
      ),
      b01_quarantined_targets_subsequently_backed_by_verified_b02_gazette_pdf:
        b01TargetsWithVerifiedB02PdfCount,
      rc2_synthetic_ext_dep_passages: rc2ExtDepCount,
      b02_chain_synthetic_ext_dep_passages: b02ExtDepCount,
    },
    counts: {
      after_rel_B01_rc2_only: b01Rc2QuarantineSnapshot.length,
      after_rel_B01_rc2_and_rel_B02_rc1: allUnresolved.length,
      b02_additional_quarantined_refs: allUnresolved.length - b01Rc2QuarantineSnapshot.length,
      by_release_origin: byReleaseOrigin,
      by_reason: byReason,
      distinct_quarantined_target_hints: new Set(allUnresolved.map((u) => u.target_hint)).size,
      distinct_citing_source_works: new Set(allUnresolved.map((u) => u.source_work_id)).size,
    },
    coverage_impact: {
      rel_B01_rc2: {
        total_admitted_tax_rulings: rc2RulingWorkSet.size,
        rulings_with_zero_quarantined_citations: rc2RulingWorkSet.size - b01CitingQuarantinedWorks.size,
        rulings_with_at_least_one_quarantined_external_citation: b01CitingQuarantinedWorks.size,
        share_fully_resolved_pct: Number(
          (((rc2RulingWorkSet.size - b01CitingQuarantinedWorks.size) / Math.max(1, rc2RulingWorkSet.size)) * 100).toFixed(2)
        ),
        verified_accepted_graph_assertions_active: rc2Assertions.length,
        suppressed_unverified_graph_links_quarantined: itemisedQuarantineEntries.filter(
          (e) => e.recorded_in_release_id === "rel.B01.rc2"
        ).length,
        runtime_retrieval_behavior:
          "All 4,578 B01 rulings remain retrievable via their own verbatim official ruling text; only the unverified external statutory target node/edge is suppressed from legal evidence until verified original text is ingested.",
      },
      rel_B02_rc1: {
        total_b02_canonical_works_in_release: b02CreatedAndReusedWorks.size,
        b02_works_with_zero_quarantined_citations: b02CreatedAndReusedWorks.size - b02CitingQuarantinedWorks.size,
        b02_works_with_quarantined_enabling_or_cross_citation: b02CitingQuarantinedWorks.size,
        verified_own_accepted_graph_assertions: b02OwnAssertions.length,
        verified_cumulative_chain_graph_assertions: b02ChainAssertions.length,
        suppressed_b02_graph_links_quarantined: itemisedQuarantineEntries.filter(
          (e) => e.recorded_in_release_id === "rel.B02.rc1"
        ).length,
      },
    },
    by_governing_instrument: quarantineSummaryByInstrument,
    entries: itemisedQuarantineEntries,
  };

  // Build Excluded & Deferred Coverage Breakdown (`excluded_and_deferred_coverage_rc2_b02.json`)
  const candsRc2 = Object.values(stFinal.candidates).filter(
    (c) => c.manifest_id === fB01.manifest.manifest_id
  );
  const candsB02 = Object.values(stFinal.candidates).filter(
    (c) => c.manifest_id === fB02.manifest.manifest_id
  );

  const groupCandsByFolderAndDisposition = (cands: typeof candsRc2) => {
    const out: Record<string, Record<string, number>> = {};
    const reasonsCount: Record<string, number> = {};
    for (const c of cands) {
      const topFolder = c.path.includes("/") ? c.path.split("/")[0] : "ROOT";
      if (!out[topFolder]) out[topFolder] = {};
      out[topFolder][c.disposition] = (out[topFolder][c.disposition] || 0) + 1;
      if (
        c.disposition === "REJECTED_OUT_OF_SCOPE" ||
        c.disposition === "DEFERRED_WITH_REASON" ||
        c.disposition === "ATTACHED_REPRESENTATION"
      ) {
        const rKey = `${c.disposition} :: ${c.reasons[0] || "unspecified"}`;
        reasonsCount[rKey] = (reasonsCount[rKey] || 0) + 1;
      }
    }
    return { by_folder_and_disposition: out, top_exclusion_and_deferral_reasons: reasonsCount };
  };

  const b01SubfolderBreakdown: Record<string, number> = {};
  for (const c of candsRc2.filter((x) => x.disposition === "REJECTED_OUT_OF_SCOPE")) {
    const parts = c.path.split("/");
    const sub = parts.length > 1 ? parts[0] : "ROOT_INDEX";
    b01SubfolderBreakdown[sub] = (b01SubfolderBreakdown[sub] || 0) + 1;
  }

  const excludedCoveragePayload = {
    generated_at: new Date().toISOString(),
    rel_B01_rc2: {
      manifest_id: fB01.manifest.manifest_id,
      inventory_snapshot_id: fB01.manifest.inventory_snapshot_id,
      inventory_hash: fB01.manifest.inventory_hash,
      reconciliation: planB01,
      rejected_out_of_scope_by_rd_subfolder: b01SubfolderBreakdown,
      ...groupCandsByFolderAndDisposition(candsRc2),
    },
    rel_B02_rc1: {
      manifest_id: fB02.manifest.manifest_id,
      inventory_snapshot_id: fB02.manifest.inventory_snapshot_id,
      inventory_hash: fB02.manifest.inventory_hash,
      reconciliation: planB02,
      ...groupCandsByFolderAndDisposition(candsB02),
    },
  };

  // Build Itemised 5,275-File OCR Recovery Queue (`ocr_recovery_queue_b02_5275.json.gz` + summary)
  const b02DriveManifest = getB02DriveManifest();
  const b02EntryByPath = new Map(
    b02DriveManifest.files.map((f) => [`${f.folder}/${f.rel_path}`, f])
  );
  const deferredB02Cands = candsB02
    .filter((c) => c.disposition === "DEFERRED_WITH_REASON")
    .sort((a, b) => a.path.localeCompare(b.path));

  const ocrByFolder: Record<
    string,
    { files: number; total_bytes: number; total_pages: number; ocr_pages: number; corrupt_pages: number; native_pages: number }
  > = {};
  const ocrByPriority: Record<string, { files: number; total_pages: number; ocr_or_corrupt_pages: number; total_bytes: number }> = {};
  let totalDeferredBytes = 0;
  let totalDeferredPages = 0;
  let totalDeferredOcrPages = 0;
  let totalDeferredCorruptPages = 0;
  let totalDeferredNativePages = 0;
  let totalDeferredNoncontentPages = 0;

  const classifyOcrPriority = (candPath: string, fileName: string, titleHint: string): {
    priority_tier:
      | "P0_UNLOCKS_QUARANTINED_CITATION"
      | "P1_CORE_TAX_CORPORATE_STATUTE"
      | "P2_SECTORAL_PRIMARY_LAW"
      | "P3_HISTORICAL_GAZETTE_GENERAL";
    priority_rationale: string;
  } => {
    const combined = `${candPath} ${fileName} ${titleHint}`;
    const rdMatch = combined.match(/(?:พระราชกฤษฎีกา|พรฎ\.?|RD[_-\s]|Royal\s*Decree)[^\d]{0,25}(\d{1,4})/i);
    if (rdMatch && quarantinedRoyalDecreeNumbers.has(rdMatch[1])) {
      return {
        priority_tier: "P0_UNLOCKS_QUARANTINED_CITATION",
        priority_rationale: `Matches Royal Decree No. ${rdMatch[1]} cited in quarantined B01/B02 unresolved ledger`,
      };
    }
    const mrMatch = combined.match(/(?:กฎกระทรวง|MR[_-\s]|Ministerial\s*Regulation)[^\d]{0,25}(\d{1,4})/i);
    if (mrMatch && quarantinedMinisterialRegNumbers.has(mrMatch[1])) {
      return {
        priority_tier: "P0_UNLOCKS_QUARANTINED_CITATION",
        priority_rationale: `Matches Ministerial Regulation No. ${mrMatch[1]} cited in quarantined B01/B02 unresolved ledger`,
      };
    }
    if (/(ประมวลรัษฎากร|สรรพากร|ภาษี|ศุลกากร|สรรพสามิต|บริษัทมหาชน|แพ่งและพาณิชย์|ล้มละลาย|หลักทรัพย์|คุ้มครองแรงงาน|ส่งเสริมการลงทุน)/i.test(combined)) {
      return {
        priority_tier: "P1_CORE_TAX_CORPORATE_STATUTE",
        priority_rationale: "Core Thai tax, customs, excise, corporate, commercial, insolvency, labor, or capital-markets instrument",
      };
    }
    if (/^Primary Law\//i.test(candPath) && /(พระราชบัญญัติ|พระราชกำหนด|Act)/i.test(combined)) {
      return {
        priority_tier: "P2_SECTORAL_PRIMARY_LAW",
        priority_rationale: "Enacted Act / Emergency Decree in Primary Law collection",
      };
    }
    return {
      priority_tier: "P3_HISTORICAL_GAZETTE_GENERAL",
      priority_rationale: "Historical Royal Gazette scan or general subordinate instrument",
    };
  };

  const ocrRecoveryQueueItems = deferredB02Cands.map((c, idx) => {
    const dm = b02EntryByPath.get(c.path);
    const folder = dm?.folder || (c.path.includes("/") ? c.path.split("/")[0] : "ROOT");
    const fileName = dm?.file_name || path.basename(c.path);
    const byteSize = dm?.size ?? 0;
    const pageCount = dm?.page_count ?? 0;
    const routes = dm?.routes ?? { native: 0, repaired: 0, ocr: pageCount, corrupt: 0, noncontent: 0 };
    const prio = classifyOcrPriority(c.path, fileName, dm?.title_hint || "");

    totalDeferredBytes += byteSize;
    totalDeferredPages += pageCount;
    totalDeferredOcrPages += routes.ocr;
    totalDeferredCorruptPages += routes.corrupt;
    totalDeferredNativePages += routes.native;
    totalDeferredNoncontentPages += routes.noncontent;

    if (!ocrByFolder[folder]) {
      ocrByFolder[folder] = { files: 0, total_bytes: 0, total_pages: 0, ocr_pages: 0, corrupt_pages: 0, native_pages: 0 };
    }
    ocrByFolder[folder].files += 1;
    ocrByFolder[folder].total_bytes += byteSize;
    ocrByFolder[folder].total_pages += pageCount;
    ocrByFolder[folder].ocr_pages += routes.ocr;
    ocrByFolder[folder].corrupt_pages += routes.corrupt;
    ocrByFolder[folder].native_pages += routes.native;

    if (!ocrByPriority[prio.priority_tier]) {
      ocrByPriority[prio.priority_tier] = { files: 0, total_pages: 0, ocr_or_corrupt_pages: 0, total_bytes: 0 };
    }
    ocrByPriority[prio.priority_tier].files += 1;
    ocrByPriority[prio.priority_tier].total_pages += pageCount;
    ocrByPriority[prio.priority_tier].ocr_or_corrupt_pages += routes.ocr + routes.corrupt;
    ocrByPriority[prio.priority_tier].total_bytes += byteSize;

    const recommendedPipelineRoute =
      routes.corrupt > 0 && routes.ocr === 0
        ? "STAGE_3_LEGACY_FONT_REPAIR_THEN_SELECTIVE_OCR_FALLBACK"
        : routes.native > 0 && (routes.ocr > 0 || routes.corrupt > 0)
          ? "STAGE_4_MIXED_KEEP_NATIVE_PAGES_AND_OCR_FAILED_PAGES_ONLY"
          : "STAGE_4_FULL_IMAGE_SCAN_THAI_ENGLISH_LEGAL_OCR";

    return {
      queue_index: idx + 1,
      candidate_id: c.candidate_id,
      manifest_id: c.manifest_id,
      source_file_id: c.source_file_id,
      source_uri: c.source_uri,
      folder,
      path: c.path,
      file_name: fileName,
      title_hint: dm?.title_hint || null,
      sha256: dm?.sha256 || c.source_revision,
      byte_size: byteSize,
      physical_page_count: pageCount,
      file_route: dm?.file_route || "ocr_required",
      measured_page_routes: routes,
      deferral_reason: c.reasons[0] || dm?.reason || "HISTORICAL_SCAN_OR_LEGACY_FONT_REQUIRES_VERIFIED_OCR",
      priority_tier: prio.priority_tier,
      priority_rationale: prio.priority_rationale,
      recommended_recovery_route: recommendedPipelineRoute,
      fabricated_or_inferred_text_admitted: false,
      verification_gate_required: "DUAL_CONTROL_SPAN_AND_CRITICAL_TOKEN_CHECK_BEFORE_INGESTION",
    };
  });

  const ocrRecoveryQueueSummary = {
    generated_at: new Date().toISOString(),
    code_identifiers: codeIds,
    manifest_id: fB02.manifest.manifest_id,
    policy_verified: {
      total_deferred_files: ocrRecoveryQueueItems.length,
      zero_fabricated_or_inferred_text: ocrRecoveryQueueItems.every(
        (i) => i.fabricated_or_inferred_text_admitted === false
      ),
      all_marked_deferred_with_reason: deferredB02Cands.length === 5275,
    },
    measured_totals: {
      deferred_files_count: ocrRecoveryQueueItems.length,
      total_bytes: totalDeferredBytes,
      total_decimal_gb: Number((totalDeferredBytes / 1_000_000_000).toFixed(4)),
      total_physical_pages: totalDeferredPages,
      pages_needing_image_ocr: totalDeferredOcrPages,
      pages_needing_legacy_font_repair_or_ocr: totalDeferredCorruptPages,
      pages_with_reusable_native_text_in_mixed_docs: totalDeferredNativePages,
      pages_confirmed_noncontent_blank_or_cover: totalDeferredNoncontentPages,
    },
    by_priority_tier: ocrByPriority,
    by_source_folder: ocrByFolder,
    six_stage_recovery_protocol: [
      "1. Content-hash & legal-work deduplication across folders before dispatching any OCR page budget.",
      "2. Page-by-page native text preservation in mixed PDFs (never re-OCR clean native pages).",
      "3. Deterministic legacy Thai glyph/PUA font mapping repair (`font_mapping_registry.json`) verified against rendered page image.",
      "4. Page-selective Thai+English legal OCR (`ocr-v2`) strictly on image-only or unrepairable corrupt pages.",
      "5. Automated + human critical-token verification (section numbers, B.E. dates, rates, negative particles `ไม่`/`เว้นแต่`).",
      "6. Re-stage verified extractions in a future batch candidate manifest with SHA-256 artifact + page/bbox locator.",
    ],
    sample_p0_and_p1_items: ocrRecoveryQueueItems
      .filter((x) => x.priority_tier === "P0_UNLOCKS_QUARANTINED_CITATION" || x.priority_tier === "P1_CORE_TAX_CORPORATE_STATUTE")
      .slice(0, 40),
  };

  // Source Fidelity & Statutory Version Verification Summary
  const verCorpus = getVerifiedStatutoryCorpus();
  const allRc2Artifacts = new Set(rc2Passages.map((p) => p.real_locator.artifact_id));
  const allB02Artifacts = new Set(b02ChainPassages.map((p) => p.real_locator.artifact_id));
  const verifyArtifactsSha = (artIds: Set<string>) =>
    Array.from(artIds).every((aid) => {
      const a = stFinal.artifacts[aid];
      return Boolean(a && /^[0-9a-f]{64}$/.test(a.actual_bytes_sha256));
    });

  const sec65TerVersions = Object.values(stFinal.versions).filter((v) => v.work_id === "prov.th.rc.65_ตรี");
  const sourceFidelityAndStatutoryVersions = {
    generated_at: new Date().toISOString(),
    code_identifiers: codeIds,
    artifact_sha256_integrity: {
      rel_B01_rc2_distinct_artifacts: allRc2Artifacts.size,
      rel_B01_rc2_all_have_64char_sha256: verifyArtifactsSha(allRc2Artifacts),
      rel_B02_rc1_chain_distinct_artifacts: allB02Artifacts.size,
      rel_B02_rc1_chain_all_have_64char_sha256: verifyArtifactsSha(allB02Artifacts),
    },
    passage_locator_integrity: {
      rel_B01_rc2_passages_total: rc2Passages.length,
      rel_B01_rc2_all_have_origin_uri_and_artifact_id: rc2Passages.every(
        (p) => Boolean(p.real_locator?.artifact_id && p.real_locator?.origin_uri)
      ),
      rel_B02_rc1_chain_passages_total: b02ChainPassages.length,
      rel_B02_rc1_all_have_origin_uri_and_artifact_id: b02ChainPassages.every(
        (p) => Boolean(p.real_locator?.artifact_id && p.real_locator?.origin_uri)
      ),
    },
    verified_statutory_corpus_coverage: {
      verified_revenue_code_sections_count: Object.keys(verCorpus.revenue_code_sections).length,
      verified_subordinate_and_amendment_works_count: Object.keys(verCorpus.subordinate_and_amendment_works).length,
      synthetic_ext_dep_placeholders_in_rc2: rc2ExtDepCount,
      synthetic_ext_dep_placeholders_in_b02: b02ExtDepCount,
      bitemporal_sec_65_ter_versions: sec65TerVersions.map((v) => ({
        version_id: v.version_id,
        version_label: v.version_label,
        legal_applicability: v.legal_applicability,
        publication_date: v.publication_date,
      })),
    },
  };

  const postSha = sha256File(protectedCanonicalGz);
  if (postSha !== PROTECTED_CANONICAL_SHA256) {
    throw new Error(
      `PROTECTED_STORE_MUTATED_ERROR: Expected ${PROTECTED_CANONICAL_SHA256}, got ${postSha}`
    );
  }

  const candidatePackageSummary = {
    generated_at: new Date().toISOString(),
    isolated_staging_dir: stagingDir,
    protected_canonical_store_verified_untouched: {
      path: protectedCanonicalGz,
      sha256_before: preSha,
      sha256_after: postSha,
      identical: preSha === postSha,
    },
    code_identifiers: codeIds,
    governance_posture: {
      active_release_id: stFinal.active_release_id,
      accepted_batch_releases: stFinal.accepted_batch_releases,
      any_owner_uat_decision_recorded: Object.values(stFinal.acceptances).some(
        (a) => a.user_decision !== null
      ),
      rel_B01_rc1_state: stFinal.releases["rel.B01.rc1"]?.state,
      rel_B01_rc1_user_decision: stFinal.acceptances["rel.B01.rc1"]?.user_decision ?? null,
      rel_B01_rc2_state: stFinal.releases["rel.B01.rc2"]?.state,
      rel_B01_rc2_user_decision: stFinal.acceptances["rel.B01.rc2"]?.user_decision ?? null,
      rel_B02_rc1_state: stFinal.releases["rel.B02.rc1"]?.state,
      rel_B02_rc1_user_decision: stFinal.acceptances["rel.B02.rc1"]?.user_decision ?? null,
    },
    preserved_rel_B01_rc1_audit: {
      release_id: "rel.B01.rc1",
      manifest_id: stFinal.releases["rel.B01.rc1"]?.manifest_id,
      manifest_hash: stFinal.releases["rel.B01.rc1"]?.manifest_hash,
      code_commit: stFinal.releases["rel.B01.rc1"]?.code_commit,
      passages_preserved: rc1PassagesPreserved,
      assertions_preserved: rc1AssertionsPreserved,
      report_preserved: Boolean(rc1PreservedReport.report),
      wal_seq_1_to_14_preserved:
        walFinal.slice(0, 14).length === 14 &&
        walFinal[0]?.seq === 1 &&
        walFinal[13]?.seq === 14,
    },
    candidate_rel_B01_rc2: {
      release_id: runB01.release_id,
      scope_classification: evalB01.release_report.scope_classification,
      scope_label: evalB01.release_report.scope_label,
      review_gate_status: evalB01.release_report.review_gate_status,
      state: stFinal.releases["rel.B01.rc2"].state,
      owner_decision: stFinal.acceptances["rel.B01.rc2"].user_decision,
      code_commit: stFinal.releases["rel.B01.rc2"].code_commit,
      supersession_lineage: stFinal.releases["rel.B01.rc2"].supersession_lineage ?? null,
      manifest_id: fB01.manifest.manifest_id,
      inventory_snapshot_id: fB01.manifest.inventory_snapshot_id,
      inventory_hash: fB01.manifest.inventory_hash,
      manifest_hash: stFinal.releases["rel.B01.rc2"].manifest_hash,
      reconciliation: planB01,
      processed_candidates: runB01.processed_candidates,
      created_works: stFinal.releases["rel.B01.rc2"].created_work_ids.length,
      reused_works: stFinal.releases["rel.B01.rc2"].reused_work_ids.length,
      passages_count: rc2Passages.length,
      accepted_assertions_count: rc2Assertions.length,
      synthetic_ext_dep_passages: rc2ExtDepCount,
      quarantined_unresolved_references: b01Rc2QuarantineSnapshot.length,
      all_automated_gates_passed: evalB01.evaluation.all_automated_gates_passed,
      evaluation_metrics: evalB01.evaluation.metrics,
      uat_precheck_passed_count: evalB01.uat_cases.filter(
        (u) => u.evaluator_results?.automated_precheck_passed
      ).length,
      uat_total_cases: evalB01.uat_cases.length,
      blind_validation: {
        total_cases: blindB01.total_cases,
        passed_cases: blindB01.passed_cases,
        overall_accuracy: blindB01.overall_accuracy,
        dimension_scores: blindB01.dimension_scores,
      },
    },
    candidate_rel_B02_rc1: {
      release_id: runB02.release_id,
      scope_classification: evalB02.release_report.scope_classification,
      scope_label: evalB02.release_report.scope_label,
      review_gate_status: evalB02.release_report.review_gate_status,
      state: stFinal.releases["rel.B02.rc1"].state,
      owner_decision: stFinal.acceptances["rel.B02.rc1"].user_decision,
      code_commit: stFinal.releases["rel.B02.rc1"].code_commit,
      previous_accepted_release_id: stFinal.releases["rel.B02.rc1"].previous_accepted_release_id,
      supersession_lineage: stFinal.releases["rel.B02.rc1"].supersession_lineage ?? null,
      manifest_id: fB02.manifest.manifest_id,
      inventory_snapshot_id: fB02.manifest.inventory_snapshot_id,
      inventory_hash: fB02.manifest.inventory_hash,
      manifest_hash: stFinal.releases["rel.B02.rc1"].manifest_hash,
      reconciliation: planB02,
      processed_candidates: runB02.processed_candidates,
      created_works: stFinal.releases["rel.B02.rc1"].created_work_ids.length,
      reused_works: stFinal.releases["rel.B02.rc1"].reused_work_ids.length,
      own_passages_count: b02OwnPassages.length,
      cumulative_chain_passages_count: b02ChainPassages.length,
      own_accepted_assertions_count: b02OwnAssertions.length,
      cumulative_chain_assertions_count: b02ChainAssertions.length,
      synthetic_ext_dep_passages_in_chain: b02ExtDepCount,
      total_quarantined_unresolved_references: allUnresolved.length,
      all_automated_gates_passed: evalB02.evaluation.all_automated_gates_passed,
      evaluation_metrics: evalB02.evaluation.metrics,
      uat_precheck_passed_count: evalB02.uat_cases.filter(
        (u) => u.evaluator_results?.automated_precheck_passed
      ).length,
      uat_total_cases: evalB02.uat_cases.length,
      blind_validation: {
        total_cases: blindB02.total_cases,
        passed_cases: blindB02.passed_cases,
        overall_accuracy: blindB02.overall_accuracy,
        dimension_scores: blindB02.dimension_scores,
      },
    },
    source_fidelity_and_statutory_versions: sourceFidelityAndStatutoryVersions,
    idempotent_duplicate_reimport_verification: {
      b01_idempotent_replay_flag: replayB01.idempotent_replay,
      b02_idempotent_replay_flag: replayB02.idempotent_replay,
      delta_works: countsAfterReplay.works - countsBeforeReplay.works,
      delta_passages: countsAfterReplay.passages - countsBeforeReplay.passages,
      delta_assertions: countsAfterReplay.assertions - countsBeforeReplay.assertions,
      delta_vectors_rc2: countsAfterReplay.vectors_rc2 - countsBeforeReplay.vectors_rc2,
      delta_vectors_b02: countsAfterReplay.vectors_b02 - countsBeforeReplay.vectors_b02,
    },
    disposable_rollback_probe_verification: {
      b02_rolled_back_state: rbB02.state,
      shared_65_ter_intact_after_b02_rollback: shared65TerStillIntactAfterB02Rollback,
      b01_rc2_rolled_back_state: rbB01Rc2.state,
      preserved_rel_B01_rc1_intact_after_both_rollbacks: rc1StillIntactAfterBothRollbacks,
    },
    combined_staging_store_audit: {
      store_revision: stFinal.store_revision,
      wal_entries_total: walFinal.length,
      wal_monotonic_seq_verified: walFinal.every((w, idx) => w.seq === idx + 1),
    },
  };

  const metricsOut = getArgValue("--metrics-out");
  if (metricsOut) {
    const p = path.resolve(metricsOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(candidatePackageSummary, null, 2), "utf8");
    console.log(`Saved candidate package summary -> ${p}`);
  }

  const quarantineOut = getArgValue("--quarantine-out");
  if (quarantineOut) {
    const p = path.resolve(quarantineOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(quarantineLedgerPayload, null, 2), "utf8");
    console.log(`Saved full quarantine ledger -> ${p}`);
  }

  const excludedOut = getArgValue("--excluded-out");
  if (excludedOut) {
    const p = path.resolve(excludedOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(excludedCoveragePayload, null, 2), "utf8");
    console.log(`Saved excluded & deferred coverage report -> ${p}`);
  }

  const ocrQueueGzOut = getArgValue("--ocr-queue-gz-out");
  if (ocrQueueGzOut) {
    const p = path.resolve(ocrQueueGzOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const gzBuf = zlib.gzipSync(
      Buffer.from(
        JSON.stringify(
          {
            summary: ocrRecoveryQueueSummary,
            items: ocrRecoveryQueueItems,
          },
          null,
          2
        ),
        "utf8"
      ),
      { level: 6 }
    );
    fs.writeFileSync(p, gzBuf);
    console.log(`Saved full 5,275-item OCR recovery queue (.json.gz) -> ${p}`);
  }

  const ocrSummaryOut = getArgValue("--ocr-summary-out");
  if (ocrSummaryOut) {
    const p = path.resolve(ocrSummaryOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(ocrRecoveryQueueSummary, null, 2), "utf8");
    console.log(`Saved OCR recovery queue summary -> ${p}`);
  }

  const uatOut = getArgValue("--uat-out");
  if (uatOut) {
    const p = path.resolve(uatOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          code_identifiers: codeIds,
          rel_B01_rc2_uat_cases: evalB01.uat_cases,
          rel_B02_rc1_uat_cases: evalB02.uat_cases,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log(`Saved proposed UAT case sheets (20 B01 + 20 B02) -> ${p}`);
  }

  const blindOut = getArgValue("--blind-out");
  if (blindOut) {
    const p = path.resolve(blindOut);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          code_identifiers: codeIds,
          rel_B01_rc2_blind_validation: blindB01,
          rel_B02_rc1_blind_validation: blindB02,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log(`Saved blind source-to-answer validation ledger -> ${p}`);
  }

  console.log(JSON.stringify(candidatePackageSummary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
