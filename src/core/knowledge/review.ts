/**
 * REG24 — Task F3: Human Review Queue, Stratified 5% (Min 20) Audit Sampler & Defect Stratum Expansion
 * Implements Section 6 & SH-17.
 */

import { sha256Bytes } from "./identity";
import type { Actor, BatchId } from "./contracts";
import type { DurableKnowledgeStore, ReviewQueueItem } from "./store";

export function enqueueReviewItem(
  store: DurableKnowledgeStore,
  item: Omit<ReviewQueueItem, "review_id" | "status" | "reviewer_id" | "decision_note" | "created_at" | "decided_at">
): ReviewQueueItem {
  const now = new Date().toISOString();
  const reviewId = `rev.${item.batch_id.toLowerCase()}.${sha256Bytes(`${item.category}:${item.work_id || item.candidate_id}:${now}:${Math.random()}`).slice(0, 10)}`;
  const full: ReviewQueueItem = {
    ...item,
    review_id: reviewId,
    status: "PENDING",
    reviewer_id: null,
    decision_note: null,
    created_at: now,
    decided_at: null,
  };
  store.transactSync("ENQUEUE_REVIEW", (s) => {
    s.reviews[reviewId] = full;
  });
  return full;
}

/**
 * Reproducible deterministic stratified audit sample of >= 5% of accepted documents,
 * minimum 20 per run (or the entire run if smaller), per Section 6.
 */
export function selectStratifiedAuditSample(
  docs: Array<{ work_id: string; stratum: string }>,
  fraction = 0.05,
  minDocs = 20,
  seed = "reg24.audit.2026"
): Array<{ work_id: string; stratum: string }> {
  if (docs.length <= minDocs) {
    return [...docs];
  }

  const byStratum = new Map<string, Array<{ work_id: string; stratum: string }>>();
  for (const d of docs) {
    const arr = byStratum.get(d.stratum) || [];
    arr.push(d);
    byStratum.set(d.stratum, arr);
  }

  const targetTotal = Math.max(minDocs, Math.ceil(docs.length * fraction));
  const selected = new Map<string, { work_id: string; stratum: string }>();

  for (const [stratum, bucket] of byStratum.entries()) {
    const sorted = [...bucket].sort((a, b) =>
      sha256Bytes(`${seed}:${stratum}:${a.work_id}`).localeCompare(
        sha256Bytes(`${seed}:${stratum}:${b.work_id}`)
      )
    );
    const quota = Math.max(1, Math.ceil((bucket.length / docs.length) * targetTotal));
    for (const item of sorted.slice(0, quota)) {
      selected.set(item.work_id, item);
    }
  }

  if (selected.size < targetTotal) {
    const remaining = docs
      .filter((d) => !selected.has(d.work_id))
      .sort((a, b) =>
        sha256Bytes(`${seed}:fill:${a.work_id}`).localeCompare(
          sha256Bytes(`${seed}:fill:${b.work_id}`)
        )
      );
    for (const r of remaining) {
      if (selected.size >= targetTotal) break;
      selected.set(r.work_id, r);
    }
  }

  return Array.from(selected.values());
}

/**
 * Records a human reviewer's decision. If a CRITICAL defect is detected in a stratum,
 * expands audit coverage of that entire stratum to 100% and blocks promotion until resolved (Section 6).
 */
export function decideReviewItem(
  store: DurableKnowledgeStore,
  params: {
    review_id: string;
    decision: "APPROVED" | "CORRECTED" | "REJECTED_DEFECT";
    note: string;
    actor: Actor;
    allDocsInBatch?: Array<{ work_id: string; stratum: string; release_id: string }>;
  }
): { item: ReviewQueueItem; expanded_stratum_count: number } {
  if (params.actor.role !== "legal_reviewer" && params.actor.role !== "engineering_lead") {
    throw new Error("FORBIDDEN_403: Only qualified legal_reviewer or engineering_lead may record review decisions.");
  }

  let expandedCount = 0;
  const updated = store.transactSync("DECIDE_REVIEW", (s) => {
    const item = s.reviews[params.review_id];
    if (!item) throw new Error(`REVIEW_NOT_FOUND:${params.review_id}`);
    item.status = params.decision;
    item.reviewer_id = params.actor.actor_id;
    item.decision_note = params.note;
    item.decided_at = new Date().toISOString();

    if (params.decision === "REJECTED_DEFECT" && params.allDocsInBatch) {
      const existingReviewedWorks = new Set(
        Object.values(s.reviews).map((r) => r.work_id).filter(Boolean)
      );
      const affected = params.allDocsInBatch.filter(
        (d) => d.stratum === item.stratum && !existingReviewedWorks.has(d.work_id)
      );
      for (const doc of affected) {
        const expId = `rev.exp.${sha256Bytes(`${item.review_id}:${doc.work_id}`).slice(0, 10)}`;
        s.reviews[expId] = {
          review_id: expId,
          batch_id: item.batch_id,
          release_id: doc.release_id,
          work_id: doc.work_id,
          candidate_id: null,
          category: "STRATIFIED_AUDIT",
          stratum: doc.stratum,
          severity: "HIGH",
          summary: `100% stratum audit expansion triggered by critical defect ${item.review_id}`,
          evidence_locator_summary: doc.work_id,
          status: "PENDING",
          reviewer_id: null,
          decision_note: null,
          created_at: new Date().toISOString(),
          decided_at: null,
        };
        expandedCount += 1;
      }
    }

    return { ...item };
  });

  return { item: updated, expanded_stratum_count: expandedCount };
}
