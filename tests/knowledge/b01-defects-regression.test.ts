import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { THAI_TAX_RULINGS_CORPUS } from "../../src/core/data/thai-tax-rulings-loader";
import {
  extractB01,
  extractCitedRevenueCodeAndSubRegulations,
  separateRulingFactsAndConclusion,
} from "../../src/core/knowledge/profiles/B01";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { freezeInventory, planReconciliation } from "../../src/core/knowledge/inventory";
import { rollbackRelease, startBatchRun } from "../../src/core/knowledge/releases";
import {
  loadGraphProjectionSnapshot,
  loadLexicalProjectionSnapshot,
  loadVectorProjectionSnapshot,
} from "../../src/core/knowledge/projections";
import { queryKnowledge } from "../../src/core/knowledge/query";
import { sha256Bytes } from "../../src/core/knowledge/identity";
import type { Actor, Artifact, Extraction } from "../../src/core/knowledge/contracts";

const ENG_ACTOR: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("Batch 01 Independent Audit Defect Regressions (DEF-B01-01, DEF-B01-02, DEF-B01-03)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-b01-defects-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("DEF-B01-01: Separates requester facts from Revenue Department conclusions across ALL 4,650 corpus records (794 identical + 5 recovered empty-ruling PDFs -> 0 mixed records)", () => {
    expect(THAI_TAX_RULINGS_CORPUS.length).toBe(4650);

    let rawIdenticalCount = 0;
    let splitCount = 0;
    let postIdenticalCount = 0;
    let ambiguousCount = 0;
    const emptyConclusionIds: string[] = [];

    for (const r of THAI_TAX_RULINGS_CORPUS) {
      const fTrim = (r.facts || "").trim();
      const rTrim = (r.ruling || "").trim();
      if (fTrim && rTrim && fTrim === rTrim) {
        rawIdenticalCount += 1;
      }

      const separated = separateRulingFactsAndConclusion({
        rawFacts: r.facts,
        rawRuling: r.ruling,
        fullText: r.ruling || r.facts || "",
        legacyId: r.id,
      });

      if (separated.wasMixedAndSplit) splitCount += 1;
      if (separated.ambiguousUnresolvedMix) ambiguousCount += 1;
      if (separated.factsText && separated.rulingText && separated.factsText === separated.rulingText) {
        postIdenticalCount += 1;
      }
      if (!separated.rulingText || separated.rulingText === "-") {
        emptyConclusionIds.push(r.id);
      }
    }

    expect(rawIdenticalCount).toBe(794);
    expect(splitCount).toBeGreaterThanOrEqual(794);
    expect(postIdenticalCount).toBe(0);
    expect(ambiguousCount).toBe(0);
    expect(emptyConclusionIds).toEqual(["ruling.th.rd.30677"]);

    const r22929 = THAI_TAX_RULINGS_CORPUS.find((x) => x.id === "ruling.th.rd.22929")!;
    const s22929 = separateRulingFactsAndConclusion({
      rawFacts: r22929.facts,
      rawRuling: r22929.ruling,
      fullText: r22929.ruling || "",
      legacyId: r22929.id,
    });
    expect(s22929.wasMixedAndSplit).toBe(true);
    expect(s22929.factsText).not.toBe(s22929.rulingText);
    expect(s22929.rulingText).toContain("ไม่จำเป็นต้องจัดเก็บและลงบัญชีสต็อค");
  });

  it("DEF-B01-02: Ruling กค 0811/13980 (rd.go.th/22874.html) does NOT mislink Royal Decree 244 s. 3(5) to RC s. 3 or CCC s. 491 to RC s. 491, and quarantines unverified instruments", async () => {
    const raw22874 = THAI_TAX_RULINGS_CORPUS.find((x) => x.id === "ruling.th.rd.22874")!;
    expect(raw22874).toBeDefined();

    const bodyText = raw22874.ruling || "";
    const sha = sha256Bytes(bodyText);
    const nowIso = new Date().toISOString();

    const artifact: Artifact = {
      artifact_id: "art.test.22874",
      actual_bytes_sha256: sha,
      size: Buffer.byteLength(bodyText, "utf8"),
      MIME: "text/html",
      immutable_uri: `artifact://sha256/${sha}`,
      fetched_at: nowIso,
      origin_uri: "https://www.rd.go.th/22874.html",
      authenticity_status: "official_html_snapshot",
      access_scope: "scope.platform.public",
      rights_status: "approved_public",
    };

    const extraction: Extraction = {
      extraction_id: "ext.test.22874",
      artifact_id: artifact.artifact_id,
      work_id: "work.th.taxruling.22874",
      version_id: "ver.th.taxruling.22874.v1",
      extractor_version: "b01-v1.2",
      model_version: "native",
      configuration_version: "cfg.v1.2",
      raw_text_uri: artifact.immutable_uri,
      raw_text: bodyText,
      normalized_text: bodyText,
      normalization_log: [],
      quality_status: "VALIDATED",
      accepted_revision: 1,
      created_at: nowIso,
    };

    const extracted = await extractB01({
      batch_id: "B01",
      artifact,
      extraction,
      candidate_work_id: "work.th.taxruling.22874",
      candidate_version_id: "ver.th.taxruling.22874.v1",
      release_id: "rel.B01.rc2",
      source_metadata: {
        ruling_no: "กค 0811/13980",
        date: raw22874.date,
        subject: "ภาษีเงินได้นิติบุคคลและภาษีธุรกิจเฉพาะ การขายฝากที่ดินของบริษัทหรือห้างหุ้นส่วนนิติบุคคล",
        facts: raw22874.facts,
        ruling: raw22874.ruling,
        legacy_id: raw22874.id,
      },
      processing_version: "1.2",
      access_scope: "scope.platform.public",
    });

    // 1. Facts and official conclusion passages are strictly distinct
    const reqPassages = extracted.passages.filter((p) => p.statement_role === "requester_facts");
    const concPassages = extracted.passages.filter((p) => p.statement_role === "official_conclusion");
    expect(reqPassages.length).toBeGreaterThan(0);
    expect(concPassages.length).toBeGreaterThan(0);
    expect(reqPassages[0].exact_text).not.toBe(concPassages[0].exact_text);

    // 2. Forbidden mislinks `prov.th.rc.3` and `prov.th.rc.491` MUST NOT exist anywhere in dependency_requests or assertions!
    const depTargets = extracted.dependency_requests.map((d) => d.normalized_key);
    const assertionObjects = extracted.proposed_assertions.map((a) => a.object);

    expect(depTargets).not.toContain("prov.th.rc.3");
    expect(depTargets).not.toContain("prov.th.rc.491");
    expect(assertionObjects).not.toContain("prov.th.rc.3");
    expect(assertionObjects).not.toContain("prov.th.rc.491");

    // 3. Genuine Revenue Code provisions in Ruling 0811/13980 (`มาตรา 65`, `91/2`, etc.) ARE linked
    expect(depTargets).toContain("prov.th.rc.65");
    expect(depTargets).toContain("prov.th.rc.91/2");

    // 4. Royal Decree 244 s. 3(5) and CCC s. 491 are quarantined with `usable_as_legal_evidence: false`
    expect(extracted.unresolved_references.length).toBeGreaterThanOrEqual(2);
    for (const ur of extracted.unresolved_references) {
      expect(ur.quarantine_status).toBe("UNRESOLVED_QUARANTINED");
      expect(ur.usable_as_legal_evidence).toBe(false);
    }

    const rd244Quarantined = extracted.unresolved_references.find((u) =>
      (u.governing_instrument || u.raw_citation_text).includes("244")
    );
    expect(rd244Quarantined).toBeDefined();

    const ccc491Quarantined = extracted.unresolved_references.find((u) =>
      u.target_hint.includes("491")
    );
    expect(ccc491Quarantined).toBeDefined();
  });

  it("DEF-B01-02: Correctly scopes Royal Decrees, Ministerial Regulations, Civil & Commercial Code (ป.พ.พ.), standalone Acts, and Pali ordinals without Revenue Code mislinking", () => {
    const complexRulingSample = [
      "1. บริษัทมีหน้าที่หักภาษี ณ ที่จ่ายตามมาตรา 3 เตรส และมาตรา 65 ตรี (3) แห่งประมวลรัษฎากร",
      "2. ได้รับยกเว้นตามมาตรา 5 สัตตรส และมาตรา 5 โสฬส แห่งพระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 10) พ.ศ. 2500",
      "3. การทำสัญญาจ้างทำของตาม ป.พ.พ. มาตรา 587 และการเลิกบริษัทตามมาตรา 1236 และมาตรา 1238 แห่งประมวลกฎหมายแพ่งและพาณิชย์",
      "4. นิติบุคคลหมู่บ้านจัดสรรตามมาตรา 44 แห่งพระราชบัญญัติการจัดสรรที่ดิน พ.ศ. 2543 และนิติบุคคลอาคารชุดตามพระราชบัญญัติอาคารชุด พ.ศ. 2522 มาตรา 18",
      "5. ได้รับยกเว้นเบี้ยปรับตามมาตรา 6 แห่งพระราชบัญญัติยกเว้นเบี้ยปรับ เงินเพิ่มภาษีอากร และความรับผิดทางอาญา เพื่อสนับสนุนการปฏิบัติการเกี่ยวกับภาษีอากรตามประมวลรัษฎากร พ.ศ. 2562",
    ].join("\n");

    const parsed = extractCitedRevenueCodeAndSubRegulations("", complexRulingSample, "work.test");
    const depKeys = parsed.dependencies.map((d) => d.normalized_key);

    // Must ONLY include genuine Revenue Code sections (`prov.th.rc.3_เตรส` and `prov.th.rc.65_ตรี`) + verified Royal Decree 10!
    expect(depKeys).toContain("prov.th.rc.3_เตรส");
    expect(depKeys).toContain("prov.th.rc.65_ตรี");
    expect(depKeys).toContain("subreg.th.rc.royal_decree.10");

    // Must NOT mislink Royal Decree 10 (`5`, `5 สัตตรส`, `5 โสฬส`), CCC (`587`, `1236`, `1238`), or standalone Acts (`44`, `18`, `6`) to Revenue Code!
    expect(depKeys).not.toContain("prov.th.rc.3");
    expect(depKeys).not.toContain("prov.th.rc.5");
    expect(depKeys).not.toContain("prov.th.rc.5_สัตตรส");
    expect(depKeys).not.toContain("prov.th.rc.5_โสฬส");
    expect(depKeys).not.toContain("prov.th.rc.587");
    expect(depKeys).not.toContain("prov.th.rc.1236");
    expect(depKeys).not.toContain("prov.th.rc.1238");
    expect(depKeys).not.toContain("prov.th.rc.44");
    expect(depKeys).not.toContain("prov.th.rc.18");
    expect(depKeys).not.toContain("prov.th.rc.6");

    // CCC and standalone Acts are cleanly quarantined
    const quarantinedKeys = parsed.quarantinedCitations.map((q) => q.normalized_key);
    expect(quarantinedKeys.some((k) => k.includes("ccc.587"))).toBe(true);
    expect(quarantinedKeys.some((k) => k.includes("ccc.1236"))).toBe(true);
    expect(quarantinedKeys.some((k) => k.includes("ccc.1238"))).toBe(true);
    expect(
      parsed.quarantinedCitations.filter((q) => q.instrument_kind === "STANDALONE_ACT").length
    ).toBeGreaterThanOrEqual(3);
  });

  it("DEF-B01-03: Stages Batch 01 with ZERO generated `ext.dep.*` statutory passages, real verbatim text + SHA-256 hashes, and strict quarantine of unresolved references", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    const frozen = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(frozen.manifest.manifest_id, ENG_ACTOR, { store });

    const runReceipt = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: frozen.manifest.manifest_id,
        idempotency_key: "idem-def-b01-03",
        max_documents: 100,
      },
      ENG_ACTOR,
      { store }
    );

    const st = store.getState();
    const allPassages = Object.values(st.passages);
    const allExtractions = Object.values(st.extractions);

    // 1. ZERO synthetic `ext.dep.*` extractions or passages anywhere in canonical store
    const syntheticExtractions = allExtractions.filter((e) => e.extraction_id.startsWith("ext.dep."));
    const syntheticPassages = allPassages.filter((p) => p.extraction_id.startsWith("ext.dep."));
    expect(syntheticExtractions).toEqual([]);
    expect(syntheticPassages).toEqual([]);

    // 2. Every statutory/subordinate passage has real verbatim text (`ext.ver.*`) and 64-char SHA-256 artifact hash
    const statPassages = allPassages.filter((p) => p.statement_role === "statutory_text");
    expect(statPassages.length).toBeGreaterThan(20);
    for (const sp of statPassages) {
      expect(sp.extraction_id.startsWith("ext.ver.")).toBe(true);
      const art = st.artifacts[sp.real_locator.artifact_id];
      expect(art).toBeDefined();
      expect(art.actual_bytes_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(art.is_derivative).not.toBe(true);
      expect(sp.exact_text).not.toContain("สรุปสาระสำคัญ");
    }

    // 3. Unresolved external references are strictly quarantined (`usable_as_legal_evidence: false`) and have ZERO passages, vectors, lexical entries, or graph edges
    const unresolvedList = Object.values(st.unresolved_references);
    expect(unresolvedList.length).toBeGreaterThan(0);
    const passageWorkIds = new Set(allPassages.map((p) => p.work_id));
    const lexSnap = loadLexicalProjectionSnapshot(store, runReceipt.release_id);
    const vecSnap = loadVectorProjectionSnapshot(store, runReceipt.release_id);
    const graphSnap = loadGraphProjectionSnapshot(store, runReceipt.release_id);
    expect(lexSnap).toBeDefined();
    expect(vecSnap).toBeDefined();
    expect(graphSnap).toBeDefined();
    const graphNodeIds = new Set<string>();
    for (const edge of graphSnap!.edges) {
      graphNodeIds.add(edge.subject);
      graphNodeIds.add(edge.object);
    }

    for (const ur of unresolvedList) {
      expect(ur.quarantine_status).toBe("UNRESOLVED_QUARANTINED");
      expect(ur.usable_as_legal_evidence).toBe(false);
      expect(ur.recorded_in_release_id).toBe(runReceipt.release_id);
      expect(passageWorkIds.has(ur.target_hint)).toBe(false);
      expect(graphNodeIds.has(ur.target_hint)).toBe(false);
    }

    // 4. Querying for a quarantined external reference never returns a quarantined item as verified legal evidence
    const sampleQuarantined = unresolvedList[0];
    const qAns = await queryKnowledge(
      {
        question: sampleQuarantined.raw_citation_text,
        release_id: runReceipt.release_id,
        mode: "standard",
      },
      ENG_ACTOR,
      { store }
    );
    for (const ev of qAns.evidence) {
      expect(ev.work_id).not.toBe(sampleQuarantined.target_hint);
    }

    expect(runReceipt.release_id).toBe("rel.B01.rc1");
  }, 30000);

  it("DEF-B01-05/06: Prepares rel.B01.rc2 and rel.B02.rc1 in isolated staging while preserving rel.B01.rc1 audit trail, zero auto-approvals, duplicate re-import idempotency, and safe rollback", async () => {
    const store = new DurableKnowledgeStore(tempDir);

    // 1. Seed initial rel.B01.rc1 in READY_FOR_UAT (user_decision: null)
    const fRc1 = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(fRc1.manifest.manifest_id, ENG_ACTOR, { store });
    const runRc1 = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: fRc1.manifest.manifest_id,
        idempotency_key: "idem-rc1-preserve",
        max_documents: 40,
      },
      ENG_ACTOR,
      { store, releaseIdOverride: "rel.B01.rc1" }
    );
    expect(runRc1.release_id).toBe("rel.B01.rc1");
    const rc1HashBefore = store.getState().releases["rel.B01.rc1"].manifest_hash;
    const rc1PassagesBefore = store.getPassagesForRelease("rel.B01.rc1").length;
    const walCountAfterRc1 = store.readWalEntries().length;

    // 2. Stage candidate rel.B01.rc2 in the SAME isolated store without touching rel.B01.rc1 or recording Owner approval
    const fRc2 = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(fRc2.manifest.manifest_id, ENG_ACTOR, { store });
    const runRc2 = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: fRc2.manifest.manifest_id,
        idempotency_key: "idem-rc2-candidate",
        max_documents: 40,
      },
      ENG_ACTOR,
      { store, releaseIdOverride: "rel.B01.rc2" }
    );
    expect(runRc2.release_id).toBe("rel.B01.rc2");

    // 3. Stage candidate rel.B02.rc1 against candidate predecessor rel.B01.rc2 (isolated custom dir only; zero auto-approvals)
    const fB02 = await freezeInventory("B02", ENG_ACTOR, {
      store,
      predecessorReleaseId: "rel.B01.rc2",
    });
    await planReconciliation(fB02.manifest.manifest_id, ENG_ACTOR, { store });
    const runB02 = await startBatchRun(
      {
        batch_id: "B02",
        manifest_id: fB02.manifest.manifest_id,
        idempotency_key: "idem-b02-candidate",
        max_documents: 40,
      },
      ENG_ACTOR,
      {
        store,
        releaseIdOverride: "rel.B02.rc1",
        stagingCandidatePredecessorReleaseId: "rel.B01.rc2",
      }
    );
    expect(runB02.release_id).toBe("rel.B02.rc1");

    const stPrepared = store.getState();
    expect(stPrepared.active_release_id).toBeNull();
    expect(stPrepared.releases["rel.B01.rc1"].state).toBe("READY_FOR_UAT");
    expect(stPrepared.releases["rel.B01.rc1"].manifest_hash).toBe(rc1HashBefore);
    expect(store.getPassagesForRelease("rel.B01.rc1").length).toBe(rc1PassagesBefore);
    expect(stPrepared.releases["rel.B01.rc2"].state).toBe("READY_FOR_UAT");
    expect(stPrepared.releases["rel.B01.rc2"].supersession_lineage).toBeDefined();
    expect(stPrepared.releases["rel.B01.rc2"].supersession_lineage?.supersedes_release_id).toBe("rel.B01.rc1");
    expect(stPrepared.releases["rel.B01.rc2"].supersession_lineage?.supersedes_manifest_id).toBe(fRc1.manifest.manifest_id);
    expect(stPrepared.releases["rel.B01.rc2"].supersession_lineage?.supersedes_manifest_hash).toBe(rc1HashBefore);
    expect(stPrepared.releases["rel.B01.rc2"].supersession_lineage?.prior_chat_approval_preserved).toBe(true);
    expect(stPrepared.releases["rel.B02.rc1"].state).toBe("READY_FOR_UAT");
    expect(stPrepared.acceptances["rel.B01.rc1"].user_decision).toBeNull();
    expect(stPrepared.acceptances["rel.B01.rc2"].user_decision).toBeNull();
    expect(stPrepared.acceptances["rel.B02.rc1"].user_decision).toBeNull();
    expect(store.readWalEntries().length).toBeGreaterThan(walCountAfterRc1);

    // 4. Duplicate re-import is 100% idempotent (0 extra works, passages, or assertions)
    const worksCountBeforeReplay = Object.keys(stPrepared.works).length;
    const passagesCountBeforeReplay = Object.keys(stPrepared.passages).length;
    const replayRc2 = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: fRc2.manifest.manifest_id,
        idempotency_key: "idem-rc2-candidate",
        max_documents: 40,
      },
      ENG_ACTOR,
      { store, releaseIdOverride: "rel.B01.rc2" }
    );
    expect(replayRc2.idempotent_replay).toBe(true);
    expect(Object.keys(store.getState().works).length).toBe(worksCountBeforeReplay);
    expect(Object.keys(store.getState().passages).length).toBe(passagesCountBeforeReplay);

    // 5. Rolling back rel.B02.rc1 and rel.B01.rc2 preserves rel.B01.rc1 and shared law works intact
    await rollbackRelease("rel.B02.rc1", "Test B02 rollback", ENG_ACTOR, { store });
    expect(store.getState().releases["rel.B02.rc1"].state).toBe("ROLLED_BACK");
    expect(store.getState().works["prov.th.rc.65_ตรี"]).toBeDefined();

    await rollbackRelease("rel.B01.rc2", "Test B01.rc2 rollback", ENG_ACTOR, { store });
    expect(store.getState().releases["rel.B01.rc2"].state).toBe("ROLLED_BACK");
    expect(store.getState().releases["rel.B01.rc1"].state).toBe("READY_FOR_UAT");
    expect(store.getPassagesForRelease("rel.B01.rc1").length).toBe(rc1PassagesBefore);
  }, 45000);
});
