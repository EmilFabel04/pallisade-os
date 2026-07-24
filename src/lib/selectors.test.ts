import { describe, it, expect } from "vitest";
import type { Scorecard, Project } from "@/lib/types";
import { allTimeMetrics } from "./selectors";

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
