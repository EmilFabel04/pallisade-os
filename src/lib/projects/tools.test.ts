import { describe, it, expect } from "vitest";
import { PROJECT_TOOLS, SERVER_TOOL_NAMES, resolveProjectTool, type ProjectSnapshot } from "./tools";
import type { ProposedAction } from "@/lib/types";

const snapshot: ProjectSnapshot = {
  project: {
    id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
    type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
    dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "", nextAction: "",
    deliverables: "", notes: "", repoPath: null,
  },
  milestones: [{
    id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest",
    startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
    order: 0, dependsOn: [], commitScope: "", notes: "",
  }],
  tasks: [{
    id: "t1", createdAt: "", updatedAt: "", title: "Auth handshake", linkKind: "project",
    linkId: "p1", milestoneId: "m1", category: "delivery", priority: "high",
    status: "in progress", dueDate: null, notes: "",
  }],
};

describe("PROJECT_TOOLS", () => {
  it("declares every read and write tool the prompt promises", () => {
    const names = PROJECT_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "list_milestones", "list_tasks", "read_repo_status", "read_commits",
      "create_milestone", "update_milestone", "create_task", "update_task", "update_project",
    ]));
  });

  it("marks only the git tools as server-resolved", () => {
    expect([...SERVER_TOOL_NAMES].sort()).toEqual(["read_commits", "read_repo_status"]);
  });

  it("requires a name on create_milestone and an id on update_milestone", () => {
    const create = PROJECT_TOOLS.find((t) => t.name === "create_milestone")!;
    const update = PROJECT_TOOLS.find((t) => t.name === "update_milestone")!;
    expect(create.input_schema.required).toContain("name");
    expect(update.input_schema.required).toContain("id");
  });
});

describe("resolveProjectTool — reads", () => {
  it("lists milestones with their ids", () => {
    const out = resolveProjectTool("list_milestones", {}, snapshot, []);
    expect(out).toContain("Ingest");
    expect(out).toContain("m1");
  });

  it("lists tasks and can filter to open ones", () => {
    expect(resolveProjectTool("list_tasks", {}, snapshot, [])).toContain("Auth handshake");
    expect(resolveProjectTool("list_tasks", { status: "done" }, snapshot, [])).not.toContain("Auth handshake");
  });
});

describe("resolveProjectTool — writes queue proposals", () => {
  it("queues a milestone proposal rather than writing", () => {
    const proposals: ProposedAction[] = [];
    const out = resolveProjectTool(
      "create_milestone", { name: "Handover", endDate: "2026-08-10" }, snapshot, proposals,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ tool: "create_milestone", status: "pending" });
    expect(out).toMatch(/confirm/i);
  });

  it("injects the project id so the agent cannot target another project", () => {
    const proposals: ProposedAction[] = [];
    resolveProjectTool("create_milestone", { name: "X", projectId: "SOMEWHERE_ELSE" }, snapshot, proposals);
    expect(proposals[0].args.projectId).toBe("p1");
  });

  it("rejects a dependency that would create a cycle", () => {
    const proposals: ProposedAction[] = [];
    const out = resolveProjectTool(
      "update_milestone", { id: "m1", dependsOn: ["m1"] }, snapshot, proposals,
    );
    expect(proposals).toHaveLength(0);
    expect(out).toMatch(/loop|cycle/i);
  });

  it("refuses an unknown tool by name", () => {
    expect(resolveProjectTool("delete_everything", {}, snapshot, [])).toMatch(/unknown tool/i);
  });
});
