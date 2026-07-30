"use client";

import { AlertOctagon, ArrowRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { DetailGrid, DetailRow } from "@/components/ui/Detail";
import { GanttChart } from "@/components/projects/GanttChart";
import { CommitFeed } from "@/components/projects/CommitFeed";
import type { RepoState } from "@/components/projects/useRepo";
import type { Milestone, Project } from "@/lib/types";
import { fmtDate, relativeDay } from "@/lib/utils";

export function OverviewTab({
  project,
  projectMilestones,
  repo,
  onEditMilestone,
}: {
  project: Project;
  projectMilestones: Milestone[];
  repo: RepoState;
  onEditMilestone: (m: Milestone) => void;
}) {
  const nextMilestone = projectMilestones.find((m) => m.status !== "done") ?? null;

  return (
    <div className="space-y-4">
      <Panel title="Timeline">
        <GanttChart
          groups={[{ key: project.id, milestones: projectMilestones }]}
          onSelect={onEditMilestone}
        />
      </Panel>
      <Panel title="Status">
        <DetailGrid>
          <DetailRow label="Start date">{fmtDate(project.startDate)}</DetailRow>
          <DetailRow label="Due date">
            {project.dueDate ? `${fmtDate(project.dueDate)} (${relativeDay(project.dueDate)})` : "—"}
          </DetailRow>
          <DetailRow label="Next milestone" full>{nextMilestone?.name ?? "—"}</DetailRow>
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
      {project.repoPath && !repo.error && repo.commits.length > 0 && (
        <Panel title="Recent commits">
          <CommitFeed commits={repo.commits} limit={5} />
        </Panel>
      )}
    </div>
  );
}
