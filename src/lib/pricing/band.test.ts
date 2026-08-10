import { describe, it, expect } from "vitest";
import { preparePricing, buildBand } from "./band";
import type { BuildAttributes, Comparable, Quote, Settings } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/seed";

const NOW = "2026-08-10T09:00:00.000Z";

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: ["Xero"], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  usdToZar: 18,
  minimumSetupFee: 50000,
  targetMarginPct: 0.4,
};

function comparable(id: string, setupPrice: number, monthlyPrice: number): Comparable {
  return {
    id, createdAt: "", updatedAt: "", kind: "market", name: `Vendor ${id}`,
    notes: "", sourceUrl: "", attributes: ATTRS, setupPrice, monthlyPrice, currency: "ZAR",
  };
}

const COMPARABLES = [
  comparable("a", 90000, 7000),
  comparable("b", 120000, 9000),
  comparable("c", 160000, 12000),
];

const BASE = {
  attributes: ATTRS,
  opexLines: [{ id: "h", label: "Hosting", monthlyCost: 5000 }],
  aiUsage: null,
  comparables: COMPARABLES,
  quotes: [] as Quote[],
  currentQuoteId: "current",
  settings: SETTINGS,
  intent: null,
  capex: null,
};

describe("preparePricing", () => {
  it("produces bounds and an anchor from three comparables", () => {
    const p = preparePricing(BASE);
    expect(p.setupAnchor).not.toBeNull();
    expect(p.bounds.setup).not.toBeNull();
    expect(p.bounds.monthly.floor).toBe(7000);
    expect(p.set.candidates).toHaveLength(3);
  });

  it("reports every missing input as a degrade code", () => {
    const p = preparePricing(BASE);
    expect(p.degraded).toContain("no-intent");
    expect(p.degraded).toContain("no-capex");
    expect(p.degraded).not.toContain("no-anchor");
  });

  it("reports no-anchor below three comparables", () => {
    const p = preparePricing({ ...BASE, comparables: COMPARABLES.slice(0, 2) });
    expect(p.setupAnchor).toBeNull();
    expect(p.bounds.setup).toBeNull();
    expect(p.degraded).toContain("no-anchor");
  });

  it("reports no-fx-rate when USD comparables were dropped", () => {
    const usd: Comparable = { ...comparable("u", 5000, 400), currency: "USD" };
    const p = preparePricing({
      ...BASE,
      settings: { ...SETTINGS, usdToZar: 0 },
      comparables: [...COMPARABLES, usd],
    });
    expect(p.degraded).toContain("no-fx-rate");
  });

  it("reports an unpriced AI model", () => {
    const p = preparePricing({
      ...BASE,
      aiUsage: {
        model: "gpt-hypothetical", runsPerDay: 10,
        inputTokensPerRun: 1000, outputTokensPerRun: 200,
        inputPriceOverride: null, outputPriceOverride: null,
      },
    });
    expect(p.degraded).toContain("unpriced-ai-model");
  });
});

describe("buildBand", () => {
  it("uses the adjudicated numbers when they sit inside the bounds", () => {
    const p = preparePricing(BASE);
    const band = buildBand(
      p,
      { setup: { target: 120000, stretch: 150000 }, monthly: { target: 9000, stretch: 11000 }, reasoning: "Strong signals." },
      "ZAR",
      NOW,
    );
    expect(band.setup!.target).toBe(120000);
    expect(band.setup!.stretch).toBe(150000);
    expect(band.monthly.target).toBe(9000);
    expect(band.reasoning).toBe("Strong signals.");
    expect(band.clamps).toHaveLength(0);
    expect(band.computedAt).toBe(NOW);
  });

  it("clamps an over-reaching proposal and records why", () => {
    const p = preparePricing(BASE);
    const band = buildBand(
      p,
      { setup: { target: 120000, stretch: 900000 }, monthly: { target: 9000, stretch: 11000 }, reasoning: "" },
      "ZAR",
      NOW,
    );
    expect(band.setup!.stretch).toBe(p.bounds.setup!.ceiling);
    expect(band.clamps.join(" ")).toContain("ceiling");
  });

  it("never quotes a monthly below the opex floor, whatever the model says", () => {
    const p = preparePricing(BASE);
    const band = buildBand(
      p,
      { setup: null, monthly: { target: 100, stretch: 200 }, reasoning: "" },
      "ZAR",
      NOW,
    );
    expect(band.monthly.target).toBe(7000);
    expect(band.monthly.floor).toBe(7000);
  });

  it("falls back deterministically when adjudication is missing", () => {
    const p = preparePricing(BASE);
    const band = buildBand(p, null, "ZAR", NOW);
    expect(band.degraded).toContain("no-adjudication");
    expect(band.setup!.target).toBe(p.setupAnchor!.mid);
    expect(band.setup!.stretch).toBe(p.bounds.setup!.ceiling);
    expect(band.monthly.target).toBe(Math.round(7000 * 1.15));
    expect(band.reasoning).toContain("without an adjudication");
  });

  it("produces a monthly band but no setup band when there is no anchor", () => {
    const p = preparePricing({ ...BASE, comparables: [] });
    const band = buildBand(p, null, "ZAR", NOW);
    expect(band.setup).toBeNull();
    expect(band.anchor).toBeNull();
    expect(band.monthly.floor).toBe(7000);
    expect(band.degraded).toContain("no-anchor");
  });

  it("lists anchor contributors in matched, and price-losses only in clamps", () => {
    const lostQuote: Quote = {
      id: "lost1", createdAt: "", updatedAt: "", leadId: "l1", name: "Kestrelmoor",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "lost", sentSetup: 140000, sentMonthly: 9000,
      closedSetup: 0, closedMonthly: 0, lostReason: "price", notes: "",
    };
    const p = preparePricing({ ...BASE, quotes: [lostQuote] });
    const band = buildBand(p, null, "ZAR", NOW);
    expect(band.matched.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(band.clamps.join(" ")).toContain("Kestrelmoor");
  });

  it("carries the capex multiplier through to the ceiling", () => {
    const enterprise = preparePricing({
      ...BASE,
      capex: {
        band: "enterprise", headcount: 900, revenueNote: "", evidence: [],
        confidence: "high", generatedAt: NOW,
      },
    });
    const small = preparePricing(BASE);
    expect(enterprise.bounds.setup!.ceiling).toBeGreaterThan(small.bounds.setup!.ceiling);
    expect(enterprise.degraded).not.toContain("no-capex");
  });
});
