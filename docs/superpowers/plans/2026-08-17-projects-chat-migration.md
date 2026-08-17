# Projects Chat Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `api/projects/chat` — the last surface running its own tool-use loop — onto the shared `runAgent()` runtime, via a new `delivery` capability group and a `projectSnapshot` on `AgentContext`.

**Architecture:** A new `delivery` capability group grants the nine project-scoped tools, gated on `ctx.projectSnapshot` being present so a misdeclared grant yields nothing rather than nine broken tools. Two tools are renamed to make the tool bus's unspoken name-uniqueness assumption true. `resolveProjectTool` becomes async and absorbs the two git tools, which lets the inverted `SERVER_TOOL_NAMES` export be deleted rather than renamed. The route then becomes the same six lines of orchestration the Brain and Advisor routes already are.

**Tech Stack:** Next.js 15 App Router (route handlers, `runtime = "nodejs"`), TypeScript strict, Vitest (`environment: "node"`, no DOM), `@anthropic-ai/sdk`, libSQL/Turso via `src/lib/db/sqlite.ts`.

**Spec:** `docs/superpowers/specs/2026-08-17-projects-chat-migration-design.md`

## Global Constraints

- **Never let a test touch `data/pallisade.db`.** `getClient()` (`src/lib/db/client.ts:16`) defaults to it and it holds real founder data. Stub the module boundary with `vi.mock` (see `src/app/api/brain/route.test.ts:51-58`) or redirect `TURSO_DATABASE_URL` to a temp file in `beforeAll` (see `src/lib/agents/overrides.test.ts`). Verify by row counts, never by file checksum.
- **No new runtime dependencies.** The app deliberately carries 11.
- **Tests are colocated** `src/**/*.test.ts`, `environment: "node"`. `vitest.config.ts` excludes `.test.tsx` — there is no DOM library, so `.tsx` components are verified in a browser, not unit-tested.
- **Route errors use `apiError(code, status, cause)`.** Passing the cause is what makes it log.
- **Server-authored tables must NOT go in `COLLECTIONS`** (`src/lib/db/sqlite.ts`). Not triggered by this plan, but do not add any.
- **Run the mutant.** Every assertion this plan adds must be checked with `scripts/mutate.sh` before its task is called done. A green suite is the least reliable signal in this repo: the two failure modes are an assertion that passes against the thing it is meant to detect, and a capability granted but not wired.
- **Tool names are globally unique** across capability groups after Task 2. Task 2's disjointness test enforces it; do not add a tool that breaks it.
- Full verification commands: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

### Task 1: `projectSnapshot` on `AgentContext`, and the gated `delivery` grant

**Files:**
- Modify: `src/lib/agents/types.ts:3-5` (add `delivery` to `CAPABILITY_GROUPS`), `:49-59` (add `projectSnapshot` to `AgentContext`)
- Modify: `src/lib/agents/capabilities.ts:20-24` (import), `:38-56` (`grantsFor`)
- Test: `src/lib/agents/capabilities.test.ts`

**Interfaces:**
- Consumes: `ProjectSnapshot` from `@/lib/projects/tools` (already exists, `tools.ts:7-11`), `PROJECT_TOOLS` from the same module.
- Produces: `AgentContext.projectSnapshot: ProjectSnapshot | null`; `CapabilityGroup` union gains `"delivery"`. Tasks 2, 3, 4 and 5 all depend on both.

- [ ] **Step 1: Write the failing tests**

In `src/lib/agents/capabilities.test.ts`, add a project fixture next to the existing `snapshot()` helper, and extend the existing `ctx()` helper with the new field:

```ts
import type { ProjectSnapshot } from "@/lib/projects/tools";

function projectSnapshot(): ProjectSnapshot {
  return {
    project: {
      id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
      type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
      dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "", nextAction: "",
      deliverables: "", notes: "", repoPath: null, repoSlug: null,
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
}
```

Add `projectSnapshot: null,` to the object literal inside the existing `ctx()` helper (before the `...over` spread, so a test can override it).

Then add the new describe block:

```ts
describe("the delivery group", () => {
  it("grants the project tool set when a project is in context", () => {
    const granted = names(toolsFor(["delivery"], ctx({ projectSnapshot: projectSnapshot() })));
    expect(granted).toHaveLength(9);
    expect(granted).toContain("list_milestones");
    expect(granted).toContain("update_project");
  });

  // The handover records "a capability granted but not wired" as a failure
  // mode this codebase has produced twice: a tool appears in the list the
  // model receives and then answers every call with an error. Gating the
  // grant on the context that backs it is what closes that by construction.
  it("grants nothing when no project is in context", () => {
    expect(toolsFor(["delivery"], ctx())).toEqual([]);
  });

  it("does not leak project tools into the cross-project projects group", () => {
    const granted = names(toolsFor(["projects"], ctx({ projectSnapshot: projectSnapshot() })));
    expect(granted).toEqual(["get_project_context", "list_projects"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/agents/capabilities.test.ts`
Expected: FAIL. The `delivery` string is not assignable to `CapabilityGroup`, and `projectSnapshot` is not a property of `AgentContext` — these surface as TypeScript errors inside the test run.

- [ ] **Step 3: Add the capability group and the context field**

In `src/lib/agents/types.ts`, add `"delivery"` to the array (place it next to `"projects"` so the pair reads together):

```ts
export const CAPABILITY_GROUPS = [
  "crm", "email", "calendar", "drive", "projects", "delivery", "web", "writes", "repo", "fathom",
] as const;
```

Add the type-only import at the top of the same file:

```ts
import type { ProjectSnapshot } from "@/lib/projects/tools";
```

and the field at the end of `AgentContext`:

```ts
  driveAccountId: string | null;
  /**
   * The ONE project a thread is about, or null on cross-project surfaces.
   * The `delivery` tools resolve against it. Assembled server-side from a
   * projectId like every other field here — the browser names which project,
   * never what is in it.
   */
  projectSnapshot: ProjectSnapshot | null;
```

- [ ] **Step 4: Add the grant**

In `src/lib/agents/capabilities.ts`, extend the existing import from `@/lib/projects/projectContext` region with a new import:

```ts
import { PROJECT_TOOLS } from "@/lib/projects/tools";
```

and add the case to `grantsFor`, directly under `case "projects"`:

```ts
    case "projects": return PROJECT_CONTEXT_TOOLS;
    // Scoped to the ONE project in ctx.projectSnapshot — the inverse of
    // `projects`, which is cross-project and read-only. Granting nothing
    // without a project in context is deliberate: nine tools that all answer
    // with an error is the failure mode this gate exists to prevent.
    case "delivery": return ctx.projectSnapshot ? PROJECT_TOOLS : [];
```

- [ ] **Step 5: Fix every other `AgentContext` construction**

Run: `npx tsc --noEmit`

Every site that builds an `AgentContext` now fails to compile. Add `projectSnapshot: null` to each. Expected sites: `src/app/api/brain/route.ts:122-134`, `src/app/api/advisor/route.ts` (its `ctx` literal), `src/lib/agents/runtime.test.ts`, and any other `.test.ts` that constructs one. Do not guess the list — let `tsc` name them.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 7: Run the mutants**

Two mutations, each must turn a test red:

1. In `capabilities.ts`, change the grant to `case "delivery": return PROJECT_TOOLS;` (drop the gate). Expected: "grants nothing when no project is in context" FAILS. Revert.
2. In `capabilities.ts`, change it to `case "delivery": return PROJECT_CONTEXT_TOOLS;`. Expected: "grants the project tool set when a project is in context" FAILS on the length assertion. Revert.

If either mutation leaves the suite green, the test is insulated — fix the test, not the mutant.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agents/types.ts src/lib/agents/capabilities.ts src/lib/agents/capabilities.test.ts src/app/api src/lib/agents/runtime.test.ts
git commit -m "feat(agents): add the delivery capability group and projectSnapshot context"
```

---

### Task 2: Make tool names globally unique

**Files:**
- Test: `src/lib/agents/capabilities.test.ts` (the disjointness suite — write first)
- Modify: `src/lib/projects/tools.ts:54,59` (tool defs), `:145,150` (resolver cases)
- Modify: `src/lib/advisor/applyAction.ts:194,208`
- Modify: `src/lib/projects/prompt.ts:89-93` (the tool names named in prose)
- Modify: `src/lib/projects/tools.test.ts` (existing assertions on the old names)

**Interfaces:**
- Consumes: `CAPABILITY_GROUPS` from `@/lib/agents/types`, `toolsFor` from `@/lib/agents/capabilities`, the `ctx()` and `projectSnapshot()` helpers from Task 1.
- Produces: `PROJECT_TOOLS` containing `create_project_task` and `update_project_task` instead of `create_task` and `update_task`. Tasks 3, 4 and 5 depend on the new names.

**Why this task exists.** `advisor/tools.ts:53,75` and `projects/tools.ts:54,59` both define `create_task` and `update_task`, with different schemas, different resolvers and different snapshot types. `dispatch()` (`capabilities.ts:71-98`) routes purely by name-set membership in a fixed if-chain, so it assumes tool names are globally unique. After Task 1 that assumption is false, and `create_task` on a project surface would route to the CRM resolver against an `AdvisorSnapshot` that is null there.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/agents/capabilities.test.ts`:

```ts
import { CAPABILITY_GROUPS } from "@/lib/agents/types";

describe("capability group disjointness", () => {
  // Every integration connected AND a project in context. With any of them
  // missing, `email`, `calendar` and `delivery` grant [] and both tests below
  // pass by being blind — which is exactly the failure mode this repo produces
  // (an assertion that passes against the thing it is meant to detect).
  const full = () => ctx({
    emailEnabled: true,
    calendarEnabled: true,
    driveAccountId: "acct-1",
    projectSnapshot: projectSnapshot(),
  });

  // Guards the fixture itself. If a future change makes a group grant nothing
  // under this context, the disjointness test below silently stops covering it
  // — this test fails first and says which group went dark.
  it("grants a non-empty tool set for every implemented group", () => {
    const empty = CAPABILITY_GROUPS.filter((g) => toolsFor([g], full()).length === 0);
    expect(empty).toEqual(["repo", "fathom"]);
  });

  // dispatch() routes a tool call by name-set membership in a fixed if-chain,
  // so it can only be correct while no two groups grant the same name. That
  // invariant was load-bearing and untested until this test.
  it("never grants the same tool name from two different groups", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const group of CAPABILITY_GROUPS) {
      for (const tool of toolsFor([group], full())) {
        const prev = owner.get(tool.name);
        if (prev) clashes.push(`${tool.name} granted by both ${prev} and ${group}`);
        else owner.set(tool.name, group);
      }
    }
    expect(clashes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/agents/capabilities.test.ts -t "disjointness"`
Expected: "never grants the same tool name" FAILS with two clashes — `create_task granted by both writes and delivery` and `update_task granted by both writes and delivery`. The "non-empty" test should already PASS; if it does not, fix the fixture before continuing.

- [ ] **Step 3: Rename the two colliding tools**

In `src/lib/projects/tools.ts`, change the two definitions (currently lines 54-64):

```ts
  { name: "create_project_task", description: "Propose a task on THIS project, optionally under a milestone. Scoped to this project — it is not the CRM-wide create_task.",
    input_schema: obj({
      title: s(), milestoneId: s("id from list_milestones"), category: enumStr(TASK_CATEGORIES),
      priority: enumStr(["low", "medium", "high"]), dueDate: dateStr(), notes: s(),
    }, ["title"]) },
  { name: "update_project_task", description: "Propose changes to a task on this project. Use an id from list_tasks.",
    input_schema: obj({
      id: s(), title: s(), status: enumStr(TASK_STATUSES),
      priority: enumStr(["low", "medium", "high"]), dueDate: dateStr(),
      milestoneId: s(), notes: s(),
    }, ["id"]) },
```

And the two `resolveProjectTool` cases (currently lines 145 and 150):

```ts
    case "create_project_task":
      return queue(proposals, name, `Add task "${String(args.title ?? "")}"`, {
        ...args, linkKind: "project", linkId: projectId,
      });

    case "update_project_task": {
```

Note the `queue()` call passes `name` as the proposal's `tool` field, so a proposal created after this change carries `create_project_task`. That is why Step 4 exists.

- [ ] **Step 4: Teach `applyAction` both generations**

In `src/lib/advisor/applyAction.ts`, add the new names as fall-through cases:

```ts
    // `create_task` is the CRM-wide tool; `create_project_task` is the
    // project-scoped one, renamed so the tool bus can route by name. Both are
    // kept: proposals already persisted in projectThreads carry the old string,
    // and dropping it would make a still-pending confirm button do nothing.
    case "create_task":
    case "create_project_task":
      return { kind: "tasks", id: idOf(store.create("tasks", buildTask(a))) };
```

and:

```ts
    case "update_task":
    case "update_project_task": {
      const id = str(a.id);
      if (!id) return null;
      store.update("tasks", id, buildTaskPatch(a));
      return { kind: "tasks", id };
    }
```

- [ ] **Step 5: Write the `applyAction` test**

`src/lib/advisor/applyAction.test.ts` already exists. Append this describe block to it, reusing that file's existing imports and any store helper it already defines rather than duplicating them — the `recorder()` below is what to write only if no equivalent helper is there:

```ts
function recorder() {
  const created: { key: string; value: unknown }[] = [];
  const updated: { key: string; id: string; patch: unknown }[] = [];
  const store: AdvisorStore = {
    create: (key, value) => { created.push({ key, value }); return { id: "new-1" }; },
    update: (key, id, patch) => { updated.push({ key, id, patch }); },
  };
  return { store, created, updated };
}

describe("applyAction accepts both task tool generations", () => {
  it("applies a pre-rename create_task proposal from a project thread", () => {
    const { store, created } = recorder();
    const out = applyAction(store, {
      id: "a1", tool: "create_task", description: "", status: "pending",
      args: { title: "Ship it", linkKind: "project", linkId: "p1" },
    });
    expect(out).toEqual({ kind: "tasks", id: "new-1" });
    expect(created[0].value).toMatchObject({ title: "Ship it", linkKind: "project", linkId: "p1" });
  });

  it("applies a post-rename create_project_task proposal identically", () => {
    const { store, created } = recorder();
    const out = applyAction(store, {
      id: "a2", tool: "create_project_task", description: "", status: "pending",
      args: { title: "Ship it", linkKind: "project", linkId: "p1" },
    });
    expect(out).toEqual({ kind: "tasks", id: "new-1" });
    expect(created[0].value).toMatchObject({ title: "Ship it", linkKind: "project", linkId: "p1" });
  });

  it("applies update_project_task the same way as update_task", () => {
    const { store, updated } = recorder();
    applyAction(store, {
      id: "a3", tool: "update_project_task", description: "", status: "pending",
      args: { id: "t1", status: "done" },
    });
    expect(updated[0]).toMatchObject({ key: "tasks", id: "t1" });
  });
});
```

- [ ] **Step 6: Update the prose and the existing assertions**

In `src/lib/projects/prompt.ts:89-93`, the "HOW YOU WORK" text names the tools. Change `create_task, update_task` to `create_project_task, update_project_task` in that sentence.

In `src/lib/projects/tools.test.ts`, update every occurrence of the old names — the `PROJECT_TOOLS` name list at line 26-31 and each `resolveProjectTool("create_task", …)` / `("update_task", …)` call.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green, including both disjointness tests.

- [ ] **Step 8: Run the mutants**

1. Rename `create_project_task` back to `create_task` in `tools.ts` only. Expected: the disjointness test FAILS naming the clash. Revert.
2. In `capabilities.test.ts`, change the `full()` fixture's `projectSnapshot` back to `null`. Expected: "grants a non-empty tool set for every implemented group" FAILS naming `delivery`. Revert. (This is the anti-blindness guard proving it works.)
3. In `applyAction.ts`, delete the `case "create_task":` fall-through line. Expected: the pre-rename test FAILS. Revert.

- [ ] **Step 9: Commit**

```bash
git add src/lib/projects/tools.ts src/lib/projects/tools.test.ts src/lib/projects/prompt.ts src/lib/advisor/applyAction.ts src/lib/advisor/applyAction.test.ts src/lib/agents/capabilities.test.ts
git commit -m "fix(agents): make tool names unique across capability groups

create_task and update_task were defined in both the CRM and project tool
sets with different schemas and different resolvers, while dispatch() routes
purely by name. Renames the project-scoped pair and adds the test that makes
the bus's name-uniqueness assumption explicit."
```

---

### Task 3: `resolveProjectTool` absorbs the git tools; delete `SERVER_TOOL_NAMES`

**Files:**
- Modify: `src/lib/projects/tools.ts:27` (delete), `:98-165` (async + git cases), and add `PROJECT_TOOL_NAMES`
- Modify: `src/lib/agents/capabilities.ts:71-98` (`dispatch`)
- Modify: `src/app/api/projects/chat/route.ts:6,90-101,125-133` (minimal patch to keep the tree compiling)
- Test: `src/lib/projects/tools.test.ts`, `src/lib/agents/capabilities.test.ts`

**Interfaces:**
- Consumes: `readStatus`, `readCommits` from `@/lib/git/repo` (`readStatus(path): Promise<RepoStatus>`, `readCommits(path, { limit?, since? }): Promise<Commit[]>`).
- Produces: `resolveProjectTool(name, args, snap, proposals): Promise<string>` — now **async**. `PROJECT_TOOL_NAMES: Set<string>`. `SERVER_TOOL_NAMES` no longer exported from `@/lib/projects/tools`. Task 5 depends on all three.

**Why deletion, not renaming.** `projects/tools.ts:27`'s `SERVER_TOOL_NAMES` means *resolved by an async server-side resolver, and does receive a `tool_result`*. `capabilities.ts:35` uses the identical name to mean *executed by Anthropic, and must not receive one* (`runtime.ts:61-64`). Conflating them hangs the agent. Once `resolveProjectTool` owns the git tools internally, nothing reads the project-side set, so the inverted meaning has nowhere to come back to.

- [ ] **Step 1: Write the failing tests**

In `src/lib/projects/tools.test.ts`, replace the existing `it("marks only the git tools as server-resolved")` test — it asserts on the export being deleted — with a regression guard, and add the git resolver tests. At the top of the file add the mock:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/git/repo", () => ({
  readStatus: vi.fn(async () => ({
    branch: "main", ahead: 1, behind: 0, staged: 0, unstaged: 2, untracked: 1, source: "local" as const,
  })),
  readCommits: vi.fn(async () => ([{
    hash: "abc1234", shortHash: "abc1234", subject: "feat(ingest): batch loader",
    body: "", authorDate: "2026-07-18T10:00:00+02:00", files: ["src/ingest.ts"],
  }])),
}));
```

Then:

```ts
describe("the projects tool module", () => {
  // capabilities.ts:35 exports SERVER_TOOL_NAMES meaning "Anthropic-executed,
  // must NOT receive a tool_result". This module used to export the same name
  // meaning the exact inverse. Re-adding it is a bug, not a refactor.
  it("no longer exports a SERVER_TOOL_NAMES set", async () => {
    const mod = await import("./tools");
    expect("SERVER_TOOL_NAMES" in mod).toBe(false);
  });

  it("names every project tool in PROJECT_TOOL_NAMES", async () => {
    const { PROJECT_TOOLS, PROJECT_TOOL_NAMES } = await import("./tools");
    expect([...PROJECT_TOOL_NAMES].sort()).toEqual(PROJECT_TOOLS.map((t) => t.name).sort());
  });
});

describe("resolveProjectTool — git", () => {
  const linked: ProjectSnapshot = {
    ...snapshot,
    project: { ...snapshot.project, repoPath: "/Users/e/code/acme" },
  };

  it("returns real branch and dirty-file data from read_repo_status", async () => {
    const out = await resolveProjectTool("read_repo_status", {}, linked, []);
    expect(JSON.parse(out)).toMatchObject({ branch: "main", unstaged: 2 });
  });

  it("returns real commits from read_commits", async () => {
    const out = await resolveProjectTool("read_commits", { limit: 5 }, linked, []);
    expect(JSON.parse(out)[0]).toMatchObject({ shortHash: "abc1234" });
  });

  it("says so plainly when no repo is linked, rather than erroring", async () => {
    const out = await resolveProjectTool("read_repo_status", {}, snapshot, []);
    expect(out).toBe("No repo is linked to this project.");
  });
});
```

Every existing `resolveProjectTool(...)` call in this file must gain `await`, and its enclosing `it` must become `async`.

- [ ] **Step 2: Write the "every tool returns data" test**

This is the deeper assertion the handover demands — a grant test proves a tool *definition* resolves; this proves a tool *returns a payload*. Add to `src/lib/agents/capabilities.test.ts`:

```ts
describe("every delivery tool answers with data, not an error", () => {
  const withProject = () => ctx({ projectSnapshot: projectSnapshot(), proposals: [] });

  it("returns this project's milestones from list_milestones", async () => {
    const out = await dispatch("list_milestones", {}, withProject());
    expect(JSON.parse(out)[0]).toMatchObject({ id: "m1", name: "Ingest" });
  });

  it("returns this project's tasks from list_tasks", async () => {
    const out = await dispatch("list_tasks", {}, withProject());
    expect(JSON.parse(out)[0]).toMatchObject({ id: "t1", title: "Auth handshake" });
  });

  it("queues a proposal scoped to this project from create_milestone", async () => {
    const c = withProject();
    await dispatch("create_milestone", { name: "Handover" }, c);
    expect(c.proposals[0]).toMatchObject({ tool: "create_milestone", args: { projectId: "p1" } });
  });

  it("queues a project-linked task from create_project_task", async () => {
    const c = withProject();
    await dispatch("create_project_task", { title: "Ship it" }, c);
    expect(c.proposals[0].args).toMatchObject({ linkKind: "project", linkId: "p1" });
  });

  it("queues an update against this project's own id from update_project", async () => {
    const c = withProject();
    await dispatch("update_project", { stage: "handover" }, c);
    expect(c.proposals[0].args).toMatchObject({ id: "p1", stage: "handover" });
  });

  it("rejects an update_milestone for a milestone on another project", async () => {
    const out = await dispatch("update_milestone", { id: "not-mine" }, withProject());
    expect(out).toContain("No milestone with id");
  });

  it("rejects an update_project_task for a task on another project", async () => {
    const out = await dispatch("update_project_task", { id: "not-mine" }, withProject());
    expect(out).toContain("No task with id");
  });

  // The CRM create_task must still reach the CRM resolver — the rename in
  // Task 2 is only correct if both names still route to their own owner.
  it("routes the CRM create_task to the CRM resolver, not the project one", async () => {
    const c = ctx({ projectSnapshot: projectSnapshot(), proposals: [] });
    await dispatch("create_task", { title: "Call Sam", linkKind: "lead", linkId: "l1" }, c);
    expect(c.proposals[0].args).toMatchObject({ linkKind: "lead", linkId: "l1" });
  });

  it("reports a missing project rather than throwing", async () => {
    const out = await dispatch("list_milestones", {}, ctx());
    expect(JSON.parse(out).error).toContain("no project");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/projects/tools.test.ts src/lib/agents/capabilities.test.ts`
Expected: FAIL — `PROJECT_TOOL_NAMES` is not exported, `SERVER_TOOL_NAMES` still is, `read_repo_status` returns `"Unknown tool: read_repo_status"`, and `dispatch` returns `unknown tool` for every project tool.

- [ ] **Step 4: Implement in `tools.ts`**

Delete line 27 and its comment entirely. Add after `PROJECT_TOOLS`:

```ts
export const PROJECT_TOOL_NAMES = new Set(PROJECT_TOOLS.map((t) => t.name));
```

Change the resolver signature and add the git branch. `readStatus`/`readCommits` are imported dynamically so this module stays importable from a client component's type graph — the same pattern `projectContext.ts:110-111` uses:

```ts
/**
 * Resolves every project tool, including the two git reads.
 *
 * The git tools used to be resolved by the route through a set this module
 * exported as SERVER_TOOL_NAMES — a name capabilities.ts uses for the exact
 * inverse meaning (Anthropic-executed, never given a tool_result). Owning them
 * here deletes that collision instead of renaming it.
 *
 * Every write injects the snapshot's own projectId, so the agent can only ever
 * propose changes to the project whose thread it is in.
 */
export async function resolveProjectTool(
  name: string,
  args: Args,
  snap: ProjectSnapshot,
  proposals: ProposedAction[],
): Promise<string> {
  const projectId = snap.project.id;
  const repoPath = snap.project.repoPath;

  switch (name) {
    case "read_repo_status":
    case "read_commits": {
      // Not an error: a project with no repo is normal, and git is never
      // load-bearing. The model is told in prose so it can say so.
      if (!repoPath) return "No repo is linked to this project.";
      const { readStatus, readCommits } = await import("@/lib/git/repo");
      try {
        if (name === "read_repo_status") return JSON.stringify(await readStatus(repoPath));
        const limit = Number(args.limit) || 30;
        const since = args.since ? String(args.since) : undefined;
        return JSON.stringify(await readCommits(repoPath, { limit, since }));
      } catch {
        return `The repo at ${repoPath} could not be read right now.`;
      }
    }
```

Leave the rest of the switch as it is.

- [ ] **Step 5: Implement in `capabilities.ts`**

Add the import:

```ts
import { PROJECT_TOOLS, PROJECT_TOOL_NAMES, resolveProjectTool } from "@/lib/projects/tools";
```

and the branch inside `dispatch`, placed directly after the `PROJECT_CONTEXT_TOOL_NAMES` check:

```ts
    if (PROJECT_TOOL_NAMES.has(name)) {
      // Unreachable while toolsFor gates the grant on the same field, but a
      // resolver that dereferences null on a path it "cannot" reach is how the
      // next surface to grant `delivery` finds out the hard way.
      if (!ctx.projectSnapshot) throw new Error("no project in context for this tool");
      return await resolveProjectTool(name, args, ctx.projectSnapshot, ctx.proposals);
    }
```

Chain order does not affect correctness once names are unique (Task 2's test enforces that); this position keeps the two project-shaped branches adjacent.

- [ ] **Step 6: Patch the route so the tree compiles**

`src/app/api/projects/chat/route.ts` still imports the deleted export. This is a holding patch — Task 5 rewrites the file.

Change the import on line 6 to drop `SERVER_TOOL_NAMES`. Delete the `resolveServerTool` closure (lines 90-101). Replace the tool-result mapping (lines 125-133) with:

```ts
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: await resolveProjectTool(
            tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals,
          ),
        })),
      );
```

The route's own `readStatus`/`readCommits` calls at lines 66-71 stay — those build the prompt's state block, not a tool result.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 8: Run the mutants**

1. In `tools.ts`, make the git branch return `"No repo is linked to this project."` unconditionally. Expected: both `read_repo_status` and `read_commits` data tests FAIL. Revert.
2. In `capabilities.ts`, delete the `PROJECT_TOOL_NAMES` branch from `dispatch`. Expected: every test in "every delivery tool answers with data" FAILS. Revert.
3. In `capabilities.ts`, change the branch to pass `ctx.snapshot as never` instead of `ctx.projectSnapshot`. Expected: the data tests FAIL. Revert.
4. Re-add `export const SERVER_TOOL_NAMES = new Set(["read_repo_status"]);` to `tools.ts`. Expected: the regression guard FAILS. Revert.

- [ ] **Step 9: Commit**

```bash
git add src/lib/projects/tools.ts src/lib/projects/tools.test.ts src/lib/agents/capabilities.ts src/lib/agents/capabilities.test.ts src/app/api/projects/chat/route.ts
git commit -m "refactor(projects): give resolveProjectTool the git tools and delete SERVER_TOOL_NAMES

The project-side set meant 'async server resolver, DOES get a tool_result';
capabilities.ts uses the same name for 'Anthropic-executed, must NOT'.
Owning the git reads in the resolver deletes the collision rather than
renaming it."
```

---

### Task 4: The `project-agent` persona and the state block

**Files:**
- Create: `src/agents/project-agent.md`
- Modify: `src/lib/projects/prompt.ts:65` (rename and strip), `:5` (comment)
- Modify: `src/lib/projects/prompt.test.ts`, `src/app/api/projects/chat/route.ts:5,73` (call site)
- Test: `src/lib/agents/registry.test.ts` or a new `src/lib/agents/projectAgent.test.ts`

**Interfaces:**
- Consumes: `buildSpec` validation rules (`spec.ts:17-70`) — frontmatter requires `name`, `description`, `color`, `emoji`, `vibe`, `surface`, and every entry in `tools` must be a known `CapabilityGroup`.
- Produces: `buildProjectStateBlock(input: ProjectPromptInput): string` (renamed from `buildProjectSystemPrompt`, same signature). Agent id `project-agent`, surface `project`. Task 5 depends on both.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/agents/projectAgent.test.ts`:

```ts
/* The registry is DB-backed through loadOverrides (getClient() defaults to
   the founder's real production DB). Stub it at the module boundary — the
   same pattern as src/lib/agents/roster.test.ts. */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));

import { getAgent, listAgents } from "@/lib/agents/registry";

describe("the project agent", () => {
  it("is on the project surface with only the delivery group", async () => {
    const spec = await getAgent("project-agent");
    expect(spec.surface).toBe("project");
    expect(spec.tools).toEqual(["delivery"]);
  });

  it("appears in the project roster, which was empty before", async () => {
    const cards = await listAgents("project");
    expect(cards.map((c) => c.id)).toEqual(["project-agent"]);
  });

  it("names the renamed task tools, not the CRM ones", async () => {
    const { body } = await getAgent("project-agent");
    expect(body).toContain("create_project_task");
    expect(body).toContain("update_project_task");
    expect(body).not.toMatch(/\bcreate_task\b/);
    expect(body).not.toMatch(/\bupdate_task\b/);
  });

  it("uses only placeholders renderBody can substitute", async () => {
    const { body } = await getAgent("project-agent");
    const used = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    for (const token of used) {
      expect(["today", "businessName", "founderName", "services"]).toContain(token);
    }
  });
});
```

In `src/lib/projects/prompt.test.ts`, change the import to `buildProjectStateBlock` and every call site, then add:

```ts
  // The persona now lives in src/agents/project-agent.md and is editable in
  // Settings. A copy left here would silently win or silently conflict.
  it("carries the project's facts and none of the persona", () => {
    const out = buildProjectStateBlock(base);
    expect(out).toContain("Ingest pipeline");
    expect(out).toContain("Wire the auth handshake");
    expect(out).not.toContain("HOW YOU WORK");
    expect(out).not.toContain("You are the project agent");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/agents/projectAgent.test.ts src/lib/projects/prompt.test.ts`
Expected: FAIL — `unknown agent: project-agent`, and `buildProjectStateBlock` is not exported.

- [ ] **Step 3: Create the persona**

Create `src/agents/project-agent.md`:

```markdown
---
name: Project Agent
description: Knows one project deeply — its milestones, tasks, linked repo and history — and proposes confirm-gated changes to it.
color: "#38BDF8"
emoji: 🛠️
vibe: Grounded and exacting — cites real commits over recollection, and never claims a queued change is done.
surface: project
tools: [delivery]
---
Today's date is {{today}}. Resolve relative dates against it and pass concrete ISO dates (YYYY-MM-DD) to tools.

You are the project agent at {{businessName}}, working with {{founderName}} on the single project described below. You know this one project deeply and help plan it, unblock it and keep it honest. Everything you can see and change is scoped to this project alone.

HOW YOU WORK:

- Ground every answer in the project state below and in the read tools. Never invent milestones, commits, dates or history. If you don't have a fact, say so.
- Use read_commits and read_repo_status when {{founderName}} asks what shipped or where the work stands. Real commits beat recollection.
- When {{founderName}} wants to change something, call the matching write tool (create_milestone, update_milestone, create_project_task, update_project_task, update_project). Writes do NOT execute immediately — they are queued as proposals {{founderName}} must confirm in the UI. After proposing, say briefly what you've queued and that it awaits confirmation; never claim it is already done.
- For update_* tools always pass an id from the state below or from list_milestones / list_tasks, and only the fields you intend to change.
- Be direct, concrete and concise. Confident and brief beats verbose.
```

- [ ] **Step 4: Strip the persona from `prompt.ts`**

Rename the function and delete the persona halves. The file's exported function becomes:

```ts
/**
 * The factual state block for one project: state, milestones, open tasks and
 * repo. Appended after the rendered persona body, the shape brain/route.ts
 * uses for attachments.
 *
 * Renamed from buildProjectSystemPrompt: it no longer builds a system prompt,
 * and a name that says it does would be the last thing in the codebase
 * claiming the persona lives in TypeScript.
 */
export function buildProjectStateBlock(input: ProjectPromptInput): string {
  const { project: p } = input;

  const block =
    `PROJECT: ${p.name}${p.company ? ` · ${p.company}` : ""} — a ${p.type} for ${dash(p.company)}\n` +
    `  Stage: ${p.stage} · Priority: ${p.priority}\n` +
    `  Dates: ${p.startDate ?? "—"} → ${p.dueDate ?? "—"}\n` +
    `  Blocker: ${dash(p.currentBlocker)}\n` +
    `  Next action: ${dash(p.nextAction)}\n` +
    `  Deliverables: ${dash(p.deliverables)}\n` +
    `  Notes: ${dash(p.notes)}\n\n` +
    `MILESTONES:\n${milestoneLines(input.milestones)}\n\n` +
    `OPEN TASKS:\n${taskLines(input.tasks)}\n\n` +
    `${repoBlock(p, input.repo, input.commits)}`;

  return block.length > PROMPT_BUDGET
    ? `${block.slice(0, PROMPT_BUDGET - 13)}\n[truncated]`
    : block;
}
```

`businessName`, `founderName` and `today` stay on `ProjectPromptInput` — Task 5 still passes them, and removing fields is a separate change. Keep `milestoneLines`, `taskLines`, `repoBlock` and `dash` exactly as they are.

- [ ] **Step 5: Update the route's call site**

In `src/app/api/projects/chat/route.ts`, change the import on line 5 and the call on line 73 from `buildProjectSystemPrompt` to `buildProjectStateBlock`. The route still passes the same input object. This is a holding patch; Task 5 rewrites the file.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 7: Run the mutants**

1. In `project-agent.md`, change `tools: [delivery]` to `tools: [projects]`. Expected: the surface/tools test FAILS. Revert.
2. In `project-agent.md`, change `create_project_task` back to `create_task`. Expected: the renamed-tools test FAILS. Revert.
3. In `prompt.ts`, re-add the `HOW YOU WORK:` line to the returned block. Expected: the persona-separation test FAILS. Revert.
4. In `project-agent.md`, add `{{projectName}}` to the body. Expected: the placeholder test FAILS. Revert.

- [ ] **Step 8: Commit**

```bash
git add src/agents/project-agent.md src/lib/projects/prompt.ts src/lib/projects/prompt.test.ts src/lib/agents/projectAgent.test.ts src/app/api/projects/chat/route.ts
git commit -m "feat(agents): add the project-agent persona and split the state block out of prompt.ts"
```

---

### Task 5: Rewrite the route onto `runAgent`

**Files:**
- Modify: `src/app/api/projects/chat/route.ts` (full rewrite, 147 → ~110 lines)
- Test: `src/app/api/projects/chat/route.test.ts` (create)

**Interfaces:**
- Consumes: `getAgent`/`AgentNotFound` (`@/lib/agents/registry`), `runAgent`/`DEFAULT_MODEL` (`@/lib/agents/runtime`), `renderBody` (`@/lib/agents/render`), `buildProjectStateBlock` (Task 4), `AgentContext.projectSnapshot` (Task 1), `apiError` (`@/lib/api/errors`), `loadAll` (`@/lib/db/sqlite`), `linkedRepoPathFor` (`@/lib/git/linkedRepos`).
- Produces: `POST` accepting `{ projectId, messages, agentId?, context? }` and returning `{ content, actions, stoppedBy }`. Task 6 depends on that contract.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/projects/chat/route.test.ts`:

```ts
/* getAgent -> loadRegistry -> loadOverrides and loadAll are both DB-backed
   (getClient() defaults to file:data/pallisade.db, the founder's real
   production database). Both are stubbed at the module boundary so this file
   never touches it — the same pattern as src/app/api/brain/route.test.ts. The
   Anthropic SDK is stubbed so no test makes a network call. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
const { mockLoadAll } = vi.hoisted(() => ({ mockLoadAll: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic { messages = { create: mockCreate }; },
}));
vi.mock("@/lib/agents/overrides", () => ({
  loadOverrides: () => Promise.resolve(new Map<string, string>()),
}));
vi.mock("@/lib/db/sqlite", () => ({ loadAll: mockLoadAll }));

import { POST } from "./route";

const PROJECT = {
  id: "p1", createdAt: "", updatedAt: "", name: "Acme Dashboard", company: "Acme",
  type: "paid project", stage: "building", priority: "high", startDate: "2026-07-01",
  dueDate: "2026-08-15", currentMilestone: "", currentBlocker: "", nextAction: "",
  deliverables: "", notes: "", repoPath: null, repoSlug: null,
};
const MILESTONE = {
  id: "m1", createdAt: "", updatedAt: "", projectId: "p1", name: "Ingest",
  startDate: "2026-07-01", endDate: "2026-07-20", status: "in progress",
  order: 0, dependsOn: [], commitScope: "", notes: "",
};
const TASK = {
  id: "t1", createdAt: "", updatedAt: "", title: "Auth handshake", linkKind: "project",
  linkId: "p1", milestoneId: "m1", category: "delivery", priority: "high",
  status: "in progress", dueDate: null, notes: "",
};

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/projects/chat", {
    method: "POST", body: JSON.stringify(body),
  }));

const reply = (text: string) => ({
  content: [{ type: "text", text }], stop_reason: "end_turn",
});

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  mockCreate.mockReset().mockResolvedValue(reply("Here is where the build stands."));
  mockLoadAll.mockReset().mockResolvedValue({
    projects: [PROJECT], milestones: [MILESTONE], tasks: [TASK], projectThreads: [],
  });
});

describe("POST /api/projects/chat", () => {
  it("answers with the agent's text and the stop reason", async () => {
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "status?" }] });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      content: "Here is where the build stands.", stoppedBy: "end", actions: [],
    });
  });

  // The whole point of the migration: the browser names WHICH project, never
  // what is in it. A snapshot in the body must have no effect.
  it("loads the project from the DB and ignores a client-supplied snapshot", async () => {
    await post({
      projectId: "p1",
      messages: [{ role: "user", content: "status?" }],
      snapshot: { project: { ...PROJECT, name: "Forged Project" }, milestones: [], tasks: [] },
    });
    const system = mockCreate.mock.calls[0][0].system as string;
    expect(system).toContain("Acme Dashboard");
    expect(system).not.toContain("Forged Project");
  });

  it("grants the nine delivery tools", async () => {
    await post({ projectId: "p1", messages: [{ role: "user", content: "status?" }] });
    const tools = mockCreate.mock.calls[0][0].tools as { name: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_milestone", "create_project_task", "list_milestones", "list_tasks",
      "read_commits", "read_repo_status", "update_milestone", "update_project",
      "update_project_task",
    ]);
  });

  it("appends the project state block after the persona body", async () => {
    await post({ projectId: "p1", messages: [{ role: "user", content: "status?" }] });
    const system = mockCreate.mock.calls[0][0].system as string;
    expect(system).toContain("You are the project agent");
    expect(system).toContain("MILESTONES:");
    expect(system.indexOf("You are the project agent")).toBeLessThan(system.indexOf("MILESTONES:"));
    expect(system).not.toContain("{{");
  });

  it("404s on a projectId that matches nothing", async () => {
    const res = await post({ projectId: "nope", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "project_not_found" });
  });

  it("400s with missing_project when no projectId is sent", async () => {
    const res = await post({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "missing_project" });
  });

  it("400s with missing_messages on an empty thread", async () => {
    const res = await post({ projectId: "p1", messages: [] });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "missing_messages" });
  });

  it("503s with agent_unconfigured when no API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_unconfigured" });
  });

  it("502s with the cause when the DB read fails", async () => {
    mockLoadAll.mockRejectedValue(new Error("db unavailable"));
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_failed" });
  });

  it("404s on an agentId that does not exist", async () => {
    const res = await post({
      projectId: "p1", agentId: "nope", messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_not_found" });
  });

  it("502s when the upstream call fails", async () => {
    mockCreate.mockRejectedValue(new Error("anthropic down"));
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "agent_failed" });
  });

  it("returns queued proposals as actions", async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu1", name: "create_milestone", input: { name: "Handover" } }],
      })
      .mockResolvedValueOnce(reply("Queued it."));
    const res = await post({ projectId: "p1", messages: [{ role: "user", content: "add handover" }] });
    const json = await res.json();
    expect(json.actions).toHaveLength(1);
    expect(json.actions[0]).toMatchObject({ tool: "create_milestone", status: "pending" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/projects/chat/route.test.ts`
Expected: FAIL — the route still requires `snapshot` and returns `missing_snapshot`.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/projects/chat/route.ts` entirely:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apiError } from "@/lib/api/errors";
import { getAgent, AgentNotFound } from "@/lib/agents/registry";
import { runAgent, DEFAULT_MODEL } from "@/lib/agents/runtime";
import { renderBody } from "@/lib/agents/render";
import { buildProjectStateBlock } from "@/lib/projects/prompt";
import { linkedRepoPathFor } from "@/lib/git/linkedRepos";
import { loadAll } from "@/lib/db/sqlite";
import type { ProjectSnapshot } from "@/lib/projects/tools";
import type { AgentContext, AgentSpec } from "@/lib/agents/types";
import type { Commit, RepoStatus } from "@/lib/git/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_AGENT = "project-agent";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: DEFAULT_MODEL });
}

interface ChatRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  projectId?: string;
  agentId?: string;
  context?: { businessName?: string; founderName?: string; services?: string };
}

/**
 * The project, its milestones and its tasks, read from the database on the
 * project id alone. The client used to send this whole object; it now names
 * only which project, so a crafted body can neither invent milestones nor aim
 * the git reads at an arbitrary repo on this Mac.
 */
async function loadProjectSnapshot(projectId: string): Promise<ProjectSnapshot | null> {
  const data = await loadAll();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return {
    project: { ...project, repoPath: linkedRepoPathFor(projectId, data.projects) },
    milestones: data.milestones.filter((m) => m.projectId === projectId),
    tasks: data.tasks.filter((t) => t.linkKind === "project" && t.linkId === projectId),
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return apiError("agent_unconfigured", 503);

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", 400);
  }

  if (!body.projectId) return apiError("missing_project", 400);
  if (!body.messages?.length) return apiError("missing_messages", 400);

  let spec: AgentSpec;
  try {
    spec = await getAgent(body.agentId ?? DEFAULT_AGENT);
  } catch (err) {
    // AgentNotFound means the id genuinely doesn't exist. Anything else — a
    // readdir failure, a malformed .md, a loadOverrides DB error — is a real
    // server failure and must not be relabeled "not found" with an empty
    // console. apiError only logs when passed a cause.
    if (err instanceof AgentNotFound) return apiError("agent_not_found", 404);
    return apiError("agent_failed", 502, err);
  }

  let snapshot: ProjectSnapshot | null;
  try {
    snapshot = await loadProjectSnapshot(body.projectId);
  } catch (err) {
    // A whole-DB read failing is a server failure, not a tool failure: every
    // answer this turn would be about a project we cannot see.
    return apiError("agent_failed", 502, err);
  }
  if (!snapshot) return apiError("project_not_found", 404);

  // Best-effort, for the state block only. A missing or unreadable repo must
  // never fail the request — git is never load-bearing.
  let repo: RepoStatus | null = null;
  let commits: Commit[] = [];
  const { repoPath } = snapshot.project;
  if (repoPath) {
    const { readStatus, readCommits } = await import("@/lib/git/repo");
    [repo, commits] = await Promise.all([
      readStatus(repoPath).catch(() => null),
      readCommits(repoPath, { limit: 30 }).catch(() => [] as Commit[]),
    ]);
  }

  const ctx: AgentContext = {
    today: new Date().toISOString().slice(0, 10),
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services: body.context?.services || "",
    // Read-side CRM context is not granted on this surface: no project agent
    // declares `crm`, so nothing here resolves against an AdvisorSnapshot.
    snapshot: null,
    projectSnapshot: snapshot,
    proposals: [],
    emailEnabled: false,
    calendarEnabled: false,
    driveAccountId: null,
  };

  const stateBlock = buildProjectStateBlock({
    project: snapshot.project,
    milestones: snapshot.milestones,
    tasks: snapshot.tasks,
    repo,
    commits,
    businessName: ctx.businessName,
    founderName: ctx.founderName,
    today: ctx.today,
  });

  try {
    const result = await runAgent({
      spec: { ...spec, body: `${renderBody(spec.body, ctx)}\n\n${stateBlock}` },
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
      ctx,
      client: new Anthropic({ apiKey }),
    });
    return NextResponse.json({
      content: result.content || "I couldn't produce a response — try rephrasing.",
      actions: result.proposals,
      stoppedBy: result.stoppedBy,
    });
  } catch (err) {
    return apiError("agent_failed", 502, err);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green. The client (`projectClient.ts`) still sends `snapshot` at this point and will get a 400 in the browser — Task 6 fixes that. Do not ship without Task 6.

- [ ] **Step 5: Run the mutants**

1. In the route, change `loadProjectSnapshot` to `return body.snapshot as ProjectSnapshot` (casting through `any` if needed). Expected: the "ignores a client-supplied snapshot" test FAILS. Revert.
2. Change `projectSnapshot: snapshot` to `projectSnapshot: null`. Expected: the "grants the nine delivery tools" test FAILS with an empty tool list. Revert.
3. Swap the concatenation order to `${stateBlock}\n\n${renderBody(...)}`. Expected: the ordering assertion FAILS. Revert.
4. Change `if (!snapshot) return apiError("project_not_found", 404)` to `502`. Expected: the 404 test FAILS. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/chat/route.ts src/app/api/projects/chat/route.test.ts
git commit -m "refactor(projects): run project chat on the shared agent runtime

The last route with its own tool-use loop. Context is now assembled
server-side from a projectId — the browser names which project, never
what is in it."
```

---

### Task 6: The client — `flush()`, `projectId`, and the stop notice

**Files:**
- Modify: `src/lib/store.tsx:145-171` (add `flush`), and the context type/value it exports
- Modify: `src/lib/projects/projectClient.ts` (whole file)
- Modify: `src/components/projects/ProjectChat.tsx:15,99-106,119-124,170-179`
- Test: `src/lib/projects/projectClient.test.ts` (create)

**Interfaces:**
- Consumes: the route contract from Task 5 — `{ projectId, messages, context }` in, `{ content, actions, stoppedBy }` out.
- Produces: `sendProjectMessage(req: ProjectChatRequest): Promise<ProjectChatReply>` where `ProjectChatRequest` carries `projectId: string` and `ProjectChatReply` carries `stoppedBy?: AgentStopReason`. `useStore()` gains `flush(): Promise<void>`.

**Why `flush` is here and not its own task.** It is eight lines inside a React context that `vitest.config.ts` cannot load (no DOM library, `.test.tsx` excluded). It is verified in the browser alongside the component that needs it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/projects/projectClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendProjectMessage } from "./projectClient";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const ok = (json: unknown) => ({ ok: true, json: async () => json });

describe("sendProjectMessage", () => {
  it("sends a projectId and no snapshot", async () => {
    fetchMock.mockResolvedValue(ok({ content: "hi", actions: [], stoppedBy: "end" }));
    await sendProjectMessage({
      projectId: "p1",
      messages: [{ role: "user", content: "status?" }],
      context: { businessName: "Pallisade", founderName: "Emil" },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.projectId).toBe("p1");
    expect(body).not.toHaveProperty("snapshot");
  });

  it("carries the stop reason through so the UI can say the answer was cut short", async () => {
    fetchMock.mockResolvedValue(ok({ content: "partial", actions: [], stoppedBy: "max_iterations" }));
    const reply = await sendProjectMessage({
      projectId: "p1",
      messages: [{ role: "user", content: "status?" }],
      context: { businessName: "P", founderName: "E" },
    });
    expect(reply.stoppedBy).toBe("max_iterations");
  });

  it("throws the server's error code so the component can match on it", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "agent_unconfigured" }) });
    await expect(sendProjectMessage({
      projectId: "p1",
      messages: [{ role: "user", content: "hi" }],
      context: { businessName: "P", founderName: "E" },
    })).rejects.toThrow("agent_unconfigured");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/projects/projectClient.test.ts`
Expected: FAIL — `ProjectChatRequest` has no `projectId`, and `ProjectChatReply` has no `stoppedBy`.

- [ ] **Step 3: Rewrite `projectClient.ts`**

```ts
import type { ProposedAction } from "@/lib/types";
import type { AgentStopReason } from "@/lib/agents/types";

export interface ProjectChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  /** Which project — never what is in it. The route reads the rest from the DB. */
  projectId: string;
  context: { businessName: string; founderName: string };
}

export interface ProjectChatReply {
  content: string;
  actions: ProposedAction[];
  stoppedBy?: AgentStopReason;
}

export async function sendProjectMessage(req: ProjectChatRequest): Promise<ProjectChatReply> {
  const res = await fetch("/api/projects/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "request_failed");
  return { content: json.content ?? "", actions: json.actions ?? [], stoppedBy: json.stoppedBy };
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

- [ ] **Step 4: Add `flush()` to the store**

In `src/lib/store.tsx`, add the callback near the other exported store operations, and include `flush` in the context value and its type:

```tsx
  /**
   * Persist immediately instead of waiting out the 450ms debounce above.
   * A surface that asks the server to read the DB (project chat) must flush
   * first, or the agent answers from a database that is up to a second stale —
   * the sequence that bites is confirm-a-proposal then ask-what's-next.
   *
   * Carries the same guard as the beforeunload flush: never persist an
   * unhydrated (empty) state, which would wipe a populated remote DB.
   */
  const flush = useCallback(async () => {
    if (!hydratedOk.current || !adapterRef.current) return;
    await adapterRef.current.save(data);
  }, [data]);
```

- [ ] **Step 5: Update `ProjectChat.tsx`**

Four changes:

Import the stop notice and its type:

```tsx
import { stopNotice } from "@/lib/agents/stopNotice";
import type { AgentStopReason } from "@/lib/agents/types";
```

Flush before sending, and send a `projectId` (replacing the `snapshot` argument at lines 99-106):

```tsx
      // The route reads milestones and tasks from the DB. Flush first, or a
      // change made in the last 450ms is invisible to the agent.
      await store.flush();
      const reply = await sendProjectMessage({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        projectId: project.id,
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
        },
      });
```

Match the new error code (line 121):

```tsx
        (err as Error).message === "agent_unconfigured"
          ? "No ANTHROPIC_API_KEY set — add one to .env.local and restart."
          : "That didn't go through. Try again.",
```

Render the notice. Store `reply.stoppedBy` in component state alongside `error`, and render it under the message list:

```tsx
  const [stopped, setStopped] = useState<AgentStopReason | null>(null);
```

set `setStopped(reply.stoppedBy ?? null)` after a successful reply and `setStopped(null)` at the top of `send()`, then below the messages:

```tsx
        {stopNotice(stopped) && (
          <p className="text-[0.78rem] text-[var(--color-dim)]">{stopNotice(stopped)}</p>
        )}
```

The `milestones` and `tasks` props are no longer sent to the server, but they are still used for local rendering — leave the component's props alone.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, full suite green.

- [ ] **Step 7: Run the mutants**

1. In `projectClient.ts`, drop `stoppedBy` from the returned object. Expected: the stop-reason test FAILS. Revert.
2. In `projectClient.ts`, change `throw new Error(json.error ?? …)` to `throw new Error("request_failed")`. Expected: the error-code test FAILS. Revert.

- [ ] **Step 8: Verify in the browser**

The `.tsx` changes have no unit coverage by design. Run `npm run dev`, open a project with at least one milestone, and check four things:

1. Ask "what's the plan?" — the agent answers with real milestone names.
2. Ask "add a task to chase the API key" — a proposal card appears; confirming it creates the task.
3. Immediately after confirming, ask "what's on this project now?" — the new task appears in the answer. This is the flush working; without it the agent misses it.
4. Ask something with no key set in `.env.local` — the message reads "No ANTHROPIC_API_KEY set", not "That didn't go through".

- [ ] **Step 9: Commit**

```bash
git add src/lib/store.tsx src/lib/projects/projectClient.ts src/lib/projects/projectClient.test.ts src/components/projects/ProjectChat.tsx
git commit -m "feat(projects): send a projectId, flush before asking, and surface truncated turns"
```

---

### Task 7: Whole-branch verification

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Full verification**

Run each and record the actual output:

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: all three clean. The suite should be at 1011 tests plus roughly 35 added here.

- [ ] **Step 2: Confirm the route is genuinely off its own loop**

```bash
grep -n "MAX_ITERATIONS\|stop_reason\|messages.create" src/app/api/projects/chat/route.ts
```

Expected: no matches. If any remain, a fragment of the old loop survived.

- [ ] **Step 3: Confirm the collision is gone in both directions**

```bash
grep -rn "SERVER_TOOL_NAMES" src/lib/projects/
grep -rn "\"create_task\"\|\"update_task\"" src/lib/projects/
```

Expected: the first prints nothing; the second prints nothing (`applyAction.ts` keeps the old names, but it is not under `src/lib/projects/`).

- [ ] **Step 4: Confirm no test touched the real database**

```bash
sqlite3 data/pallisade.db "select 'leads', count(*) from leads union all select 'quotes', count(*) from quotes union all select 'projects', count(*) from projects union all select 'milestones', count(*) from milestones;"
```

Expected: leads 11, quotes 3, projects 5, milestones 7. Row counts, not a checksum — a checksum flags a harmless chat thread and a wiped table identically.

- [ ] **Step 5: Commit any fixes and update the status file**

Write `docs/superpowers/plans/2026-08-17-projects-chat-migration-STATUS.md` recording, per task: what was built, which mutants were run and what they proved, and every defect found in review. The prior branch caught 14 real defects, 11 of them in the plan rather than the implementation — record where each one was caught, because that ratio is the argument for where review effort goes next time.

```bash
git add docs/superpowers/plans/2026-08-17-projects-chat-migration-STATUS.md
git commit -m "docs(projects): status for the project chat migration"
```
