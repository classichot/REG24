/**
 * REG24 — Incremental Core Tax Authority Overlay (`rel.B01.rc6`) in Staging Store
 *
 * - Strictly refuses to touch `data/knowledge-store` (verifies SHA-256 `08b61fd...` before & after).
 * - Does NOT rebuild any of the 4,581 `TaxRuling` works in `rel.B01.rc5` — inherits `rel.B01.rc5`
 *   cumulatively via `previous_accepted_release_id: "rel.B01.rc5"`.
 * - Materializes all verified official `rd.go.th` Revenue Code sections, rate schedules
 *   (`บัญชีอัตราภาษีเงินได้`, `บัญชีอัตราอากรแสตมป์`), amending Acts (`ฉบับที่ 40, 42, 44`),
 *   Royal Decrees (`470, 555, 577, 646, 780, 799, 807`), Ministerial Regulations (`389, 402`),
 *   and DG Notifications (`อากรแสตมป์ ฉบับที่ 37`, VAT/SBT local-tax schedules) from
 *   `getVerifiedStatutoryCorpus()`, plus accepted authority-dependency graph edges.
 * - Keeps `active_release_id: null` and `state: "READY_FOR_UAT"` (`user_decision: null`).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { getVerifiedStatutoryCorpus } from "../src/core/data/verified-statutory-loader";
import { chunkThaiLegalDocument } from "../src/core/knowledge/extraction";
import type { Assertion, BatchManifest, LegalWork } from "../src/core/knowledge/contracts";
import { sha256Bytes } from "../src/core/knowledge/identity";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { extractAmendmentLedgerFromStatutoryText } from "../src/core/knowledge/temporal-versioning";

const PROTECTED_CANONICAL_SHA256 =
  "08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9";

export const TARGET_STAGING_RELEASE_ID = "rel.B01.rc6";

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main(): Promise<void> {
  const protectedLiveGz = path.resolve("data/knowledge-store/canonical-state.json.gz");
  const preSha = sha256File(protectedLiveGz);
  if (preSha !== PROTECTED_CANONICAL_SHA256) {
    throw new Error(`PROTECTED_STORE_MISMATCH_PRE: ${preSha}`);
  }

  const stagingDir = path.resolve("data/knowledge-store-b01-rc2-staging");
  const store = new DurableKnowledgeStore(stagingDir);
  const verCorpus = getVerifiedStatutoryCorpus();
  const gitHead = execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString("utf8").trim();
  const nowIso = "2026-11-18T20:25:00.000Z";

  const createdWorkIds: string[] = [];
  const createdVersionIds: string[] = [];
  const createdPassageIds: string[] = [];
  const createdAssertionIds: string[] = [];
  const reusedWorkIds: string[] = [];

  store.transactSync(
    "PROMOTE_B01_RC6_CORE_TAX_AUTHORITIES",
    (draft) => {
      // Remove any prior rc6 draft artifacts if re-run idempotently
      for (const pid of Object.keys(draft.passages)) {
        if (draft.passages[pid].release_id === TARGET_STAGING_RELEASE_ID) {
          delete draft.passages[pid];
        }
      }
      for (const aid of Object.keys(draft.assertions)) {
        if (draft.assertions[aid].release_id === TARGET_STAGING_RELEASE_ID) {
          delete draft.assertions[aid];
        }
      }

      const existingPassagesInRc5 = new Set<string>();
      for (const p of Object.values(draft.passages)) {
        if (
          !p.extraction_id.startsWith("ext.dep.") &&
          (p.release_id === "rel.B01.rc5" || p.release_id === "rel.B01.rc1")
        ) {
          existingPassagesInRc5.add(p.work_id);
        }
      }

      for (const wid of Object.keys(draft.works)) {
        if (existingPassagesInRc5.has(wid)) {
          reusedWorkIds.push(wid);
        }
      }

      const allVerifiedEntries: Array<{
        key: string;
        targetType: LegalWork["type"];
        title: string;
        sectionLabel: string | null;
        originUri: string;
        anchor: string | null;
        artifactSha256: string;
        artifactSize: number;
        effectiveIso: string | null;
        effectiveRaw: string | null;
        dateStatus: "verified" | "unknown_restricted";
        verbatimText: string;
      }> = [];

      for (const [key, rc] of Object.entries(verCorpus.revenue_code_sections)) {
        if (existingPassagesInRc5.has(key)) continue;
        allVerifiedEntries.push({
          key,
          targetType: "ProvisionVersion",
          title: rc.title_th,
          sectionLabel: rc.section_label,
          originUri: rc.origin_uri,
          anchor: rc.anchor,
          artifactSha256: rc.artifact_sha256,
          artifactSize: rc.artifact_size,
          effectiveIso: rc.effective_date_iso,
          effectiveRaw: rc.effective_date_raw,
          dateStatus: rc.date_status,
          verbatimText: rc.verbatim_text,
        });
      }

      for (const [key, sub] of Object.entries(verCorpus.subordinate_and_amendment_works)) {
        if (existingPassagesInRc5.has(key)) continue;
        const targetType: LegalWork["type"] = key.startsWith("statute.")
          ? "Statute"
          : "SubordinateLegislation";
        allVerifiedEntries.push({
          key,
          targetType,
          title: sub.title_th,
          sectionLabel: null,
          originUri: sub.origin_uri,
          anchor: null,
          artifactSha256: sub.artifact_sha256,
          artifactSize: sub.artifact_size,
          effectiveIso: sub.effective_date_iso,
          effectiveRaw: sub.effective_date_raw,
          dateStatus: sub.date_status,
          verbatimText: sub.verbatim_text,
        });
      }

      for (const entry of allVerifiedEntries) {
        const verbatimText = entry.verbatimText.replace(/<!--[\s\S]*?-->/g, "").trim();
        if (verbatimText.length < 20) continue;

        const artId = `art.ver.${entry.artifactSha256.slice(0, 14)}`;
        const lowerUri = entry.originUri.toLowerCase();
        const isPdf = lowerUri.endsWith(".pdf");
        const mime = isPdf
          ? "application/pdf"
          : lowerUri.endsWith(".docx")
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : lowerUri.endsWith(".doc")
              ? "application/msword"
              : "text/html";

        if (!draft.artifacts[artId]) {
          draft.artifacts[artId] = {
            artifact_id: artId,
            actual_bytes_sha256: entry.artifactSha256,
            size: entry.artifactSize,
            MIME: mime,
            immutable_uri: `artifact://sha256/${entry.artifactSha256}`,
            fetched_at: nowIso,
            origin_uri: entry.originUri,
            authenticity_status: isPdf ? "official_original" : "official_html_snapshot",
            access_scope: "scope.platform.public",
            rights_status: "approved_public",
          };
        }

        const issuerId =
          entry.targetType === "SubordinateLegislation"
            ? /^subreg\.th\.rc\.royal_decree\./.test(entry.key)
              ? "reg.th.cabinet"
              : /^subreg\.th\.rc\.min_reg\./.test(entry.key)
                ? "reg.th.mof"
                : "reg.th.rd"
            : "reg.th.parliament";

        const aliases = new Set<string>([entry.title]);
        if (entry.sectionLabel) {
          aliases.add(entry.sectionLabel);
          aliases.add(`${entry.sectionLabel} แห่งประมวลรัษฎากร`);
        }
        const rdMatch = /\.royal_decree\.([0-9]+)/.exec(entry.key);
        if (rdMatch) {
          aliases.add(`พระราชกฤษฎีกา (ฉบับที่ ${rdMatch[1]})`);
          aliases.add(`พ.ร.ฎ. ฉบับที่ ${rdMatch[1]}`);
          aliases.add(`พ.ร.ฎ. ${rdMatch[1]}`);
        }
        const mrMatch = /\.min_reg\.([0-9]+)/.exec(entry.key);
        if (mrMatch) {
          aliases.add(`กฎกระทรวง ฉบับที่ ${mrMatch[1]}`);
        }
        const actMatch = /rc_amendment_([0-9]+)_([0-9]{4})/.exec(entry.key);
        if (actMatch) {
          aliases.add(`พระราชบัญญัติแก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ${actMatch[1]})`);
          aliases.add(`พ.ร.บ. แก้ไขเพิ่มเติมประมวลรัษฎากร (ฉบับที่ ${actMatch[1]})`);
        }

        const existingWork = draft.works[entry.key];
        draft.works[entry.key] = {
          work_id: entry.key,
          type: entry.targetType,
          issuer_id: issuerId,
          jurisdiction: "TH",
          title_th: entry.title,
          official_identifiers: [
            {
              raw: entry.sectionLabel || entry.title,
              normalized: entry.sectionLabel || entry.title,
              kind: entry.sectionLabel ? "section_no" : "statute_code",
            },
          ],
          identity_evidence: [artId],
          aliases: Array.from(aliases),
          owner_batch_id: "B02",
          first_loaded_by_batch_id: existingWork?.first_loaded_by_batch_id || "B01",
          required_by: existingWork?.required_by || [],
        };
        createdWorkIds.push(entry.key);

        const verId = `ver.${entry.key.replace(/^(?:prov\.|subreg\.|statute\.|sched\.)/, "")}.v1`;
        const isConsolidatedRc =
          entry.key.startsWith("prov.th.rc.") || entry.key.startsWith("sched.th.rc.");
        const effIso = isConsolidatedRc ? null : entry.effectiveIso;
        const dateStatus = isConsolidatedRc
          ? "verified"
          : entry.dateStatus === "verified" && effIso
            ? "verified"
            : "unknown_restricted";
        const parsedAmendLedger = isConsolidatedRc
          ? extractAmendmentLedgerFromStatutoryText(entry.key, verbatimText)
          : undefined;

        draft.versions[verId] = {
          version_id: verId,
          work_id: entry.key,
          version_label: isConsolidatedRc ? "consolidated_rd_current" : "v1",
          legal_applicability: [
            {
              valid_from: effIso,
              valid_to: null,
              conditions: isConsolidatedRc
                ? [
                    "ตัวบทรวมแก้ไขเพิ่มเติมฉบับปัจจุบันตามข้อมูลทางการกรมสรรพากร (rd.go.th) — วันเริ่มใช้บังคับของแต่ละวรรคหรืออนุมาตราให้ตรวจสอบจากหมายเหตุแก้ไขเพิ่มเติมท้ายวรรคนั้นและราชกิจจานุเบกษาโดยตรง",
                  ]
                : entry.effectiveRaw
                  ? [entry.effectiveRaw]
                  : [],
              date_status: dateStatus,
              applicability_basis: isConsolidatedRc
                ? "CONSOLIDATED_MULTI_AMENDMENT"
                : /รอบระยะเวลาบัญชี/.test(entry.effectiveRaw || "")
                  ? "ACCOUNTING_PERIOD_START"
                  : "TRANSACTION_OR_EVENT_DATE",
            },
          ],
          publication_date: effIso,
          decision_date: null,
          raw_date_text: isConsolidatedRc
            ? "ตัวบทรวมแก้ไขเพิ่มเติมตามข้อมูลทางการกรมสรรพากร (rd.go.th)"
            : entry.effectiveRaw,
          temporal_evidence_ids: [artId],
          known_from: nowIso,
          known_to: null,
          is_consolidated_derived: isConsolidatedRc,
          draft_or_enacted_status: isConsolidatedRc ? "CONSOLIDATED_DERIVED" : "ENACTED_ORIGINAL",
          amendment_ledger: parsedAmendLedger,
          access_scope: "scope.platform.public",
        };
        createdVersionIds.push(verId);

        const extId = `ext.ver.${sha256Bytes(`${TARGET_STAGING_RELEASE_ID}:${entry.key}`).slice(0, 12)}`;
        draft.extractions[extId] = {
          extraction_id: extId,
          artifact_id: artId,
          work_id: entry.key,
          version_id: verId,
          extractor_version: "verified-statutory-v1.3",
          model_version: "verbatim-official-rd-source",
          configuration_version: "cfg.v1.3",
          raw_text_uri: draft.artifacts[artId].immutable_uri,
          raw_text: verbatimText,
          normalized_text: verbatimText,
          normalization_log: ["verified_verbatim_statutory_source"],
          quality_status: "VALIDATED",
          accepted_revision: 1,
          created_at: nowIso,
        };

        const anchorSel = entry.anchor
          ? `a#${entry.anchor}`
          : `article#${entry.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

        const verPsgs = chunkThaiLegalDocument({
          work_id: entry.key,
          version_id: verId,
          extraction_id: extId,
          release_id: TARGET_STAGING_RELEASE_ID,
          artifact_id: artId,
          origin_uri: entry.originUri,
          locator_kind: isPdf ? "pdf_page" : "html_structural",
          physical_page_index: isPdf ? 0 : undefined,
          structural_selector_prefix: isPdf ? undefined : anchorSel,
          header_label: entry.title,
          structural_path_prefix: [entry.title, entry.sectionLabel || "บทบัญญัติ"],
          raw_text: verbatimText,
          statement_role: "statutory_text",
          access_scope: "scope.platform.public",
        });

        for (const vp of verPsgs) {
          draft.passages[vp.passage_id] = vp;
          createdPassageIds.push(vp.passage_id);
        }

        // Clean up anyresolved quarantine entries targeting `entry.key` now that real verbatim text is verified!
        for (const [urefId, uref] of Object.entries(draft.unresolved_references)) {
          if (uref.target_hint === entry.key) {
            delete draft.unresolved_references[urefId];
          }
        }
      }

      // Add explicit ACCEPTED controlling-authority dependency edges (`MADE_UNDER` / `AMENDS` / `CITES`)
      const authorityEdges: Array<{
        subject: string;
        predicate: Assertion["predicate"];
        object: string;
        note: string;
      }> = [
        { subject: "sched.th.rc.income_tax_rate", predicate: "CITES", object: "prov.th.rc.48", note: "PIT progressive tax rate schedule" },
        { subject: "sched.th.rc.income_tax_rate", predicate: "CITES", object: "prov.th.rc.65", note: "CIT 20% net profit tax rate schedule" },
        { subject: "sched.th.rc.income_tax_rate", predicate: "CITES", object: "prov.th.rc.67", note: "CIT schedule reference" },
        { subject: "subreg.th.rc.royal_decree.470", predicate: "MADE_UNDER", object: "prov.th.rc.48", note: "PIT first 150,000 THB net income exemption" },
        { subject: "subreg.th.rc.royal_decree.470", predicate: "CITES", object: "sched.th.rc.income_tax_rate", note: "Modifies effective PIT first bracket" },
        { subject: "statute.th.rc_amendment_42_2559", predicate: "AMENDS", object: "sched.th.rc.income_tax_rate", note: "Permanent 20% CIT rate from accounting periods >= 1 Jan 2559" },
        { subject: "statute.th.rc_amendment_42_2559", predicate: "CITES", object: "prov.th.rc.65", note: "Permanent 20% CIT rate on net profit" },
        { subject: "subreg.th.rc.royal_decree.530", predicate: "MADE_UNDER", object: "prov.th.rc.65", note: "SME CIT progressive rates & 2555-2557 reduction" },
        { subject: "subreg.th.rc.royal_decree.555", predicate: "AMENDS", object: "subreg.th.rc.royal_decree.530", note: "Temporary 20% CIT rate for 2556-2557" },
        { subject: "subreg.th.rc.royal_decree.577", predicate: "AMENDS", object: "subreg.th.rc.royal_decree.530", note: "Temporary 20% CIT rate for accounting periods starting in 2558 (incl. split FY 2558/2559)" },
        { subject: "subreg.th.rc.royal_decree.577", predicate: "CITES", object: "prov.th.rc.65", note: "Temporary 20% CIT rate for accounting periods starting in 2558" },
        { subject: "statute.th.rc_amendment_40_2558", predicate: "AMENDS", object: "prov.th.rc.42", note: "Gift tax exemptions s.42(26)-(28)" },
        { subject: "statute.th.rc_amendment_40_2558", predicate: "AMENDS", object: "prov.th.rc.48", note: "Gift tax 5% election s.48(6)" },
        { subject: "statute.th.rc_amendment_44_2560", predicate: "AMENDS", object: "prov.th.rc.42_ทวิ", note: "50% up to 100,000 THB standard deduction for s.40(1)-(2) from tax year 2560" },
        { subject: "statute.th.rc_amendment_44_2560", predicate: "AMENDS", object: "sched.th.rc.income_tax_rate", note: "Modern PIT progressive rate brackets up to 35%" },
        { subject: "subreg.th.rc.royal_decree.646", predicate: "MADE_UNDER", object: "prov.th.rc.80", note: "Base VAT reduction to 6.3% (+ 0.7% local tax = 7.0%)" },
        { subject: "subreg.th.rc.royal_decree.780", predicate: "AMENDS", object: "subreg.th.rc.royal_decree.646", note: "VAT 6.3% (+ 0.7% local = 7.0%) through 30 Sep 2567" },
        { subject: "subreg.th.rc.royal_decree.799", predicate: "MADE_UNDER", object: "prov.th.rc.80", note: "VAT 6.3% (+ 0.7% local = 7.0%) for 1 Oct 2568 - 30 Sep 2569" },
        { subject: "subreg.th.rc.royal_decree.807", predicate: "MADE_UNDER", object: "prov.th.rc.80", note: "VAT 6.3% (+ 0.7% local = 7.0%) through 30 Sep 2570" },
        { subject: "subreg.th.rd.vat_local_tax_guide", predicate: "CITES", object: "prov.th.rc.80", note: "Local tax 1/9 of VAT (0.7%) yielding 7.0% total VAT" },
        { subject: "subreg.th.rc.royal_decree.432", predicate: "MADE_UNDER", object: "prov.th.rc.81/1", note: "1,800,000 THB annual small-business VAT exemption threshold" },
        { subject: "subreg.th.rc.royal_decree.432", predicate: "CITES", object: "prov.th.rc.85/1", note: "30-day VAT registration trigger above 1,800,000 THB" },
        { subject: "subreg.th.rd.dg_vat.105", predicate: "MADE_UNDER", object: "prov.th.rc.80/1", note: "Zero-rate VAT export of services conditions" },
        { subject: "subreg.th.rd.order_tp.4_2528", predicate: "MADE_UNDER", object: "prov.th.rc.3_เตรส", note: "Domestic WHT rates (1%, 2%, 3%, 5%)" },
        { subject: "subreg.th.rd.order_tp.354_2566", predicate: "CITES", object: "prov.th.rc.3_ปัณรส", note: "e-Withholding Tax 1% for 1 Jan 2566 - 31 Dec 2568" },
        { subject: "subreg.th.rc.min_reg.389", predicate: "MADE_UNDER", object: "prov.th.rc.3_เตรส", note: "e-Withholding Tax 1% for 1 Jan 2566 - 31 Dec 2568" },
        { subject: "subreg.th.rc.min_reg.389", predicate: "CITES", object: "prov.th.rc.3_ปัณรส", note: "e-Withholding Tax statutory mechanism" },
        { subject: "subreg.th.rc.min_reg.402", predicate: "MADE_UNDER", object: "prov.th.rc.3_เตรส", note: "e-Withholding Tax 1% for 1 Jan 2569 - 31 Dec 2570 (signed 1 Oct 2569)" },
        { subject: "subreg.th.rc.min_reg.402", predicate: "CITES", object: "prov.th.rc.3_ปัณรส", note: "e-Withholding Tax statutory mechanism" },
        { subject: "sched.th.rc.stamp_duty", predicate: "CITES", object: "prov.th.rc.103", note: "Stamp duty definitions & schedule" },
        { subject: "sched.th.rc.stamp_duty", predicate: "CITES", object: "prov.th.rc.104", note: "Stamp duty rate schedule & liable party" },
        { subject: "subreg.th.rd.dg_stamp.37", predicate: "MADE_UNDER", object: "prov.th.rc.103", note: "Mandatory cash stamp duty payment (O.S.4) for hire of work >= 1,000,000 THB" },
        { subject: "subreg.th.rd.dg_stamp.37", predicate: "CITES", object: "sched.th.rc.stamp_duty", note: "Instrument item 4 hire of work cash payment threshold" },
        { subject: "subreg.th.rc.royal_decree.342", predicate: "MADE_UNDER", object: "prov.th.rc.91/2", note: "SBT commercial immovable property sale rules (5-year holding & inheritance exemptions)" },
        { subject: "subreg.th.rd.sbt_local_tax_guide", predicate: "CITES", object: "prov.th.rc.91/6", note: "10% local tax on SBT (3.0% + 0.3% = 3.3% effective rate)" },
        { subject: "subreg.th.rd.order_p.52_2537", predicate: "CITES", object: "prov.th.rc.65_ตรี", note: "Section 65 ter (3)(b) 2% of post-donation net profit calculation rule (2/102 of pre-donation net profit)" },
      ];

      for (const edge of authorityEdges) {
        if (!draft.works[edge.subject] || !draft.works[edge.object]) continue;
        const subPsg = Object.values(draft.passages).find(
          (p) => p.work_id === edge.subject && !p.extraction_id.startsWith("ext.dep.")
        );
        const asrtId = `asrt.rc6.${sha256Bytes(`${edge.subject}:${edge.predicate}:${edge.object}`).slice(0, 14)}`;
        draft.assertions[asrtId] = {
          assertion_id: asrtId,
          release_id: TARGET_STAGING_RELEASE_ID,
          subject: edge.subject,
          subject_type: draft.works[edge.subject].type,
          predicate: edge.predicate,
          object: edge.object,
          object_type: draft.works[edge.object].type,
          qualifications: {
            conditions: [edge.note],
            exceptions: [],
          },
          evidence_ids: subPsg ? [subPsg.passage_id] : [],
          statement_role: "statutory_text",
          state: "ACCEPTED",
          review_id: null,
          validity: {
            valid_from: null,
            valid_to: null,
          },
          confidence: 1.0,
          legal_certainty: "settled_statutory",
          scope: "scope.platform.public",
        };
        createdAssertionIds.push(asrtId);
      }

      const rc5Rel = draft.releases["rel.B01.rc5"];
      const manifestId = "mfst.b01.rc6_core_auth";
      const manifestPayload = JSON.stringify({
        parent_manifest_hash: rc5Rel?.manifest_hash || null,
        created_work_ids: [...createdWorkIds].sort(),
        created_passage_count: createdPassageIds.length,
      });
      const manifestHash = sha256Bytes(manifestPayload);

      const baseManifest = rc5Rel ? draft.manifests[rc5Rel.manifest_id] : undefined;
      const nextManifest: BatchManifest = {
        manifest_id: manifestId,
        batch_id: "B01",
        previous_batch_id: baseManifest?.previous_batch_id ?? null,
        inventory_snapshot_id: `inv.b01.rc6.${manifestHash.slice(0, 10)}`,
        inventory_hash: manifestHash,
        owned_folder_ids: baseManifest?.owned_folder_ids || ["https://www.rd.go.th"],
        dependency_manifest_id: `dep.${manifestId}`,
        run_limits: baseManifest?.run_limits || {
          max_documents_per_run: 5000,
          max_source_pages_per_run: 25000,
          max_ocr_task_pages: 0,
          max_ocr_dispatch_pages_per_run: 0,
          stratified_audit_fraction: 0.05,
          stratified_audit_min_docs: 20,
        },
        source_cutoff_at: nowIso,
        expected_previous_release_id: "rel.B01.rc5",
        frozen_at: nowIso,
        frozen_by: "staging.eng@reg24.th",
        empty_folders_detected: [],
        shortcut_cycles_prevented: [],
        index_mismatches: [],
        dedicated_oversized_runs_required: [],
      };
      draft.manifests[manifestId] = nextManifest;

      draft.releases[TARGET_STAGING_RELEASE_ID] = {
        release_id: TARGET_STAGING_RELEASE_ID,
        batch_id: "B01",
        manifest_id: manifestId,
        manifest_hash: manifestHash,
        code_commit: gitHead,
        state: "READY_FOR_UAT",
        revision: 6,
        previous_accepted_release_id: "rel.B01.rc5",
        rollback_target_release_id: "rel.B01.rc5",
        supersession_lineage: {
          supersedes_release_id: "rel.B01.rc5",
          supersedes_manifest_id: rc5Rel?.manifest_id || "mfst.b01.mwlizi6u",
          supersedes_manifest_hash: rc5Rel?.manifest_hash || "",
          prior_release_preserved_state: rc5Rel?.state || "READY_FOR_UAT",
          prior_chat_approval_preserved: false,
          explanation:
            "Incremental verified primary/schedule/rate/subordinate authority overlay from official rd.go.th without rebuilding the 4,581 B01 rulings.",
        },
        created_work_ids: createdWorkIds,
        created_version_ids: createdVersionIds,
        created_passage_ids: createdPassageIds,
        created_assertion_ids: createdAssertionIds,
        reused_work_ids: reusedWorkIds,
        coverage_gaps: rc5Rel?.coverage_gaps || [],
        transitions: [
          {
            from: null,
            to: "READY_FOR_UAT",
            actor_id: "staging.eng@reg24.th",
            at: nowIso,
            revision: 6,
            note: "Materialized incremental core statutory schedules, rates, and subordinate dependencies (rel.B01.rc6) preserving all 4,581 B01 rulings.",
          },
        ],
        created_at: nowIso,
        updated_at: nowIso,
      };

      // Governance invariant: never auto-promote `active_release_id` without Owner UAT sign-off
      draft.active_release_id = null;
    },
    { actorId: "staging.eng@reg24.th" }
  );

  const postSha = sha256File(protectedLiveGz);
  if (postSha !== PROTECTED_CANONICAL_SHA256) {
    throw new Error(`PROTECTED_STORE_MISMATCH_POST: ${postSha}`);
  }

  const allRc6Passages = store.getPassagesForRelease(TARGET_STAGING_RELEASE_ID);
  console.log(
    JSON.stringify(
      {
        ok: true,
        release_id: TARGET_STAGING_RELEASE_ID,
        created_works: createdWorkIds.length,
        reused_works: reusedWorkIds.length,
        created_passages: createdPassageIds.length,
        created_assertions: createdAssertionIds.length,
        cumulative_passages_in_rc6: allRc6Passages.length,
        protected_canonical_sha256_verified: postSha,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
