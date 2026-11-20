# Original `6e4fde1` Test & Retrieval Replay Evidence Bundle (`PROVISIONAL` / Preserved Unchanged)

> **Governance Status**: This folder preserves the **exact original test logs and unchanged JSON output** from commit **`6e4fde13253ca66c3e46f9ca56005776dc9011f1`** (permanently pinned via git tag `archive/b01-rc10-6e4fde1`), release `rel.B01.rc7`.
> - Treat `34/34` strictly as **engineering-reported regression coverage** (NOT Batch 1 acceptance and NOT proof of live Neon PostgreSQL atomicity).
> - Treat `21/21` strictly as a **reported retrieval score under the original `6e4fde1` grader** (which used `work_id`-level checks, a label-seeded 359/390-passage challenger pool, mixed-engine PyThaiNLP-index/TS-query tokenization, and a reconstructed packet from `b3.top_hits`).

---

## 1. Exact Build, Manifest, Projection, Case-Set & Runtime Provenance (`6e4fde1`)

| Provenance Field | Exact Value at `6e4fde1` |
|---|---|
| **Git Commit SHA** | `6e4fde13253ca66c3e46f9ca56005776dc9011f1` (preserved tag: `archive/b01-rc10-6e4fde1`) |
| **Release ID / Manifest ID** | `rel.B01.rc7` · `mfst.b01.rc7_thai_legal_index` |
| **Full Manifest SHA-256** | `870b5912da03acd62b3aadfde856a79471398ba8c799c5fa1065472eb21274fe` |
| **RC7 Lexical Projection (`rel.B01.rc7_lexical.json.gz`)** | `6,898,663` bytes · SHA-256 `ec59319f58c599c3f6e71e911c6a7824ae527831583ea01881ec0c206e3e9dd3` |
| **RC7 Graph Projection (`rel.B01.rc7_graph.json.gz`)** | `735,738` bytes · SHA-256 `a1bfa89e6d2e8b22752bf965d0b8adf88d342e0cef338e6f16212f21d243d916` |
| **RC7 Vector Projection (`rel.B01.rc7_vector.json`)** | `473` bytes (`deliberately_disabled`) · SHA-256 `b309c019db2585b3d6389238fd5b9ee29bd2ee66fbaaaff1b785a0cb433a7db3` |
| **RC6 Rollback Projections (`lexical` / `graph` / `vector`)** | `1972158ed13a...` (`6,895,690` B) · `35111bd185dc...` (`735,437` B) · `cb8789b970c6...` (`466` B) |
| **Original Replay Script (`scripts/run-rc7-retrieval-replay-and-ablation.ts`)** | `41,932` bytes · SHA-256 `7f16585109feac1c528b11ac92da0e167d1e8830b7bc74de9ff5bbe099da0834` |
| **Extracted Case-Set JSON (`original_6e4fde1_case_definitions.json`)** | SHA-256 `8d014bf6e6910a27396837cf0a7fdb933df5413dc32c01fcd1c06fa91d5fb8cd` |
| **Unchanged Original Replay JSON (`rc7_retrieval_ablation_and_replay.json`)** | `280,564` bytes · SHA-256 `22db2038c6145f61b2c5ac436f683328c9a2c355a52a588e44ab7f5ec5d55eb3` |
| **Runtime Versions** | Node `v24.17.0` (`win32/x64`), Vitest `2.1.9`, TypeScript `5.9.3`, Python `3.12.10`, `pythainlp 5.4.0`, `openthai2-0-latte-wordseg-lite 0.1.2`, `onnxruntime 1.32.0`, `BAAI/bge-m3` ONNX |
| **Cache Reused During Original `21/21` Run** | **`REUSE_PY_OUT=1`** reused prior scratch output `_rc7_ablation_slice_out.json` (containing 390-passage LATTE + BGE-M3 embeddings computed earlier in the same session, which differed in passage count from the 359-passage re-export and lacked hash validation). |

---

## 2. Original `34/34` Regression Coverage Evidence

- **Exact Command**:
  ```bash
  npx vitest run tests/knowledge/official-citations-and-claim-traceability-t01-t13.test.ts tests/knowledge/rc7-thai-legal-index-and-retrieval-gates.test.ts tests/knowledge/gate1-generalized-remediation.test.ts tests/knowledge/gemini4-neon-and-claim-calc-isolation.test.ts tests/knowledge/grounded-llm-architecture.test.ts tests/knowledge/dodo-query-persist-revision-chain.test.ts
  ```
- **Exit Code**: `0` · **Duration**: `80.05s` · **Retries**: `0` · **Skips**: `0` · **Quarantined**: `0`
- **Raw Unmodified Runner Log**: [`original_6e4fde1_vitest_34of34_raw.log`](./original_6e4fde1_vitest_34of34_raw.log) (SHA-256 `034d68e2ba2afc2261c3d4c25ba84e0cd5db6bbab593782cbc7712c2fe4620dd`, captured `2026-11-20T19:43:10Z`)
- **Separate Typecheck (`npx tsc --noEmit`)**: Executed twice at `6e4fde1` (`2026-11-20T19:39:11Z` standalone and chained after replay at `2026-11-20T19:43:43Z` in [`original_6e4fde1_replay_and_tsc_raw.log`](./original_6e4fde1_replay_and_tsc_raw.log)): **Exit code `0`, empty stdout/stderr (`0` TypeScript errors)**.

### Per-Suite Counts & Fixture/Mock vs. Real-Service Classification

| # | Exact Test File Path | Passed / Total | Retries / Skips / Quarantined | Fixtures / Mocks vs. Real Services |
|---|---|---|---|---|
| 1 | `tests/knowledge/grounded-llm-architecture.test.ts` | `4 / 4` | `0 / 0 / 0` | **Local corpus store + deterministic/mock LLM draft fixtures**. Does NOT call live Gemini API or live Neon PostgreSQL. |
| 2 | `tests/knowledge/rc7-thai-legal-index-and-retrieval-gates.test.ts` | `4 / 4` | `0 / 0 / 0` | Tests 1–3 use **real on-disk `data/knowledge-store-b01-rc2-staging`** (real archived Gazette PDFs + projections) + temp dir for stale-manifest tests. **Test 4 (`transactional save isolation`) uses an in-memory mock transport (`setCustomCitationDbTransportForTesting`) and is NOT proof of live Neon PostgreSQL atomicity.** |
| 3 | `tests/knowledge/gemini4-neon-and-claim-calc-isolation.test.ts` | `4 / 4` | `0 / 0 / 0` | **Local corpus store + injected synthetic draft/calculation fixtures** (verifies verifier/store isolation locally). Does NOT call live Gemini 4 Neon or live Neon PostgreSQL. |
| 4 | `tests/knowledge/dodo-query-persist-revision-chain.test.ts` | `3 / 3` | `0 / 0 / 0` | **Local temp copy of staging store + in-memory PostgreSQL FK mock transport**. Does NOT connect to live Neon PostgreSQL. |
| 5 | `tests/knowledge/gate1-generalized-remediation.test.ts` | `5 / 5` | `0 / 0 / 0` | **Real on-disk staging corpus store + deterministic baseline / QA synthetic fixtures**. Does NOT call live Gemini API or live Neon PostgreSQL. |
| 6 | `tests/knowledge/official-citations-and-claim-traceability-t01-t13.test.ts` | `14 / 14` | `0 / 0 / 0` | Tests T01–T13 use **synthetic temp-dir canonical stores**; Section 10 Owner's Demo copies **real on-disk `data/knowledge-store-b01-rc2-staging`** into a temp dir. Does NOT call live Gemini API or live Neon PostgreSQL. |
| **Total** | **6 files** | **`34 / 34`** | **`0 / 0 / 0`** | **0 live network calls (no live Gemini API, no live Neon PostgreSQL, no live Vercel preview).** |

---

## 3. Original `21/21` Retrieval Replay Evidence (`PROVISIONAL` / Original Grader)

- **Exact Command**:
  ```powershell
  $env:REUSE_PY_OUT="1"; npx tsx scripts/run-rc7-retrieval-replay-and-ablation.ts; npx tsc --noEmit
  ```
- **Exit Code**: `0`
- **Raw Unmodified Runner Log**: [`original_6e4fde1_replay_and_tsc_raw.log`](./original_6e4fde1_replay_and_tsc_raw.log) (SHA-256 `8129b13cdd4679cec38f57eafb436ccb8a750a960f2485c4fe9cdd9a09938bd2`, captured `2026-11-20T19:43:38Z`)
- **Unchanged Original JSON Output**: [`rc7_retrieval_ablation_and_replay.json`](./rc7_retrieval_ablation_and_replay.json) (SHA-256 `22db2038c6145f61b2c5ac436f683328c9a2c355a52a588e44ab7f5ec5d55eb3`)
- **Case Definitions & Expected Labels**: [`original_6e4fde1_case_definitions.json`](./original_6e4fde1_case_definitions.json)

### Per-Method Breakdown (Distinguishing Ranked-Retrieval Score vs. Reconstructed Packet Score)

| Measurement | Method / Stage | Reported Sealed Score (`21` cases) | Reported NitiBench-Tax (`25` cases) | Notes / Caveats Identified in Audit |
|---|---|---|---|---|
| **Ranked Retrieval Top-5** | `M1_BASE_PYTHAINLP` | **`21/21 (100.0%)`** (`p95 = 184.10 ms`) | `3/25 (12.0%)` (`Any@5: 5/25`) | Mixed-engine build (PyThaiNLP index + TS live BM25 lookup); `work_id`-level original grader. |
| **Ranked Retrieval Top-5** | `M1_CHALLENGER_LATTE` | `19/21 (90.5%)` (`p95 = 31.55 ms`) | `3/25 (12.0%)` | Evaluated on label-seeded challenger pool (`REUSE_PY_OUT=1`); diagnostic only. |
| **Ranked Retrieval Top-5** | `M2_BASE_PLUS_BGEM3` | **`21/21 (100.0%)`** (`p95 = 537.87 ms`) | `3/25 (12.0%)` | Evaluated on label-seeded challenger pool (`REUSE_PY_OUT=1`); diagnostic only. |
| **Ranked Retrieval Top-5** | `M3_BASE_PLUS_GRAPH` | **`21/21 (100.0%)`** (`p95 = 195.08 ms`) | `3/25 (12.0%)` | Mixed-engine build + verified graph links; `work_id`-level original grader. |
| **Ranked Retrieval Top-5** | `M4_BASE_PLUS_BOTH` | `20/21 (95.2%)` (`p95 = 548.85 ms`) | `3/25 (12.0%)` | Evaluated on label-seeded challenger pool (`REUSE_PY_OUT=1`); diagnostic only. |
| **Reconstructed Packet** *(NOT real `query.ts` app assembly)* | `buildGroundedPassagePack(b3.top_hits)` | **`21/21 (100.0%)`** | `3/25 (12.0%)` | Built directly from `b3.top_hits` inside the replay script rather than capturing the live packet assembled inside `queryKnowledge()`. |
