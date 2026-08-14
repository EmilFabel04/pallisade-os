# Agent registry and tool bus

**Date:** 2026-08-13
**Status:** approved

## Problem

Pallisade OS has three conversational AI surfaces — Brain, Sales Advisor and Projects
chat. Each hand-rolls its own system prompt, assembles its own tool array, and runs its
own copy of the same tool-use loop. The three routes total 482 lines and differ only in
which tools they gather:

| Route | Lines | Shape | Tools assembled |
| --- | --- | --- | --- |
| `api/advisor` | 178 | loop | `TOOLS` + `PROJECT_CONTEXT_TOOLS` + `EMAIL_TOOLS` + `CALENDAR_TOOLS` |
| `api/brain` | 157 | loop ×2 modes | `DRIVE_TOOLS` + `PROJECT_CONTEXT_TOOLS` (+ `web_search`) |
| `api/projects/chat` | 147 | loop | `PROJECT_TOOLS` |
| `api/prep` | 171 | **one-shot** | one inline `save_playbook` tool, forced `tool_choice` |

All three loops use `claude-sonnet-4-6`, all cap at `MAX_ITERATIONS = 8`, and all run the
same `stop_reason === "tool_use"` cycle. The loop is written three times.

`api/prep` is listed for contrast: it is a single forced-`tool_choice` call with no loop
and no message thread (`prep/route.ts:147-152`), so it is a structured generator, not a
conversational surface. It joins the registry when Meeting Prep is rebuilt as something
the founder can actually talk to (see Out of scope).

Three consequences follow, and they are the founder's actual complaints.

**The Brain is starved, not badly written.** `brain/prompt.ts` is a competent persona.
Its default strategist mode is granted exactly two tools — `list_projects` and
`get_project_context` (`brain/route.ts:63`) — against the Advisor's twenty-two. A
strategist that cannot see a lead, an interaction, a quote, the pipeline or the inbox will
give generic advice however good its prompt is. The fix is a tool grant, not a rewrite.

The Brain's two "modes" are themselves the evidence for a roster. `strategist` and
`brainstorm` are branches inside one route with different prompts and different tool sets
— `brainstorm` additionally gets `web_search`, `drive_search` and `drive_read_file`
(`brain/route.ts:101-105`). That is a two-agent bench implemented as an `if`. Adding a
third specialist today means a third branch.

**Three of the Advisor's tools are fake.** `src/lib/ai.ts` is a keyword matcher —
`pick(lines, ["pain", "struggle", "manual", ...])` — written as a stand-in for a real
model and never replaced. `advisor/tools.ts` imports `generateCallSummary`,
`generateBusinessReview` and `generateTomorrowPlan` from it directly, so those three
tools return regex output *always*, even with a valid API key. An LLM calls a keyword
matcher and presents the result as analysis.

**Failures are rendered as answers.** `aiClient.ts` wraps its `/api/ai` call in
`catch { /* fall through to mock */ }`. A missing key, a rate limit or a network blip
silently produces keyword-matched output that renders identically to real analysis. There
is no way to tell which one you got.

Adding a persona today means adding a route. There is nowhere to put the eight or so
`agency-agents` files worth adapting, and no way to grant one a toolset.

## Decisions

- **An agent is a file.** `src/agents/<id>.md`, in `agency-agents` frontmatter format
  extended with `surface` and `tools`. Vendored from
  [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) and adapted
  against Pallisade's real domain — the upstream files are generic role personas written
  for a coding-agent context, and dropped in verbatim they read as differently generic.
  The value taken is the format and the tool-binding architecture, not the catalogue.
- **One runtime.** The four duplicated loops collapse into `runAgent()`. Routes become
  thin adapters.
- **Capability groups, not tool lists.** Nine named bundles. Deepening the Brain is one
  line in a file.
- **`writes` is a group, off by default.** Mutations stay proposals that require the
  founder's confirmation. Grantable per agent rather than welded to the Advisor.
- **The mock is deleted. Failures fail loudly.** No fallback path may render a
  non-answer as an answer.
- **Conversational surfaces only, and initially only two of them.** The registry covers Brain
  and Advisor. **Projects chat is deferred** — see the note below.
  Content Studio's brief/draft/revise stages, pricing adjudication, news curation, AI
  Business Review and Meeting Prep keep their purpose-built code. They need
  schema-constrained output and deterministic gates, which a persona abstraction fights.
  Business Review and Meeting Prep are one-shot generators in particular — a form or a
  forced `tool_choice` call producing a typed result, with no message thread and no loop
  — so neither is a registry agent today. Business Review's mock still dies (see
  Disposition of the mock); it simply becomes a real structured call. Meeting Prep joins
  the registry only when it is rebuilt as a conversation.
- **Repo files are the baseline; the database may override the body.** The founder tunes
  personas live in Settings; the vendored file stays version-controlled and diffable.
- **A surface renders a roster.** Brain becomes a bench of specialists rather than one
  voice.

## Agent file format

```yaml
---
name: Deal Strategist
description: Pressure-tests live deals — qualification gaps, risk, next move.
color: "#10B981"
emoji: 🎯
vibe: Asks what has to be true for this to close.
surface: brain
tools: [crm, projects, web]
---
<system prompt body>
```

`name`, `description`, `color`, `emoji` and `vibe` are upstream's fields, so a vendored
file needs no reshaping to load. `surface` and `tools` are ours. `model` is an optional
override; absent, the runtime default applies.

Frontmatter is parsed by ~50 lines of hand-rolled code rather than a new dependency. The
app carries eleven runtime dependencies and no YAML parser; every field in every file
being vendored is a scalar or a flat string array. If upstream files ever need nested
YAML, revisit then.

## Capability groups

| Group | Backed by | Status |
| --- | --- | --- |
| `crm` | `TOOLS` — leads, tasks, projects, interactions, pain points, pipeline metrics | exists |
| `email` | `EMAIL_TOOLS` | exists |
| `calendar` | `CALENDAR_TOOLS` (read) | exists |
| `drive` | `DRIVE_TOOLS` | exists |
| `projects` | `PROJECT_CONTEXT_TOOLS` | exists |
| `web` | `web_search` | exists |
| `writes` | mutations, confirm-before-apply | exists, regrouped |
| `repo` | read a linked repo's files and commits | **new** |
| `fathom` | past meeting summaries and transcripts | **new** |

`repo` and `fathom` are specified here as group names and stubs only. Their tool
implementations are separate sub-projects (see Out of scope).

### Why Projects chat is deferred

Discovered during Task 7 and ruled on 2026-08-14. The `projects` group above grants
`PROJECT_CONTEXT_TOOLS` — `list_projects` and `get_project_context`, both cross-project and
read-only. Projects chat does not use those. It grants `PROJECT_TOOLS`
(`src/lib/projects/tools.ts:29-70`): `list_milestones`, `list_tasks`, `read_repo_status`,
`read_commits`, plus five mutations. **The two sets are disjoint**, so migrating that route
onto the `projects` group would strip the agent of every tool it actually uses.

The mismatch is structural, not clerical. Projects chat's tools are scoped to *one* project
and resolve against a `ProjectSnapshot`, which `AgentContext` does not carry — it holds an
`AdvisorSnapshot`. Closing that properly needs a new capability group and a context
extension, which is a design change rather than a migration.

There is also a name collision to disarm first: `src/lib/projects/tools.ts:27` exports its
own `SERVER_TOOL_NAMES = new Set(["read_repo_status", "read_commits"])`, meaning *resolved by
an async server-side resolver* — and those tools **do** receive a `tool_result`
(`projects/chat/route.ts:128-131`). `capabilities.ts:35` uses the same name to mean
*executed by Anthropic*, which must **not** receive one. Conflating them would hang the
project agent.

Brain and Advisor are the surfaces that motivated this work — Brain granted two tools,
Advisor calling a keyword matcher. Projects chat is not broken. It keeps its own loop until
a follow-up spec designs project-scoped agent context.

## Components

`src/lib/agents/`

- **`types.ts`** (~40) — `AgentSpec`, `CapabilityGroup`, `AgentContext`, `AgentResult`.
  No logic.
- **`frontmatter.ts`** (~50) — splits `---`-delimited frontmatter from body. Pure, no I/O.
- **`spec.ts`** (~70) — validates parsed frontmatter into an `AgentSpec`. Rejects unknown
  capability groups, missing `surface`, empty body. Errors name the file and the offending
  field, so a typo'd `tools: [crmm]` dies at load rather than mid-conversation.
- **`capabilities.ts`** (~90) — the bus. Maps group to `ToolDef[]` and dispatches a tool
  call to the owning resolver. Replaces the four `*_TOOL_NAMES` sets currently scattered
  across routes.
- **`registry.ts`** (~80) — reads `src/agents/*.md` at module scope, parses, validates,
  applies overrides. Exposes `getAgent(id)` and `listAgents(surface)`. Server-only.
- **`overrides.ts`** (~50) — `agentOverrides` table access. One row per edited agent:
  `id`, `body`, `updatedAt`. Frontmatter stays file-owned, so a Settings edit cannot
  silently grant `writes`.
- **`runtime.ts`** (~120) — the loop, once. Owns model selection, `max_tokens`, the
  iteration cap, the tool-use cycle and error mapping.

`src/agents/*.md` — the vendored and adapted personas.

**Build wiring.** `next.config.ts` gains `outputFileTracingIncludes` for `./src/agents/**`.
Without it the registry reads files that exist locally and are absent from the serverless
bundle, so the roster works in development and is empty in production. This is the one
non-obvious deployment trap in the design.

## Data flow

**Load**, once at module init:

```
src/agents/*.md ─┬─► frontmatter.parse ─► spec.validate ─┐
                 │                                       ├─► registry cache
DB agentOverrides ─────────── body override ─────────────┘
```

Validation failures throw at load. A malformed agent file fails the boot, not a
conversation.

**Roster.** `GET /api/agents?surface=brain` returns `{ id, name, description, color,
emoji, vibe }` per agent. Presentation fields only — the system prompt and the tool grant
never reach the browser.

**Turn.**

```
POST /api/brain { agentId, messages, mode }
  ├─ auth (existing middleware)
  ├─ registry.getAgent(agentId)        → AgentSpec  (404 if unknown)
  ├─ capabilities.toolsFor(spec.tools) → ToolDef[]
  └─ runAgent({ spec, tools, messages, context })
       └─ loop ≤ 8:
            messages.create({ model, system: spec.body, tools })
            ├─ stop_reason ≠ tool_use → return text
            └─ tool_use → capabilities.dispatch(name, args, context)
                            ├─ crm      → resolveTool
                            ├─ email    → resolveTool (gmail)
                            ├─ drive    → resolveBrainTool
                            ├─ projects → resolveProjectContextTool
                            ├─ repo     → resolveRepoTool     (new)
                            ├─ fathom   → resolveFathomTool   (new)
                            └─ writes   → queue proposal, return receipt
```

Two properties hold by construction.

**Context is server-assembled.** `AgentContext` carries the session identity, today's
date and the enabled-integration flags, all derived server-side. The client sends an
`agentId` and messages; it cannot widen its own tool grant by posting a capability list.
This preserves the current posture, where `advisor/route.ts` decides `emailEnabled` and
`calendarEnabled` on the server.

**Writes stay proposals.** A `writes` call does not mutate. It returns a receipt built by
the existing `describeAction`, the UI renders a confirm card, and `applyAction.ts` commits
on the founder's click. Behaviour is unchanged; only the grant becomes per-agent.

## Disposition of the mock

`src/lib/ai.ts` is deleted along with the fallback path in `aiClient.ts`. Its three
exported functions are not equivalent and do not share a fate.

- `generateCallSummary` and `generateBusinessReview` become real schema-constrained model
  calls, reusing the `output_config: { format: { type: "json_schema", schema } }`
  machinery already in `api/ai/route.ts`. The typed `CallSummary` and `BusinessReview`
  shapes that the database and UI depend on are preserved exactly.
- `generateTomorrowPlan` was never AI. It is deterministic ranking over open tasks, due
  follow-ups and the latest scorecard. It moves to `src/lib/plan/tomorrow.ts` as ordinary
  code and stops being presented as a model call.

## Error handling

A failure is never rendered as an answer.

| Failure | Today | After |
| --- | --- | --- |
| No `ANTHROPIC_API_KEY` | silent keyword-match | `agent_unconfigured` — "No model configured" |
| Model throws / rate limit | silent keyword-match | `agent_failed` — error state, retry, turn preserved |
| Unknown `agentId` | n/a | 404, roster refetch |
| Tool resolver throws | varies by route | error returned as `tool_result`; agent may recover |
| Iteration cap hit | silent truncation | `agent_max_iterations` — surfaced, partial answer kept |

Tool errors are deliberately non-fatal. They return as `tool_result` content so the agent
can say it could not reach the calendar rather than the whole turn dying — matching how
`resolveTool` already behaves.

## Testing

Unit tests per module, all pure and offline:

| Module | Asserted |
| --- | --- |
| `frontmatter` | delimiters, arrays, missing block, CRLF, `---` inside body |
| `spec` | unknown group rejected, missing `surface` rejected, empty body rejected, error names file and field |
| `capabilities` | group to resolved tool-name set; dispatch routes to the right resolver; unknown tool errors |
| `registry` | override beats file; reset restores file; `listAgents` filters by surface; projection omits `body` and `tools` |
| `runtime` | stops on non-`tool_use`; caps at 8; tool throw is non-fatal; each error maps to its own code |
| `overrides` | round-trip, reset, absent row |

`STATUS.md` for the content engine records that five of that plan's tests passed against
the very thing they were meant to detect, each found by mutation rather than review. This
design has the same trap shape, so four assertions are specified against it:

1. **Grant assertions resolve, they do not grep.** Asserting that Brain's prompt mentions
   CRM passes against any hardcoded string. Assert that `toolsFor(spec.tools)` returns the
   exact tool-name set, so dropping a group from the mapping kills the test.
2. **The projection test asserts the key set exactly.** Checking that the roster response
   *has* `name` and `color` still passes if it also leaks `body`.
3. **The `writes`-off-by-default test runs against the shipped roster.** Asserting it
   against a fixture proves nothing about the vendored files. Every real agent without an
   explicit `writes` grant must resolve to zero mutation tools.
4. **A regression guard greps the source tree** and fails if anything imports `@/lib/ai`.
   This is what stops the mock returning through a future merge.

A mutation sweep over `spec`, `capabilities` and `runtime` must hold at zero survivors,
using the harness described in `STATUS.md`.

**Live verification is part of done.** Open Brain in a browser, select each agent on the
bench, and confirm the tool grant works end-to-end against real data. The content engine
deferred exactly this step and its `STATUS.md` item #1 has been open since 2026-08-05.

## Out of scope

Sequenced follow-ups, each its own spec:

0. **Projects chat migration** — needs a project-scoped capability group and a
   `projectSnapshot` on `AgentContext`, plus resolution of the `SERVER_TOOL_NAMES` name
   collision described above. Deferred out of this branch on 2026-08-14.
1. **`repo` tools** — read a linked repo's files for project context. Extends the existing
   `readCommitsApi` and linked-repo gating.
2. **`fathom` tools** — sync past meeting summaries and transcripts via the Fathom public
   API (REST, webhooks, OAuth, TypeScript SDK at developers.fathom.ai).
3. **Meeting Prep rebuild** — on `sales-discovery-coach` plus Fathom history. This is
   where prep stops being a one-shot `save_playbook` generator and becomes a conversation,
   and so also where it migrates onto the registry as a fourth surface.
4. **Content Studio image prompts** — a new pipeline stage adapted from
   `design-image-prompt-engineer`. Pipeline code, not a registry agent.
5. **Pricing comparables** — the `comparables` table holds three synthetic fixtures
   ("Vendor Alpha/Beta/Gamma reporting suite", all near-identical, created 2026-08-10
   during the build). Every band is anchored on placeholder data. Two of three live quotes
   also carry a band with no intent read.
6. **Interaction form** — `whatTheySaid`, `painPoints`, `objections` and `buyingSignals`
   are AI outputs rendered as manual input boxes, which is why the founder fills Raw Notes
   and leaves four boxes empty.
7. **Settings colours.**
8. **Daily-loop information architecture** — deferred deliberately until the surfaces that
   survive are known.

`GITHUB_TOKEN` is absent from `.env.local` while present in `.env.example`, so
`github.ts:45` throws `no_token` and repo connect returns 503. That is a configuration
fix, not a design item.
