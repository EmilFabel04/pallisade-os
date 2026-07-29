"use client";

import { Panel } from "@/components/ui/Panel";
import { ProjectChat } from "@/components/projects/ProjectChat";
import type { Milestone, Project, Task } from "@/lib/types";

export function ChatTab({
  project,
  projectMilestones,
  projectTasks,
}: {
  project: Project;
  projectMilestones: Milestone[];
  projectTasks: Task[];
}) {
  return (
    <Panel title="Project chat">
      <ProjectChat project={project} milestones={projectMilestones} tasks={projectTasks} />
    </Panel>
  );
}
