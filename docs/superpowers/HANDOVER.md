# Pallisade OS — session handover

**Written:** 2026-08-20
**For:** the next session picking up the reshape

Read this, then `docs/superpowers/specs/2026-08-13-agent-registry-tool-bus-design.md` §"Out of
scope" — that list is still the sequenced backlog, minus the two items now done.

---

## Where things stand

**PR #7 (agent registry) and PR #8 (projects chat migration) are merged.** `origin/main` is at
`1c8e9f0`. **PR #9 (Fathom meeting tools) is open** and is the tip of the work.

The suite is at **1107 tests** (824 → 1011 → 1051 → 1107 across three branches),
`tsc --noEmit` clean, `npm run build` clean.

**Repo state to fix first — two minutes:**

```bash
git checkout main && git pull            # local main is behind origin/main
gh pr edit 9 --base main                 # #9 still targets the merged feat/projects-chat-migration
git branch -D feat/agent-registry        # -D, not -d: its one commit was cherry-picked, so the
                                         # SHA differs but the content is on main
```

`gh pr edit 9 --base main` matters. #9 was opened as a stacked PR against
`feat/projects-chat-migration`; that branch merged, but GitHub only auto-retargets when the base
is deleted. As it stands #9 cannot be merged sensibly.

## What the reshape is

Emil asked to reshape Pallisade OS around **one opinionated daily loop** rather than a menu of
20 nav sections. Standing judgements from 2026-08-13: Brain underdeveloped, Content Studio
generic with no image prompts, Meeting Prep useless and shallow. He uses the Pipeline core and
the Intelligence layer weekly.

The agent registry was phase one. Phases two and three are below.

## What shipped this session (do not redo)

**Projects chat migration (PR #8, merged).** `api/projects/chat` was the last conversational
route running its own hand-rolled tool-use loop; it now runs on the shared `runAgent()` like
Brain and Advisor. A `delivery` capability group grants the nine project-scoped tools, gated on
`ctx.projectSnapshot` so a misdeclared grant yields nothing. Context is assembled server-side —
the client sends a `projectId` and three presentation strings, nothing more. `src/agents/project-agent.md`
carries the persona; `buildProjectSystemPrompt` became `buildProjectStateBlock` and emits facts
only. Full record: `docs/superpowers/plans/2026-08-17-projects-chat-migration-STATUS.md`.

That branch also fixed a bug that had been load-bearing and untested since the tool bus was
written: **`create_task` and `update_task` existed in both the CRM and project tool sets**, with
different schemas and resolvers, while `dispatch()` routes purely by name. The project pair is
renamed `create_project_task` / `update_project_task`, `applyAction` accepts both generations so
pre-rename proposals still confirm, and a test now asserts no two capability groups grant the
same tool name.

**Fathom meeting tools (PR #9, open).** `fathom` went from a group name returning `[]` to two
tools: `fathom_search_meetings` (pages a 90-day window capped at 5 pages, filters in memory by
company or keyword, reports `scanned` / `matched` / `truncated`) and `fathom_read_meeting`
(locates one meeting by `recording_id`, optional clipped transcript). Gated on `FATHOM_API_KEY`.
Granted to `sales-advisor`, `discovery-coach` and `pipeline-analyst`. Full record:
`docs/superpowers/plans/2026-08-19-fathom-tools-STATUS.md`.

### Capability groups as they stand

| Group | Backed by | Declared by |
| --- | --- | --- |
| `crm` | `READ_TOOLS` | strategist, deal-strategist, discovery-coach, pipeline-analyst, sales-advisor |
| `email` | `EMAIL_TOOLS` | strategist, deal-strategist, pipeline-analyst, sales-advisor |
| `calendar` | `CALENDAR_READ_TOOLS` | strategist, deal-strategist, discovery-coach, sales-advisor |
| `drive` | `DRIVE_TOOLS` | strategist, product-brainstorm |
| `projects` | `PROJECT_CONTEXT_TOOLS` — cross-project, read-only | strategist, deal-strategist, product-brainstorm, sales-advisor |
| `delivery` | `PROJECT_TOOLS` — one project, reads and mutations | project-agent |
| `web` | `web_search` | strategist, product-brainstorm |
| `writes` | CRM mutations + `create_calendar_event` | sales-advisor |
| `fathom` | `FATHOM_TOOLS` | discovery-coach, pipeline-analyst, sales-advisor |
| **`repo`** | **still `[]`** | nobody |

`repo` is the only group left granting nothing.

## Backlog, in the order the spec sequences it

1. **`repo` tools** — the last empty group. Read a linked repo's files for project context;
   extends `readCommitsApi` and the linked-repo gating in `api/git/route.ts`. Blocked on
   `GITHUB_TOKEN` for the connect flow, though local git reads already work through
   `readCommits`/`readStatus`. **The `delivery` and `fathom` test suites are the template** for
   the deeper assertion this needs — assert a resolved tool returns *data*, not that a group
   resolves to tool definitions.
2. **Meeting Prep rebuild** — now unblocked; PR #9 is its data source. On `discovery-coach` plus
   Fathom history. Note prep is still a **one-shot** forced-`tool_choice` generator
   (`prep/route.ts:147-152`), not a conversation. It joins the registry when it becomes one.
   Emil called it "useless and shallow".
3. **Content Studio image prompts** — a new pipeline stage adapted from
   `design-image-prompt-engineer`. Pipeline code, **not** a registry agent — those stages need
   schema-constrained output and deterministic gates.
4. **Pricing.** The engine is sound; its inputs are fake. `comparables` holds 3 synthetic rows
   ("Vendor Alpha/Beta/Gamma reporting suite", created 2026-08-10 during the build, all
   near-identical). Every price band is anchored on placeholder data. **Needs Emil's market
   knowledge, not code.**
5. **Interaction form.** `whatTheySaid`, `painPoints`, `objections`, `buyingSignals` are AI
   *outputs* (generate button at `interactions/page.tsx:192`) rendered as manual input boxes.
   Emil correctly never fills them.
6. **Settings colours.** `settings.accentColor` already exists.
7. **Daily-loop IA reshape** — held back deliberately until it is known which surfaces survive.

## Unverified work — read this before trusting either branch

**Nobody has driven the projects chat migration through a browser, and it is now on `main`.**
Everything verified was `tsc`, `vitest`, `next build` and a DB row count. `.tsx` is excluded from
this repo's vitest config, so `store.flush()` in the real React lifecycle, the stop notice and
the proposal card have **no automated coverage of any kind**. A 14-step checklist is in
`docs/superpowers/plans/2026-08-17-projects-chat-migration-STATUS.md` §"Outstanding". Step 8
exercises the store's hydration guard — the one path that could write an empty state over the
real database. **Back up `data/pallisade.db` before running it.**

**No call has ever been made against the real Fathom API.** Every test in PR #9 stubs `fetch` or
mocks the client; the wire mapping is verified against Fathom's published reference, not a live
response. This matters more than usual — see failure mode 3 below, which is exactly the defect
that class of verification missed. Set `FATHOM_API_KEY`, ask the Advisor what was discussed with
a real company, and confirm the summary comes back **non-empty**.

## Configuration only Emil can do

- **`FATHOM_API_KEY` is absent** from `.env.local` (now present in `.env.example`). Generate one
  at developers.fathom.ai — available on all Fathom tiers, header `X-Api-Key`. Without it the
  `fathom` group grants nothing, by design, so the three personas silently lose the tools.
- **`GITHUB_TOKEN` is absent** from `.env.local` (present in `.env.example`). `github.ts:45`
  throws `no_token` → repo connect 503s. Needs a fine-grained PAT with Contents: read, then
  `vercel env add GITHUB_TOKEN production` too. **Blocks backlog #1.**
- Also missing locally: `NEWS_MODEL`, `REDDIT_CLIENT_ID/SECRET`, `TURSO_DATABASE_URL`.
  `CRON_SECRET` is set locally — verify it exists on Vercel.
- **Content Studio has never run.** `voiceSamples: 0`, `positioningProfiles: 0`,
  `contentPosts: 0`. It needs three writing samples pasted at `/content` → Rebuild fingerprint →
  Generate. Open since 2026-08-05.
- **Granola.** Emil mentioned on 2026-08-19 that he is now using Granola rather than Fathom, then
  chose to keep building on Fathom because its API works on all tiers where Granola's needs a
  Business plan. If the switch sticks, the swap is `src/lib/fathom/client.ts` and the field
  mapping — the tools, the gate, the group and every test are provider-neutral. Granola's API is
  `https://public-api.granola.ai/v1/`, bearer `grn_` keys, `GET /v1/notes`.

## Unused surfaces (evidence for the IA reshape)

Empty tables: `targets`, `dialLists`, `notes`, `metricEntries`, `newsInterests`, `newsFeed`,
`playbooks`, `voiceSamples`, `positioningProfiles`, `contentPosts` — against 20 nav items in
`src/components/layout/nav.ts`.

## Three failure modes this codebase reliably produces

The first two are documented at length in the agent-registry STATUS. The third was found on
2026-08-19 and is new. **A green suite is the least reliable signal in this repo.**

1. **An assertion that passes against the thing it is meant to detect.** Example from this
   session: a test named "ignores a client-supplied snapshot" posted a forged snapshot with
   *empty* milestone and task arrays and asserted only on the project name — so a route that
   trusted client milestones passed all twelve tests. Only running the mutant catches these.
   `scripts/mutate.sh` exists. Use it.
2. **A capability granted but not wired.** A tool can appear in the list the model receives and
   still answer every call with an error. Both new groups close this by construction rather than
   by assertion: `delivery` grants `[]` without a `projectSnapshot`, `fathom` grants `[]` without
   an API key. **`repo` needs the same gate on day one.**
3. **A request that cannot return the fields whose names you audited.** Fathom's `GET /meetings`
   gates `default_summary`, `crm_matches` and `action_items` behind `include_*` query parameters
   that **all default to `false`**. PR #9 ran *four separate field-name audits*, passed all four,
   and would have shipped empty summaries on every path while passing 1096 tests — because the
   tool tests mock the client with fixtures that already carry those fields. Auditing that field
   names are correct is **not** the same as auditing that the request will return those fields.
   Caught only by the whole-branch review reading the API docs, never by a test.

## Where the defects are, across three branches

| Branch | Defects | In the plan | In the implementation |
| --- | --- | --- | --- |
| Agent registry | 14 | 11 | 3 |
| Projects chat migration | 8 | 8 | 0 |
| Fathom tools | 13 | 13 | 0 |

**32 of 35 defects were in the plan's own prose or test code, not in an implementer departing
from it.** Budget review effort at the specification. Two habits that would have caught most of
them:

- **Check a spec's stated invariants against the spec's own later sections**, the way a
  typechecker checks a type against its uses. Four of PR #9's thirteen defects were the *same*
  doctrine — "a partial scan must never be presented as a complete answer" — violated in four
  places downstream of where it was written. Re-reading the document caught none of them.
- **Review the plan's test code before dispatching anything.** That is where the assertions that
  cannot fail live.

## Working conventions

- **Never let a test touch `data/pallisade.db`.** `getClient()` (`src/lib/db/client.ts:16`)
  defaults to it and it holds real data: 11 leads, 3 quotes, 5 interactions, 12 tasks, 8 pain
  points, 5 projects, 7 milestones, 16 scorecards, 3 comparables. Redirect `TURSO_DATABASE_URL`
  to a temp file in `beforeAll` (see `src/lib/agents/overrides.test.ts`) or mock the module (see
  `roster.test.ts`). **Verify by row counts, not by file checksum** — a checksum flags a harmless
  chat thread and a wiped table identically.
- **No test may reach the network.** Stub `fetch` with `vi.stubGlobal` and restore with
  `vi.unstubAllGlobals()`, or mock the client module. And make it a *property*, not an accident:
  a test that avoids a live call only because an env var happens to be unset becomes a live call
  on the first machine where it is set.
- **Server-authored tables must NOT go in `COLLECTIONS`** (`src/lib/db/sqlite.ts`). `saveAll()`
  deletes and reinserts every listed collection from a client snapshot, so a stale browser tab
  would wipe them. Follow `src/lib/content/daily/store.ts`.
- **Tool names must be globally unique across capability groups.** `dispatch()` routes purely by
  name-set membership; a pairwise disjointness test in `capabilities.test.ts` now enforces it,
  guarded by a companion test asserting every implemented group grants something under a
  fully-enabled fixture. **When you implement `repo`, that guard's `expect(empty).toEqual(["repo"])`
  becomes `toEqual([])` — and its fixture needs whatever flag `repo` gates on, or the guard goes
  blind to the group it exists to watch.**
- No new runtime dependencies without a reason — the app deliberately carries 11.
- Route errors use `apiError(code, status, cause)`. **Passing the cause is what makes it log.**
- Tests are colocated `src/**/*.test.ts`, `environment: "node"`, no DOM library — components are
  verified in a browser, not unit-tested. `vitest.config.ts` excludes `.test.tsx`.
- `next.config.ts` carries `outputFileTracingIncludes` for `./src/agents/**`. Without it the
  registry reads files that exist locally and are absent from the serverless bundle, so the
  roster works in development and is empty in production.

## Known minors carried forward

Both STATUS docs carry full triaged lists; these are the ones worth acting on.

- **`ActionCard.tsx`'s `ICON` map has no entry for `create_milestone`, `update_milestone` or
  `update_project`**, so those proposals render a `Plus`. An *edit* showing a plus sign is the
  wrong-direction case. Three lines.
- **`ProjectChat.tsx`'s `milestones`/`tasks` props are now unused in its JSX**, though
  `ChatTab.tsx:18` and `projects/[id]/page.tsx:174` still compute and pass them.
- **`PROMPT_BUDGET` bounds only the project state block**, not the assembled system prompt.
- **`src/lib/plan/tomorrow.ts` has zero production consumers.** Either wire it back or delete it.
- **`src/lib/brain/availability.ts` is imported by the Advisor route** — the path misdescribes
  ownership now that it also resolves Fathom. `src/lib/agents/` is the natural home.
- `CALENDAR_TOOLS` in `advisor/tools.ts` is a dead export.
- Error-code divergence: `agent_unconfigured` on the three migrated routes, `no_key` on ~9 others.
- No `error.tsx` boundary under `src/app`.
- `/settings` issues one request per agent plus one roster call per surface on load.
- The `fathom` tool schemas describe their defaults but not the new `MAX_SINCE_DAYS = 365` /
  `MAX_LIMIT = 50` clamps, so the model is not told a large value will be clamped.
