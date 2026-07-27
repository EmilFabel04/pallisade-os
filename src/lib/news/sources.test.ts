import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchStructured } from "./sources";
import { itemId } from "./normalize";
import type { NewsItem } from "@/lib/types";

const interests = {
  id: "i", createdAt: "", updatedAt: "",
  topics: "", githubLanguages: "", githubTopics: "", subreddits: "", rssFeeds: "", aboutMe: "",
};

const mk = (url: string, category: NewsItem["category"]): NewsItem => ({
  id: itemId(url), title: url, url, source: "s", category, snippet: "", publishedAt: null,
});

describe("fetchStructured", () => {
  it("merges sources, dedupes by id, and isolates a failing source into degraded", async () => {
    const out = await fetchStructured(interests, {
      github: async () => [mk("https://g/1", "github"), mk("https://dup", "github")],
      reddit: async () => { throw new Error("boom"); },
      rss: async () => [mk("https://dup", "ai")],
    });
    expect(out.degraded).toEqual(["Reddit"]);
    const urls = out.items.map((i) => i.url).sort();
    expect(urls).toEqual(["https://dup", "https://g/1"]); // dup collapsed
  });

  it("logs why a source failed instead of swallowing the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await fetchStructured(interests, {
      github: async () => [],
      reddit: async () => { throw new Error("Reddit r/SaaS 403"); },
      rss: async () => [],
    });

    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("Reddit");
    expect(logged).toContain("403"); // the real cause must survive, not just the name
  });
});
