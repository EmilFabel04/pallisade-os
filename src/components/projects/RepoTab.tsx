"use client";

import { Panel } from "@/components/ui/Panel";
import { RepoLink } from "@/components/projects/RepoLink";
import type { Project } from "@/lib/types";

export function RepoTab({ project }: { project: Project }) {
  return (
    <Panel title="Repository">
      <RepoLink project={project} />
    </Panel>
  );
}
