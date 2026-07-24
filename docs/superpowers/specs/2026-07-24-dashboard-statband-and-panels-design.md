# Dashboard v3 — Stat Band + Working Panels — Design

**Date:** 2026-07-24
**Status:** Approved
**Supersedes the layout of:** `2026-07-24-editable-dashboard-widgets-design.md` (keeps its editable `metricEntries` model; drops the sparklines/over-time display)

## Goal

Reshape the dashboard so that:
- The editable stats become a **hero stat band** — one wide panel of big numbers, no graphs / nothing over-time (the underlying data "won't always adhere to time").
- The day-to-day **working panels return below the stats**: Today's Focus, Quick Links, Pipeline Snapshot, Recent Activity.

Editing stays exactly as it is (click a number → type → commit → upsert today's `metricEntries` value). We simply stop rendering the history.

## Layout (top → bottom)

1. **PageHeader** — greeting + "Log day" / "AI Review" actions (unchanged).
2. **Affirmation banner** — kept, at the very top above the stats (unchanged markup).
3. **Hero stat band** — a single `panel` containing a responsive row of 7 stat cells separated by subtle dividers:
   - Editable (click-to-edit): **Calls made, Meetings booked, LinkedIn posts, Cash collected** (cash via `fmtCurrency(current, settings.currency)`).
   - Static (from Projects list): **Projects built, Projects pitched, Waiting for feedback**.
   - No sparkline / no time series anywhere.
4. **Working panels** — responsive 2×2 grid (`grid-cols-1 lg:grid-cols-2 gap-5`):
   - **Today's Focus** — top 3 pressing items (overdue/due follow-ups then high-priority non-follow-up tasks). Restored verbatim from the pre-all-time dashboard (`git show e641ac7~1:src/app/page.tsx`).
   - **Quick Links** — new panel: shortcut buttons/links to Add Lead, Log a call (Dial List `/dial`), New Project, Daily Scorecard (`/scorecard`), AI Review (`/review`).
   - **Pipeline Snapshot** — open pipeline value + lead count + per-status bars. Restored verbatim from the original.
   - **Recent Activity** — latest leads/interactions/projects/tasks, newest first. Restored verbatim from the original.

## Components

- **New `src/components/dashboard/StatCell.tsx`** — one stat within the band: a big value + small label, click-to-edit when `editable`. The edit logic (the `handledRef`-guarded `commit`/`cancel`, Enter/blur commit, Escape cancel, `Math.max(0, n)`) is lifted from the current `MetricWidget` — same behavior, minus the sparkline and the card chrome. Props:
  ```ts
  { label: string; value: number; display?: string; accent?: boolean; editable?: boolean; onCommit?: (value: number) => void }
  ```
  No `icon`/`series` props (the band is text-forward; icons optional and omitted for a clean numeric look).
- **Delete `src/components/dashboard/MetricWidget.tsx`** and **`src/components/ui/Sparkline.tsx`** — both become unused once the band replaces the card grid.
- **`TrendChart.tsx` stays untouched** (still used by `/scorecard`).

## Selectors

- Keep: `metricView` (current value + edit target via `findMetricEntry`), `projectCounts`, and the restored-panel selectors already in the repo (`followUps`, `openTasks`, `pipelineCounts`, `pipelineValue`, `recentActivity`).
- **Remove `projectSeries`** (+ its unit test) — it only fed the sparklines.

## Data model

Unchanged. `metricEntries` still stores one value per metric per day; editing upserts today's entry; current value = latest entry. The accumulated history simply isn't rendered. No migration.

## Page wiring (`src/app/page.tsx`)

- Keep the hydration-gated, ref-guarded continuity seed and the `commit(key, value)` upsert exactly as they are now.
- Replace the `MetricWidget` grid with the stat band (row of `StatCell`s in a `panel`).
- Re-add the three restored panels + Quick Links, using the selectors and the JSX from the original page (Today's Focus, Pipeline Snapshot, Recent Activity) plus a new Quick Links panel.
- Re-import what the restored panels need: `Panel`, `Badge`, `EmptyState`, `leadStatusTone`, `followUps`, `openTasks`, `pipelineCounts`, `pipelineValue`, `recentActivity`, `fmtCurrency`, `relativeDay`, `timeAgo`, and the relevant lucide icons + the `ACTIVITY_ICON` map.

## Testing (Vitest)

- Remove the `projectSeries` describe block.
- `metricView` / `findMetricEntry` / `projectCounts` tests remain (unchanged).
- No new unit tests (the band/panels are presentational; vitest is node-env with no DOM). Verification is `tsc` + `build` + a controller browser smoke test (band renders, inline edit still works + persists, all four panels render).

## Out of scope / YAGNI

- No changes to the `metricEntries` data model or persistence.
- No graphs/sparklines anywhere on the dashboard.
- Do not restore Tomorrow Plan or Next Meetings (not requested this round).
- No changes to `/scorecard`.
