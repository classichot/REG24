import * as fs from "node:fs";
import * as path from "node:path";
import { resolveActiveCitationDbTransport } from "../src/core/knowledge/citation-postgres-store";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadDotEnvLocal();
  const db = resolveActiveCitationDbTransport();
  if (!db) throw new Error("DATABASE_URL not configured for Neon PostgreSQL");
  const sqlPath = path.resolve(
    process.cwd(),
    "prisma/migrations/0007_save_operation_idempotency_key.sql"
  );
  const raw = fs.readFileSync(sqlPath, "utf8");
  const stmts = raw
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/--[^\r\n]*/g, "").trim())
    .filter(Boolean);

  for (const st of stmts) {
    await db(st, []);
  }

  const idx = await db(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE tablename = 'citation_published_answer'
        AND indexname = 'idx_citation_published_answer_save_op_unique'`,
    []
  );
  const cols = await db(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_name = 'citation_published_answer'
        AND column_name IN ('save_operation_key', 'save_payload_sha256')
      ORDER BY column_name`,
    []
  );
  console.log(
    JSON.stringify(
      {
        migration: "0007_save_operation_idempotency_key.sql",
        applied_statements: stmts.length,
        columns: cols.rows,
        unique_index: idx.rows,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
