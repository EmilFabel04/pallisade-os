import { describe, it, expect } from "vitest";
import { buildDraftPrompt } from "./draft";
import { buildRevisePrompt } from "./revise";
import { profileFromSamples } from "@/lib/content/voice";
import type { PostBrief, EditorialCheck } from "./types";

const brief: PostBrief = {
  slot: 1, sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
  pillar: "client-pain", format: "scene",
  claim: "Nobody owned the reconciliation, so it cost 14 hours a month.",
  anchor: "14 hours", why: "It is the sharpest thing logged this week.",
};

const base = {
  brief,
  sourceTexts: ["Reconciliation takes 14 hours every month end."],
  positioning: "We sell calm to overwhelmed finance teams.",
  fingerprint: "Blunt, concrete, allergic to abstraction.",
  stats: profileFromSamples(["Shipped it Tuesday. The job that took 14 hours now takes 20 minutes."]),
  samples: ["Shipped it Tuesday."],
  killedExamples: [{ body: "Manual work is bad.", reason: "boring" }],
  editPairs: [{ before: "We leveraged automation.", after: "We wired the two systems together." }],
  neverSay: ["leverage"],
};

describe("buildDraftPrompt", () => {
  it("carries the claim, the anchor and the source text", () => {
    const p = buildDraftPrompt(base);
    expect(p).toContain("Nobody owned the reconciliation");
    expect(p).toContain("14 hours");
    expect(p).toContain("Reconciliation takes 14 hours every month end.");
  });

  it("states the pillar and the format shape", () => {
    const p = buildDraftPrompt(base);
    expect(p).toMatch(/client-pain/);
    expect(p).toMatch(/specific moment/i);
  });

  it("includes the anti-slop constitution and the craft rules", () => {
    const p = buildDraftPrompt(base);
    expect(p).toMatch(/It's not X, it's Y/);
    expect(p).toMatch(/Specificity is the whole game/);
  });

  it("gives the founder's numeric targets so rhythm is a target, not a vibe", () => {
    // Assert the TARGETS BLOCK, not the bare words: "rhythm" also appears in
    // the anti-slop constitution's rule 6, and /\d/ matches any digit anywhere
    // in the prompt — so the loose form passes with the block deleted.
    const p = buildDraftPrompt(base);
    expect(p).toContain("VOICE TARGETS");
    expect(p).toMatch(/sentence rhythm \(burstiness\): aim near \d+\.\d\d/);
    expect(p).toMatch(/average sentence: about \d+ words/);
  });

  it("passes killed posts, edit pairs and the never-say list as feedback", () => {
    const p = buildDraftPrompt(base);
    expect(p).toContain("Manual work is bad.");
    expect(p).toContain("We wired the two systems together.");
    // Not a bare toContain("leverage") — the edit pair's "before" text is
    // "We leveraged automation.", so that substring is present whether or not
    // the never-say list is rendered at all.
    expect(p).toContain("NEVER USE THESE WORDS OR PHRASES: leverage");
  });

  it("forbids any output other than the post body", () => {
    expect(buildDraftPrompt(base)).toMatch(/only the post|nothing else|no preamble/i);
  });

  it("separates its sections with blank lines", () => {
    // The prompt is assembled from an array where "" entries are the blank-line
    // spacers between sections. Filtering out every empty string to drop the
    // OMITTED optional sections also strips all of them, running every heading
    // onto the line below its predecessor.
    const p = buildDraftPrompt(base);
    expect(p).toContain("\n\nPOSITIONING:");
    expect(p).toContain("\n\nTHE BRIEF");
  });

  it("omits the samples and feedback sections when there is nothing to put in them", () => {
    const bare = buildDraftPrompt({
      ...base, samples: [], killedExamples: [], editPairs: [], neverSay: [],
    });
    expect(bare).not.toContain("HOW HE SOUNDS");
    expect(bare).not.toContain("POSTS HE KILLED");
    expect(bare).not.toContain("NEVER USE THESE");
    // ...and does not leave a run of blank lines where they would have been.
    expect(bare).not.toMatch(/\n{3,}/);
  });

  it("still carries the required sections with no optional feedback at all", () => {
    const bare = buildDraftPrompt({
      ...base, samples: [], killedExamples: [], editPairs: [], neverSay: [],
    });
    expect(bare).toContain("THE BRIEF");
    expect(bare).toContain("Reconciliation takes 14 hours every month end.");
    expect(bare).toMatch(/only the post|no preamble/i);
  });
});

describe("buildRevisePrompt", () => {
  const failures: EditorialCheck[] = [
    { rule: "ai-tells", passed: false, detail: 'negative parallelism — "It’s not X, it’s Y"' },
    { rule: "burstiness", passed: false, detail: "sentence rhythm is uniform (0.18 against your 0.55)" },
  ];

  it("quotes the draft and every named defect", () => {
    const p = buildRevisePrompt({ ...base, body: "It's not a tool, it's a mindset.", failures });
    expect(p).toContain("It's not a tool, it's a mindset.");
    expect(p).toContain("negative parallelism");
    expect(p).toContain("0.18");
  });

  it("tells the model to keep the claim and fix only the defects", () => {
    const p = buildRevisePrompt({ ...base, body: "x", failures });
    expect(p).toMatch(/same claim|keep the claim/i);
    expect(p).toMatch(/do not rewrite from scratch|only/i);
  });

  it("names every failure, not just the first", () => {
    const p = buildRevisePrompt({ ...base, body: "x", failures });
    expect(p).toContain("[ai-tells]");
    expect(p).toContain("[burstiness]");
  });

  it("carries the full draft brief through, so the revision keeps its constraints", () => {
    // The revise prompt is the draft prompt plus the defect list. If it were
    // only the defect list, the model would repair the named rules with no
    // memory of the claim, the anchor, the source records or the never-say
    // list — and could reintroduce a different violation while fixing this one.
    const p = buildRevisePrompt({ ...base, body: "x", failures });
    expect(p).toContain("Nobody owned the reconciliation");
    expect(p).toContain("Reconciliation takes 14 hours every month end.");
    expect(p).toMatch(/It's not X, it's Y/);
  });
});
