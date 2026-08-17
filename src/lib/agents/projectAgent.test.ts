/* The registry is DB-backed through loadOverrides (getClient() defaults to
   the founder's real production DB). Stub it at the module boundary — the
   same pattern as src/lib/agents/roster.test.ts. */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));

import { getAgent, listAgents } from "@/lib/agents/registry";

describe("the project agent", () => {
  it("is on the project surface with only the delivery group", async () => {
    const spec = await getAgent("project-agent");
    expect(spec.surface).toBe("project");
    expect(spec.tools).toEqual(["delivery"]);
  });

  it("appears in the project roster, which was empty before", async () => {
    const cards = await listAgents("project");
    expect(cards.map((c) => c.id)).toEqual(["project-agent"]);
  });

  it("names the renamed task tools, not the CRM ones", async () => {
    const { body } = await getAgent("project-agent");
    expect(body).toContain("create_project_task");
    expect(body).toContain("update_project_task");
    expect(body).not.toMatch(/\bcreate_task\b/);
    expect(body).not.toMatch(/\bupdate_task\b/);
  });

  it("uses only placeholders renderBody can substitute", async () => {
    const { body } = await getAgent("project-agent");
    const used = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const token of used) {
      expect(["today", "businessName", "founderName", "services"]).toContain(token);
    }
  });
});
