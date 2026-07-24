# Pallisade Progress Dashboard — Design

**Date:** 2026-07-24
**Status:** Approved

## Goal

Replace the home page (`/`) — currently a daily-overview dashboard whose top
metrics read from *today's* scorecard — with an **all-time progress dashboard**.
This becomes the founder's personal "how far have I come / where am I" view. The
daily log stays at `/scorecard` (now the only daily-log surface).

## Surfaces

- **Changed:** `src/app/page.tsx` (`DashboardPage`, route `/`).
- **Unchanged:** `/scorecard` (daily log) keeps working exactly as-is.

## Affirmation banner

- New module `src/lib/affirmations.ts` holding a curated list of ~35 founder
  affirmations.
- `affirmationForDate(date: Date): string` picks deterministically by day-of-year
  (`dayOfYear % list.length`). Stable for the whole day, rotates daily. No AI,
  no network, works offline.
- Rendered as a prominent banner directly under `PageHeader` (large quote-style
  text).

## All-time stat blocks

New pure selector `allTimeMetrics(data)` in `src/lib/selectors.ts` aggregating
across *all* records (not just today). All scorecard sums use `?? 0` so rows
missing newer fields count as zero.

| Block | Source |
|-------|--------|
| **Meetings booked** | Σ `scorecard.meetingsBooked` |
| **Calls made** | Σ `scorecard.dials` |
| **LinkedIn posts** | Σ `scorecard.linkedinPosts` *(new field, see below)* |
| **Projects built** | count of projects at stage `building`, `testing`, `demo-ready`, `sent`, or `closed` |
| **Projects pitched** | count of projects at stage `demo-ready`, `sent`, or `closed`, OR type `proposal`/`demo` |
| **Waiting for feedback** | count of projects at stage `sent` or `demo-ready` |
| **Cash collected** | Σ `scorecard.revenueClosed`, currency-formatted |

Notes:
- **Pitched** and **Waiting for feedback** intentionally overlap. Pitched is
  cumulative (ever pitched); Waiting is current state (still awaiting response).
- Stage classification uses the existing `PROJECT_STAGES` order in
  `src/lib/types.ts`.
- Cash collected is formatted with the existing currency helper / `Settings.currency`.

## New field: `linkedinPosts`

There is no existing field for LinkedIn posts published (`linkedinMessages` is
outreach DMs). Add a new daily counter:

- Add `linkedinPosts: number` to the `Scorecard` interface in `src/lib/types.ts`.
- Add it to the `ScorecardForm` field list (`src/components/forms/ScorecardForm.tsx`)
  and its `initial?.linkedinPosts ?? 0` default.
- Update the seed generator (`src/lib/seed.ts`) to emit a plausible value so
  seeded data isn't all-zero (optional but keeps demo data coherent).
- Existing DB rows lack the field; all reads use `?? 0`, so **no migration is
  required**. Past days simply contribute 0.

## Layout

- `PageHeader`: keep the greeting ("Good morning, {founderName}"); change the
  subtitle to "{businessName} — all time". Keep the "Log day" (opens scorecard
  quick-add) and "AI Review" actions.
- Body order: affirmation banner → grid of 7 stat cards (reuse the existing
  `MetricCard` component, fed all-time values).
- **Removed from the home page:** Today's Focus, Tomorrow Plan, Pipeline
  Snapshot, Follow-ups Due, Recent Activity, Next Meetings. Their components and
  selectors remain in the repo untouched (just no longer imported by `page.tsx`),
  so no other surface breaks.

## Testing (Vitest)

- `allTimeMetrics()`:
  - sums `meetingsBooked` / `dials` / `linkedinPosts` / `revenueClosed` across
    multiple scorecards, treating missing fields as 0;
  - classifies projects correctly into built / pitched / waiting across every
    `ProjectStage` and relevant `ProjectType`.
- `affirmationForDate()`:
  - returns the same string for the same date (determinism);
  - rotates across consecutive days;
  - stays within the list bounds for any date.

## Out of scope / YAGNI

- No AI-generated affirmations.
- No historical backfill of `linkedinPosts`.
- No new charts — this view is headline stats + affirmation only.
- No changes to `/scorecard` beyond adding the one new field.
