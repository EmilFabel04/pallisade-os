import { describe, it, expect } from "vitest";
import { parseRepoSlug, isRepoSlug } from "./slug";

describe("parseRepoSlug", () => {
  it("reads an SSH remote", () => {
    expect(parseRepoSlug("git@github.com:EmilFabel04/pallisade-os.git"))
      .toBe("EmilFabel04/pallisade-os");
  });

  it("reads an HTTPS remote, with and without the .git suffix", () => {
    expect(parseRepoSlug("https://github.com/EmilFabel04/pallisade-os.git"))
      .toBe("EmilFabel04/pallisade-os");
    expect(parseRepoSlug("https://github.com/EmilFabel04/pallisade-os"))
      .toBe("EmilFabel04/pallisade-os");
  });

  it("reads an ssh:// remote", () => {
    expect(parseRepoSlug("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("reads a remote carrying credentials or a port", () => {
    expect(parseRepoSlug("https://user:token@github.com/owner/repo.git")).toBe("owner/repo");
    expect(parseRepoSlug("ssh://git@github.com:22/owner/repo.git")).toBe("owner/repo");
  });

  it("accepts an already-bare slug, which is what the UI accepts on Vercel", () => {
    expect(parseRepoSlug("owner/repo")).toBe("owner/repo");
  });

  it("trims surrounding whitespace and a trailing slash", () => {
    expect(parseRepoSlug("  https://github.com/owner/repo/  ")).toBe("owner/repo");
  });

  it("returns null for a non-GitHub host rather than guessing", () => {
    // The reader only speaks to api.github.com; inventing a slug from a GitLab
    // or Bitbucket remote would produce confident 404s against the wrong host.
    expect(parseRepoSlug("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(parseRepoSlug("https://bitbucket.org/owner/repo.git")).toBeNull();
  });

  it("returns null for empty, malformed, or deeper-than-two-segment input", () => {
    for (const bad of ["", "   ", "owner", "/repo", "owner/", "a/b/c", "https://github.com/owner"]) {
      expect(parseRepoSlug(bad)).toBeNull();
    }
  });

  it("returns null rather than throwing on nullish input", () => {
    expect(parseRepoSlug(null)).toBeNull();
    expect(parseRepoSlug(undefined)).toBeNull();
  });

  it("rejects segments carrying characters GitHub names cannot contain", () => {
    // Guards the API path: the slug is interpolated into a request URL, so a
    // segment holding "..", a slash or a query character must never survive.
    expect(parseRepoSlug("owner/../secret")).toBeNull();
    expect(parseRepoSlug("owner/repo?x=1")).toBeNull();
    expect(parseRepoSlug("owner/repo#frag")).toBeNull();
  });

  it("keeps the dots and dashes that real repo names use", () => {
    expect(parseRepoSlug("owner/my.repo-name_2")).toBe("owner/my.repo-name_2");
  });
});

describe("isRepoSlug", () => {
  it("distinguishes a slug from an absolute path, which is how the source is chosen", () => {
    expect(isRepoSlug("owner/repo")).toBe(true);
    expect(isRepoSlug("/Users/emilfabel/code/thing")).toBe(false);
    expect(isRepoSlug("")).toBe(false);
  });
});
