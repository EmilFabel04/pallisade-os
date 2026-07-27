import type { NewsInterests, NewsItem } from "@/lib/types";
import { itemId, parseList } from "./normalize";
import { parseRssXml, rssBlocks, toISO } from "./rss";

const UA = "pallisade-os-news/1.0";
const MAX_SUBS = 6;
const PER_SUB = 8;

/* ---------------------------- JSON (OAuth) path ---------------------------- */

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

/* ------------------------------ RSS fallback ------------------------------ */

/** Reddit escapes the post HTML inside <content>, so the markup arrives as
 *  entities (`&lt;p&gt;`) and its own entities arrive double-escaped
 *  (`&amp;#39;`). One pass per layer. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Post body as plain text. Reddit appends a "submitted by … [comments]" footer
 *  to every entry, which is navigation chrome rather than content. */
function contentToSnippet(raw: string): string {
  return decodeEntities(decodeEntities(raw))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*submitted by[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Which subreddit an entry came from. The Atom feed tags each entry with
 *  `<category term="…">`, which is what makes one merged multireddit request
 *  usable in place of one request per subreddit. */
function entrySub(block: string, link: string, fallback: string): string {
  const term = block.match(/<category[^>]*\bterm="([^"]+)"/i)?.[1];
  if (term) return term;
  return link.match(/\/r\/([^/]+)/i)?.[1] ?? fallback;
}

/** Normalize `top.rss` (Atom), single- or multi-subreddit. Carries no upvote
 *  count, so `score` is left undefined rather than faked as 0 — NewsCard then
 *  hides the ★ badge and sorting falls through to recency. */
export function normalizeRedditRss(xml: string, fallbackSub = "reddit"): NewsItem[] {
  return rssBlocks(xml).flatMap((block) => {
    // Reuse the shared parser for title/link/date; <link href> is self-closing here.
    const [entry] = parseRssXml(block);
    if (!entry?.link || !entry.title) return [];
    const raw = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ?? "";
    return [{
      id: itemId(entry.link),
      title: decodeEntities(entry.title),
      url: entry.link,
      source: "r/" + entrySub(block, entry.link, fallbackSub),
      category: "reddit" as const,
      snippet: contentToSnippet(raw),
      publishedAt: toISO(entry.pubDate),
    }];
  });
}

/* -------------------------------- auth ----------------------------------- */

interface TokenCache {
  key: string;
  token: string;
  expiresAt: number;
}
let cached: TokenCache | null = null;

/** App-only OAuth (client_credentials). Keyed by credentials so a rotated
 *  secret invalidates the cache. Returns null when unconfigured or rejected,
 *  which sends the caller down the RSS path. */
async function accessToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  const key = `${id}:${secret}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.token;

  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(key).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    // Renew a minute early so a token never expires mid-fetch.
    cached = {
      key,
      token: json.access_token,
      expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
    };
    return cached.token;
  } catch {
    return null;
  }
}

/* -------------------------------- fetch ---------------------------------- */

async function fetchSubJson(sub: string, token: string): Promise<NewsItem[]> {
  const res = await fetch(
    `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/top?t=day&limit=${PER_SUB}`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`Reddit r/${sub} ${res.status}`);
  return normalizeReddit(await res.json(), sub);
}

/** One merged request for every subreddit via multireddit (`r/a+b+c`).
 *
 *  Measured against the unauthenticated endpoint: 4 concurrent per-subreddit
 *  requests returned 3×429/1×200, and even spaced 1.5s apart only the first two
 *  succeeded — Reddit throttles this endpoint to roughly two requests per
 *  window per IP. Collapsing to a single request avoids the limiter instead of
 *  trying to out-wait it. The cost is a merged "top of day" ranking, so a
 *  quiet subreddit can be crowded out by a busy one. */
async function fetchMultiRss(subs: string[]): Promise<NewsItem[]> {
  const path = subs.map(encodeURIComponent).join("+");
  const res = await fetch(`https://www.reddit.com/r/${path}/top.rss?t=day`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`Reddit r/${path} ${res.status}`);
  return normalizeRedditRss(await res.text(), subs[0]).slice(0, subs.length * PER_SUB);
}

/** Top posts of the day for the configured subreddits.
 *
 *  Reddit blocks unauthenticated JSON access (`/top.json` → 403 for every
 *  User-Agent, browser or not), so there are two routes:
 *
 *  - REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET set → the OAuth API, which allows
 *    100 req/min. Per-subreddit and concurrent, so coverage is balanced and
 *    upvote counts are available. One throttled subreddit costs only its own
 *    items; "Reddit" is reported degraded only if every subreddit fails.
 *  - otherwise → a single public multireddit Atom request (see fetchMultiRss).
 *    No credentials, but no scores and a merged ranking. */
export async function fetchReddit(interests: NewsInterests): Promise<NewsItem[]> {
  const subs = parseList(interests.subreddits).slice(0, MAX_SUBS);
  if (subs.length === 0) return [];

  const token = await accessToken();
  if (!token) return fetchMultiRss(subs);

  const settled = await Promise.allSettled(subs.map((sub) => fetchSubJson(sub, token)));
  const rejected = settled.filter((r) => r.status === "rejected");
  if (rejected.length === subs.length) {
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    throw new Error(
      `Reddit unavailable — all ${subs.length} subreddit(s) failed (${reason instanceof Error ? reason.message : String(reason)})`,
    );
  }

  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
