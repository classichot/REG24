import { describe, expect, it } from "vitest";
import {
  gradeHardenedCase,
  type HardenedEvalCase,
} from "../../src/core/knowledge/retrieval-benchmark-grader";

describe("REG24 Batch 1 Hardened Grader — Mandatory Negative Controls & Version-at-Hit-Position Rules", () => {
  it("Negative Control 1: Decree 807 after expiry (2027-10-01) FAILS if returned as governing, PASSES only if absent or explicitly labeled historical_or_excluded_context", () => {
    const postExpiryCase: HardenedEvalCase = {
      case_id: "NC-01-POST-807",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_POST_EXPIRY",
      category: "vat_post_expiry",
      question: "1 ตุลาคม 2570 อัตรา VAT เท่าใด พ.ร.ฎ. 807 ยังใช้บังคับหรือไม่",
      applicable_date: "2027-10-01",
      expected_evidence: [
        {
          work_id: "prov.th.rc.80",
          expected_version_id: "ver.th.rc.80.v1",
          required_passage_ids: ["psg.rc80.main"],
        },
      ],
      forbidden_governing_work_ids: ["subreg.th.rc.royal_decree.807"],
      allowed_historical_context_work_ids: ["subreg.th.rc.royal_decree.807"],
    };

    // Synthetic violation A: RD 807 returned as eligible governing authority in ranked hits -> MUST FAIL!
    const failRanked = gradeHardenedCase(postExpiryCase, {
      ranked_passages: [
        { rank: 1, passage_id: "psg.rc80.main", work_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_role: "governing" },
        { rank: 2, passage_id: "psg.rc7.rd807.sec_3_4", work_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v2", evidence_role: "governing" },
      ],
      actual_packet: [
        { position: 1, passage_id: "psg.rc80.main", work_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_role: "governing" },
      ],
      unresolved_ruling_ids: [],
      response_status: "READY_FOR_LLM_GROUNDED",
    });
    expect(failRanked.passed).toBe(false);
    expect(failRanked.expired_governing_leak).toBe(true);
    expect(failRanked.first_failing_step).toBe("EXPIRED_AUTHORITY_AS_GOVERNING");

    // Synthetic violation B: RD 807 absent from ranked hits, BUT leaked into actual model packet as governing -> MUST FAIL!
    const failPacket = gradeHardenedCase(postExpiryCase, {
      ranked_passages: [
        { rank: 1, passage_id: "psg.rc80.main", work_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_role: "governing" },
      ],
      actual_packet: [
        { position: 1, passage_id: "psg.rc80.main", work_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_role: "governing" },
        { position: 2, passage_id: "psg.rc7.rd807.sec_3_4", work_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v2", evidence_role: "governing" },
      ],
      unresolved_ruling_ids: [],
      response_status: "READY_FOR_LLM_GROUNDED",
    });
    expect(failPacket.passed).toBe(false);
    expect(failPacket.expired_governing_leak).toBe(true);

    // Valid behavior: RD 807 absent from eligible governing hits AND clearly labeled `historical_or_excluded_context` in packet -> PASS!
    const passHistorical = gradeHardenedCase(postExpiryCase, {
      ranked_passages: [
        { rank: 1, passage_id: "psg.rc80.main", work_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_role: "governing" },
      ],
      actual_packet: [
        { position: 1, passage_id: "psg.rc80.main", work_id: "prov.th.rc.80", version_id: "ver.th.rc.80.v1", evidence_role: "governing" },
        { position: 2, passage_id: "psg.rc7.rd807.sec_3_4", work_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v2", evidence_role: "historical_or_excluded_context" },
      ],
      unresolved_ruling_ids: [],
      response_status: "READY_FOR_LLM_GROUNDED",
    });
    expect(passHistorical.passed).toBe(true);
    expect(passHistorical.scoring_bucket).toBe("NEGATIVE_OR_ABSTENTION");
  });

  it("Negative Control 2: Wrong version ranked first, correct version lower down MUST FAIL (cannot be rescued!)", () => {
    const coveredCase: HardenedEvalCase = {
      case_id: "NC-02-WRONG-VER-FIRST",
      suite: "SEALED_GATE",
      case_kind: "POSITIVE_COVERED",
      category: "vat_effective_date",
      question: "ขายสินค้าวันที่ 1 ตุลาคม 2568 เสีย VAT กี่เปอร์เซ็นต์",
      applicable_date: "2025-10-01",
      expected_evidence: [
        {
          work_id: "subreg.th.rc.royal_decree.799",
          expected_version_id: "ver.th.rc.royal_decree.799.v2",
          required_passage_ids: ["psg.rc7.rd799.sec_3_4"],
        },
      ],
    };

    const res = gradeHardenedCase(coveredCase, {
      ranked_passages: [
        // Wrong version v1 ranked #1, correct version v2 ranked #2!
        { rank: 1, passage_id: "psg.old.rd799.v1", work_id: "subreg.th.rc.royal_decree.799", version_id: "ver.th.rc.royal_decree.799.v1", evidence_role: "governing" },
        { rank: 2, passage_id: "psg.rc7.rd799.sec_3_4", work_id: "subreg.th.rc.royal_decree.799", version_id: "ver.th.rc.royal_decree.799.v2", evidence_role: "governing" },
      ],
      actual_packet: [
        { position: 1, passage_id: "psg.rc7.rd799.sec_3_4", work_id: "subreg.th.rc.royal_decree.799", version_id: "ver.th.rc.royal_decree.799.v2", evidence_role: "governing" },
      ],
      unresolved_ruling_ids: [],
      response_status: "READY_FOR_LLM_GROUNDED",
    });

    expect(res.passed).toBe(false);
    expect(res.wrong_version_first).toBe(true);
    expect(res.wrong_version_substitution).toBe(true);
    expect(res.first_failing_step).toBe("WRONG_VERSION_RANKED_FIRST");
  });

  it("Negative Control 3: Fake ruling marked unresolved while another ruling is offered as substitute MUST FAIL", () => {
    const fakeRulingCase: HardenedEvalCase = {
      case_id: "NC-03-FAKE-RULING-SUBSTITUTE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_FAKE_RULING",
      category: "exact_ruling_abstention",
      question: "หนังสือตอบข้อหารือเลขที่ กค 0702/99999 วินิจฉัยอย่างไร",
      applicable_date: null,
      expected_evidence: [],
      expect_unresolved_ruling_id: "กค 0702/99999",
    };

    // Synthetic violation: unresolved_ruling_ids has 99999, BUT another TaxRuling is offered as governing!
    const failSub = gradeHardenedCase(fakeRulingCase, {
      ranked_passages: [
        { rank: 1, passage_id: "psg.636", work_id: "work.th.rd.gk_0702_636_2026_ec1b79d8", version_id: "ver.636.v1", evidence_role: "governing" },
      ],
      actual_packet: [
        { position: 1, passage_id: "psg.636", work_id: "work.th.rd.gk_0702_636_2026_ec1b79d8", version_id: "ver.636.v1", evidence_role: "governing", source_type: "TaxRuling" },
      ],
      unresolved_ruling_ids: ["กค 0702/99999"],
      response_status: "INSUFFICIENT_EVIDENCE",
    });
    expect(failSub.passed).toBe(false);
    expect(failSub.false_substitution).toBe(true);
    expect(failSub.first_failing_step).toBe("FALSE_SUBSTITUTE_AUTHORITY");

    // Valid clean abstention: unresolved flagged, INSUFFICIENT_EVIDENCE, ZERO substitute rulings in packet or citations -> PASS!
    const passClean = gradeHardenedCase(fakeRulingCase, {
      ranked_passages: [],
      actual_packet: [],
      unresolved_ruling_ids: ["กค 0702/99999"],
      response_status: "INSUFFICIENT_EVIDENCE",
      response_governing_citations: [],
    });
    expect(passClean.passed).toBe(true);
    expect(passClean.scoring_bucket).toBe("NEGATIVE_OR_ABSTENTION");
  });

  it("Additional Negative Controls: Missing decisive date & genuinely missing historical authority reject silent latest-version substitution", () => {
    const missingDateCase: HardenedEvalCase = {
      case_id: "NC-04-MISSING-DATE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_MISSING_DATE",
      category: "vat_missing_date",
      question: "ให้บริการในประเทศเสีย VAT กี่เปอร์เซ็นต์ตาม พ.ร.ฎ. ฉบับใด",
      applicable_date: null,
      expected_evidence: [],
      temporary_decree_work_ids_requiring_date: [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ],
    };

    // Violation: silently returns ANSWERED using latest RD 807 as governing without asking for date -> MUST FAIL!
    const failSilentLatest = gradeHardenedCase(missingDateCase, {
      ranked_passages: [],
      actual_packet: [
        { position: 1, passage_id: "psg.rc7.rd807.sec_3_4", work_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v2", evidence_role: "governing" },
      ],
      unresolved_ruling_ids: [],
      response_status: "ANSWERED",
      clarification_questions: [],
    });
    expect(failSilentLatest.passed).toBe(false);
    expect(failSilentLatest.silent_latest_version_on_missing_date).toBe(true);
    expect(failSilentLatest.first_failing_step).toBe("SILENT_LATEST_VERSION_MISSING_DATE");

    // Valid: CLARIFICATION_OR_CONDITIONAL_NEEDED with conditional_branch_authority -> PASS!
    const passClarify = gradeHardenedCase(missingDateCase, {
      ranked_passages: [],
      actual_packet: [
        { position: 1, passage_id: "psg.rc7.rd799.sec_3_4", work_id: "subreg.th.rc.royal_decree.799", version_id: "ver.th.rc.royal_decree.799.v2", evidence_role: "conditional_branch_authority" },
        { position: 2, passage_id: "psg.rc7.rd807.sec_3_4", work_id: "subreg.th.rc.royal_decree.807", version_id: "ver.th.rc.royal_decree.807.v2", evidence_role: "conditional_branch_authority" },
      ],
      unresolved_ruling_ids: [],
      response_status: "CLARIFICATION_OR_CONDITIONAL_NEEDED",
      clarification_questions: ["กรุณาระบุวันที่เกิดความรับผิดทางภาษี"],
    });
    expect(passClarify.passed).toBe(true);
    expect(passClarify.scoring_bucket).toBe("NEGATIVE_OR_ABSTENTION");

    // Genuinely missing historical authority (2019-06-15): FAIL if RD 790/799/807 substituted, PASS if clean abstention!
    const missingAuthCase: HardenedEvalCase = {
      case_id: "NC-05-MISSING-2019-DECREE",
      suite: "SEALED_GATE",
      case_kind: "NEGATIVE_MISSING_AUTHORITY",
      category: "missing_historical_authority",
      question: "ขายสินค้าในประเทศวันที่ 15 มิถุนายน 2562 ต้องเสีย VAT ตามพระราชกฤษฎีกาฉบับใด",
      applicable_date: "2019-06-15",
      expected_evidence: [],
    };
    const failSubDecree = gradeHardenedCase(missingAuthCase, {
      ranked_passages: [],
      actual_packet: [
        { position: 1, passage_id: "psg.rc7.rd790.sec_3_4", work_id: "subreg.th.rc.royal_decree.790", version_id: "ver.th.rc.royal_decree.790.v1", evidence_role: "governing" },
      ],
      unresolved_ruling_ids: [],
      response_status: "ANSWERED",
    });
    expect(failSubDecree.passed).toBe(false);
    expect(failSubDecree.false_substitution).toBe(true);

    const passAbstain = gradeHardenedCase(missingAuthCase, {
      ranked_passages: [],
      actual_packet: [],
      unresolved_ruling_ids: [],
      response_status: "INSUFFICIENT_EVIDENCE",
    });
    expect(passAbstain.passed).toBe(true);
    expect(passAbstain.scoring_bucket).toBe("NEGATIVE_OR_ABSTENTION");
  });
});
