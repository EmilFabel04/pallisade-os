/* ============================================================
   SQLite persistence (server-only).
   Uses Node's built-in `node:sqlite` — no native module to build.
   Stores the database at  <project>/data/pallisade.db.

   This module must only be imported from server code (the
   /api/data route). It is the concrete backend behind the
   StorageAdapter seam; the client never touches it directly.
   ============================================================ */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DataShape } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/seed";

const COLLECTIONS = [
  "leads",
  "interactions",
  "projects",
  "tasks",
  "scorecards",
  "painPoints",
  "conversations",
  "playbooks",
  "targets",
  "positioningProfiles",
  "contentThreads",
  "brainThreads",
] as const;
type Coll = (typeof COLLECTIONS)[number];

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const handle = new DatabaseSync(path.join(dir, "pallisade.db"));
  handle.exec("PRAGMA journal_mode = WAL;");
  for (const c of COLLECTIONS) {
    handle.exec(
      `CREATE TABLE IF NOT EXISTS ${c} (
         id TEXT PRIMARY KEY,
         json TEXT NOT NULL,
         updated_at TEXT
       )`,
    );
  }
  handle.exec(
    `CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  );
  db = handle;
  return handle;
}

export function loadAll(): DataShape {
  const d = getDb();
  const out = {} as DataShape;
  for (const c of COLLECTIONS) {
    const rows = d
      .prepare(`SELECT json FROM ${c} ORDER BY updated_at DESC`)
      .all() as { json: string }[];
    out[c] = rows.map((r) => JSON.parse(r.json)) as never;
  }
  const s = d
    .prepare(`SELECT json FROM settings WHERE id = 'singleton'`)
    .get() as { json: string } | undefined;
  out.settings = s ? JSON.parse(s.json) : DEFAULT_SETTINGS;
  return out;
}

export function saveAll(data: DataShape): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    for (const c of COLLECTIONS) {
      const items = ((data[c] as unknown[]) ?? []) as Array<{
        id: string;
        updatedAt?: string;
      }>;
      d.exec(`DELETE FROM ${c}`);
      const insert = d.prepare(
        `INSERT INTO ${c} (id, json, updated_at) VALUES (?, ?, ?)`,
      );
      for (const it of items) {
        insert.run(it.id, JSON.stringify(it), it.updatedAt ?? null);
      }
    }
    const settingsJson = JSON.stringify(data.settings ?? DEFAULT_SETTINGS);
    d.prepare(
      `INSERT INTO settings (id, json) VALUES ('singleton', ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
    ).run(settingsJson);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export type { Coll };
