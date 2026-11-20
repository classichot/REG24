import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import {
  buildReleaseProjectionsFromOutbox,
  inspectReleaseProjectionDiagnostics,
  loadGraphProjectionSnapshot,
  loadLexicalProjectionSnapshot,
  loadVectorProjectionSnapshot,
  runTokenizerParityProbe,
} from "../../src/core/knowledge/projections";
import { retrieveAuthorizedKnowledge } from "../../src/core/knowledge/retrieval";
import {
  extractCompositeLegalTokens,
  extractPreservedNegationTokens,
  getThaiTokenizerContractMetadata,
  THAI_TOKENIZER_ENGINE_ID,
  tokenizeThaiLegalWithDictionary,
} from "../../src/core/knowledge/thai-legal-dictionary-v1";
import type { Actor } from "../../src/core/knowledge/contracts";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

const QA_ACTOR: Actor = {
  actor_id: "qa.rc7@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

describe("REG24 Batch 1 RC7 — Thai Legal Indexing, Manifest-Pinned Projections & Retrieval Gates", () => {
  it("1) Royal Decrees 790, 799, 807 carry verified Gazette hashes, separate temporal fields, real pdf_page locators, and strict endpoint filtering (zero unknown-expiry inference)", () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const st = store.getState();

    const expectedDecrees = [
      {
        workId: "subreg.th.rc.royal_decree.790",
        versionId: "ver.th.rc.royal_decree.790.v1",
        sha256: "8cee8f1d3715313f0538e99b1f6cb6887945e943ade089022a5d9d2bc8c5a14e",
        enactment: "2024-09-19",
        publication: "2024-09-20",
        commencement: "2024-10-01",
        txFrom: "2017-10-01",
        txTo: "2025-09-30",
        winFrom: "2024-10-01",
        winTo: "2025-09-30",
        originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
      },
      {
        workId: "subreg.th.rc.royal_decree.799",
        versionId: "ver.th.rc.royal_decree.799.v2",
        sha256: "796b9aff527081720587dcf5b378833eb09bac731c3cc941fea382ce18302ba3",
        enactment: "2025-09-13",
        publication: "2025-09-14",
        commencement: "2025-10-01",
        txFrom: "2017-10-01",
        txTo: "2026-09-30",
        winFrom: "2025-10-01",
        winTo: "2026-09-30",
        originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
      },
      {
        workId: "subreg.th.rc.royal_decree.807",
        versionId: "ver.th.rc.royal_decree.807.v2",
        sha256: "a4e0c55a2324397af4079317d2a5138fa075fcd87eb9348771742ed7ad6dab70",
        enactment: "2026-08-20",
        publication: "2026-08-23",
        commencement: "2026-10-01",
        txFrom: "2017-10-01",
        txTo: "2027-09-30",
        winFrom: "2026-10-01",
        winTo: "2027-09-30",
        originUri: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf",
      },
    ];

    const rc7Passages = store.getPassagesForRelease("rel.B01.rc7");
    for (const d of expectedDecrees) {
      const ver = st.versions[d.versionId];
      expect(ver).toBeTruthy();
      expect(ver.enactment_date).toBe(d.enactment);
      expect(ver.publication_date).toBe(d.publication);
      expect(ver.commencement_date).toBe(d.commencement);
      expect(ver.covered_transaction_period?.from).toBe(d.txFrom);
      expect(ver.covered_transaction_period?.to).toBe(d.txTo);
      expect(ver.covered_transaction_period?.is_temporary_rule).toBe(true);
      expect(ver.legal_applicability[0].valid_from).toBe(d.winFrom);
      expect(ver.legal_applicability[0].valid_to).toBe(d.winTo);
      expect(ver.legal_applicability[0].is_temporary_rule).toBe(true);

      const psgs = rc7Passages.filter((p) => p.work_id === d.workId);
      expect(psgs.length).toBe(3); // มาตรา ๑-๒, มาตรา ๓-๔, หมายเหตุ
      for (const p of psgs) {
        expect(p.version_id).toBe(d.versionId);
        expect(p.real_locator.kind).toBe("pdf_page");
        expect(p.real_locator.origin_uri).toBe(d.originUri);
        expect(typeof p.real_locator.physical_page_index).toBe("number");
        expect(p.real_locator.printed_page_label).toBeTruthy();
        const art = st.artifacts[p.real_locator.artifact_id];
        expect(art?.actual_bytes_sha256).toBe(d.sha256);
        expect(art?.authenticity_status).toBe("official_original");
        // Separate normalized search fields preserve original verbatim Thai numerals
        expect(p.search_fields?.normalized_text_arabic).toBeTruthy();
      }
    }

    // Test BOTH endpoints of every decree + post-807 expiry (2027-10-01)
    const endpointChecks: Array<{ date: string; allowed: string[]; forbidden: string[] }> = [
      {
        date: "2024-10-01",
        allowed: ["subreg.th.rc.royal_decree.790"],
        forbidden: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
      },
      {
        date: "2025-09-30",
        allowed: ["subreg.th.rc.royal_decree.790"],
        forbidden: ["subreg.th.rc.royal_decree.799", "subreg.th.rc.royal_decree.807"],
      },
      {
        date: "2025-10-01",
        allowed: ["subreg.th.rc.royal_decree.799"],
        forbidden: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
      },
      {
        date: "2026-09-30",
        allowed: ["subreg.th.rc.royal_decree.799"],
        forbidden: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.807"],
      },
      {
        date: "2026-10-01",
        allowed: ["subreg.th.rc.royal_decree.807"],
        forbidden: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
      },
      {
        date: "2027-09-30",
        allowed: ["subreg.th.rc.royal_decree.807"],
        forbidden: ["subreg.th.rc.royal_decree.790", "subreg.th.rc.royal_decree.799"],
      },
      {
        date: "2027-10-01",
        allowed: ["prov.th.rc.80"],
        forbidden: [
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
      },
    ];

    for (const chk of endpointChecks) {
      const bundle = retrieveAuthorizedKnowledge(store, {
        question: "การขายสินค้าในประเทศต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามประมวลรัษฎากร มาตรา 80 และพระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่ม",
        release_id: "rel.B01.rc7",
        actor: QA_ACTOR,
        applicable_date: chk.date,
        controlling_work_ids: ["prov.th.rc.80", ...chk.allowed],
        strategy: "exact_lexical",
        max_passages: 12,
      });
      const hitWorkIds = new Set(bundle.top_hits.map((h) => h.passage.work_id));
      for (const a of chk.allowed) {
        expect(hitWorkIds.has(a), `Expected ${a} on ${chk.date}`).toBe(true);
      }
      for (const f of chk.forbidden) {
        expect(hitWorkIds.has(f), `Forbidden ${f} leaked on ${chk.date}`).toBe(false);
      }
    }
  });

  it("2) Preserves composite identifiers (`มาตรา ๘๐/๑ (๒)` != `มาตรา 80`), negations/exceptions (`มิให้`, `เว้นแต่`), and reports unverified rulings without substitution", () => {
    const compTokens = extractCompositeLegalTokens("ตามประมวลรัษฎากร มาตรา ๘๐/๑ (๒) เว้นแต่กรณีมิให้ถือเป็น");
    expect(compTokens).toContain("sec:80/1(2)");
    expect(compTokens).toContain("sec:80/1");
    expect(compTokens).not.toContain("sec:80");

    const allToks = tokenizeThaiLegalWithDictionary("มาตรา ๘๐/๑ (๒) มิให้ถือเป็น เว้นแต่ ไม่มีค่าตอบแทน โดยเสน่หา");
    expect(allToks).toContain("sec:80/1(2)");
    expect(allToks).not.toContain("sec:80");
    expect(allToks).not.toContain("80");
    expect(allToks).toContain("มิให้");
    expect(allToks).toContain("เว้นแต่");
    expect(allToks).toContain("ไม่มีค่าตอบแทน");
    expect(allToks).toContain("โดยเสน่หา");

    const negs = extractPreservedNegationTokens("มิให้รวมคำนวณ เว้นแต่กรณีที่ไม่มีค่าตอบแทน");
    expect(negs).toEqual(expect.arrayContaining(["มิให้", "เว้นแต่", "ไม่มีค่าตอบแทน"]));

    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);
    const secBundle = retrieveAuthorizedKnowledge(store, {
      question: "ประมวลรัษฎากร มาตรา ๘๐/๑ (๒) บัญญัติไว้อย่างไร",
      release_id: "rel.B01.rc7",
      actor: QA_ACTOR,
      strategy: "exact_lexical",
      max_passages: 5,
    });
    expect(secBundle.top_hits[0]?.passage.work_id).toBe("prov.th.rc.80/1");

    const fakeRulingBundle = retrieveAuthorizedKnowledge(store, {
      question: "หนังสือตอบข้อหารือกรมสรรพากร เลขที่ กค 0702/99999 วินิจฉัยอย่างไร",
      release_id: "rel.B01.rc7",
      actor: QA_ACTOR,
      strategy: "exact_lexical",
      max_passages: 5,
    });
    expect(fakeRulingBundle.unresolved_explicit_ruling_ids).toContain("กค 0702/99999");
  });

  it("3) Manifest-pinned projections reject stale/mismatched snapshots, distinguish `deliberately_disabled` vectors from `missing`/`incompatible`, and prove rollback selects RC6 projections", async () => {
    const store = new DurableKnowledgeStore(STAGING_STORE_DIR);

    // Rollback proof: RC7 vs RC6 select their exact respective projection sets & passages (zero duplicates!)
    const diagRc7 = inspectReleaseProjectionDiagnostics(store, "rel.B01.rc7");
    const diagRc6 = inspectReleaseProjectionDiagnostics(store, "rel.B01.rc6");

    const rtMeta = getThaiTokenizerContractMetadata();
    expect(diagRc7.lexical.status).toBe("ready");
    expect(diagRc7.lexical.schema_version).toBe("2.0");
    expect(diagRc7.lexical.tokenizer_engine).toBe(THAI_TOKENIZER_ENGINE_ID);
    expect(diagRc7.lexical.tokenizer_contract_sha256).toBe(rtMeta.tokenizer_contract_sha256);
    expect(diagRc7.lexical.legal_dictionary_sha256).toBe(rtMeta.legal_dictionary_sha256);
    expect(diagRc7.lexical.tokenizer_parity_verified).toBe(true);
    expect(diagRc7.lexical.lexical_index_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(diagRc7.vector.status).toBe("deliberately_disabled");
    expect(diagRc7.graph.status).toBe("ready");
    expect(diagRc7.graph.neo4j_runtime_dependency).toBe(false);

    // Live tokenizer parity probe across unspaced Thai, legal citations, negation, and compound terms
    const parity = runTokenizerParityProbe(store, "rel.B01.rc7");
    expect(parity.contract_parity_ok).toBe(true);
    expect(parity.all_probes_ok).toBe(true);
    expect(parity.probes.map((p) => p.category)).toEqual([
      "unspaced_thai",
      "legal_citations",
      "negation",
      "compound_terms",
    ]);

    expect(diagRc6.lexical.status).toBe("ready");
    expect(diagRc6.lexical.generation).not.toBe(diagRc7.lexical.generation);
    expect(diagRc6.vector.status).toBe("deliberately_disabled");
    expect(loadVectorProjectionSnapshot(store, "rel.B01.rc7")).toBeNull(); // Disabled -> never loaded as active!
    expect(loadLexicalProjectionSnapshot(store, "rel.B01.rc7")?.manifest_hash).toBe(diagRc7.manifest_hash);
    expect(loadLexicalProjectionSnapshot(store, "rel.B01.rc6")?.manifest_hash).toBe(diagRc6.manifest_hash);
    expect(loadGraphProjectionSnapshot(store, "rel.B01.rc6")?.generation).toBe(diagRc6.graph.generation);

    // Zero duplicate passages in RC7 and preserved RC6 isolation
    const rc7Psgs = store.getPassagesForRelease("rel.B01.rc7");
    const rc6Psgs = store.getPassagesForRelease("rel.B01.rc6");
    expect(new Set(rc7Psgs.map((p) => p.passage_id)).size).toBe(rc7Psgs.length);
    expect(rc6Psgs.some((p) => p.work_id === "subreg.th.rc.royal_decree.790")).toBe(false);
    expect(rc7Psgs.some((p) => p.work_id === "subreg.th.rc.royal_decree.790")).toBe(true);

    // Isolated temp-dir test proving stale/mismatched manifest_hash projection is REJECTED and flagged `incompatible`,
    // and missing vector file is flagged `missing` (distinct from `deliberately_disabled`!)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-proj-guard-"));
    try {
      const tmpStore = new DurableKnowledgeStore(tmpDir);
      await tmpStore.transact("SEED_RELEASE", (draft) => {
        draft.releases["rel.B01.test"] = {
          release_id: "rel.B01.test",
          batch_id: "B01",
          manifest_id: "mfst.test.v1",
          manifest_hash: "aaaa1111bbbb2222cccc3333dddd4444aaaa1111bbbb2222cccc3333dddd4444",
          code_commit: "test",
          state: "READY_FOR_UAT",
          revision: 1,
          previous_accepted_release_id: null,
          rollback_target_release_id: null,
          created_work_ids: [],
          created_version_ids: [],
          created_passage_ids: [],
          created_assertion_ids: [],
          reused_work_ids: [],
          coverage_gaps: [],
          transitions: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });

      // Before building -> missing
      const beforeDiag = inspectReleaseProjectionDiagnostics(tmpStore, "rel.B01.test");
      expect(beforeDiag.lexical.status).toBe("missing");
      expect(beforeDiag.vector.status).toBe("missing");

      // After building with default vectorMode -> deliberately_disabled + exact tokenizer parity
      await buildReleaseProjectionsFromOutbox(tmpStore, "rel.B01.test", "durable_disk");
      const readyDiag = inspectReleaseProjectionDiagnostics(tmpStore, "rel.B01.test");
      expect(readyDiag.lexical.status).toBe("ready");
      expect(readyDiag.lexical.tokenizer_parity_verified).toBe(true);
      expect(readyDiag.vector.status).toBe("deliberately_disabled");

      // Mixed-engine lexical snapshot (e.g. PyThaiNLP index queried by TS runtime) MUST be rejected as incompatible!
      const lexPath = path.join(tmpDir, "projections", "rel.B01.test_lexical.json");
      const lexObj = JSON.parse(fs.readFileSync(lexPath, "utf8"));
      lexObj.tokenizer_engine = "pythainlp_newmm_v5.4.0+reg24-th-legal-dict-v1.0";
      fs.writeFileSync(lexPath, JSON.stringify(lexObj), "utf8");
      // Touch mtime +2s to ensure cache reload
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(lexPath, future, future);
      expect(loadLexicalProjectionSnapshot(tmpStore, "rel.B01.test")).toBeNull();
      const mixedDiag = inspectReleaseProjectionDiagnostics(tmpStore, "rel.B01.test");
      expect(mixedDiag.lexical.status).toBe("incompatible");
      expect(mixedDiag.lexical.tokenizer_parity_verified).toBe(false);
      expect(mixedDiag.lexical.reason).toContain("TOKENIZER_ENGINE_MISMATCH");

      // Rebuild cleanly, then mutate manifest_hash -> REJECTED & incompatible!
      await buildReleaseProjectionsFromOutbox(tmpStore, "rel.B01.test", "durable_disk");
      await tmpStore.transact("BUMP_MANIFEST_HASH", (draft) => {
        draft.releases["rel.B01.test"].manifest_hash =
          "ffff9999eeee8888dddd7777cccc6666ffff9999eeee8888dddd7777cccc6666";
      });
      expect(loadLexicalProjectionSnapshot(tmpStore, "rel.B01.test")).toBeNull();
      expect(loadGraphProjectionSnapshot(tmpStore, "rel.B01.test")).toBeNull();
      const staleDiag = inspectReleaseProjectionDiagnostics(tmpStore, "rel.B01.test");
      expect(staleDiag.lexical.status).toBe("incompatible");
      expect(staleDiag.vector.status).toBe("incompatible");
      expect(staleDiag.graph.status).toBe("incompatible");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("4) Transactional save isolation: interrupted save leaves ZERO partial revision visible and retry produces ZERO duplicate rows", async () => {
    const {
      persistAnswerRevisionToPostgres,
      setCustomCitationDbTransportForTesting,
    } = await import("../../src/core/knowledge/citation-postgres-store");

    const committedAnswers = new Map<string, unknown>();
    const committedClaims = new Map<string, unknown>();
    const committedLinks = new Map<string, unknown>();
    const committedAudits = new Map<string, unknown>();
    let shouldFailMidTransaction = true;

    setCustomCitationDbTransportForTesting(
      async () => ({ rows: [], rowCount: 0 }),
      async (statements) => {
        // Atomic staging copy — mirrors PostgreSQL BEGIN ... COMMIT / ROLLBACK semantics
        const stagedAnswers = new Map(committedAnswers);
        const stagedClaims = new Map(committedClaims);
        const stagedLinks = new Map(committedLinks);
        const stagedAudits = new Map(committedAudits);

        for (let i = 0; i < statements.length; i++) {
          const st = statements[i];
          const q = st.query.trim();
          if (q.startsWith("INSERT INTO citation_published_answer")) {
            const revId = String(st.params[0]);
            if (!stagedAnswers.has(revId)) stagedAnswers.set(revId, st.params);
          } else if (q.startsWith("INSERT INTO citation_atomic_claim")) {
            if (shouldFailMidTransaction) {
              throw new Error("SIMULATED_INTERRUPTED_SAVE_MID_TRANSACTION");
            }
            const claimId = String(st.params[0]);
            if (!stagedClaims.has(claimId)) stagedClaims.set(claimId, st.params);
          } else if (q.startsWith("INSERT INTO citation_claim_evidence_link")) {
            const linkId = String(st.params[0]);
            if (!stagedLinks.has(linkId)) stagedLinks.set(linkId, st.params);
          } else if (q.startsWith("INSERT INTO citation_audit_event")) {
            const auditId = String(st.params[0]);
            if (!stagedAudits.has(auditId)) stagedAudits.set(auditId, st.params);
          }
        }
        // Only commit if ALL statements succeeded!
        for (const [k, v] of stagedAnswers) committedAnswers.set(k, v);
        for (const [k, v] of stagedClaims) committedClaims.set(k, v);
        for (const [k, v] of stagedLinks) committedLinks.set(k, v);
        for (const [k, v] of stagedAudits) committedAudits.set(k, v);
      }
    );

    const saveArgs = {
      envelope: {
        schema_version: "reg24.citation-traceability.v1" as const,
        answer_id: "ans.tx.iso",
        answer_revision: "ans.tx.iso.r1",
        revision_number: 1,
        supersedes_answer_revision: null,
        channel: "chat" as const,
        generated_at: new Date().toISOString(),
        as_of_date: "2026-09-30",
        status: "complete" as const,
        rendered_answer_th: "คำตอบทดสอบธุรกรรม",
        user_supplied_facts: [],
        assumptions: [],
        claims: [
          {
            claim_id: "clm.tx.1",
            claim_number: 1,
            text: "อัตราภาษีมูลค่าเพิ่มร้อยละ 7",
            claim_type: "legal_proposition" as const,
            claim_type_label_th: "ข้อกฎหมาย",
            premise_ids: [],
            verification_decision: "supported" as const,
            published: true,
            withheld_explanation_th: null,
            evidence_references: [
              {
                link_id: "lnk.tx.1",
                evidence_id: "psg.rc7.rd799.sec_3_4",
                doc_id: "subreg.th.rc.royal_decree.799",
                version_id: "ver.th.rc.royal_decree.799.v2",
                extraction_revision_id: "ext.gazette.rd799.796b9aff5270",
                support_role: "primary_authority" as const,
                support_role_label_th: "หลักฐานกฎหมายหลัก",
                required_group: "grp.1",
                citation_label_th: "พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568",
                issuer_name_th: "กรมสรรพากร",
                source_family: "gazette_enactment" as const,
                source_family_label_th: "กฎหมาย",
                record_type: "full_record" as const,
                record_type_label_th: "เอกสารฉบับเต็มทางการ",
                date_relied_on: "2026-09-30",
                official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
                official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf#page=2",
                resolver_url: "/api/v1/knowledge/evidence/psg.rc7.rd799.sec_3_4",
                locator: {
                  human_pinpoint_th: "หน้า ๒",
                  section_paragraph_path: ["มาตรา 4"],
                  physical_page_start: 2,
                  physical_page_end: 2,
                  printed_page_start: "หน้า ๒",
                  printed_page_end: "หน้า ๒",
                  anchors: [],
                },
                verification_status: "supported" as const,
                link_health: "unchecked_live" as const,
                link_health_notice_th: null,
                last_successful_verification_at: null,
                access_permission: "public" as const,
                access_conditions_th: null,
              },
            ],
          },
        ],
        unresolved_issues: [],
        legacy_warning_th: null,
        verifier_metadata: {
          verifier_version: "reg24-claim-verifier-v2.1",
          ruleset_version: "th-official-traceability-2026.11.2",
          release_id: "rel.B01.rc7",
          publication_gate_mode: "enforced" as const,
        },
      },
      question_text: "ทดสอบธุรกรรมบันทึกคำตอบ",
      owner_actor_id: QA_ACTOR.actor_id,
      owner_tenant_id: QA_ACTOR.tenant_id,
      actor: QA_ACTOR,
      revision_reason: "Transactional isolation test",
      referenced_bundles: [],
    };

    try {
      // Attempt 1: Interrupted mid-transaction -> MUST fail and leave ZERO partial rows visible!
      await expect(persistAnswerRevisionToPostgres(saveArgs)).rejects.toThrow(
        "SIMULATED_INTERRUPTED_SAVE_MID_TRANSACTION"
      );
      expect(committedAnswers.size).toBe(0);
      expect(committedClaims.size).toBe(0);
      expect(committedLinks.size).toBe(0);
      expect(committedAudits.size).toBe(0);

      // Attempt 2: Retry cleanly -> commits all 4 atomically!
      shouldFailMidTransaction = false;
      const res1 = await persistAnswerRevisionToPostgres(saveArgs);
      expect(res1.persisted).toBe(true);
      expect(committedAnswers.size).toBe(1);
      expect(committedClaims.size).toBe(1);
      expect(committedLinks.size).toBe(1);
      expect(committedAudits.size).toBe(1);

      // Attempt 3: Safe idempotent retry -> ZERO duplicate revisions, claims, links, or audit events!
      const res2 = await persistAnswerRevisionToPostgres(saveArgs);
      expect(res2.persisted).toBe(true);
      expect(committedAnswers.size).toBe(1);
      expect(committedClaims.size).toBe(1);
      expect(committedLinks.size).toBe(1);
      expect(committedAudits.size).toBe(1);
    } finally {
      setCustomCitationDbTransportForTesting(null);
    }
  });
});
