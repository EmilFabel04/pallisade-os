import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isConfigured, oauthClient, GMAIL_SCOPES } from "@/lib/gmail/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kick off the OAuth dance: redirect the popup to Google's consent screen. */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }

  const state = randomUUID();
  const authUrl = oauthClient().generateAuthUrl({
    access_type: "offline",   // request a refresh token
    prompt: "consent",        // ensure a refresh token even on re-consent
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gmail_oauth_state", state, {
    httpOnly: true, sameSite: "lax", maxAge: 600, path: "/",
  });
  return res;
}
