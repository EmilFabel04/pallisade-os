"use client";

import { Clock, MapPin, Users, ArrowUpRight } from "lucide-react";
import type { CalEvent } from "@/lib/calendar/calendarClient";
import { fmtTime } from "@/lib/utils";

export function EventRow({ event, showDate }: { event: CalEvent; showDate?: boolean }) {
  const when = event.allDay
    ? "All day"
    : `${fmtTime(event.start)}${event.end ? `–${fmtTime(event.end)}` : ""}`;

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="shrink-0 w-[78px] text-right">
        <div className="text-[0.78rem] tnum text-[var(--color-ink-soft)]">{when.split("–")[0]}</div>
        {!event.allDay && event.end && (
          <div className="text-[0.66rem] tnum text-[var(--color-dim)]">{fmtTime(event.end)}</div>
        )}
      </div>
      <div className="w-px self-stretch bg-[var(--color-line)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[0.84rem] text-[var(--color-ink)]">{event.title}</span>
          {event.htmlLink && (
            <a href={event.htmlLink} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--color-dim)] hover:text-[var(--color-accent)]">
              <ArrowUpRight size={12} />
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[0.7rem] text-[var(--color-dim)]">
          {event.location && (
            <span className="inline-flex items-center gap-1 truncate max-w-[200px]"><MapPin size={10} /> {event.location}</span>
          )}
          {event.attendees.length > 0 && (
            <span className="inline-flex items-center gap-1"><Users size={10} /> {event.attendees.length}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export { Clock };
