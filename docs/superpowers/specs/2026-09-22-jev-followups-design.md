# Jev follow-ups

**Date:** 2026-09-22
**Status:** approved

Stacks on the `feat/fathom-tools` tip. Introduces a second AI vendor — TypeSafe's Jev — and
the first UI the sent-mail follow-up audit has ever had.

## Problem

`auditSentFollowUps()` (`sentAudit.ts:166`) pages up to 400 sent threads, filters them and
groups them by recipient. Nothing in the app renders it. Its only caller is the advisor's
`audit_sent_followups` tool (`advisorEmail.ts:56`), so the audit exists but the founder can
only reach it by asking a chatbot the right question.

Worse, the audit does not judge what its name implies. Two pure functions do the work and
neither decides whether a follow-up is owed:

- **`judgeThread`** (`sentScan.ts:136`) is an *authorship* test. A thread is included when it
  is not Apollo-warming-labelled AND (the subject contains "Pallisade" OR the last non-empty
  line of the founder's own text is "emil"). Its fourth reason code,
  `no_subject_no_signoff`, names its own blind spot: every thread where he wrote plainly and
  did not sign off is invisible to the audit.
- **`classifyThread`** (`sentScan.ts:179`) answers who wrote last — `no_reply`,
  `awaiting_you`, `stalled`. That is a fact about message order, not a judgement.

So the founder receives an undifferentiated list of every thread that mentions his company or
carries his sign-off, with no notion of which ones are stalled deals worth chasing today and
which concluded weeks ago. The obvious fix — ask a model per thread — is why this was never
built: 400 threads through Sonnet is $1–2 and several minutes per scan, for a screen he would
open every morning.

## Why Jev

TypeSafe came out of stealth on 2026-09-15 with Jev, a "System One" model: non-autoregressive,
state in, typed decisions out. It answers `noul` (probability a statement is true), `choice`
(one of up to 255 options, with calibrated probabilities) and `score` (a 2–10 level ordinal),
several questions against one state in a single parallel pass.

| | |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY` |
| Latency | 70–500ms |
| Price | $0.042 / MTok input, output free |
| Limits | 64k context total, 32k per question, 1,200 req/min, 250k tokens/sec |
| Errors | `429` rate limited, `529` overloaded |

At ~1.2k tokens of thread text per call, a full 400-thread scan costs roughly **2¢** and is
bounded by Gmail, not by Jev. That is the entire reason this feature is possible: a model call
per thread stops being a budget decision.

What Jev is not: it emits no prose and accepts no audio. Transcription stays on `whisper-1`
(`api/transcribe/route.ts`), meeting transcripts keep coming from Fathom, and every generative
surface in the app — advisor, brain, content, review — stays on Claude. Nothing else moves.

## Decisions

**Jev judges provenance and need; code keeps the bucket.** Three questions per thread:
`is_my_outreach` replaces `judgeThread`, `needs_nudge` is new, `urgency` ranks the page.
`classifyThread` is untouched — it is derivable with certainty from sender and order, and a
model could only make it worse. The split is the general rule: the model gets the judgements,
the code keeps the facts.

**One call per thread, not one per question.** Jev evaluates questions in parallel against a
single state, so three questions cost one round trip and one copy of the thread text.

**Plain `fetch`, no SDK.** The official docs and the practical guides disagree on the npm
package name (`typesafe-sdk` vs `@typesafe-ai/sdk`). It is one endpoint with a JSON body; the
repo already calls OpenAI this way in `api/transcribe/route.ts`. A week-old package is not
worth the dependency, and this keeps the vendor swappable.

**Degrade per thread, never fail the audit.** Missing key, exhausted retries, `529`, or a
malformed body falls that one thread back to `judgeThread` and marks the run `degraded`. A
TypeSafe outage costs ranking, not the audit. This mirrors Fathom's rule that a failed
transcript still returns the summary (`fathom/tools.ts:213`).

**One engine, both surfaces.** The page and the advisor tool both call
`auditSentFollowUps()`. Two follow-up judges in one codebase would drift, and the advisor
benefits from better judgement for the same reason the page does.

**Synchronous run, persisted result.** `POST /api/followups/run` does the Gmail paging and the
Jev fan-out in one request, matching `/api/news` and `/api/content`. Streaming is a contained
follow-up if the wait annoys in practice; neither the judge nor the storage would change.

**Storage splits by owner.** `followUpState` is the founder's own state — small, client-visible,
in `COLLECTIONS`. `followUpRuns` is server-authored and large, so it owns its table outside
`COLLECTIONS`, exactly as `contentPosts` does (`content/daily/store.ts:30`).

**Keep the last 10 runs.** Compare mode is worth building only if disagreements accumulate.
One run is a screenshot; ten is a sample worth a decision.

**Thresholds are named constants**, in the manner of `SIGNOFF_SEARCH_LINES` — one place to
tune, with a comment saying when to move them.

## Components

| File | Status | Purpose |
|---|---|---|
| `src/lib/jev/client.ts` | new | `isConfigured()`, `evaluate(state, questions)`, typed answers, 429/529 backoff. No Gmail knowledge. |
| `src/lib/jev/types.ts` | new | `NoulAnswer`, `ChoiceAnswer`, `ScoreAnswer`, `JevUsage`, `JevError`. |
| `src/lib/gmail/sentJudge.ts` | new | `buildJudgeState` and `interpretJudgement` (pure), `JUDGE_QUESTIONS` (data), `judgeThreads` (IO fan-out, concurrency 12). |
| `src/lib/gmail/sentAudit.ts` | edit | `judge?: "jev" \| "heuristic" \| "both"`; per-thread fallback; `judgeStats` on the result. |
| `src/lib/gmail/followUpRuns.ts` | new | Server-only table, own `ensureSchema`, keeps 10 runs. |
| `src/lib/db/sqlite.ts` | edit | `followUpState` added to `COLLECTIONS`. |
| `src/lib/types.ts` | edit | `FollowUpState`, `ThreadJudgement`, `JudgeStats`, `FollowUpRun`. |
| `src/app/api/followups/run/route.ts` | new | `POST {limit, judge}` → run, persist, return. |
| `src/app/api/followups/route.ts` | new | `GET` → last run + `{gmail, jev}` configured flags. |
| `src/app/follow-ups/page.tsx` | new | The page. |
| `src/components/followups/FollowUpRow.tsx` | new | One recipient: verdict, bucket, actions. |
| `src/components/followups/ComparePanel.tsx` | new | Agreement counts and the disagreement list. |
| `src/components/layout/nav.ts` | edit | `/follow-ups`, "Follow-ups", `MailWarning`, group Pipeline. |

`buildJudgeState` reuses `unquotedBody()` so the model reads the same de-quoted text the
sign-off test does, newest message first, truncated to a 6,000-character budget — comfortably
inside the 32k-per-question limit, and the recent messages are the ones that decide.

## The questions

```ts
export const JUDGE_QUESTIONS = {
  is_my_outreach: {
    type: "noul",
    instructions:
      "This thread is genuine correspondence written by the founder to a real person — " +
      "not a newsletter, receipt, automated notification, calendar invite or internal note.",
  },
  needs_nudge: {
    type: "noul",
    instructions:
      "The founder owes this person a follow-up now. False when the conversation reached " +
      "a conclusion: the deal closed, they declined, or a meeting is already booked.",
  },
  urgency: {
    type: "score",
    instructions: "How much does chasing this thread today matter?",
    criteria: ["Dead — do not chase", "Low — chase when idle",
               "Warm — chase this week", "Hot — chase today"],
  },
} as const;
```

## Data flow

```
POST /api/followups/run { limit, judge }
  → auditSentFollowUps()
      → Gmail paging (unchanged, FETCH_CONCURRENCY 8, SCAN_CAP 400)
      → per thread: buildJudgeState → judgeThreads (concurrency 12)
           ├── ok    → interpretJudgement → { included, needsNudge, urgency, source: "jev" }
           └── throw → judgeThread        → { included, source: "heuristic" }, run degraded
      → classifyThread (unchanged) → bucket
      → groupByRecipient (unchanged)
  → followUpRuns.save()
  → JSON { followUps[], judgeStats, capped, cappedReasons, listingFailures, degraded }
```

In `"both"` mode every thread gets both verdicts and the row carries `agrees: boolean`.

## The page

Header: scan size `50 / 150 / 400` (default 150), `[Run audit]`, `[⇄ Compare]`.

Status strip: last run, scanned / owed, cost in cents, elapsed — and the audit's existing
honesty flags, `capped`, `cappedReasons` and `listingFailures`, which are computed today and
read by nobody. A scan that covered half the mail says so.

List, sorted by urgency then days silent. Each row: recipient and company
(`companyFromEmail`), last subject, bucket chip, days silent, urgency dot with the
`needs_nudge` probability, and in compare mode `⚠ disagrees` with the heuristic's verdict
beneath. Actions: open in inbox, log interaction, + task, ✓ handled, snooze 7d — the first
three reusing `buildInteraction` / `buildLead` as `/inbox` does.

Compare panel: agreement counts across stored runs and a "disagreements only" filter.
Deliberately not a statistics dashboard — reading twenty disagreements settles the trust
question better than a coefficient does.

Banners: Gmail unconnected → `EmptyState` pointing at the `/inbox` connect flow. Jev unkeyed →
"ranking off; running the keyword heuristic — add `TYPESAFE_API_KEY`", matching how Settings
renders `configured` today (`settings/page.tsx:244`).

Handled and snoozed need no route: `followUpState` is in `COLLECTIONS` and rides the existing
store and `/api/data`.

## Error handling

| Condition | Behaviour |
|---|---|
| `TYPESAFE_API_KEY` absent | Whole run uses `judgeThread`; page banner says ranking is off. |
| `429` / `529` | Bounded exponential backoff, 3 attempts, then that thread degrades. |
| Non-2xx, malformed body, missing answer key | That thread degrades; error counted in `judgeStats.failures`. |
| Gmail listing failure | Unchanged — `listingFailures`, now actually surfaced. |
| Scan capped | Unchanged — `capped` + `cappedReasons`, now actually surfaced. |

`degraded` is `true` whenever any thread fell back, and the strip reads "N of 400 judged by
heuristic". A worse list is never served silently.

## Testing

This feature is a textbook setup for the defect this repo keeps producing: a capability wired,
typed and rendered that never returns real data — here, a judge that always falls back, with
every assertion green. The daily-engine branch found five assertions that passed against the
thing they were meant to detect (`2026-08-04-content-studio-daily-engine-STATUS.md:115`), and
the same shape reached production twice on the agent-registry branch, in the CRM snapshot and
Drive tools. Tests therefore assert resolved values, never declared configuration.

- **Pure.** `buildJudgeState`: newest-first order, 6k truncation, own-vs-counterparty split,
  quoted text removed. `interpretJudgement`: both sides of each threshold. `JUDGE_QUESTIONS`:
  score criteria within the 2–10 legal range.
- **Client.** Stubbed `fetch`: 429-then-success, 529 exhausting retries, malformed body,
  absent key.
- **Audit.** With a stubbed judge, `auditSentFollowUps` returns follow-ups carrying
  `source: "jev"` and real probabilities — asserting the returned data, never that a judge was
  constructed. Separately: a thrown `JevError` yields a heuristic verdict *and*
  `degraded: true`. Separately: `"both"` mode populates both verdicts and sets `agrees`.
- **Route.** `api/followups/run/route.test.ts` in the existing route-test style.
- **Mutation.** `scripts/mutate.sh` against the two assertions most likely to be hollow:
  invert the fallback branch, and move a threshold constant. A survivor means the check never
  fired.

## Out of scope

- Streaming the run (approach B); revisit if the wait annoys.
- A cron that runs the audit before the founder wakes up (approach C).
- Drafting replies — the advisor already writes follow-up messages.
- Jev anywhere else in the app. News ranking and buying-intent scoring are the next two
  candidates and are deliberately not touched here; one vendor integration, one surface,
  judged on its own evidence first.
