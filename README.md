# Pallisade OS

The internal operating system for **Pallisade Data** — a single place for a solo B2B
agency founder to run leads, outreach, calls, follow-ups, projects, delivery, daily
activity, AI summaries and tomorrow's priorities.

Boutique-terminal aesthetic: near-black charcoal canvas, off-white text, hairline
borders, a single crimson accent, and monospace numerals throughout.

## Stack

- **Next.js 15 (App Router)** + **TypeScript**
- **Tailwind CSS v4** design tokens (see `src/app/globals.css`)
- **Geist Sans / Geist Mono** typography
- **lucide-react** icons
- Bespoke **SVG charts** (no charting dependency) — `src/components/ui/TrendChart.tsx`
- **SQLite** persistence (Node's built-in `node:sqlite`) behind a swappable adapter

## Run it

**Easiest — just double-click `Pallisade OS.command`** (in this folder).
It starts the production server and opens the app in its own window. No terminal,
no `npm run dev`. The first launch builds the app (~30s); every launch after is
instant. Close the small terminal window it opens to quit the app.

> Tip: drag `Pallisade OS.command` to your Dock or make an alias on your Desktop
> so it's one click away. (First time only, macOS may ask you to confirm opening
> it — right-click → Open.)

From a terminal you can also use:

```bash
npm run app      # same as the double-click launcher (production)
npm run dev      # development server with hot reload
npm run build    # production build
```

The app starts **empty** — everything you add is your own data. Want to see it
populated? **Settings → Data → Load demo data** drops in a full sample dataset
(and **Clear all data** wipes it back to empty).

## Sections

| Route            | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `/`              | Dashboard — metrics, today's focus, pipeline, follow-ups, activity, AI tomorrow plan |
| `/leads`         | CRM with full filtering (status, source, industry, quality, follow-up) |
| `/follow-ups`    | Who is owed a reply, judged and ranked per thread by Jev        |
| `/interactions`  | Call / interaction notes + **Generate Call Summary** (AI)      |
| `/projects`      | Project tracker with linked tasks                              |
| `/tasks`         | Tasks with Today / This Week / Overdue / Sales / Product / Delivery views |
| `/scorecard`     | Daily logging + 5 trend charts                                 |
| `/review`        | **AI Business Review** from a messy daily brain-dump           |
| `/pain-bank`     | Searchable pain-point bank with pattern surfacing              |
| `/settings`      | Business profile, branding, currency, data management          |

Global **search** (top bar) spans leads, notes, projects, tasks and pain points.
**Quick add** (top bar) captures a Lead, Call, Task, Project or Daily Scorecard from anywhere.

## Architecture & extension points

The app is built so the two "mocked" pieces can be replaced without touching the UI.

### 1. Storage — SQLite now, any backend later

Data is stored in a **SQLite database on disk** at `data/pallisade.db` (created
automatically). The flow:

```
browser ──fetch──▶ /api/data route ──▶ node:sqlite ──▶ data/pallisade.db
```

- `src/lib/db/sqlite.ts` — server-only: opens the DB, creates tables, load/save
- `src/app/api/data/route.ts` — GET reads, PUT/POST writes (the POST path lets
  `sendBeacon` flush on tab close)
- `src/lib/db/apiAdapter.ts` — client adapter implementing `StorageAdapter`

Everything goes through one interface: `StorageAdapter` (`src/lib/db/adapter.ts`).
To swap backends, implement that interface and change the single factory line in
`src/lib/store.tsx`:

```ts
function getAdapter(): StorageAdapter {
  return new ApiAdapter();            // SQLite (default)
  // return new LocalStorageAdapter(); // browser-only, no server
  // return new SupabaseAdapter(...);  // hosted Postgres + uploads
}
```

Every entity already carries `id` / `createdAt` / `updatedAt`, so the shape maps
directly onto Postgres tables or Firestore documents.

> **Deploying to Vercel?** SQLite writes to a local file, which the serverless
> filesystem doesn't persist. For a hosted deploy, swap `ApiAdapter`'s backend
> for **Turso** (hosted libSQL/SQLite) or **Postgres** — the adapter seam means
> the UI doesn't change. A `LocalStorageAdapter` is also still available for a
> pure browser-only build.

### 2. AI — real Claude, with automatic mock fallback

AI runs through **Claude Sonnet 4.6** at `high` effort when an API key is present,
and transparently falls back to a local mock when it isn't — the UI is identical
either way.

- **Add your key:** put `ANTHROPIC_API_KEY=sk-ant-...` in `.env.local`, then restart
  the app. **Settings → AI** shows whether it's connected.
- `src/app/api/ai/route.ts` — server route that calls Sonnet 4.6 with schema-constrained
  JSON output (`GET` reports status; `POST` generates).
- `src/lib/aiClient.ts` — client gateway: calls the route, falls back to the mock in
  `src/lib/ai.ts` on any failure or missing key.
- `src/lib/ai.ts` — the pure-function mock (`generateCallSummary`,
  `generateBusinessReview`, `generateTomorrowPlan`); also powers the dashboard's
  Tomorrow Plan, which stays local/instant.

To switch models or effort, edit the `MODEL` / `EFFORT` constants in
`src/app/api/ai/route.ts`.

## Project layout

```
src/
  app/                 # one folder per section (App Router)
  components/
    layout/            # sidebar, topbar, app shell, brand
    forms/             # entity forms + global Quick-Add provider
    ui/                # Panel, Modal, Badge, Field, TrendChart, EmptyState…
    dashboard/         # dashboard metric card
  lib/
    types.ts           # domain model + enums
    store.tsx          # React context: state, CRUD, search, persistence
    db/                # storage adapter seam
    ai.ts              # mocked, swap-ready AI
    seed.ts            # demo dataset
    selectors.ts       # derived dashboard / pipeline metrics
    badges.ts          # enum → colour tone mapping
    utils.ts           # dates, currency, formatting
```
