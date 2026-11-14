# REG24 — Owner testing checklist for every batch

Use this after the developer marks a candidate READY_FOR_UAT. You should receive a normal application link and a completed test sheet; no database tools are needed.

## Before testing

- [ ] Confirm the batch number, release ID and source cutoff displayed in REG24 match the handover report.
- [ ] Confirm what is included, what is missing and whether this is a pilot or the full frozen batch scope.
- [ ] Receive twenty real, runnable batch cases with expected source evidence; reject a handover containing unresolved fixture placeholders.
- [ ] Receive the developer benchmark, duplicate checks, earlier-batch regressions, known defects and rollback target.
- [ ] Receive page-route/completeness, font-repair/OCR validation and archive/text reconciliation reports. At least five of the twenty cases must exercise source fidelity and actual extraction risks in this batch.

## Test the user journey

For each case: open the specified release → ask the question → set the applicable date → read the answer → open every decisive citation → compare the original passage → inspect related authorities → record Pass/Fail and comments.

| Check | Pass means |
|---|---|
| Relevant answer | It answers the actual question and distinguishes missing material facts. |
| Source support | The cited passage supports the statement, not merely a related topic. |
| Source fidelity | Numbers, dates, negation, exceptions and source wording are correct. |
| Page and record completeness | Source pages, annexes and text/archive records are accounted for; a readable first page does not hide missing later content. |
| Repair provenance | Repaired or OCR text matches the original; real repeated legal language has not been deleted. |
| Authority | Ruling, opinion, statute, judgment and commentary are labeled correctly. |
| Time | The version applies to the requested period, or uncertainty is explicit. |
| Conditions | The answer preserves exceptions and factual limits. |
| Graph usefulness | Related sources help explain the issue, with evidence for each relevant link. |
| No duplication | Multiple copies of one work do not appear as independent legal authorities. |
| Honest uncertainty | Missing, conflicting or insufficient evidence does not produce invented certainty. |
| Earlier batches | Prior accepted questions still work or show a justified, sourced change. |
| Source viewer | The exact page/passage opens and matches the claim. |
| Usability | The full question-to-evidence journey works without developer assistance. |

Run all twenty prepared cases. Add at least five of your own questions, including one deliberately incomplete scenario and one question spanning an earlier batch. Your own questions are additional exploratory checks, not a replacement for the prepared set. Check protected-source behavior only with authorized test accounts supplied by the developer.

## Record a defect

Record: batch, release ID, case/question, applicable date, trace ID, expected behavior, actual behavior, relevant citation and comment. You can simply select “Fail” in the candidate UI and describe what looks wrong; the developer must capture the technical details.

| Severity | Examples | Decision |
|---|---|---|
| P0 | Private-data exposure, destructive graph change, unrecoverable corruption | Stop testing affected paths; block release and investigate. |
| P1 | Wrong decisive legal conclusion, fabricated/misattributed authority, wrong applicable version, unsupported critical figure/deadline, broken decisive citation | Block release; fix underlying cause and rerun tests. |
| P2 | Non-decisive omission, unclear explanation, material usability problem | Correct before acceptance or record an explicit bounded exception. |
| P3 | Cosmetic issue with no evidence/meaning impact | May defer with owner agreement and tracked follow-up. |

Do not mark an uncertain legal conclusion correct simply because it sounds convincing. Send it to the designated legal reviewer; you remain the owner of product acceptance, while qualified review establishes legal benchmark judgments.

## Your decision

- **Pass:** all mandatory cases pass, P0/P1 issues are closed, declared scope is acceptable and technical/legal attestations are supplied.
- **Pass with declared gaps:** the admitted material passes the same quality gates, but specific source/coverage gaps are explicitly accepted and visibly restrict answers. This does not waive correctness or privacy defects.
- **Fail:** one or more mandatory cases fail, key evidence is missing or the declared scope is not acceptable. The developer creates a corrected candidate and returns for retesting.

Acceptance applies only to the exact tested release and manifest hash. The developer must not change the underlying candidate after your decision without revalidation and renewed acceptance. Production promotion occurs after recorded approval; production smoke tests must pass before the next batch starts. After B10, use cross-domain questions and review the final ten-batch coverage/operations report.
