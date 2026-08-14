import { describe, it, expect } from "vitest";
import { buildSpec, toCard } from "@/lib/agents/spec";

const OK = `---
name: Deal Strategist
description: Pressure-tests live deals.
color: "#10B981"
emoji: 🎯
vibe: Asks what has to be true for this to close.
surface: brain
tools: [crm, projects]
---
You are Deal Strategist.`;

describe("buildSpec", () => {
  it("builds a spec from a valid file", () => {
    const s = buildSpec("deal-strategist", OK);
    expect(s.id).toBe("deal-strategist");
    expect(s.surface).toBe("brain");
    expect(s.tools).toEqual(["crm", "projects"]);
    expect(s.body).toBe("You are Deal Strategist.");
    expect(s.model).toBeUndefined();
  });

  it("rejects an unknown capability group, naming file and field", () => {
    const bad = OK.replace("[crm, projects]", "[crm, crmm]");
    expect(() => buildSpec("deal-strategist", bad))
      .toThrow(/^agent "deal-strategist": field "tools" has unknown capability group "crmm"/);
  });

  it("rejects an unknown surface", () => {
    const bad = OK.replace("surface: brain", "surface: nowhere");
    expect(() => buildSpec("deal-strategist", bad))
      .toThrow(/^agent "deal-strategist": field "surface" has unknown value "nowhere"/);
  });

  it("rejects a missing required field", () => {
    const bad = OK.replace("name: Deal Strategist\n", "");
    expect(() => buildSpec("deal-strategist", bad))
      .toThrow(/^agent "deal-strategist": field "name" is required/);
  });

  it("rejects an empty body", () => {
    expect(() => buildSpec("x", `---\nname: N\ndescription: D\ncolor: "#fff"\nemoji: X\nvibe: V\nsurface: brain\ntools: [crm]\n---\n`))
      .toThrow(/body/i);
  });

  it("accepts an empty tools list", () => {
    const s = buildSpec("x", OK.replace("[crm, projects]", "[]"));
    expect(s.tools).toEqual([]);
  });

  it("reads an optional model override", () => {
    const s = buildSpec("x", OK.replace("surface: brain", "surface: brain\nmodel: claude-opus-4-6"));
    expect(s.model).toBe("claude-opus-4-6");
  });

  it("names the agent when the frontmatter block is missing entirely", () => {
    expect(() => buildSpec("deal-strategist", "no frontmatter here"))
      .toThrow(/^agent "deal-strategist": .*frontmatter/s);
  });
});

describe("toCard", () => {
  it("projects exactly the presentation fields and nothing else", () => {
    const card = toCard(buildSpec("deal-strategist", OK));
    // Exact key set — a superset would leak the system prompt to the browser.
    expect(Object.keys(card).sort())
      .toEqual(["color", "description", "emoji", "id", "name", "vibe"]);
  });
});
