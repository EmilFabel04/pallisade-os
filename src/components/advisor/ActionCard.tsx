"use client";

import Link from "next/link";
import { Check, X, Plus, PencilLine, PhoneCall, FolderPlus, ArrowUpRight, CalendarPlus } from "lucide-react";
import type { CollectionKey, ProposedAction } from "@/lib/types";

const ICON: Record<string, typeof Plus> = {
  create_task: Plus,
  create_lead: Plus,
  create_project: FolderPlus,
  log_interaction: PhoneCall,
  update_lead: PencilLine,
  update_task: PencilLine,
  create_calendar_event: CalendarPlus,
};

/** Each addressable collection maps onto its section route (which reads ?focus=). */
const ROUTE: Partial<Record<CollectionKey, string>> = {
  leads: "/leads",
  tasks: "/tasks",
  projects: "/projects",
  interactions: "/interactions",
};

function viewHref(result?: ProposedAction["result"]): string | null {
  if (!result) return null;
  const base = ROUTE[result.kind];
  return base && result.id ? `${base}?focus=${result.id}` : null;
}

export function ActionCard({
  action, onConfirm, onDismiss,
}: {
  action: ProposedAction;
  onConfirm: (a: ProposedAction) => void;
  onDismiss: (a: ProposedAction) => void;
}) {
  const Icon = ICON[action.tool] ?? Plus;
  const done = action.status === "confirmed";
  const skipped = action.status === "dismissed";
  const href = done ? viewHref(action.result) : null;
  const externalUrl = done ? action.externalUrl : null;

  return (
    <div
      className="flex items-center gap-3 rounded-md border bg-[var(--color-surface-2)] px-3 py-2.5 mt-2"
      style={{ borderColor: done ? "var(--color-positive)" : skipped ? "var(--color-line)" : "var(--color-line-strong)" }}
    >
      <Icon size={15} className="shrink-0" style={{ color: done ? "var(--color-positive)" : "var(--color-accent)" }} strokeWidth={1.7} />
      <span className="flex-1 text-[0.82rem] leading-snug text-[var(--color-ink-soft)]">
        {action.description}
      </span>
      {action.status === "pending" ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <button className="btn btn-sm btn-accent" onClick={() => onConfirm(action)}>
            <Check size={13} /> Confirm
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onDismiss(action)}>
            <X size={13} /> Dismiss
          </button>
        </div>
      ) : externalUrl ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[0.72rem] shrink-0 link-accent"
          style={{ color: "var(--color-positive)" }}
        >
          Open in Calendar <ArrowUpRight size={12} />
        </a>
      ) : href ? (
        <Link
          href={href}
          className="flex items-center gap-1 text-[0.72rem] shrink-0 link-accent"
          style={{ color: "var(--color-positive)" }}
        >
          View <ArrowUpRight size={12} />
        </Link>
      ) : (
        <span className="text-[0.72rem] shrink-0" style={{ color: done ? "var(--color-positive)" : "var(--color-dim)" }}>
          {done ? "✓ Done" : "Dismissed"}
        </span>
      )}
    </div>
  );
}
