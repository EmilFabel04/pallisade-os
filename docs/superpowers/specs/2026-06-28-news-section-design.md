# News Section — Design

**Date:** 2026-06-28
**Status:** Approved design, pending implementation plan
**Section route:** `/news` (Intelligence group)

## 1. Purpose

A personalized "News" section that surfaces the latest relevant happenings for a
solo B2B agency founder (South Africa): cool new public GitHub repos, AI-related
news, SA finance news, new products/tricks/"cool stuff people are doing", plus
Reddit and X chatter — filtered to what *this user* cares about, with a short AI
"why this matters to you" layer and a top-picks summary on top.

It mirrors the existing **Brain** feature's end-to-end shape (page + API route +
client lib + SQLite-backed state + Claude tool-loop).

## 2. Core decisions (locked during brainstorm)

| Decision | Choice |
|----------|--------|
| Experience | **Hybrid: card feed + AI summary** — raw item cards grouped by category, with a top-picks digest and per-item "why it matters" blurbs. |
| Fetch model | **Hybrid fetch** — direct APIs/RSS for structured sources (GitHub, Reddit, RSS), Claude `web_search` for fuzzy gaps (X, "cool stuff") + curation/summary. |
| Relevance | **Editable interests profile** — user-controlled config (topics/keywords, GitHub languages/topics, subreddits, RSS feed URLs, "about me" blurb). |
| Refresh | **On-demand + cache** — fetch on "Refresh"; cache last feed in SQLite; auto-refresh in background only if cache > 6h old on open. No cron. |
| Per-item actions | Open URL (new tab), **bookmark/save**, **"Discuss in Brain"**. |

## 3. Architecture & file layout

Follows the Brain pattern exactly.

```
src/app/news/page.tsx              # Feed UI: top-picks, category panels, refresh, interests modal, Saved view
src/app/api/news/route.ts          # GET cached feed + status · POST refresh (hybrid fetch + curate)
src/lib/news/
  types.ts                         # NewsItem, NewsFeed, NewsInterests, NewsBookmark
  sources.ts                       # GitHub / Reddit / RSS fetchers → normalized NewsItem[]
  curate.ts                        # Claude pass: rank/filter, web_search gaps, "why it matters", top-picks
  prompt.ts                        # System prompt built from the interests profile
  newsClient.ts                    # client → /api/news (refresh, getFeed)
```

UI reuses existing primitives: `PageHeader`, `Panel`, `Badge`, `Modal`, `Field`,
`EmptyState`, the Lucide `Newspaper` icon.

## 4. Data model

Three new collections registered in `DataShape` (`src/lib/types.ts`) and wired
into `store.tsx` `EMPTY`, following existing conventions. `newsInterests` and
`newsFeed` use the **singleton-as-array** convention (like `playbooks` →
`usePlaybook`, reading element `[0]`). `newsBookmarks` is an ordinary list so
saved items survive a feed refresh.

```ts
// All items the feed surfaces, normalized across sources.
export type NewsCategory =
  | "github" | "ai" | "finance" | "products" | "reddit" | "x";

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

export interface NewsFeed extends BaseRecord {
  items: NewsItem[];
  summary: string;        // top-picks digest (markdown)
  fetchedAt: string;      // ISO — drives the 6h staleness check
  degraded?: string[];    // names of sources that failed this fetch
}

export interface NewsInterests extends BaseRecord {
  topics: string;         // free-text keywords, comma/newline separated
  githubLanguages: string;// e.g. "TypeScript, Python"
  githubTopics: string;   // e.g. "llm, agents, rag"
  subreddits: string;     // e.g. "MachineLearning, LocalLLaMA, SaaS"
  rssFeeds: string;       // newline-separated RSS/Atom URLs
  aboutMe: string;        // blurb Claude uses to judge relevance
}

export interface NewsBookmark extends BaseRecord {
  item: NewsItem;         // snapshot, so it survives feed replacement
}
```

`DataShape` gains: `newsInterests: NewsInterests[]`, `newsFeed: NewsFeed[]`,
`newsBookmarks: NewsBookmark[]`. `CollectionKey` derives them automatically.
A sensible default `NewsInterests` (SA solo B2B agency / AI builder) is created
on first visit if none exists.

## 5. Data flow

### Refresh (POST `/api/news`)
Client sends the current `NewsInterests`. Server:

1. **Structured fetch, in parallel** (`sources.ts`), each wrapped independently:
   - **GitHub**: Search API — `created:>=<7d ago>` filtered by the user's
     languages/topics, sorted by stars desc, top N. Uses `GITHUB_TOKEN` if set
     (higher rate limit), works unauthenticated otherwise.
   - **Reddit**: public JSON (`https://www.reddit.com/r/<sub>/top.json?t=day`)
     for each configured subreddit, top N each.
   - **RSS**: fetch + parse each configured feed URL (AI news, SA finance,
     products) → recent entries. Lightweight XML parse, no heavy dependency.
   - Each fetcher normalizes to `NewsItem[]`; failures are caught and the source
     name is added to `degraded[]`.
2. **Fuzzy fetch + curation** (`curate.ts`): one Claude `web_search` tool-loop
   (Brain-style, capped iterations) seeded with the interests profile. It:
   - searches for X chatter and "cool stuff people are doing" not covered above,
   - ranks/filters the structured items for relevance,
   - writes a one-line `whyItMatters` for the top items,
   - produces the `summary` (top-picks digest).
   Output parsed into the final `NewsFeed`.
3. Items deduped by `id` (url hash). `NewsFeed` returned to the client, which
   stores it on the `newsFeed` singleton (persisted to SQLite via the existing
   debounced store save).

### Open (GET `/api/news` / section mount)
- Returns configured status (has `ANTHROPIC_API_KEY`? has `GITHUB_TOKEN`?).
- The page reads the cached `newsFeed` from the store and renders instantly.
- If `fetchedAt` > 6h old (or no feed yet), it kicks off a background refresh and
  shows the stale feed (if any) until the new one lands.

## 6. UI

- **Header** (`PageHeader`): title "News" + "Updated <relative time>". A
  **Refresh** button (spinner while fetching) and a **gear** opening the
  interests modal. A **Saved** toggle switches the feed to bookmarked items.
- **Top Picks** panel: renders `feed.summary` (markdown) at the top.
- **Category panels**: one `Panel` per non-empty category (`GitHub`, `AI News`,
  `SA Finance`, `Products & Tricks`, `Reddit`, `X`). Each lists item cards:
  - `Badge` (source), title (links to `url`, opens new tab), snippet, the
    `whyItMatters` line when present, relative `publishedAt`.
  - Card actions: **bookmark** (star toggle → `newsBookmarks`), **Discuss in
    Brain** (see §7).
- If a source is in `degraded[]`, its panel shows a small "couldn't load" note
  rather than disappearing.
- **EmptyState** before the first fetch ("No news yet — hit Refresh").
- **Interests modal** (`Modal` + `Field`): edits the `NewsInterests` singleton
  (topics, GitHub languages/topics, subreddits, RSS URLs, about-me). Saving
  updates the store; does not auto-refetch (user hits Refresh).

## 7. "Discuss in Brain" integration

Each card has a "Discuss in Brain" action. It:
1. Creates a `brainThread` (mode `"brainstorm"`) via the store, seeded with a
   first user `ChatMessage` containing the item title, url, and snippet plus a
   short "let's dig into this" framing.
2. Navigates to `/brain?thread=<id>`.

Requires a **small addition to `src/app/brain/page.tsx`**: on mount, read a
`thread` query param and open that thread if present. This is the only change
to existing feature code; everything else is additive.

## 8. Config & keys

- `GITHUB_TOKEN` — **optional**; raises GitHub rate limit. Documented in
  `.env.example`.
- `ANTHROPIC_API_KEY` — reused for curation. **Graceful degradation**: if absent,
  the section still renders the raw structured feed (GitHub/Reddit/RSS cards)
  with no summary and no `whyItMatters`, mirroring the existing mock-fallback
  pattern. The X / "cool stuff" categories simply stay empty in that mode.
- Reddit/RSS need no keys.
- `NEWS_MODEL` env (default `claude-sonnet-4-6`), matching the `BRAIN_MODEL`
  convention.

## 9. Error handling

- **Per-source isolation**: every structured fetcher is independently
  try/caught; one failure (rate limit, dead feed, Reddit block) adds the source
  to `degraded[]` and that panel shows a notice — the rest of the feed renders.
- **Curation best-effort**: if the Claude pass fails or times out, the route
  returns the structured items with no summary/whyItMatters rather than erroring.
- **web_search pause_turn**: handled the same way the Brain brainstorm loop
  already handles it (resume without a synthetic tool_result).
- Network/route failure surfaces a non-blocking error toast; the cached feed
  stays on screen.

## 10. Out of scope (v1)

- Scheduled/cron digests (revisit if/when deployed off a local laptop).
- A direct X/Twitter API integration (no viable free tier; covered via search).
- Read/unread state, infinite scroll, notifications.
- Auto-deriving interests from app data (interests are user-edited only in v1).

## 11. Testing

- `sources.ts`: unit-test each normalizer against captured sample payloads
  (GitHub search JSON, Reddit JSON, a sample RSS XML); assert mapping to
  `NewsItem` and that a thrown fetch yields a `degraded` entry, not a crash.
- `curate.ts`: test the parse of a representative Claude response into
  `NewsFeed`; test the no-API-key path returns structured items unchanged.
- Dedupe: assert items with the same URL collapse to one.
- Store: assert the three new collections register and round-trip through the
  adapter; bookmarks persist across a `newsFeed` replacement.
- Brain deep-link: `/brain?thread=<id>` opens the named thread.
