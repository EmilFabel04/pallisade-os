import { describe, it, expect } from "vitest";
import { buildStructuredFeed, applySubmission } from "./curate";
import { itemId } from "./normalize";
import type { NewsItem } from "@/lib/types";

const items: NewsItem[] = [
  { id: itemId("https://a/1"), title: "One", url: "https://a/1", source: "github", category: "github", snippet: "", publishedAt: null },
  { id: itemId("https://a/2"), title: "Two", url: "https://a/2", source: "r/x", category: "reddit", snippet: "", publishedAt: null },
];

describe("buildStructuredFeed", () => {
  it("returns the items unchanged with empty summary (no AI pass)", () => {
    const feed = buildStructuredFeed(items, ["Reddit"], "2026-06-29T00:00:00Z");
    expect(feed.items).toHaveLength(2);
    expect(feed.summary).toBe("");
    expect(feed.degraded).toEqual(["Reddit"]);
    expect(feed.fetchedAt).toBe("2026-06-29T00:00:00Z");
  });
});

describe("applySubmission", () => {
  it("attaches whyItMatters by id, appends extra x items, sets the summary", () => {
    const feed = applySubmission(
      items,
      {
        summary: "## Top picks\n- big stuff",
        picks: [{ id: items[0].id, whyItMatters: "Directly relevant to your stack" }],
        extra: [{ title: "X thread", url: "https://x.com/p/1", source: "x.com", category: "x", snippet: "buzz" }],
      },
      [],
      "2026-06-29T00:00:00Z",
    );
    expect(feed.summary).toContain("Top picks");
    expect(feed.items.find((i) => i.id === items[0].id)?.whyItMatters).toBe("Directly relevant to your stack");
    const x = feed.items.find((i) => i.category === "x");
    expect(x).toMatchObject({ title: "X thread", url: "https://x.com/p/1", category: "x" });
    expect(x?.id).toBe(itemId("https://x.com/p/1"));
  });

  it("ignores picks whose id is unknown", () => {
    const feed = applySubmission(items, { summary: "", picks: [{ id: "nope", whyItMatters: "x" }], extra: [] }, [], "t");
    expect(feed.items.every((i) => i.whyItMatters === undefined)).toBe(true);
  });
});
