# Content Studio Daily Engine — Status and Outstanding Work

**As of:** 2026-08-05
**Branch:** `feat/content-daily-engine`
**Plan:** [2026-08-04-content-studio-daily-engine.md](2026-08-04-content-studio-daily-engine.md)
**Spec:** [../specs/2026-08-04-content-studio-daily-engine-design.md](../specs/2026-08-04-content-studio-daily-engine-design.md)

All 18 tasks are implemented. This file records what was verified, what the
first live runs found, and what is deliberately left for a follow-up.

## Where it stands

Suite: **598 tests passing** (baseline before this work was 388). `tsc --noEmit`
clean. Production build passes.

| Phase | Task | State |
| --- | --- | --- |
| 1 | 1-6 · Voice, types, craft, anchors, rotation, gate | ✅ complete, reviewed |
| 1 | 7 · Material harvest | ✅ complete |
| 2 | 8 · Server-authored tables | ✅ complete |
| 2 | 9 · Voice collections registered | ✅ complete |
| 3 | 10 · Voice panel | ✅ complete (UI unverified in browser) |
| 4 | 11 · Brief stage | ✅ complete |
| 4 | 12 · Draft and revise stages | ✅ complete |
| 4 | 13 · Orchestrator | ✅ complete |
| 4 | 14 · Fingerprint generation | ✅ complete |
| 5 | 15 · Posts endpoints and client | ✅ complete |
| 5 | 16 · Today panel | ✅ complete (UI unverified in browser) |
| 6 | 17 · Daily route, cron, middleware | ✅ complete, verified live |
| 6 | 18 · End-to-end verification | ✅ complete — see below |

The review debt recorded against `74fd3f2` is cleared: the `firstLine()`
blank-line fix had no test (all 42 gate tests passed against the pre-fix
implementation), and a ten-mutant sweep found a second survivor. Both closed.

## What the live runs found

Two real end-to-end runs against `claude-sonnet-4-6`, driven through
`POST /api/content/daily` with `CRON_SECRET` (which bypasses the OAuth-fronted
UI). Verified: 401 without the secret, 401 with a wrong one, and a full
pipeline run on the founder's real logged data — a 23-25 item ledger drawn from
actual pain points, leads and projects.

**Defect found and fixed: spelled-out numbers.** Both posts in the first run
failed the specificity check and survived two revisions without recovering. The
cause was that the model wrote "Six days", "three days each", "ten, maybe
fifteen people" — `extractAnchors` matches digits only, so the posts had no
anchors at all. The failure detail said only "no verifiable detail", which gave
the revise stage nothing to act on. Fixed in two places: the anti-slop
constitution now requires digits explicitly, and the specificity failure detail
names the rule. On the re-run, one post came back clean on the same material.

**Rotation confirmed live.** The second run picked `proof`/`scene` and
`build-log`/`one-idea` — the first run's `teardown`/`before-after` and
`client-pain`/`numbers` were blocked by the guardrails reading the first run's
own posts back out of the database.

**Test artifacts removed.** The three placeholder voice samples, the
placeholder positioning profile, and the four generated posts and runs were
deleted from `data/pallisade.db` afterwards. The database is back to its
pre-verification state; the founder's first real run starts from their own
samples.

## Outstanding

1. **Browser verification of the two panels.** `/content` sits behind Google
   OAuth, so `VoicePanel` and `TodayPanel` have never been rendered. Both
   type-check and survive the production build, and the routes behind them are
   verified, but the visual result and the click paths are unconfirmed. Do this
   first: paste three writing samples, hit **Rebuild fingerprint**, then
   **Generate today's posts**.
2. **`CRON_SECRET` on Vercel.** Present in `.env.local` for local verification;
   `vercel env add CRON_SECRET production` before the cron can authenticate.
3. **Anchor-free material still reaches the brief stage.** In the second live
   run one post cited a lead record containing no digits at all, so no post
   written from it could pass specificity. The gate correctly refused it and
   said why — the designed behaviour — but the brief stage should not have
   picked material with no anchors. The prompt already labels such items "none
   — weak material" and says to prefer anchored ones; making it a hard
   constraint is the obvious next step, and wants more than two runs of
   evidence before changing `chooseBriefs`' contract.

## Deferred, unchanged from the plan

- **Per-slot "Regenerate this one"** (spec §6). Needs a `chooseBriefs` contract
  change, since briefs are chosen as a validated pair. Flagged, not narrowed.
- **Dashboard widget.** Natural follow-up once the Today panel earns its keep.
- **News mode is a stub.** An empty database produces a clean failure rather
  than a bad post, which is the correct interim behaviour.
- **`neverSay` 60-cap** is applied on read in `run.ts` rather than pruned at
  write time.

## Deferred minors, raised during Phase 1 review

None block.

1. `measure()` has a dead `paragraphs.length === 0` guard. (Task 1)
2. No direct test for `avgParagraphSentences`; none for a bare empty string. (Task 1)
3. Emoji counting is per-codepoint, so ZWJ and skin-tone sequences overcount. (Task 1)
4. No test exercises a zero-valued profile metric in `compare()`. (Task 2)
5. "Rule of three" matches only single-token words of 5+ letters. (Task 3)
6. `extractAnchors` fires on sentence-initial capitalised pairs. Mitigated
   downstream — the gate only *fails* on untraced proper nouns carrying a
   company token. (Task 4)
7. `checkNeverSay` is substring-only, so `neverSay: ["cat"]` fires on
   "catalogue". (Task 6)
8. The `ai-tells` failure detail repeats word stems and is unbounded. (Task 6)
9. `traces()` uses plain substring matching for non-numeric anchors. (Task 6)

## What execution taught

Every defect found across this branch was a check that silently failed to fire
while a green suite reported success — and in the second half, a recurring
second species: **assertions that passed against the thing they were meant to
detect**. The plan's own tests contained at least five, each found by mutation
rather than by reading:

- `buildBriefPrompt`'s rotation test asserted `/proof/`, `/numbers/` and
  `/must differ/i` — all three match the static catalogues, so it passed with an
  empty memory.
- The brief retry test searched the whole message array for `/must differ/`,
  which the original prompt already contains.
- `buildDraftPrompt`'s never-say assertion was `toContain("leverage")`, which
  the edit pair's own "before" text satisfies.
- Its voice-targets assertion was `/rhythm/i` plus `/\d/` — both satisfied
  elsewhere in the prompt.
- `harvest`'s ranking test passed on text length, not anchor count.

The method that catches these is not review. It is executing the mutant: break
the check deliberately and confirm a test dies. Every module on this branch now
holds at zero surviving mutants, and the sweeps are cheap to re-run — the
harness used is a ~30-line script that applies a find/replace, runs the file's
tests, and reports.

The other durable lesson is the apostrophe one, unchanged: this system matches
model-generated text, and models emit typographic apostrophes by default.
`gate.ts` folds them centrally before matching. Any new text-matching code must
do the same or inherit that fold.
