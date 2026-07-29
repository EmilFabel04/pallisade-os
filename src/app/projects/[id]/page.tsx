"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Pencil,
  AlertOctagon,
  ArrowRight,
  FolderKanban,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { DetailGrid, DetailRow } from "@/components/ui/Detail";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { TaskForm } from "@/components/forms/TaskForm";
import { GanttChart } from "@/components/projects/GanttChart";
import { MilestoneForm } from "@/components/projects/MilestoneForm";
import { MilestoneList } from "@/components/projects/MilestoneList";
import { RepoLink } from "@/components/projects/RepoLink";
import { useRepo } from "@/components/projects/useRepo";
import type { Milestone, Task } from "@/lib/types";
import { priorityTone, projectStageTone, taskStatusTone } from "@/lib/badges";
import { fmtDate, relativeDay, cn } from "@/lib/utils";

const TABS = ["Overview", "Milestones", "Tasks", "Repo"] as const;
type Tab = (typeof TABS)[number];

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projects, milestones, tasks, update, remove } = useStore();
  const [tab, setTab] = useState<Tab>("Overview");
  const [editing, setEditing] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [editMilestone, setEditMilestone] = useState<Milestone | null>(null);
  const [deleteMilestone, setDeleteMilestone] = useState<Milestone | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  const project = projects.find((p) => p.id === id) ?? null;
  const projectMilestones = useMemo(
    () => milestones.filter((m) => m.projectId === id).sort((a, b) => a.order - b.order),
    [milestones, id],
  );
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.linkKind === "project" && t.linkId === id),
    [tasks, id],
  );
  const repo = useRepo(project?.repoPath ?? null);

  if (!project)
    return (
      <Panel noPad>
        <EmptyState
          icon={FolderKanban}
          title="Project not found"
          message="It may have been deleted."
          action={<Link className="btn" href="/projects">Back to projects</Link>}
        />
      </Panel>
    );

  const nextMilestone = projectMilestones.find((m) => m.status !== "done") ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-[0.74rem] text-[var(--color-muted)] hover:text-[var(--color-ink)] mb-1.5">
            <ArrowLeft size={13} /> Projects
          </Link>
          <h1 className="text-[1.35rem] font-semibold text-[var(--color-ink)] truncate">{project.name}</h1>
          <p className="text-[0.8rem] text-[var(--color-dim)]">{project.company}</p>
          {project.repoPath && (
            <p className="text-[0.74rem] text-[var(--color-dim)] tnum mt-0.5">
              {repo.error ? (
                <span className="text-[var(--color-accent-soft)]">
                  Repo not found at {project.repoPath}
                </span>
              ) : repo.status ? (
                <>
                  {repo.status.branch || "(detached)"}
                  {repo.status.staged + repo.status.unstaged + repo.status.untracked > 0 &&
                    ` · ${repo.status.staged + repo.status.unstaged + repo.status.untracked} uncommitted`}
                  {repo.status.ahead > 0 && ` · ${repo.status.ahead} ahead`}
                  {repo.status.behind > 0 && ` · ${repo.status.behind} behind`}
                </>
              ) : (
                "Reading repo…"
              )}
            </p>
          )}
        </div>
        <button className="btn shrink-0" onClick={() => setEditing(true)}>
          <Pencil size={15} /> Edit
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone={projectStageTone(project.stage)}>{project.stage}</Badge>
        <Badge tone={priorityTone(project.priority)} dot={false}>{project.priority} priority</Badge>
        <span className="chip">{project.type}</span>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-line)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-[0.82rem] border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-dim)] hover:text-[var(--color-ink)]",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-4">
          <Panel title="Timeline">
            <GanttChart
              groups={[{ key: project.id, milestones: projectMilestones }]}
              onSelect={setEditMilestone}
            />
          </Panel>
          <Panel title="Status">
            <DetailGrid>
              <DetailRow label="Start date">{fmtDate(project.startDate)}</DetailRow>
              <DetailRow label="Due date">
                {project.dueDate ? `${fmtDate(project.dueDate)} (${relativeDay(project.dueDate)})` : "—"}
              </DetailRow>
              <DetailRow label="Next milestone" full>{nextMilestone?.name ?? "—"}</DetailRow>
              <DetailRow label="Current blocker" full>{project.currentBlocker}</DetailRow>
              <DetailRow label="Next action" full>{project.nextAction}</DetailRow>
              <DetailRow label="Deliverables" full>{project.deliverables}</DetailRow>
              <DetailRow label="Notes" full>{project.notes}</DetailRow>
            </DetailGrid>
          </Panel>
          {project.currentBlocker && (
            <p className="text-[0.8rem] text-[var(--color-accent-soft)] flex items-start gap-1.5">
              <AlertOctagon size={13} className="mt-0.5 shrink-0" />
              {project.currentBlocker}
            </p>
          )}
          {project.nextAction && (
            <p className="text-[0.8rem] text-[var(--color-ink-soft)] flex items-start gap-1.5">
              <ArrowRight size={13} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
              {project.nextAction}
            </p>
          )}
        </div>
      )}

      {tab === "Milestones" && (
        <div className="space-y-4">
          <Panel title="Timeline">
            <GanttChart
              groups={[{ key: project.id, milestones: projectMilestones }]}
              onSelect={setEditMilestone}
            />
          </Panel>
          <Panel
            title="Milestones"
            action={
              <button className="btn btn-sm" onClick={() => setAddingMilestone(true)}>
                <Plus size={13} /> Add
              </button>
            }
          >
            <MilestoneList
              milestones={projectMilestones}
              tasks={projectTasks}
              onEdit={setEditMilestone}
              onDelete={setDeleteMilestone}
            />
          </Panel>
        </div>
      )}

      {tab === "Tasks" && (
        <Panel
          title="Tasks"
          action={
            <button className="btn btn-sm" onClick={() => setAddingTask(true)}>
              <Plus size={13} /> Add
            </button>
          }
        >
          <GroupedTasks
            milestones={projectMilestones}
            tasks={projectTasks}
            onToggle={(t) => update("tasks", t.id, { status: t.status === "done" ? "not started" : "done" })}
          />
        </Panel>
      )}

      {tab === "Repo" && (
        <Panel title="Repository">
          <RepoLink project={project} />
        </Panel>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit — ${project.name}`}>
        <ProjectForm initial={project} onClose={() => setEditing(false)} />
      </Modal>
      <Modal open={addingMilestone} onClose={() => setAddingMilestone(false)} title="Add Milestone" subtitle={project.name}>
        <MilestoneForm
          projectId={project.id}
          nextOrder={projectMilestones.length}
          onClose={() => setAddingMilestone(false)}
        />
      </Modal>
      <Modal open={!!editMilestone} onClose={() => setEditMilestone(null)} title={`Edit — ${editMilestone?.name ?? ""}`}>
        {editMilestone && (
          <MilestoneForm projectId={project.id} initial={editMilestone} onClose={() => setEditMilestone(null)} />
        )}
      </Modal>
      <Modal open={addingTask} onClose={() => setAddingTask(false)} title="Add Task" subtitle={`Linked to ${project.name}`}>
        <TaskForm presetLink={{ kind: "project", id: project.id }} onClose={() => setAddingTask(false)} />
      </Modal>

      <ConfirmDialog
        open={!!deleteMilestone}
        onClose={() => setDeleteMilestone(null)}
        onConfirm={() => {
          if (deleteMilestone) remove("milestones", deleteMilestone.id);
          setDeleteMilestone(null);
        }}
        title="Delete milestone?"
        message="Linked tasks are kept but will move to Unassigned."
      />
    </div>
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
