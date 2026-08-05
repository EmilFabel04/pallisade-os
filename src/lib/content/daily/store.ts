/* ============================================================
   Server-authored persistence for the daily engine.

   These tables are deliberately NOT in the COLLECTIONS array in
   src/lib/db/sqlite.ts. saveAll() there deletes and reinserts every
   listed collection from a client-supplied snapshot, so a browser tab
   opened before the cron ran would wipe the cron's rows on its next
   save. The engine owns this data; the client only patches it.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "@/lib/db/client";
import { addDaysISO, nowISO } from "@/lib/utils";
import type { ContentPost, ContentRun } from "./types";

let schemaReady: Promise<void> | null = null;

export async function ensureContentSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const client = getClient();
    const stmts: InStatement[] = [
      {
        sql: `CREATE TABLE IF NOT EXISTS contentPosts (
                id         TEXT PRIMARY KEY,
                date       TEXT NOT NULL,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS contentRuns (
                id         TEXT PRIMARY KEY,
                date       TEXT NOT NULL,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_contentPosts_date ON contentPosts(date)`, args: [] },
      { sql: `CREATE INDEX IF NOT EXISTS idx_contentRuns_date ON contentRuns(date)`, args: [] },
    ];
    await client.batch(stmts, "write");
  })();

  return schemaReady;
}

function parsePost(json: string): ContentPost {
  return JSON.parse(json) as ContentPost;
}

export async function listPosts(date: string): Promise<ContentPost[]> {
  await ensureContentSchema();
  const res = await getClient().execute({
    sql: `SELECT json FROM contentPosts WHERE date = ? ORDER BY json_extract(json, '$.slot')`,
    args: [date],
  });
  return res.rows.map((r) => parsePost(r.json as string));
}

export async function savePosts(posts: ContentPost[]): Promise<void> {
  if (posts.length === 0) return;
  await ensureContentSchema();
  await getClient().batch(
    posts.map((p) => ({
      sql: `INSERT INTO contentPosts (id, date, json, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET date = excluded.date, json = excluded.json,
                                          updated_at = excluded.updated_at`,
      args: [p.id, p.date, JSON.stringify(p), p.updatedAt],
    })),
    "write",
  );
}

export async function patchPost(
  id: string,
  changes: Partial<ContentPost>,
): Promise<ContentPost | null> {
  await ensureContentSchema();
  const client = getClient();
  const res = await client.execute({
    sql: `SELECT json FROM contentPosts WHERE id = ?`,
    args: [id],
  });
  const row = res.rows[0];
  if (!row) return null;

  const merged: ContentPost = {
    ...parsePost(row.json as string),
    ...changes,
    id,
    updatedAt: nowISO(),
  };
  await client.execute({
    sql: `UPDATE contentPosts SET date = ?, json = ?, updated_at = ? WHERE id = ?`,
    args: [merged.date, JSON.stringify(merged), merged.updatedAt, id],
  });
  return merged;
}

export async function recentPosts(days: number, today: string): Promise<ContentPost[]> {
  await ensureContentSchema();
  // addDaysISO, not `new Date(today).toISOString()`. The latter parses the
  // date as LOCAL midnight and then formats it in UTC, so at any positive
  // offset (this project runs SAST, +02:00) the boundary lands one day early
  // and the window quietly reaches further back than asked. addDaysISO round
  // -trips through local components and is stable at every offset.
  const fromISO = addDaysISO(today, -(days - 1));

  const res = await getClient().execute({
    sql: `SELECT json FROM contentPosts WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    args: [fromISO, today],
  });
  return res.rows.map((r) => parsePost(r.json as string));
}

export async function saveRun(run: ContentRun): Promise<void> {
  await ensureContentSchema();
  await getClient().execute({
    sql: `INSERT INTO contentRuns (id, date, json, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    args: [run.id, run.date, JSON.stringify(run), run.finishedAt ?? run.startedAt],
  });
}

export async function latestRun(date: string): Promise<ContentRun | null> {
  await ensureContentSchema();
  const res = await getClient().execute({
    sql: `SELECT json FROM contentRuns WHERE date = ? ORDER BY updated_at DESC LIMIT 1`,
    args: [date],
  });
  const row = res.rows[0];
  return row ? (JSON.parse(row.json as string) as ContentRun) : null;
}
