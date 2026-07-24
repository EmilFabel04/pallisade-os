# Editable Dashboard Widgets + Graphs — Design

**Date:** 2026-07-24
**Status:** Approved
**Builds on:** `2026-07-24-pallisade-progress-dashboard-design.md` (the all-time dashboard already shipped)

## Goal

Turn the all-time progress dashboard into a **directly-editable, graphed dashboard**:
- The founder edits widget values **inline** (click the number, type, done) — no daily
  scorecard logging required.
- Each metric shows a **mini sparkline** of its history.
- The layout is a clean grid of KPI cards, each with a value + sparkline.

## Decisions (locked)

1. **Edit model:** direct-edit stored totals. Clicking a widget edits the value; the
   value is stored as typed. Each change is snapshotted with the date, so the sparkline
   shows progress over time.
2. **Editable metrics (4):** Calls made, Meetings booked, LinkedIn posts, Cash collected.
3. **Derived metrics (3):** Projects built, Projects pitched, Waiting for feedback — stay
   auto-counted from the Projects list; not editable.
4. **Layout:** KPI cards with mini sparklines (responsive grid).
5. **Continuity seed:** on first load with no entries, seed today's value for each editable
   metric from the current derived all-time totals so numbers carry over.
6. **Scorecard divergence accepted:** the dashboard's editable metrics are independent of
   `scorecard.*`. The `/scorecard` page keeps its own separate charts, unchanged.

## Data model — new `metricEntries` collection

Each record is one metric's value on one day (one record per metric+date):

```ts
export const METRIC_KEYS = ["callsMade", "meetingsBooked", "linkedinPosts", "cashCollected"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface MetricEntry extends BaseRecord {
  metric: MetricKey;
  date: string;   // ISO date (YYYY-MM-DD), one per (metric, date)
  value: number;
}
```

Registered as a store collection (`metricEntries: MetricEntry[]`) in:
- `src/lib/types.ts` — `DataShape` + the interface/enum above.
- `src/lib/db/sqlite.ts` — add `"metricEntries"` to the `COLLECTIONS` tuple.
- `src/lib/store.tsx` — `metricEntries: []` in the `EMPTY` shape.
- `src/lib/seed.ts` — `metricEntries: []` in the seeded shape.
- `src/lib/db/apiAdapter.ts` — `metricEntries: []` in its empty shape.

**Semantics:**
- **Current value** of a metric = the entry with the maximum `date` (0 if none).
- **Sparkline series** = all entries for that metric, sorted ascending by `date`, mapped to
  `{ label: date, value }`.
- **Edit → upsert today:** committing a new value finds the entry for `(metric, todayISO())`
  and updates it, or creates one if none exists. Repeated edits the same day update the same
  record (one point per day).

Persistence rides the existing generic store plumbing (the collection round-trips through
`saveAll`/`loadAll` automatically once registered — same pattern used by every other
collection).

## Selectors (`src/lib/selectors.ts`)

```ts
export interface MetricView {
  key: MetricKey;
  current: number;                              // latest entry value, 0 if none
  series: { label: string; value: number }[];   // ascending by date
}
export function metricView(entries: MetricEntry[], key: MetricKey): MetricView;

export interface ProjectCounts { built: number; pitched: number; waiting: number; }
export function projectCounts(projects: Project[]): ProjectCounts;

// cumulative count of the qualifying projects over time, by createdAt — for the
// derived cards' sparkline. Returns ascending {label,value} points.
export function projectSeries(projects: Project[], kind: "built" | "pitched" | "waiting"): { label: string; value: number }[];
```

- `projectCounts` reuses the exact classification from the shipped `allTimeMetrics`
  (built = stages building/testing/demo-ready/sent/closed; pitched = stages
  demo-ready/sent/closed OR type proposal/demo; waiting = stages sent/demo-ready).
- **Refactor:** the shipped `allTimeMetrics()` summed scorecards for meetings/calls/linkedin/cash
  — those sums are now replaced by `metricView`. `allTimeMetrics` and its scorecard-sum tests
  are removed; the project classification moves into `projectCounts` (with its tests
  re-pointed there). No dead code left behind.

## Components

- **New `src/components/ui/Sparkline.tsx`** — a lightweight pure-SVG sparkline (~30–40 lines),
  no gridlines/tooltip/axes. Props: `{ data: number[]; color?: string; height?: number;
  width?: number }`. Renders a single smoothed/− polyline path scaled to min/max. Kept
  separate from the existing `TrendChart` so the scorecard page is untouched. Renders nothing
  (or a flat baseline) for `data.length < 2`.
- **New `src/components/dashboard/MetricWidget.tsx`** — one KPI card:
  `{ label, icon, value: number, display?: string, series: number[], accent?, editable?,
     onCommit?: (value: number) => void }`.
  - Renders label + icon, the value (via `display ?? fmtCompact(value)`), and a `Sparkline`
    of `series`.
  - When `editable`, clicking the value swaps it for a `NumberInput` (autofocused, existing
    `Field.tsx` primitive). Enter or blur → `onCommit(parsedNumber)`. Escape → revert, no
    commit. A subtle affordance (e.g. a small pencil/edit icon or hover cursor) marks it
    editable.
  - Non-editable cards render the value statically (used by the 3 project cards).
- The existing `MetricCard` is left in place (still used elsewhere? no — only the home page
  used it). It is superseded by `MetricWidget` on the home page; if nothing else imports it,
  it may be removed. The plan will verify call sites and remove it only if unused.

## Page (`src/app/page.tsx`)

- Keep the affirmation banner (unchanged).
- **Continuity seed effect:** on mount, for each `MetricKey` with zero entries, create an
  entry `{ metric, date: todayISO(), value: <derived total> }` where the derived total is the
  current all-time sum from scorecards (calls = Σ dials, meetings = Σ meetingsBooked,
  linkedin = Σ linkedinPosts, cash = Σ revenueClosed). Ref-guarded and run inside a
  `useEffect` (never during render) to avoid a Strict-Mode double-create — matching the
  precedent set by the `/dial` and news-interests seeding.
- **Commit handler:** `commit(key, value)` → find `(metric=key, date=today)`; `update` if
  present, else `create`. Passed to each editable `MetricWidget`.
- Render 7 `MetricWidget`s in a responsive grid:
  - Editable: Calls made, Meetings booked, LinkedIn posts, Cash collected (cash uses
    `display={fmtCurrency(current, settings.currency)}`).
  - Derived: Projects built, Projects pitched, Waiting for feedback (from `projectCounts` +
    `projectSeries`, not editable).

## Testing (Vitest)

- `metricView()`:
  - returns `current` = latest-dated entry's value; `0` when no entries.
  - `series` sorted ascending by date; picks the right metric only.
- Upsert-by-day: a helper (or the page's commit logic factored into a pure function
  `upsertMetricEntry(entries, key, date, value)`) — same-day edit updates in place (no
  duplicate), new day appends. Tested as a pure function.
- `projectCounts()`: built/pitched/waiting classification across every stage/type (ported
  from the existing `allTimeMetrics` test).
- `projectSeries()`: cumulative, ascending, counts only qualifying projects.

## Out of scope / YAGNI

- No third-party charting library — hand-rolled SVG only.
- No editing of the derived project widgets.
- No changes to `/scorecard` or its charts.
- No historical backfill beyond the one-time continuity seed.
- No drag-to-reorder / add-remove widgets (fixed set of 7).
