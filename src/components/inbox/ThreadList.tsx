"use client";

import { Mail } from "lucide-react";
import type { ThreadSummary } from "@/lib/gmail/gmailClient";
import type { Lead } from "@/lib/types";
import { relativeDay, cn } from "@/lib/utils";

export function ThreadList({
  threads, selectedId, onSelect, leadByEmail, accountEmailById, showAccount,
}: {
  threads: ThreadSummary[];
  selectedId: string | null;
  onSelect: (t: ThreadSummary) => void;
  leadByEmail: Map<string, Lead>;
  accountEmailById: Map<string, string>;
  showAccount: boolean;
}) {
  return (
    <div className="flex flex-col">
      {threads.map((t) => {
        const matched = t.participants.map((e) => leadByEmail.get(e)).find(Boolean);
        const active = t.id === selectedId;
        return (
          <button
            key={`${t.accountId}:${t.id}`}
            onClick={() => onSelect(t)}
            className={cn(
              "text-left w-full px-3 py-2.5 border-b border-[var(--color-line)] transition-colors",
              active ? "bg-[var(--color-surface-2)]" : "hover:bg-[var(--color-surface-2)]",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex-1 truncate text-[0.82rem]",
                  t.unread ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]",
                )}
              >
                {t.from.name || t.from.email}
              </span>
              <span className="shrink-0 text-[0.68rem] tnum text-[var(--color-dim)]">
                {relativeDay(t.date)}
              </span>
            </div>
            <div className={cn("truncate text-[0.8rem] mt-0.5", t.unread ? "text-[var(--color-ink-soft)]" : "text-[var(--color-muted)]")}>
              {t.subject}
            </div>
            <div className="truncate text-[0.74rem] text-[var(--color-dim)] mt-0.5">{t.snippet}</div>
            <div className="flex items-center gap-2 mt-1">
              {matched && (
                <span className="inline-flex items-center text-[0.64rem] rounded px-1.5 py-0.5 bg-[var(--color-surface-3)] text-[var(--color-positive)] border border-[var(--color-line)]">
                  ● {matched.company || matched.contactName || "Lead"}
                </span>
              )}
              {showAccount && (
                <span className="inline-flex items-center gap-1 text-[0.64rem] text-[var(--color-dim)]">
                  <Mail size={10} /> {accountEmailById.get(t.accountId) ?? t.accountId}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
