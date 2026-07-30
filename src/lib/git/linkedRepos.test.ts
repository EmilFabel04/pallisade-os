import { describe, it, expect } from "vitest";
import {
  isLinkedRepoPath,
  linkedRepoPaths,
  normalizeRepoPath,
  pathMatchesAny,
} from "./linkedRepos";
import type { Project } from "@/lib/types";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    name: "Proj",
    company: "Acme",
    type: "paid project",
    stage: "idea",
    priority: "medium",
    startDate: null,
    dueDate: null,
    currentMilestone: "",
    currentBlocker: "",
    nextAction: "",
    deliverables: "",
    notes: "",
    repoPath: null,
    ...over,
  };
}

describe("normalizeRepoPath", () => {
  it("strips trailing separators", () => {
    expect(normalizeRepoPath("/Users/e/code/acme/")).toBe("/Users/e/code/acme");
    expect(normalizeRepoPath("/Users/e/code/acme///")).toBe("/Users/e/code/acme");
  });

  it("collapses duplicate separators and dot segments", () => {
    expect(normalizeRepoPath("/Users//e/code/./acme")).toBe("/Users/e/code/acme");
    expect(normalizeRepoPath("/Users/e/code/other/../acme")).toBe("/Users/e/code/acme");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRepoPath("  /Users/e/code/acme  ")).toBe("/Users/e/code/acme");
  });

  it("returns empty string for blank, null or undefined input", () => {
    expect(normalizeRepoPath("")).toBe("");
    expect(normalizeRepoPath("   ")).toBe("");
    expect(normalizeRepoPath(null)).toBe("");
    expect(normalizeRepoPath(undefined)).toBe("");
  });

  it("keeps the root separator", () => {
    expect(normalizeRepoPath("/")).toBe("/");
  });
});

describe("linkedRepoPaths", () => {
  it("returns the normalized stored paths", () => {
    const projects = [
      project({ id: "a", repoPath: "/Users/e/code/acme/" }),
      project({ id: "b", repoPath: "/Users/e/code/beta" }),
    ];
    expect(linkedRepoPaths(projects)).toEqual([
      "/Users/e/code/acme",
      "/Users/e/code/beta",
    ]);
  });

  it("drops null and blank repo paths", () => {
    const projects = [
      project({ id: "a", repoPath: null }),
      project({ id: "b", repoPath: "" }),
      project({ id: "c", repoPath: "   " }),
      project({ id: "d", repoPath: "/Users/e/code/acme" }),
    ];
    expect(linkedRepoPaths(projects)).toEqual(["/Users/e/code/acme"]);
  });

  it("de-duplicates two projects sharing one repo", () => {
    const projects = [
      project({ id: "a", repoPath: "/Users/e/code/acme" }),
      project({ id: "b", repoPath: "/Users/e/code/acme/" }),
    ];
    expect(linkedRepoPaths(projects)).toEqual(["/Users/e/code/acme"]);
  });

  it("returns an empty list when no project has a repo", () => {
    expect(linkedRepoPaths([project()])).toEqual([]);
  });
});

describe("pathMatchesAny", () => {
  it("matches after normalizing both sides", () => {
    expect(pathMatchesAny("/Users/e/code/acme/", ["/Users/e/code/acme"])).toBe(true);
    expect(pathMatchesAny("/Users/e/code/acme", ["/Users/e/code/acme/"])).toBe(true);
  });

  it("does not match a different path", () => {
    expect(pathMatchesAny("/Users/e/code/other", ["/Users/e/code/acme"])).toBe(false);
  });

  it("does not match a parent or child of a linked path", () => {
    expect(pathMatchesAny("/Users/e/code", ["/Users/e/code/acme"])).toBe(false);
    expect(pathMatchesAny("/Users/e/code/acme/src", ["/Users/e/code/acme"])).toBe(false);
  });

  it("does not match a sibling that shares a prefix", () => {
    expect(pathMatchesAny("/Users/e/code/acme-secret", ["/Users/e/code/acme"])).toBe(false);
  });

  it("never matches a blank candidate, even against a blank entry", () => {
    expect(pathMatchesAny("", [""])).toBe(false);
    expect(pathMatchesAny("   ", ["/Users/e/code/acme"])).toBe(false);
  });

  it("returns false against an empty list", () => {
    expect(pathMatchesAny("/Users/e/code/acme", [])).toBe(false);
  });
});

describe("isLinkedRepoPath", () => {
  const projects = [
    project({ id: "a", repoPath: "/Users/e/code/acme" }),
    project({ id: "b", repoPath: null }),
  ];

  it("allows a path stored on some project", () => {
    expect(isLinkedRepoPath("/Users/e/code/acme", projects)).toBe(true);
  });

  it("allows a stored path written with a trailing separator", () => {
    expect(isLinkedRepoPath("/Users/e/code/acme/", projects)).toBe(true);
  });

  it("refuses an unlinked repo on the same machine", () => {
    expect(isLinkedRepoPath("/Users/e/code/personal", projects)).toBe(false);
  });

  it("refuses a traversal that lands outside every linked repo", () => {
    expect(isLinkedRepoPath("/Users/e/code/acme/../personal", projects)).toBe(false);
  });

  it("refuses everything when no project has a linked repo", () => {
    expect(isLinkedRepoPath("/Users/e/code/acme", [project()])).toBe(false);
    expect(isLinkedRepoPath("/Users/e/code/acme", [])).toBe(false);
  });

  it("refuses a blank path", () => {
    expect(isLinkedRepoPath("", projects)).toBe(false);
  });

  // APFS is case-insensitive, so a differently-cased path can still open the
  // same repo on disk. We compare case-sensitively anyway: the client always
  // sends back the exact string it stored, so the only cost is failing closed
  // on a hand-typed URL.
  it("compares case-sensitively", () => {
    expect(isLinkedRepoPath("/users/e/code/ACME", projects)).toBe(false);
  });
});
