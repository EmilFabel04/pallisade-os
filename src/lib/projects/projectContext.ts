import type { Milestone, Project, ProjectThread, Task } from "@/lib/types";
import type { Commit, RepoStatus } from "@/lib/git/types";
import type { ToolDef } from "@/lib/advisor/tools";

/** Ceiling on a single get_project_context tool result. */
export const CONTEXT_BUDGET = 8000;
const MAX_THREAD_MESSAGES = 15;
const MAX_COMMITS = 10;

export interface ProjectContextInput {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  threads: ProjectThread[];
  repo: RepoStatus | null;
  commits: Commit[];
}

const dash = (v: string) => (v.trim() ? v.trim() : "—");

export function formatProjectContext(input: ProjectContextInput): string {
  const { project: p } = input;

  const milestones = input.milestones.length
    ? [...input.milestones]
        .sort((a, b) => a.order - b.order)
        .map((m) => {
          const dates = m.startDate && m.endDate ? `${m.startDate} → ${m.endDate}` : "no dates";
          return `  - [${m.status}] ${m.name} (${dates})`;
        })
        .join("\n")
    : "  (none)";

  const open = input.tasks.filter((t) => t.status !== "done");
  const tasks = open.length
    ? open.map((t) => `  - [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`).join("\n")
    : "  (none open)";

  let repo: string;
  if (!p.repoPath) {
    repo = "REPO: none linked.";
  } else if (!input.repo) {
    repo = `REPO: ${p.repoPath} (could not be read).`;
  } else {
    const dirty = input.repo.staged + input.repo.unstaged + input.repo.untracked;
    const commits = input.commits.length
      ? "\n" + input.commits.slice(0, MAX_COMMITS)
          .map((c) => `  - ${c.authorDate.slice(0, 10)} ${c.shortHash} ${c.subject}`)
          .join("\n")
      : "\n  (no commits)";
    repo = `REPO: ${p.repoPath} · branch ${input.repo.branch || "(detached)"} · ${dirty} uncommitted${commits}`;
  }

  // Only the most recent thread — older threads are superseded context, not history.
  const newest = [...input.threads]
    .filter((t) => t.projectId === p.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const decisions = newest
    ? newest.messages
        .slice(-MAX_THREAD_MESSAGES)
        .map((m) => `  ${m.role === "user" ? "Founder" : "Agent"}: ${m.content}`)
        .join("\n")
    : "  (no project chat yet — nothing has been decided in a thread)";

  const out =
    `PROJECT: ${p.name}${p.company ? ` · ${p.company}` : ""}\n` +
    `  Type: ${p.type} · Stage: ${p.stage} · Priority: ${p.priority}\n` +
    `  Dates: ${p.startDate ?? "—"} → ${p.dueDate ?? "—"}\n` +
    `  Blocker: ${dash(p.currentBlocker)}\n` +
    `  Next action: ${dash(p.nextAction)}\n` +
    `  Deliverables: ${dash(p.deliverables)}\n\n` +
    `MILESTONES:\n${milestones}\n\n` +
    `OPEN TASKS:\n${tasks}\n\n` +
    `${repo}\n\n` +
    `RECENT DECISIONS (latest project chat):\n${decisions}`;

  return out.length > CONTEXT_BUDGET ? `${out.slice(0, CONTEXT_BUDGET - 13)}\n[truncated]` : out;
}

export const PROJECT_CONTEXT_TOOLS: ToolDef[] = [
  {
    name: "list_projects",
    description: "Every project with its id, stage and next action. Use this to resolve a project name to an id.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_project_context",
    description:
      "Deep context on one project: state, milestones, open tasks, linked repo and recent commits, " +
      "plus what was decided in its most recent project chat. Pass either projectId or name.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "id from list_projects" },
        name: { type: "string", description: "project name, matched case-insensitively" },
      },
    },
  },
];

export const PROJECT_CONTEXT_TOOL_NAMES = new Set(PROJECT_CONTEXT_TOOLS.map((t) => t.name));

/* ---- server-only resolver (reads the DB and the filesystem) ---- */

export async function resolveProjectContextTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { loadAll } = await import("@/lib/db/sqlite");
  const { readCommits, readStatus } = await import("@/lib/git/repo");
  const data = await loadAll();

  if (name === "list_projects") {
    return JSON.stringify(
      data.projects.map((p) => ({
        id: p.id, name: p.name, company: p.company, stage: p.stage,
        priority: p.priority, dueDate: p.dueDate, nextAction: p.nextAction,
      })),
    );
  }

  const wanted = String(args.name ?? "").toLowerCase();
  const project =
    data.projects.find((p) => p.id === args.projectId) ??
    (wanted ? data.projects.find((p) => p.name.toLowerCase().includes(wanted)) : undefined);

  if (!project) return "No matching project. Call list_projects to see what exists.";

  let repo: RepoStatus | null = null;
  let commits: Commit[] = [];
  if (project.repoPath) {
    [repo, commits] = await Promise.all([
      readStatus(project.repoPath).catch(() => null),
      readCommits(project.repoPath, { limit: MAX_COMMITS }).catch(() => [] as Commit[]),
    ]);
  }

  return formatProjectContext({
    project,
    milestones: data.milestones.filter((m) => m.projectId === project.id),
    tasks: data.tasks.filter((t) => t.linkKind === "project" && t.linkId === project.id),
    threads: data.projectThreads,
    repo,
    commits,
  });
}
