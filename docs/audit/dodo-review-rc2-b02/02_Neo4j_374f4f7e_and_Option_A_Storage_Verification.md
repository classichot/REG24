# Neo4j `374f4f7e` Preservation Protocol & Option A Production Architecture / Cost Proposal (Instructions 1 & 4)

> [!CAUTION]
> **IMMEDIATE PRESERVATION DEADLINE FLAG (`~23–27 November 2026` — Estimated `8–12 Days` Remaining)**
> - Neo4j AuraDB Free auto-pauses instances after **72 hours** of write inactivity and **permanently deletes paused instances and all data after 30 days** (with **zero** automated recurring cloud backups while paused).
> - Last Neo4j sync commits in Git occurred on **21–25 October 2026** (`802fdb6`, `7b4447a`), placing estimated auto-pause at **24–28 October 2026** and **irreversible 30-day deletion at `~23–27 November 2026`**.
> - **Sanctioned Scope Boundary Flagged First (`Instruction 1`)**: This workspace contains Bolt database credentials (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE=374f4f7e`) in `.env.local`, but **zero** Neo4j Aura Cloud Console session or Management API keys (`AURA_CLI_CLIENT_ID` / `NEO4J_AURA_CLIENT_ID` absent), **zero** Vercel admin tokens, and **zero** local `docker` / `java` / `neo4j-admin` binaries on this host. Confirming pause status, clicking *Resume*, and exporting the `.backup` / `.dump` snapshot in `https://console.neo4j.io` therefore require Owner Console execution following the pre-resume writer-lockout checklist in Section 1 below.

---

## 1. Neo4j `374f4f7e` Pre-Resume Writer Lockout, Fixed Read-Only Verifier & Isolated-Restore Protocol (`Instruction 1`)

### 1.1 Pre-Resume Writer Audit & Live Vercel Lockout Requirement
Before resuming `374f4f7e` in Aura Console, we audited every Neo4j call site across the repository and deployment configuration:
- **Background / Scheduled Jobs**: **Zero** (`0` `vercel.json` crons, `0` `.github/workflows` jobs, `0` background daemons).
- **UI Page Loads**: Read-only (`GET /api/v1/infrastructure/graph/health` runs `MATCH (n) ... RETURN nodeCount, count(r)`).
- **CRITICAL HAZARD FOUND ON LIVE VERCEL (`main` @ `7df41c4`)**: Live `https://reg24-theta.vercel.app` holds `NEO4J_URI` + `NEO4J_PASSWORD` and exposes **3 unauthenticated HTTP `POST` endpoints** that default a missing `x-reg24-role` header to `"Platform Administrator"` and execute live `MERGE` / `DETACH DELETE` against `374f4f7e` if invoked while `374f4f7e` is online:
  1. `POST /api/v1/infrastructure/graph/health` (`action: "run_migration"` / `"rollback_batch"`)
  2. `POST /api/v1/infrastructure/graph/audit` (`action: "sync_and_audit_neo4j"`)
  3. `POST /api/v1/legal/resource-master` (`action: "sync_chunks_to_neo4j"`)
- **Code Hardening Completed on Staging (`3c3034763128f22865c10c88274f468c5752bc09`)**:
  - Removed default `"Platform Administrator"` role fallbacks on all 3 mutating routes ([`health/route.ts`](file:///d:/Code/REG24/src/app/api/v1/infrastructure/graph/health/route.ts#L77-L108), [`audit/route.ts`](file:///d:/Code/REG24/src/app/api/v1/infrastructure/graph/audit/route.ts#L36-L59), [`resource-master/route.ts`](file:///d:/Code/REG24/src/app/api/v1/legal/resource-master/route.ts#L208-L232)) so unauthenticated `POST` requests return `403 Forbidden`.
  - Added process-wide `NEO4J_PRESERVATION_READ_ONLY=true` enforcement in [`neo4j-client.ts`](file:///d:/Code/REG24/src/core/graph/neo4j-client.ts#L63-L70) (`L226-L241`) returning `423 Locked` (`NEO4J_PRESERVATION_LOCKOUT_423`) on any write/DDL call.
- **Mandatory Owner Step Before Clicking *Resume* in Aura Console**:
  1. In **Vercel Project Settings -> Environment Variables** (`reg24-theta`), temporarily remove or blank `NEO4J_PASSWORD` (or `NEO4J_URI`) **before** resuming `374f4f7e` (or immediately rotate the database password in Aura Console upon resume and do **not** update Vercel), severing all live application reconnect paths.

### 1.2 Audit Script Fixes & Retest Results ([`verify-neo4j-374f4f7e-readonly.ts`](file:///d:/Code/REG24/scripts/verify-neo4j-374f4f7e-readonly.ts))
Both defects identified in `verify-neo4j-374f4f7e-readonly.ts` have been fixed and verified in [`neo4j-readonly-verifier.test.ts`](file:///d:/Code/REG24/tests/knowledge/neo4j-readonly-verifier.test.ts) (`6 / 6` tests passing):
1. **Strict Target & Server Identity Validation (`validateAuditTarget` + `CALL db.info()`)**:
   - Removed the silent fallback to `"374f4f7e.databases.neo4j.io"` and `"neo4j"`: missing `NEO4J_URI`, non-TLS schemes, mismatched Aura instance IDs (`!= "374f4f7e"`), or mismatched database names (`!= "374f4f7e"`) abort before network connect with `TARGET_VALIDATION_FAILED`.
   - Added server-side database verification (`CALL db.info() YIELD name RETURN name`) inside `session.executeRead(...)` so a misrouted DB immediately throws `DATABASE_IDENTITY_MISMATCH`.
   - Added `--target-mode isolated-restore --bolt-uri bolt://127.0.0.1:7687 --backup-file <path> --expected-sha256 <hex>`, which strictly requires a loopback host (`127.0.0.1` / `localhost`), **hard-blocks `*.databases.neo4j.io`**, verifies the `.backup` / `.dump` SHA-256 digest (`verifyBackupFileChecksum`), and audits the isolated restored copy strictly via `neo4j.session.READ` + `session.executeRead(...)` + `assertStrictlyReadOnlyCypher`.
2. **Dynamic Actual Failure Reporting (`classifyAuditFailure`)**:
   - Replaced the hardcoded DNS-paused message with stage-specific reporting (`TARGET_VALIDATION_FAILED`, `BACKUP_FILE_VERIFICATION_FAILED`, `DNS_RESOLUTION_FAILED`, `TCP_CONNECT_FAILED`, `BOLT_AUTHENTICATION_FAILED`, `BOLT_TLS_ERROR`, `DATABASE_IDENTITY_MISMATCH`, `BOLT_ROUTING_OR_PROTOCOL_FAILED`, `CYPHER_READ_QUERY_FAILED`).
   - Current live read-only receipt ([`neo4j_374f4f7e_readonly_verification.json`](file:///C:/Users/I7/.gemini/antigravity/brain/ade02dfd-8b7a-4fcf-a521-8f458561a22a/scratch/neo4j_374f4f7e_readonly_verification.json), `report_sha256 = 8fda57b2a6f263d57342172d6dbeee5b31621f16c9c9cd39301ecfdca4b59e7f`):
     - `target_validation.valid`: **`true`** (`observed_aura_instance_id = "374f4f7e"`, `expected_database_name = "374f4f7e"`)
     - `verification_status`: **`DNS_RESOLUTION_FAILED`** (`observed_error_code = "ENOTFOUND"`, quoting exact `queryA` / `queryAaaa` / `querySrv` responses; live graph counts remain formally **unverified** until backup export & isolated restore).

### 1.3 Safe Preservation, Export & Isolated-Restore Sequence (Zero Charge / Zero Live Graph Mutation)
1. **Verify in `https://console.neo4j.io`**: Confirm instance ID `374f4f7e`, tier (`AuraDB Free`), current status (`Paused`), pause date, and remaining days before deletion.
2. **Lock Out Writers**: Blank/remove `NEO4J_PASSWORD` in Vercel Environment Variables (`reg24-theta`) and set `NEO4J_PRESERVATION_READ_ONLY=true` locally.
3. **Resume & Export Supported Snapshot**: Resume `374f4f7e` in Aura Console -> *Snapshots* -> *Take snapshot* -> download `.backup` / `.dump` to encrypted offline storage and record `Get-FileHash <file> -Algorithm SHA256`.
4. **Restore & Audit in Isolated Local Container (Preferred Over Querying Live `374f4f7e`)**:
   ```bash
   docker run --rm -v /secure/backups:/backups neo4j:5-enterprise neo4j-admin database load 374f4f7e --from-path=/backups
   # Start isolated container bound ONLY to 127.0.0.1:7687, then run read-only verifier:
   npx tsx scripts/verify-neo4j-374f4f7e-readonly.ts --target-mode isolated-restore --bolt-uri bolt://127.0.0.1:7687 --username neo4j --password <local_pw> --database 374f4f7e --backup-file /secure/backups/374f4f7e.dump --expected-sha256 <sha256> --out aura_374f4f7e_isolated_restore_audit.json
   ```

---

## 2. Option A Itemised Production Proposal: Managed PostgreSQL + Neo4j AuraDB (`Instruction 4`)

*For evaluation only — no provider selected and no paid plan provisioned.*

### 2.1 Regional Co-Location & Topology
- **Recommended Region**: **`ap-southeast-1` (AWS Singapore)** for Managed PostgreSQL and **`asia-southeast1` / `ap-southeast-1` (Singapore)** for Neo4j AuraDB, co-located with Vercel Edge/Function region **`sin1` (Singapore)** (`< 3–8 ms` intra-region DB RTT; `~25–35 ms` end-user RTT from Bangkok).

### 2.2 Itemised Component Specification (Availability, Backup/Recovery, Security & Monthly Charges)

| Dimension | Option A-1: **AWS RDS PostgreSQL** (Enterprise Baseline) | Option A-2: **Supabase Pro / Neon Launch** (Lean Managed PG) | Graph Projection: **Neo4j AuraDB Professional** |
| :--- | :--- | :--- | :--- |
| **Region** | AWS `ap-southeast-1` (Singapore) | AWS `ap-southeast-1` (Singapore) | GCP `asia-southeast1` / AWS `ap-southeast-1` (Singapore) |
| **Recommended Tier (`B01–B02` Launch)** | `db.t4g.small` (`2 vCPU`, `2 GiB RAM`, `20 GB gp3` SSD) — Single-AZ (`Multi-AZ` optional for `99.95%` HA) | Supabase Pro (`Dedicated Micro 2 vCPU / 1 GB` + `8 GB` SSD) or Neon Launch (`0.25–2 CU`, `10 GB`) | **AuraDB Professional `1 GB RAM`** (`2 GB` SSD, dedicated non-pausing instance; **never** auto-deletes on idle) |
| **Availability & SLA** | Single-AZ: `99.5%` \| **Multi-AZ Standby**: **`99.95%` SLA** (`< 60s` automatic failover) | Supabase Pro: `99.9%` \| Neon Launch/Scale: `99.95%` multi-AZ storage separation | `99.5%` SLA (AuraDB Pro) \| `99.95%` Multi-AZ HA available on AuraDB Business Critical |
| **Backup, PITR, RPO & RTO** | Continuous WAL archiving to S3 (**`35-day` PITR**, **`RPO < 5 min`**, **`RTO ~10–15 min`**) + daily snapshots + pre-release logical `.dump` | Daily automated backups (`7-day` retention) + **7-day continuous PITR add-on** (`RPO < 2 min`, `RTO ~5–10 min`) | Automated daily snapshots (**`30-day` retention** on Pro vs `0` on Free) + on-demand pre-promotion snapshots (`RPO = 0` per batch release because graph is deterministically rebuildable from PostgreSQL outbox in `< 4 min`) |
| **Security Controls** | TLS `1.3` enforced (`rds.force_ssl=1`), KMS `AES-256` at rest, private VPC / egress IP allowlist, separate `reg24_app_rw` / `reg24_audit_ro` roles, PostgreSQL RLS ([`0001_reg24_canonical_rls.sql`](file:///d:/Code/REG24/prisma/migrations/0001_reg24_canonical_rls.sql)), 90-day secret rotation | TLS `1.3`, `AES-256` at rest, PgBouncer connection pooling (`transaction` mode for Vercel bursts), RLS enforced, IP restrictions (add-on), role separation | Mandatory `neo4j+s://` TLS `1.3`, `AES-256` encrypted volumes, dedicated `reg24_outbox_writer` vs `reg24_query_reader` credentials, parameterized-Cypher firewall, dynamic credential rotation ([`neo4j-client.ts`](file:///d:/Code/REG24/src/core/graph/neo4j-client.ts#L142-L173)) |
| **Itemised Monthly Cost (`B01–B02`)** | Compute (`730h`): **\$26.28** (Single-AZ) / **\$52.56** (Multi-AZ)<br>Storage (`20 GB gp3`): **\$2.76**<br>PITR/Backups (`+20 GB`): **\$1.90**<br>Egress (`~5 GB`): **\$0.60**<br>**Subtotal PG**: **\$31.54 / mo** (Single-AZ) or **\$57.82 / mo** (Multi-AZ) | Base plan: **\$25.00 / mo** (includes `\$10` Micro compute + `8 GB` DB)<br>7-day PITR add-on (optional): **+\$100.00 / mo** (Supabase) or **\$19–\$34 / mo** all-in on Neon Launch (`7-day` PITR included) | Compute + Storage (`1 GB RAM / 2 GB SSD` @ `\$0.09/hr x 730h`): **\$65.70 / mo**<br>Automated 30-day daily backups: **\$0.00 (included)**<br>Intra-region transfer (`< 10 GB`): **~\$0.90 / mo**<br>**Subtotal Neo4j**: **\$66.60 / mo** |

### 2.3 Combined Monthly Run-Rate & 10-Batch Growth Assumptions (`B01` .. `B10`)

| Roadmap Phase | Cumulative Corpus Assumptions | Canonical Works / Passages / Graph Edges | PostgreSQL Footprint (incl. JSONB, Vector/Lexical & WAL Audit) | Neo4j Footprint & Recommended Tier | Expected Combined Monthly Charge (USD) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1: `B01` + `B02` (Limited-Scope)** | `6,602` admitted files (`4,578` RD rulings + `2,024` statutes/sub-regs) | `~13.6k` works / `23.4k` passages / `57.4k` edges | `~0.65 GB` data + `~0.3 GB` indexes/WAL (`< 1.5 GB`) | `~0.35 GB` graph store -> **AuraDB Pro `1 GB`** (`\$66.60`) + PG (`\$25–\$58`) | **\$91.60 – \$124.42 / mo** |
| **Phase 2: `B01` + Full `B02` (Post-OCR of `5,275` Scans)** | `11,877` files (`+41,247` verified OCR Gazette pages) | `~32k` works / `~95k` passages / `~190k` edges | `~2.8 GB` data + `~1.4 GB` indexes/WAL (`~4.2 GB`) | `~1.1 GB` graph store -> **AuraDB Pro `2 GB`** (`\$131.40`) + PG `20 GB` (`\$32–\$60`) | **\$163.40 – \$191.40 / mo** |
| **Phase 3: `B01` – `B05`** *(+BOI/DBD, BOT/SEC/OIC, Labour/PDPA)* | `~28,000` files (`~140k` pages) | `~85k` works / `~260k` passages / `~520k` edges | `~8.5 GB` data + `~4.0 GB` indexes/WAL (`~12.5 GB`) | `~2.6 GB` graph store -> **AuraDB Pro `4 GB`** (`\$262.80`) + PG `db.t4g.medium` `30 GB` (`\$65–\$118`) | **\$327.80 – \$380.80 / mo** |
| **Phase 4: `B01` – `B10` Full Target** *(+Sectoral, Council of State, Supreme Court `ฎีกา`)* | `~65,000+` files (`~380k` pages) | `~210k` works / `~680k` passages / `~1.55M` edges | `~24 GB` data + `~12 GB` indexes/WAL (`~36 GB`) | `~6.2 GB` graph store -> **AuraDB Pro `8 GB`** (`\$525.60`) + PG `db.t4g.large` Multi-AZ `60 GB` (`\$195`) | **\$720.60 / mo** |

*(Note: Verified OCR execution for the `5,275` deferred `B02` pages [`41,247` pages] is a separate one-time ingestion job cost estimated at `~\$62–\$165` total depending on OCR provider policy in `RAG24`, gated by budget reservations before dispatch.)*

---

## 3. Durable-Storage Integration Test Results (`Instruction 4`)

All durable-storage, transactional concurrency, SQL schema constraint, crash-recovery, and rollback tests are green (**`29 / 29` suites, `157 / 157` tests passing**):

1. **Relational SQL WAL + CAS + Outbox Integration Suite ([`option-a-durable-storage-integration.test.ts`](file:///d:/Code/REG24/tests/knowledge/option-a-durable-storage-integration.test.ts)) — `PASS`**:
   - Compiles [`0002_knowledge_releases_cas_and_outbox.sql`](file:///d:/Code/REG24/prisma/migrations/0002_knowledge_releases_cas_and_outbox.sql) directly onto a disk-backed ACID SQL database (`node:sqlite` in `WAL` + `synchronous = FULL` + `FOREIGN KEYS = ON` mode) across multiple independent database connections (`connA`, `connB`, `connC`):
   - **Atomic State + Audit Rollback**: Simulated mid-transaction crash after `UPDATE knowledge_release` and `UPDATE knowledge_store_coordinator` (before `audit_log_chain` commit) rolled back **100%** of changes (`state = READY_FOR_UAT`, `revision = 1`, `store_revision = 0`, `0` orphan audit rows).
   - **Two-Connection Concurrent Approval Race (`DEF-B01-07`)**: Both `connA` and `connB` read `revision = 1`; `connA` committed `UAT_PASS` (`revision -> 2`, `audit_sequence_no = 1`), and `connB`'s concurrent `UAT_FAIL` at stale `revision = 1` was deterministically rejected with `REVISION_CONFLICT_409` (`0` lost updates).
   - **Database-Enforced Quarantine Non-Evidence Check**: Verified SQL `CHECK (usable_as_legal_evidence = 0)` blocked `UPDATE knowledge_quarantine_ledger SET usable_as_legal_evidence = 1` on Royal Decree `736` (`uref.subreg.th.rc.royal_decree.736...`) at the storage engine level.
   - **Cold-Restart Durability & Hash-Chain Verification**: Closed all connections, reopened cold from disk (`connC`), and verified `rel.B01.rc1` preservation, `rel.B01.rc2` supersession lineage, SHA-256 `audit_log_chain` hash continuity, and `VERIFIED_COMPLETED` Neo4j outbox checksum match (`5,066` nodes / `29,094` edges).
2. **Multi-Process OS Concurrency, Crash Journal & Serverless Guard Suite ([`concurrency-and-recovery.test.ts`](file:///d:/Code/REG24/tests/knowledge/concurrency-and-recovery.test.ts)) — `5 / 5 PASS`**:
   - `5/5` 2-process barrier races with `0` lost updates; `4` OS processes x `5` commits (`20/20` unique monotonic WAL `seq`); interrupted `.staged-commits/` crash journal recovery; `/tmp` serverless promotion hard-blocked with `422`.
