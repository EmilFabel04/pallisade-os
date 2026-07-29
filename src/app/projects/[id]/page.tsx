"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, FolderKanban } from "lucide-react";
import { useStore } from "@/lib/store";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { TaskForm } from "@/components/forms/TaskForm";
import { MilestoneForm } from "@/components/projects/MilestoneForm";
import { OverviewTab } from "@/components/projects/OverviewTab";
import { MilestonesTab } from "@/components/projects/MilestonesTab";
import { TasksTab } from "@/components/projects/TasksTab";
import { RepoTab } from "@/components/projects/RepoTab";
import { useRepo } from "@/components/projects/useRepo";
import type { Milestone } from "@/lib/types";
import { priorityTone, projectStageTone } from "@/lib/badges";
import { cn } from "@/lib/utils";

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
        <OverviewTab
          project={project}
          projectMilestones={projectMilestones}
          repo={repo}
          onEditMilestone={setEditMilestone}
        />
      )}

      {tab === "Milestones" && (
        <MilestonesTab
          project={project}
          projectMilestones={projectMilestones}
          projectTasks={projectTasks}
          onAddMilestone={() => setAddingMilestone(true)}
          onEditMilestone={setEditMilestone}
          onDeleteMilestone={setDeleteMilestone}
        />
      )}

      {tab === "Tasks" && (
        <TasksTab
          projectMilestones={projectMilestones}
          projectTasks={projectTasks}
          onAddTask={() => setAddingTask(true)}
          onToggleTask={(t) => update("tasks", t.id, { status: t.status === "done" ? "not started" : "done" })}
        />
      )}

      {tab === "Repo" && <RepoTab project={project} repo={repo} />}

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
