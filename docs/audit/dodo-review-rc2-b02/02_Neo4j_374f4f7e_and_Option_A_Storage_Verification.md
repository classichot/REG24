# Neo4j AuraDB `374f4f7e` & Option A Production Storage Verification Report (Instruction 3)

> [!IMPORTANT]
> **Strict Non-Mutation Compliance**: Per Owner Instruction 3 (`2026-11-15`), Neo4j AuraDB instance `374f4f7e` was **neither resumed, replaced, deleted, migrated, nor modified**, no paid infrastructure changes were made, and `data/knowledge-store/canonical-state.json.gz` (`SHA-256 = 08b61fd3626eca0aca8c004dabce1587514f3861f915e4cb90ad1b32a21545e9`) and `https://reg24-theta.vercel.app` remain untouched.

---

## 1. Identity & Live Connectivity Verification of Instance `374f4f7e`

Executed via [`verify-neo4j-374f4f7e-readonly.ts`](file:///d:/Code/REG24/scripts/verify-neo4j-374f4f7e-readonly.ts) (`defaultAccessMode: neo4j.session.READ` + static Cypher write firewall; signed receipt [neo4j_374f4f7e_readonly_verification.json](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/neo4j_374f4f7e_readonly_verification.json), `SHA-256 = 667dd671fc558e83f6f7db4b7f43eadee29fd388402375165a10ef9d806077ab`):

| Property / Probe | Verified Result (`2026-11-15T06:36:59Z`) | Evidence |
| :--- | :--- | :--- |
| **Aura Instance ID & DB Name** | `374f4f7e` (`neo4j+s://374f4f7e.databases.neo4j.io`) | `.env.local` & [`neo4j-client.ts`](file:///d:/Code/REG24/src/core/graph/neo4j-client.ts#L118-L135) |
| **Bolt DB Credentials Present** | `NEO4J_USERNAME=374f4f7e` + `NEO4J_PASSWORD` present | `.env.local` (redacted) |
| **Aura Cloud Management API Keys** | **Not present** (`AURA_CLI_CLIENT_ID` / `NEO4J_AURA_CLIENT_ID` absent) | Cannot query Aura Cloud control-plane metadata from CLI without Owner Console login |
| **DNS `A` / `AAAA` / `_neo4j._tcp` `SRV`** | `ENOTFOUND` (`NXDOMAIN` on all three record types) | Hostname de-registered while AuraDB Free instance is paused (or expired) |
| **TCP `:7687` (Bolt+TLS) & `:443`** | `TCP_TIMEOUT_4000MS` (unreachable) | Direct socket probe |
| **Bolt `READ` Session Probe** | `Could not perform discovery. No routing servers available. Known routing table: RoutingTable[database=374f4f7e, ..., routers=[], readers=[], writers=[]]` | Matches live `GET https://reg24-theta.vercel.app/api/v1/infrastructure/graph/health` |

---

## 2. Current Graph State & Correction of Earlier Assumption (`UNVERIFIED_WHILE_PAUSED`)

> [!WARNING]
> **Explicit Audit Correction — Absence of Batch 01 Data in `374f4f7e` Is `UNVERIFIED_WHILE_PAUSED_OR_OFFLINE`, Not Assumed**:
> Because `374f4f7e.databases.neo4j.io` currently returns `ENOTFOUND` and we are strictly prohibited from resuming it without Owner approval, **zero live Cypher queries can reach `374f4f7e` right now**. Furthermore, full Git history audit disproved our earlier summary claim that `374f4f7e` only ever received `352` seed nodes: in October 2026, `374f4f7e` held **9,242 nodes and 9,096 relationships**.

### Complete Repository-Wide Neo4j Write Audit vs. Unverified Live State

| Date & Commit | Code Path | What Repository History Proves | Live `374f4f7e` Verification Status |
| :--- | :--- | :--- | :--- |
| **20 Oct 2026** (`8fd220b`, `dd91850`) | [`graph-migrator.ts`](file:///d:/Code/REG24/src/core/graph/graph-migrator.ts#L1170-L1275) (`runGraphMigration`) | Upserted `352` core seed nodes and `523` relationships (including `10` seed `:TaxRuling` nodes from `reg24-core.ts`) into `374f4f7e`. | Recorded in commit `dd91850`; current presence inside `374f4f7e` **pending live read check**. |
| **21 Oct 2026** (`802fdb6`, `2f06b30`) | [`legal-chunk-neo4j-sync.ts`](file:///d:/Code/REG24/src/core/ingestion/legal-chunk-neo4j-sync.ts#L40-L345) (`syncLegalResourceMasterChunksToNeo4j`) | Upserted `17` `:Regulator` (`reg.th.lrm.*`), `2,312` `:LegalInstrument` (`inst.lrm.*`), and structural `:Provision` chunks across 17 authorities — recording **`9,242` live nodes and `9,096` live relationships** in [`agentic-legal-research-engine.ts`](file:///d:/Code/REG24/src/core/agentic-rag/agentic-legal-research-engine.ts#L11) (`L1037-L1038`). | Recorded in `2f06b30`; current presence inside `374f4f7e` **pending live read check**. |
| **14 Nov 2026** (`bbdca54`..`7df41c4`) | [`releases.ts`](file:///d:/Code/REG24/src/core/knowledge/releases.ts), [`projections.ts`](file:///d:/Code/REG24/src/core/knowledge/projections.ts), [`materialize-b01-candidate.ts`](file:///d:/Code/REG24/scripts/materialize-b01-candidate.ts#L40) | Zero `executeCypher` write calls exist in `src/core/knowledge/*`; `materialize-b01-candidate.ts` ran with `probeLiveNeo4j: false` ([F1_baseline_verification.json](file:///d:/Code/REG24/data/knowledge-store/reports/F1_baseline_verification.json#L16-L22)) and wrote `rel.B01.rc1` (`35,805` edges) to `projections/rel.B01.rc1_graph.json.gz`. | **Formally `UNVERIFIED_WHILE_PAUSED_OR_OFFLINE`** — cannot confirm zero Batch 01 / manual / ad-hoc data in `374f4f7e` until `374f4f7e` is inspected directly. |

---

## 3. Backups, Recovery & Urgent 30-Day AuraDB Free Deletion Window

> [!CAUTION]
> **Time-Sensitive Data Retention Risk (`~23–27 November 2026`)**:
> Under Neo4j AuraDB Free policy:
> 1. Instances **auto-pause after 72 hours of write inactivity** (read queries do not reset the timer).
> 2. Paused AuraDB Free instances have **no automated recurring cloud backups** (only manual on-demand `.dump` snapshots in the Aura Console).
> 3. If a paused AuraDB Free instance is **not resumed within 30 days of being paused, Neo4j permanently deletes the instance and all of its data**.
>
> Given the last Neo4j-related commits in Git occurred on **21–25 October 2026** (`802fdb6`, `7b4447a`), `374f4f7e` likely entered `Paused` state around **24–28 October 2026** — placing today (**15 November 2026**) at **~18–22 days paused**, with permanent auto-deletion estimated around **23–27 November 2026**.

### Step-by-Step Read-Only Verification Protocol (Requires Owner Console Access)
1. **Console Status Check (Zero Resume / Zero Cost)**: Log into `https://console.neo4j.io` and inspect instance `374f4f7e` (`status`: `Paused` vs. deleted, pause timestamp, node/relationship counters, and whether an existing manual snapshot is listed under *Snapshots*).
2. **Optional Authorised Read-Only Inspection & Archival Export**: If `374f4f7e` is `Paused` and you authorise a temporary resume solely for verification/backup:
   - Export an on-demand `.dump` snapshot in Aura Console for archival preservation, and
   - Run `npx tsx scripts/verify-neo4j-374f4f7e-readonly.ts --out aura_374f4f7e_live_audit.json` (which uses `neo4j.session.READ` + a hard write-blocking regex firewall) to produce a signed SHA-256 inventory of every label, `migration_batch_id`, `work.th.rd.*`, and `rel.B01.*` count inside `374f4f7e`.

---

## 4. Option A Cost Evaluation (Managed PostgreSQL + Neo4j AuraDB Professional)

No paid resources have been provisioned. Below are verified 2026 USD rates (`730 hrs/month` continuous 24/7 operation):

### 4.1 Transactional Governance & Canonical State Layer — Managed PostgreSQL
| Provider & Tier | Billing Model | Compute / RAM / Storage Included | Backups & PITR | Typical Monthly Cost (USD) | Fit for REG24 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Neon Launch** | Serverless usage (`\$0.106/CU-hr` + `\$0.35/GB-mo`) | Autoscaling `0.25–4 CU` (`1–16 GB RAM`), scale-to-zero or pinned | Instant PITR history (`\$0.20/GB-mo`) + DB branching | **\$15 – \$35 / mo** | Best for low idle cost + isolated staging branches per release candidate |
| **Supabase Pro** | Fixed subscription + usage | Dedicated Micro compute (`\$10` credit included), `8 GB` SSD | Automated daily backups (7-day retention; PITR add-on available) | **\$25 – \$40 / mo** | Predictable flat billing; matches existing RLS migration [`0001_reg24_canonical_rls.sql`](file:///d:/Code/REG24/prisma/migrations/0001_reg24_canonical_rls.sql) |
| **AWS RDS PostgreSQL** (`db.t4g.small` / `medium`) | Provisioned hourly (`24/7`) | `2 vCPU`, `2–4 GiB RAM`, `20 GB gp3` SSD | Automated daily snapshots + up to 35-day continuous PITR | **\$28 – \$55 / mo** (Single-AZ)<br>**\$56 – \$110 / mo** (Multi-AZ) | Highest enterprise compliance control if deploying in AWS ap-southeast-1 |

### 4.2 Graph Traversal Projection Layer — Neo4j AuraDB Professional
AuraDB Professional bills at **\$0.09 / GB RAM / hour** (`never` auto-pauses or auto-deletes on idle; includes `2x RAM` SSD storage, automated daily backups, and 30-day backup retention):

| AuraDB Pro Tier | Hourly Rate | Monthly Cost (`730h`) | Storage Quota | Capacity Fit Across REG24's 10-Batch Roadmap |
| :--- | :--- | :--- | :--- | :--- |
| **1 GB RAM** | \$0.09 / hr | **\$65.70 / mo** | `2 GB` SSD | Sufficient for **Batches B01 + B02** (`~6,600` works, `~57,400` assertion edges) |
| **2 GB RAM** | \$0.18 / hr | **\$131.40 / mo** | `4 GB` SSD | Recommended for **Batches B01 – B05** (`~150k–250k` nodes / `~500k` edges) |
| **4 GB RAM** | \$0.36 / hr | **\$262.80 / mo** | `8 GB` SSD | Full **10-Batch target** (`500k+` nodes / `1.6M+` edges) |

### 4.3 Combined Option A Monthly Run-Rate Summary
- **Initial Production (B01 + B02 — 1 GB AuraDB Pro + Neon/Supabase Pro)**: **~\$81 – \$106 / month**
- **Mid-Roadmap Scale (B01 – B05 — 2 GB AuraDB Pro + Supabase Pro / RDS Single-AZ)**: **~\$156 – \$186 / month**

---

## 5. Proposed Option A Durable Storage & Two-Phase Rollback Design

Draft DDL prepared for review (not applied) at [`0002_knowledge_releases_cas_and_outbox.sql`](file:///d:/Code/REG24/prisma/migrations/0002_knowledge_releases_cas_and_outbox.sql), extending [`0001_reg24_canonical_rls.sql`](file:///d:/Code/REG24/prisma/migrations/0001_reg24_canonical_rls.sql):

```mermaid
sequenceDiagram
  participant API as Vercel API Worker
  participant PG as PostgreSQL (System of Record)
  participant W as Outbox Worker
  participant Neo as Neo4j AuraDB Pro (Graph Projection)

  API->>PG: BEGIN; SELECT store_revision FROM knowledge_store_coordinator FOR UPDATE
  PG-->>API: Verify expected_revision (409 StaleRevisionError on mismatch)
  API->>PG: INSERT audit_log_chain (UNIQUE sequence_no + SHA-256 prev_hash)
  API->>PG: INSERT knowledge_release_approval / UPDATE knowledge_release
  API->>PG: INSERT knowledge_neo4j_projection_outbox (status = PENDING)
  API->>PG: COMMIT
  W->>PG: Claim PENDING outbox row
  W->>Neo: Idempotent MERGE nodes & edges tagged with release_id + manifest_hash
  Neo-->>W: Verify node_count & edge_count == manifest checksums (Gate V06 / AT12)
  W->>PG: Mark outbox VERIFIED_COMPLETED & swap active_release_id atomically
```

1. **Zero Lost Updates Across Serverless Instances (`DEF-B01-07`)**: Every state transition, UAT approval, promotion, and rollback runs inside a single PostgreSQL ACID transaction acquiring `SELECT ... FOR UPDATE` on `knowledge_store_coordinator`, checking `expected_revision`, appending to `audit_log_chain` (`UNIQUE(sequence_no)`), and enforcing `UNIQUE (release_id, manifest_hash, approval_kind, expected_release_revision)` on `knowledge_release_approval`.
2. **Database-Enforced Quarantine Invariant (`DEF-B01-03`)**: `knowledge_quarantine_ledger` enforces `CHECK (quarantine_status = 'UNRESOLVED_QUARANTINED')` and `CHECK (usable_as_legal_evidence = FALSE)` at the SQL schema level so unverified citations cannot be flipped to legal evidence without verified ingestion.
3. **Transparent Supersession Lineage (`Instruction 2`)**: `knowledge_release` stores `supersedes_release_id`, `supersedes_manifest_id`, `supersedes_manifest_hash`, `supersession_explanation`, and `prior_chat_approval_preserved` while keeping `rel.B01.rc1` immutable.
4. **Two-Phase Non-Destructive Rollback (`< 5s` RTO)**:
   - **Phase 1 (Immediate Read Cutover in PostgreSQL)**: Single ACID commit reverts `knowledge_store_coordinator.active_release_id` to `rollback_target_release_id` (`rel.B01.rc2` when rolling back `B02`, or `NULL` prior to first production cutover), appends a `ROLLED_BACK` receipt to `knowledge_release_approval`, and enqueues `DEACTIVATE_ROLLED_BACK_RELEASE` in `knowledge_neo4j_projection_outbox`. All live queries immediately pin to the restored `active_release_id`.
   - **Phase 2 (Shared-Work-Safe Graph Cleanup in Neo4j)**: Outbox worker deletes only assertion edges with `{release_id: $rolledBackReleaseId}` and detaches only nodes not referenced by any other active or preserved release — guaranteeing shared statutory nodes (`prov.th.rc.65_ตรี`, `statute.th.revenue_code`) and preserved audit history remain intact.
