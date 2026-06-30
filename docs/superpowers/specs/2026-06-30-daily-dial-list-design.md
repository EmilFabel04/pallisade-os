# Daily Dial List (`/dial`) — Design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Purpose

Give the founder a focused "today's 20" call list every morning, drawn at random
from the already-qualified `/targets` prospect list. Each target is tracked through
a simple call lifecycle (call count + disposition) so the list stays fresh day to
day and converted prospects flow into the `/leads` CRM.

## Scope

- Draws **only** from the raw `/targets` table (fresh cold-dial candidates), not
  from `/leads`.
- Targets are treated as already qualified — selection is **random**, not scored.
- One new section at `/dial`; no cron infrastructure (daily snapshot is generated
  on first view per calendar day).

Out of scope: fit scoring/ranking, per-row notes, anything drawing from `/leads`.

## Data model

### Additions to `Target` (`src/lib/types.ts`)

Three persistent call-tracking fields, all optional with sensible defaults so
existing target records remain valid:

- `callCount?: number` — number of logged calls. 0 → 1 → 2 → 3+, rendered as
  "—/once/twice/thrice". Default treated as 0 when absent.
- `lastCalledAt?: string | null` — ISO timestamp of the most recent logged call.
- `disposition?: "not_interested" | null` — set when the user marks **Not
  interested**. "Interested" is *not* stored here because that path removes the
  target (promotes it to a Lead).

### New record type `DialList`

A persisted per-day snapshot so the day's 20 are stable across refreshes:

```ts
interface DialEntry {
  targetId: string;
  label: string; // denormalized "Company — Contact", captured at snapshot time
  outcome?: "interested" | "not_interested" | null;
}
interface DialList extends BaseRecord {
  date: string; // "YYYY-MM-DD" — also the stable id, exactly one per day
  entries: DialEntry[];
}
```

`outcome` records the disposition given *today* for display purposes (e.g. show a
greyed "→ Lead" row after Interested). The authoritative persistent state lives on
the `Target` (`callCount`, `disposition`); `outcome` is the per-day display marker.
`label` is denormalized so a completed "→ Lead" row still renders after Interested
removes the underlying target.

## Daily generation (the "freeze")

When `/dial` is opened:

1. Compute today's date string (`YYYY-MM-DD`, local).
2. Look up a `DialList` with that `date`.
3. If none exists, generate one:
   - **Eligible pool** = all targets where `disposition !== "not_interested"`.
     (Interested targets are already gone from the targets table, so no extra
     filter is needed for them.)
   - Pick **up to 20 at random**, no duplicates. If the pool has fewer than 20,
     serve whatever is available.
   - Persist as a new `DialList` with the chosen `targetId`s as `entries`.
4. Render the snapshot.

The same 20 appear on every refresh that day. The next calendar day produces a
fresh snapshot. A target called once/twice/thrice with no disposition stays in the
eligible pool and may be re-picked on a later day (targets **keep cycling** until a
disposition is given — no auto-drop after three calls).

## The screen (`src/app/dial/page.tsx`)

A focused table, one row per entry, joined to the current `Target` record:

| Column        | Content                                                        |
| ------------- | -------------------------------------------------------------- |
| Company       | `target.company`                                               |
| Contact       | `target.contactName` · `target.contactRole`                    |
| Phone         | `target.phone` as a click-to-call `tel:` link                  |
| Context       | `target.industry` · `target.location`                          |
| Calls         | badge: — / once / twice / thrice (from `callCount`)            |
| Actions       | **Log call**, **Interested**, **Not interested**               |

### Row actions

- **Log call** → `callCount++`, set `lastCalledAt = now`. Also increments **today's
  Scorecard `dials` by 1** (a logged call is a dial). Decision: keep this coupling.
- **Interested** → promote to a Lead by reusing `targetToLead(target, founderName)`
  (`src/lib/targets/promote.ts`), create the lead, **remove the target** (matching
  existing `/targets` promote behavior at `src/app/targets/page.tsx:40-43`), and set
  the entry's `outcome: "interested"`. The row stays visible for the day as a greyed
  "→ Lead" state and is naturally absent from future eligible pools.
- **Not interested** → set `target.disposition = "not_interested"` and the entry's
  `outcome: "not_interested"`. Row greys out; excluded from all future days.

Rows whose underlying target no longer exists but carry `outcome: "interested"` are
rendered from the snapshot entry as completed "→ Lead" rows.

## Components / files

- `src/app/dial/page.tsx` — the screen (client component using the existing `store`).
- Nav entry for `/dial` (wherever the existing sidebar/nav is defined).
- `src/lib/dial/select.ts` — pure helpers: `eligibleTargets(targets)` and
  `pickDaily(pool, count, rng)` (rng injectable for deterministic tests).
- `src/lib/dial/snapshot.ts` (or inline in the page/store) — `getOrCreateToday(date,
  targets, store)` idempotent generation.
- Reuse: existing `store` (libSQL/JSON adapter) for `DialList` persistence;
  `targetToLead` for promotion; existing Scorecard read/update for the dial bump.

## Testing

Unit tests (vitest, matching existing `*.test.ts` convention):

- `eligibleTargets` excludes `disposition === "not_interested"`, includes everything
  else.
- `pickDaily` returns at most `count`, never duplicates, and returns the whole pool
  when the pool is smaller than `count`; deterministic with an injected rng.
- `getOrCreateToday` is idempotent — a second call for the same date returns the
  existing snapshot rather than regenerating.

## Decisions captured

- **Source:** `/targets` only.
- **Selection:** random (targets are pre-qualified).
- **Lifecycle:** Log call increments count; Interested → auto-promote to Lead +
  remove target; Not interested → permanent exclusion; keep cycling until a
  disposition (no auto-drop after thrice).
- **Daily freeze:** persisted `DialList` snapshot per calendar day, generated on
  first view (no cron).
- **Placement:** dedicated `/dial` section.
- **Scorecard coupling:** Log call bumps today's `dials` (kept).
- **No per-row notes** (YAGNI — notes happen on the Lead after Interested).
