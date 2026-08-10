import { describe, it, expect } from "vitest";
import { anchorFrom, weightedPercentile, MIN_CANDIDATES } from "./anchor";
import type { Candidate } from "./comparables";
import type { BuildAttributes } from "@/lib/types";

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: [], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

function cand(id: string, setupPrice: number, weight: number): Candidate {
  return {
    source: "comparable", id, label: id, attributes: ATTRS,
    setupPrice, monthlyPrice: setupPrice / 12,
    similarity: weight, weight,
  };
}

describe("weightedPercentile", () => {
  it("returns the value where the running weight first crosses the fraction", () => {
    const points = [
      { value: 10, weight: 1 },
      { value: 20, weight: 1 },
      { value: 30, weight: 1 },
      { value: 40, weight: 1 },
    ];
    expect(weightedPercentile(points, 0.25)).toBe(10);
    expect(weightedPercentile(points, 0.5)).toBe(20);
    expect(weightedPercentile(points, 0.75)).toBe(30);
  });

  it("lets a heavy point dominate a light one", () => {
    const points = [
      { value: 10, weight: 0.1 },
      { value: 100, weight: 9.9 },
    ];
    expect(weightedPercentile(points, 0.5)).toBe(100);
  });

  it("sorts by value, not by input order", () => {
    const points = [
      { value: 30, weight: 1 },
      { value: 10, weight: 1 },
      { value: 20, weight: 1 },
    ];
    expect(weightedPercentile(points, 0.5)).toBe(20);
  });
});

describe("anchorFrom", () => {
  it("requires at least three candidates", () => {
    expect(MIN_CANDIDATES).toBe(3);
    expect(anchorFrom([cand("a", 100, 1), cand("b", 200, 1)], (c) => c.setupPrice)).toBeNull();
  });

  it("produces a non-decreasing low/mid/high", () => {
    const a = anchorFrom(
      [cand("a", 80000, 1), cand("b", 100000, 1), cand("c", 140000, 1), cand("d", 200000, 1)],
      (c) => c.setupPrice,
    );
    expect(a).not.toBeNull();
    expect(a!.low).toBeLessThanOrEqual(a!.mid);
    expect(a!.mid).toBeLessThanOrEqual(a!.high);
  });

  it("anchors monthly from the same candidate set", () => {
    const set = [cand("a", 120000, 1), cand("b", 120000, 1), cand("c", 120000, 1)];
    const monthly = anchorFrom(set, (c) => c.monthlyPrice);
    expect(monthly).toEqual({ low: 10000, mid: 10000, high: 10000 });
  });
});
