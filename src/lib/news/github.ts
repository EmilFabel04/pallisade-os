import type { NewsInterests, NewsItem } from "@/lib/types";
import { addDaysISO, todayISO } from "@/lib/utils";
import { itemId, parseList } from "./normalize";

interface GithubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count?: number;
  created_at?: string | null;
}

export function normalizeGithub(json: unknown): NewsItem[] {
  const repos = (json as { items?: GithubRepo[] } | null)?.items;
  if (!Array.isArray(repos)) return [];
  return repos.map((r) => ({
    id: itemId(r.html_url),
    title: r.full_name,
    url: r.html_url,
    source: "github",
    category: "github" as const,
    snippet: r.description ?? "",
    score: r.stargazers_count ?? 0,
    publishedAt: r.created_at ?? null,
  }));
}

/** Search repos created in the last 7 days, filtered by the user's languages/topics,
 *  sorted by stars. Uses GITHUB_TOKEN when present for a higher rate limit. */
export async function fetchGithub(interests: NewsInterests): Promise<NewsItem[]> {
  const since = addDaysISO(todayISO(), -7);
  const langs = parseList(interests.githubLanguages).map((l) => `language:${l}`);
  const topics = parseList(interests.githubTopics).map((t) => `topic:${t}`);
  // GitHub OR-combines repeated qualifiers; created: narrows to the last week.
  const q = [`created:>=${since}`, ...langs, ...topics].join(" ");
  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
    `&sort=stars&order=desc&per_page=15`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pallisade-os-news",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return normalizeGithub(await res.json());
}
