import { NextResponse } from "next/server";
import { isConfigured, hasCalendarScope } from "@/lib/gmail/config";
import { listAccounts } from "@/lib/gmail/accounts";
import { GmailAuthError } from "@/lib/gmail/client";
import { listUpcomingEvents, createEvent, type CalEvent } from "@/lib/calendar/calendarApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountRef = { id: string; email: string };

/** Upcoming events aggregated across calendar-enabled accounts. ?days= &accountId= */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get("days")) || 14, 60);
  const only = url.searchParams.get("accountId");

  const accounts = listAccounts().filter((a) => !only || only === "all" || a.id === only);
  const needsReconnect: AccountRef[] = [];
  const enabled = accounts.filter((a) => {
    const ok = hasCalendarScope(a.tokens.scope);
    if (!ok) needsReconnect.push({ id: a.id, email: a.email });
    return ok;
  });

  try {
    const lists = await Promise.all(
      enabled.map((a) =>
        listUpcomingEvents(a.id, { days, maxResults: 25 }).catch((e) => {
          if (e instanceof GmailAuthError) {
            needsReconnect.push({ id: a.id, email: a.email });
            return [] as CalEvent[];
          }
          throw e;
        }),
      ),
    );
    const events = lists.flat().sort((a, b) => (a.start < b.start ? -1 : 1));
    return NextResponse.json({ events, needsReconnect, hasAccounts: listAccounts().length > 0 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** Create an event. Body: { accountId?, summary, start, end?, durationMinutes?, description?, location?, attendees? } */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "gmail_not_configured" }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const summary = String(body.summary ?? "").trim();
  const start = String(body.start ?? "");
  if (!summary || !start) {
    return NextResponse.json({ error: "missing_summary_or_start" }, { status: 400 });
  }

  // Pick the account: explicit, else the first calendar-enabled one.
  const enabled = listAccounts().filter((a) => hasCalendarScope(a.tokens.scope));
  const accountId = body.accountId ? String(body.accountId) : enabled[0]?.id;
  if (!accountId) {
    return NextResponse.json({ error: "no_calendar_account" }, { status: 409 });
  }

  try {
    const event = await createEvent(accountId, {
      summary,
      start,
      end: body.end ? String(body.end) : undefined,
      durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : undefined,
      description: body.description ? String(body.description) : undefined,
      location: body.location ? String(body.location) : undefined,
      attendees: Array.isArray(body.attendees) ? (body.attendees as string[]) : undefined,
    });
    return NextResponse.json({ event });
  } catch (e) {
    if (e instanceof GmailAuthError) {
      return NextResponse.json({ error: "reconnect", accountId: e.accountId }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
