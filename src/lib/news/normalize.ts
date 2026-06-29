import type { NewsCategory, NewsItem } from "@/lib/types";

/** Deterministic djb2 hash → base36 id. Same url ⇒ same id across refreshes. */
export function itemId(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return "n_" + (h >>> 0).toString(36);
}

/** Remove duplicate items by id, preserving first-seen order. */
export function dedupeItems(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/** Split a comma/newline list into trimmed, non-empty tokens. */
export function parseList(text: string): string[] {
  return (text ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const RSS_CATEGORIES: NewsCategory[] = ["ai", "finance", "products"];

/** Parse rssFeeds lines: "category|url" (category ∈ ai|finance|products) or bare url (→ ai). */
export function parseRssFeeds(text: string): { url: string; category: NewsCategory }[] {
  return (text ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf("|");
      if (bar > -1) {
        const cat = line.slice(0, bar).trim() as NewsCategory;
        const url = line.slice(bar + 1).trim();
        if (RSS_CATEGORIES.includes(cat)) return { url, category: cat };
      }
      return { url: line, category: "ai" as NewsCategory };
    })
    .filter((f) => /^https?:\/\//.test(f.url));
}
