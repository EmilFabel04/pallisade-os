import type { NewsInterests, NewsItem } from "@/lib/types";
import { itemId, parseList } from "./normalize";

interface RedditPost {
  title: string;
  permalink: string;
  selftext?: string;
  score?: number;
  created_utc?: number;
  subreddit?: string;
}
interface RedditListing {
  data?: { children?: { data: RedditPost }[] };
}

export function normalizeReddit(json: unknown, sub: string): NewsItem[] {
  const children = (json as RedditListing | null)?.data?.children;
  if (!Array.isArray(children)) return [];
  return children
    .filter((c) => c?.data?.permalink)
    .map((c) => {
      const d = c.data;
      const url = "https://reddit.com" + d.permalink;
      return {
        id: itemId(url),
        title: d.title,
        url,
        source: "r/" + (d.subreddit ?? sub),
        category: "reddit" as const,
        snippet: (d.selftext ?? "").slice(0, 240),
        score: d.score ?? 0,
        publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
      };
    });
}

/** Top posts of the day for each configured subreddit. Reddit blocks the default
 *  fetch UA, so a custom User-Agent is required. */
export async function fetchReddit(interests: NewsInterests): Promise<NewsItem[]> {
  const subs = parseList(interests.subreddits).slice(0, 6);
  const results = await Promise.all(
    subs.map(async (sub) => {
      const res = await fetch(
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?t=day&limit=8`,
        { headers: { "User-Agent": "pallisade-os-news/1.0" } },
      );
      if (!res.ok) throw new Error(`Reddit r/${sub} ${res.status}`);
      return normalizeReddit(await res.json(), sub);
    }),
  );
  return results.flat();
}
