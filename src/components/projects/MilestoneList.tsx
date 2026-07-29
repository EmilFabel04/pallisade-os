"use client";

import { Pencil, Trash2, ListChecks } from "lucide-react";
import type { Milestone, MilestoneStatus, Task } from "@/lib/types";
import type { Commit } from "@/lib/git/types";
import { Badge } from "@/components/ui/Badge";
import { milestoneStatusTone } from "@/lib/badges";
import { fmtDate, relativeDay } from "@/lib/utils";

export function MilestoneList({
  milestones,
  tasks,
  commitsByMilestone,
  onEdit,
  onDelete,
  onSuggest,
}: {
  milestones: Milestone[];
  tasks: Task[];
  commitsByMilestone?: Map<string, Commit[]>;
  onEdit: (m: Milestone) => void;
  onDelete: (m: Milestone) => void;
  onSuggest?: (m: Milestone, status: MilestoneStatus) => void;
}) {
  if (milestones.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No milestones yet.</p>;

  const sorted = [...milestones].sort((a, b) => a.order - b.order);

  return (
    <ul className="space-y-1.5">
      {sorted.map((m) => {
        const mt = tasks.filter((t) => t.milestoneId === m.id);
        const done = mt.filter((t) => t.status === "done").length;
        const commits = commitsByMilestone?.get(m.id) ?? [];
        const latest = commits[0]; // git log is newest-first
        const suggestion =
          commits.length > 0 && m.status === "planned" ? ("in progress" as const) : null;
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
              {commits.length > 0 && (
                <p className="text-[0.72rem] text-[var(--color-dim)] tnum">
                  {commits.length} commit{commits.length === 1 ? "" : "s"}
                  {latest && ` · last ${relativeDay(latest.authorDate.slice(0, 10))}`}
                </p>
              )}
            </div>
            {mt.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[0.73rem] text-[var(--color-dim)] tnum shrink-0">
                <ListChecks size={13} /> {done}/{mt.length}
              </span>
            )}
            <Badge tone={milestoneStatusTone(m.status)}>{m.status}</Badge>
            {suggestion && onSuggest && (
              <button
                className="btn btn-sm shrink-0"
                onClick={() => onSuggest(m, suggestion)}
                title="Suggested from commit activity — applies only when you click"
              >
                Mark {suggestion}?
              </button>
            )}
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
