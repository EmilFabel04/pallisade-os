/* ============================================================
   Connected Gmail accounts + OAuth tokens (server-only).

   Tokens are secrets and must never travel through the client data
   sync (/api/data). They live in their own table in the same local
   SQLite file and are only ever read inside server routes.
   ============================================================ */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Credentials } from "google-auth-library";

export interface GmailAccount {
  id: string;
  email: string;
  tokens: Credentials;
  createdAt: string;
  updatedAt: string;
}

/** Public, secret-free view safe to return to the client. */
export type GmailAccountInfo = Pick<GmailAccount, "id" | "email" | "createdAt">;

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const handle = new DatabaseSync(path.join(dir, "pallisade.db"));
  handle.exec("PRAGMA journal_mode = WAL;");
  handle.exec(
    `CREATE TABLE IF NOT EXISTS gmail_accounts (
       id TEXT PRIMARY KEY,
       email TEXT NOT NULL UNIQUE,
       tokens_json TEXT NOT NULL,
       created_at TEXT,
       updated_at TEXT
     )`,
  );
  db = handle;
  return handle;
}

function rowToAccount(r: {
  id: string; email: string; tokens_json: string; created_at: string; updated_at: string;
}): GmailAccount {
  return {
    id: r.id,
    email: r.email,
    tokens: JSON.parse(r.tokens_json) as Credentials,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listAccounts(): GmailAccount[] {
  const rows = getDb()
    .prepare(`SELECT * FROM gmail_accounts ORDER BY created_at ASC`)
    .all() as Parameters<typeof rowToAccount>[0][];
  return rows.map(rowToAccount);
}

export function listAccountInfo(): GmailAccountInfo[] {
  return listAccounts().map(({ id, email, createdAt }) => ({ id, email, createdAt }));
}

export function getAccount(id: string): GmailAccount | null {
  const r = getDb()
    .prepare(`SELECT * FROM gmail_accounts WHERE id = ?`)
    .get(id) as Parameters<typeof rowToAccount>[0] | undefined;
  return r ? rowToAccount(r) : null;
}

/** Upsert by email — re-connecting the same inbox refreshes its tokens. */
export function upsertAccount(email: string, tokens: Credentials): GmailAccount {
  const d = getDb();
  const now = new Date().toISOString();
  const existing = d
    .prepare(`SELECT id, created_at FROM gmail_accounts WHERE email = ?`)
    .get(email) as { id: string; created_at: string } | undefined;

  if (existing) {
    // Preserve a refresh_token if Google omits it on a repeat consent.
    const prev = getAccount(existing.id);
    const merged: Credentials = {
      ...tokens,
      refresh_token: tokens.refresh_token ?? prev?.tokens.refresh_token,
    };
    d.prepare(
      `UPDATE gmail_accounts SET tokens_json = ?, updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(merged), now, existing.id);
    return getAccount(existing.id)!;
  }

  const id = `gm_${Math.abs(hashString(email)).toString(36)}_${email.length}`;
  d.prepare(
    `INSERT INTO gmail_accounts (id, email, tokens_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, JSON.stringify(tokens), now, now);
  return getAccount(id)!;
}

export function updateTokens(id: string, tokens: Credentials): void {
  getDb()
    .prepare(`UPDATE gmail_accounts SET tokens_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(tokens), new Date().toISOString(), id);
}

export function deleteAccount(id: string): void {
  getDb().prepare(`DELETE FROM gmail_accounts WHERE id = ?`).run(id);
}

/** Tiny deterministic string hash (avoids Math.random for stable ids). */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
