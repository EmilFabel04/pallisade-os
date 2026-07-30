import { describe, it, expect } from "vitest";
import { buildBrainSystemPrompt, formatAttachmentsBlock } from "./prompt";

describe("buildBrainSystemPrompt", () => {
  const base = {
    businessName: "Pallisade Data",
    founderName: "Emil",
    today: "2026-06-26",
  };

  it("embeds the business, founder and date", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toContain("Pallisade Data");
    expect(p).toContain("Emil");
    expect(p).toContain("2026-06-26");
  });

  it("establishes the seasoned-operator identity drawn from many great minds", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/scaled|IPO|founder|operator/i);
    expect(p).toMatch(/investors?|bankers?|tech (ceos?|leaders?)/i);
  });

  it("instructs one-way vs two-way door reasoning and naming risks", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/one-way door/i);
    expect(p).toMatch(/risk|failure mode/i);
  });

  it("allows asking the single sharpest clarifying question when underspecified", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/clarif|underspecified|need .* before/i);
  });

  it("tells it to cite specific people/frameworks only when genuinely relevant", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/only when .* relevant|not .* name-?drop/i);
  });

  it("sets a direct, high-signal, no-flattery tone", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/direct|high-signal|no flattery|concise/i);
  });
});

describe("buildBrainSystemPrompt — modes", () => {
  const base = { businessName: "Pallisade Data", founderName: "Emil", today: "2026-06-28" };

  it("strategist output is unchanged when mode omitted vs explicit strategist", () => {
    expect(buildBrainSystemPrompt(base)).toBe(buildBrainSystemPrompt({ ...base, mode: "strategist" }));
  });

  it("brainstorm mode steers toward sources, research and a build scope", () => {
    const p = buildBrainSystemPrompt({ ...base, mode: "brainstorm" });
    expect(p).toMatch(/drive_search|drive_read_file/);
    expect(p).toMatch(/web_search|research/i);
    expect(p).toMatch(/build scope/i);
    expect(p).toMatch(/Claude Code/i);
  });
});

describe("brain prompt — project awareness", () => {
  const input = { businessName: "Pallisade Data", founderName: "Emil", today: "2026-07-29" };

  it("tells the strategist about the project tools", () => {
    const p = buildBrainSystemPrompt(input);
    expect(p).toContain("get_project_context");
    expect(p).toContain("list_projects");
  });

  it("tells brainstorm mode too", () => {
    const p = buildBrainSystemPrompt({ ...input, mode: "brainstorm" });
    expect(p).toContain("get_project_context");
  });
});

describe("formatAttachmentsBlock", () => {
  it("returns empty string with no attachments", () => {
    expect(formatAttachmentsBlock([])).toBe("");
  });
  it("labels each document by name", () => {
    const out = formatAttachmentsBlock([{ name: "call.md", content: "hello" }]);
    expect(out).toContain("call.md");
    expect(out).toContain("hello");
  });
  it("truncates past the char budget with a marker", () => {
    const out = formatAttachmentsBlock([{ name: "big.md", content: "x".repeat(50) }], 10);
    expect(out).toContain("[truncated]");
  });
});
