# REG24 — Graph RAG data onboarding in 10 batches

Version 1.3 · 14 November 2026 · Planning snapshot, Asia/Bangkok

## 1. Decision and scope

Build **one cumulative legal graph**, released in **10 domain batches**. Begin with **B01 Revenue Department rulings**, then **B02 statutes and tax framework**, and continue in the numbered order below. **Council of State opinions are now B08**. Each release uses smaller checkpointed processing runs. The ten batches cover the wider master collection; they are not ten equal slices of just RD and Council of State records.

This plan and its JSON files organize the source collection logically. No source files have been moved and no production graph ingestion has been performed. Selected REG24 repository code was inspected at the pinned commit documented in section 3A. Live graph contents, deployed configuration, credentials and capacity were not inspected. Reuse the existing graph and retrieval services after a compatibility check; do not recreate the database or assume it is empty.

Source: [Legal Database Resource Master](https://drive.google.com/drive/folders/1Q81SV8sXWFrt9ASLf8uBsezFMd1d1Ltm).

### Why use domain batches?

- Recommended: domain releases with a shared law/provision registry. Every release delivers a usable research capability and contributes relationships to later releases.
- Equal file-count slices are easy to schedule but split related issues and do not deliver coherent coverage.
- Year-only slices help historical research but delay business coverage and can omit older authorities needed by newer documents. Use year as a secondary ordering key inside each domain.

The user-approved sequence prioritizes REG24's business-law focus. Batch sizes will differ substantially. B07 and B10 require many processing runs; the number ten is a release organization, not an equal workload promise.

## 2. What was actually inspected

| Item | Observed result | Limit |
|---|---|---|
| Master folder | 88 top-level source folders mapped below | Supplied OCR audit subsequently traversed metadata: 56,064 files; content/page verification remains outstanding |
| RD Index | 5,135 data rows: 4,571 ruling-related and 564 other records | Index classifications, not independently verified unique legal documents |
| Council of State current index tab | 7,527 nonempty rows; 7,527 distinct raw opinion-number values | Combined-number records, duplicate representations and document completeness still require verification |
| Links in inspected indexes | All 4,571 RD ruling rows and 7,527 opinion rows contain a Drive file-link pattern | A link does not prove successful download, correct content or completeness |
| RD ruling organization | CIT, VAT, WHT, PIT, Stamp, SBT, General & Other | Files and index records must be reconciled recursively |
| RD sample | An HTML-derived corrected PDF explicitly identifies itself as a derivative and preserves original identifiers | Its connector-extracted text contains duplicated Thai syllables; rendering/raw HTML must be checked before extraction |
| Council of State sample | Opinion 1218/2569 has garbled connector-extracted text | This does not establish that the visible PDF is damaged; do not ingest that extraction as clean Thai |

Index sources: [RD Index](https://docs.google.com/spreadsheets/d/1ZJAUx7mYQR5yvdSdZoM8gvtDloGiqc0WAWyGNSHlW9U/edit) and [Council of State index](https://docs.google.com/spreadsheets/d/1S6CNwilzltq51DIjh2sBMOP_5QwfBxwAE-pA9OkIZRo/edit). Use only the current `INDEX - Council of State Opinions` tab. Old/superseded and gap-audit tabs are supporting audit material, not additional opinions. The older master-count summary is historical and was not used as a current corpus total.

The current index's laws-involved text is a discovery hint, not validated graph data. In particular, garbled year digits can create false statute identities. Re-extract law names and years from validated source text and verify ambiguous matches.

### 14 November OCR audit revision

The user-supplied OCR readiness audit reports a full metadata traversal of 56,064 physical Drive files / 41.2509 GB, including 54,072 PDFs / 33.8328 GB across 88 top-level folders and 534 descendant folders. This supersedes the earlier “descendants not fully enumerated” limitation at metadata level only. Unique legal-work counts, archive contents, exact page counts and OCR demand remain unverified.

The random 120-PDF sample classified 52 as native-extraction candidates, 7 as legacy-font repair, 20 as corrupted repair/OCR, 33 as no usable text and 8 as mixed/review. These are file-level triage outcomes, not page/byte proportions or legal-accuracy scores. No OCR model was benchmarked. Preserve the audit's sampling limits; do not multiply these percentages by storage GB to estimate OCR work.

Require a full page manifest before graph acceptance: probe every page; preserve good native text; apply only source-verified, font-specific deterministic repairs; OCR failing pages/regions; quarantine uncertain critical content. Coordinate-based cleanup must not delete genuine repeated legal text. All pages—including noncontent pages with reasons—must reconcile; unresolved potentially material pages block complete-document publication.

Add safe archive/member and TXT record parsing before expensive OCR. Deka's 5.4649 GB contains only 0.0710 GB of standalone PDFs; its text/archives must not be treated as an OCR byte backlog. Record physical files, expanded members/logical records and canonical works separately, with exact-byte deduplication and unchanged access scopes. Primary Law and BOT/SEC need scan-focused pilots; TISI needs a font-repair-versus-OCR benchmark; RD/opinions prioritize verified native extraction with page checks; B10 books/theses need long-document resumability.

Keep the ten-batch sequence and owner test gate. Extend the shared foundation before B01 to support all five routes; calibration of later-domain fixtures is permitted without ingesting those later domains. Use at-most-50-page OCR tasks and an initial 250 OCR-invoked-page dispatch budget per run within existing document/source-page ceilings; oversized documents continue checkpointed and publish only after complete evidence validation. Record actual OCR attempts separately from final page route counts. These are tunable scheduling limits, not throughput forecasts.

Reforecast each batch from deduplicated page routes, expanded archive records, measured extraction/OCR throughput, critical review hours, graph/evaluation overhead and the owner's testing calendar. No new full-corpus completion date is established by this audit. All existing graph/answer quality, historical-law, replay, citation, authorization and rollback gates remain mandatory. Detailed requirements and AT19–AT26 are in the updated developer package's `03_OCR_AUDIT_ADJUSTMENTS.md`.

Audit source: supplied `REG24_Legal_Resource_OCR_Audit_2026-11-14(1).md`; no independent recrawl or OCR execution occurred during this plan revision.

| Release scope | Physical files | PDFs | Total GB | PDF GB |
|---|---:|---:|---:|---:|
| B01 + B02 combined source pools | 11,903 | 11,867 | 3.6145 | 3.5959 |
| B03 — Corporate, investment and commerce | 3,452 | 3,398 | 3.0608 | 3.0573 |
| B04 — Financial services and capital markets | 11,228 | 11,174 | 7.8979 | 7.8727 |
| B05 — Employment, data and digital business | 2,746 | 2,690 | 1.6658 | 1.6550 |
| B06 — Energy, environment and industry | 5,396 | 5,365 | 2.9651 | 2.9640 |
| B07 — Health, property, transport and other sectors | 6,691 | 6,650 | 4.5697 | 4.5680 |
| B08 — Council of State opinions | 7,528 | 7,524 | 2.5014 | 2.4999 |
| B09 — Public administration, procurement and oversight | 2,866 | 2,805 | 2.8356 | 2.7591 |
| B10 — Courts, enforcement and research | 4,252 | 2,599 | 12.1401 | 4.8605 |
| Root-level files, classify during setup | 2 | 0 | 0.0000 | 0.0000 |
| **Audit total** | **56,064** | **54,072** | **41.2509** | **33.8328** |

B01/B02 source-pool counts are combined because the RD parent spans both; root-level files remain to classify. These are physical files before deduplication and archive expansion.

## 3. Ten release batches

Revision 1.1 applies the requested original order **01 → 03 → 04 → 05 → 06 → 07 → 09 → 02 → 08 → 10**, renumbered as B01–B10. Group membership is unchanged. All batch references below use the new numbering. The JSON batch map preserves `previous_batch_id` for traceability.

| Batch | Group | Main data | Capability delivered |
|---|---|---|---|
| **B01** | **RD rulings / ข้อหารือกรมสรรพากร** | Rulings subtree; ruling records elsewhere after deduplication; cited provisions as dependencies | Find comparable tax fact patterns, conditions, outcomes and cited tax provisions |
| **B02** | Statutes and tax framework | Primary Law, Council of State legislation, Gazette, royal decrees, Parliament, remaining RD material, Customs and Excise | Resolve cited sections to evidenced law versions and expand tax coverage |
| **B03** | Corporate, investment and commerce | DBD, BOI, EEC, competition, domestic/foreign trade, IP, consumer and cooperative sources | Corporate activities, investment incentives and commercial obligations |
| **B04** | Financial services and capital markets | SEC, SET, BOT, AMLO, OIC, FPO, DPA, PDMO, bond-default material | Connect regulated activities, operators, obligations and reporting rules |
| **B05** | Employment, data and digital business | Labor, Employment, PDPC, NCSA, ETDA, NBTC, AI/platform and cross-border data | Employer, privacy, cybersecurity and digital-service research |
| **B06** | Energy, environment and industry | ERC, DMF, DOEB, DEDE/EPPO, climate, environment, factories, standards, industrial estates and minerals | Connect projects and operating activities to licensing and environmental requirements |
| **B07** | Health, property, transport and other sectors | Health/FDA, construction, aviation, marine/land transport, agriculture, education and space | Sector-specific licensing and operating research |
| **B08** | **Council of State opinions / ความเห็นกฤษฎีกา** | Opinions, requesting agencies, legal questions, reasoning and referenced opinions | Trace legal interpretation and compare opinions on a provision or issue |
| **B09** | Public administration, procurement and oversight | CGD, Treasury/SEPO, Cabinet, public administration, DOPA/DDPM, NACC, OAG and oversight bodies | Trace authority, procurement, public assets and administrative obligations |
| **B10** | Courts, enforcement and research | Deka, Constitutional Court, justice/enforcement, Attorney General, books, theses, articles and forms | Compare case treatment and add clearly labeled commentary and practical materials |

**Dependency rule:** Each batch imports necessary cited legal authorities on demand. B01 loads the primary-law provisions it needs before the full B02 release; B08 reuses the legislation and sector data released in B02–B07. Necessary cited decisions can be loaded before B10. Preserve `owner_batch_id` (for example B02 for legislation or B10 for court decisions) and `first_loaded_by_batch_id` (the batch that actually loads the item). Targeted dependencies do not advance the full release of their owner batch. This is preparation inside the ten batches, not an eleventh batch.

Source organization is a starting point. Document type and provenance override folder names. A statute found in an articles folder remains a statute; an article in a regulator folder does not become a regulation. Check acronym meanings, especially DPA, from document issuer evidence before creating agency nodes.

## 3A. Mandatory existing-graph protection gate — revision 1.2

This preparation is required before B01 and revalidated before each later batch. It does not change the approved ten-batch order. **Production import readiness is BLOCKED_PENDING_VERIFICATION.** The requirements below are not yet implemented or certified by this review.

### Current-code review and evidence

Read-only review of `classichot/REG24`, commit `0978e1d7c578b74c888eb06d9d70be786f387ca0`. Nine relevant implementation/test files were inspected. This is a repository snapshot, not proof that the deployed application uses the same commit. No production endpoint, database, constraint list, backup or graph inventory was inspected. No production data or repository source was changed.

| Finding | Evidence | Consequence |
|---|---|---|
| Existing canonical-ID protection | `src/core/graph/graph-schema.ts:133–145` defines per-label uniqueness constraints; graph writers use `MERGE` | Reuse this protection, but verify constraints actually exist in the deployed database |
| Duplicate registries are process-local | `knowledge-ingestion-pipeline.ts:435–448` stores jobs, hash registry and idempotency keys in Maps | A new process or worker does not inherit previously ingested records through this service |
| The value called SHA-256 is not SHA-256 | `knowledge-ingestion-pipeline.ts:20–32,563` uses a custom repeated hexadecimal hash over text or filename | It cannot certify original-byte identity; replace with real original-byte SHA-256 and separate text hashes |
| Work/document identity depends on filenames | `knowledge-ingestion-pipeline.ts:728–730`; near-duplicate detection at `902–914` also uses filename normalization | Renamed PDFs, HTML and corrected OCR may fail to resolve to one legal work |
| Graph import paths use different identity schemes | `legal-chunk-neo4j-sync.ts:113,139` uses `inst.lrm.<catalog-id>`; `graph-migrator.ts` preserves seed instrument and tax-ruling IDs | Introduce an explicit crosswalk to existing identities before inserting new nodes; cross-path equivalence was not established by the review |
| Matched nodes can be overwritten on sync | `legal-chunk-neo4j-sync.ts:139–156` sets title, verification, dates, hash and status after matching | Duplicate prevention alone does not protect curated metadata or provenance from replacement |
| Existing repeat test is narrower than its crash-recovery label | `knowledge-ingestion-pipeline.ts:1628–1651` submits twice to the same service instance | Passing that test does not prove recovery across process restarts or multiple workers |

Local behavioral checks executed with Node v24.22.1 against the pinned service file; no network/database connection was used:

| Check | Observed result |
|---|---|
| Submit identical payload/key twice to one service instance | Second submission reports `idempotent_replay` |
| Submit the same payload/key to a fresh service instance | Reports `accepted`, with `reused_existing_duplicate=false` |
| Compare receipt hash to Node crypto SHA-256 of the same text | Different values |
| Submit the same test ruling number/date with a renamed file and one trailing newline | Different `work_id`; duplicate not reused |

These results show specific gaps in the inspected service. They do not prove that duplicates already exist in production or that all ingestion paths behave this way. Full application tests and live Neo4j repeat-import tests were not run. The current candidate manifest remains unverified; no actual overlap count is available.

Pinned sources:

- [Pipeline service](https://github.com/classichot/REG24/blob/0978e1d7c578b74c888eb06d9d70be786f387ca0/src/core/ingestion/knowledge-ingestion-pipeline.ts)
- [Graph constraints](https://github.com/classichot/REG24/blob/0978e1d7c578b74c888eb06d9d70be786f387ca0/src/core/graph/graph-schema.ts)
- [Catalog/chunk graph synchronization](https://github.com/classichot/REG24/blob/0978e1d7c578b74c888eb06d9d70be786f387ca0/src/core/ingestion/legal-chunk-neo4j-sync.ts)
- [Canonical graph migration](https://github.com/classichot/REG24/blob/0978e1d7c578b74c888eb06d9d70be786f387ca0/src/core/graph/graph-migrator.ts)

### Required work before any production batch import

1. **Capture and restore-test the baseline.** Identify the deployed commit, Neo4j database, backing canonical store and retrieval indexes. Record node/relationship counts by type, uniqueness constraints, stable IDs, versions, source links and access scopes. Take a consistent recoverable snapshot and verify restoration in an isolated environment. Existing duplicates must be inventoried before enabling constraints; do not silently delete them to make a migration pass.
2. **Build a persistent identity registry and crosswalk.** Resolve incoming legal identities to existing graph IDs. Include legacy seed IDs, catalog IDs, source URLs, source revisions and existing passage/assertion IDs. Preserve existing public citations and IDs. Where two existing nodes appear equivalent, open a reviewed reconciliation proposal; retain aliases/redirects and all valid evidence if consolidation is later approved.
3. **Use three separate identities.** Legal-work identity uses verified issuer, source type, official number/year/date context. Source-artifact identity uses SHA-256 of original bytes. Extraction identity uses source-artifact ID plus extractor/version/configuration. Store normalized text hashes for candidate discovery only. Batch ID, filename, OCR output and upload time must not determine legal-work identity. A corrected extraction is not automatically a new legal edition.
4. **Persist repeat protection.** Store idempotency keys, request fingerprints, canonical mappings and job states durably, with transactional uniqueness/locking for concurrent workers. Fingerprint all semantically relevant request fields, not only text. Same key plus incompatible payload must produce a conflict. Match within authorized access scopes; private/public copies must not be merged across permissions automatically.
5. **Generate a read-only reconciliation manifest.** Every candidate receives an evidenced disposition from the table below. Record `candidate_id`, `existing_canonical_id`, `match_method`, `match_evidence`, `artifact_sha256`, `text_hash`, `legal_identity_fields`, `disposition`, `field_changes`, `review_state`, `baseline_snapshot_id`, `rule_version` and `planned_write_counts`. Unknown matches have no production write permission. If the baseline changes before promotion, revalidate impacted matches.
6. **Protect existing content during upsert.** An unchanged duplicate is a no-op except permitted source/audit bookkeeping. Do not blindly overwrite reviewed text, dates, authority class, verification status, tenant scope or accepted relationships. Source corrections and better OCR create versioned representations/extractions, with an explicit accepted-generation switch. Legally amended text gets a distinct legal version with evidenced temporal links. Use existing endpoint IDs when adding graph relations; retain distinct source assertions while consolidating equivalent retrieval results.
7. **Stage, compare and promote.** Verify canonical-store, graph and retrieval changes against one release manifest. Track each operation as create/update/reuse and retain before-images where needed. Publish only after all required projections pass checks. Rollback restores changed values and removes only entities exclusively created by this run; it must not delete shared legal nodes merely because a migration/batch tag was updated.

| Disposition | Meaning | Allowed action |
|---|---|---|
| `SKIP_UNCHANGED` | Same verified work, representation and accepted processing generation already available | Reuse; no duplicate document, passage, vector or assertion |
| `ATTACH_REPRESENTATION` | Same legal work, different PDF/HTML/scan source | Add provenance-linked representation; reuse canonical work |
| `NEW_EXTRACTION_REVISION` | Better OCR or parser result for existing source/version | Stage new extraction; preserve old evidence and citations |
| `NEW_LEGAL_VERSION` | Verified legal amendment/revision, not merely extraction variation | Add version and evidenced temporal relationship |
| `CREATE_NEW_WORK` | No existing work after complete authorized matching | Create stable work ID and dependencies |
| `REVIEW_IDENTITY_CONFLICT` | Ambiguous identity, conflicting text or incompatible metadata | Quarantine; no overwrite or automatic consolidation |

### Acceptance tests required to clear the gate

- Repeat the exact accepted import in the same worker, after a worker restart and through a second worker: zero additional canonical works, accepted passages, vectors or accepted assertions. Audit entries and processing receipts may increase without duplicating knowledge.
- Submit concurrently from two workers: one canonical work/representation per applicable identity and scope; both callers resolve to the same accepted result or a documented retry/conflict.
- Import the same ruling as PDF and HTML, or with a renamed file and formatting-only extraction changes: resolve the legal identity once; preserve source representations.
- Improve OCR: preserve work identity and legal edition, retain prior extraction provenance, and switch retrieval to the accepted extraction only after review.
- Import an actual amendment: retain both legal versions and correct date-scoped retrieval. Same section number under different laws must remain distinct.
- Reorder batches or retry using a different batch/run identifier: canonical IDs remain unchanged.
- Existing node has reviewed values and incoming metadata differs: proposed field diff is held, with no silent replacement.
- Simulate failure between canonical-store, graph and vector writes: the prior accepted release stays queryable; retry and rollback produce consistent results.
- Verify scoped behavior: private records do not become public through deduplication or shared hash matches.
- Reconcile counts and identities, not counts alone: compare pre/post entity sets, evidence reachability, shared relationships and retrieval results. Zero net growth can conceal one deletion plus one duplicate creation.

**Gate completion requires:** a verified baseline/restore result, persistent identity mapping, validated actual byte hashes, read-only overlap report for the selected pilot, passing restart/concurrency/replay tests against the deployed-compatible storage stack, and a reviewed field-level change plan. Missing live graph access or any failed check keeps the gate blocked. This requirement applies even if an existing UI displays a passed test counter.


## 4. B01 execution plan — RD rulings

Primary folder: [RD / Rulings](https://drive.google.com/drive/folders/1cgVt2LJgeLK2KQXLBuDGIK1PAXcZKW_I).

| Processing lane | Index rows | Suggested order |
|---|---:|---|
| CIT | 1,432 | 1 — business income, deductions and restructuring |
| VAT | 1,372 | 2 — transactions, invoices, exemptions and credits |
| WHT | 375 | 3 — payer/payee facts and payment classification |
| PIT | 903 | 4 — employment and individual income |
| Stamp | 126 | 5 — instrument classification |
| SBT | 210 | 6 — relevant transactions and activities |
| General & Other | 153 | 7 — procedures, miscellaneous and classification review |
| **Total** | **4,571** | Includes five `RD Ruling` rows and one compilation row, as well as 4,565 `Ruling` rows |

These are the current index's primary tags. A document can have multiple tax topics. Do not create duplicate legal documents for each tag. The compilation row must be split into evidenced component rulings; it cannot be treated as one newly issued ruling or counted as fully verified from its one source URL.

### Start with a 100-document pilot

Select **100 unique, verified documents**, after deduplication: 30 CIT, 25 VAT, 15 WHT, 10 PIT, 5 Stamp, 5 SBT, 10 General & Other. Cover older and newer documents, native text, HTML sources and scans. Include difficult extraction cases in the pilot evaluation, but quarantine failures rather than publishing them.

The manifest supplied with this plan lists candidates; it does not claim these pilot documents have already been selected or validated. Select the pilot from downloaded and checked documents, not simply the first 100 index rows. A successful pilot is the gate to larger B01 runs.

After the pilot, process approximately **200 unique documents or 1,000 pages per run, whichever is reached first**, as an initial operating limit. Keep an oversized document in its own run. Recalibrate after measuring OCR time, extraction tokens, review demand and failure rates. Use identifiers such as `B01-CIT-R001`, `B01-VAT-R001`; these remain inside B01.

### Extract from each ruling

- Issuer, full letter number including prefixes/suffixes, issue date, subject and official source URL.
- Facts / ข้อเท็จจริง, question / ข้อหารือ, cited law / ข้อกฎหมาย, reasoning and conclusion / แนววินิจฉัย.
- Relevant taxpayer roles, transaction, tax topics, assumptions, conditions and exceptions.
- Precise law/section/subsection references and supporting text spans.
- Historical context and any explicit reference to an earlier ruling; unknown current applicability remains unknown.

Preserve distinctions between the applicant's assertions and the department's conclusion. A summarizer must not promote an applicant's requested treatment into the ruling outcome. Preserve anonymous roles such as บริษัท ก within that document; do not merge all บริษัท ก references across the corpus into a global company.

Prefer a validated official HTML body where available, then validated native PDF text, then page-image OCR for pages with unusable text. Retain originals, cached HTML, corrected copies and transformations as separate representations of the same legal document. Never count a corrected copy as a new ruling or label it an original official PDF.

## 5. B08 execution plan — Council of State opinions

Primary folder: [Council of State Opinions](https://drive.google.com/drive/folders/1ER5P5v0aMPusO1UnS8FB7v6fsEHkpXdI). Do not confuse this with the separate `Council of State (กฤษฎีกา)` legislation folder assigned to B02.

Create multi-label topic lanes, with one primary routing lane for processing:

1. Tax, public finance and state revenue — creates the first bridge to B01.
2. Administrative procedure, authority, delegation, licensing and appeals.
3. State property, procurement, public contracts, concessions and state enterprises.
4. Business, investment, labor and regulated industries.
5. Land, construction, environment, energy and infrastructure.
6. Remaining public-law topics and uncertain classification.

These lanes are proposed labels, not measured counts. Use subject and agency columns for candidate triage only; validate against the actual opinion. Use the six lanes as subdivisions of B08, not additional release batches.

Start with 50 unique opinions: 15 tax/public-finance, 15 administrative procedure, 10 public contracts/property, and 10 business/sector opinions. If a lane lacks verified candidates, record the shortfall and adjust explicitly. Follow with approximately 100 opinions or 1,000 pages per run, whichever comes first, pending pilot calibration.

Extract opinion number and Buddhist Era year; issuing committee/body; requesting agency; the request and factual assumptions; legal question; the issuing body's reasoning and conclusion; cited statutes/provisions; cited earlier opinions and judgments; document date and dispatch date separately where present. Do not substitute the Drive upload date or `date added` for the opinion date.

For combined-number PDFs, retain one source file and create separate opinion identities only where the text supports distinct opinions; preserve shared passages and the exact number set. Do not expand every numerical range blindly into separate invented opinions. Keep historical and revised views separately, and never mark an older opinion superseded merely because a newer one discusses the same subject.

## 6. Shared graph model and retrieval behavior

| Entity | Purpose and identity rule |
|---|---|
| LegalDocument | Canonical legal item: ruling, opinion, legislation or judgment. Source-type-specific identity after verification |
| SourceRepresentation | Original PDF/HTML, scan, corrected derivative, translation; source URI, hash, timestamp and provenance |
| Passage | Evidence text, page/paragraph or HTML anchor, offsets and extraction version |
| Instrument / Provision / ProvisionVersion | Law identity, section hierarchy and evidenced historical text version; resolve year and amendment ambiguity |
| Agency / Topic / LegalIssue | Controlled labels with aliases and verified entity resolution |
| Interpretation | Source-attributed legal proposition, conditions and scope; always points to evidence |

Initial relationships: `HAS_REPRESENTATION`, `HAS_PASSAGE`, `ISSUED_BY`, `REQUESTED_BY`, `ADDRESSES`, `CITES`, `INTERPRETS`, `HAS_PROVISION`, `HAS_VERSION`, and `SUPPORTED_BY`. Add `AMENDS`, `REPEALS` and `SUPERSEDES` only from verified explicit evidence. Similarity links stay labeled as retrieval aids, not legal propositions. Candidate conflicts remain `potential_conflict` until reviewed; topic similarity alone does not establish contradiction.

A typical answer path is: question → relevant issue/passages → ruling or opinion → cited provision/version → related authorities → cited answer. Use lexical and vector retrieval plus bounded graph expansion and reranking. A shared section is a useful discovery link; it is not proof that two cases have the same outcome.

Use one canonical registry across all batches. Every fact-bearing relationship must have an evidence passage or an explicit derivation record, source representation, extractor/model/prompt versions and review state. Unresolved citations can be typed reference placeholders, but must not be presented as verified law text. Track their resolution queue and coverage.

Preserve original Thai and a separate normalized retrieval field. Keep raw Thai/Arabic numerals, Buddhist/Gregorian year conversion and the original date string. Do not overwrite original text during normalization. Track issue date, publication date, effective intervals and knowledge-acquisition time separately. An issue date does not establish present-day legal applicability.

For historical queries, select the evidenced relevant law version. For present-day applicability questions, require verified status evidence or disclose that status is unresolved. Display whether a citation is legislation, RD interpretation, Council of State opinion, judgment or commentary; do not collapse these source types into a single universal authority rank.

## 7. Repeatable pipeline for every run

1. **Freeze candidate manifest.** Enumerate all descendants using pagination; reconcile index rows, actual Drive files, derivatives, missing links and unindexed files. Save the cutoff, row identities, folder paths and source revision metadata.
2. **Download and fingerprint.** Preserve original bytes. Track Drive ID plus revision, source URL, retrieval timestamp, MIME type, page count and SHA-256. Apply access/license classifications; confidential advisory materials stay out of public retrieval.
3. **Resolve identities.** Match exact bytes and verified legal identity; retain aliases and representations. Near-duplicates require review. Letter number alone is insufficient without issuer/date context. Never merge conflicting texts automatically.
4. **Validate text.** Detect garbled encodings, repeated syllables, missing pages, bad reading order and broken tables. Check section numbers, years, amounts, rates, negatives and exceptions. OCR only where needed. Preserve page and span provenance.
5. **Structure and extract.** Separate facts, questions, quoted arguments, reasoning and conclusions. Extract source-grounded entities/relationships with uncertainty and schema validation.
6. **Resolve dependencies.** Load cited law versions and necessary referenced authorities. Keep an unresolved-reference queue; unsupported current-law conclusions must remain blocked.
7. **Stage and evaluate.** Load into an isolated staging dataset using stable IDs and idempotent upserts. Check evidence links, retrieval and regression against prior released batches.
8. **Promote an accepted snapshot.** Publish the graph, searchable passages and release metadata consistently. Keep prior snapshot pointers and per-run rollback information.
9. **Report coverage.** Distinguish discovered rows, downloaded representations, unique documents, verified text, released documents, quarantined documents and unresolved citations. Reconcile every candidate to a disposition.

Worker retries resume by document/version/stage. Use bounded retry counts, a failure queue, configurable budget and concurrency caps. Source document content is evidence, never executable agent instructions. Changes to extraction logic create versioned outputs; they do not overwrite evidence silently.

## 8. Proposed acceptance gates

These are initial acceptance targets, not measured performance or promises.

| Gate | Release rule |
|---|---|
| Existing-graph protection | Section 3A passed against the deployed-compatible storage stack before production writes |
| Manifest accounting | 100% of frozen candidates have a disposition: released, duplicate, excluded with reason, quarantined, or blocked |
| Evidence | 100% of released interpretive claims have resolvable evidence spans; generated summaries are not sole evidence |
| Critical text | Every released document passes automated checks; all flagged critical fields are reviewed; no unresolved known critical error in released content |
| Reviewed extraction sample | Review all pilot documents. Later runs: all flagged items plus a stratified random sample of at least 10%, minimum 20 documents or the whole run if smaller. Require ≥98% exact correctness on reviewed critical fields and ≥95% supported relation precision; any material legal distortion blocks the affected scope and expands review |
| Duplicate and replay behavior | Replaying an accepted run adds no duplicate canonical documents/relationships; source representations remain traceable |
| Retrieval | Establish 50 reviewed questions for B01 and 50 for B08, including cross-document, historical and unanswerable cases. Target evidence Recall@10 ≥90% and citation support ≥95%; report sample size and failures |
| Serious answer errors | Zero observed fabricated authorities, reversed conditions or unsupported present-law assertions in the release test set; this is not a guarantee of zero future errors |
| Regression and rollback | Prior acceptance sets still pass; demonstrate rollback of the run without deleting shared entities needed by earlier releases |

If quarantines remain, release the accepted subset only with an explicit coverage statement. Do not label the entire source corpus complete. Freeze a benchmark holdout so later tuning does not simply memorize all evaluation questions.

## 9. First work packages and handoff

**First:** complete the mandatory existing-graph protection gate in section 3A. The repository checks exposed repeat-protection gaps; production readiness remains blocked until they are resolved and verified against the deployed storage stack. Reconcile existing graph and retrieval records before importing.

**Next:** reconcile B01 candidates against source files, validate 100 unique pilot documents, fetch their cited primary-law dependencies, and build the evidence-backed pilot graph. Measure pages/minute, usable-text rate, cost/document and review time.

**Then:** pass the B01 pilot gate and scale by tax topic. Release B02 statutes/tax framework, B03 corporate/commerce, B04 finance, B05 employment/digital, B06 energy/industry and B07 sector-specific regulation in that order. Next run the B08 50-opinion Council of State pilot and scale it after acceptance, followed by B09 public administration/procurement and B10 courts/research. Load targeted dependencies earlier only where needed.

Do not promise a completion date from document counts. Estimate after the pilots: processing time from native/scanned pages and measured throughput; extraction cost from measured tokens; review hours from flag rate and sampled handling time. Record those three budgets separately.

### Files delivered

- `REG24_GraphRAG_10_Batch_Plan_v1_3.md` — this plan and exact top-level folder allocation.
- `REG24_GraphRAG_10_Batch_Map_v1_3.json` — ten logical batches, observed source folder IDs and routing rules.
- `REG24_RD_OCS_Candidate_Manifest_v1_1.json` — 12,662 current index rows: 4,571 B01, 7,527 B08 and 564 B02 candidates. Preserves source row numbers, URLs, labels and notes. All records are `indexed_unverified`; canonical IDs are null deliberately. This is not a ready-to-publish queue and not a census of every actual source file.

### Bot work instruction

> Implement REG24 ingestion against the supplied ten-batch map. Complete section 3A before any production write, then begin B01 using the existing graph and verified identity crosswalk. Treat the candidate manifest as unverified input. Preserve original sources and derivative provenance; validate Thai text before extraction; build evidence-backed document, passage, issue and versioned-provision relationships. Select and validate the 100-document B01 pilot, import its legal dependencies, evaluate the release gates, and report coverage and measured cost before scaling. Keep all work checkpointed and idempotent. Never infer current legal applicability from document age, index metadata or model knowledge alone.

## 10. Official reference points and sample evidence

- [RD ruling example](https://www.rd.go.th/24380.html) — official structured ruling with question and department conclusion.
- [RD ruling search manual](https://www.rd.go.th/fileadmin/download/fess/manual-search-discuss-rd.pdf) — official source-discovery reference.
- [Council of State opinion search](https://www.ocs.go.th/searchlaw-comment) — opinion number, Buddhist Era year, committee and category fields.
- [Council of State opinion service](https://comment.ocs.go.th/) — additional official discovery endpoint; reconcile with primary records, not search-result counts alone.
- [Inspected RD corrected-copy sample](https://drive.google.com/file/d/1IYbjHKPb7EuHnCr739pAd_vwZJEnhwtY/view) — demonstrates derivative provenance and the need to validate extracted text.
- [Inspected Council of State sample 1218/2569](https://drive.google.com/file/d/1qDkLqQ_ucP2ANTke5oWihKFh_M9jxqUJ/view) — demonstrates why native text presence does not establish usable Thai extraction.

## Appendix — exact allocation of the 88 observed source folders

Folders remain in their original locations. The RD root is the B01 entry point only for its Rulings subtree; its other source subfolders belong to B02. Index/control documents at the master root are inventory support, not law. `FourCorners Analysis` is product research and excluded from the legal evidence corpus unless separately reviewed for a defined use.

| Batch | Observed source folder | Source |
|---|---|---|
| B01 | RD - Revenue Department | [Open](https://drive.google.com/drive/folders/1sJHpmTR1uEiEcFo3B0bVSfkX1P5HPsi6) |
| B02 | Council of State (กฤษฎีกา) | [Open](https://drive.google.com/drive/folders/15Khrg59kGxNjt3rxqiTTxjIOV8Gp9_84) |
| B02 | Customs - Customs Department | [Open](https://drive.google.com/drive/folders/1BaWRZgpQbEl7hl8Xsh3vPXMZsDjXkgxv) |
| B02 | Excise - Excise Department | [Open](https://drive.google.com/drive/folders/1r9buiqHavK-pOVDw3lnjuX-y5Gex_YAA) |
| B02 | Misc Gazette | [Open](https://drive.google.com/drive/folders/1RqAoj8tudRfYEwLjXTc4ZN2mXWUj88ed) |
| B02 | Misc Royal Decrees | [Open](https://drive.google.com/drive/folders/1mM9Urykv0oTRzer4bE12vTdrdVzgJPFq) |
| B02 | Parliament | [Open](https://drive.google.com/drive/folders/1uPd5YxGWZbSyl4y5ffl4bUUExeNn3mDE) |
| B02 | Primary Law | [Open](https://drive.google.com/drive/folders/1d44FTBu5a4P63fcvRdTgWwqX8fFZmuz5) |
| B03 | BOI - Board of Investment | [Open](https://drive.google.com/drive/folders/1O_y2gYVNmj4D9jB4ZI4aHc9a4XQeFlq5) |
| B03 | CPD Cooperatives Regulations | [Open](https://drive.google.com/drive/folders/1h_VNeAfVx4F2TKNFPeaFuCm4DfZ2E5-k) |
| B03 | DBD - Department of Business Development | [Open](https://drive.google.com/drive/folders/1rzEBsNIfbHoB37J2Nt05E60EDEZaVkgM) |
| B03 | DFT - Department of Foreign Trade | [Open](https://drive.google.com/drive/folders/1XCcLJfgz1WLwfuGkGfju3ojvqAxWTUzL) |
| B03 | DIP - Department of Intellectual Property | [Open](https://drive.google.com/drive/folders/16mP-VcR_RZl41JSyPb5O8nYk-1Uzr5wt) |
| B03 | DIT - Department of Internal Trade | [Open](https://drive.google.com/drive/folders/1TQnWbdCQZzbNix3AUDVotfV6uG_uQI4U) |
| B03 | DITP - Department of International Trade Promotion | [Open](https://drive.google.com/drive/folders/1J3v1MBMRJo6QTBnsv6-8TJYL2cR8Cn4U) |
| B03 | EEC Regulations | [Open](https://drive.google.com/drive/folders/1ovmuMO-RzJnryN0DjondryPj9PtIRCHq) |
| B03 | OCPB Regulations | [Open](https://drive.google.com/drive/folders/19xMhu8R7iVKQyMe8Xy-Rr0NxfFJVAKy7) |
| B03 | TCCT - Trade Competition Commission of Thailand | [Open](https://drive.google.com/drive/folders/1qlvpJ75tLWBgBSR5Roo6_fI14w8n2MuP) |
| B04 | AMLO - Anti-Money Laundering Office | [Open](https://drive.google.com/drive/folders/1v0A2tcjqs_xPnaff2FDy3hQQfbA01P3v) |
| B04 | BOT - Bank of Thailand | [Open](https://drive.google.com/drive/folders/1ogA-OJLKZZP4BQDGxzrZ2f_JDwwwNNQF) |
| B04 | Bond Default Forensics | [Open](https://drive.google.com/drive/folders/1yF23vdy_4tYvQqSpBOblJTBBjjJRmrFe) |
| B04 | DPA Regulations | [Open](https://drive.google.com/drive/folders/1C1HDDoj0hi-cfZtvSS84CmirJsJwcUOy) |
| B04 | FPO Regulations | [Open](https://drive.google.com/drive/folders/1q-tch29kVfa25sVC4ZNj0j2E1J_YXhM_) |
| B04 | OIC - Office of Insurance Commission | [Open](https://drive.google.com/drive/folders/1ctRzKWIsiGnjxL5FbpHKAnK4YJbm409P) |
| B04 | PDMO Regulations | [Open](https://drive.google.com/drive/folders/1kJK_a1NU-gRoo7t54S5kkIrZvoi35e6M) |
| B04 | SEC - Securities and Exchange Commission Thailand | [Open](https://drive.google.com/drive/folders/14GpOTTS7h8Fx9SyEOn8TYOTwNYhXbvJB) |
| B04 | SET - Stock Exchange of Thailand | [Open](https://drive.google.com/drive/folders/1gQhTyb9Sa3vRoCl7ybyW3pilfnT6jjH_) |
| B05 | AI & Platform Law | [Open](https://drive.google.com/drive/folders/16Wrzsbd3U27CxqOjBXPfLVcgzKvodwOa) |
| B05 | Cross-Border Data & Cloud | [Open](https://drive.google.com/drive/folders/1F_Xsq_k-r5HFBQI4hKOHQbL88i6ySCf5) |
| B05 | DOE - Department of Employment | [Open](https://drive.google.com/drive/folders/1zjfgUKmMQMnmq7rAx5XYRPoVh0LsKuc2) |
| B05 | ETDA Regulations | [Open](https://drive.google.com/drive/folders/1h6x4StDW71BKxuKrIkbV1-kfF2ieFX6d) |
| B05 | Labor & Social Regulations | [Open](https://drive.google.com/drive/folders/1fLYQuOVWCHxtTHhlD3zeWkY9YXEtXX2O) |
| B05 | NBTC | [Open](https://drive.google.com/drive/folders/1pGZ5d5vIl3acWHn9hrA3xw1bQ4yqmNWe) |
| B05 | NCSA | [Open](https://drive.google.com/drive/folders/1BqNSQ-IK5QJOdVd-xdEKyKxNGkxIWpDH) |
| B05 | PDPC Regulations | [Open](https://drive.google.com/drive/folders/1H_E-dXoC7Lyz95qUXAxK6xLnDz01ry84) |
| B06 | Carbon & Climate Regulations | [Open](https://drive.google.com/drive/folders/1LkwDYeqEbSgf1YZVpzneseooOkMYfxtu) |
| B06 | DEDE & EPPO Regulations | [Open](https://drive.google.com/drive/folders/1OVnna8TBFZWu7yTxU9zYXr2NiFEXH599) |
| B06 | DIPROM Regulations | [Open](https://drive.google.com/drive/folders/1ah-CxwlQSny7bKzVy11RpfdC8npOqv4d) |
| B06 | DIW Regulations | [Open](https://drive.google.com/drive/folders/1yvpDgFsa-xf_fVxJKJX7kDFwiOSBGcYK) |
| B06 | DMF - Department of Mineral Fuels | [Open](https://drive.google.com/drive/folders/1jCDwAEoCWs7UspUJ99h4IHedRWX6s0y-) |
| B06 | DOEB | [Open](https://drive.google.com/drive/folders/1EbsLAue8n6xCV0Oq7gD3w0uvoXEj4OpB) |
| B06 | DPIM Regulations | [Open](https://drive.google.com/drive/folders/1ag450qum7MJMc-P5pxzVzg7TKswQUPEn) |
| B06 | ERC - Energy Regulatory Commission | [Open](https://drive.google.com/drive/folders/1DCCntM2MmZ3d8l8PB_cjMkiMZAv7GDAT) |
| B06 | Energy Transition Law | [Open](https://drive.google.com/drive/folders/1NRham8NU6HMwePlfijyR3_okAo8LPjXT) |
| B06 | Environment Regulations | [Open](https://drive.google.com/drive/folders/1LvI6kfjV3F3DoXnmkKzTwFwOgIELDg2K) |
| B06 | IEAT - Industrial Estate Authority of Thailand | [Open](https://drive.google.com/drive/folders/19vJpedvBeRwoJ7QsBXT_YnU37A83CKyC) |
| B06 | OAP Regulations | [Open](https://drive.google.com/drive/folders/1fqz3KVVAuWmKzV9Co3YIpOod1m8arEIr) |
| B06 | OCSB Regulations | [Open](https://drive.google.com/drive/folders/14hUTQP4beX8bsfRFSU0Lgt_QmnaphzbK) |
| B06 | OIE Regulations | [Open](https://drive.google.com/drive/folders/1aTGwEDRABmD8t8Do3bvEWtGGzS-gHvPa) |
| B06 | TISI Regulations | [Open](https://drive.google.com/drive/folders/1fkaXB5VAwEJsK4IPSEpSlphYXet8MZPf) |
| B07 | Agriculture Regulations | [Open](https://drive.google.com/drive/folders/1USNHLkzESHU4C-rWq8QsD4g9rt0PSvqr) |
| B07 | Aviation Regulation | [Open](https://drive.google.com/drive/folders/1Hlfy-Fp8CWiC1T3MFQE_-Qp5rL8MImIv) |
| B07 | Construction Regulations | [Open](https://drive.google.com/drive/folders/1PVgbHMJLhPv6YM8-pGfLDoZBDsbwHQZE) |
| B07 | DDC Regulations | [Open](https://drive.google.com/drive/folders/1bpL8aBlGF4Haw-YS95d8sMPjLAE7uKIY) |
| B07 | DLT Regulations | [Open](https://drive.google.com/drive/folders/1AqXvQk71AVrrATFUQIQSdVRjoqRLoUvf) |
| B07 | DOH Health Regulations | [Open](https://drive.google.com/drive/folders/13zS2hmttQy-Rt-y1dnsL8t_iS7Lasn5r) |
| B07 | Education & Culture Regulations | [Open](https://drive.google.com/drive/folders/11baQD-yjXebqLqzAIA4jIamOM8hG8VBp) |
| B07 | FDA Regulations | [Open](https://drive.google.com/drive/folders/15n1OQpxNLVeaMGTV2yIIS8UMcr4MT0mm) |
| B07 | HSS Regulations | [Open](https://drive.google.com/drive/folders/1PGRIUEWTGf1s70IBPoMsOWPDeK-aJvTB) |
| B07 | Health | [Open](https://drive.google.com/drive/folders/1yCcf--L1g11uRCqagTCjwdhdnh_C-piv) |
| B07 | MD Regulations | [Open](https://drive.google.com/drive/folders/1LW4ZkzvyoKDmpPhbXNMZpgcy_WnXYSpT) |
| B07 | MOPH Other Regulations | [Open](https://drive.google.com/drive/folders/1K7GQCEaUtSJKaCaVKru2v2BllkgZwdSM) |
| B07 | Roads & Rail Regulations | [Open](https://drive.google.com/drive/folders/15JHfkxuiJrh8eR82MJljc2DfDMfcHUID) |
| B07 | Space Law | [Open](https://drive.google.com/drive/folders/1q9NPkdSSakc7p8-w6wWlgojoYhKGdhFO) |
| B08 | Council of State Opinions | [Open](https://drive.google.com/drive/folders/1ER5P5v0aMPusO1UnS8FB7v6fsEHkpXdI) |
| B09 | CGD Regulations | [Open](https://drive.google.com/drive/folders/1cAtWIoKn-h415LxFednyAzccldQutU4C) |
| B09 | Cabinet Resolutions | [Open](https://drive.google.com/drive/folders/1CUdnikGHMdiFwOsPwDacrWD2OXaHH_cw) |
| B09 | DOPA & DDPM Regulations | [Open](https://drive.google.com/drive/folders/1allqQw8wAHpisRXFtW98xsMYDNCAGClw) |
| B09 | ECT Regulations | [Open](https://drive.google.com/drive/folders/1uk6jSBWD7l9wPVFfDYk0sJ3B5PG_K4qI) |
| B09 | NACC Regulations | [Open](https://drive.google.com/drive/folders/1BAh1gfX47RHHyM-fqgy_1f1vWYHKMjnV) |
| B09 | NHRC Regulations | [Open](https://drive.google.com/drive/folders/1VdYhbjOUbpuczjVt59XphoBGa4fRkl-w) |
| B09 | Ombudsman Regulations | [Open](https://drive.google.com/drive/folders/1O-4_4KkBm8YaoysXSWotoa8tD9ZcI_WL) |
| B09 | Public Administration Regulations | [Open](https://drive.google.com/drive/folders/1yyHc3I-Q8jZw4t_LeB4YwdomRpE4x5tY) |
| B09 | Security & Foreign Affairs Regulations | [Open](https://drive.google.com/drive/folders/1oXjU8ITJR7twJpR1ncZhLFccd3M1T5WR) |
| B09 | State Audit Office (OAG) | [Open](https://drive.google.com/drive/folders/1--dYD_19dgs9EebIFjIUbBtScIgPXgWi) |
| B09 | Treasury & SEPO Regulations | [Open](https://drive.google.com/drive/folders/1gcYYEIwKms7QYnmxIqaPoyWQzn0p8Nov) |
| B10 | Advisory Back Up Doc | [Open](https://drive.google.com/drive/folders/10u8pUbF0CmyLKWEkMdNfnS2Authk6GxD) |
| B10 | Attorney General Regulations | [Open](https://drive.google.com/drive/folders/1oXvGFWDci7nsuc9gjKb6H-I82tDpsrTm) |
| B10 | Constitutional Court | [Open](https://drive.google.com/drive/folders/17_UZynLH99oY93v3dbFp-TOXvnRHLNOs) |
| B10 | Deka Database | [Open](https://drive.google.com/drive/folders/1BpwNu1FmibYUDLtQ6PnEnt6OeogXAvDc) |
| B10 | Justice & Courts Regulations | [Open](https://drive.google.com/drive/folders/1FKdnmnguYbPl_XxUpeJ0lHTBBdA7ws61) |
| B10 | LED Regulations | [Open](https://drive.google.com/drive/folders/1kPB1flCbQiNKN-kKbWh0ct4JSE8pcemG) |
| B10 | Law Books | [Open](https://drive.google.com/drive/folders/1d0hFX1ie8X0dfJG6KNJC89N_C0Lp-6v4) |
| B10 | Law Thesis Library | [Open](https://drive.google.com/drive/folders/1WC2nzehdVVEkGkGxpXaJ0dSqCpIhONqw) |
| B10 | Legal Articles Library | [Open](https://drive.google.com/drive/folders/1RCd9CJBb_xclKVSXk-suMKeo5FL9AGjk) |
| B10 | Legal Forms | [Open](https://drive.google.com/drive/folders/1jNJtHzWoJfGZdDqHzPbuZshNzbOwk-or) |
| B10 | Thai Bar - เนติบัณฑิตยสภา | [Open](https://drive.google.com/drive/folders/1dS128D3yrWhtEjQxvBOJUvkdezFA6Hjy) |
| B10 | Thai law book | [Open](https://drive.google.com/drive/folders/1f6Gm_tDpsYLpFHakziawg4MEAfZZo7w3) |
