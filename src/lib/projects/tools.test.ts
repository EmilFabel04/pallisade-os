import { describe, it, expect, vi } from "vitest";
import { PROJECT_TOOLS, resolveProjectTool, type ProjectSnapshot } from "./tools";
import type { ProposedAction } from "@/lib/types";

vi.mock("@/lib/git/repo", () => ({
  readStatus: vi.fn(async () => ({
    branch: "main", ahead: 1, behind: 0, staged: 0, unstaged: 2, untracked: 1, source: "local" as const,
  })),
  readCommits: vi.fn(async () => ([{
    hash: "abc1234", shortHash: "abc1234", subject: "feat(ingest): batch loader",
    body: "", authorDate: "2026-07-18T10:00:00+02:00", files: ["src/ingest.ts"],
  }])),
}));

const snapshot: ProjectSnapshot = {
  project: {
    id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
    type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
    dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "", nextAction: "",
    deliverables: "", notes: "", repoPath: null, repoSlug: null,
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
      "create_milestone", "update_milestone", "create_project_task", "update_project_task", "update_project",
    ]));
  });

  it("requires a name on create_milestone and an id on update_milestone", () => {
    const create = PROJECT_TOOLS.find((t) => t.name === "create_milestone")!;
    const update = PROJECT_TOOLS.find((t) => t.name === "update_milestone")!;
    expect(create.input_schema.required).toContain("name");
    expect(update.input_schema.required).toContain("id");
  });
});

describe("the projects tool module", () => {
  // capabilities.ts:35 exports SERVER_TOOL_NAMES meaning "Anthropic-executed,
  // must NOT receive a tool_result". This module used to export the same name
  // meaning the exact inverse. Re-adding it is a bug, not a refactor.
  it("no longer exports a SERVER_TOOL_NAMES set", async () => {
    const mod = await import("./tools");
    expect("SERVER_TOOL_NAMES" in mod).toBe(false);
  });

  it("names every project tool in PROJECT_TOOL_NAMES", async () => {
    const { PROJECT_TOOLS, PROJECT_TOOL_NAMES } = await import("./tools");
    expect([...PROJECT_TOOL_NAMES].sort()).toEqual(PROJECT_TOOLS.map((t) => t.name).sort());
  });
});

describe("resolveProjectTool — reads", () => {
  it("lists milestones with their ids", async () => {
    const out = await resolveProjectTool("list_milestones", {}, snapshot, []);
    expect(out).toContain("Ingest");
    expect(out).toContain("m1");
  });

  it("lists tasks and can filter to open ones", async () => {
    expect(await resolveProjectTool("list_tasks", {}, snapshot, [])).toContain("Auth handshake");
    expect(await resolveProjectTool("list_tasks", { status: "done" }, snapshot, [])).not.toContain("Auth handshake");
  });
});

describe("resolveProjectTool — writes queue proposals", () => {
  it("queues a milestone proposal rather than writing", async () => {
    const proposals: ProposedAction[] = [];
    const out = await resolveProjectTool(
      "create_milestone", { name: "Handover", endDate: "2026-08-10" }, snapshot, proposals,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ tool: "create_milestone", status: "pending" });
    expect(out).toMatch(/confirm/i);
  });

  it("defaults an omitted order to the end of the list, not 0", async () => {
    // snapshot already has one milestone at order 0. If an agent-created
    // milestone also lands at order 0, it sorts ABOVE the existing one and
    // displaces it as the project's "current" / next milestone.
    const proposals: ProposedAction[] = [];
    await resolveProjectTool("create_milestone", { name: "Handover" }, snapshot, proposals);
    expect(proposals[0].args.order).toBe(snapshot.milestones.length);
    expect(proposals[0].args.order as number).toBeGreaterThan(
      Math.max(...snapshot.milestones.map((m) => m.order)),
    );
  });

  it("respects an explicitly-passed order", async () => {
    const proposals: ProposedAction[] = [];
    await resolveProjectTool("create_milestone", { name: "Handover", order: 3 }, snapshot, proposals);
    expect(proposals[0].args.order).toBe(3);
  });

  it("respects an explicit order of 0 rather than treating it as omitted", async () => {
    // Guards against `??` regressing to `||`, which would treat 0 as falsy
    // and re-introduce the same displacement bug for a deliberate order: 0.
    const proposals: ProposedAction[] = [];
    await resolveProjectTool("create_milestone", { name: "Kickoff", order: 0 }, snapshot, proposals);
    expect(proposals[0].args.order).toBe(0);
  });

  it("injects the project id so the agent cannot target another project", async () => {
    const proposals: ProposedAction[] = [];
    await resolveProjectTool("create_milestone", { name: "X", projectId: "SOMEWHERE_ELSE" }, snapshot, proposals);
    expect(proposals[0].args.projectId).toBe("p1");
  });

  it("rejects a dependency that would create a cycle", async () => {
    const proposals: ProposedAction[] = [];
    const out = await resolveProjectTool(
      "update_milestone", { id: "m1", dependsOn: ["m1"] }, snapshot, proposals,
    );
    expect(proposals).toHaveLength(0);
    expect(out).toMatch(/loop|cycle/i);
  });

  it("refuses an unknown tool by name", async () => {
    expect(await resolveProjectTool("delete_everything", {}, snapshot, [])).toMatch(/unknown tool/i);
  });
});

describe("resolveProjectTool — cross-project write guard", () => {
  // The snapshot-membership check is the ONLY thing standing between a
  // hallucinated/foreign id and a write that lands on another project's
  // record (applyAction performs the store write with no ownership check
  // of its own). These tests must fail if `if (!target) return ...` is
  // ever deleted from resolveProjectTool.
  it("rejects update_milestone for an id not in the snapshot and queues nothing", async () => {
    const proposals: ProposedAction[] = [];
    const out = await resolveProjectTool(
      "update_milestone", { id: "FOREIGN_MILESTONE", name: "Hijacked" }, snapshot, proposals,
    );
    expect(out).toMatch(/no milestone with id/i);
    // Assert on the proposals array itself, not just the return string — a
    // proposal pushed before the guard check would still return a rejection
    // string via a later code path, but a return-value-only assertion would
    // miss that a write got queued anyway.
    expect(proposals).toHaveLength(0);
  });

  it("rejects update_project_task for an id not in the snapshot and queues nothing", async () => {
    const proposals: ProposedAction[] = [];
    const out = await resolveProjectTool(
      "update_project_task", { id: "FOREIGN_TASK", title: "Hijacked" }, snapshot, proposals,
    );
    expect(out).toMatch(/no task with id/i);
    expect(proposals).toHaveLength(0);
  });
});

describe("resolveProjectTool — git", () => {
  const linked: ProjectSnapshot = {
    ...snapshot,
    project: { ...snapshot.project, repoPath: "/Users/e/code/acme" },
  };

  it("returns real branch and dirty-file data from read_repo_status", async () => {
    const out = await resolveProjectTool("read_repo_status", {}, linked, []);
    expect(JSON.parse(out)).toMatchObject({ branch: "main", unstaged: 2 });
  });

  it("returns real commits from read_commits", async () => {
    const out = await resolveProjectTool("read_commits", { limit: 5 }, linked, []);
    expect(JSON.parse(out)[0]).toMatchObject({ shortHash: "abc1234" });
  });

  it("says so plainly when no repo is linked, rather than erroring", async () => {
    const out = await resolveProjectTool("read_repo_status", {}, snapshot, []);
    expect(out).toBe("No repo is linked to this project.");
  });
});
