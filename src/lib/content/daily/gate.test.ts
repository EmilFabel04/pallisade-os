import { describe, it, expect } from "vitest";
import { runGate, normaliseOpener } from "./gate";
import { profileFromSamples } from "@/lib/content/voice";
import type { SourceRef } from "./types";

const profile = profileFromSamples([
  "Shipped it Tuesday.\nThe reconciliation job that took 14 hours now takes 20 minutes.\nNobody asked for a dashboard.",
]);

const refs: SourceRef[] = [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }];
const sourceTexts = ["Reconciliation takes 14 hours every month end."];

function gate(body: string, over: Partial<Parameters<typeof runGate>[0]> = {}) {
  return runGate({
    body, sourceRefs: refs, sourceTexts, profile,
    neverSay: [], recentOpeners: [], ...over,
  });
}

const check = (body: string, rule: string) =>
  gate(body).find((c) => c.rule === rule)!;

const GOOD =
  "Reconciliation took them 14 hours every month end.\n" +
  "Fourteen. For numbers that already existed in two systems.\n" +
  "We wired the two together and it now runs in 20 minutes, unattended.\n" +
  "The finance lead's first reaction was not relief. It was embarrassment that nobody had asked sooner.";

describe("ai-tells", () => {
  it("stays quiet on clean prose", () => {
    expect(check(GOOD, "ai-tells").passed).toBe(true);
  });

  it("catches banned vocabulary and names the word", () => {
    const c = check("Let me delve into the robust results.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/delve/);
  });

  it("catches negative parallelism", () => {
    const c = check("It's not a tool, it's a mindset. We shipped it in 20 minutes.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/negative parallelism/i);
  });

  it("catches emoji bullets", () => {
    expect(check("\u{1F680} Faster\n\u{1F525} Cheaper", "ai-tells").passed).toBe(false);
  });
});

describe("specificity", () => {
  it("passes when an anchor from the post appears in a source record", () => {
    expect(check(GOOD, "specificity").passed).toBe(true);
  });

  it("fails when nothing in the post is verifiable", () => {
    const c = check(
      "Manual processes slow teams down.\nAutomation helps.\nThink about your workflows.",
      "specificity",
    );
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/verifiable|unfalsifiable/i);
  });

  it("fails when the post's number is not in any source record", () => {
    const c = gate("We cut it from 900 hours to 3 hours flat.").find(
      (x) => x.rule === "specificity",
    )!;
    expect(c.passed).toBe(false);
  });
});

describe("broetry", () => {
  it("fails when more than sixty percent of paragraphs are one sentence", () => {
    const body = "One.\nTwo.\nThree.\nFour.\nFive.";
    const c = check(body, "broetry");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/5 of 5|one line|single sentence/i);
  });

  it("passes a post with real paragraphs", () => {
    const body =
      "They ran it for 14 hours. Every month end, without fail.\n\n" +
      "We wired the systems together. It takes 20 minutes now, and nobody watches it.";
    expect(check(body, "broetry").passed).toBe(true);
  });
});

describe("opener-collision", () => {
  it("fails when the opening line matches a recent opener's shape", () => {
    const c = gate(GOOD, {
      recentOpeners: ["Reconciliation took them 9 hours every quarter."],
    }).find((x) => x.rule === "opener-collision")!;
    expect(c.passed).toBe(false);
  });

  it("passes against unrelated openers", () => {
    const c = gate(GOOD, { recentOpeners: ["Nobody asked for a dashboard."] }).find(
      (x) => x.rule === "opener-collision",
    )!;
    expect(c.passed).toBe(true);
  });
});

describe("never-say", () => {
  it("fails on a founder-banned phrase and quotes it back", () => {
    const c = gate(GOOD + " We should leverage this.", { neverSay: ["leverage"] }).find(
      (x) => x.rule === "never-say",
    )!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/leverage/);
  });
});

describe("burstiness", () => {
  it("fails a draft markedly flatter than the founder's baseline", () => {
    const flat = "aa bb cc dd ee ff.\naa bb cc dd ee ff.\naa bb cc dd ee ff.\naa bb cc dd ee ff.";
    expect(check(flat, "burstiness").passed).toBe(false);
  });
});

describe("normaliseOpener", () => {
  it("reduces an opener to its comparable shape", () => {
    expect(normaliseOpener("Reconciliation took them 14 hours!")).toBe(
      normaliseOpener("reconciliation took them 9 hours"),
    );
  });
});

describe("runGate", () => {
  it("reports every rule, passing or failing", () => {
    const rules = gate(GOOD).map((c) => c.rule).sort();
    expect(rules).toEqual(
      ["ai-tells", "broetry", "burstiness", "never-say", "opener-collision", "specificity"],
    );
  });
});
