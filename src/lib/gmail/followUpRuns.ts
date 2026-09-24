/* ============================================================
   Stored follow-up audit runs (server-only).

   Deliberately NOT in the COLLECTIONS array in src/lib/db/sqlite.ts, for
   the reason content/daily/store.ts documents: saveAll() deletes and
   reinserts every listed collection from a client snapshot, so a browser
   tab opened before a run would wipe it. The audit owns this table.

   History exists so compare mode has a sample. One run is a screenshot;
   ten is enough to judge whether Jev and the keyword rule actually differ.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "@/lib/db/client";
import type { FollowUpRun } from "@/lib/types";

export const RUN_HISTORY = 10;

let schemaReady: Promise<void> | null = null;

export async function ensureFollowUpSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  // Identity-checked clear, as in content/daily/store.ts: one SQLITE_BUSY
  // must not poison this promise for the life of the process.
  const attempt: Promise<void> = (async () => {
    const stmts: InStatement[] = [
      {
        sql: `CREATE TABLE IF NOT EXISTS followUpRuns (
                id         TEXT PRIMARY KEY,
                at         TEXT NOT NULL,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_followUpRuns_at ON followUpRuns(at)`, args: [] },
    ];
    await getClient().batch(stmts, "write");
  })().catch((err: unknown) => {
    if (schemaReady === attempt) schemaReady = null;
    throw err;
  });

  schemaReady = attempt;
  return schemaReady;
}

export async function saveRun(run: FollowUpRun): Promise<void> {
  await ensureFollowUpSchema();
  const client = getClient();

  await client.execute({
    sql: `INSERT INTO followUpRuns (id, at, json, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET at = excluded.at, json = excluded.json,
                                        updated_at = excluded.updated_at`,
    args: [run.id, run.at, JSON.stringify(run), run.at],
  });

  await client.execute({
    sql: `DELETE FROM followUpRuns WHERE id NOT IN (
            SELECT id FROM followUpRuns ORDER BY at DESC LIMIT ?
          )`,
    args: [RUN_HISTORY],
  });
}

export async function listRuns(limit = RUN_HISTORY): Promise<FollowUpRun[]> {
  await ensureFollowUpSchema();
  const res = await getClient().execute({
    sql: `SELECT json FROM followUpRuns ORDER BY at DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => JSON.parse(r.json as string) as FollowUpRun);
}

export async function latestRun(): Promise<FollowUpRun | null> {
  const [first] = await listRuns(1);
  return first ?? null;
}
