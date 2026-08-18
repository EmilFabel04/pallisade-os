# Projects chat migration

**Date:** 2026-08-17
**Status:** approved

Follow-up #0 from `2026-08-13-agent-registry-tool-bus-design.md` §"Out of scope". That spec
deferred this route with a stated reason; §"Why Projects chat is deferred" is the problem
statement this design answers.

## Problem

`api/projects/chat` (147 lines) is the last conversational surface running its own copy of
the tool-use loop. Advisor and Brain were migrated onto `runAgent()`; this route still
builds its own system prompt, assembles its own tool array, and runs its own
`stop_reason === "tool_use"` cycle.

Three things block a straight migration. The first two were known on 2026-08-14. The third
was found on 2026-08-17 while designing this spec, and is the reason the migration is not
a rename.

**1. The tool sets are disjoint.** The `projects` capability group grants
`PROJECT_CONTEXT_TOOLS` — `list_projects` and `get_project_context`, both cross-project and
read-only. Projects chat uses `PROJECT_TOOLS` (`src/lib/projects/tools.ts:29-71`): nine
tools scoped to *one* project. Declaring `projects` on a project agent would strip it of
every tool it actually uses.

**2. `AgentContext` carries no project.** `PROJECT_TOOLS` resolve against a
`ProjectSnapshot` (project + milestones + tasks). `AgentContext`
(`src/lib/agents/types.ts:49-59`) holds an `AdvisorSnapshot` and nothing project-shaped.

**3. `create_task` and `update_task` exist in both tool sets.** `advisor/tools.ts:53,75`
defines CRM-wide versions where the model supplies `linkKind`/`linkId`;
`projects/tools.ts:54,59` defines project-scoped versions where `resolveProjectTool`
injects `linkKind: "project"` and the snapshot's own `projectId`. Different schemas,
different resolvers, different snapshot types, identical names.

This matters because `dispatch()` (`capabilities.ts:71-98`) routes a tool call purely by
name-set membership in a fixed if-chain. It therefore assumes tool names are globally
unique — an assumption written nowhere and tested nowhere. `sales-advisor` already declares
both `writes` and `projects`, so the assumption holds today only because the *project*
group happens not to be the one carrying the colliding names. Adding `PROJECT_TOOLS` to the
bus breaks it: `create_task` would route to the CRM resolver against an `AdvisorSnapshot`
that a project surface does not have.

There is also the name collision the prior spec flagged: `projects/tools.ts:27` exports
`SERVER_TOOL_NAMES = new Set(["read_repo_status", "read_commits"])` meaning *resolved by an
async server-side resolver, and does receive a `tool_result`*
(`projects/chat/route.ts:128-131`). `capabilities.ts:35` uses the same identifier to mean
*executed by Anthropic, and must not receive one* (`runtime.ts:61-64`). Conflating them
hangs the agent.

## Decisions

**A new `delivery` capability group, not `project`.** One character from the existing
`projects` is a footgun in a string union, and `projects` already means the opposite thing.
`delivery` names what the group is for: the milestones, tasks, repo state and project edits
of the one project whose thread the agent is in.

**`grantsFor("delivery", ctx)` returns `[]` when `ctx.projectSnapshot` is null.** The
handover records "a capability granted but not wired" as a failure mode this codebase has
produced twice — a tool appears in the list the model receives and then answers every call
with an error. Gating the grant on the context that backs it closes that by construction
rather than by assertion.

**Rename the colliding tools rather than order the if-chain around them.**
`create_task` → `create_project_task`, `update_task` → `update_project_task`, in
`PROJECT_TOOLS` only. Making the names globally unique turns the bus's unspoken assumption
into a true one. Disambiguating by if-chain order instead would leave a routing bug that is
correct only while nobody reorders the chain — precisely the class of defect the prior
branch produced eleven times.

**Delete `projects/tools.ts:27`, do not rename it.** Once `dispatch` owns routing, nothing
reads that set. `resolveProjectTool` becomes `async` and resolves the two git tools
internally through a dynamic `await import("@/lib/git/repo")`, the pattern
`resolveProjectContextTool` already uses (`projectContext.ts:110-111`). The bus then has a
single project entry point, and the inverted meaning of `SERVER_TOOL_NAMES` has nowhere to
come back to.

**`repo` stays `[]`.** Moving `read_repo_status`/`read_commits` into it was considered and
rejected: scoped this way, `repo` would mean "the current project's linked repo" and would
resolve to nothing on the brain surface — shipping failure mode #2 deliberately. `repo`
keeps its own follow-up spec.

**Context is assembled server-side.** The client sends `projectId`; the route loads
project, milestones and tasks from `loadAll()`. This generalises what `storedRepoPath`
(`projects/chat/route.ts:29-36`) already does for the repo path alone, and it is the
property the registry design rests on: the browser names which project, never what is in
it.

## Capability groups after this change

| Group | Backed by | Status |
| --- | --- | --- |
| `crm` | `READ_TOOLS` | unchanged |
| `email` | `EMAIL_TOOLS` | unchanged |
| `calendar` | `CALENDAR_READ_TOOLS` | unchanged |
| `drive` | `DRIVE_TOOLS` | unchanged |
| `projects` | `PROJECT_CONTEXT_TOOLS` — cross-project, read-only | unchanged |
| `web` | `web_search` | unchanged |
| `writes` | CRM mutations + `create_calendar_event` | unchanged |
| `delivery` | `PROJECT_TOOLS` — one project, reads and mutations | **new** |
| `repo` | read a linked repo's files | still `[]` |
| `fathom` | past meeting summaries | still `[]` |

`delivery` grants nine tools: `list_milestones`, `list_tasks`, `read_repo_status`,
`read_commits`, `create_milestone`, `update_milestone`, `create_project_task`,
`update_project_task`, `update_project`.

Reads and mutations sit in one group. The project mutations are confirm-gated proposals
like every other write, and `agentOverrides` has no `tools` column, so a Settings edit
cannot widen the grant. A read-only project agent is not expressible after this change;
that is accepted until something needs one.

## Components

**`src/lib/agents/types.ts`** — `AgentContext` gains
`projectSnapshot: ProjectSnapshot | null`. Type-only import from
`@/lib/projects/tools`.

**`src/lib/agents/capabilities.ts`** — `grantsFor` gains the `delivery` case, gated on
`ctx.projectSnapshot`. `dispatch` gains a `PROJECT_TOOL_NAMES` branch that throws
`no project in context for this tool` when `ctx.projectSnapshot` is null, so the
never-reachable path still fails legibly rather than by dereferencing null.

**`src/lib/projects/tools.ts`** — `SERVER_TOOL_NAMES` deleted. `PROJECT_TOOL_NAMES`
exported. Two tools renamed. `resolveProjectTool` becomes `async` and gains the
`read_repo_status`/`read_commits` cases, reading `snap.project.repoPath` and returning
`"No repo is linked to this project."` when it is null — the same string the route returns
today, so the model's behaviour on an unlinked project does not change.

**`src/agents/project-agent.md`** — new. `surface: project`, `tools: [delivery]`. Carries
the "HOW YOU WORK" half of `buildProjectSystemPrompt` (`prompt.ts:84-96`), with the two
renamed tools. Becomes editable in Settings, which already queries `surface=project` and
gets an empty roster today.

**`src/lib/projects/prompt.ts`** — `buildProjectSystemPrompt` keeps the factual state
block (project state, milestones, open tasks, repo, commits), loses the persona half, and
is renamed `buildProjectStateBlock`. It no longer builds a system prompt and a name that
says it does would be the only remaining lie about where the persona lives. The route
appends its output after the rendered persona body, the shape `brain/route.ts:136-138` uses
for attachments. `PROMPT_BUDGET` still applies to the state block.

**`src/app/api/projects/chat/route.ts`** — rewritten to the shape of the other two: resolve
spec → assemble context → `runAgent` → `{ content, actions, stoppedBy }`. Its
`resolveServerTool` closure and its loop are deleted.

**`src/lib/advisor/applyAction.ts`** — gains `case "create_project_task"` and
`case "update_project_task"` alongside the existing ones. The old cases stay: proposals
already persisted in `projectThreads` carry the old tool string, and dropping them would
make a still-pending confirm button silently do nothing.

**`src/lib/store.tsx`** — exposes `flush(): Promise<void>` on the store context, awaiting
`adapterRef.current.save(data)`. It carries the same `hydratedOk.current` guard as the
`beforeunload` flush (`store.tsx:161`) and resolves without saving when hydration failed —
without it, `flush()` becomes a second way to persist an empty state over a populated
remote DB, which is the one thing that file is most careful about.

**`src/lib/projects/projectClient.ts`** — `ProjectChatRequest` sends `projectId` instead of
`snapshot`. `ProjectChatReply` gains `stoppedBy`.

**`src/components/projects/ProjectChat.tsx`** — awaits `store.flush()` before sending,
sends `projectId`, renders `stopNotice(stoppedBy)`, and matches `agent_unconfigured`
instead of the literal `"no_key"` at line 121.

## Data flow

A turn, after the change:

1. `ProjectChat.send()` writes the user message to `projectThreads`, awaits `store.flush()`,
   and posts `{ projectId, messages, context }`.
2. The route resolves `body.agentId ?? "project-agent"` through `getAgent`, mapping
   `AgentNotFound` to 404 and anything else to 502-with-cause, exactly as
   `brain/route.ts:92-102` does. The client never sends `agentId`; the route accepts it so
   that adding a second project persona later is a roster change, not a route change.
3. It loads `project`, `milestones`, `tasks` from `loadAll()`, keyed on `projectId`, and takes
   `repoPath` from the stored project. A missing project is a 404.
4. It builds `ctx` with `projectSnapshot` set and `snapshot: null` — no `delivery` tool reads
   an `AdvisorSnapshot`.
5. `renderBody(spec.body, ctx)` substitutes `today`/`businessName`/`founderName`/`services`;
   the state block from `buildProjectSystemPrompt` is appended after it.
6. `runAgent` runs the loop. `dispatch` routes the nine tools to `resolveProjectTool`.
   Mutations push onto `ctx.proposals`.
7. The route returns `{ content, actions: result.proposals, stoppedBy: result.stoppedBy }`.
8. `ProjectChat` persists the assistant message with its `actions`, and renders the stop
   notice when `stoppedBy !== "end"`. Confirm still runs `applyAction` client-side.

**The debounce race.** The store persists on a 450ms timer (`store.tsx:149`), so a
server-loaded snapshot can miss a change made moments earlier. The sequence that bites is
confirm-a-proposal-then-ask-what's-next, which is natural enough to matter. `store.flush()`
before send closes it. `get_project_context` and `storedRepoPath` have this race today and
keep it; only the project surface is fixed here.

## Error handling

| Condition | Response | Notes |
| --- | --- | --- |
| No `ANTHROPIC_API_KEY` | `agent_unconfigured`, 503 | was `no_key`; aligns with the two migrated routes |
| Unparseable body | `bad_request`, 400 | unchanged |
| No `projectId` | `missing_project`, 400 | replaces `missing_snapshot` |
| No messages | `missing_messages`, 400 | unchanged |
| `projectId` matches nothing | `project_not_found`, 404 | new; previously unreachable |
| Agent id unknown | `agent_not_found`, 404 | `AgentNotFound` only |
| Registry or DB failure | `agent_failed`, 502, cause logged | passing the cause is what makes it log |
| Upstream failure | `agent_failed`, 502, cause logged | was `UPSTREAM_FAILED` |
| Tool failure | `{"error": …}` to the agent | `dispatch` catches; the turn continues |
| Repo unreadable | prose to the agent | not an error; git is never load-bearing |
| Iteration or token cap | 200, partial text, `stoppedBy` | rendered by `stopNotice` |

`ProjectChat.tsx:121` matches the error string and must change with the first row.

## Testing

The handover records two failure modes this codebase reliably produces: an assertion that
passes against the thing it is meant to detect, and a capability granted but not wired.
Both are addressed by named tests, and every one below must be run against its mutant
(`scripts/mutate.sh`) before it counts.

**Group disjointness.** For every pair of `CAPABILITY_GROUPS`, the granted tool-name sets
are disjoint. The fixture must have every integration enabled *and* `projectSnapshot` set —
with either absent, `email`, `calendar` and `delivery` grant `[]` and the test passes by
being blind, which is failure mode #1 exactly. This test fails before the rename and is the
entry point for it.

**Each `delivery` tool returns data.** Against a populated fixture, each of the nine tools
is asserted to return a payload containing a known value — not merely to appear in
`toolsFor`. The handover names this as the assertion `repo` and `fathom` will need; it is
written here first, where there is a working implementation to check it against.

**The grant is gated.** `toolsFor(["delivery"], ctx)` with `projectSnapshot: null` returns
`[]`, and `dispatch("list_milestones", …)` in that state returns an error mentioning the
missing project rather than throwing.

**Renamed tools route correctly.** `dispatch("create_task", …)` with `writes` granted still
reaches the CRM resolver; `dispatch("create_project_task", …)` reaches the project resolver
and injects the snapshot's own `projectId`. A mutant that swaps the two branches must fail.

**`applyAction` accepts both generations.** A proposal with `tool: "create_task"` and
`linkKind: "project"` still applies, and one with `tool: "create_project_task"` applies
identically.

**Regression guard.** Importing `SERVER_TOOL_NAMES` from `@/lib/projects/tools` fails, in
the shape of the existing `noMock.test.ts` guard.

**Prompt composition.** The rendered body contains no unsubstituted `{{` token, and the
appended state block contains the project's milestones.

Tests are colocated `src/**/*.test.ts`, `environment: "node"`. No test may touch
`data/pallisade.db` — redirect `TURSO_DATABASE_URL` to a temp file in `beforeAll` (see
`overrides.test.ts`) or mock the module (see `roster.test.ts`), and verify by row counts,
not by file checksum.

## Out of scope

- **An agent picker on the project surface.** One agent, no picker; the client sends no
  `agentId`. `listAgents("project")` will return one card and Settings will render it.
- **Widening the project agent's tools** to `crm`, `email` or `calendar`. Ruled out
  2026-08-17: this is a plumbing migration, and behaviour should be identical on the other
  side of it.
- **`repo` and `fathom` tools.** Unchanged by this spec; both still `[]`.
- **The debounce race on `get_project_context` and `storedRepoPath`.** Both keep it.
- **`api/prep`.** Still a one-shot forced-`tool_choice` generator; it joins the registry when
  Meeting Prep is rebuilt.
