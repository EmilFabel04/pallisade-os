import { describe, it, expect } from "vitest";
import { preparePricing, buildBand } from "./band";
import { adjudicateRequestFrom } from "@/lib/pricing/recompute";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { BuildAttributes, Comparable, Quote, Settings } from "@/lib/types";

const NOW = "2026-08-10T09:00:00.000Z";

const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  usdToZar: 18,
  minimumSetupFee: 40000,
  targetMarginPct: 0.4,
};

const ATTRS: BuildAttributes = {
  buildStatus: "new", surfaces: 6, integrations: ["Xero"], dataSources: 3,
  aiDepth: "core", userCount: 20, supportLoad: "medium",
};

const COMPARABLES: Comparable[] = [90000, 120000, 160000].map((setupPrice, i) => ({
  id: `c${i}`, createdAt: "", updatedAt: "", kind: "market",
  name: `Vendor ${i}`, notes: "", sourceUrl: "",
  attributes: ATTRS, setupPrice, monthlyPrice: setupPrice / 14, currency: "ZAR",
}));

const OPEX = [{ id: "h", label: "Hosting", monthlyCost: 4000 }];

function run(over: Partial<Parameters<typeof preparePricing>[0]> = {}) {
  const prepared = preparePricing({
    attributes: ATTRS,
    opexLines: OPEX,
    aiUsage: null,
    comparables: COMPARABLES,
    quotes: [],
    currentQuoteId: "current",
    settings: SETTINGS,
    intent: null,
    capex: null,
    ...over,
  });
  return { prepared, band: buildBand(prepared, null, "ZAR", NOW) };
}

describe("pricing engine end to end", () => {
  it("always produces a monthly price, however little it knows", () => {
    const { band } = run({ comparables: [], opexLines: [], aiUsage: null });
    expect(band.monthly.target).toBeGreaterThanOrEqual(band.monthly.floor);
    expect(band.setup).toBeNull();
    expect(band.degraded).toContain("no-anchor");
    // A mis-wired assembly on this degenerate input would collapse to NaN or
    // undefined rather than 0 — that is the failure a floor≥target comparison
    // alone would miss, since both sides can go missing together.
    expect(Number.isFinite(band.monthly.floor)).toBe(true);
    expect(Number.isFinite(band.monthly.target)).toBe(true);
    expect(Number.isFinite(band.monthly.stretch)).toBe(true);
  });

  it("never quotes a monthly below running cost plus margin", () => {
    const { band } = run();
    expect(band.monthly.floor).toBe(5600); // 4000 × 1.4
    expect(band.monthly.target).toBeGreaterThanOrEqual(5600);
    expect(band.monthly.stretch).toBeGreaterThanOrEqual(band.monthly.target);
  });

  it("wires the actual computed bounds through assembly, not just any ordered triple", () => {
    const { prepared, band } = run();
    // clampTriple would force floor ≤ target ≤ stretch even if buildBand fed it
    // the wrong bounds object entirely, so that ordering alone proves nothing.
    // What it cannot fake is the floor matching the bounds this exact input
    // computed, and every target/stretch sitting inside that specific range.
    expect(band.setup!.floor).toBe(prepared.bounds.setup!.floor);
    expect(band.monthly.floor).toBe(prepared.bounds.monthly.floor);

    expect(band.setup!.target).toBeGreaterThanOrEqual(prepared.bounds.setup!.floor);
    expect(band.setup!.target).toBeLessThanOrEqual(prepared.bounds.setup!.ceiling);
    expect(band.setup!.stretch).toBeGreaterThanOrEqual(prepared.bounds.setup!.floor);
    expect(band.setup!.stretch).toBeLessThanOrEqual(prepared.bounds.setup!.ceiling);

    expect(band.monthly.target).toBeGreaterThanOrEqual(prepared.bounds.monthly.floor);
    expect(band.monthly.target).toBeLessThanOrEqual(prepared.bounds.monthly.ceiling);
    expect(band.monthly.stretch).toBeGreaterThanOrEqual(prepared.bounds.monthly.floor);
    expect(band.monthly.stretch).toBeLessThanOrEqual(prepared.bounds.monthly.ceiling);
  });

  it("prices a licensed build exactly as high as a new one, and still tells the model which it is", () => {
    const newRun = run();
    const licensedRun = run({ attributes: { ...ATTRS, buildStatus: "license as-is" } });
    expect(licensedRun.band.setup!.target).toBe(newRun.band.setup!.target);
    expect(licensedRun.band.setup!.stretch).toBe(newRun.band.setup!.stretch);

    // The price half is guaranteed a priori — buildStatus never reaches
    // similarity() or the bounds math. The half that isn't guaranteed is that
    // the adjudication request still carries buildStatus through, so the model
    // knows the build is already done and can reason about margin instead of
    // build cost. Drop that field from the payload and this fails.
    const newRequest = adjudicateRequestFrom("Acme", "new", newRun.prepared, null, null);
    const licensedRequest = adjudicateRequestFrom(
      "Acme", "license as-is", licensedRun.prepared, null, null,
    );
    expect(newRequest.buildStatus).toBe("new");
    expect(licensedRequest.buildStatus).toBe("license as-is");
  });

  it("lets capex widen the ceiling without moving the floor", () => {
    const small = run().band;
    const big = run({
      capex: {
        band: "enterprise", headcount: 900, revenueNote: "",
        evidence: [{ claim: "900 staff", url: "https://x.com" }],
        confidence: "high", generatedAt: NOW,
      },
    }).band;
    expect(big.setup!.stretch).toBeGreaterThan(small.setup!.stretch);
    expect(big.setup!.floor).toBe(small.setup!.floor);
  });

  it("caps the stretch after a price loss, and names the deal that caused it", () => {
    const lost: Quote = {
      id: "lost1", createdAt: "", updatedAt: "", leadId: "l1", name: "Kestrelmoor",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "lost", sentSetup: 100000, sentMonthly: 8000,
      closedSetup: 0, closedMonthly: 0, lostReason: "price", notes: "",
    };
    const capped = run({ quotes: [lost] }).band;
    const uncapped = run().band;
    expect(capped.setup!.stretch).toBeLessThan(uncapped.setup!.stretch);
    expect(capped.clamps.join(" ")).toContain("Kestrelmoor");
  });

  it("ignores a loss that was not about price", () => {
    const lost: Quote = {
      id: "lost2", createdAt: "", updatedAt: "", leadId: "l1", name: "Timing",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "lost", sentSetup: 100000, sentMonthly: 8000,
      closedSetup: 0, closedMonthly: 0, lostReason: "timing", notes: "",
    };
    expect(run({ quotes: [lost] }).band.setup!.stretch).toBe(run().band.setup!.stretch);
  });

  it("promotes a won deal into the evidence the next quote is priced from", () => {
    const won: Quote = {
      id: "won1", createdAt: "", updatedAt: "", leadId: "l1", name: "Acme",
      attributes: ATTRS, opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
      status: "won", sentSetup: 200000, sentMonthly: 14000,
      closedSetup: 200000, closedMonthly: 14000, lostReason: "", notes: "",
    };
    const withWin = run({ quotes: [won] });
    expect(withWin.prepared.set.candidates.map((c) => c.id)).toContain("won1");
    expect(withWin.band.matched.some((m) => m.id === "won1")).toBe(true);
    expect(withWin.band.setup!.stretch).toBeGreaterThan(run().band.setup!.stretch);
  });

  it("reports rather than hides every missing input", () => {
    const { band } = run({ settings: { ...SETTINGS, usdToZar: 0 }, comparables: [
      ...COMPARABLES,
      { ...COMPARABLES[0], id: "usd", currency: "USD" as const },
    ] });
    // Exactly these four, no stray or duplicated codes — arrayContaining would
    // have let either slip through unnoticed.
    expect([...band.degraded].sort()).toEqual(
      ["no-adjudication", "no-capex", "no-fx-rate", "no-intent"],
    );
  });
});
