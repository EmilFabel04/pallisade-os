import { describe, it, expect } from "vitest";
import { milestoneStatusTone } from "./badges";

describe("milestoneStatusTone", () => {
  it("maps each milestone status onto an existing tone", () => {
    expect(milestoneStatusTone("planned")).toBe("neutral");
    expect(milestoneStatusTone("in progress")).toBe("accent");
    expect(milestoneStatusTone("blocked")).toBe("warning");
    expect(milestoneStatusTone("done")).toBe("positive");
  });
});
