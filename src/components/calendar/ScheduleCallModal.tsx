"use client";

import { useMemo, useState } from "react";
import { Loader2, CalendarPlus, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, FormGrid, Select, TextInput } from "@/components/ui/Field";
import { useStore } from "@/lib/store";
import { createCalendarEvent, type CalEvent } from "@/lib/calendar/calendarClient";
import type { Lead } from "@/lib/types";

/** Pad to 2 digits. */
const p2 = (n: number) => String(n).padStart(2, "0");

/** datetime-local string for tomorrow at 10:00, in the browser's local time. */
function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function ScheduleCallModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const store = useStore();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultStart());
  const [duration, setDuration] = useState("30");
  const [invite, setInvite] = useState(true);
  const [markBooked, setMarkBooked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CalEvent | null>(null);

  const defaultTitle = useMemo(
    () => (lead ? `Call with ${lead.contactName || lead.company}` : "Call"),
    [lead],
  );

  if (!lead) return null;

  const errorHint = (msg: string): string => {
    if (msg === "no_calendar_account" || msg === "reconnect")
      return "Your Google account hasn't granted calendar access yet — reconnect it on the Inbox page (or Agenda → Reconnect for calendar).";
    if (msg === "gmail_not_configured") return "Google isn't configured on the server.";
    return msg;
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const startISO = new Date(when).toISOString();
      const event = await createCalendarEvent({
        summary: (title || defaultTitle).trim(),
        start: startISO,
        durationMinutes: Number(duration),
        attendees: invite && lead.email ? [lead.email] : [],
        description: lead.notes ? `Lead notes: ${lead.notes}` : undefined,
      });
      if (markBooked) {
        store.update("leads", lead.id, {
          status: "call booked",
          nextFollowUp: when.slice(0, 10),
        });
      }
      setDone(event);
    } catch (e) {
      setError(errorHint((e as Error).message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!lead}
      onClose={onClose}
      title="Schedule call"
      subtitle={lead.company}
      footer={
        done ? (
          <button className="btn btn-accent" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-accent" onClick={submit} disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <CalendarPlus size={15} />}
              Add to calendar
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="py-4 text-center space-y-3">
          <p className="text-[0.9rem] text-[var(--color-ink)]">Call added to your Google Calendar.</p>
          {done.htmlLink && (
            <a href={done.htmlLink} target="_blank" rel="noreferrer" className="link-accent inline-flex items-center gap-1 text-[0.84rem]">
              Open in Google Calendar <ExternalLink size={13} />
            </a>
          )}
          {markBooked && <p className="text-[0.76rem] text-[var(--color-dim)]">Lead marked as “call booked”.</p>}
        </div>
      ) : (
        <div className="space-y-3.5">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} />
          </Field>
          <FormGrid>
            <Field label="When">
              <TextInput type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Field label="Duration">
              <Select options={["15", "30", "45", "60"]} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
          </FormGrid>
          <label className="flex items-center gap-2 text-[0.82rem] text-[var(--color-ink-soft)]">
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} disabled={!lead.email} />
            Invite {lead.email || "the lead"} {lead.email ? "" : "(no email on file)"}
          </label>
          <label className="flex items-center gap-2 text-[0.82rem] text-[var(--color-ink-soft)]">
            <input type="checkbox" checked={markBooked} onChange={(e) => setMarkBooked(e.target.checked)} />
            Mark lead as “call booked”
          </label>
          {error && <p className="text-[0.78rem] text-[var(--color-accent)]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
