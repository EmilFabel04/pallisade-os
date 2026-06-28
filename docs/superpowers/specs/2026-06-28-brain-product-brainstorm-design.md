# The Brain — Product Brainstorm mode (v2) — Design

**Date:** 2026-06-28
**Status:** Approved, ready for implementation plan
**Builds on:** `2026-06-26-brain-ceo-strategist-design.md` (v1, merged in `ac3e6f4`)

## Overview

The Brain v1 shipped one mode — **CEO/Strategist** (a pure strategic sparring
partner, no tools, no data). This is the **second mode** from the original
two-mode vision: **Product Brainstorm**.

Product Brainstorm is an **agentic 0-to-1 product strategist**. In a session it:

1. Grounds itself in the founder's own source material — `.md` docs and call
   transcripts — pulled from **Google Drive** (agentically) and/or **dropped into
   the session** locally.
2. **Researches** the company/market and how the problem has been solved with AI,
   using web search.
3. Pressure-tests the angle and produces a **Build Scope in markdown** the founder
   copies straight into a Claude Code session.

It lives on the same `/brain` page, selected via a segmented mode toggle.

### What changed from the v1 "future extension notes"

The v1 spec assumed two big net-new subsystems (document ingestion + web
research). Both are now near-primitives in this environment, which collapses the
build to **a single cohesive spec**:

- **Web/company research** → the Anthropic SDK exposes a native server-side
  `web_search` tool. The route enables it inside a tool loop; nothing to scrape or
  host.
- **Document ingestion** → handled two ways, both light: (a) **Google Drive read**
  is a *scope addition* to the app's existing Google OAuth (Gmail + Calendar
  already run on it), and (b) **local `.md` drop** reads files client-side and
  attaches their text to the thread. No upload/storage subsystem.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Source material input | **Google Drive (agentic)** + **local `.md`/`.txt` drop** into the session |
| How the Brain touches Drive | **Agentic tools** (`drive_search`, `drive_read_file`) it calls as needed |
| Research capability | Anthropic native **`web_search`** server tool, in a tool loop |
| Output artifact | **Markdown message** (a "Build Scope") the founder copies into Claude Code — no new collection, no Drive write-back |
| Mode switching | **Segmented toggle** on `/brain` (Strategist \| Brainstorm); thread list filtered by active mode; new thread inherits active mode; mode stored per-thread |
| Business data access | **None** in v2 — sources are Drive + dropped docs + web only (pain-point/interaction snapshot deferred) |
| Streaming | Non-streaming (matches every other route) |

## Architecture

Product Brainstorm reuses the **Advisor/Content tool-loop** shape: an iterating
`messages.create()` loop that handles `tool_use` → `tool_result` until the model
stops. CEO/Strategist keeps its existing single-call path untouched. The Brain
route branches on `mode`.

### Files

| File | Change |
|---|---|
| `src/lib/types.ts` | `BrainThread` gains `mode` + optional `attachments` |
| `src/app/brain/page.tsx` | Mode toggle, filtered thread list, brainstorm composer with `.md` drop, mode/attachments passed to route |
| `src/app/api/brain/route.ts` | `POST` branches on `mode`; brainstorm path runs the tool loop |
| `src/lib/brain/prompt.ts` | `buildBrainSystemPrompt` takes `mode`; new brainstorm persona branch |
| `src/lib/brain/tools.ts` | **NEW** — `drive_search` / `drive_read_file` tool schemas + resolver (`web_search` is native, needs no resolver) |
| `src/lib/brainClient.ts` | `sendBrainTurn` carries `mode` + `attachments` + connected Drive account id(s) |
| `src/lib/drive/driveApi.ts` | **NEW** — `searchFiles()` / `readFileContent()` over `googleFetch` |
| `src/lib/gmail/config.ts` | Add `drive.readonly` scope + `hasDriveScope()` helper |
| `src/app/api/drive/status/route.ts` | **NEW** (or extend gmail status) — does a Drive-scoped account exist? |
| `src/components/advisor/MessageBubble.tsx` | Copy button optionally copies **raw markdown source** for assistant turns |

### Data model — `src/lib/types.ts`

```ts
export interface BrainAttachment {
  id: string;
  name: string;        // file name, e.g. "discovery-call-acme.md"
  content: string;     // raw text
  createdAt: string;
}

export interface BrainThread extends BaseRecord {
  title: string;
  mode: "strategist" | "brainstorm";   // NEW
  messages: ChatMessage[];
  attachments?: BrainAttachment[];      // NEW — brainstorm session source docs
}
```

- **Back-compat:** existing `brainThreads` rows have no `mode`. They are read as
  `"strategist"` (default at the read site / a tiny normalizer). No migration
  script; `attachments` is optional.
- No new collection. `brainThreads` stays excluded from `AdvisorSnapshot`.

### Page — `src/app/brain/page.tsx`

- A two-option **segmented control** at the top: **Strategist | Brainstorm**.
  Active mode held in component state (default `"strategist"`).
- `ThreadList` is fed `brainThreads.filter(t => (t.mode ?? "strategist") === activeMode)`.
  Selecting a thread switches the toggle to that thread's mode.
- **New thread inherits the active mode** (set on `store.create`).
- Empty-state copy + composer placeholder swap per mode.
- **Brainstorm composer** adds a drop-zone / attach button accepting `.md` and
  `.txt`. Files are read client-side (`FileReader`), appended to the thread's
  `attachments`, and shown as removable chips above the textarea. (Drive needs no
  UI here — the Brain reaches it via tools.)
- **Drive gate:** when Brainstorm is active and no connected Google account holds
  `drive.readonly`, the panel shows a "Connect Google Drive" prompt that kicks the
  existing consent re-flow, in place of (or above) the composer. `.md` drop still
  works without Drive — research/Drive are additive, not required.

### Route — `src/app/api/brain/route.ts`

- `GET` unchanged (`{ configured, model }`).
- `POST` body gains:
  ```ts
  {
    messages: { role: "user" | "assistant"; content: string }[];
    mode?: "strategist" | "brainstorm";        // default "strategist"
    attachments?: { name: string; content: string }[];
    context?: { businessName?; founderName?; driveAccountId?: string };
  }
  ```
- **`mode === "strategist"`** → existing single `messages.create()` call. Unchanged.
- **`mode === "brainstorm"`** → tool loop:
  - `tools`: the native **`web_search`** tool (capped via `max_uses` to bound cost)
    plus **`drive_search`** and **`drive_read_file`** from `brain/tools.ts`.
  - Loop shape mirrors `advisor/route.ts` (`MAX_ITERATIONS ≈ 8`): push assistant
    turn, execute local tool calls, push `tool_result`s, repeat while
    `stop_reason === "tool_use"`. **`web_search` is executed server-side by
    Anthropic** — it returns result blocks automatically and needs no local
    handler; only the Drive tools are resolved locally.
  - **Attachments injection:** dropped docs are injected as a labeled context block
    (e.g. appended to the system prompt or as a leading synthetic user turn:
    `<<SESSION DOCUMENT: name>> … <<END>>`). A total-size guard caps injected chars
    (generous, e.g. ~120k chars); if exceeded, later docs are truncated with an
    explicit note so the model knows.
  - Drive tools use `context.driveAccountId` (the connected account holding Drive
    scope, chosen client-side). If absent/unauthorized, the tool returns a clear
    error string the model can relay; the loop continues.
- Error convention unchanged (`502` + forwarded message — pre-existing repo
  convention; see Known limitations).

The exact `web_search` tool-type string (e.g. `web_search_20250305`) and any beta
header are **verified by the implementer against the installed `@anthropic-ai/sdk`
version** — consult the `claude-api` skill before wiring it.

### Drive access — extend existing Google OAuth

The `src/lib/gmail/*` module is the app's shared Google OAuth layer (Calendar
already piggybacks on it via `googleFetch`). Drive is a straightforward extension:

- **`src/lib/gmail/config.ts`:** add `https://www.googleapis.com/auth/drive.readonly`
  to `GOOGLE_SCOPES`; add `DRIVE_SCOPE` + `hasDriveScope(scope)` (mirrors the
  existing `hasCalendarScope`). User **re-consents once**; existing token storage
  and refresh plumbing carry the new scope automatically.
- **`src/lib/drive/driveApi.ts` (NEW)** — reuses `googleFetch(accountId, url)`:
  - `searchFiles(accountId, query)` → `GET drive/v3/files` with a `q`/`fullText`
    filter, returns `{ id, name, mimeType }[]` (scoped to docs/markdown/text).
  - `readFileContent(accountId, fileId)` → returns plain text:
    - Google Docs (`application/vnd.google-apps.document`) → **export** as
      `text/markdown` (or `text/plain`).
    - `.md` / plain-text files → **download** media (`?alt=media`).
- **`src/app/api/drive/status/route.ts` (NEW)**, or an addition to the gmail status
  route — reports whether any connected account has `drive.readonly`, so the page
  can gate the Brainstorm composer and pick the `driveAccountId`.

### Tools — `src/lib/brain/tools.ts` (NEW)

Two local tool definitions + a resolver, following the `advisor/tools.ts` shape:

- `drive_search({ query })` → `searchFiles` → a compact list of `{ id, name }`.
- `drive_read_file({ fileId })` → `readFileContent` → the file's text (with a
  per-file size cap + truncation note).

`web_search` is **not** defined here — it's the Anthropic native server tool,
declared inline in the route's `tools` array.

### Prompt — `src/lib/brain/prompt.ts`

`buildBrainSystemPrompt({ businessName, founderName, today, mode })`:

- **`mode === "strategist"`** → returns today's prompt **byte-for-byte unchanged**.
- **`mode === "brainstorm"`** → a product-strategist / 0-to-1 builder persona that:
  - Grounds first in the founder's **session documents** (injected) and **Drive**
    (via `drive_search`/`drive_read_file`) before opining.
  - Uses `web_search` to research the company/market and **how the problem has
    been solved with AI** (existing products, common approaches, what's hard).
  - Pressure-tests the angle, names the riskiest assumption, and is explicit about
    what it could not verify.
  - Ends by producing a **Build Scope** in a fixed markdown shape:
    *Problem · Who it's for · The angle · Proposed build · Stack / approach ·
    Risks & unknowns · First steps for Claude Code.*

### Output — markdown message + copy

The Build Scope is a normal assistant `ChatMessage`. `MessageBubble` already
renders assistant content via `<Markdown>` and already exposes a copy button.
**Only change:** for assistant turns, the copy button copies the **raw markdown
source** (`message.content`) rather than the rendered `innerText`, so the scope
pastes into Claude Code with headings/lists intact. (Confirm this doesn't regress
the Advisor/Content email-paste use that relies on plain-text copy — if it does,
add a separate "Copy markdown" affordance instead of changing the default.)

## Error handling

- No API key → `GET` reports `configured: false`; `POST` → `503`.
- No Drive-scoped account in Brainstorm → page shows "Connect Google Drive";
  `.md` drop + web research still function.
- Drive tool failure (401/expired/no scope) → tool returns a clear error string;
  the loop continues and the Brain relays it rather than crashing the turn.
- Upstream model error → `502` with the forwarded message (repo convention); page
  surfaces it inline and does not persist a broken assistant turn.
- Oversized attachments → truncated with an explicit note in the injected block.

## Testing

- **Prompt:** `buildBrainSystemPrompt` with `mode: "strategist"` is unchanged from
  v1 (snapshot/identity assertions still pass); with `mode: "brainstorm"` includes
  the source-grounding guidance, the tool guidance, and the Build Scope format.
- **Route:** brainstorm `POST` runs the tool loop — Anthropic client + Drive
  helpers mocked; asserts `drive_*` tool calls are resolved and `tool_result`s fed
  back, and that a final `{ content }` is returned. Strategist `POST` still takes
  the single-call path. `503`/`400` guards unchanged.
- **`driveApi`:** `readFileContent` exports Google-Doc mimetypes vs downloads
  plain text; `searchFiles` builds the right query. (`googleFetch` mocked.)
- **Page (light):** toggle renders; thread list filters by mode; new thread
  inherits active mode; dropping a `.md` adds a removable attachment chip; Drive
  gate shows when no Drive scope.
- Follow existing repo test conventions (match advisor/content/brain route tests).

## Out of scope (v2)

- Business-data snapshot access (pain points / interactions / leads) in Brainstorm.
- Writing the scope back to Google Drive (would need `drive.file` write scope).
- A separate `buildScopes` collection / dedicated artifact panel / export.
- A Drive file-picker UI (access is agentic + drop-based by design).
- Streaming responses.
- Ingesting non-text formats (PDF/docx) on the local drop path — `.md`/`.txt` only.

## Known limitations (pre-existing, non-blocking)

- Chat-thread titles aren't surfaced in global search (`store.tsx search()` indexes
  5 collections) — same gap as Content Studio / Brain v1 threads.
- Routes forward raw SDK error text to the client — pre-existing convention across
  content/advisor/brain routes; kept for consistency.
