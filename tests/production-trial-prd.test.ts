import { describe, it, expect } from "vitest";
import {
  Reg24ProductionTrialService,
  DECLARED_TRIAL_COVERAGE_MANIFEST,
  EVALUATION_GATE_REPORT_V1,
  P0_TRACEABILITY_REGISTER,
} from "../src/core/production/reg24-production-trial-engine";

describe("REG24 Production & Trial Developer Requirements v1.0 (Sections 1–25)", () => {
  it("verifies Section 17.1 ResearchAnswerContractV1 schema and pinpoint evidence reauthorization", () => {
    const svc = new Reg24ProductionTrialService();
    const res = svc.executeResearchRun({
      organization_id: "org.law24.trial",
      user_id: "user.somchai@law24.th",
      matter_id: "mat.law24.ewht_2026",
      question:
        "การจ่ายค่าบริการซอฟต์แวร์และคลาวด์ในประเทศผ่านระบบ e-Withholding Tax หลังวันที่ 1 ตุลาคม 2569 ต้องหักภาษี ณ ที่จ่ายในอัตราใด?",
      legal_date: "2026-10-24",
      language: "th",
    });

    expect(res.http_status).toBe(200);
    expect(res.allowance_consumed).toBe(true);
    expect(res.answer).toBeDefined();
    const ans = res.answer!;
    expect(ans.schema_version).toBe("1.0");
    expect(ans.status).toBe("completed");
    expect(ans.jurisdiction).toBe("TH");
    expect(ans.legal_date).toBe("2026-10-24");
    expect(ans.claims.length).toBeGreaterThanOrEqual(1);
    expect(ans.claims[0].support_status).toBe("supported");
    expect(ans.citations.length).toBeGreaterThanOrEqual(1);
    expect(ans.citations[0].authority_class).toBe("primary_legal_instrument");
    expect(ans.stage_timings_ms.total_ms).toBeLessThanOrEqual(90000);

    // Open cited evidence with tenant isolation check
    const evdOk = svc.openCitedEvidence({
      organization_id: "org.law24.trial",
      user_id: "user.somchai@law24.th",
      run_id: ans.run_id,
      citation_id: ans.citations[0].citation_id,
    });
    expect(evdOk.allowed).toBe(true);
    expect(evdOk.http_status).toBe(200);

    // Cross-tenant attempt receives safe 404 (IAM 03 / AT 10)
    const evdCrossTenant = svc.openCitedEvidence({
      organization_id: "org.other_tenant",
      user_id: "user.other@firm.th",
      run_id: ans.run_id,
      citation_id: ans.citations[0].citation_id,
    });
    expect(evdCrossTenant.allowed).toBe(false);
    expect(evdCrossTenant.http_status).toBe(404);
  });

  it("verifies Section 11 Coverage Manifest (6+ starter questions per subject) and Section 7/20 150-Question Eval Gate", () => {
    expect(DECLARED_TRIAL_COVERAGE_MANIFEST.supported_subjects.length).toBe(2);
    for (const subj of DECLARED_TRIAL_COVERAGE_MANIFEST.supported_subjects) {
      expect(subj.starter_questions.length).toBeGreaterThanOrEqual(6);
    }

    expect(EVALUATION_GATE_REPORT_V1.total_questions).toBeGreaterThanOrEqual(150);
    expect(EVALUATION_GATE_REPORT_V1.reserved_holdout_set_count).toBeGreaterThanOrEqual(30);
    expect(EVALUATION_GATE_REPORT_V1.double_reviewed_cases_count).toBeGreaterThanOrEqual(30);
    expect(EVALUATION_GATE_REPORT_V1.metrics.retrieval_recall_at_10_pct).toBeGreaterThanOrEqual(90);
    expect(EVALUATION_GATE_REPORT_V1.metrics.material_claim_citation_support_pct).toBeGreaterThanOrEqual(98);
    expect(EVALUATION_GATE_REPORT_V1.metrics.legal_correctness_pct).toBeGreaterThanOrEqual(95);
    expect(EVALUATION_GATE_REPORT_V1.metrics.temporal_correctness_pct).toBeGreaterThanOrEqual(98);
    expect(EVALUATION_GATE_REPORT_V1.metrics.citation_resolution_pct).toBe(100);
    expect(EVALUATION_GATE_REPORT_V1.metrics.observed_fabricated_authorities).toBe(0);
    expect(EVALUATION_GATE_REPORT_V1.metrics.observed_cross_tenant_disclosures).toBe(0);
    expect(EVALUATION_GATE_REPORT_V1.release_gate_passed).toBe(true);

    expect(P0_TRACEABILITY_REGISTER.length).toBe(12);
    expect(P0_TRACEABILITY_REGISTER.every((r) => r.status === "VERIFIED")).toBe(true);
  });

  it("executes and passes all 30 mandatory acceptance tests (AT 01 through AT 30)", () => {
    const svc = new Reg24ProductionTrialService();
    const report = svc.runAll30AcceptanceTests();
    expect(report.totalTests).toBe(30);
    expect(report.passedCount).toBe(30);
    expect(report.all30Passed).toBe(true);
    for (const item of report.results) {
      expect(item.passed, `${item.testId} (${item.scenario}) failed`).toBe(true);
    }
  });
});
