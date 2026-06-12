import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/gmail/config";
import { listAccountInfo } from "@/lib/gmail/accounts";
import { listThreads } from "@/lib/gmail/gmailApi";
import { GmailAuthError } from "@/lib/gmail/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent inbox threads. ?accountId=<id|all> &q=<gmail search> */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const q = url.searchParams.get("q") ?? undefined;

  const all = listAccountInfo();
  const ids = accountId && accountId !== "all" ? [accountId] : all.map((a) => a.id);
  if (ids.length === 0) return NextResponse.json({ threads: [], needsReconnect: [] });

  const needsReconnect: string[] = [];
  try {
    const lists = await Promise.all(
      ids.map((id) =>
        listThreads(id, { q }).catch((e) => {
          // An expired/revoked account shouldn't blank the whole inbox.
          if (e instanceof GmailAuthError) {
            needsReconnect.push(e.accountId);
            return [];
          }
          throw e;
        }),
      ),
    );
    const threads = lists.flat().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
    return NextResponse.json({ threads, needsReconnect });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
