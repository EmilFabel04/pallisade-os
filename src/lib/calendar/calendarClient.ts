/* ============================================================
   Browser-side gateway to the calendar API routes. Type-only
   imports from the server module are erased at build.
   ============================================================ */

import type { CalEvent, NewEvent } from "./calendarApi";

export type { CalEvent, NewEvent };

export interface AccountRef {
  id: string;
  email: string;
}

export interface UpcomingResult {
  events: CalEvent[];
  needsReconnect: AccountRef[];
  hasAccounts: boolean;
}

export async function fetchUpcomingEvents(days = 14, accountId = "all"): Promise<UpcomingResult> {
  const params = new URLSearchParams({ days: String(days), accountId });
  const res = await fetch(`/api/calendar/events?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `calendar_${res.status}`);
  }
  return (await res.json()) as UpcomingResult;
}

export async function createCalendarEvent(
  input: NewEvent & { accountId?: string },
): Promise<CalEvent> {
  const res = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `calendar_${res.status}`);
  }
  return ((await res.json()) as { event: CalEvent }).event;
}
