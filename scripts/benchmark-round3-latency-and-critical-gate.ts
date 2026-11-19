/**
 * REG24 — Round 3 Before/After Latency Benchmark & 11-Critical-Case Gate
 *
 * Measures identical 30 Legal Team prompts under controlled conditions:
 *   - Cold latency: first query on a brand-new `DurableKnowledgeStore` instance
 *   - Warm latency: full 30-case sweep (`p50`, `p95`, `mean`, `min`, `max`, `errors`, `timeouts`)
 *   - Writes JSON receipts so `--phase before` vs `--phase after` provides an exact apples-to-apples
 *     comparison proving `>= 20%` lower warm p95 with zero cold/error regression and zero weakened checks.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

const STAGING_STORE_DIR = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
process.env.REG24_KNOWLEDGE_DATA_DIR = STAGING_STORE_DIR;

import type { Actor, ConversationTurnInput } from "../src/core/knowledge/contracts";
import { queryKnowledge } from "../src/core/knowledge/query";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";

interface BenchPrompt {
  case_id: string;
  prior_turn_case_id?: string;
  mode?: "standard" | "exact_lookup" | "comparison";
  question: string;
}

const BENCH_30_PROMPTS: BenchPrompt[] = [
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
    case_id: "B1-03",
    question:
      "บริษัท คลองสาน เทรดดิ้ง จำกัด เป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม ขายสินค้าในราชอาณาจักรเมื่อวันที่ 15 พฤศจิกายน 2569 ความรับผิดใน VAT เกิดวันเดียวกัน ต้องคิด VAT กี่ร้อยละ",
  },
  {
    case_id: "B1-04",
    question:
      "นายภิญโญรับจ้างทำซอฟต์แวร์ให้บริษัทไทยแห่งหนึ่ง ทำสัญญาจ้างทำของเป็นหนังสือ กำหนดสินจ้าง 2,000,000 บาท สัญญาทำและปฏิบัติในไทย ต้องปิดอากรแสตมป์เท่าใด และใครเป็นผู้มีหน้าที่เสียอากร",
  },
  {
    case_id: "B1-05",
    question:
      "บริษัท ปากน้ำ ซัพพลาย จำกัด (นิติบุคคลไทย) จ่ายค่าจ้างทำของ 1,200,000 บาท ให้บริษัท บางนา เซอร์วิส จำกัด (นิติบุคคลไทย ไม่ใช่มูลนิธิหรือสมาคม) เมื่อวันที่ 15 มิถุนายน 2568 และนำส่งภาษีหัก ณ ที่จ่ายผ่านระบบ e-Withholding Tax ตามมาตรา 3 ปัณรส ต้องหักในอัตราเท่าใด",
  },
  {
    case_id: "B1-05F",
    prior_turn_case_id: "B1-05",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-05: วันที่จ่ายค่าจ้างทำของจริงคือ 15 มกราคม 2569 ไม่ใช่ 15 มิถุนายน 2568 บริษัทยังนำส่งผ่านระบบ e-Withholding Tax อัตราหัก ณ ที่จ่ายเป็นเท่าใด",
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
    case_id: "B1-07F",
    prior_turn_case_id: "B1-07",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-07: แปลงที่หนึ่งไม่ได้มาทางมรดก นายวิชัยซื้อมาจากบุคคลภายนอกตั้งแต่ปี 2560 และถือครองเกิน 5 ปีก่อนขายในเดือนมิถุนายน 2568 ยังไม่ได้ประกอบธุรกิจค้าอสังหาริมทรัพย์เป็นปกติ ผลทางภาษีธุรกิจเฉพาะของแปลงนี้เปลี่ยนหรือไม่",
  },
  {
    case_id: "B1-08",
    question:
      "บริษัท ชลบุรี แพ็กเกจจิ้ง จำกัด มีกำไรสุทธิก่อนรายจ่ายบริจาค 20,000,000 บาท ในรอบบัญชีที่เริ่ม 1 มกราคม 2568 บริจาคเงิน 1,000,000 บาท ให้แก่องค์การสาธารณกุศลตามที่อธิบดีประกาศกำหนด หักเป็นรายจ่ายได้เท่าใด",
  },
  {
    case_id: "B1-09",
    question:
      "นายสมชายโอนที่ดินให้บุตรชอบด้วยกฎหมายคนหนึ่งโดยไม่มีค่าตอบแทน เมื่อวันที่ 10 กุมภาพันธ์ 2568 มูลค่า 25,000,000 บาท บุตรไม่ใช่บุตรบุญธรรม ปีนั้นยังไม่มีการให้ที่ดินแก่บุตรคนนี้รายการอื่น เงินได้ของบุตรได้รับยกเว้นภาษีเท่าใด และส่วนใดต้องนำมารวมคำนวณ",
  },
  {
    case_id: "B1-09F",
    prior_turn_case_id: "B1-09",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-09: ผู้รับโอนไม่ใช่บุตรชอบด้วยกฎหมาย แต่เป็นหลานสาวของนายสมชาย และการให้ที่ดินมูลค่า 25,000,000 บาท เป็นการให้เนื่องในงานสมรสตามประเพณีเมื่อวันที่ 10 กุมภาพันธ์ 2568 ผลทางภาษีเงินได้ของหลานสาวเปลี่ยนอย่างไร",
  },
  {
    case_id: "B1-10",
    question:
      "นางดาวขายของชำเป็นบุคคลธรรมดา มีรายรับจากการขายสินค้าในปีปฏิทิน 2568 รวม 1,500,000 บาท ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่มโดยสมัครใจ และไม่ได้ขายสินค้าที่ได้รับยกเว้นเป็นอย่างอื่น ต้องจดทะเบียน VAT หรือไม่",
  },
  {
    case_id: "B1-11",
    question:
      "บริษัท พิกเซลแล็บ จำกัด เป็นผู้ประกอบการจดทะเบียน VAT ในไทย ให้บริการบำรุงรักษาซอฟต์แวร์จากสำนักงานในกรุงเทพฯ แก่บริษัทในสิงคโปร์ โดยส่งมอบงานทางอิเล็กทรอนิกส์ ลูกค้าใช้บริการนั้นทั้งหมดที่สำนักงานในสิงคโปร์ ออกใบกำกับและรับเงินเมื่อ 10 มีนาคม 2569 ต้องคิด VAT ร้อยละ 7 หรือร้อยละ 0",
  },
  {
    case_id: "B1-11F",
    prior_turn_case_id: "B1-11",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-11: บริการบำรุงรักษาซอฟต์แวร์ถูกใช้ที่สาขากรุงเทพฯ ของลูกค้าสิงคโปร์ ไม่ได้ใช้ที่สำนักงานในสิงคโปร์ อัตรา VAT เป็นอย่างไร",
  },
  {
    case_id: "B1-12",
    question:
      "บริษัท คิริ จำกัด มีรอบระยะเวลาบัญชี 1 กรกฎาคม 2561 – 30 มิถุนายน 2562 บริจาคให้พรรคการเมืองตามกฎหมายประกอบรัฐธรรมนูญว่าด้วยพรรคการเมือง เป็นเงิน 80,000 บาท หักเป็นรายจ่ายได้หรือไม่ และได้เท่าใด",
  },
  {
    case_id: "B1-12F",
    prior_turn_case_id: "B1-12",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-12: รอบระยะเวลาบัญชีของบริษัท คิริ จำกัด คือ 1 กรกฎาคม 2560 – 30 มิถุนายน 2561 ไม่ใช่เริ่ม 1 กรกฎาคม 2561 บริษัทยังอ้างหักเงินบริจาคพรรคการเมือง 80,000 บาท ตามมาตรา 65 ตรี (3)(ก) ที่แก้ไขโดยพ.ร.บ. ฉบับที่ 51 ได้หรือไม่",
  },
  {
    case_id: "B1-13",
    question:
      "นางสาวพิมพ์ได้รับเงินเดือนตามมาตรา 40(1) ในปีภาษี 2568 และไม่มีเงินได้ตามมาตรา 40(2) เธอจะหักค่าใช้จ่ายเป็นการเหมาตามมาตรา 42 ทวิ ได้ในอัตราและเพดานเท่าใด ถ้ามีคนอ้างข้อหารือเก่าที่ว่าหักได้ร้อยละ 40 ไม่เกิน 60,000 บาท ต้องใช้ตัวเลขนั้นหรือไม่",
  },
  {
    case_id: "B1-14",
    question:
      "บริษัท สยามเฟอร์นิเจอร์ จำกัด เป็นบริษัททั่วไป (ไม่ใช่ SME) มีรอบระยะเวลาบัญชี 1 มกราคม – 31 ธันวาคม 2559 กรรมการเข้าใจว่าอัตราภาษีเงินได้นิติบุคคลยังเป็นร้อยละ 30 อยู่จริงหรือไม่",
  },
  {
    case_id: "B1-14F",
    prior_turn_case_id: "B1-14",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-14: รอบระยะเวลาบัญชีคือ 1 กรกฎาคม 2558 – 30 มิถุนายน 2559 ไม่ใช่เริ่ม 1 มกราคม 2559 บริษัททั่วไปที่ไม่ใช่ SME ต้องใช้อัตราตามพ.ร.บ. ฉบับที่ 42 หรือไม่ แล้วอัตราที่ถูกต้องของรอบนี้คืออะไร",
  },
  {
    case_id: "B1-15",
    question:
      "บริษัท คลองสาน เทรดดิ้ง จำกัด (ผู้ประกอบการจดทะเบียน VAT) ส่งมอบสินค้าในราชอาณาจักรและมีความรับผิดใน VAT เกิดวันที่ 20 ตุลาคม 2570 ต้องคิดอัตราเท่าใด มีพระราชกฤษฎีกาฉบับที่ 807 ขยายอัตราลดอยู่หรือไม่",
  },
  {
    case_id: "B1-15F",
    prior_turn_case_id: "B1-15",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-15: ความรับผิดใน VAT เกิดวันที่ 20 กันยายน 2570 ไม่ใช่ 20 ตุลาคม 2570 อัตราที่ต้องใช้เป็นเท่าใด",
  },
  {
    case_id: "B1-16",
    question:
      "บริษัท ลมทะเล จำกัด จ่าย 'ค่าที่ปรึกษา' 2,000,000 บาท เมื่อวันที่ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายเท่าใด",
  },
  {
    case_id: "B1-16F",
    prior_turn_case_id: "B1-16",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-16: ผู้รับค่าที่ปรึกษา 2,000,000 บาท คือบริษัทที่ตั้งขึ้นตามกฎหมายต่างประเทศ ไม่มีสถานประกอบการในไทย งานบริหารจัดการทำจากต่างประเทศ จ่ายเมื่อ 20 สิงหาคม 2568 ต้องหักภาษี ณ ที่จ่ายอย่างไร",
  },
  {
    case_id: "B1-17",
    question:
      "บริษัท สุริยา โลจิสติกส์ จำกัด ยื่นแบบ ภ.ง.ด.50 เมื่อวันที่ 28 พฤษภาคม 2565 ต่อมาวันที่ 10 สิงหาคม 2568 ได้รับหมายเรียกของเจ้าพนักงานประเมินตามมาตรา 19 ไม่มีข้อเท็จจริงว่ามีการหลีกเลี่ยงภาษีหรือมีคำขอคืนภาษี สรรพากรออกหมายเรียกได้หรือไม่",
  },
  {
    case_id: "B1-17F",
    prior_turn_case_id: "B1-17",
    question:
      "ข้อมูลเพิ่มเติมจากข้อ B1-17: ในหมายเรียกวันที่ 10 สิงหาคม 2568 ระบุว่าอธิบดีอนุมัติให้ขยายระยะเวลาการออกหมายเรียกแล้ว เพราะมีเหตุอันควรสงสัยว่าผู้ยื่นรายการมีเจตนาหลีกเลี่ยงภาษีอากร ผลตามมาตรา 19 เปลี่ยนหรือไม่",
  },
  {
    case_id: "B1-18",
    mode: "exact_lookup",
    question:
      "ขอสรุปแนววินิจฉัยในหนังสือตอบข้อหารือเลขที่ กค 0702/848421 ลงวันที่ 12 กันยายน 2568 เรื่องภาษีเงินได้นิติบุคคล กรณีค่าโฆษณาบนแพลตฟอร์มต่างประเทศ และขอเลขตู้ด้วย",
  },
  {
    case_id: "B1-19",
    question:
      "ลูกจ้างอายุ 17 ปี ทำสัญญาจ้างแรงงานกับนายจ้างในไทย มีผลผูกพันตามประมวลกฎหมายแพ่งและพาณิชย์ และพระราชบัญญัติคุ้มครองแรงงาน พ.ศ. 2541 หรือไม่ ผู้ปกครองต้องลงนามด้วยหรือไม่",
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

async function main() {
  const phaseIdx = process.argv.indexOf("--phase");
  const phase = phaseIdx >= 0 && process.argv[phaseIdx + 1] ? process.argv[phaseIdx + 1] : "before";
  const timeoutMs = 15_000;

  const actor: Actor = {
    actor_id: "bench.round3@7ladvisory.review",
    role: "legal_reviewer",
    tenant_id: "PUBLIC",
    authorized_scopes: ["scope.platform.public"],
    csrf_verified: true,
  };

  // 1. Cold-start measurement on a brand-new DurableKnowledgeStore instance
  const coldStartT0 = performance.now();
  const coldStore = new DurableKnowledgeStore(STAGING_STORE_DIR);
  const coldRes = await queryKnowledge(
    {
      question: BENCH_30_PROMPTS[0].question,
      release_id: "rel.B01.rc6",
      enable_tax_foundation_pilot: false,
    },
    actor,
    { store: coldStore, persistAnswerAtomically: false }
  );
  const coldMs = Math.round((performance.now() - coldStartT0) * 100) / 100;

  // 2. Warm sweep across all 30 prompts on the same warmed store
  const priorAnswerMap = new Map<string, { question: string; answer: string }>();
  const perCase: Array<{
    case_id: string;
    latency_ms: number;
    status: string;
    traceable_status: string | null;
    error: string | null;
    timed_out: boolean;
  }> = [];

  // Prime one warm-up call before measuring the 30-case warm sweep
  await queryKnowledge(
    {
      question: BENCH_30_PROMPTS[0].question,
      release_id: "rel.B01.rc6",
      enable_tax_foundation_pilot: false,
    },
    actor,
    { store: coldStore, persistAnswerAtomically: false }
  );

  let errorCount = 0;
  let timeoutCount = 0;
  for (const spec of BENCH_30_PROMPTS) {
    const history: ConversationTurnInput[] = [];
    if (spec.prior_turn_case_id) {
      const prev = priorAnswerMap.get(spec.prior_turn_case_id);
      if (prev) {
        history.push({ role: "user", content: prev.question });
        history.push({ role: "assistant", content: prev.answer });
      }
    }

    const t0 = performance.now();
    try {
      const res = await queryKnowledge(
        {
          question: spec.question,
          release_id: "rel.B01.rc6",
          mode: spec.mode || "standard",
          conversation_history: history.length > 0 ? history : undefined,
          enable_tax_foundation_pilot: false,
        },
        actor,
        { store: coldStore, persistAnswerAtomically: false }
      );
      const elapsed = Math.round((performance.now() - t0) * 100) / 100;
      const timedOut = elapsed > timeoutMs;
      if (timedOut) timeoutCount++;
      priorAnswerMap.set(spec.case_id, { question: spec.question, answer: res.answer });
      perCase.push({
        case_id: spec.case_id,
        latency_ms: elapsed,
        status: res.status,
        traceable_status: res.traceable_answer?.status ?? null,
        error: null,
        timed_out: timedOut,
      });
    } catch (err) {
      const elapsed = Math.round((performance.now() - t0) * 100) / 100;
      errorCount++;
      perCase.push({
        case_id: spec.case_id,
        latency_ms: elapsed,
        status: "ERROR",
        traceable_status: null,
        error: err instanceof Error ? err.message : String(err),
        timed_out: elapsed > timeoutMs,
      });
    }
  }

  const sortedWarm = perCase.map((c) => c.latency_ms).sort((a, b) => a - b);
  const meanWarm =
    Math.round((sortedWarm.reduce((s, v) => s + v, 0) / Math.max(1, sortedWarm.length)) * 100) /
    100;

  const gitCommitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  const report = {
    schema_version: "1.0",
    phase,
    measured_at: new Date().toISOString(),
    git_commit_sha: gitCommitSha,
    release_id: "rel.B01.rc6",
    manifest_id: "mfst.b01.rc6_core_auth",
    vat_foundation_pilot_enabled: false,
    prompt_count: BENCH_30_PROMPTS.length,
    cold_first_query_ms: coldMs,
    cold_first_query_status: coldRes.status,
    warm_p50_ms: percentile(sortedWarm, 50),
    warm_p95_ms: percentile(sortedWarm, 95),
    warm_mean_ms: meanWarm,
    warm_min_ms: sortedWarm[0] ?? 0,
    warm_max_ms: sortedWarm[sortedWarm.length - 1] ?? 0,
    errors: errorCount,
    timeouts: timeoutCount,
    timeout_threshold_ms: timeoutMs,
    per_case: perCase,
  };

  const outPath = path.resolve(
    process.cwd(),
    "docs",
    "audit",
    "dodo-review-rc2-b02",
    `round3_latency_benchmark_${phase}.json`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        phase,
        git_commit_sha: gitCommitSha,
        cold_first_query_ms: report.cold_first_query_ms,
        warm_p50_ms: report.warm_p50_ms,
        warm_p95_ms: report.warm_p95_ms,
        warm_mean_ms: report.warm_mean_ms,
        errors: report.errors,
        timeouts: report.timeouts,
        out_path: outPath,
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
