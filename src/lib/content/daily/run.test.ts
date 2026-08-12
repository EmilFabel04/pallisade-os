import { describe, it, expect, vi } from "vitest";
import { runDaily, preconditionCode } from "./run";
import type { DataShape } from "@/lib/types";
import type { ContentPost, PostBrief } from "./types";

const painPoint = {
  id: "pp1", createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
  painPoint: "Reconciliation takes 14 hours every month end.",
  industry: "Asset management", companyType: "Boutique", whoMentioned: "CFO",
  frequency: 3, workaround: "Two analysts and a spreadsheet.", possibleSolution: "",
  urgency: "high", willingnessToPay: "high", notes: "",
};

const scorecard = {
  id: "sc1", createdAt: "2026-08-02T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z",
  date: "2026-08-02", wins: "Shipped the ingest job in 3 days.",
  problems: "It broke twice on bad CSV rows.", lessons: "", avoidTomorrow: "",
};

function data(): DataShape {
  return {
    leads: [], interactions: [], projects: [], tasks: [],
    scorecards: [scorecard], painPoints: [painPoint], conversations: [],
    playbooks: [], targets: [], dialLists: [],
    positioningProfiles: [{ id: "pf1", name: "P", body: "We sell calm.", createdAt: "", updatedAt: "" }],
    contentThreads: [], brainThreads: [], newsFeed: [], newsInterests: [],
    newsBookmarks: [], notes: [], metricEntries: [], milestones: [], projectThreads: [],
    voiceSamples: [
      { id: "v1", text: "Shipped it Tuesday. The job that took 14 hours now takes 20 minutes and nobody watches it.", source: "linkedin", createdAt: "", updatedAt: "" },
      { id: "v2", text: "Nobody asked for a dashboard. They asked to stop doing the same thing every month.", source: "linkedin", createdAt: "", updatedAt: "" },
      { id: "v3", text: "Two systems already held the numbers. We wired them together in an afternoon.", source: "linkedin", createdAt: "", updatedAt: "" },
    ],
    voiceProfile: [],
    settings: {} as DataShape["settings"],
  } as unknown as DataShape;
}

const briefs: PostBrief[] = [
  { slot: 1, sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14" }],
    pillar: "client-pain", format: "scene", claim: "c1", anchor: "14", why: "w" },
  { slot: 2, sourceRefs: [{ collection: "scorecards", id: "sc1", anchor: "3" }],
    pillar: "build-log", format: "numbers", claim: "c2", anchor: "3", why: "w" },
];

const CLEAN =
  "Reconciliation took them 14 hours every month end.\n\n" +
  "Fourteen. For numbers two systems already held.\n\n" +
  "We wired them together in an afternoon and it runs unattended now. The finance lead was not relieved. He was embarrassed nobody had asked sooner.";

/**
 * Slot 2 cites the scorecard, not the pain point, so it needs its own body:
 * the gate's specificity check traces the post's anchors against the records
 * the brief actually cites. Handing both slots the same reconciliation body
 * makes slot 2 fail legitimately — the post would be talking about material it
 * did not cite — and every "clean run" assertion then silently tests the
 * revise path instead of the happy path.
 */
const CLEAN_BUILD =
  "We shipped the ingest job in 3 days.\n\n" +
  "It broke twice on bad CSV rows. Both times on a Friday.\n\n" +
  "The fix was smaller than the postmortem. That is usually how it goes, and it still surprises me every single time.";

/** A draft body appropriate to whichever brief is being written. */
const cleanFor = (brief: PostBrief) => (brief.slot === 1 ? CLEAN : CLEAN_BUILD);

type DraftArgs = [unknown, { brief: PostBrief; sourceTexts: string[] }];
type ReviseArgs = [
  unknown,
  // `detail` is part of every EditorialCheck and is what the revise stage
  // actually acts on — omitting it here hid it from these fixtures.
  {
    brief: PostBrief;
    body: string;
    failures: { rule: string; passed: boolean; detail: string }[];
  },
];

function deps(over: Partial<Parameters<typeof runDaily>[0]> = {}) {
  return {
    data: data(),
    today: "2026-08-04",
    client: {} as never,
    chooseBriefs: vi.fn(async () => briefs),
    draftPost: vi.fn(async (...args: DraftArgs) => cleanFor(args[1].brief)),
    revisePost: vi.fn(async (...args: ReviseArgs) => cleanFor(args[1].brief)),
    loadRecentPosts: vi.fn(async () => [] as ContentPost[]),
    persist: vi.fn(async (..._args: [ContentPost[], { status: string; error: string | null }]) => {}),
    ...over,
  };
}

describe("runDaily", () => {
  it("produces two posts and an ok run", async () => {
    const d = deps();
    const { run, posts } = await runDaily(d);
    expect(posts).toHaveLength(2);
    expect(run.status).toBe("ok");
    expect(run.ledgerSize).toBeGreaterThan(0);
    expect(d.persist).toHaveBeenCalledOnce();
  });

  it("stamps each post with its brief's pillar, format, claim and sources", async () => {
    const { posts } = await runDaily(deps());
    expect(posts[0].pillar).toBe("client-pain");
    expect(posts[1].format).toBe("numbers");
    expect(posts[0].sourceRefs[0].id).toBe("pp1");
    expect(posts[0].openingLine.length).toBeGreaterThan(0);
  });

  it("revises a failing draft and records the revision count", async () => {
    const bad = "It's not a tool, it's a mindset.\nDelve into it.\nLet that sink in.";
    const draftPost = vi.fn(async (..._a: DraftArgs) => bad);
    const revisePost = vi.fn(async (...a: ReviseArgs) => cleanFor(a[1].brief));
    const { posts } = await runDaily(deps({ draftPost, revisePost }));
    expect(revisePost).toHaveBeenCalled();
    expect(posts[0].revisions).toBeGreaterThan(0);
    expect(posts[0].status).toBe("draft");
  });

  it("gives up after two revisions and marks the post needs_work", async () => {
    const bad = "It's not a tool, it's a mindset.\nDelve into it.\nLet that sink in.";
    const revisePost = vi.fn(async (..._a: ReviseArgs) => bad);
    const { posts } = await runDaily(deps({ draftPost: async () => bad, revisePost }));
    expect(posts[0].status).toBe("needs_work");
    expect(posts[0].revisions).toBe(2);
    expect(posts[0].checks.some((c) => !c.passed)).toBe(true);
  });

  describe("the disclosure boundary", () => {
    /**
     * A founder with a real client on file AND that client's name written into
     * the notes of the pain point the brief actually cites.
     *
     * Both halves are load-bearing. The lead record alone only populates the
     * vocabulary; it is never harvested for its company field, and the brief
     * cites pp1, not the lead — so a name that lives only on the lead never
     * reaches a prompt and every redaction assertion below would pass without
     * redaction existing at all. Writing the client's name into a cited
     * record's notes is also what actually happens in practice.
     */
    function withLead() {
      const d = data();
      (d.leads as unknown as Record<string, unknown>[]).push({
        id: "l1", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
        company: "Kestrelmoor Capital", contactName: "Sarah Whitfield",
        painPoint: "", objection: "", buyingSignal: "", notes: "",
      });
      (d.painPoints as unknown as Record<string, unknown>[])[0].notes =
        "Kestrelmoor Capital — Sarah Whitfield says they still do it by hand.";
      return d;
    }

    it("never lets a post naming a client through as a clean draft", async () => {
      // The end-to-end guarantee. A real client name TRACES against its source
      // record, so checkSpecificity passes it — this is exactly the post that
      // used to reach him looking finished.
      const named =
        "Kestrelmoor Capital took 14 hours every month end on reconciliation.\n\n" +
        "For numbers two systems already held.\n\n" +
        "We wired them together in an afternoon and it runs unattended now. Nobody " +
        "had thought to ask before, which is the part that still surprises me.";
      const { posts } = await runDaily(
        deps({ data: withLead(), draftPost: async () => named, revisePost: async () => named }),
      );
      expect(posts[0].status).toBe("needs_work");
      const disclosure = posts[0].checks.find((c) => c.rule === "disclosure")!;
      expect(disclosure.passed).toBe(false);
      expect(disclosure.detail).toMatch(/Kestrelmoor Capital/);
    });

    it("sends the disclosure failure back to the revise stage with the name in it", async () => {
      // The revise stage can only fix what it is told. A generic "rejected"
      // leaves the model guessing which detail was the problem.
      const named = "Kestrelmoor Capital still reconciles 14 hours by hand every month end.";
      const revisePost = vi.fn(async (...a: ReviseArgs) => cleanFor(a[1].brief));
      await runDaily(deps({ data: withLead(), draftPost: async () => named, revisePost }));

      const failures = revisePost.mock.calls[0][1].failures;
      expect(failures.some((f) => f.rule === "disclosure")).toBe(true);
      expect(failures.find((f) => f.rule === "disclosure")!.detail).toMatch(/Kestrelmoor Capital/);
    });

    it("strips client names out of the source texts handed to the draft stage", async () => {
      // Redaction happens at harvest, so the model is never shown the name at
      // all — the structural half of the guarantee, independent of the gate.
      const draftPost = vi.fn(async (...a: DraftArgs) => cleanFor(a[1].brief));
      await runDaily(deps({ data: withLead(), draftPost }));

      const everySourceText = draftPost.mock.calls
        .flatMap((c) => c[1].sourceTexts)
        .join(" ");
      expect(everySourceText).not.toMatch(/Kestrelmoor/i);
      expect(everySourceText).not.toMatch(/Whitfield/i);
    });

    it("keeps a post that is specific about a client without naming them", async () => {
      // The boundary must not be so wide that nothing survives it: CLEAN is
      // anchored on a real figure and passes with the vocabulary populated.
      const { posts } = await runDaily(deps({ data: withLead() }));
      expect(posts[0].checks.find((c) => c.rule === "disclosure")!.passed).toBe(true);
      expect(posts[0].status).toBe("draft");
    });
  });

  it("marks the run thin when the ledger had to reach back", async () => {
    const old = data();
    (old.painPoints as unknown as { updatedAt: string }[])[0].updatedAt = "2026-05-01T00:00:00Z";
    (old.painPoints as unknown as { createdAt: string }[])[0].createdAt = "2026-05-01T00:00:00Z";
    (old.scorecards as unknown as { date: string }[])[0].date = "2026-05-02";
    const { run } = await runDaily(deps({ data: old }));
    expect(run.reachback).toBe(true);
    expect(run.status).toBe("thin");
  });

  it("completes, and says so, when the rotation windows were exhausted", async () => {
    // 2026-08-12 in production: two posts on 08-11 and four on 08-10 put every
    // pillar and every format inside its window, the brief stage was handed an
    // unsatisfiable constraint set, and the run died as brief_invalid → 502.
    // It must now finish, and must not pretend the rotation was respected.
    const history: ContentPost[] = [
      ["a", "2026-08-11", "proof", "numbers"],
      ["b", "2026-08-11", "build-log", "short-punch"],
      ["c", "2026-08-10", "client-pain", "claim-defence"],
      ["d", "2026-08-10", "contrarian", "one-idea"],
      ["e", "2026-08-10", "teardown", "before-after"],
      ["f", "2026-08-10", "lesson", "scene"],
    ].map(([id, date, pillar, format]) => ({
      id, date, slot: 1, pillar, format, sourceRefs: [], claim: "", body: "",
      openingLine: "An opener.", checks: [], revisions: 0, status: "posted",
      killReason: null, editedBody: null, createdAt: "", updatedAt: "",
    })) as ContentPost[];

    const { run, posts } = await runDaily(deps({
      today: "2026-08-12",
      loadRecentPosts: vi.fn(async () => history),
    }));

    expect(posts).toHaveLength(2);
    expect(run.status).toBe("thin");
    expect(run.degraded.join(" ")).toMatch(/rotation/i);
  });

  it("says nothing about rotation on a day that did not need relaxing", async () => {
    const { run } = await runDaily(deps());
    expect(run.degraded.join(" ")).not.toMatch(/rotation/i);
  });

  it("refuses to run with fewer than three voice samples", async () => {
    const thin = data();
    thin.voiceSamples = thin.voiceSamples.slice(0, 2);
    await expect(runDaily(deps({ data: thin }))).rejects.toThrow(/voice_samples/);
  });

  it("refuses to run with no positioning profile", async () => {
    const none = data();
    none.positioningProfiles = [];
    await expect(runDaily(deps({ data: none }))).rejects.toThrow(/positioning/);
  });

  it("persists a failed run and rethrows when a stage throws", async () => {
    const persist = vi.fn(async (..._a: [ContentPost[], { status: string; error: string | null }]) => {});
    const chooseBriefs = vi.fn(async () => { throw new Error("brief_invalid: nope"); });
    await expect(runDaily(deps({ chooseBriefs, persist }))).rejects.toThrow(/brief_invalid/);
    const run = persist.mock.calls[0][1];
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/brief_invalid/);
  });

  it("derives openingLine with firstLine, not the first sentence", async () => {
    // run.ts is the only PRODUCER of openingLine; gate.ts's checkOpener and
    // rotation.ts's buildMemory are the consumers, and both reason in terms of
    // the whole first LINE. A two-sentence opening line written as only its
    // first sentence would never collide with its own stored opener — the
    // repetition guard silently passing.
    const twoSentenceOpener =
      "Reconciliation took 14 hours. That was absurd.\n\n" +
      "Two systems already held the numbers. We wired them together in an afternoon.\n\n" +
      "It runs unattended now, and the finance lead was embarrassed nobody had asked sooner.";
    const { posts } = await runDaily(deps({ draftPost: async () => twoSentenceOpener }));
    expect(posts[0].openingLine).toBe("Reconciliation took 14 hours. That was absurd.");
  });

  it("passes each brief only the source texts its own refs point at", async () => {
    const draftPost = vi.fn(async (...a: DraftArgs) => cleanFor(a[1].brief));
    await runDaily(deps({ draftPost }));
    const slot1 = draftPost.mock.calls[0][1];
    const slot2 = draftPost.mock.calls[1][1];
    expect(slot1.sourceTexts.join(" ")).toContain("Reconciliation takes 14 hours");
    expect(slot1.sourceTexts.join(" ")).not.toContain("ingest job");
    expect(slot2.sourceTexts.join(" ")).toContain("ingest job");
  });

  it("feeds the gate's named failures into the revise call", async () => {
    const bad = "It's not a tool, it's a mindset.\nDelve into it.\nLet that sink in.";
    const revisePost = vi.fn(async (...a: ReviseArgs) => cleanFor(a[1].brief));
    await runDaily(deps({ draftPost: async () => bad, revisePost }));
    const arg = revisePost.mock.calls[0][1];
    expect(arg.body).toBe(bad);
    expect(arg.failures.length).toBeGreaterThan(0);
    expect(arg.failures.every((f) => !f.passed)).toBe(true);
    expect(arg.failures.map((f) => f.rule)).toContain("ai-tells");
  });

  it("does not revise a draft that passes the gate first time", async () => {
    const revisePost = vi.fn(async (...a: ReviseArgs) => cleanFor(a[1].brief));
    const { posts } = await runDaily(deps({ revisePost }));
    expect(revisePost).not.toHaveBeenCalled();
    expect(posts[0].revisions).toBe(0);
  });

  it("prefers the stored voice profile over recomputing from samples", async () => {
    const withProfile = data();
    (withProfile.voiceProfile as unknown[]).push({
      id: "vp1", createdAt: "", updatedAt: "",
      stats: {
        burstiness: 0.9, avgSentenceLength: 7, shortSentenceRatio: 0.6,
        contractionRate: 3, questionRate: 0, avgParagraphSentences: 1.4,
        emojiPerPost: 0, firstPersonRate: 4,
      },
      fingerprint: "Blunt, concrete, allergic to abstraction.",
      neverSay: ["leverage"], sampleCount: 3, computedAt: "",
    });
    const draftPost = vi.fn(async (...a: DraftArgs) => cleanFor(a[1].brief));
    await runDaily(deps({ data: withProfile, draftPost }));
    const arg = draftPost.mock.calls[0][1] as unknown as {
      stats: { burstiness: number }; fingerprint: string; neverSay: string[];
    };
    expect(arg.stats.burstiness).toBe(0.9);
    expect(arg.fingerprint).toContain("allergic to abstraction");
    expect(arg.neverSay).toEqual(["leverage"]);
  });

  it("caps the never-say list at sixty entries", async () => {
    const many = data();
    (many.voiceProfile as unknown[]).push({
      id: "vp1", createdAt: "", updatedAt: "",
      stats: {
        burstiness: 0.5, avgSentenceLength: 9, shortSentenceRatio: 0.5,
        contractionRate: 2, questionRate: 0, avgParagraphSentences: 1.5,
        emojiPerPost: 0, firstPersonRate: 3,
      },
      fingerprint: "f",
      neverSay: Array.from({ length: 80 }, (_, i) => `phrase${i}`),
      sampleCount: 3, computedAt: "",
    });
    const draftPost = vi.fn(async (...a: DraftArgs) => cleanFor(a[1].brief));
    await runDaily(deps({ data: many, draftPost }));
    const arg = draftPost.mock.calls[0][1] as unknown as { neverSay: string[] };
    expect(arg.neverSay).toHaveLength(60);
  });

  it("gives the gate the cited record's full text, not just the ref anchor", async () => {
    // The gate traces the post's anchors against sourceTexts, falling back to
    // the SourceRef anchors. Handing it an empty sourceTexts still "works" for
    // a detail that happens to equal the ref anchor, so the weakening is
    // invisible unless the post carries a detail that lives in the record but
    // not in the ref. R120,000 is exactly that — and it is a currency figure,
    // so an untraced one fails the fabrication policy outright.
    const withFigure = data();
    (withFigure.painPoints as unknown as { notes: string }[])[0].notes =
      "They quoted R120,000 a year in analyst time.";

    const body =
      "Reconciliation took them 14 hours every month end.\n\n" +
      "That is R120,000 a year in analyst time. For numbers two systems already held.\n\n" +
      "We wired the two systems together in a single afternoon and the whole thing has run unattended ever since without anyone watching it. Nobody noticed.";

    const { posts } = await runDaily(
      deps({ data: withFigure, draftPost: async () => body }),
    );
    const specificity = posts[0].checks.find((c) => c.rule === "specificity")!;
    expect(specificity.passed).toBe(true);
    expect(posts[0].status).toBe("draft");
    // Load-bearing: `checks` holds the FINAL round's result, so a draft that
    // failed and was then rescued by a revision also ends with a passing
    // specificity check. Only revisions === 0 proves it passed on the way in.
    expect(posts[0].revisions).toBe(0);
  });

  it("does not persist any posts when a stage throws", async () => {
    const persist = vi.fn(async (..._a: [ContentPost[], { status: string; error: string | null }]) => {});
    const draftPost = vi.fn(async () => { throw new Error("upstream_failed: boom"); });
    await expect(runDaily(deps({ draftPost, persist }))).rejects.toThrow(/upstream_failed/);
    expect(persist.mock.calls[0][0]).toEqual([]);
  });
});

describe("preconditionCode", () => {
  it("recognises the setup failures the founder can fix", () => {
    expect(preconditionCode("voice_samples: need 3 writing samples, have 0")).toBe("voice_samples");
    expect(preconditionCode("positioning: no positioning profile saved")).toBe("positioning");
  });

  it("returns null for real failures, so they stay upstream_failed", () => {
    expect(preconditionCode("brief_invalid: slot 1 pillar clash")).toBeNull();
    expect(preconditionCode("fingerprint_failed: model did not call the tool")).toBeNull();
    expect(preconditionCode("Connection terminated unexpectedly")).toBeNull();
    expect(preconditionCode("")).toBeNull();
  });

  it("matches the prefix, not a mention anywhere in the message", () => {
    // An upstream error that merely quotes the word must not be reclassified
    // as a founder-fixable precondition.
    expect(preconditionCode("upstream error mentioning voice_samples: nope")).toBeNull();
  });

  it("covers every message runDaily actually throws for a precondition", async () => {
    // Pins the two together: renaming a thrown prefix without updating
    // PRECONDITION_CODES would silently downgrade it to a 502.
    const thin = data();
    thin.voiceSamples = thin.voiceSamples.slice(0, 2);
    await expect(runDaily(deps({ data: thin }))).rejects.toSatisfy(
      (e: Error) => preconditionCode(e.message) === "voice_samples",
    );

    const none = data();
    none.positioningProfiles = [];
    await expect(runDaily(deps({ data: none }))).rejects.toSatisfy(
      (e: Error) => preconditionCode(e.message) === "positioning",
    );
  });
});

describe("rotation across days", () => {
  it("blocks yesterday's pillars, formats and sources on today's run", async () => {
    // Task 18 Step 3, made deterministic. Day one's posts become day two's
    // history; this pins the whole wiring — recentPosts -> buildMemory ->
    // chooseBriefs, and recentPosts -> buildLedger's used-source filter —
    // rather than re-testing validateBriefs, which rotation.test.ts covers.
    const day1 = await runDaily(deps());
    expect(day1.posts.map((p) => p.pillar)).toEqual(["client-pain", "build-log"]);

    const chooseBriefsSpy = vi.fn(async (..._a: unknown[]) => briefs);
    await runDaily(
      deps({
        today: "2026-08-05",
        loadRecentPosts: async () => day1.posts,
        chooseBriefs: chooseBriefsSpy as unknown as Parameters<typeof runDaily>[0]["chooseBriefs"],
      }),
    ).catch(() => {
      /* the stub returns the same briefs, which the gate may reject; the
         assertions below are about what chooseBriefs was HANDED. */
    });

    const memory = (chooseBriefsSpy.mock.calls[0] as unknown[])[2] as {
      recentPillars: Map<string, string>;
      recentFormats: Map<string, string>;
      recentSources: Map<string, string>;
      recentOpeners: string[];
    };
    expect([...memory.recentPillars.keys()].sort()).toEqual(["build-log", "client-pain"]);
    expect([...memory.recentFormats.keys()].sort()).toEqual(["numbers", "scene"]);
    expect([...memory.recentSources.keys()].sort()).toEqual(["painPoints:pp1", "scorecards:sc1"]);
    expect(memory.recentOpeners).toHaveLength(2);

    // And the same history removes those records from the material ledger, so
    // the model is not even offered them.
    const ledger = ((chooseBriefsSpy.mock.calls[0] as unknown[])[1] as {
      ledger: { collection: string; id: string }[];
    }).ledger;
    expect(ledger.some((i) => i.collection === "painPoints" && i.id === "pp1")).toBe(false);
    expect(ledger.some((i) => i.collection === "scorecards" && i.id === "sc1")).toBe(false);
  });
});
