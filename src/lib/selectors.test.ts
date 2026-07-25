import { describe, it, expect } from "vitest";
import { metricView, findMetricEntry, projectCounts } from "./selectors";
import type { Project, MetricEntry, MetricKey } from "@/lib/types";

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
