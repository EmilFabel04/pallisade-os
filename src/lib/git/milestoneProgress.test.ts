import { describe, it, expect } from "vitest";
import { matchCommits } from "./milestoneProgress";
import type { Commit } from "./types";
import type { Milestone } from "@/lib/types";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "M",
    startDate: "2026-07-01", endDate: "2026-07-15", status: "planned",
    order: 0, dependsOn: [], commitScope: "", notes: "",
    ...over,
  };
}

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: "abc", shortHash: "abc", subject: "chore: tidy", body: "",
    authorDate: "2026-07-05T10:00:00+02:00", files: [],
    ...over,
  };
}

describe("matchCommits — scope matching", () => {
  it("matches conventional-commit scope", () => {
    const m = milestone({ id: "m1", commitScope: "gantt" });
    const commits = [
      commit({ hash: "1", subject: "feat(gantt): add bars" }),
      commit({ hash: "2", subject: "fix(git): counts" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")!.map((c) => c.hash)).toEqual(["1"]);
  });

  it("matches bracket scope and a breaking-change bang", () => {
    const m = milestone({ id: "m1", commitScope: "gantt" });
    const commits = [
      commit({ hash: "1", subject: "[gantt] tweak the ruler" }),
      commit({ hash: "2", subject: "feat(gantt)!: drop the old axis" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    const m = milestone({ id: "m1", commitScope: "Gantt" });
    expect(matchCommits([commit({ subject: "feat(gantt): x" })], [m]).get("m1")).toHaveLength(1);
  });

  it("does not match a bare substring outside a scope", () => {
    const m = milestone({ id: "m1", commitScope: "gantt" });
    expect(matchCommits([commit({ subject: "docs: describe the gantt" })], [m]).get("m1")).toEqual([]);
  });

  it("ignores dates entirely when a scope is set", () => {
    const m = milestone({ id: "m1", commitScope: "gantt", startDate: "2026-01-01", endDate: "2026-01-02" });
    expect(matchCommits([commit({ subject: "feat(gantt): x" })], [m]).get("m1")).toHaveLength(1);
  });
});

describe("matchCommits — date-range fallback", () => {
  it("matches commits inside the range", () => {
    const m = milestone({ id: "m1" }); // 2026-07-01 → 2026-07-15
    const commits = [
      commit({ hash: "in", authorDate: "2026-07-05T10:00:00+02:00" }),
      commit({ hash: "before", authorDate: "2026-06-30T23:59:00+02:00" }),
      commit({ hash: "after", authorDate: "2026-07-16T00:01:00+02:00" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")!.map((c) => c.hash)).toEqual(["in"]);
  });

  it("includes both boundary dates", () => {
    const m = milestone({ id: "m1" });
    const commits = [
      commit({ hash: "start", authorDate: "2026-07-01T00:00:00+02:00" }),
      commit({ hash: "end", authorDate: "2026-07-15T23:59:00+02:00" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")).toHaveLength(2);
  });

  it("matches nothing for a milestone missing either date", () => {
    const result = matchCommits([commit()], [
      milestone({ id: "a", startDate: null }),
      milestone({ id: "b", endDate: null }),
    ]);
    expect(result.get("a")).toEqual([]);
    expect(result.get("b")).toEqual([]);
  });
});

describe("matchCommits — general", () => {
  it("lets one commit match two overlapping milestones", () => {
    const result = matchCommits([commit({ hash: "x" })], [
      milestone({ id: "a", startDate: "2026-07-01", endDate: "2026-07-10" }),
      milestone({ id: "b", startDate: "2026-07-03", endDate: "2026-07-20" }),
    ]);
    expect(result.get("a")).toHaveLength(1);
    expect(result.get("b")).toHaveLength(1);
  });

  it("returns an entry for every milestone, even empty ones", () => {
    const result = matchCommits([], [milestone({ id: "a" }), milestone({ id: "b" })]);
    expect([...result.keys()].sort()).toEqual(["a", "b"]);
  });
});
