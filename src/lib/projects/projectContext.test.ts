import { describe, it, expect } from "vitest";
import { formatProjectContext, CONTEXT_BUDGET } from "./projectContext";
import type { Milestone, Project, ProjectThread, Task } from "@/lib/types";

const project: Project = {
  id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
  type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
  dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "Waiting on API creds",
  nextAction: "Chase Sam", deliverables: "Dashboard + handover", notes: "", repoPath: null,
};

const milestone: Milestone = {
  id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest pipeline",
  startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
  order: 0, dependsOn: [], commitScope: "", notes: "",
};

const task: Task = {
  id: "t1", createdAt: "", updatedAt: "", title: "Auth handshake", linkKind: "project",
  linkId: "p1", milestoneId: "m1", category: "delivery", priority: "high",
  status: "in progress", dueDate: null, notes: "",
};

const thread: ProjectThread = {
  id: "th1", createdAt: "", updatedAt: "2026-07-28T10:00:00Z", projectId: "p1",
  title: "Scope call", messages: [
    { id: "1", role: "user", content: "Should we build the export in v1?", createdAt: "" },
    { id: "2", role: "assistant", content: "No — defer export to v2, it's a two-way door.", createdAt: "" },
  ],
};

const base = { project, milestones: [milestone], tasks: [task], threads: [thread], repo: null, commits: [] };

describe("formatProjectContext", () => {
  it("includes project state, milestones and open tasks", () => {
    const out = formatProjectContext(base);
    expect(out).toContain("Acme Dashboard");
    expect(out).toContain("Waiting on API creds");
    expect(out).toContain("Ingest pipeline");
    expect(out).toContain("Auth handshake");
  });

  it("surfaces recent decisions from the newest thread", () => {
    const out = formatProjectContext(base);
    expect(out).toContain("defer export to v2");
  });

  it("uses only the most recent thread", () => {
    const older: ProjectThread = {
      ...thread, id: "th0", updatedAt: "2026-01-01T00:00:00Z",
      messages: [{ id: "x", role: "assistant", content: "ANCIENT DECISION", createdAt: "" }],
    };
    const out = formatProjectContext({ ...base, threads: [older, thread] });
    expect(out).not.toContain("ANCIENT DECISION");
    // Discriminating check: the newest thread's content must actually be present,
    // proving the omission of ANCIENT DECISION is selection, not an empty-threads bug.
    expect(out).toContain("defer export to v2");

    // Order in the input array must not matter — sort by updatedAt, not array position.
    const reversedOrder = formatProjectContext({ ...base, threads: [thread, older] });
    expect(reversedOrder).not.toContain("ANCIENT DECISION");
    expect(reversedOrder).toContain("defer export to v2");
  });

  it("keeps only the last 15 messages", () => {
    const long: ProjectThread = {
      ...thread,
      messages: Array.from({ length: 40 }, (_, i) => ({
        id: `m${i}`, role: "user" as const, content: `MESSAGE_${i}`, createdAt: "",
      })),
    };
    const out = formatProjectContext({ ...base, threads: [long] });
    expect(out).not.toContain("MESSAGE_0");
    expect(out).toContain("MESSAGE_39");
    // Discriminating check: exactly the last 15 (25..39) survive — not just "the tail exists".
    // Matched with a trailing digit boundary so "MESSAGE_2" doesn't false-positive on
    // "MESSAGE_25"/"MESSAGE_29" etc.
    const has = (i: number) => new RegExp(`MESSAGE_${i}(?!\\d)`).test(out);
    for (let i = 25; i <= 39; i++) expect(has(i)).toBe(true);
    for (let i = 0; i < 25; i++) expect(has(i)).toBe(false);
  });

  it("excludes threads belonging to a different project", () => {
    // resolveProjectContextTool deliberately passes ALL projectThreads in and
    // relies entirely on this filter — a solo agency's confidentiality
    // boundary between clients lives here. The foreign thread is made NEWER
    // than the p1 thread so that, if the `t.projectId === p.id` filter were
    // ever deleted, the newest-thread-wins logic would surface the sentinel
    // and this test would fail.
    const foreignThread: ProjectThread = {
      id: "th-foreign", createdAt: "", updatedAt: "2026-07-29T10:00:00Z", projectId: "p2",
      title: "Someone else's project", messages: [
        { id: "1", role: "user", content: "SENTINEL_OTHER_CLIENT_DECISION", createdAt: "" },
      ],
    };
    const out = formatProjectContext({ ...base, threads: [thread, foreignThread] });
    expect(out).not.toContain("SENTINEL_OTHER_CLIENT_DECISION");
    // Discriminating check: p1's own content must still be present, proving
    // the omission above is filtering, not an empty-threads bug.
    expect(out).toContain("defer export to v2");
  });

  it("says so plainly when there are no threads", () => {
    expect(formatProjectContext({ ...base, threads: [] })).toMatch(/no .*(chat|decision|thread)/i);
  });

  it("reports repo state and commits when present", () => {
    const out = formatProjectContext({
      ...base,
      project: { ...project, repoPath: "/Users/founder/code/acme" },
      repo: { branch: "main", ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 0 },
      commits: [{
        hash: "abc", shortHash: "abc", subject: "feat(ingest): loader", body: "",
        authorDate: "2026-07-28T10:00:00+02:00", files: [],
      }],
    });
    expect(out).toContain("main");
    expect(out).toContain("feat(ingest): loader");
  });

  it("distinguishes no repo linked from a repo that could not be read", () => {
    const noRepo = formatProjectContext({ ...base, project: { ...project, repoPath: null } });
    const unreadable = formatProjectContext({
      ...base, project: { ...project, repoPath: "/Users/founder/code/acme" }, repo: null,
    });
    expect(noRepo.toLowerCase()).toMatch(/no.*repo|none linked/);
    expect(unreadable).toContain("/Users/founder/code/acme");
    expect(unreadable.toLowerCase()).toMatch(/could not be read|unreadable|error/);
    // The two messages must actually differ — a resolver bug that maps "not linked"
    // and "unreadable" to the same string would pass a looser assertion.
    expect(noRepo).not.toEqual(unreadable);
    expect(noRepo).not.toContain("/Users/founder/code/acme");
  });

  it("caps commits at 10 even when more are supplied", () => {
    const manyCommits = Array.from({ length: 25 }, (_, i) => ({
      hash: `h${i}`, shortHash: `h${i}`, subject: `commit number ${i}`, body: "",
      authorDate: "2026-07-28T10:00:00+02:00", files: [],
    }));
    const out = formatProjectContext({
      ...base,
      project: { ...project, repoPath: "/Users/founder/code/acme" },
      repo: { branch: "main", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0 },
      commits: manyCommits,
    });
    // Newest-first cap: commits 0-9 survive, the rest are dropped.
    for (let i = 0; i < 10; i++) expect(out).toContain(`commit number ${i}`);
    for (let i = 10; i < 25; i++) expect(out).not.toContain(`commit number ${i}`);
  });

  it("respects the character budget", () => {
    const many = Array.from({ length: 900 }, (_, i) => ({
      ...milestone, id: `m${i}`, name: `A deliberately long milestone name number ${i}`,
    }));
    const out = formatProjectContext({ ...base, milestones: many });
    expect(out.length).toBeLessThanOrEqual(CONTEXT_BUDGET);
    expect(out).toContain("[truncated]");
    // Discriminating check: the cap must actually bind (not merely never triggered
    // because the input happened to be short) — content beyond the budget must be gone.
    expect(out).not.toContain("A deliberately long milestone name number 899");
    // And the truncation marker must sit at the very end, not merely appear somewhere
    // in the untruncated middle of the string.
    expect(out.endsWith("[truncated]")).toBe(true);
  });

  it("does not truncate small input", () => {
    const out = formatProjectContext(base);
    expect(out).not.toContain("[truncated]");
    expect(out.length).toBeLessThan(CONTEXT_BUDGET);
  });
});
