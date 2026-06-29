import { describe, it, expect } from "vitest";
import { itemId, dedupeItems, parseList, parseRssFeeds } from "./normalize";
import type { NewsItem } from "@/lib/types";

const item = (url: string): NewsItem => ({
  id: itemId(url),
  title: url,
  url,
  source: "x",
  category: "ai",
  snippet: "",
  publishedAt: null,
});

describe("news normalize helpers", () => {
  it("itemId is deterministic and stable for the same url", () => {
    expect(itemId("https://a.com/x")).toBe(itemId("https://a.com/x"));
    expect(itemId("https://a.com/x")).not.toBe(itemId("https://a.com/y"));
  });

  it("dedupeItems collapses items with the same url/id, keeping first", () => {
    const out = dedupeItems([item("https://a.com/1"), item("https://a.com/1"), item("https://a.com/2")]);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.url)).toEqual(["https://a.com/1", "https://a.com/2"]);
  });

  it("parseList splits on commas and newlines and trims", () => {
    expect(parseList("TypeScript, Python\n Go ,")).toEqual(["TypeScript", "Python", "Go"]);
    expect(parseList("")).toEqual([]);
  });

  it("parseRssFeeds reads optional 'category|url' prefix, defaults to ai, drops non-urls", () => {
    const out = parseRssFeeds("finance|https://f.com/rss\nhttps://a.com/feed\nnot a url");
    expect(out).toEqual([
      { url: "https://f.com/rss", category: "finance" },
      { url: "https://a.com/feed", category: "ai" },
    ]);
  });
});
