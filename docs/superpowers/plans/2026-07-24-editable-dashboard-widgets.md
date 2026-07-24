# Editable Dashboard Widgets + Graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's four effort metrics (Calls made, Meetings booked, LinkedIn posts, Cash collected) directly editable inline — no scorecard logging — with each metric and each project widget showing a mini sparkline of its history.

**Architecture:** A new `metricEntries` store collection holds one value per metric per day (current value = latest day; sparkline = the history). Clicking a widget upserts today's entry. Project widgets stay derived from the Projects list. A one-time, hydration-gated seed carries existing derived totals into the new collection so nothing looks blank.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7, Tailwind v4, lucide-react, hand-rolled SVG charts, Vitest (node env — no DOM rendering in tests).

## Global Constraints

- New collection registration must be added at **every** DataShape construction site: `src/lib/types.ts` (interface), `src/lib/db/sqlite.ts` (`COLLECTIONS` tuple), `src/lib/store.tsx` (`EMPTY`), `src/lib/seed.ts` (seed return), `src/lib/db/apiAdapter.ts` (empty shape). `npx tsc --noEmit` is the safety net for any missed site.
- `metricEntries` semantics: one record per `(metric, date)`. Current value = entry with max `date` (0 if none). Series = entries ascending by `date`.
- Editable metrics: `callsMade`, `meetingsBooked`, `linkedinPosts`, `cashCollected`. Cash renders via `fmtCurrency(value, settings.currency)`.
- Derived metrics unchanged: built = stages building/testing/demo-ready/sent/closed; pitched = stages demo-ready/sent/closed OR type proposal/demo; waiting = stages sent/demo-ready.
- The continuity seed must be **hydration-gated on `store.ready` with a ref guard** (mirror `src/app/news/page.tsx:36-54`) — never seed during render, never before hydration (else derived totals read 0).
- Test command: `npm run test` (vitest run). Focused: `npm run test -- selectors`. Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- `/scorecard` and its charts must remain untouched. Do not modify `src/components/ui/TrendChart.tsx`.

---

### Task 1: Register the `metricEntries` collection

**Files:**
- Modify: `src/lib/types.ts` (add enum + interface; add field to `DataShape`)
- Modify: `src/lib/db/sqlite.ts:16-34` (`COLLECTIONS` tuple)
- Modify: `src/lib/store.tsx:75-93` (`EMPTY`)
- Modify: `src/lib/seed.ts` (seed return, near `notes: []` ~line 748)
- Modify: `src/lib/db/apiAdapter.ts` (empty shape, near `notes: []` ~line 54)

**Interfaces:**
- Produces:
  ```ts
  const METRIC_KEYS = ["callsMade", "meetingsBooked", "linkedinPosts", "cashCollected"] as const;
  type MetricKey = (typeof METRIC_KEYS)[number];
  interface MetricEntry extends BaseRecord { metric: MetricKey; date: string; value: number; }
  ```
  and `DataShape.metricEntries: MetricEntry[]`. Consumed by Tasks 3 and 4.

- [ ] **Step 1: Add the enum + interface to `types.ts`**

In `src/lib/types.ts`, immediately **before** `export interface DataShape {`, add:

```ts
export const METRIC_KEYS = [
  "callsMade",
  "meetingsBooked",
  "linkedinPosts",
  "cashCollected",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** One editable dashboard metric's value on one day (one record per metric+date). */
export interface MetricEntry extends BaseRecord {
  metric: MetricKey;
  date: string; // ISO date (YYYY-MM-DD)
  value: number;
}
```

- [ ] **Step 2: Add the field to `DataShape`**

In `src/lib/types.ts`, inside `export interface DataShape`, add `metricEntries` right after `notes: Note[];`:

```ts
  notes: Note[];
  metricEntries: MetricEntry[];
  settings: Settings;
```

- [ ] **Step 3: Register in the `COLLECTIONS` tuple**

In `src/lib/db/sqlite.ts`, add `"metricEntries",` right after `"notes",` in the `COLLECTIONS` array:

```ts
  "notes",
  "metricEntries",
] as const;
```

- [ ] **Step 4: Add to the three DataShape literals**

In `src/lib/store.tsx` (`EMPTY`), `src/lib/seed.ts` (seed return), and `src/lib/db/apiAdapter.ts` (empty shape), add `metricEntries: [],` right after the `notes: []`/`notes: [],` line in each file.

- [ ] **Step 5: Typecheck — catches any missed construction site**

Run: `npx tsc --noEmit`
Expected: no errors. (If "Property 'metricEntries' is missing in type ... DataShape" appears, add `metricEntries: []` at that site.)

- [ ] **Step 6: Run the full suite**

Run: `npm run test`
Expected: 152 passed (unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/db/sqlite.ts src/lib/store.tsx src/lib/seed.ts src/lib/db/apiAdapter.ts
git commit -m "feat(dashboard): register metricEntries collection"
```

---

### Task 2: Sparkline + MetricWidget components

**Files:**
- Create: `src/components/ui/Sparkline.tsx`
- Create: `src/components/dashboard/MetricWidget.tsx`

**Interfaces:**
- Consumes: `fmtCompact` from `@/lib/utils`; `LucideIcon`, `Pencil` from `lucide-react`.
- Produces:
  ```ts
  function Sparkline(props: { data: number[]; color?: string; height?: number }): JSX.Element
  function MetricWidget(props: {
    label: string; value: number; icon: LucideIcon; series: number[];
    display?: string; accent?: boolean; editable?: boolean;
    onCommit?: (value: number) => void;
  }): JSX.Element
  ```
  Consumed by Task 4's page.

- [ ] **Step 1: Create the `Sparkline` component**

Create `src/components/ui/Sparkline.tsx`:

```tsx
"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** A minimal, dependency-free SVG sparkline: one polyline, no axes/tooltip. */
export function Sparkline({
  data,
  color = "var(--color-accent)",
  height = 34,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pad = 2;
  const innerW = Math.max(0, w - pad * 2);
  const innerH = height - pad * 2;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const x = (i: number) =>
    data.length <= 1 ? pad + innerW / 2 : pad + (i / (data.length - 1)) * innerW;
  const y = (v: number) => pad + innerH - ((v - min) / range) * innerH;
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  return (
    <div ref={wrapRef} className="w-full" style={{ height }}>
      {w > 0 && data.length > 0 && (
        <svg width={w} height={height} className="block">
          {data.length === 1 ? (
            <line
              x1={pad}
              x2={w - pad}
              y1={y(data[0])}
              y2={y(data[0])}
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.7}
            />
          ) : (
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the `MetricWidget` component**

Create `src/components/dashboard/MetricWidget.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Pencil } from "lucide-react";
import { fmtCompact } from "@/lib/utils";
import { Sparkline } from "@/components/ui/Sparkline";

/** A KPI card: label + icon, a value (optionally click-to-edit), and a sparkline. */
export function MetricWidget({
  label,
  value,
  icon: Icon,
  series,
  display,
  accent,
  editable,
  onCommit,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  series: number[];
  display?: string;
  accent?: boolean;
  editable?: boolean;
  onCommit?: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    if (!editable) return;
    setDraft(String(value));
    setEditing(true);
  };
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && onCommit) onCommit(Math.max(0, n));
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  return (
    <div className="panel p-4 flex flex-col gap-3 hover:border-[var(--color-line-strong)] transition-colors">
      <div className="flex items-start justify-between">
        <span className="text-[0.7rem] font-medium tracking-[0.04em] uppercase text-[var(--color-muted)] leading-tight max-w-[80%]">
          {label}
        </span>
        <Icon
          size={15}
          strokeWidth={1.8}
          className={accent ? "text-[var(--color-accent)]" : "text-[var(--color-dim)]"}
        />
      </div>

      <div className="min-h-[2rem] flex items-baseline">
        {editing ? (
          <input
            autoFocus
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") cancel();
            }}
            className="input tnum text-[1.5rem] font-semibold leading-none w-full max-w-[8rem] py-0"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={!editable}
            title={editable ? "Click to edit" : undefined}
            className={`group tnum text-[1.7rem] font-semibold leading-none text-[var(--color-ink)] inline-flex items-center gap-1.5 ${
              editable ? "cursor-text hover:text-white" : "cursor-default"
            }`}
          >
            {display ?? fmtCompact(value)}
            {editable && (
              <Pencil
                size={12}
                className="text-[var(--color-dim)] opacity-0 group-hover:opacity-100 transition-opacity"
              />
            )}
          </button>
        )}
      </div>

      <Sparkline data={series} color={accent ? "var(--color-accent)" : "var(--color-muted)"} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The components aren't imported yet; this only confirms they compile. `page.tsx` still uses the old `allTimeMetrics`/`MetricCard` and stays green.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Sparkline.tsx src/components/dashboard/MetricWidget.tsx
git commit -m "feat(dashboard): add Sparkline and editable MetricWidget components"
```

---

### Task 3: New dashboard selectors + tests

**Files:**
- Modify: `src/lib/selectors.ts` (add new selectors; leave `allTimeMetrics` in place for now)
- Modify: `src/lib/selectors.test.ts` (add tests for the new selectors; keep existing tests)

**Interfaces:**
- Consumes: `MetricEntry`, `MetricKey`, `Project` from `@/lib/types`.
- Produces:
  ```ts
  interface MetricView { key: MetricKey; current: number; series: { label: string; value: number }[]; }
  function metricView(entries: MetricEntry[], key: MetricKey): MetricView
  function findMetricEntry(entries: MetricEntry[], key: MetricKey, date: string): MetricEntry | undefined
  interface ProjectCounts { built: number; pitched: number; waiting: number; }
  function projectCounts(projects: Project[]): ProjectCounts
  function projectSeries(projects: Project[], kind: "built" | "pitched" | "waiting"): { label: string; value: number }[]
  ```
  Consumed by Task 4's page.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/selectors.test.ts`. First extend the import line at the top:

```ts
import { allTimeMetrics, metricView, findMetricEntry, projectCounts, projectSeries } from "./selectors";
import type { Scorecard, Project, MetricEntry, MetricKey } from "@/lib/types";
```

Add a `metricEntry` factory after the existing `project()` factory:

```ts
function metricEntry(over: Partial<MetricEntry> & { metric: MetricKey; date: string; value: number }): MetricEntry {
  return {
    id: over.id ?? `${over.metric}-${over.date}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}
```

Then append these `describe` blocks:

```ts
describe("metricView", () => {
  it("returns 0 current and empty series when no entries", () => {
    const v = metricView([], "callsMade");
    expect(v.current).toBe(0);
    expect(v.series).toEqual([]);
  });

  it("current is the latest-dated entry; series is ascending by date and metric-filtered", () => {
    const entries: MetricEntry[] = [
      metricEntry({ metric: "callsMade", date: "2026-07-03", value: 30 }),
      metricEntry({ metric: "callsMade", date: "2026-07-01", value: 10 }),
      metricEntry({ metric: "callsMade", date: "2026-07-02", value: 20 }),
      metricEntry({ metric: "meetingsBooked", date: "2026-07-05", value: 99 }),
    ];
    const v = metricView(entries, "callsMade");
    expect(v.current).toBe(30);
    expect(v.series.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(v.series.map((p) => p.label)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
  });
});

describe("findMetricEntry", () => {
  const entries: MetricEntry[] = [
    metricEntry({ metric: "callsMade", date: "2026-07-01", value: 5 }),
    metricEntry({ metric: "callsMade", date: "2026-07-02", value: 8 }),
  ];
  it("finds the entry for a metric+date", () => {
    expect(findMetricEntry(entries, "callsMade", "2026-07-02")?.value).toBe(8);
  });
  it("returns undefined when absent", () => {
    expect(findMetricEntry(entries, "callsMade", "2026-07-09")).toBeUndefined();
    expect(findMetricEntry(entries, "meetingsBooked", "2026-07-01")).toBeUndefined();
  });
});

describe("projectCounts", () => {
  it("classifies built / pitched / waiting", () => {
    const c = projectCounts([
      project({ id: "1", stage: "idea", type: "research" }),
      project({ id: "2", stage: "building", type: "paid project" }),
      project({ id: "3", stage: "sent", type: "paid project" }),
      project({ id: "4", stage: "demo-ready", type: "demo" }),
      project({ id: "5", stage: "closed", type: "paid project" }),
      project({ id: "6", stage: "discovery", type: "proposal" }),
    ]);
    expect(c.built).toBe(4);
    expect(c.pitched).toBe(4);
    expect(c.waiting).toBe(2);
  });
});

describe("projectSeries", () => {
  it("cumulative count of qualifying projects, ascending by createdAt", () => {
    const s = projectSeries(
      [
        project({ id: "a", stage: "building", createdAt: "2026-05-10T00:00:00.000Z" }),
        project({ id: "b", stage: "idea", createdAt: "2026-05-11T00:00:00.000Z" }), // not built
        project({ id: "c", stage: "closed", createdAt: "2026-06-01T00:00:00.000Z" }),
      ],
      "built",
    );
    expect(s.map((p) => p.value)).toEqual([1, 2]);
    expect(s.map((p) => p.label)).toEqual(["2026-05-10", "2026-06-01"]);
  });

  it("empty when nothing qualifies", () => {
    expect(projectSeries([project({ id: "x", stage: "idea", type: "research" })], "built")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- selectors`
Expected: FAIL — `metricView`/`findMetricEntry`/`projectCounts`/`projectSeries` are not exported.

- [ ] **Step 3: Implement the new selectors**

In `src/lib/selectors.ts`, add `MetricEntry`, `MetricKey` to the existing `import type { ... } from "@/lib/types";` line. Then append at the end of the file:

```ts
export interface MetricView {
  key: MetricKey;
  current: number;
  series: { label: string; value: number }[];
}

/** Latest-dated value for a metric (0 if none) + its full ascending series. */
export function metricView(entries: MetricEntry[], key: MetricKey): MetricView {
  const mine = entries
    .filter((e) => e.metric === key)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    key,
    current: mine.length ? mine[mine.length - 1].value : 0,
    series: mine.map((e) => ({ label: e.date, value: e.value })),
  };
}

/** The entry for a metric on a given date, if any (for upsert-by-day). */
export function findMetricEntry(
  entries: MetricEntry[],
  key: MetricKey,
  date: string,
): MetricEntry | undefined {
  return entries.find((e) => e.metric === key && e.date === date);
}

function isBuilt(p: Project): boolean {
  return BUILT_STAGES.includes(p.stage);
}
function isPitched(p: Project): boolean {
  return PITCHED_STAGES.includes(p.stage) || PITCHED_TYPES.includes(p.type);
}
function isWaiting(p: Project): boolean {
  return WAITING_STAGES.includes(p.stage);
}

export interface ProjectCounts {
  built: number;
  pitched: number;
  waiting: number;
}

export function projectCounts(projects: Project[]): ProjectCounts {
  return {
    built: projects.filter(isBuilt).length,
    pitched: projects.filter(isPitched).length,
    waiting: projects.filter(isWaiting).length,
  };
}

/** Cumulative count of qualifying projects over time, by createdAt (ascending). */
export function projectSeries(
  projects: Project[],
  kind: "built" | "pitched" | "waiting",
): { label: string; value: number }[] {
  const pred = kind === "built" ? isBuilt : kind === "pitched" ? isPitched : isWaiting;
  const dates = projects
    .filter(pred)
    .map((p) => p.createdAt.slice(0, 10))
    .sort((a, b) => a.localeCompare(b));
  let cum = 0;
  return dates.map((d) => ({ label: d, value: ++cum }));
}
```

Note: `BUILT_STAGES`, `PITCHED_STAGES`, `PITCHED_TYPES`, `WAITING_STAGES` already exist as module consts (defined for `allTimeMetrics`); reuse them — do not redeclare.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- selectors`
Expected: PASS (existing `allTimeMetrics` tests + the 6 new ones).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (`allTimeMetrics` still present, page still uses it).

- [ ] **Step 6: Commit**

```bash
git add src/lib/selectors.ts src/lib/selectors.test.ts
git commit -m "feat(dashboard): add metricView, findMetricEntry, projectCounts, projectSeries selectors"
```

---

### Task 4: Rebuild the page with editable widgets + seed; remove the superseded code

**Files:**
- Modify: `src/app/page.tsx` (full replacement)
- Modify: `src/lib/selectors.ts` (remove `allTimeMetrics` + its `AllTimeMetrics` interface)
- Modify: `src/lib/selectors.test.ts` (remove the `allTimeMetrics` describe block + its imports/factories that become unused)
- Delete: `src/components/dashboard/MetricCard.tsx` (only if no remaining importers)

**Interfaces:**
- Consumes: `metricView`, `findMetricEntry`, `projectCounts`, `projectSeries` (Task 3); `MetricWidget` (Task 2); `MetricKey` (Task 1); `store.ready`, `create`, `update`, `metricEntries` from `useStore()`.

- [ ] **Step 1: Replace the home page**

Replace the entire contents of `src/app/page.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  CalendarCheck,
  Phone,
  Linkedin,
  Hammer,
  Send,
  Clock,
  Banknote,
  Sparkles,
  Quote,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricWidget } from "@/components/dashboard/MetricWidget";
import { useQuickAdd } from "@/components/forms/QuickAdd";
import {
  metricView,
  findMetricEntry,
  projectCounts,
  projectSeries,
} from "@/lib/selectors";
import { affirmationForDate } from "@/lib/affirmations";
import { fmtCurrency, todayISO } from "@/lib/utils";
import type { MetricKey } from "@/lib/types";

export default function DashboardPage() {
  const { projects, scorecards, metricEntries, settings, ready, create, update } = useStore();
  const quickAdd = useQuickAdd();

  // One-time continuity seed: carry the existing derived totals into the new
  // editable metrics once the store has hydrated, so nothing looks blank.
  // Ref-guarded + gated on `ready` (never during render) to avoid a Strict-Mode
  // double-create — mirrors src/app/news/page.tsx.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!ready || seededRef.current) return;
    seededRef.current = true;
    const today = todayISO();
    const derived: Record<MetricKey, number> = {
      callsMade: scorecards.reduce((a, s) => a + (s.dials || 0), 0),
      meetingsBooked: scorecards.reduce((a, s) => a + (s.meetingsBooked || 0), 0),
      linkedinPosts: scorecards.reduce((a, s) => a + (s.linkedinPosts || 0), 0),
      cashCollected: scorecards.reduce((a, s) => a + (s.revenueClosed || 0), 0),
    };
    (Object.keys(derived) as MetricKey[]).forEach((key) => {
      const hasAny = metricEntries.some((e) => e.metric === key);
      if (!hasAny && derived[key] > 0) {
        create("metricEntries", { metric: key, date: today, value: derived[key] });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const commit = (key: MetricKey, value: number) => {
    const today = todayISO();
    const existing = findMetricEntry(metricEntries, key, today);
    if (existing) update("metricEntries", existing.id, { value });
    else create("metricEntries", { metric: key, date: today, value });
  };

  const calls = metricView(metricEntries, "callsMade");
  const meetings = metricView(metricEntries, "meetingsBooked");
  const linkedin = metricView(metricEntries, "linkedinPosts");
  const cash = metricView(metricEntries, "cashCollected");
  const pc = projectCounts(projects);

  const vals = (s: { value: number }[]) => s.map((p) => p.value);
  const affirmation = affirmationForDate(new Date());
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${settings.founderName || "Emil"}`}
        subtitle={`${settings.businessName || "Pallisade Data"} — all time`}
        actions={
          <>
            <button className="btn" onClick={() => quickAdd.open("scorecard")}>
              <CalendarCheck size={15} /> Log day
            </button>
            <Link href="/review" className="btn btn-accent">
              <Sparkles size={15} /> AI Review
            </Link>
          </>
        }
      />

      {/* Daily affirmation */}
      <div className="panel p-6 flex items-start gap-4">
        <Quote size={22} className="text-[var(--color-accent)] shrink-0 mt-1" />
        <p className="text-[1.15rem] leading-relaxed text-[var(--color-ink)] font-medium">
          {affirmation}
        </p>
      </div>

      {/* Editable + derived progress widgets */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricWidget
          label="Meetings booked"
          value={meetings.current}
          icon={CalendarCheck}
          accent
          editable
          series={vals(meetings.series)}
          onCommit={(v) => commit("meetingsBooked", v)}
        />
        <MetricWidget
          label="Calls made"
          value={calls.current}
          icon={Phone}
          editable
          series={vals(calls.series)}
          onCommit={(v) => commit("callsMade", v)}
        />
        <MetricWidget
          label="LinkedIn posts"
          value={linkedin.current}
          icon={Linkedin}
          editable
          series={vals(linkedin.series)}
          onCommit={(v) => commit("linkedinPosts", v)}
        />
        <MetricWidget
          label="Cash collected"
          value={cash.current}
          icon={Banknote}
          accent
          editable
          display={fmtCurrency(cash.current, settings.currency)}
          series={vals(cash.series)}
          onCommit={(v) => commit("cashCollected", v)}
        />
        <MetricWidget
          label="Projects built"
          value={pc.built}
          icon={Hammer}
          accent
          series={vals(projectSeries(projects, "built"))}
        />
        <MetricWidget
          label="Projects pitched"
          value={pc.pitched}
          icon={Send}
          series={vals(projectSeries(projects, "pitched"))}
        />
        <MetricWidget
          label="Waiting for feedback"
          value={pc.waiting}
          icon={Clock}
          series={vals(projectSeries(projects, "waiting"))}
        />
      </div>
    </div>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
```

- [ ] **Step 2: Remove the superseded `allTimeMetrics` selector**

In `src/lib/selectors.ts`, delete the `export interface AllTimeMetrics { ... }` block and the entire `export function allTimeMetrics(...) { ... }` function. **Keep** the `BUILT_STAGES`/`PITCHED_STAGES`/`PITCHED_TYPES`/`WAITING_STAGES` consts and the `isBuilt`/`isPitched`/`isWaiting` helpers (still used by `projectCounts`/`projectSeries`).

- [ ] **Step 3: Remove the obsolete `allTimeMetrics` tests**

In `src/lib/selectors.test.ts`:
- Remove `allTimeMetrics` from the import: `import { metricView, findMetricEntry, projectCounts, projectSeries } from "./selectors";`
- Delete the entire `describe("allTimeMetrics", () => { ... })` block.
- The `scorecard()` factory and the `Scorecard` type import are now unused — remove the `scorecard()` function and drop `Scorecard` from the `import type` line (keep `Project`, `MetricEntry`, `MetricKey`).

- [ ] **Step 4: Remove the superseded `MetricCard` component if unused**

Run: `grep -rl "MetricCard" src | grep -v "MetricWidget"`
Expected: no output (the old `page.tsx` was the only importer). If the only match is `src/components/dashboard/MetricCard.tsx` itself, delete it:

```bash
git rm src/components/dashboard/MetricCard.tsx
```

If any other file imports it, leave it and note it in the commit.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. No dangling references to `allTimeMetrics`, `AllTimeMetrics`, or `MetricCard`.

- [ ] **Step 6: Run the full suite**

Run: `npm run test`
Expected: all pass (the removed `allTimeMetrics` tests are gone; the Task 3 selector tests remain).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds; `/` compiles with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/lib/selectors.ts src/lib/selectors.test.ts
git commit -m "feat(dashboard): editable widgets with sparklines; remove derived-total path"
```

---

## Self-Review

**Spec coverage:**
- `metricEntries` collection + registration → Task 1. ✅
- `metricView` / `findMetricEntry` / `projectCounts` / `projectSeries` → Task 3. ✅
- Remove `allTimeMetrics`, no dead code → Task 4 Steps 2-3. ✅
- `Sparkline` (separate from `TrendChart`) + `MetricWidget` inline-edit → Task 2. ✅
- 4 editable widgets (upsert today), 3 derived widgets, cash currency → Task 4 Step 1. ✅
- Continuity seed, hydration-gated + ref-guarded → Task 4 Step 1 effect. ✅
- Affirmation banner retained; `/scorecard`/`TrendChart` untouched → Task 4 (not modified). ✅
- Tests for selectors + upsert helper → Task 3. ✅

**Placeholder scan:** No TBD/TODO; all code shown in full. ✅

**Type consistency:** `metricView(entries, key)`, `findMetricEntry(entries, key, date)`, `projectCounts(projects)`, `projectSeries(projects, kind)` signatures match between Task 3 definition, its tests, and Task 4's call sites. `MetricWidget` prop shape (`series: number[]`, `onCommit: (value:number)=>void`) matches Task 2 definition and Task 4 usage. `create("metricEntries", { metric, date, value })` matches the `MetricEntry` shape (id/createdAt/updatedAt auto-filled by the store's `create`). `store.ready` used in Task 4 exists on `StoreValue`. ✅

**Ordering check:** `allTimeMetrics` is removed (Task 4) only in the same task that stops `page.tsx` importing it, so every task's `tsc` gate stays green. Task 2 components and Task 3 selectors are additive and don't break the still-old page. ✅
