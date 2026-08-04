# Content Studio — Daily Engine — Design

**Date:** 2026-08-04
**Status:** Approved (design), pending implementation plan

## Summary

Content Studio produces generic, repetitive output. This design replaces the
"ask and hope" chat model with a **daily engine**: every morning at 06:00 SAST a
cron job mines what actually happened in Pallisade OS, commits to two specific
editorial angles, drafts two LinkedIn posts, and puts them through a
deterministic anti-slop gate before they reach the founder. No prompting
required.

The chat surface at `/content` stays exactly as it is, for going deeper on a
given idea. The daily engine is additive.

## The problem, diagnosed

The symptom is "generic and repetitive". Those are two different failures with
two different causes, and neither is fixable by prompt tuning:

1. **Repetitive — cold start every time.** `contentThreads` holds no record of
   what was already generated or posted. Nothing can tell the model "you have
   used the reconciliation angle three times." Repetition is architecturally
   guaranteed.
2. **Repetitive — thin raw material.** The database holds 8 pain points, 5
   interactions and 10 leads. Even a great writer repeats themselves with 8
   facts. Meanwhile scorecards (wins / problems / lessons), projects,
   milestones, notes and metric movements — the actual texture of the working
   week — are never read by the content agent at all.
3. **Generic — grounding is optional.** [`prompt.ts:73`](../../../src/lib/content/prompt.ts)
   asks the model to "use the read tools", but nothing forces a post to attach
   to a specific real record. Absent that, the model writes plausible-sounding
   generalities, because it can.
4. **Generic — no taste signal.** Nothing captures which drafts the founder
   loved or killed, so the system never converges on his voice.

A fifth cause is in the prompt itself: the format rules in `contentTypeMeta()`
are generic LinkedIn advice ("lead with a strong hook", "one idea per post").
That is the prompt that produces LinkedIn-cliché output.

## Decisions taken

| Decision | Choice |
| --- | --- |
| Source material | The founder's day, auto-mined. Zero daily input. |
| Output | 2 LinkedIn posts per day, differing pillar **and** format. |
| Voice | Seeded from pasted writing samples, refined by keep / kill / edit. |
| Surface | A "Today" panel at the top of `/content`. |
| Topic selection | Material-led, with hard rotation guardrails. |
| Quiet days | Reach back to unused logged material first, news feed second. |

## Goals

- Two posts every morning without being asked.
- Every post traceable to a specific real record the founder can click and verify.
- Output that does not read as machine-written, measured objectively rather than
  asserted.
- A feedback loop that makes month three better than month one.

## Non-goals (YAGNI)

- No auto-posting to LinkedIn. The founder copies, pastes, and eyeballs every post.
- No scheduling or queueing beyond today's two.
- No published-performance analytics (unavailable without the LinkedIn API).
- No image or carousel generation.
- LinkedIn only — no X, no video scripts.

## Craft sources

The anti-slop layer is built from external, citable sources rather than invented
rules:

- **[Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)**
  (CC BY-SA 4.0) — a community-maintained catalogue of AI tells, used by
  Wikipedia editors to detect machine text. Supplies the banned vocabulary
  ("delve", "boasts", "landscape", "tapestry", "testament", "underscore",
  "robust", "showcase", "pivotal", "crucial", "meticulous", "intricate",
  "foster", "garner", "enhance", "align with", "valuable insights"), the
  negative-parallelism patterns ("It's not X, it's Y"; "Not only… but also";
  "no ___, no ___, just ___"), the rule-of-three tic, and the formatting tells
  (em-dash overuse, mechanical bolding, `- **Header:** text` lists, emoji as
  bullet markers).
- **Burstiness** — `stddev(sentence lengths) / mean(sentence lengths)`. Human
  prose swings between short punches and long constructions; machine prose
  hovers at a uniform length. Values below ~0.30 read as machine-written, and it
  is reportedly a cleaner separator than vocabulary analysis. Computable with no
  model involvement.
- **[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)**
  (MIT) — 60+ marketing skills for coding agents by the founder of Swipe Files.
  The `copywriting`, `copy-editing`, `marketing-psychology` and `social` skills
  supply the craft rules for the draft stage. MIT permits direct adaptation;
  attribute in a source comment in `craft.ts`.
- **Specificity as a hard rule** — "we increased leads" is forgettable; "we
  increased leads by 47% in 3 weeks" stops the scroll. Made checkable by
  requiring a concrete anchor that traces back to a real record.

Deliberately **not** used: `write-good`, `retext`, `proselint`, `alex`. They
catch passive voice and weasel words, which is not the failure mode here. Vale
is a genuinely good configurable linter, but it is a Go binary and the
configurable house-style part is precisely what this design builds itself. Our
own rules are targeted, dependency-free and unit-testable.

## Architecture

### 0. Storage split — who authors what

[`sqlite.ts:133`](../../../src/lib/db/sqlite.ts) implements `saveAll` as
`DELETE FROM <collection>` followed by a reinsert of everything the client sent,
and [`apiAdapter.ts:24`](../../../src/lib/db/apiAdapter.ts) PUTs the **entire**
`DataShape` on every save.

This is a real hazard for cron-authored data. A tab opened at 05:00 holds a
snapshot without today's posts. The cron writes them at 06:00. The founder edits
a lead at 09:00 in that same tab, the client PUTs its stale snapshot, and the
`DELETE` wipes the posts. The empty-payload guard at `sqlite.ts:107` does not
cover this case — the payload is not empty, merely stale.

The design therefore splits collections by author:

- **Client-authored** — `voiceSamples`, `voiceProfile`. Added to `COLLECTIONS`
  in [`sqlite.ts:16`](../../../src/lib/db/sqlite.ts), to `DataShape` in
  [`types.ts`](../../../src/lib/types.ts) and to the store's initial state in
  [`store.tsx`](../../../src/lib/store.tsx), exactly like every other
  collection. The founder writes these, so full-replace is safe.
- **Server-authored** — `contentPosts`, `contentRuns`. Deliberately **kept out
  of `COLLECTIONS`**, with their own tables, their own schema bootstrap, and
  their own endpoints. The cron owns them. Client mutations (keep / kill / edit)
  go through a targeted `PATCH` rather than a full-state PUT.

New module `src/lib/content/daily/store.ts` owns the server-authored tables. It
mirrors the existing table shape (`id TEXT PRIMARY KEY, json TEXT NOT NULL,
updated_at TEXT`) and carries its own `ensureContentSchema()` with the same
once-per-process promise-caching pattern as `ensureSchema()` in `sqlite.ts:41`.
It exposes `listPosts(date)`, `savePosts(posts)`, `patchPost(id, changes)`,
`recentPosts(days)`, `saveRun(run)` and `latestRun()`.

### 1. Data model

Client-authored, in `types.ts`:

```ts
interface VoiceSample extends BaseRecord {
  text: string;
  source: "linkedin" | "email" | "voice-note" | "other";
}

interface VoiceStats {
  burstiness: number;            // stddev/mean of sentence lengths
  avgSentenceLength: number;     // words
  shortSentenceRatio: number;    // share of sentences under 8 words
  contractionRate: number;       // contractions per 100 words
  questionRate: number;          // questions per 100 sentences
  avgParagraphSentences: number;
  emojiPerPost: number;
  firstPersonRate: number;       // I/my/we per 100 words
}

// Singleton collection, following the newsFeed pattern.
interface VoiceProfile extends BaseRecord {
  stats: VoiceStats;      // measured from samples, not guessed
  fingerprint: string;    // prose description of the voice
  neverSay: string[];     // seeded from samples, grown from kill reasons
  sampleCount: number;
  computedAt: string;
}
```

Server-authored, in `src/lib/content/daily/types.ts`:

```ts
type ContentPillar =
  | "client-pain" | "build-log" | "contrarian"
  | "proof" | "teardown" | "lesson";

type PostFormat =
  | "scene" | "one-idea" | "before-after"
  | "claim-defence" | "numbers" | "short-punch";

type KillReason =
  | "boring" | "not_my_voice" | "not_true"
  | "wrong_angle" | "already_said";

interface SourceRef {
  collection: string;   // e.g. "painPoints"
  id: string;
  anchor: string;       // the concrete detail lifted from this record
}

interface EditorialCheck {
  rule: string;         // e.g. "ai-tells", "burstiness"
  passed: boolean;
  detail: string;       // human-readable, specific, actionable
}

interface ContentPost {
  id: string;
  date: string;                 // YYYY-MM-DD
  slot: 1 | 2;
  pillar: ContentPillar;
  format: PostFormat;
  sourceRefs: SourceRef[];
  claim: string;                // committed in the brief, before drafting
  body: string;
  openingLine: string;          // denormalised for collision checks
  checks: EditorialCheck[];
  revisions: number;
  status: "draft" | "needs_work" | "kept" | "killed" | "posted";
  killReason: KillReason | null;
  editedBody: string | null;    // the founder's edits — highest-signal feedback
  createdAt: string;
  updatedAt: string;
}

interface ContentRun {
  id: string;
  date: string;
  status: "ok" | "thin" | "failed";
  ledgerSize: number;
  reachback: boolean;
  usedNews: boolean;
  degraded: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
```

Rotation memory needs no storage of its own — it is a query over `contentPosts`.

### 2. The editorial structure

**Six pillars** (what a post is about):

| Pillar | What it draws on |
| --- | --- |
| `client-pain` | A real problem someone described in a call or a pain-point record |
| `build-log` | What was shipped, broke, or got fixed |
| `contrarian` | Where the AI/automation consensus is wrong |
| `proof` | A concrete result carrying a real number |
| `teardown` | A broken process and what it should be |
| `lesson` | Something that went wrong and what it cost |

**Six formats** (how a post is shaped):

| Format | Shape |
| --- | --- |
| `scene` | A specific moment, the turn, the point |
| `one-idea` | A single observation, developed, no list |
| `before-after` | The broken way against the fixed way, concrete on both sides |
| `claim-defence` | A sharp assertion, then the reasoning that earns it |
| `numbers` | Built around real figures |
| `short-punch` | Under 80 words, one blow |

**Guardrails**, enforced in `rotation.ts` as code, not as prompt instructions:

- A pillar is not reused within **4 days**.
- A format is not reused within **3 days**.
- A specific source record is not reused within **21 days**.
- The day's two posts must differ in **both** pillar and format.
- An opening line must not collide with the last **30** opening lines.

### 3. The pipeline — `src/lib/content/daily/`

**Stage 0 · `harvest.ts` — pure, no model call.**

Scans `interactions` (rawNotes, whatTheySaid, painPoints, objections,
buyingSignals), `painPoints`, `leads` (painPoint, objection, buyingSignal,
notes), `projects` and `milestones` (stage changes, currentBlocker, nextAction),
`scorecards` (wins, problems, lessons, avoidTomorrow), `notes`, and
`metricEntries` — the last qualifying only when a metric's value differs from
its trailing 7-day mean by more than 50%, which is what makes it remarkable
enough to write about.

Each candidate becomes a `MaterialItem`:

```ts
interface MaterialItem {
  collection: string;
  id: string;
  date: string;
  text: string;
  anchors: string[];
  pillarHints: ContentPillar[];
  score: number;
}
```

`anchors` are extracted deterministically, and the definition is deliberately
narrow so the function stays testable: numerals including currency amounts and
percentages, dates, capitalised multi-word proper nouns, and spans already
quoted in the source text. Nothing inferred.

`pillarHints` come from a fixed keyword-to-pillar map in `craft.ts` — a
scorecard's `problems` field hints `lesson` and `teardown`, an interaction's
`painPoints` hints `client-pain`, a milestone reaching `done` hints `build-log`
and `proof`. Hints only bias Stage 1's choice; they do not decide it.

Scored on recency + specificity (does it carry anchors at all) + emotional
charge (problem / lesson / win language) + unusedness. Anything referenced by a
post within 21 days is excluded outright.

Fallback ladder: an empty ledger over the last 7 days triggers **reachback**
(widen to all-time unused material). A still-empty ledger triggers **news mode**
(react to the existing `newsFeed` through the positioning profile). Both are
recorded on the `ContentRun` so the Today panel can say which happened.

**Stage 1 · `brief.ts` — model call 1, forced JSON output.**

Input: the top ~12 ledger items, rotation memory, the positioning profile, and a
summary of the voice fingerprint. Output: two briefs, each
`{ sourceRefs, pillar, format, claim, anchor, why }`.

The output is **validated in code** against the guardrails. A brief that reuses
a pillar from two days ago is rejected and retried once with the violation named
explicitly. Enforcement is deterministic; the model is not trusted to remember.

This stage is what kills generic at the root. A post cannot be written unless
there is a specific claim tied to a specific real detail. The current prompt
lets the model write around having nothing to say; this one does not.

**Stage 2 · `draft.ts` — model call 2.**

Writes both posts against their briefs, the full voice fingerprint, the two or
three nearest voice samples by format, the craft rules adapted from
`marketingskills`, and the anti-slop constitution from `craft.ts`.

**Stage 3 · `gate.ts` — pure, no model call.**

| Check | Rule | Example failure detail |
| --- | --- | --- |
| `ai-tells` | Wikipedia catalogue plus a LinkedIn extension ("Here's the thing", "Let that sink in", "Read that again", emoji bullets) | `line 3: negative parallelism "It's not X, it's Y"` |
| `burstiness` | Measured against the founder's own baseline, not a generic threshold | `0.22 — every sentence is 12-16 words` |
| `specificity` | At least one concrete anchor that also appears in the cited source record | `no verifiable detail — post is unfalsifiable` |
| `broetry` | More than 60% of paragraphs are a single sentence | `12 of 14 paragraphs are one line` |
| `opener-collision` | Against the last 30 opening lines | `same shape as the 2026-07-29 opener` |
| `never-say` | The founder's accumulated never-say list | `uses "leverage", which you have killed twice` |

Every failure returns a specific, actionable message. "Make it better" is never
sent to the model.

**Stage 4 · `revise.ts` — model call 3, only when a post fails.**

The named defect list goes back with the original brief. Maximum two rounds. A
post still failing after that is stored as `needs_work` and shown with its
failures visible — never silently shipped, never silently dropped.

**Orchestrator · `run.ts`** — sequences the stages, writes the `ContentRun`, and
is shared by the cron and the manual regenerate button. Roughly three model
calls per day.

### 4. Voice fingerprint — `src/lib/content/voice.ts`

- `measure(text): VoiceStats` — pure, no model. The same function runs over the
  founder's samples and over every draft.
- `profileFromSamples(samples): VoiceStats` — takes the **median** of per-sample
  stats so a single odd sample cannot skew the profile.
- The prose `fingerprint` and the seed `neverSay` list come from one model call,
  refreshed only when samples change. Not a daily cost.
- `compare(draft, profile): Deviation[]` — returns which metrics fall outside
  tolerance, feeding the `burstiness` gate and the revise prompt.

Because the profile is numeric, "sounds like him" becomes a measurable claim
rather than a hope. Drafts are checked against *his* numbers, not generic ones.

### 5. API, cron and middleware

- `POST /api/content/daily` — runs the pipeline. Authorised by either
  `Authorization: Bearer ${CRON_SECRET}` or an authenticated NextAuth session,
  so the same route serves the cron and the Regenerate button. Idempotent: a
  no-op when today's posts already exist and `force` is not set.
- `GET /api/content/posts?date=YYYY-MM-DD` — the Today panel's read path.
- `PATCH /api/content/posts/:id` — keep / kill / edit. Accepts `status`,
  `killReason`, `editedBody` only.
- `vercel.json` gains a cron entry: `{ "path": "/api/content/daily",
  "schedule": "0 4 * * *" }` — 04:00 UTC is 06:00 SAST.
- [`src/middleware.ts:6`](../../../src/middleware.ts) matcher gains an exclusion
  for `api/content/daily`. NextAuth currently fronts every route except
  `/api/auth`, so an unmodified matcher would bounce the cron request to
  `/login`. The `CRON_SECRET` check inside the route does the real gating.
- `CRON_SECRET` is added to `.env.example` with a comment explaining it is set
  automatically by Vercel for cron invocations and must be mirrored into project
  environment variables.

### 6. UI

`TodayPanel` sits at the top of `/content`, above the existing chat. Two cards,
each showing pillar and format chips, the post body, and **the source record as
a link** — into the lead, pain point, project or scorecard it came from — so the
founder can verify the post is true in one click. Failed checks render inline
rather than being hidden.

Per-card actions: **Copy**, **Edit** (inline textarea writing to `editedBody`),
**Keep**, **Kill**. Kill opens one-tap reason chips mapping to `KillReason`.
Those taps and the edit diffs are the entire feedback loop.

How that feedback actually lands, since a reason chip alone does not identify an
offending phrase:

- Choosing `not_my_voice` reveals an optional one-line "which bit?" input. Text
  entered there is appended to `neverSay` verbatim. Left blank, the kill still
  counts but adds no phrase.
- All other kill reasons store the post body as a **negative example**. The
  three most recent killed bodies for the chosen pillar are passed to
  `draft.ts` as "you wrote these and they were rejected for <reason>".
- Where `editedBody` differs from `body`, the pair is passed to `draft.ts` as a
  before/after example. This is the strongest available signal — it shows the
  correction rather than describing it.
- `neverSay` is capped at 60 entries, oldest dropped first, so the draft prompt
  cannot grow without bound.

**Regenerate this one** re-runs stages 1-4 for a single slot, excluding the
rejected material from the ledger.

The sidebar gains a **Voice** panel: paste samples, view the measured stats and
sample count, rebuild the fingerprint. The existing chat, thread list,
positioning-profile manager and content-type selector are unchanged.

### 7. Error handling

- Cron fails → the run is stored with `status: "failed"` and the error; the
  Today panel shows it with a Retry button.
- Cron never ran (paused deploy, missed schedule) → a page-load staleness check,
  the same pattern as [`news/page.tsx:79`](../../../src/app/news/page.tsx),
  triggers a run client-side when there is no run for today and it is past
  06:00.
- Fewer than 3 voice samples, or no positioning profile → the panel shows a
  setup prompt naming exactly what is missing, and no run is attempted.
- Invalid brief JSON → one retry, then the run fails cleanly with a specific error.
- Anthropic unreachable → the run is marked failed and yesterday's posts stay on
  screen rather than the panel emptying.
- Thin day → `status: "thin"`, and the panel states which fallback was used
  ("reached back to older material" / "built from your news feed").

### 8. Testing

Vitest, matching the existing pattern in `prompt.test.ts`, `curate.test.ts` and
`snapshot.test.ts`. The pure layer carries real coverage:

- `harvest.test.ts` — scoring order, the 21-day exclusion, the reachback
  trigger, and the empty-ledger-to-news-mode path.
- `voice.test.ts` — burstiness arithmetic against hand-computed strings, median
  aggregation across samples, tolerance comparison.
- `gate.test.ts` — every rule fires on a known-bad string and stays quiet on a
  known-good one; specificity anchor tracing back to a source record; the
  broetry ratio boundary; opener collision.
- `rotation.test.ts` — guardrail validation accepting and rejecting brief
  combinations, including the same-day pillar/format clash.

Model calls are not unit-tested. `run.ts` is tested with stubbed stage
responses to cover the fallback ladder, the revise loop's two-round cap, and the
`needs_work` terminal state.

## File layout

```
src/lib/content/
  prompt.ts              (existing — the chat surface, unchanged)
  voice.ts               measure / profileFromSamples / compare   [pure]
  daily/
    types.ts             ContentPost, ContentRun, pillars, formats
    store.ts             server-authored tables + ensureContentSchema()
    harvest.ts           material ledger                          [pure]
    rotation.ts          guardrail validation                     [pure]
    gate.ts              the anti-slop checks                     [pure]
    craft.ts             pillars, formats, anti-slop constitution, craft rules
    brief.ts             model call 1
    draft.ts             model call 2
    revise.ts            model call 3
    run.ts               orchestrator
src/app/api/content/daily/route.ts
src/app/api/content/posts/route.ts
src/app/api/content/posts/[id]/route.ts
src/components/content/TodayPanel.tsx
src/components/content/VoicePanel.tsx
```

## Implementation phasing

The design is one coherent feature but too large for a single undifferentiated
push. The implementation plan should sequence it so each phase is independently
verifiable:

1. **Pure core** — `voice.ts`, `harvest.ts`, `rotation.ts`, `gate.ts`,
   `craft.ts`, with their tests. No model calls, no UI, no schema. This is the
   part that carries the quality argument, and it can be proven correct in
   isolation.
2. **Storage** — `types.ts`, `store.ts`, the `COLLECTIONS` additions for
   `voiceSamples` and `voiceProfile`, and `ensureContentSchema()`.
3. **Voice capture** — `VoicePanel`, so real samples exist before anything tries
   to imitate them. Nothing downstream is meaningful without this.
4. **Pipeline** — `brief.ts`, `draft.ts`, `revise.ts`, `run.ts`, driven manually
   through the Regenerate path.
5. **Surface** — `TodayPanel`, the posts endpoints, the feedback loop.
6. **Automation** — the cron entry, the middleware exclusion, `CRON_SECRET`, and
   the page-load staleness fallback. Deliberately last: the engine should be
   producing posts worth reading before it starts producing them unattended.

## Open risks

- **Material exhaustion.** With 8 pain points and 5 interactions today, the
  21-day reuse window plus reachback covers roughly three to four weeks before
  the well runs dry and news mode dominates. The engine's quality is bounded by
  how much the founder logs; the Today panel should surface `ledgerSize` so the
  trend is visible rather than discovered through declining posts.
- **Voice profile cold start.** The fingerprint needs at least 3 samples and is
  meaningfully better at 8-10. The first week's posts will be the weakest.
- **Burstiness thresholds need tuning.** The ~0.30 figure comes from AI-detector
  literature on long-form prose; short LinkedIn posts behave differently. The
  founder's own measured baseline is the real target, so the generic threshold
  is only the floor for the cold-start case.
