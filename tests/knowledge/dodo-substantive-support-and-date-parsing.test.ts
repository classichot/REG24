import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as queryPost } from "../../src/app/api/v1/knowledge/query/route";
import { POST as answersPost } from "../../src/app/api/v1/knowledge/answers/route";
import { POST as attachmentsPost } from "../../src/app/api/v1/knowledge/attachments/route";
import { GET as spotcheckCasesGet } from "../../src/app/api/v1/knowledge/legal-spotcheck-cases/route";
import { POST as legalResearchPost } from "../../src/app/api/v1/legal-research/route";
import { POST as reportGeneratePost } from "../../src/app/api/v1/reports/generate/route";
import { POST as legalAnalyzePost } from "../../src/app/api/v1/legal/analyze/route";
import { POST as mcpPost } from "../../src/app/api/mcp/route";
import {
  evaluateSubstantiveClaimSupport,
  verifyClaimAgainstPassages,
} from "../../src/core/knowledge/answer-verification";
import {
  approveDocumentedAmbiguityWithEvidence,
  commitTraceableAnswerAtomically,
  getUnifiedCitationLedgerView,
  saveOrReviseAnswerServerVerified,
  validateAndBuildTraceableAnswer,
} from "../../src/core/knowledge/claim-traceability-engine";
import { parseThaiBuddhistDateToIso } from "../../src/core/knowledge/identity";
import { queryKnowledge } from "../../src/core/knowledge/query";
import {
  clearProtectedStoreSidecarForTesting,
  onboardOfficialSourceDocument,
} from "../../src/core/knowledge/source-onboarding";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import {
  detectInvalidCalendarDateInText,
  detectYearlessMonthOrPartialDate,
  parseFlexibleMonthYearToRange,
  parseFlexibleThaiOrEnglishDateToIso,
  parseFlexibleYearOnlyToCe,
  parseQueryTemporalAndIntentContext,
  resolveTemporalInputToIsoInterval,
} from "../../src/core/knowledge/temporal-versioning";
import type { Actor } from "../../src/core/knowledge/contracts";

const TEST_USER: Actor = {
  actor_id: "dodo.retest@7ladvisory.th",
  role: "reader",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

const LEGAL_REVIEWER: Actor = {
  actor_id: "reviewer.senior@7ladvisory.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
  csrf_verified: true,
};

function cloneStagingStoreToTemp(prefix: string): {
  dir: string;
  store: DurableKnowledgeStore;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const srcGz = path.join(
    process.cwd(),
    "data",
    "knowledge-store-b01-rc2-staging",
    "canonical-state.json.gz"
  );
  fs.copyFileSync(srcGz, path.join(dir, "canonical-state.json.gz"));
  return { dir, store: new DurableKnowledgeStore(dir) };
}

describe("Dodo Retest Regression Suite — Substantive Claim Support & Year/Month Date Parsing", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs = [];
    process.env.REG24_USE_B01_RC2_PREVIEW_STORE = "1";
    setDefaultKnowledgeStoreForTesting(null);
    clearProtectedStoreSidecarForTesting();
  });

  afterEach(() => {
    delete process.env.REG24_USE_B01_RC2_PREVIEW_STORE;
    setDefaultKnowledgeStoreForTesting(null);
    clearProtectedStoreSidecarForTesting();
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // Ignore Windows temp handle lag
      }
    }
  });

  it("Issue 1A (Isolated Component): Unrelated Thai & English claims attached to real, eligible Batch 1 or onboarded sources MUST remain unverified (never marked 'supported' or 'VERIFIED')", () => {
    const { dir, store } = cloneStagingStoreToTemp("reg24-dodo-iss1a-");
    tempDirs.push(dir);
    const state = store.getState();
    const unified = getUnifiedCitationLedgerView(store, "rel.B01.rc5");

    const releasePassages = store.getPassagesForRelease("rel.B01.rc5");
    // Pick TWO real, verified, eligible Batch 1 passages from the active release (`rel.B01.rc5`):
    // 1) Ruling `กค 0702/636` (VAT 0% under Section 80/1(4) for foreign grant / government project)
    const realVatPassage = releasePassages.find((p) => {
      if (p.statement_role !== "official_conclusion") return false;
      const w = state.works[p.work_id];
      return Boolean(
        w?.official_identifiers.some((o) => o.normalized === "กค 0702/636") &&
          p.exact_text.includes("80/1 (4)")
      );
    })!;
    const work636 = state.works[realVatPassage.work_id]!;
    // 2) Revenue Code `มาตรา 70` (withholding tax on foreign company not carrying on business in Thailand, remit within 7 days)
    const realSec70Passage = releasePassages.find(
      (p) => p.work_id === "prov.th.rc.70" && p.statement_role === "statutory_text"
    )!;

    expect(unified.passages[realVatPassage.passage_id]?.eligible_for_publication).toBe(true);
    expect(unified.passages[realSec70Passage.passage_id]?.eligible_for_publication).toBe(true);

    const unrelatedClaimsAgainstVatPassage = [
      // Completely different tax type (Specific Business Tax, no overlap)
      "การขายอสังหาริมทรัพย์เป็นทางค้าหรือหากำไรอยู่ในบังคับต้องเสียภาษีธุรกิจเฉพาะ",
      // Purely verbal corporate deduction claim WITHOUT section numbers or digits
      "รายจ่ายค่ารับรองในการต้อนรับลูกค้าสามารถนำมาหักเป็นรายจ่ายในการคำนวณกำไรสุทธิของบริษัทได้",
      // Out-of-scope labour severance claim attached to a real Revenue Department ruling
      "ลูกจ้างซึ่งทำงานครบสามปีและถูกเลิกจ้างโดยไม่มีความผิดมีสิทธิได้รับค่าชดเชยจากนายจ้าง",
      // Same VAT domain, but wrong statutory subsection (`มาตรา 80/1 (2)` export of software vs `80/1 (4)` foreign aid)
      "การให้บริการพัฒนาซอฟต์แวร์แก่ผู้ว่าจ้างในต่างประเทศได้รับสิทธิเสียภาษีมูลค่าเพิ่มอัตราร้อยละ 0 ตามมาตรา 80/1 (2)",
      // Same VAT domain, ungrounded numeric rate / cap (`ร้อยละ 15` not in `กค 0702/636`)
      "การขายสินค้าให้หน่วยงานของรัฐตามโครงการความช่วยเหลือได้รับยกเว้นภาษีในอัตราร้อยละ 15",
      // Unrelated English claim attached to real Thai ruling
      "Corporate taxpayers may deduct charitable donations to public hospitals up to two percent of net profit.",
    ];

    for (const unrelatedClaim of unrelatedClaimsAgainstVatPassage) {
      // 1. Direct `evaluateSubstantiveClaimSupport` check
      const subEval = evaluateSubstantiveClaimSupport({
        claim_text: unrelatedClaim,
        passages: [
          {
            passage_id: realVatPassage.passage_id,
            doc_id: realVatPassage.work_id,
            verbatim_text: realVatPassage.exact_text,
            doc_title_th: work636.title_th,
            source_native_id: "กค 0702/636",
          },
        ],
      });
      expect(subEval.supported, `Expected unsupported for: ${unrelatedClaim}`).toBe(false);

      // 2. Direct `verifyClaimAgainstPassages` check
      const verCheck = verifyClaimAgainstPassages(
        {
          statement: unrelatedClaim,
          supporting_passage_ids: [realVatPassage.passage_id],
        },
        [realVatPassage]
      );
      expect(verCheck.verification_result, unrelatedClaim).toBe("UNSUPPORTED");
      expect(verCheck.allow_confident_answer, unrelatedClaim).toBe(false);

      // 3. `validateAndBuildTraceableAnswer` check: claim MUST NOT be marked `supported` or published!
      const built = validateAndBuildTraceableAnswer(store, {
        channel: "api",
        question: "ทดสอบการแนบแหล่งอ้างอิงจริงที่ไม่รองรับข้อกล่าวอ้าง",
        as_of_date: "2026-03-01",
        release_id: "rel.B01.rc5",
        actor: TEST_USER,
        authorized_candidate_ids: new Set([realVatPassage.passage_id]),
        proposed_claims: [
          {
            text: unrelatedClaim,
            claim_type: "legal_proposition",
            support_groups: [
              {
                group_id: "grp.irrelevant_real_source",
                role: "primary_authority",
                evidence_ids: [realVatPassage.passage_id],
              },
            ],
          },
        ],
      });
      expect(built.status, unrelatedClaim).toBe("insufficient");
      expect(built.claims.length, unrelatedClaim).toBe(0);
      expect(
        built.claims.some((c) => c.verification_decision === "supported"),
        unrelatedClaim
      ).toBe(false);
    }

    // 4. Same-section (`มาตรา 70`) claim with ungrounded deadline (`ภายใน 15 วัน` vs `ภายใน 7 วัน` in Section 70) -> REJECTED!
    const wrongDeadlineSec70 = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "กำหนดเวลานำส่งภาษีตามมาตรา 70",
      as_of_date: "2026-03-01",
      release_id: "rel.B01.rc5",
      actor: TEST_USER,
      authorized_candidate_ids: new Set([realSec70Passage.passage_id]),
      proposed_claims: [
        {
          text: "ผู้จ่ายเงินได้ให้บริษัทต่างประเทศตามมาตรา 70 ต้องนำส่งภาษีภายใน 15 วันนับแต่วันสิ้นเดือน",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "primary_authority",
              evidence_ids: [realSec70Passage.passage_id],
            },
          ],
        },
      ],
    });
    expect(wrongDeadlineSec70.status).toBe("insufficient");
    expect(wrongDeadlineSec70.claims.length).toBe(0);

    // 5. Padding a valid claim on Section 70 with an EXTRA irrelevant real source (`realVatPassage`) -> REJECTED!
    const paddedWithIrrelevant = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "หลักเกณฑ์มาตรา 70",
      as_of_date: "2026-03-01",
      release_id: "rel.B01.rc5",
      actor: TEST_USER,
      authorized_candidate_ids: new Set([
        realSec70Passage.passage_id,
        realVatPassage.passage_id,
      ]),
      proposed_claims: [
        {
          text: "บริษัทต่างประเทศที่มิได้ประกอบกิจการในประเทศไทยต้องถูกหักภาษี ณ ที่จ่ายและนำส่งภายใน 7 วันนับแต่วันสิ้นเดือนตามมาตรา 70",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "primary_authority",
              evidence_ids: [realSec70Passage.passage_id, realVatPassage.passage_id],
            },
          ],
        },
      ],
    });
    expect(paddedWithIrrelevant.status).toBe("insufficient");
    expect(paddedWithIrrelevant.claims.length).toBe(0);

    // 6. Direct `commitTraceableAnswerAtomically` guard: even if a caller constructs a forged envelope bypassing `validateAndBuildTraceableAnswer`, commit rejects real-but-irrelevant evidence!
    const validSec70Built = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "หลักเกณฑ์มาตรา 70",
      as_of_date: "2026-03-01",
      release_id: "rel.B01.rc5",
      actor: TEST_USER,
      authorized_candidate_ids: new Set([realSec70Passage.passage_id]),
      proposed_claims: [
        {
          text: "บริษัทต่างประเทศที่มิได้ประกอบกิจการในประเทศไทยต้องถูกหักภาษีจากเงินได้และนำส่งภายใน 7 วันนับแต่วันสิ้นเดือนตามมาตรา 70",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "g1",
              role: "primary_authority",
              evidence_ids: [realSec70Passage.passage_id],
            },
          ],
        },
      ],
    });
    expect(validSec70Built.status).toBe("complete");

    const tamperedEnvelope = {
      ...validSec70Built,
      answer_id: "ans.tampered.irrelevant",
      answer_revision: "ans.tampered.irrelevant.r1",
      claims: [
        {
          ...validSec70Built.claims[0],
          text: "การขายอสังหาริมทรัพย์เป็นทางค้าหรือหากำไรต้องเสียภาษีธุรกิจเฉพาะร้อยละ 3.3",
        },
      ],
    };
    expect(() =>
      commitTraceableAnswerAtomically(
        store,
        tamperedEnvelope,
        tamperedEnvelope.claims[0].evidence_references.map((r) => ({
          ...r,
          answer_revision: tamperedEnvelope.answer_revision,
          claim_id: tamperedEnvelope.claims[0].claim_id,
          verifier_or_reviewer_id: "tamper-test",
          ruleset_version: "test",
          verified_at: tamperedEnvelope.generated_at,
        })),
        {
          actor: TEST_USER,
          question_text: "พยายามบันทึกข้อกล่าวอ้างที่ไม่ตรงกับแหล่งอ้างอิงจริง",
        }
      )
    ).toThrow(/UNSUPPORTED_ANSWER_REJECTED_422/);
  });

  it("Issue 1B (Save API, Human Reviewer Override & Verified Official Attachments): Blocks saving unrelated claims attached to real Batch 1 or attached sources (422), while accepting genuinely supported claims & verified attachments", async () => {
    const { dir, store } = cloneStagingStoreToTemp("reg24-dodo-iss1b-");
    tempDirs.push(dir);
    setDefaultKnowledgeStoreForTesting(store);

    // 1. Generate a real verified answer first to obtain a valid envelope with real Batch 1 `evidence_references`
    const realAns = await queryKnowledge(
      {
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
        applicable_date: "2026-02-15",
        mode: "exact_lookup",
      },
      TEST_USER,
      { store }
    );
    expect(realAns.traceable_answer?.status).toBe("complete");
    const realEnv = realAns.traceable_answer!;

    // 2. Client swaps the claim text to an unrelated tax assertion while keeping the REAL `evidence_references` of `กค 0702/636` -> `POST /api/v1/knowledge/answers` MUST reject with 422!
    const forgedRealSourceReq = new Request("http://localhost/api/v1/knowledge/answers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-reg24-actor-id": TEST_USER.actor_id,
      },
      body: JSON.stringify({
        question_text: "อัตราภาษีอากรแสตมป์สำหรับสัญญาจ้างทำของคือเท่าไร",
        traceable_answer: {
          ...realEnv,
          answer_id: "ans.real_source_unrelated_claim",
          answer_revision: "ans.real_source_unrelated_claim.r1",
          status: "complete",
          claims: [
            {
              ...realEnv.claims[0],
              text: "ตราสารสัญญาจ้างทำของต้องปิดอากรแสตมป์บริบูรณ์ในอัตรา 1 บาทต่อจำนวนเงิน 1,000 บาท",
              verification_decision: "supported",
              published: true,
            },
          ],
        },
      }),
    });
    const forgedRealSourceRes = await answersPost(forgedRealSourceReq);
    expect(forgedRealSourceRes.status).toBe(422);
    const forgedBody = await forgedRealSourceRes.json();
    expect(forgedBody.error).toContain("UNSUPPORTED_ANSWER_REJECTED_422");

    // 3. Even `approveDocumentedAmbiguityWithEvidence` by a `legal_reviewer` CANNOT attach `กค 0702/636` to an unrelated claim!
    const savedValid = await saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: realEnv,
      question_text: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
      actor: TEST_USER,
    });
    expect(() =>
      approveDocumentedAmbiguityWithEvidence(store, {
        prior_answer_revision: savedValid.answer_revision,
        claim_text_th: "บริษัทจำกัดต้องมีผู้เริ่มก่อการอย่างน้อย 2 คนในการจดทะเบียนจัดตั้งบริษัท",
        claim_type: "interpretation",
        evidence_ids: [realEnv.claims[0].evidence_references[0].evidence_id],
        reviewer: LEGAL_REVIEWER,
        justification_th: "ทดสอบแนบแหล่งอ้างอิงจริงแต่คนละเรื่อง",
      })
    ).toThrow(/UNSUPPORTED_ANSWER_REJECTED_422/);

    // 4. Verified official law attachment remains acceptable evidence when it substantively supports the claim, AND fails if attached to an unrelated claim!
    const attText =
      "ราชกิจจานุเบกษา เล่ม ๑๔๐ ตอนที่ ๔๙ ก พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4 ให้ยกเว้นภาษีเงินได้นิติบุคคลเป็นจำนวนร้อยละหนึ่งร้อยของรายจ่ายเพื่อการลงทุนในระบบอัตโนมัติ ตั้งแต่วันที่ 1 มกราคม พ.ศ. 2566 ถึงวันที่ 31 ธันวาคม พ.ศ. 2568";
    const attRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 779) พ.ศ. 2566 มาตรา 4",
          original_title_th:
            "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 779) พ.ศ. 2566",
          official_origin_url: "https://ratchakitcha.soc.go.th/documents/rd-779-2566.pdf",
          royal_gazette_ref: "เล่ม ๑๔๐ ตอนที่ ๔๙ ก",
          publication_date: "2023-08-17",
          effective_from: "2023-08-18",
          section_label: "มาตรา 4",
          physical_page_one_based: 3,
          printed_page_label: "๓",
          attachment_text: attText,
        }),
      })
    );
    expect(attRes.status).toBe(200);
    const attJson = await attRes.json();

    // Positive: supported claim grounded in verified attachment -> `complete` & `supported`!
    const supportedAttEnv = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "สิทธิยกเว้นภาษีเงินได้นิติบุคคลสำหรับระบบอัตโนมัติตาม พ.ร.ฎ. 779 มาตรา 4",
      as_of_date: "2024-06-15",
      release_id: "rel.B01.rc5",
      actor: TEST_USER,
      authorized_candidate_ids: new Set([attJson.passage_id]),
      proposed_claims: [
        {
          text: "พระราชกฤษฎีกา (ฉบับที่ 779) มาตรา 4 ยกเว้นภาษีเงินได้นิติบุคคลร้อยละ 100 สำหรับรายจ่ายลงทุนในระบบอัตโนมัติ",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "grp.att",
              role: "verified_attachment_authority",
              evidence_ids: [attJson.passage_id],
            },
          ],
        },
      ],
    });
    expect(supportedAttEnv.status).toBe("complete");
    expect(supportedAttEnv.claims[0].verification_decision).toBe("supported");

    // Negative: unrelated claim attached to the verified attachment -> `insufficient`, 0 supported claims!
    const unrelatedAttEnv = validateAndBuildTraceableAnswer(store, {
      channel: "api",
      question: "การส่งออกสินค้าเสียภาษีมูลค่าเพิ่มเท่าไร",
      as_of_date: "2024-06-15",
      release_id: "rel.B01.rc5",
      actor: TEST_USER,
      authorized_candidate_ids: new Set([attJson.passage_id]),
      proposed_claims: [
        {
          text: "การส่งออกสินค้าไปนอกราชอาณาจักรได้รับสิทธิเสียภาษีมูลค่าเพิ่มในอัตราร้อยละ 0",
          claim_type: "legal_proposition",
          support_groups: [
            {
              group_id: "grp.att_unrelated",
              role: "verified_attachment_authority",
              evidence_ids: [attJson.passage_id],
            },
          ],
        },
      ],
    });
    expect(unrelatedAttEnv.status).toBe("insufficient");
    expect(unrelatedAttEnv.claims.length).toBe(0);
  });

  it("Issue 2A (Isolated Date-Parsing Components): Year-only, month-only, monetary amounts after months, and invalid calendar dates in Thai & English NEVER invent dates or drop years", () => {
    // 1. `parseThaiBuddhistDateToIso` & `parseFlexibleThaiOrEnglishDateToIso` reject invalid calendar dates, year-only, and month-only inputs
    for (const badOrPartial of [
      "2018",
      "2561",
      "ปี 2561",
      "June",
      "มิถุนายน",
      "June 2018",
      "มิถุนายน 2561",
      "2018-06",
      "15 June",
      "15 มิถุนายน",
      "2019-02-29", // 2019 not leap year
      "2562-02-29", // B.E. 2562 = 2019 not leap year
      "2023-02-30",
      "31/06/2018",
      "31/04/2561",
      "31 มิถุนายน 2561",
      "30 กุมภาพันธ์ 2562",
      "29 Feb 2019",
      "June 31, 2018",
    ]) {
      expect(parseThaiBuddhistDateToIso(badOrPartial), `parseThaiBuddhistDateToIso(${badOrPartial})`).toBeNull();
      expect(
        parseFlexibleThaiOrEnglishDateToIso(badOrPartial),
        `parseFlexibleThaiOrEnglishDateToIso(${badOrPartial})`
      ).toBeNull();
    }
    // Valid leap day (`2020-02-29` / `29 กุมภาพันธ์ 2563`) still parses cleanly
    expect(parseThaiBuddhistDateToIso("29 กุมภาพันธ์ 2563")).toBe("2020-02-29");
    expect(parseFlexibleThaiOrEnglishDateToIso("29 Feb 2020")).toBe("2020-02-29");

    // 2. `parseFlexibleMonthYearToRange` NEVER truncates 3-part invalid/valid dates (`2019-02-30`, `15/06/2018`) and NEVER invents years from amounts (`มิถุนายน 50,000 บาท`)
    for (const nonMonthYear of [
      "2019-02-30",
      "2019-02-15",
      "15/06/2018",
      "31/02/2019",
      "15 มิถุนายน 2561",
      "15 June 2018",
      "ในเดือนมิถุนายน 50,000 บาท",
      "เดือนมิถุนายน 20%",
      "June",
      "มิถุนายน",
      "2018",
      "2561",
    ]) {
      expect(
        parseFlexibleMonthYearToRange(nonMonthYear),
        `parseFlexibleMonthYearToRange(${nonMonthYear})`
      ).toBeNull();
    }

    // 3. `parseFlexibleYearOnlyToCe` & `resolveTemporalInputToIsoInterval` handle Thai & English year-only without inventing point dates
    expect(parseFlexibleYearOnlyToCe("2018")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("2561")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("พ.ศ. 2561")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("ปี 2561")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("2561 B.E.")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("FY2018")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("fiscal year 2018")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("2018 accounting period")).toBe(2018);
    expect(parseFlexibleYearOnlyToCe("June")).toBeNull();
    expect(parseFlexibleYearOnlyToCe("2018-06")).toBeNull();

    expect(resolveTemporalInputToIsoInterval("2018")).toEqual({
      kind: "year_only_range",
      startIso: "2018-01-01",
      endIso: "2018-12-31",
      yearCe: 2018,
      canonicalLabel: "2018",
      ambiguousAltIso: null,
    });
    expect(resolveTemporalInputToIsoInterval("June").kind).toBe("incomplete_or_invalid");
    expect(resolveTemporalInputToIsoInterval("มิถุนายน").kind).toBe("incomplete_or_invalid");
    expect(resolveTemporalInputToIsoInterval("2019-02-30").kind).toBe("incomplete_or_invalid");
    expect(detectInvalidCalendarDateInText("เมื่อวันที่ 30 กุมภาพันธ์ 2562")).toBe(true);

    // 4. `parseQueryTemporalAndIntentContext` on Thai & English YEAR-ONLY questions (including JS Thai `\bปี` edge cases & `FY2018` non-invention!)
    const yearOnlyQuestions: Array<{ q: string; appDate?: string | null; expectedYr: number }> = [
      { q: "ปี 2561 บริษัทบริจาคเงินให้พรรคการเมืองหักรายจ่ายได้หรือไม่", expectedYr: 2018 },
      { q: "รายจ่ายบริจาคของปี 2561 หักเป็นรายจ่ายนิติบุคคลได้ไหม", expectedYr: 2018 },
      { q: "จ่ายเงินบริจาคปี2560 หักรายจ่ายได้หรือไม่", expectedYr: 2017 },
      { q: "รอบระยะเวลาบัญชีปี 2561 บริษัทบริจาคเงินให้พรรคการเมือง", expectedYr: 2018 },
      { q: "รอบบัญชี 2562 บริษัทขายสินค้าให้องค์การระหว่างประเทศ", expectedYr: 2019 },
      { q: "2561 บริจาคพรรคการเมืองหักรายจ่ายได้ไหม", expectedYr: 2018 },
      { q: "In fiscal year 2018, can a Thai company deduct a political party donation?", expectedYr: 2018 },
      { q: "For the 2018 accounting period, is a political party contribution deductible?", expectedYr: 2018 },
      { q: "As of 2019, does 0% VAT apply to foreign economic and trade offices?", expectedYr: 2019 },
      { q: "Under 2560 B.E. tax rules, could a company deduct political donations?", expectedYr: 2017 },
      { q: "บริษัทบริจาคเงินให้พรรคการเมืองหักรายจ่ายได้ไหม", appDate: "2018", expectedYr: 2018 },
      { q: "บริษัทบริจาคเงินให้พรรคการเมืองหักรายจ่ายได้ไหม", appDate: "2561", expectedYr: 2018 },
    ];

    for (const item of yearOnlyQuestions) {
      const ctx = parseQueryTemporalAndIntentContext({
        question: item.q,
        applicableDate: item.appDate ?? null,
        explicitRulingIds: [],
      });
      expect(ctx.transaction_year_ce, item.q).toBe(item.expectedYr);
      expect(ctx.has_any_temporal_anchor, item.q).toBe(true);
      // Must NEVER invent exact day/month dates (`-01-01`, `-05-01`, or `-12-31`) from year-only inputs!
      expect(ctx.point_in_time_date_iso, item.q).toBeNull();
      expect(ctx.accounting_period_start_iso, item.q).toBeNull();
      expect(ctx.accounting_period_end_iso, item.q).toBeNull();
      expect(ctx.transaction_date_iso, item.q).toBeNull();
    }

    // 5. `parseQueryTemporalAndIntentContext` on Thai & English MONTH-ONLY / yearless partial questions (including monetary amounts right after month!)
    const monthOnlyQuestions: Array<{ q: string; appDate?: string | null }> = [
      { q: "เดือนมิถุนายน บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักรายจ่ายได้หรือไม่" },
      { q: "ในเดือนมิถุนายน 50,000 บาท บริจาคให้สถานศึกษาหักรายจ่ายได้เท่าไร" },
      { q: "เมื่อวันที่ 15 มิถุนายน 50,000 บาท บริษัทบริจาคเงินให้พรรคการเมือง" },
      { q: "มิ.ย. บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ ได้ VAT 0% ไหม" },
      { q: "สำหรับเดือนกุมภาพันธ์ บริษัทได้สิทธิเสียภาษีมูลค่าเพิ่มร้อยละ 0 หรือไม่" },
      { q: "เดือนกพ บริษัทขายสินค้าให้องค์การระหว่างประเทศ" },
      { q: "In Feb, our Thai company sold goods to a foreign economic and trade office." },
      { q: "For June, can our company deduct a 50,000 THB donation to a political party?" },
      { q: "On 15 Jun, 20 companies donated to a charity; is it deductible?" },
      { q: "June 15, 50,000 THB political party donation deduction" },
      { q: "During May, our company sold goods to an embassy." },
      { q: "บริษัทขายสินค้าให้สถานทูตได้สิทธิ VAT 0% ไหม", appDate: "June" },
      { q: "บริษัทขายสินค้าให้สถานทูตได้สิทธิ VAT 0% ไหม", appDate: "มิถุนายน" },
    ];

    for (const mq of monthOnlyQuestions) {
      const ctx = parseQueryTemporalAndIntentContext({
        question: mq.q,
        applicableDate: mq.appDate ?? null,
        explicitRulingIds: [],
      });
      expect(ctx.has_yearless_partial_date, mq.q).toBe(true);
      expect(ctx.transaction_year_ce, `Must NOT invent year on: ${mq.q}`).toBeNull();
      expect(ctx.transaction_date_iso, `Must NOT invent date on: ${mq.q}`).toBeNull();
      expect(ctx.point_in_time_date_iso, `Must NOT invent point date on: ${mq.q}`).toBeNull();
    }

    // Confirm modal verb "May a company..." at sentence start is NOT misclassified as month of May
    expect(
      detectYearlessMonthOrPartialDate("May a Thai company deduct a 40,000 THB political party donation?")
    ).toBe(false);
  });

  it("Issue 2B (Complete Answer Flow — Thai & English): Year-only, month-only, and invalid dates prevent wrong legal versions & invented dates across Query, Research, Reports, Analyze, MCP, and Onboarded Multi-Version Statutes", async () => {
    const { dir, store } = cloneStagingStoreToTemp("reg24-dodo-iss2b-");
    tempDirs.push(dir);
    setDefaultKnowledgeStoreForTesting(store);

    // 1. Year-only questions on `ACCOUNTING_PERIOD_START` cutoff year (`ปี 2561` / `2018` / `fiscal year 2018`) -> `NEEDS_CLARIFICATION` (because non-calendar 2018 FY started in 2017 < 2018-01-01!), ZERO invented `2018-12-31`!
    const year2018BoundaryQuestions: Array<{ q: string; appDate?: string | null }> = [
      {
        q: "ปี 2561 บริษัทจ่ายเงินบริจาคให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายตามมาตรา 65 ตรี (3) ได้หรือไม่",
      },
      {
        q: "In 2018, can a Thai corporate taxpayer deduct a 50,000 THB political party donation under Section 65 ter (3)?",
      },
      {
        q: "For fiscal year 2018, can our company deduct a 50,000 baht political party contribution?",
      },
      {
        q: "บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายตามมาตรา 65 ตรี ได้หรือไม่",
        appDate: "2018",
      },
    ];

    for (const yq of year2018BoundaryQuestions) {
      const res = await queryKnowledge(
        { question: yq.q, applicable_date: yq.appDate ?? null, release_id: "rel.B01.rc5" },
        TEST_USER,
        { store }
      );
      expect(res.status, yq.q).toBe("NEEDS_CLARIFICATION");
      expect(res.clarification_questions.length, yq.q).toBeGreaterThan(0);
      expect(res.answer, `No invented 2018-12-31 in: ${yq.q}`).not.toContain("2018-12-31");
      expect(res.answer, `No invented 2018-05-01 in: ${yq.q}`).not.toContain("2018-05-01");
      // Traceable envelope must NEVER mark a clarification-needed answer as `complete`
      expect(res.traceable_answer?.status, yq.q).not.toBe("complete");
    }

    // 2. Year-only strictly pre-cutoff (`ปี 2560` / `ของปี 2559` / `As of 2017`) -> `INSUFFICIENT_EVIDENCE` containment, ZERO invented `-12-31`!
    for (const preYrQ of [
      "ปี 2560 บริษัทบริจาคเงินให้พรรคการเมือง 50,000 บาท หักเป็นรายจ่ายได้หรือไม่",
      "รายจ่ายบริจาคพรรคการเมืองของปี 2559 นำมาหักกำไรสุทธิได้ไหม",
      "As of 2017, could a Thai company deduct a 50,000 THB political party donation?",
    ]) {
      const res = await queryKnowledge(
        { question: preYrQ, release_id: "rel.B01.rc5" },
        TEST_USER,
        { store }
      );
      expect(res.status, preYrQ).toBe("INSUFFICIENT_EVIDENCE");
      expect(res.evidence, preYrQ).toEqual([]);
      expect(res.answer, preYrQ).not.toContain("-12-31");
    }

    // 3. Month-only Thai & English questions AND invalid calendar dates across ALL HTTP paths -> `NEEDS_CLARIFICATION`!
    const monthOnlyEn =
      "In Feb, our Thai company sold goods to a foreign economic and trade office in Thailand. Does 0% VAT under Section 80/1 (5) apply?";
    const monthOnlyThWithAmount =
      "ในเดือนมิถุนายน 50,000 บาท บริษัทจ่ายเงินบริจาคให้พรรคการเมือง หักรายจ่ายตามมาตรา 65 ตรี ได้หรือไม่?";
    const invalidFeb30Q =
      "เมื่อวันที่ 30 กุมภาพันธ์ 2562 บริษัทขายสินค้าให้สำนักงานเศรษฐกิจและการค้าของต่างประเทศ ได้สิทธิ VAT 0% หรือไม่?";

    for (const testQ of [monthOnlyEn, monthOnlyThWithAmount, invalidFeb30Q]) {
      const apiJson = await (
        await queryPost(
          new Request("http://localhost/api/v1/knowledge/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: testQ }),
          })
        )
      ).json();
      expect(apiJson.answer.status, `Query API: ${testQ}`).toBe("NEEDS_CLARIFICATION");

      const researchJson = await (
        await legalResearchPost(
          new NextRequest("http://localhost/api/v1/legal-research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: testQ }),
          })
        )
      ).json();
      expect(researchJson.grounded_status, `Research API: ${testQ}`).toBe("NEEDS_CLARIFICATION");

      const reportJson = await (
        await reportGeneratePost(
          new NextRequest("http://localhost/api/v1/reports/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query_or_topic: testQ }),
          })
        )
      ).json();
      expect(reportJson.grounded_status, `Reports API: ${testQ}`).toBe("NEEDS_CLARIFICATION");

      const analyzeJson = await (
        await legalAnalyzePost(
          new NextRequest("http://localhost/api/v1/legal/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: testQ }),
          })
        )
      ).json();
      expect(analyzeJson.grounded_status, `Analyze API: ${testQ}`).toBe("NEEDS_CLARIFICATION");

      const mcpJson = await (
        await mcpPost(
          new NextRequest("http://localhost/api/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "mcp-dodo-date",
              method: "tools/call",
              params: {
                name: "reg24.citations.ask_traceable",
                arguments: { question: testQ },
              },
            }),
          })
        )
      ).json();
      expect(
        mcpJson.result.structuredContent.grounded_status,
        `MCP API: ${testQ}`
      ).toBe("NEEDS_CLARIFICATION");
    }

    // 4. Multi-version onboarded statute (`ป.พ.พ. มาตรา 1097`: v1 `2008-07-01..2023-02-06` = 3 promoters, v2 `2023-02-07..open` = 2 promoters):
    //    Verify year-only, month+year, month-only, and invalid `applicable_date` values NEVER select the wrong version or invent `-12-31`!
    const v1 = onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ป.พ.พ. มาตรา 1097",
      original_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097",
      observed_url: "https://ratchakitcha.soc.go.th/documents/ccc-1097-v1.pdf",
      mime_type: "application/pdf",
      captured_bytes:
        "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 บุคคลใดๆ ตั้งแต่สามคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
      effective_from: "2008-07-01",
      effective_to: "2023-02-06",
    });
    onboardOfficialSourceDocument(store, {
      batch_id: "B01",
      release_id: "rel.B01.rc5",
      source_family: "gazette_enactment",
      issuer_id: "reg.th.soc_ratchakitcha",
      source_native_id: "ป.พ.พ. มาตรา 1097",
      original_title_th: "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097",
      observed_url: "https://ratchakitcha.soc.go.th/documents/ccc-1097-v2.pdf",
      mime_type: "application/pdf",
      captured_bytes:
        "ประมวลกฎหมายแพ่งและพาณิชย์ มาตรา 1097 บุคคลใดๆ ตั้งแต่สองคนขึ้นไปจะเริ่มก่อการและตั้งเป็นบริษัทจำกัดก็ได้",
      effective_from: "2023-02-07",
      predecessor_version_id: v1.version.version_id,
      is_verified_amendment: true,
    });

    // 4a. `applicable_date: "2022"` (entire year 2022 is inside v1) -> selects v1 ("สามคนขึ้นไป"), keeps `as_of_date === "2022"` (NO invented `"2022-12-31"`!)
    const yr2022 = await queryKnowledge(
      { question: "ป.พ.พ. มาตรา 1097 กำหนดผู้เริ่มก่อการกี่คน", applicable_date: "2022" },
      TEST_USER,
      { store }
    );
    expect(yr2022.status).toBe("ANSWERED");
    expect(yr2022.traceable_answer?.claims[0].text).toContain("สามคนขึ้นไป");
    expect(yr2022.traceable_answer?.as_of_date).toBe("2022");

    // 4b. `applicable_date: "2023"` (straddles `2023-02-07`!) -> MUST return `NEEDS_CLARIFICATION`, NEVER lexicographically pick v1!
    const yr2023Straddle = await queryKnowledge(
      { question: "ป.พ.พ. มาตรา 1097 กำหนดผู้เริ่มก่อการกี่คน", applicable_date: "2023" },
      TEST_USER,
      { store }
    );
    expect(yr2023Straddle.status).toBe("NEEDS_CLARIFICATION");
    expect(yr2023Straddle.traceable_answer?.claims.length).toBe(0);

    // 4c. `applicable_date: "February 2023"` (`2023-02` straddles `2023-02-07`!) -> MUST return `NEEDS_CLARIFICATION`, NEVER invent `2023-02-28`!
    const feb2023Straddle = await queryKnowledge(
      { question: "ป.พ.พ. มาตรา 1097 กำหนดผู้เริ่มก่อการกี่คน", applicable_date: "February 2023" },
      TEST_USER,
      { store }
    );
    expect(feb2023Straddle.status).toBe("NEEDS_CLARIFICATION");
    expect(feb2023Straddle.traceable_answer?.claims.length).toBe(0);

    // 4d. `applicable_date: "March 2023"` (`2023-03` is 100% inside v2) -> selects v2 ("สองคนขึ้นไป"), keeps `as_of_date === "2023-03"`!
    const mar2023Ok = await queryKnowledge(
      { question: "ป.พ.พ. มาตรา 1097 กำหนดผู้เริ่มก่อการกี่คน", applicable_date: "March 2023" },
      TEST_USER,
      { store }
    );
    expect(mar2023Ok.status).toBe("ANSWERED");
    expect(mar2023Ok.traceable_answer?.claims[0].text).toContain("สองคนขึ้นไป");
    expect(mar2023Ok.traceable_answer?.as_of_date).toBe("2023-03");

    // 4e. `applicable_date: "June"` or `"2023-02-30"` -> `NEEDS_CLARIFICATION`, 0 claims!
    for (const badAppDate of ["June", "มิถุนายน", "2023-02-30"]) {
      const badAns = await queryKnowledge(
        { question: "ป.พ.พ. มาตรา 1097 กำหนดผู้เริ่มก่อการกี่คน", applicable_date: badAppDate },
        TEST_USER,
        { store }
      );
      expect(badAns.status, badAppDate).toBe("NEEDS_CLARIFICATION");
      expect(badAns.traceable_answer?.claims.length, badAppDate).toBe(0);
    }

    // 5. Verify `/api/v1/knowledge/legal-spotcheck-cases` serves the full 30-case Legal Team pack for `/legal-review`!
    const packRes = await spotcheckCasesGet(
      new Request("http://localhost/api/v1/knowledge/legal-spotcheck-cases")
    );
    expect(packRes.status).toBe(200);
    const packJson = await packRes.json();
    expect(packJson.ok).toBe(true);
    expect(packJson.total_cases).toBe(30);
    expect(packJson.cases.length).toBe(30);
  });
});
