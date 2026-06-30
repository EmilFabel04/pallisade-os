/* ============================================================
   Authenticated Gmail REST access for a connected account.
   Handles access-token refresh and persists refreshed tokens.
   Server-only.
   ============================================================ */

import type { OAuth2Client, Credentials } from "google-auth-library";
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

function clientForAccount(account: GmailAccount): {
  client: OAuth2Client;
  takeRefreshed: () => Credentials | null;
} {
  const client = oauthClient();
  client.setCredentials(account.tokens);
  // Capture refreshed tokens so the caller can persist them with an AWAITED
  // write inside the request — a detached/fire-and-forget write can be lost
  // when a serverless instance freezes after the response is sent.
  let refreshed: Credentials | null = null;
  client.on("tokens", (t) => {
    const merged = { ...account.tokens, ...t };
    account.tokens = merged; // current request uses the fresh token regardless
    refreshed = merged;
  });
  return { client, takeRefreshed: () => refreshed };
}

async function accessTokenFor(account: GmailAccount): Promise<string> {
  const { client, takeRefreshed } = clientForAccount(account);
  let token: string | null | undefined;
  try {
    ({ token } = await client.getAccessToken());
  } catch {
    throw new GmailAuthError(account.id);
  }
  // Persist a refreshed token before returning (awaited, so it survives on
  // serverless). Failure to persist is non-fatal — the request still has the
  // token in memory; the worst case is an extra refresh next time.
  const refreshed = takeRefreshed();
  if (refreshed) {
    try {
      await updateTokens(account.id, refreshed);
    } catch {
      /* non-fatal: token already applied in memory for this request */
    }
  }
  if (!token) throw new GmailAuthError(account.id);
  return token;
}

/** Authenticated fetch against any Google API for a connected account.
 *  Handles token refresh; maps 401 to GmailAuthError (reconnect needed). */
export async function googleFetch(
  accountId: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const account = await getAccount(accountId);
  if (!account) throw new GmailAuthError(accountId);
  const token = await accessTokenFor(account);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new GmailAuthError(accountId);
  return res;
}

/** GET against `users/me/<path>` for a connected account; returns parsed JSON. */
export async function gmailGet<T = unknown>(
  accountId: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await googleFetch(accountId, url.toString());
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`gmail_api_${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
