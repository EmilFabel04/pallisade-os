// src/lib/content/daily/craft.test.ts
import { describe, it, expect } from "vitest";
import {
  PILLARS, FORMATS, PILLAR_META, FORMAT_META, PILLAR_KEYWORDS,
  AI_TELL_PHRASES, AI_TELL_PATTERNS, ANTI_SLOP_CONSTITUTION, CRAFT_RULES,
} from "./craft";

describe("catalogues", () => {
  it("has the six pillars and six formats from the spec", () => {
    expect([...PILLARS].sort()).toEqual([
      "build-log", "client-pain", "contrarian", "lesson", "proof", "teardown",
    ]);
    expect([...FORMATS].sort()).toEqual([
      "before-after", "claim-defence", "numbers", "one-idea", "scene", "short-punch",
    ]);
  });

  it("describes every pillar and every format", () => {
    for (const p of PILLARS) expect(PILLAR_META[p].description.length).toBeGreaterThan(20);
    for (const f of FORMATS) expect(FORMAT_META[f].shape.length).toBeGreaterThan(20);
  });

  it("maps source fields to pillar hints", () => {
    expect(PILLAR_KEYWORDS.some((k) => k.pillars.includes("client-pain"))).toBe(true);
    expect(PILLAR_KEYWORDS.every((k) => k.pillars.length > 0)).toBe(true);
  });
});

describe("AI tell catalogue", () => {
  it("carries the Wikipedia vocabulary", () => {
    for (const w of ["delve", "boasts", "tapestry", "testament", "underscore", "robust", "pivotal", "meticulous"]) {
      expect(AI_TELL_PHRASES).toContain(w);
    }
  });

  it("carries the LinkedIn-specific tells", () => {
    for (const w of ["here's the thing", "let that sink in", "read that again", "game-changer"]) {
      expect(AI_TELL_PHRASES).toContain(w);
    }
  });

  it("has named structural patterns with human-readable labels", () => {
    const labels = AI_TELL_PATTERNS.map((p) => p.label);
    expect(labels).toContain("negative parallelism");
    expect(labels).toContain("rule of three");
    expect(AI_TELL_PATTERNS.every((p) => p.regex instanceof RegExp)).toBe(true);
  });

  it("catches 'It's not X, it's Y' and 'Not only ... but also'", () => {
    const neg = AI_TELL_PATTERNS.find((p) => p.label === "negative parallelism")!;
    expect(neg.regex.test("It's not a tool, it's a mindset.")).toBe(true);
    neg.regex.lastIndex = 0;
    expect(neg.regex.test("Not only did it ship, but it also worked.")).toBe(true);
    neg.regex.lastIndex = 0;
    expect(neg.regex.test("I shipped the dashboard on Tuesday.")).toBe(false);
  });
});

describe("prompt fragments", () => {
  it("forbids the tells explicitly and names the specificity rule", () => {
    expect(ANTI_SLOP_CONSTITUTION).toMatch(/never/i);
    expect(ANTI_SLOP_CONSTITUTION).toMatch(/specific|concrete/i);
    expect(CRAFT_RULES.length).toBeGreaterThan(200);
  });
});
