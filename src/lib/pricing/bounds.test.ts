import { describe, it, expect } from "vitest";
import { computeBounds, capexMultiplier, monthlyFloor } from "./bounds";
import type { Candidate } from "./comparables";
import type { BuildAttributes, Settings } from "@/lib/types";

const MULT: Settings["capexMultipliers"] = { micro: 0.7, small: 1.0, mid: 1.4, enterprise: 2.0 };

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: [], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

function loss(id: string, setupPrice: number): Candidate {
  return {
    source: "quote", id, label: id, attributes: ATTRS,
    setupPrice, monthlyPrice: 9000, similarity: 0.8, weight: 0.8,
  };
}

const BASE = {
  opexTotal: 5000,
  targetMarginPct: 0.4,
  minimumSetupFee: 0,
  setupAnchor: { low: 90000, mid: 120000, high: 160000 },
  monthlyAnchor: { low: 7000, mid: 9000, high: 12000 },
  capexBand: "small" as const,
  multipliers: MULT,
  priceLosses: [] as Candidate[],
  currency: "ZAR" as const,
};

describe("capexMultiplier", () => {
  it("maps each band to its multiplier", () => {
    expect(capexMultiplier("micro", MULT)).toBe(0.7);
    expect(capexMultiplier("enterprise", MULT)).toBe(2.0);
  });
  it("treats an unknown band as neutral", () => {
    expect(capexMultiplier("unknown", MULT)).toBe(1);
  });
  it("treats a zero multiplier as neutral rather than as zero", () => {
    // Settings' NumberInput has min={0} and Number("") is 0, so a cleared
    // field must not collapse the ceiling to the floor.
    expect(capexMultiplier("micro", { ...MULT, micro: 0 })).toBe(1);
  });
  it("treats a negative or non-finite multiplier as neutral", () => {
    expect(capexMultiplier("micro", { ...MULT, micro: -1 })).toBe(1);
    expect(capexMultiplier("micro", { ...MULT, micro: NaN })).toBe(1);
  });
});

describe("monthlyFloor", () => {
  it("is opex plus target margin, rounded — the single formula bounds.ts and OpexPanel share", () => {
    expect(monthlyFloor(5000, 0.4)).toBe(7000);
    expect(monthlyFloor(333, 0.1)).toBe(366); // round(333 * 1.1) = round(366.3)
  });
});

describe("computeBounds", () => {
  it("sets the monthly floor at opex plus target margin", () => {
    const b = computeBounds(BASE);
    expect(b.monthly.floor).toBe(7000); // 5000 × 1.4
  });

  it("never lets the monthly ceiling fall below 1.5× the floor", () => {
    const b = computeBounds({ ...BASE, monthlyAnchor: { low: 100, mid: 200, high: 300 } });
    expect(b.monthly.ceiling).toBe(10500); // 7000 × 1.5 beats 300 × 1.0
  });

  it("falls back to 1.5× the floor when there is no anchor at all", () => {
    const b = computeBounds({ ...BASE, setupAnchor: null, monthlyAnchor: null });
    expect(b.setup).toBeNull();
    expect(b.monthly.floor).toBe(7000);
    expect(b.monthly.ceiling).toBe(10500);
  });

  it("raises the setup floor to the minimum setup fee when that is higher", () => {
    expect(computeBounds(BASE).setup!.floor).toBe(90000);
    expect(computeBounds({ ...BASE, minimumSetupFee: 110000 }).setup!.floor).toBe(110000);
  });

  it("applies the capex multiplier to the setup ceiling", () => {
    expect(computeBounds({ ...BASE, capexBand: "enterprise" }).setup!.ceiling).toBe(320000);
    expect(computeBounds({ ...BASE, capexBand: "micro" }).setup!.ceiling).toBe(112000);
  });

  it("caps the ceiling at the lowest price-loss, and says whose", () => {
    const b = computeBounds({ ...BASE, priceLosses: [loss("Kestrelmoor", 140000), loss("Other", 155000)] });
    expect(b.setup!.ceiling).toBe(140000);
    expect(b.notes.join(" ")).toContain("Kestrelmoor");
    expect(b.notes.join(" ")).toContain("R140,000");
  });

  it("ignores a price-loss above the ceiling", () => {
    const b = computeBounds({ ...BASE, priceLosses: [loss("Rich", 900000)] });
    expect(b.setup!.ceiling).toBe(160000);
    expect(b.notes).toHaveLength(0);
  });

  it("lets the walk-away floor win when a price-loss cap lands below it", () => {
    const b = computeBounds({
      ...BASE,
      minimumSetupFee: 150000,
      priceLosses: [loss("Cheapskate", 60000)],
    });
    expect(b.setup!.floor).toBe(150000);
    expect(b.setup!.ceiling).toBe(150000);
    expect(b.notes.join(" ")).toContain("floor wins");
    expect(b.notes.join(" ")).toContain("Price-loss cap");
  });

  it("does not invent a price-loss refusal when the floor wins with zero price losses", () => {
    // Reproduces the reviewer's case: nothing was ever lost on price — the
    // capex multiplier and minimum setup fee alone squeeze the ceiling below
    // the floor. The note must not claim a client refused a number.
    const b = computeBounds({
      ...BASE,
      minimumSetupFee: 120000,
      capexBand: "micro",
      priceLosses: [],
    });
    expect(b.setup!.ceiling).toBe(120000); // 160000 × 0.7 = 112000, floor wins at 120000
    const joined = b.notes.join(" ");
    expect(joined).toContain("floor wins");
    expect(joined).not.toContain("price loss");
    expect(joined.toLowerCase()).not.toContain("price-loss");
    expect(joined).toContain("capex multiplier");
    expect(joined).toContain("minimum setup fee");
  });
});
