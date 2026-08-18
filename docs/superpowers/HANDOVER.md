# Pallisade OS — session handover

**Written:** 2026-08-17
**For:** the next session picking up the reshape

Read this, then `docs/superpowers/specs/2026-08-13-agent-registry-tool-bus-design.md` §"Out of
scope" — that list is the sequenced backlog.

---

## Where things stand

**PR #7 is merged.** `origin/main` is at `9f58ecb`. The agent registry shipped: 1011 tests
(from 824), `tsc --noEmit` clean, `npm run build` clean.

**Repo state to fix first — 30 seconds:**

```bash
git checkout main && git pull        # local main is 39 commits behind origin/main
git branch -d feat/agent-registry   # merged, safe to delete
```

The working tree is clean and the local `feat/agent-registry` branch still exists.

## What the reshape is

Emil asked to reshape Pallisade OS around **one opinionated daily loop** rather than a menu of
20 nav sections. Standing judgements from 2026-08-13: Brain underdeveloped, Content Studio
generic with no image prompts, Meeting Prep useless and shallow. He uses the Pipeline core and
the Intelligence layer weekly.

The agent registry was phase one — the foundation the AI surfaces sit on. Everything below is
still open.

## What shipped (do not redo)

An AI persona is now a file: `src/agents/<id>.md`, agency-agents frontmatter plus a system
prompt, validated into an `AgentSpec`, granted tools by capability group, run by one
`runAgent()` in `src/lib/agents/runtime.ts`.

| Agent | Surface | Tools |
| --- | --- | --- |
| `strategist` ("The Brain") | brain | `[crm, projects, drive, email, calendar, web]` |
| `product-brainstorm` | brain | `[projects, drive, web]` |
| `deal-strategist` | brain | `[crm, projects, email, calendar]` |
| `discovery-coach` | brain | `[crm, calendar]` |
| `pipeline-analyst` | brain | `[crm, email]` |
| `sales-advisor` | advisor | `[crm, projects, email, calendar, writes]` |

- The Brain went from **2 tools to 15**. `advisor/route.ts` 178→140 lines, `brain/route.ts`
  157→114, both delegating to the shared runtime.
- **`src/lib/ai.ts` is deleted.** It was a keyword matcher (`pick(lines, ["pain","struggle",
  "manual",…])`) that three Advisor tools called directly and `aiClient.ts` fell back to
  silently. A regression guard test fails if anything imports it again.
- Personas are editable in Settings (body only — `agentOverrides` has no `tools` column, so a
  UI edit can never widen a capability).
- `scripts/mutate.sh` exists. Use it.

## Backlog, in the order the spec sequences it

1. **Projects chat migration.** Blocked on design, not effort. The `projects` capability group
   grants `PROJECT_CONTEXT_TOOLS`; `projects/chat/route.ts` uses `PROJECT_TOOLS` — **disjoint
   sets**. Needs a project-scoped group and a `projectSnapshot` on `AgentContext`. **Disarm
   first:** `src/lib/projects/tools.ts:27` exports its own `SERVER_TOOL_NAMES` meaning
   "resolved by an async server resolver, DOES get a `tool_result`" — the exact inverse of
   `capabilities.ts:35`, which means "Anthropic-executed, must NOT". Conflating them hangs the
   agent.
2. **`repo` tools** — currently a group name returning `[]`. Read a linked repo's files for
   project context; extends `readCommitsApi` and the linked-repo gating in `api/git/route.ts`.
3. **`fathom` tools** — also `[]` today. Fathom has a public API (REST, webhooks, OAuth, TS
   SDK) at developers.fathom.ai. Scan past meeting summaries.
4. **Meeting Prep rebuild** — on `sales-discovery-coach` plus Fathom history. Note: prep is
   currently a **one-shot** forced-`tool_choice` generator (`prep/route.ts:147-152`), not a
   conversation. It joins the registry when it becomes one. Emil called it "useless and
   shallow".
5. **Content Studio image prompts** — a new pipeline stage adapted from
   `design-image-prompt-engineer`. Pipeline code, **not** a registry agent — those stages need
   schema-constrained output and deterministic gates.
6. **Pricing.** The engine is sound; its inputs are fake. `comparables` holds 3 synthetic rows
   ("Vendor Alpha/Beta/Gamma reporting suite", created 2026-08-10 during the build, all
   near-identical). Every price band is anchored on placeholder data. Two of three live quotes
   also carry a band with no intent read. **Needs Emil's market knowledge, not code.**
7. **Interaction form.** `whatTheySaid`, `painPoints`, `objections`, `buyingSignals` are AI
   *outputs* (there's a generate button at `interactions/page.tsx:192`) rendered as manual
   input boxes. Emil correctly never fills them. `settings.accentColor` already exists, which
   is the hook for #8.
8. **Settings colours.**
9. **Daily-loop IA reshape** — held back deliberately until it's known which surfaces survive.

## Configuration only Emil can do

- **`GITHUB_TOKEN` is absent from `.env.local`** (present in `.env.example`). `github.ts:45`
  throws `no_token` → repo connect 503s. Needs a fine-grained PAT with Contents: read, then
  `vercel env add GITHUB_TOKEN production` too.
- Also missing locally: `NEWS_MODEL`, `REDDIT_CLIENT_ID/SECRET`, `TURSO_DATABASE_URL`.
  `CRON_SECRET` is set locally — verify it exists on Vercel.
- **Content Studio has never run.** `voiceSamples: 0`, `positioningProfiles: 0`,
  `contentPosts: 0`. It needs three writing samples pasted at `/content` → Rebuild fingerprint
  → Generate before it can do anything. This has been open since 2026-08-05.

## Unused surfaces (evidence for the IA reshape)

Empty tables: `targets`, `dialLists`, `notes`, `metricEntries`, `newsInterests`, `newsFeed`,
`playbooks`, `voiceSamples`, `positioningProfiles`, `contentPosts` — against 20 nav items in
`src/components/layout/nav.ts`.

## Two failure modes this codebase reliably produces

Both are documented at length in
`docs/superpowers/plans/2026-08-13-agent-registry-tool-bus-STATUS.md`. A green suite is the
least reliable signal in this repo.

1. **An assertion that passes against the thing it is meant to detect.** Five instances on the
   content-studio branch, four more on the agent-registry branch. Example: deleting the
   `SERVER_TOOL_NAMES` filter left all 8 runtime tests green, because the fixture was insulated
   twice over. Only running the mutant catches these.
2. **A capability granted but not wired.** A tool can appear in the list the model receives and
   still answer every call with an error. Happened twice (CRM snapshot, Drive) — and in Drive's
   case the agent told Emil his connected Drive was disconnected. Both times the grant
   assertions were green, because they assert a declared group resolves to tool *definitions*,
   never that a resolved tool returns *data*. **`repo` and `fathom` will fail this way unless
   the deeper assertion is written from day one.**

Across 17 tasks and 11 fix rounds, 14 real defects were caught — **11 of them in the plan, not
the implementation**. Budget review effort at the specification, not the code.

## Working conventions

- **Never let a test touch `data/pallisade.db`.** `getClient()` (`src/lib/db/client.ts:16`)
  defaults to it and it holds real data: 11 leads, 3 quotes, 5 interactions, 12 tasks, 8 pain
  points, 5 projects, 7 milestones, 16 scorecards, 3 comparables. Redirect
  `TURSO_DATABASE_URL` to a temp file in `beforeAll` (see `src/lib/agents/overrides.test.ts`)
  or mock `@/lib/agents/overrides` (see `src/lib/agents/roster.test.ts`). Verify by row counts,
  not by file checksum — a checksum flags a harmless chat thread and a wiped table identically.
- **Server-authored tables must NOT go in `COLLECTIONS`** (`src/lib/db/sqlite.ts`). `saveAll()`
  deletes and reinserts every listed collection from a client snapshot, so a stale browser tab
  would wipe them. Follow `src/lib/content/daily/store.ts`.
- No new runtime dependencies without a reason — the app deliberately carries 11.
- Route errors use `apiError(code, status, cause)`. Passing the cause is what makes it log.
- Tests are colocated `src/**/*.test.ts`, `environment: "node"`, no DOM library — components
  are verified in a browser, not unit-tested. `vitest.config.ts` excludes `.test.tsx`.

## Known minors carried forward

- `runtime.ts` folds nothing else into `stoppedBy` now, but truncation notices are guarded by
  **source-grep tests** rather than rendered behaviour, because there is no jsdom environment.
  Adding one is the natural fix.
- `src/lib/brain/availability.ts` is imported by the Advisor route — the path misdescribes
  ownership. `src/lib/agents/` is the natural home.
- `brain/route.ts` imports `buildSnapshot` from `@/lib/advisorClient`, a browser-framed module.
  Harmless (no `"use client"`, `fetch` only inside function bodies) but a layering smell.
- `src/lib/plan/tomorrow.ts` has **zero production consumers** — Task 9 extracted it, Task 10
  deleted its only caller. Either wire it back or delete it.
- `CALENDAR_TOOLS` in `advisor/tools.ts` is a dead export.
- Error-code divergence: `agent_unconfigured` on the two migrated routes, `no_key` on ~10
  others.
- No `error.tsx` boundary under `src/app`.
- `/settings` issues 9 requests on load (one per agent plus one roster call per surface).
- `AdvisorSnapshot` is still client-supplied on `/api/advisor`; the Brain now loads its own
  server-side. The spec's "context is server-assembled" property covers the capability grant
  and integration flags, not the Advisor's data picture.
