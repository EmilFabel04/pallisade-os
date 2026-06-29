import { describe, it, expect } from "vitest";
import { normalizeReddit } from "./reddit";

const sample = {
  data: {
    children: [
      {
        data: {
          title: "Cool new agent framework",
          permalink: "/r/MachineLearning/comments/abc/cool/",
          selftext: "Long body ".repeat(40),
          score: 321,
          created_utc: 1_750_000_000,
          subreddit: "MachineLearning",
        },
      },
    ],
  },
};

describe("normalizeReddit", () => {
  it("maps posts to NewsItem with reddit category, subreddit source, clipped snippet", () => {
    const out = normalizeReddit(sample, "MachineLearning");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "Cool new agent framework",
      url: "https://reddit.com/r/MachineLearning/comments/abc/cool/",
      source: "r/MachineLearning",
      category: "reddit",
      score: 321,
    });
    expect(out[0].snippet.length).toBeLessThanOrEqual(240);
    expect(out[0].publishedAt).toBe(new Date(1_750_000_000 * 1000).toISOString());
  });

  it("returns [] for a malformed payload", () => {
    expect(normalizeReddit({}, "x")).toEqual([]);
  });
});
