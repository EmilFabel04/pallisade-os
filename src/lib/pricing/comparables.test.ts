import { describe, it, expect } from "vitest";
import { buildCandidates, MIN_SIMILARITY } from "./comparables";
import type { BuildAttributes, Comparable, Quote } from "@/lib/types";

const ATTRS: BuildAttributes = {
  buildStatus: "new",
  surfaces: 6,
  integrations: ["Gmail", "Xero"],
  dataSources: 3,
  aiDepth: "core",
  userCount: 20,
  supportLoad: "medium",
};

const FAR: BuildAttributes = {
  buildStatus: "new",
  surfaces: 400,
  integrations: ["Salesforce"],
  dataSources: 300,
  aiDepth: "none",
  userCount: 100000,
  supportLoad: "low",
};

function comparable(over: Partial<Comparable>): Comparable {
  return {
    id: "c1", createdAt: "", updatedAt: "",
    kind: "market", name: "Vendor X", notes: "", sourceUrl: "",
    attributes: ATTRS, setupPrice: 100000, monthlyPrice: 8000, currency: "ZAR",
    ...over,
  };
}

function quote(over: Partial<Quote>): Quote {
  return {
    id: "q1", createdAt: "", updatedAt: "",
    leadId: "l1", name: "Acme build", attributes: ATTRS,
    opexLines: [], aiUsage: null, intent: null, capex: null, band: null,
    status: "won", sentSetup: 130000, sentMonthly: 9000,
    closedSetup: 125000, closedMonthly: 8500, lostReason: "", notes: "",
    ...over,
  };
}

const BASE = { attributes: ATTRS, currentQuoteId: "current", usdToZar: 18 };

describe("buildCandidates", () => {
  it("weights own won deals above market examples above reference builds", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [
        comparable({ id: "m1", kind: "market" }),
        comparable({ id: "r1", kind: "reference" }),
      ],
      quotes: [quote({ id: "w1", status: "won" })],
    });
    const byId = Object.fromEntries(set.candidates.map((c) => [c.id, c]));
    expect(byId.w1.weight).toBeGreaterThan(byId.m1.weight);
    expect(byId.m1.weight).toBeGreaterThan(byId.r1.weight);
  });

  it("uses closed prices for wins and asked prices for price-losses", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [],
      quotes: [
        quote({ id: "w1", status: "won" }),
        quote({ id: "l1", status: "lost", lostReason: "price" }),
      ],
    });
    expect(set.candidates.map((c) => c.id)).toEqual(["w1"]);
    expect(set.candidates[0].setupPrice).toBe(125000);
    expect(set.priceLosses.map((c) => c.id)).toEqual(["l1"]);
    expect(set.priceLosses[0].setupPrice).toBe(130000);
  });

  it("ignores losses that were not about price", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [],
      quotes: [quote({ id: "l2", status: "lost", lostReason: "timing" })],
    });
    expect(set.candidates).toHaveLength(0);
    expect(set.priceLosses).toHaveLength(0);
  });

  it("ignores draft and sent quotes, and the quote being priced", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [],
      quotes: [
        quote({ id: "d1", status: "draft" }),
        quote({ id: "s1", status: "sent" }),
        quote({ id: "current", status: "won" }),
      ],
    });
    expect(set.candidates).toHaveLength(0);
  });

  it("converts USD comparables at the FX rate", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [comparable({ id: "u1", currency: "USD", setupPrice: 5000, monthlyPrice: 400 })],
      quotes: [],
    });
    expect(set.candidates[0].setupPrice).toBe(90000);
    expect(set.candidates[0].monthlyPrice).toBe(7200);
  });

  it("drops USD comparables when the FX rate is unset, and counts them", () => {
    const set = buildCandidates({
      ...BASE,
      usdToZar: 0,
      comparables: [
        comparable({ id: "u1", currency: "USD" }),
        comparable({ id: "z1", currency: "ZAR" }),
      ],
      quotes: [],
    });
    expect(set.candidates.map((c) => c.id)).toEqual(["z1"]);
    expect(set.droppedForFx).toBe(1);
  });

  it("excludes anything below the similarity floor", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [comparable({ id: "far", attributes: FAR })],
      quotes: [],
    });
    expect(set.candidates).toHaveLength(0);
    expect(MIN_SIMILARITY).toBe(0.5);
  });

  it("skips records with no usable setup price", () => {
    const set = buildCandidates({
      ...BASE,
      comparables: [comparable({ id: "zero", setupPrice: 0 })],
      quotes: [quote({ id: "w0", status: "won", closedSetup: 0 })],
    });
    expect(set.candidates).toHaveLength(0);
  });
});
