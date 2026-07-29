"use client";

import { Pencil, Trash2, ListChecks } from "lucide-react";
import type { Milestone, Task } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { milestoneStatusTone } from "@/lib/badges";
import { fmtDate } from "@/lib/utils";

export function MilestoneList({
  milestones,
  tasks,
  onEdit,
  onDelete,
}: {
  milestones: Milestone[];
  tasks: Task[];
  onEdit: (m: Milestone) => void;
  onDelete: (m: Milestone) => void;
}) {
  if (milestones.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No milestones yet.</p>;

  const sorted = [...milestones].sort((a, b) => a.order - b.order);

  return (
    <ul className="space-y-1.5">
      {sorted.map((m) => {
        const mt = tasks.filter((t) => t.milestoneId === m.id);
        const done = mt.filter((t) => t.status === "done").length;
        return (
          <li
            key={m.id}
            className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[0.86rem] text-[var(--color-ink)] truncate">{m.name}</p>
              <p className="text-[0.73rem] text-[var(--color-dim)] tnum">
                {m.startDate || m.endDate ? `${fmtDate(m.startDate)} → ${fmtDate(m.endDate)}` : "No dates set"}
              </p>
            </div>
            {mt.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[0.73rem] text-[var(--color-dim)] tnum shrink-0">
                <ListChecks size={13} /> {done}/{mt.length}
              </span>
            )}
            <Badge tone={milestoneStatusTone(m.status)}>{m.status}</Badge>
            <button onClick={() => onEdit(m)} aria-label="Edit milestone" className="shrink-0 text-[var(--color-dim)] hover:text-[var(--color-ink)]">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDelete(m)} aria-label="Delete milestone" className="shrink-0 text-[var(--color-dim)] hover:text-[var(--color-accent-soft)]">
              <Trash2 size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
