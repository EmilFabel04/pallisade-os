# Dashboard v3 — Stat Band + Working Panels — Design

**Date:** 2026-07-24
**Status:** Built — see "As-built deltas" at the end for where implementation diverged from this design.
**Supersedes the layout of:** `2026-07-24-editable-dashboard-widgets-design.md` (keeps its editable `metricEntries` model; drops the sparklines/over-time display)

## Goal

Reshape the dashboard so that:
- The editable stats become a **hero stat band** — one wide panel of big numbers, no graphs / nothing over-time (the underlying data "won't always adhere to time").
- The day-to-day **working panels return below the stats**: Today's Focus, Quick Links, Pipeline Snapshot, Recent Activity.

Editing stays exactly as it is (click a number → type → commit → upsert today's `metricEntries` value). We simply stop rendering the history.

## Layout (top → bottom)

1. **PageHeader** — greeting + "Log day" / "AI Review" actions.
   - **Change the subtitle.** It currently reads `` `${businessName} — all time` `` (`page.tsx:79`), which was written for the stats-only dashboard. With working panels back, restore the original phrasing: `` `Here's where ${businessName} stands today — ${fmtDate(todayISO())}.` `` (needs `fmtDate`, `todayISO` imports).
2. **Affirmation banner** — kept, directly under the header, above the stats (markup unchanged, `page.tsx:92-98`).
3. **Hero stat band** — a single `panel` containing a responsive grid of 7 stat cells separated by subtle dividers. Order, left → right:
   1. Meetings booked *(editable, accent)*
   2. Calls made *(editable)*
   3. LinkedIn posts *(editable)*
   4. Cash collected *(editable, accent, `display={fmtCurrency(cash.current, settings.currency)}`)*
   5. Projects built *(static, accent)*
   6. Projects pitched *(static)*
   7. Waiting for feedback *(static)*

   No sparkline / no time series anywhere.
4. **Working panels** — responsive 2×2 grid (`grid grid-cols-1 lg:grid-cols-2 gap-5`):
   - **Today's Focus** — top 3 pressing items (overdue/due follow-ups, then high-priority non-follow-up tasks). Restored from `git show e641ac7~1:src/app/page.tsx`.
   - **Quick Links** — new panel (see below).
   - **Pipeline Snapshot** — open pipeline value + lead count + per-status bars. Restored, **adapted to half-width** (see Risks).
   - **Recent Activity** — latest leads/interactions/projects/tasks, newest first. Restored as-is.

## The stat band — concrete layout

This is the highest-risk visual detail, so it is specified rather than left to taste. Seven cells cannot sit in one flex row on narrow screens, and `divide-x` renders wrong once cells wrap (a stray divider appears at the wrap boundary).

Use a **grid with per-breakpoint border rules** instead of `divide-*`:

```tsx
<div className="panel p-0 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
  {/* each StatCell root: */}
  // "px-5 py-6 border-[var(--color-line)] border-b border-r
  //  last:border-r-0 sm:[&:nth-child(4n)]:border-r-0 lg:border-b-0 lg:[&:nth-child(4n)]:border-r"
</div>
```

Rules:
- `grid-cols-2` (mobile) → `sm:grid-cols-4` → `lg:grid-cols-7`.
- Dividers are **cell borders**, not `divide-x`, so wrapped rows stay correct.
- At `lg` all 7 sit in one row: bottom borders off, right border on every cell except the last.
- Below `lg` the trailing cells of each row must drop their right border, and the final row must drop its bottom border — encode with `nth-child` variants at each breakpoint rather than hand-counting.
- Band panel is `p-0`; padding lives on the cells so dividers reach the panel edges.

**Value formatting.** Do **not** use `fmtCompact` in the band. A hero number should read `1,240`, not `1.2k`. `StatCell` renders `display ?? value.toLocaleString()`. Only Cash collected passes `display` (currency).
→ `fmtCompact` (`src/lib/utils.ts:118`) then has no callers. Leave it in `utils.ts` (it is a generic formatter, not dashboard-specific) but expect no import of it from the dashboard.

**Edit-mode stability.** The `<input>` must not resize the cell when editing starts. Give it `w-full` inside a fixed-height value row (`min-h-[2.4rem] flex items-baseline`) and the same font size/weight as the static value, so the swap is visually in-place.

## Components

- **New `src/components/dashboard/StatCell.tsx`** — one stat within the band: a big value + small label, click-to-edit when `editable`. Props:
  ```ts
  { label: string; value: number; display?: string; accent?: boolean; editable?: boolean; onCommit?: (value: number) => void }
  ```
  No `icon` / `series` props — the band is text-forward.
  **`accent` semantics:** with icons removed, `accent` has nothing left to tint, so it now colors the *value* (`text-[var(--color-accent)]` vs `text-[var(--color-ink)]`). Keep it on Meetings booked, Cash collected, Projects built — three accented numbers across seven reads as emphasis; more would read as noise.
- **New `src/lib/inlineEdit.ts`** — the edit state machine, extracted as pure logic (see Testing). `StatCell` is a thin view over it.
- **Delete `src/components/dashboard/MetricWidget.tsx`** and **`src/components/ui/Sparkline.tsx`** — verified to have no other importers; both become unused once the band replaces the card grid.
- **`TrendChart.tsx` stays untouched** — still used by `/scorecard` (`src/app/scorecard/page.tsx:10`).
- **`src/components/calendar/UpcomingMeetings.tsx`** — loses its only caller (the old page rendered it at the bottom) and Next Meetings is not being restored. **Keep the file**; it is a self-gating Google-Calendar feature we will re-mount later. Note it as a knowingly-orphaned component so a future dead-code sweep doesn't delete it.

## Quick Links panel

Five shortcuts. Two open the QuickAdd modal, three navigate — be explicit, because they are different elements:

| Label | Action | Kind |
|---|---|---|
| Add Lead | `quickAdd.open("lead")` | `<button>` |
| New Project | `quickAdd.open("project")` | `<button>` |
| Log a call | `/dial` | `<Link>` |
| Daily Scorecard | `/scorecard` | `<Link>` |
| AI Review | `/review` | `<Link>` |

All five routes exist. `"lead"` and `"project"` are valid `QuickAddKind`s (`src/components/forms/QuickAdd.tsx:11`).
Render as a `grid grid-cols-2 gap-2.5` of `btn`-styled tiles with a lucide icon + label, so the panel fills its half-width slot rather than sitting as a thin list. Icons: `UserPlus`, `FolderKanban`, `PhoneCall`, `CalendarCheck`, `Sparkles`.

## Selectors

- Keep: `metricView`, `findMetricEntry`, `projectCounts`, plus the panel selectors already in the repo — `followUps`, `openTasks`, `pipelineCounts`, `pipelineValue`, `recentActivity` (all still exported from `src/lib/selectors.ts`).
- **Remove `projectSeries`** (`selectors.ts:245`) and its `describe` block (`selectors.test.ts:86`) — it only fed the sparklines.
- **Leave `MetricView.series` in place.** It is now unrendered, but it is cheap, its tests are already green, and `/scorecard`-style reuse is plausible. Removing it would churn `metricView` and its tests for no gain.
- Do **not** touch `dashboardMetrics`, `generateTomorrowPlan`, or `followUpsDueToday` — they look dashboard-only but are live in `src/lib/advisor/readTools.ts` and `src/lib/advisor/tools.ts`.

## Data model

Unchanged. `metricEntries` still stores one value per metric per day; editing upserts today's entry; current value = latest entry. The accumulated history simply isn't rendered. No migration.

## Page wiring (`src/app/page.tsx`)

- Keep the hydration-gated, ref-guarded continuity seed (`page.tsx:38-56`) and the `commit(key, value)` upsert (`page.tsx:58-63`) exactly as they are.
- Replace the `MetricWidget` grid with the stat band (row of `StatCell`s in a `panel`).
- Drop the `vals()` helper (`page.tsx:71`) — nothing consumes series any more.
- Add the four panels, using the selectors and JSX from `e641ac7~1`, plus the new Quick Links panel.
- **Carry `maxPipe`** — Pipeline Snapshot's bar widths depend on `const maxPipe = Math.max(1, ...pipeline.map(p => p.count))`; it is easy to miss when lifting the JSX.
- Re-import what the restored panels need: `Panel`, `Badge`, `EmptyState`, `leadStatusTone`, `followUps`, `openTasks`, `pipelineCounts`, `pipelineValue`, `recentActivity`, `fmtCurrency`, `fmtDate`, `relativeDay`, `timeAgo`, `todayISO`, the lucide icons, and the `ACTIVITY_ICON` map.
- Prune the now-unused icon imports (`Phone`, `Linkedin`, `Hammer`, `Send`, `Banknote`, and `Clock` if Follow-ups Due stays dropped) — the band has no icons.

## Testing (Vitest)

Vitest here is `environment: "node"` with `include: ["src/**/*.test.ts"]` — no DOM, no `.tsx` tests. That is exactly why the edit logic must not live only inside a component.

**Commit `eefdf22` ("guard MetricWidget edit so Escape never commits and Enter commits once") exists because this logic was already wrong once.** Re-typing it into a brand-new component with zero tests is how that bug comes back.

- **Extract, then test.** Move the `handledRef`-guarded state machine into `src/lib/inlineEdit.ts` as a pure module: `startEdit(value) → draft`, `commit(draft, handled) → { value: number | null; handled: true }`, `cancel() → { handled: true }`, with the `Number.isFinite` check and the `Math.max(0, n)` clamp inside it. `StatCell` holds only `useState`/`useRef` and calls into it.
- **New `src/lib/inlineEdit.test.ts`** — node-env, no DOM required. Cases: Enter commits exactly once; a blur following Enter is a no-op; Escape commits nothing and marks handled; a blur following Escape is a no-op; non-numeric draft commits nothing; negative input clamps to `0`; `"0"` commits `0` (not skipped as falsy).
- Remove the `projectSeries` describe block. `metricView` / `findMetricEntry` / `projectCounts` tests remain unchanged.
- No component tests for the band/panels — they are presentational and the harness has no DOM.

## Verification

```bash
npx tsc --noEmit          # catches missed imports from the JSX lift
npx vitest run            # inlineEdit suite green, projectSeries block gone
npm run lint              # catches orphaned imports after the icon prune
npm run build
```

Then a browser smoke test:
- Band renders 7 cells on one row at desktop width; dividers are correct at `lg`, `sm`, and mobile widths (no stray divider at a wrap boundary, no double border).
- Inline edit works on all four editable cells: Enter commits, blur commits, Escape discards, layout does not jump on entering edit mode.
- A committed value survives reload (upsert hit `metricEntries`).
- All four panels render, with populated **and** empty data (the `EmptyState` branches).

## Risks

- **Pipeline Snapshot was a sidebar.** In the original it sat in a `lg:col-span-1` column of a 3-col grid; in the new 2×2 it is roughly twice as wide, so the big value + status bars will look sparse. Expect to lay its header row out horizontally (value left, lead count right) rather than lifting the markup untouched. This is the one panel where "restore verbatim" will not hold.
- **Seven cells is a lot for one row.** If the band reads cramped at `lg`, the fallback is `lg:grid-cols-4` + a second row of 3 rather than shrinking the type — the point of the band is that the numbers are big.

## Out of scope / YAGNI

- No changes to the `metricEntries` data model or persistence.
- No graphs/sparklines anywhere on the dashboard.
- **Follow-ups Due panel is not restored.** The original had it, but Today's Focus already leads with the same `followUps()` items — two panels off one selector on a 4-panel dashboard is redundant. Quick Links takes that slot instead. (Flagged explicitly since it *was* in the pre-e641ac7 page.)
- Do not restore Tomorrow Plan or Next Meetings.
- No changes to `/scorecard`.
- No dead-code sweep of pre-existing orphans (e.g. `activeProjects` in `selectors.ts`) — unrelated to this change.

---

## As-built deltas

Three things changed during implementation. Each is a deliberate correction, not a shortcut.

**1. Dividers are computed, not `nth-child` variants.** The design specified per-breakpoint
`[&:nth-child(4n)]` classes. Those compile fine, but nothing in this repo can *test* them — vitest is
node-env, and the browser harness available here could not drive the viewport below `lg`, so the `sm`
and base column counts would have shipped on reasoning alone. Divider correctness was the design's
own #1 risk, so it moved into `src/lib/statBand.ts`: `bandCellBorders(n, total)` derives plain
utilities (`border-r`, `sm:border-r-0`, `lg:border-b-0`) from row/column arithmetic, and
`statBand.test.ts` asserts the resolved border state at 2, 4, and 7 columns. `StatCell` now takes a
`className` for its borders; the page maps a `stats` array through `bandCellBorders`.
The `lg` case was cross-checked against the live DOM and matches the unit test exactly
(right borders on cells 1–6, none on 7, no bottom borders).

**2. Blank input commits nothing.** The design said "same behavior as `MetricWidget`". Lifted
literally that means `Number("") === 0` passes the `Number.isFinite` check, so clearing a cell and
clicking away silently zeroes it — destructive on Cash collected. `commit()` now trims and treats a
blank draft as "no value". This is a deliberate behavior change from the old widget.

**3. The value row is `h-[2.4rem]`, not `min-h-`.** `.input` carries its own padding and border, so
with `min-h-` the input rendered ~2px taller than the static value and nudged the label down on
entering edit mode. A fixed height with `h-full` on the input pins it — verified live: all seven
labels sit at the same y-coordinate while a cell is being edited.

### Verified

`tsc --noEmit` clean · 169 tests across 32 files green · `next build` succeeds · live browser: band
renders one row of 7 at desktop with correct dividers, Enter commits, Escape discards (and the
following blur commits nothing — the `eefdf22` regression, re-verified in the DOM), edits survive
reload, all four panels render, console clean on load.

### Not verified

- **`sm` / base viewport rendering.** The browser harness could not change the page viewport
  (`innerWidth` stayed pinned), so narrow layouts are covered by `statBand.test.ts` and not by eye.
  Worth one manual look at a real narrow window.
- **`EmptyState` branches.** Exercising them means emptying the local store, which holds real data;
  skipped rather than risk it. Type-checked only.
- **`npm run lint`.** `next lint` is unconfigured in this repo and prompts interactively — a
  pre-existing condition, not introduced here.
