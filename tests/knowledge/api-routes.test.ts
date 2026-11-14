import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  DurableKnowledgeStore,
  setDefaultKnowledgeStoreForTesting,
} from "../../src/core/knowledge/store";
import { POST as postInventory } from "../../src/app/api/v1/knowledge/batches/[id]/inventory/route";
import { POST as postDryRun } from "../../src/app/api/v1/knowledge/batches/[id]/dry-run/route";
import { POST as postBatchRun } from "../../src/app/api/v1/knowledge/batches/[id]/runs/route";
import { GET as getBatchReport } from "../../src/app/api/v1/knowledge/batches/[id]/report/route";
import { POST as postEvaluate } from "../../src/app/api/v1/knowledge/releases/[id]/evaluate/route";
import { POST as postUatDecision } from "../../src/app/api/v1/knowledge/releases/[id]/uat-decisions/route";
import { POST as postPromote } from "../../src/app/api/v1/knowledge/releases/[id]/promote/route";
import { POST as postQuery } from "../../src/app/api/v1/knowledge/query/route";
import { GET as getEvidence } from "../../src/app/api/v1/knowledge/evidence/[id]/route";

describe("Task F6 — Knowledge GraphRAG Next.js HTTP API Routes & Owner UAT Journey", () => {
  let tempDir: string;
  let store: DurableKnowledgeStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reg24-api-routes-"));
    store = new DurableKnowledgeStore(tempDir);
    setDefaultKnowledgeStoreForTesting(store);
  });

  afterEach(() => {
    setDefaultKnowledgeStoreForTesting(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("Enforces role auth, read-only GET report, 422 B02 sequential gate, anti-spoofed query, evidence drawer, and Owner UAT sign-off", async () => {
    // 1. Freeze B01 inventory via HTTP POST -> 202
    const invReq = new Request("http://localhost:3000/api/v1/knowledge/batches/B01/inventory", {
      method: "POST",
      headers: {
        "x-reg24-csrf": "1",
        "x-reg24-actor-role": "engineering_lead",
        "x-reg24-actor-id": "eng.lead@reg24.th",
      },
    });
    const invRes = await postInventory(invReq, { params: Promise.resolve({ id: "B01" }) });
    expect(invRes.status).toBe(202);
    const invJson = await invRes.json();
    expect(invJson.total_candidates).toBe(5150);

    // 2. Dry-run reconciliation -> 200
    const dryReq = new Request("http://localhost:3000/api/v1/knowledge/batches/B01/dry-run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-reg24-csrf": "1" },
      body: JSON.stringify({ manifest_id: invJson.manifest.manifest_id }),
    });
    const dryRes = await postDryRun(dryReq, { params: Promise.resolve({ id: "B01" }) });
    expect(dryRes.status).toBe(200);

    // 3. Premature B02 run MUST fail with 422 before B01 is accepted (AT16)
    const b02Req = new Request("http://localhost:3000/api/v1/knowledge/batches/B02/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-reg24-csrf": "1",
        "x-reg24-actor-role": "engineering_lead",
      },
      body: JSON.stringify({ idempotency_key: "premature-b02-http" }),
    });
    const b02Res = await postBatchRun(b02Req, { params: Promise.resolve({ id: "B02" }) });
    expect(b02Res.status).toBe(422);

    // 4. Start B01 candidate run (25 docs for fast HTTP test) -> 202
    const b01RunReq = new Request("http://localhost:3000/api/v1/knowledge/batches/B01/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-reg24-csrf": "1",
        "x-reg24-actor-role": "engineering_lead",
      },
      body: JSON.stringify({
        manifest_id: invJson.manifest.manifest_id,
        idempotency_key: "b01-http-run-1",
        max_documents: 25,
      }),
    });
    const b01RunRes = await postBatchRun(b01RunReq, { params: Promise.resolve({ id: "B01" }) });
    expect(b01RunRes.status).toBe(202);

    // 5. Evaluate B01 candidate release -> 200
    const evalReq = new Request(
      "http://localhost:3000/api/v1/knowledge/releases/rel.B01.rc1/evaluate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-csrf": "1",
          "x-reg24-actor-role": "engineering_lead",
        },
        body: JSON.stringify({}),
      }
    );
    const evalRes = await postEvaluate(evalReq, {
      params: Promise.resolve({ id: "rel.B01.rc1" }),
    });
    expect(evalRes.status).toBe(200);

    // 6. Read-only GET report returns READY_FOR_UAT with owner_decision = null and zero state mutations
    const revBeforeGet = store.getState().store_revision;
    const repReq = new Request("http://localhost:3000/api/v1/knowledge/batches/B01/report");
    const repRes = await getBatchReport(repReq, { params: Promise.resolve({ id: "B01" }) });
    expect(repRes.status).toBe(200);
    const repJson = await repRes.json();
    expect(store.getState().store_revision).toBe(revBeforeGet);
    expect(repJson.report.status).toBe("READY_FOR_UAT");
    expect(repJson.report.uat.owner_decision).toBeNull();
    expect(repJson.uat_cases.length).toBe(20);

    // 7. Query endpoint ignores spoofed client `authorized_scopes` in JSON body and resolves real passage via Evidence endpoint
    const qReq = new Request("http://localhost:3000/api/v1/knowledge/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "ค้นหาหนังสือตอบข้อหารือเลขที่ กค 0702/636",
        release_id: "rel.B01.rc1",
        mode: "exact_lookup",
        tenant_id: "SPOOFED_TENANT",
        authorized_scopes: ["scope.tenant.secret_x"],
      }),
    });
    const qRes = await postQuery(qReq);
    expect(qRes.status).toBe(200);
    const qJson = await qRes.json();
    expect(qJson.answer.status).toBe("ANSWERED");
    const passageId = qJson.answer.evidence[0].passage_id;

    const evReq = new Request(
      `http://localhost:3000/api/v1/knowledge/evidence/${encodeURIComponent(passageId)}`
    );
    const evRes = await getEvidence(evReq, { params: Promise.resolve({ id: passageId }) });
    expect(evRes.status).toBe(200);
    const evJson = await evRes.json();
    expect(evJson.evidence.passage.passage_id).toBe(passageId);

    // 8. Non-owner cannot submit UAT decision (403); promotion before approval fails (422)
    const badRoleReq = new Request(
      "http://localhost:3000/api/v1/knowledge/releases/rel.B01.rc1/uat-decisions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-csrf": "1",
          "x-reg24-actor-role": "engineering_lead",
        },
        body: JSON.stringify({
          manifest_hash: repJson.report.manifest_hash,
          expected_revision: repJson.release_record.revision,
          decision: "UAT_PASS",
          comments: "Engineer trying to self-approve UAT",
        }),
      }
    );
    const badRoleRes = await postUatDecision(badRoleReq, {
      params: Promise.resolve({ id: "rel.B01.rc1" }),
    });
    expect(badRoleRes.status).toBe(403);

    const badPromoReq = new Request(
      "http://localhost:3000/api/v1/knowledge/releases/rel.B01.rc1/promote",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reg24-csrf": "1",
          "x-reg24-actor-role": "engineering_lead",
        },
        body: JSON.stringify({
          manifest_hash: repJson.report.manifest_hash,
          expected_active_release_id: null,
        }),
      }
    );
    const badPromoRes = await postPromote(badPromoReq, {
      params: Promise.resolve({ id: "rel.B01.rc1" }),
    });
    expect(badPromoRes.status).toBe(422);
  }, 30000);
});
