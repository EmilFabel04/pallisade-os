import { describe, it, expect } from "vitest";
import { parseStatus } from "./parse";

describe("parseStatus", () => {
  it("reads branch, ahead/behind and the three change counts", () => {
    const out = [
      "# branch.oid 9f8e7d6c5b4a",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaa bbb src/edited.ts",
      "1 M. N... 100644 100644 100644 ccc ddd src/staged.ts",
      "1 MM N... 100644 100644 100644 eee fff src/both.ts",
      "? src/new.ts",
      "? src/other.ts",
      "! dist/ignored.js",
    ].join("\n");

    expect(parseStatus(out)).toEqual({
      branch: "main",
      ahead: 2,
      behind: 1,
      staged: 2,    // M. and MM
      unstaged: 2,  // .M and MM
      untracked: 2, // ignored lines don't count
    });
  });

  it("defaults ahead/behind to zero when there is no upstream", () => {
    const out = ["# branch.oid abc", "# branch.head feature/gantt"].join("\n");
    expect(parseStatus(out)).toEqual({
      branch: "feature/gantt", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
    });
  });

  it("reports a clean repo", () => {
    const out = ["# branch.oid abc", "# branch.head main", "# branch.ab +0 -0"].join("\n");
    expect(parseStatus(out)).toMatchObject({ staged: 0, unstaged: 0, untracked: 0 });
  });

  it("counts renames and unmerged entries", () => {
    const out = [
      "# branch.head main",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
    ].join("\n");
    expect(parseStatus(out)).toMatchObject({ staged: 1, unstaged: 1 });
  });

  it("survives empty output", () => {
    expect(parseStatus("")).toEqual({
      branch: "", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
    });
  });
});
