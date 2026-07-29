import { describe, it, expect } from "vitest";
import { buildProjectSystemPrompt, PROMPT_BUDGET } from "./prompt";
import type { Milestone, Project, Task } from "@/lib/types";

const project: Project = {
  id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
  type: "paid project", stage: "building", priority: "high",
  startDate: "2026-07-01", dueDate: "2026-08-15", currentMilestone: "",
  currentBlocker: "Waiting on their API credentials", nextAction: "Chase Sam for the key",
  deliverables: "Live dashboard + handover doc", notes: "", repoPath: "/Users/e/code/acme",
};

const milestone: Milestone = {
  id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest pipeline",
  startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
  order: 0, dependsOn: [], commitScope: "ingest", notes: "",
};

const task: Task = {
  id: "t1", createdAt: "", updatedAt: "", title: "Wire the auth handshake",
  linkKind: "project", linkId: "p1", milestoneId: "m1", category: "delivery",
  priority: "high", status: "in progress", dueDate: "2026-07-18", notes: "",
};

const base = {
  project, milestones: [milestone], tasks: [task],
  repo: { branch: "main", ahead: 1, behind: 0, staged: 0, unstaged: 2, untracked: 1 },
  commits: [{
    hash: "abc123", shortHash: "abc123", subject: "feat(ingest): batch loader",
    body: "", authorDate: "2026-07-18T10:00:00+02:00", files: ["src/ingest.ts"],
  }],
  businessName: "Pallisade Data", founderName: "Emil", today: "2026-07-29",
};

describe("buildProjectSystemPrompt", () => {
  it("names the project, business and today's date", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("Acme Dashboard");
    expect(p).toContain("Pallisade Data");
    expect(p).toContain("2026-07-29");
  });

  it("includes milestones with status and dates", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("Ingest pipeline");
    expect(p).toContain("in progress");
    expect(p).toContain("2026-07-20");
  });

  it("includes the blocker, next action and open tasks", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("Waiting on their API credentials");
    expect(p).toContain("Chase Sam for the key");
    expect(p).toContain("Wire the auth handshake");
  });

  it("includes repo state and recent commits", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("main");
    expect(p).toContain("feat(ingest): batch loader");
  });

  it("says so plainly when no repo is linked", () => {
    const p = buildProjectSystemPrompt({
      ...base,
      project: { ...project, repoPath: null },
      repo: null,
      commits: [],
    });
    expect(p).toMatch(/no (linked )?repo/i);
  });

  it("respects the character budget and marks the truncation", () => {
    const many: Milestone[] = Array.from({ length: 400 }, (_, i) => ({
      ...milestone, id: `m${i}`, name: `Milestone number ${i} with a deliberately long name`,
    }));
    const p = buildProjectSystemPrompt({ ...base, milestones: many });
    expect(p.length).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(p).toContain("[truncated]");
  });

  it("forbids inventing project facts", () => {
    expect(buildProjectSystemPrompt(base)).toMatch(/never invent/i);
  });
});
