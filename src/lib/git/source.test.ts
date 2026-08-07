import { describe, it, expect } from "vitest";
import { pickRepoRef } from "./source";

const path = "/Users/emilfabel/code/thing";
const slug = "EmilFabel04/pallisade-os";

describe("pickRepoRef — running locally", () => {
  it("prefers the local path, the only source that sees uncommitted work", () => {
    expect(pickRepoRef({ repoPath: path, repoSlug: slug }, false))
      .toEqual({ kind: "local", ref: path });
  });

  it("falls back to the slug when no path is stored", () => {
    expect(pickRepoRef({ repoPath: null, repoSlug: slug }, false))
      .toEqual({ kind: "github", ref: slug });
  });

  it("returns null when neither is stored", () => {
    expect(pickRepoRef({ repoPath: null, repoSlug: null }, false)).toBeNull();
  });
});

describe("pickRepoRef — deployed", () => {
  it("uses the slug and ignores the path", () => {
    expect(pickRepoRef({ repoPath: path, repoSlug: slug }, true))
      .toEqual({ kind: "github", ref: slug });
  });

  it("returns null rather than falling back to a path that cannot exist", () => {
    // The whole point of the split. A Vercel function's filesystem holds only
    // the build output, so reading /Users/... is guaranteed to fail. Reporting
    // "nothing linked here" lets the UI ask for owner/repo; falling back would
    // surface a bare "not found" and send the founder hunting for a typo.
    expect(pickRepoRef({ repoPath: path, repoSlug: null }, true)).toBeNull();
  });
});

describe("pickRepoRef — malformed input", () => {
  it("ignores a slug that is not a GitHub reference", () => {
    expect(pickRepoRef({ repoPath: null, repoSlug: "not a repo" }, true)).toBeNull();
    expect(pickRepoRef({ repoPath: null, repoSlug: "git@gitlab.com:o/r.git" }, true)).toBeNull();
  });

  it("treats blank and whitespace-only fields as absent", () => {
    expect(pickRepoRef({ repoPath: "   ", repoSlug: "  " }, false)).toBeNull();
  });

  it("survives the fields being undefined on a restored record", () => {
    expect(pickRepoRef({}, false)).toBeNull();
    expect(pickRepoRef({}, true)).toBeNull();
  });

  it("normalises a full remote URL stored in the slug field", () => {
    expect(pickRepoRef({ repoSlug: "https://github.com/owner/repo.git" }, true))
      .toEqual({ kind: "github", ref: "owner/repo" });
  });
});
