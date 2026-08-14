import { describe, it, expect } from "vitest";
import { threadMode, threadAgentId } from "./mode";

describe("threadMode", () => {
  it("returns brainstorm when set", () => {
    expect(threadMode({ mode: "brainstorm" })).toBe("brainstorm");
  });
  it("defaults legacy/missing mode to strategist", () => {
    expect(threadMode({})).toBe("strategist");
    expect(threadMode({ mode: undefined })).toBe("strategist");
  });
});

describe("threadAgentId", () => {
  it("uses the stored agentId when the row has one", () => {
    expect(threadAgentId({ agentId: "deal-strategist" })).toBe("deal-strategist");
    expect(threadAgentId({ agentId: "pipeline-analyst", mode: "strategist" }))
      .toBe("pipeline-analyst");
  });

  // No migration was written, by design: every row persisted before agentId
  // existed must still resolve to exactly the agent it opened as before.
  it("falls back to the legacy mode for rows written before agentId existed", () => {
    expect(threadAgentId({ mode: "brainstorm" })).toBe("product-brainstorm");
    expect(threadAgentId({ mode: "strategist" })).toBe("strategist");
    expect(threadAgentId({})).toBe("strategist");
  });

  // A rollback writes `mode` and nothing else; a row that somehow carries an
  // empty agentId must not resolve to "" and vanish from every bucket.
  it("ignores an empty agentId and falls back", () => {
    expect(threadAgentId({ agentId: "", mode: "brainstorm" })).toBe("product-brainstorm");
  });
});
