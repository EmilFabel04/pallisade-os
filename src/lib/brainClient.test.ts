import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("brain client", () => {
  it("sends an agentId to the brain route", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/brainClient.ts"), "utf8");
    expect(src).toMatch(/agentId/);
  });
});
