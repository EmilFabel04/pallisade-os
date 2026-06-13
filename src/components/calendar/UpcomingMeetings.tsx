"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { EventRow } from "./EventRow";
import { fetchUpcomingEvents, type CalEvent } from "@/lib/calendar/calendarClient";
import { relativeDay } from "@/lib/utils";

/** Compact "Next meetings" panel for the dashboard. Renders nothing when the
 *  calendar isn't connected, so it stays invisible until set up. */
export function UpcomingMeetings({ limit = 5, days = 7 }: { limit?: number; days?: number }) {
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    fetchUpcomingEvents(days)
      .then((r) => {
        if (!active) return;
        if (!r.hasAccounts) { setHidden(true); return; }
        setEvents(r.events.slice(0, limit));
      })
      .catch(() => { if (active) setHidden(true); });
    return () => { active = false; };
  }, [days, limit]);

  if (hidden) return null;

  return (
    <Panel title="Next Meetings" href="/agenda">
      {events === null ? (
        <p className="text-[0.8rem] text-[var(--color-dim)] py-2">Loading calendar…</p>
      ) : events.length === 0 ? (
        <p className="text-[0.8rem] text-[var(--color-dim)] py-2">No meetings in the next {days} days.</p>
      ) : (
        <div className="divide-y divide-[var(--color-line)]">
          {events.map((e) => (
            <div key={`${e.accountId}:${e.id}`}>
              <div className="text-[0.64rem] uppercase tracking-wider text-[var(--color-dim)] pt-2">
                {relativeDay(e.start)}
              </div>
              <EventRow event={e} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
