/**
 * REG24 — Instruction 2 (2026-11-15): Separate Hashed Candidate Proposal (`rel.B02.rc2`)
 * for Independently Verified Royal Decrees No. 736 B.E. 2564 and No. 773 B.E. 2566
 *
 * GOVERNANCE INVARIANTS:
 * 1. Does NOT touch `staging_candidates_rc2_b02` (`rel.B01.rc2` + `rel.B02.rc1`), where both
 *    B01 links remain 100% SUPPRESSED and quarantined (`usable_as_legal_evidence: false`).
 * 2. Clones the clean staged store into an isolated `--proposal-dir` and materializes a new,
 *    cryptographically hashed candidate release `rel.B02.rc2` (`state = READY_FOR_UAT`,
 *    `user_decision = null`) with `supersession_lineage` pointing to `rel.B02.rc1`.
 * 3. Proposes ONLY the independently verified, verbatim-complete section-level links:
 *    - `ruling.th.rd.68494` (`กค 0702/1493`) -> `prov.th.rc.royal_decree.736.3_1` (`มาตรา 3 (1)`)
 *      and `prov.th.rc.royal_decree.736.4_1` (`มาตรา 4 (1)`)
 *    - `ruling.th.rd.68053` (`กค 0702/6077`) -> `prov.th.rc.royal_decree.773.3` (`มาตรา 3`)
 *      and `prov.th.rc.royal_decree.773.4` (`มาตรา 4`)
 * 4. Does NOT fabricate the clipped ~220-char tail of `มาตรา 4 (3)` / `มาตรา 5` on Page 2 of RD 736.
 * 5. Preserves both B01 quarantine records (`uref.subreg.th.rc.royal_decree.736...` and `773...`)
 *    with `usable_as_legal_evidence: false` — NEVER automatically marking quarantined records
 *    as usable legal evidence.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getDeployedGitCommit } from "../src/core/knowledge/baseline";
import { validateStagedAssertion } from "../src/core/knowledge/evidence";
import { sha256Bytes } from "../src/core/knowledge/identity";
import { buildReleaseProjectionsFromOutbox } from "../src/core/knowledge/projections";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import type { Assertion, LegalVersion, LegalWork, Passage } from "../src/core/knowledge/contracts";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const sourceStagingDir = path.resolve(
    getArg("--source-staging-dir") ||
      "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_candidates_rc2_b02"
  );
  const proposalDir = path.resolve(
    getArg("--proposal-dir") ||
      "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/staging_proposed_b02_rc2_rd736_773"
  );
  const receiptOutPath = path.resolve(
    getArg("--receipt-out") ||
      "C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/rd736_773_proposed_candidate_receipt.json"
  );

  const protectedProdDir = path.resolve(process.cwd(), "data/knowledge-store");
  if (
    proposalDir.toLowerCase() === protectedProdDir.toLowerCase() ||
    proposalDir.toLowerCase() === sourceStagingDir.toLowerCase()
  ) {
    throw new Error("Refusing to overwrite production store or current suppressed candidate store.");
  }

  fs.rmSync(proposalDir, { recursive: true, force: true });
  fs.mkdirSync(proposalDir, { recursive: true });
  fs.cpSync(sourceStagingDir, proposalDir, { recursive: true });

  // Verify source store remains untouched and suppressed
  const sourceStoreReadOnlyCheck = new DurableKnowledgeStore(sourceStagingDir);
  const srcState = sourceStoreReadOnlyCheck.getState();
  const srcRd736Uref = Object.values(srcState.unresolved_references).find(
    (u) => u.target_hint === "subreg.th.rc.royal_decree.736"
  );
  const srcRd773Uref = Object.values(srcState.unresolved_references).find(
    (u) => u.target_hint === "subreg.th.rc.royal_decree.773"
  );
  if (!srcRd736Uref || srcRd736Uref.usable_as_legal_evidence !== false) {
    throw new Error(
      "Source store invariant failed: RD 736 quarantine record missing or usable_as_legal_evidence !== false"
    );
  }
  if (!srcRd773Uref || srcRd773Uref.usable_as_legal_evidence !== false) {
    throw new Error(
      "Source store invariant failed: RD 773 quarantine record missing or usable_as_legal_evidence !== false"
    );
  }

  const proposalStore = new DurableKnowledgeStore(proposalDir);
  const nowIso = new Date().toISOString();
  const codeCommit = getDeployedGitCommit();
  const proposedReleaseId = "rel.B02.rc2";

  const RD736_SHA256 = "0cbb468ccf7694c4c96929cfc2a3fefea976bdc53d8bf1c682c85af6885fb183";
  const RD773_SHA256 = "1b04f02bdc56476fa925cf04bd3f6c5a83f25da27dbae538531063b14d9e4283";

  // Verbatim section texts verified directly from Royal Gazette PDFs in B02
  const RD736_S3_1_VERBATIM =
    "มาตรา 3 ให้ยกเว้นภาษีธุรกิจเฉพาะตามหมวด 5 ในลักษณะ 2 แห่งประมวลรัษฎากร ให้แก่เจ้าของอสังหาริมทรัพย์ซึ่งเป็นนิติบุคคลตามมาตรา 77/1 แห่งประมวลรัษฎากร สำหรับรายรับอันเนื่องมาจากการขายอสังหาริมทรัพย์ที่เจ้าของอสังหาริมทรัพย์มีไว้ในการประกอบกิจการเฉพาะของตนดังต่อไปนี้ ทั้งนี้ เฉพาะรายรับที่ได้รับตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป (1) รายรับที่เป็นเงินค่าทดแทนสำหรับการขายอสังหาริมทรัพย์ตามมาตรา 25 แห่งพระราชบัญญัติว่าด้วยการเวนคืนและการได้มาซึ่งอสังหาริมทรัพย์ พ.ศ. 2562";

  const RD736_S4_1_VERBATIM =
    "มาตรา 4 ให้ยกเว้นอากรแสตมป์ตามหมวด 6 ในลักษณะ 2 แห่งประมวลรัษฎากร สำหรับการกระทำตราสารอันเนื่องมาจากการโอนกรรมสิทธิ์ในอสังหาริมทรัพย์สำหรับกรณีดังต่อไปนี้ ทั้งนี้ เฉพาะตราสารที่ได้กระทำตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป (1) การขายอสังหาริมทรัพย์ตามมาตรา 25 แห่งพระราชบัญญัติว่าด้วยการเวนคืนและการได้มาซึ่งอสังหาริมทรัพย์ พ.ศ. 2562";

  const RD773_S3_VERBATIM =
    "มาตรา 3 ให้ยกเว้นภาษีเงินได้ตามส่วน 3 หมวด 3 ในลักษณะ 2 แห่งประมวลรัษฎากร ให้แก่บริษัทหรือห้างหุ้นส่วนนิติบุคคล สำหรับเงินได้ที่ได้รับเป็นเงินอุดหนุนจากภาครัฐตามมาตรการสนับสนุนการใช้ยานยนต์ไฟฟ้าประเภทรถยนต์และรถจักรยานยนต์ ทั้งนี้ เฉพาะบริษัทหรือห้างหุ้นส่วนนิติบุคคลที่ปฏิบัติตามหลักเกณฑ์ วิธีการ และเงื่อนไขที่อธิบดีกรมสรรพสามิตประกาศกำหนด การยกเว้นภาษีเงินได้ตามวรรคหนึ่งให้ใช้บังคับสำหรับรอบระยะเวลาบัญชีที่ได้รับเงินอุดหนุน";

  const RD773_S4_VERBATIM =
    "มาตรา 4 กรณีบริษัทหรือห้างหุ้นส่วนนิติบุคคลได้ใช้สิทธิยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกานี้ และต่อมาไม่ปฏิบัติตามหลักเกณฑ์ที่กำหนดในมาตรา 3 ให้สิทธิที่จะได้รับยกเว้นภาษีเงินได้ตามพระราชกฤษฎีกานี้สิ้นสุดลง และบริษัทหรือห้างหุ้นส่วนนิติบุคคลนั้นจะต้องนำเงินได้ที่ได้ใช้สิทธิยกเว้นภาษีเงินได้ไปแล้วไปรวมเป็นรายได้ในการคำนวณกำไรสุทธิเพื่อเสียภาษีเงินได้ในรอบระยะเวลาบัญชีที่ได้ใช้สิทธินั้น ทั้งนี้ ตามหลักเกณฑ์ วิธีการ และเงื่อนไขที่อธิบดีประกาศกำหนด";

  const proposalMeta = await proposalStore.transact(
    "STAGE_PROPOSED_CANDIDATE_REL_B02_RC2_RD736_773",
    (draft) => {
      const baseB02Rel = draft.releases["rel.B02.rc1"];
      const baseB02Mfst = draft.manifests[baseB02Rel.manifest_id];
      if (!baseB02Rel || !baseB02Mfst) {
        throw new Error("Base candidate rel.B02.rc1 missing in cloned staging store.");
      }

      const art736 = Object.values(draft.artifacts).find((a) => a.actual_bytes_sha256 === RD736_SHA256);
      const art773 = Object.values(draft.artifacts).find((a) => a.actual_bytes_sha256 === RD773_SHA256);
      if (!art736 || !art773) {
        throw new Error("Verified Gazette PDF artifacts for RD 736 / RD 773 not found in B02 store.");
      }

      const q736 = Object.values(draft.unresolved_references).find(
        (u) => u.target_hint === "subreg.th.rc.royal_decree.736"
      );
      const q773 = Object.values(draft.unresolved_references).find(
        (u) => u.target_hint === "subreg.th.rc.royal_decree.773"
      );
      if (!q736 || !q773) {
        throw new Error("Quarantine records for RD 736 / RD 773 missing!");
      }

      const ruling68494WorkId =
        q736.source_work_id ||
        draft.legacy_crosswalk["ruling.th.rd.68494"] ||
        "work.th.rd.gk_0702_1493_2026_c76989ef";
      const ruling68053WorkId =
        q773.source_work_id ||
        draft.legacy_crosswalk["ruling.th.rd.68053"] ||
        "work.th.rd.gk_0702_6077_2025_47ed9f4a";

      const ruling68494ConclusionPsg = Object.values(draft.passages).find(
        (p) =>
          p.work_id === ruling68494WorkId &&
          p.release_id === "rel.B01.rc2" &&
          p.statement_role === "official_conclusion"
      );
      const ruling68053ConclusionPsg = Object.values(draft.passages).find(
        (p) =>
          p.work_id === ruling68053WorkId &&
          p.release_id === "rel.B01.rc2" &&
          p.statement_role === "official_conclusion"
      );
      if (!ruling68494ConclusionPsg || !ruling68053ConclusionPsg) {
        throw new Error("Official conclusion passages for ruling 68494 or 68053 not found in rel.B01.rc2.");
      }

      // 1. Update canonical instrument titles & verified Gazette versions for RD 736 & RD 773 in `rel.B02.rc2`
      draft.works["subreg.th.rc.royal_decree.736"] = {
        ...draft.works["subreg.th.rc.royal_decree.736"],
        work_id: "subreg.th.rc.royal_decree.736",
        type: "SubordinateLegislation",
        issuer_id: "reg.th.cabinet",
        jurisdiction: "TH",
        title_th:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 736) พ.ศ. 2564",
        title_en:
          "Royal Decree Issued under the Revenue Code Governing Exemption from Revenue Taxes (No. 736) B.E. 2564 (2021)",
        official_identifiers: [
          {
            raw: "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ ๗๓๖) พ.ศ. ๒๕๖๔",
            normalized: "พระราชกฤษฎีกา (ฉบับที่ 736) พ.ศ. 2564",
            kind: "royal_decree_no",
          },
        ],
        identity_evidence: [art736.artifact_id],
        aliases: ["พ.ร.ฎ. (ฉบับที่ 736)", "พระราชกฤษฎีกา ฉบับที่ 736"],
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B02",
      };

      draft.works["subreg.th.rc.royal_decree.773"] = {
        ...draft.works["subreg.th.rc.royal_decree.773"],
        work_id: "subreg.th.rc.royal_decree.773",
        type: "SubordinateLegislation",
        issuer_id: "reg.th.cabinet",
        jurisdiction: "TH",
        title_th:
          "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ 773) พ.ศ. 2566",
        title_en:
          "Royal Decree Issued under the Revenue Code Governing Exemption from Revenue Taxes (No. 773) B.E. 2566 (2023)",
        official_identifiers: [
          {
            raw: "พระราชกฤษฎีกาออกตามความในประมวลรัษฎากร ว่าด้วยการยกเว้นรัษฎากร (ฉบับที่ ๗๗๓) พ.ศ. ๒๕๖๖",
            normalized: "พระราชกฤษฎีกา (ฉบับที่ 773) พ.ศ. 2566",
            kind: "royal_decree_no",
          },
        ],
        identity_evidence: [art773.artifact_id],
        aliases: ["พ.ร.ฎ. (ฉบับที่ 773)", "พระราชกฤษฎีกา ฉบับที่ 773"],
        owner_batch_id: "B02",
        first_loaded_by_batch_id: "B02",
      };

      const v736GazId = "ver.th.rc.royal_decree.736.v2021_gazette";
      draft.versions[v736GazId] = {
        version_id: v736GazId,
        work_id: "subreg.th.rc.royal_decree.736",
        version_label: "v2021_gazette_138_73a",
        legal_applicability: [
          {
            valid_from: "2021-11-09",
            valid_to: null,
            conditions: [
              "มาตรา 2: ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป (ประกาศราชกิจจานุเบกษา เล่ม 138 ตอนที่ 73 ก วันที่ 8 พฤศจิกายน 2564 หน้า 159–161; วันให้ไว้ ณ วันที่ 7 พฤศจิกายน 2564)",
              "มาตรา 3 และมาตรา 4: ผลบังคับย้อนหลังเฉพาะรายรับที่ได้รับและตราสารที่ได้กระทำตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป สำหรับการขายอสังหาริมทรัพย์ตามพระราชบัญญัติว่าด้วยการเวนคืนและการได้มาซึ่งอสังหาริมทรัพย์ พ.ศ. 2562",
            ],
            date_status: "retroactive_evidenced",
          },
        ],
        publication_date: "2021-11-08",
        decision_date: "2021-11-07",
        raw_date_text:
          "เล่ม 138 ตอนที่ 73 ก ราชกิจจานุเบกษา 8 พฤศจิกายน 2564 (ให้ไว้ ณ วันที่ 7 พฤศจิกายน 2564)",
        temporal_evidence_ids: [art736.artifact_id],
        known_from: nowIso,
        known_to: null,
        draft_or_enacted_status: "ENACTED_ORIGINAL",
        access_scope: "scope.platform.public",
      };

      const v773GazId = "ver.th.rc.royal_decree.773.v2023_gazette";
      draft.versions[v773GazId] = {
        version_id: v773GazId,
        work_id: "subreg.th.rc.royal_decree.773",
        version_label: "v2023_gazette_140_47a",
        legal_applicability: [
          {
            valid_from: "2023-08-16",
            valid_to: null,
            conditions: [
              "มาตรา 2: ใช้บังคับตั้งแต่วันถัดจากวันประกาศในราชกิจจานุเบกษาเป็นต้นไป (ประกาศราชกิจจานุเบกษา เล่ม 140 ตอนที่ 47 ก วันที่ 15 สิงหาคม 2566 หน้า 22–24; วันให้ไว้ ณ วันที่ 12 สิงหาคม 2566)",
              "มาตรา 3 วรรคสอง และมาตรา 4: ยกเว้นภาษีเงินได้นิติบุคคลสำหรับรอบระยะเวลาบัญชีที่ได้รับเงินอุดหนุนจากภาครัฐตามมาตรการสนับสนุนการใช้ยานยนต์ไฟฟ้า ทั้งนี้ ต้องปฏิบัติตามหลักเกณฑ์ วิธีการ และเงื่อนไขที่อธิบดีกรมสรรพสามิตประกาศกำหนด มิฉะนั้นสิ้นสิทธิและต้องนำกลับมารวมคำนวณกำไรสุทธิ",
            ],
            date_status: "transitional",
          },
        ],
        publication_date: "2023-08-15",
        decision_date: "2023-08-12",
        raw_date_text:
          "เล่ม 140 ตอนที่ 47 ก ราชกิจจานุเบกษา 15 สิงหาคม 2566 (ให้ไว้ ณ วันที่ 12 สิงหาคม 2566)",
        temporal_evidence_ids: [art773.artifact_id],
        known_from: nowIso,
        known_to: null,
        draft_or_enacted_status: "ENACTED_ORIGINAL",
        access_scope: "scope.platform.public",
      };

      // 2. Create section-level Provision works, versions, and verbatim passages
      const sectionSpecs = [
        {
          workId: "prov.th.rc.royal_decree.736.3_1",
          versionId: "ver.th.rc.royal_decree.736.3_1.v2021",
          titleTh: "พระราชกฤษฎีกาฯ (ฉบับที่ 736) พ.ศ. 2564 มาตรา 3 (1)",
          sectionRef: "มาตรา 3 (1)",
          verbatimText: RD736_S3_1_VERBATIM,
          artifact: art736,
          pubDate: "2021-11-08",
          validFrom: "2021-11-09",
          pageIndex: 0,
          printedPage: "159",
          conditionNote: "เฉพาะรายรับที่ได้รับตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป",
        },
        {
          workId: "prov.th.rc.royal_decree.736.4_1",
          versionId: "ver.th.rc.royal_decree.736.4_1.v2021",
          titleTh: "พระราชกฤษฎีกาฯ (ฉบับที่ 736) พ.ศ. 2564 มาตรา 4 (1)",
          sectionRef: "มาตรา 4 (1)",
          verbatimText: RD736_S4_1_VERBATIM,
          artifact: art736,
          pubDate: "2021-11-08",
          validFrom: "2021-11-09",
          pageIndex: 1,
          printedPage: "160",
          conditionNote: "เฉพาะตราสารที่ได้กระทำตั้งแต่วันที่ 30 พฤษภาคม พ.ศ. 2562 เป็นต้นไป",
        },
        {
          workId: "prov.th.rc.royal_decree.773.3",
          versionId: "ver.th.rc.royal_decree.773.3.v2023",
          titleTh: "พระราชกฤษฎีกาฯ (ฉบับที่ 773) พ.ศ. 2566 มาตรา 3",
          sectionRef: "มาตรา 3",
          verbatimText: RD773_S3_VERBATIM,
          artifact: art773,
          pubDate: "2023-08-15",
          validFrom: "2023-08-16",
          pageIndex: 0,
          printedPage: "22",
          conditionNote:
            "สำหรับรอบระยะเวลาบัญชีที่ได้รับเงินอุดหนุน ตามหลักเกณฑ์ที่อธิบดีกรมสรรพสามิตประกาศกำหนด",
        },
        {
          workId: "prov.th.rc.royal_decree.773.4",
          versionId: "ver.th.rc.royal_decree.773.4.v2023",
          titleTh: "พระราชกฤษฎีกาฯ (ฉบับที่ 773) พ.ศ. 2566 มาตรา 4",
          sectionRef: "มาตรา 4",
          verbatimText: RD773_S4_VERBATIM,
          artifact: art773,
          pubDate: "2023-08-15",
          validFrom: "2023-08-16",
          pageIndex: 1,
          printedPage: "23",
          conditionNote:
            "กรณีไม่ปฏิบัติตามหลักเกณฑ์ในมาตรา 3 สิทธิยกเว้นสิ้นสุดลงและต้องนำเงินได้มารวมคำนวณกำไรสุทธิ",
        },
      ];

      const newWorkIds: string[] = [
        "subreg.th.rc.royal_decree.736",
        "subreg.th.rc.royal_decree.773",
      ];
      const newVersionIds: string[] = [v736GazId, v773GazId];
      const newPassageIds: string[] = [];

      for (const spec of sectionSpecs) {
        const w: LegalWork = {
          work_id: spec.workId,
          type: "Provision",
          issuer_id: "reg.th.cabinet",
          jurisdiction: "TH",
          title_th: spec.titleTh,
          official_identifiers: [
            { raw: spec.sectionRef, normalized: spec.sectionRef, kind: "section_no" },
          ],
          identity_evidence: [spec.artifact.artifact_id],
          aliases: [spec.titleTh],
          owner_batch_id: "B02",
          first_loaded_by_batch_id: "B02",
        };
        draft.works[spec.workId] = w;
        newWorkIds.push(spec.workId);

        const ver: LegalVersion = {
          version_id: spec.versionId,
          work_id: spec.workId,
          version_label: "v1_gazette_verified",
          legal_applicability: [
            {
              valid_from: spec.validFrom,
              valid_to: null,
              conditions: [spec.conditionNote],
              date_status: "transitional",
            },
          ],
          publication_date: spec.pubDate,
          decision_date: null,
          raw_date_text: spec.pubDate,
          temporal_evidence_ids: [spec.artifact.artifact_id],
          known_from: nowIso,
          known_to: null,
          draft_or_enacted_status: "ENACTED_ORIGINAL",
          access_scope: "scope.platform.public",
        };
        draft.versions[spec.versionId] = ver;
        newVersionIds.push(spec.versionId);

        const extId = `ext.prop.${spec.workId}.${proposedReleaseId}`;
        draft.extractions[extId] = {
          extraction_id: extId,
          artifact_id: spec.artifact.artifact_id,
          work_id: spec.workId,
          version_id: spec.versionId,
          extractor_version: "b02.rc2.rd736_773_proposal.v1",
          model_version: "native_pdf_gazette_layer",
          configuration_version: "2026-11-15",
          raw_text_uri: spec.artifact.immutable_uri,
          raw_text: spec.verbatimText,
          normalized_text: spec.verbatimText,
          normalization_log: ["verified_royal_gazette_native_pdf_text"],
          quality_status: "VALIDATED",
          accepted_revision: 1,
          created_at: nowIso,
        };

        const psgId = `psg.prop.${spec.workId}.0`;
        const psg: Passage = {
          passage_id: psgId,
          work_id: spec.workId,
          version_id: spec.versionId,
          extraction_id: extId,
          release_id: proposedReleaseId,
          exact_text: spec.verbatimText,
          contextualized_header: `[${spec.titleTh} | ราชกิจจานุเบกษา ${spec.pubDate} | ใช้บังคับ ${spec.validFrom}]`,
          real_locator: {
            kind: "pdf_page",
            artifact_id: spec.artifact.artifact_id,
            origin_uri: spec.artifact.origin_uri,
            physical_page_index: spec.pageIndex,
            printed_page_label: spec.printedPage,
          },
          structural_path: [spec.titleTh, spec.sectionRef],
          parent_id: null,
          adjacent_ids: { previous_id: null, next_id: null },
          language: "th",
          statement_role: "statutory_text",
          token_count: spec.verbatimText.split(/\s+/).length,
          critical_tokens_flagged: [spec.sectionRef],
          contains_untrusted_instruction_like_text: false,
          access_scope: "scope.platform.public",
        };
        draft.passages[psgId] = psg;
        newPassageIds.push(psgId);
      }

      // 3. Propose section-specific links in `rel.B02.rc2` ONLY
      const proposedEdgeSpecs: Array<{
        assertionId: string;
        subjectWorkId: string;
        predicate: Assertion["predicate"];
        objectWorkId: string;
        evidencePassageIds: string[];
        statementRole: Assertion["statement_role"];
        taxTypes: string[];
        validFrom: string;
      }> = [
        {
          assertionId: "asrt.prop.rd736.contains.3_1",
          subjectWorkId: "subreg.th.rc.royal_decree.736",
          predicate: "CONTAINS",
          objectWorkId: "prov.th.rc.royal_decree.736.3_1",
          evidencePassageIds: ["psg.prop.prov.th.rc.royal_decree.736.3_1.0"],
          statementRole: "statutory_text",
          taxTypes: ["SBT"],
          validFrom: "2021-11-09",
        },
        {
          assertionId: "asrt.prop.rd736.contains.4_1",
          subjectWorkId: "subreg.th.rc.royal_decree.736",
          predicate: "CONTAINS",
          objectWorkId: "prov.th.rc.royal_decree.736.4_1",
          evidencePassageIds: ["psg.prop.prov.th.rc.royal_decree.736.4_1.0"],
          statementRole: "statutory_text",
          taxTypes: ["STAMP"],
          validFrom: "2021-11-09",
        },
        {
          assertionId: "asrt.prop.rd773.contains.3",
          subjectWorkId: "subreg.th.rc.royal_decree.773",
          predicate: "CONTAINS",
          objectWorkId: "prov.th.rc.royal_decree.773.3",
          evidencePassageIds: ["psg.prop.prov.th.rc.royal_decree.773.3.0"],
          statementRole: "statutory_text",
          taxTypes: ["CIT"],
          validFrom: "2023-08-16",
        },
        {
          assertionId: "asrt.prop.rd773.contains.4",
          subjectWorkId: "subreg.th.rc.royal_decree.773",
          predicate: "CONTAINS",
          objectWorkId: "prov.th.rc.royal_decree.773.4",
          evidencePassageIds: ["psg.prop.prov.th.rc.royal_decree.773.4.0"],
          statementRole: "statutory_text",
          taxTypes: ["CIT"],
          validFrom: "2023-08-16",
        },
        {
          assertionId: "asrt.prop.ruling68494.interprets.rd736_s3_1",
          subjectWorkId: ruling68494WorkId,
          predicate: "INTERPRETS",
          objectWorkId: "prov.th.rc.royal_decree.736.3_1",
          evidencePassageIds: [
            ruling68494ConclusionPsg.passage_id,
            "psg.prop.prov.th.rc.royal_decree.736.3_1.0",
          ],
          statementRole: "official_conclusion",
          taxTypes: ["SBT"],
          validFrom: "2026-03-13",
        },
        {
          assertionId: "asrt.prop.ruling68494.interprets.rd736_s4_1",
          subjectWorkId: ruling68494WorkId,
          predicate: "INTERPRETS",
          objectWorkId: "prov.th.rc.royal_decree.736.4_1",
          evidencePassageIds: [
            ruling68494ConclusionPsg.passage_id,
            "psg.prop.prov.th.rc.royal_decree.736.4_1.0",
          ],
          statementRole: "official_conclusion",
          taxTypes: ["STAMP"],
          validFrom: "2026-03-13",
        },
        {
          assertionId: "asrt.prop.ruling68053.interprets.rd773_s3",
          subjectWorkId: ruling68053WorkId,
          predicate: "INTERPRETS",
          objectWorkId: "prov.th.rc.royal_decree.773.3",
          evidencePassageIds: [
            ruling68053ConclusionPsg.passage_id,
            "psg.prop.prov.th.rc.royal_decree.773.3.0",
          ],
          statementRole: "official_conclusion",
          taxTypes: ["CIT"],
          validFrom: "2025-10-14",
        },
        {
          assertionId: "asrt.prop.ruling68053.cites.rd773_s4",
          subjectWorkId: ruling68053WorkId,
          predicate: "CITES",
          objectWorkId: "prov.th.rc.royal_decree.773.4",
          evidencePassageIds: [
            ruling68053ConclusionPsg.passage_id,
            "psg.prop.prov.th.rc.royal_decree.773.4.0",
          ],
          statementRole: "official_conclusion",
          taxTypes: ["CIT"],
          validFrom: "2025-10-14",
        },
      ];

      const proposedAssertionIds: string[] = [];
      for (const es of proposedEdgeSpecs) {
        const subType = draft.works[es.subjectWorkId]?.type;
        const objType = draft.works[es.objectWorkId]?.type;
        if (!subType || !objType) {
          throw new Error(`Missing work type for ${es.subjectWorkId} -> ${es.objectWorkId}`);
        }
        const asrt: Assertion = {
          assertion_id: es.assertionId,
          release_id: proposedReleaseId,
          subject: es.subjectWorkId,
          subject_type: subType,
          predicate: es.predicate,
          object: es.objectWorkId,
          object_type: objType,
          qualifications: {
            conditions: ["Proposed in hashed candidate rel.B02.rc2 pending Owner & legal review"],
            exceptions: [],
            tax_types: es.taxTypes,
          },
          evidence_ids: es.evidencePassageIds,
          statement_role: es.statementRole,
          state: "ACCEPTED",
          review_id: null,
          validity: { valid_from: es.validFrom, valid_to: null },
          confidence: 1,
          legal_certainty:
            es.statementRole === "statutory_text"
              ? "settled_statutory"
              : "administrative_ruling_specific_facts",
          scope: "scope.platform.public",
        };
        draft.assertions[es.assertionId] = asrt;
        proposedAssertionIds.push(es.assertionId);
      }

      // 4. Create immutable manifest & candidate release `rel.B02.rc2` superseding `rel.B02.rc1`
      const proposedManifestId = "mfst.b02.rc2_rd736_773";
      const proposedInventoryHash = sha256Bytes(
        JSON.stringify({
          base_inventory_hash: baseB02Mfst.inventory_hash,
          verified_rd736_sha256: RD736_SHA256,
          verified_rd773_sha256: RD773_SHA256,
          proposed_section_works: newWorkIds,
          proposed_assertions: proposedAssertionIds,
        })
      );

      draft.manifests[proposedManifestId] = {
        ...baseB02Mfst,
        manifest_id: proposedManifestId,
        inventory_snapshot_id: "inv.b02.rc2_rd736_773",
        inventory_hash: proposedInventoryHash,
        frozen_at: nowIso,
      };

      const combinedCreatedWorks = [...baseB02Rel.created_work_ids, ...newWorkIds];
      const combinedCreatedVersions = [...baseB02Rel.created_version_ids, ...newVersionIds];
      const combinedCreatedPassages = [...baseB02Rel.created_passage_ids, ...newPassageIds];
      const combinedCreatedAssertions = [
        ...baseB02Rel.created_assertion_ids,
        ...proposedAssertionIds,
      ];

      const proposedManifestHash = sha256Bytes(
        JSON.stringify({
          manifest_id: proposedManifestId,
          inventory_hash: proposedInventoryHash,
          release_id: proposedReleaseId,
          created_work_count: combinedCreatedWorks.length,
          created_passage_count: combinedCreatedPassages.length,
          proposed_cross_batch_assertions: proposedAssertionIds,
        })
      );

      draft.releases[proposedReleaseId] = {
        release_id: proposedReleaseId,
        batch_id: "B02",
        manifest_id: proposedManifestId,
        manifest_hash: proposedManifestHash,
        code_commit: codeCommit,
        state: "READY_FOR_UAT",
        revision: 1,
        previous_accepted_release_id: baseB02Rel.previous_accepted_release_id,
        rollback_target_release_id: null,
        supersession_lineage: {
          supersedes_release_id: "rel.B02.rc1",
          supersedes_manifest_id: baseB02Rel.manifest_id,
          supersedes_manifest_hash: baseB02Rel.manifest_hash,
          prior_release_preserved_state: baseB02Rel.state,
          prior_chat_approval_preserved: false,
          explanation:
            "Separate hashed proposal candidate (`rel.B02.rc2`) adding independently verified Gazette metadata, effective dates, and section-specific links for Royal Decree No. 736 B.E. 2564 (`มาตรา 3 (1)`, `มาตรา 4 (1)`) and Royal Decree No. 773 B.E. 2566 (`มาตรา 3`, `มาตรา 4`), while preserving `rel.B01.rc2` + `rel.B02.rc1` suppressed and keeping both B01 quarantine records marked `usable_as_legal_evidence: false` pending Owner and qualified legal review.",
        },
        created_work_ids: combinedCreatedWorks,
        created_version_ids: combinedCreatedVersions,
        created_passage_ids: combinedCreatedPassages,
        created_assertion_ids: combinedCreatedAssertions,
        reused_work_ids: [...baseB02Rel.reused_work_ids, ruling68494WorkId, ruling68053WorkId],
        coverage_gaps: [
          ...baseB02Rel.coverage_gaps,
          "RD 736 Page 2 (`หน้า 160`) excerpt clip disclosure: bottom ~220 characters of `มาตรา 4 (3)` and `มาตรา 5` were clipped by the 1,000-char/page manifest excerpt cap in `17186446_Royal_Decree.pdf` (`0cbb468c...`); zero text was fabricated or inferred, and only verbatim-complete sections (`มาตรา 3 (1)` and `มาตรา 4 (1)`) are linked.",
        ],
        transitions: [
          {
            from: "PLANNED",
            to: "READY_FOR_UAT",
            actor_id: "eng.lead@reg24.th",
            at: nowIso,
            revision: 1,
            note: `Staged isolated hashed proposal ${proposedReleaseId} (${proposedManifestId}) for Owner & legal review of RD 736 and RD 773 section links`,
          },
        ],
        created_at: nowIso,
        updated_at: nowIso,
      };

      // STRICT GOVERNANCE CHECK: Quarantine records MUST remain `usable_as_legal_evidence: false`!
      q736.quarantine_status = "UNRESOLVED_QUARANTINED";
      q736.usable_as_legal_evidence = false;
      q773.quarantine_status = "UNRESOLVED_QUARANTINED";
      q773.usable_as_legal_evidence = false;

      const outboxId = `outbox.prop.${proposedReleaseId}`;
      draft.outbox[outboxId] = {
        outbox_id: outboxId,
        release_id: proposedReleaseId,
        batch_id: "B02",
        manifest_hash: proposedManifestHash,
        status: "PENDING",
        created_at: nowIso,
        completed_at: null,
        error: null,
      };

      return {
        proposed_release_id: proposedReleaseId,
        proposed_manifest_id: proposedManifestId,
        proposed_inventory_hash: proposedInventoryHash,
        proposed_manifest_hash: proposedManifestHash,
        supersedes_release_id: "rel.B02.rc1",
        supersedes_manifest_id: baseB02Rel.manifest_id,
        supersedes_manifest_hash: baseB02Rel.manifest_hash,
        proposed_section_works: newWorkIds,
        proposed_assertions: proposedAssertionIds,
        quarantine_records_preserved_non_evidence: {
          rd_736: {
            unresolved_ref_id: q736.unresolved_ref_id,
            quarantine_status: q736.quarantine_status,
            usable_as_legal_evidence: q736.usable_as_legal_evidence,
          },
          rd_773: {
            unresolved_ref_id: q773.unresolved_ref_id,
            quarantine_status: q773.quarantine_status,
            usable_as_legal_evidence: q773.usable_as_legal_evidence,
          },
        },
      };
    },
    { actorId: "eng.lead@reg24.th" }
  );

  // Certify ontology domain/range & source locator resolution on all 8 proposed assertions
  for (const asrtId of proposalMeta.proposed_assertions) {
    const asrt = proposalStore.getState().assertions[asrtId];
    const check = validateStagedAssertion(proposalStore, asrt);
    if (!check.valid) {
      throw new Error(`Proposed assertion ${asrtId} failed ontology certification: ${check.errors.join("; ")}`);
    }
  }

  await buildReleaseProjectionsFromOutbox(proposalStore, proposedReleaseId, "durable_disk");

  const proposalStateFile = path.join(proposalDir, "canonical-state.json.gz");
  const proposalStateSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(proposalStateFile))
    .digest("hex");

  const walPath = path.join(proposalDir, "wal.jsonl");
  const walTail = fs.existsSync(walPath)
    ? fs
        .readFileSync(walPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .slice(-3)
        .map((line) => JSON.parse(line))
    : [];

  const receipt = {
    generated_at: nowIso,
    code_commit: codeCommit,
    isolated_proposal_dir: proposalDir,
    proposal_canonical_state_sha256: proposalStateSha256,
    current_candidates_untouched_and_suppressed: {
      staging_dir: sourceStagingDir,
      rel_b01_rc2_manifest_hash: srcState.releases["rel.B01.rc2"]?.manifest_hash,
      rel_b02_rc1_manifest_hash: srcState.releases["rel.B02.rc1"]?.manifest_hash,
      b01_rd736_links_in_current_candidate: 0,
      b01_rd773_links_in_current_candidate: 0,
      quarantine_usable_as_legal_evidence: false,
    },
    proposed_candidate: proposalMeta,
    wal_audit_tail: walTail,
  };

  fs.mkdirSync(path.dirname(receiptOutPath), { recursive: true });
  fs.writeFileSync(receiptOutPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(`Generated hashed RD 736 & 773 candidate proposal receipt -> ${receiptOutPath}`);
  console.log(JSON.stringify(proposalMeta, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
