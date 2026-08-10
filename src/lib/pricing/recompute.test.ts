import { describe, it, expect } from "vitest";
import { preparePricing } from "./band";
import { adjudicateRequestFrom } from "./recompute";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { BuildAttributes, Comparable, Settings } from "@/lib/types";

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: ["Xero"], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, usdToZar: 18, targetMarginPct: 0.4 };

function comparable(id: string, setupPrice: number): Comparable {
  return {
    id, createdAt: "", updatedAt: "", kind: "market", name: `Vendor ${id}`,
    notes: "", sourceUrl: "", attributes: ATTRS,
    setupPrice, monthlyPrice: setupPrice / 14, currency: "ZAR",
  };
}

const PREPARED = preparePricing({
  attributes: ATTRS,
  opexLines: [{ id: "h", label: "Hosting", monthlyCost: 5000 }],
  aiUsage: null,
  comparables: [comparable("a", 90000), comparable("b", 120000), comparable("c", 160000)],
  quotes: [],
  currentQuoteId: "current",
  settings: SETTINGS,
  intent: null,
  capex: null,
});

describe("adjudicateRequestFrom", () => {
  it("sends bounds and the anchor, never the raw candidate prices", () => {
    const req = adjudicateRequestFrom("Quillmere Capital", "new", PREPARED, null, null);
    expect(req.bounds.setup).toEqual(PREPARED.bounds.setup);
    expect(req.anchor).toEqual(PREPARED.setupAnchor);
    const blob = JSON.stringify(req);
    expect(blob).not.toContain("setupPrice");
  });

  it("passes matched comparables as labels and scores only", () => {
    const req = adjudicateRequestFrom("Acme", "new", PREPARED, null, null);
    expect(req.matched).toHaveLength(3);
    expect(Object.keys(req.matched[0]).sort()).toEqual(
      ["id", "label", "similarity", "source", "weight"],
    );
  });

  it("carries the build status through so licensing is visible", () => {
    expect(adjudicateRequestFrom("Acme", "license as-is", PREPARED, null, null).buildStatus)
      .toBe("license as-is");
  });

  it("passes null reads through rather than inventing empty ones", () => {
    const req = adjudicateRequestFrom("Acme", "new", PREPARED, null, null);
    expect(req.intent).toBeNull();
    expect(req.capex).toBeNull();
  });
});
