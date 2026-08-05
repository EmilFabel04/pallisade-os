import { describe, it, expect, vi } from "vitest";
import { runDaily } from "./run";
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
  { brief: PostBrief; body: string; failures: { rule: string; passed: boolean }[] },
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

  it("marks the run thin when the ledger had to reach back", async () => {
    const old = data();
    (old.painPoints as unknown as { updatedAt: string }[])[0].updatedAt = "2026-05-01T00:00:00Z";
    (old.painPoints as unknown as { createdAt: string }[])[0].createdAt = "2026-05-01T00:00:00Z";
    (old.scorecards as unknown as { date: string }[])[0].date = "2026-05-02";
    const { run } = await runDaily(deps({ data: old }));
    expect(run.reachback).toBe(true);
    expect(run.status).toBe("thin");
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
