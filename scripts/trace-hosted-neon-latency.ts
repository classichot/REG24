/**
 * REG24 — Hosted Neon End-to-End Stage Timing Trace (Before vs After Neon Batching)
 *
 * Traces the exact 11 critical cases through `POST /api/v1/knowledge/query` against real hosted Neon
 * (`shiny-pond-32049060`), counting exact Neon HTTPS SQL round-trips and measuring cold, warm median (p50),
 * warm p95, errors, first-attempt timeouts, and retries for both `persist_answer: true` and `persist_answer: false`.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

const TRACE_CASES: Array<{ case_id: string; prior_case_id?: string; question: string }> = [
  {
    case_id: "B1-01",
    question:
      "บริษัท แสงตะวัน อุตสาหกรรม จำกัด เป็นบริษัทจำกัดจดทะเบียนในไทย ประกอบกิจการผลิตสินค้าทั่วไป รอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2568 มีกำไรสุทธิที่คำนวณตามมาตรา 65 ทวิ และ 65 ตรี แล้ว 8,000,000 บาท ไม่ใช่ SME และไม่ได้รับสิทธิส่งเสริมการลงทุน ต้องเสียภาษีเงินได้นิติบุคคลในอัตราเท่าใด",
  },
  {
    case_id: "B1-02",
    question:
      "นายอรุณ มีเงินได้สุทธิหลังหักค่าใช้จ่ายและค่าลดหย่อนแล้ว 900,000 บาท ประจำปีภาษี 2568 เขาเป็นบุคคลธรรมดาผู้มีถิ่นที่อยู่ในไทย ไม่มีเงินได้ที่เลือกเสียแบบสุดท้ายเป็นพิเศษ อัตราและภาษีเงินได้บุคคลธรรมดาที่ต้องเสียเป็นเท่าใด",
  },
  {
    case_id: "B1-06",
    question:
      "บริษัท นภา โฮลดิ้ง จำกัด ซึ่งตั้งขึ้นตามกฎหมายไทย จ่ายให้บริษัทต่างประเทศแห่งหนึ่งที่ไม่มีสถานประกอบการในไทยเมื่อวันที่ 15 มีนาคม 2569 สองรายการ คือ (1) เงินปันผล 5,000,000 บาท และ (2) ค่าบริหารจัดการ (management fee) 1,000,000 บาท สำหรับงานบริหารที่ให้จากต่างประเทศ ไม่มีข้อมูลอนุสัญญาภาษีซ้อน บริษัทต้องหักภาษี ณ ที่จ่ายอย่างไรในแต่ละรายการ",
  },
  {
    case_id: "B1-07",
    question:
      "นายวิชัยขายที่ดินสองแปลงในเดือนมิถุนายน 2568 แปลงที่หนึ่งได้รับมรดกจากภริยาตั้งแต่ปี 2560 ถือครองมา 8 ปี แปลงที่สองซื้อจากบุคคลภายนอกในเดือนมีนาคม 2568 ถือครองได้ 3 เดือน เขามิได้ประกอบธุรกิจพัฒนาอสังหาริมทรัพย์เป็นปกติ ต้องเสียภาษีธุรกิจเฉพาะหรืออากรแสตมป์อย่างไรในแต่ละแปลง",
  },
  {
    case_id: "B1-09",
    question:
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ",
  },
  {
    case_id: "B1-09F",
    prior_case_id: "B1-09",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวของนายสมชาย และการให้ที่ดินมูลค่า 25,000,000 บาท เป็นการให้เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร",
  },
  {
    case_id: "B1-16",
    question:
      "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
  },
  {
    case_id: "B1-16F",
    prior_case_id: "B1-16",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-16: ผู้รับค่าที่ปรึกษา 2,000,000 บาท คือบริษัทที่ตั้งขึ้นตามกฎหมายต่างประเทศ ไม่มีสถานประกอบการในไทย งานบริหารจัดการทำจากต่างประเทศ จ่ายเมื่อ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายอย่างไร",
  },
  {
    case_id: "B1-20",
    question:
      "ตามคำพิพากษาศาลฎีกาที่ 8877/2567 เรื่องภาษีธุรกิจเฉพาะ ศาลตัดสินอย่างไร และใช้กับกรณีขายที่ดินของผมได้ไหม",
  },
  {
    case_id: "B1-22",
    question:
      "บริษัท เงินเชื่อแม่น้ำ จำกัด ประกอบธุรกิจเงินทุนตามกฎหมายว่าด้วยการประกอบธุรกิจเงินทุน ธุรกิจหลักทรัพย์ และธุรกิจเครดิตฟองซิเอร์ ในเดือนมีนาคม 2569 มีรายรับดอกเบี้ย 10,000,000 บาท ก่อนหักรายจ่าย ต้องเสียภาษีธุรกิจเฉพาะในอัตราเท่าใด และมีภาษีท้องถิ่นหรือไม่",
  },
];

async function main() {
  loadDotEnvLocal();
  delete process.env.VITEST;

  const phaseIdx = process.argv.indexOf("--phase");
  const phase = phaseIdx >= 0 && process.argv[phaseIdx + 1] ? process.argv[phaseIdx + 1] : "before";

  // Instrument global fetch to count & time Neon HTTPS SQL round-trips accurately without altering requests!
  let neonSqlCalls = 0;
  let neonSqlTotalMs = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes(".neon.tech/sql")) {
      const t0 = performance.now();
      try {
        return await origFetch(input, init);
      } finally {
        neonSqlCalls++;
        neonSqlTotalMs += performance.now() - t0;
      }
    }
    return origFetch(input, init);
  }) as typeof fetch;

  const gitCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const stagingGz = path.resolve(
    process.cwd(),
    "data",
    "knowledge-store-b01-rc2-staging",
    "canonical-state.json.gz"
  );
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `reg24-hosted-trace-${phase}-`));

  try {
    fs.copyFileSync(stagingGz, path.join(tempDir, "canonical-state.json.gz"));
    process.env.REG24_KNOWLEDGE_DATA_DIR = tempDir;
    const store = new DurableKnowledgeStore(tempDir);
    setDefaultKnowledgeStoreForTesting(store);

    const runNonce = Date.now().toString(36);
    const priorMap = new Map<
      string,
      { convId: string; q: string; a: string; savedId: string | null; savedRev: string | null }
    >();

    const perCase: Array<Record<string, unknown>> = [];
    let errors = 0;
    let firstAttemptTimeouts = 0;
    const timeoutMs = 45_000;

    // Cold first request (B1-01, persist_answer: true)
    neonSqlCalls = 0;
    neonSqlTotalMs = 0;
    const coldT0 = performance.now();
    const coldRes = await queryPost(
      new Request(
        "https://reg24-git-review-b01-rc2-b02-rc1-staging-7-l-advisory.vercel.app/api/v1/knowledge/query",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reg24-actor-id": `hosted.trace.${phase}@7ladvisory.review`,
          },
          body: JSON.stringify({
            question: TRACE_CASES[0].question,
            mode: "standard",
            channel: "chat",
            persist_answer: true,
            conversation_id: `conv.cold.${phase}.${runNonce}`,
            conversation_history: [],
          }),
        }
      )
    );
    const coldMs = Math.round((performance.now() - coldT0) * 100) / 100;
    const coldNeonCalls = neonSqlCalls;
    const coldNeonMs = Math.round(neonSqlTotalMs * 100) / 100;
    if (coldRes.status !== 200) errors++;
    if (coldMs > timeoutMs) firstAttemptTimeouts++;

    // Warm sweep across all 10 cases with `persist_answer: true` (exact `/legal-review` path)
    for (const tc of TRACE_CASES) {
      const prior = tc.prior_case_id ? priorMap.get(tc.prior_case_id) : undefined;
      const convId = prior
        ? prior.convId
        : `conv.warm.${phase}.${tc.case_id.toLowerCase()}.${runNonce}`;
      const history: ConversationTurnInput[] = prior
        ? [
            { role: "user", content: prior.q, conversation_id: convId },
            {
              role: "assistant",
              content: prior.a,
              saved_answer_id: prior.savedId,
              saved_answer_revision: prior.savedRev,
              conversation_id: convId,
            },
          ]
        : [];

      neonSqlCalls = 0;
      neonSqlTotalMs = 0;
      const t0 = performance.now();
      const res = await queryPost(
        new Request(
          "https://reg24-git-review-b01-rc2-b02-rc1-staging-7-l-advisory.vercel.app/api/v1/knowledge/query",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-reg24-actor-id": `hosted.trace.${phase}@7ladvisory.review`,
            },
            body: JSON.stringify({
              question: tc.question,
              mode: "standard",
              channel: "chat",
              persist_answer: true,
              conversation_id: convId,
              prior_saved_answer_revision: prior?.savedRev ?? null,
              conversation_history: history,
            }),
          }
        )
      );
      const totalMs = Math.round((performance.now() - t0) * 100) / 100;
      const json = await res.json();
      if (res.status !== 200 || !json.ok) errors++;
      if (totalMs > timeoutMs) firstAttemptTimeouts++;

      const env = json.traceable_answer;
      const ans = json.answer;
      const savedRev =
        ans &&
        ans.status !== "NEEDS_CLARIFICATION" &&
        ans.status !== "INSUFFICIENT_EVIDENCE" &&
        env &&
        (env.status === "complete" || env.status === "partial")
          ? env.answer_revision
          : null;
      priorMap.set(tc.case_id, {
        convId,
        q: tc.question,
        a: ans?.answer || "",
        savedId: savedRev && env ? env.answer_id : null,
        savedRev,
      });

      perCase.push({
        case_id: tc.case_id,
        http_status: res.status,
        total_ms: totalMs,
        neon_sql_roundtrips: neonSqlCalls,
        neon_sql_total_ms: Math.round(neonSqlTotalMs * 100) / 100,
        compute_ms: Math.round((totalMs - neonSqlTotalMs) * 100) / 100,
        saved_revision: savedRev,
      });
    }

    const sortedWarm = perCase.map((c) => Number(c.total_ms)).sort((a, b) => a - b);
    const totalRoundtrips = perCase.reduce((s, c) => s + Number(c.neon_sql_roundtrips), 0);
    const totalNeonMs = Math.round(
      perCase.reduce((s, c) => s + Number(c.neon_sql_total_ms), 0) * 100
    ) / 100;

    const receipt = {
      schema_version: "1.0",
      phase,
      measured_at: new Date().toISOString(),
      git_commit_sha: gitCommitSha,
      neon_project_id: "shiny-pond-32049060",
      persist_answer: true,
      cold_first_request_ms: coldMs,
      cold_neon_sql_roundtrips: coldNeonCalls,
      cold_neon_sql_ms: coldNeonMs,
      warm_median_p50_ms: percentile(sortedWarm, 50),
      warm_p95_ms: percentile(sortedWarm, 95),
      warm_max_ms: sortedWarm[sortedWarm.length - 1] ?? 0,
      warm_total_neon_sql_roundtrips: totalRoundtrips,
      warm_total_neon_sql_ms: totalNeonMs,
      errors,
      first_attempt_timeouts: firstAttemptTimeouts,
      retries: 0,
      timeout_threshold_ms: timeoutMs,
      per_case: perCase,
    };

    const outPath = path.resolve(
      process.cwd(),
      "docs",
      "audit",
      "dodo-review-rc2-b02",
      `round3_hosted_neon_trace_${phase}.json`
    );
    fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    console.log(
      JSON.stringify(
        {
          phase,
          git_commit_sha: gitCommitSha,
          cold_first_request_ms: coldMs,
          cold_neon_sql_roundtrips: coldNeonCalls,
          warm_median_p50_ms: receipt.warm_median_p50_ms,
          warm_p95_ms: receipt.warm_p95_ms,
          warm_total_neon_sql_roundtrips: totalRoundtrips,
          warm_total_neon_sql_ms: totalNeonMs,
          errors,
          first_attempt_timeouts: firstAttemptTimeouts,
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = origFetch;
    setDefaultKnowledgeStoreForTesting(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
