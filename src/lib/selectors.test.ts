import { describe, it, expect } from "vitest";
import { allTimeMetrics, metricView, findMetricEntry, projectCounts, projectSeries } from "./selectors";
import type { Scorecard, Project, MetricEntry, MetricKey } from "@/lib/types";

function scorecard(over: Partial<Scorecard>): Scorecard {
  return {
    id: over.id ?? "s1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    date: over.date ?? "2026-07-01",
    dials: 0,
    emails: 0,
    linkedinMessages: 0,
    linkedinPosts: 0,
    replies: 0,
    conversations: 0,
    leadsCreated: 0,
    meetingsBooked: 0,
    proposalsSent: 0,
    productHours: 0,
    seoWork: "",
    revenueClosed: 0,
    wins: "",
    problems: "",
    lessons: "",
    avoidTomorrow: "",
    ...over,
  };
}

function project(over: Partial<Project>): Project {
  return {
    id: over.id ?? "p1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    name: over.name ?? "Proj",
    company: "Acme",
    type: over.type ?? "paid project",
    stage: over.stage ?? "idea",
    priority: "medium",
    startDate: null,
    dueDate: null,
    currentMilestone: "",
    currentBlocker: "",
    nextAction: "",
    deliverables: "",
    notes: "",
    ...over,
  };
}

function metricEntry(over: Partial<MetricEntry> & { metric: MetricKey; date: string; value: number }): MetricEntry {
  return {
    id: over.id ?? `${over.metric}-${over.date}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("allTimeMetrics", () => {
  it("sums scorecard counters across all days", () => {
    const m = allTimeMetrics(
      [
        scorecard({ id: "a", dials: 10, meetingsBooked: 2, linkedinPosts: 1, revenueClosed: 500 }),
        scorecard({ id: "b", dials: 5, meetingsBooked: 3, linkedinPosts: 4, revenueClosed: 1500 }),
      ],
      [],
    );
    expect(m.callsMade).toBe(15);
    expect(m.meetingsBooked).toBe(5);
    expect(m.linkedinPosts).toBe(5);
    expect(m.cashCollected).toBe(2000);
  });

  it("treats a missing linkedinPosts field as 0", () => {
    const legacy = scorecard({ id: "old", dials: 3 });
    // simulate a pre-migration row lacking the field
    delete (legacy as Partial<Scorecard>).linkedinPosts;
    const m = allTimeMetrics([legacy], []);
    expect(m.linkedinPosts).toBe(0);
    expect(m.callsMade).toBe(3);
  });

  it("classifies projects into built / pitched / waiting", () => {
    const m = allTimeMetrics(
      [],
      [
        project({ id: "1", stage: "idea", type: "research" }),      // none
        project({ id: "2", stage: "building", type: "paid project" }), // built
        project({ id: "3", stage: "sent", type: "paid project" }),  // built + pitched + waiting
        project({ id: "4", stage: "demo-ready", type: "demo" }),    // built + pitched + waiting
        project({ id: "5", stage: "closed", type: "paid project" }),// built + pitched
        project({ id: "6", stage: "discovery", type: "proposal" }), // pitched (by type only)
      ],
    );
    expect(m.projectsBuilt).toBe(4);       // ids 2,3,4,5
    expect(m.projectsPitched).toBe(4);     // ids 3,4,5 (stage) + 6 (type)
    expect(m.waitingForFeedback).toBe(2);  // ids 3,4
  });
});

describe("metricView", () => {
  it("returns 0 current and empty series when no entries", () => {
    const v = metricView([], "callsMade");
    expect(v.current).toBe(0);
    expect(v.series).toEqual([]);
  });

  it("current is the latest-dated entry; series is ascending by date and metric-filtered", () => {
    const entries: MetricEntry[] = [
      metricEntry({ metric: "callsMade", date: "2026-07-03", value: 30 }),
      metricEntry({ metric: "callsMade", date: "2026-07-01", value: 10 }),
      metricEntry({ metric: "callsMade", date: "2026-07-02", value: 20 }),
      metricEntry({ metric: "meetingsBooked", date: "2026-07-05", value: 99 }),
    ];
    const v = metricView(entries, "callsMade");
    expect(v.current).toBe(30);
    expect(v.series.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(v.series.map((p) => p.label)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });
});

describe("findMetricEntry", () => {
  const entries: MetricEntry[] = [
    metricEntry({ metric: "callsMade", date: "2026-07-01", value: 5 }),
    metricEntry({ metric: "callsMade", date: "2026-07-02", value: 8 }),
  ];
  it("finds the entry for a metric+date", () => {
    expect(findMetricEntry(entries, "callsMade", "2026-07-02")?.value).toBe(8);
  });
  it("returns undefined when absent", () => {
    expect(findMetricEntry(entries, "callsMade", "2026-07-09")).toBeUndefined();
    expect(findMetricEntry(entries, "meetingsBooked", "2026-07-01")).toBeUndefined();
  });
});

describe("projectCounts", () => {
  it("classifies built / pitched / waiting", () => {
    const c = projectCounts([
      project({ id: "1", stage: "idea", type: "research" }),
      project({ id: "2", stage: "building", type: "paid project" }),
      project({ id: "3", stage: "sent", type: "paid project" }),
      project({ id: "4", stage: "demo-ready", type: "demo" }),
      project({ id: "5", stage: "closed", type: "paid project" }),
      project({ id: "6", stage: "discovery", type: "proposal" }),
    ]);
    expect(c.built).toBe(4);
    expect(c.pitched).toBe(4);
    expect(c.waiting).toBe(2);
  });
});

describe("projectSeries", () => {
  it("cumulative count of qualifying projects, ascending by createdAt", () => {
    const s = projectSeries(
      [
        project({ id: "a", stage: "building", createdAt: "2026-05-10T00:00:00.000Z" }),
        project({ id: "b", stage: "idea", createdAt: "2026-05-11T00:00:00.000Z" }), // not built
        project({ id: "c", stage: "closed", createdAt: "2026-06-01T00:00:00.000Z" }),
      ],
      "built",
    );
    expect(s.map((p) => p.value)).toEqual([1, 2]);
    expect(s.map((p) => p.label)).toEqual(["2026-05-10", "2026-06-01"]);
  });

  it("empty when nothing qualifies", () => {
    expect(projectSeries([project({ id: "x", stage: "idea", type: "research" })], "built")).toEqual([]);
  });
});
