# REG24 Phase-Zero Repository Audit & Implementation Plan (`REG-001`)

- **Specification**: REG24 — Thai Legal OCR, Verification and Source-Linked Publication (`v2.0 · Astra rewrite · 13 November 2026`)
- **Audit Date**: 14 November 2026
- **Inspected Repository**: `d:/Code/REG24` (Next.js `16.4.2`, React `19.0.0`, TypeScript `5.7.2`, `neo4j-driver` `6.2.0`, Vitest `2.1.8`)

---

## 1. Inspected Repository Entry Points & Discoverability Paths

Every path in `REG24` that currently ingests, chunks, indexes, writes graph edges, or exposes searchable legal content was inspected:

| Subsystem | Actual Repository File Path | Current Behavior & Owner |
|---|---|---|
| **v1 Ingestion Pipeline** | `src/core/ingestion/knowledge-ingestion-pipeline.ts` | 8-stage in-memory pipeline (`computePipelineHash` at lines 20–33 uses non-cryptographic 32-bit `Math.imul`, single-stage review, no RFC 8785 `ocr-digest/1`). |
| **Ingestion REST API** | `src/app/api/v1/ingestion/route.ts` | Accepts v1 intake sessions and stage transitions; lacks `ocr-contract/2.0.0` immutable `ExtractionManifest` and micro-unit budget reservations. |
| **Thai Structural Chunker** | `src/core/ingestion/legal-structural-chunker.ts` | Splits statutes by `ภาค / หมวด / ส่วน / มาตรา / วรรค / อนุมาตรา` (`2,312` Resource Master docs → `2,918` chunks, `1,858` cross-reference edges); uses string regex without zero-based Unicode code-point offset mapping back to `page.raw_text`. |
| **Neo4j Graph Writer** | `src/core/ingestion/legal-chunk-neo4j-sync.ts` & `src/core/graph/graph-repository.ts` | Batch-merges `:LegalDocument`, `:LegalChunk`, `:CITES_SECTION` directly into Neo4j AuraDB without staging namespace isolation or compare-and-swap (`CAS`) `publication_id` pointer filtering. |
| **Core Search & 3R GraphRAG** | `src/core/engine/reg24-core.ts` (`searchLaw`, `execute3RGraphRAGQuery` at line 4070) | Queries static seed maps + Resource Master + RD Tax Rulings; quarantines `edge.verified === false` AI edges, but does not capture a per-request immutable `publication_id` snapshot or distinguish `ocr_verified` text from `applicability_status: 'not_assessed'`. |
| **Legal Document API** | `src/app/api/v1/legal/documents/[id]/route.ts` | Returns static `data_quality_status: "Verified"` for any matching seed document without separating `transcription_status`, `reference_status`, `applicability_status`, and `publication_status`. |
| **Auth & Policy Engine** | `src/packages/policy/index.ts` & `src/packages/application/http-helper.ts` | Verifies `x-tenant-id`, `x-workspace-id`, `x-actor-id`, `x-roles`, `Authorization` scopes, and `Idempotency-Key` headers. |
| **Unified MCP Gateway** | `src/app/api/mcp/route.ts` | Streamable HTTP JSON-RPC 2.0 gateway exposing `reg24.*` tools to Gemini, Claude, ChatGPT, and LAW24. |

---

## 2. Capability Inventory (`REG-001`)

| Capability Area | Audit Status | Notes & Required v2 Remediation |
|---|---|---|
| Shared `ocr-contract/2.0.0` envelope (`OCRJob`, `ExtractionManifest`, `OCRPage`, `OCRTable`, `SourceSpan`) | **Missing** | Implement normative schema, validator, and `ocr-digest/1` (RFC 8785 JCS SHA-256) in `src/packages/ocr-v2/contract.ts`. |
| RAG24 decoupled client & continuity adapter | **Missing** | Implement `Rag24OcrServiceClient` + Continuity Adapter (ADR-OCR-001 below) with identical policy/privacy enforcement and explicit retirement plan once external RAG24 worker fleet is provisioned. |
| Per-page native PDF text eligibility check | **Partial** | v1 had basic heuristic routing; v2 requires per-page rendered vs extracted coverage, PUA (`\uF700-\uF71A`), `\uFFFD`, Thai combining-mark order, and hidden stale-layer detection. |
| 3-layer Thai representation (`raw`, `normalized` with code-point offset map, `semantic`) | **Missing** | Implement in `src/packages/ocr-v2/thai-normalizer.ts` preserving `๒๕๖๙` vs `2569`, leading zeros, and `ๆ` (`\u0E46`), with exact insertion/deletion/many-to-one mapping to zero-based Unicode code points. |
| Thai legal entity & unresolved-instrument adjudication | **Partial** | `legal-structural-chunker.ts` extracts `มาตรา` regexes; v2 enforces that `"มาตรา ๕"` without a resolved instrument remains `unresolved_candidate` (`resolved_target_id: null`) and never fuzzy-matches into a verified graph edge. |
| 4 orthogonal legal document version states | **Missing** | Implement `transcription_status`, `reference_status`, `applicability_status`, and `publication_status` on `LegalDocumentVersion`. |
| Two-person dual-control review & optimistic locking (`If-Match`) | **Missing** | Enforce distinct human approver for critical corrections & material issue resolution; block service-account self-approval and unrestricted admin access to `confidential`/`restricted` content. |
| Atomic CAS cross-store publication pointer & rollback/withdrawal | **Missing** | Stage keyword, vector, and graph artifacts by `publication_id`, validate counts & spans, swap `active_publication_id` via CAS, and filter `execute3RGraphRAGQuery` + MCP reads through per-request snapshots. |
| CER / Grapheme / WER / TEDS benchmark harness | **Missing** | Implement reproducible scorer in `src/packages/ocr-v2/benchmark.ts` with explicit disclosure separating measured golden-fixture results from the proposed 300-doc / 3,000-page frozen corpus gates. |

---

## 3. End-to-End Trace of an Existing Document & Baseline Error Findings

1. **Trace (`legal-resource-master-corpus.json` → `reg24-core.ts`)**:
   - Record loaded at startup by `src/core/data/legal-resource-master-loader.ts` → chunked in `src/core/ingestion/legal-structural-chunker.ts` → synced via `src/core/ingestion/legal-chunk-neo4j-sync.ts` (`MERGE (d:LegalDocument {doc_id: ...})`) → retrieved via `GET /api/v1/legal/documents/[id]` as `"data_quality_status": "Verified"`.
   - **In-place overwrite hazard found**: Re-running `legal-chunk-neo4j-sync.ts` overwrites `:LegalDocument` properties and `:CITES_SECTION` edges in place without preserving predecessor extraction versions or active reader snapshots.
2. **Baseline Error Sample on Representative Thai Fixtures**:
   - Legacy PDF native extraction silently passes hidden stale Gazette text layers omitting amended paragraphs.
   - Naive Unicode `NFC` / regex normalization shifts character indices when Thai Sara Am (`\u0E4D\u0E32` → `\u0E33`) or collapsed whitespace occurs, breaking `SourceSpan` highlighting by 1–14 code points per paragraph.
   - Unqualified `"มาตรา ๕"` references in tax rulings risk linking to the wrong statute if instrument context is missing.

---

## 4. Architecture Decision Record (`ADR-OCR-001`): RAG24 Client & Continuity Adapter

- **Context**: RAG24 owns OCR provider execution and `ocr-contract/2.0.0`; REG24 owns source authority metadata, Thai legal semantics, dual-control review, and GraphRAG publication. External GPU worker infrastructure (`RAG24_OCR_BASE_URL`) is not provisioned inside Vercel serverless functions by default.
- **Decision**: Implement `Rag24OcrServiceClient` speaking HTTP `ocr-contract/2.0.0` when `RAG24_OCR_BASE_URL` is configured, backed by an in-process `Rag24ContinuityAdapter` (`src/packages/ocr-v2/providers.ts`) running the identical contract validator, micro-unit budget reservation, lease/fencing state machine, and `PrivacyClass` boundary rules (`restricted` blocks cloud fallback with `POLICY_BLOCKED`).
- **Retirement Plan**: Once dedicated RAG24 GPU workers (`OpenThai2.0-OCR-Markdown` & `typhoon-ocr2-2b`) are live behind `RAG24_OCR_BASE_URL`, set `OCR_V2_DISABLE_CONTINUITY_ADAPTER=true` with zero schema or route changes in REG24.

---

## 5. Legacy Migration Rules & Independent Feature Flags

- **Legacy Corpus Tagging (`legacy_unverified`)**:
  - Existing `2,312` Resource Master documents and `3,643` Revenue Department rulings lack rendered page image hashes and dual-control OCR review records.
  - Per Section 12, they retain explicit `migration_audit_tag: "legacy_unverified"` outside the `transcription_status` enum and are **never** backfilled as `ocr_verified` without source page evidence.
- **Independent Rollout Flags**:
  - `OCR_V2_INGESTION_ENABLED` (default `true` in pilot)
  - `OCR_V2_REVIEW_ENABLED` (default `true` in pilot)
  - `OCR_V2_PUBLICATION_ENABLED` (default `true` in pilot; shadow mode keeps staged artifacts isolated from active retrieval when toggled `false`).

---

## 6. File-Level Implementation Plan

1. `src/packages/ocr-v2/contract.ts` — `ocr-contract/2.0.0` types, runtime schema validators, RFC 8785 JCS `ocr-digest/1`, micro-unit budgets, error envelopes, and rollout flags.
2. `src/packages/ocr-v2/thai-normalizer.ts` — Per-page native PDF eligibility validator, 3-layer Thai raw/normalized/semantic pipeline with exact Unicode code-point span mapping, combining-mark diagnostics, and deterministic Thai legal citation/date/negation parsers.
3. `src/packages/ocr-v2/providers.ts` — Pinned candidate provider registry (`iapp/OpenThai2.0-OCR-Markdown`, `typhoon-ai/typhoon-ocr2-2b` full-element JSON adapter preserving headers/footers/footnotes, `mistral-ocr`, `native`, `human`) + `Rag24OcrServiceClient`.
4. `src/packages/ocr-v2/benchmark.ts` — Raw/normalized Unicode code-point CER, grapheme-cluster error rate, pinned Thai WER, critical-field exact match, citation F1, TEDS / structure-only TEDS, and honest gate reporter.
5. `src/packages/ocr-v2/service.ts` — Stateful `ocr-contract/2.0.0` + REG24 legal domain store (`legal_sources`, `legal_document_versions`, dual-control `legal_approvals`, CAS `legal_publications`, outbox/inbox, HMAC-SHA256 webhooks, lease fencing, and seeded Thai legal golden fixtures).
6. `src/packages/ocr-v2/index.ts` — Public package exports.
7. Shared & REG24 API Routes (`src/app/api/v1/documents/...`, `src/app/api/v1/ocr/...`, `src/app/api/v1/legal/documents/[id]/...`) using `[id]` consistently for Next.js 16 App Router compatibility.
8. GraphRAG & MCP Integration (`src/core/engine/reg24-core.ts`, `src/app/api/mcp/route.ts`).
9. Reviewer & Publication Workspace UI (`src/components/ModernistDrawers.tsx`, `src/app/page.tsx`).
10. Acceptance & Contract Test Suite (`tests/thai-legal-ocr-v2.test.ts`) covering all 12 Section 11 E2E scenarios.
