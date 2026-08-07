import { describe, it, expect } from "vitest";
import { reconcileFollowUps, reconcileProjects } from "@/lib/reconcile";
import type { DataShape, Lead, Project, Task } from "@/lib/types";

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

function shape(over: Partial<DataShape>): DataShape {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
    painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
    positioningProfiles: [], contentThreads: [], brainThreads: [], newsFeed: [],
    newsInterests: [], newsBookmarks: [], notes: [], metricEntries: [],
    milestones: [], projectThreads: [], voiceSamples: [], voiceProfile: [],
    settings: {} as DataShape["settings"],
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    name: "Acme Dashboard", company: "Acme", type: "paid project", stage: "building",
    priority: "high", startDate: "2026-07-01", dueDate: "2026-08-15",
    currentMilestone: "Build the ingest pipeline", currentBlocker: "", nextAction: "",
    deliverables: "", notes: "", repoPath: null, repoSlug: null,
    ...over,
  };
}

describe("reconcileFollowUps", () => {
  it("backfills an empty nextFollowUp from an open follow-up task", () => {
    const out = reconcileFollowUps(shape({ leads: [lead({})], tasks: [followUpTask({})] }));
    expect(out.leads[0].nextFollowUp).toBe("2026-07-20");
  });

  it("uses the earliest open follow-up task when several exist", () => {
    const out = reconcileFollowUps(
      shape({
        leads: [lead({})],
        tasks: [
          followUpTask({ id: "t1", dueDate: "2026-08-01" }),
          followUpTask({ id: "t2", dueDate: "2026-07-15" }),
          followUpTask({ id: "t3", dueDate: "2026-09-10" }),
        ],
      }),
    );
    expect(out.leads[0].nextFollowUp).toBe("2026-07-15");
  });

  it("never overwrites an existing nextFollowUp", () => {
    const out = reconcileFollowUps(
      shape({ leads: [lead({ nextFollowUp: "2026-07-01" })], tasks: [followUpTask({ dueDate: "2026-07-20" })] }),
    );
    expect(out.leads[0].nextFollowUp).toBe("2026-07-01");
  });

  it("ignores done tasks, non-follow-up categories, and unlinked tasks", () => {
    const out = reconcileFollowUps(
      shape({
        leads: [lead({})],
        tasks: [
          followUpTask({ id: "t1", status: "done" }),
          followUpTask({ id: "t2", category: "sales" }),
          followUpTask({ id: "t3", linkKind: "none", linkId: null }),
          followUpTask({ id: "t4", dueDate: null }),
        ],
      }),
    );
    expect(out.leads[0].nextFollowUp).toBeNull();
  });

  it("returns the same reference when nothing changes (idempotent)", () => {
    const input = shape({ leads: [lead({ nextFollowUp: "2026-07-01" })] });
    expect(reconcileFollowUps(input)).toBe(input);
  });
});

describe("reconcileProjects", () => {
  it("creates one milestone from the legacy currentMilestone string", () => {
    const out = reconcileProjects(shape({ projects: [project()] }));
    expect(out.milestones).toHaveLength(1);
    expect(out.milestones[0]).toMatchObject({
      projectId: "p1",
      name: "Build the ingest pipeline",
      status: "in progress",
      order: 0,
      startDate: "2026-07-01",
      endDate: "2026-08-15",
      dependsOn: [],
      commitScope: "",
    });
  });

  it("blanks currentMilestone so a second run is a no-op", () => {
    const first = reconcileProjects(shape({ projects: [project()] }));
    expect(first.projects[0].currentMilestone).toBe("");
    const second = reconcileProjects(first);
    expect(second.milestones).toHaveLength(1);
  });

  it("skips a project that already has milestones", () => {
    const existing = {
      id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Existing",
      startDate: null, endDate: null, status: "planned" as const, order: 0,
      dependsOn: [], commitScope: "", notes: "",
    };
    const out = reconcileProjects(shape({ projects: [project()], milestones: [existing] }));
    expect(out.milestones).toHaveLength(1);
    expect(out.milestones[0].name).toBe("Existing");
  });

  it("skips a project with an empty currentMilestone", () => {
    const out = reconcileProjects(shape({ projects: [project({ currentMilestone: "" })] }));
    expect(out.milestones).toHaveLength(0);
  });

  it("returns the same object when nothing needs migrating", () => {
    const input = shape({ projects: [project({ currentMilestone: "" })] });
    expect(reconcileProjects(input)).toBe(input);
  });

  it("does not throw and skips a project missing currentMilestone entirely", () => {
    // `currentMilestone` is non-optional on `Project`, so this cast is the point:
    // it simulates exactly the untyped/historical/restored data this migration
    // exists to handle (see Finding 1). Do not "fix" the cast away — a project
    // object built without the field is what a restored/foreign payload looks
    // like at runtime, even though the compiler otherwise guarantees it here.
    const { currentMilestone: _omitted, ...rest } = project();
    const malformed = rest as Project;

    expect(() => reconcileProjects(shape({ projects: [malformed] }))).not.toThrow();
    const out = reconcileProjects(shape({ projects: [malformed] }));
    expect(out.milestones).toHaveLength(0);
  });
});
