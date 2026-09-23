# Jev-Judged Follow-ups — Status and Outstanding Work

**As of:** 2026-09-23
**Branch:** `feat/jev-followups`
**Plan:** [2026-09-22-jev-followups.md](2026-09-22-jev-followups.md)
**Spec:** [../specs/2026-09-22-jev-followups-design.md](../specs/2026-09-22-jev-followups-design.md)

All 8 tasks are complete. A second AI vendor, TypeSafe's Jev, now judges the founder's
sent-mail follow-up audit per thread — replacing the pure keyword heuristic as the
primary decision-maker wherever `TYPESAFE_API_KEY` is set, with the heuristic kept on
as an automatic, per-thread fallback. The audit is exposed through two API routes and a
new `/follow-ups` page. This file records what each task built, the two deliberate
behaviour changes worth knowing about before touching this code again, the mutation
sweep, every real defect the branch's reviews found, the deferred minors, and — stated
plainly rather than invented — what has and has not actually been verified.

## Where it stands

Suite: **1169 tests passing across 108 files** (confirmed again while writing this
document; the branch's own progression was 1116 → 1169 across the eight tasks).
`npx tsc --noEmit` clean. `npm run build` passes. `GET /api/followups` (the page's
status endpoint) returns 200. Mutation sweeps ran on Tasks 2, 4 and 5 — every mutant
introduced was killed; see **Mutation testing** below, including a correction to how
this repo's mutation script reports success.

| Task | State |
| --- | --- |
| 1 · The Jev client | complete |
| 2 · Pure judge (state builder, questions, interpreter) | complete, 1 fix round |
| 3 · Bounded-concurrency fan-out | complete, 2 fix rounds |
| 4 · Wire the judge into the sent-mail audit | complete, 1 fix round |
| 5 · Persist audit runs and the founder's dismissals | complete, 1 fix round |
| 6 · Status and run API routes | complete, no fix round |
| 7 · The `/follow-ups` page | complete, no fix round |
| 8 · This document | complete |

Two plan-doc-only commits (`c4e2ab6`, `80c96b0`) sit between Task 1 and Task 2 in the
git history: the controller correcting stale test-count predictions in
`2026-09-22-jev-followups.md` between dispatches. They touch no application code and
are not listed per-task below.

## Per task

### Task 1 — The Jev client (`737c73b`)

New `src/lib/jev/types.ts` (`JevQuestion`, `JevAnswer`, `JevResponse`, `JevError`) and
`src/lib/jev/client.ts` — a plain-`fetch` client against TypeSafe's System One endpoint
(`https://api.typesafe.ai/v1/systemone`), no new dependency. `isConfigured()` reads
`TYPESAFE_API_KEY`; `evaluate(state, questions)` answers a batch of typed questions
against one state in a single call. Only HTTP 429 and 529 are retried (up to 3
attempts, exponential backoff from 250ms) — everything else is treated as a fact about
the request, not a transient failure. `USD_PER_INPUT_TOKEN = 0.042 / 1_000_000`, per
TypeSafe's published rate (output is free).

9/9 tests, reviewed clean. Deferred minors: the network-exception catch path in
`client.ts` has no test (only HTTP-status paths are covered); the retry tests use real
timers, costing the suite about a second of wall clock in that one file.

### Task 2 — Pure judge (`451077e`, fix `cb34a10`)

New `src/lib/gmail/sentJudge.ts`, the pure half — no network. `buildJudgeState`
flattens a thread's messages into what Jev reads: newest-first, de-quoted, and
truncated to `STATE_CHAR_BUDGET = 6_000` characters (roughly 1.5k tokens, an order of
magnitude under Jev's 32k-token-per-question limit). `JUDGE_QUESTIONS` defines the
three questions Jev answers per thread — `is_my_outreach` and `needs_nudge` (both
`noul`, i.e. probability 0–1) and `urgency` (a 4-level score) — and `interpretJudgement`
turns Jev's answers into a `ThreadJudgement`. `heuristicJudgement` wraps the existing
keyword rule in the same shape, so jev and heuristic verdicts are interchangeable to
every downstream consumer.

Review found 4 Important findings, all traced to the plan's own sample code, fixed in
one round:

1. The original truncation logic could produce an **empty** message list when the
   newest message alone exceeded the budget — Jev would then judge on the subject
   alone, silently, which is exactly what the spec forbids. Fixed: the first message is
   now always admitted, sliced to the budget if needed; later messages are admitted
   whole or dropped, never sliced.
2. The sort comparator returned `-1` for both `compare(a, b)` and `compare(b, a)` on
   tied dates — an unstable-sort bug this repo has hit before (`sentScan.ts:188-196`
   already documents the same class and carries a tiebreaker). Fixed with an index
   tiebreaker.
3. `INCLUDE_NOUL_MIN` / `NUDGE_NOUL_MIN`'s doc comments said what the constant was, not
   when to move it, breaking a convention the plan itself set.
4. `daysBetween` was duplicated verbatim from `sentScan.ts:225-230`. Fixed by exporting
   it from `sentScan.ts` and importing — the resulting type-only import back from
   `sentJudge.ts` into `sentScan.ts` (see Task 4) is a circular import at the type
   level, erased at compile time, ruled acceptable.

18/18 focused tests (16 + 2), full suite 1134, mutation killed. Deferred minors:
`messageCount` has no test asserting its value; `URGENCY_LEVELS`'s comment is a legend,
not a threshold, so it carries no "when to move it" guidance by design.

### Task 3 — Bounded-concurrency fan-out (`d9bb842`, fixes `8114c7c`, `4a1e471`)

Added to `sentJudge.ts`: `runJudge(states)` fans a batch of judge states out to Jev with
`JUDGE_CONCURRENCY = 12` requests in flight (Jev's ceiling is 1,200 req/min, i.e. 20/s;
12 stays clear of it while keeping a 400-thread scan bounded by Gmail rather than by
this client). `runJudge` never rejects — a failed thread comes back `null` in its
position and is counted in `failures`, so one bad thread costs only its own ranking.

Review found 2 Important findings, both plan-mandated, fixed across two rounds:

1. The original concurrency test asserted `JUDGE_CONCURRENCY <= 20` — a check on the
   *declared constant* that would pass even with the concurrency limiter dead. Fixed
   with a behavioural test: deferred promises track observed peak concurrency across 30
   states and assert `1 < peak <= JUDGE_CONCURRENCY`.
2. A bare `catch {}` around each failed judgement conflated a Jev outage with a real
   code bug, in a counter (`failures`) the UI surfaces directly. Fixed by binding the
   error and logging with a `[followups]` tag (matching the existing precedent at
   `fathom/tools.ts:239`). A round-2 fix then spied/suppressed/asserted those log calls
   in the two failure-path tests, after a re-review flagged unasserted `console.error`
   noise as a new Important in the round-1 diff.

Rejected alternative: adding `JudgeRun.errors` to carry structured failure detail —
ruled YAGNI, since it would widen the contract Task 4 consumes for no consumer that
needs it.

23/23 focused tests (18 + 5), full suite 1139 at completion. Mutation killed. Deferred
minors: `JudgeRun.calls` is always `=== states.length` under current semantics; no test
covers `runJudge([])`.

### Task 4 — Wire the judge into the sent-mail audit (`9e676fd`, `6c9b9b7`, fix `beeb2af`)

`auditSentFollowUps` in `src/lib/gmail/sentAudit.ts` was restructured to judge each
candidate thread with Jev (when configured) and fall back to the heuristic per thread on
failure, rather than deciding everything with the keyword rule alone. This is the
highest-risk diff on the branch and carries the two deliberate behaviour changes — see
**Behaviour changes** below.

A gap was caught and closed *before* review went out: nothing at the audit level
exercised the stalled-thread behaviour change, one of the task's two deliberate changes.
Two tests were added (Jev rescues a stalled thread; heuristic mode still drops it and
increments `stalledNotShown`) — commit `6c9b9b7`.

Review (dispatched to Opus, the highest-risk diff on the branch, with six named risks)
found the restructure itself correct — heuristic mode bit-for-bit preserved, the
own-email snapshot placed exactly right, a genuine mutation kill proving the Jev verdict
reaches a `FollowUp`. It found 2 Important findings, both fixed in `beeb2af`, plus the
controller independently found a third, more serious issue on its own read of the diff:

1. **Exclusion counters stopped reconciling.** In jev mode, a thread Jev excluded that
   the heuristic would have included was counted nowhere — `scanned` and `matched` no
   longer added up, and `src/app/api/advisor/route.ts:40` tells the model to reason
   aloud from `excludedSignoffOnly` specifically. Fixed by adding `excludedByJudge` and
   attributing each exclusion to whichever judge actually made it.
2. **`stalledNotShown` had become a catch-all** under a doc comment that said "they
   replied and you answered last" — but it was also incrementing for any
   non-nudgeworthy thread regardless of bucket. Fixed by splitting out `notNudgeworthy`
   and correcting both doc comments to say what each counter actually measures.
3. **(Controller-found, not in the review) the Apollo mailwarming safety net was
   silently deleted.** See **The Apollo mailwarming net** below.

47 sentScan tests, 11 sentAudit tests (after the fix round), full suite 1152 at
completion. Mutation killed both before and after the fix round; the warming-net
restoration was additionally hand-verified load-bearing (removed, watched the test
fail, restored).

Deferred minors: `URGENCY_RANK` is typed `Record<string, number>`, which defeats the
compiler on a renamed level (should be `Record<Urgency, number>`); `Candidate.raw`
retains the full Gmail payload for the whole scan to read one id; no audit-level test
exercises more than one candidate at a time, so a partial degrade (some threads
succeed, some fall back) is never exercised end to end; `auditSentFollowUps` is now 222
lines and the judging pass would extract cleanly as `judgeCandidates()`; test
housekeeping — `afterEach` hand-duplicates the `vi.mock` factory default, and
`vi.stubEnv("TYPESAFE_API_KEY")` is inert and never unstubbed, leaking into two later
tests.

Two items were explicitly flagged to this final review for merge triage rather than
fixed in Task 4 — see **Deferred minors, triaged** below.

### Task 5 — Persist audit runs and the founder's dismissals (`168326a`, fix `968a953`)

Two separate persistence mechanisms, both new:

- **Audit run history** — `src/lib/gmail/followUpRuns.ts`, a `followUpRuns` table
  deliberately kept *outside* the `COLLECTIONS` array in `src/lib/db/sqlite.ts`, for the
  same reason `content/daily/store.ts` keeps its own table separate: `saveAll()`
  deletes and reinserts every listed collection from a client snapshot, so a browser tab
  opened before a run finished would wipe it. `RUN_HISTORY = 10`: `saveRun` inserts the
  new row then prunes with `DELETE ... WHERE id NOT IN (SELECT id ... ORDER BY at DESC
  LIMIT 10)`. History exists so compare mode (Jev vs. heuristic, run side by side) has a
  sample to look at.
- **The founder's dismissals** — a new `FollowUpState` entity (`status: "handled" |
  "snoozed"`, `until` for snoozes) added to the normal `DataShape` / `COLLECTIONS`
  registry, so it syncs through the existing client store like every other entity.
  `AdvisorSnapshot` (`src/lib/types.ts`) explicitly `Omit`s `followUpState` — confirmed
  correctly in place — so the founder's dismissals never reach the Sales Advisor.

Review found 1 Important finding: the 10-run retention cap — the one behaviourally
load-bearing thing this store does — was covered only by `expect(RUN_HISTORY).toBe(10)`,
a declared-constant assertion, the same defect class Task 3 had. Fixed with a 12-run
behavioural test (`968a953`); the implementer mutation-tested it by hand, confirming a
swapped `DELETE LIMIT` now fails the test where it previously shipped green.

The implementer also disclosed, unprompted, a residual gap: the test's hand-written
mock does not interpret `ORDER BY`, so a reversed sort direction in the real SQL would
be caught by no test. The repo was checked for a real-libsql test pattern to fix this
properly — none exists anywhere (`sqlite.test.ts` only asserts the `COLLECTIONS`
registry) — so closing it correctly means introducing a new test pattern inside a
plumbing task. Accepted and flagged here for merge triage; see below.

4/4 `followUpRuns` tests, full suite 1156/106 files at completion. Deferred minors: no
secondary sort key, so boundary selection on identical `at` timestamps is
SQLite-implementation-defined; `INSERT`-then-`DELETE` is two `execute()` calls where the
sibling `savePosts` uses one `batch()` — a failure between them leaves a stale row until
the next save (self-healing, not silent loss).

### Task 6 — Status and run API routes (`375af86`)

`GET /api/followups` (`src/app/api/followups/route.ts`) — the page's first paint: what's
configured (`gmail`, `jev`) and the latest run, if any. `POST /api/followups/run`
(`src/app/api/followups/run/route.ts`) — runs `auditSentFollowUps`, saves the run, hands
it straight back; synchronous by design, since a single-user app doesn't need a job
queue and the wall clock is Gmail's and Jev's, not the server's.

A plan defect was found and fixed during execution, not in review: the brief's literal
`vi.mock` factories hit a Vitest TDZ error (`Cannot access 'audit' before
initialization`) from the route's static top-level import. Fixed with this repo's own
forwarding-closure idiom (matching `patch.test.ts`, `gmailApi.test.ts`) — no assertion
changed.

Review clean — 0 Critical, 0 Important — after checking four named risks: the `GET`
status route has no test at all (matches repo convention: `transcribe`, `gmail/status`
and `drive/status` GETs are all untested too); `limit` passthrough is unvalidated at
this route but clamped defensively by the callee; `apiError` never puts `cause` in the
response body, only the server console; the forwarding closures still pin what each
test claims.

5/5 route tests, full suite 1161/107 files. Deferred minors: the `GET` route's
`apiError` catch branch is unexercised; the 502 test deliberately emits
`apiError`'s `console.error` — intentional, matching other negative-path tests
elsewhere in this repo.

### Task 7 — The `/follow-ups` page (`bbe5bdb`)

`src/app/follow-ups/page.tsx`. Scan-size picker (50/150/400 threads), a Run Audit
button, a Compare toggle (runs `judge: "both"` and shows agreement/disagreement between
Jev and the heuristic via `ComparePanel`), a stats strip (scanned, owed, cost, elapsed),
and per-recipient rows (`FollowUpRow`) with actions to log an interaction, create a
task, mark handled, or snooze 7 days.

Controller ruling before dispatch: this repo has **zero** `.test.tsx` files — no page or
component is tested anywhere — so the plan's lack of UI tests for Task 7 follows
convention rather than missing it, and no React tests were required. But the page's
dismissal filter (hide anyone marked handled, or snoozed with `until` still in the
future) is real logic deciding what the founder sees, and it was going to live hidden
inside a `useMemo` where this repo's conventions make it untestable. Ruling: extract it
to a pure helper instead. That became `src/lib/gmail/followUpFilter.ts`
(`isDismissed`, `visibleFollowUps`), 8 unit tests, matching the repo's existing
pure-logic-in-lib / untested-components split.

Two more plan defects were found in execution, both the controller's own:

1. `addDaysISO(nowISO(), 7)` (the snooze action) evaluates to the literal string
   `"NaN-NaN-NaN"` — `addDaysISO` expects a date-only ISO string, but `nowISO()` returns
   a full timestamp, so every snooze would have silently failed. Verified with a Node
   repro; switched to `todayISO()`, matching every other caller in the codebase.
2. The plan's CSS variables (`--hairline`, `--fg`, `--muted`, `--accent`) and raw
   Tailwind colours (`amber-400`, `neutral-500`/`700`) don't exist in this app. Swapped
   for the real design tokens; all six replacements were confirmed present in
   `globals.css`.

Review clean — 0 Critical, 0 Important. Top named risk was whether the extracted filter
is actually *called* by the page or is dead code sitting beside a surviving inline
copy — a variant of this repo's recorded pattern where a check passes because it
asserts a declared/extracted thing exists rather than that it is actually exercised.
Confirmed called, no inline duplicate; the snooze boundary is coherent end to end (both
sides compare date-only strings; a snooze reappears *on* its `until` day, matching the
existing `isPast`/`isOverdue` convention elsewhere in `lib/utils.ts`); all three honesty
flags render (the "ranking is off, add TYPESAFE_API_KEY" note when Jev isn't configured,
the `degraded` banner when some threads fell back to the heuristic, the `capped` banner
when the scan was partial); every referenced CSS token exists in `globals.css`; no
shared component was touched; first-paint safety and hook order both verified.

Suite 1169/108 files, `tsc` clean, `npm run build` passed, `/follow-ups` present in the
README route table (this document's own Task 8 also touches that table). Deferred
minors: a snooze hides for 6 full days plus two partial days rather than a clean 7,
given date-only semantics; no distinct loading state during the brief window before
`/api/followups` resolves on first paint.

## Behaviour changes

Two changes alter existing behaviour, stated here plainly because "the audit found
fewer things than before" or "the audit found things it never used to" would otherwise
look like a regression to whoever hits it next, rather than the deliberate consequence
of adding a second judge:

**1. Stalled threads are no longer dropped unseen in jev mode.** Before this branch,
any thread the classifier bucketed as `stalled` (they replied, and the founder answered
last) was dropped without anyone — heuristic or otherwise — getting a say, because the
heuristic has no opinion on stalled threads. A Jev verdict *is* something able to have
an opinion, so in jev mode a stalled thread is now kept when `needs_nudge` says so — a
closed-out "thanks, sounds good!" stays dropped, but a stalled thread where the founder
still owes a substantive reply can now surface. **Heuristic mode is unchanged**: a
stalled thread there is still dropped regardless, per `sentAudit.ts`'s `dropStalled`
condition (`bucket === "stalled" && (judgement.source === "heuristic" ||
!judgement.needsNudge)`).

**2. `is_my_outreach` fully replaces `judgeThread` for inclusion in jev mode.** Before,
every thread's inclusion was decided by the keyword heuristic (`judgeThread`), whose
rules include "the subject contains a recognizable brand/reply pattern" as a guaranteed
include. In jev mode, Jev's `is_my_outreach` answer decides inclusion instead — the
subject-pattern rule is no longer a guaranteed include, and a thread that would have
passed on subject alone can now be excluded if Jev judges it isn't genuine outreach (a
newsletter, receipt, automated notification, or similar). This exclusion is counted
separately in `excludedByJudge` (see **The new counters**, below) precisely because it
has no equivalent to `judgeThread`'s reason taxonomy.

## The Apollo mailwarming net

Behaviour change #2 above had a side effect nobody intended: because `is_my_outreach`
fully replaces `judgeThread` for inclusion in jev mode, and the Apollo mailwarming
exclusion previously lived *inside* `judgeThread`'s heuristic rules, switching to jev
mode silently removed the mailwarming safety net that `sentAudit.ts`'s own file header
advertises as deliberate double protection (excluded once in the Gmail query, and again
against resolved label names). Jev has no notion of what Apollo mailwarming is — nothing
in its questions asks about it — so a warming thread that slipped past the server-side
query for any reason (a label rename, an account added after the query was built, a
label-lookup failure) would have reached Jev and been judged as if it were ordinary
correspondence.

This was found by the controller reading the diff, not by the dispatched review. Fixed
in `beeb2af` by making the warming-label check **unconditional and ahead of the judge,
in every mode** — it now runs before either judge's verdict is consulted at all. The
reasoning, stated in the code's own comment: **a label is a fact, not a judgement, and
facts do not go to the model** — the same principle that already keeps `classifyThread`
(reply-order bucketing) out of the judge's hands entirely. Verified load-bearing by
hand: the implementer removed the check, watched the relevant test fail, and restored
it.

## The new counters

`SentAuditResult` gained two fields this branch:

- **`excludedByJudge`** — threads Jev judged not to be the founder's outreach
  (`is_my_outreach` below threshold). Needed because the old counters stopped
  reconciling: before this field existed, a Jev exclusion left every exclusion counter
  at zero, so `scanned` and `matched` no longer added up to anything explicable, and
  there was no way to tell "Jev excluded these" from "these vanished."
- **`notNudgeworthy`** — threads the judge said need no follow-up now, whatever their
  bucket. Needed because `stalledNotShown` had become a catch-all: its doc comment said
  "they replied and you answered last" (the `stalled` bucket specifically), but the code
  was incrementing it for *any* non-nudgeworthy thread regardless of bucket. The comment
  was false the moment jev mode could decide a non-stalled thread doesn't need a nudge
  either. `stalledNotShown` is now stalled-bucket-only; `notNudgeworthy` is everything
  else the judge declined to surface.

**Open note, not fixed on this branch:** `src/app/api/advisor/route.ts:40` still tells
the model to reason from `excludedSignoffOnly` by name specifically ("If followUps is
empty but excludedSignoffOnly is large, say that..."), but `excludedByJudge` and
`notNudgeworthy` now reach the advisor too, via `JSON.stringify(result)` serializing the
whole `SentAuditResult`. The advisor is handed numbers in the JSON blob it was never
told how to interpret. Not a correctness bug — the advisor just won't reason about
those two fields — but worth a one-line prompt update whenever `advisor/route.ts` is
next touched.

## Mutation testing

Mutation sweeps ran on Tasks 2, 4 and 5, targeting the load-bearing logic each task
added (state-truncation and sort-tiebreak in Task 2; the warming-net restoration and the
Jev-verdict-reaches-a-FollowUp path in Task 4; the retention prune in Task 5). Every
mutant introduced was killed — no survivors on this branch.

**Correction for future sessions reading this branch's history:** `scripts/mutate.sh`
prints **lower-case `killed:`** on success (line 69: `echo "killed:   $FIND -> $REPLACE
in $FILE"`) and reserves **upper-case `SURVIVED`** for the failure path only (line 66).
Earlier drafts of this branch's task briefs wrote "KILLED" in prose, which could be
misread by an implementer skimming for the literal string as a failure signal. It is
not — `killed:` (lower-case, with the colon) is the success line this script actually
emits.

## Verification — honest status

The plan's final step called for running the app and recording real first-run numbers:
threads scanned, follow-ups owed, cost, elapsed time, and how many disagreements a
compare-mode run found between Jev and the heuristic. **That did not happen, and this
document does not invent numbers to fill the gap.**

The reason is structural, not an oversight this task could close: the app gates client
rendering behind an auth/store-hydration splash screen that an automated request (curl,
a scripted fetch) cannot pass — confirmed true of `/inbox` as well, so it is not
specific to this page. Nobody has watched `/follow-ups` render in a browser. Nobody has
clicked "Run audit" against a real Gmail account with a real `TYPESAFE_API_KEY` and
watched it come back.

What evidence does exist, and no more than this:

- `npx tsc --noEmit` — clean.
- `npm run build` — passes; `/follow-ups`, `/api/followups` and `/api/followups/run`
  all present as routes in the build output.
- `GET /follow-ups` (and `GET /api/followups`) — returns 200.
- **1169 tests passing across 108 files**, reconfirmed while writing this document.
- Mutation sweeps on Tasks 2, 4 and 5, all mutants killed.

What remains outstanding, and is the first thing to do the next time the founder opens
this app: run the audit for real, at each of the three scan sizes, with
`TYPESAFE_API_KEY` set, and record what actually comes back — scanned/owed/cost/elapsed,
whether the numbers look sane against a real inbox, and (with Compare toggled on) how
often Jev and the keyword heuristic actually disagree. A visual check of the page itself
— does it render, do the honesty banners (ranking-off, degraded, capped) appear when
they should, does a snooze/handled action actually hide a row — is equally outstanding
and equally cheap to do in the same sitting.

## Deferred minors — triage list for whoever merges

None of the following blocks a merge. Two are worth reading before the rest:

- **Warming-labelled candidates are still sent to Jev, and billed, before being
  discarded.** The unconditional warming-label filter added in Task 4 (see **The Apollo
  mailwarming net**) runs in the per-thread judging loop, *after* the full candidate
  batch has already been built and (in jev mode) sent to `runJudge`. In practice this is
  small: the Gmail query already excludes the warming label server-side, so a warming
  thread reaching the judging loop at all should be rare (a label-lookup failure, a
  label rename, a newly-added account). But when it does happen, that thread is a real,
  billed Jev call whose answer is then thrown away. The fix is straightforward — move
  the warming check ahead of state-building instead of ahead of judgement-consultation —
  and was deliberately left for a follow-up rather than expanding Task 4's scope.
- **The `followUpRuns` test mock does not interpret `ORDER BY`.** Task 5's hand-written
  libsql mock returns rows in whatever order the test inserted them, not in the order
  the real `ORDER BY at DESC` clause would produce. A reversed sort direction in that SQL
  — oldest-first instead of newest-first — would ship with every test green. No test
  anywhere in this repo constructs a real libsql client against a real (even in-memory)
  database (`sqlite.test.ts` only asserts the `COLLECTIONS` registry), so closing this
  properly means introducing a new test pattern, not just a new test. Recoverable if it
  ships wrong (run history would just be chronologically backwards, not lost), but worth
  fixing before this table is relied on for anything more than "the last 10 runs."

The rest, grouped by task, all tagged `minor (deferred)` in the execution ledger:

- **Task 1** — no test for the network-exception catch path in `jev/client.ts` (only
  HTTP-status paths are covered); the retry tests use real timers (~1s wall clock in
  that file).
- **Task 2** — `messageCount` has no test asserting its actual value; `URGENCY_LEVELS`'s
  comment is a legend rather than a threshold, so it has no "when to move it" guidance
  by design, unlike `INCLUDE_NOUL_MIN`/`NUDGE_NOUL_MIN`.
- **Task 3** — `JudgeRun.calls` is always `=== states.length` under current semantics
  (nothing currently short-circuits before all states are dispatched); no test covers
  `runJudge([])`.
- **Task 4** — `URGENCY_RANK` is typed `Record<string, number>` instead of
  `Record<Urgency, number>`, so a renamed urgency level would defeat the compiler
  instead of failing to build; `Candidate.raw` retains the full Gmail thread payload for
  the life of the scan just to read one id off it later; no audit-level test exercises
  more than one candidate at a time, so a partial-degrade run (some threads judged by
  Jev, some fallen back to the heuristic, in the same audit) is never exercised
  end-to-end; `auditSentFollowUps` is now 222 lines and its judging pass would extract
  cleanly as a `judgeCandidates()` helper; test housekeeping — `afterEach` hand-
  duplicates the `vi.mock` factory default instead of resetting it, and
  `vi.stubEnv("TYPESAFE_API_KEY")` in one test is inert and never unstubbed, leaking
  into two later tests (harmless today, fragile if those tests are reordered).
- **Task 5** — no secondary sort key on `followUpRuns.at`, so boundary selection between
  two runs saved in the same instant is SQLite-implementation-defined; `saveRun` is an
  `INSERT` then a separate `DELETE` (two `execute()` calls) where the sibling
  `savePosts` uses one `batch()` — a crash between the two calls leaves a stale extra
  row until the next save prunes it (self-healing, not silent data loss).
- **Task 6** — the `GET /api/followups` route's `apiError` catch branch is unexercised
  by any test; the 502 test for the run route deliberately emits `apiError`'s
  `console.error` line, which is intentional and matches other negative-path tests
  elsewhere in this repo, not an oversight.
- **Task 7** — a snooze hides a recipient for 6 full days plus two partial days rather
  than a clean 7, a consequence of comparing date-only strings; there is no distinct
  loading state during the brief window before `/api/followups` resolves on first
  paint, so the page can show an empty "No audit yet" flash before the real status
  loads.
