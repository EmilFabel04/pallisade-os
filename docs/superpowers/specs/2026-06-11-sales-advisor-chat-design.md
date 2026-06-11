# Sales Advisor Chat — Design

**Date:** 2026-06-11
**Status:** Approved (pending spec review)

## Summary

Add a **Sales Advisor** — a conversational, agentic chat interface inside Pallisade
OS that can read all of the founder's data, run the existing AI skills, and propose
actions that change state. It lives at a dedicated `/advisor` route, persists
conversations through the existing storage seam, and renders turn-based (send →
"thinking…" → full reply). Any action that writes data surfaces an inline
confirmation card and is only committed when the user confirms.

## Goals

- A single chat where the founder can ask strategic questions over their pipeline,
  tasks, projects, interactions, and pain points — and get concrete answers grounded
  in their real data.
- Let the advisor **act**: create tasks/leads/projects, update leads, log
  interactions — always behind an explicit confirmation.
- Reuse the existing AI "skills" (Call Summary, Business Review, Tomorrow Plan) as
  tools the advisor can invoke.
- Persist conversations so the founder can revisit past threads.

## Non-goals (YAGNI)

- No token streaming (turn-based only).
- No global/⌘K launcher — dedicated page only.
- No multi-user / auth concerns (single-founder app).
- No new database tables or migrations — conversations ride the existing blob
  persistence.
- No mock fallback for open chat — without an API key the page shows a "configure
  your key" state.

## Architecture

### Data flow — one server round-trip per message

```
/advisor page
  └─ sends { messages, snapshot, context } ──▶ POST /api/advisor
                                                  └─ Claude tool-use loop (server)
                                                       • read tools  → resolve inline against snapshot
                                                       • skill tools → run existing AI logic inline
                                                       • write tools → record as proposed action, return
                                                                        synthetic "queued" result
                                                  ◀── { assistantText, proposedActions[] }
  ◀─ append assistant message (with action cards) to active conversation
       └─ on Confirm: apply via existing store CRUD ──▶ persists through adapter
```

- The client already holds the full `DataShape` in memory, so it sends a snapshot
  with each request. The dataset is small (solo founder), so this is cheap.
- **Read tools** and **skill tools** resolve server-side and feed results back into
  the loop, so the advisor can chain calls (e.g. find cold leads → read their last
  interactions) before answering.
- **Write tools never mutate on the server.** When the model calls one, the route
  records a `ProposedAction` and returns a synthetic
  `{ queued: true, note: "awaiting user confirmation" }` tool result so the model
  continues and writes its summary. Writes are applied **client-side** through the
  existing store CRUD after the user confirms — keeping the UI in sync and
  persistence automatic, with no server↔client drift.

### Runtime / model

- New route `src/app/api/advisor/route.ts`: `runtime = "nodejs"`,
  `dynamic = "force-dynamic"`, non-streaming.
- Model: `claude-sonnet-4-6` at `high` effort (consistent with the existing
  `/api/ai` route).
- Tool-use loop with a safety cap on iterations (e.g. max 8) to bound cost/latency.
- `GET /api/advisor` reports `{ configured: !!ANTHROPIC_API_KEY }` so the page can
  show the unconfigured state. `POST` with no key returns `503 { error: "no_key" }`.

## Toolset

Defined in `src/lib/advisor/tools.ts` — Anthropic tool schemas plus server-side
resolvers for read/skill tools and an args→description mapper for write tools.

**Read (resolve inline against snapshot):**
- `query_leads` — filter by status / quality / source / industry / has-follow-up.
- `query_tasks` — filter by status / category / priority / due window.
- `query_projects` — filter by stage / type / priority.
- `query_interactions` — filter by lead / type / date window.
- `search_pain_points` — text + industry / urgency filters.
- `get_pipeline_metrics` — derived dashboard/pipeline numbers via existing
  `src/lib/selectors.ts`.

**Skills (run existing AI logic inline, return result into the loop):**
- `generate_call_summary` — reuse Call Summary generation.
- `generate_business_review` — reuse Business Review generation.
- `generate_tomorrow_plan` — reuse the local Tomorrow Plan logic in `src/lib/ai.ts`.

**Act (recorded as proposed actions; require confirmation):**
- `create_task`
- `create_lead`
- `update_lead`
- `log_interaction`
- `create_project`

Write-tool resolvers do not touch data; they produce a `ProposedAction` whose
`args` match the corresponding store CRUD input shape.

## Data model

Added to `src/lib/types.ts`:

```ts
export interface ProposedAction {
  id: string;
  tool: string;                 // e.g. "create_task"
  description: string;          // "Create task: Follow up with Acme (high)"
  args: Record<string, unknown>;
  status: "pending" | "confirmed" | "dismissed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ProposedAction[];   // assistant turns only
  createdAt: string;            // ISO
}

export interface Conversation extends BaseRecord {
  title: string;                // auto-derived from first user message
  messages: ChatMessage[];
}
```

- Add `conversations: Conversation[]` to `DataShape` and to `EMPTY` in
  `src/lib/store.tsx`.
- `Conversation` is a normal collection, so the generic `create` / `update` /
  `remove` (keyed by `CollectionKey`), debounced persistence, `sendBeacon` flush,
  demo/clear flows, and the adapter seam all work unchanged.
- Global search is unaffected (it iterates specific collections; conversations are
  simply not indexed).

## UI

`src/app/advisor/page.tsx` — boutique-terminal aesthetic, matching existing pages
(near-black canvas, hairline borders, single crimson accent, mono numerals).

- **Thread list (left, thin):** "New conversation" button + past threads (title +
  relative time, most-recent first). Click loads a thread; the active thread is
  highlighted.
- **Message stream (main):** user messages subtle/secondary; assistant messages
  with the crimson accent. Under an assistant turn, one **action card** per
  `ProposedAction`:
  - Pending: description + `Confirm` / `Dismiss`.
  - Confirm → apply via store CRUD, set status `confirmed`, card shows a check
    (e.g. "✓ Task created").
  - Dismiss → status `dismissed`, card shows it was skipped.
  - Status is persisted on the message, so reloading a thread shows exactly what
    was done.
- **Composer:** textarea + Send; ⌘/Ctrl+Enter to send; a "thinking…" indicator
  during the turn; input disabled while a turn is in flight.
- **Unconfigured state:** if `GET /api/advisor` reports no key, show a calm panel
  explaining how to add `ANTHROPIC_API_KEY`, consistent with Settings → AI.

Small presentational components under `src/components/advisor/`:
`MessageBubble`, `ActionCard`, `ThreadList` (kept focused/single-purpose).

## Client glue

`src/lib/advisorClient.ts`:
- `sendAdvisorTurn({ messages, snapshot, context })` → posts to `/api/advisor`,
  returns the assistant `ChatMessage` (with any `actions`).
- `getAdvisorStatus()` → `GET /api/advisor`.
- The page appends user + assistant messages to the active conversation via the
  store; the conversation `title` is derived from the first user message.

## Navigation

Add to `src/components/layout/nav.ts`:

```ts
{ href: "/advisor", label: "Sales Advisor", icon: Bot, group: "Intelligence" }
```

placed above "AI Business Review" in the Intelligence group (`Bot` from
`lucide-react`).

## Files

**New:**
- `src/app/advisor/page.tsx`
- `src/app/api/advisor/route.ts`
- `src/lib/advisor/tools.ts`
- `src/lib/advisorClient.ts`
- `src/components/advisor/MessageBubble.tsx`
- `src/components/advisor/ActionCard.tsx`
- `src/components/advisor/ThreadList.tsx`

**Edited:**
- `src/lib/types.ts` — add `ProposedAction`, `ChatMessage`, `Conversation`,
  `conversations` in `DataShape`.
- `src/lib/store.tsx` — add `conversations: []` to `EMPTY` (CRUD is generic).
- `src/components/layout/nav.ts` — add the nav entry.

## Error handling

- No API key: `POST` returns `503 no_key`; page shows the unconfigured state.
- Model/tool-loop error: route returns `502 { error }`; page shows an inline error
  message in the thread and re-enables the composer (the user can retry).
- Iteration cap reached: return whatever text the model has produced plus any
  queued actions; never loop unbounded.
- Confirm/Dismiss are local and cannot fail the request; applying an action uses
  the same CRUD path as the rest of the app.

## Testing

- Read tools: given a known snapshot, each resolver returns the expected filtered
  set (pure functions — unit-testable without the model).
- Write tools: each produces a `ProposedAction` whose `args` satisfy the matching
  store CRUD input shape.
- Description mapper: snapshot a few representative args → human-readable strings.
- Manual: end-to-end turn with a real key — ask a question that chains a read then
  proposes a `create_task`; confirm it lands in `/tasks` and persists across reload;
  dismiss path leaves no data change; reload shows persisted action statuses.
- Unconfigured: with no key, page shows the configure state and never calls the
  model.
