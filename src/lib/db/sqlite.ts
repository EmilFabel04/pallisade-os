/* ============================================================
   App-data persistence (server-only).
   Uses @libsql/client — works with a local file: URL in dev
   and a libsql:// Turso URL in production.

   This module must only be imported from server code (the
   /api/data route). It is the concrete backend behind the
   StorageAdapter seam; the client never touches it directly.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "./client";
import type { DataShape } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/seed";

export const COLLECTIONS = [
  "leads",
  "interactions",
  "projects",
  "tasks",
  "scorecards",
  "painPoints",
  "conversations",
  "playbooks",
  "targets",
  "dialLists",
  "positioningProfiles",
  "contentThreads",
  "brainThreads",
  "newsFeed",
  "newsInterests",
  "newsBookmarks",
  "notes",
  "metricEntries",
] as const;
export type Coll = (typeof COLLECTIONS)[number];

// ── Schema bootstrap (runs once per process) ─────────────────────────────────

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const client = getClient();
    // NOTE: no PRAGMA journal_mode here — it cannot run inside the batch's
    // transaction (errors locally) and is meaningless on remote Turso.
    const stmts: InStatement[] = [];

    for (const c of COLLECTIONS) {
      stmts.push({
        sql: `CREATE TABLE IF NOT EXISTS ${c} (
                id         TEXT PRIMARY KEY,
                json       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      });
    }

    stmts.push({
      sql: `CREATE TABLE IF NOT EXISTS settings (
              id   TEXT PRIMARY KEY,
              json TEXT NOT NULL
            )`,
      args: [],
    });

    await client.batch(stmts, "write");
  })();

  return schemaReady;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadAll(): Promise<DataShape> {
  await ensureSchema();
  const client = getClient();
  const out = {} as DataShape;

  for (const c of COLLECTIONS) {
    const result = await client.execute(
      `SELECT json FROM ${c} ORDER BY updated_at DESC`,
    );
    out[c] = result.rows.map(
      (r) => JSON.parse(r.json as string),
    ) as never;
  }

  const sResult = await client.execute(
    `SELECT json FROM settings WHERE id = 'singleton'`,
  );
  const sRow = sResult.rows[0];
  out.settings = sRow ? JSON.parse(sRow.json as string) : DEFAULT_SETTINGS;

  return out;
}

export async function saveAll(data: DataShape): Promise<void> {
  await ensureSchema();
  const client = getClient();

  // Safety net: never let a fully-empty payload wipe a populated database.
  // Guards against a transient failed hydrate or a stale browser tab POSTing
  // an empty state back (which would otherwise DELETE every row below).
  const payloadEmpty = COLLECTIONS.every(
    (c) => !((data[c] as unknown[] | undefined)?.length),
  );
  if (payloadEmpty) {
    const checks = await Promise.all(
      COLLECTIONS.map((c) => client.execute(`SELECT 1 FROM ${c} LIMIT 1`)),
    );
    if (checks.some((r) => r.rows.length > 0)) {
      console.warn(
        "[db] refused empty saveAll over a populated database (kept existing data)",
      );
      return; // skip the destructive wipe
    }
  }

  const stmts: InStatement[] = [];

  for (const c of COLLECTIONS) {
    const items = ((data[c] as unknown[]) ?? []) as Array<{
      id: string;
      updatedAt?: string;
    }>;

    stmts.push({ sql: `DELETE FROM ${c}`, args: [] });

    for (const it of items) {
      stmts.push({
        sql: `INSERT INTO ${c} (id, json, updated_at) VALUES (?, ?, ?)`,
        args: [it.id, JSON.stringify(it), it.updatedAt ?? null],
      });
    }
  }

  const settingsJson = JSON.stringify(data.settings ?? DEFAULT_SETTINGS);
  stmts.push({
    sql: `INSERT INTO settings (id, json) VALUES ('singleton', ?)
          ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
    args: [settingsJson],
  });

  await client.batch(stmts, "write");
}
