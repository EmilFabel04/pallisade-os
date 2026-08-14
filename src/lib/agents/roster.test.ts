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
    expect(reg.size).toBeGreaterThanOrEqual(4);
  });

  it("includes the four migrated personas", async () => {
    const reg = await loadRegistry();
    for (const id of ["sales-advisor", "strategist", "product-brainstorm", "project-copilot"]) {
      expect(reg.has(id)).toBe(true);
    }
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
});
