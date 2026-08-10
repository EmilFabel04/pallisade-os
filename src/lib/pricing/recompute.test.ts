import { describe, it, expect } from "vitest";
import { preparePricing } from "./band";
import { adjudicateRequestFrom } from "./recompute";
import { DEFAULT_SETTINGS } from "@/lib/seed";
import type { BuildAttributes, Comparable, Quote, Settings } from "@/lib/types";

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

// A quote lost specifically on price caps the setup ceiling and names the
// client in `bounds.notes` (see bounds.ts) — that note is the provenance the
// wire payload is supposed to withhold.
const PRICE_LOSS_QUOTE: Quote = {
  id: "q-kestrelmoor", createdAt: "", updatedAt: "", leadId: "",
  name: "Kestrelmoor", attributes: ATTRS, opexLines: [], aiUsage: null,
  intent: null, capex: null, band: null, status: "lost",
  sentSetup: 100000, sentMonthly: 9000, closedSetup: 0, closedMonthly: 0,
  lostReason: "price", notes: "",
};

const PREPARED_WITH_LOSS = preparePricing({
  attributes: ATTRS,
  opexLines: [{ id: "h", label: "Hosting", monthlyCost: 5000 }],
  aiUsage: null,
  comparables: [comparable("a", 90000), comparable("b", 120000), comparable("c", 160000)],
  quotes: [PRICE_LOSS_QUOTE],
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

describe("adjudicateRequestFrom strips bounds provenance", () => {
  it("empties bounds.notes so a price-loss quote's client name never reaches the wire", () => {
    // Confirm the upstream note actually exists and names the client — otherwise
    // this test would rot into a no-op if the price-loss cap rule ever changes.
    expect(PREPARED_WITH_LOSS.bounds.notes.length).toBeGreaterThan(0);
    const rawNote = PREPARED_WITH_LOSS.bounds.notes[0];
    expect(rawNote).toContain("Kestrelmoor");

    const req = adjudicateRequestFrom("Acme", "new", PREPARED_WITH_LOSS, null, null);
    expect(req.bounds.notes).toEqual([]);

    const blob = JSON.stringify(req);
    expect(blob).not.toContain("Kestrelmoor");
    expect(blob).not.toContain(rawNote);
  });
});
