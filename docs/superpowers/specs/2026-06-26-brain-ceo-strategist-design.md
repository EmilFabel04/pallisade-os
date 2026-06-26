# The Brain — CEO/Strategist (v1) — Design

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Overview

"The Brain" is a new top-level section of Pallisade OS intended to grow into the
main AI of the product. The long-term vision has **two modes**:

1. **Product Brainstorm** — ingest docs (`.md`) and call transcripts, research a
   company, study how similar problems have been solved with AI, and output a
   build scope/angle to hand off to Claude Code. *(Future — not in v1.)*
2. **CEO/Strategist** — a strategic sparring partner for positioning questions
   and big business decisions, reasoning like a seasoned founder/investor.

**v1 ships only the CEO/Strategist mode.** The code and prompt are structured so
the second mode can be added later without rework, but v1 has no visible stub for
it.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| First build | CEO/Strategist mode only |
| Context it reasons over | **Pure strategic sparring partner** — no business data, no tools. You bring the situation in conversation. |
| Interaction model | **Open, threaded chat** (like Sales Advisor) — multiple saved threads, multi-turn |
| Persona representation | **One distilled master voice, cites specific people/frameworks when genuinely relevant** |
| Model | **Configurable via env**, default `claude-sonnet-4-6` |
| Streaming | Non-streaming for v1 (matches every other route) |
| Naming / placement | Page `/brain`, nav label "Brain", **Intelligence** group |

## Architecture

Mirrors the **Content Studio** pattern, but simpler: **no tools and no data
snapshot**. Because there are no tools, the API route is a single
`messages.create()` call — no iteration loop, no snapshot building, no write
proposals or confirmation UI.

### Files

| File | Role |
|---|---|
| `src/lib/brain/prompt.ts` | `buildBrainSystemPrompt(input)` — the distilled master-operator persona |
| `src/app/api/brain/route.ts` | `GET` → `{ configured, model }`; `POST { messages }` → single Claude call → `{ content }` |
| `src/lib/brainClient.ts` | `getBrainStatus()`, `sendBrainTurn({ messages })` |
| `src/app/brain/page.tsx` | Threaded chat UI; reuses `ThreadList` + `MessageBubble` |
| `src/lib/types.ts` | Add `BrainThread` interface + `brainThreads` to `DataShape` |
| `src/lib/store.tsx` | Register `brainThreads` in `EMPTY` |
| `src/lib/seed.ts` | Seed `brainThreads: []` |
| `src/components/layout/nav.ts` | Add the nav item |

### Data model

Add to `src/lib/types.ts`:

```ts
export interface BrainThread extends BaseRecord {
  title: string;                 // auto-derived from the first user message
  messages: ChatMessage[];       // reuse existing ChatMessage
}
```

And register in `DataShape`:

```ts
brainThreads: BrainThread[];
```

`brainThreads` is a normal collection (a `CollectionKey`). It is **not** part of
`AdvisorSnapshot` (the Brain doesn't read business data, and its own threads
should never leak into other agents' snapshots).

`ChatMessage` is reused as-is. Brain assistant turns never carry `actions` (no
write tools), so the `ProposedAction` card path in `MessageBubble` is simply
never exercised here.

### API route — `src/app/api/brain/route.ts`

- **Runtime:** Node (same as other agent routes).
- **`GET`** → `{ configured: boolean, model: string }` where
  `configured = !!process.env.ANTHROPIC_API_KEY` and
  `model = process.env.BRAIN_MODEL || "claude-sonnet-4-6"`.
- **`POST`** body: `{ messages: { role: "user" | "assistant"; content: string }[] }`.
  - Guard: if no API key → `503` with a clear message; if `messages` missing/empty
    → `400`.
  - Build system prompt via `buildBrainSystemPrompt({ businessName, founderName, today })`.
    `businessName`/`founderName` are passed from the client (read from
    `store.settings`), `today` derived server-side.
  - Single `client.messages.create({ model, system, messages, max_tokens: 4096 })`.
  - Extract concatenated `text` blocks from the response.
  - Return `{ content: string }`.
  - On Anthropic/SDK error → `500` with a safe message.

No tool loop, no `MAX_ITERATIONS`.

### Client — `src/lib/brainClient.ts`

- `getBrainStatus(): Promise<{ configured: boolean; model: string }>` — `GET /api/brain`.
- `sendBrainTurn(params: { messages; businessName; founderName }): Promise<{ content: string }>`
  — `POST /api/brain`.

Follows the shape of `src/lib/contentClient.ts`.

### Page — `src/app/brain/page.tsx`

- `"use client"`, uses `useStore()`.
- Layout: left sidebar = `ThreadList` over `brainThreads` (new / select / delete);
  right panel = message history (`MessageBubble`) + composer textarea + send.
- On mount: `getBrainStatus()`; if not configured, render the existing
  setup-warning panel (same as Content Studio / Advisor).
- On send:
  1. Ensure an active thread (create one if none; title derived from first user message).
  2. Append the user `ChatMessage` to the thread in the store.
  3. Call `sendBrainTurn({ messages, businessName, founderName })`.
  4. Append the assistant `ChatMessage` with the returned `content`.
- Persistence is via the existing store/adapter; no new persistence code.

### Navigation — `src/components/layout/nav.ts`

Add:

```ts
{ href: "/brain", label: "Brain", icon: <Lucide icon>, group: "Intelligence" }
```

Icon: a `lucide-react` icon evoking strategy/mind (e.g. `Brain` or `Sparkles` —
final pick at implementation time, must be a valid current export).

## The persona — `buildBrainSystemPrompt()`

Input: `{ businessName, founderName, today }`. Produces a system prompt with four
parts:

1. **Identity** — a seasoned founder/operator who has built, scaled, and IPO'd
   companies. Speaks as **one distilled voice** synthesizing the judgment of ~50
   of the best founders, investors, bankers, and tech CEOs. Knows the founder's
   name, the business name, and today's date.
2. **How it thinks** — reasons from first principles; separates one-way-door
   (irreversible) decisions from two-way-door (reversible) ones; identifies the
   real binding constraint and the second-order effects; names the risks and the
   most likely failure mode, not just the upside.
3. **How it answers** — when a decision is genuinely underspecified, it asks the
   *one* sharpest clarifying question rather than guessing ("I need X before I can
   advise" is an acceptable full answer in that case). Otherwise it gives a clear,
   opinionated recommendation — not a wishy-washy menu of options. It cites
   specific people or frameworks **only when genuinely relevant** (e.g. "treat
   this as a one-way door", "Buffett's circle of competence applies here"), never
   as name-dropping.
4. **Tone** — direct, high-signal, concise, zero flattery. Tells the founder what
   they need to hear.

## Error handling

- No API key: `GET` reports `configured: false`; page shows setup warning; `POST`
  returns `503`.
- Empty/malformed request: `400`.
- Upstream model error: `500` with a safe message; the page surfaces it inline and
  does not persist a broken assistant turn.

## Testing

- **Route unit/integration:** `GET` returns correct `configured`/`model`;
  `POST` with no key → `503`; `POST` with empty `messages` → `400`; `POST` happy
  path returns `{ content }` (Anthropic client mocked).
- **Prompt:** `buildBrainSystemPrompt` includes the founder/business name and
  today's date and the four persona sections.
- **Page (light):** renders setup warning when unconfigured; sending appends user
  then assistant messages to the active thread.
- Match the existing test conventions in the repo (check how content/advisor
  routes are currently tested, if at all, and follow suit).

## Out of scope (v1)

- Product Brainstorm mode (doc/transcript ingestion, company research, scope
  hand-off to Claude Code).
- Any document upload / knowledge base.
- Web search / company background checks.
- Business-data tools or snapshot access.
- Streaming responses.
- "Commit to memo" / structured decision-memo export.

## Future extension notes

- A `mode` discriminator can be added to `BrainThread` and a mode switch added to
  the page when Product Brainstorm lands; the prompt builder can branch on mode.
- Document ingestion and web research are the major net-new subsystems the second
  mode will require; each warrants its own spec.
