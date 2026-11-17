/**
 * REG24 — Deterministic CLI Recorder for Product Owner & Internal Legal Team Review Findings
 *
 * Usage examples:
 *   npx tsx scripts/record-owner-legal-review-finding.ts --pack b01 --id LSC-01 --verdict PASS --reviewer "Product Owner" --notes "Verified Sec 47 bis conclusion & date"
 *   npx tsx scripts/record-owner-legal-review-finding.ts --pack b01 --id LSC-04 --verdict EXCLUDE_FROM_TRIAL --reviewer "Product Owner" --notes "Hold pending RD 595 text"
 *   npx tsx scripts/record-owner-legal-review-finding.ts --pack b02-ocr --id OCR-REV-01 --verdict PASS_ADMIT --reviewer "Legal Team" --notes "Verified Gazette Vol 88"
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { withdrawKnowledgeTarget } from "../src/core/knowledge/evidence";
import type { Actor } from "../src/core/knowledge/contracts";

function argVal(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function main() {
  const packType = argVal("--pack");
  const itemId = argVal("--id");
  const verdict = argVal("--verdict");
  const reviewer = argVal("--reviewer") || "Product Owner (Legal Review)";
  const notes = argVal("--notes") || "";

  if (!packType || !itemId || !verdict) {
    throw new Error(
      "Usage: --pack <b01|b02-ocr> --id <LSC-XX|OCR-REV-XX> --verdict <PASS|NEEDS_CORRECTION|EXCLUDE_FROM_TRIAL|PASS_ADMIT|ADMIT_HISTORICAL_ONLY|HOLD_QUARANTINED> [--reviewer <name>] [--notes <text>]"
    );
  }

  const auditDir = path.resolve(process.cwd(), "docs", "audit", "dodo-review-rc2-b02");
  const nowIso = new Date().toISOString();

  if (packType === "b01") {
    const allowed = new Set(["PASS", "NEEDS_CORRECTION", "EXCLUDE_FROM_TRIAL"]);
    if (!allowed.has(verdict)) {
      throw new Error(`Invalid B01 verdict '${verdict}'. Allowed: ${Array.from(allowed).join(", ")}`);
    }
    const ledgerPath = path.join(auditDir, "b01_thai_tax_law_independent_review_ledger.json");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    const entry = ledger.cases.find((c: { spotcheck_id: string }) => c.spotcheck_id === itemId);
    if (!entry) {
      throw new Error(`Case '${itemId}' not found in B01 review ledger.`);
    }
    entry.review_status = "REVIEWED_BY_OWNER_LEGAL_TEAM";
    entry.verdict = verdict;
    entry.reviewer_name = reviewer;
    entry.reviewed_at = nowIso;
    entry.legal_findings = notes || null;

    if (verdict === "EXCLUDE_FROM_TRIAL") {
      const previewDir = path.resolve(process.cwd(), "data", "knowledge-store-b01-rc2-staging");
      const spotPack = JSON.parse(
        fs.readFileSync(path.join(auditDir, "b01_rc2_legal_spotcheck_pack_30cases.json"), "utf8")
      );
      const fullCase = spotPack.cases.find((c: { spotcheck_id: string }) => c.spotcheck_id === itemId);
      const primaryRulingCit = fullCase?.citations?.find(
        (cit: { work_id: string }) => cit.work_id.startsWith("work.th.rd.")
      );
      if (primaryRulingCit && fs.existsSync(path.join(previewDir, "canonical-state.json.gz"))) {
        const store = new DurableKnowledgeStore(previewDir);
        const ownerActor: Actor = {
          actor_id: reviewer,
          role: "legal_reviewer",
          tenant_id: "PUBLIC",
          authorized_scopes: ["scope.platform.public"],
        };
        withdrawKnowledgeTarget(
          store,
          primaryRulingCit.work_id,
          `Excluded from trial by Owner Legal Review (${itemId}): ${notes || "Material legal finding"}`,
          ownerActor
        );
        entry.remediation_applied = `Withdrawn work_id=${primaryRulingCit.work_id} from preview store.`;
      }
    }

    ledger.updated_at = nowIso;
    ledger.summary = {
      total_cases: ledger.cases.length,
      reviewed_pass: ledger.cases.filter((c: { verdict: string }) => c.verdict === "PASS").length,
      reviewed_needs_correction: ledger.cases.filter(
        (c: { verdict: string }) => c.verdict === "NEEDS_CORRECTION"
      ).length,
      reviewed_exclude_from_trial: ledger.cases.filter(
        (c: { verdict: string }) => c.verdict === "EXCLUDE_FROM_TRIAL"
      ).length,
      pending_review: ledger.cases.filter((c: { verdict: string | null }) => c.verdict === null)
        .length,
    };
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
    console.log(JSON.stringify({ updated: itemId, verdict, summary: ledger.summary }, null, 2));
    return;
  }

  if (packType === "b02-ocr") {
    const allowed = new Set(["PASS_ADMIT", "ADMIT_HISTORICAL_ONLY", "HOLD_QUARANTINED"]);
    if (!allowed.has(verdict)) {
      throw new Error(
        `Invalid B02 OCR verdict '${verdict}'. Allowed: ${Array.from(allowed).join(", ")}`
      );
    }
    const ocrPath = path.join(auditDir, "b02_170page_ocr_pilot_review_list.json");
    const list = JSON.parse(fs.readFileSync(ocrPath, "utf8"));
    const doc = list.documents.find(
      (d: { review_item_id: string }) => d.review_item_id === itemId
    );
    if (!doc) {
      throw new Error(`OCR review item '${itemId}' not found.`);
    }
    doc.verdict = verdict;
    doc.reviewer_name = reviewer;
    doc.reviewed_at = nowIso;
    doc.legal_notes = notes || null;
    doc.usable_as_legal_evidence = verdict === "PASS_ADMIT";
    fs.writeFileSync(ocrPath, JSON.stringify(list, null, 2), "utf8");
    console.log(
      JSON.stringify(
        {
          updated: itemId,
          verdict,
          usable_as_legal_evidence: doc.usable_as_legal_evidence,
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown --pack '${packType}'. Expected 'b01' or 'b02-ocr'.`);
}

main();
