import { describe, it, expect } from "vitest";
import { toolsFor, dispatch, SERVER_TOOL_NAMES } from "@/lib/agents/capabilities";
import { CAPABILITY_GROUPS } from "@/lib/agents/types";
import type { AgentContext } from "@/lib/agents/types";
import type { AdvisorSnapshot } from "@/lib/types";
import type { ProjectSnapshot } from "@/lib/projects/tools";

function snapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
    painPoints: [], dialLists: [], milestones: [], quotes: [], comparables: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
      targetMarginPct: 0.4, minimumSetupFee: 0, usdToZar: 0,
      capexMultipliers: { micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0 },
    },
  };
}

function projectSnapshot(): ProjectSnapshot {
  return {
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
}

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    today: "2026-08-13", businessName: "Pallisade", founderName: "Emil",
    services: "AI systems", snapshot: snapshot(), proposals: [],
    emailEnabled: false, calendarEnabled: false, driveAccountId: null,
    projectSnapshot: null,
    ...over,
  };
}

const names = (ts: { name: string }[]) => ts.map((t) => t.name).sort();

describe("toolsFor", () => {
  it("resolves crm to the exact read tool set, without write tools", () => {
    expect(names(toolsFor(["crm"], ctx()))).toEqual([
      "get_pipeline_metrics", "query_interactions", "query_leads",
      "query_projects", "query_tasks", "search_pain_points",
    ]);
  });

  it("resolves writes to the exact mutation set", () => {
    expect(names(toolsFor(["writes"], ctx()))).toEqual([
      "create_lead", "create_project", "create_task",
      "log_interaction", "update_lead", "update_task",
    ]);
  });

  it("grants no mutation tools when writes is absent", () => {
    const granted = names(toolsFor(["crm", "projects", "email", "calendar", "drive", "web"], ctx({
      emailEnabled: true, calendarEnabled: true,
    })));
    for (const w of ["create_task", "create_lead", "update_lead", "update_task",
                     "log_interaction", "create_project", "create_calendar_event"]) {
      expect(granted).not.toContain(w);
    }
  });

  it("omits email and calendar tools when those integrations are off", () => {
    expect(toolsFor(["email", "calendar"], ctx())).toEqual([]);
  });

  it("includes email and calendar tools when connected", () => {
    const granted = names(toolsFor(["email", "calendar"], ctx({ emailEnabled: true, calendarEnabled: true })));
    expect(granted).toContain("query_emails");
    expect(granted).toContain("query_calendar");
  });

  it("does NOT grant create_calendar_event through the calendar group", () => {
    // create_calendar_event is a mutation. The calendar group is read-only;
    // without this split, granting `calendar` would smuggle in a write tool.
    expect(names(toolsFor(["calendar"], ctx({ calendarEnabled: true })))).toEqual(["query_calendar"]);
  });

  it("grants create_calendar_event only with writes AND a connected calendar", () => {
    expect(names(toolsFor(["writes"], ctx({ calendarEnabled: true })))).toContain("create_calendar_event");
    expect(names(toolsFor(["writes"], ctx({ calendarEnabled: false })))).not.toContain("create_calendar_event");
  });

  it("marks web_search as a server-executed tool", () => {
    const web = toolsFor(["web"], ctx());
    expect(web).toHaveLength(1);
    expect(SERVER_TOOL_NAMES.has("web_search")).toBe(true);
  });

  it("dedupes a tool reachable from two groups", () => {
    const once = names(toolsFor(["crm"], ctx()));
    const twice = names(toolsFor(["crm", "crm"], ctx()));
    expect(twice).toEqual(once);
  });

  it("returns [] for no groups", () => {
    expect(toolsFor([], ctx())).toEqual([]);
  });
});

describe("dispatch", () => {
  it("routes a crm read to the advisor resolver", async () => {
    const out = await dispatch("query_leads", { limit: 5 }, ctx());
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("queues a write as a proposal instead of mutating", async () => {
    const c = ctx();
    const out = await dispatch("create_task", { title: "Call Acme" }, c);
    expect(JSON.parse(out).queued).toBe(true);
    expect(c.proposals).toHaveLength(1);
    expect(c.proposals[0].description).toContain("Call Acme");
  });

  it("returns an error payload for an unknown tool rather than throwing", async () => {
    const out = await dispatch("no_such_tool", {}, ctx());
    expect(JSON.parse(out).error).toMatch(/unknown tool/i);
  });

  it("returns an error payload when a resolver throws", async () => {
    // snapshot: null forces the crm resolver to fail
    const out = await dispatch("query_leads", {}, ctx({ snapshot: null }));
    expect(JSON.parse(out).error).toBeTruthy();
  });

  it("queues a calendar event as a proposal rather than creating it", async () => {
    const c = ctx({ calendarEnabled: true });
    const out = await dispatch("create_calendar_event", { summary: "Call Acme", start: "2026-08-20T10:00:00" }, c);
    expect(JSON.parse(out).queued).toBe(true);
    expect(c.proposals).toHaveLength(1);
  });

  it("queues a write even when the context carries no snapshot", async () => {
    // Brain-like surface: no snapshot. Writes must still queue, not error.
    const c = ctx({ snapshot: null });
    const out = await dispatch("create_task", { title: "Call Acme" }, c);
    expect(JSON.parse(out).queued).toBe(true);
    expect(c.proposals).toHaveLength(1);
  });
});

describe("the delivery group", () => {
  it("grants the project tool set when a project is in context", () => {
    const granted = names(toolsFor(["delivery"], ctx({ projectSnapshot: projectSnapshot() })));
    expect(granted).toHaveLength(9);
    expect(granted).toContain("list_milestones");
    expect(granted).toContain("update_project");
  });

  // The handover records "a capability granted but not wired" as a failure
  // mode this codebase has produced twice: a tool appears in the list the
  // model receives and then answers every call with an error. Gating the
  // grant on the context that backs it is what closes that by construction.
  it("grants nothing when no project is in context", () => {
    expect(toolsFor(["delivery"], ctx())).toEqual([]);
  });

  it("does not leak project tools into the cross-project projects group", () => {
    const granted = names(toolsFor(["projects"], ctx({ projectSnapshot: projectSnapshot() })));
    expect(granted).toEqual(["get_project_context", "list_projects"]);
  });
});

describe("every delivery tool answers with data, not an error", () => {
  const withProject = () => ctx({ projectSnapshot: projectSnapshot(), proposals: [] });

  it("returns this project's milestones from list_milestones", async () => {
    const out = await dispatch("list_milestones", {}, withProject());
    expect(JSON.parse(out)[0]).toMatchObject({ id: "m1", name: "Ingest" });
  });

  it("returns this project's tasks from list_tasks", async () => {
    const out = await dispatch("list_tasks", {}, withProject());
    expect(JSON.parse(out)[0]).toMatchObject({ id: "t1", title: "Auth handshake" });
  });

  it("queues a proposal scoped to this project from create_milestone", async () => {
    const c = withProject();
    await dispatch("create_milestone", { name: "Handover" }, c);
    expect(c.proposals[0]).toMatchObject({ tool: "create_milestone", args: { projectId: "p1" } });
  });

  it("queues a project-linked task from create_project_task", async () => {
    const c = withProject();
    await dispatch("create_project_task", { title: "Ship it" }, c);
    expect(c.proposals[0].args).toMatchObject({ linkKind: "project", linkId: "p1" });
  });

  it("queues an update against this project's own id from update_project", async () => {
    const c = withProject();
    await dispatch("update_project", { stage: "handover" }, c);
    expect(c.proposals[0].args).toMatchObject({ id: "p1", stage: "handover" });
  });

  it("rejects an update_milestone for a milestone on another project", async () => {
    const out = await dispatch("update_milestone", { id: "not-mine" }, withProject());
    expect(out).toContain("No milestone with id");
  });

  it("rejects an update_project_task for a task on another project", async () => {
    const out = await dispatch("update_project_task", { id: "not-mine" }, withProject());
    expect(out).toContain("No task with id");
  });

  // The CRM create_task must still reach the CRM resolver — the rename in
  // Task 2 is only correct if both names still route to their own owner.
  it("routes the CRM create_task to the CRM resolver, not the project one", async () => {
    const c = ctx({ projectSnapshot: projectSnapshot(), proposals: [] });
    await dispatch("create_task", { title: "Call Sam", linkKind: "lead", linkId: "l1" }, c);
    expect(c.proposals[0].args).toMatchObject({ linkKind: "lead", linkId: "l1" });
  });

  it("reports a missing project rather than throwing", async () => {
    const out = await dispatch("list_milestones", {}, ctx());
    expect(JSON.parse(out).error).toContain("no project");
  });
});

describe("capability group disjointness", () => {
  // Every integration connected AND a project in context. With any of them
  // missing, `email`, `calendar` and `delivery` grant [] and both tests below
  // pass by being blind — which is exactly the failure mode this repo produces
  // (an assertion that passes against the thing it is meant to detect).
  const full = () => ctx({
    emailEnabled: true,
    calendarEnabled: true,
    driveAccountId: "acct-1",
    projectSnapshot: projectSnapshot(),
  });

  // Guards the fixture itself. If a future change makes a group grant nothing
  // under this context, the disjointness test below silently stops covering it
  // — this test fails first and says which group went dark.
  it("grants a non-empty tool set for every implemented group", () => {
    const empty = CAPABILITY_GROUPS.filter((g) => toolsFor([g], full()).length === 0);
    expect(empty).toEqual(["repo", "fathom"]);
  });

  // dispatch() routes a tool call by name-set membership in a fixed if-chain,
  // so it can only be correct while no two groups grant the same name. That
  // invariant was load-bearing and untested until this test.
  it("never grants the same tool name from two different groups", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const group of CAPABILITY_GROUPS) {
      for (const tool of toolsFor([group], full())) {
        const prev = owner.get(tool.name);
        if (prev) clashes.push(`${tool.name} granted by both ${prev} and ${group}`);
        else owner.set(tool.name, group);
      }
    }
    expect(clashes).toEqual([]);
  });
});
