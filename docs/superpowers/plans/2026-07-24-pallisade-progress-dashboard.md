# Pallisade Progress Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily-overview home page (`/`) with an all-time "how far have I come" progress dashboard: a daily rotating affirmation banner plus seven all-time stat blocks.

**Architecture:** Add one new daily counter (`linkedinPosts`) to the `Scorecard` model and its form. Add a pure `allTimeMetrics()` selector that aggregates all scorecards and classifies projects. Add a deterministic `affirmationForDate()` module. Rebuild `src/app/page.tsx` to render the banner + seven `MetricCard`s from these two functions. The daily panels are dropped from the home page; their components/selectors stay in the repo untouched.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7, Tailwind v4, lucide-react, Vitest.

## Global Constraints

- All scorecard sums must treat missing/undefined fields as 0 (`value || 0`) — old DB rows predate `linkedinPosts`, so **no migration is performed**.
- Reuse the existing `MetricCard` component (`src/components/dashboard/MetricCard.tsx`) for all stat blocks.
- Currency values use the existing `fmtCurrency(value, settings.currency)` helper (`src/lib/utils.ts`).
- Follow existing file conventions: `"use client"` on page components, `@/` path alias, Vitest `import { describe, it, expect } from "vitest"`.
- Keep `/scorecard` working unchanged apart from the one new field.
- Test command: `npm run test` (alias for `vitest run`). Typecheck: `npx tsc --noEmit`.

---

### Task 1: Add the `linkedinPosts` daily field to the data model

**Files:**
- Modify: `src/lib/types.ts` (Scorecard interface, ~line 181)
- Modify: `src/components/forms/ScorecardForm.tsx` (NUM_FIELDS ~line 15, draft init ~line 31)
- Modify: `src/app/dial/page.tsx:100-117` (new-scorecard literal)
- Modify: `src/lib/seed.ts` (~line 580 + rec literal ~line 595)

**Interfaces:**
- Produces: `Scorecard.linkedinPosts: number` — a required field on the `Scorecard` type consumed by Task 2's selector and Task 4's page.

- [ ] **Step 1: Add the field to the `Scorecard` interface**

In `src/lib/types.ts`, inside `export interface Scorecard`, add the field right after `linkedinMessages: number;`:

```ts
  linkedinMessages: number;
  linkedinPosts: number;
```

- [ ] **Step 2: Add the field to the scorecard form**

In `src/components/forms/ScorecardForm.tsx`, add to the `NUM_FIELDS` array right after the `linkedinMessages` entry:

```ts
  { key: "linkedinMessages", label: "LinkedIn messages" },
  { key: "linkedinPosts", label: "LinkedIn posts" },
```

Then in the `useState` draft initializer, add right after the `linkedinMessages` line:

```ts
    linkedinMessages: initial?.linkedinMessages ?? 0,
    linkedinPosts: initial?.linkedinPosts ?? 0,
```

- [ ] **Step 3: Add the field to the dial-page scorecard literal**

In `src/app/dial/page.tsx`, in the `store.create("scorecards", { ... })` object (~line 100), add after `linkedinMessages: 0,`:

```ts
        linkedinMessages: 0,
        linkedinPosts: 0,
```

- [ ] **Step 4: Add a plausible seed value**

In `src/lib/seed.ts`, after the `const linkedinMessages = ...` line (~580), add:

```ts
    const linkedinPosts = !weekend && i % 3 === 0 ? 1 : 0;
```

Then in the `rec({ ... })` scorecard object, add after `linkedinMessages,` (~595):

```ts
          linkedinMessages,
          linkedinPosts,
```

- [ ] **Step 5: Typecheck to verify every Scorecard literal is updated**

Run: `npx tsc --noEmit`
Expected: no errors. (If a "Property 'linkedinPosts' is missing" error appears, a Scorecard literal was missed — add `linkedinPosts: 0` there.)

- [ ] **Step 6: Run the existing test suite to confirm nothing broke**

Run: `npm run test`
Expected: all tests PASS (same count as before this task).

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/components/forms/ScorecardForm.tsx src/app/dial/page.tsx src/lib/seed.ts
git commit -m "feat(scorecard): add linkedinPosts daily field"
```

---

### Task 2: Add the `allTimeMetrics()` selector

**Files:**
- Modify: `src/lib/selectors.ts` (append new interface + function at end of file)
- Test: `src/lib/selectors.test.ts` (new file)

**Interfaces:**
- Consumes: `Scorecard` (with `linkedinPosts` from Task 1), `Project`, `ProjectStage`, `ProjectType` from `@/lib/types`.
- Produces:
  ```ts
  interface AllTimeMetrics {
    meetingsBooked: number;
    callsMade: number;
    linkedinPosts: number;
    projectsBuilt: number;
    projectsPitched: number;
    waitingForFeedback: number;
    cashCollected: number;
  }
  function allTimeMetrics(scorecards: Scorecard[], projects: Project[]): AllTimeMetrics
  ```
  Consumed by Task 4's page. Note argument order: **scorecards first, then projects.**

- [ ] **Step 1: Write the failing test**

Create `src/lib/selectors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Scorecard, Project } from "@/lib/types";
import { allTimeMetrics } from "./selectors";

function scorecard(over: Partial<Scorecard>): Scorecard {
  return {
    id: over.id ?? "s1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    date: over.date ?? "2026-07-01",
    dials: 0,
    emails: 0,
    linkedinMessages: 0,
    linkedinPosts: 0,
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
    ...over,
  };
}

function project(over: Partial<Project>): Project {
  return {
    id: over.id ?? "p1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    name: over.name ?? "Proj",
    company: "Acme",
    type: over.type ?? "paid project",
    stage: over.stage ?? "idea",
    priority: "medium",
    startDate: null,
    dueDate: null,
    currentMilestone: "",
    currentBlocker: "",
    nextAction: "",
    deliverables: "",
    notes: "",
    ...over,
  };
}

describe("allTimeMetrics", () => {
  it("sums scorecard counters across all days", () => {
    const m = allTimeMetrics(
      [
        scorecard({ id: "a", dials: 10, meetingsBooked: 2, linkedinPosts: 1, revenueClosed: 500 }),
        scorecard({ id: "b", dials: 5, meetingsBooked: 3, linkedinPosts: 4, revenueClosed: 1500 }),
      ],
      [],
    );
    expect(m.callsMade).toBe(15);
    expect(m.meetingsBooked).toBe(5);
    expect(m.linkedinPosts).toBe(5);
    expect(m.cashCollected).toBe(2000);
  });

  it("treats a missing linkedinPosts field as 0", () => {
    const legacy = scorecard({ id: "old", dials: 3 });
    // simulate a pre-migration row lacking the field
    delete (legacy as Partial<Scorecard>).linkedinPosts;
    const m = allTimeMetrics([legacy], []);
    expect(m.linkedinPosts).toBe(0);
    expect(m.callsMade).toBe(3);
  });

  it("classifies projects into built / pitched / waiting", () => {
    const m = allTimeMetrics(
      [],
      [
        project({ id: "1", stage: "idea", type: "research" }),      // none
        project({ id: "2", stage: "building", type: "paid project" }), // built
        project({ id: "3", stage: "sent", type: "paid project" }),  // built + pitched + waiting
        project({ id: "4", stage: "demo-ready", type: "demo" }),    // built + pitched + waiting
        project({ id: "5", stage: "closed", type: "paid project" }),// built + pitched
        project({ id: "6", stage: "discovery", type: "proposal" }), // pitched (by type only)
      ],
    );
    expect(m.projectsBuilt).toBe(4);       // ids 2,3,4,5
    expect(m.projectsPitched).toBe(4);     // ids 3,4,5 (stage) + 6 (type)
    expect(m.waitingForFeedback).toBe(2);  // ids 3,4
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- selectors`
Expected: FAIL with "allTimeMetrics is not a function" (or export-not-found).

- [ ] **Step 3: Implement the selector**

Append to the end of `src/lib/selectors.ts`:

```ts
export interface AllTimeMetrics {
  meetingsBooked: number;
  callsMade: number;
  linkedinPosts: number;
  projectsBuilt: number;
  projectsPitched: number;
  waitingForFeedback: number;
  cashCollected: number;
}

const BUILT_STAGES: string[] = ["building", "testing", "demo-ready", "sent", "closed"];
const PITCHED_STAGES: string[] = ["demo-ready", "sent", "closed"];
const PITCHED_TYPES: string[] = ["proposal", "demo"];
const WAITING_STAGES: string[] = ["sent", "demo-ready"];

export function allTimeMetrics(
  scorecards: Scorecard[],
  projects: Project[],
): AllTimeMetrics {
  const sum = (pick: (s: Scorecard) => number) =>
    scorecards.reduce((acc, s) => acc + (pick(s) || 0), 0);

  return {
    meetingsBooked: sum((s) => s.meetingsBooked),
    callsMade: sum((s) => s.dials),
    linkedinPosts: sum((s) => s.linkedinPosts),
    projectsBuilt: projects.filter((p) => BUILT_STAGES.includes(p.stage)).length,
    projectsPitched: projects.filter(
      (p) => PITCHED_STAGES.includes(p.stage) || PITCHED_TYPES.includes(p.type),
    ).length,
    waitingForFeedback: projects.filter((p) => WAITING_STAGES.includes(p.stage)).length,
    cashCollected: sum((s) => s.revenueClosed),
  };
}
```

(`Scorecard` and `Project` are already imported at the top of `selectors.ts`; confirm — if not, add them to the existing `import type { ... } from "@/lib/types";` line.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- selectors`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/selectors.ts src/lib/selectors.test.ts
git commit -m "feat(dashboard): add allTimeMetrics selector"
```

---

### Task 3: Add the daily affirmation module

**Files:**
- Create: `src/lib/affirmations.ts`
- Test: `src/lib/affirmations.test.ts`

**Interfaces:**
- Produces: `function affirmationForDate(date: Date): string` — returns a stable-per-day affirmation. Consumed by Task 4's page.

- [ ] **Step 1: Write the failing test**

Create `src/lib/affirmations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { affirmationForDate, AFFIRMATIONS } from "./affirmations";

describe("affirmationForDate", () => {
  it("is deterministic for the same date", () => {
    const a = affirmationForDate(new Date(2026, 6, 24));
    const b = affirmationForDate(new Date(2026, 6, 24));
    expect(a).toBe(b);
  });

  it("rotates across consecutive days", () => {
    const day1 = affirmationForDate(new Date(2026, 6, 24));
    const day2 = affirmationForDate(new Date(2026, 6, 25));
    expect(day1).not.toBe(day2);
  });

  it("always returns a value from the list for any date across a year", () => {
    for (let i = 0; i < 400; i++) {
      const d = new Date(2026, 0, 1 + i);
      expect(AFFIRMATIONS).toContain(affirmationForDate(d));
    }
  });

  it("has no adjacent duplicate affirmations (so rotation always changes)", () => {
    for (let i = 1; i < AFFIRMATIONS.length; i++) {
      expect(AFFIRMATIONS[i]).not.toBe(AFFIRMATIONS[i - 1]);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- affirmations`
Expected: FAIL — module `./affirmations` not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/affirmations.ts`:

```ts
/**
 * A curated, deterministic daily affirmation for the Pallisade progress
 * dashboard. One is shown per calendar day (by day-of-year), so it is stable
 * for the whole day and rotates every day. No AI, no network.
 */
export const AFFIRMATIONS: string[] = [
  "You are building something real, one deliberate day at a time.",
  "Every call you make moves Pallisade forward, whether it lands or not.",
  "Discipline today is the compound interest of tomorrow's success.",
  "You do not need permission to build the future you see.",
  "Progress over perfection — ship, learn, repeat.",
  "The founder who keeps showing up outlasts the one waiting to feel ready.",
  "Your pipeline reflects your effort; pour into it without apology.",
  "Rejection is data, not a verdict on your worth.",
  "You have already done hard things — this is just the next one.",
  "Consistency is a superpower, and it is one you own.",
  "The work you avoid is usually the work that moves the needle.",
  "You are the kind of person who finishes what they start.",
  "Small wins stacked daily become an undeniable trajectory.",
  "You turn uncertainty into momentum by taking the next action.",
  "Every pitch sharpens the story only you can tell.",
  "Focus on what you can control: the next call, the next build, the next day.",
  "You are allowed to want more and to go get it.",
  "Clarity comes from action, not from waiting to feel clear.",
  "The market rewards those who keep swinging with intent.",
  "You are becoming the operator this business needs.",
  "Hard days are proof you are doing something that matters.",
  "Your future clients are waiting for you to reach out.",
  "Build like it's inevitable, because you make it so.",
  "You are not behind; you are exactly one action from ahead.",
  "Momentum loves a founder who starts before they're ready.",
  "The best time to do the work is the time you have right now.",
  "You close the gap between vision and reality by showing up.",
  "Trust the process you designed; then execute it relentlessly.",
  "Every 'no' clears the path toward the right 'yes'.",
  "You are the calm, competent center of your own operation.",
  "What you build today, someone will depend on tomorrow.",
  "Your effort compounds even on the days you can't see it.",
  "Lead with value and the results will follow you home.",
  "You are proof that persistence beats raw talent.",
  "One focused hour from you is worth a distracted day from most.",
];

export function affirmationForDate(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / 86_400_000);
  return AFFIRMATIONS[dayOfYear % AFFIRMATIONS.length];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- affirmations`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/affirmations.ts src/lib/affirmations.test.ts
git commit -m "feat(dashboard): add daily affirmation module"
```

---

### Task 4: Rebuild the home page as the all-time progress dashboard

**Files:**
- Modify: `src/components/dashboard/MetricCard.tsx` (add optional `display` prop)
- Modify: `src/app/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `allTimeMetrics(scorecards, projects)` from Task 2, `affirmationForDate(date)` from Task 3, `MetricCard` (with new `display` prop), `fmtCurrency` from `@/lib/utils`.

- [ ] **Step 1: Add an optional `display` override to `MetricCard`**

In `src/components/dashboard/MetricCard.tsx`, add `display` to the props and use it. Replace the props destructure and the value span:

Props signature becomes:

```tsx
export function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  hint,
  display,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: boolean;
  hint?: string;
  display?: string;
}) {
```

And the value span becomes:

```tsx
        <span className="tnum text-[1.7rem] font-semibold leading-none text-[var(--color-ink)]">
          {display ?? fmtCompact(value)}
        </span>
```

- [ ] **Step 2: Replace the home page**

Replace the entire contents of `src/app/page.tsx` with:

```tsx
"use client";

import Link from "next/link";
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
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useQuickAdd } from "@/components/forms/QuickAdd";
import { allTimeMetrics } from "@/lib/selectors";
import { affirmationForDate } from "@/lib/affirmations";
import { fmtCurrency } from "@/lib/utils";

export default function DashboardPage() {
  const { projects, scorecards, settings } = useStore();
  const quickAdd = useQuickAdd();

  const m = allTimeMetrics(scorecards, projects);
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

      {/* All-time progress */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Meetings booked" value={m.meetingsBooked} icon={CalendarCheck} accent />
        <MetricCard label="Calls made" value={m.callsMade} icon={Phone} />
        <MetricCard label="LinkedIn posts" value={m.linkedinPosts} icon={Linkedin} />
        <MetricCard label="Projects built" value={m.projectsBuilt} icon={Hammer} accent />
        <MetricCard label="Projects pitched" value={m.projectsPitched} icon={Send} />
        <MetricCard label="Waiting for feedback" value={m.waitingForFeedback} icon={Clock} />
        <MetricCard
          label="Cash collected"
          value={m.cashCollected}
          icon={Banknote}
          display={fmtCurrency(m.cashCollected, settings.currency)}
          accent
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

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The daily panels, `dashboardMetrics`, `UpcomingMeetings`, etc. are simply no longer imported here — they remain defined elsewhere.)

- [ ] **Step 4: Build to confirm the page compiles**

Run: `npm run build`
Expected: build succeeds; `/` is listed among the compiled routes with no errors.

- [ ] **Step 5: Visual smoke test**

Run: `npm run dev`, open `http://localhost:3000/`.
Expected: header greeting + "{business} — all time" subtitle; an affirmation banner with a quote icon; a grid of seven stat cards (Meetings booked, Calls made, LinkedIn posts, Projects built, Projects pitched, Waiting for feedback, Cash collected) showing all-time totals, with "Cash collected" rendered as a currency amount. None of the old daily panels (Today's Focus, Tomorrow Plan, Pipeline Snapshot, Follow-ups Due, Recent Activity, Next Meetings) appear. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/MetricCard.tsx src/app/page.tsx
git commit -m "feat(dashboard): rebuild home as all-time progress dashboard"
```

---

## Self-Review

**Spec coverage:**
- Replace home page → Task 4. ✅
- Affirmation banner (built-in rotating list) → Task 3 + Task 4 render. ✅
- Meetings booked / Calls made / Cash collected sums → Task 2. ✅
- LinkedIn posts (new field) → Task 1 + Task 2 + Task 4. ✅
- Projects built / pitched / waiting classification → Task 2. ✅
- Remove daily panels from home (keep code) → Task 4 (page replacement drops imports; other files untouched). ✅
- Tests for `allTimeMetrics` + `affirmationForDate` → Task 2 + Task 3. ✅

**Placeholder scan:** No TBD/TODO; all code shown in full. ✅

**Type consistency:** `allTimeMetrics(scorecards, projects)` argument order is consistent between Task 2 definition and Task 4 call. `AllTimeMetrics` field names (`meetingsBooked`, `callsMade`, `linkedinPosts`, `projectsBuilt`, `projectsPitched`, `waitingForFeedback`, `cashCollected`) match between selector, test, and page. `MetricCard` `display` prop consistent between Task 4 Step 1 and Step 2. `Scorecard.linkedinPosts` used consistently across Tasks 1, 2, 4. ✅
