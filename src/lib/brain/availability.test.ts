import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveFathomEnabled } from "./availability";

describe("resolveFathomEnabled", () => {
  let prior: string | undefined;
  beforeEach(() => { prior = process.env.FATHOM_API_KEY; });
  afterEach(() => {
    if (prior === undefined) delete process.env.FATHOM_API_KEY;
    else process.env.FATHOM_API_KEY = prior;
  });

  it("is true when the spec declares fathom and the key is set", () => {
    process.env.FATHOM_API_KEY = "test-key";
    expect(resolveFathomEnabled({ tools: ["fathom"] })).toBe(true);
  });

  it("is false when the key is set but the spec does not declare fathom", () => {
    // Spec-gated for the same reason email/calendar/drive are: an agent that
    // never asks for Fathom should not carry a flag implying it did.
    process.env.FATHOM_API_KEY = "test-key";
    expect(resolveFathomEnabled({ tools: ["crm"] })).toBe(false);
  });

  it("is false when the spec declares fathom but no key is set", () => {
    delete process.env.FATHOM_API_KEY;
    expect(resolveFathomEnabled({ tools: ["fathom"] })).toBe(false);
  });
});
