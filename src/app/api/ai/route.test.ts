/* ============================================================
   A 200 response whose content has no text block (e.g. Claude
   returns stop_reason: "refusal", a documented outcome on Claude 4+
   models) must never turn into a fabricated success. Before this
   fix, runStructured() silently substituted "{}" for the missing
   text block, so the route answered 200 with a `result` object that
   only ever carried the stamped `generatedAt` field — a failure
   dressed up as an empty-but-valid answer.

   The Anthropic SDK is stubbed at the module boundary so this test
   never makes a real network call. See the same pattern used for
   DB stubbing in src/app/api/agents/route.test.ts.
   ============================================================ */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
  },
}));

import { POST } from "@/app/api/ai/route";

const savedKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  mockCreate.mockReset();
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const call = (body: unknown) =>
  POST(
    new Request("http://x/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/ai — a missing text block is a failure, not an empty answer", () => {
  it("no text block in content (refusal-shaped response) returns 502, never a 200 result", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "refusal" }], stop_reason: "refusal" });
    const res = await call({ kind: "callSummary", input: { rawNotes: "we spoke about pricing" } });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.result).toBeUndefined();
  });

  it("empty content array returns 502, never a 200 result", async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const res = await call({ kind: "businessReview", input: { text: "did some calls today" } });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.result).toBeUndefined();
  });

  it("never leaks a raw error message to the client on this path", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "refusal" }] });
    const res = await call({ kind: "callSummary", input: { rawNotes: "x" } });
    const json = await res.json();
    expect(json.error).toBe("upstream_failed");
    expect(JSON.stringify(json)).not.toMatch(/model returned no text block/i);
  });
});
