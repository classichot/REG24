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
import { verifyAndRenderGroundedLlmDraft } from "../../src/core/knowledge/grounded-llm-verifier";
import { buildStructuredCaseFactLedger } from "../../src/core/knowledge/case-fact-ledger";
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

  it("8. Per-Tax-Point Authority & Validity Regressions: RD 807 expiry split (30 Sep / 1 Oct 2570), normal decree handover split, cutoff-straddling split, prior-invoice fixation, and verifier negative control", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const state = store.getState();

    // 1) RD 807 expiry split (฿40,000 paid 30 Sep 2570 + ฿60,000 paid 1 Oct 2570, no earlier invoice/use)
    const expiryQ =
      "บริษัท เอเพ็กซ์ คอนซัลติ้ง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยแก่ลูกค้าในกรุงเทพมหานครซึ่งใช้บริการทั้งหมดในประเทศไทย โดยไม่มีการออกใบกำกับภาษีหรือใช้บริการก่อนวันรับชำระเงิน ลูกค้าแบ่งชำระค่าบริการ 2 งวด คือ ชำระงวดแรก 40,000 บาท เมื่อวันที่ 30 กันยายน 2570 และชำระงวดที่สอง 60,000 บาท เมื่อวันที่ 1 ตุลาคม 2570 แต่ละงวดต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใดและตามกฎหมายฉบับใด";
    const expiryCap = await capturePacket(store, "rel.B01.rc8", expiryQ, null);
    expect(expiryCap.controlling_date_iso).toBeNull();
    const rd807Entries = expiryCap.actual_model_packet.filter(
      (p) => p.work_id === "subreg.th.rc.royal_decree.807"
    );
    expect(rd807Entries.length).toBeGreaterThan(0);
    // Portion 1 (2027-09-30) MUST retain RD 807 as governing; Portion 2 (2027-10-01) MUST be marked excluded!
    for (const entry of rd807Entries) {
      expect(entry.evidence_role).toBe("governing");
      expect(entry.applicable_tax_point_dates).toEqual(["2027-09-30"]);
      expect(entry.excluded_tax_point_dates).toEqual(["2027-10-01"]);
    }

    // Verify through real grounded-LLM verifier (final answer + citations, not just pre-model packet!):
    const ledgerExpiry = buildStructuredCaseFactLedger({ question: expiryQ, applicableDate: null });
    expect(ledgerExpiry.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
    expect(ledgerExpiry.temporal_facts.split_payment_tax_points?.map((p) => p.iso_date)).toEqual([
      "2027-09-30",
      "2027-10-01",
    ]);
    const rc80Psg = expiryCap.actual_model_packet.find((p) => p.work_id === "prov.th.rc.80")!;
    const rd807Psg = expiryCap.actual_model_packet.find(
      (p) => p.passage_id === "psg.rc8.rd807.sec_3_quoted_rd646_sec_4"
    )!;
    const rawPassagesById = new Map(
      store.getPassagesForRelease("rel.B01.rc8").map((p) => [p.passage_id, p])
    );
    const packForVerify = buildGroundedPassagePack({
      passages: [rawPassagesById.get(rc80Psg.passage_id)!, rawPassagesById.get(rd807Psg.passage_id)!],
      state,
      controllingDateIso: null,
      splitPaymentTaxPointDates: ["2027-09-30", "2027-10-01"],
    });
    const dummyAudit = {
      provider: "google-gemini" as const,
      api_surface: "interactions-v1beta" as const,
      requested_model: "gemini-4-neon",
      resolved_model: "gemini-4-neon",
      actual_model_invoked: "gemini-4-neon",
      pinned_settings: {
        thinking_level: "low" as const,
        thinking_level_note: null,
        temperature: 0,
        max_output_tokens: 16384,
        timeout_ms: 120000,
        store: false as const,
      },
      prompt_version: "reg24-grounded-llm-legal-application-v1.1",
      live_provider_called: true,
      silent_fallback_disabled: true as const,
      provider_interaction_id: "test-expiry-verify",
      provider_response_status: "completed",
      failure_classification: "NONE" as const,
      latency_ms: 10,
      input_tokens: 100,
      output_tokens: 100,
      thought_tokens: 0,
      total_tokens: 200,
      estimated_cost_usd: 0,
      attempts: [],
      error_summary: null,
    };

    // Valid 2-portion draft: Portion 1 cites RD 807, Portion 2 cites §80 + explicitly notes RD 807 expired!
    // PLUS negative-control Portion 3: erroneously tries to apply RD 807 as governing to 2027-10-01 -> MUST BE REJECTED!
    const verified = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.test.expiry_split",
      factLedger: ledgerExpiry,
      passagePack: packForVerify,
      rawPassagesById,
      state,
      llmOk: true,
      stagingFlagActive: true,
      invocationAudit: dummyAudit,
      draft: {
        answer_status: "CONDITIONAL",
        overall_summary_th: "แยกพิจารณาตามวันรับชำระแต่ละงวด",
        case_facts_used: [
          {
            fact_label_th: "งวดที่ 1",
            original_fact_th: "30 กันยายน 2570 (40,000 บาท)",
            source_turn: 1,
            legal_significance_th: "วันเกิดความรับผิดงวดที่ 1",
          },
          {
            fact_label_th: "งวดที่ 2",
            original_fact_th: "1 ตุลาคม 2570 (60,000 บาท)",
            source_turn: 1,
            legal_significance_th: "วันเกิดความรับผิดงวดที่ 2",
          },
        ],
        issues: [
          {
            issue_id: "iss.portion1",
            issue_title_th: "งวดที่ 1 วันที่ 30 กันยายน 2570 (40,000 บาท)",
            party_or_scope_th: "งวดที่ 1 (2027-09-30)",
            conclusion_th: "ลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บในอัตราร้อยละ 6.3 ตาม พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569",
            material_facts_relied_on: ["รับชำระวันที่ 30 กันยายน 2570"],
            governing_passage_ids: [rc80Psg.passage_id, rd807Psg.passage_id],
            application_explanation_th: "ความรับผิดเกิดขึ้นวันที่ 30 กันยายน 2570 อยู่ในช่วงเวลาของ พ.ร.ฎ. (ฉบับที่ 807) พ.ศ. 2569",
            authority_distinction_note_th: "ประมวลรัษฎากร มาตรา 80 และ พ.ร.ฎ. ฉบับที่ 807",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: null,
          },
          {
            issue_id: "iss.portion2_valid",
            issue_title_th: "งวดที่ 2 วันที่ 1 ตุลาคม 2570 (60,000 บาท)",
            party_or_scope_th: "งวดที่ 2 (2027-10-01)",
            conclusion_th:
              "การให้บริการสำหรับงวดที่ 2 อยู่นอกช่วงเวลาใช้บังคับของพระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 ซึ่งสิ้นสุดในวันที่ 30 กันยายน 2570 จึงไม่อาจนำอัตราลดมาใช้บังคับได้ ต้องเสียภาษีมูลค่าเพิ่มตามอัตราร้อยละ 10.0 แห่งประมวลรัษฎากร มาตรา 80 เว้นแต่จะมีการตราพระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่มฉบับใหม่",
            material_facts_relied_on: ["รับชำระวันที่ 1 ตุลาคม 2570"],
            governing_passage_ids: [rc80Psg.passage_id],
            application_explanation_th:
              "ประมวลรัษฎากร มาตรา 80 กำหนดให้ใช้อัตราภาษีมูลค่าเพิ่มร้อยละ 10.0 สำหรับการขายสินค้าหรือการให้บริการทุกกรณี เมื่อพระราชกฤษฎีกา (ฉบับที่ 807) สิ้นสุดระยะเวลาลดอัตราในวันที่ 30 กันยายน 2570 และไม่ครอบคลุมวันที่ 1 ตุลาคม 2570 จึงไม่อาจนำมาลดอัตราภาษีมูลค่าเพิ่มสำหรับงวดที่ 2 ได้",
            authority_distinction_note_th: "มาตรา 80 แห่งประมวลรัษฎากร (กฎหมายแม่บท)",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: null,
          },
          {
            issue_id: "iss.portion2_bad_inherit",
            issue_title_th: "งวดที่ 2 วันที่ 1 ตุลาคม 2570 (ทดสอบรับช่วง RD 807 ผิดพลาด)",
            party_or_scope_th: "งวดที่ 2 (2027-10-01)",
            conclusion_th: "วันที่ 1 ตุลาคม 2570 ยังคงใช้อัตราลดร้อยละ 6.3 ตาม พ.ร.ฎ. ฉบับที่ 807",
            material_facts_relied_on: ["รับชำระวันที่ 1 ตุลาคม 2570"],
            governing_passage_ids: [rd807Psg.passage_id],
            application_explanation_th: "ใช้อัตราลดตาม พ.ร.ฎ. ฉบับที่ 807 กับงวดที่ 2",
            authority_distinction_note_th: "พ.ร.ฎ. ฉบับที่ 807",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: null,
          },
          {
            issue_id: "iss.portion2_bad_uncited_apply",
            issue_title_th: "งวดที่ 2 วันที่ 1 ตุลาคม 2570 (ทดสอบอ้างใช้ RD 807 โดยไม่แนบและไม่ปฏิเสธ)",
            party_or_scope_th: "งวดที่ 2 (2027-10-01)",
            conclusion_th: "การให้บริการงวดที่ 2 วันที่ 1 ตุลาคม 2570 เสียภาษีมูลค่าเพิ่มตามมาตรา 80 และพระราชกฤษฎีกา (ฉบับที่ 807) ร้อยละ 10.0",
            material_facts_relied_on: ["รับชำระวันที่ 1 ตุลาคม 2570"],
            governing_passage_ids: [rc80Psg.passage_id],
            application_explanation_th: "ใช้พระราชกฤษฎีกา (ฉบับที่ 807) ควบคู่มาตรา 80 สำหรับการให้บริการงวดที่ 2",
            authority_distinction_note_th: "มาตรา 80",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: null,
          },
          {
            issue_id: "iss.portion2_bad_hallucinated_decree",
            issue_title_th: "งวดที่ 2 วันที่ 1 ตุลาคม 2570 (ทดสอบประดิษฐ์เลข พ.ร.ฎ. 999)",
            party_or_scope_th: "งวดที่ 2 (2027-10-01)",
            conclusion_th: "พระราชกฤษฎีกา (ฉบับที่ 999) ไม่ครอบคลุมวันที่ 1 ตุลาคม 2570 จึงเสียภาษีมูลค่าเพิ่มร้อยละ 10.0 ตามมาตรา 80",
            material_facts_relied_on: ["รับชำระวันที่ 1 ตุลาคม 2570"],
            governing_passage_ids: [rc80Psg.passage_id],
            application_explanation_th: "พระราชกฤษฎีกา (ฉบับที่ 999) สิ้นสุดแล้วจึงใช้มาตรา 80 สำหรับการให้บริการงวดที่ 2",
            authority_distinction_note_th: "มาตรา 80",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: null,
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(verified.verified_issues.map((v) => v.issue_id)).toContain("iss.portion1");
    expect(verified.verified_issues.map((v) => v.issue_id)).toContain("iss.portion2_valid");
    expect(
      verified.verified_issues.find((v) => v.issue_id === "iss.portion2_valid")?.governing_passage_ids
    ).toEqual([rc80Psg.passage_id]);
    expect(verified.verified_issues.map((v) => v.issue_id)).not.toContain("iss.portion2_bad_inherit");
    expect(verified.verified_issues.map((v) => v.issue_id)).not.toContain("iss.portion2_bad_uncited_apply");
    expect(verified.verified_issues.map((v) => v.issue_id)).not.toContain("iss.portion2_bad_hallucinated_decree");
    expect(
      verified.audit_trace.rejected_claims.some(
        (r) => r.issue_id === "iss.portion2_bad_inherit" && r.rejection_code === "OUT_OF_EFFECTIVE_DATE_WINDOW"
      )
    ).toBe(true);
    expect(
      verified.audit_trace.rejected_claims.some(
        (r) => r.issue_id === "iss.portion2_bad_uncited_apply" && r.rejection_code === "UNGROUNDED_OR_CONTRADICTED_CLAIM"
      )
    ).toBe(true);
    expect(
      verified.audit_trace.rejected_claims.some(
        (r) => r.issue_id === "iss.portion2_bad_hallucinated_decree" && r.rejection_code === "UNGROUNDED_OR_CONTRADICTED_CLAIM"
      )
    ).toBe(true);

    // 2) Normal decree handover split (25 Sep 2568 RD 790 + 5 Oct 2568 RD 799) -> per-tax-point validity!
    const handoverSplit = await capturePacket(
      store,
      "rel.B01.rc8",
      "บริษัทให้บริการที่ปรึกษาในประเทศไทย โดยไม่มีการออกใบกำกับภาษีหรือใช้บริการก่อนวันรับชำระเงิน ลูกค้าแบ่งชำระ 2 งวด คือ 40,000 บาท วันที่ 25 กันยายน 2568 และ 60,000 บาท วันที่ 5 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มตามกฎหมายใด",
      null
    );
    const rd790Entry = handoverSplit.actual_model_packet.find((p) => p.work_id === "subreg.th.rc.royal_decree.790");
    const rd799Entry = handoverSplit.actual_model_packet.find((p) => p.work_id === "subreg.th.rc.royal_decree.799");
    expect(rd790Entry?.evidence_role).toBe("governing");
    expect(rd790Entry?.applicable_tax_point_dates).toEqual(["2025-09-25"]);
    expect(rd790Entry?.excluded_tax_point_dates).toEqual(["2025-10-05"]);
    expect(rd799Entry?.evidence_role).toBe("governing");
    expect(rd799Entry?.applicable_tax_point_dates).toEqual(["2025-10-05"]);
    expect(rd799Entry?.excluded_tax_point_dates).toEqual(["2025-09-25"]);

    // 3) Prior invoice that already fixes the tax point under §78/1(1) (invoice 25 Sep 2568 BEFORE 2 split payments 30 Sep + 5 Oct 2568!)
    const priorInvQ =
      "บริษัทให้บริการที่ปรึกษาในประเทศไทยแก่ลูกค้าในกรุงเทพมหานคร โดยออกใบกำกับภาษีเต็มจำนวน 100,000 บาท เมื่อวันที่ 25 กันยายน 2568 แต่ลูกค้าแบ่งชำระค่าบริการ 2 งวด คือ งวดแรก 40,000 บาท วันที่ 30 กันยายน 2568 และงวดที่สอง 60,000 บาท วันที่ 5 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มตามพระราชกฤษฎีกาฉบับใด";
    const priorInvCap = await capturePacket(store, "rel.B01.rc8", priorInvQ, null);
    expect(priorInvCap.controlling_date_iso).toBe("2025-09-25");
    const priorInvGovWorks = priorInvCap.actual_model_packet
      .filter((p) => p.evidence_role === "governing")
      .map((p) => p.work_id);
    expect(priorInvGovWorks).toContain("subreg.th.rc.royal_decree.790");
    expect(priorInvGovWorks).not.toContain("subreg.th.rc.royal_decree.799");
  });

  it("9. Partial-Invoice Coverage Rule (§78/1(1)): partial ฿40k invoice of ฿100k service fixes ONLY ฿40k at invoice date (RD 790) without double-taxing settlement payment, while uninvoiced ฿60k uses post-handover payment date (RD 799)", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);

    // 1) Partial invoice WITHOUT repeating 'ใบกำกับภาษี' on payment clause (the exact d4b3e40 collapse bug!)
    const partialNoRepeatQ =
      "บริษัท โอเมก้า จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยแก่ลูกค้าในกรุงเทพมหานครซึ่งใช้บริการทั้งหมดในประเทศไทย มูลค่าสัญญารวม 100,000 บาท โดยไม่มีการใช้บริการก่อนออกใบกำกับภาษีหรือรับชำระเงิน บริษัทออกใบกำกับภาษีเฉพาะบางส่วนจำนวน 40,000 บาท เมื่อวันที่ 25 กันยายน 2568 ต่อมาลูกค้าชำระเงินจำนวน 40,000 บาทนั้นเมื่อวันที่ 30 กันยายน 2568 และชำระส่วนที่เหลืออีก 60,000 บาท เมื่อวันที่ 5 ตุลาคม 2568 แต่ละส่วนต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใดและตามพระราชกฤษฎีกาฉบับใด";
    const ledgerPartial1 = buildStructuredCaseFactLedger({ question: partialNoRepeatQ, applicableDate: null });
    expect(ledgerPartial1.temporal_facts.controlling_tax_point.iso_date).toBeNull();
    expect(ledgerPartial1.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
    expect(ledgerPartial1.temporal_facts.controlling_tax_point.controlling_event).toContain(
      "PARTIAL_INVOICE_MULTI_TAX_POINT"
    );
    // Settlement payment on 2025-09-30 MUST NOT become a 3rd taxable point (no double taxation of invoiced ฿40,000!)
    expect(ledgerPartial1.temporal_facts.split_payment_tax_points?.map((p) => p.iso_date)).toEqual([
      "2025-09-25",
      "2025-10-05",
    ]);
    expect(ledgerPartial1.temporal_facts.split_payment_tax_points?.[0]?.settled_payment_date_iso).toBe(
      "2025-09-30"
    );
    const partialCap1 = await capturePacket(store, "rel.B01.rc8", partialNoRepeatQ, null);
    const rd790P1 = partialCap1.actual_model_packet.find((p) => p.work_id === "subreg.th.rc.royal_decree.790");
    const rd799P1 = partialCap1.actual_model_packet.find((p) => p.work_id === "subreg.th.rc.royal_decree.799");
    expect(rd790P1?.evidence_role).toBe("governing");
    expect(rd790P1?.applicable_tax_point_dates).toEqual(["2025-09-25"]);
    expect(rd790P1?.excluded_tax_point_dates).toEqual(["2025-10-05"]);
    expect(rd799P1?.evidence_role).toBe("governing");
    expect(rd799P1?.applicable_tax_point_dates).toEqual(["2025-10-05"]);
    expect(rd799P1?.excluded_tax_point_dates).toEqual(["2025-09-25"]);

    // 2) Partial invoice settled AFTER decree handover (2025-10-02): must keep invoiced ฿40k at 2025-09-25 (RD 790), NOT shift to RD 799 or double-tax!
    const partialCrossPayQ =
      "บริษัท โอเมก้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท ออกใบกำกับภาษีบางส่วน 40,000 บาท วันที่ 25 กันยายน 2568 แล้วรับชำระยอด 40,000 บาทนั้นวันที่ 2 ตุลาคม 2568 และรับชำระส่วนที่เหลือ 60,000 บาท วันที่ 5 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มอย่างไร";
    const ledgerCross = buildStructuredCaseFactLedger({ question: partialCrossPayQ, applicableDate: null });
    expect(ledgerCross.temporal_facts.controlling_tax_point.iso_date).toBeNull();
    expect(ledgerCross.temporal_facts.split_payment_tax_points?.map((p) => p.iso_date)).toEqual([
      "2025-09-25",
      "2025-10-05",
    ]);
    expect(ledgerCross.temporal_facts.split_payment_tax_points?.[0]?.settled_payment_date_iso).toBe(
      "2025-10-02"
    );

    // 3) English partial invoice phrasing (same coverage rule, language-independent)
    const partialEnQ =
      "A VAT-registered Thai company provides a THB 100,000 domestic consulting service. It issues a tax invoice for only THB 40,000 on 25 September 2025, receives payment of THB 40,000 on 30 September 2025, and receives the remaining THB 60,000 on 5 October 2025. What VAT rate and Royal Decree apply to each portion?";
    const ledgerEn = buildStructuredCaseFactLedger({ question: partialEnQ, applicableDate: null });
    expect(ledgerEn.temporal_facts.controlling_tax_point.iso_date).toBeNull();
    expect(ledgerEn.temporal_facts.split_payment_tax_points?.map((p) => p.iso_date)).toEqual([
      "2025-09-25",
      "2025-10-05",
    ]);

    // 4) Unstated invoice coverage before multi-date split payments: NEVER blindly assume the invoice covered 100%!
    const unstatedCovQ =
      "บริษัท โอเมก้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท ออกใบกำกับภาษีวันที่ 25 กันยายน 2568 และรับชำระเงิน 40,000 บาท วันที่ 30 กันยายน 2568 กับอีก 60,000 บาท วันที่ 5 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มอย่างไร";
    const ledgerUnstated = buildStructuredCaseFactLedger({ question: unstatedCovQ, applicableDate: null });
    expect(ledgerUnstated.temporal_facts.controlling_tax_point.iso_date).toBeNull();
    expect(ledgerUnstated.temporal_facts.controlling_tax_point.is_split_payment_multi_tax_point).toBe(true);
  });

  it("10. Fact-Handling Risk Gates (Thai + English): unstated invoice coverage + one later payment (cross-handover conditional vs same-window sufficient) & same-amount payments with no stated allocation (never infer settlement from equal amounts alone)", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);

    // Risk 1A (Thai + English): Unstated invoice coverage + ONE later payment crossing decree handover (RD 790 -> RD 799)
    // Must NEVER infer full coverage from invoice count (`distinctPaymentDateCount === 1`)!
    const r1Th =
      "บริษัท อัลฟา คอนซัลติ้ง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่าสัญญารวม 100,000 บาท โดยไม่มีการใช้บริการก่อนวันออกใบกำกับภาษีหรือรับชำระเงิน บริษัทออกใบกำกับภาษีเมื่อวันที่ 25 กันยายน 2568 และต่อมาลูกค้าชำระเงินจำนวน 100,000 บาท เมื่อวันที่ 5 ตุลาคม 2568 ต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใดและตามพระราชกฤษฎีกาฉบับใด";
    const r1En =
      "A VAT-registered Thai company provides a THB 100,000 domestic consulting service with no prior service use. It issues a tax invoice on 25 September 2025 (without stating whether it covers the full contract or only part) and receives payment of THB 100,000 on 5 October 2025. What VAT rate and Royal Decree apply?";
    for (const q of [r1Th, r1En]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date).toBeNull();
      expect(l.temporal_facts.controlling_tax_point.controlling_event).toContain(
        "UNSTATED_INVOICE_COVERAGE_CONDITIONAL"
      );
      expect(l.temporal_facts.split_payment_tax_points?.map((p) => p.iso_date)).toEqual([
        "2025-09-25",
        "2025-10-05",
      ]);
      expect(l.explicitly_unknown_facts_th.some((u) => u.includes("2025-09-25"))).toBe(true);
    }
    const r1Cap = await capturePacket(store, "rel.B01.rc8", r1Th, null);
    expect(
      r1Cap.actual_model_packet.some(
        (p) => p.work_id === "subreg.th.rc.royal_decree.790" && p.evidence_role === "governing"
      )
    ).toBe(true);
    expect(
      r1Cap.actual_model_packet.some(
        (p) => p.work_id === "subreg.th.rc.royal_decree.799" && p.evidence_role === "governing"
      )
    ).toBe(true);

    // Risk 1B (Thai + English): Unstated invoice coverage + ONE later payment inside SAME decree window (RD 790)
    // Facts ARE sufficient for governing decree & rate -> must NOT unnecessarily decline!
    const r1SameTh =
      "บริษัท อัลฟา คอนซัลติ้ง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท โดยไม่มีการใช้บริการก่อนออกใบกำกับภาษีหรือรับชำระเงิน ออกใบกำกับภาษีวันที่ 20 กันยายน 2568 และรับชำระเงิน 100,000 บาท วันที่ 25 กันยายน 2568 ต้องเสียภาษีมูลค่าเพิ่มตามพระราชกฤษฎีกาฉบับใด";
    const r1SameEn =
      "A VAT-registered Thai company provides a THB 100,000 domestic consulting service with no prior service use. It issues a tax invoice on 20 September 2025 and receives payment of THB 100,000 on 25 September 2025. What VAT rate and Royal Decree apply?";
    for (const q of [r1SameTh, r1SameEn]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date).toBe("2025-09-20");
      expect(l.temporal_facts.controlling_tax_point.controlling_event).toContain(
        "PRIOR_INVOICE_SAME_WINDOW_SUFFICIENT"
      );
      expect(l.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
    }

    // Risk 2 (Thai + English): Same-amount payments (฿50k + ฿50k) after partial ฿50k invoice with NO stated allocation
    // Must NEVER infer settlement from equal amounts alone! Must keep all 3 candidate dates and name missing allocation!
    const r2Th =
      "บริษัท เบต้า จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่าสัญญารวม 100,000 บาท โดยไม่มีการใช้บริการก่อนออกใบกำกับภาษีหรือรับชำระเงิน บริษัทออกใบกำกับภาษีบางส่วนจำนวน 50,000 บาท เมื่อวันที่ 25 กันยายน 2568 ต่อมาลูกค้าชำระเงิน 50,000 บาท เมื่อวันที่ 30 กันยายน 2568 และชำระเงินอีก 50,000 บาท เมื่อวันที่ 5 ตุลาคม 2568 โดยไม่ได้ระบุว่ายอดชำระงวดใดเป็นการชำระตามใบกำกับภาษีที่ออกไว้แล้ว แต่ละส่วนต้องเสียภาษีมูลค่าเพิ่มตามพระราชกฤษฎีกาฉบับใด";
    const r2En =
      "A VAT-registered Thai company provides a THB 100,000 domestic consulting service with no prior service use. It issues a partial tax invoice for THB 50,000 on 25 September 2025, then receives two equal payments of THB 50,000 on 30 September 2025 and THB 50,000 on 5 October 2025 with no stated allocation as to which payment settles the invoice. What VAT rate and Royal Decree apply?";
    for (const q of [r2Th, r2En]) {
      const l = buildStructuredCaseFactLedger({ question: q, applicableDate: null });
      expect(l.temporal_facts.controlling_tax_point.iso_date).toBeNull();
      expect(l.temporal_facts.controlling_tax_point.controlling_event).toContain(
        "PARTIAL_INVOICE_UNSTATED_ALLOCATION_CONDITIONAL"
      );
      // MUST NOT drop 2025-09-30 as assumed settlement!
      expect(l.temporal_facts.split_payment_tax_points?.map((p) => p.iso_date)).toEqual([
        "2025-09-25",
        "2025-09-30",
        "2025-10-05",
      ]);
      expect(l.temporal_facts.split_payment_tax_points?.[0]?.settled_payment_date_iso).toBeUndefined();
      expect(l.explicitly_unknown_facts_th.some((u) => u.includes("การจัดสรรการชำระเงิน"))).toBe(true);
    }
    const r2Cap = await capturePacket(store, "rel.B01.rc8", r2Th, null);
    const rd790R2 = r2Cap.actual_model_packet.find((p) => p.work_id === "subreg.th.rc.royal_decree.790");
    const rd799R2 = r2Cap.actual_model_packet.find((p) => p.work_id === "subreg.th.rc.royal_decree.799");
    expect(rd790R2?.evidence_role).toBe("governing");
    expect(rd790R2?.applicable_tax_point_dates).toEqual(["2025-09-25", "2025-09-30"]);
    expect(rd799R2?.evidence_role).toBe("governing");
    expect(rd799R2?.applicable_tax_point_dates).toEqual(["2025-10-05"]);
  });

  it("11. Hosted Preflight Save Regression (trc.a1af76c79ef931): unmodified Save replays r1 idempotently, intentional r2 preserves RD 799 + 0.7% local-tax + 7,000 VAT without false downgrade, and tampered numbers stay blocked", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
    const psg77_2 = ledger.passages["psg.7bdc85da3153a7"];
    const psg78_1 = ledger.passages["psg.3228c2c7aaeb10"];
    const psg80 = ledger.passages["psg.1b1abb8e7e22df"];
    const psg799 = ledger.passages["psg.rc8.rd799.sec_3_quoted_rd646_sec_4"];
    const psgLocal = ledger.passages["psg.3d0eb5636faa0e"];
    expect(psg77_2 && psg78_1 && psg80 && psg799 && psgLocal).toBeTruthy();

    const ansId = `ans.rc103.preflight_save_reg.${Date.now().toString(36)}`;
    const questionText =
      "บริษัท ซิกม่า แอดไวซอรี่ จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่าสัญญารวม 100,000 บาท โดยลูกค้าชำระเงินครบถ้วนเมื่อวันที่ 15 พฤศจิกายน 2568 ต้องเสียภาษีมูลค่าเพิ่มในอัตราร้อยละเท่าใด เป็นเงินเท่าใด และตามพระราชกฤษฎีกาฉบับใด";

    const claim1Id = `clm.${ansId}.llm_issue.1`;
    const claim2Id = `clm.${ansId}.llm_issue.2`;
    const claim2Text =
      "ต้องเสียภาษีมูลค่าเพิ่มตามประมวลรัษฎากร มาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 ในอัตราร้อยละ 6.3 รวมภาษีท้องถิ่นอีก 1 ใน 9 (ร้อยละ 0.7) เป็นอัตรารวมร้อยละ 7.0 คิดเป็นเงินภาษีมูลค่าเพิ่ม 7,000 บาท (หากราคารวม VAT แล้วเท่ากับ 6,542.06 บาท จากฐาน 93,457.94 บาท)";

    const makeRef = (
      psg: NonNullable<typeof psg80>,
      role: "primary_authority" | "official_summary_scope" = "primary_authority"
    ) => ({
      link_id: `lnk.${ansId}.${psg.passage_id}`,
      evidence_id: psg.passage_id,
      doc_id: psg.doc_id,
      version_id: psg.version_id,
      extraction_revision_id: psg.extraction_revision_id,
      support_role: role,
      support_role_label_th: role,
      required_group: "grp.vat_799",
      citation_label_th: psg.section_paragraph_path.join(" > "),
      issuer_name_th: "กรมสรรพากร",
      source_family: "gazette_enactment" as const,
      source_family_label_th: "ราชกิจจานุเบกษา",
      record_type: "full_record" as const,
      record_type_label_th: "ต้นฉบับทางการ",
      date_relied_on: "2025-11-15",
      official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
      official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf#page=2",
      resolver_url: `/api/v1/knowledge/evidence/${psg.passage_id}`,
      locator: {
        human_pinpoint_th: psg.section_paragraph_path.join(" > "),
        section_paragraph_path: psg.section_paragraph_path,
        physical_page_start: psg.physical_page_start,
        physical_page_end: psg.physical_page_end,
        printed_page_start: psg.printed_page_start,
        printed_page_end: psg.printed_page_end,
        anchors: [],
      },
      verification_status: "supported" as const,
      link_health: "unchecked_live" as const,
      link_health_notice_th: null,
      last_successful_verification_at: null,
      access_permission: "public" as const,
      access_conditions_th: null,
    });

    const boundCalc = {
      calculation_id: `calc.${ansId}.2`,
      claim_id: claim2Id,
      answer_revision: `${ansId}.r1`,
      verifier_version: "reg24-llm-calc-verifier-v1.1",
      formula: "100,000 x 7% = 7,000 บาท",
      inputs: { tax_base_thb: 100000, exempt_amount_thb: 0, rate_pct: 7 },
      outputs: { taxable_amount_thb: 100000, computed_tax_thb: 7000 },
      units: { primary_unit: "THB" as const, detail_th: "บาท" },
      source_versions: [{ evidence_id: psg799.passage_id, doc_id: psg799.doc_id, version_id: psg799.version_id }],
      verified_numeric_tokens: ["100000", "100,000", "7", "7.0", "6.3", "0.7", "7000", "7,000", "6542.06", "93457.94"],
      verified_at: new Date().toISOString(),
    };

    const r1 = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: questionText,
      save_operation_key: null,
      query_persistence_context: {
        trusted_calculations_by_claim_id: { [claim2Id]: boundCalc },
        trusted_calculation_tokens_by_claim_id: { [claim2Id]: boundCalc.verified_numeric_tokens },
      },
      submitted_envelope: {
        answer_id: ansId,
        as_of_date: "2025-11-15",
        status: "complete",
        claims: [
          {
            claim_id: claim1Id,
            claim_number: 1,
            text: "การให้บริการในราชอาณาจักรต้องเสียภาษีมูลค่าเพิ่มตามมาตรา 77/2 และความรับผิดเกิดขึ้นเมื่อได้รับชำระราคาค่าบริการตามมาตรา 78/1 (1)",
            claim_type: "legal_proposition",
            claim_type_label_th: "ข้อกฎหมาย",
            premise_ids: [],
            verification_decision: "supported",
            published: true,
            withheld_explanation_th: null,
            evidence_references: [makeRef(psg77_2), makeRef(psg78_1)],
          },
          {
            claim_id: claim2Id,
            claim_number: 2,
            text: claim2Text,
            claim_type: "interpretation",
            claim_type_label_th: "การปรับใช้กฎหมาย",
            premise_ids: [],
            verification_decision: "supported",
            published: true,
            withheld_explanation_th: null,
            bound_calculation: boundCalc,
            evidence_references: [makeRef(psg80), makeRef(psg799), makeRef(psgLocal, "official_summary_scope")],
          },
        ],
      },
    });
    expect(r1.answer_revision).toBe(`${ansId}.r1`);
    expect(r1.status).toBe("complete");
    expect(r1.claims.filter((c) => c.verification_decision === "supported").length).toBe(2);

    // Case A: Clicking Save in UI on unmodified r1 (NO query_persistence_context) MUST replay exact r1 idempotently!
    const uiResave = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: questionText,
      save_operation_key: `op.ui_save.${r1.answer_id}.${r1.answer_revision}`,
      submitted_envelope: r1,
    });
    expect(uiResave.answer_revision).toBe(r1.answer_revision);
    expect((uiResave as unknown as { __idempotent_replay?: boolean }).__idempotent_replay).toBe(true);
    expect(uiResave.status).toBe("complete");
    expect(uiResave.claims.filter((c) => c.verification_decision === "supported").length).toBe(2);

    // Case B: Intentional r2 edit WITHOUT query_persistence_context MUST preserve Claim 2 (0.7% / 7% / 7,000 / 6,542.06) without downgrading to partial!
    const r2 = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: questionText,
      revision_reason: "Intentional reviewer save verifying RD 799 + 0.7% local-tax retention",
      save_operation_key: `op.intentional_r2.${Date.now()}`,
      submitted_envelope: r1,
    });
    expect(r2.answer_revision).toBe(`${ansId}.r2`);
    expect(r2.status).toBe("complete");
    expect(r2.claims.filter((c) => c.verification_decision === "supported").length).toBe(2);
    expect(r2.unresolved_issues.length).toBe(0);

    // Case C (Negative Control): Tampered ungrounded amount (99,999 บาท) in r3 MUST STILL be withheld/blocked!
    const tamperedClaims = r1.claims.map((c, idx) =>
      idx === 1 ? { ...c, text: `${c.text} โดยต้องเสียภาษีเพิ่มเติม 99,999 บาท` } : c
    );
    const r3 = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: questionText,
      revision_reason: "Negative control tampered numeric claim",
      save_operation_key: `op.tampered_r3.${Date.now()}`,
      submitted_envelope: { ...r1, claims: tamperedClaims },
    });
    expect(r3.status).toBe("partial");
    expect(r3.claims.filter((c) => c.verification_decision === "supported").length).toBe(1);
    expect(r3.unresolved_issues.length).toBeGreaterThanOrEqual(1);
  });

  it("12. Focused Controls A/B/C (trc.20bde13a5b05ab): VAT-inclusive total (107,000) survives Generate/Save/Reopen; wrong installment base (4,200 on 40k) & superseded multi-turn base (7,000 after 100k->200k) are withheld without dropping supported siblings; genuine edit (200k->14k/214k) recalculates without inheriting r1 numbers", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    const state = store.getState();
    const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
    const psg77_2 = ledger.passages["psg.7bdc85da3153a7"]!;
    const psg78_1 = ledger.passages["psg.3228c2c7aaeb10"]!;
    const psg80 = ledger.passages["psg.1b1abb8e7e22df"]!;
    const psg790 = ledger.passages["psg.rc8.rd790.sec_3_quoted_rd646_sec_4"]!;
    const psg799 = ledger.passages["psg.rc8.rd799.sec_3_quoted_rd646_sec_4"]!;
    const psgLocal = ledger.passages["psg.3d0eb5636faa0e"]!;
    expect(psg77_2 && psg78_1 && psg80 && psg790 && psg799 && psgLocal).toBeTruthy();

    const mockInv = {
      provider: "google_gemini" as const,
      requested_model: "gemini-4-neon",
      resolved_model: "gemini-4-neon",
      actual_model_invoked: "gemini-4-neon",
      pinned_settings: { thinking_level: "low" as const, temperature: 0, max_output_tokens: 16384, timeout_ms: 180000, store: false as const },
      live_provider_called: true,
      silent_fallback_disabled: true,
      failure_classification: "NONE" as const,
      http_status: 200,
      latency_ms: 500,
      input_tokens: 100,
      output_tokens: 100,
      total_tokens: 200,
      estimated_cost_usd: 0.01,
      provider_response_id: "ctrl12.mock",
    };

    const toPack = (p: typeof psg80, app: string[], exc: string[] = []) => ({
      passage_id: p.passage_id,
      work_id: p.doc_id,
      version_id: p.version_id,
      official_identifier: p.doc_id,
      title_th: p.section_paragraph_path.join(" > "),
      pinpoint: p.section_paragraph_path.join(" > "),
      authority_level: "subordinate_legislation",
      evidence_role: "governing" as const,
      effective_dates: { valid_from: null, valid_to: null, temporal_applicability_hint: "IN_WINDOW" as const },
      applicable_tax_point_dates: app,
      excluded_tax_point_dates: exc,
      verbatim_text: p.verbatim_text,
    });

    const rawAll = new Map(
      [psg77_2, psg78_1, psg80, psg790, psg799, psgLocal].map((p) => [p.passage_id, state.passages[p.passage_id]!])
    );

    // Control A: Correct total (100,000 + 7,000 = 107,000) MUST resolve PAYMENT date (never REGISTRATION from "ผู้ประกอบการจดทะเบียน"),
    // pass verifier, AND survive Save + idempotent replay!
    const qA =
      "บริษัท ธีต้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท ชำระวันที่ 15 พฤศจิกายน 2568 (ยังไม่ออกใบกำกับภาษี) ระบุอัตราภาษี จำนวนภาษีมูลค่าเพิ่ม และยอดรวมทั้งสิ้นที่รวมภาษีมูลค่าเพิ่มแล้ว";
    const flA = buildStructuredCaseFactLedger({ question: qA, applicableDate: null });
    expect(flA.temporal_facts.controlling_tax_point.is_ambiguous).toBe(false);
    expect(flA.temporal_facts.controlling_tax_point.iso_date).toBe("2025-11-15");
    expect(flA.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2025-11-15" && e.event_type === "PAYMENT")).toBe(true);
    expect(flA.temporal_facts.transaction_or_event_dates.some((e) => e.iso_date === "2025-11-15" && e.event_type === "REGISTRATION")).toBe(false);
    const verA = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.ctrlA.test12",
      factLedger: flA,
      passagePack: [toPack(psg80, ["2025-11-15"]), toPack(psg799, ["2025-11-15"]), toPack(psgLocal, ["2025-11-15"])] as never,
      rawPassagesById: rawAll,
      state,
      llmOk: true,
      invocationAudit: mockInv as never,
      stagingFlagActive: true,
      draft: {
        answer_status: "ANSWERED",
        overall_summary_th: "",
        case_facts_used: [],
        issues: [
          {
            issue_id: "CTRL-A1",
            issue_title_th: "อัตราภาษีมูลค่าเพิ่ม จำนวนภาษี และยอดรวมทั้งสิ้น",
            party_or_scope_th: "มูลค่า 100,000 บาท (15 พฤศจิกายน 2568)",
            conclusion_th:
              "เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นอัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 7,000 บาท และยอดรวมทั้งสิ้นที่รวมภาษีมูลค่าเพิ่มแล้วเท่ากับ 107,000 บาท",
            material_facts_relied_on: ["มูลค่า 100,000 บาท", "ชำระวันที่ 15 พฤศจิกายน 2568"],
            governing_passage_ids: [psg80.passage_id, psg799.passage_id, psgLocal.passage_id],
            application_explanation_th:
              "มาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) ลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ 6.3 รวมภาษีท้องถิ่น 1 ใน 9 (ร้อยละ 0.7) เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 7,000 บาท รวมเป็นเงินทั้งสิ้น 107,000 บาท",
            authority_distinction_note_th: "มาตรา 80 + พ.ร.ฎ. 799 + คู่มือภาษีท้องถิ่น",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "100,000 x 7% = 7,000; รวม 107,000",
              tax_base_thb: 100000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 100000,
              rate_pct: 7,
              computed_tax_thb: 7000,
              steps_th: ["100,000 x 7% = 7,000 บาท", "100,000 + 7,000 = 107,000 บาท"],
              missing_inputs_th: [],
            },
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(verA.status).toBe("ANSWERED");
    expect(verA.verified_issues.length).toBe(1);
    expect(verA.audit_trace.rejected_claims.length).toBe(0);
    expect(verA.claims[0]?.bound_calculation?.verified_numeric_tokens).toContain("107000");

    // Control B1 (Wrong installment base): 4,200 (7% of wrong 60,000 installment) on 40,000 installment MUST be withheld
    // while the supported sibling claim (60,000 -> 4,200 under RD 799) SURVIVES!
    const qB =
      "บริษัท โอเมก้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่ารวม 100,000 บาท โดยไม่มีการใช้บริการหรือออกใบกำกับภาษีก่อนหน้า ลูกค้าแบ่งชำระ 2 งวด คือ งวดที่ 1 จำนวน 40,000 บาท วันที่ 25 กันยายน 2568 และงวดที่ 2 จำนวน 60,000 บาท วันที่ 5 ตุลาคม 2568";
    const flB = buildStructuredCaseFactLedger({ question: qB, applicableDate: null });
    const verB = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.ctrlB.test12",
      factLedger: flB,
      passagePack: [
        toPack(psg80, ["2025-09-25", "2025-10-05"]),
        toPack(psg790, ["2025-09-25"], ["2025-10-05"]),
        toPack(psg799, ["2025-10-05"], ["2025-09-25"]),
        toPack(psgLocal, ["2025-09-25", "2025-10-05"]),
      ] as never,
      rawPassagesById: rawAll,
      state,
      llmOk: true,
      invocationAudit: mockInv as never,
      stagingFlagActive: true,
      draft: {
        answer_status: "ANSWERED",
        overall_summary_th: "",
        case_facts_used: [],
        issues: [
          {
            issue_id: "CTRL-B-SUPPORTED-60K",
            issue_title_th: "งวดที่ 2 วันที่ 5 ตุลาคม 2568 (60,000 บาท)",
            party_or_scope_th: "งวดที่ 2 วันที่ 5 ตุลาคม 2568 จำนวน 60,000 บาท",
            conclusion_th:
              "สำหรับการให้บริการงวดที่ 2 วันที่ 5 ตุลาคม 2568 มูลค่า 60,000 บาท ให้ลดอัตราภาษีมูลค่าเพิ่มตามมาตรา 80 แห่งประมวลรัษฎากร ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 คงจัดเก็บในอัตราร้อยละ 6.3 รวมภาษีท้องถิ่นอีก 1 ใน 9 (ร้อยละ 0.7) เป็นอัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 4,200 บาท",
            material_facts_relied_on: ["งวดที่ 2 วันที่ 5 ตุลาคม 2568 จำนวน 60,000 บาท"],
            governing_passage_ids: [psg80.passage_id, psg799.passage_id, psgLocal.passage_id],
            application_explanation_th:
              "มาตรา 80 ประกอบพระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 ลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ 6.3 สำหรับความรับผิดถึงวันที่ 30 กันยายน 2569 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นอัตรารวมร้อยละ 7.0 จากฐาน 60,000 บาท คิดเป็นภาษีมูลค่าเพิ่ม 4,200 บาท",
            authority_distinction_note_th: "มาตรา 80 + พ.ร.ฎ. 799 + คู่มือภาษีท้องถิ่น",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "60,000 x 7% = 4,200",
              tax_base_thb: 60000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 60000,
              rate_pct: 7,
              computed_tax_thb: 4200,
              steps_th: ["60,000 x 7% = 4,200 บาท"],
              missing_inputs_th: [],
            },
          },
          {
            issue_id: "CTRL-B-WRONG-BASE-40K-USING-4200",
            issue_title_th: "งวดที่ 1 วันที่ 25 กันยายน 2568 (40,000 บาท)",
            party_or_scope_th: "งวดที่ 1 วันที่ 25 กันยายน 2568 จำนวน 40,000 บาท",
            conclusion_th:
              "สำหรับการให้บริการงวดที่ 1 วันที่ 25 กันยายน 2568 มูลค่า 40,000 บาท เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 790) อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 4,200 บาท",
            material_facts_relied_on: ["งวดที่ 1 วันที่ 25 กันยายน 2568 จำนวน 40,000 บาท"],
            governing_passage_ids: [psg80.passage_id, psg790.passage_id, psgLocal.passage_id],
            application_explanation_th:
              "มาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 790) ลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 4,200 บาท",
            authority_distinction_note_th: "มาตรา 80 + พ.ร.ฎ. 790",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: null,
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(verB.verified_issues.map((v) => v.issue_id)).toEqual(["CTRL-B-SUPPORTED-60K"]);
    expect(verB.audit_trace.rejected_claims.map((r) => r.issue_id)).toContain("CTRL-B-WRONG-BASE-40K-USING-4200");

    // Control B2 (Superseded multi-turn base: Turn 1 ฿100,000 -> Turn 2 ฿200,000): stale ฿7,000 MUST be rejected!
    const flSuperseded = buildStructuredCaseFactLedger({
      question: "แก้ไขมูลค่าบริการเป็น 200,000 บาท ชำระวันที่ 15 พฤศจิกายน 2568 ต้องเสียภาษีมูลค่าเพิ่มเท่าไร",
      applicableDate: null,
      conversationHistory: [
        {
          role: "user",
          content:
            "บริษัท ธีต้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท ชำระวันที่ 15 พฤศจิกายน 2568",
        },
      ],
    });
    const verSuperseded = verifyAndRenderGroundedLlmDraft({
      traceId: "trc.ctrlB2.superseded",
      factLedger: flSuperseded,
      passagePack: [toPack(psg80, ["2025-11-15"]), toPack(psg799, ["2025-11-15"]), toPack(psgLocal, ["2025-11-15"])] as never,
      rawPassagesById: rawAll,
      state,
      llmOk: true,
      invocationAudit: mockInv as never,
      stagingFlagActive: true,
      draft: {
        answer_status: "ANSWERED",
        overall_summary_th: "",
        case_facts_used: [],
        issues: [
          {
            issue_id: "CTRL-B2-STALE-100K-BASE",
            issue_title_th: "คำนวณจากฐานเดิม 100,000 บาทที่ถูกแก้ไขทับแล้ว",
            party_or_scope_th: "15 พฤศจิกายน 2568",
            conclusion_th:
              "เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) ร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นร้อยละ 7.0 คิดเป็นเงิน 7,000 บาท",
            material_facts_relied_on: ["15 พฤศจิกายน 2568"],
            governing_passage_ids: [psg80.passage_id, psg799.passage_id, psgLocal.passage_id],
            application_explanation_th: "คำนวณจากฐานเดิม 100,000 บาท ได้ภาษีมูลค่าเพิ่ม 7,000 บาท",
            authority_distinction_note_th: "มาตรา 80 + พ.ร.ฎ. 799",
            missing_facts_or_uncertainties_th: [],
            proposed_calculation: {
              is_computable_from_stated_facts: true,
              formula_description_th: "100,000 x 7% = 7,000",
              tax_base_thb: 100000,
              exempt_amount_thb: 0,
              taxable_amount_thb: 100000,
              rate_pct: 7,
              computed_tax_thb: 7000,
              steps_th: ["100,000 x 7% = 7,000 บาท"],
              missing_inputs_th: [],
            },
          },
        ],
        assumptions_th: [],
        clarification_questions_th: [],
        evidence_gaps_th: [],
      },
    });
    expect(verSuperseded.verified_issues.length).toBe(0);
    expect(verSuperseded.audit_trace.rejected_calculations.length).toBe(1);
    expect(verSuperseded.audit_trace.rejected_claims.map((r) => r.issue_id)).toContain("CTRL-B2-STALE-100K-BASE");

    // Control C (Genuine edit on Save: r1 100k/7k/107k -> r2 edited to 200k/14k/214k):
    // r2 MUST NOT inherit r1's 7,000 verification, MUST verify 14,000 & 214,000 cleanly, and MUST reject stale 7,000!
    const ansC = `ans.rc103.ctrlC.${Date.now().toString(36)}`;
    const makeRefC = (psg: typeof psg80, role: "primary_authority" | "official_summary_scope" = "primary_authority") => ({
      link_id: `lnk.${ansC}.${psg.passage_id}`,
      evidence_id: psg.passage_id,
      doc_id: psg.doc_id,
      version_id: psg.version_id,
      extraction_revision_id: psg.extraction_revision_id,
      support_role: role,
      support_role_label_th: role,
      required_group: "grp.vat_799",
      citation_label_th: psg.section_paragraph_path.join(" > "),
      issuer_name_th: "กรมสรรพากร",
      source_family: "gazette_enactment" as const,
      source_family_label_th: "ราชกิจจานุเบกษา",
      record_type: "full_record" as const,
      record_type_label_th: "ต้นฉบับทางการ",
      date_relied_on: "2025-11-15",
      official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
      official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf#page=2",
      resolver_url: `/api/v1/knowledge/evidence/${psg.passage_id}`,
      locator: {
        human_pinpoint_th: psg.section_paragraph_path.join(" > "),
        section_paragraph_path: psg.section_paragraph_path,
        physical_page_start: psg.physical_page_start,
        physical_page_end: psg.physical_page_end,
        printed_page_start: psg.printed_page_start,
        printed_page_end: psg.printed_page_end,
        anchors: [],
      },
      verification_status: "supported" as const,
      link_health: "unchecked_live" as const,
      link_health_notice_th: null,
      last_successful_verification_at: null,
      access_permission: "public" as const,
      access_conditions_th: null,
    });

    const r1C = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: qA,
      save_operation_key: `op.ctrlC.r1.${Date.now()}`,
      submitted_envelope: {
        answer_id: ansC,
        as_of_date: "2025-11-15",
        status: "complete",
        claims: [
          {
            claim_id: `clm.${ansC}.r1.1`,
            claim_number: 1,
            text: "การให้บริการมูลค่า 100,000 บาท เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นอัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 7,000 บาท และยอดรวมทั้งสิ้น 107,000 บาท",
            claim_type: "interpretation",
            claim_type_label_th: "การปรับใช้กฎหมาย",
            premise_ids: [],
            verification_decision: "supported",
            published: true,
            withheld_explanation_th: null,
            evidence_references: [makeRefC(psg80), makeRefC(psg799), makeRefC(psgLocal, "official_summary_scope")],
          },
        ],
      },
    });
    expect(r1C.status).toBe("complete");
    expect(r1C.claims[0].text).toContain("107,000");

    // Genuine edit to 200,000 -> 14,000 VAT / 214,000 gross total succeeds cleanly on r2
    const qC2 =
      "บริษัท ธีต้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 200,000 บาท ชำระวันที่ 15 พฤศจิกายน 2568 ระบุอัตราภาษี จำนวนภาษีมูลค่าเพิ่ม และยอดรวมทั้งสิ้นที่รวมภาษีมูลค่าเพิ่มแล้ว";
    const r2C = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: qC2,
      revision_reason: "Genuine edit updating taxable base from 100,000 to 200,000 THB",
      save_operation_key: `op.ctrlC.r2.${Date.now()}`,
      submitted_envelope: {
        ...r1C,
        claims: [
          {
            ...r1C.claims[0],
            text: "การให้บริการมูลค่า 200,000 บาท เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นอัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 14,000 บาท และยอดรวมทั้งสิ้น 214,000 บาท",
          },
        ],
      },
    });
    expect(r2C.answer_revision).toBe(`${ansC}.r2`);
    expect(r2C.status).toBe("complete");
    expect(r2C.claims.filter((c) => c.verification_decision === "supported").length).toBe(1);

    // Attempting to save r3 on the 200,000 question while carrying stale 7,000 from r1 MUST be rejected (422)!
    await expect(
      saveOrReviseAnswerServerVerified(store, {
        actor: QA_ACTOR,
        question_text: qC2,
        revision_reason: "Negative control: stale 7,000 from r1 on 200,000 base",
        save_operation_key: `op.ctrlC.r3.stale.${Date.now()}`,
        submitted_envelope: {
          ...r2C,
          claims: [
            {
              ...r2C.claims[0],
              text: "การให้บริการมูลค่า 200,000 บาท เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นอัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 7,000 บาท",
            },
          ],
        },
      })
    ).rejects.toThrow(/UNSUPPORTED_ANSWER_REJECTED_422/);
  });

  it("13. Staging Reviewer Identity & Read/Write Isolation: server-verified invite derives isolated actor & tenant (ignoring spoofed x-reg24-actor-id), blocks unauthorized read/write/list across testers", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    setDefaultKnowledgeStoreForTesting(store);
    const { resolveServerActor } = await import("../../src/core/knowledge/http-auth");
    const { POST: postAnswers, GET: listAnswers } = await import("../../src/app/api/v1/knowledge/answers/route");
    const { GET: getAnswerById } = await import("../../src/app/api/v1/knowledge/answers/[id]/route");

    const prevInviteOnly = process.env.REG24_TRIAL_INVITE_ONLY;
    const prevInviteCodes = process.env.REG24_TRIAL_INVITE_CODES;
    const prevRateLimit = process.env.REG24_TRIAL_RATE_LIMIT;
    const tokenA = "staging-qa-tester-alpha-secret-token-2026";
    const tokenB = "staging-qa-tester-beta-secret-token-2026";
    process.env.REG24_TRIAL_INVITE_ONLY = "1";
    process.env.REG24_TRIAL_INVITE_CODES = `${tokenA},${tokenB}`;
    process.env.REG24_TRIAL_RATE_LIMIT = "0";

    try {
      // 1) Client-supplied x-reg24-actor-id is IGNORED when invite-only staging auth is active;
      //    both actor_id and tenant_id are derived strictly from the server-verified credential.
      const reqSpoofA = new Request("http://localhost/api/v1/knowledge/answers", {
        headers: {
          "x-reg24-trial-invite": tokenA,
          "x-reg24-actor-id": "spoofed.admin@evil.example",
        },
      });
      const actorA = resolveServerActor(reqSpoofA);
      expect(actorA.actor_id).toMatch(/^trial\.user\.[0-9a-f]{14}@reg24\.th$/);
      expect(actorA.actor_id).not.toContain("spoofed");
      expect(actorA.tenant_id).toMatch(/^tenant\.trial\.[0-9a-f]{14}$/);

      const actorB = resolveServerActor(
        new Request("http://localhost/api/v1/knowledge/answers", {
          headers: { "x-reg24-trial-invite": tokenB },
        })
      );
      expect(actorB.actor_id).not.toBe(actorA.actor_id);
      expect(actorB.tenant_id).not.toBe(actorA.tenant_id);

      // 2) Missing invite credential -> HTTP 401 on list & read
      const unauthList = await listAnswers(new Request("http://localhost/api/v1/knowledge/answers"));
      expect(unauthList.status).toBe(401);

      // 3) Tester A saves an answer -> resolves to actorA / tenantA on Save AND Reopen
      const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
      const psg799 = ledger.passages["psg.rc8.rd799.sec_3_quoted_rd646_sec_4"]!;
      const ansId = `ans.rc103.auth_iso.${Date.now().toString(36)}`;
      const saveReqA = new Request("http://localhost/api/v1/knowledge/answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-trial-invite": tokenA,
          "x-reg24-actor-id": "ignored.client.header@example.com",
        },
        body: JSON.stringify({
          question_text: "อัตราภาษีมูลค่าเพิ่มตาม พ.ร.ฎ. ฉบับที่ 799 พ.ศ. 2568",
          save_operation_key: `op.auth_iso.${Date.now()}`,
          traceable_answer: {
            answer_id: ansId,
            as_of_date: "2025-11-15",
            status: "complete",
            claims: [
              {
                claim_id: `clm.${ansId}.1`,
                claim_number: 1,
                text: "พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 ลดอัตราภาษีมูลค่าเพิ่มคงจัดเก็บร้อยละ 6.3 ถึงวันที่ 30 กันยายน 2569",
                claim_type: "legal_proposition",
                claim_type_label_th: "ข้อกฎหมาย",
                premise_ids: [],
                verification_decision: "supported",
                published: true,
                withheld_explanation_th: null,
                evidence_references: [
                  {
                    link_id: `lnk.${ansId}.1`,
                    evidence_id: psg799.passage_id,
                    doc_id: psg799.doc_id,
                    version_id: psg799.version_id,
                    extraction_revision_id: psg799.extraction_revision_id,
                    support_role: "primary_authority",
                    support_role_label_th: "หลักฐานหลัก",
                    required_group: "grp.1",
                    citation_label_th: "พ.ร.ฎ. 799",
                    issuer_name_th: "กรมสรรพากร",
                    source_family: "gazette_enactment",
                    source_family_label_th: "ราชกิจจานุเบกษา",
                    record_type: "full_record",
                    record_type_label_th: "ต้นฉบับทางการ",
                    date_relied_on: "2025-11-15",
                    official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
                    official_url_with_anchor: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf#page=2",
                    resolver_url: `/api/v1/knowledge/evidence/${psg799.passage_id}`,
                    locator: {
                      human_pinpoint_th: "หน้า ๒",
                      section_paragraph_path: ["มาตรา ๓"],
                      physical_page_start: 2,
                      physical_page_end: 2,
                      printed_page_start: "หน้า ๒",
                      printed_page_end: "หน้า ๒",
                      anchors: [],
                    },
                    verification_status: "supported",
                    link_health: "unchecked_live",
                    link_health_notice_th: null,
                    last_successful_verification_at: null,
                    access_permission: "public",
                    access_conditions_th: null,
                  },
                ],
              },
            ],
          },
        }),
      });
      const saveResA = await postAnswers(saveReqA);
      expect(saveResA.status).toBe(200);
      const saveJsonA = (await saveResA.json()) as {
        resolved_actor_id: string;
        resolved_tenant_id: string;
        saved_answer_revision: string;
        answer: { owner_actor_id: string };
      };
      expect(saveJsonA.resolved_actor_id).toBe(actorA.actor_id);
      expect(saveJsonA.resolved_tenant_id).toBe(actorA.tenant_id);
      expect(saveJsonA.answer.owner_actor_id).toBe(actorA.actor_id);

      // 4) Tester A can reopen own saved answer (HTTP 200) with matching server-verified actor & tenant
      const reopenResA = await getAnswerById(
        new Request(`http://localhost/api/v1/knowledge/answers/${saveJsonA.saved_answer_revision}`, {
          headers: { "x-reg24-trial-invite": tokenA },
        }),
        { params: Promise.resolve({ id: saveJsonA.saved_answer_revision }) }
      );
      expect(reopenResA.status).toBe(200);
      const reopenJsonA = (await reopenResA.json()) as {
        resolved_actor_id: string;
        resolved_tenant_id: string;
      };
      expect(reopenJsonA.resolved_actor_id).toBe(actorA.actor_id);
      expect(reopenJsonA.resolved_tenant_id).toBe(actorA.tenant_id);

      // 5) Unauthorized user (missing invite) CANNOT reopen Tester A's answer (HTTP 401)
      const unauthRead = await getAnswerById(
        new Request(`http://localhost/api/v1/knowledge/answers/${saveJsonA.saved_answer_revision}`),
        { params: Promise.resolve({ id: saveJsonA.saved_answer_revision }) }
      );
      expect(unauthRead.status).toBe(401);

      // 6) Different authorized user (Tester B) CANNOT read (404), list (0 leaked), or overwrite (403) Tester A's answer!
      const crossReadB = await getAnswerById(
        new Request(`http://localhost/api/v1/knowledge/answers/${saveJsonA.saved_answer_revision}`, {
          headers: { "x-reg24-trial-invite": tokenB },
        }),
        { params: Promise.resolve({ id: saveJsonA.saved_answer_revision }) }
      );
      expect(crossReadB.status).toBe(404);

      const listResB = await listAnswers(
        new Request("http://localhost/api/v1/knowledge/answers", {
          headers: { "x-reg24-trial-invite": tokenB },
        })
      );
      expect(listResB.status).toBe(200);
      const listJsonB = (await listResB.json()) as { saved_answers: Array<{ answer_id: string }> };
      expect(listJsonB.saved_answers.some((a) => a.answer_id === ansId)).toBe(false);

      const crossWriteB = await postAnswers(
        new Request("http://localhost/api/v1/knowledge/answers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-trial-invite": tokenB,
          },
          body: JSON.stringify({
            question_text: "cross user overwrite attempt",
            save_operation_key: `op.cross_write.${Date.now()}`,
            traceable_answer: { answer_id: ansId, status: "complete", claims: [] },
          }),
        })
      );
      expect(crossWriteB.status).toBe(403);
    } finally {
      if (prevInviteOnly === undefined) delete process.env.REG24_TRIAL_INVITE_ONLY;
      else process.env.REG24_TRIAL_INVITE_ONLY = prevInviteOnly;
      if (prevInviteCodes === undefined) delete process.env.REG24_TRIAL_INVITE_CODES;
      else process.env.REG24_TRIAL_INVITE_CODES = prevInviteCodes;
      if (prevRateLimit === undefined) delete process.env.REG24_TRIAL_RATE_LIMIT;
      else process.env.REG24_TRIAL_RATE_LIMIT = prevRateLimit;
    }
  });

  it("14. B2 Save-Path Calculation Binding, Unchanged Idempotent Save, Read-Only Pre-Generate Reviewer Check & Preview Model Alignment", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    setDefaultKnowledgeStoreForTesting(store);
    const ledger = getUnifiedCitationLedgerView(store, "rel.B01.rc8");
    const psg80 = ledger.passages["psg.1b1abb8e7e22df"]!;
    const psg799 = ledger.passages["psg.rc8.rd799.sec_3_quoted_rd646_sec_4"]!;
    const psgLocal = ledger.passages["psg.3d0eb5636faa0e"]!;
    const mkRef = (p: typeof psg80, role: "primary_authority" | "supporting_guidance" = "primary_authority") => ({
      evidence_id: p.passage_id,
      work_id: p.doc_id,
      version_id: p.version_id,
      citation_label_th: p.section_paragraph_path.join(" > "),
      official_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
      authority_level: "subordinate_legislation" as const,
      support_role: role,
    });

    const refs = [mkRef(psg80), mkRef(psg799), mkRef(psgLocal, "supporting_guidance")];
    const rateClaimText =
      "การให้บริการในประเทศไทยซึ่งชำระวันที่ 15 พฤศจิกายน 2568 อยู่ภายใต้มาตรา 80 แห่งประมวลรัษฎากร ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 คงจัดเก็บภาษีมูลค่าเพิ่มอัตราร้อยละ 6.3 รวมภาษีท้องถิ่นร้อยละ 0.7 เป็นอัตรารวมร้อยละ 7.0";
    const calcClaimTextR1 =
      "การให้บริการมูลค่า 100,000 บาท เสียภาษีมูลค่าเพิ่มตามมาตรา 80 ประกอบ พ.ร.ฎ. (ฉบับที่ 799) พ.ศ. 2568 อัตรารวมร้อยละ 7.0 คิดเป็นภาษีมูลค่าเพิ่ม 7,000 บาท และยอดรวมทั้งสิ้น 107,000 บาท";
    const q1 =
      "บริษัท ธีต้า จำกัด ผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท ชำระวันที่ 15 พฤศจิกายน 2568 (ยังไม่ออกใบกำกับภาษี) ระบุอัตราภาษีมูลค่าเพิ่ม จำนวนภาษีมูลค่าเพิ่ม และยอดรวมทั้งสิ้นที่รวมภาษีมูลค่าเพิ่มแล้ว";
    const ansId = `ans.rc103.b2save.${Date.now().toString(36)}`;
    const realTokens = ["6.3", "0.7", "7", "7.0", "100000", "100,000", "7000", "7,000", "107000", "107,000"];

    // 1) Valid r1 on 100,000 base with server-verified bound_calculation
    const r1 = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: q1,
      revision_reason: "Initial verified answer from query endpoint (100,000 base)",
      save_operation_key: `op.b2save.r1.${Date.now()}`,
      query_persistence_context: {
        trusted_calculations_by_claim_id: {
          "clm.r1.calc": {
            calculation_id: "calc.b2save.r1",
            rule_id: "VAT_RATE_7PCT",
            inputs: { tax_base_thb: 100000, exempt_amount_thb: 0, rate_pct: 7 },
            outputs: { taxable_amount_thb: 100000, computed_tax_thb: 7000 },
            steps_th: ["100,000 x 7% = 7,000 บาท", "100,000 + 7,000 = 107,000 บาท"],
            source_versions: [],
            verified_numeric_tokens: realTokens,
            verifier_version: "reg24-llm-calc-verifier-v1.1",
            verified_at: new Date().toISOString(),
          },
        },
        trusted_calculation_tokens_by_claim_id: { "clm.r1.calc": realTokens },
      } as never,
      submitted_envelope: {
        answer_id: ansId,
        as_of_date: "2025-11-15",
        status: "complete",
        claims: [
          { claim_id: "clm.r1.rate", claim_type: "legal_conclusion", text: rateClaimText, evidence_references: refs },
          { claim_id: "clm.r1.calc", claim_type: "legal_conclusion", text: calcClaimTextR1, evidence_references: refs },
        ],
      } as never,
    });
    expect(r1.status).toBe("complete");
    expect(r1.claims).toHaveLength(2);
    expect(r1.claims.some((c) => c.text.includes("7,000") && Boolean(c.bound_calculation))).toBe(true);

    // 2) Positive control: unchanged re-save of r1 remains idempotent!
    const r1Replay = (await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text: q1,
      save_operation_key: `op.b2save.r1.ui_save.${Date.now()}`,
      submitted_envelope: r1,
    })) as typeof r1 & { __idempotent_replay?: boolean };
    expect(r1Replay.__idempotent_replay).toBe(true);
    expect(r1Replay.answer_revision).toBe(r1.answer_revision);
    expect(r1Replay.claims).toHaveLength(2);

    // 3) Negative control (B2 exact carryover): base corrected to 200,000 while retaining r1's EXACT old 7,000 wording & citations!
    const r2 = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text:
        "แก้ไขข้อมูลมูลค่าค่าบริการเป็น 200,000 บาท (ชำระวันที่ 15 พฤศจิกายน 2568 เช่นเดิม และยังไม่ออกใบกำกับภาษี) ต้องเสียภาษีมูลค่าเพิ่มอัตราเท่าไรและกี่บาท",
      revision_reason: "B2 negative fixture: base changed 100k -> 200k while carrying old 7,000 wording & citations",
      save_operation_key: `op.b2save.r2.${Date.now()}`,
      submitted_envelope: {
        answer_id: ansId,
        answer_revision: r1.answer_revision,
        supersedes_answer_revision: r1.answer_revision,
        as_of_date: "2025-11-15",
        status: "complete",
        claims: [
          { claim_id: "clm.r2.rate", claim_type: "legal_conclusion", text: rateClaimText, evidence_references: refs },
          { claim_id: "clm.r2.stale", claim_type: "legal_conclusion", text: calcClaimTextR1, evidence_references: refs },
        ],
      } as never,
    });
    expect(r2.status).toBe("partial");
    expect(r2.claims).toHaveLength(1);
    expect(r2.claims[0].text).toBe(rateClaimText);
    expect(r2.claims.some((c) => c.text.includes("7,000"))).toBe(false);

    // 4) Negative control (B2 "จาก 100,000 บาท เป็น 200,000 บาท" phrasing): superseded 100,000 MUST NOT ground 7,000!
    const r3 = await saveOrReviseAnswerServerVerified(store, {
      actor: QA_ACTOR,
      question_text:
        "แก้ไขข้อมูลมูลค่าค่าบริการจาก 100,000 บาท เป็น 200,000 บาท (ชำระวันที่ 15 พฤศจิกายน 2568) ต้องเสียภาษีมูลค่าเพิ่มกี่บาท",
      revision_reason: "B2 variant: explicit from-100k-to-200k correction carrying stale 7,000",
      save_operation_key: `op.b2save.r3.${Date.now()}`,
      submitted_envelope: {
        answer_id: ansId,
        answer_revision: r2.answer_revision,
        supersedes_answer_revision: r2.answer_revision,
        as_of_date: "2025-11-15",
        status: "complete",
        claims: [
          { claim_id: "clm.r3.rate", claim_type: "legal_conclusion", text: rateClaimText, evidence_references: refs },
          { claim_id: "clm.r3.stale", claim_type: "legal_conclusion", text: calcClaimTextR1, evidence_references: refs },
        ],
      } as never,
    });
    expect(r3.status).toBe("partial");
    expect(r3.claims).toHaveLength(1);
    expect(r3.claims.some((c) => c.text.includes("7,000"))).toBe(false);

    // Original historical r1 MUST remain intact on Reopen
    const r1Reopened = reopenSavedTraceableAnswer(store, r1.answer_revision, QA_ACTOR);
    expect(r1Reopened.answer?.status).toBe("complete");
    expect(r1Reopened.answer?.claims).toHaveLength(2);

    // 5) Read-only pre-Generate reviewer check + Preview model policy alignment on GET /api/v1/knowledge/environment
    const { GET: getEnvironment } = await import("../../src/app/api/v1/knowledge/environment/route");
    const prevVercelEnv = process.env.VERCEL_ENV;
    const prevGroundedFlag = process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
    const prevInviteOnly = process.env.REG24_TRIAL_INVITE_ONLY;
    const prevInviteCodes = process.env.REG24_TRIAL_INVITE_CODES;
    const prevEnvScope = process.env.REG24_TRIAL_ENV_SCOPE;
    const tok = "test-readonly-reviewer-verify-token-2026";
    process.env.VERCEL_ENV = "preview";
    delete process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
    process.env.REG24_TRIAL_INVITE_ONLY = "1";
    process.env.REG24_TRIAL_INVITE_CODES = tok;
    process.env.REG24_TRIAL_ENV_SCOPE = "staging";

    try {
      // Anonymous check: model policy aligned to gemini-4-neon @ low (no silent fallback) + reviewer UNVERIFIED
      const anonEnvRes = await getEnvironment(new Request("http://localhost/api/v1/knowledge/environment"));
      expect(anonEnvRes.status).toBe(200);
      const anonEnv = (await anonEnvRes.json()) as {
        model_and_verifiers: { generation_mode: string; model_id: string; thinking_level: string; silent_fallback_disabled: boolean };
        authenticated_reviewer: { verified: boolean; gate_enabled: boolean; actor_id: string | null; tenant_id: string | null; error_code: string | null };
      };
      expect(anonEnv.model_and_verifiers.generation_mode).toBe("llm_grounded");
      expect(anonEnv.model_and_verifiers.model_id).toBe("google-gemini:gemini-4-neon");
      expect(anonEnv.model_and_verifiers.thinking_level).toBe("low");
      expect(anonEnv.model_and_verifiers.silent_fallback_disabled).toBe(true);
      expect(anonEnv.authenticated_reviewer.verified).toBe(false);
      expect(anonEnv.authenticated_reviewer.gate_enabled).toBe(true);
      expect(anonEnv.authenticated_reviewer.actor_id).toBeNull();
      expect(anonEnv.authenticated_reviewer.error_code).toBe("TRIAL_INVITE_REQUIRED_401");

      // Authenticated check (with spoofed x-reg24-actor-id ignored): reports server-verified actor & tenant!
      const authEnvRes = await getEnvironment(
        new Request("http://localhost/api/v1/knowledge/environment", {
          headers: {
            "x-reg24-trial-invite": tok,
            "x-reg24-actor-id": "spoofed.display@evil.example",
          },
        })
      );
      expect(authEnvRes.status).toBe(200);
      const authEnv = (await authEnvRes.json()) as {
        authenticated_reviewer: { verified: boolean; actor_id: string; tenant_id: string; error_code: string | null };
      };
      expect(authEnv.authenticated_reviewer.verified).toBe(true);
      expect(authEnv.authenticated_reviewer.actor_id).toMatch(/^trial\.user\.[0-9a-f]{14}@reg24\.th$/);
      expect(authEnv.authenticated_reviewer.tenant_id).toMatch(/^tenant\.trial\.[0-9a-f]{14}$/);
      expect(authEnv.authenticated_reviewer.error_code).toBeNull();

      // Invalid token check
      const badEnvRes = await getEnvironment(
        new Request("http://localhost/api/v1/knowledge/environment", {
          headers: { "x-reg24-trial-invite": "invalid-wrong-token" },
        })
      );
      const badEnv = (await badEnvRes.json()) as {
        authenticated_reviewer: { verified: boolean; error_code: string | null };
      };
      expect(badEnv.authenticated_reviewer.verified).toBe(false);
      expect(badEnv.authenticated_reviewer.error_code).toBe("TRIAL_INVITE_INVALID_401");
    } finally {
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
      if (prevGroundedFlag === undefined) delete process.env.REG24_GROUNDED_LLM_STAGING_ENABLED;
      else process.env.REG24_GROUNDED_LLM_STAGING_ENABLED = prevGroundedFlag;
      if (prevInviteOnly === undefined) delete process.env.REG24_TRIAL_INVITE_ONLY;
      else process.env.REG24_TRIAL_INVITE_ONLY = prevInviteOnly;
      if (prevInviteCodes === undefined) delete process.env.REG24_TRIAL_INVITE_CODES;
      else process.env.REG24_TRIAL_INVITE_CODES = prevInviteCodes;
      if (prevEnvScope === undefined) delete process.env.REG24_TRIAL_ENV_SCOPE;
      else process.env.REG24_TRIAL_ENV_SCOPE = prevEnvScope;
    }
  });

  it("15. Query SSE Keepalive Streaming, Spotcheck Graceful 200 & Legal-Feedback Auth Refresh Gate", async () => {
    const store = new DurableKnowledgeStore(STORE_DIR);
    setDefaultKnowledgeStoreForTesting(store);

    const { GET: getSpotcheckCases } = await import(
      "../../src/app/api/v1/knowledge/legal-spotcheck-cases/route"
    );
    const { GET: getLegalFeedback } = await import(
      "../../src/app/api/v1/knowledge/legal-feedback/route"
    );
    const { POST: postQuery } = await import("../../src/app/api/v1/knowledge/query/route");

    // 1) Spotcheck cases endpoint MUST return 200 cleanly (never crash with 500)
    const spotRes = await getSpotcheckCases(
      new Request("http://localhost/api/v1/knowledge/legal-spotcheck-cases")
    );
    expect(spotRes.status).toBe(200);
    const spotJson = (await spotRes.json()) as {
      ok: boolean;
      cases: unknown[];
      total_cases: number;
    };
    expect(spotJson.ok).toBe(true);
    expect(Array.isArray(spotJson.cases)).toBe(true);

    const prevInviteOnly = process.env.REG24_TRIAL_INVITE_ONLY;
    const prevInviteCodes = process.env.REG24_TRIAL_INVITE_CODES;
    const prevEnvScope = process.env.REG24_TRIAL_ENV_SCOPE;
    const prevRateLimit = process.env.REG24_TRIAL_RATE_LIMIT;
    const prevVercelEnv = process.env.VERCEL_ENV;
    const tok = "test-sse-feedback-gate-token-2026";
    process.env.REG24_TRIAL_INVITE_ONLY = "1";
    process.env.REG24_TRIAL_INVITE_CODES = tok;
    process.env.REG24_TRIAL_ENV_SCOPE = "staging";
    process.env.REG24_TRIAL_RATE_LIMIT = "50";
    delete process.env.VERCEL_ENV;

    try {
      // 2) Legal-feedback GET rejects anonymous with 401 and allows verified invite with 200
      const anonFbRes = await getLegalFeedback(
        new Request("http://localhost/api/v1/knowledge/legal-feedback")
      );
      expect(anonFbRes.status).toBe(401);

      const authFbRes = await getLegalFeedback(
        new Request("http://localhost/api/v1/knowledge/legal-feedback", {
          headers: { "x-reg24-trial-invite": tok },
        })
      );
      expect(authFbRes.status).toBe(200);
      const authFbJson = (await authFbRes.json()) as { ok: boolean; feedback: unknown[] };
      expect(authFbJson.ok).toBe(true);
      expect(Array.isArray(authFbJson.feedback)).toBe(true);

      // 3) Query stream: true MUST reject anonymous BEFORE starting SSE stream (JSON 401)
      const anonStreamRes = await postQuery(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: "บริษัทขายสินค้าในประเทศเมื่อวันที่ 15 พฤศจิกายน 2568 เสีย VAT อัตราเท่าไร",
            stream: true,
          }),
        })
      );
      expect(anonStreamRes.status).toBe(401);
      expect((anonStreamRes.headers.get("content-type") || "").toLowerCase()).toContain(
        "application/json"
      );

      // 4) Authenticated stream: true emits SSE progress -> validated_claim -> complete with full payload
      const streamRes = await postQuery(
        new Request("http://localhost/api/v1/knowledge/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-trial-invite": tok,
          },
          body: JSON.stringify({
            question:
              "บริษัทให้บริการที่ปรึกษาในประเทศไทยมูลค่า 100,000 บาท ชำระวันที่ 15 พฤศจิกายน 2568 ต้องเสียภาษีมูลค่าเพิ่มอัตราร้อยละเท่าใด",
            stream: true,
            persist_answer: false,
            answer_generation_mode: "baseline_deterministic",
          }),
        })
      );
      expect(streamRes.status).toBe(200);
      expect((streamRes.headers.get("content-type") || "").toLowerCase()).toContain(
        "text/event-stream"
      );
      const sseText = await streamRes.text();
      expect(sseText).toContain('event: progress\ndata: {"stage":"accepted"');
      expect(sseText).toContain('"stage":"retrieval_and_claim_validation_complete"');
      expect(sseText).toContain("event: complete\ndata:");
      const completeMatch = sseText.match(/event: complete\ndata: (\{.*\})/);
      expect(completeMatch).toBeTruthy();
      const completePayload = JSON.parse(completeMatch![1]) as {
        ok: boolean;
        answer: { status: string };
        traceable_answer: { claims: unknown[] } | null;
        stage_timing_ms: { query: number; persist: number; audit: number; total: number };
      };
      expect(completePayload.ok).toBe(true);
      expect(completePayload.answer.status).toBe("ANSWERED");
      expect(completePayload.stage_timing_ms.total).toBeGreaterThanOrEqual(0);
    } finally {
      if (prevInviteOnly === undefined) delete process.env.REG24_TRIAL_INVITE_ONLY;
      else process.env.REG24_TRIAL_INVITE_ONLY = prevInviteOnly;
      if (prevInviteCodes === undefined) delete process.env.REG24_TRIAL_INVITE_CODES;
      else process.env.REG24_TRIAL_INVITE_CODES = prevInviteCodes;
      if (prevEnvScope === undefined) delete process.env.REG24_TRIAL_ENV_SCOPE;
      else process.env.REG24_TRIAL_ENV_SCOPE = prevEnvScope;
      if (prevRateLimit === undefined) delete process.env.REG24_TRIAL_RATE_LIMIT;
      else process.env.REG24_TRIAL_RATE_LIMIT = prevRateLimit;
      if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = prevVercelEnv;
    }
  });
});
