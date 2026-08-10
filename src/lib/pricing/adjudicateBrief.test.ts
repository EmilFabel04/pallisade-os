import { describe, it, expect } from "vitest";
import { adjudicateBrief } from "./adjudicateBrief";
import type { AdjudicateRequest } from "./adjudicateBrief";

const REQ: AdjudicateRequest = {
  company: "Quillmere Capital",
  bounds: {
    setup: { floor: 90000, ceiling: 160000 },
    monthly: { floor: 7000, ceiling: 12000 },
    notes: [],
  },
  anchor: { low: 90000, mid: 120000, high: 160000 },
  matched: [{ source: "quote", id: "q1", label: "Acme build", similarity: 0.82, weight: 0.82 }],
  intent: {
    score: 78, band: "hot",
    signals: [{ quote: "We need this before year end", weight: 0.9 }],
    risks: ["Procurement is slow"], generatedAt: "",
  },
  capex: {
    band: "mid", headcount: 140, revenueNote: "R400m AUM",
    evidence: [{ claim: "140 staff", url: "https://x.com" }],
    confidence: "high", generatedAt: "",
  },
  buildStatus: "new",
};

describe("adjudicateBrief", () => {
  it("states both ranges explicitly", () => {
    const b = adjudicateBrief(REQ);
    expect(b).toContain("90000");
    expect(b).toContain("160000");
    expect(b).toContain("7000");
    expect(b).toContain("12000");
  });

  it("passes the intent evidence through verbatim", () => {
    expect(adjudicateBrief(REQ)).toContain("We need this before year end");
  });

  it("says plainly when a read is missing rather than omitting it", () => {
    const b = adjudicateBrief({ ...REQ, intent: null, capex: null });
    expect(b).toContain("No intent read");
    expect(b).toContain("No capex read");
  });

  it("flags a licensing deal so the model knows the floor is not a build cost", () => {
    expect(adjudicateBrief({ ...REQ, buildStatus: "license as-is" })).toContain("already built");
  });

  it("says there is no setup range when there is no anchor", () => {
    const b = adjudicateBrief({
      ...REQ,
      anchor: null,
      bounds: { setup: null, monthly: REQ.bounds.monthly, notes: [] },
    });
    expect(b).toContain("no setup range");
  });

  // The route casts an unchecked request body to AdjudicateRequest, so
  // adjudicateBrief must tolerate every shape a malformed body can take
  // without throwing past the route's error handling (see Task 11's
  // capexQuery lesson: a pure builder run before the try block on an
  // unchecked cast must be defensive, not just the route).

  it("does not throw when bounds is missing entirely", () => {
    expect(() =>
      adjudicateBrief({ ...REQ, bounds: undefined as unknown as AdjudicateRequest["bounds"] }),
    ).not.toThrow();
  });

  it("does not throw when bounds is not an object", () => {
    expect(() =>
      adjudicateBrief({ ...REQ, bounds: "nope" as unknown as AdjudicateRequest["bounds"] }),
    ).not.toThrow();
  });

  it("does not throw when bounds.monthly is missing", () => {
    expect(() =>
      adjudicateBrief({
        ...REQ,
        bounds: { setup: null, notes: [] } as unknown as AdjudicateRequest["bounds"],
      }),
    ).not.toThrow();
  });

  it("does not throw when bounds.monthly is present but malformed", () => {
    expect(() =>
      adjudicateBrief({
        ...REQ,
        bounds: { setup: null, monthly: "nope", notes: [] } as unknown as AdjudicateRequest["bounds"],
      }),
    ).not.toThrow();
  });

  it("does not throw when matched is not an array", () => {
    expect(() =>
      adjudicateBrief({ ...REQ, matched: "nope" as unknown as AdjudicateRequest["matched"] }),
    ).not.toThrow();
  });

  it("does not throw when matched is missing", () => {
    expect(() =>
      adjudicateBrief({ ...REQ, matched: undefined as unknown as AdjudicateRequest["matched"] }),
    ).not.toThrow();
  });

  it("does not throw when intent.signals is not an array", () => {
    expect(() =>
      adjudicateBrief({
        ...REQ,
        intent: { ...REQ.intent!, signals: "nope" } as unknown as AdjudicateRequest["intent"],
      }),
    ).not.toThrow();
  });

  it("does not throw when intent.risks is not an array", () => {
    expect(() =>
      adjudicateBrief({
        ...REQ,
        intent: { ...REQ.intent!, risks: "nope" } as unknown as AdjudicateRequest["intent"],
      }),
    ).not.toThrow();
  });

  it("does not throw when req itself is not an object", () => {
    expect(() =>
      adjudicateBrief(null as unknown as AdjudicateRequest),
    ).not.toThrow();
  });
});
