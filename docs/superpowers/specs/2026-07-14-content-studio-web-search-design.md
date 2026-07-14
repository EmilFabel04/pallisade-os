# Content Studio — Web Search — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan

## Summary

Give the Content Studio agent Anthropic's server-side `web_search_20250305` tool, so it
can pull in current outside information — a live trend to hook onto, a stat worth citing,
what competitors are saying — instead of working only from the positioning profile and
the founder's own CRM data.

The model decides when to search; there is no UI toggle. Sources are attributed inline in
the model's prose ("per TechCrunch last week…") rather than returned as structured data,
so the route's response shape and the client are untouched.

This mirrors the Brain agent's brainstorm loop
([src/app/api/brain/route.ts](../../../src/app/api/brain/route.ts):69-104), which already
combines `web_search` with local tools. No new dependency.

## Goals

- Content Studio can ground ideas in current, outside-the-CRM information.
- The model reaches for search on its own when currency or evidence would help.
- Web-derived claims are attributed inline so the founder can sanity-check them.

## Non-goals (YAGNI)

- No UI toggle for enabling/disabling search.
- No `sources` array in the API response; no source list rendered under messages.
- No streaming of search progress.
- No changes to the Brain agent or news curation.

## Architecture

Two files change. No UI, no data-layer change, no new package.

### 1. System prompt — [src/lib/content/prompt.ts](../../../src/lib/content/prompt.ts)

Extend the `HOW TO RESPOND` guidance in `buildContentSystemPrompt` with a `web_search`
paragraph covering three rules:

- **When to search.** Reach for `web_search` when current or outside information would make
  the content land harder — a live trend to hook onto, a statistic worth citing, what
  competitors or the market are saying right now. Skip it for pure voice, positioning, or
  structure work, where the profile is already the source of truth.
- **Attribution.** When a claim comes from the web, name the source inline in the prose
  ("per TechCrunch last week…"). No bare URLs, no appended link list.
- **Boundary.** The web is for the outside world only. The founder's own customers, pains,
  numbers and stories still come from `search_pain_points` / `query_leads` /
  `query_interactions`. The existing never-invent-client-detail rule is unchanged, and
  search results must not be used to embellish it.

`CONTENT_TOOL_NAMES` is **not** changed. It is the allowlist used to filter the local
`TOOLS` registry in the route; `web_search` is not in that registry — it is a server-side
Anthropic tool appended separately.

### 2. API route — [src/app/api/content/route.ts](../../../src/app/api/content/route.ts)

Three edits to the existing tool loop:

**a. Add the tool.** Build the request's tools array as the server-side search tool plus the
existing local subset:

```ts
const tools = [
  { type: "web_search_20250305", name: "web_search", max_uses: 4 },
  ...CONTENT_TOOLS,
] as unknown as Anthropic.Tool[];
```

`max_uses: 4` (Brain uses 5): Content Studio has `MAX_ITERATIONS = 6` and a tighter
`max_tokens` budget (3072 vs Brain's 4096). Search results are token-heavy, and a long
search sweep should not starve the actual draft.

**b. Handle `pause_turn`.** Anthropic may pause its server-side search loop mid-turn. The
current code at line 89 breaks on any stop reason other than `tool_use`, so without this
branch the route would truncate mid-search and return whatever partial text it had. Resume
by appending the partial assistant turn and re-requesting, with no synthetic `tool_result`:

```ts
if (response.stop_reason === "pause_turn") {
  messages.push({ role: "assistant", content: response.content });
  continue;
}
```

This must sit before the `stop_reason !== "tool_use"` break.

**c. Filter to local tool uses.** Anthropic executes `web_search` server-side and resolves it
inside `response.content`. Passing that block to `resolveTool` would produce a bogus result
for a tool the local registry doesn't know. Filter the `tool_use` blocks by
`CONTENT_TOOL_NAMES` before mapping them to `tool_result`, and use that filtered list for the
loop's break condition — the same shape as Brain's `driveUses` filter.

## Error handling

Unchanged. Search failures surface through the existing try/catch as a 502 with the error
message, which the client already renders in the thread. A search that returns nothing is a
normal model outcome, not an error — the model writes from the profile and CRM data as it
does today.

## Testing

- Extend [src/lib/content/prompt.test.ts](../../../src/lib/content/prompt.test.ts) with a case
  asserting the built prompt contains the web-search guidance and the inline-attribution
  rule. This follows the file's existing prompt-contents assertion pattern.
- The route's tool loop has no test today (neither does Brain's), and this change does not
  add a test harness for it. Verify by running the app and asking Content Studio for
  something that requires current information — confirm it searches, and that the reply names
  its sources inline.

## Reused building blocks

- `web_search_20250305` + `pause_turn` loop — [src/app/api/brain/route.ts](../../../src/app/api/brain/route.ts):69-104
- Local tool subset + `resolveTool` — [src/lib/advisor/tools.ts](../../../src/lib/advisor/tools.ts)
- Prompt builder + tool allowlist — [src/lib/content/prompt.ts](../../../src/lib/content/prompt.ts)
