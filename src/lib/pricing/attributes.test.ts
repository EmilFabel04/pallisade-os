import { describe, it, expect } from "vitest";
import { similarity, numericCloseness, jaccard } from "./attributes";
import type { BuildAttributes } from "@/lib/types";

const BASE: BuildAttributes = {
  buildStatus: "new",
  surfaces: 6,
  integrations: ["Gmail", "Xero"],
  dataSources: 3,
  aiDepth: "core",
  userCount: 20,
  supportLoad: "medium",
};

describe("numericCloseness", () => {
  it("is 1 for equal values", () => expect(numericCloseness(5, 5)).toBe(1));
  it("falls toward 0 as the gap approaches the larger value", () => {
    expect(numericCloseness(1, 10)).toBeCloseTo(0.1, 6);
  });
  it("treats 0 and 0 as identical rather than dividing by zero", () => {
    expect(numericCloseness(0, 0)).toBe(1);
  });
});

describe("jaccard", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(jaccard(["Gmail", " xero "], ["gmail", "XERO"])).toBe(1);
  });
  it("scores partial overlap", () => {
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 6);
  });
  it("treats two empty sets as identical", () => {
    expect(jaccard([], [])).toBe(1);
  });
  it("scores disjoint sets at 0", () => {
    expect(jaccard(["a"], ["b"])).toBe(0);
  });
});

describe("similarity", () => {
  it("scores identical attributes at 1", () => {
    expect(similarity(BASE, BASE)).toBeCloseTo(1, 6);
  });

  it("ignores buildStatus entirely", () => {
    const licensed: BuildAttributes = { ...BASE, buildStatus: "license as-is" };
    expect(similarity(BASE, licensed)).toBeCloseTo(1, 6);
  });

  it("scores a maximally different build near 0", () => {
    const other: BuildAttributes = {
      buildStatus: "new",
      surfaces: 400,
      integrations: ["Salesforce"],
      dataSources: 300,
      aiDepth: "none",
      userCount: 100000,
      supportLoad: "low",
    };
    expect(similarity(BASE, other)).toBeLessThan(0.2);
  });

  it("is symmetric", () => {
    const other: BuildAttributes = { ...BASE, surfaces: 2, aiDepth: "light" };
    expect(similarity(BASE, other)).toBeCloseTo(similarity(other, BASE), 9);
  });

  it("scales user count logarithmically, so 20 vs 200 beats 20 vs 200000", () => {
    const near: BuildAttributes = { ...BASE, userCount: 200 };
    const far: BuildAttributes = { ...BASE, userCount: 200000 };
    expect(similarity(BASE, near)).toBeGreaterThan(similarity(BASE, far));
  });
});
