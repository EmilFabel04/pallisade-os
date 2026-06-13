/* ============================================================
   Async resolver for the advisor's calendar read tool (server-only).
   The write tool (create_calendar_event) is queued as a proposal and
   executed client-side on confirmation, so it isn't handled here.
   ============================================================ */

import { isConfigured, hasCalendarScope } from "@/lib/gmail/config";
import { listAccounts } from "@/lib/gmail/accounts";
import { listUpcomingEvents } from "./calendarApi";

type Args = Record<string, unknown>;

/** True when at least one connected account has granted calendar access. */
export function calendarToolsAvailable(): boolean {
  return isConfigured() && listAccounts().some((a) => hasCalendarScope(a.tokens.scope));
}

export async function resolveCalendarTool(name: string, args: Args): Promise<string> {
  if (name === "query_calendar") {
    const accounts = listAccounts().filter((a) => hasCalendarScope(a.tokens.scope));
    const days = Math.min(Number(args.days) || 7, 60);
    const q = args.query ? String(args.query) : undefined;

    const lists = await Promise.all(
      accounts.map((a) => listUpcomingEvents(a.id, { days, q, maxResults: 25 }).catch(() => [])),
    );
    const events = lists
      .flat()
      .sort((a, b) => (a.start < b.start ? -1 : 1))
      .slice(0, 40)
      .map((e) => ({
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
        attendees: e.attendees,
      }));
    return JSON.stringify({ events });
  }

  return JSON.stringify({ error: `unknown calendar tool: ${name}` });
}
