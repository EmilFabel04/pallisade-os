import { NextResponse } from "next/server";
import { apiError, UPSTREAM_FAILED } from "@/lib/api/errors";
import { isConfigured } from "@/lib/gmail/config";
import { getThread } from "@/lib/gmail/gmailApi";
import { GmailAuthError } from "@/lib/gmail/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full thread with message bodies. ?accountId=<id> &id=<threadId> */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const id = url.searchParams.get("id");
  if (!accountId || !id) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  try {
    const thread = await getThread(accountId, id);
    return NextResponse.json({ thread });
  } catch (e) {
    if (e instanceof GmailAuthError) {
      return NextResponse.json({ error: "reconnect", accountId: e.accountId }, { status: 401 });
    }
    return apiError(UPSTREAM_FAILED, 502, e);
  }
}
