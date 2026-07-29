"use client";

import { Plus } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { GanttChart } from "@/components/projects/GanttChart";
import { MilestoneList } from "@/components/projects/MilestoneList";
import type { Milestone, Project, Task } from "@/lib/types";

export function MilestonesTab({
  project,
  projectMilestones,
  projectTasks,
  onAddMilestone,
  onEditMilestone,
  onDeleteMilestone,
}: {
  project: Project;
  projectMilestones: Milestone[];
  projectTasks: Task[];
  onAddMilestone: () => void;
  onEditMilestone: (m: Milestone) => void;
  onDeleteMilestone: (m: Milestone) => void;
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
          onEdit={onEditMilestone}
          onDelete={onDeleteMilestone}
        />
      </Panel>
    </div>
  );
}
