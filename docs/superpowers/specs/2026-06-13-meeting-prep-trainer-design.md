# Meeting Prep Trainer — Design

**Date:** 2026-06-13
**Status:** Approved for planning

## Purpose

A sales-prep training surface inside Pallisade OS that drills the founder before a
meeting across three areas, in sequence:

1. **Pronunciation** — tricky names, places, and terms (coaching only, no scoring).
2. **Business & Industry** — the buyer's industry language and acronyms.
3. **Tools & Values** — the founder's own offerings, value props, pricing anchors,
   and objection responses.

It is **switchable** between a reusable **General** mode and a **Meeting** mode tied
to a specific lead/upcoming meeting. Content is **hybrid**: Claude drafts it, the
founder edits it, and it persists in an editable **Playbook** that sharpens over time.

## Decisions (locked)

- **Anchor:** both — general study space *and* per-meeting prep, switchable.
- **Pronunciation feedback:** coaching only. Phonetic respelling + tip + a
  "Hear it" button using the browser's `speechSynthesis`. No pass/fail (Whisper
  returns text, not phonetic scoring, so scoring would be misleading).
- **Content source:** hybrid — AI drafts, founder edits, persists in the Playbook.
- **Session flow:** guided stages + active recall, with a progress bar across the
  three stages.
- **Recall check:** self-graded reveal. Think/say the answer → reveal model answer →
  mark "Got it" / "Missed it". Fully local, zero per-card API cost. Missed cards
  resurface and drop to `confidence: "learning"`.

## Architecture overview

Reuses every existing pattern in the app:

- **Persistence:** one new collection `playbooks` holding a single record, stored via
  the existing SQLite-backed `/api/data` adapter and the generic store CRUD.
- **Generation:** a new `/api/prep` route mirroring `/api/advisor` (Anthropic SDK,
  `claude-sonnet-4-6`, `ANTHROPIC_API_KEY` guard) using forced structured output.
- **Client:** `src/lib/prep/prepClient.ts`, mirroring `advisorClient.ts`.
- **UI:** a new `/prep` page ("Meeting Prep") in the **Intelligence** nav group,
  with a **Train** surface and a **Playbook** surface.

## 1. Data model

Added to `src/lib/types.ts`:

```ts
export type Confidence = "new" | "learning" | "known";

export interface PlaybookCard {
  id: string;
  confidence: Confidence;        // self-graded, persists; drives ordering
}

export interface PronunciationCard extends PlaybookCard {
  term: string;                  // "Aigues-Mortes", "Saoirse", "EBITDA"
  phonetic: string;              // "eg-MORT", "SEER-sha"
  tip: string;                   // "silent s; rhymes with 'court'"
}

export interface GlossaryCard extends PlaybookCard {
  term: string;                  // "AUM", "drawdown", "mandate"
  definition: string;
  kind: "acronym" | "term";
  industry: string;              // "" for general
  example: string;               // a sentence using the term naturally
}

export interface OfferingCard extends PlaybookCard {
  name: string;                  // a tool/service the founder sells
  summary: string;               // what it does, plainly
  valueProp: string;             // why it matters to the buyer
  priceAnchor: string;           // "from R15k" / "" if N/A
  objection: string;             // the objection likely to be heard
  response: string;              // crisp rebuttal
}

export interface Playbook extends BaseRecord {
  pronunciations: PronunciationCard[];
  glossary: GlossaryCard[];
  offerings: OfferingCard[];
}
```

Registry wiring:

- `DataShape` gains `playbooks: Playbook[]`.
- `store.tsx` `EMPTY` gains `playbooks: []`.
- `sqlite.ts` `COLLECTIONS` gains `"playbooks"`.
- `CollectionKey` includes `"playbooks"` automatically; `create/update/remove`
  work unchanged.

The collection holds a **single** Playbook record (singleton by convention). A
helper selector returns it (creating an empty one on first use). Card edits are
patches to the record's nested arrays, applied through `update("playbooks", id, patch)`.

## 2. Generation — `/api/prep`

`src/app/api/prep/route.ts`, Node runtime, `force-dynamic`.

- `GET` → `{ configured: !!process.env.ANTHROPIC_API_KEY, model }` (status check,
  like the advisor route).
- `POST` body: `{ intent: "draft_general" | "meeting_prep", section?, context, lead? }`.
- Uses a single forced tool `save_playbook` whose input schema is the relevant card
  arrays, so Claude must emit clean JSON (no free-text parsing).
- **`draft_general`** — grounded in Settings (`businessName`, `mainMarket`,
  `services`). Drafts industry jargon/acronyms for `mainMarket`, offering cards from
  `services` (with value prop + objection/response), and pronunciations for any tricky
  generated terms. Honours `section` so only one section is drafted at a time.
- **`meeting_prep`** — grounded in a chosen lead's real fields (company, contactName,
  contactRole, industry, painPoint, objection). Drafts lead-specific cards: the
  contact's name pronunciation, that industry's terms, and which offerings answer the
  stated pain. Returned as additions to merge over the saved playbook for the session.

Cards returned from generation default to `confidence: "new"`.

Client `src/lib/prep/prepClient.ts`:
- `getPrepStatus(): Promise<{ configured: boolean }>`
- `draftSection(section, context): Promise<Partial<Playbook>>`
- `meetingPrep(lead, context): Promise<Partial<Playbook>>`

Error contract matches the advisor: `503 { error: "no_key" }`, `400 bad_request`,
`502` on upstream failure, surfaced as friendly messages in the UI.

## 3. UI — `/prep` page

New nav item **"Meeting Prep"** in the **Intelligence** group (next to Sales
Advisor). Two surfaces with a mode bar on top.

**Mode bar:** toggle `General` ⇆ `Meeting`. In Meeting mode, a dropdown lists
upcoming meetings/leads; selecting one calls `meetingPrep` and merges the result
onto the saved playbook for this session only.

### Surface 1 — Train (session runner)

- Progress bar across three stages:
  **① Pronunciation → ② Business & Industry → ③ Tools & Values.**
- **Stage 1 (Pronunciation):** term + phonetic + tip + **"Hear it"** (`speechSynthesis`)
  + **"I practiced"** to advance. No scoring.
- **Stages 2 & 3 (active recall):** show the prompt (term, or "Pitch the value of X" /
  "Handle this objection") → **Reveal** model answer (definition + example, or value
  prop + objection/response) → **Got it** / **Missed it**.
- Card ordering within a stage: `learning` first, then `new`, then `known`.
- Missed cards re-queue at the end of the current stage and persist as `learning`;
  "Got it" on a `learning`/`new` card promotes it toward `known`.
- A stage with zero cards is auto-skipped.
- End screen: count seen and a short "revisit these" list.

### Surface 2 — Playbook (editable library)

- Three sections matching the stages, each a list of editable cards using existing
  `Panel` / `Field` / `Modal` / `Detail` UI.
- Each section has its **own "Draft with AI"** button — regenerating one section
  never touches another section's hand-edited cards.
- AI-drafted cards are **appended** to the section (prepended to the list), never
  overwriting existing cards. You then review them in place and edit or delete any you
  don't want. Manual add / edit / delete supported throughout.

### Speech helper

`src/lib/voice/useSpeak.ts` — wraps `window.speechSynthesis.speak(...)`; if
unsupported, exposes `supported: false` and the "Hear it" button is hidden.

## 4. Error handling & edge cases

- **No API key:** `/api/prep` → `503 no_key`; UI shows the advisor-style message.
  Manual playbook editing works fully offline.
- **Empty playbook:** Train shows an `EmptyState` pointing to "Draft with AI" or
  manual add; empty stages auto-skip.
- **Sparse lead in Meeting mode:** generation uses whatever fields exist; lead cards
  merge with — never overwrite — saved playbook cards for the session.
- **`speechSynthesis` unavailable:** "Hear it" hidden; phonetic + tip still carry the card.
- **Bad AI draft:** drafted cards are appended, never overwriting existing cards, so a
  weak draft only adds a card you can edit or delete — it can't clobber saved work.

## 5. Testing (vitest)

Pure-logic units tested; UI / `speechSynthesis` untested (consistent with the
advisor page):

- **Session builder:** stage assembly, card ordering (`learning` → `new` → `known`),
  auto-skip of empty stages, missed-card re-queue.
- **Merge logic:** meeting-specific cards layered onto the saved playbook without
  duplication or overwrite.
- **Generation normalisation:** `/api/prep` response → typed card arrays with
  defaulted `confidence`.

## Out of scope (YAGNI)

- Phonetic/audio pronunciation scoring.
- Spaced-repetition scheduling, review history, analytics.
- Claude-graded recall answers.
- Per-session persistence beyond the `confidence` flag on playbook cards.
