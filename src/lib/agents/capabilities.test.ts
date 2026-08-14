import { describe, it, expect } from "vitest";
import { toolsFor, dispatch, SERVER_TOOL_NAMES } from "@/lib/agents/capabilities";
import type { AgentContext } from "@/lib/agents/types";
import type { AdvisorSnapshot } from "@/lib/types";

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

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    today: "2026-08-13", businessName: "Pallisade", founderName: "Emil",
    services: "AI systems", snapshot: snapshot(), proposals: [],
    emailEnabled: false, calendarEnabled: false, driveAccountId: null,
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
