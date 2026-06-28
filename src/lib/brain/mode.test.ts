import { describe, it, expect } from "vitest";
import { threadMode } from "./mode";

describe("threadMode", () => {
  it("returns brainstorm when set", () => {
    expect(threadMode({ mode: "brainstorm" })).toBe("brainstorm");
  });
  it("defaults legacy/missing mode to strategist", () => {
    expect(threadMode({})).toBe("strategist");
    expect(threadMode({ mode: undefined })).toBe("strategist");
  });
});
