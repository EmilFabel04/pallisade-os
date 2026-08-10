import { describe, it, expect } from "vitest";
import { clampTriple } from "./clamp";

const BOUNDS = { floor: 100000, ceiling: 160000 };

describe("clampTriple", () => {
  it("passes an in-range proposal through untouched", () => {
    const { triple, notes } = clampTriple({ target: 120000, stretch: 150000 }, BOUNDS, "Setup", "ZAR");
    expect(triple).toEqual({ floor: 100000, target: 120000, stretch: 150000 });
    expect(notes).toHaveLength(0);
  });

  it("pulls a stretch above the ceiling back down and says so", () => {
    const { triple, notes } = clampTriple({ target: 120000, stretch: 400000 }, BOUNDS, "Setup", "ZAR");
    expect(triple.stretch).toBe(160000);
    expect(notes[0]).toContain("Setup");
    expect(notes[0]).toContain("R160,000");
  });

  it("lifts a target below the floor", () => {
    const { triple, notes } = clampTriple({ target: 40000, stretch: 150000 }, BOUNDS, "Setup", "ZAR");
    expect(triple.target).toBe(100000);
    expect(notes.join(" ")).toContain("floor");
  });

  it("raises a stretch that sits below the target", () => {
    const { triple, notes } = clampTriple({ target: 150000, stretch: 110000 }, BOUNDS, "Monthly", "ZAR");
    expect(triple.stretch).toBe(150000);
    expect(notes.join(" ")).toContain("Monthly");
  });

  it("rounds to whole units", () => {
    const { triple } = clampTriple({ target: 120000.7, stretch: 150000.2 }, BOUNDS, "Setup", "ZAR");
    expect(triple.target).toBe(120001);
    expect(triple.stretch).toBe(150000);
  });

  it("collapses to the floor when floor and ceiling are equal", () => {
    const { triple } = clampTriple({ target: 5, stretch: 999 }, { floor: 50, ceiling: 50 }, "Setup", "ZAR");
    expect(triple).toEqual({ floor: 50, target: 50, stretch: 50 });
  });
});
