import { describe, it, expect } from "vitest";
import {
  contentTypeMeta,
  buildContentSystemPrompt,
  CONTENT_TOOL_NAMES,
} from "./prompt";

describe("contentTypeMeta", () => {
  it("gives a distinct label + rules for each content type", () => {
    const social = contentTypeMeta("social");
    const script = contentTypeMeta("script");
    const longform = contentTypeMeta("longform");
    expect(social.label).toMatch(/social/i);
    expect(script.label).toMatch(/script/i);
    expect(longform.label).toMatch(/long/i);
    // rules are non-empty and not identical across types
    expect(social.rules.length).toBeGreaterThan(20);
    expect(new Set([social.rules, script.rules, longform.rules]).size).toBe(3);
  });

  it("bakes the platform/format cues into the rules", () => {
    expect(contentTypeMeta("social").rules).toMatch(/hook/i);
    expect(contentTypeMeta("script").rules).toMatch(/\[HOOK\]/);
    expect(contentTypeMeta("longform").rules).toMatch(/subhead|outline/i);
  });
});

describe("buildContentSystemPrompt", () => {
  const base = {
    profile: { name: "Boutique AMs", body: "We sell calm to overwhelmed PMs." },
    contentType: "social" as const,
    businessName: "Pallisade Data",
    founderName: "Emil",
    services: "bespoke AI systems",
    today: "2026-06-23",
  };

  it("embeds the positioning body, business, founder and date", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toContain("We sell calm to overwhelmed PMs.");
    expect(p).toContain("Pallisade Data");
    expect(p).toContain("Emil");
    expect(p).toContain("2026-06-23");
  });

  it("injects the selected content type's rules and ideas-first behaviour", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toContain(contentTypeMeta("social").rules);
    expect(p).toMatch(/ideas first|batch of/i);
  });

  it("instructs grounding via the read tools and no inventing", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toMatch(/search_pain_points/);
    expect(p).toMatch(/never invent/i);
  });
});

describe("CONTENT_TOOL_NAMES", () => {
  it("is exactly the three read tools", () => {
    expect([...CONTENT_TOOL_NAMES].sort()).toEqual(
      ["query_interactions", "query_leads", "search_pain_points"].sort(),
    );
  });
});
