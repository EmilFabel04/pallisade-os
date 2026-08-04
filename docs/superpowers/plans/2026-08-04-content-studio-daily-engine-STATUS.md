# Content Studio Daily Engine — Status and Outstanding Work

**As of:** 2026-08-04
**Branch:** `feat/content-daily-engine`
**Plan:** [2026-08-04-content-studio-daily-engine.md](2026-08-04-content-studio-daily-engine.md)
**Spec:** [../specs/2026-08-04-content-studio-daily-engine-design.md](../specs/2026-08-04-content-studio-daily-engine-design.md)

Execution was stopped deliberately part-way through Phase 1. This file records
exactly where it stopped and what has to happen next, so the work can be resumed
without re-deriving any of it.

## Where it stands

Suite: **478 tests passing** (baseline before this work was 388). `tsc --noEmit` clean.

| Phase | Task | State |
| --- | --- | --- |
| 1 | 1 · Voice measurement primitives | ✅ complete, reviewed |
| 1 | 2 · Voice profile aggregation | ✅ complete, reviewed |
| 1 | 3 · Daily types + craft catalogue | ✅ complete, reviewed |
| 1 | 4 · Anchor extraction | ✅ complete, reviewed |
| 1 | 5 · Rotation guardrails | ✅ complete, reviewed |
| 1 | 6 · Anti-slop gate | ⚠️ complete but **last commit unreviewed** |
| 1 | 7 · Material harvest | ❌ not started |
| 2-6 | 8-18 | ❌ not started |

Everything shipped so far is the **pure core** — no model calls, no schema, no UI.
It is the part that carries the quality argument, and it is provable without an
API key.

## Immediate next steps, in order

1. **Re-review commit `74fd3f2`.** It is the only commit on this branch that did
   not pass a scoped re-review — the implementing agent was stopped mid-round.
   It implements the fabrication policy and a `firstLine()` fix. Behaviour was
   spot-checked by hand and the suite is green, but the adversarial re-review and
   mutation sweep that every other commit received have not run against it.
   Specifically unverified: whether the `firstLine()` blank-line fix actually
   closes the case it was written for (body beginning with `\n`, whitespace, or
   `---`, which previously made `opener-collision` silently self-disable).
2. **Task 7 — material harvest.** Brief is already generated at
   `.superpowers/sdd/2026-08-04-content-studio-daily-engine/task-7-brief.md`
   (that directory is gitignored scratch; regenerate with
   `scripts/task-brief <plan> 7` if it has been cleaned).
3. **Final whole-branch review**, on the most capable model, pointed at the
   deferred-minor list below so it can triage what must be fixed before merge.
4. **Merge and push.**

## Review debt

`74fd3f2` — "feat(content): fail the gate on unverified client detail". Green,
hand-checked, unreviewed. Treat as untrusted until re-reviewed.

## Deferred minors, for the final review to triage

None of these block. All were raised by a task reviewer, judged Minor, and
recorded rather than fixed.

1. `measure()` has a dead `paragraphs.length === 0` guard — the earlier
   empty-input early return already excludes that case. (Task 1)
2. No direct test for `avgParagraphSentences`; no test for a bare empty string
   (only whitespace). (Task 1)
3. Emoji counting is per-codepoint, so ZWJ and skin-tone sequences overcount
   against visual glyphs. (Task 1)
4. No test exercises a zero-valued profile metric in `compare()`'s
   `if (p === 0) continue` guard. (Task 2)
5. "Rule of three" matches only single-token words of 5+ letters, so multi-word
   triads ("increase revenue and improve morale") do not trigger it. (Task 3)
6. `extractAnchors` fires on sentence-initial capitalised pairs — "Happy Monday
   everyone!" yields `["Happy Monday"]`. Mitigated downstream: the gate now only
   *fails* on untraced proper nouns carrying a company token, so ordinary pairs
   pass. (Task 4)
7. `checkNeverSay` is substring-only, so `neverSay: ["cat"]` fires on
   "catalogue". (Task 6)
8. The `ai-tells` failure detail repeats word stems ("underscore"; "underscores")
   and is unbounded in length. (Task 6)
9. `traces()` uses plain substring matching for non-numeric anchors, so
   `"12 June"` would falsely trace to a source reading `"112 June-ish"`. Numeric
   anchors are digit-boundary aware; non-numeric ones are not. (Task 6)

## Plan defects found during execution

Four defects were found **in the plan itself**, not in the implementations. Three
were fixed in the code as they were hit. One was fixed in the plan file:

- **Task 13 (`run.ts`) — FIXED IN THE PLAN.** The plan's snippet wrote
  `openingLine: splitSentences(body)[0]`, which would have reintroduced the exact
  producer/consumer mismatch Task 6 removed. Now specifies `firstLine(body)` and
  carries a "do not break this" note. Verify it survived if the plan is ever
  regenerated.

The other three (negative-parallelism regex, inline-header colon placement,
currency `\b` boundary) were corrected in the shipped code and their briefs are
now stale relative to it. **The plan file's code blocks for Tasks 3 and 4 no
longer match what is committed.** Read the source, not the plan, for those two.

## Environment notes for Phases 3-6

- `/data`, `.env*` and `/node_modules` are gitignored. Phase 1-2 tests need none
  of them — `store.test.ts` builds a temp DB from `TURSO_DATABASE_URL`.
- Phases 3-6 manual verification needs `ANTHROPIC_API_KEY`, which is present in
  `.env.local` in the primary working directory. This is why the work was done on
  a feature branch in place rather than in a worktree.
- Phase 6 needs `CRON_SECRET` added to the Vercel project and a `matcher`
  exclusion in `src/middleware.ts`, or NextAuth will bounce the cron to `/login`.

## What execution taught, and what it means for the remaining phases

Six defects were found across six tasks. **Every single one was a check that
silently failed to fire while a green test suite reported success.** Three of the
six were apostrophe-related: a regex character class that lost its U+2019, a
detail string mixing forms, and — the worst — a case where a curly apostrophe
defeated six separate AI-slop tells at once, so `"It's not a tool, it's a
mindset."` was reported as clean prose.

That is not a coincidence. This system matches model-generated text, and models
emit typographic apostrophes by default. `gate.ts` now folds them centrally
before matching; **any new text-matching code in later phases must do the same or
inherit that fold**, and never hand-write a straight apostrophe into a pattern.

The second lesson is about method. Reading a regex tells you nothing about
whether it fires. Every defect here was caught by *executing* the pattern —
building adversarial strings, reconstructing the pre-fix implementation and
re-running the suite against it, and mutation testing (breaking a check
deliberately to confirm a test dies). Task 6's re-review ran 22 mutants with zero
survivors; that is the standard the remaining phases should hold to, and it is
worth the cost on anything that gates output quality.

Two findings raised during review were themselves wrong, both because behaviour
was reasoned about rather than run. Verify a finding's premise by execution
before acting on it.
