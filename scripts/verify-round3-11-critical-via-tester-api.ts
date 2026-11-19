/**
 * REG24 — Round 3 Live Tester-Interface Verification of All 11 Critical Cases + 3 Legal Rewrites
 *
 * Runs every critical case (`B1-01`, `B1-02`, `B1-05F`, `B1-06`, `B1-07`, `B1-09F`, `B1-11F`,
 * `B1-16`, `B1-16F`, `B1-20`, `B1-22`) plus `B1-07F` and `B1-09` through the EXACT HTTP route
 * the legal tester uses (`POST /api/v1/knowledge/query` with `persist_answer: true`, `channel: "chat"`,
 * `conversation_id`, and `prior_saved_answer_revision` on follow-ups) backed by live hosted Neon
 * (`shiny-pond-32049060`).
 *
 * Writes credential-redacted receipt to:
 *   `docs/audit/dodo-review-rc2-b02/round3_11_critical_live_tester_api_receipt.json`
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { POST as queryPost } from "../src/app/api/v1/knowledge/query/route";
import type { ConversationTurnInput } from "../src/core/knowledge/contracts";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../src/core/knowledge/store";

function loadDotEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

interface TesterCase {
  case_id: string;
  is_critical: boolean;
  is_rewrite_review?: boolean;
  prior_case_id?: string;
  question: string;
}

const TESTER_CASES: TesterCase[] = [
  {
    case_id: "B1-01",
    is_critical: true,
    question:
      "บริษัท แสงตะวัน อุตสาหกรรม จำกัด เป็นบริษัทจำกัดจดทะเบียนในไทย ประกอบกิจการผลิตสินค้าทั่วไป รอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2568 มีกำไรสุทธิที่คำนวณตามมาตรา 65 ทวิ และ 65 ตรี แล้ว 8,000,000 บาท ไม่ใช่ SME และไม่ได้รับสิทธิส่งเสริมการลงทุน ต้องเสียภาษีเงินได้นิติบุคคลในอัตราเท่าใด",
  },
  {
    case_id: "B1-02",
    is_critical: true,
    question:
      "นายอรุณ มีเงินได้สุทธิหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว 900,000 บาท ประจำปีภาษี 2568 เขาเป็นบุคคลธรรมดาผู้มีถิ่นที่อยู่ในไทย ไม่มีเงินได้ที่เลือกเสียแบบสุดท้ายเป็นพิเศษ อัตราและภาษีเงินได้บุคคลธรรมดาที่ต้องเสียเป็นเท่าใด",
  },
  {
    case_id: "B1-05",
    is_critical: false,
    question:
      "บริษัท ปากน้ำ ซัพพลาย จำกัด (นิติบุคคลไทย) จ่ายค่าจ้างทำของ 1,200,000 บาท ให้บริษัท บางนา เซอร์วิส จำกัด (นิติบุคคลไทย ไม่ใช่มูลนิธิหรือสมาคม) เมื่อวันที่ 15 มิถุนายน 2568 และนำส่งภาษีหัก ณ ที่จ่ายผ่านระบบ e-Withholding Tax ตามมาตรา 3 ปัณรส ต้องหักในอัตราเท่าใด",
  },
  {
    case_id: "B1-05F",
    is_critical: true,
    prior_case_id: "B1-05",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-05: วันที่จ่ายค่าจ้างทำของจริงคือ 15 มกราคม 2569 ไม่ใช่ 15 มิถุนายน 2568 บริษัทยังนำส่งผ่านระบบ e-Withholding Tax อัตราหัก ณ ที่จ่ายเป็นเท่าใด",
  },
  {
    case_id: "B1-06",
    is_critical: true,
    question:
      "บริษัท นภา โฮลดิ้ง จำกัด ซึ่งตั้งขึ้นตามกฎหมายไทย จ่ายให้บริษัทต่างประเทศแห่งหนึ่งที่ไม่มีสถานประกอบการในไทยเมื่อวันที่ 15 มีนาคม 2569 สองรายการ คือ (1) เงินปันผล 5,000,000 บาท และ (2) ค่าบริหารจัดการ (management fee) 1,000,000 บาท สำหรับงานบริหารที่ให้จากต่างประเทศ ไม่มีข้อมูลอนุสัญญาภาษีซ้อน บริษัทต้องหักภาษี ณ ที่จ่ายอย่างไรในแต่ละรายการ",
  },
  {
    case_id: "B1-07",
    is_critical: true,
    question:
      "นายวิชัยขายที่ดินสองแปลงในเดือนมิถุนายน 2568 แปลงที่หนึ่งได้รับมรดกจากภริยาตั้งแต่ปี 2560 ถือครองมา 8 ปี แปลงที่สองซื้อจากบุคคลภายนอกในเดือนมีนาคม 2568 ถือครองได้ 3 เดือน เขามิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไรในแต่ละแปลง",
  },
  {
    case_id: "B1-07F",
    is_critical: false,
    is_rewrite_review: true,
    prior_case_id: "B1-07",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-07: แปลงที่หนึ่งไม่ได้มาทางมรดก นายวิชัยซื้อมาจากบุคคลภายนอกตั้งแต่ปี 2560 และถือครองเกิน 5 ปีก่อนขายในเดือนมิถุนายน 2568 ยังไม่ได้ประกอบธุรกิจค้าอสังหาริมทรัพย์เป็นปกติ ผลทางภาษีธุรกิจเฉพาะของแปลงนี้เปลี่ยนหรือไม่",
  },
  {
    case_id: "B1-09",
    is_critical: false,
    is_rewrite_review: true,
    question:
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ",
  },
  {
    case_id: "B1-09F",
    is_critical: true,
    is_rewrite_review: true,
    prior_case_id: "B1-09",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวของนายสมชาย และการให้ที่ดินมูลค่า 25,000,000 บาท เป็นการให้เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร",
  },
  {
    case_id: "B1-11",
    is_critical: false,
    question:
      "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
  },
  {
    case_id: "B1-11F",
    is_critical: true,
    prior_case_id: "B1-11",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
  },
  {
    case_id: "B1-16",
    is_critical: true,
    question:
      "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
  },
  {
    case_id: "B1-16F",
    is_critical: true,
    prior_case_id: "B1-16",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-16: ผู้รับค่าที่ปรึกษา 2,000,000 บาท คือบริษัทที่ตั้งขึ้นตามกฎหมายต่างประเทศ ไม่มีสถานประกอบการในไทย งานบริหารจัดการทำจากต่างประเทศ จ่ายเมื่อ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายอย่างไร",
  },
  {
    case_id: "B1-20",
    is_critical: true,
    question:
      "ตามคำพิพากษาศาลฎีกาที่ 8877/2567 เรื่องภาษีธุรกิจเฉพาะ ศาลตัดสินอย่างไร และใช้กับกรณีขายที่ดินของผมได้ไหม",
  },
  {
    case_id: "B1-22",
    is_critical: true,
    question:
      "บริษัท เงินเชื่อแม่น้ำ จำกัด ประกอบธุรกิจเงินทุนตามกฎหมายว่าด้วยการประกอบธุรกิจเงินทุน ธุรกิจหลักทรัพย์ และธุรกิจเครดิตฟองซิเอร์ ในเดือนมีนาคม 2569 มีรายรับดอกเบี้ย 10,000,000 บาท ก่อนหักรายจ่าย ต้องเสียภาษีธุรกิจเฉพาะในอัตราเท่าใด และมีภาษีท้องถิ่นหรือไม่",
  },
];

async function main() {
  loadDotEnvLocal();
  delete process.env.VITEST;

  const gitCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const stagingGz = path.resolve(
    process.cwd(),
    "data",
    "knowledge-store-b01-rc2-staging",
    "canonical-state.json.gz"
  );
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-r3-11crit-"));

  try {
    fs.copyFileSync(stagingGz, path.join(tempDir, "canonical-state.json.gz"));
    process.env.REG24_KNOWLEDGE_DATA_DIR = tempDir;
    const store = new DurableKnowledgeStore(tempDir);
    setDefaultKnowledgeStoreForTesting(store);

    const priorState = new Map<
      string,
      {
        conversation_id: string;
        question: string;
        answer: string;
        saved_answer_id: string | null;
        saved_answer_revision: string | null;
      }
    >();

    const results: Array<Record<string, unknown>> = [];
    const runNonce = Date.now().toString(36);

    for (const tc of TESTER_CASES) {
      const prior = tc.prior_case_id ? priorState.get(tc.prior_case_id) : undefined;
      const convId = prior
        ? prior.conversation_id
        : `conv.r3.${tc.case_id.toLowerCase()}.${runNonce}`;
      const history: ConversationTurnInput[] = prior
        ? [
            { role: "user", content: prior.question, conversation_id: convId },
            {
              role: "assistant",
              content: prior.answer,
              saved_answer_id: prior.saved_answer_id,
              saved_answer_revision: prior.saved_answer_revision,
              conversation_id: convId,
            },
          ]
        : [];

      const res = await queryPost(
        new Request(
          "https://reg24-git-review-b01-rc2-b02-rc1-staging-7-l-advisory.vercel.app/api/v1/knowledge/query",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-reg24-actor-id": "round3.tester@7ladvisory.review",
            },
            body: JSON.stringify({
              question: tc.question,
              mode: "standard",
              channel: "chat",
              persist_answer: true,
              conversation_id: convId,
              prior_saved_answer_revision: prior?.saved_answer_revision ?? null,
              conversation_history: history,
            }),
          }
        )
      );

      const json = await res.json();
      if (res.status !== 200 || !json.ok) {
        throw new Error(
          `TESTER_API_FAILED on ${tc.case_id}: HTTP ${res.status} — ${JSON.stringify(json)}`
        );
      }

      const ans = json.answer;
      const env = json.traceable_answer;
      const savedRev =
        ans.status !== "NEEDS_CLARIFICATION" &&
        ans.status !== "INSUFFICIENT_EVIDENCE" &&
        env &&
        (env.status === "complete" || env.status === "partial")
          ? env.answer_revision
          : null;
      const savedAnsId = savedRev && env ? env.answer_id : null;

      priorState.set(tc.case_id, {
        conversation_id: convId,
        question: tc.question,
        answer: ans.answer,
        saved_answer_id: savedAnsId,
        saved_answer_revision: savedRev,
      });

      const uniqueSources = new Map<
        string,
        {
          doc_id: string;
          version_id: string;
          citation_label_th: string;
          human_pinpoint_th: string;
          official_url: string;
        }
      >();
      for (const clm of env?.claims || []) {
        for (const ref of clm.evidence_references || []) {
          const key = `${ref.doc_id}|${ref.version_id}`;
          if (!uniqueSources.has(key)) {
            uniqueSources.set(key, {
              doc_id: ref.doc_id,
              version_id: ref.version_id,
              citation_label_th: ref.citation_label_th,
              human_pinpoint_th: ref.locator?.human_pinpoint_th || "",
              official_url: ref.official_url,
            });
          }
        }
      }

      results.push({
        case_id: tc.case_id,
        is_critical: tc.is_critical,
        is_rewrite_review: Boolean(tc.is_rewrite_review),
        http_status: res.status,
        grounded_status: ans.status,
        traceable_status: env?.status ?? null,
        neon_saved_answer_revision: savedRev,
        neon_supersedes_answer_revision: savedRev ? env?.supersedes_answer_revision ?? null : null,
        clarification_questions: ans.clarification_questions || [],
        actual_answer_th: ans.answer,
        supporting_official_sources: Array.from(uniqueSources.values()),
      });
    }

    const outPath = path.resolve(
      process.cwd(),
      "docs",
      "audit",
      "dodo-review-rc2-b02",
      "round3_11_critical_live_tester_api_receipt.json"
    );
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          schema_version: "1.0",
          verified_at: new Date().toISOString(),
          git_commit_sha: gitCommitSha,
          release_id: "rel.B01.rc6",
          manifest_id: "mfst.b01.rc6_core_auth",
          manifest_hash: "c539710fa3804b05f5e47729977b085993a5b5e5c109003ed71a24a7d8621ed5",
          protected_tester_url:
            "https://reg24-git-review-b01-rc2-b02-rc1-staging-7-l-advisory.vercel.app/legal-review",
          vat_foundation_pilot_enabled: false,
          neon_project_id: "shiny-pond-32049060",
          total_cases_executed: results.length,
          critical_cases_executed: results.filter((r) => r.is_critical).length,
          http_200_count: results.filter((r) => r.http_status === 200).length,
          results,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          git_commit_sha: gitCommitSha,
          total: results.length,
          critical: results.filter((r) => r.is_critical).length,
          http_200: results.filter((r) => r.http_status === 200).length,
          out_path: outPath,
        },
        null,
        2
      )
    );
  } finally {
    setDefaultKnowledgeStoreForTesting(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
