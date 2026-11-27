import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DurableKnowledgeStore, setDefaultKnowledgeStoreForTesting } from "../../src/core/knowledge/store";
import {
  markHistoricalAttachmentSupersededOrUnverified,
  onboardVerifiedOfficialAttachment,
  setTrustedPublisherFetcherForTesting,
} from "../../src/core/knowledge/source-onboarding";
import {
  loadSavedAnswerFromPostgres,
  setCustomCitationDbTransportForTesting,
} from "../../src/core/knowledge/citation-postgres-store";
import * as cte from "../../src/core/knowledge/claim-traceability-engine";
import { POST as attachmentsPost } from "../../src/app/api/v1/knowledge/attachments/route";
import type { Actor } from "../../src/core/knowledge/contracts";

const OFFICIAL_RD807_URL = "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc807.pdf";
const OFFICIAL_RD807_SHA256 = "a4e0c55a2324397af4079317d2a5138fa075fcd87eb9348771742ed7ad6dab70";

const GENUINE_RD807_PAGE1_EXCERPT =
  "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙\n" +
  "ให้ไว้ ณ วันที่ ๒๐ สิงหาคม พ.ศ. ๒๕๖๙ เป็นปีที่ ๑๑ ในรัชกาลปัจจุบัน\n" +
  "มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙”\n" +
  "มาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙ เป็นต้นไป";

// Exact mismatched C12 QA ISO-X fixture (wrong signing date ๑๗ สิงหาคม + wrong publication_date)
const MISMATCHED_C12_ISOX_EXCERPT =
  "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙ " +
  "ให้ไว้ ณ วันที่ ๑๗ สิงหาคม พ.ศ. ๒๕๖๙ " +
  'มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๘๐๗) พ.ศ. ๒๕๖๙" ' +
  "มาตรา ๒ พระราชกฤษฎีกานี้ให้ใช้บังคับตั้งแต่วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙ เป็นต้นไป";

const REVIEWER_A: Actor = {
  actor_id: "trial.user.isox_reviewer_a@reg24.th",
  role: "reader",
  tenant_id: "tenant.trial.isox_a",
  authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.isox_a"],
  csrf_verified: true,
};

const REVIEWER_B: Actor = {
  actor_id: "trial.user.isox_reviewer_b@reg24.th",
  role: "reader",
  tenant_id: "tenant.trial.isox_b",
  authorized_scopes: ["scope.platform.public", "scope.tenant.tenant.trial.isox_b"],
  csrf_verified: true,
};

function cloneCanonicalStoreToTemp(prefix: string): { dir: string; store: DurableKnowledgeStore } {
  const srcDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const gz = path.join(srcDir, "canonical-state.json.gz");
  if (fs.existsSync(gz)) {
    fs.copyFileSync(gz, path.join(dir, "canonical-state.json.gz"));
  } else {
    fs.copyFileSync(path.join(srcDir, "canonical-state.json"), path.join(dir, "canonical-state.json"));
  }
  const store = new DurableKnowledgeStore(dir);
  return { dir, store };
}

describe("ISO-X Trusted Source Verification (Server-Side Excerpt, Locator & Version Checks)", () => {
  const tempDirs: string[] = [];
  let store: DurableKnowledgeStore;

  beforeEach(() => {
    const cloned = cloneCanonicalStoreToTemp("reg24-isox-");
    tempDirs.push(cloned.dir);
    store = cloned.store;
    setDefaultKnowledgeStoreForTesting(store);
  });

  afterEach(() => {
    setTrustedPublisherFetcherForTesting(null);
    setCustomCitationDbTransportForTesting(null);
    setDefaultKnowledgeStoreForTesting(null);
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("ISOX-1 (Mismatched C12 fixture): rejects / leaves unverified the altered ๑๗ สิงหาคม / wrong-date RD 807 attachment and excludes it from governing evidence", async () => {
    const fpBefore = cte.computeEligibleReleaseCorpusFingerprint(store, "rel.B01.rc8");

    // 1. Direct onboarding check MUST NOT produce an eligible governing attachment
    let directDocId: string | null = null;
    let directEligible = false;
    try {
      const res = onboardVerifiedOfficialAttachment(store, {
        release_id: "rel.B01.rc8",
        issuer_id: "reg.th.rd",
        source_family: "gazette_enactment",
        source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 มาตรา 1-2 (Mismatched ISO-X)",
        original_title_th:
          "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569",
        official_origin_url: OFFICIAL_RD807_URL,
        publication_date: "2026-08-20",
        effective_from: "2026-10-01",
        section_label: "มาตรา ๑",
        physical_page_one_based: 1,
        mime_type: "application/pdf",
        attachment_bytes_or_text: MISMATCHED_C12_ISOX_EXCERPT,
        actor: REVIEWER_A,
      });
      directDocId = res.doc.doc_id;
      directEligible = res.doc.eligible_for_citation || Boolean(res.passages[0]?.eligible_for_publication);
    } catch {
      directEligible = false;
    }
    expect(directEligible).toBe(false);

    // If an unverified quarantined record was stored, querying with its doc_id MUST exclude it from governing evidence!
    if (directDocId) {
      const ans = cte.tryAnswerFromOnboardedCitationSources(store, {
        question: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ พระราชกฤษฎีกาฉบับนี้ให้ไว้ ณ วันที่ใด",
        applicable_date: null,
        release_id: "rel.B01.rc8",
        actor: REVIEWER_A,
        attachment_doc_ids: [directDocId],
        persist: false,
      });
      expect(ans?.status === "INSUFFICIENT_EVIDENCE" || ans === null).toBe(true);
      expect(ans?.claims?.filter((c) => c.claim_type !== "abstention_notice").length ?? 0).toBe(0);
      expect(ans?.answer || "").not.toMatch(/๑๗ สิงหาคม|17 สิงหาคม/);
    }

    // 2. HTTP /api/v1/knowledge/attachments MUST return 422 (unverified) for the mismatched fixture
    const httpRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": REVIEWER_A.actor_id,
        },
        body: JSON.stringify({
          issuer_id: "reg.th.rd",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 มาตรา 1-2 (Mismatched HTTP)",
          original_title_th:
            "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569",
          official_origin_url: OFFICIAL_RD807_URL,
          publication_date: "2026-10-01",
          effective_from: "2026-10-01",
          section_label: "มาตรา ๑",
          physical_page_one_based: 1,
          attachment_text: MISMATCHED_C12_ISOX_EXCERPT,
        }),
      })
    );
    expect(httpRes.status).toBe(422);

    // Release corpus fingerprint MUST remain untouched
    const fpAfter = cte.computeEligibleReleaseCorpusFingerprint(store, "rel.B01.rc8");
    expect(fpAfter.eligible_official_documents).toBe(fpBefore.eligible_official_documents);
    expect(fpAfter.eligible_evidence_passages).toBe(fpBefore.eligible_evidence_passages);
    expect(fpAfter.eligible_corpus_fingerprint_sha256).toBe(fpBefore.eligible_corpus_fingerprint_sha256);
  });

  it("ISOX-2 (Generic non-RD-807 negative controls): leaves unverified any statute with altered wording, wrong publication/effective date, wrong page locator, or unconfirmed external URL", () => {
    // 2a. Non-RD-807 statute (RD 799) with altered wording/date in excerpt vs canonical record
    let rd799AlteredEligible = false;
    try {
      const r = onboardVerifiedOfficialAttachment(store, {
        release_id: "rel.B01.rc8",
        issuer_id: "reg.th.rd",
        source_family: "gazette_enactment",
        source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 มาตรา 1-2 [Altered]",
        original_title_th:
          "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 799) พ.ศ. 2568",
        official_origin_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
        publication_date: "2025-09-14",
        effective_from: "2025-10-01",
        section_label: "มาตรา ๑",
        physical_page_one_based: 1,
        mime_type: "application/pdf",
        attachment_bytes_or_text:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ ให้ไว้ ณ วันที่ ๙ กันยายน พ.ศ. ๒๕๖๘ มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘”",
        actor: REVIEWER_A,
      });
      rd799AlteredEligible = r.doc.eligible_for_citation;
    } catch {
      rd799AlteredEligible = false;
    }
    expect(rd799AlteredEligible).toBe(false);

    // 2b. Non-RD-807 statute (RD 799) with wrong publication_date (passing signing date 2025-09-13 instead of Gazette publication date 2025-09-14)
    let rd799WrongPubDateEligible = false;
    try {
      const r = onboardVerifiedOfficialAttachment(store, {
        release_id: "rel.B01.rc8",
        issuer_id: "reg.th.rd",
        source_family: "gazette_enactment",
        source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 799) พ.ศ. 2568 มาตรา 1-2 [WrongPubDate]",
        original_title_th:
          "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 799) พ.ศ. 2568",
        official_origin_url: "https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dc799.pdf",
        publication_date: "2025-09-13",
        effective_from: "2025-10-01",
        section_label: "มาตรา ๑",
        physical_page_one_based: 1,
        mime_type: "application/pdf",
        attachment_bytes_or_text:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘ ให้ไว้ ณ วันที่ ๑๓ กันยายน พ.ศ. ๒๕๖๘ มาตรา ๑ พระราชกฤษฎีกานี้เรียกว่า “พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ ๗๙๙) พ.ศ. ๒๕๖๘”",
        actor: REVIEWER_A,
      });
      rd799WrongPubDateEligible = r.doc.eligible_for_citation;
    } catch {
      rd799WrongPubDateEligible = false;
    }
    expect(rd799WrongPubDateEligible).toBe(false);

    // 2c. Wrong page locator (claiming page 2 for มาตรา ๑ which is on page 1 in canonical RD 807)
    let wrongPageEligible = false;
    try {
      const r = onboardVerifiedOfficialAttachment(store, {
        release_id: "rel.B01.rc8",
        issuer_id: "reg.th.rd",
        source_family: "gazette_enactment",
        source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 มาตรา 1-2 [WrongPage]",
        original_title_th:
          "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569",
        official_origin_url: OFFICIAL_RD807_URL,
        publication_date: "2026-08-23",
        effective_from: "2026-10-01",
        section_label: "มาตรา ๑",
        physical_page_one_based: 2,
        mime_type: "application/pdf",
        attachment_bytes_or_text: GENUINE_RD807_PAGE1_EXCERPT,
        actor: REVIEWER_A,
      });
      wrongPageEligible = r.doc.eligible_for_citation;
    } catch {
      wrongPageEligible = false;
    }
    expect(wrongPageEligible).toBe(false);

    // 2d. Unconfirmed external document on permitted host (no canonical record & no trusted publisher copy)
    let unconfirmedEligible = false;
    try {
      const r = onboardVerifiedOfficialAttachment(store, {
        release_id: "rel.B01.rc8",
        issuer_id: "reg.th.soc_ratchakitcha",
        source_family: "gazette_enactment",
        source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 9999) พ.ศ. 2569 มาตรา 1 [Unconfirmed]",
        original_title_th: "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร (ฉบับที่ 9999) พ.ศ. 2569",
        official_origin_url: "https://ratchakitcha.soc.go.th/documents/unconfirmed-9999.pdf",
        publication_date: "2026-08-23",
        effective_from: "2026-10-01",
        section_label: "มาตรา 1",
        physical_page_one_based: 1,
        mime_type: "application/pdf",
        attachment_bytes_or_text:
          "ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๙๙ ก พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร (ฉบับที่ 9999) พ.ศ. 2569 มาตรา 1 ให้ยกเว้นภาษีทุกประเภทโดยไม่มีเงื่อนไข",
        actor: REVIEWER_A,
      });
      unconfirmedEligible = r.doc.eligible_for_citation;
    } catch {
      unconfirmedEligible = false;
    }
    expect(unconfirmedEligible).toBe(false);
  });

  it("ISOX-3 (Genuine official RD 807 excerpt): verifies cleanly with separated dates (signed 2026-08-20, published 2026-08-23, effective 2026-10-01), retains exact citation on Save/Reopen, stays tenant/matter isolated, and preserves corpus fingerprint", async () => {
    const fpBefore = cte.computeEligibleReleaseCorpusFingerprint(store, "rel.B01.rc8");
    expect(fpBefore.eligible_official_documents).toBe(5070);
    expect(fpBefore.eligible_evidence_passages).toBe(11783);

    const onboarded = onboardVerifiedOfficialAttachment(store, {
      release_id: "rel.B01.rc8",
      issuer_id: "reg.th.rd",
      source_family: "gazette_enactment",
      source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 มาตรา 1-2 (Official Verified)",
      original_title_th:
        "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569",
      official_origin_url: OFFICIAL_RD807_URL,
      expected_artifact_sha256: OFFICIAL_RD807_SHA256,
      royal_gazette_ref: "ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๕๐ ก หน้า ๒๐–๒๒ วันที่ ๒๓ สิงหาคม ๒๕๖๙",
      enactment_date: "2026-08-20",
      publication_date: "2026-08-23",
      effective_from: "2026-10-01",
      section_label: "มาตรา ๑",
      physical_page_one_based: 1,
      printed_page_label: "หน้า ๒๐",
      mime_type: "application/pdf",
      attachment_bytes_or_text: GENUINE_RD807_PAGE1_EXCERPT,
      actor: REVIEWER_A,
    });

    expect(onboarded.verified).toBe(true);
    expect(onboarded.trusted_source_verification.reference_kind).toBe("reviewed_canonical_record");
    expect(onboarded.trusted_source_verification.excerpt_verified).toBe(true);
    expect(onboarded.trusted_source_verification.locator_verified).toBe(true);
    expect(onboarded.trusted_source_verification.version_verified).toBe(true);
    expect(onboarded.trusted_source_verification.checksum_verified).toBe(true);
    expect(onboarded.doc.eligible_for_citation).toBe(true);
    expect(onboarded.passages[0]?.eligible_for_publication).toBe(true);
    expect(onboarded.version.source_metadata.enactment_date).toBe("2026-08-20");
    expect(onboarded.version.publication_date).toBe("2026-08-23");
    expect(onboarded.version.effective_from).toBe("2026-10-01");
    expect(onboarded.version.source_metadata.official_artifact_sha256).toBe(OFFICIAL_RD807_SHA256);
    expect(onboarded.doc.access_scope).toBe(`scope.tenant.${REVIEWER_A.tenant_id}`);

    // Generate -> Save -> Reopen
    const gen = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ พระราชกฤษฎีกาฉบับนี้ให้ไว้ ณ วันที่ใด และมีชื่อเต็มว่าอย่างไร",
      applicable_date: null,
      release_id: "rel.B01.rc8",
      actor: REVIEWER_A,
      attachment_doc_ids: [onboarded.doc.doc_id],
      persist: false,
    });
    expect(gen?.status).toBe("ANSWERED");
    expect(gen?.answer).toContain("๒๐ สิงหาคม พ.ศ. ๒๕๖๙");
    expect(gen?.traceable_answer?.claims.length).toBeGreaterThanOrEqual(1);
    expect(gen?.traceable_answer?.claims[0].evidence_references[0].evidence_id).toBe(
      onboarded.passages[0].passage_id
    );

    const saved = await cte.saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: gen!.traceable_answer!,
      question_text: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      revision_reason: "ISO-X genuine RD 807 verified save",
      actor: REVIEWER_A,
      grounded_answer_snapshot: gen!,
    });
    const reopenedA = cte.reopenSavedTraceableAnswer(store, saved.answer_revision, REVIEWER_A);
    expect(reopenedA.found).toBe(true);
    expect(reopenedA.answer?.claims[0].evidence_references[0].evidence_id).toBe(
      onboarded.passages[0].passage_id
    );
    expect(reopenedA.answer?.claims[0].evidence_references[0].official_url).toBe(OFFICIAL_RD807_URL);

    // Tenant & matter isolation checks
    const reopenedB = cte.reopenSavedTraceableAnswer(store, saved.answer_revision, REVIEWER_B);
    expect(reopenedB.found).toBe(false);
    expect(reopenedB.http_status).toBe(404);

    const outOfMatterA = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      applicable_date: null,
      release_id: "rel.B01.rc8",
      actor: REVIEWER_A,
      attachment_doc_ids: [],
      persist: false,
    });
    expect(outOfMatterA).toBeNull();

    const crossTenantB = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      applicable_date: null,
      release_id: "rel.B01.rc8",
      actor: REVIEWER_B,
      attachment_doc_ids: [onboarded.doc.doc_id],
      persist: false,
    });
    expect(crossTenantB?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(crossTenantB?.claims).toHaveLength(0);

    // Corpus fingerprint 5,070 / 11,783 / LiveFP strictly unchanged
    const fpAfter = cte.computeEligibleReleaseCorpusFingerprint(store, "rel.B01.rc8");
    expect(fpAfter.eligible_official_documents).toBe(5070);
    expect(fpAfter.eligible_evidence_passages).toBe(11783);
    expect(fpAfter.eligible_corpus_fingerprint_sha256).toBe(fpBefore.eligible_corpus_fingerprint_sha256);
    expect(OFFICIAL_RD807_SHA256).toHaveLength(64);
  });

  it("ISOX-4 (Trusted publisher copy path for non-canonical statute): verifies matching excerpt/locator/dates against server-side publisher copy and rejects altered wording or checksum", async () => {
    const syntheticUrl = "https://ratchakitcha.soc.go.th/documents/rd-812-synthetic-test.pdf";
    const syntheticSha = "1111111111111111111111111111111111111111111111111111111111111111";
    const trustedPageText =
      "ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๖๒ ก หน้า ๕ วันที่ ๑๐ พฤศจิกายน ๒๕๖๙\n" +
      "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ ๘๑๒) พ.ศ. ๒๕๖๙\n" +
      "ให้ไว้ ณ วันที่ ๕ พฤศจิกายน พ.ศ. ๒๕๖๙\n" +
      "มาตรา ๓ ให้ยกเว้นภาษีเงินได้นิติบุคคลสำหรับรายจ่ายฝึกอบรมทักษะดิจิทัลร้อยละหนึ่งร้อย";

    setTrustedPublisherFetcherForTesting(async ({ official_url }) => {
      if (official_url !== syntheticUrl) return null;
      return {
        official_url: syntheticUrl,
        artifact_sha256: syntheticSha,
        enactment_date: "2026-11-05",
        publication_date: "2026-11-10",
        effective_from: "2026-11-11",
        pages: [
          {
            physical_page_one_based: 1,
            printed_page_label: "หน้า ๕",
            page_text_verbatim: trustedPageText,
          },
        ],
      };
    });

    // 4a. Matching upload verifies via server-side trusted publisher copy
    const okRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": REVIEWER_A.actor_id,
        },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 812) พ.ศ. 2569 มาตรา 3",
          original_title_th:
            "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 812) พ.ศ. 2569",
          official_origin_url: syntheticUrl,
          expected_artifact_sha256: syntheticSha,
          enactment_date: "2026-11-05",
          publication_date: "2026-11-10",
          effective_from: "2026-11-11",
          section_label: "มาตรา ๓",
          physical_page_one_based: 1,
          printed_page_label: "หน้า ๕",
          attachment_text: trustedPageText,
        }),
      })
    );
    expect(okRes.status).toBe(200);
    const okJson = await okRes.json();
    expect(okJson.ok).toBe(true);
    expect(okJson.trusted_source_verification.reference_kind).toBe("trusted_publisher_copy");
    expect(okJson.enactment_date).toBe("2026-11-05");
    expect(okJson.publication_date).toBe("2026-11-10");
    expect(okJson.effective_from).toBe("2026-11-11");

    // 4b. Tampered wording ("ร้อยละสองร้อย" instead of "ร้อยละหนึ่งร้อย") fails closed (422)
    const badTextRes = await attachmentsPost(
      new Request("http://localhost/api/v1/knowledge/attachments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-actor-id": REVIEWER_A.actor_id,
        },
        body: JSON.stringify({
          issuer_id: "reg.th.soc_ratchakitcha",
          source_family: "gazette_enactment",
          source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 812) พ.ศ. 2569 มาตรา 3 [Tampered]",
          original_title_th:
            "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 812) พ.ศ. 2569",
          official_origin_url: syntheticUrl,
          enactment_date: "2026-11-05",
          publication_date: "2026-11-10",
          effective_from: "2026-11-11",
          section_label: "มาตรา ๓",
          physical_page_one_based: 1,
          attachment_text: trustedPageText.replace("ร้อยละหนึ่งร้อย", "ร้อยละสองร้อย"),
        }),
      })
    );
    expect(badTextRes.status).toBe(422);
    const badTextJson = await badTextRes.json();
    expect(badTextJson.verified).toBe(false);
    expect(badTextJson.eligible_for_citation).toBe(false);
  });

  it("ISOX-5 (Isolated historical supersession demo mirroring C12 odoc.bee40524d4ca7c5e + r1/r2): authorized reviewer still views historical revisions & preserved audit trail without superseded evidence appearing currently verified, while new queries exclude it", async () => {
    // 1. Seed a historical attachment + saved r1 and r2 in this isolated temp store (NEVER touching Neon!)
    const histAtt = onboardVerifiedOfficialAttachment(store, {
      release_id: "rel.B01.rc8",
      issuer_id: "reg.th.rd",
      source_family: "gazette_enactment",
      source_native_id: "พระราชกฤษฎีกา (ฉบับที่ 807) พ.ศ. 2569 มาตรา 1-2 [Isolated Historical Demo]",
      original_title_th:
        "พระราชกฤษฎีกา ออกตามความในประมวลรัษฎากร ว่าด้วยการลดอัตราภาษีมูลค่าเพิ่ม (ฉบับที่ 807) พ.ศ. 2569",
      official_origin_url: OFFICIAL_RD807_URL,
      enactment_date: "2026-08-20",
      publication_date: "2026-08-23",
      effective_from: "2026-10-01",
      section_label: "มาตรา ๑",
      physical_page_one_based: 1,
      mime_type: "application/pdf",
      attachment_bytes_or_text: GENUINE_RD807_PAGE1_EXCERPT,
      actor: REVIEWER_A,
    });
    expect(histAtt.verified).toBe(true);

    const genR1 = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      applicable_date: null,
      release_id: "rel.B01.rc8",
      actor: REVIEWER_A,
      attachment_doc_ids: [histAtt.doc.doc_id],
      persist: false,
    });
    expect(genR1?.status).toBe("ANSWERED");

    const savedR1 = await cte.saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: genR1!.traceable_answer!,
      question_text: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      revision_reason: "Historical r1 prior to supersession",
      actor: REVIEWER_A,
      grounded_answer_snapshot: genR1!,
    });
    const savedR2 = await cte.saveOrReviseAnswerServerVerified(store, {
      submitted_envelope: {
        ...savedR1,
        supersedes_answer_revision: savedR1.answer_revision,
      },
      question_text: "ตามเอกสารแนบเดิม มาตรา ๒ ใช้บังคับตั้งแต่วันใด",
      revision_reason: "Historical r2 follow-up prior to supersession",
      actor: REVIEWER_A,
      grounded_answer_snapshot: genR1!,
    });

    // 2. Non-destructively supersede / mark the historical attachment as unverified (preserving r1, r2 & audit trail)
    const superseded = markHistoricalAttachmentSupersededOrUnverified(store, {
      doc_id: histAtt.doc.doc_id,
      actor: REVIEWER_A,
      status: "superseded_historical",
      reason: "Superseded after ISO-X trusted-source verification remediation; retained read-only for audit review.",
    });
    expect(superseded.doc.eligible_for_citation).toBe(false);
    expect(superseded.audit_event.event_type).toBe("OFFICIAL_ATTACHMENT_SUPERSEDED");

    // 3. Authorized reviewer CAN still reopen BOTH r1 and r2 and view preserved audit trail,
    //    AND superseded evidence is explicitly marked NOT currently verified!
    for (const revId of [savedR1.answer_revision, savedR2.answer_revision]) {
      const reopened = cte.reopenSavedTraceableAnswer(store, revId, REVIEWER_A);
      expect(reopened.found).toBe(true);
      expect(reopened.http_status).toBe(200);
      expect(reopened.answer?.revision_history?.length).toBe(2);
      const ref = reopened.answer?.claims[0].evidence_references[0];
      expect(ref?.currently_verified).toBe(false);
      expect(ref?.historical_evidence_status).toBe("superseded_historical");
      expect(ref?.verification_status).toBe("needs_review");
      expect(ref?.historical_evidence_notice_th).toContain(histAtt.doc.doc_id);
      expect(reopened.answer?.historical_evidence_warnings_th?.length).toBeGreaterThanOrEqual(1);
      expect(
        reopened.audit_events?.some((e) => e.event_type === "OFFICIAL_ATTACHMENT_SUPERSEDED")
      ).toBe(true);
    }

    // 4. Evidence resolver also lets authorized reviewer inspect the preserved copy as QUARANTINED / NOT currently verified,
    //    while unauthorized cross-tenant reviewer STILL receives 404!
    const evA = cte.resolveTraceableEvidenceById(store, histAtt.passages[0].passage_id, REVIEWER_A, "rel.B01.rc8");
    expect(evA.ok).toBe(true);
    expect(evA.evidence?.verification_status).toBe("QUARANTINED");
    expect(evA.evidence?.currently_verified).toBe(false);
    expect(evA.evidence?.historical_evidence_status).toBe("superseded_historical");

    const evB = cte.resolveTraceableEvidenceById(store, histAtt.passages[0].passage_id, REVIEWER_B, "rel.B01.rc8");
    expect(evB.ok).toBe(false);
    expect(evB.http_status).toBe(404);

    const reopenB = cte.reopenSavedTraceableAnswer(store, savedR1.answer_revision, REVIEWER_B);
    expect(reopenB.found).toBe(false);
    expect(reopenB.http_status).toBe(404);

    // 5. New queries referencing the superseded doc_id MUST exclude it from governing evidence!
    const newQueryAfterSupersede = cte.tryAnswerFromOnboardedCitationSources(store, {
      question: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      applicable_date: null,
      release_id: "rel.B01.rc8",
      actor: REVIEWER_A,
      attachment_doc_ids: [histAtt.doc.doc_id],
      persist: false,
    });
    expect(newQueryAfterSupersede?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(newQueryAfterSupersede?.claims).toHaveLength(0);
    expect(newQueryAfterSupersede?.evidence).toHaveLength(0);

    // 6. Verify identical Postgres reopen semantics via in-memory mock transport (NEVER hitting live Neon!)
    const mockRow = {
      answer_revision_id: savedR1.answer_revision,
      answer_id: savedR1.answer_id,
      revision_number: 1,
      supersedes_revision_id: null,
      channel: "api",
      question_text: "ตามเอกสารแนบ พ.ร.ฎ. ฉบับที่ 807 มาตรา ๑ ให้ไว้ ณ วันที่ใด",
      generated_at: savedR1.generated_at,
      as_of_date_raw: null,
      status: "complete",
      rendered_answer_th: savedR1.rendered_answer_th,
      ordered_claim_ids: [savedR1.claims[0].claim_id],
      unresolved_issues: [],
      user_supplied_facts: [],
      assumptions: [],
      legacy_warning_th: null,
      release_id: "rel.B01.rc8",
      verifier_version: savedR1.verifier_metadata.verifier_version,
      ruleset_version: savedR1.verifier_metadata.ruleset_version,
      owner_actor_id: REVIEWER_A.actor_id,
      owner_tenant_id: REVIEWER_A.tenant_id,
      actor_id: REVIEWER_A.actor_id,
      tenant_id: REVIEWER_A.tenant_id,
      revision_reason: "Historical r1 prior to supersession",
      execution_provenance: {},
    };
    setCustomCitationDbTransportForTesting(async <T = Record<string, unknown>>(query: string) => {
      const q = query.trim();
      if (q.startsWith("SELECT answer_revision_id, answer_id, revision_number, supersedes_revision_id,")) {
        return { rows: [mockRow] as unknown as T[], rowCount: 1 };
      }
      if (q.startsWith("SELECT answer_revision_id, revision_number, supersedes_revision_id,")) {
        return { rows: [mockRow] as unknown as T[], rowCount: 1 };
      }
      if (q.startsWith("SELECT claim_id, display_order, displayed_claim_text,")) {
        return {
          rows: [
            {
              claim_id: savedR1.claims[0].claim_id,
              display_order: 1,
              displayed_claim_text: savedR1.claims[0].text,
              claim_type: "legal_proposition",
              premise_claim_ids: [],
              verification_decision: "supported",
              published: true,
              withheld_reason_th: null,
              bound_calculation: null,
            },
          ] as unknown as T[],
          rowCount: 1,
        };
      }
      if (q.includes("FROM citation_claim_evidence_link l")) {
        return {
          rows: [
            {
              link_id: "cel.isox.demo.1",
              claim_id: savedR1.claims[0].claim_id,
              passage_id: histAtt.passages[0].passage_id,
              version_id: histAtt.version.version_id,
              support_role: "verified_attachment_authority",
              required_group: "grp.primary",
              citation_label_th: histAtt.doc.source_native_id,
              official_url: OFFICIAL_RD807_URL,
              resolver_url: `/api/v1/knowledge/evidence/${encodeURIComponent(histAtt.passages[0].passage_id)}`,
              human_pinpoint_th: histAtt.passages[0].human_pinpoint_th,
              doc_id: histAtt.doc.doc_id,
              extraction_revision_id: histAtt.passages[0].extraction_revision_id,
              section_paragraph_path: histAtt.passages[0].section_paragraph_path,
              physical_page_start: 1,
              physical_page_end: 1,
              printed_page_start: "หน้า ๒๐",
              printed_page_end: "หน้า ๒๐",
              anchors: [],
              access_scope: histAtt.doc.access_scope,
              verbatim_text: histAtt.passages[0].verbatim_text,
              original_title_th: histAtt.doc.original_title_th,
              issuer_id: histAtt.doc.issuer_id,
              source_family: histAtt.doc.source_family,
              record_type: histAtt.doc.record_type,
              access_permission: histAtt.doc.access_permission,
              access_conditions_th: null,
              eligible_for_citation: false,
              eligible_for_publication: false,
              ineligible_reason: superseded.doc.ineligible_reason,
              quarantine_reason: superseded.doc.ineligible_reason,
              effective_from: "2026-10-01",
              publication_date: "2026-08-23",
              link_health: "verified_online",
              last_successful_verified_at: null,
            },
          ] as unknown as T[],
          rowCount: 1,
        };
      }
      if (q.includes("FROM citation_audit_event")) {
        return {
          rows: [superseded.audit_event] as unknown as T[],
          rowCount: 1,
        };
      }
      return { rows: [] as T[], rowCount: 0 };
    });

    const pgReopenA = await loadSavedAnswerFromPostgres(savedR1.answer_revision, REVIEWER_A);
    expect(pgReopenA.found).toBe(true);
    expect(pgReopenA.answer?.claims[0].evidence_references[0].currently_verified).toBe(false);
    expect(pgReopenA.answer?.claims[0].evidence_references[0].historical_evidence_status).toBe(
      "superseded_historical"
    );
    expect(pgReopenA.answer?.claims[0].evidence_references[0].verification_status).toBe("needs_review");
    expect(
      pgReopenA.audit_events?.some((e) => e.event_type === "OFFICIAL_ATTACHMENT_SUPERSEDED")
    ).toBe(true);

    const pgReopenB = await loadSavedAnswerFromPostgres(savedR1.answer_revision, REVIEWER_B);
    expect(pgReopenB.found).toBe(false);
    expect(pgReopenB.forbidden_restricted).toBe(true);
  });
});
