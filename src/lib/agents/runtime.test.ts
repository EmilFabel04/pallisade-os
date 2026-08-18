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
    driveAccountId: null, projectSnapshot: null,
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

  // This one pins pause_turn ONLY. It cannot pin the SERVER_TOOL_NAMES filter:
  // the pause_turn branch returns before `localUses` is evaluated, and the
  // block is typed `server_tool_use` so the `b.type === "tool_use"` clause
  // short-circuits regardless. The next two tests do that job.
  it("resumes a paused turn without synthesising a tool_result", async () => {
    const { client, create } = stub([
      { content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }], stop_reason: "pause_turn" },
      text("researched"),
    ]);
    const r = await runAgent({ spec: { ...spec, tools: ["web"] }, messages: [], ctx: ctx(), client });
    expect(r.content).toBe("researched");
    const second = create.mock.calls[1][0];
    expect(second.messages[second.messages.length - 1].role).toBe("assistant");
  });

  it("synthesises a tool_result only for the local tool use, never the server one", async () => {
    const { client, create } = stub([
      { content: [
          { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
          { type: "tool_use", id: "tu_1", name: "query_leads", input: {} },
        ], stop_reason: "tool_use" },
      text("done"),
    ]);
    await runAgent({ spec: { ...spec, tools: ["crm", "web"] }, messages: [], ctx: ctx(), client });
    const last = create.mock.calls[1][0].messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content).toHaveLength(1);
    expect(last.content[0].tool_use_id).toBe("tu_1");
  });

  // Isolates SERVER_TOOL_NAMES specifically: a server tool arriving with the
  // `tool_use` type. Fails if and only if the name filter is removed.
  it("never answers a server tool even when it arrives typed as tool_use", async () => {
    const { client, create } = stub([
      { content: [{ type: "tool_use", id: "s1", name: "web_search", input: {} }], stop_reason: "tool_use" },
      text("done"),
    ]);
    await runAgent({ spec: { ...spec, tools: ["web"] }, messages: [], ctx: ctx(), client });
    const pushed = create.mock.calls[1]?.[0]?.messages ?? [];
    expect(pushed.some((m: { role: string; content: unknown }) =>
      m.role === "user" && Array.isArray(m.content) &&
      m.content.some((c: { tool_use_id?: string }) => c.tool_use_id === "s1"))).toBe(false);
  });

  it("stops at the iteration cap and keeps the partial answer", async () => {
    // Each response carries text AND a tool_use, so the accumulated partial
    // answer is observable. A fixture of bare tool_uses leaves content "" and
    // the assertion below cannot fail — which is the whole point of the test.
    const responses = Array.from({ length: MAX_ITERATIONS }, (_, i) => ({
      content: [
        { type: "text", text: `partial-${i}` },
        { type: "tool_use", id: `tu_${i}`, name: "query_leads", input: {} },
      ],
      stop_reason: "tool_use",
    }));
    const { client, create } = stub(responses);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(create).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(r.stoppedBy).toBe("max_iterations");
    expect(r.content).toBe(`partial-${MAX_ITERATIONS - 1}`);
  });

  /* max_tokens was folded into "end", which made the Advisor's likeliest
     truncation channel — a 2048-token ceiling with twenty-two tools —
     unrepresentable, and left the page rendering a cut-off answer as a
     finished one. */
  it("reports max_tokens as its own stop reason, and keeps the partial text", async () => {
    const { client } = stub([
      { content: [{ type: "text", text: "half an ans" }], stop_reason: "max_tokens" },
    ]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.stoppedBy).toBe("max_tokens");
    expect(r.content).toBe("half an ans");
  });

  it("reports max_tokens even when the truncated turn carried a tool_use block", async () => {
    // Running out of budget mid-tool_use returns stop_reason "max_tokens"
    // with a (possibly incomplete) tool_use block. The loop must not treat
    // that as a normal end, and must not try to answer the partial call.
    const { client, create } = stub([
      { content: [
          { type: "text", text: "looking that up" },
          { type: "tool_use", id: "tu_1", name: "query_leads", input: {} },
        ], stop_reason: "max_tokens" },
      text("never reached"),
    ]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.stoppedBy).toBe("max_tokens");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a normal end_turn is still 'end'", async () => {
    const { client } = stub([text("complete")]);
    const r = await runAgent({ spec, messages: [], ctx: ctx(), client });
    expect(r.stoppedBy).toBe("end");
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
