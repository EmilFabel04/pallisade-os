"use client";

import { UserPlus, PhoneCall, ArrowUpRight, Check } from "lucide-react";
import type { ThreadDetail } from "@/lib/gmail/gmailClient";
import type { Lead } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

export function ThreadReader({
  thread, matchedLead, logged, onCreateLead, onLogToLead, onViewLead,
}: {
  thread: ThreadDetail;
  matchedLead: Lead | null;
  logged: boolean;
  onCreateLead: () => void;
  onLogToLead: () => void;
  onViewLead: (lead: Lead) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--color-line)]">
        <h2 className="text-[0.98rem] font-semibold text-[var(--color-ink)] leading-snug">
          {thread.subject}
        </h2>
      </div>

      {/* lead action bar */}
      <div className="flex flex-wrap items-center gap-2 py-3 border-b border-[var(--color-line)]">
        {matchedLead ? (
          <>
            <span className="text-[0.74rem] text-[var(--color-muted)]">
              Matches lead{" "}
              <button
                onClick={() => onViewLead(matchedLead)}
                className="link-accent inline-flex items-center gap-0.5"
              >
                {matchedLead.company || matchedLead.contactName} <ArrowUpRight size={11} />
              </button>
            </span>
            <button
              onClick={onLogToLead}
              disabled={logged}
              className="btn btn-sm btn-ghost"
            >
              {logged ? <Check size={13} /> : <PhoneCall size={13} />}
              {logged ? "Logged" : "Log to lead"}
            </button>
          </>
        ) : (
          <button onClick={onCreateLead} className="btn btn-sm btn-accent">
            <UserPlus size={13} /> Create lead from sender
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pt-3 space-y-4">
        {thread.messages.map((m) => (
          <div key={m.id} className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[0.8rem] font-medium text-[var(--color-ink)]">
                {m.from.name || m.from.email}
              </span>
              <span className="text-[0.68rem] tnum text-[var(--color-dim)] shrink-0">{fmtDate(m.date)}</span>
            </div>
            <div className="text-[0.68rem] text-[var(--color-dim)] mt-0.5">
              to {m.to.map((t) => t.name || t.email).join(", ") || "—"}
            </div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-[var(--color-ink-soft)]">
              {m.text || m.snippet}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
