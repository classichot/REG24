/**
 * REG24 — Standalone Single-Engine Tokenizer Parity Verification Script
 *
 * Verifies on the current OS/Node/ICU runtime (Windows local OR Linux CI/Vercel build)
 * that index tokens, live BM25 query tokens, and on-disk posting keys match 100% under
 * the single pinned tokenizer contract (`ts_legal_dict_intl_v1.0+reg24-th-legal-dict-v1.0`).
 */

import * as path from "node:path";
import { DurableKnowledgeStore } from "../src/core/knowledge/store";
import { runTokenizerParityProbe } from "../src/core/knowledge/projections";

const storeDir = path.resolve(process.cwd(), "data/knowledge-store-b01-rc2-staging");
const releaseId = process.argv[2] || "rel.B01.rc7";

const store = new DurableKnowledgeStore(storeDir);
const report = runTokenizerParityProbe(store, releaseId);
console.log(JSON.stringify(report, null, 2));

if (!report.contract_parity_ok || !report.all_probes_ok) {
  console.error("FAIL: Tokenizer parity probe failed!");
  process.exit(1);
}
