import type { Milestone, Project, Task } from "@/lib/types";
import type { Commit, RepoStatus } from "@/lib/git/types";

/** Hard ceiling on the rendered system prompt. */
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

export function buildProjectSystemPrompt(input: ProjectPromptInput): string {
  const { project: p, businessName, founderName, today } = input;

  const prompt =
    `Today's date is ${today}. Resolve relative dates against it and pass concrete ISO ` +
    `dates (YYYY-MM-DD) to tools.\n\n` +
    `You are the project agent for "${p.name}" — a ${p.type} for ${dash(p.company)}, run by ` +
    `${founderName} at ${businessName}. You know this one project deeply and help ${founderName} ` +
    `plan it, unblock it and keep it honest.\n\n` +
    `PROJECT STATE:\n` +
    `  Stage: ${p.stage} · Priority: ${p.priority}\n` +
    `  Dates: ${p.startDate ?? "—"} → ${p.dueDate ?? "—"}\n` +
    `  Blocker: ${dash(p.currentBlocker)}\n` +
    `  Next action: ${dash(p.nextAction)}\n` +
    `  Deliverables: ${dash(p.deliverables)}\n` +
    `  Notes: ${dash(p.notes)}\n\n` +
    `MILESTONES:\n${milestoneLines(input.milestones)}\n\n` +
    `OPEN TASKS:\n${taskLines(input.tasks)}\n\n` +
    `${repoBlock(p, input.repo, input.commits)}\n\n` +
    `HOW YOU WORK:\n` +
    `- Ground every answer in the state above and in the read tools. Never invent milestones, ` +
    `commits, dates or history. If you don't have a fact, say so.\n` +
    `- Use read_commits and read_repo_status when the founder asks what shipped or where the ` +
    `work stands. Real commits beat recollection.\n` +
    `- When the founder wants to change something, call the matching write tool ` +
    `(create_milestone, update_milestone, create_project_task, update_project_task, update_project). Writes do ` +
    `NOT execute immediately — they are queued as proposals ${founderName} must confirm in the ` +
    `UI. After proposing, say briefly what you've queued and that it awaits confirmation; never ` +
    `claim it is already done.\n` +
    `- For update_* tools always pass an id from the state above, and only the fields you intend ` +
    `to change.\n` +
    `- Be direct, concrete and concise. Confident and brief beats verbose.`;

  return prompt.length > PROMPT_BUDGET
    ? `${prompt.slice(0, PROMPT_BUDGET - 13)}\n[truncated]`
    : prompt;
}
