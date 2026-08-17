/* getAgent -> loadRegistry -> loadOverrides and loadAll are both DB-backed
   (getClient() defaults to file:data/pallisade.db, the founder's real
   production database). Both are stubbed at the module boundary so this file
   never touches it — the same pattern as src/app/api/brain/route.test.ts. The
   Anthropic SDK is stubbed so no test makes a network call. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
const { mockLoadAll } = vi.hoisted(() => ({ mockLoadAll: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic { messages = { create: mockCreate }; },
}));
vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));
vi.mock("@/lib/db/sqlite", () => ({ loadAll: mockLoadAll }));

import { POST } from "./route";

const PROJECT = {
  id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
  type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
  dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "", nextAction: "",
  deliverables: "", notes: "", repoPath: null, repoSlug: null,
};
const MILESTONE = {
  id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest",
  startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
  order: 0, dependsOn: [], commitScope: "", notes: "",
};
const TASK = {
  id: "t1", createdAt: "", updatedAt: "", title: "Auth handshake", linkKind: "project",
  linkId: "p1", milestoneId: "m1", category: "delivery", priority: "high",
  status: "in progress", dueDate: null, notes: "",
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/projects/chat", {
    method: "POST", body: JSON.stringify(body),
  }));

const reply = (text: string) => ({
  content: [{ type: "text", text }], stop_reason: "end_turn",
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  mockCreate.mockReset().mockResolvedValue(reply("Here is where the build stands."));
  mockLoadAll.mockReset().mockResolvedValue({
    projects: [PROJECT], milestones: [MILESTONE], tasks: [TASK], projectThreads: [],
  });
});

describe("POST /api/projects/chat", () => {
  it("answers with the agent's text and the stop reason", async () => {
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "status?" }] });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      content: "Here is where the build stands.", stoppedBy: "end", actions: [],
    });
  });

  // The whole point of the migration: the browser names WHICH project, never
  // what is in it. A snapshot in the body must have no effect.
  it("loads the project from the DB and ignores a client-supplied snapshot", async () => {
    await post({
      projectId: "p1",
      messages: [{ role: "user", content: "status?" }],
      snapshot: { project: { ...PROJECT, name: "Forged Project" }, milestones: [], tasks: [] },
    });
    const system = mockCreate.mock.calls[0][0].system as string;
    expect(system).toContain("Acme Dashboard");
    expect(system).not.toContain("Forged Project");
  });

  it("grants the nine delivery tools", async () => {
    await post({ projectId: "p1", messages: [{ role: "user", content: "status?" }] });
    const tools = mockCreate.mock.calls[0][0].tools as { name: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_milestone", "create_project_task", "list_milestones", "list_tasks",
      "read_commits", "read_repo_status", "update_milestone", "update_project",
      "update_project_task",
    ]);
  });

  it("appends the project state block after the persona body", async () => {
    await post({ projectId: "p1", messages: [{ role: "user", content: "status?" }] });
    const system = mockCreate.mock.calls[0][0].system as string;
    expect(system).toContain("You are the project agent");
    expect(system).toContain("MILESTONES:");
    expect(system.indexOf("You are the project agent")).toBeLessThan(system.indexOf("MILESTONES:"));
    expect(system).not.toContain("{{");
  });

  it("404s on a projectId that matches nothing", async () => {
    const res = await post({ projectId: "nope", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "project_not_found" });
  });

  it("400s with missing_project when no projectId is sent", async () => {
    const res = await post({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "missing_project" });
  });

  it("400s with missing_messages on an empty thread", async () => {
    const res = await post({ projectId: "p1", messages: [] });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "missing_messages" });
  });

  it("503s with agent_unconfigured when no API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_unconfigured" });
  });

  it("502s with the cause when the DB read fails", async () => {
    mockLoadAll.mockRejectedValue(new Error("db unavailable"));
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_failed" });
  });

  it("404s on an agentId that does not exist", async () => {
    const res = await post({
      projectId: "p1", agentId: "nope", messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_not_found" });
  });

  it("502s when the upstream call fails", async () => {
    mockCreate.mockRejectedValue(new Error("anthropic down"));
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_failed" });
  });

  it("returns queued proposals as actions", async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu1", name: "create_milestone", input: { name: "Handover" } }],
      })
      .mockResolvedValueOnce(reply("Queued it."));
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "add handover" }] });
    const json = await res.json();
    expect(json.actions).toHaveLength(1);
    expect(json.actions[0]).toMatchObject({ tool: "create_milestone", status: "pending" });
  });
});
