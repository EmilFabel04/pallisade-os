# Content Agent — Design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## Summary

A new threaded-chat agent at `/content` that turns a saved **positioning profile**
plus a chosen **content type** into content ideas and scripts. By default it replies
with a tight batch of distinct angles/ideas; when the founder picks one, it writes the
full post/script plus brief delivery guidance. It grounds ideas in the founder's real
Pain Bank / leads / interactions and never invents client names or numbers.

The agent mirrors the existing **Sales Advisor** pattern (page + client + `/api/*`
route calling Claude with a system prompt), so most scaffolding is proven.

## Goals

- Paste a positioning document once, name it, and reuse it across content requests.
- Choose a content type per thread: Short social, Video/voice script, or Long-form.
- Get ideas first; get the full script/post on request.
- Ground content in real customer pain points, leads, and interaction notes.

## Non-goals (YAGNI)

- No cold-outreach / email content type.
- No writing generated content back into the CRM (read-only agent — no write tools,
  no proposed-action UI).
- No content analytics, scheduling, or publishing.

## Architecture

Follows the Sales Advisor pattern:

- **Page** `src/app/content/page.tsx` — threaded chat UI.
- **Client** `src/lib/contentClient.ts` — talks to the route.
- **Route** `src/app/api/content/route.ts` — calls Claude with a content system prompt
  and a read-only subset of the Advisor's tools.

### 1. Data layer — two new collections

Registered the same way every collection is: add to `DataShape`
([src/lib/types.ts](../../../src/lib/types.ts)), the store's initial state
([src/lib/store.tsx](../../../src/lib/store.tsx)), and the `COLLECTIONS` array
([src/lib/db/sqlite.ts](../../../src/lib/db/sqlite.ts)). The DB layer is generic
(key → table), so no bespoke schema is needed.

**`positioningProfiles`**
```ts
interface PositioningProfile extends BaseRecord {
  name: string;   // e.g. "Pallisade — boutique asset managers"
  body: string;   // the pasted positioning document
}
```
Reusable. Paste once, name it, pick from a dropdown. Managed via create/edit/delete in
a small panel on the page.

**`contentThreads`**
```ts
interface ContentThread extends BaseRecord {
  title: string;            // auto-derived from first user message
  messages: ChatMessage[];
  profileId: string | null; // selected positioning profile
  contentType: ContentType; // selected content type
}

type ContentType = "social" | "script" | "longform";
```
Same idea as `Conversation`, but a separate collection so the Content agent and the
Advisor do not share threads. Each thread remembers its selected profile and content
type.

### 2. Page — `src/app/content/page.tsx`

A clone of the Advisor page UX, reusing `ThreadList`-style list, `MessageBubble`,
`MicButton`, and the composer. Differences:

- Two thread-scoped controls in the header/composer: a **Positioning profile**
  dropdown and a **Content type** selector (Short social / Video-voice script /
  Long-form).
- A small **Positioning Profiles** manager panel (create / edit / delete; paste-once).
- No proposed-actions UI (read-only agent).

Sending a turn requires a selected positioning profile; if none exists, prompt the
founder to create one first.

### 3. Client — `src/lib/contentClient.ts`

```ts
getContentStatus(): Promise<{ configured: boolean }>
sendContentTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: AdvisorSnapshot;          // reuse buildSnapshot from advisorClient
  profile: { name: string; body: string };
  contentType: ContentType;
  context: { businessName: string; founderName: string; services: string };
}): Promise<{ content: string }>       // no actions array — read-only
```

Reuses `buildSnapshot` from [src/lib/advisorClient.ts](../../../src/lib/advisorClient.ts).

### 4. API route — `src/app/api/content/route.ts`

- `runtime = "nodejs"`, `dynamic = "force-dynamic"`, model `claude-sonnet-4-6`.
- `GET` → `{ configured: !!process.env.ANTHROPIC_API_KEY }`.
- `POST` → builds the system prompt, runs the Claude tool loop (same shape as the
  Advisor's loop), returns `{ content }`.
- **Tools:** reuse only the read tools from
  [src/lib/advisor/tools.ts](../../../src/lib/advisor/tools.ts) —
  `query_leads`, `query_interactions`, `search_pain_points` — resolved via the existing
  `resolveTool(name, input, snapshot, proposals)`. `proposals` is passed as an empty
  array and stays empty (none of these three are write tools). No email/calendar tools,
  no write tools, no skill tools.

### 5. System prompt — the agent's job

A sharp content strategist + copywriter for the founder's business. Rules baked in:

- Always work from the **positioning profile** body (injected into the prompt).
- **Default reply** = a batch of distinct content angles/hooks, each with a one-line
  rationale. Keep it tight; don't dump full drafts unprompted.
- **On selection** (founder picks an idea or asks for the script) = write the full piece
  in the right format for the content type, plus brief delivery guidance (hook,
  structure, CTA, posting/delivery notes).
- Ground claims in real **pain points / leads / interactions** via the read tools;
  never invent client names, numbers, or history.
- Confident and concise over verbose.

**Content-type format rules** (injected based on `contentType`):

- **social** — platform-aware (LinkedIn / X); hook on line one; scannable; one idea per
  post; optional thread/carousel structure.
- **script** — spoken cadence; `[HOOK] / [BODY] / [CTA]` beats; on-screen text cues;
  a length target.
- **longform** — outline → draft; headline + subheads; narrative arc; clear takeaway.

### 6. Navigation

Add a `/content` entry to the sidebar nav alongside the other sections.

## Error handling

- No `ANTHROPIC_API_KEY` → route returns `{ error: "no_key" }` (503); client surfaces a
  clear "add your key" message, matching the Advisor.
- No positioning profile selected → client blocks send and prompts to create one.
- Claude/tool errors → 502 with message, surfaced in the thread (same as Advisor).

## Testing

- Unit-test any new pure logic (e.g. content-type → format-rule mapping, thread
  title derivation if not reused). Follow the existing `*.test.ts` convention used in
  `src/lib/advisor` and `src/lib/targets`.
- The route/page largely reuse proven Advisor code paths; cover the new tool-subset
  wiring with a focused test if practical.

## Reused building blocks

- `buildSnapshot`, `AdvisorSnapshot` — [src/lib/advisorClient.ts](../../../src/lib/advisorClient.ts)
- `resolveTool`, read tool definitions — [src/lib/advisor/tools.ts](../../../src/lib/advisor/tools.ts)
- `MessageBubble`, `MicButton`, thread list, composer — `src/components/advisor/*`, `src/components/ui/*`
- Claude tool-loop shape — [src/app/api/advisor/route.ts](../../../src/app/api/advisor/route.ts)
