# Project Tracker Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/projects` from a flat card grid into a real build surface — milestone records on a time axis, the local git repo as a live signal, and a per-project AI chat whose decisions the Sales Advisor and Brain can read.

**Architecture:** Two new JSON-blob collections (`milestones`, `projectThreads`) join the existing `COLLECTIONS` registry, so they get SQLite tables and store CRUD for free. All layout maths and git parsing live in pure modules tested against fixtures; the only impure code is `execFile` in `repo.ts` and the React components. The project chat reuses the Advisor's `ProposedAction` confirm-gated write rails verbatim.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind v4, `@libsql/client`, `@anthropic-ai/sdk`, vitest, `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-07-29-project-tracker-depth-design.md`

## Global Constraints

- **Git source is local folders only.** `git -C <absolute path>`. No GitHub API, no auth.
- **`execFile`, never `exec`.** No shell is spawned. Every git call sets `timeout: 5000` and a `maxBuffer` cap.
- **Git never writes a milestone status.** Matching yields commit counts and a one-click *suggestion* only. The founder stays the author of record.
- **Git is never load-bearing.** Every page renders fully when a repo is missing, moved, or `git` is absent from PATH.
- **`Project.currentMilestone` stays on the interface permanently**, marked deprecated. `reconcileProjects` runs on every hydrate and must be able to read it from a restored backup.
- **Deleting a milestone orphans its tasks**, never deletes them.
- **No new dependencies.** The Gantt is bespoke, following the `TrendChart.tsx` idiom (`ResizeObserver` for width).
- **Tests are pure-logic only**, `*.test.ts` beside source, matching the existing suite. No component tests, no tests that shell out to a real repo.
- **Drag-to-reschedule is out of scope.**
- Run tests with `npm test` (vitest run). Single file: `npx vitest run src/lib/path/file.test.ts`.

---

# Phase 1 — Data model, milestones, project page

The only phase with a migration. Ends with a deeper tracker that stands on its own.

---

### Task 1: Milestone and ProjectThread types + registry wiring

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db/sqlite.ts:16-35`
- Modify: `src/lib/store.tsx:75-95`
- Test: `src/lib/db/sqlite.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Milestone`, `MilestoneStatus`, `MILESTONE_STATUSES`, `ProjectThread`; `DataShape.milestones`, `DataShape.projectThreads`; `Project.repoPath`, `Task.milestoneId`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/db/sqlite.test.ts`:

```ts
describe("sqlite COLLECTIONS registry — project tracker", () => {
  it("includes the milestone and project-thread collections so they persist", () => {
    expect(COLLECTIONS).toContain("milestones");
    expect(COLLECTIONS).toContain("projectThreads");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/db/sqlite.test.ts`
Expected: FAIL — `expected [ 'leads', … ] to contain 'milestones'`

- [ ] **Step 3: Add the types**

In `src/lib/types.ts`, after the `PROJECT_STAGES` / `Priority` enum block:

```ts
export const MILESTONE_STATUSES = [
  "planned",
  "in progress",
  "blocked",
  "done",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
```

After the `Project` interface:

```ts
export interface Milestone extends BaseRecord {
  projectId: string;
  name: string;
  startDate: string | null;   // ISO YYYY-MM-DD — the Gantt bar's left edge
  endDate: string | null;     // ISO YYYY-MM-DD — right edge
  status: MilestoneStatus;
  order: number;              // manual sequence within the project
  dependsOn: string[];        // milestone ids, same project only
  commitScope: string;        // e.g. "gantt" → matches `feat(gantt):`. "" = date-range matching
  notes: string;
}

export interface ProjectThread extends BaseRecord {
  projectId: string;
  title: string;              // auto-derived from the first user message
  messages: ChatMessage[];
}
```

Add `repoPath: string | null;` to `Project`. Mark the existing `currentMilestone` field:

```ts
  /** @deprecated Retired in favour of Milestone records. Kept so
   *  reconcileProjects can still migrate a restored backup. */
  currentMilestone: string;
```

Add `milestoneId: string | null;` to `Task`.

- [ ] **Step 4: Wire the registry**

`DataShape` gains, beside the other collections:

```ts
  milestones: Milestone[];
  projectThreads: ProjectThread[];
```

`AdvisorSnapshot` — add `"projectThreads"` to the `Omit` union (leave `milestones` in; the Advisor should see it):

```ts
export type AdvisorSnapshot = Omit<
  DataShape,
  | "conversations" | "playbooks" | "targets" | "positioningProfiles"
  | "contentThreads" | "brainThreads" | "projectThreads"
  | "newsFeed" | "newsInterests" | "newsBookmarks"
  | "notes" | "metricEntries"
>;
```

`src/lib/db/sqlite.ts` — add `"milestones",` and `"projectThreads",` to `COLLECTIONS`. `ensureSchema` creates both tables on next boot via `CREATE TABLE IF NOT EXISTS`; no migration script.

`src/lib/store.tsx` — add `milestones: [],` and `projectThreads: [],` to `EMPTY`, and import both types.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: sqlite test PASSES. `tsc` reports errors in `ProjectForm.tsx` and `TaskForm.tsx` for the new required fields — **expected**, fixed in Tasks 8 and 9. Fix any *other* error now.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/db/sqlite.ts src/lib/db/sqlite.test.ts src/lib/store.tsx
git commit -m "feat(projects): Milestone and ProjectThread types + registry wiring"
```

---

### Task 2: reconcileProjects migration

Backfills a real `Milestone` from the legacy `currentMilestone` string, then blanks the string so it cannot re-fire.

**Files:**
- Modify: `src/lib/reconcile.ts`
- Modify: `src/lib/store.tsx:117`
- Test: `src/lib/reconcile.test.ts`

**Interfaces:**
- Consumes: `Milestone`, `DataShape` (Task 1)
- Produces: `reconcileProjects(data: DataShape): DataShape`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/reconcile.test.ts`. Note the `DataShape` helper — build it from the module's own `EMPTY`-shaped literal so adding collections later doesn't break these tests:

```ts
import { reconcileProjects } from "./reconcile";
import type { DataShape, Project } from "./types";

function shape(over: Partial<DataShape>): DataShape {
  return {
    leads: [], interactions: [], projects: [], tasks: [], scorecards: [],
    painPoints: [], conversations: [], playbooks: [], targets: [], dialLists: [],
    positioningProfiles: [], contentThreads: [], brainThreads: [], newsFeed: [],
    newsInterests: [], newsBookmarks: [], notes: [], metricEntries: [],
    milestones: [], projectThreads: [],
    settings: {} as DataShape["settings"],
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    name: "Acme Dashboard", company: "Acme", type: "paid project", stage: "building",
    priority: "high", startDate: "2026-07-01", dueDate: "2026-08-15",
    currentMilestone: "Build the ingest pipeline", currentBlocker: "", nextAction: "",
    deliverables: "", notes: "", repoPath: null,
    ...over,
  };
}

describe("reconcileProjects", () => {
  it("creates one milestone from the legacy currentMilestone string", () => {
    const out = reconcileProjects(shape({ projects: [project()] }));
    expect(out.milestones).toHaveLength(1);
    expect(out.milestones[0]).toMatchObject({
      projectId: "p1",
      name: "Build the ingest pipeline",
      status: "in progress",
      order: 0,
      startDate: "2026-07-01",
      endDate: "2026-08-15",
      dependsOn: [],
      commitScope: "",
    });
  });

  it("blanks currentMilestone so a second run is a no-op", () => {
    const first = reconcileProjects(shape({ projects: [project()] }));
    expect(first.projects[0].currentMilestone).toBe("");
    const second = reconcileProjects(first);
    expect(second.milestones).toHaveLength(1);
  });

  it("skips a project that already has milestones", () => {
    const existing = {
      id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Existing",
      startDate: null, endDate: null, status: "planned" as const, order: 0,
      dependsOn: [], commitScope: "", notes: "",
    };
    const out = reconcileProjects(shape({ projects: [project()], milestones: [existing] }));
    expect(out.milestones).toHaveLength(1);
    expect(out.milestones[0].name).toBe("Existing");
  });

  it("skips a project with an empty currentMilestone", () => {
    const out = reconcileProjects(shape({ projects: [project({ currentMilestone: "" })] }));
    expect(out.milestones).toHaveLength(0);
  });

  it("returns the same object when nothing needs migrating", () => {
    const input = shape({ projects: [project({ currentMilestone: "" })] });
    expect(reconcileProjects(input)).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/reconcile.test.ts`
Expected: FAIL — `reconcileProjects is not a function`

- [ ] **Step 3: Implement**

Append to `src/lib/reconcile.ts` (it currently imports only `DataShape`; add `Milestone` and the utils):

```ts
import { nowISO, uid } from "./utils";
import type { DataShape, Milestone } from "./types";

/**
 * Migrates the legacy `Project.currentMilestone` string onto a real Milestone
 * record. Runs on every hydrate alongside reconcileFollowUps.
 *
 * A project qualifies when it has a non-empty `currentMilestone` AND zero
 * milestone records. After migrating we blank the string — that is what makes
 * this idempotent, and it means the migration cannot re-fire after the founder
 * deliberately deletes every milestone on a project.
 */
export function reconcileProjects(data: DataShape): DataShape {
  const withMilestones = new Set(data.milestones.map((m) => m.projectId));
  const needing = data.projects.filter(
    (p) => p.currentMilestone.trim() && !withMilestones.has(p.id),
  );
  if (needing.length === 0) return data;

  const ts = nowISO();
  const created: Milestone[] = needing.map((p) => ({
    id: uid("mil"),
    createdAt: ts,
    updatedAt: ts,
    projectId: p.id,
    name: p.currentMilestone.trim(),
    startDate: p.startDate,
    endDate: p.dueDate,
    status: "in progress",
    order: 0,
    dependsOn: [],
    commitScope: "",
    notes: "",
  }));

  const migrated = new Set(needing.map((p) => p.id));
  const projects = data.projects.map((p) =>
    migrated.has(p.id) ? { ...p, currentMilestone: "" } : p,
  );

  return { ...data, projects, milestones: [...data.milestones, ...created] };
}
```

- [ ] **Step 4: Chain it into hydration**

`src/lib/store.tsx:117` — wrap the existing call:

```ts
setData(reconcileProjects(reconcileFollowUps({ ...EMPTY, ...loaded })));
```

Add `reconcileProjects` to the existing `./reconcile` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/reconcile.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/reconcile.ts src/lib/reconcile.test.ts src/lib/store.tsx
git commit -m "feat(projects): migrate currentMilestone string to Milestone records"
```

---

### Task 3: milestoneStatusTone

**Files:**
- Modify: `src/lib/badges.ts`
- Test: `src/lib/badges.test.ts` (create)

**Interfaces:**
- Consumes: `MilestoneStatus` (Task 1)
- Produces: `milestoneStatusTone(s: MilestoneStatus): Tone`

- [ ] **Step 1: Write the failing test**

Create `src/lib/badges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { milestoneStatusTone } from "./badges";

describe("milestoneStatusTone", () => {
  it("maps each milestone status onto an existing tone", () => {
    expect(milestoneStatusTone("planned")).toBe("neutral");
    expect(milestoneStatusTone("in progress")).toBe("accent");
    expect(milestoneStatusTone("blocked")).toBe("warning");
    expect(milestoneStatusTone("done")).toBe("positive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/badges.test.ts`
Expected: FAIL — `milestoneStatusTone is not a function`

- [ ] **Step 3: Implement**

Add `MilestoneStatus` to the type import in `src/lib/badges.ts`, then append beside `taskStatusTone`:

```ts
export function milestoneStatusTone(s: MilestoneStatus): Tone {
  switch (s) {
    case "done":
      return "positive";
    case "in progress":
      return "accent";
    case "blocked":
      return "warning";
    case "planned":
      return "neutral";
    default:
      return "neutral";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/badges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/badges.ts src/lib/badges.test.ts
git commit -m "feat(projects): milestone status tone mapping"
```

---

### Task 4: MilestoneForm

Phase 1 exposes name, dates, status, order and notes. `dependsOn` arrives in Task 13 (when the Gantt draws connectors) and `commitScope` in Task 20 (when git lands) — both fields already exist on the type, so neither needs a migration.

**Files:**
- Create: `src/components/projects/MilestoneForm.tsx`

**Interfaces:**
- Consumes: `Milestone`, `MILESTONE_STATUSES` (Task 1); `useStore` CRUD
- Produces: `<MilestoneForm projectId initial? onClose />`

- [ ] **Step 1: Implement**

Mirrors `ProjectForm.tsx` exactly — same `Draft` type, same `set` helper, same `FormActions` footer.

```tsx
"use client";

import { useState } from "react";
import { MILESTONE_STATUSES, type Milestone } from "@/lib/types";
import { useStore } from "@/lib/store";
import { Field, FormGrid, NumberInput, Select, TextArea, TextInput } from "@/components/ui/Field";
import { FormActions } from "@/components/forms/FormActions";

type Draft = Omit<Milestone, "id" | "createdAt" | "updatedAt">;

export function MilestoneForm({
  projectId,
  initial,
  nextOrder = 0,
  onClose,
}: {
  projectId: string;
  initial?: Milestone;
  nextOrder?: number;
  onClose: () => void;
}) {
  const { create, update } = useStore();
  const [d, setD] = useState<Draft>(() => ({
    projectId,
    name: initial?.name ?? "",
    startDate: initial?.startDate ?? null,
    endDate: initial?.endDate ?? null,
    status: initial?.status ?? "planned",
    order: initial?.order ?? nextOrder,
    dependsOn: initial?.dependsOn ?? [],
    commitScope: initial?.commitScope ?? "",
    notes: initial?.notes ?? "",
  }));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const datesInvalid = !!d.startDate && !!d.endDate && d.endDate < d.startDate;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.name.trim() || datesInvalid) return;
    if (initial) update("milestones", initial.id, d);
    else create("milestones", d);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <Field label="Milestone name *">
        <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} autoFocus required />
      </Field>

      <FormGrid>
        <Field label="Start date" className="mt-3.5">
          <TextInput type="date" value={d.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
        </Field>
        <Field
          label="End date"
          className="mt-3.5"
          hint={datesInvalid ? "End date must fall on or after the start date." : undefined}
        >
          <TextInput type="date" value={d.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
        </Field>
        <Field label="Status" className="mt-3.5">
          <Select
            options={MILESTONE_STATUSES}
            value={d.status}
            onChange={(e) => set("status", e.target.value as Draft["status"])}
          />
        </Field>
        <Field label="Order" className="mt-3.5" hint="Lower numbers sort first.">
          <NumberInput value={d.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
        </Field>
      </FormGrid>

      <Field label="Notes" className="mt-3.5">
        <TextArea value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
      </Field>

      <FormActions
        onCancel={onClose}
        saveLabel={initial ? "Save changes" : "Add milestone"}
        saveDisabled={!d.name.trim() || datesInvalid}
      />
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from this file. If `FormActions` prop names differ, read `src/components/forms/FormActions.tsx` and match it.

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/MilestoneForm.tsx
git commit -m "feat(projects): milestone create/edit form"
```

---

### Task 5: MilestoneList

**Files:**
- Create: `src/components/projects/MilestoneList.tsx`

**Interfaces:**
- Consumes: `Milestone`, `Task` (Task 1); `milestoneStatusTone` (Task 3)
- Produces: `<MilestoneList milestones tasks onEdit onDelete />`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { Pencil, Trash2, ListChecks } from "lucide-react";
import type { Milestone, Task } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { milestoneStatusTone } from "@/lib/badges";
import { fmtDate } from "@/lib/utils";

export function MilestoneList({
  milestones,
  tasks,
  onEdit,
  onDelete,
}: {
  milestones: Milestone[];
  tasks: Task[];
  onEdit: (m: Milestone) => void;
  onDelete: (m: Milestone) => void;
}) {
  if (milestones.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No milestones yet.</p>;

  const sorted = [...milestones].sort((a, b) => a.order - b.order);

  return (
    <ul className="space-y-1.5">
      {sorted.map((m) => {
        const mt = tasks.filter((t) => t.milestoneId === m.id);
        const done = mt.filter((t) => t.status === "done").length;
        return (
          <li
            key={m.id}
            className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[0.86rem] text-[var(--color-ink)] truncate">{m.name}</p>
              <p className="text-[0.73rem] text-[var(--color-dim)] tnum">
                {m.startDate || m.endDate ? `${fmtDate(m.startDate)} → ${fmtDate(m.endDate)}` : "No dates set"}
              </p>
            </div>
            {mt.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[0.73rem] text-[var(--color-dim)] tnum shrink-0">
                <ListChecks size={13} /> {done}/{mt.length}
              </span>
            )}
            <Badge tone={milestoneStatusTone(m.status)}>{m.status}</Badge>
            <button onClick={() => onEdit(m)} aria-label="Edit milestone" className="shrink-0 text-[var(--color-dim)] hover:text-[var(--color-ink)]">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDelete(m)} aria-label="Delete milestone" className="shrink-0 text-[var(--color-dim)] hover:text-[var(--color-accent-soft)]">
              <Trash2 size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/projects/MilestoneList.tsx
git commit -m "feat(projects): milestone list with task rollup"
```

---

### Task 6: /projects/[id] page

**Files:**
- Create: `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `MilestoneForm` (Task 4), `MilestoneList` (Task 5)
- Produces: the route `/projects/<id>`; a `TABS` array later tasks extend (`Repo` in Task 21, `Chat` in Task 27)

- [ ] **Step 1: Implement**

Phase 1 ships three tabs; the Gantt slot in Overview is filled in Task 13.

```tsx
"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, AlertOctagon, ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { DetailGrid, DetailRow } from "@/components/ui/Detail";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { TaskForm } from "@/components/forms/TaskForm";
import { MilestoneForm } from "@/components/projects/MilestoneForm";
import { MilestoneList } from "@/components/projects/MilestoneList";
import type { Milestone } from "@/lib/types";
import { priorityTone, projectStageTone } from "@/lib/badges";
import { fmtDate, relativeDay, cn } from "@/lib/utils";
import { FolderKanban } from "lucide-react";

const TABS = ["Overview", "Milestones", "Tasks"] as const;
type Tab = (typeof TABS)[number];

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projects, milestones, tasks, update, remove } = useStore();
  const [tab, setTab] = useState<Tab>("Overview");
  const [editing, setEditing] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [editMilestone, setEditMilestone] = useState<Milestone | null>(null);
  const [deleteMilestone, setDeleteMilestone] = useState<Milestone | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  const project = projects.find((p) => p.id === id) ?? null;
  const projectMilestones = useMemo(
    () => milestones.filter((m) => m.projectId === id).sort((a, b) => a.order - b.order),
    [milestones, id],
  );
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.linkKind === "project" && t.linkId === id),
    [tasks, id],
  );

  if (!project)
    return (
      <Panel noPad>
        <EmptyState
          icon={FolderKanban}
          title="Project not found"
          message="It may have been deleted."
          action={<Link className="btn" href="/projects">Back to projects</Link>}
        />
      </Panel>
    );

  const nextMilestone = projectMilestones.find((m) => m.status !== "done") ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-[0.74rem] text-[var(--color-muted)] hover:text-[var(--color-ink)] mb-1.5">
            <ArrowLeft size={13} /> Projects
          </Link>
          <h1 className="text-[1.35rem] font-semibold text-[var(--color-ink)] truncate">{project.name}</h1>
          <p className="text-[0.8rem] text-[var(--color-dim)]">{project.company}</p>
        </div>
        <button className="btn shrink-0" onClick={() => setEditing(true)}>
          <Pencil size={15} /> Edit
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone={projectStageTone(project.stage)}>{project.stage}</Badge>
        <Badge tone={priorityTone(project.priority)} dot={false}>{project.priority} priority</Badge>
        <span className="chip">{project.type}</span>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-line)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-3 py-2 text-[0.82rem] border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-dim)] hover:text-[var(--color-ink)]",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-4">
          {/* Gantt slot — filled in Task 13 */}
          <Panel title="Status">
            <DetailGrid>
              <DetailRow label="Start date">{fmtDate(project.startDate)}</DetailRow>
              <DetailRow label="Due date">
                {project.dueDate ? `${fmtDate(project.dueDate)} (${relativeDay(project.dueDate)})` : "—"}
              </DetailRow>
              <DetailRow label="Next milestone" full>{nextMilestone?.name ?? "—"}</DetailRow>
              <DetailRow label="Current blocker" full>{project.currentBlocker}</DetailRow>
              <DetailRow label="Next action" full>{project.nextAction}</DetailRow>
              <DetailRow label="Deliverables" full>{project.deliverables}</DetailRow>
              <DetailRow label="Notes" full>{project.notes}</DetailRow>
            </DetailGrid>
          </Panel>
          {project.currentBlocker && (
            <p className="text-[0.8rem] text-[var(--color-accent-soft)] flex items-start gap-1.5">
              <AlertOctagon size={13} className="mt-0.5 shrink-0" />
              {project.currentBlocker}
            </p>
          )}
          {project.nextAction && (
            <p className="text-[0.8rem] text-[var(--color-ink-soft)] flex items-start gap-1.5">
              <ArrowRight size={13} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
              {project.nextAction}
            </p>
          )}
        </div>
      )}

      {tab === "Milestones" && (
        <Panel
          title="Milestones"
          action={
            <button className="btn btn-sm" onClick={() => setAddingMilestone(true)}>
              <Plus size={13} /> Add
            </button>
          }
        >
          <MilestoneList
            milestones={projectMilestones}
            tasks={projectTasks}
            onEdit={setEditMilestone}
            onDelete={setDeleteMilestone}
          />
        </Panel>
      )}

      {tab === "Tasks" && (
        <Panel
          title="Tasks"
          action={
            <button className="btn btn-sm" onClick={() => setAddingTask(true)}>
              <Plus size={13} /> Add
            </button>
          }
        >
          {/* Grouped by milestone in Task 8 */}
          <MilestoneTasksPlaceholder count={projectTasks.length} />
        </Panel>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit — ${project.name}`}>
        <ProjectForm initial={project} onClose={() => setEditing(false)} />
      </Modal>
      <Modal open={addingMilestone} onClose={() => setAddingMilestone(false)} title="Add Milestone" subtitle={project.name}>
        <MilestoneForm
          projectId={project.id}
          nextOrder={projectMilestones.length}
          onClose={() => setAddingMilestone(false)}
        />
      </Modal>
      <Modal open={!!editMilestone} onClose={() => setEditMilestone(null)} title={`Edit — ${editMilestone?.name ?? ""}`}>
        {editMilestone && (
          <MilestoneForm projectId={project.id} initial={editMilestone} onClose={() => setEditMilestone(null)} />
        )}
      </Modal>
      <Modal open={addingTask} onClose={() => setAddingTask(false)} title="Add Task" subtitle={`Linked to ${project.name}`}>
        <TaskForm presetLink={{ kind: "project", id: project.id }} onClose={() => setAddingTask(false)} />
      </Modal>

      <ConfirmDialog
        open={!!deleteMilestone}
        onClose={() => setDeleteMilestone(null)}
        onConfirm={() => {
          if (deleteMilestone) remove("milestones", deleteMilestone.id);
          setDeleteMilestone(null);
        }}
        title="Delete milestone?"
        message="Linked tasks are kept but will move to Unassigned."
      />
    </div>
  );
}

function MilestoneTasksPlaceholder({ count }: { count: number }) {
  return <p className="text-[0.8rem] text-[var(--color-muted)]">{count} linked task(s).</p>;
}
```

- [ ] **Step 2: Verify the page renders**

Run: `npm run dev`, open `/projects`, click a project card (still opens the modal until Task 7), then navigate directly to `/projects/<id>` using an id from the card's link.
Expected: header, badges, three tabs, milestone add/edit/delete all work.

- [ ] **Step 3: Commit**

```bash
git add src/app/projects/\[id\]/page.tsx
git commit -m "feat(projects): dedicated project detail page with tabs"
```

---

### Task 7: Route the index at the new page

**Files:**
- Modify: `src/app/projects/page.tsx`

**Interfaces:**
- Consumes: the `/projects/[id]` route (Task 6)
- Produces: card links to `/projects/<id>`; `?focus=<id>` redirect preserving `Topbar.tsx:82`, `ActionCard.tsx:28` and the dashboard linkers

- [ ] **Step 1: Redirect `?focus=`**

Replace the `useEffect` at `src/app/projects/page.tsx:41-43`:

```tsx
const router = useRouter();

useEffect(() => {
  if (focusId) router.replace(`/projects/${focusId}`);
}, [focusId, router]);
```

Add `import { useRouter } from "next/navigation";`.

- [ ] **Step 2: Turn cards into links**

Change the card `<button onClick={() => setViewId(p.id)}>` to `<Link href={`/projects/${p.id}`}>`, keeping every className. Import `Link` from `next/link`.

- [ ] **Step 3: Delete the now-dead detail modal**

Remove the detail `<Modal open={!!view}>` block, the `viewId` / `editId` / `deleteId` / `addTaskFor` state, the `view` / `edit` lookups, the `LinkedTasks` component, and the `ConfirmDialog`. Editing and deleting now live on the detail page. Keep the "Add Project" modal, the filters, and the empty state.

- [ ] **Step 4: Verify every deep link still works**

Run: `npm run dev`. Check:
- A project card navigates to `/projects/<id>`
- `/projects?focus=<id>` redirects to `/projects/<id>`
- Global search (top bar) → a project hit lands on the detail page

Run: `npx tsc --noEmit` — expect zero unused-import errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/projects/page.tsx
git commit -m "feat(projects): route index cards and ?focus= deep links to the detail page"
```

---

### Task 8: Link tasks to milestones

**Files:**
- Modify: `src/components/forms/TaskForm.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `Task.milestoneId` (Task 1)
- Produces: a milestone picker on `TaskForm`; a grouped Tasks tab with an "Unassigned" bucket

- [ ] **Step 1: Add milestoneId to TaskForm**

Read `src/components/forms/TaskForm.tsx` first and match its `Draft` / `set` idiom. Add `milestoneId: initial?.milestoneId ?? null` to the draft. Render a picker **only** when the task is linked to a project — otherwise there are no milestones to choose from:

```tsx
{d.linkKind === "project" && d.linkId && (
  <Field label="Milestone" className="mt-3.5">
    <select
      className="select"
      value={d.milestoneId ?? ""}
      onChange={(e) => set("milestoneId", e.target.value || null)}
    >
      <option value="">Unassigned</option>
      {milestones
        .filter((m) => m.projectId === d.linkId)
        .sort((a, b) => a.order - b.order)
        .map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
    </select>
  </Field>
)}
```

Pull `milestones` from `useStore()`. Clear `milestoneId` to `null` whenever `linkKind` or `linkId` changes, so a task moved between projects can't keep a foreign milestone.

- [ ] **Step 2: Group the Tasks tab**

Replace `MilestoneTasksPlaceholder` in `src/app/projects/[id]/page.tsx` with a real grouped list:

```tsx
function GroupedTasks({
  milestones,
  tasks,
  onToggle,
}: {
  milestones: Milestone[];
  tasks: Task[];
  onToggle: (t: Task) => void;
}) {
  const groups = [
    ...milestones.map((m) => ({ key: m.id, label: m.name, items: tasks.filter((t) => t.milestoneId === m.id) })),
    {
      key: "unassigned",
      label: "Unassigned",
      items: tasks.filter((t) => !t.milestoneId || !milestones.some((m) => m.id === t.milestoneId)),
    },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No tasks linked yet.</p>;

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="eyebrow mb-2">{g.label}</p>
          <ul className="space-y-1.5">
            {g.items.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                <button onClick={() => onToggle(t)} className="shrink-0" aria-label="Toggle done">
                  {t.status === "done"
                    ? <CheckCircle2 size={16} className="text-[var(--color-positive)]" />
                    : <Circle size={16} className="text-[var(--color-dim)] hover:text-[var(--color-ink)]" />}
                </button>
                <span className={cn("flex-1 text-[0.83rem]", t.status === "done" ? "line-through text-[var(--color-dim)]" : "text-[var(--color-ink-soft)]")}>
                  {t.title}
                </span>
                <Badge tone={taskStatusTone(t.status)} dot={false}>{t.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

Note the Unassigned bucket deliberately catches tasks whose `milestoneId` points at a **deleted** milestone — that is the orphan behaviour the spec requires.

Wire it in the Tasks tab:

```tsx
<GroupedTasks
  milestones={projectMilestones}
  tasks={projectTasks}
  onToggle={(t) => update("tasks", t.id, { status: t.status === "done" ? "not started" : "done" })}
/>
```

Import `CheckCircle2`, `Circle`, `taskStatusTone` and `type Task`.

- [ ] **Step 3: Verify orphaning**

Run: `npm run dev`. Create a milestone, link a task to it, delete the milestone, open the Tasks tab.
Expected: the task still exists, under "Unassigned".

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/TaskForm.tsx "src/app/projects/[id]/page.tsx"
git commit -m "feat(projects): link tasks to milestones with an unassigned bucket"
```

---

### Task 9: Retire currentMilestone from the UI + seed milestones

**Files:**
- Modify: `src/components/forms/ProjectForm.tsx`
- Modify: `src/lib/seed.ts`

**Interfaces:**
- Consumes: `Milestone` (Task 1)
- Produces: demo milestones so `Settings → Load demo data` shows a populated tracker

- [ ] **Step 1: Remove the field from ProjectForm**

Delete the `Current milestone` `<Field>` block (`ProjectForm.tsx:76-78`) and promote `Current blocker` to fill that grid row. Keep `currentMilestone: initial?.currentMilestone ?? ""` in the `Draft` initialiser — the field is still on the type and dropping it would wipe the value before `reconcileProjects` has migrated it on an older database.

Add `repoPath: initial?.repoPath ?? null` to the draft (the input arrives in Task 20).

- [ ] **Step 2: Seed demo milestones**

Read `src/lib/seed.ts` first to get the real seeded project ids and their `startDate`/`dueDate`, then add a `milestones` array. Substitute the actual ids for `PROJECT_A_ID` / `PROJECT_B_ID` and keep every milestone's dates inside its project's own span:

```ts
const ts = "2026-07-01T09:00:00.000Z";

const milestones: Milestone[] = [
  // Project A — one done, one running, one planned, with a dependency chain.
  { id: "mil_a1", createdAt: ts, updatedAt: ts, projectId: PROJECT_A_ID,
    name: "Discovery & data audit", startDate: "2026-07-01", endDate: "2026-07-10",
    status: "done", order: 0, dependsOn: [], commitScope: "", notes: "" },
  { id: "mil_a2", createdAt: ts, updatedAt: ts, projectId: PROJECT_A_ID,
    name: "Ingest pipeline", startDate: "2026-07-13", endDate: "2026-07-31",
    status: "in progress", order: 1, dependsOn: ["mil_a1"], commitScope: "", notes: "" },
  { id: "mil_a3", createdAt: ts, updatedAt: ts, projectId: PROJECT_A_ID,
    name: "Dashboard build", startDate: "2026-08-03", endDate: "2026-08-21",
    status: "planned", order: 2, dependsOn: ["mil_a2"], commitScope: "", notes: "" },
  { id: "mil_a4", createdAt: ts, updatedAt: ts, projectId: PROJECT_A_ID,
    name: "Handover", startDate: "2026-08-24", endDate: "2026-08-28",
    status: "planned", order: 3, dependsOn: ["mil_a3"], commitScope: "", notes: "" },

  // Project B — a shorter arc, one bar deliberately blocked.
  { id: "mil_b1", createdAt: ts, updatedAt: ts, projectId: PROJECT_B_ID,
    name: "Scope & mockups", startDate: "2026-07-06", endDate: "2026-07-17",
    status: "done", order: 0, dependsOn: [], commitScope: "", notes: "" },
  { id: "mil_b2", createdAt: ts, updatedAt: ts, projectId: PROJECT_B_ID,
    name: "Demo build", startDate: "2026-07-20", endDate: "2026-08-07",
    status: "blocked", order: 1, dependsOn: ["mil_b1"], commitScope: "",
    notes: "Waiting on their sandbox credentials." },
];
```

Add `milestones` and `projectThreads: []` to the object `seedData()` returns, and import `Milestone`.

Set `currentMilestone: ""` on every seeded project — new demo data should not trigger the migration.

- [ ] **Step 3: Verify**

Run: `npm run dev` → Settings → Clear all data → Load demo data → `/projects` → open a project → Milestones tab.
Expected: seeded milestones with dates and mixed statuses; Overview shows a "Next milestone".

Run: `npm test && npx tsc --noEmit`
Expected: all green, zero type errors. **Phase 1 complete.**

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/ProjectForm.tsx src/lib/seed.ts
git commit -m "feat(projects): retire currentMilestone from forms, seed demo milestones"
```

---

# Phase 2 — Gantt

Purely additive. All layout maths is pure and tested before a pixel is drawn.

**Reference dates used throughout Phase 2's tests** (verified, do not change casually):
`2026-07-01` is a **Wednesday**; `2026-08-15` is a **Saturday**. Weeks run Monday→Sunday, so the padded range for those two dates is `2026-06-29` → `2026-08-16`, exactly 49 days (7 weeks).

---

### Task 10: schedule.ts — ganttRange and barGeometry

**Files:**
- Create: `src/lib/projects/schedule.ts`
- Test: `src/lib/projects/schedule.test.ts`

**Interfaces:**
- Consumes: `Milestone` (Task 1); `addDaysISO`, `daysBetween` from `@/lib/utils`
- Produces: `GanttRange`, `ganttRange(milestones): GanttRange | null`, `barGeometry(m, range, width): { x: number; w: number } | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/projects/schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ganttRange, barGeometry } from "./schedule";
import type { Milestone } from "@/lib/types";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "M",
    startDate: "2026-07-01", endDate: "2026-07-15", status: "planned",
    order: 0, dependsOn: [], commitScope: "", notes: "",
    ...over,
  };
}

describe("ganttRange", () => {
  it("spans the earliest start to the latest end, padded to whole weeks", () => {
    const range = ganttRange([
      milestone({ id: "a", startDate: "2026-07-01", endDate: "2026-07-15" }),
      milestone({ id: "b", startDate: "2026-07-10", endDate: "2026-08-15" }),
    ]);
    // 2026-07-01 is a Wednesday → back to Monday 2026-06-29
    // 2026-08-15 is a Saturday  → forward to Sunday 2026-08-16
    expect(range).toEqual({ start: "2026-06-29", end: "2026-08-16" });
  });

  it("ignores milestones missing either date", () => {
    const range = ganttRange([
      milestone({ id: "a", startDate: "2026-07-01", endDate: "2026-07-15" }),
      milestone({ id: "b", startDate: null, endDate: "2026-12-31" }),
      milestone({ id: "c", startDate: "2026-01-01", endDate: null }),
    ]);
    expect(range).toEqual({ start: "2026-06-29", end: "2026-07-19" });
  });

  it("returns null when no milestone has both dates", () => {
    expect(ganttRange([milestone({ startDate: null, endDate: null })])).toBeNull();
    expect(ganttRange([])).toBeNull();
  });
});

describe("barGeometry", () => {
  const range = { start: "2026-06-29", end: "2026-08-16" }; // 49 days

  it("positions a bar proportionally within the range", () => {
    // width 490 over 49 days = 10px/day. Offset 2 days, span 15 days.
    const g = barGeometry(milestone({ startDate: "2026-07-01", endDate: "2026-07-15" }), range, 490);
    expect(g).toEqual({ x: 20, w: 150 });
  });

  it("gives a full-width bar to a milestone covering the whole range", () => {
    const g = barGeometry(milestone({ startDate: "2026-06-29", endDate: "2026-08-16" }), range, 490);
    expect(g).toEqual({ x: 0, w: 490 });
  });

  it("keeps a single-day milestone visible", () => {
    const g = barGeometry(milestone({ startDate: "2026-07-01", endDate: "2026-07-01" }), range, 490);
    expect(g!.w).toBeGreaterThanOrEqual(4);
  });

  it("returns null for a milestone missing either date", () => {
    expect(barGeometry(milestone({ startDate: null }), range, 490)).toBeNull();
    expect(barGeometry(milestone({ endDate: null }), range, 490)).toBeNull();
  });

  it("clamps a bar that falls outside the range", () => {
    const g = barGeometry(milestone({ startDate: "2026-05-01", endDate: "2026-09-30" }), range, 490);
    expect(g).toEqual({ x: 0, w: 490 });
  });

  it("returns null when width is zero (pre-measure render)", () => {
    expect(barGeometry(milestone(), range, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/schedule.test.ts`
Expected: FAIL — cannot find module `./schedule`

- [ ] **Step 3: Implement**

Create `src/lib/projects/schedule.ts`:

```ts
import type { Milestone } from "@/lib/types";
import { addDaysISO, daysBetween } from "@/lib/utils";

export interface GanttRange {
  start: string; // ISO YYYY-MM-DD, always a Monday
  end: string;   // ISO YYYY-MM-DD, always a Sunday
}

/** Minimum rendered bar width in px, so a one-day milestone stays visible. */
const MIN_BAR_PX = 4;

/** 0 = Monday … 6 = Sunday */
function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00`).getDay() + 6) % 7;
}

const startOfWeek = (iso: string) => addDaysISO(iso, -weekdayIndex(iso));
const endOfWeek = (iso: string) => addDaysISO(iso, 6 - weekdayIndex(iso));

/** A milestone contributes to the timeline only when it has both dates. */
function isDated(m: Milestone): m is Milestone & { startDate: string; endDate: string } {
  return !!m.startDate && !!m.endDate;
}

/**
 * The chart's date domain: earliest start to latest end across every dated
 * milestone, padded out to whole Monday→Sunday weeks so the column grid lines
 * land on week boundaries.
 *
 * Returns null when nothing is dated — the caller renders an empty state
 * rather than an invalid domain.
 */
export function ganttRange(milestones: Milestone[]): GanttRange | null {
  const dated = milestones.filter(isDated);
  if (dated.length === 0) return null;

  let min = dated[0].startDate;
  let max = dated[0].endDate;
  for (const m of dated) {
    if (m.startDate < min) min = m.startDate;
    if (m.endDate > max) max = m.endDate;
  }

  return { start: startOfWeek(min), end: endOfWeek(max) };
}

/** Total inclusive days in the domain. */
export function rangeDays(range: GanttRange): number {
  return daysBetween(range.start, range.end) + 1;
}

/**
 * Pixel position and width of a milestone's bar within `width`.
 * Returns null for an undated milestone (listed without a bar) or a
 * zero width (the first render, before ResizeObserver has measured).
 */
export function barGeometry(
  m: Milestone,
  range: GanttRange,
  width: number,
): { x: number; w: number } | null {
  if (!isDated(m) || width <= 0) return null;

  const total = rangeDays(range);
  const perDay = width / total;

  const rawX = daysBetween(range.start, m.startDate) * perDay;
  const rawW = (daysBetween(m.startDate, m.endDate) + 1) * perDay;

  const x = Math.max(0, Math.min(rawX, width));
  const w = Math.max(MIN_BAR_PX, Math.min(rawW, width - x));

  return { x, w };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/schedule.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/schedule.ts src/lib/projects/schedule.test.ts
git commit -m "feat(projects): gantt date domain and bar geometry"
```

---

### Task 11: schedule.ts — detectCycles and dependencyEdges

**Files:**
- Modify: `src/lib/projects/schedule.ts`
- Test: `src/lib/projects/schedule.test.ts`

**Interfaces:**
- Consumes: `GanttRange`, `barGeometry` (Task 10)
- Produces: `detectCycles(milestones): string[][]`, `dependencyEdges(milestones, range, width, rowHeight): Edge[]`, `Edge`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/projects/schedule.test.ts`:

```ts
import { detectCycles, dependencyEdges } from "./schedule";

describe("detectCycles", () => {
  it("finds nothing in a clean chain", () => {
    expect(detectCycles([
      milestone({ id: "a", dependsOn: [] }),
      milestone({ id: "b", dependsOn: ["a"] }),
      milestone({ id: "c", dependsOn: ["b"] }),
    ])).toEqual([]);
  });

  it("finds nothing in a diamond", () => {
    expect(detectCycles([
      milestone({ id: "a", dependsOn: [] }),
      milestone({ id: "b", dependsOn: ["a"] }),
      milestone({ id: "c", dependsOn: ["a"] }),
      milestone({ id: "d", dependsOn: ["b", "c"] }),
    ])).toEqual([]);
  });

  it("finds a three-node loop", () => {
    const cycles = detectCycles([
      milestone({ id: "a", dependsOn: ["c"] }),
      milestone({ id: "b", dependsOn: ["a"] }),
      milestone({ id: "c", dependsOn: ["b"] }),
    ]);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]].sort()).toEqual(["a", "b", "c"]);
  });

  it("finds a self-reference", () => {
    expect(detectCycles([milestone({ id: "a", dependsOn: ["a"] })])).toEqual([["a"]]);
  });

  it("ignores a dependency on a milestone that no longer exists", () => {
    expect(detectCycles([milestone({ id: "a", dependsOn: ["deleted"] })])).toEqual([]);
  });
});

describe("dependencyEdges", () => {
  const range = { start: "2026-06-29", end: "2026-08-16" };

  it("draws an edge from each dependency's right edge to its dependant's left edge", () => {
    const edges = dependencyEdges(
      [
        milestone({ id: "a", order: 0, startDate: "2026-07-01", endDate: "2026-07-15" }),
        milestone({ id: "b", order: 1, startDate: "2026-07-20", endDate: "2026-07-31", dependsOn: ["a"] }),
      ],
      range, 490, 40,
    );
    // a: x=20 w=150 → right edge 170, row 0 → y 20
    // b: offset 21 days → x=210, row 1 → y 60
    expect(edges).toEqual([{ x1: 170, y1: 20, x2: 210, y2: 60 }]);
  });

  it("skips an edge when either milestone is undated", () => {
    expect(dependencyEdges(
      [
        milestone({ id: "a", order: 0, startDate: null, endDate: null }),
        milestone({ id: "b", order: 1, dependsOn: ["a"] }),
      ],
      range, 490, 40,
    )).toEqual([]);
  });

  it("skips a dependency on a milestone that no longer exists", () => {
    expect(dependencyEdges(
      [milestone({ id: "b", order: 0, dependsOn: ["deleted"] })],
      range, 490, 40,
    )).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/schedule.test.ts`
Expected: FAIL — `detectCycles is not a function`

- [ ] **Step 3: Implement**

Append to `src/lib/projects/schedule.ts`:

```ts
export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Every dependency cycle in the graph, each as an ordered list of milestone ids.
 * Iterative-safe DFS with three colours: 0 unvisited, 1 on the current path,
 * 2 fully explored. Dependencies pointing at deleted milestones are ignored —
 * they are dangling, not cyclic.
 */
export function detectCycles(milestones: Milestone[]): string[][] {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const colour = new Map<string, 0 | 1 | 2>();
  const cycles: string[][] = [];
  const path: string[] = [];

  function visit(id: string): void {
    if (colour.get(id) === 2) return;

    if (colour.get(id) === 1) {
      // Found a back-edge — slice the loop out of the current path.
      const from = path.indexOf(id);
      if (from !== -1) cycles.push(path.slice(from));
      return;
    }

    colour.set(id, 1);
    path.push(id);

    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep);
    }

    path.pop();
    colour.set(id, 2);
  }

  for (const m of milestones) visit(m.id);
  return cycles;
}

/**
 * Connector lines from each dependency's right edge to its dependant's left
 * edge, at each bar's vertical centre. Rows follow `order`, matching the
 * chart's own row sort. Undated or deleted endpoints produce no edge.
 */
export function dependencyEdges(
  milestones: Milestone[],
  range: GanttRange,
  width: number,
  rowHeight: number,
): Edge[] {
  const rows = [...milestones].sort((a, b) => a.order - b.order);
  const rowOf = new Map(rows.map((m, i) => [m.id, i]));
  const byId = new Map(rows.map((m) => [m.id, m]));
  const centre = (id: string) => (rowOf.get(id) ?? 0) * rowHeight + rowHeight / 2;

  const edges: Edge[] = [];
  for (const m of rows) {
    const to = barGeometry(m, range, width);
    if (!to) continue;

    for (const depId of m.dependsOn) {
      const dep = byId.get(depId);
      if (!dep) continue;
      const from = barGeometry(dep, range, width);
      if (!from) continue;

      edges.push({
        x1: from.x + from.w,
        y1: centre(depId),
        x2: to.x,
        y2: centre(m.id),
      });
    }
  }
  return edges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/schedule.test.ts`
Expected: PASS — 17 tests total

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/schedule.ts src/lib/projects/schedule.test.ts
git commit -m "feat(projects): dependency cycle detection and connector geometry"
```

---

### Task 12: GanttChart component

**Files:**
- Create: `src/components/projects/GanttChart.tsx`

**Interfaces:**
- Consumes: `ganttRange`, `rangeDays`, `barGeometry`, `dependencyEdges` (Tasks 10–11); `milestoneStatusTone`, `TONE_STYLE` (Task 3)
- Produces: `<GanttChart groups onSelect? />` where `groups: { key: string; label?: string; milestones: Milestone[] }[]`

One component serves both surfaces: the project page passes a single group; the portfolio timeline passes one group per project.

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Milestone } from "@/lib/types";
import {
  ganttRange, rangeDays, barGeometry, dependencyEdges, type GanttRange,
} from "@/lib/projects/schedule";
import { milestoneStatusTone } from "@/lib/badges";
import { TONE_STYLE } from "@/lib/badges";
import { addDaysISO, daysBetween, fmtDate, todayISO } from "@/lib/utils";

const ROW_H = 34;
const LABEL_W = 168;

export interface GanttGroup {
  key: string;
  label?: string;
  milestones: Milestone[];
}

export function GanttChart({
  groups,
  onSelect,
}: {
  groups: GanttGroup[];
  onSelect?: (m: Milestone) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  // Width comes from a ResizeObserver, matching TrendChart.tsx.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const all = useMemo(() => groups.flatMap((g) => g.milestones), [groups]);
  const range = useMemo(() => ganttRange(all), [all]);

  if (!range)
    return (
      <p className="text-[0.8rem] text-[var(--color-muted)]">
        No dated milestones yet — add start and end dates to see the timeline.
      </p>
    );

  const barsW = Math.max(0, w - LABEL_W);
  const ticks = weekTicks(range);
  const total = rangeDays(range);
  const today = todayISO();
  const todayX =
    today >= range.start && today <= range.end
      ? (daysBetween(range.start, today) / total) * barsW
      : null;

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      {/* week ruler */}
      <div className="flex" style={{ paddingLeft: LABEL_W }}>
        <div className="relative h-5 flex-1">
          {ticks.map((t) => (
            <span
              key={t.iso}
              className="absolute top-0 text-[0.66rem] text-[var(--color-dim)] tnum -translate-x-1/2"
              style={{ left: (daysBetween(range.start, t.iso) / total) * barsW }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {groups.map((g) => {
        const rows = [...g.milestones].sort((a, b) => a.order - b.order);
        const edges = dependencyEdges(rows, range, barsW, ROW_H);

        return (
          <div key={g.key} className="mb-3 last:mb-0">
            {g.label && <p className="eyebrow mb-1.5">{g.label}</p>}

            <div className="relative">
              {/* dependency connectors — an overlay, so bars stay plain DOM */}
              <svg
                className="pointer-events-none absolute inset-0"
                style={{ left: LABEL_W, width: barsW, height: rows.length * ROW_H }}
              >
                {edges.map((e, i) => (
                  <polyline
                    key={i}
                    points={`${e.x1},${e.y1} ${e.x1 + 8},${e.y1} ${e.x1 + 8},${e.y2} ${e.x2},${e.y2}`}
                    fill="none"
                    stroke="var(--color-line-strong)"
                    strokeWidth={1}
                  />
                ))}
              </svg>

              {/* today marker */}
              {todayX !== null && (
                <div
                  className="pointer-events-none absolute top-0 w-px bg-[var(--color-accent)] opacity-40"
                  style={{ left: LABEL_W + todayX, height: rows.length * ROW_H }}
                />
              )}

              {rows.map((m) => {
                const geo = barGeometry(m, range, barsW);
                const tone = TONE_STYLE[milestoneStatusTone(m.status)];
                return (
                  <div key={m.id} className="flex items-center" style={{ height: ROW_H }}>
                    <span
                      className="shrink-0 truncate pr-3 text-[0.78rem] text-[var(--color-ink-soft)]"
                      style={{ width: LABEL_W }}
                      title={m.name}
                    >
                      {m.name}
                    </span>
                    <div className="relative flex-1" style={{ height: ROW_H }}>
                      {geo ? (
                        <button
                          onClick={() => onSelect?.(m)}
                          title={`${m.name} · ${m.status} · ${fmtDate(m.startDate)} → ${fmtDate(m.endDate)}`}
                          className="absolute top-1/2 -translate-y-1/2 rounded-sm border transition-opacity hover:opacity-80"
                          style={{
                            left: geo.x,
                            width: geo.w,
                            height: 16,
                            background: tone.bg,
                            borderColor: tone.border,
                          }}
                        />
                      ) : (
                        <span className="absolute top-1/2 -translate-y-1/2 text-[0.7rem] text-[var(--color-muted)]">
                          no dates
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A label every Monday, thinned so they never collide on a long domain. */
function weekTicks(range: GanttRange): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const weeks = Math.ceil((daysBetween(range.start, range.end) + 1) / 7);
  const every = weeks > 12 ? 4 : weeks > 6 ? 2 : 1;

  for (let i = 0; i < weeks; i += every) {
    const iso = addDaysISO(range.start, i * 7);
    out.push({
      iso,
      label: new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      }),
    });
  }
  return out;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Merge the two `@/lib/badges` imports into one statement if the linter objects.

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/GanttChart.tsx
git commit -m "feat(projects): bespoke gantt chart with dependency connectors"
```

---

### Task 13: Wire the Gantt into the project page + dependsOn editing

**Files:**
- Modify: `src/app/projects/[id]/page.tsx`
- Modify: `src/components/projects/MilestoneForm.tsx`

**Interfaces:**
- Consumes: `GanttChart` (Task 12), `detectCycles` (Task 11)
- Produces: a Timeline panel on Overview; `dependsOn` multi-select with cycle rejection

- [ ] **Step 1: Fill the Gantt slot on Overview**

In `src/app/projects/[id]/page.tsx`, replace the `{/* Gantt slot — filled in Task 13 */}` comment:

```tsx
<Panel title="Timeline">
  <GanttChart
    groups={[{ key: project.id, milestones: projectMilestones }]}
    onSelect={setEditMilestone}
  />
</Panel>
```

Import `GanttChart`. Add the same panel above `MilestoneList` in the Milestones tab.

- [ ] **Step 2: Add dependsOn to MilestoneForm**

`MilestoneForm` needs the project's other milestones to offer as dependencies, and must reject a selection that would close a loop. Pull `milestones` from `useStore()` and add:

```tsx
const siblings = milestones
  .filter((m) => m.projectId === projectId && m.id !== initial?.id)
  .sort((a, b) => a.order - b.order);

// Validate against the graph as it WOULD be after this save.
const wouldCycle = useMemo(() => {
  const draftAsRecord: Milestone = {
    ...(initial ?? { id: "__draft", createdAt: "", updatedAt: "" }),
    ...d,
    id: initial?.id ?? "__draft",
  } as Milestone;
  const next = [...siblings, draftAsRecord];
  return detectCycles(next).length > 0;
}, [d, initial, siblings]);
```

Render the picker below Status:

```tsx
{siblings.length > 0 && (
  <Field
    label="Depends on"
    className="mt-3.5"
    hint={wouldCycle ? "That would create a dependency loop." : "Cmd/Ctrl-click to select several."}
  >
    <select
      multiple
      className="select h-24"
      value={d.dependsOn}
      onChange={(e) =>
        set("dependsOn", Array.from(e.target.selectedOptions, (o) => o.value))
      }
    >
      {siblings.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  </Field>
)}
```

Extend the guards: `if (!d.name.trim() || datesInvalid || wouldCycle) return;` and `saveDisabled={!d.name.trim() || datesInvalid || wouldCycle}`.

Import `useMemo`, `detectCycles`, and `type Milestone`.

- [ ] **Step 3: Verify**

Run: `npm run dev` → a demo project → Overview.
Expected: bars in `order`, correct status colours, a connector between the seeded dependency pair, a today hairline. Editing a milestone's dates moves its bar. Selecting a dependency that closes a loop disables Save and shows the hint.

- [ ] **Step 4: Commit**

```bash
git add "src/app/projects/[id]/page.tsx" src/components/projects/MilestoneForm.tsx
git commit -m "feat(projects): project timeline panel and dependency editing"
```

---

### Task 14: Portfolio timeline on the index

**Files:**
- Modify: `src/app/projects/page.tsx`

**Interfaces:**
- Consumes: `GanttChart`, `GanttGroup` (Task 12)
- Produces: a `Board | Timeline` toggle

- [ ] **Step 1: Implement**

Add view state beside the existing filters:

```tsx
const [view, setView] = useState<"board" | "timeline">("board");
```

Render the toggle in the filter row:

```tsx
<div className="ml-auto flex gap-1">
  {(["board", "timeline"] as const).map((v) => (
    <button
      key={v}
      onClick={() => setView(v)}
      className={cn("btn btn-sm capitalize", view === v && "btn-accent")}
    >
      {v}
    </button>
  ))}
</div>
```

Build the groups from the already-filtered project list, so the stage/type filters apply to both views:

```tsx
const { projects, milestones, tasks, remove } = useStore();
const router = useRouter();

const groups: GanttGroup[] = useMemo(
  () =>
    filtered.map((p) => ({
      key: p.id,
      label: `${p.name}${p.company ? ` · ${p.company}` : ""}`,
      milestones: milestones.filter((m) => m.projectId === p.id),
    })),
  [filtered, milestones],
);
```

Swap the body on `view`, keeping the existing empty state for the board:

```tsx
{view === "timeline" ? (
  <Panel>
    <GanttChart groups={groups} onSelect={(m) => router.push(`/projects/${m.projectId}`)} />
  </Panel>
) : (
  /* existing card grid + empty state, unchanged */
)}
```

Clicking a bar in the portfolio view navigates to that project rather than opening an editor — the index has no milestone modal.

- [ ] **Step 2: Verify**

Run: `npm run dev` → `/projects` → Timeline.
Expected: one labelled group per project on a shared axis; stage/type filters change which groups appear; clicking a bar opens that project. **Phase 2 complete.**

Run: `npm test && npx tsc --noEmit` — all green.

- [ ] **Step 3: Commit**

```bash
git add src/app/projects/page.tsx
git commit -m "feat(projects): portfolio timeline view on the index"
```

---

# Phase 3 — Git

Parsing is separated from execution so it tests against fixture strings with no repo on disk. Git is never load-bearing: every failure degrades to a chip and a re-link button.

---

### Task 15: parseStatus

**Files:**
- Create: `src/lib/git/types.ts`
- Create: `src/lib/git/parse.ts`
- Test: `src/lib/git/parse.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `RepoStatus`, `Commit`, `GitErrorCode` (in `types.ts`); `parseStatus(stdout: string): RepoStatus`

`types.ts` is separate from `parse.ts` because client components import the types while `repo.ts` is server-only — a shared type file keeps the client from pulling in anything that touches `node:child_process`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/git/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseStatus } from "./parse";

describe("parseStatus", () => {
  it("reads branch, ahead/behind and the three change counts", () => {
    const out = [
      "# branch.oid 9f8e7d6c5b4a",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaa bbb src/edited.ts",
      "1 M. N... 100644 100644 100644 ccc ddd src/staged.ts",
      "1 MM N... 100644 100644 100644 eee fff src/both.ts",
      "? src/new.ts",
      "? src/other.ts",
      "! dist/ignored.js",
    ].join("\n");

    expect(parseStatus(out)).toEqual({
      branch: "main",
      ahead: 2,
      behind: 1,
      staged: 2,    // M. and MM
      unstaged: 2,  // .M and MM
      untracked: 2, // ignored lines don't count
    });
  });

  it("defaults ahead/behind to zero when there is no upstream", () => {
    const out = ["# branch.oid abc", "# branch.head feature/gantt"].join("\n");
    expect(parseStatus(out)).toEqual({
      branch: "feature/gantt", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
    });
  });

  it("reports a clean repo", () => {
    const out = ["# branch.oid abc", "# branch.head main", "# branch.ab +0 -0"].join("\n");
    expect(parseStatus(out)).toMatchObject({ staged: 0, unstaged: 0, untracked: 0 });
  });

  it("counts renames and unmerged entries", () => {
    const out = [
      "# branch.head main",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
    ].join("\n");
    expect(parseStatus(out)).toMatchObject({ staged: 1, unstaged: 1 });
  });

  it("survives empty output", () => {
    expect(parseStatus("")).toEqual({
      branch: "", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/git/parse.test.ts`
Expected: FAIL — cannot find module `./parse`

- [ ] **Step 3: Create the shared types**

Create `src/lib/git/types.ts`:

```ts
export interface RepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  authorDate: string; // ISO 8601
  files: string[];
}

export type GitErrorCode = "not_found" | "not_a_repo" | "git_failed";
```

- [ ] **Step 4: Implement parseStatus**

Create `src/lib/git/parse.ts`:

```ts
import type { RepoStatus } from "./types";

const EMPTY_STATUS: RepoStatus = {
  branch: "", ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0,
};

/**
 * Parses `git status --porcelain=v2 --branch`.
 *
 * Header lines start `# branch.*`. Entry lines: `1` ordinary change,
 * `2` rename/copy, `u` unmerged, `?` untracked, `!` ignored. For `1`/`2`
 * the second field is an XY pair — X is the index (staged) state and Y the
 * worktree (unstaged) state, `.` meaning unmodified.
 */
export function parseStatus(stdout: string): RepoStatus {
  const out: RepoStatus = { ...EMPTY_STATUS };

  for (const line of stdout.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      out.branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        out.ahead = Number(m[1]);
        out.behind = Number(m[2]);
      }
      continue;
    }
    if (line.startsWith("#")) continue;

    const kind = line[0];
    if (kind === "?") {
      out.untracked += 1;
    } else if (kind === "u") {
      // A conflicted file needs work in the worktree.
      out.unstaged += 1;
    } else if (kind === "1" || kind === "2") {
      const xy = line.split(" ")[1] ?? "..";
      if (xy[0] && xy[0] !== ".") out.staged += 1;
      if (xy[1] && xy[1] !== ".") out.unstaged += 1;
    }
    // "!" ignored entries are deliberately not counted.
  }

  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/git/parse.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/git/types.ts src/lib/git/parse.ts src/lib/git/parse.test.ts
git commit -m "feat(git): parse porcelain v2 status output"
```

---

### Task 16: parseLog

**Files:**
- Modify: `src/lib/git/parse.ts`
- Test: `src/lib/git/parse.test.ts`

**Interfaces:**
- Consumes: `Commit` (Task 15)
- Produces: `parseLog(stdout: string): Commit[]`, `LOG_FORMAT` (the exact `--format` string `repo.ts` must pass)

Records are delimited by ASCII **RS** (`\x1e`) and fields by **US** (`\x1f`), so a commit body containing newlines or any printable character cannot corrupt the parse.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/git/parse.test.ts`:

```ts
import { parseLog, LOG_FORMAT } from "./parse";

const RS = "\x1e";
const US = "\x1f";

describe("parseLog", () => {
  it("parses several commits with their changed files", () => {
    const out =
      `${RS}9f8e7d6${US}9f8e7d6${US}2026-07-28T14:02:11+02:00${US}feat(gantt): add bar geometry${US}${US}\n` +
      "src/lib/projects/schedule.ts\nsrc/lib/projects/schedule.test.ts\n" +
      `${RS}1a2b3c4${US}1a2b3c4${US}2026-07-27T09:15:00+02:00${US}fix(git): count renames${US}Body line one.\nBody line two.${US}\n` +
      "src/lib/git/parse.ts\n";

    const commits = parseLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "9f8e7d6",
      shortHash: "9f8e7d6",
      authorDate: "2026-07-28T14:02:11+02:00",
      subject: "feat(gantt): add bar geometry",
      body: "",
      files: ["src/lib/projects/schedule.ts", "src/lib/projects/schedule.test.ts"],
    });
    expect(commits[1].body).toBe("Body line one.\nBody line two.");
    expect(commits[1].files).toEqual(["src/lib/git/parse.ts"]);
  });

  it("handles a commit with no changed files (e.g. a merge)", () => {
    const out = `${RS}abc${US}abc${US}2026-07-01T00:00:00Z${US}Merge branch 'x'${US}${US}\n`;
    expect(parseLog(out)[0].files).toEqual([]);
  });

  it("returns an empty array for empty output", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog("\n")).toEqual([]);
  });

  it("exposes a format string using the record and unit separators", () => {
    expect(LOG_FORMAT).toContain("%x1e");
    expect(LOG_FORMAT).toContain("%x1f");
    expect(LOG_FORMAT).toContain("%H");
    expect(LOG_FORMAT).toContain("%aI");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/git/parse.test.ts`
Expected: FAIL — `parseLog is not a function`

- [ ] **Step 3: Implement**

Append to `src/lib/git/parse.ts` (add `Commit` to the type import):

```ts
/**
 * The exact `--format` `readCommits` must pass. Fields, in order:
 * full hash, short hash, author date (ISO), subject, body — each preceded by
 * a record separator for the commit and separated by unit separators. The
 * trailing %x1f closes the body so `--name-only` file paths that follow are
 * unambiguously outside the fields.
 */
export const LOG_FORMAT = "%x1e%H%x1f%h%x1f%aI%x1f%s%x1f%b%x1f";

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split("\x1e")
    .slice(1) // text before the first record separator is never a commit
    .map((record) => {
      const [hash, shortHash, authorDate, subject, body, filesBlob] = record.split("\x1f");
      return {
        hash: (hash ?? "").trim(),
        shortHash: (shortHash ?? "").trim(),
        authorDate: (authorDate ?? "").trim(),
        subject: subject ?? "",
        body: body ?? "",
        files: (filesBlob ?? "")
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
      };
    })
    .filter((c) => !!c.hash);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/git/parse.test.ts`
Expected: PASS — 9 tests total

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/parse.ts src/lib/git/parse.test.ts
git commit -m "feat(git): parse separator-delimited log output"
```

---

### Task 17: repo.ts — the execution layer

**Files:**
- Create: `src/lib/git/repo.ts`

**Interfaces:**
- Consumes: `parseStatus`, `parseLog`, `LOG_FORMAT` (Tasks 15–16); `RepoStatus`, `Commit`, `GitErrorCode`
- Produces: `GitError`, `resolveRepo(path)`, `readStatus(path)`, `readCommits(path, opts?)`

Not unit-tested — it needs a real repo on disk. Every branch it has is either a thin `execFile` wrapper or a guard verified by hand in Step 3.

- [ ] **Step 1: Implement**

```ts
/* ============================================================
   Local git reader (server-only).

   Shells out to the `git` binary against an absolute path on
   this machine. Must only be imported from server code — it
   uses node:child_process and node:fs.
   ============================================================ */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseLog, parseStatus, LOG_FORMAT } from "./parse";
import type { Commit, GitErrorCode, RepoStatus } from "./types";

const run = promisify(execFile);

/** Hard caps so a huge or pathological repo cannot hang the route. */
const TIMEOUT_MS = 5000;
const MAX_BUFFER = 4 * 1024 * 1024;
const DEFAULT_LIMIT = 50;

export class GitError extends Error {
  constructor(readonly code: GitErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GitError";
  }
}

/**
 * The gatekeeper every read goes through. The path must be absolute, exist,
 * be a directory, and contain a `.git` entry (a file for worktrees, a
 * directory otherwise).
 */
export async function resolveRepo(repoPath: string): Promise<string> {
  const p = (repoPath ?? "").trim();
  if (!p || !path.isAbsolute(p)) throw new GitError("not_found", "Path must be absolute");

  try {
    const s = await stat(p);
    if (!s.isDirectory()) throw new GitError("not_found", "Path is not a directory");
  } catch (err) {
    if (err instanceof GitError) throw err;
    throw new GitError("not_found", "Path does not exist");
  }

  try {
    await stat(path.join(p, ".git"));
  } catch {
    throw new GitError("not_a_repo", "No .git found at this path");
  }

  return p;
}

/** execFile — never exec — so a path with shell metacharacters is an argument. */
async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", repoPath, ...args], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    throw new GitError("git_failed", (err as Error).message);
  }
}

export async function readStatus(repoPath: string): Promise<RepoStatus> {
  const dir = await resolveRepo(repoPath);
  return parseStatus(await git(dir, ["status", "--porcelain=v2", "--branch"]));
}

export async function readCommits(
  repoPath: string,
  opts: { limit?: number; since?: string } = {},
): Promise<Commit[]> {
  const dir = await resolveRepo(repoPath);
  const args = [
    "log",
    `--max-count=${Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 200))}`,
    "--date=iso-strict",
    "--name-only",
    `--format=${LOG_FORMAT}`,
  ];
  if (opts.since) args.push(`--since=${opts.since}`);

  return parseLog(await git(dir, args));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify by hand against a real repo**

There is no unit test here, so exercise it once from a scratch script:

```bash
cat > /tmp/git-check.mjs <<'EOF'
import { readStatus, readCommits, resolveRepo } from "./src/lib/git/repo.ts";
console.log(await readStatus(process.cwd()));
console.log((await readCommits(process.cwd(), { limit: 3 })).map(c => `${c.shortHash} ${c.subject} (${c.files.length} files)`));
await resolveRepo("/tmp").catch(e => console.log("expected:", e.code));
await resolveRepo("/nope").catch(e => console.log("expected:", e.code));
EOF
npx tsx /tmp/git-check.mjs
```

Expected: a real branch and change counts for this repo; three recent commits with subjects and file counts; `expected: not_a_repo` for `/tmp`; `expected: not_found` for `/nope`. Delete `/tmp/git-check.mjs` afterwards. If `tsx` is unavailable, verify through the API route in Task 18 instead.

- [ ] **Step 4: Commit**

```bash
git add src/lib/git/repo.ts
git commit -m "feat(git): server-only local repo reader"
```

---

### Task 18: /api/git route + client gateway

**Files:**
- Create: `src/app/api/git/route.ts`
- Create: `src/lib/git/gitClient.ts`

**Interfaces:**
- Consumes: `readStatus`, `readCommits`, `GitError` (Task 17)
- Produces: `GET /api/git?path=&action=status|log&limit=`; `GitResult<T>`, `fetchRepoStatus(path)`, `fetchCommits(path, limit?)`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { GitError, readCommits, readStatus } from "@/lib/git/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  not_a_repo: 404,
  git_failed: 502,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoPath = url.searchParams.get("path") ?? "";
  const action = url.searchParams.get("action") ?? "status";
  const limit = Number(url.searchParams.get("limit")) || undefined;

  if (!repoPath) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const data =
      action === "log"
        ? await readCommits(repoPath, { limit })
        : await readStatus(repoPath);
    return NextResponse.json({ data });
  } catch (err) {
    // Never leak a stack trace or a raw fs error to the client.
    const code = err instanceof GitError ? err.code : "git_failed";
    return NextResponse.json({ error: code }, { status: STATUS_FOR[code] ?? 502 });
  }
}
```

The route is already behind auth — `src/middleware.ts` matches everything except `api/auth`, `login` and static files.

- [ ] **Step 2: Implement the client gateway**

Create `src/lib/git/gitClient.ts`:

```ts
import type { Commit, GitErrorCode, RepoStatus } from "./types";

export type GitResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: GitErrorCode };

async function call<T>(params: Record<string, string>): Promise<GitResult<T>> {
  try {
    const res = await fetch(`/api/git?${new URLSearchParams(params)}`);
    const json = await res.json();
    if (!res.ok) return { ok: false, error: (json.error as GitErrorCode) ?? "git_failed" };
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, error: "git_failed" };
  }
}

export const fetchRepoStatus = (path: string) =>
  call<RepoStatus>({ path, action: "status" });

export const fetchCommits = (path: string, limit = 50) =>
  call<Commit[]>({ path, action: "log", limit: String(limit) });
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, then in the browser console on any authed page:

```js
await (await fetch(`/api/git?path=${encodeURIComponent("/Users/emilfabel/Pallisade_OS")}&action=log&limit=3`)).json()
```

Expected: `{ data: [ … 3 commits … ] }`. Then try `path=/tmp` → `{ error: "not_a_repo" }` with a 404, and `path=/nope` → `{ error: "not_found" }`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/git/route.ts src/lib/git/gitClient.ts
git commit -m "feat(git): authed api route and client gateway"
```

---

### Task 19: milestoneProgress

**Files:**
- Create: `src/lib/git/milestoneProgress.ts`
- Test: `src/lib/git/milestoneProgress.test.ts`

**Interfaces:**
- Consumes: `Commit` (Task 15), `Milestone` (Task 1)
- Produces: `matchCommits(commits, milestones): Map<string, Commit[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/git/milestoneProgress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchCommits } from "./milestoneProgress";
import type { Commit } from "./types";
import type { Milestone } from "@/lib/types";

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "M",
    startDate: "2026-07-01", endDate: "2026-07-15", status: "planned",
    order: 0, dependsOn: [], commitScope: "", notes: "",
    ...over,
  };
}

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: "abc", shortHash: "abc", subject: "chore: tidy", body: "",
    authorDate: "2026-07-05T10:00:00+02:00", files: [],
    ...over,
  };
}

describe("matchCommits — scope matching", () => {
  it("matches conventional-commit scope", () => {
    const m = milestone({ id: "m1", commitScope: "gantt" });
    const commits = [
      commit({ hash: "1", subject: "feat(gantt): add bars" }),
      commit({ hash: "2", subject: "fix(git): counts" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")!.map((c) => c.hash)).toEqual(["1"]);
  });

  it("matches bracket scope and a breaking-change bang", () => {
    const m = milestone({ id: "m1", commitScope: "gantt" });
    const commits = [
      commit({ hash: "1", subject: "[gantt] tweak the ruler" }),
      commit({ hash: "2", subject: "feat(gantt)!: drop the old axis" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    const m = milestone({ id: "m1", commitScope: "Gantt" });
    expect(matchCommits([commit({ subject: "feat(gantt): x" })], [m]).get("m1")).toHaveLength(1);
  });

  it("does not match a bare substring outside a scope", () => {
    const m = milestone({ id: "m1", commitScope: "gantt" });
    expect(matchCommits([commit({ subject: "docs: describe the gantt" })], [m]).get("m1")).toEqual([]);
  });

  it("ignores dates entirely when a scope is set", () => {
    const m = milestone({ id: "m1", commitScope: "gantt", startDate: "2026-01-01", endDate: "2026-01-02" });
    expect(matchCommits([commit({ subject: "feat(gantt): x" })], [m]).get("m1")).toHaveLength(1);
  });
});

describe("matchCommits — date-range fallback", () => {
  it("matches commits inside the range", () => {
    const m = milestone({ id: "m1" }); // 2026-07-01 → 2026-07-15
    const commits = [
      commit({ hash: "in", authorDate: "2026-07-05T10:00:00+02:00" }),
      commit({ hash: "before", authorDate: "2026-06-30T23:59:00+02:00" }),
      commit({ hash: "after", authorDate: "2026-07-16T00:01:00+02:00" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")!.map((c) => c.hash)).toEqual(["in"]);
  });

  it("includes both boundary dates", () => {
    const m = milestone({ id: "m1" });
    const commits = [
      commit({ hash: "start", authorDate: "2026-07-01T00:00:00+02:00" }),
      commit({ hash: "end", authorDate: "2026-07-15T23:59:00+02:00" }),
    ];
    expect(matchCommits(commits, [m]).get("m1")).toHaveLength(2);
  });

  it("matches nothing for a milestone missing either date", () => {
    const result = matchCommits([commit()], [
      milestone({ id: "a", startDate: null }),
      milestone({ id: "b", endDate: null }),
    ]);
    expect(result.get("a")).toEqual([]);
    expect(result.get("b")).toEqual([]);
  });
});

describe("matchCommits — general", () => {
  it("lets one commit match two overlapping milestones", () => {
    const result = matchCommits([commit({ hash: "x" })], [
      milestone({ id: "a", startDate: "2026-07-01", endDate: "2026-07-10" }),
      milestone({ id: "b", startDate: "2026-07-03", endDate: "2026-07-20" }),
    ]);
    expect(result.get("a")).toHaveLength(1);
    expect(result.get("b")).toHaveLength(1);
  });

  it("returns an entry for every milestone, even empty ones", () => {
    const result = matchCommits([], [milestone({ id: "a" }), milestone({ id: "b" })]);
    expect([...result.keys()].sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/git/milestoneProgress.test.ts`
Expected: FAIL — cannot find module `./milestoneProgress`

- [ ] **Step 3: Implement**

```ts
import type { Milestone } from "@/lib/types";
import type { Commit } from "./types";

/** Escape a user-supplied scope so it cannot inject regex syntax. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a conventional-commit scope — `feat(gantt):`, `fix(gantt)!:` — or a
 * bracket scope — `[gantt]`. Deliberately NOT a bare substring: "docs: describe
 * the gantt" is about the milestone, not work on it.
 */
function scopeMatcher(scope: string): RegExp {
  const s = escapeRe(scope.trim());
  return new RegExp(`(\\(\\s*${s}\\s*\\)\\s*!?\\s*:)|(\\[\\s*${s}\\s*\\])`, "i");
}

/**
 * Commits attributable to each milestone.
 *
 * Rule 1 — when `commitScope` is set, match on the scope and ignore dates.
 * Rule 2 — otherwise match commits whose author date falls inside
 *          [startDate, endDate] inclusive. A milestone missing either date
 *          matches nothing.
 *
 * A commit may match several milestones; exclusivity is not enforced because
 * any tie-break would be a guess. Every milestone gets a map entry, empty or not.
 */
export function matchCommits(
  commits: Commit[],
  milestones: Milestone[],
): Map<string, Commit[]> {
  const out = new Map<string, Commit[]>();

  for (const m of milestones) {
    if (m.commitScope.trim()) {
      const re = scopeMatcher(m.commitScope);
      out.set(m.id, commits.filter((c) => re.test(c.subject)));
      continue;
    }

    if (!m.startDate || !m.endDate) {
      out.set(m.id, []);
      continue;
    }

    const { startDate: from, endDate: to } = m;
    out.set(
      m.id,
      commits.filter((c) => {
        const day = c.authorDate.slice(0, 10);
        return day >= from && day <= to;
      }),
    );
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/git/milestoneProgress.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/milestoneProgress.ts src/lib/git/milestoneProgress.test.ts
git commit -m "feat(git): match commits to milestones by scope or date range"
```

---

### Task 20: RepoLink + repo chip in the project header

**Files:**
- Create: `src/components/projects/RepoLink.tsx`
- Create: `src/components/projects/useRepo.ts`
- Modify: `src/components/forms/ProjectForm.tsx`
- Modify: `src/components/projects/MilestoneForm.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `fetchRepoStatus`, `fetchCommits` (Task 18)
- Produces: `useRepo(repoPath)` → `{ status, commits, error, loading }`; `<RepoLink project />`

- [ ] **Step 1: Implement the hook**

One hook owns all repo fetching so no component fetches twice. Create `src/components/projects/useRepo.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { fetchCommits, fetchRepoStatus } from "@/lib/git/gitClient";
import type { Commit, GitErrorCode, RepoStatus } from "@/lib/git/types";

export interface RepoState {
  status: RepoStatus | null;
  commits: Commit[];
  error: GitErrorCode | null;
  loading: boolean;
}

const IDLE: RepoState = { status: null, commits: [], error: null, loading: false };

export function useRepo(repoPath: string | null, limit = 50): RepoState {
  const [state, setState] = useState<RepoState>(IDLE);

  useEffect(() => {
    if (!repoPath) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    setState({ ...IDLE, loading: true });

    (async () => {
      const [s, c] = await Promise.all([
        fetchRepoStatus(repoPath),
        fetchCommits(repoPath, limit),
      ]);
      if (cancelled) return;

      // A failure on either call is reported once; the page still renders.
      const error = !s.ok ? s.error : !c.ok ? c.error : null;
      setState({
        status: s.ok ? s.data : null,
        commits: c.ok ? c.data : [],
        error,
        loading: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [repoPath, limit]);

  return state;
}
```

- [ ] **Step 2: Implement RepoLink**

```tsx
"use client";

import { useState } from "react";
import { GitBranch, Check, X } from "lucide-react";
import type { Project } from "@/lib/types";
import { useStore } from "@/lib/store";
import { fetchRepoStatus } from "@/lib/git/gitClient";
import { Field, TextInput } from "@/components/ui/Field";

const MESSAGE: Record<string, string> = {
  not_found: "No folder at that path.",
  not_a_repo: "That folder isn't a git repository.",
  git_failed: "Couldn't run git — is it installed and on PATH?",
};

export function RepoLink({ project }: { project: Project }) {
  const { update } = useStore();
  const [path, setPath] = useState(project.repoPath ?? "");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const check = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      update("projects", project.id, { repoPath: null });
      setResult({ ok: true, message: "Repo unlinked." });
      return;
    }

    setChecking(true);
    const res = await fetchRepoStatus(trimmed);
    setChecking(false);

    if (res.ok) {
      update("projects", project.id, { repoPath: trimmed });
      setResult({ ok: true, message: `Linked — on branch ${res.data.branch || "(detached)"}.` });
    } else {
      setResult({ ok: false, message: MESSAGE[res.error] ?? "Couldn't read that repo." });
    }
  };

  return (
    <div className="space-y-2.5">
      <Field label="Repository path" hint="An absolute folder path on this Mac, e.g. /Users/you/code/acme">
        <TextInput
          value={path}
          onChange={(e) => { setPath(e.target.value); setResult(null); }}
          placeholder="/Users/you/code/project"
          spellCheck={false}
        />
      </Field>
      <div className="flex items-center gap-2.5">
        <button className="btn btn-sm" onClick={check} disabled={checking}>
          <GitBranch size={13} /> {checking ? "Checking…" : "Check & link"}
        </button>
        {result && (
          <span
            className={`inline-flex items-center gap-1.5 text-[0.76rem] ${
              result.ok ? "text-[var(--color-positive)]" : "text-[var(--color-accent-soft)]"
            }`}
          >
            {result.ok ? <Check size={13} /> : <X size={13} />} {result.message}
          </span>
        )}
      </div>
    </div>
  );
}
```

Linking writes `repoPath` only after a successful check, so a typo can never be saved.

- [ ] **Step 3: Expose commitScope on MilestoneForm**

Now that git exists, add below the Order field in `MilestoneForm.tsx`:

```tsx
<Field
  label="Commit scope"
  className="mt-3.5"
  hint="Optional. Matches feat(scope): or [scope] in commit subjects. Leave blank to match by date."
>
  <TextInput
    value={d.commitScope}
    onChange={(e) => set("commitScope", e.target.value)}
    placeholder="gantt"
    spellCheck={false}
  />
</Field>
```

- [ ] **Step 4: Add the header chip**

In `src/app/projects/[id]/page.tsx`, call the hook and render the chip under the company line:

```tsx
const repo = useRepo(project.repoPath);
```

```tsx
{project.repoPath && (
  <p className="text-[0.74rem] text-[var(--color-dim)] tnum mt-0.5">
    {repo.error ? (
      <span className="text-[var(--color-accent-soft)]">
        Repo not found at {project.repoPath}
      </span>
    ) : repo.status ? (
      <>
        {repo.status.branch || "(detached)"}
        {repo.status.staged + repo.status.unstaged + repo.status.untracked > 0 &&
          ` · ${repo.status.staged + repo.status.unstaged + repo.status.untracked} uncommitted`}
        {repo.status.ahead > 0 && ` · ${repo.status.ahead} ahead`}
        {repo.status.behind > 0 && ` · ${repo.status.behind} behind`}
      </>
    ) : (
      "Reading repo…"
    )}
  </p>
)}
```

Add `repoPath: initial?.repoPath ?? null` to `ProjectForm`'s draft if Task 9 Step 1 did not already.

- [ ] **Step 5: Verify**

Run: `npm run dev` → a project → Repo tab (added next task; for now use the Overview and a temporary `<RepoLink project={project} />`). Link `/Users/emilfabel/Pallisade_OS`.
Expected: "Linked — on branch main." and a header chip showing the branch. Then link `/tmp` → "That folder isn't a git repository." and nothing saved.

- [ ] **Step 6: Commit**

```bash
git add src/components/projects/RepoLink.tsx src/components/projects/useRepo.ts src/components/projects/MilestoneForm.tsx src/components/forms/ProjectForm.tsx "src/app/projects/[id]/page.tsx"
git commit -m "feat(git): link a project to a local repo and show branch state"
```

---

### Task 21: CommitFeed + Repo tab

**Files:**
- Create: `src/components/projects/CommitFeed.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `useRepo` (Task 20), `Commit` (Task 15)
- Produces: `<CommitFeed commits limit? />`; a `Repo` tab

- [ ] **Step 1: Implement CommitFeed**

```tsx
"use client";

import { GitCommit } from "lucide-react";
import type { Commit } from "@/lib/git/types";
import { relativeDay } from "@/lib/utils";

export function CommitFeed({ commits, limit }: { commits: Commit[]; limit?: number }) {
  if (commits.length === 0)
    return <p className="text-[0.8rem] text-[var(--color-muted)]">No commits found.</p>;

  const shown = limit ? commits.slice(0, limit) : commits;

  return (
    <ul className="space-y-1.5">
      {shown.map((c) => (
        <li
          key={c.hash}
          className="flex items-start gap-2.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2"
        >
          <GitCommit size={14} className="mt-0.5 shrink-0 text-[var(--color-dim)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.82rem] text-[var(--color-ink-soft)] truncate" title={c.subject}>
              {c.subject}
            </p>
            <p className="text-[0.72rem] text-[var(--color-dim)] tnum">
              {c.shortHash} · {relativeDay(c.authorDate.slice(0, 10))}
              {c.files.length > 0 && ` · ${c.files.length} file${c.files.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Add the Repo tab**

Extend `TABS` to `["Overview", "Milestones", "Tasks", "Repo"] as const` and add the panel:

```tsx
{tab === "Repo" && (
  <div className="space-y-4">
    <Panel title="Repository">
      <RepoLink project={project} />
    </Panel>
    {project.repoPath && (
      <Panel title="Recent commits">
        {repo.loading ? (
          <p className="text-[0.8rem] text-[var(--color-muted)]">Reading repo…</p>
        ) : repo.error ? (
          <p className="text-[0.8rem] text-[var(--color-accent-soft)]">
            Couldn&apos;t read the repo at {project.repoPath}. Re-link it above.
          </p>
        ) : (
          <CommitFeed commits={repo.commits} />
        )}
      </Panel>
    )}
  </div>
)}
```

Add the last-5 feed to Overview, below the Status panel:

```tsx
{project.repoPath && !repo.error && repo.commits.length > 0 && (
  <Panel title="Recent commits">
    <CommitFeed commits={repo.commits} limit={5} />
  </Panel>
)}
```

Remove the temporary `<RepoLink>` from Overview if Task 20 Step 5 left one there.

- [ ] **Step 3: Verify the failure path**

Run: `npm run dev`. Link a repo, confirm the feed. Then rename that folder on disk and reload.
Expected: the page renders in full, the header shows "Repo not found at …", the Repo tab offers a re-link, and the Overview/Milestones/Tasks tabs are unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/CommitFeed.tsx "src/app/projects/[id]/page.tsx"
git commit -m "feat(git): commit feed and repo tab"
```

---

### Task 22: Milestone progress suggestions

Commit counts appear on each milestone; a suggestion offers a one-click status change. Git never flips a status by itself.

**Files:**
- Modify: `src/components/projects/MilestoneList.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `matchCommits` (Task 19), `useRepo` (Task 20)
- Produces: `MilestoneList` gains an optional `commitsByMilestone` prop and an `onSuggest` callback

- [ ] **Step 1: Extend MilestoneList**

Add props:

```tsx
commitsByMilestone?: Map<string, Commit[]>;
onSuggest?: (m: Milestone, status: MilestoneStatus) => void;
```

Inside the `sorted.map`, compute the suggestion:

```tsx
const commits = commitsByMilestone?.get(m.id) ?? [];
const latest = commits[0]; // git log is newest-first
const suggestion =
  commits.length > 0 && m.status === "planned" ? ("in progress" as const) : null;
```

Render the count under the dates, and the suggestion as its own row:

```tsx
{commits.length > 0 && (
  <p className="text-[0.72rem] text-[var(--color-dim)] tnum">
    {commits.length} commit{commits.length === 1 ? "" : "s"}
    {latest && ` · last ${relativeDay(latest.authorDate.slice(0, 10))}`}
  </p>
)}
```

```tsx
{suggestion && onSuggest && (
  <button
    className="btn btn-sm shrink-0"
    onClick={() => onSuggest(m, suggestion)}
    title="Suggested from commit activity — applies only when you click"
  >
    Mark {suggestion}?
  </button>
)}
```

Import `relativeDay`, `type Commit`, `type MilestoneStatus`.

Only `planned → in progress` is ever suggested. Nothing suggests `done`: the absence of commits is not evidence of completion, and a wrong `done` is the expensive mistake.

- [ ] **Step 2: Wire it up**

In `src/app/projects/[id]/page.tsx`:

```tsx
const commitsByMilestone = useMemo(
  () => matchCommits(repo.commits, projectMilestones),
  [repo.commits, projectMilestones],
);
```

```tsx
<MilestoneList
  milestones={projectMilestones}
  tasks={projectTasks}
  commitsByMilestone={commitsByMilestone}
  onEdit={setEditMilestone}
  onDelete={setDeleteMilestone}
  onSuggest={(m, status) => update("milestones", m.id, { status })}
/>
```

Import `matchCommits`.

- [ ] **Step 3: Verify**

Run: `npm run dev`. Link this repo to a demo project, set a milestone's dates to span the last week, leave it `planned`.
Expected: a commit count, a last-commit date, and a "Mark in progress?" button that changes the status only when clicked. Set `commitScope` to `gantt` and confirm the count switches to scope-matched commits and ignores the dates. **Phase 3 complete.**

Run: `npm test && npx tsc --noEmit` — all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/MilestoneList.tsx "src/app/projects/[id]/page.tsx"
git commit -m "feat(git): milestone commit counts and status suggestions"
```

---

# Phase 4 — Context chat and the cross-agent seam

Reuses the Advisor's `ProposedAction` confirm-gated rails verbatim. The payoff is Task 28–30: what gets decided in a project thread becomes readable by the Advisor and the Brain.

---

### Task 23: Project system prompt

**Files:**
- Create: `src/lib/projects/prompt.ts`
- Test: `src/lib/projects/prompt.test.ts`

**Interfaces:**
- Consumes: `Project`, `Milestone`, `Task` (Task 1); `RepoStatus`, `Commit` (Task 15)
- Produces: `ProjectPromptInput`, `buildProjectSystemPrompt(input): string`, `PROMPT_BUDGET`

- [ ] **Step 1: Write the failing test**

Create `src/lib/projects/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildProjectSystemPrompt, PROMPT_BUDGET } from "./prompt";
import type { Milestone, Project, Task } from "@/lib/types";

const project: Project = {
  id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
  type: "paid project", stage: "building", priority: "high",
  startDate: "2026-07-01", dueDate: "2026-08-15", currentMilestone: "",
  currentBlocker: "Waiting on their API credentials", nextAction: "Chase Sam for the key",
  deliverables: "Live dashboard + handover doc", notes: "", repoPath: "/Users/e/code/acme",
};

const milestone: Milestone = {
  id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest pipeline",
  startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
  order: 0, dependsOn: [], commitScope: "ingest", notes: "",
};

const task: Task = {
  id: "t1", createdAt: "", updatedAt: "", title: "Wire the auth handshake",
  linkKind: "project", linkId: "p1", milestoneId: "m1", category: "delivery",
  priority: "high", status: "in progress", dueDate: "2026-07-18", notes: "",
};

const base = {
  project, milestones: [milestone], tasks: [task],
  repo: { branch: "main", ahead: 1, behind: 0, staged: 0, unstaged: 2, untracked: 1 },
  commits: [{
    hash: "abc123", shortHash: "abc123", subject: "feat(ingest): batch loader",
    body: "", authorDate: "2026-07-18T10:00:00+02:00", files: ["src/ingest.ts"],
  }],
  businessName: "Pallisade Data", founderName: "Emil", today: "2026-07-29",
};

describe("buildProjectSystemPrompt", () => {
  it("names the project, business and today's date", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("Acme Dashboard");
    expect(p).toContain("Pallisade Data");
    expect(p).toContain("2026-07-29");
  });

  it("includes milestones with status and dates", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("Ingest pipeline");
    expect(p).toContain("in progress");
    expect(p).toContain("2026-07-20");
  });

  it("includes the blocker, next action and open tasks", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("Waiting on their API credentials");
    expect(p).toContain("Chase Sam for the key");
    expect(p).toContain("Wire the auth handshake");
  });

  it("includes repo state and recent commits", () => {
    const p = buildProjectSystemPrompt(base);
    expect(p).toContain("main");
    expect(p).toContain("feat(ingest): batch loader");
  });

  it("says so plainly when no repo is linked", () => {
    const p = buildProjectSystemPrompt({
      ...base,
      project: { ...project, repoPath: null },
      repo: null,
      commits: [],
    });
    expect(p).toMatch(/no (linked )?repo/i);
  });

  it("respects the character budget and marks the truncation", () => {
    const many: Milestone[] = Array.from({ length: 400 }, (_, i) => ({
      ...milestone, id: `m${i}`, name: `Milestone number ${i} with a deliberately long name`,
    }));
    const p = buildProjectSystemPrompt({ ...base, milestones: many });
    expect(p.length).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(p).toContain("[truncated]");
  });

  it("forbids inventing project facts", () => {
    expect(buildProjectSystemPrompt(base)).toMatch(/never invent/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/prompt.test.ts`
Expected: FAIL — cannot find module `./prompt`

- [ ] **Step 3: Implement**

```ts
import type { Milestone, Project, Task } from "@/lib/types";
import type { Commit, RepoStatus } from "@/lib/git/types";

/** Hard ceiling on the rendered system prompt. */
export const PROMPT_BUDGET = 24000;

export interface ProjectPromptInput {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  repo: RepoStatus | null;
  commits: Commit[];
  businessName: string;
  founderName: string;
  today: string; // YYYY-MM-DD
}

const dash = (v: string) => (v.trim() ? v.trim() : "—");

function milestoneLines(milestones: Milestone[]): string {
  if (!milestones.length) return "  (none yet)";
  return [...milestones]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const dates = m.startDate && m.endDate ? `${m.startDate} → ${m.endDate}` : "no dates";
      const deps = m.dependsOn.length ? ` · depends on ${m.dependsOn.length}` : "";
      return `  - [${m.status}] ${m.name} (${dates})${deps} · id=${m.id}`;
    })
    .join("\n");
}

function taskLines(tasks: Task[]): string {
  const open = tasks.filter((t) => t.status !== "done");
  if (!open.length) return "  (no open tasks)";
  return open
    .map((t) => `  - [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""} · id=${t.id}`)
    .join("\n");
}

function repoBlock(project: Project, repo: RepoStatus | null, commits: Commit[]): string {
  if (!project.repoPath) return "REPOSITORY: no repo linked to this project.";
  if (!repo) return `REPOSITORY: linked to ${project.repoPath}, but it could not be read right now.`;

  const dirty = repo.staged + repo.unstaged + repo.untracked;
  const head =
    `REPOSITORY: ${project.repoPath} · branch ${repo.branch || "(detached)"} · ` +
    `${dirty} uncommitted file(s) · ${repo.ahead} ahead / ${repo.behind} behind`;

  if (!commits.length) return `${head}\nRecent commits: (none)`;

  const lines = commits
    .slice(0, 20)
    .map((c) => `  - ${c.authorDate.slice(0, 10)} ${c.shortHash} ${c.subject} (${c.files.length} files)`)
    .join("\n");

  return `${head}\nRecent commits (newest first):\n${lines}`;
}

export function buildProjectSystemPrompt(input: ProjectPromptInput): string {
  const { project: p, businessName, founderName, today } = input;

  const prompt =
    `Today's date is ${today}. Resolve relative dates against it and pass concrete ISO ` +
    `dates (YYYY-MM-DD) to tools.\n\n` +
    `You are the project agent for "${p.name}" — a ${p.type} for ${dash(p.company)}, run by ` +
    `${founderName} at ${businessName}. You know this one project deeply and help ${founderName} ` +
    `plan it, unblock it and keep it honest.\n\n` +
    `PROJECT STATE:\n` +
    `  Stage: ${p.stage} · Priority: ${p.priority}\n` +
    `  Dates: ${p.startDate ?? "—"} → ${p.dueDate ?? "—"}\n` +
    `  Blocker: ${dash(p.currentBlocker)}\n` +
    `  Next action: ${dash(p.nextAction)}\n` +
    `  Deliverables: ${dash(p.deliverables)}\n` +
    `  Notes: ${dash(p.notes)}\n\n` +
    `MILESTONES:\n${milestoneLines(input.milestones)}\n\n` +
    `OPEN TASKS:\n${taskLines(input.tasks)}\n\n` +
    `${repoBlock(p, input.repo, input.commits)}\n\n` +
    `HOW YOU WORK:\n` +
    `- Ground every answer in the state above and in the read tools. Never invent milestones, ` +
    `commits, dates or history. If you don't have a fact, say so.\n` +
    `- Use read_commits and read_repo_status when the founder asks what shipped or where the ` +
    `work stands. Real commits beat recollection.\n` +
    `- When the founder wants to change something, call the matching write tool ` +
    `(create_milestone, update_milestone, create_task, update_task, update_project). Writes do ` +
    `NOT execute immediately — they are queued as proposals ${founderName} must confirm in the ` +
    `UI. After proposing, say briefly what you've queued and that it awaits confirmation; never ` +
    `claim it is already done.\n` +
    `- For update_* tools always pass an id from the state above, and only the fields you intend ` +
    `to change.\n` +
    `- Be direct, concrete and concise. Confident and brief beats verbose.`;

  return prompt.length > PROMPT_BUDGET
    ? `${prompt.slice(0, PROMPT_BUDGET - 13)}\n[truncated]`
    : prompt;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/prompt.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/prompt.ts src/lib/projects/prompt.test.ts
git commit -m "feat(projects): project agent system prompt"
```

---

### Task 24: buildMilestone and the milestone write actions

**Files:**
- Modify: `src/lib/advisor/applyAction.ts`
- Test: `src/lib/advisor/applyAction.test.ts`

**Interfaces:**
- Consumes: `Milestone` (Task 1)
- Produces: `buildMilestone(a): New<Milestone>`, `buildMilestonePatch(a)`; `applyAction` handles `create_milestone`, `update_milestone`, `update_project`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/advisor/applyAction.test.ts`:

```ts
import { buildMilestone, applyAction } from "./applyAction";

describe("buildMilestone", () => {
  it("fills sensible defaults", () => {
    expect(buildMilestone({ projectId: "p1", name: "Discovery" })).toEqual({
      projectId: "p1", name: "Discovery", startDate: null, endDate: null,
      status: "planned", order: 0, dependsOn: [], commitScope: "", notes: "",
    });
  });

  it("coerces the fields it is given", () => {
    expect(buildMilestone({
      projectId: "p1", name: "Build", startDate: "2026-07-01", endDate: "2026-07-20",
      status: "in progress", order: 2, dependsOn: ["m0"], commitScope: "build", notes: "n",
    })).toMatchObject({
      startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
      order: 2, dependsOn: ["m0"], commitScope: "build",
    });
  });

  it("turns an empty date string into null", () => {
    expect(buildMilestone({ projectId: "p1", name: "X", startDate: "" }).startDate).toBeNull();
  });

  it("ignores a non-array dependsOn", () => {
    expect(buildMilestone({ projectId: "p1", name: "X", dependsOn: "m0" }).dependsOn).toEqual([]);
  });
});

describe("applyAction — milestones", () => {
  function fakeStore() {
    const calls: { op: string; key: string; id?: string; value?: unknown }[] = [];
    return {
      calls,
      create: (key: string, value: unknown) => { calls.push({ op: "create", key, value }); return { id: "new1" }; },
      update: (key: string, id: string, value: unknown) => { calls.push({ op: "update", key, id, value }); },
    };
  }

  it("creates a milestone but deep-links to its project", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a1", tool: "create_milestone", description: "", status: "confirmed",
      args: { projectId: "p1", name: "Discovery" },
    });
    expect(store.calls[0]).toMatchObject({ op: "create", key: "milestones" });
    // Milestones have no page — link to the project so ?focus= resolves.
    expect(result).toEqual({ kind: "projects", id: "p1" });
  });

  it("updates a milestone and deep-links to its project", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a2", tool: "update_milestone", description: "", status: "confirmed",
      args: { id: "m1", projectId: "p1", status: "done" },
    });
    expect(store.calls[0]).toMatchObject({ op: "update", key: "milestones", id: "m1" });
    expect(result).toEqual({ kind: "projects", id: "p1" });
  });

  it("returns null for a milestone update with no id", () => {
    expect(applyAction(fakeStore(), {
      id: "a3", tool: "update_milestone", description: "", status: "confirmed",
      args: { projectId: "p1" },
    })).toBeNull();
  });

  it("updates a project", () => {
    const store = fakeStore();
    const result = applyAction(store, {
      id: "a4", tool: "update_project", description: "", status: "confirmed",
      args: { id: "p1", currentBlocker: "Waiting on creds" },
    });
    expect(store.calls[0]).toMatchObject({ op: "update", key: "projects", id: "p1" });
    expect(result).toEqual({ kind: "projects", id: "p1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/advisor/applyAction.test.ts`
Expected: FAIL — `buildMilestone is not a function`

- [ ] **Step 3: Implement**

Add `Milestone`, `MilestoneStatus` to the type import in `applyAction.ts`, then:

```ts
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)) : [];

export function buildMilestone(a: Args): New<Milestone> {
  return {
    projectId: str(a.projectId),
    name: str(a.name),
    startDate: orNull(a.startDate),
    endDate: orNull(a.endDate),
    status: (a.status as MilestoneStatus) ?? "planned",
    order: Number(a.order) || 0,
    dependsOn: strArray(a.dependsOn),
    commitScope: str(a.commitScope),
    notes: str(a.notes),
  };
}

/** Only the keys actually present, so an update never blanks a field by omission. */
export function buildMilestonePatch(a: Args): Partial<Milestone> {
  const p: Partial<Milestone> = {};
  if (a.name !== undefined) p.name = str(a.name);
  if (a.startDate !== undefined) p.startDate = orNull(a.startDate);
  if (a.endDate !== undefined) p.endDate = orNull(a.endDate);
  if (a.status !== undefined) p.status = a.status as MilestoneStatus;
  if (a.order !== undefined) p.order = Number(a.order) || 0;
  if (a.dependsOn !== undefined) p.dependsOn = strArray(a.dependsOn);
  if (a.commitScope !== undefined) p.commitScope = str(a.commitScope);
  if (a.notes !== undefined) p.notes = str(a.notes);
  return p;
}

export function buildProjectPatch(a: Args): Partial<Project> {
  const p: Partial<Project> = {};
  if (a.name !== undefined) p.name = str(a.name);
  if (a.stage !== undefined) p.stage = a.stage as ProjectStage;
  if (a.priority !== undefined) p.priority = a.priority as Priority;
  if (a.startDate !== undefined) p.startDate = orNull(a.startDate);
  if (a.dueDate !== undefined) p.dueDate = orNull(a.dueDate);
  if (a.currentBlocker !== undefined) p.currentBlocker = str(a.currentBlocker);
  if (a.nextAction !== undefined) p.nextAction = str(a.nextAction);
  if (a.deliverables !== undefined) p.deliverables = str(a.deliverables);
  if (a.notes !== undefined) p.notes = str(a.notes);
  return p;
}
```

Add three cases to `applyAction`'s switch, before `default`:

```ts
    // Milestones have no page of their own, so every milestone write deep-links
    // to its project. /projects?focus=<projectId> redirects to /projects/<id>.
    case "create_milestone": {
      const projectId = str(a.projectId);
      if (!projectId) return null;
      store.create("milestones", buildMilestone(a));
      return { kind: "projects", id: projectId };
    }
    case "update_milestone": {
      const id = str(a.id);
      const projectId = str(a.projectId);
      if (!id || !projectId) return null;
      store.update("milestones", id, buildMilestonePatch(a));
      return { kind: "projects", id: projectId };
    }
    case "update_project": {
      const id = str(a.id);
      if (!id) return null;
      store.update("projects", id, buildProjectPatch(a));
      return { kind: "projects", id };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/advisor/applyAction.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/advisor/applyAction.ts src/lib/advisor/applyAction.test.ts
git commit -m "feat(projects): milestone and project write actions"
```

---

### Task 25: Project tool definitions and snapshot resolvers

**Files:**
- Create: `src/lib/projects/tools.ts`
- Test: `src/lib/projects/tools.test.ts`

**Interfaces:**
- Consumes: `ToolDef` shape from `src/lib/advisor/tools.ts`; `ProposedAction`
- Produces: `PROJECT_TOOLS`, `SERVER_TOOL_NAMES`, `ProjectSnapshot`, `resolveProjectTool(name, args, snapshot, proposals): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/projects/tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PROJECT_TOOLS, SERVER_TOOL_NAMES, resolveProjectTool, type ProjectSnapshot } from "./tools";
import type { ProposedAction } from "@/lib/types";

const snapshot: ProjectSnapshot = {
  project: {
    id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
    type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
    dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "", nextAction: "",
    deliverables: "", notes: "", repoPath: null,
  },
  milestones: [{
    id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest",
    startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
    order: 0, dependsOn: [], commitScope: "", notes: "",
  }],
  tasks: [{
    id: "t1", createdAt: "", updatedAt: "", title: "Auth handshake", linkKind: "project",
    linkId: "p1", milestoneId: "m1", category: "delivery", priority: "high",
    status: "in progress", dueDate: null, notes: "",
  }],
};

describe("PROJECT_TOOLS", () => {
  it("declares every read and write tool the prompt promises", () => {
    const names = PROJECT_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "list_milestones", "list_tasks", "read_repo_status", "read_commits",
      "create_milestone", "update_milestone", "create_task", "update_task", "update_project",
    ]));
  });

  it("marks only the git tools as server-resolved", () => {
    expect([...SERVER_TOOL_NAMES].sort()).toEqual(["read_commits", "read_repo_status"]);
  });

  it("requires a name on create_milestone and an id on update_milestone", () => {
    const create = PROJECT_TOOLS.find((t) => t.name === "create_milestone")!;
    const update = PROJECT_TOOLS.find((t) => t.name === "update_milestone")!;
    expect(create.input_schema.required).toContain("name");
    expect(update.input_schema.required).toContain("id");
  });
});

describe("resolveProjectTool — reads", () => {
  it("lists milestones with their ids", () => {
    const out = resolveProjectTool("list_milestones", {}, snapshot, []);
    expect(out).toContain("Ingest");
    expect(out).toContain("m1");
  });

  it("lists tasks and can filter to open ones", () => {
    expect(resolveProjectTool("list_tasks", {}, snapshot, [])).toContain("Auth handshake");
    expect(resolveProjectTool("list_tasks", { status: "done" }, snapshot, [])).not.toContain("Auth handshake");
  });
});

describe("resolveProjectTool — writes queue proposals", () => {
  it("queues a milestone proposal rather than writing", () => {
    const proposals: ProposedAction[] = [];
    const out = resolveProjectTool(
      "create_milestone", { name: "Handover", endDate: "2026-08-10" }, snapshot, proposals,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ tool: "create_milestone", status: "pending" });
    expect(out).toMatch(/confirm/i);
  });

  it("injects the project id so the agent cannot target another project", () => {
    const proposals: ProposedAction[] = [];
    resolveProjectTool("create_milestone", { name: "X", projectId: "SOMEWHERE_ELSE" }, snapshot, proposals);
    expect(proposals[0].args.projectId).toBe("p1");
  });

  it("rejects a dependency that would create a cycle", () => {
    const proposals: ProposedAction[] = [];
    const out = resolveProjectTool(
      "update_milestone", { id: "m1", dependsOn: ["m1"] }, snapshot, proposals,
    );
    expect(proposals).toHaveLength(0);
    expect(out).toMatch(/loop|cycle/i);
  });

  it("refuses an unknown tool by name", () => {
    expect(resolveProjectTool("delete_everything", {}, snapshot, [])).toMatch(/unknown tool/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/tools.test.ts`
Expected: FAIL — cannot find module `./tools`

- [ ] **Step 3: Implement**

```ts
import type { Milestone, Project, ProposedAction, Task } from "@/lib/types";
import type { ToolDef } from "@/lib/advisor/tools";
import { MILESTONE_STATUSES, TASK_STATUSES } from "@/lib/types";
import { detectCycles } from "./schedule";
import { uid } from "@/lib/utils";

export interface ProjectSnapshot {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
}

type Args = Record<string, unknown>;

const obj = (properties: Record<string, unknown>, required?: string[]): ToolDef["input_schema"] =>
  ({ type: "object", properties, ...(required ? { required } : {}) });
const s = (description = "") => ({ type: "string", description });
const n = (description = "") => ({ type: "number", description });
const enumStr = (values: readonly string[], description = "") =>
  ({ type: "string", enum: [...values], description });
const dateStr = (description = "") =>
  ({ type: "string", description: `ISO date (YYYY-MM-DD). ${description}`.trim() });
const strArr = (description = "") =>
  ({ type: "array", items: { type: "string" }, description });

/** Resolved server-side by the route (they touch the filesystem), not here. */
export const SERVER_TOOL_NAMES = new Set(["read_repo_status", "read_commits"]);

export const PROJECT_TOOLS: ToolDef[] = [
  // ---- read ----
  { name: "list_milestones", description: "This project's milestones with ids, dates, status and dependencies.",
    input_schema: obj({}) },
  { name: "list_tasks", description: "This project's tasks with ids. Omit status to get every task.",
    input_schema: obj({ status: enumStr(TASK_STATUSES), milestoneId: s() }) },
  { name: "read_repo_status", description: "Current branch, uncommitted file counts, ahead/behind. Only if a repo is linked.",
    input_schema: obj({}) },
  { name: "read_commits", description: "Recent commits from the linked repo, newest first.",
    input_schema: obj({ limit: n("default 30"), since: s("e.g. '2 weeks ago'") }) },

  // ---- write (proposed, need confirmation) ----
  { name: "create_milestone", description: "Propose a new milestone on this project.",
    input_schema: obj({
      name: s(), startDate: dateStr(), endDate: dateStr(),
      status: enumStr(MILESTONE_STATUSES), order: n("lower sorts first"),
      dependsOn: strArr("milestone ids from list_milestones"),
      commitScope: s("conventional-commit scope, e.g. 'ingest'"), notes: s(),
    }, ["name"]) },
  { name: "update_milestone", description: "Propose changes to a milestone. Use an id from list_milestones. Pass only the fields you are changing.",
    input_schema: obj({
      id: s(), name: s(), startDate: dateStr(), endDate: dateStr(),
      status: enumStr(MILESTONE_STATUSES), order: n(),
      dependsOn: strArr(), commitScope: s(), notes: s(),
    }, ["id"]) },
  { name: "create_task", description: "Propose a task on this project, optionally under a milestone.",
    input_schema: obj({
      title: s(), milestoneId: s("id from list_milestones"), category: s(),
      priority: enumStr(["low", "medium", "high"]), dueDate: dateStr(), notes: s(),
    }, ["title"]) },
  { name: "update_task", description: "Propose changes to a task. Use an id from list_tasks.",
    input_schema: obj({
      id: s(), title: s(), status: enumStr(TASK_STATUSES),
      priority: enumStr(["low", "medium", "high"]), dueDate: dateStr(),
      milestoneId: s(), notes: s(),
    }, ["id"]) },
  { name: "update_project", description: "Propose changes to the project itself — stage, blocker, next action, dates.",
    input_schema: obj({
      stage: s(), priority: enumStr(["low", "medium", "high"]),
      startDate: dateStr(), dueDate: dateStr(), currentBlocker: s(),
      nextAction: s(), deliverables: s(), notes: s(),
    }) },
];

const compactMilestone = (m: Milestone) => ({
  id: m.id, name: m.name, status: m.status, start: m.startDate, end: m.endDate,
  order: m.order, dependsOn: m.dependsOn, commitScope: m.commitScope,
});
const compactTask = (t: Task) => ({
  id: t.id, title: t.title, status: t.status, priority: t.priority,
  dueDate: t.dueDate, milestoneId: t.milestoneId,
});

function queue(
  proposals: ProposedAction[],
  tool: string,
  description: string,
  args: Args,
): string {
  proposals.push({ id: uid("act"), tool, description, args, status: "pending" });
  return `Queued "${description}". It is awaiting the founder's confirmation in the UI — it has NOT been applied.`;
}

/**
 * Resolves the snapshot-backed tools. Git tools are handled by the route.
 *
 * Every write injects the snapshot's own projectId, so the agent can only ever
 * propose changes to the project whose thread it is in.
 */
export function resolveProjectTool(
  name: string,
  args: Args,
  snap: ProjectSnapshot,
  proposals: ProposedAction[],
): string {
  const projectId = snap.project.id;

  switch (name) {
    case "list_milestones":
      return JSON.stringify(
        [...snap.milestones].sort((a, b) => a.order - b.order).map(compactMilestone),
      );

    case "list_tasks": {
      let out = snap.tasks;
      if (args.status) out = out.filter((t) => t.status === args.status);
      if (args.milestoneId) out = out.filter((t) => t.milestoneId === args.milestoneId);
      return JSON.stringify(out.map(compactTask));
    }

    case "create_milestone":
      return queue(proposals, name, `Add milestone "${String(args.name ?? "")}"`, {
        ...args, projectId,
      });

    case "update_milestone": {
      const id = String(args.id ?? "");
      const target = snap.milestones.find((m) => m.id === id);
      if (!target) return `No milestone with id ${id} on this project.`;

      // Validate the graph as it WOULD be, so a confirm can never close a loop.
      if (Array.isArray(args.dependsOn)) {
        const next = snap.milestones.map((m) =>
          m.id === id ? { ...m, dependsOn: args.dependsOn as string[] } : m,
        );
        if (detectCycles(next).length > 0) {
          return "Rejected: that dependency would create a loop. Pick a different one.";
        }
      }

      return queue(proposals, name, `Update milestone "${target.name}"`, { ...args, projectId });
    }

    case "create_task":
      return queue(proposals, name, `Add task "${String(args.title ?? "")}"`, {
        ...args, linkKind: "project", linkId: projectId,
      });

    case "update_task": {
      const id = String(args.id ?? "");
      const target = snap.tasks.find((t) => t.id === id);
      if (!target) return `No task with id ${id} on this project.`;
      return queue(proposals, name, `Update task "${target.title}"`, args);
    }

    case "update_project":
      return queue(proposals, name, `Update project "${snap.project.name}"`, {
        ...args, id: projectId,
      });

    default:
      return `Unknown tool: ${name}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/tools.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/tools.ts src/lib/projects/tools.test.ts
git commit -m "feat(projects): project agent tools with confirm-gated writes"
```

---

### Task 26: Chat route and client gateway

**Files:**
- Create: `src/app/api/projects/chat/route.ts`
- Create: `src/lib/projects/projectClient.ts`

**Interfaces:**
- Consumes: `buildProjectSystemPrompt` (Task 23), `PROJECT_TOOLS`, `SERVER_TOOL_NAMES`, `resolveProjectTool` (Task 25), `readStatus`/`readCommits` (Task 17)
- Produces: `POST /api/projects/chat` → `{ content, actions }`; `sendProjectMessage(req)`

- [ ] **Step 1: Implement the route**

Mirrors `src/app/api/advisor/route.ts` — same iteration cap, same async/sync tool split.

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ProposedAction } from "@/lib/types";
import { buildProjectSystemPrompt } from "@/lib/projects/prompt";
import { PROJECT_TOOLS, SERVER_TOOL_NAMES, resolveProjectTool, type ProjectSnapshot } from "@/lib/projects/tools";
import { readCommits, readStatus } from "@/lib/git/repo";
import type { Commit, RepoStatus } from "@/lib/git/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 8;

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface ChatRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: ProjectSnapshot;
  context?: { businessName?: string; founderName?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const snapshot = body.snapshot;
  if (!snapshot?.project) return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });
  if (!body.messages?.length) return NextResponse.json({ error: "missing_messages" }, { status: 400 });

  // Repo reads are best-effort — a missing repo must never fail the request.
  const repoPath = snapshot.project.repoPath;
  let repo: RepoStatus | null = null;
  let commits: Commit[] = [];
  if (repoPath) {
    [repo, commits] = await Promise.all([
      readStatus(repoPath).catch(() => null),
      readCommits(repoPath, { limit: 30 }).catch(() => [] as Commit[]),
    ]);
  }

  const system = buildProjectSystemPrompt({
    project: snapshot.project,
    milestones: snapshot.milestones ?? [],
    tasks: snapshot.tasks ?? [],
    repo,
    commits,
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    today: new Date().toISOString().slice(0, 10),
  });

  const client = new Anthropic({ apiKey });
  const proposals: ProposedAction[] = [];
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role, content: m.content,
  }));

  /** Git tools read the filesystem, so they resolve here rather than in tools.ts. */
  async function resolveServerTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!repoPath) return "No repo is linked to this project.";
    try {
      if (name === "read_repo_status") return JSON.stringify(await readStatus(repoPath));
      const limit = Number(args.limit) || 30;
      const since = args.since ? String(args.since) : undefined;
      return JSON.stringify(await readCommits(repoPath, { limit, since }));
    } catch {
      return `The repo at ${repoPath} could not be read right now.`;
    }
  }

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system,
        tools: PROJECT_TOOLS as unknown as Anthropic.Tool[],
        messages,
      });

      const textParts = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text);
      if (textParts.length) finalText = textParts.join("\n").trim();

      const toolUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          const content = SERVER_TOOL_NAMES.has(tu.name)
            ? await resolveServerTool(tu.name, input)
            : resolveProjectTool(tu.name, input, snapshot, proposals);
          return { type: "tool_result" as const, tool_use_id: tu.id, content };
        }),
      );
      messages.push({ role: "user", content: results });
    }

    if (!finalText) {
      finalText = proposals.length
        ? "I've queued the action(s) below for your confirmation."
        : "I couldn't produce a response — try rephrasing.";
    }

    return NextResponse.json({ content: finalText, actions: proposals });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Implement the client gateway**

Create `src/lib/projects/projectClient.ts`, following `src/lib/brainClient.ts`:

```ts
import type { ProposedAction } from "@/lib/types";
import type { ProjectSnapshot } from "./tools";

export interface ProjectChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: ProjectSnapshot;
  context: { businessName: string; founderName: string };
}

export interface ProjectChatReply {
  content: string;
  actions: ProposedAction[];
}

export async function sendProjectMessage(req: ProjectChatRequest): Promise<ProjectChatReply> {
  const res = await fetch("/api/projects/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "request_failed");
  return { content: json.content ?? "", actions: json.actions ?? [] };
}

export async function projectChatConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/projects/chat");
    return !!(await res.json()).configured;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run dev`. With `ANTHROPIC_API_KEY` set, POST from the browser console on an authed page:

```js
await (await fetch("/api/projects/chat", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: [{ role: "user", content: "What are the milestones and what's next?" }],
    snapshot: { project: { id: "p1", name: "Test", company: "", type: "demo", stage: "idea",
      priority: "medium", startDate: null, dueDate: null, currentMilestone: "",
      currentBlocker: "", nextAction: "", deliverables: "", notes: "", repoPath: null,
      createdAt: "", updatedAt: "" }, milestones: [], tasks: [] },
    context: { businessName: "Pallisade Data", founderName: "Emil" },
  }),
})).json()
```

Expected: `{ content: "…", actions: [] }`. Unset the key and confirm a 503 `no_key`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/projects/chat/route.ts src/lib/projects/projectClient.ts
git commit -m "feat(projects): project chat route and client gateway"
```

---

### Task 27: ProjectChat UI and the Chat tab

**Files:**
- Create: `src/components/projects/ProjectChat.tsx`
- Modify: `src/app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `sendProjectMessage`, `projectChatConfigured` (Task 26); `applyAction` (Task 24); `advisor/MessageBubble`, `advisor/ActionCard`
- Produces: `<ProjectChat project milestones tasks />`

- [ ] **Step 1: Read the components being reused**

Read `src/app/advisor/page.tsx`, `src/components/advisor/MessageBubble.tsx` and `src/components/advisor/ActionCard.tsx` first. Match their props exactly — thread persistence, action confirm/dismiss and message rendering all already exist there and must not be reimplemented.

- [ ] **Step 2: Implement**

Persist to the `projectThreads` collection: one thread per conversation, `title` derived from the first user message (mirroring `BrainThread`). Keep the newest thread for the project open by default.

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import type { Milestone, Project, ProjectThread, ProposedAction, Task } from "@/lib/types";
import { useStore } from "@/lib/store";
import { projectChatConfigured, sendProjectMessage } from "@/lib/projects/projectClient";
import { applyAction } from "@/lib/advisor/applyAction";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { ActionCard } from "@/components/advisor/ActionCard";
import { nowISO, uid } from "@/lib/utils";

export function ProjectChat({
  project,
  milestones,
  tasks,
}: {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
}) {
  const store = useStore();
  const { projectThreads, settings, create, update } = store;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  // Same "not configured" posture as the other agents.
  useEffect(() => {
    let cancelled = false;
    void projectChatConfigured().then((ok) => { if (!cancelled) setConfigured(ok); });
    return () => { cancelled = true; };
  }, []);

  const thread: ProjectThread | null = useMemo(() => {
    const mine = projectThreads
      .filter((t) => t.projectId === project.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return (threadId ? mine.find((t) => t.id === threadId) : mine[0]) ?? null;
  }, [projectThreads, project.id, threadId]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setError(null);
    setBusy(true);

    const userMsg = { id: uid("msg"), role: "user" as const, content: text, createdAt: nowISO() };
    const history = [...(thread?.messages ?? []), userMsg];

    // Create the thread on the first message so the transcript survives a reload.
    let id = thread?.id ?? null;
    if (id) {
      update("projectThreads", id, { messages: history });
    } else {
      const created = create("projectThreads", {
        projectId: project.id,
        title: text.slice(0, 60),
        messages: history,
      });
      id = created.id;
      setThreadId(id);
    }

    try {
      const reply = await sendProjectMessage({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        snapshot: { project, milestones, tasks },
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
        },
      });
      update("projectThreads", id, {
        messages: [
          ...history,
          {
            id: uid("msg"), role: "assistant" as const, content: reply.content,
            actions: reply.actions, createdAt: nowISO(),
          },
        ],
      });
    } catch (err) {
      setError(
        (err as Error).message === "no_key"
          ? "No ANTHROPIC_API_KEY set — add one to .env.local and restart."
          : "That didn't go through. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resolve = (msgId: string, action: ProposedAction, confirmed: boolean) => {
    if (!thread) return;
    const result = confirmed ? applyAction(store, action) : null;
    update("projectThreads", thread.id, {
      messages: thread.messages.map((m) =>
        m.id !== msgId
          ? m
          : {
              ...m,
              actions: m.actions?.map((a) =>
                a.id !== action.id
                  ? a
                  : { ...a, status: confirmed ? "confirmed" : "dismissed", result: result ?? undefined },
              ),
            },
      ),
    });
  };

  if (configured === false)
    return (
      <p className="text-[0.8rem] text-[var(--color-muted)]">
        No <code>ANTHROPIC_API_KEY</code> set. Add one to <code>.env.local</code> and restart to
        use project chat.
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-3 min-h-[12rem]">
        {!thread?.messages.length && (
          <p className="text-[0.8rem] text-[var(--color-muted)]">
            Ask about this project — milestones, what shipped, what&apos;s blocking, what to do next.
          </p>
        )}
        {thread?.messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <MessageBubble message={m} />
            {m.actions?.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                onConfirm={() => resolve(m.id, a, true)}
                onDismiss={() => resolve(m.id, a, false)}
              />
            ))}
          </div>
        ))}
        {busy && <p className="text-[0.78rem] text-[var(--color-dim)]">Thinking…</p>}
        {error && <p className="text-[0.78rem] text-[var(--color-accent-soft)]">{error}</p>}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask about this project…"
          disabled={busy}
        />
        <button className="btn btn-accent" onClick={() => void send()} disabled={busy || !input.trim()}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
```

If `MessageBubble` / `ActionCard` take different prop names, match the advisor page rather than changing those components — they are shared.

- [ ] **Step 3: Add the Chat tab**

Extend `TABS` to `["Overview", "Milestones", "Tasks", "Repo", "Chat"] as const` and add:

```tsx
{tab === "Chat" && (
  <Panel title="Project chat">
    <ProjectChat project={project} milestones={projectMilestones} tasks={projectTasks} />
  </Panel>
)}
```

- [ ] **Step 4: Verify**

Run: `npm run dev` → a project → Chat.
Expected: asking "what are my milestones?" returns real ones. Asking "add a handover milestone for mid August" queues a confirm card; confirming creates the milestone and it appears on the Timeline; dismissing changes nothing. Reload the page — the transcript is still there.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects/ProjectChat.tsx "src/app/projects/[id]/page.tsx"
git commit -m "feat(projects): per-project context chat with confirm-gated writes"
```

---

### Task 28: get_project_context — the cross-agent module

**Files:**
- Create: `src/lib/projects/projectContext.ts`
- Test: `src/lib/projects/projectContext.test.ts`

**Interfaces:**
- Consumes: `loadAll` from `src/lib/db/sqlite.ts`; `readStatus`/`readCommits` (Task 17)
- Produces: `CONTEXT_BUDGET`, `formatProjectContext(input): string` (pure), `resolveProjectContext(args): Promise<string>` (server-only), `PROJECT_CONTEXT_TOOLS`, `PROJECT_CONTEXT_TOOL_NAMES`

The formatter is pure and tested; the resolver does the DB and git reads and is verified by hand.

- [ ] **Step 1: Write the failing test**

Create `src/lib/projects/projectContext.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatProjectContext, CONTEXT_BUDGET } from "./projectContext";
import type { Milestone, Project, ProjectThread, Task } from "@/lib/types";

const project: Project = {
  id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
  type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
  dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "Waiting on API creds",
  nextAction: "Chase Sam", deliverables: "Dashboard + handover", notes: "", repoPath: null,
};

const milestone: Milestone = {
  id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest pipeline",
  startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
  order: 0, dependsOn: [], commitScope: "", notes: "",
};

const task: Task = {
  id: "t1", createdAt: "", updatedAt: "", title: "Auth handshake", linkKind: "project",
  linkId: "p1", milestoneId: "m1", category: "delivery", priority: "high",
  status: "in progress", dueDate: null, notes: "",
};

const thread: ProjectThread = {
  id: "th1", createdAt: "", updatedAt: "2026-07-28T10:00:00Z", projectId: "p1",
  title: "Scope call", messages: [
    { id: "1", role: "user", content: "Should we build the export in v1?", createdAt: "" },
    { id: "2", role: "assistant", content: "No — defer export to v2, it's a two-way door.", createdAt: "" },
  ],
};

const base = { project, milestones: [milestone], tasks: [task], threads: [thread], repo: null, commits: [] };

describe("formatProjectContext", () => {
  it("includes project state, milestones and open tasks", () => {
    const out = formatProjectContext(base);
    expect(out).toContain("Acme Dashboard");
    expect(out).toContain("Waiting on API creds");
    expect(out).toContain("Ingest pipeline");
    expect(out).toContain("Auth handshake");
  });

  it("surfaces recent decisions from the newest thread", () => {
    const out = formatProjectContext(base);
    expect(out).toContain("defer export to v2");
  });

  it("uses only the most recent thread", () => {
    const older: ProjectThread = {
      ...thread, id: "th0", updatedAt: "2026-01-01T00:00:00Z",
      messages: [{ id: "x", role: "assistant", content: "ANCIENT DECISION", createdAt: "" }],
    };
    expect(formatProjectContext({ ...base, threads: [older, thread] })).not.toContain("ANCIENT DECISION");
  });

  it("keeps only the last 15 messages", () => {
    const long: ProjectThread = {
      ...thread,
      messages: Array.from({ length: 40 }, (_, i) => ({
        id: `m${i}`, role: "user" as const, content: `MESSAGE_${i}`, createdAt: "",
      })),
    };
    const out = formatProjectContext({ ...base, threads: [long] });
    expect(out).not.toContain("MESSAGE_0");
    expect(out).toContain("MESSAGE_39");
  });

  it("says so plainly when there are no threads", () => {
    expect(formatProjectContext({ ...base, threads: [] })).toMatch(/no .*(chat|decision|thread)/i);
  });

  it("reports repo state and commits when present", () => {
    const out = formatProjectContext({
      ...base,
      repo: { branch: "main", ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 0 },
      commits: [{
        hash: "abc", shortHash: "abc", subject: "feat(ingest): loader", body: "",
        authorDate: "2026-07-28T10:00:00+02:00", files: [],
      }],
    });
    expect(out).toContain("main");
    expect(out).toContain("feat(ingest): loader");
  });

  it("respects the character budget", () => {
    const many = Array.from({ length: 900 }, (_, i) => ({
      ...milestone, id: `m${i}`, name: `A deliberately long milestone name number ${i}`,
    }));
    const out = formatProjectContext({ ...base, milestones: many });
    expect(out.length).toBeLessThanOrEqual(CONTEXT_BUDGET);
    expect(out).toContain("[truncated]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/projectContext.test.ts`
Expected: FAIL — cannot find module `./projectContext`

- [ ] **Step 3: Implement**

```ts
import type { Milestone, Project, ProjectThread, Task } from "@/lib/types";
import type { Commit, RepoStatus } from "@/lib/git/types";
import type { ToolDef } from "@/lib/advisor/tools";

/** Ceiling on a single get_project_context tool result. */
export const CONTEXT_BUDGET = 8000;
const MAX_THREAD_MESSAGES = 15;
const MAX_COMMITS = 10;

export interface ProjectContextInput {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  threads: ProjectThread[];
  repo: RepoStatus | null;
  commits: Commit[];
}

const dash = (v: string) => (v.trim() ? v.trim() : "—");

export function formatProjectContext(input: ProjectContextInput): string {
  const { project: p } = input;

  const milestones = input.milestones.length
    ? [...input.milestones]
        .sort((a, b) => a.order - b.order)
        .map((m) => {
          const dates = m.startDate && m.endDate ? `${m.startDate} → ${m.endDate}` : "no dates";
          return `  - [${m.status}] ${m.name} (${dates})`;
        })
        .join("\n")
    : "  (none)";

  const open = input.tasks.filter((t) => t.status !== "done");
  const tasks = open.length
    ? open.map((t) => `  - [${t.status}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`).join("\n")
    : "  (none open)";

  let repo: string;
  if (!p.repoPath) {
    repo = "REPO: none linked.";
  } else if (!input.repo) {
    repo = `REPO: ${p.repoPath} (could not be read).`;
  } else {
    const dirty = input.repo.staged + input.repo.unstaged + input.repo.untracked;
    const commits = input.commits.length
      ? "\n" + input.commits.slice(0, MAX_COMMITS)
          .map((c) => `  - ${c.authorDate.slice(0, 10)} ${c.shortHash} ${c.subject}`)
          .join("\n")
      : "\n  (no commits)";
    repo = `REPO: ${p.repoPath} · branch ${input.repo.branch || "(detached)"} · ${dirty} uncommitted${commits}`;
  }

  // Only the most recent thread — older threads are superseded context, not history.
  const newest = [...input.threads]
    .filter((t) => t.projectId === p.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const decisions = newest
    ? newest.messages
        .slice(-MAX_THREAD_MESSAGES)
        .map((m) => `  ${m.role === "user" ? "Founder" : "Agent"}: ${m.content}`)
        .join("\n")
    : "  (no project chat yet — nothing has been decided in a thread)";

  const out =
    `PROJECT: ${p.name}${p.company ? ` · ${p.company}` : ""}\n` +
    `  Type: ${p.type} · Stage: ${p.stage} · Priority: ${p.priority}\n` +
    `  Dates: ${p.startDate ?? "—"} → ${p.dueDate ?? "—"}\n` +
    `  Blocker: ${dash(p.currentBlocker)}\n` +
    `  Next action: ${dash(p.nextAction)}\n` +
    `  Deliverables: ${dash(p.deliverables)}\n\n` +
    `MILESTONES:\n${milestones}\n\n` +
    `OPEN TASKS:\n${tasks}\n\n` +
    `${repo}\n\n` +
    `RECENT DECISIONS (latest project chat):\n${decisions}`;

  return out.length > CONTEXT_BUDGET ? `${out.slice(0, CONTEXT_BUDGET - 13)}\n[truncated]` : out;
}

export const PROJECT_CONTEXT_TOOLS: ToolDef[] = [
  {
    name: "list_projects",
    description: "Every project with its id, stage and next action. Use this to resolve a project name to an id.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_project_context",
    description:
      "Deep context on one project: state, milestones, open tasks, linked repo and recent commits, " +
      "plus what was decided in its most recent project chat. Pass either projectId or name.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "id from list_projects" },
        name: { type: "string", description: "project name, matched case-insensitively" },
      },
    },
  },
];

export const PROJECT_CONTEXT_TOOL_NAMES = new Set(PROJECT_CONTEXT_TOOLS.map((t) => t.name));
```

- [ ] **Step 4: Add the server resolver**

Append to the same file. It reads the database directly — this is why `projectThreads` never has to be posted from the browser.

```ts
/* ---- server-only resolver (reads the DB and the filesystem) ---- */

export async function resolveProjectContextTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { loadAll } = await import("@/lib/db/sqlite");
  const { readCommits, readStatus } = await import("@/lib/git/repo");
  const data = await loadAll();

  if (name === "list_projects") {
    return JSON.stringify(
      data.projects.map((p) => ({
        id: p.id, name: p.name, company: p.company, stage: p.stage,
        priority: p.priority, dueDate: p.dueDate, nextAction: p.nextAction,
      })),
    );
  }

  const wanted = String(args.name ?? "").toLowerCase();
  const project =
    data.projects.find((p) => p.id === args.projectId) ??
    (wanted ? data.projects.find((p) => p.name.toLowerCase().includes(wanted)) : undefined);

  if (!project) return "No matching project. Call list_projects to see what exists.";

  let repo: RepoStatus | null = null;
  let commits: Commit[] = [];
  if (project.repoPath) {
    [repo, commits] = await Promise.all([
      readStatus(project.repoPath).catch(() => null),
      readCommits(project.repoPath, { limit: MAX_COMMITS }).catch(() => [] as Commit[]),
    ]);
  }

  return formatProjectContext({
    project,
    milestones: data.milestones.filter((m) => m.projectId === project.id),
    tasks: data.tasks.filter((t) => t.linkKind === "project" && t.linkId === project.id),
    threads: data.projectThreads,
    repo,
    commits,
  });
}
```

The dynamic `import()` keeps `node:child_process` and `@libsql/client` out of any client bundle that imports the pure formatter.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/projectContext.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/projects/projectContext.ts src/lib/projects/projectContext.test.ts
git commit -m "feat(projects): shared project context readable by other agents"
```

---

### Task 29: Wire get_project_context into the Sales Advisor

**Files:**
- Modify: `src/app/api/advisor/route.ts`

**Interfaces:**
- Consumes: `PROJECT_CONTEXT_TOOLS`, `PROJECT_CONTEXT_TOOL_NAMES`, `resolveProjectContextTool` (Task 28)
- Produces: the Advisor can read any project's milestones, repo and decisions

- [ ] **Step 1: Add the tools**

In `src/app/api/advisor/route.ts`, extend the tool list:

```ts
const tools = [
  ...TOOLS,
  ...PROJECT_CONTEXT_TOOLS,
  ...(emailEnabled ? EMAIL_TOOLS : []),
  ...(calendarEnabled ? CALENDAR_TOOLS : []),
];
```

- [ ] **Step 2: Route them to the async resolver**

These read the database and filesystem, so they join the async family alongside the email and calendar tools (`route.ts:130`):

```ts
const content = EMAIL_TOOL_NAMES.has(tu.name)
  ? await resolveEmailTool(tu.name, input)
  : CALENDAR_READ_TOOL_NAMES.has(tu.name)
  ? await resolveCalendarTool(tu.name, input)
  : PROJECT_CONTEXT_TOOL_NAMES.has(tu.name)
  ? await resolveProjectContextTool(tu.name, input)
  : resolveTool(tu.name, input, snapshot, proposals);
```

- [ ] **Step 3: Tell the model the tools exist**

Append to the `system` string, after the read-tools paragraph:

```ts
`\n\nFor delivery work, use list_projects and get_project_context. get_project_context ` +
`returns a project's milestones, open tasks, linked repo with recent commits, and what was ` +
`decided in its most recent project chat — reach for it whenever the founder asks how a ` +
`build is going or what was agreed on a project.`
```

Add the imports from `@/lib/projects/projectContext`.

- [ ] **Step 4: Verify**

Run: `npm run dev` → `/advisor`. First have a project chat decision on record (Task 27), then ask the Advisor: *"What did we decide about the Acme dashboard export?"*
Expected: it calls `list_projects` then `get_project_context` and answers from the real thread — not from the client snapshot, which never carried it.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/advisor/route.ts
git commit -m "feat(advisor): read project context, milestones and decisions"
```

---

### Task 30: Wire get_project_context into the Brain

The Brain currently has no local-data tools at all — only Drive and web search. This gives the strategist its first view of real delivery work.

**Files:**
- Modify: `src/app/api/brain/route.ts`
- Modify: `src/lib/brain/prompt.ts`
- Test: `src/lib/brain/prompt.test.ts`

**Interfaces:**
- Consumes: `PROJECT_CONTEXT_TOOLS`, `PROJECT_CONTEXT_TOOL_NAMES`, `resolveProjectContextTool` (Task 28)
- Produces: both Brain modes can read project context

- [ ] **Step 1: Write the failing test**

Append to `src/lib/brain/prompt.test.ts`:

```ts
describe("brain prompt — project awareness", () => {
  const input = { businessName: "Pallisade Data", founderName: "Emil", today: "2026-07-29" };

  it("tells the strategist about the project tools", () => {
    const p = buildBrainSystemPrompt(input);
    expect(p).toContain("get_project_context");
    expect(p).toContain("list_projects");
  });

  it("tells brainstorm mode too", () => {
    const p = buildBrainSystemPrompt({ ...input, mode: "brainstorm" });
    expect(p).toContain("get_project_context");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brain/prompt.test.ts`
Expected: FAIL — prompt does not contain `get_project_context`

- [ ] **Step 3: Add the shared paragraph to both prompts**

In `src/lib/brain/prompt.ts`, add a shared constant and append it to both `strategistPrompt` and `brainstormPrompt` return values:

```ts
const PROJECT_TOOLS_BLOCK =
  `\n\nTHE FOUNDER'S REAL WORK:\n` +
  `- Use list_projects to see every live project, and get_project_context for one project's ` +
  `milestones, open tasks, linked repo with recent commits, and what was decided in its most ` +
  `recent project chat.\n` +
  `- Reach for them before advising on delivery, capacity or what to build next. Ground the ` +
  `advice in what is actually running; never invent project state.`;
```

- [ ] **Step 4: Give the strategist mode a tool loop**

The strategist path is currently a single `client.messages.create` with no `tools` (`brain/route.ts:50-61`). It now needs a loop. Replace that block with the same shape the brainstorm path uses, but with only the project-context tools:

```ts
  if (mode === "strategist") {
    const system = buildBrainSystemPrompt({ businessName, founderName, today });
    try {
      let finalText = "";
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system,
          tools: PROJECT_CONTEXT_TOOLS as unknown as Anthropic.Tool[],
          messages,
        });

        const textParts = response.content
          .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
          .map((blk) => blk.text);
        if (textParts.length) finalText = textParts.join("\n").trim();

        const toolUses = response.content.filter(
          (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
        );
        if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: await Promise.all(
            toolUses.map(async (tu) => ({
              type: "tool_result" as const,
              tool_use_id: tu.id,
              content: await resolveProjectContextTool(tu.name, (tu.input ?? {}) as Record<string, unknown>),
            })),
          ),
        });
      }
      return NextResponse.json({ content: finalText || "I couldn't produce a response — try rephrasing." });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
  }
```

- [ ] **Step 5: Add the tools to brainstorm mode**

In the brainstorm path, extend the tools array and the resolver branch:

```ts
const tools = [
  { type: "web_search_20250305", name: "web_search", max_uses: 5 },
  ...DRIVE_TOOLS,
  ...PROJECT_CONTEXT_TOOLS,
] as unknown as Anthropic.Tool[];
```

The existing loop only collects `driveUses`. Widen it to every locally-resolved tool:

```ts
const localUses = response.content.filter(
  (blk): blk is Anthropic.ToolUseBlock =>
    blk.type === "tool_use" &&
    (DRIVE_TOOL_NAMES.has(blk.name) || PROJECT_CONTEXT_TOOL_NAMES.has(blk.name)),
);
```

Replace `driveUses` with `localUses` in the break condition and the results map, dispatching on the name:

```ts
localUses.map(async (tu) => ({
  type: "tool_result" as const,
  tool_use_id: tu.id,
  content: PROJECT_CONTEXT_TOOL_NAMES.has(tu.name)
    ? await resolveProjectContextTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)
    : await resolveBrainTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, driveAccountId),
})),
```

Leave the `pause_turn` handling for `web_search` exactly as it is.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/brain/prompt.test.ts`
Expected: PASS

- [ ] **Step 7: Verify end to end**

Run: `npm run dev` → `/brain` (strategist mode). Ask: *"Given what's actually running, what should I focus on next week?"*
Expected: it calls `list_projects`, pulls context on one or two, and reasons from real milestones and blockers. Switch to brainstorm mode and confirm Drive search and web search still work.

Run: `npm test && npx tsc --noEmit`
Expected: all green. **Phase 4 complete.**

- [ ] **Step 8: Commit**

```bash
git add src/app/api/brain/route.ts src/lib/brain/prompt.ts src/lib/brain/prompt.test.ts
git commit -m "feat(brain): read real project context in both modes"
```

---

## Done

All four phases landed. Final check:

```bash
npm test && npx tsc --noEmit && npm run build
```
