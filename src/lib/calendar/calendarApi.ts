/* ============================================================
   Google Calendar reads/writes for a connected Google account.
   Reuses the shared OAuth token handling in lib/gmail/client.ts.
   Server-only.
   ============================================================ */

import { googleFetch, GmailAuthError } from "@/lib/gmail/client";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export interface CalEvent {
  id: string;
  accountId: string;
  title: string;
  start: string;       // ISO (date-time, or YYYY-MM-DD for all-day)
  end: string;         // ISO
  allDay: boolean;
  location: string;
  description: string;
  attendees: string[]; // emails
  htmlLink: string;
}

export interface NewEvent {
  summary: string;
  description?: string;
  location?: string;
  start: string;          // ISO date-time (UTC or with offset)
  end?: string;           // ISO date-time; if omitted, derive from durationMinutes
  durationMinutes?: number;
  attendees?: string[];   // emails
}

interface RawEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
}

function shape(accountId: string, e: RawEvent): CalEvent {
  const allDay = !!e.start?.date && !e.start?.dateTime;
  return {
    id: e.id,
    accountId,
    title: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    allDay,
    location: e.location || "",
    description: e.description || "",
    attendees: (e.attendees ?? []).map((a) => a.email || "").filter(Boolean),
    htmlLink: e.htmlLink || "",
  };
}

/** Upcoming events on the primary calendar, soonest first. */
export async function listUpcomingEvents(
  accountId: string,
  opts: { days?: number; maxResults?: number; q?: string } = {},
): Promise<CalEvent[]> {
  const now = new Date();
  const timeMax = new Date(now.getTime() + (opts.days ?? 14) * 86400_000);
  const url = new URL(BASE);
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(opts.maxResults ?? 20));
  if (opts.q) url.searchParams.set("q", opts.q);

  const res = await googleFetch(accountId, url.toString());
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`calendar_api_${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { items?: RawEvent[] };
  return (data.items ?? []).map((e) => shape(accountId, e));
}

/** Create an event on the primary calendar. */
export async function createEvent(accountId: string, input: NewEvent): Promise<CalEvent> {
  const startISO = input.start;
  const endISO =
    input.end ||
    new Date(new Date(startISO).getTime() + (input.durationMinutes ?? 30) * 60_000).toISOString();

  const body = {
    summary: input.summary,
    description: input.description || undefined,
    location: input.location || undefined,
    start: { dateTime: startISO },
    end: { dateTime: endISO },
    attendees: input.attendees?.length ? input.attendees.map((email) => ({ email })) : undefined,
  };

  const res = await googleFetch(accountId, BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`calendar_api_${res.status}: ${detail.slice(0, 200)}`);
  }
  return shape(accountId, (await res.json()) as RawEvent);
}

export { GmailAuthError };
