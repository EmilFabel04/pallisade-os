/* ============================================================
   Authenticated Gmail REST access for a connected account.
   Handles access-token refresh and persists refreshed tokens.
   Server-only.
   ============================================================ */

import type { OAuth2Client } from "google-auth-library";
import { oauthClient } from "./config";
import { getAccount, updateTokens, type GmailAccount } from "./accounts";

/** Thrown when an account's tokens are missing/expired/revoked — the UI should
 *  prompt the user to reconnect that inbox. */
export class GmailAuthError extends Error {
  constructor(public accountId: string) {
    super("gmail_auth");
    this.name = "GmailAuthError";
  }
}

function clientForAccount(account: GmailAccount): OAuth2Client {
  const client = oauthClient();
  client.setCredentials(account.tokens);
  // Persist tokens whenever the library refreshes the access token.
  client.on("tokens", (t) => {
    const merged = { ...account.tokens, ...t };
    account.tokens = merged;
    updateTokens(account.id, merged);
  });
  return client;
}

async function accessTokenFor(account: GmailAccount): Promise<string> {
  const client = clientForAccount(account);
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("no_token");
    return token;
  } catch {
    throw new GmailAuthError(account.id);
  }
}

/** GET against `users/me/<path>` for a connected account; returns parsed JSON. */
export async function gmailGet<T = unknown>(
  accountId: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const account = getAccount(accountId);
  if (!account) throw new GmailAuthError(accountId);

  const token = await accessTokenFor(account);
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new GmailAuthError(accountId);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`gmail_api_${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
