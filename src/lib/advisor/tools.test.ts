import { describe, it, expect } from "vitest";
import { TOOLS, describeAction, resolveTool } from "@/lib/advisor/tools";
import type { AdvisorSnapshot } from "@/lib/types";

function emptySnapshot(): AdvisorSnapshot {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [], painPoints: [], dialLists: [],
    settings: {
      businessName: "X", founderName: "Y", mainMarket: "Z", services: "S",
      accentColor: "#000", currency: "ZAR", secondaryCurrencyEnabled: false,
    },
  };
}

describe("TOOLS", () => {
  it("exposes read, skill, and write tools with valid schemas", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("query_leads");
    expect(names).toContain("generate_call_summary");
    expect(names).toContain("create_task");
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe("object");
    }
  });
});

describe("describeAction", () => {
  it("renders a human-readable line for create_task", () => {
    expect(describeAction("create_task", { title: "Call Acme", priority: "high" }))
      .toContain("Call Acme");
  });
});

describe("resolveTool", () => {
  it("resolves a read tool inline", () => {
    const proposals: unknown[] = [];
    const r = resolveTool("query_leads", {}, emptySnapshot(), proposals as never);
    expect(Array.isArray(JSON.parse(r))).toBe(true);
    expect(proposals).toHaveLength(0);
  });

  it("records a write tool as a proposal instead of executing", () => {
    const proposals: { tool: string }[] = [];
    const r = resolveTool("create_task", { title: "X" }, emptySnapshot(), proposals as never);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].tool).toBe("create_task");
    expect(JSON.parse(r)).toHaveProperty("queued", true);
  });
});
