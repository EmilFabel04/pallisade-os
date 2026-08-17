import type { Milestone, Project, ProposedAction, Task } from "@/lib/types";
import type { ToolDef } from "@/lib/advisor/tools";
import { MILESTONE_STATUSES, PROJECT_STAGES, TASK_CATEGORIES, TASK_STATUSES } from "@/lib/types";
import { detectCycles } from "./schedule";
import { uid } from "@/lib/utils";

export interface ProjectSnapshot {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
}

type Args = Record<string, unknown>;

const obj = (properties: Record<string, unknown>, required?: string[]): ToolDef["input_schema"] =>
  ({ type: "object", properties, ...(required ? { required } : {}) });
const s = (description = "") => ({ type: "string", description });
const n = (description = "") => ({ type: "number", description });
const enumStr = (values: readonly string[], description = "") =>
  ({ type: "string", enum: [...values], description });
const dateStr = (description = "") =>
  ({ type: "string", description: `ISO date (YYYY-MM-DD). ${description}`.trim() });
const strArr = (description = "") =>
  ({ type: "array", items: { type: "string" }, description });

export const PROJECT_TOOLS: ToolDef[] = [
  // ---- read ----
  { name: "list_milestones", description: "This project's milestones with ids, dates, status and dependencies.",
    input_schema: obj({}) },
  { name: "list_tasks", description: "This project's tasks with ids. Omit status to get every task.",
    input_schema: obj({ status: enumStr(TASK_STATUSES), milestoneId: s() }) },
  { name: "read_repo_status", description: "Current branch, uncommitted file counts, ahead/behind. Only if a repo is linked.",
    input_schema: obj({}) },
  { name: "read_commits", description: "Recent commits from the linked repo, newest first.",
    input_schema: obj({ limit: n("default 30"), since: s("e.g. '2 weeks ago'") }) },

  // ---- write (proposed, need confirmation) ----
  { name: "create_milestone", description: "Propose a new milestone on this project.",
    input_schema: obj({
      name: s(), startDate: dateStr(), endDate: dateStr(),
      status: enumStr(MILESTONE_STATUSES), order: n("lower sorts first"),
      dependsOn: strArr("milestone ids from list_milestones"),
      commitScope: s("conventional-commit scope, e.g. 'ingest'"), notes: s(),
    }, ["name"]) },
  { name: "update_milestone", description: "Propose changes to a milestone. Use an id from list_milestones. Pass only the fields you are changing.",
    input_schema: obj({
      id: s(), name: s(), startDate: dateStr(), endDate: dateStr(),
      status: enumStr(MILESTONE_STATUSES), order: n(),
      dependsOn: strArr(), commitScope: s(), notes: s(),
    }, ["id"]) },
  { name: "create_project_task", description: "Propose a task on THIS project, optionally under a milestone. Scoped to this project — it is not the CRM-wide create_task.",
    input_schema: obj({
      title: s(), milestoneId: s("id from list_milestones"), category: enumStr(TASK_CATEGORIES),
      priority: enumStr(["low", "medium", "high"]), dueDate: dateStr(), notes: s(),
    }, ["title"]) },
  { name: "update_project_task", description: "Propose changes to a task on this project. Use an id from list_tasks.",
    input_schema: obj({
      id: s(), title: s(), status: enumStr(TASK_STATUSES),
      priority: enumStr(["low", "medium", "high"]), dueDate: dateStr(),
      milestoneId: s(), notes: s(),
    }, ["id"]) },
  { name: "update_project", description: "Propose changes to the project itself — stage, blocker, next action, dates.",
    input_schema: obj({
      stage: enumStr(PROJECT_STAGES), priority: enumStr(["low", "medium", "high"]),
      startDate: dateStr(), dueDate: dateStr(), currentBlocker: s(),
      nextAction: s(), deliverables: s(), notes: s(),
    }) },
];

export const PROJECT_TOOL_NAMES = new Set(PROJECT_TOOLS.map((t) => t.name));

const compactMilestone = (m: Milestone) => ({
  id: m.id, name: m.name, status: m.status, start: m.startDate, end: m.endDate,
  order: m.order, dependsOn: m.dependsOn, commitScope: m.commitScope,
});
const compactTask = (t: Task) => ({
  id: t.id, title: t.title, status: t.status, priority: t.priority,
  dueDate: t.dueDate, milestoneId: t.milestoneId,
});

function queue(
  proposals: ProposedAction[],
  tool: string,
  description: string,
  args: Args,
): string {
  proposals.push({ id: uid("act"), tool, description, args, status: "pending" });
  return `Queued "${description}". It is awaiting the founder's confirmation in the UI — it has NOT been applied.`;
}

/**
 * Resolves every project tool, including the two git reads.
 *
 * The git tools used to be resolved by the route through a set this module
 * exported as SERVER_TOOL_NAMES — a name capabilities.ts uses for the exact
 * inverse meaning (Anthropic-executed, never given a tool_result). Owning them
 * here deletes that collision instead of renaming it.
 *
 * Every write injects the snapshot's own projectId, so the agent can only ever
 * propose changes to the project whose thread it is in.
 */
export async function resolveProjectTool(
  name: string,
  args: Args,
  snap: ProjectSnapshot,
  proposals: ProposedAction[],
): Promise<string> {
  const projectId = snap.project.id;
  const repoPath = snap.project.repoPath;

  switch (name) {
    case "read_repo_status":
    case "read_commits": {
      // Not an error: a project with no repo is normal, and git is never
      // load-bearing. The model is told in prose so it can say so.
      if (!repoPath) return "No repo is linked to this project.";
      const { readStatus, readCommits } = await import("@/lib/git/repo");
      try {
        if (name === "read_repo_status") return JSON.stringify(await readStatus(repoPath));
        const limit = Number(args.limit) || 30;
        const since = args.since ? String(args.since) : undefined;
        return JSON.stringify(await readCommits(repoPath, { limit, since }));
      } catch {
        return `The repo at ${repoPath} could not be read right now.`;
      }
    }

    case "list_milestones":
      return JSON.stringify(
        [...snap.milestones].sort((a, b) => a.order - b.order).map(compactMilestone),
      );

    case "list_tasks": {
      let out = snap.tasks;
      if (args.status) out = out.filter((t) => t.status === args.status);
      if (args.milestoneId) out = out.filter((t) => t.milestoneId === args.milestoneId);
      return JSON.stringify(out.map(compactTask));
    }

    case "create_milestone":
      // Default to the end of the list when the model omits `order` — a bare
      // `order: 0` fallback would sort above whatever milestone already holds
      // order 0, displacing it as the project's "current" milestone.
      return queue(proposals, name, `Add milestone "${String(args.name ?? "")}"`, {
        ...args, projectId, order: args.order ?? snap.milestones.length,
      });

    case "update_milestone": {
      const id = String(args.id ?? "");
      const target = snap.milestones.find((m) => m.id === id);
      if (!target) return `No milestone with id ${id} on this project.`;

      // Validate the graph as it WOULD be, so a confirm can never close a loop.
      if (Array.isArray(args.dependsOn)) {
        const next = snap.milestones.map((m) =>
          m.id === id ? { ...m, dependsOn: args.dependsOn as string[] } : m,
        );
        if (detectCycles(next).length > 0) {
          return "Rejected: that dependency would create a loop. Pick a different one.";
        }
      }

      return queue(proposals, name, `Update milestone "${target.name}"`, { ...args, projectId });
    }

    case "create_project_task":
      return queue(proposals, name, `Add task "${String(args.title ?? "")}"`, {
        ...args, linkKind: "project", linkId: projectId,
      });

    case "update_project_task": {
      const id = String(args.id ?? "");
      const target = snap.tasks.find((t) => t.id === id);
      if (!target) return `No task with id ${id} on this project.`;
      return queue(proposals, name, `Update task "${target.title}"`, args);
    }

    case "update_project":
      return queue(proposals, name, `Update project "${snap.project.name}"`, {
        ...args, id: projectId,
      });

    default:
      return `Unknown tool: ${name}`;
  }
}
