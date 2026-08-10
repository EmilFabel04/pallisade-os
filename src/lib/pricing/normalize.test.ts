import { describe, it, expect } from "vitest";
import { normalizeIntent, normalizeCapex, normalizeAdjudication } from "./normalize";

const NOW = "2026-08-10T09:00:00.000Z";

describe("normalizeIntent", () => {
  it("keeps a well-formed read intact", () => {
    const r = normalizeIntent(
      {
        score: 78,
        band: "hot",
        signals: [{ quote: "We need this before year end", weight: 0.9 }],
        risks: ["Procurement is slow"],
      },
      NOW,
    );
    expect(r.score).toBe(78);
    expect(r.band).toBe("hot");
    expect(r.signals).toHaveLength(1);
    expect(r.generatedAt).toBe(NOW);
  });

  it("clamps a score outside 0-100", () => {
    expect(normalizeIntent({ score: 3000 }, NOW).score).toBe(100);
    expect(normalizeIntent({ score: -5 }, NOW).score).toBe(0);
  });

  it("derives the band from the score when the model invents one", () => {
    expect(normalizeIntent({ score: 20, band: "scorching" }, NOW).band).toBe("cold");
    expect(normalizeIntent({ score: 50 }, NOW).band).toBe("warm");
    expect(normalizeIntent({ score: 90 }, NOW).band).toBe("hot");
  });

  it("drops signals with no quoted evidence", () => {
    const r = normalizeIntent(
      { score: 50, signals: [{ quote: "", weight: 1 }, { weight: 1 }, { quote: "Real quote", weight: 5 }] },
      NOW,
    );
    expect(r.signals).toEqual([{ quote: "Real quote", weight: 1 }]);
  });

  it("survives a completely empty payload", () => {
    const r = normalizeIntent({}, NOW);
    expect(r.score).toBe(0);
    expect(r.band).toBe("cold");
    expect(r.signals).toEqual([]);
    expect(r.risks).toEqual([]);
  });
});

describe("normalizeCapex", () => {
  it("keeps a well-formed read intact", () => {
    const r = normalizeCapex(
      {
        band: "mid",
        headcount: 140,
        revenueNote: "R400m AUM",
        evidence: [{ claim: "140 staff", url: "https://example.com/about" }],
        confidence: "high",
      },
      NOW,
    );
    expect(r.band).toBe("mid");
    expect(r.headcount).toBe(140);
    expect(r.evidence).toHaveLength(1);
    expect(r.confidence).toBe("high");
  });

  it("falls back to unknown for a band it does not recognise", () => {
    expect(normalizeCapex({ band: "enormous" }, NOW).band).toBe("unknown");
    expect(normalizeCapex({}, NOW).band).toBe("unknown");
  });

  it("drops evidence with no source URL", () => {
    const r = normalizeCapex(
      { band: "mid", evidence: [{ claim: "Big" }, { claim: "Real", url: "https://x.com" }] },
      NOW,
    );
    expect(r.evidence).toEqual([{ claim: "Real", url: "https://x.com" }]);
  });

  it("defaults confidence to low rather than assuming", () => {
    expect(normalizeCapex({ band: "mid", confidence: "certain" }, NOW).confidence).toBe("low");
  });

  it("treats a non-numeric headcount as unknown", () => {
    expect(normalizeCapex({ band: "mid", headcount: "lots" }, NOW).headcount).toBeNull();
  });
});

describe("normalizeAdjudication", () => {
  it("keeps well-formed numbers", () => {
    const a = normalizeAdjudication({
      setup: { target: 120000, stretch: 150000 },
      monthly: { target: 9000, stretch: 11000 },
      reasoning: "Because.",
    });
    expect(a.setup).toEqual({ target: 120000, stretch: 150000 });
    expect(a.monthly).toEqual({ target: 9000, stretch: 11000 });
    expect(a.reasoning).toBe("Because.");
  });

  it("returns a null setup when the numbers are not usable", () => {
    expect(normalizeAdjudication({ monthly: { target: 9000, stretch: 11000 } }).setup).toBeNull();
    expect(normalizeAdjudication({ setup: { target: "lots" }, monthly: {} }).setup).toBeNull();
  });

  it("zeroes an unusable monthly so the floor clamp catches it", () => {
    const a = normalizeAdjudication({});
    expect(a.monthly).toEqual({ target: 0, stretch: 0 });
    expect(a.reasoning).toBe("");
  });
});
