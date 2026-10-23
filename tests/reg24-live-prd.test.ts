import { describe, it, expect } from "vitest";
import {
  reg24LiveEngine,
  Reg24LiveService,
  SEED_LIVE_SOURCES,
  SEED_LIVE_UPDATES,
} from "../src/core/live/reg24-live-engine";

describe("REG24 Live Developer Requirements v1.0 (24 October 2026) — Daily Law & Regulation Updates", () => {
  it("registers official Thai sources across Priorities 1–3 with explicit coverage & health semantics (SRC 01..04, MON 04, Section 22)", () => {
    expect(SEED_LIVE_SOURCES.length).toBeGreaterThanOrEqual(6);
    const royalGazette = SEED_LIVE_SOURCES.find((s) => s.source_id === "src.ratchakitcha.soc");
    expect(royalGazette?.priority).toBe(1);
    expect(royalGazette?.entry_url).toBe("https://ratchakitcha.soc.go.th/");

    const ocs = SEED_LIVE_SOURCES.find((s) => s.source_id === "src.ocs.searchlaw");
    expect(ocs?.health_state).toBe("degraded_or_unavailable");
    expect(ocs?.active_incident).toContain("INC-OCS-403");
  });

  it("maintains 4 independent state dimensions (pipeline, verification, publication, legal_effect) and blocks unverified notices from compliance logic (REV 01)", () => {
    const verifiedRd = SEED_LIVE_UPDATES.find((u) => u.update_id === "upd.2026.10.rd_ewht_3pct")!;
    expect(verifiedRd.pipeline_state).toBe("ready");
    expect(verifiedRd.verification_state).toBe("reviewer_verified");
    expect(verifiedRd.publication_state).toBe("verified_update");
    expect(verifiedRd.legal_effect_state).toBe("in_force");

    const detectedBoi = SEED_LIVE_UPDATES.find((u) => u.update_id === "upd.2026.10.detected_boi_ev_notice")!;
    expect(detectedBoi.publication_state).toBe("detected_notice");
    expect(detectedBoi.legal_effect_state).toBe("unresolved");
  });

  it("resolves bi-temporal legal_as_of and known_as_of timelines for retrospective and future commencement rules (LAW 03..04, AT 09..11)", () => {
    const svc = new Reg24LiveService();

    // Before retrospective Paw. 432/2569 was enacted on 23 Oct 2026
    const priorKnown = svc.getProvisionVersionAt({
      provision_id: "prov.tp161.clause12_1",
      legal_as_of: "2026-10-15",
      known_as_of: "2026-10-16T00:00:00Z",
    });
    expect(priorKnown.selected_version?.version_id).toBe("ver.tp161.gap_default_3pct");

    // After retrospective Paw. 432/2569 was enacted on 23 Oct 2026
    const currentKnown = svc.getProvisionVersionAt({
      provision_id: "prov.tp161.clause12_1",
      legal_as_of: "2026-10-15",
      known_as_of: "2026-10-24T00:00:00Z",
    });
    expect(currentKnown.selected_version?.version_id).toBe("ver.tp432.2569");
  });

  it("evaluates three-valued company applicability and enforces advisor client isolation (IMP 01..03, SEC 01..02, AT 20..21)", () => {
    const svc = new Reg24LiveService();

    // Complete profile -> likely_applicable
    const siam = svc.assessCompanyImpact({
      tenant_id: "tenant.law24.prod",
      actor_id: "counsel.somchai@law24.th",
      actor_role: "compliance_manager",
      entity_id: "ent.siam_cloud_tech",
      update_id: "upd.2026.10.rd_ewht_3pct",
    });
    expect(siam.status).toBe("ok");
    expect(siam.assessment?.outcome).toBe("likely_applicable");

    // Incomplete profile -> potentially_applicable with missing_facts listed
    const eastern = svc.assessCompanyImpact({
      tenant_id: "tenant.law24.prod",
      actor_id: "counsel.somchai@law24.th",
      actor_role: "compliance_manager",
      entity_id: "ent.eastern_incomplete_co",
      update_id: "upd.2026.10.rd_ewht_3pct",
    });
    expect(eastern.status).toBe("ok");
    expect(eastern.assessment?.missing_facts).toContain("uses_e_withholding_tax");

    // Unassigned advisor blocked (403)
    const blockedAdvisor = svc.assessCompanyImpact({
      tenant_id: "tenant.law24.prod",
      actor_id: "advisor.ekachai@law24.th",
      actor_role: "advisor",
      entity_id: "ent.eastern_incomplete_co",
      update_id: "upd.2026.10.rd_ewht_3pct",
    });
    expect(blockedAdvisor.status).toBe("forbidden_403");
  });

  it("passes all 30 mandatory Acceptance Tests (AT 01 through AT 30) across Sections 19 and 20", () => {
    const report = reg24LiveEngine.runAll30AcceptanceTests();
    expect(report.totalTests).toBe(30);
    expect(report.passedCount).toBe(30);
    expect(report.all30Passed).toBe(true);
  });
});
