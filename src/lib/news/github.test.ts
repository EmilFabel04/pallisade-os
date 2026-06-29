import { describe, it, expect } from "vitest";
import { normalizeGithub } from "./github";

const sample = {
  items: [
    {
      full_name: "acme/agent-kit",
      html_url: "https://github.com/acme/agent-kit",
      description: "A toolkit for building agents",
      stargazers_count: 1234,
      language: "TypeScript",
      created_at: "2026-06-25T10:00:00Z",
    },
    { full_name: "n/d", html_url: "https://github.com/n/d", description: null, stargazers_count: 5, created_at: null },
  ],
};

describe("normalizeGithub", () => {
  it("maps repos to NewsItem with category github and star score", () => {
    const out = normalizeGithub(sample);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "acme/agent-kit",
      url: "https://github.com/acme/agent-kit",
      source: "github",
      category: "github",
      snippet: "A toolkit for building agents",
      score: 1234,
      publishedAt: "2026-06-25T10:00:00Z",
    });
    expect(out[0].id).toBeTruthy();
    expect(out[1].snippet).toBe("");      // null description → ""
    expect(out[1].publishedAt).toBeNull();
  });

  it("returns [] for a malformed payload", () => {
    expect(normalizeGithub({})).toEqual([]);
    expect(normalizeGithub(null)).toEqual([]);
  });

  it("drops items missing html_url and keeps the rest", () => {
    const mixed = {
      items: [
        {
          full_name: "acme/agent-kit",
          html_url: "https://github.com/acme/agent-kit",
          description: "A toolkit",
          stargazers_count: 10,
          created_at: "2026-06-25T10:00:00Z",
        },
        { full_name: "bad/repo", description: "no url here" },
      ],
    };
    const out = normalizeGithub(mixed);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://github.com/acme/agent-kit");
  });
});
