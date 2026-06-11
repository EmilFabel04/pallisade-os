"use client";

import { Check, X, Plus, PencilLine, PhoneCall, FolderPlus } from "lucide-react";
import type { ProposedAction } from "@/lib/types";

const ICON: Record<string, typeof Plus> = {
  create_task: Plus,
  create_lead: Plus,
  create_project: FolderPlus,
  log_interaction: PhoneCall,
  update_lead: PencilLine,
};

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
      ) : (
        <span className="text-[0.72rem] shrink-0" style={{ color: done ? "var(--color-positive)" : "var(--color-dim)" }}>
          {done ? "✓ Done" : "Dismissed"}
        </span>
      )}
    </div>
  );
}
