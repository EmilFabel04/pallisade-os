/* ============================================================
   Server-authored persistence for agent body overrides.

   Deliberately NOT in the COLLECTIONS array in src/lib/db/sqlite.ts.
   saveAll() there deletes and reinserts every listed collection from a
   client-supplied snapshot, so a browser tab opened before an override was
   written would wipe it on its next save. See content/daily/store.ts.

   Only the BODY is overridable. Frontmatter — and therefore the tool grant —
   stays file-owned, so editing a persona in Settings can never widen its
   capabilities.
   ============================================================ */

import type { InStatement } from "@libsql/client";
import { getClient } from "@/lib/db/client";
import { nowISO } from "@/lib/utils";

let schemaReady: Promise<void> | null = null;

export async function ensureAgentSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const stmts: InStatement[] = [
      {
        sql: `CREATE TABLE IF NOT EXISTS agentOverrides (
                id         TEXT PRIMARY KEY,
                body       TEXT NOT NULL,
                updated_at TEXT
              )`,
        args: [],
      },
    ];
    await getClient().batch(stmts, "write");
  })();
  return schemaReady;
}

export async function loadOverrides(): Promise<Map<string, string>> {
  await ensureAgentSchema();
  const res = await getClient().execute("SELECT id, body FROM agentOverrides");
  return new Map(res.rows.map((r) => [r.id as string, r.body as string]));
}

export async function saveOverride(id: string, body: string): Promise<void> {
  await ensureAgentSchema();
  await getClient().execute({
    sql: `INSERT INTO agentOverrides (id, body, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    args: [id, body, nowISO()],
  });
}

export async function clearOverride(id: string): Promise<void> {
  await ensureAgentSchema();
  await getClient().execute({ sql: `DELETE FROM agentOverrides WHERE id = ?`, args: [id] });
}
