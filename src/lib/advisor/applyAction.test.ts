import { describe, it, expect, vi } from "vitest";
import { buildTask, buildTaskPatch, buildLead, buildLeadPatch, buildMilestone, buildMilestonePatch, buildProjectPatch, applyAction } from "@/lib/advisor/applyAction";
import type { AdvisorStore } from "@/lib/advisor/applyAction";
import type { ProposedAction } from "@/lib/types";

describe("buildTask", () => {
  it("fills required defaults around the provided title", () => {
    const t = buildTask({ title: "Follow up with Acme", priority: "high" });
    expect(t).toMatchObject({
      title: "Follow up with Acme", priority: "high",
      status: "not started", category: "follow-up", linkKind: "none", linkId: null,
      dueDate: null, notes: "",
    });
  });
});

describe("buildLead", () => {
  it("defaults status/quality/source and coerces value", () => {
    const l = buildLead({ company: "Acme", estimatedValue: "5000" });
    expect(l.company).toBe("Acme");
    expect(l.status).toBe("new");
    expect(l.quality).toBe("medium");
    expect(l.source).toBe("warm lead");
    expect(l.estimatedValue).toBe(5000);
    expect(l.nextFollowUp).toBeNull();
  });
});

describe("buildLeadPatch", () => {
  it("only includes provided keys", () => {
    expect(buildLeadPatch({ status: "won" })).toEqual({ status: "won" });
    expect(buildLeadPatch({})).toEqual({});
  });
});

describe("buildTaskPatch", () => {
  it("includes a milestone reassignment", () => {
    expect(buildTaskPatch({ milestoneId: "m1" })).toEqual({ milestoneId: "m1" });
  });

  it("allows an explicit null through, to unassign a task from its milestone", () => {
    expect(buildTaskPatch({ milestoneId: null })).toEqual({ milestoneId: null });
  });

  it("produces an empty patch for empty args", () => {
    expect(buildTaskPatch({})).toEqual({});
  });

  it("drops an out-of-schema key", () => {
    expect(buildTaskPatch({ linkId: "other-project" })).toEqual({});
  });
});

describe("applyAction", () => {
  it("routes create_task to store.create", () => {
    const store = { create: vi.fn(), update: vi.fn() };
    const action: ProposedAction = {
      id: "a1", tool: "create_task", description: "", status: "pending",
      args: { title: "Call back" },
    };
    applyAction(store as never, action);
    expect(store.create).toHaveBeenCalledWith("tasks", expect.objectContaining({ title: "Call back" }));
  });

  it("routes update_lead to store.update with the id", () => {
    const store = { create: vi.fn(), update: vi.fn() };
    const action: ProposedAction = {
      id: "a2", tool: "update_lead", description: "", status: "pending",
      args: { id: "l1", status: "proposal" },
    };
    applyAction(store as never, action);
    expect(store.update).toHaveBeenCalledWith("leads", "l1", { status: "proposal" });
  });

  it("routes update_task to store.update and returns the task link", () => {
    const store = { create: vi.fn(), update: vi.fn() };
    const action: ProposedAction = {
      id: "a3", tool: "update_task", description: "", status: "pending",
      args: { id: "t1", status: "done", dueDate: "2026-06-20" },
    };
    const result = applyAction(store as never, action);
    expect(store.update).toHaveBeenCalledWith("tasks", "t1", { status: "done", dueDate: "2026-06-20" });
    expect(result).toEqual({ kind: "tasks", id: "t1" });
  });

  it("returns the created record's link from a create action", () => {
    const store = { create: vi.fn(() => ({ id: "new-1" })), update: vi.fn() };
    const action: ProposedAction = {
      id: "a4", tool: "create_lead", description: "", status: "pending",
      args: { company: "Acme" },
    };
    expect(applyAction(store as never, action)).toEqual({ kind: "leads", id: "new-1" });
  });
});

describe("buildMilestone", () => {
  it("fills sensible defaults", () => {
    expect(buildMilestone({ projectId: "p1", name: "Discovery" })).toEqual({
      projectId: "p1", name: "Discovery", startDate: null, endDate: null,
      status: "planned", order: 0, dependsOn: [], commitScope: "", notes: "",
    });
  });

  it("coerces the fields it is given", () => {
    expect(buildMilestone({
      projectId: "p1", name: "Build", startDate: "2026-07-01", endDate: "2026-07-20",
      status: "in progress", order: 2, dependsOn: ["m0"], commitScope: "build", notes: "n",
    })).toMatchObject({
      startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
      order: 2, dependsOn: ["m0"], commitScope: "build",
    });
  });

  it("turns an empty date string into null", () => {
    expect(buildMilestone({ projectId: "p1", name: "X", startDate: "" }).startDate).toBeNull();
  });

  it("ignores a non-array dependsOn", () => {
    expect(buildMilestone({ projectId: "p1", name: "X", dependsOn: "m0" }).dependsOn).toEqual([]);
  });
});

describe("buildMilestonePatch", () => {
  it("produces an empty patch for empty args", () => {
    expect(buildMilestonePatch({})).toEqual({});
  });

  it("only includes provided keys", () => {
    expect(buildMilestonePatch({ status: "done" })).toEqual({ status: "done" });
  });

  it("includes a field explicitly cleared to an empty string", () => {
    expect(buildMilestonePatch({ notes: "" })).toEqual({ notes: "" });
  });
});

describe("buildProjectPatch", () => {
  it("produces an empty patch for empty args", () => {
    expect(buildProjectPatch({})).toEqual({});
  });

  it("only includes provided keys", () => {
    expect(buildProjectPatch({ currentBlocker: "Waiting on creds" })).toEqual({ currentBlocker: "Waiting on creds" });
  });

  it("includes a field explicitly cleared to an empty string", () => {
    expect(buildProjectPatch({ notes: "" })).toEqual({ notes: "" });
  });
});

describe("applyAction — milestones", () => {
  function fakeStore() {
    const calls: { op: string; key: string; id?: string; value?: unknown }[] = [];
    return {
      calls,
      create: (key: string, value: unknown) => { calls.push({ op: "create", key, value }); return { id: "new1" }; },
      update: (key: string, id: string, value: unknown) => { calls.push({ op: "update", key, id, value }); },
    };
  }

  it("creates a milestone but deep-links to its project", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a1", tool: "create_milestone", description: "", status: "confirmed",
      args: { projectId: "p1", name: "Discovery" },
    });
    expect(store.calls[0]).toMatchObject({ op: "create", key: "milestones" });
    // Milestones have no page — link to the project so ?focus= resolves.
    expect(result).toEqual({ kind: "projects", id: "p1" });
  });

  it("updates a milestone and deep-links to its project", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a2", tool: "update_milestone", description: "", status: "confirmed",
      args: { id: "m1", projectId: "p1", status: "done" },
    });
    expect(store.calls[0]).toMatchObject({ op: "update", key: "milestones", id: "m1" });
    expect(result).toEqual({ kind: "projects", id: "p1" });
  });

  it("returns null for a milestone update with no id", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a3", tool: "update_milestone", description: "", status: "confirmed",
      args: { projectId: "p1" },
    });
    expect(result).toBeNull();
    expect(store.calls).toEqual([]);
  });

  it("returns null for a milestone update with an id but no projectId", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a3b", tool: "update_milestone", description: "", status: "confirmed",
      args: { id: "m1" },
    });
    expect(result).toBeNull();
    expect(store.calls).toEqual([]);
  });

  it("returns null for a milestone create with no projectId", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a3c", tool: "create_milestone", description: "", status: "confirmed",
      args: { name: "Discovery" },
    });
    expect(result).toBeNull();
    expect(store.calls).toEqual([]);
  });

  it("updates a project", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a4", tool: "update_project", description: "", status: "confirmed",
      args: { id: "p1", currentBlocker: "Waiting on creds" },
    });
    expect(store.calls[0]).toMatchObject({ op: "update", key: "projects", id: "p1" });
    expect(result).toEqual({ kind: "projects", id: "p1" });
  });

  it("returns null for a project update with no id", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a4b", tool: "update_project", description: "", status: "confirmed",
      args: { currentBlocker: "Waiting on creds" },
    });
    expect(result).toBeNull();
    expect(store.calls).toEqual([]);
  });
});

function recorder() {
  const created: { key: string; value: unknown }[] = [];
  const updated: { key: string; id: string; patch: unknown }[] = [];
  const store: AdvisorStore = {
    create: (key, value) => { created.push({ key, value }); return { id: "new-1" }; },
    update: (key, id, patch) => { updated.push({ key, id, patch }); },
  };
  return { store, created, updated };
}

describe("applyAction accepts both task tool generations", () => {
  it("applies a pre-rename create_task proposal from a project thread", () => {
    const { store, created } = recorder();
    const out = applyAction(store, {
      id: "a1", tool: "create_task", description: "", status: "pending",
      args: { title: "Ship it", linkKind: "project", linkId: "p1" },
    });
    expect(out).toEqual({ kind: "tasks", id: "new-1" });
    expect(created[0].value).toMatchObject({ title: "Ship it", linkKind: "project", linkId: "p1" });
  });

  it("applies a post-rename create_project_task proposal identically", () => {
    const { store, created } = recorder();
    const out = applyAction(store, {
      id: "a2", tool: "create_project_task", description: "", status: "pending",
      args: { title: "Ship it", linkKind: "project", linkId: "p1" },
    });
    expect(out).toEqual({ kind: "tasks", id: "new-1" });
    expect(created[0].value).toMatchObject({ title: "Ship it", linkKind: "project", linkId: "p1" });
  });

  it("applies update_project_task the same way as update_task", () => {
    const { store, updated } = recorder();
    applyAction(store, {
      id: "a3", tool: "update_project_task", description: "", status: "pending",
      args: { id: "t1", status: "done" },
    });
    expect(updated[0]).toMatchObject({ key: "tasks", id: "t1" });
  });
});
