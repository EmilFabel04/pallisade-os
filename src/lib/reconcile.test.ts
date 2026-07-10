import { describe, it, expect } from "vitest";
import { reconcileFollowUps } from "@/lib/reconcile";
import type { DataShape, Lead, Task } from "@/lib/types";

const lead = (over: Partial<Lead>): Lead =>
  ({ id: "l1", nextFollowUp: null, ...over }) as Lead;

const followUpTask = (over: Partial<Task>): Task =>
  ({
    id: "t1",
    linkKind: "lead",
    linkId: "l1",
    category: "follow-up",
    status: "not started",
    dueDate: "2026-07-20",
    ...over,
  }) as Task;

const shape = (leads: Lead[], tasks: Task[]): DataShape =>
  ({ leads, tasks }) as unknown as DataShape;

describe("reconcileFollowUps", () => {
  it("backfills an empty nextFollowUp from an open follow-up task", () => {
    const out = reconcileFollowUps(shape([lead({})], [followUpTask({})]));
    expect(out.leads[0].nextFollowUp).toBe("2026-07-20");
  });

  it("uses the earliest open follow-up task when several exist", () => {
    const out = reconcileFollowUps(
      shape(
        [lead({})],
        [
          followUpTask({ id: "t1", dueDate: "2026-08-01" }),
          followUpTask({ id: "t2", dueDate: "2026-07-15" }),
          followUpTask({ id: "t3", dueDate: "2026-09-10" }),
        ],
      ),
    );
    expect(out.leads[0].nextFollowUp).toBe("2026-07-15");
  });

  it("never overwrites an existing nextFollowUp", () => {
    const out = reconcileFollowUps(
      shape([lead({ nextFollowUp: "2026-07-01" })], [followUpTask({ dueDate: "2026-07-20" })]),
    );
    expect(out.leads[0].nextFollowUp).toBe("2026-07-01");
  });

  it("ignores done tasks, non-follow-up categories, and unlinked tasks", () => {
    const out = reconcileFollowUps(
      shape(
        [lead({})],
        [
          followUpTask({ id: "t1", status: "done" }),
          followUpTask({ id: "t2", category: "sales" }),
          followUpTask({ id: "t3", linkKind: "none", linkId: null }),
          followUpTask({ id: "t4", dueDate: null }),
        ],
      ),
    );
    expect(out.leads[0].nextFollowUp).toBeNull();
  });

  it("returns the same reference when nothing changes (idempotent)", () => {
    const input = shape([lead({ nextFollowUp: "2026-07-01" })], []);
    expect(reconcileFollowUps(input)).toBe(input);
  });
});
