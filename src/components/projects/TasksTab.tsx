"use client";

import { Plus, CheckCircle2, Circle } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import type { Milestone, Task } from "@/lib/types";
import { taskStatusTone } from "@/lib/badges";
import { cn } from "@/lib/utils";

export function TasksTab({
  projectMilestones,
  projectTasks,
  onAddTask,
  onToggleTask,
}: {
  projectMilestones: Milestone[];
  projectTasks: Task[];
  onAddTask: () => void;
  onToggleTask: (t: Task) => void;
}) {
  return (
    <Panel
      title="Tasks"
      action={
        <button className="btn btn-sm" onClick={onAddTask}>
          <Plus size={13} /> Add
        </button>
      }
    >
      <GroupedTasks milestones={projectMilestones} tasks={projectTasks} onToggle={onToggleTask} />
    </Panel>
  );
}

function GroupedTasks({
  milestones,
  tasks,
  onToggle,
}: {
  milestones: Milestone[];
  tasks: Task[];
  onToggle: (t: Task) => void;
}) {
  const groups = [
    ...milestones.map((m) => ({ key: m.id, label: m.name, items: tasks.filter((t) => t.milestoneId === m.id) })),
    {
      key: "unassigned",
      label: "Unassigned",
      items: tasks.filter((t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId)),
    },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No tasks linked yet.</p>;

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="eyebrow mb-2">{g.label}</p>
          <ul className="space-y-1.5">
            {g.items.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                <button onClick={() => onToggle(t)} className="shrink-0" aria-label="Toggle done">
                  {t.status === "done"
                    ? <CheckCircle2 size={16} className="text-[var(--color-positive)]" />
                    : <Circle size={16} className="text-[var(--color-dim)] hover:text-[var(--color-ink)]" />}
                </button>
                <span className={cn("flex-1 text-[0.83rem]", t.status === "done" ? "line-through text-[var(--color-dim)]" : "text-[var(--color-ink-soft)]")}>
                  {t.title}
                </span>
                <Badge tone={taskStatusTone(t.status)} dot={false}>{t.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
