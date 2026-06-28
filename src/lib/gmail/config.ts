/* ============================================================
   Gmail OAuth configuration (server-only).
   Reads credentials from the environment and builds OAuth clients.
   The integration is dormant until GOOGLE_CLIENT_ID / SECRET exist —
   every consumer checks isConfigured() first.
   ============================================================ */

import { OAuth2Client } from "google-auth-library";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.readonly",
];

/** Back-compat alias. */
export const GMAIL_SCOPES = GOOGLE_SCOPES;

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Whether a stored token's granted scopes include calendar access. */
export function hasCalendarScope(scope: string | undefined | null): boolean {
  return !!scope && scope.includes(CALENDAR_SCOPE);
}

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Whether a stored token's granted scopes include Drive read access. */
export function hasDriveScope(scope: string | undefined | null): boolean {
  return !!scope && scope.includes(DRIVE_SCOPE);
}

/** Where Google sends the user back after consent. Must be registered verbatim
 *  as an authorized redirect URI on the OAuth client. */
export function redirectUri(): string {
  return process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/api/gmail/callback";
}

export function isConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** A fresh OAuth2 client. Throws if credentials are missing — callers must
 *  guard with isConfigured() first (routes return a setup notice instead). */
export function oauthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("gmail_not_configured");
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri: redirectUri() });
}
