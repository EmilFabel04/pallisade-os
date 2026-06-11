"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import {
  FolderKanban,
  Plus,
  Pencil,
  Trash2,
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  Circle,
  ListChecks,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useFocusParam } from "@/components/useFocus";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { DetailGrid, DetailRow, FilterSelect } from "@/components/ui/Detail";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { TaskForm } from "@/components/forms/TaskForm";
import { PROJECT_STAGES, PROJECT_TYPES, type Project, type Task } from "@/lib/types";
import { priorityTone, projectStageTone, taskStatusTone } from "@/lib/badges";
import { fmtDate, relativeDay, isOverdue, cn } from "@/lib/utils";

function ProjectsView() {
  const { projects, tasks, update, remove } = useStore();
  const focusId = useFocusParam();

  const [fStage, setFStage] = useState("all");
  const [fType, setFType] = useState("all");
  const [viewId, setViewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [addTaskFor, setAddTaskFor] = useState<Project | null>(null);

  useEffect(() => {
    if (focusId) setViewId(focusId);
  }, [focusId]);

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        if (fStage !== "all" && p.stage !== fStage) return false;
        if (fType !== "all" && p.type !== fType) return false;
        return true;
      }),
    [projects, fStage, fType],
  );

  const tasksFor = (id: string) => tasks.filter((t) => t.linkKind === "project" && t.linkId === id);
  const view = projects.find((p) => p.id === viewId) ?? null;
  const edit = projects.find((p) => p.id === editId) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        subtitle="Active client and demo work — stage, blockers, next actions and the tasks behind each one."
        actions={
          <button className="btn btn-accent" onClick={() => setCreating(true)}>
            <Plus size={15} /> Add Project
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <FilterSelect label="Stage" value={fStage} onChange={setFStage} options={[{ value: "all", label: "All stages" }, ...PROJECT_STAGES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect label="Type" value={fType} onChange={setFType} options={[{ value: "all", label: "All types" }, ...PROJECT_TYPES.map((s) => ({ value: s, label: s }))]} />
      </div>

      {filtered.length === 0 ? (
        <Panel noPad>
          <EmptyState
            icon={FolderKanban}
            title={projects.length === 0 ? "No projects yet" : "No projects match"}
            message={projects.length === 0 ? "Add a project to track demo or paid work from idea to closed." : "Try clearing a filter."}
            action={projects.length === 0 ? <button className="btn btn-accent" onClick={() => setCreating(true)}><Plus size={15} /> Add Project</button> : undefined}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const pt = tasksFor(p.id);
            const done = pt.filter((t) => t.status === "done").length;
            return (
              <button key={p.id} onClick={() => setViewId(p.id)} className="panel p-4 text-left hover:border-[var(--color-line-strong)] transition-colors flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)] truncate">{p.name}</h3>
                    <p className="text-[0.76rem] text-[var(--color-dim)] truncate">{p.company}</p>
                  </div>
                  <Badge tone={priorityTone(p.priority)} dot={false}>{p.priority}</Badge>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={projectStageTone(p.stage)}>{p.stage}</Badge>
                  <span className="chip">{p.type}</span>
                </div>

                {p.nextAction && (
                  <p className="text-[0.79rem] text-[var(--color-ink-soft)] leading-snug flex items-start gap-1.5">
                    <ArrowRight size={13} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{p.nextAction}</span>
                  </p>
                )}
                {p.currentBlocker && (
                  <p className="text-[0.76rem] text-[var(--color-accent-soft)] leading-snug flex items-start gap-1.5">
                    <AlertOctagon size={12} className="mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{p.currentBlocker}</span>
                  </p>
                )}

                <div className="mt-auto pt-2 flex items-center justify-between text-[0.74rem] text-[var(--color-dim)] border-t border-[var(--color-line)]">
                  <span className="inline-flex items-center gap-1.5"><ListChecks size={13} /> {done}/{pt.length} tasks</span>
                  {p.dueDate && (
                    <span className={cn("tnum", isOverdue(p.dueDate) && p.stage !== "closed" ? "text-[var(--color-accent-soft)]" : "")}>
                      Due {relativeDay(p.dueDate)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail */}
      <Modal
        open={!!view}
        onClose={() => setViewId(null)}
        title={view?.name ?? ""}
        subtitle={view?.company}
        size="lg"
        footer={
          view && (
            <>
              <button className="btn" onClick={() => setAddTaskFor(view)}><Plus size={15} /> Add task</button>
              <button className="btn" onClick={() => { setEditId(view.id); setViewId(null); }}><Pencil size={15} /> Edit</button>
              <button className="btn" onClick={() => setDeleteId(view.id)} style={{ color: "var(--color-accent-soft)" }}><Trash2 size={15} /> Delete</button>
            </>
          )
        }
      >
        {view && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone={projectStageTone(view.stage)}>{view.stage}</Badge>
              <Badge tone={priorityTone(view.priority)} dot={false}>{view.priority} priority</Badge>
              <span className="chip">{view.type}</span>
            </div>

            <DetailGrid>
              <DetailRow label="Start date">{fmtDate(view.startDate)}</DetailRow>
              <DetailRow label="Due date">{view.dueDate ? `${fmtDate(view.dueDate)} (${relativeDay(view.dueDate)})` : ""}</DetailRow>
              <DetailRow label="Current milestone" full>{view.currentMilestone}</DetailRow>
              <DetailRow label="Current blocker" full>{view.currentBlocker}</DetailRow>
              <DetailRow label="Next action" full>{view.nextAction}</DetailRow>
              <DetailRow label="Deliverables" full>{view.deliverables}</DetailRow>
              <DetailRow label="Notes" full>{view.notes}</DetailRow>
            </DetailGrid>

            {/* Linked tasks */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <p className="eyebrow">Linked tasks</p>
                <button className="btn btn-sm" onClick={() => setAddTaskFor(view)}><Plus size={13} /> Add</button>
              </div>
              <LinkedTasks tasks={tasksFor(view.id)} onToggle={(t) => update("tasks", t.id, { status: t.status === "done" ? "not started" : "done" })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add Project" subtitle="Track a new piece of work">
        <ProjectForm onClose={() => setCreating(false)} />
      </Modal>
      <Modal open={!!edit} onClose={() => setEditId(null)} title={`Edit — ${edit?.name ?? ""}`}>
        {edit && <ProjectForm initial={edit} onClose={() => setEditId(null)} />}
      </Modal>
      <Modal open={!!addTaskFor} onClose={() => setAddTaskFor(null)} title="Add Task" subtitle={addTaskFor ? `Linked to ${addTaskFor.name}` : ""}>
        {addTaskFor && <TaskForm presetLink={{ kind: "project", id: addTaskFor.id }} onClose={() => setAddTaskFor(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) remove("projects", deleteId); setViewId(null); }}
        title="Delete project?"
        message="This removes the project. Linked tasks are kept but will no longer be linked."
      />
    </div>
  );
}

function LinkedTasks({ tasks, onToggle }: { tasks: Task[]; onToggle: (t: Task) => void }) {
  if (tasks.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No tasks linked yet.</p>;
  return (
    <ul className="space-y-1.5">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
          <button onClick={() => onToggle(t)} className="shrink-0" aria-label="Toggle done">
            {t.status === "done" ? (
              <CheckCircle2 size={16} className="text-[var(--color-positive)]" />
            ) : (
              <Circle size={16} className="text-[var(--color-dim)] hover:text-[var(--color-ink)]" />
            )}
          </button>
          <span className={cn("flex-1 text-[0.83rem]", t.status === "done" ? "line-through text-[var(--color-dim)]" : "text-[var(--color-ink-soft)]")}>
            {t.title}
          </span>
          <Badge tone={taskStatusTone(t.status)} dot={false}>{t.status}</Badge>
        </li>
      ))}
    </ul>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsView />
    </Suspense>
  );
}
