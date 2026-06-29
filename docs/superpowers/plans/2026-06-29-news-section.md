# News Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personalized `/news` section that aggregates GitHub repos, Reddit, RSS feeds (AI / SA finance / products), and Claude-`web_search` chatter (X + "cool stuff") into a card feed with an AI top-picks summary, bookmarking, and "Discuss in Brain".

**Architecture:** Mirrors the existing **Brain** feature end-to-end. Structured sources are fetched server-side and normalized into a shared `NewsItem` shape; a Claude tool-loop (`web_search` + a terminal `submit_news` tool) ranks them, writes per-item blurbs and a top-picks digest. The result is cached as a singleton record in the existing SQLite-backed store and rendered as category panels. No cron — fetch is on-demand with a 6h staleness auto-refresh on open.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `@anthropic-ai/sdk`, `node:sqlite` (via existing store seam), `react-markdown` (already a dependency), Vitest.

## Global Constraints

- All domain entity types live in `src/lib/types.ts` (codebase convention — do NOT create `src/lib/news/types.ts`).
- Every entity extends `BaseRecord` (`id`, `createdAt`, `updatedAt` ISO strings).
- Collections are registered in **four** places that must stay in sync: `DataShape` (`src/lib/types.ts`), `EMPTY` (`src/lib/store.tsx`), `COLLECTIONS` (`src/lib/db/sqlite.ts`), and `clear()`'s empty object (`src/lib/db/apiAdapter.ts`). `DataShape`, `EMPTY`, and `clear()` are TypeScript-checked against `DataShape`; `COLLECTIONS` is a plain `as const` array and is the one that silently drifts — guard it with a test.
- AI model env var: `NEWS_MODEL`, default `"claude-sonnet-4-6"` (matches the `BRAIN_MODEL` convention).
- Graceful degradation: with no `ANTHROPIC_API_KEY`, the route returns the raw structured feed (no summary / no `whyItMatters`), never an error.
- Per-source isolation: one failing source adds its name to `degraded[]`; it never breaks the rest.
- Styling: reuse existing primitives (`PageHeader`, `Panel`, `Badge`, `Modal`, `Field`/`TextInput`/`TextArea`, `EmptyState`, `Markdown`) and CSS-var design tokens (`var(--color-*)`, `btn`, `btn-accent`, `btn-ghost`, `chip`). No new UI libraries.
- Tests use Vitest (`describe/it/expect`), colocated as `*.test.ts` next to the unit. Run with `npm test`.

---

### Task 1: Data model + persistence wiring

**Files:**
- Modify: `src/lib/types.ts` (add news entity types; extend `DataShape`; extend `AdvisorSnapshot` Omit)
- Modify: `src/lib/store.tsx` (extend `EMPTY`; add typed selectors)
- Modify: `src/lib/db/sqlite.ts` (add to `COLLECTIONS`; export it)
- Modify: `src/lib/db/apiAdapter.ts` (extend `clear()` empty object)
- Test: `src/lib/db/sqlite.test.ts` (new)

**Interfaces:**
- Produces: `NewsCategory`, `NewsItem`, `NewsFeedData`, `NewsFeed`, `NewsInterests`, `NewsBookmark` (in `types.ts`); `useNewsFeed()`, `useNewsInterests()`, `useNewsBookmarks()` (in `store.tsx`); exported `COLLECTIONS` (in `sqlite.ts`).

- [ ] **Step 1: Add news types to `src/lib/types.ts`**

Insert before the `/* ---------- collections registry ---------- */` section:

```ts
/* ---------- news ---------- */

export type NewsCategory =
  | "github"
  | "ai"
  | "finance"
  | "products"
  | "reddit"
  | "x";

export interface NewsItem {
  id: string;             // stable hash of url (dedupe across refreshes)
  title: string;
  url: string;
  source: string;         // e.g. "github", "r/MachineLearning", "TechCrunch", "x.com"
  category: NewsCategory;
  snippet: string;        // short description / excerpt
  whyItMatters?: string;  // one-line Claude blurb (top items only)
  score?: number;         // upstream signal (stars, upvotes) for sort
  publishedAt: string | null; // ISO when known
}

/** What the /api/news route returns (no BaseRecord fields). */
export interface NewsFeedData {
  items: NewsItem[];
  summary: string;        // top-picks digest (markdown), "" when no AI pass
  fetchedAt: string;      // ISO — drives the 6h staleness check
  degraded: string[];     // names of sources that failed this fetch
}

export interface NewsFeed extends BaseRecord, NewsFeedData {}

export interface NewsInterests extends BaseRecord {
  topics: string;          // free-text keywords, comma/newline separated
  githubLanguages: string; // e.g. "TypeScript, Python"
  githubTopics: string;    // e.g. "llm, agents, rag"
  subreddits: string;      // e.g. "MachineLearning, LocalLLaMA, SaaS"
  rssFeeds: string;        // newline-separated; each line "category|url" or just "url"
  aboutMe: string;         // blurb Claude uses to judge relevance
}

export interface NewsBookmark extends BaseRecord {
  item: NewsItem;          // snapshot, so it survives feed replacement
}
```

- [ ] **Step 2: Register the three collections in `DataShape` and `AdvisorSnapshot`**

In `src/lib/types.ts`, extend `DataShape` (add the three lines before `settings`):

```ts
export interface DataShape {
  leads: Lead[];
  interactions: Interaction[];
  projects: Project[];
  tasks: Task[];
  scorecards: Scorecard[];
  painPoints: PainPoint[];
  conversations: Conversation[];
  playbooks: Playbook[];
  targets: Target[];
  positioningProfiles: PositioningProfile[];
  contentThreads: ContentThread[];
  brainThreads: BrainThread[];
  newsFeed: NewsFeed[];
  newsInterests: NewsInterests[];
  newsBookmarks: NewsBookmark[];
  settings: Settings;
}
```

`AdvisorSnapshot` uses `Omit`, so new keys would leak into it — add them to the omit list:

```ts
export type AdvisorSnapshot = Omit<
  DataShape,
  | "conversations" | "playbooks" | "targets" | "positioningProfiles"
  | "contentThreads" | "brainThreads"
  | "newsFeed" | "newsInterests" | "newsBookmarks"
>;
```

- [ ] **Step 3: Extend `EMPTY` and add selectors in `src/lib/store.tsx`**

Add the three keys to the `EMPTY` object (before `settings`):

```ts
  brainThreads: [],
  newsFeed: [],
  newsInterests: [],
  newsBookmarks: [],
  settings: DEFAULT_SETTINGS,
```

Add the imports `NewsFeed, NewsInterests, NewsBookmark` to the existing `import type { ... } from "./types";` block, and append these selectors at the end of the file:

```ts
export const useNewsFeed = () => (useStore().newsFeed as NewsFeed[])[0] ?? null;
export const useNewsInterests = () =>
  (useStore().newsInterests as NewsInterests[])[0] ?? null;
export const useNewsBookmarks = () => useStore().newsBookmarks as NewsBookmark[];
```

- [ ] **Step 4: Register + export `COLLECTIONS` in `src/lib/db/sqlite.ts`**

Add the three names to the array and export it:

```ts
export const COLLECTIONS = [
  "leads",
  "interactions",
  "projects",
  "tasks",
  "scorecards",
  "painPoints",
  "conversations",
  "playbooks",
  "targets",
  "positioningProfiles",
  "contentThreads",
  "brainThreads",
  "newsFeed",
  "newsInterests",
  "newsBookmarks",
] as const;
```

(Change `const COLLECTIONS` to `export const COLLECTIONS`.)

- [ ] **Step 5: Extend `clear()` empty object in `src/lib/db/apiAdapter.ts`**

Add the three keys to the `empty` object before `settings`:

```ts
      brainThreads: [],
      newsFeed: [],
      newsInterests: [],
      newsBookmarks: [],
      settings: DEFAULT_SETTINGS,
```

- [ ] **Step 6: Write the drift-guard test**

Create `src/lib/db/sqlite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COLLECTIONS } from "./sqlite";

describe("sqlite COLLECTIONS registry", () => {
  it("includes the news collections so they persist", () => {
    expect(COLLECTIONS).toContain("newsFeed");
    expect(COLLECTIONS).toContain("newsInterests");
    expect(COLLECTIONS).toContain("newsBookmarks");
  });
});
```

- [ ] **Step 7: Run the test and the type-check**

Run: `npm test -- src/lib/db/sqlite.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors (confirms `EMPTY`, `clear()`, `DataShape` stay consistent).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/store.tsx src/lib/db/sqlite.ts src/lib/db/apiAdapter.ts src/lib/db/sqlite.test.ts
git commit -m "feat(news): register news data model + persistence wiring"
```

---

### Task 2: News defaults + normalize helpers

**Files:**
- Create: `src/lib/news/defaults.ts`
- Create: `src/lib/news/normalize.ts`
- Test: `src/lib/news/normalize.test.ts`

**Interfaces:**
- Produces: `DEFAULT_NEWS_INTERESTS` (`Omit<NewsInterests,"id"|"createdAt"|"updatedAt">`), `CATEGORY_LABELS: Record<NewsCategory,string>`, `CATEGORY_ORDER: NewsCategory[]`, `categoryTone(c)`; `itemId(url)`, `dedupeItems(items)`, `parseList(text)`, `parseRssFeeds(text)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/news/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { itemId, dedupeItems, parseList, parseRssFeeds } from "./normalize";
import type { NewsItem } from "@/lib/types";

const item = (url: string): NewsItem => ({
  id: itemId(url),
  title: url,
  url,
  source: "x",
  category: "ai",
  snippet: "",
  publishedAt: null,
});

describe("news normalize helpers", () => {
  it("itemId is deterministic and stable for the same url", () => {
    expect(itemId("https://a.com/x")).toBe(itemId("https://a.com/x"));
    expect(itemId("https://a.com/x")).not.toBe(itemId("https://a.com/y"));
  });

  it("dedupeItems collapses items with the same url/id, keeping first", () => {
    const out = dedupeItems([item("https://a.com/1"), item("https://a.com/1"), item("https://a.com/2")]);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.url)).toEqual(["https://a.com/1", "https://a.com/2"]);
  });

  it("parseList splits on commas and newlines and trims", () => {
    expect(parseList("TypeScript, Python\n Go ,")).toEqual(["TypeScript", "Python", "Go"]);
    expect(parseList("")).toEqual([]);
  });

  it("parseRssFeeds reads optional 'category|url' prefix, defaults to ai, drops non-urls", () => {
    const out = parseRssFeeds("finance|https://f.com/rss\nhttps://a.com/feed\nnot a url");
    expect(out).toEqual([
      { url: "https://f.com/rss", category: "finance" },
      { url: "https://a.com/feed", category: "ai" },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/news/normalize.test.ts`
Expected: FAIL ("Cannot find module './normalize'").

- [ ] **Step 3: Write `src/lib/news/normalize.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/news/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/lib/news/defaults.ts`**

```ts
import type { NewsCategory, NewsInterests } from "@/lib/types";
import type { Tone } from "@/lib/badges";

/** Seeded on first visit; the user edits it in the interests modal. */
export const DEFAULT_NEWS_INTERESTS: Omit<
  NewsInterests,
  "id" | "createdAt" | "updatedAt"
> = {
  topics: "AI agents, RAG, LLM tooling, developer tools, B2B SaaS, automation",
  githubLanguages: "TypeScript, Python",
  githubTopics: "llm, agents, rag, ai",
  subreddits: "MachineLearning, LocalLLaMA, SaaS, Entrepreneur",
  rssFeeds: [
    "ai|https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "finance|https://www.moneyweb.co.za/feed/",
    "products|https://news.ycombinator.com/rss",
  ].join("\n"),
  aboutMe:
    "Solo B2B agency founder in South Africa building bespoke AI systems, " +
    "automation and custom software for boutique asset managers and B2B service businesses.",
};

export const CATEGORY_ORDER: NewsCategory[] = [
  "github",
  "ai",
  "finance",
  "products",
  "reddit",
  "x",
];

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  github: "GitHub",
  ai: "AI News",
  finance: "SA Finance",
  products: "Products & Tricks",
  reddit: "Reddit",
  x: "X",
};

export function categoryTone(c: NewsCategory): Tone {
  switch (c) {
    case "github": return "info";
    case "ai": return "accent";
    case "finance": return "positive";
    case "products": return "warning";
    case "reddit": return "neutral";
    case "x": return "muted";
    default: return "neutral";
  }
}
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/news/defaults.ts src/lib/news/normalize.ts src/lib/news/normalize.test.ts
git commit -m "feat(news): defaults + normalize/parse helpers"
```

---

### Task 3: GitHub source

**Files:**
- Create: `src/lib/news/github.ts`
- Test: `src/lib/news/github.test.ts`

**Interfaces:**
- Consumes: `itemId` (Task 2), `parseList` (Task 2).
- Produces: `normalizeGithub(json): NewsItem[]`, `fetchGithub(interests): Promise<NewsItem[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/news/github.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeGithub } from "./github";

const sample = {
  items: [
    {
      full_name: "acme/agent-kit",
      html_url: "https://github.com/acme/agent-kit",
      description: "A toolkit for building agents",
      stargazers_count: 1234,
      language: "TypeScript",
      created_at: "2026-06-25T10:00:00Z",
    },
    { full_name: "n/d", html_url: "https://github.com/n/d", description: null, stargazers_count: 5, created_at: null },
  ],
};

describe("normalizeGithub", () => {
  it("maps repos to NewsItem with category github and star score", () => {
    const out = normalizeGithub(sample);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "acme/agent-kit",
      url: "https://github.com/acme/agent-kit",
      source: "github",
      category: "github",
      snippet: "A toolkit for building agents",
      score: 1234,
      publishedAt: "2026-06-25T10:00:00Z",
    });
    expect(out[0].id).toBeTruthy();
    expect(out[1].snippet).toBe("");      // null description → ""
    expect(out[1].publishedAt).toBeNull();
  });

  it("returns [] for a malformed payload", () => {
    expect(normalizeGithub({})).toEqual([]);
    expect(normalizeGithub(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/news/github.test.ts`
Expected: FAIL ("Cannot find module './github'").

- [ ] **Step 3: Write `src/lib/news/github.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/news/github.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/github.ts src/lib/news/github.test.ts
git commit -m "feat(news): github source fetch + normalize"
```

---

### Task 4: Reddit source

**Files:**
- Create: `src/lib/news/reddit.ts`
- Test: `src/lib/news/reddit.test.ts`

**Interfaces:**
- Consumes: `itemId` (Task 2), `parseList` (Task 2).
- Produces: `normalizeReddit(json, sub): NewsItem[]`, `fetchReddit(interests): Promise<NewsItem[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/news/reddit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/news/reddit.test.ts`
Expected: FAIL ("Cannot find module './reddit'").

- [ ] **Step 3: Write `src/lib/news/reddit.ts`**

```ts
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
  return children.map((c) => {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/news/reddit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/reddit.ts src/lib/news/reddit.test.ts
git commit -m "feat(news): reddit source fetch + normalize"
```

---

### Task 5: RSS source

**Files:**
- Create: `src/lib/news/rss.ts`
- Test: `src/lib/news/rss.test.ts`

**Interfaces:**
- Consumes: `itemId` (Task 2), `parseRssFeeds` (Task 2).
- Produces: `parseRssXml(xml): { title; link; description; pubDate }[]`, `normalizeRss(xml, category): NewsItem[]`, `fetchRss(interests): Promise<NewsItem[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/news/rss.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRssXml, normalizeRss } from "./rss";

const rss = `<?xml version="1.0"?><rss><channel>
  <item>
    <title><![CDATA[GPT-X released]]></title>
    <link>https://news.example.com/gpt-x</link>
    <description><![CDATA[<p>A <b>big</b> model drop with new tools.</p>]]></description>
    <pubDate>Wed, 24 Jun 2026 08:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?><feed>
  <entry>
    <title>Atom item</title>
    <link href="https://atom.example.com/a" />
    <summary>Short summary</summary>
    <updated>2026-06-24T08:00:00Z</updated>
  </entry>
</feed>`;

describe("parseRssXml", () => {
  it("parses RSS items, unwraps CDATA, strips HTML from description", () => {
    const out = parseRssXml(rss);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("GPT-X released");
    expect(out[0].link).toBe("https://news.example.com/gpt-x");
    expect(out[0].description).toBe("A big model drop with new tools.");
    expect(out[0].pubDate).toBe("Wed, 24 Jun 2026 08:00:00 GMT");
  });

  it("parses Atom entries with href links and summary", () => {
    const out = parseRssXml(atom);
    expect(out[0].title).toBe("Atom item");
    expect(out[0].link).toBe("https://atom.example.com/a");
    expect(out[0].description).toBe("Short summary");
  });
});

describe("normalizeRss", () => {
  it("maps to NewsItem with the given category and ISO publishedAt", () => {
    const out = normalizeRss(rss, "ai");
    expect(out[0]).toMatchObject({
      title: "GPT-X released",
      url: "https://news.example.com/gpt-x",
      category: "ai",
    });
    expect(out[0].publishedAt).toBe(new Date("Wed, 24 Jun 2026 08:00:00 GMT").toISOString());
    expect(out[0].source).toBe("news.example.com");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/news/rss.test.ts`
Expected: FAIL ("Cannot find module './rss'").

- [ ] **Step 3: Write `src/lib/news/rss.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/news/rss.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/rss.ts src/lib/news/rss.test.ts
git commit -m "feat(news): rss source parse + normalize"
```

---

### Task 6: Structured aggregation

**Files:**
- Create: `src/lib/news/sources.ts`
- Test: `src/lib/news/sources.test.ts`

**Interfaces:**
- Consumes: `fetchGithub`, `fetchReddit`, `fetchRss` (Tasks 3–5), `dedupeItems` (Task 2).
- Produces: `fetchStructured(interests, fetchers?): Promise<{ items: NewsItem[]; degraded: string[] }>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/news/sources.test.ts`. It injects fake fetchers so no network is hit and asserts per-source isolation + dedupe:

```ts
import { describe, it, expect } from "vitest";
import { fetchStructured } from "./sources";
import { itemId } from "./normalize";
import type { NewsItem } from "@/lib/types";

const interests = {
  id: "i", createdAt: "", updatedAt: "",
  topics: "", githubLanguages: "", githubTopics: "", subreddits: "", rssFeeds: "", aboutMe: "",
};

const mk = (url: string, category: NewsItem["category"]): NewsItem => ({
  id: itemId(url), title: url, url, source: "s", category, snippet: "", publishedAt: null,
});

describe("fetchStructured", () => {
  it("merges sources, dedupes by id, and isolates a failing source into degraded", async () => {
    const out = await fetchStructured(interests, {
      github: async () => [mk("https://g/1", "github"), mk("https://dup", "github")],
      reddit: async () => { throw new Error("boom"); },
      rss: async () => [mk("https://dup", "ai")],
    });
    expect(out.degraded).toEqual(["Reddit"]);
    const urls = out.items.map((i) => i.url).sort();
    expect(urls).toEqual(["https://dup", "https://g/1"]); // dup collapsed
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/news/sources.test.ts`
Expected: FAIL ("Cannot find module './sources'").

- [ ] **Step 3: Write `src/lib/news/sources.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/news/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/news/sources.ts src/lib/news/sources.test.ts
git commit -m "feat(news): structured source aggregation with per-source isolation"
```

---

### Task 7: Curation pass (prompt + Claude tool-loop)

**Files:**
- Create: `src/lib/news/prompt.ts`
- Create: `src/lib/news/curate.ts`
- Test: `src/lib/news/curate.test.ts`

**Interfaces:**
- Consumes: `itemId` (Task 2), `NewsInterests`, `NewsItem`, `NewsFeedData` (Task 1).
- Produces: `buildNewsSystemPrompt({interests, today, items})` (`prompt.ts`); `SUBMIT_NEWS_TOOL`, `Submission`, `buildStructuredFeed(items, degraded, fetchedAt)`, `applySubmission(items, submission, degraded, fetchedAt)`, `curate({client, model, interests, items, degraded, today, fetchedAt})` (`curate.ts`).

- [ ] **Step 1: Write the failing test (pure helpers only — no network)**

Create `src/lib/news/curate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/news/curate.test.ts`
Expected: FAIL ("Cannot find module './curate'").

- [ ] **Step 3: Write `src/lib/news/prompt.ts`**

```ts
import type { NewsInterests, NewsItem } from "@/lib/types";

/** System prompt for the curation pass. Embeds the interests profile and the
 *  already-fetched structured items so Claude ranks them and fills gaps. */
export function buildNewsSystemPrompt(params: {
  interests: NewsInterests;
  today: string;
  items: NewsItem[];
}): string {
  const { interests, today, items } = params;
  const itemLines = items
    .map((i) => `- [${i.id}] (${i.category}) ${i.title} — ${i.source}${i.snippet ? ` — ${i.snippet.slice(0, 120)}` : ""}`)
    .join("\n");

  return [
    `You are the news curator inside Pallisade OS. Today is ${today}.`,
    ``,
    `THE FOUNDER:`,
    interests.aboutMe,
    ``,
    `THEIR INTERESTS: ${interests.topics}`,
    ``,
    `You are given a list of already-fetched items (GitHub repos, Reddit posts, RSS articles).`,
    `Your job:`,
    `1. Use web_search to find a FEW high-signal extra items the founder would care about, focused on`,
    `   X/Twitter chatter and "cool things people are building/sharing" not already in the list.`,
    `2. Pick the most relevant items overall and write a one-line "why this matters to you" for each (max ~12 words).`,
    `3. Write a short markdown "Top Picks" summary (3-6 bullets) of what's most worth their time today.`,
    `Finally, call the submit_news tool exactly once with your result. Do not write a normal text reply.`,
    ``,
    `ALREADY-FETCHED ITEMS (reference picks by their [id]):`,
    itemLines || "(none)",
  ].join("\n");
}
```

- [ ] **Step 4: Write `src/lib/news/curate.ts`**

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { NewsCategory, NewsFeedData, NewsInterests, NewsItem } from "@/lib/types";
import { itemId, dedupeItems } from "./normalize";
import { buildNewsSystemPrompt } from "./prompt";

const MAX_ITERATIONS = 6;
const CATEGORIES: NewsCategory[] = ["github", "ai", "finance", "products", "reddit", "x"];

export interface Submission {
  summary: string;
  picks: { id: string; whyItMatters: string }[];
  extra: { title: string; url: string; source: string; category: NewsCategory; snippet: string }[];
}

/** The terminal tool the model calls once with its curated result. */
export const SUBMIT_NEWS_TOOL = {
  name: "submit_news",
  description: "Submit the final curated news: a markdown top-picks summary, per-item blurbs, and any extra items found via search.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Markdown 'Top Picks' summary, 3-6 bullets." },
      picks: {
        type: "array",
        description: "Relevance blurbs for the most important already-fetched items.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "the [id] of an already-fetched item" },
            whyItMatters: { type: "string", description: "one line, max ~12 words" },
          },
          required: ["id", "whyItMatters"],
        },
      },
      extra: {
        type: "array",
        description: "New items found via web_search (esp. X chatter / cool builds).",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            source: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
            snippet: { type: "string" },
          },
          required: ["title", "url", "source", "category", "snippet"],
        },
      },
    },
    required: ["summary", "picks", "extra"],
  },
};

/** No-AI feed: structured items as-is, no summary. */
export function buildStructuredFeed(
  items: NewsItem[],
  degraded: string[],
  fetchedAt: string,
): NewsFeedData {
  return { items, summary: "", fetchedAt, degraded };
}

/** Merge Claude's submission into the structured items. */
export function applySubmission(
  items: NewsItem[],
  submission: Submission,
  degraded: string[],
  fetchedAt: string,
): NewsFeedData {
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  for (const p of submission.picks ?? []) {
    const it = byId.get(p.id);
    if (it) it.whyItMatters = p.whyItMatters;
  }
  const extras: NewsItem[] = (submission.extra ?? [])
    .filter((e) => /^https?:\/\//.test(e.url) && e.title)
    .map((e) => ({
      id: itemId(e.url),
      title: e.title,
      url: e.url,
      source: e.source || "web",
      category: CATEGORIES.includes(e.category) ? e.category : "x",
      snippet: e.snippet ?? "",
      publishedAt: null,
    }));
  return {
    items: dedupeItems([...byId.values(), ...extras]),
    summary: submission.summary ?? "",
    fetchedAt,
    degraded,
  };
}

/** Run the curation tool-loop. Falls back to the structured feed on any failure. */
export async function curate(params: {
  client: Anthropic;
  model: string;
  interests: NewsInterests;
  items: NewsItem[];
  degraded: string[];
  today: string;
  fetchedAt: string;
}): Promise<NewsFeedData> {
  const { client, model, interests, items, degraded, today, fetchedAt } = params;
  const system = buildNewsSystemPrompt({ interests, today, items });
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 4 },
    SUBMIT_NEWS_TOOL,
  ] as unknown as Anthropic.Tool[];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Curate today's news for me." },
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await client.messages.create({ model, max_tokens: 4096, system, tools, messages });

      const submit = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_news",
      );
      if (submit) return applySubmission(items, submit.input as Submission, degraded, fetchedAt);

      // web_search runs server-side and may pause; resume by re-sending.
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      if (res.stop_reason !== "tool_use") break;
      // Any other tool_use (only web_search exists server-side) — just continue the loop.
      messages.push({ role: "assistant", content: res.content });
    }
  } catch {
    /* fall through to structured feed */
  }
  return buildStructuredFeed(items, degraded, fetchedAt);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/lib/news/curate.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/news/prompt.ts src/lib/news/curate.ts src/lib/news/curate.test.ts
git commit -m "feat(news): claude curation pass (prompt + tool-loop + merge)"
```

---

### Task 8: API route `/api/news`

**Files:**
- Create: `src/app/api/news/route.ts`
- Modify: `.env.example` (document `GITHUB_TOKEN`, `NEWS_MODEL`)

**Interfaces:**
- Consumes: `fetchStructured` (Task 6), `curate` / `buildStructuredFeed` (Task 7), `NewsInterests`, `NewsFeedData` (Task 1).
- Produces: `GET → { configured, github, model }`; `POST { interests } → NewsFeedData`.

- [ ] **Step 1: Write `src/app/api/news/route.ts`**

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { NewsInterests } from "@/lib/types";
import { fetchStructured } from "@/lib/news/sources";
import { curate, buildStructuredFeed } from "@/lib/news/curate";
import { nowISO, todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.NEWS_MODEL || "claude-sonnet-4-6";

export async function GET() {
  return NextResponse.json({
    configured: !!process.env.ANTHROPIC_API_KEY,
    github: !!process.env.GITHUB_TOKEN,
    model: MODEL,
  });
}

interface NewsRequest {
  interests?: NewsInterests;
}

export async function POST(req: Request) {
  let body: NewsRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.interests) {
    return NextResponse.json({ error: "missing_interests" }, { status: 400 });
  }

  const interests = body.interests;
  const fetchedAt = nowISO();

  let structured: { items: import("@/lib/types").NewsItem[]; degraded: string[] };
  try {
    structured = await fetchStructured(interests);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful degradation: raw structured feed, no AI layer.
    return NextResponse.json(buildStructuredFeed(structured.items, structured.degraded, fetchedAt));
  }

  const client = new Anthropic({ apiKey });
  const feed = await curate({
    client,
    model: MODEL,
    interests,
    items: structured.items,
    degraded: structured.degraded,
    today: todayISO(),
    fetchedAt,
  });
  return NextResponse.json(feed);
}
```

- [ ] **Step 2: Document env vars in `.env.example`**

Append:

```bash
# News section (all optional)
# Raises the GitHub Search API rate limit; the feed works unauthenticated too.
GITHUB_TOKEN=
# Override the model used for news curation (defaults to claude-sonnet-4-6).
NEWS_MODEL=
```

- [ ] **Step 3: Type-check and smoke-test the route**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run dev` then in another shell:
```bash
curl -s localhost:3000/api/news | head
```
Expected: JSON like `{"configured":true,"github":false,"model":"claude-sonnet-4-6"}`.

Then test a refresh (uses the default interests inline):
```bash
curl -s -X POST localhost:3000/api/news -H 'content-type: application/json' \
  -d '{"interests":{"id":"i","createdAt":"","updatedAt":"","topics":"AI agents","githubLanguages":"TypeScript","githubTopics":"llm","subreddits":"MachineLearning","rssFeeds":"ai|https://news.ycombinator.com/rss","aboutMe":"AI builder"}}' | head -c 400
```
Expected: JSON with `items`, `summary`, `fetchedAt`, `degraded` keys (items array non-empty if GitHub/RSS reachable).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/news/route.ts .env.example
git commit -m "feat(news): /api/news route (status + refresh with graceful degradation)"
```

---

### Task 9: News client lib

**Files:**
- Create: `src/lib/newsClient.ts`
- Test: `src/lib/newsClient.test.ts`

**Interfaces:**
- Consumes: `/api/news` (Task 8), `NewsInterests`, `NewsFeedData` (Task 1).
- Produces: `getNewsStatus(): Promise<{ configured; github; model }>`, `refreshNews(interests): Promise<NewsFeedData>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/newsClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getNewsStatus, refreshNews } from "./newsClient";

const interests = {
  id: "i", createdAt: "", updatedAt: "",
  topics: "", githubLanguages: "", githubTopics: "", subreddits: "", rssFeeds: "", aboutMe: "",
};

afterEach(() => vi.unstubAllGlobals());

describe("newsClient", () => {
  it("getNewsStatus returns a safe default when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await getNewsStatus()).toEqual({ configured: false, github: false, model: "" });
  });

  it("refreshNews posts interests and returns the feed data", async () => {
    const feed = { items: [], summary: "hi", fetchedAt: "t", degraded: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => feed }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await refreshNews(interests);
    expect(out).toEqual(feed);
    expect(fetchMock).toHaveBeenCalledWith("/api/news", expect.objectContaining({ method: "POST" }));
  });

  it("refreshNews throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "boom" }) })));
    await expect(refreshNews(interests)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/newsClient.test.ts`
Expected: FAIL ("Cannot find module './newsClient'").

- [ ] **Step 3: Write `src/lib/newsClient.ts`**

```ts
import type { NewsFeedData, NewsInterests } from "./types";

export async function getNewsStatus(): Promise<{ configured: boolean; github: boolean; model: string }> {
  try {
    const res = await fetch("/api/news", { method: "GET" });
    if (!res.ok) return { configured: false, github: false, model: "" };
    return (await res.json()) as { configured: boolean; github: boolean; model: string };
  } catch {
    return { configured: false, github: false, model: "" };
  }
}

export async function refreshNews(interests: NewsInterests): Promise<NewsFeedData> {
  const res = await fetch("/api/news", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interests }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    throw new Error(typeof err.error === "string" ? err.error : "The news refresh failed.");
  }
  return (await res.json()) as NewsFeedData;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/newsClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/newsClient.ts src/lib/newsClient.test.ts
git commit -m "feat(news): news client lib (status + refresh)"
```

---

### Task 10: News card + interests modal components

**Files:**
- Create: `src/components/news/NewsCard.tsx`
- Create: `src/components/news/NewsInterestsModal.tsx`

**Interfaces:**
- Consumes: `NewsItem`, `NewsInterests` (Task 1); `Badge`, `Modal`, `Field`/`TextInput`/`TextArea`; `categoryTone` (Task 2); `timeAgo` (utils).
- Produces: `NewsCard({ item, bookmarked, onBookmark, onDiscuss })`; `NewsInterestsModal({ open, interests, onClose, onSave })`.

- [ ] **Step 1: Write `src/components/news/NewsCard.tsx`**

```tsx
"use client";

import { Bookmark, BookmarkCheck, MessageSquarePlus, ArrowUpRight } from "lucide-react";
import type { NewsItem } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { categoryTone } from "@/lib/news/defaults";
import { timeAgo } from "@/lib/utils";

export function NewsCard({
  item,
  bookmarked,
  onBookmark,
  onDiscuss,
}: {
  item: NewsItem;
  bookmarked: boolean;
  onBookmark: (item: NewsItem) => void;
  onDiscuss: (item: NewsItem) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Badge tone={categoryTone(item.category)} dot={false}>{item.source}</Badge>
        {item.publishedAt && (
          <span className="text-[0.7rem] text-[var(--color-dim)]">{timeAgo(item.publishedAt)}</span>
        )}
        {typeof item.score === "number" && item.score > 0 && (
          <span className="text-[0.7rem] text-[var(--color-dim)]">★ {item.score}</span>
        )}
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="text-[0.88rem] font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)] inline-flex items-start gap-1 leading-snug"
      >
        {item.title}
        <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-[var(--color-dim)]" />
      </a>

      {item.snippet && (
        <p className="text-[0.78rem] text-[var(--color-muted)] leading-relaxed line-clamp-2">{item.snippet}</p>
      )}
      {item.whyItMatters && (
        <p className="text-[0.76rem] text-[var(--color-accent)] leading-snug">→ {item.whyItMatters}</p>
      )}

      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={() => onBookmark(item)}
          className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--color-dim)] hover:text-[var(--color-ink)]"
          title={bookmarked ? "Remove bookmark" : "Bookmark"}
        >
          {bookmarked ? <BookmarkCheck size={13} className="text-[var(--color-accent)]" /> : <Bookmark size={13} />}
          {bookmarked ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => onDiscuss(item)}
          className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--color-dim)] hover:text-[var(--color-ink)]"
          title="Discuss in Brain"
        >
          <MessageSquarePlus size={13} /> Discuss in Brain
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/news/NewsInterestsModal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { NewsInterests } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea } from "@/components/ui/Field";

type Editable = Pick<
  NewsInterests,
  "topics" | "githubLanguages" | "githubTopics" | "subreddits" | "rssFeeds" | "aboutMe"
>;

export function NewsInterestsModal({
  open,
  interests,
  onClose,
  onSave,
}: {
  open: boolean;
  interests: NewsInterests;
  onClose: () => void;
  onSave: (patch: Editable) => void;
}) {
  const [form, setForm] = useState<Editable>(interests);

  useEffect(() => { setForm(interests); }, [interests, open]);

  const set = (k: keyof Editable) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="News interests"
      subtitle="Tune what the feed pulls and how it judges relevance."
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={() => { onSave(form); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Topics & keywords" hint="Comma-separated; used to rank and judge relevance.">
          <TextInput value={form.topics} onChange={set("topics")} placeholder="AI agents, RAG, automation" />
        </Field>
        <Field label="GitHub languages" hint="Comma-separated, e.g. TypeScript, Python">
          <TextInput value={form.githubLanguages} onChange={set("githubLanguages")} />
        </Field>
        <Field label="GitHub topics" hint="Comma-separated, e.g. llm, agents, rag">
          <TextInput value={form.githubTopics} onChange={set("githubTopics")} />
        </Field>
        <Field label="Subreddits" hint="Comma-separated, no r/ prefix">
          <TextInput value={form.subreddits} onChange={set("subreddits")} />
        </Field>
        <Field label="RSS feeds" hint="One per line. Prefix with a category: ai|url, finance|url, products|url (bare url ⇒ ai).">
          <TextArea rows={4} value={form.rssFeeds} onChange={set("rssFeeds")} />
        </Field>
        <Field label="About me" hint="Helps Claude judge what's relevant to you.">
          <TextArea rows={3} value={form.aboutMe} onChange={set("aboutMe")} />
        </Field>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/components/news/NewsCard.tsx src/components/news/NewsInterestsModal.tsx
git commit -m "feat(news): NewsCard + NewsInterestsModal components"
```

---

### Task 11: News page

**Files:**
- Create: `src/app/news/page.tsx`

**Interfaces:**
- Consumes: store (`useStore`, `useNewsFeed`, `useNewsInterests`, `useNewsBookmarks`), `refreshNews`/`getNewsStatus` (Task 9), `NewsCard`/`NewsInterestsModal` (Task 10), `DEFAULT_NEWS_INTERESTS`/`CATEGORY_ORDER`/`CATEGORY_LABELS` (Task 2), `Markdown`, `Panel`, `PageHeader`, `EmptyState`.

- [ ] **Step 1: Write `src/app/news/page.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Newspaper, RefreshCw, Settings2, Loader2, Bookmark } from "lucide-react";
import { useStore, useNewsFeed, useNewsInterests, useNewsBookmarks } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Markdown } from "@/components/advisor/Markdown";
import { NewsCard } from "@/components/news/NewsCard";
import { NewsInterestsModal } from "@/components/news/NewsInterestsModal";
import { getNewsStatus, refreshNews } from "@/lib/newsClient";
import { DEFAULT_NEWS_INTERESTS, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/news/defaults";
import type { NewsInterests, NewsItem } from "@/lib/types";
import { timeAgo, uid, nowISO } from "@/lib/utils";

const STALE_MS = 6 * 60 * 60 * 1000;

export default function NewsPage() {
  const store = useStore();
  const feed = useNewsFeed();
  const interests = useNewsInterests();
  const bookmarks = useNewsBookmarks();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showInterests, setShowInterests] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [autoTried, setAutoTried] = useState(false);

  useEffect(() => { getNewsStatus().then((s) => setConfigured(s.configured)); }, []);

  // Ensure an interests record exists (seed on first visit).
  const ensureInterests = (): NewsInterests => {
    if (interests) return interests;
    return store.create("newsInterests", { ...DEFAULT_NEWS_INTERESTS }) as NewsInterests;
  };

  // Upsert the singleton feed record.
  const saveFeed = (data: { items: NewsItem[]; summary: string; fetchedAt: string; degraded: string[] }) => {
    if (feed) store.update("newsFeed", feed.id, data);
    else store.create("newsFeed", data as Omit<typeof data, never>);
  };

  const refresh = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const data = await refreshNews(ensureInterests());
      saveFeed(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh once if the cache is missing or stale (>6h) and AI is configured.
  useEffect(() => {
    if (!store.ready || autoTried || configured === null) return;
    const stale = !feed || Date.now() - Date.parse(feed.fetchedAt) > STALE_MS;
    if (stale) { setAutoTried(true); void refresh(); }
    else setAutoTried(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready, configured, autoTried]);

  const bookmarkedIds = useMemo(() => new Set(bookmarks.map((b) => b.item.id)), [bookmarks]);

  const toggleBookmark = (item: NewsItem) => {
    const existing = bookmarks.find((b) => b.item.id === item.id);
    if (existing) store.remove("newsBookmarks", existing.id);
    else store.create("newsBookmarks", { item });
  };

  const discussInBrain = (item: NewsItem) => {
    const seed = `Let's dig into this and brainstorm what it means for me / what I could build:\n\n**${item.title}**\n${item.url}\n${item.snippet ?? ""}`;
    const thread = store.create("brainThreads", {
      title: item.title.slice(0, 48),
      mode: "brainstorm",
      messages: [{ id: uid("msg"), role: "user", content: seed, createdAt: nowISO() }],
      attachments: [],
    });
    router.push(`/brain?thread=${thread.id}`);
  };

  const visibleItems = showSaved ? bookmarks.map((b) => b.item) : feed?.items ?? [];
  const byCategory = useMemo(() => {
    const map = new Map<string, NewsItem[]>();
    for (const it of visibleItems) {
      const arr = map.get(it.category) ?? [];
      arr.push(it);
      map.set(it.category, arr);
    }
    // Sort each bucket by score desc, then recency.
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
    }
    return map;
  }, [visibleItems]);

  const hasAnything = visibleItems.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="News"
        subtitle={feed ? `Updated ${timeAgo(feed.fetchedAt)}` : "Your personalized feed — GitHub, AI, SA finance, products, Reddit & X."}
        actions={
          <>
            <button
              className={`btn ${showSaved ? "btn-accent" : ""}`}
              onClick={() => setShowSaved((s) => !s)}
              title="Saved items"
            >
              <Bookmark size={15} /> Saved{bookmarks.length ? ` (${bookmarks.length})` : ""}
            </button>
            <button className="btn btn-ghost btn-icon" onClick={() => setShowInterests(true)} title="News interests">
              <Settings2 size={16} />
            </button>
            <button className="btn btn-accent" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh
            </button>
          </>
        }
      />

      {configured === false && (
        <Panel>
          <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed p-1">
            No <code>ANTHROPIC_API_KEY</code> — showing the raw feed without the AI summary. Add the key to{" "}
            <code>.env.local</code> and restart for top picks and relevance blurbs.
          </p>
        </Panel>
      )}

      {error && <p className="text-[0.8rem] text-[var(--color-accent)]">{error}</p>}

      {feed?.degraded?.length ? (
        <p className="text-[0.76rem] text-[var(--color-dim)]">Couldn’t load: {feed.degraded.join(", ")}.</p>
      ) : null}

      {!showSaved && feed?.summary && (
        <Panel title="Top Picks">
          <Markdown>{feed.summary}</Markdown>
        </Panel>
      )}

      {!hasAnything ? (
        <Panel>
          <EmptyState
            icon={showSaved ? Bookmark : Newspaper}
            title={showSaved ? "No saved items yet" : "No news yet"}
            message={showSaved ? "Bookmark items from the feed and they’ll show up here." : "Hit Refresh to pull the latest relevant news."}
            action={
              !showSaved ? (
                <button className="btn btn-accent" onClick={() => void refresh()} disabled={loading}>
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
                </button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {CATEGORY_ORDER.filter((c) => (byCategory.get(c)?.length ?? 0) > 0).map((c) => (
            <Panel key={c} title={CATEGORY_LABELS[c]}>
              <div className="flex flex-col gap-2.5">
                {byCategory.get(c)!.map((item) => (
                  <NewsCard
                    key={item.id}
                    item={item}
                    bookmarked={bookmarkedIds.has(item.id)}
                    onBookmark={toggleBookmark}
                    onDiscuss={discussInBrain}
                  />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {interests && (
        <NewsInterestsModal
          open={showInterests}
          interests={interests}
          onClose={() => setShowInterests(false)}
          onSave={(patch) => store.update("newsInterests", interests.id, patch)}
        />
      )}
      {!interests && showInterests && (
        <NewsInterestsModal
          open={showInterests}
          interests={ensureInterests()}
          onClose={() => setShowInterests(false)}
          onSave={(patch) => {
            const created = ensureInterests();
            store.update("newsInterests", created.id, patch);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/news`.
Verify:
- The page auto-refreshes on first open; category panels (GitHub / AI News / SA Finance / Products / Reddit / X) populate.
- "Top Picks" renders markdown (when `ANTHROPIC_API_KEY` is set).
- Bookmark a card → toggle to "Saved"; click the **Saved** toggle → only bookmarks show; reload the page → bookmarks persist.
- Open the gear → edit an interest → Save → Refresh reflects it.

- [ ] **Step 4: Commit**

```bash
git add src/app/news/page.tsx
git commit -m "feat(news): news page (feed, top picks, bookmarks, interests)"
```

---

### Task 12: Nav entry + Brain deep-link

**Files:**
- Modify: `src/components/layout/nav.ts`
- Modify: `src/app/brain/page.tsx`

**Interfaces:**
- Consumes: nav config; Brain page `selectThread`.
- Produces: `/news` nav item; `/brain?thread=<id>` opens the named thread.

- [ ] **Step 1: Add the nav entry in `src/components/layout/nav.ts`**

Add `Newspaper` to the lucide import list, then add the item under the Intelligence group (after Brain):

```ts
  { href: "/brain", label: "Brain", icon: BrainCircuit, group: "Intelligence" },
  { href: "/news", label: "News", icon: Newspaper, group: "Intelligence" },
  { href: "/prep", label: "Meeting Prep", icon: GraduationCap, group: "Intelligence" },
```

- [ ] **Step 2: Open a thread from the `?thread=` param in `src/app/brain/page.tsx`**

Add `useSearchParams` to the existing `next/navigation`-free imports — add this import near the top:

```ts
import { useSearchParams } from "next/navigation";
```

Inside `BrainPage`, after the existing `const scrollRef = ...` line, add:

```ts
  const searchParams = useSearchParams();
```

Then add this effect after the existing `useEffect` that calls `getBrainStatus` (it must come after `selectThread` is defined — place it just before the `return (`):

```ts
  // Deep link from the News section: /brain?thread=<id> opens that thread.
  useEffect(() => {
    const id = searchParams.get("thread");
    if (id && store.ready && brainThreads.some((t) => t.id === id)) {
      selectThread(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, store.ready, brainThreads.length]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`.
- Confirm **News** appears in the sidebar under Intelligence and routes to `/news`.
- On `/news`, click **Discuss in Brain** on any card → it navigates to `/brain`, lands in Brainstorm mode, and the new thread is open with the seeded message.

- [ ] **Step 5: Run the full test suite + build**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/nav.ts src/app/brain/page.tsx
git commit -m "feat(news): nav entry + Brain ?thread deep-link"
```

---

## Self-Review Notes

- **Spec coverage:** §3 file layout → Tasks 1–11 (entity types kept in `types.ts` per codebase convention, noted in Global Constraints). §4 data model → Task 1. §5 hybrid fetch (GitHub/Reddit/RSS + web_search curation + dedupe + 6h staleness) → Tasks 3–7 + Task 11 auto-refresh. §6 UI (header, top picks, category panels, interests modal, saved, empty state) → Tasks 10–11. §7 Discuss-in-Brain + deep-link → Tasks 11–12. §8 keys + `NEWS_MODEL` + graceful degradation → Tasks 2/8. §9 error handling (per-source isolation, best-effort curation, pause_turn) → Tasks 6–8. §11 testing → tests in Tasks 1–9.
- **Graceful degradation** verified by the route returning `buildStructuredFeed` when `ANTHROPIC_API_KEY` is absent (Task 8) and the page's `configured === false` notice (Task 11).
- **Type consistency:** `NewsFeedData` (route/client return) vs `NewsFeed` (stored, extends `BaseRecord`) used consistently; `fetchStructured` shape matches what `curate`/route consume; `Submission` fields (`summary`/`picks`/`extra`) match the `SUBMIT_NEWS_TOOL` schema and `applySubmission`.
- **X category:** sourced only via the curation pass's `extra` items (Task 7); no direct X fetcher, per spec out-of-scope.
