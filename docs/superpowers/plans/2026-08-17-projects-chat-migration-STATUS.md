# Projects Chat Migration — Status and Outstanding Work

**As of:** 2026-08-17
**Branch:** `feat/projects-chat-migration`
**Plan:** [2026-08-17-projects-chat-migration.md](2026-08-17-projects-chat-migration.md)
**Spec:** [../specs/2026-08-17-projects-chat-migration-design.md](../specs/2026-08-17-projects-chat-migration-design.md)

All 7 tasks are complete. This file records what each task built, the mutation sweep,
every real defect the branch's reviews found, and what is deliberately left for the
founder to verify by hand.

## Where it stands

Suite: **1048 tests passing** (99 files; baseline before this branch was 1011). `tsc
--noEmit` clean. Production build passes. Zero surviving mutants across a 24-mutant sweep
spread over six tasks. Real production database (`data/pallisade.db`) untouched
throughout — row counts verified before and after the full gate run: leads 11, quotes 3,
projects 5, milestones 7, file mtime unchanged (`Aug 14`, three days before this branch's
first commit).

The plan predicted "1011 tests plus roughly 35 added here" (~1046); actual growth was
+37, landing at 1048. Recorded as observed, not adjusted to fit the estimate.

| Task | State |
| --- | --- |
| 1 · `projectSnapshot` on `AgentContext` + gated `delivery` grant | ✅ complete |
| 2 · Make tool names globally unique | ✅ complete |
| 3 · `resolveProjectTool` absorbs the git tools; delete `SERVER_TOOL_NAMES` | ✅ complete |
| 4 · The `project-agent` persona and the state-block split | ✅ complete, 2 fix rounds |
| 5 · Rewrite the route onto `runAgent` | ✅ complete, 1 fix round |
| 6 · Client — `flush`, `projectId`, stop notice | ✅ complete |
| 7 · Whole-branch verification | ✅ this document |

## Per task

### Task 1 — `projectSnapshot` on `AgentContext` + gated `delivery` grant

Commits `33be18b..fed1808`. `AgentContext` gained `projectSnapshot: ProjectSnapshot |
null`; `CAPABILITY_GROUPS` gained `"delivery"`; `grantsFor` gained `case "delivery":
return ctx.projectSnapshot ? PROJECT_TOOLS : []` — closing the "capability granted but
not wired" failure mode (named in the prior branch's STATUS doc) by construction rather
than by a later assertion. Five other `AgentContext` construction sites needed the new
field; `tsc` named all five, no guessing.

**Mutants (2, both killed):** dropping the gate (`return PROJECT_TOOLS` unconditionally)
failed "grants nothing when no project is in context"; granting the wrong tool set
(`PROJECT_CONTEXT_TOOLS` instead of `PROJECT_TOOLS`) failed the length assertion on the
positive case. Both proved the gate is load-bearing, not decorative.

**Review:** clean, Approved, no findings.

### Task 2 — Make tool names globally unique

Commits `fed1808..04f503b`. Renamed the two colliding `PROJECT_TOOLS` entries
(`create_task`→`create_project_task`, `update_task`→`update_project_task`) so
`dispatch()`'s name-based if-chain — which assumes tool names are globally unique, an
assumption written nowhere and tested nowhere before this task — becomes actually true.
Added a permanent disjointness test over every pair of `CAPABILITY_GROUPS`.
`applyAction.ts` gained cases for both new names while keeping the old ones, so proposals
already persisted in `projectThreads` under the old names still apply.

**Mutants (3, all killed):** reverting the rename in `tools.ts` alone (leaving the
resolver case renamed) re-opened the clash; blinding the disjointness fixture's
`projectSnapshot` back to `null` caught `delivery` silently dropping out of the check
(the exact "assertion that passes against the thing it's meant to detect" failure mode);
deleting the `create_task` fall-through in `applyAction.ts` failed the pre-rename
proposal test.

**Review:** clean, Approved. One reviewer question (does `dispatch()` need a
`PROJECT_TOOL_NAMES` branch yet?) resolved as not a Task 2 gap — Task 3 adds it by
design, per the plan.

### Task 3 — `resolveProjectTool` absorbs the git tools; delete `SERVER_TOOL_NAMES`

Commits `04f503b..86c73fa`. Deleted `SERVER_TOOL_NAMES` — the name `capabilities.ts`
already used for the *opposite* meaning (Anthropic-executed, no `tool_result`, vs. this
set's server-resolved, receives a `tool_result`), which the spec flagged as a hang risk
if the two ever collided. `resolveProjectTool` became `async` and absorbed
`read_repo_status`/`read_commits` internally via the same dynamic-import pattern
`resolveProjectContextTool` already used. `dispatch()` gained the `PROJECT_TOOL_NAMES`
branch, with a defensive throw (`no project in context for this tool`) that stays
unreachable while `grantsFor` gates on the same field — a resolver that would otherwise
dereference `null` silently if a future surface ever got this wrong.

**Mutants (4, all killed):** removing the no-repo-linked guard broke JSON parsing on both
git-data tests; deleting the `dispatch()` branch failed 8 of 9 "answers with data" tests
(the 9th, CRM routing, is correctly unaffected — the brief's own wording claimed "every
test," which is 8 of 9); passing the wrong snapshot type to `resolveProjectTool` failed 7
of 8 tests reaching real data (the missing-project test is unaffected by design — its
guard fires first); re-adding `SERVER_TOOL_NAMES` failed only the regression guard.

**Review:** clean, Approved, no findings.

### Task 4 — The `project-agent` persona and the state-block split

Initial commit `154571f`; fix rounds `ebd5465`, `f2894a6`. New `src/agents/project-agent.md`
(`surface: project`, `tools: [delivery]`) carries the persona half of the old prompt.
`buildProjectSystemPrompt` renamed to `buildProjectStateBlock`, stripped to only the
factual state block (project, milestones, tasks, repo, commits) — the route now
concatenates persona + state block, the shape `brain/route.ts` already uses for
attachments.

**Mutants (7 total across the original pass and both fix rounds, all killed):** wrong
capability group in frontmatter; CRM tool names instead of the renamed project ones;
`HOW YOU WORK:` reappearing in the state block; an unrenderable placeholder; deleting
`{{today}}`; deleting "never claim it is already done"; deleting "never invent... — each
turned exactly its target test red.

**Review:** Approved with 1 Important finding, fixed across 2 rounds — see the defect
table below. One deferred minor pulled forward into the fix round anyway (see below).

### Task 5 — Rewrite the route onto `runAgent`

Initial commit `2d4a46d`; fix round `9f82d1e`. `src/app/api/projects/chat/route.ts` fully
rewritten onto the shape the other two AI surfaces already use: resolve spec → assemble
context → `runAgent` → `{content, actions, stoppedBy}`. Accepts `{projectId, messages,
agentId?, context?}` — the client-supplied `snapshot` is gone; the route loads project,
milestones and tasks from the DB by `projectId` alone, so a forged client body cannot
invent facts the agent then states as true. New error codes: `agent_unconfigured` (was
`no_key`), `missing_project` (was `missing_snapshot`), `project_not_found` (new,
previously unreachable).

**Mutants (6 total across the original pass and the fix round, all killed):** trusting a
client-supplied snapshot over the DB read; ungating `projectSnapshot` from the context;
swapping persona/state-block concatenation order; turning `project_not_found` into a 502;
partial-trust of client-supplied milestones/tasks even with the project itself DB-sourced
(fix round); dropping the `cause` argument from a 502 (fix round).

**Review:** Needs fixes, 2 Important findings, both fixed in 1 round — see the defect
table below. Route implementation itself confirmed correct by the reviewer: a crafted
request body cannot invent milestones or tasks, and cannot aim the git reads anywhere
(the read tools take no path argument).

### Task 6 — Client: `flush`, `projectId`, the stop notice

Commit `c4734c9`. `projectClient.ts` sends `projectId`, reads `stoppedBy` back.
`store.tsx` gained a guarded `flush()` — same `hydratedOk.current` guard as the existing
`beforeunload` flush, plus a null-check on the adapter — so the client can force a write
before asking, closing the debounce race the spec named (confirm a proposal, then ask
"what's next," inside the 450ms window). `ProjectChat.tsx` awaits `flush()` before
sending, renders the stop notice via `stopNotice(stoppedBy)`, and matches the route's
real `agent_unconfigured` code instead of the never-matching literal `"no_key"`.
`ActionCard.tsx`'s icon map gained entries for `create_project_task`/
`update_project_task`, closing a gap Task 2's rename left open (see deferred minors).

**Mutants (2, both killed):** dropping `stoppedBy` from the client's returned object
failed the stop-reason test; collapsing the thrown error to a constant string failed the
error-code test.

**Review:** clean, Approved, no Critical/Important.

### Task 7 — Whole-branch verification (this task)

No production code changed. Ran `tsc --noEmit` (clean), `npx vitest run` (99 files, 1048
tests, all passing), `npm run build` (clean, `/api/projects/chat` and `/projects/[id]`
both present as expected dynamic routes), the two greps confirming the old loop and the
name collision are gone, and the DB row-count check (exact match, before and after the
full gate run). Full verbatim output of every command is in
`.superpowers/sdd/2026-08-17-projects-chat-migration/task-7-report.md`. One grep
(`SERVER_TOOL_NAMES` under `src/lib/projects/`) printed 3 lines against a plan prediction
of none — all three are prose (a doc comment and a test's own title/comment explaining
the deletion), not a live symbol; confirmed independently via `tsc` (clean) and the
passing regression test that asserts the export doesn't exist. Treated as a plan-wording
imprecision, not a functional finding — no code touched.

## Defect table

Four real defects were found across the branch's six review passes (Tasks 1, 2, 3 and 6
reviewed clean with no Important/Critical findings). "Caught where" follows the same
test the prior branch's STATUS doc used: **plan** means the review found the plan's own
text — a prescribed code sample, or the test code specifying what to assert — was wrong;
**implementation** would mean a reviewer found working code that departed from a correct
plan.

| # | Found in | Defect | Caught where | Fixed in |
| --- | --- | --- | --- | --- |
| 1 | Task 4 | Renaming `buildProjectSystemPrompt`→`buildProjectStateBlock` deleted 7 persona-instruction assertions from `prompt.test.ts` (correctly — that content moved to the persona file) but re-asserted none of them in `projectAgent.test.ts`. Deleting the persona instructions from `project-agent.md` left the whole suite green. The one placeholder test that touched the persona body passed vacuously against a body with zero `{{...}}` tokens. | Plan — test code | `ebd5465`, `f2894a6` |
| 2 | Task 4 | `buildProjectStateBlock` printed the project's company twice: `PROJECT: Acme Dashboard · Acme — a paid project for Acme`. The conditional `${p.company ? \` · ${p.company}\` : ""}` suppressed the first mention only when company was unset, but `dash(p.company)` always rendered the second. | Plan — the brief's own Step 4 code sample carried this line verbatim; the coordinator's own words: "I authored the defect in the plan." | `ebd5465` |
| 3 | Task 5 | The "ignores a client-supplied snapshot" test posted a forged project name plus `milestones: []`/`tasks: []`, then asserted only on the project name. `buildProjectStateBlock` prints `MILESTONES:\n  (none yet)` unconditionally for an empty list, so a partial-trust bug — real project, forged milestones/tasks — would have passed all 12 tests. | Plan — test code | `9f82d1e` |
| 4 | Task 5 | Both 502 tests asserted `status` and the JSON `error` code only, not that the `cause` reached `console.error`. Dropping the third argument at any of the three `apiError(..., 502, err)` call sites — the exact thing the branch's logging rule exists to guarantee — would have shipped with every test green. | Plan — test code | `9f82d1e` |

**Ratio: 4 of 4 defects (100%) were in the plan; 0 of 4 (0%) were in the implementation.**
The prior branch's ratio was 11 of 14 (79%) in the plan. This branch is more concentrated
in the same direction: every review pass that found something found it in a test file's
assertions or in code the brief specified verbatim, never in a case where the
implementer built something the plan didn't ask for. Both reviewers independently traced
the actual route/tool logic on Tasks 4 and 5 and confirmed it correct — the code the
implementers wrote from the plan's own instructions worked; the plan's instructions were
twice incomplete about what to test, and once wrong about what to print. The argument
holds again: review effort on this codebase belongs on the plan's prose and the test
code it specifies, not on auditing whether an implementer followed instructions — they
do.

## Deferred minors (carried forward, not lost)

None of the following blocks. Grouped by the task that surfaced them.

**Task 1**
- Mutant 2 was applied as a gated variant rather than the brief's literal unconditional
  return; outcome identical for the exercised test.
- `task-1-report.md`'s self-review section contains visible second-guessing noise about
  the `git add` file list; the staged file set itself is correct.

**Task 2**
- ~~`ActionCard.tsx`'s `ICON` map had no entry for `create_project_task`/
  `update_project_task`~~ — real, caused by this task's rename, ruled Minor and carried
  into Task 6's dispatch (the only other UI-touching task). **Closed in Task 6**
  (`c4734c9`).

**Task 3**
- `tools.ts:104-114`'s git-read catch branch has no test forcing a throw; deleting the
  catch would fail nothing. Behaviour carried over unchanged from the deleted route
  closure.
- `read_repo_status`/`read_commits` are exercised directly via `resolveProjectTool` but
  not through the `dispatch` routing layer (7 of 9 delivery tool names go through
  `dispatch` in tests; these 2 don't).

**Task 4**
- The `/queued as proposals/i` assertion (added in the Task 4 fix round) is narrower than
  the original persona-test's `/proposals?.*(awaiting|await|must confirm)/is` — it
  doesn't independently guard the "must confirm" clause. Non-vacuous, so it counts, but
  it catches less than what it replaced.
- `projectAgent.test.ts` asserts `toEqual(["project-agent"])` on the whole project
  roster — the second project persona ever added breaks this test from an unrelated
  task.
- `prompt.test.ts`'s new test duplicates assertions already present elsewhere in the
  file; only its two `not.toContain` assertions are new information.
- `ProjectPromptInput` still declares `businessName`/`founderName`/`today`, which
  `buildProjectStateBlock` no longer reads — accepted in the pre-flight ruling as object
  properties with no compiler cost; narrowing the interface is separate scope.
- `PROMPT_BUDGET = 24000` bounds only the state block, not the assembled prompt (persona
  ~1.2KB + state block). `context.businessName`/`founderName`/`services` are
  client-supplied and reach the system prompt uncapped. Same shape as `brain/route.ts` —
  pre-existing, shared, low-severity; not fixed here as a one-route patch.

**Task 5**
- `route.ts:87-94`'s repo-linked branch has no route-level test coverage — every fixture
  sets `repoPath: null`, so the dynamic `await import("@/lib/git/repo")` and its
  best-effort `.catch()` are unexercised at this layer (they are exercised at the
  `tools.ts` layer by Task 3's tests).
- `route.ts:54-55`'s `bad_request` path discards a real cause (`catch {}` on the JSON
  parse). Defensible — the cause-logging rule targets 502s, not 400s.

**Task 6**
- `flush()` and the 450ms debounce are two uncoordinated writers against a full-replace
  endpoint; if the flush PUT lands after the debounce PUT, the just-created
  `projectThread` row is briefly deleted. Self-healing on the next save. Fix: clear the
  pending debounce timer inside `flush()`.
- A failed `flush()` is silent — `ApiAdapter.save` swallows non-ok responses, so
  `flush()` resolves even when the write never happened. Should be documented as
  best-effort.
- `projectClient.test.ts` never asserts the request URL or `method: "POST"` — changing
  either kills the feature with all three tests green. This is the same "assertion
  passes against the thing it's meant to detect" failure mode as defects 1/3/4 above,
  just not escalated to Important in this review. Worth closing before it's the next
  branch's finding.
- `projectClient.test.ts` covers neither the `?? "request_failed"` fallback nor a
  rejecting `fetch`; `aiClient.test.ts:37-51` covers both shapes and could be a template.
- `projectClient.test.ts` has no `vi.unstubAllGlobals()`; the repo's three other
  fetch-stubbing test files all restore.
- The stop notice renders `text-[var(--color-dim)]`; Advisor and Brain both use
  `text-[var(--color-muted)] mt-3` for the identical notice — same copy, different color
  on the third surface.
- `ActionCard.tsx`'s `ICON` map still has no entry for `create_milestone`,
  `update_milestone`, `update_project` — same wrong-icon gap this task closed for the two
  renamed task tools, one line away, pre-existing.
- `ProjectChat.tsx`'s `milestones`/`tasks` props are now genuinely unused in its JSX
  (only in the destructure/type/a comment), not merely unsent — `ChatTab.tsx:18` and
  `projects/[id]/page.tsx:174` still compute and pass them. Kept unchanged per the task's
  explicit instruction not to touch the component's public props; `tsconfig.json` has
  neither `noUnusedLocals` nor `noUnusedParameters`, so this compiles clean either way.

## Outstanding — browser verification (not yet performed)

**Nobody has driven this branch through a browser.** All verification above is `tsc`,
`vitest`, `next build`, two greps and a DB row count — none of it opens `/projects/[id]`
in a real session. The plan's own Task 6 Step 8 lists four scenarios; `task-6-report.md`
expands each into what has zero automated coverage because `.tsx` files are outside this
repo's `vitest.config.ts` (`include: ["src/**/*.test.ts"]`, no DOM library). The ledger
also references "a 14-step checklist" the Task 6 reviewer produced; that checklist is not
preserved as a retrievable artifact in this branch's `.superpowers/sdd/` directory or its
diffs, so what follows is the fullest version actually on file — the plan's 4 scenarios,
each annotated with the specific coverage gap `task-6-report.md` names:

1. **Ask "what's the plan?"** on a project with at least one milestone — the agent
   should answer with real milestone names. Exercises the whole route + agent + DB path,
   not just Task 6's client changes.
2. **Ask "add a task to chase the API key"** — a proposal card should appear;
   confirming it should create the task. Also exercises `ActionCard.tsx`'s new
   `create_project_task`/`update_project_task` icon entries actually rendering
   `Plus`/`PencilLine` in a real card.
3. **Immediately after confirming, ask "what's on this project now?"** — the new task
   should appear in the answer. This is the core reason `flush()` exists: without it,
   the agent would answer from a database up to 450ms stale. Nothing has verified
   `store.flush()` is actually called before `sendProjectMessage` in the real React
   lifecycle, nor that this end-to-end sequence actually closes the race it was built to
   close.
4. **Ask something with no `ANTHROPIC_API_KEY` set** — the message should read "No
   ANTHROPIC_API_KEY set...", not the generic "That didn't go through." Also unverified:
   `stopNotice(stopped)` actually rendering in the DOM when `stoppedBy` is
   `"max_iterations"`/`"max_tokens"` and staying absent when `"end"`; and the
   `configured === false` early-return branch, unchanged by this branch but still `.tsx`
   and still untested.

Needs a dev server, a real `ANTHROPIC_API_KEY`, and a project with real milestones.
