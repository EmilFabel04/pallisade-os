import { describe, it, expect } from "vitest";
import { ganttRange, barGeometry, detectCycles, dependencyEdges } from "./schedule";
import type { Milestone } from "@/lib/types";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "M",
    startDate: "2026-07-01", endDate: "2026-07-15", status: "planned",
    order: 0, dependsOn: [], commitScope: "", notes: "",
    ...over,
  };
}

describe("ganttRange", () => {
  it("spans the earliest start to the latest end, padded to whole weeks", () => {
    const range = ganttRange([
      milestone({ id: "a", startDate: "2026-07-01", endDate: "2026-07-15" }),
      milestone({ id: "b", startDate: "2026-07-10", endDate: "2026-08-15" }),
    ]);
    // 2026-07-01 is a Wednesday → back to Monday 2026-06-29
    // 2026-08-15 is a Saturday  → forward to Sunday 2026-08-16
    expect(range).toEqual({ start: "2026-06-29", end: "2026-08-16" });
  });

  it("ignores milestones missing either date", () => {
    const range = ganttRange([
      milestone({ id: "a", startDate: "2026-07-01", endDate: "2026-07-15" }),
      milestone({ id: "b", startDate: null, endDate: "2026-12-31" }),
      milestone({ id: "c", startDate: "2026-01-01", endDate: null }),
    ]);
    expect(range).toEqual({ start: "2026-06-29", end: "2026-07-19" });
  });

  it("returns null when no milestone has both dates", () => {
    expect(ganttRange([milestone({ startDate: null, endDate: null })])).toBeNull();
    expect(ganttRange([])).toBeNull();
  });
});

describe("barGeometry", () => {
  const range = { start: "2026-06-29", end: "2026-08-16" }; // 49 days

  it("positions a bar proportionally within the range", () => {
    // width 490 over 49 days = 10px/day. Offset 2 days, span 15 days.
    const g = barGeometry(milestone({ startDate: "2026-07-01", endDate: "2026-07-15" }), range, 490);
    expect(g).toEqual({ x: 20, w: 150 });
  });

  it("gives a full-width bar to a milestone covering the whole range", () => {
    const g = barGeometry(milestone({ startDate: "2026-06-29", endDate: "2026-08-16" }), range, 490);
    expect(g).toEqual({ x: 0, w: 490 });
  });

  it("keeps a single-day milestone visible", () => {
    const g = barGeometry(milestone({ startDate: "2026-07-01", endDate: "2026-07-01" }), range, 490);
    expect(g!.w).toBeGreaterThanOrEqual(4);
  });

  it("returns null for a milestone missing either date", () => {
    expect(barGeometry(milestone({ startDate: null }), range, 490)).toBeNull();
    expect(barGeometry(milestone({ endDate: null }), range, 490)).toBeNull();
  });

  it("clamps a bar that falls outside the range", () => {
    const g = barGeometry(milestone({ startDate: "2026-05-01", endDate: "2026-09-30" }), range, 490);
    expect(g).toEqual({ x: 0, w: 490 });
  });

  it("returns null when width is zero (pre-measure render)", () => {
    expect(barGeometry(milestone(), range, 0)).toBeNull();
  });
});

describe("detectCycles", () => {
  it("finds nothing in a clean chain", () => {
    expect(detectCycles([
      milestone({ id: "a", dependsOn: [] }),
      milestone({ id: "b", dependsOn: ["a"] }),
      milestone({ id: "c", dependsOn: ["b"] }),
    ])).toEqual([]);
  });

  it("finds nothing in a diamond", () => {
    expect(detectCycles([
      milestone({ id: "a", dependsOn: [] }),
      milestone({ id: "b", dependsOn: ["a"] }),
      milestone({ id: "c", dependsOn: ["a"] }),
      milestone({ id: "d", dependsOn: ["b", "c"] }),
    ])).toEqual([]);
  });

  it("finds a three-node loop", () => {
    const cycles = detectCycles([
      milestone({ id: "a", dependsOn: ["c"] }),
      milestone({ id: "b", dependsOn: ["a"] }),
      milestone({ id: "c", dependsOn: ["b"] }),
    ]);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]].sort()).toEqual(["a", "b", "c"]);
  });

  it("finds a self-reference", () => {
    expect(detectCycles([milestone({ id: "a", dependsOn: ["a"] })])).toEqual([["a"]]);
  });

  it("ignores a dependency on a milestone that no longer exists", () => {
    expect(detectCycles([milestone({ id: "a", dependsOn: ["deleted"] })])).toEqual([]);
  });
});

describe("dependencyEdges", () => {
  const range = { start: "2026-06-29", end: "2026-08-16" };

  it("draws an edge from each dependency's right edge to its dependant's left edge", () => {
    const edges = dependencyEdges(
      [
        milestone({ id: "a", order: 0, startDate: "2026-07-01", endDate: "2026-07-15" }),
        milestone({ id: "b", order: 1, startDate: "2026-07-20", endDate: "2026-07-31", dependsOn: ["a"] }),
      ],
      range, 490, 40,
    );
    // a: x=20 w=150 → right edge 170, row 0 → y 20
    // b: offset 21 days → x=210, row 1 → y 60
    expect(edges).toEqual([{ x1: 170, y1: 20, x2: 210, y2: 60 }]);
  });

  it("skips an edge when either milestone is undated", () => {
    expect(dependencyEdges(
      [
        milestone({ id: "a", order: 0, startDate: null, endDate: null }),
        milestone({ id: "b", order: 1, dependsOn: ["a"] }),
      ],
      range, 490, 40,
    )).toEqual([]);
  });

  it("skips a dependency on a milestone that no longer exists", () => {
    expect(dependencyEdges(
      [milestone({ id: "b", order: 0, dependsOn: ["deleted"] })],
      range, 490, 40,
    )).toEqual([]);
  });
});
