import type { NewsInterests, NewsItem } from "@/lib/types";
import { fetchGithub } from "./github";
import { fetchReddit } from "./reddit";
import { fetchRss } from "./rss";
import { dedupeItems } from "./normalize";

type Fetcher = (interests: NewsInterests) => Promise<NewsItem[]>;
export interface Fetchers {
  github: Fetcher;
  reddit: Fetcher;
  rss: Fetcher;
}

const DEFAULT_FETCHERS: Fetchers = { github: fetchGithub, reddit: fetchReddit, rss: fetchRss };

/** Run every structured source independently. A thrown source is recorded in
 *  `degraded` (by display name) and contributes no items, rather than failing
 *  the whole fetch. Results are deduped by id. */
export async function fetchStructured(
  interests: NewsInterests,
  fetchers: Fetchers = DEFAULT_FETCHERS,
): Promise<{ items: NewsItem[]; degraded: string[] }> {
  const jobs: { name: string; run: Fetcher }[] = [
    { name: "GitHub", run: fetchers.github },
    { name: "Reddit", run: fetchers.reddit },
    { name: "RSS", run: fetchers.rss },
  ];

  const items: NewsItem[] = [];
  const degraded: string[] = [];

  await Promise.all(
    jobs.map(async (j) => {
      try {
        items.push(...(await j.run(interests)));
      } catch {
        degraded.push(j.name);
      }
    }),
  );

  return { items: dedupeItems(items), degraded };
}
