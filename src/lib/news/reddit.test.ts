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

  it("skips malformed children (no permalink) without throwing, returning only valid posts", () => {
    const mixed = {
      data: {
        children: [
          // valid post
          {
            data: {
              title: "Valid post",
              permalink: "/r/MachineLearning/comments/xyz/valid/",
              score: 42,
              created_utc: 1_750_000_000,
              subreddit: "MachineLearning",
            },
          },
          // structurally incomplete: empty object (no data key)
          {},
          // structurally incomplete: data present but no permalink
          { data: {} },
          // Reddit "more" continuation object variant
          { kind: "more", data: { children: [], count: 5 } },
        ],
      },
    };

    let result: ReturnType<typeof normalizeReddit> | undefined;
    expect(() => {
      result = normalizeReddit(mixed, "MachineLearning");
    }).not.toThrow();
    expect(result).toHaveLength(1);
    expect(result![0].title).toBe("Valid post");
    expect(result![0].url).toBe(
      "https://reddit.com/r/MachineLearning/comments/xyz/valid/",
    );
  });
});
