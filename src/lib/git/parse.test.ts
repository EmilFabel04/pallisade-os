import { describe, it, expect } from "vitest";
import { parseStatus, parseLog, LOG_FORMAT } from "./parse";

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

const RS = "\x1e";
const US = "\x1f";

describe("parseLog", () => {
  it("parses several commits with their changed files", () => {
    const out =
      `${RS}9f8e7d6${US}9f8e7d6${US}2026-07-28T14:02:11+02:00${US}feat(gantt): add bar geometry${US}${US}\n` +
      "src/lib/projects/schedule.ts\nsrc/lib/projects/schedule.test.ts\n" +
      `${RS}1a2b3c4${US}1a2b3c4${US}2026-07-27T09:15:00+02:00${US}fix(git): count renames${US}Body line one.\nBody line two.${US}\n` +
      "src/lib/git/parse.ts\n";

    const commits = parseLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "9f8e7d6",
      shortHash: "9f8e7d6",
      authorDate: "2026-07-28T14:02:11+02:00",
      subject: "feat(gantt): add bar geometry",
      body: "",
      files: ["src/lib/projects/schedule.ts", "src/lib/projects/schedule.test.ts"],
    });
    expect(commits[1].body).toBe("Body line one.\nBody line two.");
    expect(commits[1].files).toEqual(["src/lib/git/parse.ts"]);
  });

  it("handles a commit with no changed files (e.g. a merge)", () => {
    const out = `${RS}abc${US}abc${US}2026-07-01T00:00:00Z${US}Merge branch 'x'${US}${US}\n`;
    expect(parseLog(out)[0].files).toEqual([]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog("\n")).toEqual([]);
  });

  it("exposes a format string using the record and unit separators", () => {
    expect(LOG_FORMAT).toContain("%x1e");
    expect(LOG_FORMAT).toContain("%x1f");
    expect(LOG_FORMAT).toContain("%H");
    expect(LOG_FORMAT).toContain("%aI");
  });
});
