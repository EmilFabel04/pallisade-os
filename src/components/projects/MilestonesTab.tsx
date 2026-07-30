"use client";

import { Plus } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { GanttChart } from "@/components/projects/GanttChart";
import { MilestoneList } from "@/components/projects/MilestoneList";
import type { Commit } from "@/lib/git/types";
import type { Milestone, MilestoneStatus, Project, Task } from "@/lib/types";

export function MilestonesTab({
  project,
  projectMilestones,
  projectTasks,
  commitsByMilestone,
  onAddMilestone,
  onEditMilestone,
  onDeleteMilestone,
  onSuggestMilestoneStatus,
}: {
  project: Project;
  projectMilestones: Milestone[];
  projectTasks: Task[];
  commitsByMilestone?: Map<string, Commit[]>;
  onAddMilestone: () => void;
  onEditMilestone: (m: Milestone) => void;
  onDeleteMilestone: (m: Milestone) => void;
  onSuggestMilestoneStatus?: (m: Milestone, status: MilestoneStatus) => void;
}) {
  return (
    <div className="space-y-4">
      <Panel title="Timeline">
        <GanttChart
          groups={[{ key: project.id, milestones: projectMilestones }]}
          onSelect={onEditMilestone}
        />
      </Panel>
      <Panel
        title="Milestones"
        action={
          <button className="btn btn-sm" onClick={onAddMilestone}>
            <Plus size={13} /> Add
          </button>
        }
      >
        <MilestoneList
          milestones={projectMilestones}
          tasks={projectTasks}
          commitsByMilestone={commitsByMilestone}
          onEdit={onEditMilestone}
          onDelete={onDeleteMilestone}
          onSuggest={onSuggestMilestoneStatus}
        />
      </Panel>
    </div>
  );
}
