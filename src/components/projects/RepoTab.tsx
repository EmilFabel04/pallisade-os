"use client";

import { Panel } from "@/components/ui/Panel";
import { RepoLink } from "@/components/projects/RepoLink";
import { CommitFeed } from "@/components/projects/CommitFeed";
import type { RepoState } from "@/components/projects/useRepo";
import type { Project } from "@/lib/types";

export function RepoTab({ project, repo }: { project: Project; repo: RepoState }) {
  return (
    <div className="space-y-4">
      <Panel title="Repository">
        <RepoLink project={project} />
      </Panel>
      {project.repoPath && (
        <Panel title="Recent commits">
          {repo.loading ? (
            <p className="text-[0.8rem] text-[var(--color-muted)]">Reading repo…</p>
          ) : repo.error ? (
            <p className="text-[0.8rem] text-[var(--color-accent-soft)]">
              Couldn&apos;t read the repo at {project.repoPath}. Re-link it above.
            </p>
          ) : (
            <CommitFeed commits={repo.commits} />
          )}
        </Panel>
      )}
    </div>
  );
}
