import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchReddit, normalizeReddit, normalizeRedditRss } from "./reddit";
import type { NewsInterests } from "@/lib/types";

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

/** Shape mirrors a real www.reddit.com/r/<sub>/top.rss entry: Atom, self-closing
 *  <link href>, and double-escaped HTML inside <content>. */
const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>top scoring links : SaaS</title>
  <entry>
    <author><name>/u/founder</name></author>
    <category term="SaaS" label="r/SaaS"/>
    <content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;We hit &amp;#36;10k MRR &amp;amp; churn dropped. Here&amp;#39;s what worked.&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/founder&quot;&gt; /u/founder &lt;/a&gt; to &lt;a href=&quot;https://www.reddit.com/r/SaaS/&quot;&gt; r/SaaS &lt;/a&gt; &lt;a href=&quot;x&quot;&gt;[link]&lt;/a&gt; &lt;a href=&quot;y&quot;&gt;[comments]&lt;/a&gt;</content>
    <id>t3_abc123</id>
    <link href="https://www.reddit.com/r/SaaS/comments/abc123/how_we_hit_10k_mrr/" />
    <updated>2026-07-26T15:57:02+00:00</updated>
    <title>How we hit $10k MRR</title>
  </entry>
</feed>`;

describe("normalizeRedditRss", () => {
  it("maps Atom entries to NewsItem with r/<sub> source and reddit category", () => {
    const out = normalizeRedditRss(atom, "SaaS");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: "How we hit $10k MRR",
      url: "https://www.reddit.com/r/SaaS/comments/abc123/how_we_hit_10k_mrr/",
      source: "r/SaaS",
      category: "reddit",
    });
    expect(out[0].publishedAt).toBe("2026-07-26T15:57:02.000Z");
  });

  it("decodes double-escaped HTML and drops the 'submitted by' boilerplate", () => {
    const { snippet } = normalizeRedditRss(atom, "SaaS")[0];
    // Entities fully resolved: no raw &lt; / &amp; / &#39; left behind.
    expect(snippet).not.toMatch(/&(lt|gt|amp|quot|#\d+);/);
    expect(snippet).not.toMatch(/<[a-z/]/i);
    expect(snippet).toContain("$10k MRR & churn dropped");
    expect(snippet).toContain("Here's what worked");
    expect(snippet).not.toContain("submitted by");
    expect(snippet).not.toContain("[comments]");
    expect(snippet.length).toBeLessThanOrEqual(240);
  });

  it("returns [] for a non-feed payload", () => {
    expect(normalizeRedditRss("<html>blocked</html>", "SaaS")).toEqual([]);
  });

  it("attributes each entry to its own subreddit in a merged multireddit feed", () => {
    const merged = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <category term="LocalLLaMA" label="r/LocalLLaMA"/>
        <title>New 8B model</title>
        <link href="https://www.reddit.com/r/LocalLLaMA/comments/a1/new_8b/" />
        <updated>2026-07-26T10:00:00+00:00</updated>
      </entry>
      <entry>
        <category term="Entrepreneur" label="r/Entrepreneur"/>
        <title>First hire</title>
        <link href="https://www.reddit.com/r/Entrepreneur/comments/b2/first_hire/" />
        <updated>2026-07-26T11:00:00+00:00</updated>
      </entry>
    </feed>`;

    const out = normalizeRedditRss(merged, "LocalLLaMA");
    expect(out.map((i) => i.source)).toEqual(["r/LocalLLaMA", "r/Entrepreneur"]);
  });

  it("falls back to the link path when an entry has no category tag", () => {
    const noCat = `<feed><entry>
      <title>Untagged</title>
      <link href="https://www.reddit.com/r/SaaS/comments/c3/untagged/" />
    </entry></feed>`;
    expect(normalizeRedditRss(noCat, "Other")[0].source).toBe("r/SaaS");
  });
});

const interests = (subreddits: string): NewsInterests => ({
  id: "i", createdAt: "", updatedAt: "",
  topics: "", githubLanguages: "", githubTopics: "",
  subreddits, rssFeeds: "", aboutMe: "",
});

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
const fail = (status: number) => ({ ok: false, status, text: async () => "", json: async () => ({}) });

const jsonListing = (sub: string, slug: string) =>
  JSON.stringify({
    data: { children: [{ data: { title: slug, permalink: `/r/${sub}/comments/${slug}/`, score: 5, subreddit: sub } }] },
  });

describe("fetchReddit", () => {
  const saved = { id: process.env.REDDIT_CLIENT_ID, secret: process.env.REDDIT_CLIENT_SECRET };

  beforeEach(() => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.REDDIT_CLIENT_ID = saved.id;
    process.env.REDDIT_CLIENT_SECRET = saved.secret;
    if (saved.id === undefined) delete process.env.REDDIT_CLIENT_ID;
    if (saved.secret === undefined) delete process.env.REDDIT_CLIENT_SECRET;
  });

  it("without credentials, reads the public .rss endpoint (never the blocked .json)", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return ok(atom);
    }));

    const out = await fetchReddit(interests("SaaS"));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/r/SaaS/top.rss");
    expect(seen[0]).not.toContain(".json");
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("r/SaaS");
  });

  it("without credentials, collapses every subreddit into ONE multireddit request", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return ok(atom);
    }));

    await fetchReddit(interests("MachineLearning, LocalLLaMA, SaaS"));

    // Reddit throttles this endpoint to ~2 requests per window, so 3 subs must
    // not become 3 requests.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("/r/MachineLearning+LocalLLaMA+SaaS/top.rss");
  });

  it("throws when the public feed request fails, so 'Reddit' is reported as degraded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(429)));
    await expect(fetchReddit(interests("SaaS, Entrepreneur"))).rejects.toThrow(/429/);
  });

  it("with credentials, keeps the healthy subreddits when one is rate-limited", async () => {
    process.env.REDDIT_CLIENT_ID = "id-partial";
    process.env.REDDIT_CLIENT_SECRET = "secret-partial";

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("access_token")) return ok(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      if (url.includes("LocalLLaMA")) return fail(429);
      const sub = url.includes("MachineLearning") ? "MachineLearning" : "SaaS";
      return ok(jsonListing(sub, sub.toLowerCase()));
    }));

    const out = await fetchReddit(interests("MachineLearning, LocalLLaMA, SaaS"));

    // 2 of 3 subs succeeded — the section must not be blanked by the third.
    expect(out).toHaveLength(2);
  });

  it("with credentials, throws only when every subreddit fails", async () => {
    process.env.REDDIT_CLIENT_ID = "id-allfail";
    process.env.REDDIT_CLIENT_SECRET = "secret-allfail";

    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("access_token")
        ? ok(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : fail(403),
    ));

    await expect(fetchReddit(interests("SaaS, Entrepreneur"))).rejects.toThrow(/all 2 subreddit/);
  });

  it("returns [] without fetching when no subreddits are configured", async () => {
    const fetchMock = vi.fn(async () => ok(atom));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchReddit(interests("  "))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with credentials, authenticates once and reads the OAuth API for every subreddit", async () => {
    process.env.REDDIT_CLIENT_ID = "id-oauth-1";
    process.env.REDDIT_CLIENT_SECRET = "secret-oauth-1";

    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("access_token")) {
        return ok(JSON.stringify({ access_token: "tok-123", expires_in: 86400 }));
      }
      const sub = url.includes("SaaS") ? "SaaS" : "Entrepreneur";
      return ok(jsonListing(sub, sub.toLowerCase()));
    }));

    const out = await fetchReddit(interests("SaaS, Entrepreneur"));

    const tokenCalls = calls.filter((c) => c.url.includes("access_token"));
    expect(tokenCalls).toHaveLength(1); // one token, reused across both subs
    expect(tokenCalls[0].init?.method).toBe("POST");

    const apiCalls = calls.filter((c) => !c.url.includes("access_token"));
    expect(apiCalls).toHaveLength(2);
    for (const c of apiCalls) {
      expect(c.url).toContain("oauth.reddit.com");
      expect((c.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    }

    // OAuth path keeps the JSON fields RSS cannot provide.
    expect(out).toHaveLength(2);
    expect(out[0].score).toBe(5);
  });

  it("falls back to .rss when the token request is rejected", async () => {
    process.env.REDDIT_CLIENT_ID = "id-oauth-bad";
    process.env.REDDIT_CLIENT_SECRET = "secret-oauth-bad";

    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      if (url.includes("access_token")) return fail(401);
      return ok(atom);
    }));

    const out = await fetchReddit(interests("SaaS"));

    expect(seen.some((u) => u.includes("/top.rss"))).toBe(true);
    expect(out).toHaveLength(1);
  });
});
