import { describe, it, expect } from "vitest";
import { tomorrowPlan } from "@/lib/plan/tomorrow";
import type { Task } from "@/lib/types";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1", title: "Ship the thing", category: "delivery", priority: "high",
  status: "not started", dueDate: "2026-08-14", notes: "", linkKind: "none",
  linkId: null, milestoneId: null, createdAt: "", updatedAt: "", ...over,
});

describe("tomorrowPlan", () => {
  it("leads with due follow-ups when there are any", () => {
    const p = tomorrowPlan({ scorecard: null, openTasks: [], dueFollowUps: 3 });
    expect(p.priorities[0]).toMatch(/3 follow-ups/);
  });

  it("singularises a single follow-up", () => {
    const p = tomorrowPlan({ scorecard: null, openTasks: [], dueFollowUps: 1 });
    expect(p.priorities[0]).toMatch(/1 follow-up\b/);
    expect(p.priorities[0]).not.toMatch(/follow-ups/);
  });

  it("surfaces the earliest-due high-priority open task", () => {
    const p = tomorrowPlan({
      scorecard: null, dueFollowUps: 0,
      openTasks: [task({ id: "a", title: "Later", dueDate: "2026-09-01" }),
                  task({ id: "b", title: "Sooner", dueDate: "2026-08-14" })],
    });
    expect(p.priorities.some((s) => s.includes("Sooner"))).toBe(true);
  });

  it("ignores done tasks", () => {
    const p = tomorrowPlan({
      scorecard: null, dueFollowUps: 0,
      openTasks: [task({ title: "Finished", status: "done" })],
    });
    expect(p.priorities.some((s) => s.includes("Finished"))).toBe(false);
  });

  it("always returns exactly three priorities", () => {
    expect(tomorrowPlan({ scorecard: null, openTasks: [], dueFollowUps: 0 }).priorities).toHaveLength(3);
    expect(tomorrowPlan({ scorecard: null, openTasks: [task()], dueFollowUps: 5 }).priorities).toHaveLength(3);
  });
});
