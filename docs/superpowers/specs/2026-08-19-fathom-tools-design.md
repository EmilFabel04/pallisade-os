# Fathom meeting tools

**Date:** 2026-08-19
**Status:** approved

Follow-up #2 from `2026-08-13-agent-registry-tool-bus-design.md` §"Out of scope". Stacks on
`2026-08-17-projects-chat-migration-design.md` — it extends `AgentContext` and the
capability bus, neither of which carries this branch's shape on `main` yet.

## Problem

`fathom` has been a capability group name returning `[]` since the registry shipped
(`capabilities.ts:60`). An agent may declare it today and receive nothing.

The founder records every sales call in Fathom. Nothing in Pallisade OS can read them, so
every agent reasons about a deal from CRM fields and typed interaction notes — a summary of
a conversation, written afterwards, by the person who was in it. What was actually said is
in a transcript no agent can reach.

Two questions are currently unanswerable:

- **Per-deal.** "What did Acme push back on last time?" The Advisor has the lead, the
  quote and whatever was typed into Raw Notes. It does not have the call.
- **Cross-deal.** "Which objections keep coming up?" Nothing can read across meetings at
  all.

There is no `FATHOM_API_KEY` in `.env.local` or even `.env.example` — Fathom has never been
wired here in any form.

## Decisions

**Live API, no local sync.** Tools call Fathom in-request. The alternative — a
`fathomMeetings` table filled by a cron — buys real search and offline access at the cost
of a table, a migration, a cron route, sync state, a backfill, and a staleness mode where
the agent answers confidently from old data. At a solo founder's meeting volume a 90-day
window is one or two paginated calls. Revisit when a query arrives that live cannot answer.

**`GET /meetings` has no text-search parameter**, only `created_after`, `created_before`
and `recorded_by[]`. Search is therefore fetch-a-window-and-filter-in-memory. This is why
search returns summaries only and never transcripts: summaries are short, so a window is
cheap; transcripts are fetched one at a time, on demand, by the second tool.

**The group gates on availability.** `AgentContext` gains `fathomEnabled`, and
`grantsFor("fathom", ctx)` returns `[]` when it is false. Without the gate an agent
declaring `fathom` receives two tools that answer every call with "Fathom is not
connected", and relays that to the founder as a fact about their own integrations. That
exact failure has happened twice in this codebase — CRM snapshot and Drive — and the
handover names `repo` and `fathom` as the next two to produce it. The gate closes it by
construction rather than by assertion.

**Truncation is reported, never silent.** Pagination caps at 5 pages. When the cap bites,
the payload carries `truncated: true` and `scanned`, and the tool description tells the
model to say so. A partial scan rendered as a complete answer is the same defect class as
a capped turn rendered as a finished one, which the previous branch fixed with `stopNotice`.

**Light lead matching only.** `company` is matched against the `crm_matches` companies and
contacts Fathom already returns, plus meeting title and attendee emails. Joining Fathom
meetings to the `leads` table by id is deferred to the Meeting Prep rebuild, which is the
work that needs it.

**No new runtime dependencies.** Fathom ships TypeScript and Python SDKs; this uses plain
`fetch`. The app deliberately carries 11 dependencies.

## Components

**`src/lib/fathom/config.ts`** — `isConfigured(): boolean` → `!!process.env.FATHOM_API_KEY`.
Mirrors `gmail/config.ts:40`. Callers guard with it; `apiKey()` throws if missing.

**`src/lib/fathom/client.ts`** — server-only HTTP client against
`https://api.fathom.ai/external/v1`, header `X-Api-Key`.

- `listMeetings(params: { createdAfter?: string; createdBefore?: string; cursor?: string }): Promise<{ items: FathomMeeting[]; nextCursor: string | null }>`
- `getTranscript(recordingId: string): Promise<FathomTranscriptLine[]>`
- `FathomAuthError` for 401, `FathomRateLimitError` for 429. Both carry no response body —
  the caller turns them into prose for the model.

Types are declared here from the documented response shape: meeting metadata, `transcript`
(speaker, text, timestamp), `default_summary` (markdown), `action_items`, `crm_matches`
(contacts, companies, deals). Only the fields the tools use are typed; unknown fields are
ignored rather than mapped.

**`src/lib/fathom/tools.ts`** — `FATHOM_TOOLS: ToolDef[]`, `FATHOM_TOOL_NAMES: Set<string>`,
`resolveFathomTool(name, args): Promise<string>`. Structurally `brain/tools.ts:40` with a
different backend: never throws, every failure becomes a JSON `{ error }` the model can
read and relay.

**`src/lib/agents/types.ts`** — `AgentContext` gains `fathomEnabled: boolean`.

**`src/lib/agents/capabilities.ts`** — `grantsFor` gains the gated `fathom` case; `dispatch`
gains a `FATHOM_TOOL_NAMES` branch.

**`src/lib/brain/availability.ts`** — gains `resolveFathomEnabled(spec)`:
`spec.tools.includes("fathom") && isConfigured()`. Synchronous — unlike email, calendar and
Drive this is an env read, not a DB read, so there is no cost to gate against and no
`Promise.all` to join.

**`src/agents/*.md`** — `sales-advisor`, `discovery-coach` and `pipeline-analyst` add
`fathom` to `tools`, plus one body paragraph each on when to reach for it.

**The three agent routes** — each sets `fathomEnabled` on the context it builds.

## The tools

### `fathom_search_meetings`

| Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `company` | string | — | matched against `crm_matches` companies/contacts, title, attendee emails |
| `query` | string | — | matched against title and `default_summary` |
| `sinceDays` | number | 90 | window start, as `created_after` |
| `limit` | number | 20 | rows returned after filtering |

Returns `{ meetings: [{ id, title, date, attendees, companies, summaryExcerpt }], scanned, truncated }`,
where `scanned` is the number of meetings **examined before filtering** (not pages, not rows
returned) and `truncated` says the page cap stopped the scan before the window was exhausted.

Both filters are case-insensitive substring matches, ANDed when both are given. Omitting
both returns the most recent meetings in the window — the "what have I been in lately"
case.

### `fathom_read_meeting`

| Arg | Type | Default | Meaning |
| --- | --- | --- | --- |
| `recordingId` | string | **required** | id from `fathom_search_meetings` |
| `includeTranscript` | boolean | false | fetch the full transcript |

Returns `{ title, date, attendees, summary, actionItems, transcript? }`. The transcript is
clipped to `MAX_TRANSCRIPT_CHARS = 40000` with a trailing `[truncated]`, matching how
`brain/tools.ts` clips a Drive file.

Transcript defaults to off because a summary answers most questions at a fraction of the
tokens, and an 8-iteration loop that pulls three full transcripts will hit the turn's
output ceiling before it answers.

## Data flow

1. A route resolves the spec, computes `fathomEnabled = spec.tools.includes("fathom") && isConfigured()`, and puts it on `AgentContext`.
2. `toolsFor` grants `FATHOM_TOOLS` only when that flag is true.
3. The model calls `fathom_search_meetings`. `dispatch` routes on `FATHOM_TOOL_NAMES` to `resolveFathomTool`.
4. The resolver pages `listMeetings` from `now - sinceDays`, stopping at 5 pages or when `nextCursor` is null, filters in memory, and returns at most `limit` compact rows plus `scanned`/`truncated`.
5. The model calls `fathom_read_meeting` with an id from step 4, optionally with `includeTranscript: true`, which adds one `getTranscript` call.

## Error handling

`resolveFathomTool` never throws. Every branch returns a JSON string the model reads.

| Condition | Payload | Notes |
| --- | --- | --- |
| `FATHOM_API_KEY` unset | `{"error":"Fathom is not connected. Add FATHOM_API_KEY to .env.local and restart."}` | unreachable while the grant is gated; kept as defence in depth |
| 401 | `{"error":"Fathom rejected the API key."}` | `FathomAuthError` |
| 429 | `{"error":"Fathom's rate limit was hit. Try again in a moment."}` | `FathomRateLimitError` |
| other non-2xx | `{"error":"Fathom could not be reached right now."}` | status logged, body not relayed |
| network failure | same as above | |
| unknown tool name | `{"error":"unknown tool: <name>"}` | |
| no matches | `{"meetings":[],"scanned":N,"truncated":false}` | an empty result is data, not an error |

No route error codes change. These are tool results, not HTTP responses.

## Testing

The handover names this work specifically: "**`repo` and `fathom` will fail this way unless
the deeper assertion is written from day one**" — the failure being a grant test that
asserts a group resolves to tool *definitions* and never that a resolved tool returns
*data*. Every test below is checked against a mutant.

**Each tool returns data.** With `fetch` stubbed to a fixture meeting, `dispatch("fathom_search_meetings", …)` returns a payload containing that meeting's title, and `dispatch("fathom_read_meeting", …)` returns its summary. Not `toolsFor` membership — the parsed payload.

**The gate holds.** `toolsFor(["fathom"], ctx)` with `fathomEnabled: false` returns `[]`; with it true, exactly the two names. `dispatch` on a fathom tool with the flag false still returns a legible error rather than throwing.

**Filtering is real.** Given three fixture meetings, `company: "Acme"` returns only the Acme one — matched via `crm_matches`, and in a second case via attendee email when `crm_matches` is empty. `query` matches summary text, not only the title.

**Truncation is surfaced.** A stub returning a `nextCursor` forever produces `truncated: true` and a `scanned` count equal to the meetings across 5 pages, not a silent partial result. A stub whose window fits in two pages produces `truncated: false`.

**Transcript is opt-in and clipped.** `includeTranscript` omitted makes no `getTranscript` call at all (asserted on the stub's call count); set true, an over-budget transcript comes back ending `[truncated]`.

**Errors become prose.** A stubbed 401, 429 and 500 each produce their table row above, and none throws.

**The existing anti-blindness guard is updated, not weakened.** `capabilities.test.ts`
asserts `expect(empty).toEqual(["repo", "fathom"])` — that every group with an
implementation grants something. Implementing `fathom` makes it fail, correctly; it becomes
`["repo"]`. Changing it to a `toContain` or dropping `fathom` from the array without
implementing it would defeat the guard.

**Disjointness still holds.** `fathom_search_meetings` and `fathom_read_meeting` collide
with nothing; the existing pairwise test covers it once the fixture sets `fathomEnabled`.

No test makes a network call: `fetch` is stubbed at the module boundary. No test touches
`data/pallisade.db`.

## Out of scope

- **A local `fathomMeetings` table and its cron.** Revisit when a query arrives that live cannot answer.
- **Joining meetings to the `leads` table by id.** Belongs to the Meeting Prep rebuild.
- **Webhooks.** Fathom offers them; nothing here needs push.
- **OAuth.** A single-user local-first app uses an API key. OAuth matters for a public integration.
- **Meeting Prep rebuild** — the next follow-up, and the first consumer of these tools.
- **Granola.** The founder is trialling it; its API needs a Business plan where Fathom's works on all tiers. If the switch sticks, the swap is `client.ts` and the field mapping — the tools, the gate, the group and every test above are provider-neutral.
