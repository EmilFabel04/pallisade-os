import { describe, it, expect, vi } from "vitest";
import { buildTask, buildLead, buildLeadPatch, applyAction } from "@/lib/advisor/applyAction";
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
});
