import { describe, it, expect } from "vitest";
import { DRIVE_TOOLS, DRIVE_TOOL_NAMES, resolveBrainTool } from "./tools";

describe("brain tools", () => {
  it("exposes drive_search and drive_read_file", () => {
    expect(DRIVE_TOOL_NAMES.has("drive_search")).toBe(true);
    expect(DRIVE_TOOL_NAMES.has("drive_read_file")).toBe(true);
    expect(DRIVE_TOOLS).toHaveLength(2);
  });
  it("returns an error result (no throw) when Drive is not connected", async () => {
    const out = await resolveBrainTool("drive_search", { query: "x" }, null);
    expect(JSON.parse(out)).toHaveProperty("error");
  });
  it("returns an error result for an unknown tool", async () => {
    const out = await resolveBrainTool("nope", {}, "acct_1");
    expect(JSON.parse(out).error).toMatch(/unknown tool/);
  });
});
