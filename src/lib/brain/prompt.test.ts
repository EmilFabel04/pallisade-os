import { describe, it, expect } from "vitest";
import { buildBrainSystemPrompt } from "./prompt";

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
