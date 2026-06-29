import type { NewsCategory, NewsInterests, NewsItem } from "@/lib/types";
import { itemId, parseRssFeeds } from "./normalize";

/** Inner text of the first <tag>…</tag>, unwrapping CDATA. "" if absent. */
function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

/** RSS uses <link>text</link>; Atom uses <link href="…"/>. */
function pickLink(block: string): string {
  const rss = pick(block, "link");
  if (rss) return rss;
  const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function host(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i);
  return m ? m[1] : "rss";
}

export function parseRssXml(
  xml: string,
): { title: string; link: string; description: string; pubDate: string | null }[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) ?? [];
  return blocks.map((b) => ({
    title: stripTags(pick(b, "title")),
    link: pickLink(b),
    description: stripTags(pick(b, "description") || pick(b, "summary") || pick(b, "content")).slice(0, 240),
    pubDate: pick(b, "pubDate") || pick(b, "updated") || pick(b, "published") || null,
  }));
}

function toISO(pubDate: string | null): string | null {
  if (!pubDate) return null;
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeRss(xml: string, category: NewsCategory): NewsItem[] {
  return parseRssXml(xml)
    .filter((e) => e.link && e.title)
    .map((e) => ({
      id: itemId(e.link),
      title: e.title,
      url: e.link,
      source: host(e.link),
      category,
      snippet: e.description,
      publishedAt: toISO(e.pubDate),
    }));
}

export async function fetchRss(interests: NewsInterests): Promise<NewsItem[]> {
  const feeds = parseRssFeeds(interests.rssFeeds).slice(0, 8);
  const results = await Promise.all(
    feeds.map(async (f) => {
      const res = await fetch(f.url, { headers: { "User-Agent": "pallisade-os-news/1.0" } });
      if (!res.ok) throw new Error(`RSS ${host(f.url)} ${res.status}`);
      return normalizeRss(await res.text(), f.category).slice(0, 6);
    }),
  );
  return results.flat();
}
