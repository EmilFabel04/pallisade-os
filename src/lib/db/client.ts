/* ============================================================
   Shared libSQL client (server-only).
   URL:  TURSO_DATABASE_URL  env var, or "file:data/pallisade.db" for dev.
   Auth: TURSO_AUTH_TOKEN    env var (undefined for local file URL).
   ============================================================ */

import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import path from "node:path";

let _client: Client | null = null;

export function getClient(): Client {
  if (_client) return _client;

  const url =
    process.env.TURSO_DATABASE_URL ?? "file:data/pallisade.db";

  // For local file URLs ensure the data directory exists.
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    const dir = path.isAbsolute(filePath)
      ? path.dirname(filePath)
      : path.join(process.cwd(), path.dirname(filePath));
    mkdirSync(dir, { recursive: true });
  }

  _client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return _client;
}
