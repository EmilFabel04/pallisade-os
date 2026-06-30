# Daily Dial List (`/dial`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/dial` section that serves a frozen, random "today's 20" call list drawn from the `/targets` table, with per-target call-count and Interested/Not-interested dispositions.

**Architecture:** Three new persistent fields on `Target` track call state. A new `dialLists` collection stores one per-day snapshot (`date` = `YYYY-MM-DD`) of 20 chosen targets. Pure helpers in `src/lib/dial/` do eligibility filtering, random selection, and snapshot lookup/build (TDD). A client page at `src/app/dial/page.tsx` generates today's snapshot on first view, renders rows, and wires the three row actions to the existing `store`, `targetToLead`, and the Scorecard.

**Tech Stack:** Next.js 15 App Router (React 19, TypeScript), libSQL/JSON `store` seam, Tailwind v4, lucide-react, vitest.

## Global Constraints

- All new `Target` fields are **optional** — existing target records must stay valid. Treat absent `callCount` as `0`.
- Persistence goes through the existing `useStore()` API (`create`/`update`/`remove`); never touch the libSQL client directly from the client.
- A new collection must be registered in **all five** sites: `DataShape` (types.ts), `EMPTY` (store.tsx), `COLLECTIONS` (sqlite.ts), the empty default in `apiAdapter.ts`, and the `seedData()` return in `seed.ts`.
- Date strings use `todayISO()` from `src/lib/utils.ts` (`YYYY-MM-DD`, local), matching the Scorecard `date` convention.
- Test files are `src/**/*.test.ts`, run with `npm test` (vitest, node env). Path alias `@` → `src`.
- Follow existing page conventions: `"use client"`, `PageHeader`, `Panel`, `EmptyState`, `data-table` / `btn` classNames.

---

### Task 1: Domain types + `dialLists` collection registration

**Files:**
- Modify: `src/lib/types.ts` (Target interface ~332-342; DataShape ~391-408)
- Modify: `src/lib/store.tsx` (imports ~12-27; `EMPTY` ~72-89; selectors ~314-319)
- Modify: `src/lib/db/sqlite.ts` (`COLLECTIONS` ~16-32)
- Modify: `src/lib/db/apiAdapter.ts` (empty default ~40-53)
- Modify: `src/lib/seed.ts` (`seedData()` return ~729-745)

**Interfaces:**
- Produces:
  - `Target` gains `callCount?: number`, `lastCalledAt?: string | null`, `disposition?: "not_interested" | null`
  - `interface DialEntry { targetId: string; label: string; outcome?: "interested" | "not_interested" | null }`
  - `interface DialList extends BaseRecord { date: string; entries: DialEntry[] }`
  - `DataShape` gains `dialLists: DialList[]`; `CollectionKey` therefore includes `"dialLists"`
  - `useDialLists(): DialList[]` hook from `src/lib/store.tsx`

- [ ] **Step 1: Add call-tracking fields to `Target`**

In `src/lib/types.ts`, extend the `Target` interface:

```ts
export interface Target extends BaseRecord {
  company: string;
  contactName: string;
  contactRole: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  industry: string;
  location: string;
  notes: string;
  // ── dial-list call tracking (all optional; absent callCount means 0) ──
  callCount?: number;
  lastCalledAt?: string | null;
  disposition?: "not_interested" | null;
}
```

- [ ] **Step 2: Add `DialEntry` / `DialList` types and register the collection**

In `src/lib/types.ts`, add the new interfaces near the other entity blocks (e.g. just after the `Target` interface):

```ts
/* ---------- dial list (daily call snapshot) ---------- */

export interface DialEntry {
  targetId: string;
  label: string; // denormalized "Company — Contact", captured at snapshot time
  outcome?: "interested" | "not_interested" | null;
}

export interface DialList extends BaseRecord {
  date: string; // "YYYY-MM-DD" — exactly one per day
  entries: DialEntry[];
}
```

Then add `dialLists` to `DataShape` (insert alongside the other arrays, e.g. right after `targets: Target[];`):

```ts
  targets: Target[];
  dialLists: DialList[];
```

- [ ] **Step 3: Register `dialLists` in the store**

In `src/lib/store.tsx`, add `DialList` to the type import from `./types`:

```ts
import type {
  CollectionKey,
  DataShape,
  DialList,
  Interaction,
  Lead,
  // ...existing imports unchanged
} from "./types";
```

Add `dialLists: []` to the `EMPTY` constant (next to `targets: []`):

```ts
  targets: [],
  dialLists: [],
```

Add a typed selector near the other `use*` exports (e.g. after `useTargets`):

```ts
export const useDialLists = () => useStore().dialLists as DialList[];
```

- [ ] **Step 4: Register `dialLists` in the three persistence sites**

In `src/lib/db/sqlite.ts`, add `"dialLists"` to the `COLLECTIONS` array (after `"targets",`):

```ts
  "targets",
  "dialLists",
```

In `src/lib/db/apiAdapter.ts`, add `dialLists: []` to the empty default object (after `targets: [],`):

```ts
      targets: [],
      dialLists: [],
```

In `src/lib/seed.ts`, add `dialLists: []` to the `seedData()` return object (after the `targets` entry):

```ts
    dialLists: [],
```

- [ ] **Step 5: Verify the project type-checks and builds**

Run: `npm run build`
Expected: build completes with no TypeScript errors (the generic `store` wiring exercises the new `CollectionKey`). First build may take ~30s.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/store.tsx src/lib/db/sqlite.ts src/lib/db/apiAdapter.ts src/lib/seed.ts
git commit -m "feat(dial): add Target call-tracking fields and dialLists collection"
```

---

### Task 2: Selection helpers (`src/lib/dial/select.ts`)

**Files:**
- Create: `src/lib/dial/select.ts`
- Test: `src/lib/dial/select.test.ts`

**Interfaces:**
- Consumes: `Target` from `@/lib/types`
- Produces:
  - `eligibleTargets(targets: Target[]): Target[]` — excludes `disposition === "not_interested"`
  - `pickDaily(pool: Target[], count: number, rng?: () => number): Target[]` — up to `count` unique random picks; `rng` defaults to `Math.random` and returns a float in `[0, 1)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dial/select.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Target } from "@/lib/types";
import { eligibleTargets, pickDaily } from "./select";

function target(over: Partial<Target>): Target {
  return {
    id: over.id ?? "t1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    company: "Acme",
    contactName: "Jane Doe",
    contactRole: "CTO",
    email: "jane@acme.com",
    phone: "+15551234567",
    linkedinUrl: "",
    industry: "SaaS",
    location: "NYC",
    notes: "",
    ...over,
  };
}

describe("eligibleTargets", () => {
  it("excludes not_interested, keeps everything else", () => {
    const pool = [
      target({ id: "a" }),
      target({ id: "b", disposition: "not_interested" }),
      target({ id: "c", callCount: 3 }), // still eligible — keeps cycling
      target({ id: "d", disposition: null }),
    ];
    expect(eligibleTargets(pool).map((t) => t.id)).toEqual(["a", "c", "d"]);
  });
});

describe("pickDaily", () => {
  it("returns at most `count` items", () => {
    const pool = Array.from({ length: 50 }, (_, i) => target({ id: `t${i}` }));
    expect(pickDaily(pool, 20).length).toBe(20);
  });

  it("returns the whole pool when smaller than count, no duplicates", () => {
    const pool = [target({ id: "a" }), target({ id: "b" }), target({ id: "c" })];
    const picked = pickDaily(pool, 20);
    expect(picked.length).toBe(3);
    expect(new Set(picked.map((t) => t.id)).size).toBe(3);
  });

  it("is deterministic with an injected rng and never duplicates", () => {
    const pool = Array.from({ length: 5 }, (_, i) => target({ id: `t${i}` }));
    const rng = () => 0; // always picks the first remaining item
    const picked = pickDaily(pool, 3, rng);
    expect(picked.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/dial/select.test.ts`
Expected: FAIL — cannot resolve `./select` / `eligibleTargets is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dial/select.ts`:

```ts
import type { Target } from "@/lib/types";

/** Targets still in rotation: anything not marked not_interested. */
export function eligibleTargets(targets: Target[]): Target[] {
  return targets.filter((t) => t.disposition !== "not_interested");
}

/**
 * Up to `count` unique random targets from `pool`.
 * `rng` returns a float in [0, 1); defaults to Math.random. Does not mutate `pool`.
 */
export function pickDaily(
  pool: Target[],
  count: number,
  rng: () => number = Math.random,
): Target[] {
  const remaining = [...pool];
  const out: Target[] = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * remaining.length);
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/dial/select.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dial/select.ts src/lib/dial/select.test.ts
git commit -m "feat(dial): add eligibility + random selection helpers"
```

---

### Task 3: Snapshot helpers (`src/lib/dial/snapshot.ts`)

**Files:**
- Create: `src/lib/dial/snapshot.ts`
- Test: `src/lib/dial/snapshot.test.ts`

**Interfaces:**
- Consumes: `Target`, `DialList`, `DialEntry` from `@/lib/types`; `eligibleTargets`, `pickDaily` from `./select`
- Produces:
  - `findToday(dialLists: DialList[], date: string): DialList | null`
  - `buildEntries(targets: Target[], count: number, rng?: () => number): DialEntry[]` — picks eligible targets and maps each to `{ targetId, label: "Company — Contact", outcome: null }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dial/snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { DialList, Target } from "@/lib/types";
import { findToday, buildEntries } from "./snapshot";

function target(over: Partial<Target>): Target {
  return {
    id: over.id ?? "t1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    company: over.company ?? "Acme",
    contactName: over.contactName ?? "Jane Doe",
    contactRole: "CTO",
    email: "jane@acme.com",
    phone: "+15551234567",
    linkedinUrl: "",
    industry: "SaaS",
    location: "NYC",
    notes: "",
    ...over,
  };
}

function dialList(over: Partial<DialList>): DialList {
  return {
    id: over.id ?? "d1",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    date: over.date ?? "2026-06-30",
    entries: over.entries ?? [],
  };
}

describe("findToday", () => {
  it("returns the list matching the date, else null", () => {
    const lists = [dialList({ id: "a", date: "2026-06-29" }), dialList({ id: "b", date: "2026-06-30" })];
    expect(findToday(lists, "2026-06-30")?.id).toBe("b");
    expect(findToday(lists, "2026-07-01")).toBeNull();
  });
});

describe("buildEntries", () => {
  it("maps picked targets to entries with a denormalized label and null outcome", () => {
    const targets = [target({ id: "a", company: "Acme", contactName: "Jane Doe" })];
    const entries = buildEntries(targets, 20);
    expect(entries).toEqual([{ targetId: "a", label: "Acme — Jane Doe", outcome: null }]);
  });

  it("excludes not_interested targets and caps at count", () => {
    const targets = [
      target({ id: "a" }),
      target({ id: "b", disposition: "not_interested" }),
      target({ id: "c" }),
    ];
    const entries = buildEntries(targets, 1, () => 0);
    expect(entries.length).toBe(1);
    expect(entries[0].targetId).toBe("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/dial/snapshot.test.ts`
Expected: FAIL — cannot resolve `./snapshot`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dial/snapshot.ts`:

```ts
import type { DialEntry, DialList, Target } from "@/lib/types";
import { eligibleTargets, pickDaily } from "./select";

/** The snapshot for a given YYYY-MM-DD date, or null if none exists yet. */
export function findToday(dialLists: DialList[], date: string): DialList | null {
  return dialLists.find((d) => d.date === date) ?? null;
}

/** Pick up to `count` eligible targets and turn them into fresh dial entries. */
export function buildEntries(
  targets: Target[],
  count: number,
  rng: () => number = Math.random,
): DialEntry[] {
  return pickDaily(eligibleTargets(targets), count, rng).map((t) => ({
    targetId: t.id,
    label: `${t.company} — ${t.contactName}`,
    outcome: null,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/dial/snapshot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dial/snapshot.ts src/lib/dial/snapshot.test.ts
git commit -m "feat(dial): add daily snapshot lookup + build helpers"
```

---

### Task 4: `/dial` page + navigation

**Files:**
- Create: `src/app/dial/page.tsx`
- Modify: `src/components/layout/nav.ts` (imports ~1-20; `NAV` array ~29-47)
- Reference (do not modify): `src/lib/targets/promote.ts` (`targetToLead`), `src/lib/selectors.ts` (`todayScorecard`), `src/components/ui/*`

**Interfaces:**
- Consumes: `useStore`, `useTargets`, `useDialLists`, `useScorecards`, `useSettings` from `@/lib/store`; `findToday`, `buildEntries` from `@/lib/dial/snapshot`; `targetToLead` from `@/lib/targets/promote`; `todayScorecard` from `@/lib/selectors`; `todayISO` from `@/lib/utils`; `DialEntry`, `DialList`, `Target` types.

- [ ] **Step 1: Add the nav entry**

In `src/components/layout/nav.ts`, add `PhoneOutgoing` to the lucide import list (alongside `PhoneCall`):

```ts
  PhoneCall,
  PhoneOutgoing,
```

Insert a `NAV` item directly **above** the Leads entry so it leads the Pipeline group:

```ts
  { href: "/inbox", label: "Inbox", icon: Inbox, group: "Pipeline" },
  { href: "/dial", label: "Dial List", icon: PhoneOutgoing, group: "Pipeline" },
  { href: "/leads", label: "Leads", icon: Users, group: "Pipeline" },
```

- [ ] **Step 2: Create the page skeleton with daily snapshot generation**

Create `src/app/dial/page.tsx`. This step establishes the data flow (generate-on-first-view) and an empty render; row UI and actions come next.

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { PhoneOutgoing } from "lucide-react";
import {
  useStore,
  useTargets,
  useDialLists,
  useScorecards,
  useSettings,
} from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { findToday, buildEntries } from "@/lib/dial/snapshot";
import { targetToLead } from "@/lib/targets/promote";
import { todayScorecard } from "@/lib/selectors";
import { todayISO, nowISO } from "@/lib/utils";
import type { DialEntry, Target } from "@/lib/types";

const DAILY_COUNT = 20;

const CALL_LABEL = ["—", "once", "twice", "thrice"];
function callLabel(n: number): string {
  return CALL_LABEL[n] ?? `${n}×`;
}

export default function DialPage() {
  const store = useStore();
  const targets = useTargets();
  const dialLists = useDialLists();
  const scorecards = useScorecards();
  const settings = useSettings();

  const today = todayISO();
  const todayList = findToday(dialLists, today);

  // Generate today's frozen snapshot once, on first view of the day.
  useEffect(() => {
    if (!store.ready) return;
    if (findToday(store.dialLists, today)) return;
    store.create("dialLists", { date: today, entries: buildEntries(targets, DAILY_COUNT) });
    // Intentionally runs only when readiness/date changes; targets read at creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.ready, today]);

  const targetById = useMemo(() => {
    const m = new Map<string, Target>();
    for (const t of targets) m.set(t.id, t);
    return m;
  }, [targets]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dial List"
        subtitle="Today's 20 prospects to call, drawn at random from your Targets. Refreshes tomorrow."
      />
      {!todayList || todayList.entries.length === 0 ? (
        <EmptyState
          icon={PhoneOutgoing}
          title="No one to dial yet"
          message="Import prospects on the Targets page and a list of 20 will appear here each day."
        />
      ) : (
        <Panel title={`Today · ${todayList.entries.length}`} noPad>
          {/* table added in Step 3 */}
        </Panel>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the row table and the three action handlers**

Replace the `{/* table added in Step 3 */}` placeholder with the table below, and add the three handlers above the `return` (after `targetById`).

Handlers (insert before `return`):

```tsx
  /** Replace one entry's fields within today's snapshot. */
  const patchEntry = (targetId: string, patch: Partial<DialEntry>) => {
    if (!todayList) return;
    const entries = todayList.entries.map((e) =>
      e.targetId === targetId ? { ...e, ...patch } : e,
    );
    store.update("dialLists", todayList.id, { entries });
  };

  /** Log a call: bump the target's count + stamp, and add 1 to today's Scorecard dials. */
  const logCall = (t: Target) => {
    store.update("targets", t.id, {
      callCount: (t.callCount ?? 0) + 1,
      lastCalledAt: nowISO(),
    });
    const sc = todayScorecard(scorecards);
    if (sc) {
      store.update("scorecards", sc.id, { dials: sc.dials + 1 });
    } else {
      store.create("scorecards", {
        date: todayISO(),
        dials: 1,
        emails: 0,
        linkedinMessages: 0,
        replies: 0,
        conversations: 0,
        leadsCreated: 0,
        meetingsBooked: 0,
        proposalsSent: 0,
        productHours: 0,
        seoWork: "",
        revenueClosed: 0,
        wins: "",
        problems: "",
        lessons: "",
        avoidTomorrow: "",
      });
    }
  };

  /** Interested: promote to a Lead, remove the target, mark the row done. */
  const markInterested = (t: Target) => {
    store.create("leads", targetToLead(t, settings.founderName));
    store.remove("targets", t.id);
    patchEntry(t.id, { outcome: "interested" });
  };

  /** Not interested: flag the target out of all future rotations, mark the row done. */
  const markNotInterested = (t: Target) => {
    store.update("targets", t.id, { disposition: "not_interested" });
    patchEntry(t.id, { outcome: "not_interested" });
  };
```

Table (replaces the placeholder inside the `<Panel>`):

```tsx
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Context</th>
                  <th className="text-right">Calls</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {todayList.entries.map((e) => {
                  const t = targetById.get(e.targetId);
                  const done = e.outcome != null;
                  if (!t || done) {
                    // Completed row — render from the denormalized label.
                    return (
                      <tr key={e.targetId} className="opacity-50">
                        <td className="font-medium" colSpan={5}>{e.label}</td>
                        <td className="text-right whitespace-nowrap">
                          {e.outcome === "interested" ? "→ Lead" : "Not interested"}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={e.targetId}>
                      <td className="font-medium text-[var(--color-ink)]">{t.company}</td>
                      <td className="whitespace-nowrap">{t.contactName} · {t.contactRole}</td>
                      <td className="whitespace-nowrap">
                        {t.phone ? (
                          <a className="link" href={`tel:${t.phone}`}>{t.phone}</a>
                        ) : (
                          <span className="text-[var(--color-dim)]">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-[var(--color-dim)]">
                        {[t.industry, t.location].filter(Boolean).join(" · ")}
                      </td>
                      <td className="text-right tnum">{callLabel(t.callCount ?? 0)}</td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button className="btn btn-sm" onClick={() => logCall(t)}>Log call</button>
                          <button className="btn btn-sm" onClick={() => markInterested(t)}>Interested</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => markNotInterested(t)}>Not interested</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
```

- [ ] **Step 4: Verify build and behavior**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

Then run the app (`npm run dev`) and manually verify:
1. Visiting `/dial` with targets present shows up to 20 rows; refreshing the page keeps the **same** 20 (snapshot frozen).
2. **Log call** flips the Calls badge — / once / twice / thrice and increments "Dials today" on `/scorecard`.
3. **Interested** greys the row to "→ Lead", removes the target from `/targets`, and creates a new record on `/leads`.
4. **Not interested** greys the row; that target never reappears on a future day's list.
5. With an empty targets list, `/dial` shows the empty state.

- [ ] **Step 5: Commit**

```bash
git add src/app/dial/page.tsx src/components/layout/nav.ts
git commit -m "feat(dial): add /dial daily call list page and nav entry"
```

---

## Notes for the implementer

- **One scorecard per day** is an existing invariant (`ScorecardForm` upserts by date); `logCall` preserves it by updating the existing record when present and only creating when today's is absent.
- **Why generate in `useEffect`, not during render:** `store.create` mutates state; calling it in render would loop. The effect guards on `store.ready` and re-checks `findToday(store.dialLists, today)` to stay idempotent across the hydrate→ready transition and Strict Mode double-invocation.
- **`store.dialLists` vs `dialLists` in the effect:** read `store.dialLists` inside the effect (latest value) for the idempotency guard; the top-level `todayList` is for rendering.
- Do not re-sort or mutate `todayList.entries` in render — order is the frozen pick order.
```
