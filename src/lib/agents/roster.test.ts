/* ============================================================
   Verifies the SHIPPED roster in src/agents — not a fixture.

   loadRegistry() with no dir argument reads src/agents AND calls
   loadOverrides(), which is DB-backed (getClient() defaults to
   file:data/pallisade.db — the founder's real production database).
   Stub loadOverrides at the module boundary so this file never touches
   the DB. See the task brief's "Database hazard" section and the same
   pattern in src/lib/agents/registry.test.ts.
   ============================================================ */

import { describe, it, expect, vi } from "vitest";
import { loadRegistry } from "@/lib/agents/registry";
import { toolsFor } from "@/lib/agents/capabilities";
import { renderBody } from "@/lib/agents/render";
import { CAPABILITY_GROUPS, type AgentContext } from "@/lib/agents/types";

vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));

const baseCtx = (): AgentContext => ({
  today: "2026-08-13", businessName: "P", founderName: "E", services: "S",
  snapshot: null, proposals: [], emailEnabled: false, calendarEnabled: false,
  driveAccountId: null,
});

describe("the shipped agent roster", () => {
  it("loads every file in src/agents without a validation error", async () => {
    const reg = await loadRegistry();
    expect(reg.size).toBeGreaterThanOrEqual(3);
  });

  it("includes the three migrated personas", async () => {
    const reg = await loadRegistry();
    for (const id of ["sales-advisor", "strategist", "product-brainstorm"]) {
      expect(reg.has(id)).toBe(true);
    }
  });

  // A *valid but wrong* surface passes every other test in this file while
  // silently dropping the agent from the picker listAgents() feeds. Pin it.
  it("puts each agent on its intended surface", async () => {
    const reg = await loadRegistry();
    expect(reg.get("strategist")!.surface).toBe("brain");
    expect(reg.get("product-brainstorm")!.surface).toBe("brain");
    expect(reg.get("sales-advisor")!.surface).toBe("advisor");
  });

  it("grants writes to the advisor only", async () => {
    const reg = await loadRegistry();
    for (const [id, spec] of reg) {
      expect(spec.tools.includes("writes")).toBe(id === "sales-advisor");
    }
  });

  it("resolves no mutation tool for any agent that did not declare writes", async () => {
    // Declaration alone is not the guarantee — a read group could smuggle a
    // mutation in (create_calendar_event used to live in CALENDAR_TOOLS).
    // Assert on the RESOLVED tool set, with every integration switched on.
    const MUTATIONS = ["create_task", "create_lead", "update_lead", "update_task",
                       "log_interaction", "create_project", "create_calendar_event"];
    const full = { ...baseCtx(), emailEnabled: true, calendarEnabled: true };
    for (const [id, spec] of await loadRegistry()) {
      if (spec.tools.includes("writes")) continue;
      const granted = toolsFor(spec.tools, full).map((t) => t.name);
      for (const m of MUTATIONS) {
        expect(granted, `${id} must not resolve ${m}`).not.toContain(m);
      }
    }
  });

  // The point of the whole branch: the Brain was "very underdeveloped" because
  // its tool grant resolved to exactly two project tools. Assert on RESOLVED
  // tools, not declared groups — a declaration check still passes when the bus
  // hands back nothing because an integration reads as disconnected, which is
  // the trap Task 11's review caught.
  it("gives the Brain strategist real access to the business", async () => {
    const spec = (await loadRegistry()).get("strategist")!;
    for (const g of ["crm", "projects", "email", "calendar", "drive", "web"]) {
      expect(spec.tools).toContain(g);
    }
    const granted = toolsFor(spec.tools, {
      ...baseCtx(), emailEnabled: true, calendarEnabled: true,
    }).map((t) => t.name);
    for (const t of ["query_leads", "query_emails", "query_calendar",
                     "drive_search", "list_projects", "web_search"]) {
      expect(granted).toContain(t);
    }
  });

  it("puts a bench of specialists on the brain surface", async () => {
    const brain = [...(await loadRegistry()).values()].filter((s) => s.surface === "brain");
    expect(brain.length).toBeGreaterThanOrEqual(5);
  });

  // Each bench specialist is only worth shipping if the tools it is told to
  // reach for actually arrive. Same rule as above: resolved, not declared.
  it("resolves the CRM read tools for every bench specialist", async () => {
    const reg = await loadRegistry();
    const full = { ...baseCtx(), emailEnabled: true, calendarEnabled: true };
    for (const id of ["deal-strategist", "discovery-coach", "pipeline-analyst"]) {
      const spec = reg.get(id);
      expect(spec, `${id} must be on the roster`).toBeTruthy();
      expect(spec!.surface).toBe("brain");
      const granted = toolsFor(spec!.tools, full).map((t) => t.name);
      for (const t of ["query_leads", "query_interactions", "search_pain_points",
                       "get_pipeline_metrics"]) {
        expect(granted, `${id} must resolve ${t}`).toContain(t);
      }
    }
  });

  it("declares only known capability groups", async () => {
    const reg = await loadRegistry();
    for (const spec of reg.values()) {
      for (const t of spec.tools) expect(CAPABILITY_GROUPS).toContain(t);
    }
  });

  it("carries a non-trivial system prompt in every agent", async () => {
    const reg = await loadRegistry();
    for (const spec of reg.values()) expect(spec.body.length).toBeGreaterThan(200);
  });

  // renderBody leaves an unknown token in place on purpose, so a typo like
  // {{foundername}} reaches the model verbatim. The Brain route asserts this
  // for two personas; assert it for the whole shipped roster.
  it("uses only substitutable placeholders", async () => {
    for (const [id, spec] of await loadRegistry()) {
      const rendered = renderBody(spec.body, baseCtx());
      expect(rendered, `${id} has an unsubstituted placeholder`).not.toMatch(/\{\{/);
    }
  });
});
