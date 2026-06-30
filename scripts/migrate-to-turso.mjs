/* One-off / re-runnable: copy every user table from the local SQLite file
   (data/pallisade.db) into the Turso database. Idempotent — each table is
   cleared then re-inserted, so running it again re-syncs local → Turso.

   Usage (keep creds OUT of your shell history / chat — use an env file):
     1. Create a gitignored .turso.env with:
          TURSO_DATABASE_URL=libsql://<your-db>.turso.io
          TURSO_AUTH_TOKEN=<your-token>
     2. node --env-file=.turso.env scripts/migrate-to-turso.mjs

   Get the values from https://app.turso.tech (database URL + create a token). */
import { createClient } from "@libsql/client";

const LOCAL = "file:" + process.cwd() + "/data/pallisade.db";
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error(
    "Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.\n" +
      "Create .turso.env (see header) and run with: node --env-file=.turso.env scripts/migrate-to-turso.mjs",
  );
  process.exit(1);
}

const local = createClient({ url: LOCAL });
const turso = createClient({ url, authToken });

// Fold any WAL frames into the readable view before copying.
try {
  await local.execute("PRAGMA wal_checkpoint(TRUNCATE)");
} catch {
  /* fine — normal reads already include committed WAL data */
}

const tables = (
  await local.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
).rows;

console.log(`Found ${tables.length} tables to migrate.\n`);

for (const t of tables) {
  const name = t.name;
  const createSql = String(t.sql).replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS");
  await turso.execute(createSql);

  const rows = (await local.execute(`SELECT * FROM "${name}"`)).rows;
  const stmts = [{ sql: `DELETE FROM "${name}"`, args: [] }];

  if (rows.length) {
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const ph = cols.map(() => "?").join(", ");
    for (const r of rows) {
      stmts.push({
        sql: `INSERT INTO "${name}" (${colList}) VALUES (${ph})`,
        args: cols.map((c) => r[c]),
      });
    }
  }
  await turso.batch(stmts, "write");
  console.log(`  copied ${name}: ${rows.length} rows`);
}

console.log("\nVerifying row counts in Turso:");
let total = 0;
for (const t of tables) {
  const n = (await turso.execute(`SELECT count(*) AS n FROM "${t.name}"`)).rows[0].n;
  total += Number(n);
  console.log(`  ${t.name}: ${n}`);
}
console.log(`\nDone. ${total} total rows now in Turso.`);
