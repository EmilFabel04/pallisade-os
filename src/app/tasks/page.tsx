"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ListChecks,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  Link2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusParam } from "@/components/useFocus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { TaskForm } from "@/components/forms/TaskForm";
import type { Task } from "@/lib/types";
import { priorityTone, taskStatusTone } from "@/lib/badges";
import { relativeDay, isOverdue, todayISO, addDaysISO, cn } from "@/lib/utils";

type ViewKey = "today" | "week" | "overdue" | "all" | "sales" | "product" | "delivery";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "overdue", label: "Overdue" },
  { key: "all", label: "All" },
  { key: "sales", label: "Sales" },
  { key: "product", label: "Product" },
  { key: "delivery", label: "Delivery" },
];

function TasksView() {
  const { tasks, leads, projects, update, remove } = useStore();
  const focusId = useFocusParam();

  const [view, setView] = useState<ViewKey>("today");
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (focusId) setEditId(focusId);
  }, [focusId]);

  const today = todayISO();
  const weekEnd = addDaysISO(today, 7);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done");
    return {
      today: open.filter((t) => t.dueDate?.slice(0, 10) === today).length,
      week: open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) >= today && t.dueDate.slice(0, 10) <= weekEnd).length,
      overdue: open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today).length,
      all: tasks.length,
      sales: tasks.filter((t) => t.category === "sales").length,
      product: tasks.filter((t) => t.category === "product").length,
      delivery: tasks.filter((t) => t.category === "delivery").length,
    } as Record<ViewKey, number>;
  }, [tasks, today, weekEnd]);

  const filtered = useMemo(() => {
    const open = (t: Task) => t.status !== "done";
    let list = tasks;
    switch (view) {
      case "today":
        list = tasks.filter((t) => open(t) && t.dueDate?.slice(0, 10) === today);
        break;
      case "week":
        list = tasks.filter((t) => open(t) && t.dueDate && t.dueDate.slice(0, 10) >= today && t.dueDate.slice(0, 10) <= weekEnd);
        break;
      case "overdue":
        list = tasks.filter((t) => open(t) && t.dueDate && t.dueDate.slice(0, 10) < today);
        break;
      case "sales":
      case "product":
      case "delivery":
        list = tasks.filter((t) => t.category === view);
        break;
      default:
        list = tasks;
    }
    return [...list].sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (b.status === "done" && a.status !== "done") return -1;
      return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
    });
  }, [tasks, view, today, weekEnd]);

  const edit = tasks.find((t) => t.id === editId) ?? null;

  const linkName = (t: Task): string | null => {
    if (t.linkKind === "lead") return leads.find((l) => l.id === t.linkId)?.company ?? null;
    if (t.linkKind === "project") return projects.find((p) => p.id === t.linkId)?.name ?? null;
    return null;
  };

  const cycleStatus = (t: Task) => {
    const order: Task["status"][] = ["not started", "in progress", "blocked", "done"];
    const next = order[(order.indexOf(t.status) + 1) % order.length];
    update("tasks", t.id, { status: next });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle="Everything that needs doing — filtered the way you actually work."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Task
          </button>
        }
      />

      {/* View tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-line)] pb-px -mb-px overflow-x-auto">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={cn(
              "relative px-3.5 py-2 text-[0.82rem] whitespace-nowrap transition-colors",
              view === v.key ? "text-[var(--color-ink)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink-soft)]",
            )}
          >
            {v.label}
            <span className="tnum ml-1.5 text-[0.72rem] text-[var(--color-dim)]">{counts[v.key]}</span>
            {view === v.key && <span className="absolute left-0 right-0 -bottom-px h-[2px]" style={{ background: "var(--color-accent)" }} />}
          </button>
        ))}
      </div>

      <Panel noPad>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing here"
            message={view === "today" ? "No tasks due today. Enjoy the clear runway — or pull something forward." : view === "overdue" ? "No overdue tasks. You're on top of it." : "No tasks in this view yet."}
            action={<button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Add Task</button>}
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {filtered.map((t) => {
              const link = linkName(t);
              const overdue = t.status !== "done" && t.dueDate && isOverdue(t.dueDate);
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors group">
                  <button onClick={() => update("tasks", t.id, { status: t.status === "done" ? "not started" : "done" })} className="shrink-0" aria-label="Toggle done">
                    {t.status === "done" ? (
                      <CheckCircle2 size={18} className="text-[var(--color-positive)]" />
                    ) : (
                      <Circle size={18} className="text-[var(--color-dim)] hover:text-[var(--color-ink)]" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className={cn("text-[0.88rem]", t.status === "done" ? "line-through text-[var(--color-dim)]" : "text-[var(--color-ink)]")}>
                      {t.title}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[0.73rem] text-[var(--color-dim)]">
                      <span>{t.category}</span>
                      {link && <span className="inline-flex items-center gap-1"><Link2 size={11} /> {link}</span>}
                    </div>
                  </div>

                  <button onClick={() => cycleStatus(t)} title="Click to cycle status" className="shrink-0">
                    <Badge tone={taskStatusTone(t.status)} dot={false}>{t.status}</Badge>
                  </button>
                  <div className="hidden sm:block shrink-0"><Badge tone={priorityTone(t.priority)} dot={false}>{t.priority}</Badge></div>
                  <div className="w-20 text-right shrink-0">
                    {t.dueDate ? (
                      <span className={cn("tnum text-[0.78rem]", overdue ? "text-[var(--color-accent-soft)]" : "text-[var(--color-muted)]")}>{relativeDay(t.dueDate)}</span>
                    ) : (
                      <span className="text-[var(--color-dim)] text-[0.78rem]">—</span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditId(t.id)} aria-label="Edit"><Pencil size={14} /></button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteId(t.id)} aria-label="Delete"><Trash2 size={14} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add Task" subtitle="Capture something to do">
        <TaskForm onClose={() => setCreating(false)} />
      </Modal>
      <Modal open={!!edit} onClose={() => setEditId(null)} title="Edit task">
        {edit && <TaskForm initial={edit} onClose={() => setEditId(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) remove("tasks", deleteId); }}
        title="Delete task?"
        message="This permanently removes the task."
      />
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksView />
    </Suspense>
  );
}
