import { describe, it, expect, vi } from "vitest";
import { runAgent, MAX_ITERATIONS } from "@/lib/agents/runtime";
import type { AgentSpec, AgentContext } from "@/lib/agents/types";

const spec: AgentSpec = {
  id: "t", name: "T", description: "D", color: "#fff", emoji: "A", vibe: "V",
  surface: "brain", tools: ["crm"], body: "SYSTEM PROMPT",
};

function ctx(): AgentContext {
  return {
    today: "2026-08-13", businessName: "P", founderName: "E", services: "S",
    snapshot: null, proposals: [], emailEnabled: false, calendarEnabled: false,
    driveAccountId: null,
  };
}

const text = (t: string) => ({
  content: [{ type: "text", text: t }], stop_reason: "end_turn",
});
const toolUse = (name: string, id = "tu_1") => ({
  content: [{ type: "tool_use", id, name, input: {} }], stop_reason: "tool_use",
});

function stub(responses: unknown[]) {
  const create = vi.fn();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  return { client: { messages: { create } } as never, create };
}

describe("runAgent", () => {
  it("returns the text of a single non-tool turn", async () => {
    const { client, create } = stub([text("hello")]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("hello");
    expect(r.stoppedBy).toBe("end");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("passes the agent body as the system prompt", async () => {
    const { client, create } = stub([text("hi")]);
    await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(create.mock.calls[0][0].system).toBe("SYSTEM PROMPT");
  });

  it("uses the spec model override when present", async () => {
    const { client, create } = stub([text("hi")]);
    await runAgent({ spec: { ...spec, model: "claude-opus-4-6" }, messages: [], ctx: ctx(), client });
    expect(create.mock.calls[0][0].model).toBe("claude-opus-4-6");
  });

  it("answers a tool_use with a tool_result and continues", async () => {
    const { client, create } = stub([toolUse("query_leads"), text("done")]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("done");
    const second = create.mock.calls[1][0];
    const last = second.messages[second.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content[0].type).toBe("tool_result");
  });

  it("does not synthesise a tool_result for a server-executed tool", async () => {
    const { client, create } = stub([
      { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }], stop_reason: "pause_turn" },
      text("researched"),
    ]);
    const r = await runAgent({ spec: { ...spec, tools: ["web"] }, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("researched");
    const second = create.mock.calls[1][0];
    expect(second.messages[second.messages.length - 1].role).toBe("assistant");
  });

  it("stops at the iteration cap and keeps the partial answer", async () => {
    const responses = Array.from({ length: MAX_ITERATIONS }, () => toolUse("query_leads"));
    const { client, create } = stub(responses);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(create).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(r.stoppedBy).toBe("max_iterations");
  });

  it("surfaces a tool failure to the agent instead of throwing", async () => {
    const { client } = stub([toolUse("query_leads"), text("recovered")]);
    // ctx().snapshot is null, so the crm resolver fails inside dispatch
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("recovered");
  });

  it("propagates a model error to the caller", async () => {
    const create = vi.fn().mockRejectedValue(new Error("rate limited"));
    await expect(
      runAgent({ spec, messages: [], ctx: ctx(), client: { messages: { create } } as never }),
    ).rejects.toThrow(/rate limited/);
  });
});
