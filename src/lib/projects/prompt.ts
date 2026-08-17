import type { Milestone, Project, Task } from "@/lib/types";
import type { Commit, RepoStatus } from "@/lib/git/types";

/** Hard ceiling on the rendered project state block. */
export const PROMPT_BUDGET = 24000;

export interface ProjectPromptInput {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  repo: RepoStatus | null;
  commits: Commit[];
  businessName: string;
  founderName: string;
  today: string; // YYYY-MM-DD
}

const dash = (v: string) => (v.trim() ? v.trim() : "—");

function milestoneLines(milestones: Milestone[]): string {
  if (!milestones.length) return "  (none yet)";
  return [...milestones]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const dates = m.startDate && m.endDate ? `${m.startDate} → ${m.endDate}` : "no dates";
      const deps = m.dependsOn.length ? ` · depends on ${m.dependsOn.length}` : "";
      return `  - [${m.status}] ${m.name} (${dates})${deps} · id=${m.id}`;
    })
    .join("\n");
}

function taskLines(tasks: Task[]): string {
  const open = tasks.filter((t) => t.status !== "done");
  if (!open.length) return "  (no open tasks)";
  return open
    .map((t) => `  - [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""} · id=${t.id}`)
    .join("\n");
}

function repoBlock(project: Project, repo: RepoStatus | null, commits: Commit[]): string {
  if (!project.repoPath) return "REPOSITORY: no repo linked to this project.";
  if (!repo) return `REPOSITORY: linked to ${project.repoPath}, but it could not be read right now.`;

  const dirty = repo.staged + repo.unstaged + repo.untracked;
  const head =
    `REPOSITORY: ${project.repoPath} · branch ${repo.branch || "(detached)"} · ` +
    `${dirty} uncommitted file(s) · ${repo.ahead} ahead / ${repo.behind} behind`;

  if (!commits.length) return `${head}\nRecent commits: (none)`;

  const lines = commits
    .slice(0, 20)
    // The GitHub reader cannot fill `files` without one request per commit,
    // so the clause is omitted rather than reported as "(0 files)" — which
    // would tell the model the commit touched nothing.
    .map((c) => {
      const files = c.files.length ? ` (${c.files.length} files)` : "";
      return `  - ${c.authorDate.slice(0, 10)} ${c.shortHash} ${c.subject}${files}`;
    })
    .join("\n");

  return `${head}\nRecent commits (newest first):\n${lines}`;
}

/**
 * The factual state block for one project: state, milestones, open tasks and
 * repo. Appended after the rendered persona body, the shape brain/route.ts
 * uses for attachments.
 *
 * Renamed from buildProjectSystemPrompt: it no longer builds a system prompt,
 * and a name that says it does would be the last thing in the codebase
 * claiming the persona lives in TypeScript.
 */
export function buildProjectStateBlock(input: ProjectPromptInput): string {
  const { project: p } = input;

  const block =
    `PROJECT: ${p.name} — a ${p.type} for ${dash(p.company)}\n` +
    `  Stage: ${p.stage} · Priority: ${p.priority}\n` +
    `  Dates: ${p.startDate ?? "—"} → ${p.dueDate ?? "—"}\n` +
    `  Blocker: ${dash(p.currentBlocker)}\n` +
    `  Next action: ${dash(p.nextAction)}\n` +
    `  Deliverables: ${dash(p.deliverables)}\n` +
    `  Notes: ${dash(p.notes)}\n\n` +
    `MILESTONES:\n${milestoneLines(input.milestones)}\n\n` +
    `OPEN TASKS:\n${taskLines(input.tasks)}\n\n` +
    `${repoBlock(p, input.repo, input.commits)}`;

  return block.length > PROMPT_BUDGET
    ? `${block.slice(0, PROMPT_BUDGET - 13)}\n[truncated]`
    : block;
}
