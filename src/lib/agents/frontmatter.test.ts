import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/lib/agents/frontmatter";

const DOC = `---
name: Deal Strategist
description: Pressure-tests live deals.
color: "#10B981"
emoji: 🎯
surface: brain
tools: [crm, projects, web]
---
You are Deal Strategist.

Second paragraph.`;

describe("parseFrontmatter", () => {
  it("reads scalars, quoted scalars and flat arrays", () => {
    const { meta } = parseFrontmatter(DOC);
    expect(meta.name).toBe("Deal Strategist");
    expect(meta.color).toBe("#10B981");          // quotes stripped
    expect(meta.emoji).toBe("🎯");
    expect(meta.tools).toEqual(["crm", "projects", "web"]);
  });

  it("returns the body with the delimiter block removed", () => {
    const { body } = parseFrontmatter(DOC);
    expect(body).toBe("You are Deal Strategist.\n\nSecond paragraph.");
  });

  it("keeps a --- that appears inside the body", () => {
    const { body } = parseFrontmatter("---\nname: X\n---\nintro\n\n---\n\nafter");
    expect(body).toBe("intro\n\n---\n\nafter");
  });

  it("tolerates CRLF line endings", () => {
    const { meta, body } = parseFrontmatter("---\r\nname: X\r\n---\r\nbody here");
    expect(meta.name).toBe("X");
    expect(body).toBe("body here");
  });

  it("throws when no frontmatter block is present", () => {
    expect(() => parseFrontmatter("just a body")).toThrow(/frontmatter/i);
  });

  it("throws when the block is unterminated", () => {
    expect(() => parseFrontmatter("---\nname: X\nbody")).toThrow(/unterminated/i);
  });
});
