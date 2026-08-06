import { describe, it, expect } from "vitest";
import { collectCandidates, buildLedger, scoreItem } from "./harvest";
import type { MaterialItem } from "./types";
import type { DataShape } from "@/lib/types";
import type { ContentPost } from "./types";

function data(over: Partial<DataShape> = {}): DataShape {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
    painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
    positioningProfiles: [], contentThreads: [], brainThreads: [], newsFeed: [],
    newsInterests: [], newsBookmarks: [], notes: [], metricEntries: [],
    milestones: [], projectThreads: [],
    settings: {} as DataShape["settings"],
    ...over,
  } as DataShape;
}

const painPoint = {
  id: "pp1", createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
  painPoint: "Reconciliation takes 14 hours every month end.",
  industry: "Asset management", companyType: "Boutique", whoMentioned: "CFO",
  frequency: 3, workaround: "Two analysts and a spreadsheet.",
  possibleSolution: "", urgency: "high", willingnessToPay: "high", notes: "",
} as unknown as DataShape["painPoints"][number];

describe("collectCandidates", () => {
  it("pulls pain points with their anchors and pillar hints", () => {
    const items = collectCandidates(data({ painPoints: [painPoint] }));
    const item = items.find((i) => i.id === "pp1")!;
    expect(item.collection).toBe("painPoints");
    expect(item.anchors).toContain("14");
    expect(item.pillarHints).toContain("client-pain");
  });

  it("skips empty and whitespace-only fields", () => {
    const blank = { ...painPoint, id: "pp2", painPoint: "   ", workaround: "" };
    expect(collectCandidates(data({ painPoints: [blank] })).some((i) => i.id === "pp2")).toBe(false);
  });

  it("never harvests a metric entry, however far the value moved", () => {
    // metricEntries used to be emitted as "<metric> moved to <value> against a
    // recent average of <mean>", which publishes his commercial position
    // directly — the case that prompted the disclosure boundary was "MRR moved
    // to 0 against a recent average of 0". The number IS the disclosure, so
    // there is no filtering that rescues it; the collection is excluded.
    // A dramatic swing is used deliberately: this is the exact shape that used
    // to qualify as material, so the test would pass vacuously on a flat one.
    const base = (date: string, value: number) => ({
      id: `m-${date}`, createdAt: date, updatedAt: date,
      metric: "callsMade" as const, date, value,
    });
    const spike = [
      base("2026-07-29", 10), base("2026-07-30", 10),
      base("2026-08-03", 10), base("2026-08-04", 40),
    ];
    expect(collectCandidates(data({ metricEntries: spike as never }))).toHaveLength(0);
  });

  it("takes a completed milestone as build-log material, and ignores an incomplete one", () => {
    const milestone = (over: Record<string, unknown>) => ({
      id: "ms1", projectId: "pr1", name: "Reconciliation engine live",
      startDate: "2026-08-01", endDate: "2026-08-03", status: "done",
      order: 1, dependsOn: [], commitScope: "", notes: "",
      createdAt: "2026-08-03T00:00:00Z", updatedAt: "2026-08-03T00:00:00Z", ...over,
    });

    const done = collectCandidates(data({ milestones: [milestone({})] as never }));
    expect(done.some((i) => i.collection === "milestones" && i.id === "ms1")).toBe(true);
    expect(done.find((i) => i.id === "ms1")!.pillarHints).toContain("build-log");

    const planned = collectCandidates(data({ milestones: [milestone({ status: "planned" })] as never }));
    expect(planned.some((i) => i.collection === "milestones")).toBe(false);
  });
});

describe("scoreItem", () => {
  const item = (over: Partial<MaterialItem>): MaterialItem => ({
    collection: "painPoints", id: "x", date: "2026-08-04", text: "",
    anchors: [], pillarHints: [], score: 0, ...over,
  });

  it("rewards recency — the same material scores lower as it ages", () => {
    const text = "The reconciliation job ran overnight and finished on its own.";
    const fresh = scoreItem(item({ text, date: "2026-08-04" }), "2026-08-04");
    const older = scoreItem(item({ text, date: "2026-07-25" }), "2026-08-04");
    expect(fresh).toBeGreaterThan(older);
  });

  it("stops penalising age past twenty days rather than going negative", () => {
    const text = "The reconciliation job ran overnight and finished on its own.";
    const at25 = scoreItem(item({ text, date: "2026-07-10" }), "2026-08-04");
    const at90 = scoreItem(item({ text, date: "2026-05-06" }), "2026-08-04");
    expect(at25).toBe(at90);
  });

  it("does not reward distressed language over calm language", () => {
    // The inverse of what this file used to assert. A +12 "charge" bonus for
    // text matching broke|failed|wasted|lost|stuck|embarrass|missed|late
    // ranked his worst days highest, which is how the most exposing material
    // kept winning the day's slot. Same anchors and date on both sides, so
    // charge is the only variable that could separate them.
    const charged = scoreItem(item({ text: "It broke. I wasted the day, stuck again." }), "2026-08-04");
    const calm = scoreItem(item({ text: "It ran overnight and finished on its own." }), "2026-08-04");
    expect(charged).toBeLessThanOrEqual(calm);
  });

  it("ranks on specificity instead — anchors are what earn a post", () => {
    const anchored = scoreItem(item({ text: "Ran in 20 minutes.", anchors: ["20"] }), "2026-08-04");
    const vague = scoreItem(item({ text: "Ran much faster than before." }), "2026-08-04");
    expect(anchored).toBeGreaterThan(vague);
  });
});

describe("buildLedger", () => {
  const today = "2026-08-04";

  it("returns fresh mode when recent material exists", () => {
    const { items, mode } = buildLedger(data({ painPoints: [painPoint] }), [], today);
    expect(mode).toBe("fresh");
    expect(items.length).toBeGreaterThan(0);
  });

  it("excludes material used by a post inside the twenty-one day window", () => {
    const used = [{
      id: "p1", date: "2026-07-30", slot: 1, pillar: "client-pain", format: "scene",
      sourceRefs: [{ collection: "painPoints", id: "pp1", anchor: "14 hours" }],
      claim: "", body: "", openingLine: "", checks: [], revisions: 0,
      status: "posted", killReason: null, editedBody: null, createdAt: "", updatedAt: "",
    }] as ContentPost[];
    const { items } = buildLedger(data({ painPoints: [painPoint] }), used, today);
    expect(items.some((i) => i.id === "pp1")).toBe(false);
  });

  it("falls back to reachback when nothing is recent but older material is unused", () => {
    const old = { ...painPoint, id: "pp-old", createdAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z" };
    const { items, mode } = buildLedger(data({ painPoints: [old] }), [], today);
    expect(mode).toBe("reachback");
    expect(items.length).toBeGreaterThan(0);
  });

  it("falls back to news when there is no usable material at all", () => {
    expect(buildLedger(data(), [], today).mode).toBe("news");
  });

  it("ranks items carrying anchors above items without", () => {
    // The anchor-free item is deliberately the LONGER of the two — long enough
    // to max out the substance component — and both share a date, so the
    // anchor count is the only thing that can decide the order. An earlier
    // version of this test used a vague item of similar length, which meant it
    // passed on text length alone and would still have passed with the
    // specificity weight set to zero.
    const anchored = {
      ...painPoint, id: "pp-anchored", workaround: "",
      painPoint: "Cut 14 hours to 2 on 12 June, saving R120,000.",
    };
    const vague = {
      ...painPoint, id: "pp-vague", workaround: "",
      painPoint:
        "The team keeps saying the same thing about the process and everyone agrees " +
        "that it could be better in some way but nobody has written down what better " +
        "would look like or who would own it or when it would happen or what the first " +
        "step even is so it stays exactly where it has always been sitting quietly in " +
        "the background of every conversation that anyone has about it on any given week.",
    };
    const { items } = buildLedger(data({ painPoints: [anchored, vague] }), [], today);
    expect(items[0].id).toBe("pp-anchored");
  });
});
