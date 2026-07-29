# Project Tracker — Depth, Timeline, Git & Context Chat — Design

**Date:** 2026-07-29
**Status:** Approved

## Goal

Turn `/projects` from a flat card grid into the surface where build work actually
lives: real milestone records on a time axis, the local git repo as a live signal,
and a per-project AI chat whose decisions are readable by the Sales Advisor and the
Brain.

Today a `Project` is 13 flat fields. `currentMilestone` is a **string**. There is no
history, no phase structure, no dependency, no time axis, no build signal, and no
per-project memory. Every feature below needs the data model opened up first.

## Decisions (locked)

1. **Git source: local folders on this Mac.** A project stores an absolute
   `repoPath`; the server shells out to `git -C <path>`. No auth, works offline, sees
   uncommitted work and every branch. This ties the feature to a locally-run app —
   accepted, matching the existing `node:sqlite`-on-disk / `Pallisade OS.command`
   architecture. A hosted deploy would need a GitHub-API adapter behind the same
   `readStatus` / `readCommits` interface.
2. **Gantt bars are milestones**, not tasks and not projects. A new `Milestone`
   record per project; tasks link to a milestone and nest under its bar.
3. **Context chat is a per-project thread, readable by other agents.** Stored as a
   `ProjectThread` collection. A `get_project_context` tool on the Advisor and the
   Brain reads it server-side.
4. **Git signal: commit feed, working state, and milestone progress matching.**
   Momentum indicators (commits/day sparkline, "stale for N days") are explicitly
   out of scope.
5. **Git never writes a milestone status.** Matching produces a commit count, a last
   commit date, and a one-click *suggestion* ("6 commits since Jul 20 — mark in
   progress?"). Date-range and commit-scope matching are heuristics; a bar that
   silently marks itself `done` is worse than no signal. The founder stays the author
   of record.
6. **Drag-to-reschedule is out of scope.** Dates are edited in the milestone form.
   The geometry module makes it additive later.
7. **Deleting a milestone orphans its tasks**, it does not delete them — matching how
   project deletion already treats linked tasks.

## Phasing

Each phase is independently shippable. Only Phase 1 carries a migration; 2–4 are
purely additive.

| Phase | Contents |
| ----- | -------- |
| 1 | Data model, milestone CRUD, `reconcileProjects` migration, `/projects/[id]` page |
| 2 | `GanttChart` + `schedule.ts` — portfolio timeline and per-project timeline |
| 3 | Git layer: repo link, commit feed, working state, progress suggestions |
| 4 | Project context chat + `get_project_context` on Advisor and Brain |

---

## 1. Data model — `src/lib/types.ts`

### New collection: `milestones`

```ts
export const MILESTONE_STATUSES = [
  "planned",
  "in progress",
  "blocked",
  "done",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

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
```

### New collection: `projectThreads`

```ts
export interface ProjectThread extends BaseRecord {
  projectId: string;
  title: string;              // auto-derived from the first user message, like BrainThread
  messages: ChatMessage[];
}
```

### Field changes

- `Project.repoPath: string | null` — absolute local path, `null` when unlinked.
- `Task.milestoneId: string | null` — `null` renders under "Unassigned".
- `Project.currentMilestone` — retired from every form and read path, but the field
  **stays on the interface permanently**, marked deprecated. `reconcileProjects` runs
  on every hydrate, so it must still be able to read the field from an old backup or
  a restored database. Removing it from the type would make the migration
  un-runnable on exactly the data it exists to fix.

### Registry wiring

`Milestone` and `ProjectThread` slot into the existing seams and get CRUD for free:

- `DataShape` gains `milestones: Milestone[]` and `projectThreads: ProjectThread[]`
- `COLLECTIONS` in `src/lib/db/sqlite.ts` gains `"milestones"` and `"projectThreads"`
  — `ensureSchema` creates the tables via `CREATE TABLE IF NOT EXISTS` on next boot
- `EMPTY` in `src/lib/store.tsx` gains both as `[]`
- `AdvisorSnapshot` is `Omit<DataShape, …>`, so `milestones` is included
  automatically once it joins `DataShape` — which is what we want, since the snapshot
  already carries `projects` and `tasks`. `"projectThreads"` must be **added
  explicitly to the `Omit` list**, alongside the other thread collections. It is
  reached server-side by `get_project_context`, so transcripts never inflate the
  client payload.
- `src/lib/seed.ts` gains demo milestones for the seeded projects and leaves
  `projectThreads` empty.

### Migration — `reconcileProjects` in `src/lib/reconcile.ts`

`reconcileFollowUps` already runs on every hydrate (`store.tsx:117`); this joins it.

For each project where `currentMilestone` is non-empty **and** the project has zero
milestone records:

1. Create one `Milestone` — `name` from the string, `status: "in progress"`,
   `order: 0`, `startDate` from `project.startDate`, `endDate` from `project.dueDate`,
   `dependsOn: []`, `commitScope: ""`, `notes: ""`.
2. Set `project.currentMilestone = ""`.

Blanking the string is what makes it idempotent: it cannot re-fire after the founder
deliberately deletes every milestone on a project. No data is lost and no manual step
is required.

`reconcileProjects` must return new arrays rather than mutating, matching
`reconcileFollowUps`, and must be a pure function of `(projects, milestones)` so it
is testable without a store.

---

## 2. Git layer

All server-side. The browser never resolves a filesystem path; it calls an authed
route.

```
/projects/[id] ──fetch──▶ /api/git ──execFile──▶ git -C <repoPath> …
```

### `src/lib/git/repo.ts` (server-only — executes)

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
  authorDate: string; // ISO
  files: string[];
}

export type GitErrorCode = "not_found" | "not_a_repo" | "git_failed";

export async function resolveRepo(path: string): Promise<string>;
export async function readStatus(path: string): Promise<RepoStatus>;
export async function readCommits(
  path: string,
  opts?: { limit?: number; since?: string },
): Promise<Commit[]>;
```

- `resolveRepo` is the gatekeeper every other function calls first. The path must be
  absolute, exist, be a directory, and contain a `.git` entry. It throws a typed error
  carrying a `GitErrorCode`.
- `readStatus` runs `git status --porcelain=v2 --branch`.
- `readCommits` runs `git log` with `--date=iso-strict`, a record-separated
  `--format`, `--name-only`, and `--max-count` (default 50).
- **`execFile`, never `exec`** — no shell is spawned, so a path containing shell
  metacharacters is an argument, not a command.
- Every invocation sets `timeout: 5000` and a `maxBuffer` cap so a large repo cannot
  hang or exhaust the route.

### `src/lib/git/parse.ts` (pure — parses)

Parsing is separated from execution so it can be tested against fixture strings with
no repo on disk.

```ts
export function parseStatus(stdout: string): RepoStatus;
export function parseLog(stdout: string): Commit[];
```

`repo.ts` only shells out and hands stdout to these.

### `src/app/api/git/route.ts`

`GET /api/git?path=<abs>&action=status|log&limit=<n>`

Already behind auth via `src/middleware.ts` (which excludes only `api/auth`, `login`
and static files). Responds `{ error: GitErrorCode }` with a real status code —
`404` for `not_found` / `not_a_repo`, `502` for `git_failed`. Never returns a stack
trace or a raw filesystem error.

### `src/lib/git/gitClient.ts` (client gateway)

Thin `fetch` wrapper returning a discriminated result:

```ts
type GitResult<T> = { ok: true; data: T } | { ok: false; error: GitErrorCode };
```

### `src/lib/git/milestoneProgress.ts` (pure)

```ts
export function matchCommits(
  commits: Commit[],
  milestones: Milestone[],
): Map<string, Commit[]>; // milestoneId → matching commits
```

Two rules, applied per milestone in this order:

1. **Scope match** — when `commitScope` is non-empty, match commits whose subject
   contains that scope in conventional-commit form `type(scope):` or in `[scope]`
   form. Case-insensitive.
2. **Date-range fallback** — otherwise match commits whose `authorDate` falls within
   `[startDate, endDate]` inclusive. A milestone missing either date matches nothing
   and returns an empty array.

A commit may match more than one milestone. Exclusivity is deliberately not enforced —
a tie-break rule would be guessing.

### Failure posture

Git is **never load-bearing**. Repo moved, path wrong, or `git` absent from PATH — the
project page renders completely, showing a `Repo not found at <path>` chip with a
re-link button where the commit feed would be. No milestone, task, or chat feature
depends on git resolving.

---

## 3. UI

### Route change

Projects move from a `size="lg"` modal to a real page at `/projects/[id]`.

Three existing call sites build `/<page>?focus=<id>` deep links — global search
(`Topbar.tsx:82`), advisor action cards (`ActionCard.tsx:28`), and the dashboard
follow-up list. Rather than change all three, `/projects` keeps reading `?focus=` and
`router.replace`s to `/projects/<id>`. Every existing linker keeps working untouched.

### `/projects` index

Keeps the card grid and the stage/type filters. Gains a `Board | Timeline` toggle.

- **Board** — the existing grid, unchanged.
- **Timeline** — every project's milestones on one shared axis, grouped by project.

### `/projects/[id]`

```
Acme Dashboard · Acme Capital          [build] [high] [paid project]
main · 3 uncommitted                                    ~/code/acme
─────────────────────────────────────────────────────────────────
 Overview   Milestones   Tasks   Repo   Chat
─────────────────────────────────────────────────────────────────
```

Tabbed, because each panel wants full width. **Overview** is the default and shows: a
compact Gantt, current + next milestone, `currentBlocker`, `nextAction`, open tasks,
and the last 5 commits. The header carries the repo chip (branch · dirty count) or the
not-found state.

### `src/lib/projects/schedule.ts` (pure)

All layout math lives here so it is tested without rendering:

```ts
export interface GanttRange { start: string; end: string }

export function ganttRange(milestones: Milestone[]): GanttRange | null;
export function barGeometry(
  m: Milestone, range: GanttRange, width: number,
): { x: number; w: number } | null;
export function dependencyEdges(
  milestones: Milestone[], range: GanttRange, width: number, rowHeight: number,
): { x1: number; y1: number; x2: number; y2: number }[];
export function detectCycles(milestones: Milestone[]): string[][];
```

- `ganttRange` returns `null` when no milestone has both dates, so the chart can
  render an empty state rather than an invalid domain. The domain is padded out to
  week boundaries.
- `barGeometry` returns `null` for an undated milestone — it is listed without a bar.
- `detectCycles` returns each cycle found as an ordered list of milestone ids.

### `src/components/projects/GanttChart.tsx`

Bespoke, no charting dependency, following the `TrendChart.tsx` idiom — a
`ResizeObserver` supplies width. CSS-grid rows with absolutely-positioned bars, so bar
colours come from existing CSS custom properties; a thin absolutely-positioned SVG
overlay draws only the dependency connectors. A vertical hairline marks today. Clicking
a bar opens the milestone editor.

The same component serves both surfaces — the portfolio timeline passes every
project's milestones with a project grouping; the project page passes one project's.

### Other new components — `src/components/projects/`

| Component | Purpose |
| --------- | ------- |
| `MilestoneForm.tsx` | Create/edit; validates dates and rejects dependency cycles |
| `MilestoneList.tsx` | Ordered list with status, dates, task rollup, reorder |
| `CommitFeed.tsx` | Commit rows — subject, relative date, file count |
| `RepoLink.tsx` | Path input + validate button; shows the resolved branch on success |
| `ProjectChat.tsx` | Thread UI, reusing `advisor/MessageBubble`, `advisor/Markdown`, `advisor/ActionCard` |

`src/lib/badges.ts` gains `milestoneStatusTone` mapping the four statuses onto existing
tones: `planned` → neutral, `in progress` → accent, `blocked` → warning,
`done` → positive.

---

## 4. Project context chat

### `src/lib/projects/prompt.ts` (pure)

```ts
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

export function buildProjectSystemPrompt(input: ProjectPromptInput): string;
```

The brief carries project state, milestones with dates and status, open tasks, repo
state and recent commits. It is capped to a character budget with a truncation marker,
the way `formatAttachmentsBlock` caps attachments in `src/lib/brain/prompt.ts`.

### `src/lib/projects/tools.ts`

| Tool | Resolution | Effect |
| ---- | ---------- | ------ |
| `list_milestones` | snapshot | read |
| `list_tasks` | snapshot | read |
| `read_repo_status` | server (async) | read |
| `read_commits` | server (async) | read |
| `create_milestone` | proposal | confirm-gated write |
| `update_milestone` | proposal | confirm-gated write |
| `create_task` | proposal | confirm-gated write |
| `update_task` | proposal | confirm-gated write |
| `update_project` | proposal | confirm-gated write |

Writes reuse the existing `ProposedAction` rails. `src/lib/advisor/applyAction.ts`
gains `buildMilestone`.

Milestone deep-linking needs care: `ProposedAction.result` is
`{ kind: CollectionKey; id: string }`, and the link builder at `applyAction.ts:136`
produces `/<page>?focus=<id>` — it only has the record's own id, and milestones have
no page of their own. So a confirmed `create_milestone` / `update_milestone` sets
`result: { kind: "projects", id: projectId }` rather than pointing at the milestone.
That yields `/projects?focus=<projectId>`, which the Phase 1 redirect already turns
into `/projects/<projectId>`. No change to the link builder and no new route map entry.

`update_milestone` proposals are validated against `detectCycles` **before** the card
is offered, so a confirm can never introduce a dependency loop.

### `src/app/api/projects/chat/route.ts`

Mirrors `src/app/api/advisor/route.ts`: `claude-sonnet-4-6`, `MAX_ITERATIONS = 8`,
`GET` reports `{ configured, model }`, `POST` runs the tool loop. Server-resolved tools
(`read_repo_status`, `read_commits`) are answered from a name set the way
`EMAIL_TOOL_NAMES` is at `advisor/route.ts:130`; everything else resolves synchronously
from the posted snapshot.

### `src/lib/projects/projectClient.ts`

Client gateway following `src/lib/brainClient.ts` — posts messages plus the project
snapshot, returns `{ content, actions }`.

### `get_project_context` — the cross-agent seam

Added to the Advisor's `TOOLS` (alongside a `list_projects` so the model can resolve a
name to an id) **and to the Brain**, which today has no local-data tools at all — only
Drive and web search.

It resolves **async and server-side**, joining the `EMAIL_TOOL_NAMES` /
`CALENDAR_READ_TOOL_NAMES` family, reading the database directly. This is why
`projectThreads` stays out of `AdvisorSnapshot`: transcripts are pulled server-side on
demand rather than posted from the browser on every message.

Returns a budget-capped brief:

```
project state (name, company, stage, priority, dates, blocker, next action, deliverables)
milestones — name, status, dates, order, dependsOn
open tasks
repo — branch, dirty count, last 10 commits
recent decisions — last ~15 messages of the most recent ProjectThread
```

Cap: 8000 characters, later sections truncated with a marker.

---

## Error handling

| Condition | Behaviour |
| --------- | --------- |
| No `ANTHROPIC_API_KEY` | Route returns `503 no_key`; chat shows the same "not configured" state as the other agents |
| Repo path invalid / moved / `git` absent | Page renders fully; repo chip shows not-found with a re-link button |
| Git tool called with no linked repo | Returns `"repo not linked"` as a normal `tool_result`; the model continues. Never a 502 |
| Tool loop hits `MAX_ITERATIONS` | Returns whatever text exists, matching the advisor route |
| Dependency cycle | Rejected at `MilestoneForm`, and re-validated before an `update_milestone` proposal is offered |
| Milestone deleted | Linked tasks keep a dangling `milestoneId` and render under "Unassigned" |
| `ganttRange` has no dated milestones | Chart renders an empty state; milestones still list |

## Testing

Vitest, `*.test.ts` beside source, pure logic only — matching the existing suite.

| File | Covers |
| ---- | ------ |
| `src/lib/git/parse.test.ts` | `parseStatus` porcelain v2 (branch, ahead/behind, staged/unstaged/untracked), `parseLog` multi-commit with files, empty output |
| `src/lib/git/milestoneProgress.test.ts` | scope match (`feat(x):` and `[x]`), date-range match, inclusive boundary dates, undated milestone → empty, commit matching two milestones |
| `src/lib/projects/schedule.test.ts` | `ganttRange` domain + week padding + `null` when undated, `barGeometry` position/width + `null`, `dependencyEdges`, `detectCycles` on a clean graph and a 3-node loop |
| `src/lib/projects/prompt.test.ts` | brief includes milestones, blocker and commits; respects the char budget with a truncation marker |
| `src/lib/advisor/applyAction.test.ts` | `buildMilestone` defaults and coercion |
| `src/lib/reconcile.test.ts` | `reconcileProjects` backfills once, is a no-op on second run, skips projects that already have milestones |

Deliberately untested: the `execFile` calls in `repo.ts` (needs a real repo on disk)
and React components — consistent with the current suite, which covers pure logic only.
