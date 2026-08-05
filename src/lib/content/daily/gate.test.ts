import { describe, it, expect } from "vitest";
import { runGate, normaliseOpener, firstLine, BURSTINESS_FLOOR } from "./gate";
import { profileFromSamples, ZERO_STATS } from "@/lib/content/voice";
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

  it("catches a phrase that ends on punctuation, not a word character (C2)", () => {
    // A trailing \b after "?" can never match — there is no word character
    // on either side of it — so the phrase could never fire at all unless
    // the boundary is dropped on that side.
    const c = check("We rewired it. The result? Twenty minutes.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/the result\?/i);
  });

  it("catches negative parallelism written with a curly apostrophe (C3)", () => {
    const c = check("It’s not a tool, it’s a mindset. We shipped it in 20 minutes.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/negative parallelism/i);
  });

  it("catches \"here's the thing\" written with a curly apostrophe (C3)", () => {
    const c = check("Here’s the thing about reconciliation: it never gets fixed.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/here's the thing/i);
  });

  it("catches \"it's important to note\" written with a curly apostrophe (C3)", () => {
    const c = check("It’s important to note the change we made.", "ai-tells");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/it's important to note/i);
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

  it("does not let '3' falsely trace against a source that only contains '43' (C4i)", () => {
    const c = gate("We saved 3 hours every week.", {
      sourceRefs: [],
      sourceTexts: ["The old process took 43 hours total."],
    }).find((x) => x.rule === "specificity")!;
    expect(c.passed).toBe(false);
  });

  it("does not let '1' falsely trace against a source that only contains '100' (C4i)", () => {
    const c = gate("We fixed it in 1 day.", {
      sourceRefs: [],
      sourceTexts: ["It used to take 100 days total."],
    }).find((x) => x.rule === "specificity")!;
    expect(c.passed).toBe(false);
  });

  it("names untraced anchors on the failing path too (C4ii)", () => {
    const c = gate("We cut it from 900 hours to 3 hours flat.").find(
      (x) => x.rule === "specificity",
    )!;
    expect(c.detail).toMatch(/UNVERIFIED/);
  });

  it("traces a SourceRef anchor by substring, not exact whole-string equality (I1)", () => {
    // extractAnchors yields the narrow token "14" from the body, while the
    // ref's own anchor is the wider phrase "14 hours" it was lifted from.
    // With no sourceTexts at all, only the ref fallback can trace this.
    const c = gate("The job took 14 hours.", {
      sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
      sourceTexts: [],
    }).find((x) => x.rule === "specificity")!;
    expect(c.passed).toBe(true);
  });

  describe("fabrication policy (ITEM 2): untraced high-risk anchors fail outright", () => {
    const acmeBody =
      "Acme Financial saved R2,400,000 after we rebuilt their close. " +
      "Reconciliation took 14 hours before.";

    it("FAILS on an untraced currency figure and company name, even with a traced anchor present", () => {
      // "Acme Financial" and "R2,400,000" are invented — only "14" traces
      // back to the source record. One verified number must not launder a
      // fabricated client name and figure sitting right next to it.
      const c = gate(acmeBody).find((x) => x.rule === "specificity")!;
      expect(c.passed).toBe(false);
      expect(c.detail).toMatch(/Acme Financial/);
      expect(c.detail).toMatch(/R2,400,000/);
    });

    it("passes the same body once the source actually contains both details", () => {
      const c = gate(acmeBody, {
        sourceRefs: [],
        sourceTexts: [
          "Acme Financial's reconciliation took 14 hours before we rebuilt their close, saving R2,400,000.",
        ],
      }).find((x) => x.rule === "specificity")!;
      expect(c.passed).toBe(true);
    });

    it("still PASSES on an untraced plain number — models legitimately rephrase or derive figures", () => {
      const c = gate(
        "Reconciliation took them 14 hours every month end. It now takes 20 minutes.",
      ).find((x) => x.rule === "specificity")!;
      expect(c.passed).toBe(true);
    });

    it("still PASSES on an untraced ordinary proper noun — not every capitalised pair is a company", () => {
      // "Last Tuesday" is a multi-word, Title-Case anchor extractAnchors
      // yields from completely ordinary prose. Failing on it would reject
      // good posts daily.
      const c = gate(
        "Last Tuesday we fixed the reconciliation job. It used to take 14 hours.",
      ).find((x) => x.rule === "specificity")!;
      expect(c.passed).toBe(true);
    });

    it("still PASSES on 'Happy Monday' — an ordinary capitalised greeting, not a company", () => {
      const c = gate(
        "Happy Monday. The reconciliation job that took 14 hours now runs unattended.",
      ).find((x) => x.rule === "specificity")!;
      expect(c.passed).toBe(true);
    });

    it("FAILS on an untraced currency amount alone", () => {
      const c = gate("We saved R2,400,000 last quarter with the new process.", {
        sourceRefs: [],
        sourceTexts: ["The finance team was happy with the new process."],
      }).find((x) => x.rule === "specificity")!;
      expect(c.passed).toBe(false);
      expect(c.detail).toMatch(/R2,400,000/);
    });

    it("does not treat a single quoted word as a company name, even a company-ish one", () => {
      // isCompanyAnchor requires MORE THAN ONE word. extractAnchors yields
      // single-token anchors from quoted spans, so without that requirement a
      // post quoting someone saying the word "Capital" would be rejected as a
      // fabricated client name. Only "14" traces here; "Capital" does not.
      const c = gate('He kept saying "Capital" over and over. It took them 14 hours.').find(
        (x) => x.rule === "specificity",
      )!;
      expect(c.passed).toBe(true);
    });

    it("does not treat a name beginning with 'R' as a currency figure", () => {
      // CURRENCY_ANCHOR requires the digit run that makes an anchor a
      // currency shape, not merely a leading "R" — a name like "Robert
      // Anderson" must not be caught by the currency check.
      const c = gate("Robert Anderson approved the change after we cut it to 14 hours.").find(
        (x) => x.rule === "specificity",
      )!;
      expect(c.passed).toBe(true);
    });
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

  function paragraphs(total: number, singleSentence: number): string {
    const out: string[] = [];
    for (let i = 0; i < singleSentence; i++) out.push(`Single sentence number ${i}.`);
    for (let i = 0; i < total - singleSentence; i++) out.push(`First part ${i}. Second part ${i}.`);
    return out.join("\n\n");
  }

  it("passes at exactly the 60% threshold (I2)", () => {
    const c = check(paragraphs(100, 60), "broetry");
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/60 of 100/);
  });

  it("fails just above the 60% threshold, at 61% (I2)", () => {
    const c = check(paragraphs(100, 61), "broetry");
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/61 of 100/);
  });

  it("passes a two-paragraph post even if both paragraphs are single-sentence — too short to judge (I3)", () => {
    const c = check("One sentence only.\n\nAnother single sentence.", "broetry");
    expect(c.passed).toBe(true);
    expect(c.detail).toMatch(/too short/i);
  });

  it("fails a three-paragraph post where all three are single-sentence, once the ratio check applies (I3)", () => {
    const c = check(
      "One sentence only.\n\nAnother single sentence.\n\nA third single sentence.",
      "broetry",
    );
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/3 of 3/);
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

  it("collides on the whole first line, not just its first sentence (I5)", () => {
    // The opening LINE holds two sentences. ContentPost.openingLine (see
    // rotation.ts's recentOpeners) denormalises the whole line, so the gate
    // must compare against the whole line too, or a post with a two-sentence
    // opener will never collide with its own recorded opener.
    const body = "Reconciliation took 14 hours. That was absurd.\nWe fixed it in 20 minutes.";
    const c = gate(body, {
      recentOpeners: ["Reconciliation took 9 hours. That was absurd."],
    }).find((x) => x.rule === "opener-collision")!;
    expect(c.passed).toBe(false);
  });

  // End-to-end counterpart to the firstLine leading-noise tests: a model that
  // emits a stray leading newline or a "---" rule must not thereby switch the
  // whole collision check off.
  it("still detects a collision when the body opens with a stray newline", () => {
    const c = gate("\nReconciliation took them 14 hours every month end.\nWe fixed it.", {
      recentOpeners: ["Reconciliation took them 9 hours every quarter."],
    }).find((x) => x.rule === "opener-collision")!;
    expect(c.passed).toBe(false);
  });

  it("still detects a collision when the body opens with a separator line", () => {
    const c = gate("---\nReconciliation took them 14 hours every month end.\nWe fixed it.", {
      recentOpeners: ["Reconciliation took them 9 hours every quarter."],
    }).find((x) => x.rule === "opener-collision")!;
    expect(c.passed).toBe(false);
  });
});

describe("firstLine", () => {
  it("takes the whole first line, stopping only at a newline (I5)", () => {
    expect(firstLine("Reconciliation took 14 hours. That was absurd.\nRest of the post.")).toBe(
      "Reconciliation took 14 hours. That was absurd.",
    );
  });

  // The three cases below all returned a shape-less opener under the previous
  // `body.split(/\n+/)[0]` implementation, which made checkOpener's `if
  // (!shape)` guard report "no opening line to compare" — a PASS — while
  // comparing nothing at all. A silently self-disabling check is worse than
  // an absent one, so each leading-noise shape is pinned here directly.
  it("skips a leading blank line rather than returning an empty opener", () => {
    expect(firstLine("\nReconciliation took 14 hours.\nRest of the post.")).toBe(
      "Reconciliation took 14 hours.",
    );
  });

  it("skips a leading whitespace-only line", () => {
    expect(firstLine("   \t \nReconciliation took 14 hours.")).toBe(
      "Reconciliation took 14 hours.",
    );
  });

  it("skips a leading separator carrying no letter or digit", () => {
    expect(firstLine("---\nReconciliation took 14 hours.")).toBe(
      "Reconciliation took 14 hours.",
    );
  });

  it("returns an empty string when the body has no alphanumeric line at all", () => {
    expect(firstLine("\n---\n   \n")).toBe("");
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
  const flat = "aa bb cc dd ee ff.\naa bb cc dd ee ff.\naa bb cc dd ee ff.\naa bb cc dd ee ff.";

  it("fails a draft markedly flatter than the founder's baseline", () => {
    expect(check(flat, "burstiness").passed).toBe(false);
  });

  it("fails a flat draft even when the profile itself is the cold-start ZERO_STATS (C1)", () => {
    // profileFromSamples([]) yields ZERO_STATS: burstiness 0. The
    // profile-relative check (draft < profile - 0.15) can never fire here —
    // 0 is never less than -0.15 — so only the absolute floor can catch this.
    const c = gate(flat, { profile: ZERO_STATS }).find((x) => x.rule === "burstiness")!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(new RegExp(BURSTINESS_FLOOR.toFixed(2)));
  });

  it("fails a flat draft against a near-zero (but nonzero) baseline (C1)", () => {
    // profile.burstiness = 0.10: profile - 0.15 is still negative, so the
    // relative check is still dead here too — this is not just a
    // zero-exactly edge case, it covers any founder whose own writing
    // genuinely measures as close to uniform.
    const nearZero = { ...ZERO_STATS, burstiness: 0.1 };
    const c = gate(flat, { profile: nearZero }).find((x) => x.rule === "burstiness")!;
    expect(c.passed).toBe(false);
  });

  it("still passes a genuinely bursty draft against a near-zero baseline (C1, floor satisfied)", () => {
    // Pins the other direction against the mutation "burstiness always
    // fires": once the draft clears the absolute floor, and the (very low)
    // baseline obviously doesn't demand more, it must pass.
    const nearZero = { ...ZERO_STATS, burstiness: 0.1 };
    const c = gate(GOOD, { profile: nearZero }).find((x) => x.rule === "burstiness")!;
    expect(c.passed).toBe(true);
  });

  it("fails via the profile-relative check alone, independent of the floor (C1)", () => {
    // Draft burstiness ~0.328 — above the 0.30 floor — against a profile of
    // 0.60, where profile - 0.15 = 0.45. The floor alone would pass this;
    // only the relative comparison against the founder's own baseline
    // catches it. Confirms the floor did not silently replace that check.
    const draft =
      "One two three four five six seven eight.\n" +
      "One two three four five.\n" +
      "One two three four five six.\n" +
      "One two three.";
    const highProfile = { ...ZERO_STATS, burstiness: 0.6 };
    const c = gate(draft, { profile: highProfile }).find((x) => x.rule === "burstiness")!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/0\.60/);
  });
});

describe("normaliseOpener", () => {
  it("reduces an opener to its comparable shape", () => {
    expect(normaliseOpener("Reconciliation took them 14 hours!")).toBe(
      normaliseOpener("reconciliation took them 9 hours"),
    );
  });

  it("pins the 6-word window: two openers that only differ after word 6 collide (I4)", () => {
    // This is documenting current behaviour, not asserting it is desirable —
    // a future change to the window size should make this test visibly
    // change, rather than the collision silently starting or stopping.
    const a = "Last Tuesday a client asked me why the numbers never matched at close.";
    const b = "Last Tuesday a client asked me how the numbers never matched at close.";
    expect(normaliseOpener(a)).toBe(normaliseOpener(b));
    expect(normaliseOpener(a)).toBe("last tuesday a client asked me");
  });

  it("pins the 6-word window: two openers that differ within the first 6 words do not collide (I4)", () => {
    const a = "Nobody asked for a dashboard";
    const b = "Nobody asked for a dashboard, ever";
    expect(normaliseOpener(a)).not.toBe(normaliseOpener(b));
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
