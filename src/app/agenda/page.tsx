"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, RefreshCw, AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { EventRow } from "@/components/calendar/EventRow";
import { fetchUpcomingEvents, type CalEvent, type AccountRef } from "@/lib/calendar/calendarClient";
import { getGmailStatus, connectGmailPopup, type GmailStatus } from "@/lib/gmail/gmailClient";
import { fmtDate, relativeDay } from "@/lib/utils";

export default function AgendaPage() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [needsReconnect, setNeedsReconnect] = useState<AccountRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchUpcomingEvents(days);
      setEvents(r.events);
      setNeedsReconnect(r.needsReconnect);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    getGmailStatus().then((s) => {
      setStatus(s);
      if (s.configured && s.accounts.length) void load();
    });
  }, [load]);

  const connect = async () => {
    setConnecting(true);
    const r = await connectGmailPopup();
    setConnecting(false);
    if (r.ok) {
      const s = await getGmailStatus();
      setStatus(s);
      void load();
    }
  };

  const configured = status?.configured;
  const accounts = status?.accounts ?? [];

  // group events by calendar day
  const groups: { day: string; items: CalEvent[] }[] = [];
  for (const e of events) {
    const day = e.start.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Agenda"
        subtitle="Your upcoming Google Calendar meetings, inside the OS."
        actions={
          configured && accounts.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <select className="select py-1 text-[0.8rem]" style={{ width: 130 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>Next 7 days</option>
                <option value={14}>Next 14 days</option>
                <option value={30}>Next 30 days</option>
              </select>
              <button className="btn btn-sm btn-ghost" onClick={() => void load()} disabled={loading}>
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          ) : undefined
        }
      />

      {status === null && (
        <Panel><div className="flex items-center gap-2 p-2 text-[0.84rem] text-[var(--color-dim)]">
          <Loader2 size={14} className="animate-spin" /> Checking calendar connection…
        </div></Panel>
      )}

      {status && !configured && (
        <Panel>
          <EmptyState
            icon={CalendarClock}
            title="Calendar isn't set up"
            message="Connect a Google account on the Inbox page first — the calendar shares the same connection."
          />
        </Panel>
      )}

      {configured && accounts.length === 0 && (
        <Panel>
          <EmptyState
            icon={CalendarClock}
            title="Connect Google to see your calendar"
            message="Sign in with Google to show your upcoming meetings here."
            action={
              <button className="btn btn-accent" onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Connect Google
              </button>
            }
          />
        </Panel>
      )}

      {configured && accounts.length > 0 && needsReconnect.length > 0 && (
        <Panel>
          <div className="flex items-center justify-between gap-3 p-1">
            <span className="flex items-center gap-2 text-[0.8rem] text-[var(--color-accent)]">
              <AlertTriangle size={14} />
              {needsReconnect.map((a) => a.email).join(", ")} hasn't granted calendar access yet.
            </span>
            <button className="btn btn-sm btn-accent" onClick={connect} disabled={connecting}>
              {connecting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Reconnect for calendar
            </button>
          </div>
        </Panel>
      )}

      {configured && accounts.length > 0 && (
        <Panel>
          {loading && events.length === 0 ? (
            <div className="flex items-center gap-2 p-2 text-[0.8rem] text-[var(--color-dim)]">
              <Loader2 size={14} className="animate-spin" /> Loading meetings…
            </div>
          ) : error ? (
            <p className="p-2 text-[0.8rem] text-[var(--color-accent)]">{error}</p>
          ) : groups.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing scheduled" message={`No meetings in the next ${days} days.`} />
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.day}>
                  <div className="flex items-baseline gap-2 mb-1 pb-1 border-b border-[var(--color-line)]">
                    <span className="text-[0.82rem] font-semibold text-[var(--color-ink)]">{relativeDay(g.day)}</span>
                    <span className="text-[0.72rem] text-[var(--color-dim)]">{fmtDate(g.day)}</span>
                  </div>
                  <div className="divide-y divide-[var(--color-line)]">
                    {g.items.map((e) => <EventRow key={`${e.accountId}:${e.id}`} event={e} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
