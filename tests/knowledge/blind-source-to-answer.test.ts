import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../../src/core/knowledge/store";
import { freezeInventory, planReconciliation } from "../../src/core/knowledge/inventory";
import { startBatchRun } from "../../src/core/knowledge/releases";
import { runBlindSourceToAnswerValidation } from "../../src/core/knowledge/blind-audit";
import type { Actor } from "../../src/core/knowledge/contracts";

const ENG_ACTOR: Actor = {
  actor_id: "eng.lead@reg24.th",
  role: "engineering_lead",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

const AUDITOR_ACTOR: Actor = {
  actor_id: "independent.qa@reg24.th",
  role: "legal_reviewer",
  tenant_id: "PUBLIC",
  authorized_scopes: ["scope.platform.public"],
};

describe("DEF-B01-04 — Independent Blind Source-to-Answer Legal Validation Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-blind-qa-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Validates 20 blind source-to-answer legal cases on staged B01 across conclusions, conditions, exceptions, dates, instrument citations, and verbatim source openability", async () => {
    const store = new DurableKnowledgeStore(tempDir);
    const frozen = await freezeInventory("B01", ENG_ACTOR, { store });
    await planReconciliation(frozen.manifest.manifest_id, ENG_ACTOR, { store });

    const run = await startBatchRun(
      {
        batch_id: "B01",
        manifest_id: frozen.manifest.manifest_id,
        idempotency_key: "idem-blind-b01",
        max_documents: 100,
      },
      ENG_ACTOR,
      { store }
    );

    const blindReport = await runBlindSourceToAnswerValidation(run.release_id, AUDITOR_ACTOR, { store });

    expect(blindReport.total_cases).toBe(20);
    expect(blindReport.synthetic_placeholder_citations_detected).toBe(0);
    expect(blindReport.quarantined_unresolved_used_as_evidence).toBe(0);
    expect(blindReport.mislinked_instrument_citations_detected).toBe(0);

    // Every single blind gold case must pass all 6 dimensions!
    const failed = blindReport.case_results.filter((c) => !c.overall_passed);
    expect(failed).toEqual([]);
    expect(blindReport.overall_accuracy).toBe(1.0);
    expect(blindReport.dimension_scores.conclusion_accuracy).toBe(1.0);
    expect(blindReport.dimension_scores.condition_fidelity).toBe(1.0);
    expect(blindReport.dimension_scores.exception_fidelity).toBe(1.0);
    expect(blindReport.dimension_scores.date_and_version_accuracy).toBe(1.0);
    expect(blindReport.dimension_scores.citation_instrument_precision).toBe(1.0);
    expect(blindReport.dimension_scores.source_open_and_verbatim_support).toBe(1.0);
  }, 40000);
});
