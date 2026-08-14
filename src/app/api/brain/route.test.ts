/* ============================================================
   The Brain route runs on the shared agent runtime (getAgent + runAgent).
   getAgent -> loadRegistry -> loadOverrides is DB-backed (getClient()
   defaults to file:data/pallisade.db, the founder's real production
   database). Stub loadOverrides at the module boundary so this file never
   touches the DB. See the task brief's "Database hazard" section and the
   same pattern in src/lib/agents/roster.test.ts and
   src/app/api/agents/route.test.ts.

   The Anthropic SDK is stubbed the same way (src/app/api/ai/route.test.ts)
   so no test makes a real network call.
   ============================================================ */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));

import { GET, POST } from "@/app/api/brain/route";
import { resetRegistryCache } from "@/lib/agents/registry";

const savedKey = process.env.ANTHROPIC_API_KEY;
const savedModel = process.env.BRAIN_MODEL;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.BRAIN_MODEL;
  mockCreate.mockReset();
  resetRegistryCache();
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.BRAIN_MODEL;
  else process.env.BRAIN_MODEL = savedModel;
});

const call = (body: unknown) =>
  POST(
    new Request("http://x/api/brain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const textResponse = (t: string) => ({
  content: [{ type: "text", text: t }],
  stop_reason: "end_turn",
});

const msgs = [{ role: "user" as const, content: "hi" }];

describe("GET /api/brain", () => {
  it("reports configured + the default model", async () => {
    const json = await (await GET()).json();
    expect(json.configured).toBe(true);
    expect(json.model).toBe("claude-sonnet-4-6");
  });

  it("reports the BRAIN_MODEL override", async () => {
    process.env.BRAIN_MODEL = "claude-opus-4-6";
    const json = await (await GET()).json();
    expect(json.model).toBe("claude-opus-4-6");
  });

  it("reports unconfigured with no key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const json = await (await GET()).json();
    expect(json.configured).toBe(false);
  });
});

describe("POST /api/brain — error semantics", () => {
  it("503 agent_unconfigured with no API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await call({ messages: msgs });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("agent_unconfigured");
  });

  it("400 bad_request on invalid JSON", async () => {
    const res = await POST(new Request("http://x/api/brain", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  it("404 agent_not_found for an unknown agentId", async () => {
    const res = await call({ agentId: "nope", messages: msgs });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("agent_not_found");
  });

  it("502 agent_failed, and never leaks the raw upstream message, when the model call throws", async () => {
    mockCreate.mockRejectedValue(new Error("some upstream secret detail"));
    const res = await call({ messages: msgs });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("agent_failed");
    expect(JSON.stringify(json)).not.toMatch(/upstream secret detail/);
  });
});

describe("POST /api/brain — agent resolution", () => {
  it("defaults to strategist (project tools only) with neither mode nor agentId", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(["list_projects", "get_project_context"]);
  });

  it("mode: 'brainstorm' resolves product-brainstorm (drive + web tools too)", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "brainstorm", messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(
      expect.arrayContaining(["list_projects", "get_project_context", "drive_search", "drive_read_file", "web_search"]),
    );
  });

  it("an unrecognised mode falls back to strategist", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "not-a-real-mode", messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(["list_projects", "get_project_context"]);
  });

  it("agentId wins over mode when both are present", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ mode: "brainstorm", agentId: "strategist", messages: msgs });
    const toolNames = mockCreate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(["list_projects", "get_project_context"]);
  });
});

describe("POST /api/brain — BRAIN_MODEL override", () => {
  it("splices the env override onto the resolved spec's model", async () => {
    process.env.BRAIN_MODEL = "claude-opus-4-6";
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-opus-4-6");
  });

  it("falls back to the runtime default when BRAIN_MODEL is unset", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-sonnet-4-6");
  });
});

describe("POST /api/brain — attachments", () => {
  it("appends formatAttachmentsBlock's output to the rendered system prompt", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({
      mode: "brainstorm",
      messages: msgs,
      attachments: [{ name: "call.md", content: "notes from the call" }],
    });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).toContain("SESSION DOCUMENTS");
    expect(system).toContain("call.md");
    expect(system).toContain("notes from the call");
  });

  it("does not append an attachments block when there are none", async () => {
    mockCreate.mockResolvedValue(textResponse("hi"));
    await call({ messages: msgs });
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).not.toContain("SESSION DOCUMENTS");
  });
});

describe("POST /api/brain — response shape", () => {
  it("returns content and stoppedBy", async () => {
    mockCreate.mockResolvedValue(textResponse("the answer"));
    const res = await call({ messages: msgs });
    const json = await res.json();
    expect(json.content).toBe("the answer");
    expect(json.stoppedBy).toBe("end");
  });

  it("substitutes a fallback message when the model returns no text", async () => {
    mockCreate.mockResolvedValue({ content: [], stop_reason: "end_turn" });
    const res = await call({ messages: msgs });
    const json = await res.json();
    expect(json.content).toBe("I couldn't produce a response — try rephrasing.");
  });
});
