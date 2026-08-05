import { describe, it, expect, vi } from "vitest";
import { buildFingerprintPrompt, generateFingerprint, FINGERPRINT_SCHEMA } from "./fingerprint";

const samples = ["Shipped it Tuesday.", "Nobody asked for a dashboard."];

describe("buildFingerprintPrompt", () => {
  it("includes every sample", () => {
    const p = buildFingerprintPrompt(samples);
    expect(p).toContain("Shipped it Tuesday.");
    expect(p).toContain("Nobody asked for a dashboard.");
  });

  it("asks for a voice description and things he would never say", () => {
    const p = buildFingerprintPrompt(samples);
    expect(p).toMatch(/never (?:say|write|use)/i);
    expect(p).toMatch(/rhythm|cadence|diction/i);
  });

  it("labels each sample separately rather than running them together", () => {
    const p = buildFingerprintPrompt(samples);
    expect(p).toContain("SAMPLE 1:");
    expect(p).toContain("SAMPLE 2:");
  });
});

describe("FINGERPRINT_SCHEMA", () => {
  it("requires both fields", () => {
    expect(FINGERPRINT_SCHEMA.input_schema.required).toEqual(
      expect.arrayContaining(["fingerprint", "neverSay"]),
    );
  });
});

function stub(content: unknown[]) {
  return {
    messages: { create: vi.fn(async (..._a: unknown[]) => ({ content })) },
  } as never;
}
const calls = (c: unknown) =>
  (c as { messages: { create: { mock: { calls: unknown[][] } } } }).messages.create.mock.calls;

describe("generateFingerprint", () => {
  it("returns the tool payload", async () => {
    const client = stub([{
      type: "tool_use", id: "t1", name: "submit_fingerprint",
      input: { fingerprint: "Blunt and concrete.", neverSay: ["leverage", "synergy"] },
    }]);
    const out = await generateFingerprint(client, samples);
    expect(out.fingerprint).toBe("Blunt and concrete.");
    expect(out.neverSay).toContain("synergy");
  });

  it("throws when the model does not call the tool", async () => {
    await expect(
      generateFingerprint(stub([{ type: "text", text: "hi" }]), samples),
    ).rejects.toThrow(/fingerprint_failed/);
  });

  it("throws when the tool_use block is for a different tool", async () => {
    await expect(
      generateFingerprint(
        stub([{ type: "tool_use", id: "t1", name: "something_else", input: { fingerprint: "x", neverSay: [] } }]),
        samples,
      ),
    ).rejects.toThrow(/fingerprint_failed/);
  });

  it("normalises the never-say entries to lowercase and drops blanks", async () => {
    // checkNeverSay in gate.ts lowercases the body before matching, so an
    // entry stored as "Leverage" would never fire.
    const client = stub([{
      type: "tool_use", id: "t1", name: "submit_fingerprint",
      input: { fingerprint: "f", neverSay: ["  Leverage ", "SYNERGY", "", "   "] },
    }]);
    const out = await generateFingerprint(client, samples);
    expect(out.neverSay).toEqual(["leverage", "synergy"]);
  });

  it("forces the model through the submit_fingerprint tool", async () => {
    const client = stub([{
      type: "tool_use", id: "t1", name: "submit_fingerprint",
      input: { fingerprint: "f", neverSay: [] },
    }]);
    await generateFingerprint(client, samples);
    const arg = calls(client)[0][0] as {
      tool_choice?: { type: string; name: string }; tools: { name: string }[];
    };
    expect(arg.tool_choice).toEqual({ type: "tool", name: "submit_fingerprint" });
    expect(arg.tools.map((t) => t.name)).toContain("submit_fingerprint");
  });

  it("tolerates a tool call missing either field rather than throwing", async () => {
    const client = stub([{
      type: "tool_use", id: "t1", name: "submit_fingerprint", input: {},
    }]);
    const out = await generateFingerprint(client, samples);
    expect(out.fingerprint).toBe("");
    expect(out.neverSay).toEqual([]);
  });
});
