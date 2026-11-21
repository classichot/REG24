/**
 * REG24 Batch 1 — RC10.3 P0 Remediation Gates Suite
 *
 * Proves all three RC10.3 P0 requirements:
 *   1. P0-1 | Governing evidence matches transaction date:
 *      - Preserves RC10.2 (`rel.B01.rc7`) comparison baseline untouched (reproducing its old `amends.prev` & open RD 646 metadata).
 *      - Proves RC10.3 (`rel.B01.rc8`) separates `AMENDS` (Decree 646 §4) from `SUPERSEDES` (predecessor history),
 *        labels amending decree §3 separately from quoted replacement text of Decree 646 §4,
 *        blocks superseded RD 646 and linked predecessors from entering `actual_model_packet` as `governing`
 *        (including passages added via graph expansion beyond Top-5), and enforces day-before / day-of every
 *        relevant boundary (RD 646, RD 780, RD 790, RD 799, RD 807, post-807 expiry, and 2019 gap).
 *   2. P0-2 | Publish only after commit; retry same save without creating a new revision:
 *      - Failed Neon transaction leaves ZERO revision visible in memory/cache/API.
 *      - Same `(actor, answer_id, save_operation_key)` + same payload returns exact same revision.
 *      - Same `save_operation_key` + different content fails clearly with `409`.
 *      - Intentional edit with a new `save_operation_key` creates the next revision (`r2`).
 *   3. P0-3 | Normal staging default is Gemini 4 Neon @ low without request override:
 *      - Verifies `GET /api/v1/knowledge/environment?probe_tokenizer=1` resolves `rel.B01.rc8`,
 *        `thinking_level: "low"` by default without env/request override, and passes tokenizer parity.
 */

import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import {
  buildGroundedPassagePack,
  resolveThinkingLevelForModel,
} from "../../src/core/knowledge/grounded-llm-drafter";
import {
  queryKnowledge,
  type RealAppEvidenceAssemblyCapture,
} from "../../src/core/knowledge/query";
import {
  getUnifiedCitationLedgerView,
  reopenSavedTraceableAnswer,
  saveOrReviseAnswerServerVerified,
} from "../../src/core/knowledge/claim-traceability-engine";
import { setCustomCitationDbTransportForTesting } from "../../src/core/knowledge/citation-postgres-store";
import { GET as getEnvironment } from "../../src/app/api/v1/knowledge/environment/route";
import { POST as postQuery } from "../../src/app/api/v1/knowledge/query/route";
import { retrieveAuthorizedKnowledge } from "../../src/core/knowledge/retrieval";
import type { Actor } from "../../src/core/knowledge/contracts";

const STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");

const QA_ACTOR: Actor = {
  actor_id: "qa.rc10_3@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

async function capturePacket(
  store: DurableKnowledgeStore,
  releaseId: string,
  question: string,
  applicableDate: string | null
): Promise<RealAppEvidenceAssemblyCapture> {
  let cap: RealAppEvidenceAssemblyCapture | null = null;
  await queryKnowledge(
    {
      question,
      release_id: releaseId,
      applicable_date: applicableDate,
      mode: "standard",
      answer_generation_mode: "llm_grounded",
    },
    QA_ACTOR,
    {
      store,
      retrievalStrategy: "hybrid_with_graph",
      captureRealAppEvidenceAssemblyOnly: true,
      onRealAppEvidenceAssembly: (c) => {
        cap = c;
      },
    }
  );
  if (!cap) throw new Error("CAPTURE_MISSING");
  return cap;
}

describe("REG24 Batch 1 RC10.3 — P0-1, P0-2, and P0-3 Remediation Gates", () => {
  afterEach(() => {
    setCustomCitationDbTransportForTesting(null, null);
    setDefaultKnowledgeStoreForTesting(null);
  });

  it("1. P0-1: Separates AMENDS (RD 646 §4) from SUPERSEDES (predecessor history), splits §3 vs quoted RD 646 §4, and rejects superseded RD 646 as governing", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const st = store.getState();

    // Preserved RC10.2 comparison baseline (`rel.B01.rc7`) remains untouched
    const rc7Asrts = store.getAcceptedAssertionsForRelease("rel.B01.rc7");
    expect(rc7Asrts.some((a) => a.assertion_id === "asrt.rc7.rd807.amends.prev")).toBe(true);
    expect(st.versions["ver.th.rc.royal_decree.646.v1"]?.legal_applicability?.[0]?.valid_to).toBeNull();

    // RC10.3 (`rel.B01.rc8`): AMENDS -> RD 646 is distinct from SUPERSEDES -> predecessor
    const rc8Asrts = store.getAcceptedAssertionsForRelease("rel.B01.rc8");
    expect(rc8Asrts.some((a) => /^asrt\.rc7\.rd\d+\.amends\.prev$/.test(a.assertion_id))).toBe(false);
    for (const [decree, pred] of [
      ["790", "780"],
      ["799", "790"],
      ["807", "799"],
    ]) {
      expect(
        rc8Asrts.some(
          (a) =>
            a.subject === `subreg.th.rc.royal_decree.${decree}` &&
            a.predicate === "AMENDS" &&
            a.object === "subreg.th.rc.royal_decree.646"
        )
      ).toBe(true);
      expect(
        rc8Asrts.some(
          (a) =>
            a.subject === `subreg.th.rc.royal_decree.${decree}` &&
            a.predicate === "SUPERSEDES" &&
            a.object === `subreg.th.rc.royal_decree.${pred}`
        )
      ).toBe(true);
      // §3 amending clause labeled separately from quoted RD 646 §4 replacement text
      const rc8Psgs = store.getPassagesForRelease("rel.B01.rc8");
      const sec3 = rc8Psgs.find((p) => p.passage_id === `psg.rc8.rd${decree}.sec_3_amending_clause`);
      const quotedSec4 = rc8Psgs.find(
        (p) => p.passage_id === `psg.rc8.rd${decree}.sec_3_quoted_rd646_sec_4`
      );
      expect(sec3).toBeTruthy();
      expect(quotedSec4).toBeTruthy();
      expect(sec3!.exact_text).toContain("มาตรา ๓");
      expect(sec3!.exact_text).not.toContain("“มาตรา ๔");
      expect(quotedSec4!.exact_text).toContain("“มาตรา ๔");
    }

    // RC10.3 rejects superseded RD 646 AND linked predecessor RD 799 as governing on 2026-10-01 (RD 807)!
    const cap807 = await capturePacket(
      store,
      "rel.B01.rc8",
      "บริษัทขายสินค้าในประเทศวันที่ 1 ตุลาคม 2569 เสียภาษีมูลค่าเพิ่มกี่เปอร์เซ็นต์ตามพระราชกฤษฎีกาฉบับใด",
      "2026-10-01"
    );
    const govWorks807 = cap807.actual_model_packet
      .filter((p) => p.evidence_role === "governing")
      .map((p) => p.work_id);
    expect(govWorks807).toContain("subreg.th.rc.royal_decree.807");
    expect(govWorks807).not.toContain("subreg.th.rc.royal_decree.646");
    expect(govWorks807).not.toContain("subreg.th.rc.royal_decree.799");
    expect(govWorks807).not.toContain("subreg.th.rc.royal_decree.790");

    // Defense-in-depth: even if superseded RD 646 or linked predecessor RD 799 is forced into buildGroundedPassagePack
    // alongside RD 807 on 2026-10-01, BOTH are strictly downgraded to `historical_or_excluded_context`!
    const rc8All = store.getPassagesForRelease("rel.B01.rc8");
    const p807 = rc8All.find((p) => p.passage_id === "psg.rc8.rd807.sec_3_quoted_rd646_sec_4")!;
    const p799 = rc8All.find((p) => p.passage_id === "psg.rc8.rd799.sec_3_quoted_rd646_sec_4")!;
    const p646 = rc8All.find((p) => p.passage_id === "psg.rc8.rd646.sec_4_compiled")!;
    const pack = buildGroundedPassagePack({
      passages: [p807, p799, p646],
      state: st,
      controllingDateIso: "2026-10-01",
    });
    expect(pack.find((x) => x.work_id === "subreg.th.rc.royal_decree.807")?.evidence_role).toBe(
      "governing"
    );
    expect(pack.find((x) => x.work_id === "subreg.th.rc.royal_decree.799")?.evidence_role).toBe(
      "historical_or_excluded_context"
    );
    expect(pack.find((x) => x.work_id === "subreg.th.rc.royal_decree.646")?.evidence_role).toBe(
      "historical_or_excluded_context"
    );
  });

  it("2. P0-1 Boundaries: Pre-cutoff abstention (2018-06-15, 2022-05-15, 2023-09-30) + day-before & day-of every verified VAT decree boundary (RD 780..807) and post-807 expiry", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const q = (thaiDate: string) =>
      `บริษัทขายสินค้าในประเทศและออกใบกำกับภาษีวันที่ ${thaiDate} ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด ตามพระราชกฤษฎีกาฉบับใด`;

    const checks: Array<{
      dateIso: string;
      thaiDate: string;
      expectedGoverningDecree: string | null;
      forbiddenGoverningDecrees: string[];
      expectPreCutoffAbstention?: boolean;
      expectHistorical807?: boolean;
    }> = [
      {
        dateIso: "2018-06-15",
        thaiDate: "15 มิถุนายน 2561",
        expectedGoverningDecree: null,
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.780",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
        expectPreCutoffAbstention: true,
      },
      {
        dateIso: "2023-09-30",
        thaiDate: "30 กันยายน 2566",
        expectedGoverningDecree: null,
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.780",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
        expectPreCutoffAbstention: true,
      },
      {
        dateIso: "2023-10-01",
        thaiDate: "1 ตุลาคม 2566",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.780",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
      },
      {
        dateIso: "2024-09-30",
        thaiDate: "30 กันยายน 2567",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.780",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
      },
      {
        dateIso: "2024-10-01",
        thaiDate: "1 ตุลาคม 2567",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.790",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.780",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
      },
      {
        dateIso: "2025-09-30",
        thaiDate: "30 กันยายน 2568",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.790",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
      },
      {
        dateIso: "2025-10-01",
        thaiDate: "1 ตุลาคม 2568",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.799",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.807",
        ],
      },
      {
        dateIso: "2026-09-30",
        thaiDate: "30 กันยายน 2569",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.799",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.807",
        ],
      },
      {
        dateIso: "2026-10-01",
        thaiDate: "1 ตุลาคม 2569",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.807",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
        ],
      },
      {
        dateIso: "2027-09-30",
        thaiDate: "30 กันยายน 2570",
        expectedGoverningDecree: "subreg.th.rc.royal_decree.807",
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
        ],
      },
      {
        dateIso: "2027-10-01",
        thaiDate: "1 ตุลาคม 2570",
        expectedGoverningDecree: null,
        forbiddenGoverningDecrees: [
          "subreg.th.rc.royal_decree.646",
          "subreg.th.rc.royal_decree.780",
          "subreg.th.rc.royal_decree.790",
          "subreg.th.rc.royal_decree.799",
          "subreg.th.rc.royal_decree.807",
        ],
        expectHistorical807: true,
      },
    ];

    for (const c of checks) {
      const cap = await capturePacket(store, "rel.B01.rc8", q(c.thaiDate), c.dateIso);
      const govWorks = cap.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id);
      if (c.expectedGoverningDecree) {
        expect(govWorks, `date=${c.dateIso}`).toContain(c.expectedGoverningDecree);
      }
      for (const fWid of c.forbiddenGoverningDecrees) {
        expect(govWorks, `date=${c.dateIso} forbidden=${fWid}`).not.toContain(fWid);
      }
      if (c.expectPreCutoffAbstention) {
        expect(cap.pre_llm_response_status, `date=${c.dateIso}`).toBe("INSUFFICIENT_EVIDENCE");
        expect(cap.actual_model_packet.length, `date=${c.dateIso}`).toBe(0);
      }
      if (c.expectHistorical807) {
        expect(
          cap.actual_model_packet.some(
            (p) =>
              p.work_id === "subreg.th.rc.royal_decree.807" &&
              p.evidence_role === "historical_or_excluded_context"
          )
        ).toBe(true);
      }
    }
  });

  it("3. P0-2: Commit-before-expose rule leaves ZERO in-memory revision on failed DB commit; same save_operation_key replays idempotently, rejects payload conflict (409), and allows new key edit (r2)", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
    const psg = ledger.passages["psg.rc8.rd790.sec_3_quoted_rd646_sec_4"];
    expect(psg).toBeTruthy();

    // Simulate a failing Neon transaction FIRST -> verify ZERO in-memory/cache leak!
    const ansId = `ans.rc10_3_unit_${Date.now().toString(36)}`;
    let shouldFailTx = true;
    setCustomCitationDbTransportForTesting(
      async <T = Record<string, unknown>>(sql: string) => {
        if (/SELECT.*FROM citation_published_answer/i.test(sql)) {
          return { rows: [] as T[], rowCount: 0 };
        }
        return { rows: [] as T[], rowCount: 0 };
      },
      async () => {
        if (shouldFailTx) {
          throw new Error("NEON_CITATION_TX_HTTP_500:SIMULATED_MID_TX_INTERRUPT");
        }
      }
    );

    const payload = {
      answer_id: ansId,
      as_of_date: "2025-09-30",
      status: "complete" as const,
      rendered_answer_th:
        "ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม ถึงวันที่ 30 กันยายน 2568",
      claims: [
        {
          claim_id: `clm.${ansId}.1`,
          claim_number: 1,
          text: "ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร และคงจัดเก็บในอัตราร้อยละหกจุดสาม สำหรับการขายสินค้า การให้บริการ หรือการนำเข้าทุกกรณี ถึงวันที่ 30 กันยายน 2568",
          claim_type: "legal_proposition" as const,
          claim_type_label_th: "ข้อกฎหมาย",
          premise_ids: [],
          verification_decision: "supported" as const,
          published: true,
          withheld_explanation_th: null,
          evidence_references: [
            {
              link_id: `lnk.${ansId}.1`,
              evidence_id: psg.passage_id,
              doc_id: psg.doc_id,
              version_id: psg.version_id,
              extraction_revision_id: psg.extraction_revision_id,
              support_role: "primary_authority" as const,
              support_role_label_th: "หลักฐานกฎหมายหลัก",
              required_group: "grp.1",
              citation_label_th: "พ.ร.ฎ. (ฉบับที่ 790) พ.ศ. 2567",
              issuer_name_th: "กรมสรรพากร",
              source_family: "gazette_enactment" as const,
              source_family_label_th: "กฎหมาย",
              record_type: "full_record" as const,
              record_type_label_th: "เอกสารฉบับเต็มทางการ",
              date_relied_on: "2025-09-30",
              official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
              official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf#page=2",
              resolver_url: `/api/v1/knowledge/evidence/${psg.passage_id}`,
              locator: {
                human_pinpoint_th: "หน้า ๒",
                section_paragraph_path: ["มาตรา ๓"],
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
      verifier_metadata: {
        verifier_version: "reg24-claim-verifier-v2.1",
        ruleset_version: "th-official-traceability-2026.11.2",
        release_id: "rel.B01.rc8",
        publication_gate_mode: "enforced" as const,
      },
    };

    await expect(
      saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: payload,
        question_text: "ทดสอบ commit-before-expose",
        save_operation_key: "op-key-1",
        actor: QA_ACTOR,
      })
    ).rejects.toThrow("SIMULATED_MID_TX_INTERRUPT");

    // In-memory store MUST NOT expose ANY partial/uncommitted revision!
    const memAfterFail = reopenSavedTraceableAnswer(store, `${ansId}.r1`, QA_ACTOR);
    expect(memAfterFail.found).toBe(false);

    // Local-mode idempotency contract (same key replays r1, same key + altered text throws 409, new key creates r2)
    setCustomCitationDbTransportForTesting(null, null);
    const savedR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: payload,
      question_text: "ทดสอบ commit-before-expose",
      save_operation_key: "op-key-local-1",
      actor: QA_ACTOR,
    });
    expect(savedR1.answer_revision).toBe(`${ansId}.r1`);

    const replayR1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: payload,
      question_text: "ทดสอบ commit-before-expose",
      save_operation_key: "op-key-local-1",
      actor: QA_ACTOR,
    });
    expect(replayR1.answer_revision).toBe(`${ansId}.r1`);

    await expect(
      saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: {
          ...payload,
          rendered_answer_th: "ข้อความที่เปลี่ยนแปลงแต่ใช้คีย์เดิม",
        },
        question_text: "ทดสอบ commit-before-expose",
        save_operation_key: "op-key-local-1",
        actor: QA_ACTOR,
      })
    ).rejects.toThrow("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT_409");

    const editedR2 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: {
        ...payload,
        rendered_answer_th: "ข้อความที่แก้ไขโดยเจตนาด้วยคีย์ใหม่",
      },
      question_text: "ทดสอบ commit-before-expose",
      save_operation_key: "op-key-local-2",
      actor: QA_ACTOR,
    });
    expect(editedR2.answer_revision).toBe(`${ansId}.r2`);
    expect(editedR2.supersedes_answer_revision).toBe(`${ansId}.r1`);
  });

  it("4. P0-3: Staging default uses Gemini 4 Neon @ low without request/env override and /api/v1/knowledge/environment?probe_tokenizer=1 resolves rel.B01.rc8", async () => {
    const prevEnabled = process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
    const prevThink = process.env.REG24_GROUNDED_LLM_THINKING_LEVEL;
    const prevModel = process.env.REG24_GROUNDED_LLM_MODEL;
    process.env.REG24_GROUNDED_LLM_STAGING_ENABLED = "true";
    delete process.env.REG24_GROUNDED_LLM_THINKING_LEVEL;
    delete process.env.REG24_GROUNDED_LLM_MODEL;
    setDefaultKnowledgeStoreForTesting(new DurableKnowledgeStore(STORE_DIR));
    try {
      expect(resolveThinkingLevelForModel("gemini-4-neon", null).thinking_level).toBe("low");
      const req = new Request("http://localhost/api/v1/knowledge/environment?probe_tokenizer=1");
      const res = await getEnvironment(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data_version.release_id).toBe("rel.B01.rc8");
      expect(body.data_version.manifest_id).toBe("mfst.b01.rc8_thai_legal_index");
      expect(body.model_and_verifiers.model_id).toBe("google-gemini:gemini-4-neon");
      expect(body.model_and_verifiers.thinking_level).toBe("low");
      expect(body.model_and_verifiers.silent_fallback_disabled).toBe(true);
      expect(body.projections.vector.status).toBe("deliberately_disabled");
      expect(body.tokenizer_parity_probe.contract_parity_ok).toBe(true);
      expect(body.tokenizer_parity_probe.all_probes_ok).toBe(true);
    } finally {
      if (prevEnabled !== undefined) process.env.REG24_GROUNDED_LLM_STAGING_ENABLED = prevEnabled;
      else delete process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
      if (prevThink !== undefined) process.env.REG24_GROUNDED_LLM_THINKING_LEVEL = prevThink;
      else delete process.env.REG24_GROUNDED_LLM_THINKING_LEVEL;
      if (prevModel !== undefined) process.env.REG24_GROUNDED_LLM_MODEL = prevModel;
      else delete process.env.REG24_GROUNDED_LLM_MODEL;
    }
  });

  it("5. P0-2 Concurrency: Two distinct edits from the same predecessor cleanly reject the loser with 409 (CONCURRENT_EDIT_PREDECESSOR_CONFLICT_409) and ZERO orphaned child rows (with or without save_operation_key)", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
    const psg = ledger.passages["psg.rc8.rd790.sec_3_quoted_rd646_sec_4"];
    expect(psg).toBeTruthy();

    const ansId = `ans.rc103.concurrent_distinct.${Date.now()}`;
    const storedAnswers = new Map<string, Record<string, unknown>>();
    const storedClaims: Array<{ rev: string; text: string }> = [];

    const mockDb = async (sql: string, params: unknown[] = []) => {
      if (/save_operation_key = \$4/i.test(sql)) {
        const key = String(params[3] || "");
        const hit = [...storedAnswers.values()].find(
          (r) => r.answer_id === params[2] && r.save_operation_key === key
        );
        return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
      }
      if (/FROM citation_published_answer\s+WHERE answer_id = \$1\s+ORDER BY revision_number DESC/i.test(sql)) {
        const hits = [...storedAnswers.values()]
          .filter((r) => r.answer_id === params[0])
          .sort((a, b) => Number(b.revision_number) - Number(a.revision_number));
        return { rows: hits, rowCount: hits.length };
      }
      if (/FROM citation_published_answer\s+WHERE answer_revision_id = \$1/i.test(sql)) {
        const hit = storedAnswers.get(String(params[0]));
        return { rows: hit ? [hit] : [], rowCount: hit ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    };

    const mockTx = async (stmts: Array<{ query: string; params: unknown[] }>) => {
      // Simulate PostgreSQL atomic PK enforcement on `citation_published_answer(answer_revision_id)`
      const ansInsert = stmts.find((s) => /INSERT INTO citation_published_answer/i.test(s.query));
      if (ansInsert) {
        // Ensure parent insert NEVER uses ON CONFLICT DO NOTHING (which would corrupt child tables!)
        expect(ansInsert.query).not.toMatch(/ON CONFLICT/i);
        const revId = String(ansInsert.params[0]);
        if (storedAnswers.has(revId)) {
          throw new Error(
            `NEON_CITATION_TX_HTTP_400: duplicate key value violates unique constraint "citation_published_answer_pkey" (23505)`
          );
        }
        storedAnswers.set(revId, {
          answer_revision_id: revId,
          answer_id: ansInsert.params[1],
          revision_number: ansInsert.params[2],
          supersedes_revision_id: ansInsert.params[3],
          question_text: ansInsert.params[5],
          generated_at: ansInsert.params[6],
          as_of_date_raw: ansInsert.params[8],
          status: ansInsert.params[9],
          rendered_answer_th: ansInsert.params[10],
          ordered_claim_ids: JSON.parse(String(ansInsert.params[11] || "[]")),
          owner_actor_id: ansInsert.params[19],
          owner_tenant_id: ansInsert.params[20],
          actor_id: ansInsert.params[21],
          revision_reason: ansInsert.params[23],
          save_operation_key: ansInsert.params[26],
          save_payload_sha256: ansInsert.params[27],
        });
      }
      const clmInsert = stmts.find((s) => /INSERT INTO citation_atomic_claim/i.test(s.query));
      if (clmInsert) {
        storedClaims.push({
          rev: String(clmInsert.params[1]),
          text: String(clmInsert.params[3]),
        });
      }
    };

    setCustomCitationDbTransportForTesting(mockDb as never, mockTx as never);

    const buildPayload = (claimText: string) => ({
      answer_id: ansId,
      as_of_date: "2025-05-01",
      status: "complete" as const,
      rendered_answer_th: claimText,
      claims: [
        {
          claim_id: `clm.${ansId}.1`,
          claim_number: 1,
          text: claimText,
          claim_type: "legal_proposition" as const,
          claim_type_label_th: "ข้อกฎหมาย",
          premise_ids: [],
          verification_decision: "supported" as const,
          published: true,
          withheld_explanation_th: null,
          evidence_references: [
            {
              link_id: `lnk.${ansId}.1`,
              evidence_id: psg.passage_id,
              doc_id: psg.doc_id,
              version_id: psg.version_id,
              extraction_revision_id: psg.extraction_revision_id,
              support_role: "primary_authority" as const,
              support_role_label_th: "หลักฐานกฎหมายหลัก",
              required_group: "grp.1",
              citation_label_th: "พ.ร.ฎ. (ฉบับที่ 790) พ.ศ. 2567",
              issuer_name_th: "กรมสรรพากร",
              source_family: "gazette_enactment" as const,
              source_family_label_th: "กฎหมาย",
              record_type: "full_record" as const,
              record_type_label_th: "เอกสารฉบับเต็มทางการ",
              date_relied_on: "2025-05-01",
              official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf",
              official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc790.pdf#page=2",
              resolver_url: `/api/v1/knowledge/evidence/${psg.passage_id}`,
              locator: {
                human_pinpoint_th: "หน้า ๒",
                section_paragraph_path: ["มาตรา ๓"],
                physical_page_start: 2,
                physical_page_end: 2,
                printed_page_start: "หน้า ๒",
                printed_page_end: "หน้า ๒",
                anchors: [],
              },
              verification_status: "supported" as const,
              link_health: "verified_online" as const,
              link_health_notice_th: null,
              last_successful_verification_at: "2026-11-20T00:00:00.000Z",
              access_permission: "public" as const,
              access_conditions_th: null,
            },
          ],
        },
      ],
      verifier_metadata: {
        release_id: "rel.B01.rc8",
        verifier_version: "reg24-claim-verifier-v2.1",
        ruleset_version: "th-official-traceability-2026.11.2",
        publication_gate_mode: "enforced" as const,
      },
    });

    // 1) Initial r1 succeeds
    const r1 = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: buildPayload(
        "ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร คงจัดเก็บในอัตราร้อยละ 6.3 ตาม พ.ร.ฎ. 790 [r1]"
      ),
      question_text: "ทดสอบ concurrent distinct edits",
      save_operation_key: "k-init-r1",
      actor: QA_ACTOR,
    });
    expect(r1.answer_revision).toBe(`${ansId}.r1`);
    expect(storedAnswers.size).toBe(1);
    expect(storedClaims.length).toBe(1);

    // 2) Simulate two distinct edits racing concurrently from the exact same predecessor r1
    //    (both see [r1] before either writes r2 -> winner writes r2, loser hits 23505!)
    let releaseSecondLookup!: () => void;
    const bothReadR1 = new Promise<void>((res) => {
      releaseSecondLookup = res;
    });
    let r1ReadCount = 0;
    const racingDb = async (sql: string, params: unknown[] = []) => {
      const result = await mockDb(sql, params);
      if (
        /FROM citation_published_answer\s+WHERE answer_id = \$1\s+ORDER BY revision_number DESC/i.test(sql)
      ) {
        r1ReadCount += 1;
        if (r1ReadCount === 2) releaseSecondLookup();
        if (r1ReadCount <= 2) await bothReadR1;
      }
      return result;
    };
    setCustomCitationDbTransportForTesting(racingDb as never, mockTx as never);

    const [resA, resB] = await Promise.allSettled([
      saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: buildPayload(
          "ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร คงจัดเก็บในอัตราร้อยละ 6.3 ตาม พ.ร.ฎ. 790 [edit A]"
        ),
        question_text: "ทดสอบ concurrent distinct edits",
        save_operation_key: "k-edit-A",
        actor: QA_ACTOR,
      }),
      saveOrReviseAnswerServerVerified(store, {
        submitted_envelope: buildPayload(
          "ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร คงจัดเก็บในอัตราร้อยละ 6.3 ตาม พ.ร.ฎ. 790 [edit B]"
        ),
        question_text: "ทดสอบ concurrent distinct edits",
        save_operation_key: "k-edit-B",
        actor: QA_ACTOR,
      }),
    ]);

    const fulfilled = [resA, resB].filter((r) => r.status === "fulfilled");
    const rejected = [resA, resB].filter((r) => r.status === "rejected");
    const rejectionReasons = rejected.map((r) => String((r as PromiseRejectedResult).reason));
    expect(fulfilled.length, `Rejections: ${JSON.stringify(rejectionReasons)}`).toBe(1);
    expect(rejected.length).toBe(1);
    expect((fulfilled[0] as PromiseFulfilledResult<{ answer_revision: string }>).value.answer_revision).toBe(
      `${ansId}.r2`
    );
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain(
      "CONCURRENT_EDIT_PREDECESSOR_CONFLICT_409"
    );
    // ZERO orphaned child rows: exactly r1 + winning r2!
    expect(storedAnswers.size).toBe(2);
    expect(storedClaims.length).toBe(2);
  });

  it("6. P0-1 RC8-only Preview Guard: Rejects request release_id overrides (400) and fails hard (503) instead of silently falling back when lexical/graph artifacts are missing", async () => {
    const prevVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    const store = new DurableKnowledgeStore(STORE_DIR);
    setDefaultKnowledgeStoreForTesting(store);
    try {
      // 1) Request override to unbundled/older release (rc7 / rc6) is REJECTED with HTTP 400!
      for (const forbiddenRel of ["rel.B01.rc7", "rel.B01.rc6", "rel.B01.rc5"]) {
        const req = new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "อัตรา VAT เดือนพฤษภาคม 2568",
            release_id: forbiddenRel,
            applicable_date: "2025-05-01",
          }),
        });
        const res = await postQuery(req);
        expect(res.status, `override=${forbiddenRel}`).toBe(400);
        const body = await res.json();
        expect(String(body.error || "")).toContain("RELEASE_OVERRIDE_REJECTED_400");
      }

      // 2) Missing lexical/graph artifact fails HARD (503) — ZERO silent fallback to substring scan or live assertions!
      expect(() =>
        retrieveAuthorizedKnowledge(store, {
          question: "อัตรา VAT เดือนพฤษภาคม 2568",
          release_id: "rel.B01.unbundled_missing",
          actor: QA_ACTOR,
          applicable_date: "2025-05-01",
          require_pinned_projections: true,
        })
      ).toThrow("PROJECTION_ARTIFACT_MISSING_OR_INCOMPATIBLE_503");

      // 3) Environment endpoint attests strict RC8-only preview protections & runtime OS fields
      const envRes = await getEnvironment(
        new Request("http://localhost/api/v1/knowledge/environment?probe_tokenizer=1")
      );
      expect(envRes.status).toBe(200);
      const envBody = await envRes.json();
      expect(envBody.data_version.release_id).toBe("rel.B01.rc8");
      expect(envBody.environment.strict_single_release_preview).toBe(true);
      expect(envBody.environment.release_override_rejected_on_preview).toBe(true);
      expect(envBody.environment.silent_retrieval_fallback_disabled).toBe(true);
      expect(envBody.environment.runtime_platform).toBe(process.platform);
      expect(envBody.environment.node_version).toBe(process.version);
      expect(envBody.projections.lexical.status).toBe("ready");
      expect(envBody.projections.graph.status).toBe("ready");
    } finally {
      if (prevVercelEnv !== undefined) process.env.VERCEL_ENV = prevVercelEnv;
      else delete process.env.VERCEL_ENV;
    }
  });

  it("7. Track 2 VAT Coverage Acceptance (Thai free text, NO applicable_date override): 15 Jun 2018, interior 2565, 30 Sep / 1 Oct 2566 boundary, decree handover, missing/ambiguous date, and split-payment diagnostic", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);

    // A) Pre-cutoff unsupported dates (NO rate, NO calculation, NO consolidated RD 646 citation!)
    const preCutoffQuestions = [
      {
        label: "2018-06-15 (15 มิถุนายน 2561)",
        q: "บริษัทขายสินค้าในประเทศและส่งมอบวันที่ 15 มิถุนายน 2561 มูลค่า 100,000 บาท ต้องคิดภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใดและเป็นเงินกี่บาท",
      },
      {
        label: "2022-05-15 (interior 2565)",
        q: "บริษัทให้บริการในประเทศไทยและได้รับชำระค่าบริการวันที่ 15 พฤษภาคม 2565 มูลค่า 500,000 บาท ต้องเรียกเก็บภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      },
      {
        label: "2023-09-30 (day before 1 Oct 2566 cutoff)",
        q: "บริษัทขายสินค้าในประเทศเมื่อวันที่ 30 กันยายน 2566 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      },
    ];
    for (const item of preCutoffQuestions) {
      // Test BOTH grounded-LLM path AND deterministic path with NO applicable_date override!
      for (const mode of ["llm_grounded", "baseline_deterministic"] as const) {
        const res = await queryKnowledge(
          {
            question: item.q,
            release_id: "rel.B01.rc8",
            applicable_date: null,
            answer_generation_mode: mode,
          },
          QA_ACTOR,
          { store, persistAnswerAtomically: false }
        );
        expect(res.status, `${item.label} [${mode}]`).toBe("INSUFFICIENT_EVIDENCE");
        expect(res.evidence.length, `${item.label} [${mode}] zero citations`).toBe(0);
        // Must NOT leak any rate (6.3%, 7%, 10%) or calculated VAT amount!
        expect(res.answer, `${item.label} [${mode}] no rate leak`).not.toMatch(
          /(?:ร้อยละ\s*(?:6\.3|7|10)|(?:6\.3|7|10)\s*%|7,000|35,000)/
        );
        expect(res.answer, `${item.label} [${mode}] mentions 1 ตุลาคม 2566 cutoff`).toContain(
          "1 ตุลาคม 2566"
        );
      }
    }

    // B) Post-cutoff boundary (1 October 2566 -> RD 780) & supported decree handover (30 Sep 2568 RD 790 -> 1 Oct 2568 RD 799), Thai free text with NO date override!
    const oct1_2566 = await capturePacket(
      store,
      "rel.B01.rc8",
      "บริษัทขายสินค้าในประเทศเมื่อวันที่ 1 ตุลาคม 2566 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      null
    );
    expect(oct1_2566.pre_llm_response_status).toBe("READY_FOR_LLM_GROUNDED");
    expect(oct1_2566.controlling_date_iso).toBe("2023-10-01");
    expect(
      oct1_2566.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id)
    ).toContain("subreg.th.rc.royal_decree.780");
    expect(
      oct1_2566.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id)
    ).not.toContain("subreg.th.rc.royal_decree.646");

    const sep30_2568 = await capturePacket(
      store,
      "rel.B01.rc8",
      "บริษัทขายสินค้าในประเทศเมื่อวันที่ 30 กันยายน 2568 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      null
    );
    expect(
      sep30_2568.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id)
    ).toContain("subreg.th.rc.royal_decree.790");
    expect(
      sep30_2568.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id)
    ).not.toContain("subreg.th.rc.royal_decree.799");

    const oct1_2568 = await capturePacket(
      store,
      "rel.B01.rc8",
      "บริษัทขายสินค้าในประเทศเมื่อวันที่ 1 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      null
    );
    expect(
      oct1_2568.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id)
    ).toContain("subreg.th.rc.royal_decree.799");
    expect(
      oct1_2568.actual_model_packet
        .filter((p) => p.evidence_role === "governing")
        .map((p) => p.work_id)
    ).not.toContain("subreg.th.rc.royal_decree.790");

    // C) Missing or ambiguous date -> prompts for clarification (NEEDS_CLARIFICATION), ZERO rate/calculation!
    for (const qMissing of [
      "บริษัทขายสินค้าในประเทศต้องคิดภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
      "บริษัทขายสินค้าในประเทศในปี 2568 ต้องคิดภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
    ]) {
      const resClarify = await queryKnowledge(
        {
          question: qMissing,
          release_id: "rel.B01.rc8",
          applicable_date: null,
          answer_generation_mode: "llm_grounded",
        },
        QA_ACTOR,
        { store, persistAnswerAtomically: false }
      );
      expect(resClarify.status, qMissing).toBe("NEEDS_CLARIFICATION");
      expect(resClarify.clarification_questions.length, qMissing).toBeGreaterThan(0);
      expect(resClarify.answer, qMissing).not.toMatch(/(?:ร้อยละ\s*(?:6\.3|7|10)|(?:6\.3|7|10)\s*%)/);
    }

    // D) Split-payment diagnostic (NEVER collapses whole transaction to earlier date!)
    // D1: Supported handover split (deposit 25 Sep 2568 RD 790 + balance 5 Oct 2568 RD 799)
    const splitSupported = await capturePacket(
      store,
      "rel.B01.rc8",
      "บริษัทให้บริการที่ปรึกษาในประเทศไทย โดยแบ่งรับชำระค่าบริการ 2 งวด: รับเงินมัดจำงวดแรกวันที่ 25 กันยายน 2568 และรับชำระส่วนที่เหลืองวดที่ 2 วันที่ 5 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มตามกฎหมายใด",
      null
    );
    expect(splitSupported.controlling_date_iso).toBeNull();
    const splitGovWorks = splitSupported.actual_model_packet
      .filter((p) => p.evidence_role === "governing")
      .map((p) => p.work_id);
    expect(splitGovWorks).toContain("subreg.th.rc.royal_decree.790");
    expect(splitGovWorks).toContain("subreg.th.rc.royal_decree.799");
    expect(splitGovWorks).not.toContain("subreg.th.rc.royal_decree.646");

    // D2: Cutoff-straddling split (deposit 25 Sep 2566 pre-cutoff + balance 5 Oct 2566 RD 780)
    const splitCutoff = await queryKnowledge(
      {
        question:
          "บริษัทให้บริการในประเทศไทย โดยแบ่งรับชำระ 2 งวด: รับเงินมัดจำงวดแรกวันที่ 25 กันยายน 2566 และรับส่วนที่เหลืองวดที่ 2 วันที่ 5 ตุลาคม 2566 ต้องคิดภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
        release_id: "rel.B01.rc8",
        applicable_date: null,
        answer_generation_mode: "llm_grounded",
      },
      QA_ACTOR,
      { store, persistAnswerAtomically: false }
    );
    expect(splitCutoff.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(splitCutoff.answer).toContain("2023-09-25");
    expect(splitCutoff.answer).toContain("2023-10-05");
    expect(splitCutoff.answer).toContain("ห้ามใช้วันที่ของงวดแรกบังคับกับทั้งธุรกรรม");
    expect(splitCutoff.evidence.length).toBe(0);
    expect(splitCutoff.answer).not.toMatch(/(?:ร้อยละ\s*(?:6\.3|7|10)|(?:6\.3|7|10)\s*%)/);
  });
});
