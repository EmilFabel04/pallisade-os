/* ============================================================
   Connected Gmail accounts + OAuth tokens (server-only).

   Tokens are secrets and must never travel through the client data
   sync (/api/data). They live in their own table in the same local
   SQLite file and are only ever read inside server routes.
   ============================================================ */

import { getClient } from "@/lib/db/client";
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

// ── Schema bootstrap (runs once per process) ─────────────────────────────────

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const client = getClient();
    // NOTE: no PRAGMA journal_mode here — it cannot run inside the batch's
    // transaction (errors locally) and is meaningless on remote Turso.
    await client.batch(
      [
        {
          sql: `CREATE TABLE IF NOT EXISTS gmail_accounts (
                  id         TEXT PRIMARY KEY,
                  email      TEXT NOT NULL UNIQUE,
                  tokens_json TEXT NOT NULL,
                  created_at TEXT,
                  updated_at TEXT
                )`,
          args: [],
        },
      ],
      "write",
    );
  })();

  return schemaReady;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<GmailAccount[]> {
  await ensureSchema();
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, email, tokens_json, created_at, updated_at FROM gmail_accounts ORDER BY created_at ASC`,
    args: [],
  });
  return result.rows.map((r) =>
    rowToAccount({
      id: r.id as string,
      email: r.email as string,
      tokens_json: r.tokens_json as string,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
    }),
  );
}

export async function listAccountInfo(): Promise<GmailAccountInfo[]> {
  const accounts = await listAccounts();
  return accounts.map(({ id, email, createdAt }) => ({ id, email, createdAt }));
}

export async function getAccount(id: string): Promise<GmailAccount | null> {
  await ensureSchema();
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, email, tokens_json, created_at, updated_at FROM gmail_accounts WHERE id = ?`,
    args: [id],
  });
  const r = result.rows[0];
  if (!r) return null;
  return rowToAccount({
    id: r.id as string,
    email: r.email as string,
    tokens_json: r.tokens_json as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  });
}

/** Upsert by email — re-connecting the same inbox refreshes its tokens. */
export async function upsertAccount(email: string, tokens: Credentials): Promise<GmailAccount> {
  await ensureSchema();
  const client = getClient();
  const now = new Date().toISOString();

  const existingResult = await client.execute({
    sql: `SELECT id, created_at FROM gmail_accounts WHERE email = ?`,
    args: [email],
  });
  const existing = existingResult.rows[0] as unknown as { id: string; created_at: string } | undefined;

  if (existing) {
    // Preserve a refresh_token if Google omits it on a repeat consent.
    const prev = await getAccount(existing.id);
    const merged: Credentials = {
      ...tokens,
      refresh_token: tokens.refresh_token ?? prev?.tokens.refresh_token,
    };
    await client.execute({
      sql: `UPDATE gmail_accounts SET tokens_json = ?, updated_at = ? WHERE id = ?`,
      args: [JSON.stringify(merged), now, existing.id],
    });
    return (await getAccount(existing.id))!;
  }

  const id = `gm_${Math.abs(hashString(email)).toString(36)}_${email.length}`;
  await client.execute({
    sql: `INSERT INTO gmail_accounts (id, email, tokens_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, email, JSON.stringify(tokens), now, now],
  });
  return (await getAccount(id))!;
}

export async function updateTokens(id: string, tokens: Credentials): Promise<void> {
  await ensureSchema();
  const client = getClient();
  await client.execute({
    sql: `UPDATE gmail_accounts SET tokens_json = ?, updated_at = ? WHERE id = ?`,
    args: [JSON.stringify(tokens), new Date().toISOString(), id],
  });
}

export async function deleteAccount(id: string): Promise<void> {
  await ensureSchema();
  const client = getClient();
  await client.execute({
    sql: `DELETE FROM gmail_accounts WHERE id = ?`,
    args: [id],
  });
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
