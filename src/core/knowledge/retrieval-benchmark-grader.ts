/**
 * REG24 Batch 1 — Hardened Retrieval & Evidence-Assembly Grader (v2)
 *
 * Fixes every flaw in the provisional `6e4fde1` grader:
 *   1. Grades instrument (`work_id`) + exact `version_id` + required `passage_id` (NOT only `work_id`).
 *   2. Checks the EXACT version at the position that earned the hit:
 *      a wrong version ranked first CANNOT be rescued by the correct version appearing lower down.
 *   3. Mandatory Negative Control 1 (Decree 807 after expiry):
 *      FAIL if returned as eligible governing authority in ranked hits or model packet;
 *      ALLOW only if absent OR explicitly labeled `historical_or_excluded_context`.
 *   4. Mandatory Negative Control 2 (Wrong version first, correct version later):
 *      FAIL immediately (`wrong_version_first: true`).
 *   5. Mandatory Negative Control 3 (Fake ruling marked unresolved while another ruling is offered as substitute):
 *      FAIL if any substitute ruling/authority appears as governing in the actual packet or response citations,
 *      OR if response status is not an abstention — even when `unresolved_ruling_ids` contains the fake ID!
 *   6. Missing date & genuinely missing authority are scored SEPARATELY from positive retrieval hits;
 *      FAIL if a definitive result silently uses the latest version or an unrelated ruling.
 */

export type BenchmarkCaseKind =
  | "POSITIVE_COVERED"
  | "NEGATIVE_POST_EXPIRY"
  | "NEGATIVE_FAKE_RULING"
  | "NEGATIVE_MISSING_DATE"
  | "NEGATIVE_MISSING_AUTHORITY";

export type PacketEvidenceRole =
  | "governing"
  | "conditional_branch_authority"
  | "historical_or_excluded_context"
  | "contextual_ruling_or_guidance";

export interface ExpectedEvidenceUnit {
  work_id: string;
  expected_version_id: string;
  /** At least one exact passage_id of `expected_version_id` must earn the hit in Top-5 AND reach the actual packet. */
  required_passage_ids: string[];
  section_label?: string;
}

export interface HardenedEvalCase {
  case_id: string;
  suite: "SEALED_GATE" | "LEGAL_HOLDOUT" | "NITIBENCH_TAX_SUPPLEMENT";
  case_kind: BenchmarkCaseKind;
  category: string;
  question: string;
  applicable_date: string | null;
  expected_evidence: ExpectedEvidenceUnit[];
  /** Works forbidden from appearing as eligible governing authority (e.g., expired RD 807 on 2027-10-01). */
  forbidden_governing_work_ids?: string[];
  /** Works allowed ONLY as explicitly labeled `historical_or_excluded_context` (never governing!). */
  allowed_historical_context_work_ids?: string[];
  /** For NEGATIVE_FAKE_RULING: the invented ruling identifier that MUST be flagged unresolved. */
  expect_unresolved_ruling_id?: string | null;
  /** For exact composite section lookup (e.g. `มาตรา 80/1 (2)`): must rank #1 and never confuse with `มาตรา 80`. */
  expected_exact_top1_work_id?: string | null;
  /** For NEGATIVE_MISSING_DATE: temporary works that must NOT be presented as a single definitive governing decree. */
  temporary_decree_work_ids_requiring_date?: string[];
}

export interface RankedPassageObservation {
  rank: number;
  passage_id: string;
  work_id: string;
  version_id: string;
  /** Retrieval hits are eligible governing candidates unless explicitly marked historical/excluded. */
  evidence_role?: PacketEvidenceRole;
}

export interface ActualPacketObservation {
  position: number;
  passage_id: string;
  work_id: string;
  version_id: string;
  evidence_role: PacketEvidenceRole;
  source_type?: string;
}

export interface GraderInputObservation {
  ranked_passages: RankedPassageObservation[];
  actual_packet: ActualPacketObservation[];
  unresolved_ruling_ids: string[];
  /** Actual app response status (pre-LLM or final verified status). */
  response_status:
    | "ANSWERED"
    | "READY_FOR_LLM_GROUNDED"
    | "CONDITIONAL"
    | "NEEDS_CLARIFICATION"
    | "CLARIFICATION_OR_CONDITIONAL_NEEDED"
    | "INSUFFICIENT_EVIDENCE"
    | "ABSTAINED";
  /** Optional governing citations emitted in a rendered/verified response (checked for substitute leaks!). */
  response_governing_citations?: Array<{
    work_id: string;
    version_id: string;
    source_type?: string;
    evidence_role?: PacketEvidenceRole;
  }>;
  clarification_questions?: string[];
}

export interface HardenedGradeResult {
  case_id: string;
  case_kind: BenchmarkCaseKind;
  passed: boolean;
  /** Separate scoring bucket: positive covered hit@5 vs negative/clarification/abstention pass. */
  scoring_bucket: "POSITIVE_RETRIEVAL" | "NEGATIVE_OR_ABSTENTION";
  ranking_passed: boolean;
  actual_packet_passed: boolean;
  /** Explicitly surfaces when retrieval Top-5 missed an authority that app packet assembly later recovered! */
  ranking_miss_packet_recovered: boolean;
  final_answer_qa_status: "NOT_RUN_PRE_LLM_CAPTURE" | "PASS" | "FAIL";
  all_required_in_top5: boolean;
  any_required_in_top5: boolean;
  all_required_in_actual_packet: boolean;
  wrong_version_first: boolean;
  wrong_version_substitution: boolean;
  expired_governing_leak: boolean;
  false_substitution: boolean;
  silent_latest_version_on_missing_date: boolean;
  ranks_by_expected_work: Record<
    string,
    {
      first_seen_rank: number | null;
      first_seen_version_id: string | null;
      matching_version_passage_rank: number | null;
      version_matched_at_first_hit: boolean;
      in_actual_packet_as_governing: boolean;
    }
  >;
  first_failing_step:
    | "NONE"
    | "WRONG_VERSION_RANKED_FIRST"
    | "EXPIRED_AUTHORITY_AS_GOVERNING"
    | "FALSE_SUBSTITUTE_AUTHORITY"
    | "SILENT_LATEST_VERSION_MISSING_DATE"
    | "MISSING_UNRESOLVED_ABSTENTION"
    | "RANKING_TOP5_MISS"
    | "RANKING_MISS_PACKET_RECOVERED"
    | "EXACT_TOP1_MISMATCH"
    | "ACTUAL_PACKET_ASSEMBLY_MISS";
  failure_reasons: string[];
}

function isGoverningRole(role: PacketEvidenceRole | undefined): boolean {
  return !role || role === "governing";
}

function getEligibleGoverningTopKWorks(
  ranked: RankedPassageObservation[],
  k: number
): RankedPassageObservation[] {
  const out: RankedPassageObservation[] = [];
  const seenWork = new Set<string>();
  for (const h of ranked) {
    if (!isGoverningRole(h.evidence_role)) continue;
    if (!seenWork.has(h.work_id)) {
      seenWork.add(h.work_id);
      out.push(h);
      if (out.length >= k) break;
    }
  }
  return out;
}

export function gradeHardenedCase(
  c: HardenedEvalCase,
  obs: GraderInputObservation
): HardenedGradeResult {
  const reasons: string[] = [];
  let wrongVersionFirst = false;
  let wrongVersionSubstitution = false;
  let expiredGoverningLeak = false;
  let falseSubstitution = false;
  let silentLatestVersionOnMissingDate = false;

  const governingRanked = obs.ranked_passages.filter((h) => isGoverningRole(h.evidence_role));
  const top5UniqueWorks = getEligibleGoverningTopKWorks(obs.ranked_passages, 5);
  const top5WorkSet = new Set(top5UniqueWorks.map((h) => h.work_id));
  const governingPacket = obs.actual_packet.filter((p) => p.evidence_role === "governing");
  const responseGoverning = (obs.response_governing_citations || []).filter((r) =>
    isGoverningRole(r.evidence_role)
  );

  // 1. Check forbidden / expired governing authorities across BOTH eligible ranked Top-5 AND actual governing packet & response!
  const forbiddenSet = new Set(c.forbidden_governing_work_ids || []);
  const allowedHistoricalSet = new Set(c.allowed_historical_context_work_ids || []);

  for (const fw of forbiddenSet) {
    const inTop5Governing = top5UniqueWorks.some((h) => h.work_id === fw);
    const inPacketGoverning = governingPacket.some((p) => p.work_id === fw);
    const inResponseGoverning = responseGoverning.some((r) => r.work_id === fw);
    const inPacketUnallowedNonHistorical = obs.actual_packet.some(
      (p) =>
        p.work_id === fw &&
        p.evidence_role !== "historical_or_excluded_context" &&
        !(c.case_kind === "NEGATIVE_MISSING_DATE" && p.evidence_role === "conditional_branch_authority")
    );

    if (inTop5Governing || inPacketGoverning || inResponseGoverning || inPacketUnallowedNonHistorical) {
      if (allowedHistoricalSet.has(fw) || c.case_kind === "NEGATIVE_POST_EXPIRY") {
        expiredGoverningLeak = true;
        reasons.push(`EXPIRED_OR_FORBIDDEN_GOVERNING_LEAK: ${fw} appeared as governing (only historical_or_excluded_context allowed)`);
      } else {
        wrongVersionSubstitution = true;
        reasons.push(`FORBIDDEN_AUTHORITY_SUBSTITUTION: ${fw} appeared in eligible governing results`);
      }
    }
  }

  // 2. Grade expected instrument + exact version + exact required passage AT THE POSITION THAT EARNED THE HIT!
  const ranksByExpected: HardenedGradeResult["ranks_by_expected_work"] = {};
  let allRequiredInTop5 = true;
  let anyRequiredInTop5 = false;
  let allRequiredInPacket = true;

  // Build rank index per unique work in governingRanked (1-based work rank)
  const uniqueWorkRankMap = new Map<string, { workRank: number; firstHit: RankedPassageObservation }>();
  let uRank = 0;
  for (const h of governingRanked) {
    if (!uniqueWorkRankMap.has(h.work_id)) {
      uRank += 1;
      uniqueWorkRankMap.set(h.work_id, { workRank: uRank, firstHit: h });
    }
  }

  for (const exp of c.expected_evidence) {
    const firstInfo = uniqueWorkRankMap.get(exp.work_id);
    const firstSeenRank = firstInfo?.workRank ?? null;
    const firstSeenVersion = firstInfo?.firstHit.version_id ?? null;

    // Strict Rule: If the FIRST hit for `exp.work_id` has a WRONG `version_id`, FAIL IMMEDIATELY!
    // A wrong version ranked first CANNOT be rescued by the correct version appearing lower down!
    const versionMatchedAtFirstHit = Boolean(
      firstInfo && firstInfo.firstHit.version_id === exp.expected_version_id
    );
    if (firstInfo && !versionMatchedAtFirstHit) {
      wrongVersionFirst = true;
      wrongVersionSubstitution = true;
      reasons.push(
        `WRONG_VERSION_RANKED_FIRST: ${exp.work_id} first appeared at work-rank ${firstSeenRank} with version '${firstSeenVersion}' != expected '${exp.expected_version_id}'`
      );
    }

    // Check required passage_id (with exact expected_version_id) in eligible governing hits
    // Top-5 eligibility requires the work to be in Top-5 unique governing works AND the required passage
    // of the expected version to be present without a wrong version ranked ahead of it!
    const matchingPassagesForWork = governingRanked.filter(
      (h) =>
        h.work_id === exp.work_id &&
        h.version_id === exp.expected_version_id &&
        (exp.required_passage_ids.length === 0 || exp.required_passage_ids.includes(h.passage_id))
    );
    const firstMatchingPassageRank =
      matchingPassagesForWork.length > 0 ? firstSeenRank : null;

    const earnedTop5Hit =
      versionMatchedAtFirstHit &&
      top5WorkSet.has(exp.work_id) &&
      matchingPassagesForWork.length > 0 &&
      // Also verify that within the first 15 ranked passages (the Top-5 work window), the required passage itself appears
      governingRanked
        .slice(0, 15)
        .some(
          (h) =>
            h.work_id === exp.work_id &&
            h.version_id === exp.expected_version_id &&
            (exp.required_passage_ids.length === 0 || exp.required_passage_ids.includes(h.passage_id))
        );

    if (earnedTop5Hit) anyRequiredInTop5 = true;
    else {
      allRequiredInTop5 = false;
      if (!wrongVersionFirst) {
        reasons.push(
          `TOP5_MISS: ${exp.work_id}@${exp.expected_version_id} required passage(s) [${exp.required_passage_ids.join(",")}] did not earn eligible governing Top-5 hit (first_seen_rank=${firstSeenRank})`
        );
      }
    }

    // Check actual model packet (must carry the exact expected version & required passage as governing!)
    const inActualPacket = governingPacket.some(
      (p) =>
        p.work_id === exp.work_id &&
        p.version_id === exp.expected_version_id &&
        (exp.required_passage_ids.length === 0 || exp.required_passage_ids.includes(p.passage_id))
    );
    if (!inActualPacket) {
      allRequiredInPacket = false;
      reasons.push(
        `ACTUAL_PACKET_MISS: ${exp.work_id}@${exp.expected_version_id} required passage(s) missing as governing in actual model packet`
      );
    }

    // Also reject wrong version inside actual governing packet
    const wrongVerInPacket = governingPacket.some(
      (p) => p.work_id === exp.work_id && p.version_id !== exp.expected_version_id
    );
    if (wrongVerInPacket) {
      wrongVersionSubstitution = true;
      reasons.push(
        `WRONG_VERSION_IN_PACKET: ${exp.work_id} appeared in actual governing packet with wrong version_id`
      );
    }

    ranksByExpected[exp.work_id] = {
      first_seen_rank: firstSeenRank,
      first_seen_version_id: firstSeenVersion,
      matching_version_passage_rank: firstMatchingPassageRank,
      version_matched_at_first_hit: versionMatchedAtFirstHit,
      in_actual_packet_as_governing: inActualPacket,
    };
  }

  // Exact Top-1 composite section check (e.g., `มาตรา 80/1 (2)` must rank #1, NEVER `มาตรา 80`)
  let exactTop1Mismatch = false;
  if (c.expected_exact_top1_work_id) {
    const top1 = top5UniqueWorks[0];
    if (!top1 || top1.work_id !== c.expected_exact_top1_work_id) {
      exactTop1Mismatch = true;
      falseSubstitution = true;
      reasons.push(
        `EXACT_TOP1_MISMATCH: expected #1 '${c.expected_exact_top1_work_id}', got '${top1?.work_id || "none"}'`
      );
    }
  }

  // 3. Negative / Clarification / Abstention Case Grading (Scored SEPARATELY from positive retrieval hits!)
  if (c.case_kind === "NEGATIVE_FAKE_RULING") {
    const expectedId = c.expect_unresolved_ruling_id || "";
    const unresolvedMarked = obs.unresolved_ruling_ids.some(
      (u) => u === expectedId || u.includes(expectedId.replace(/^กค\s*/, ""))
    );
    const isAbstentionStatus =
      obs.response_status === "INSUFFICIENT_EVIDENCE" || obs.response_status === "ABSTAINED";
    const substituteInPacket = governingPacket.some(
      (p) => p.source_type === "TaxRuling" || p.work_id.startsWith("work.th.rd.")
    );
    const substituteInResponse = responseGoverning.some(
      (r) => r.source_type === "TaxRuling" || r.work_id.startsWith("work.th.rd.")
    );
    if (!unresolvedMarked || !isAbstentionStatus) {
      reasons.push(
        `MISSING_UNRESOLVED_ABSTENTION: unresolvedMarked=${unresolvedMarked}, response_status=${obs.response_status}`
      );
    }
    if (substituteInPacket || substituteInResponse) {
      falseSubstitution = true;
      reasons.push(
        `FALSE_SUBSTITUTE_AUTHORITY: fake ruling '${expectedId}' was paired with a substitute TaxRuling offered as governing authority!`
      );
    }
  }

  if (c.case_kind === "NEGATIVE_MISSING_AUTHORITY") {
    const isAbstentionStatus =
      obs.response_status === "INSUFFICIENT_EVIDENCE" || obs.response_status === "ABSTAINED";
    const substituteGoverningDecree = governingPacket.some((p) =>
      p.work_id.startsWith("subreg.th.rc.royal_decree.")
    ) || responseGoverning.some((r) => r.work_id.startsWith("subreg.th.rc.royal_decree."));
    if (!isAbstentionStatus) {
      reasons.push(`MISSING_UNRESOLVED_ABSTENTION: expected abstention for missing authority, got ${obs.response_status}`);
    }
    if (substituteGoverningDecree) {
      falseSubstitution = true;
      reasons.push(
        `FALSE_SUBSTITUTE_AUTHORITY: offered a different Royal Decree as governing authority for an uncovered historical date!`
      );
    }
  }

  if (c.case_kind === "NEGATIVE_MISSING_DATE") {
    const isClarificationOrConditional =
      obs.response_status === "NEEDS_CLARIFICATION" ||
      obs.response_status === "CLARIFICATION_OR_CONDITIONAL_NEEDED" ||
      obs.response_status === "CONDITIONAL" ||
      (obs.clarification_questions || []).length > 0;
    const tempDecrees = new Set(
      c.temporary_decree_work_ids_requiring_date || [
        "subreg.th.rc.royal_decree.790",
        "subreg.th.rc.royal_decree.799",
        "subreg.th.rc.royal_decree.807",
      ]
    );
    const definitiveSingleTempDecree =
      (obs.response_status === "ANSWERED" || obs.response_status === "READY_FOR_LLM_GROUNDED") &&
      governingPacket.some((p) => tempDecrees.has(p.work_id));
    if (!isClarificationOrConditional || definitiveSingleTempDecree) {
      silentLatestVersionOnMissingDate = true;
      reasons.push(
        `SILENT_LATEST_VERSION_MISSING_DATE: missing decisive date did not ask for clarification/conditional branches (status=${obs.response_status}, definitiveTempDecree=${definitiveSingleTempDecree})`
      );
    }
  }

  // 4. Determine exact first_failing_step & overall pass
  let firstFailingStep: HardenedGradeResult["first_failing_step"] = "NONE";
  if (wrongVersionFirst) {
    firstFailingStep = "WRONG_VERSION_RANKED_FIRST";
  } else if (expiredGoverningLeak) {
    firstFailingStep = "EXPIRED_AUTHORITY_AS_GOVERNING";
  } else if (falseSubstitution) {
    firstFailingStep = "FALSE_SUBSTITUTE_AUTHORITY";
  } else if (silentLatestVersionOnMissingDate) {
    firstFailingStep = "SILENT_LATEST_VERSION_MISSING_DATE";
  } else if (
    (c.case_kind === "NEGATIVE_FAKE_RULING" || c.case_kind === "NEGATIVE_MISSING_AUTHORITY") &&
    reasons.length > 0
  ) {
    firstFailingStep = "MISSING_UNRESOLVED_ABSTENTION";
  } else if (exactTop1Mismatch) {
    firstFailingStep = "EXACT_TOP1_MISMATCH";
  } else if (c.expected_evidence.length > 0 && !allRequiredInTop5) {
    firstFailingStep = allRequiredInPacket ? "RANKING_MISS_PACKET_RECOVERED" : "RANKING_TOP5_MISS";
  } else if (c.expected_evidence.length > 0 && !allRequiredInPacket) {
    firstFailingStep = "ACTUAL_PACKET_ASSEMBLY_MISS";
  } else if (wrongVersionSubstitution) {
    firstFailingStep = "WRONG_VERSION_RANKED_FIRST";
  }

  const passed = firstFailingStep === "NONE" && reasons.length === 0;
  const scoringBucket: HardenedGradeResult["scoring_bucket"] =
    c.case_kind === "POSITIVE_COVERED" ? "POSITIVE_RETRIEVAL" : "NEGATIVE_OR_ABSTENTION";
  const rankingPassed =
    !wrongVersionFirst &&
    !wrongVersionSubstitution &&
    !expiredGoverningLeak &&
    !exactTop1Mismatch &&
    (c.expected_evidence.length > 0 ? allRequiredInTop5 : passed);
  const actualPacketPassed =
    !wrongVersionSubstitution &&
    !expiredGoverningLeak &&
    !falseSubstitution &&
    !silentLatestVersionOnMissingDate &&
    (c.expected_evidence.length > 0 ? allRequiredInPacket : passed);
  const rankingMissPacketRecovered = !rankingPassed && actualPacketPassed;

  return {
    case_id: c.case_id,
    case_kind: c.case_kind,
    passed,
    scoring_bucket: scoringBucket,
    ranking_passed: rankingPassed,
    actual_packet_passed: actualPacketPassed,
    ranking_miss_packet_recovered: rankingMissPacketRecovered,
    final_answer_qa_status: "NOT_RUN_PRE_LLM_CAPTURE",
    all_required_in_top5: c.expected_evidence.length > 0 ? allRequiredInTop5 : passed,
    any_required_in_top5: c.expected_evidence.length > 0 ? anyRequiredInTop5 : passed,
    all_required_in_actual_packet: c.expected_evidence.length > 0 ? allRequiredInPacket : passed,
    wrong_version_first: wrongVersionFirst,
    wrong_version_substitution: wrongVersionSubstitution || expiredGoverningLeak,
    expired_governing_leak: expiredGoverningLeak,
    false_substitution: falseSubstitution,
    silent_latest_version_on_missing_date: silentLatestVersionOnMissingDate,
    ranks_by_expected_work: ranksByExpected,
    first_failing_step: firstFailingStep,
    failure_reasons: reasons,
  };
}
