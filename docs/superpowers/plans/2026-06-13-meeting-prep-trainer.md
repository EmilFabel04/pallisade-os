# Meeting Prep Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Meeting Prep" trainer to Pallisade OS that drills the founder through three stages — pronunciation, business/industry language & acronyms, and the founder's own tools & values — switchable between a reusable General playbook and per-lead Meeting prep.

**Architecture:** One new singleton-by-convention collection `playbooks` persisted through the existing SQLite/`/api/data` store. A new `/api/prep` route uses the Anthropic SDK with a forced `save_playbook` tool to *draft* card content (the founder edits/accepts it). A `/prep` page has two surfaces: **Train** (a stepped session runner with self-graded active recall) and **Playbook** (an editable library with per-section "Draft with AI"). Pure logic (session building, card ordering, merge, normalisation) lives in tested modules; UI and `speechSynthesis` follow the untested-by-convention pattern of the advisor page.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `@anthropic-ai/sdk` (`claude-sonnet-4-6`), `node:sqlite`, Tailwind v4, vitest, lucide-react, browser `speechSynthesis`.

---

## File Structure

**Create:**
- `src/lib/prep/session.ts` — pure session logic: stage assembly, card ordering, missed-card requeue, confidence transitions, meeting-merge.
- `src/lib/prep/session.test.ts` — tests for the above.
- `src/lib/prep/normalize.ts` — pure normalisation of `/api/prep` JSON → typed card arrays with defaults.
- `src/lib/prep/normalize.test.ts` — tests for the above.
- `src/lib/prep/prepClient.ts` — browser client for `/api/prep` (status, draft section, meeting prep).
- `src/app/api/prep/route.ts` — generation route (Anthropic SDK, forced tool).
- `src/lib/voice/useSpeak.ts` — `speechSynthesis` wrapper hook.
- `src/components/prep/SessionRunner.tsx` — the stepped trainer UI.
- `src/components/prep/PlaybookEditor.tsx` — the editable library UI (three sections + per-section AI draft + edit modal).
- `src/app/prep/page.tsx` — the page orchestrating mode, surfaces, persistence.

**Modify:**
- `src/lib/types.ts` — add Playbook/card types; add `playbooks` to `DataShape`.
- `src/lib/store.tsx` — add `playbooks: []` to `EMPTY`; add `usePlaybook()` selector.
- `src/lib/db/sqlite.ts` — add `"playbooks"` to `COLLECTIONS`.
- `src/components/layout/nav.ts` — add the "Meeting Prep" nav item.

---

## Task 1: Domain types

**Files:**
- Modify: `src/lib/types.ts` (add to the "sales advisor chat" area, before the collections registry; extend `DataShape`)

- [ ] **Step 1: Add the Playbook types**

In `src/lib/types.ts`, immediately **above** the `/* ---------- collections registry ---------- */` comment, insert:

```ts
/* ---------- meeting prep playbook ---------- */

export type Confidence = "new" | "learning" | "known";

/** Fields every playbook card shares. `confidence` is self-graded and drives drill order. */
export interface PlaybookCard {
  id: string;
  confidence: Confidence;
}

export interface PronunciationCard extends PlaybookCard {
  term: string;      // "Aigues-Mortes", "Saoirse", "EBITDA"
  phonetic: string;  // "eg-MORT", "SEER-sha"
  tip: string;       // "silent s; rhymes with 'court'"
}

export interface GlossaryCard extends PlaybookCard {
  term: string;
  definition: string;
  kind: "acronym" | "term";
  industry: string;  // "" for general
  example: string;   // a sentence using the term naturally
}

export interface OfferingCard extends PlaybookCard {
  name: string;
  summary: string;
  valueProp: string;
  priceAnchor: string; // "from R15k" / "" if N/A
  objection: string;   // the objection likely to be heard
  response: string;    // crisp rebuttal
}

export interface Playbook extends BaseRecord {
  pronunciations: PronunciationCard[];
  glossary: GlossaryCard[];
  offerings: OfferingCard[];
}
```

- [ ] **Step 2: Register the collection**

In the `DataShape` interface, add `playbooks` to the list (after `conversations`):

```ts
export interface DataShape {
  leads: Lead[];
  interactions: Interaction[];
  projects: Project[];
  tasks: Task[];
  scorecards: Scorecard[];
  painPoints: PainPoint[];
  conversations: Conversation[];
  playbooks: Playbook[];
  settings: Settings;
}
```

- [ ] **Step 3: Verify the project type-checks**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/lib/store.tsx` (EMPTY missing `playbooks`) and `src/lib/db/sqlite.ts` if anything references the shape — those are fixed in Task 2. No errors in `types.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(prep): add Playbook domain types"
```

---

## Task 2: Store + persistence wiring

**Files:**
- Modify: `src/lib/store.tsx` (the `EMPTY` constant near the top; the convenience selectors at the bottom)
- Modify: `src/lib/db/sqlite.ts` (the `COLLECTIONS` array)

- [ ] **Step 1: Add `playbooks` to the empty store**

In `src/lib/store.tsx`, in the `EMPTY` constant, add `playbooks: []` after `conversations: []`:

```ts
const EMPTY: DataShape = {
  leads: [],
  interactions: [],
  projects: [],
  tasks: [],
  scorecards: [],
  painPoints: [],
  conversations: [],
  playbooks: [],
  settings: DEFAULT_SETTINGS,
};
```

- [ ] **Step 2: Add the `usePlaybook` selector + type import**

In `src/lib/store.tsx`, add `Playbook` to the type import block at the top (the `import type { ... } from "./types"` list).

Then at the very bottom of the file, after the existing `useSettings` selector, add:

```ts
/** The single Playbook record, or null before it has been created. */
export const usePlaybook = () => (useStore().playbooks as Playbook[])[0] ?? null;
```

- [ ] **Step 3: Add `playbooks` to the SQLite collections**

In `src/lib/db/sqlite.ts`, add `"playbooks"` to the `COLLECTIONS` array (after `"conversations"`):

```ts
const COLLECTIONS = [
  "leads",
  "interactions",
  "projects",
  "tasks",
  "scorecards",
  "painPoints",
  "conversations",
  "playbooks",
] as const;
```

- [ ] **Step 4: Verify type-check passes clean**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.tsx src/lib/db/sqlite.ts
git commit -m "feat(prep): wire playbooks collection into store and sqlite"
```

---

## Task 3: Session logic (TDD)

Pure functions that build a session from a playbook, order cards, transition confidence, and merge meeting-specific cards. No React, no I/O.

**Files:**
- Create: `src/lib/prep/session.ts`
- Test: `src/lib/prep/session.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prep/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  orderCards,
  nextConfidence,
  buildSession,
  mergeCards,
  mergePlaybook,
} from "./session";
import type { GlossaryCard, OfferingCard, Playbook, PronunciationCard } from "@/lib/types";

const glossary = (id: string, term: string, confidence: GlossaryCard["confidence"]): GlossaryCard => ({
  id, term, confidence, definition: "d", kind: "term", industry: "", example: "e",
});

describe("orderCards", () => {
  it("orders learning first, then new, then known (stable within a group)", () => {
    const cards = [
      glossary("a", "A", "known"),
      glossary("b", "B", "new"),
      glossary("c", "C", "learning"),
      glossary("d", "D", "new"),
    ];
    expect(orderCards(cards).map((c) => c.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("does not mutate the input array", () => {
    const cards = [glossary("a", "A", "known"), glossary("c", "C", "learning")];
    orderCards(cards);
    expect(cards.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("nextConfidence", () => {
  it("promotes to known on a correct recall", () => {
    expect(nextConfidence(false)).toBe("learning");
    expect(nextConfidence(true)).toBe("known");
  });
});

describe("buildSession", () => {
  const pron: PronunciationCard = { id: "p1", confidence: "new", term: "X", phonetic: "ex", tip: "t" };
  const off: OfferingCard = {
    id: "o1", confidence: "new", name: "Bot", summary: "s", valueProp: "v",
    priceAnchor: "", objection: "too dear", response: "worth it",
  };

  it("builds three ordered stages and tags their kind", () => {
    const pb: Playbook = {
      id: "pb", createdAt: "", updatedAt: "",
      pronunciations: [pron], glossary: [glossary("g1", "AUM", "new")], offerings: [off],
    };
    const stages = buildSession(pb);
    expect(stages.map((s) => s.id)).toEqual(["pronunciation", "glossary", "offerings"]);
    expect(stages[0].kind).toBe("pronunciation");
    expect(stages[1].kind).toBe("recall");
    expect(stages[2].kind).toBe("recall");
  });

  it("auto-skips stages with no cards", () => {
    const pb: Playbook = {
      id: "pb", createdAt: "", updatedAt: "",
      pronunciations: [], glossary: [glossary("g1", "AUM", "new")], offerings: [],
    };
    expect(buildSession(pb).map((s) => s.id)).toEqual(["glossary"]);
  });
});

describe("mergeCards", () => {
  it("appends additions but drops ones whose key already exists (case-insensitive), base wins", () => {
    const base = [glossary("g1", "AUM", "known")];
    const additions = [glossary("g2", "aum", "new"), glossary("g3", "Mandate", "new")];
    const merged = mergeCards(base, additions, (c) => c.term);
    expect(merged.map((c) => c.id)).toEqual(["g1", "g3"]); // "aum" dropped, base "g1" kept
  });
});

describe("mergePlaybook", () => {
  it("merges every section by its natural key", () => {
    const base: Playbook = {
      id: "pb", createdAt: "", updatedAt: "",
      pronunciations: [{ id: "p1", confidence: "new", term: "X", phonetic: "", tip: "" }],
      glossary: [glossary("g1", "AUM", "new")],
      offerings: [],
    };
    const additions = {
      pronunciations: [{ id: "p2", confidence: "new" as const, term: "Y", phonetic: "", tip: "" }],
      glossary: [glossary("g2", "AUM", "new")], // dup → dropped
      offerings: [{
        id: "o2", confidence: "new" as const, name: "Bot", summary: "", valueProp: "",
        priceAnchor: "", objection: "", response: "",
      }],
    };
    const merged = mergePlaybook(base, additions);
    expect(merged.pronunciations.map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(merged.glossary.map((c) => c.id)).toEqual(["g1"]);
    expect(merged.offerings.map((c) => c.id)).toEqual(["o2"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prep/session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Implement `session.ts`**

Create `src/lib/prep/session.ts`:

```ts
import type {
  Confidence,
  GlossaryCard,
  OfferingCard,
  Playbook,
  PlaybookCard,
  PronunciationCard,
} from "@/lib/types";

export type StageId = "pronunciation" | "glossary" | "offerings";

export interface BuiltStage {
  id: StageId;
  title: string;
  kind: "pronunciation" | "recall";
  cards: PlaybookCard[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { learning: 0, new: 1, known: 2 };

/** Learning cards first (need most work), then unseen, then known. Stable, non-mutating. */
export function orderCards<T extends PlaybookCard>(cards: T[]): T[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const byRank = CONFIDENCE_RANK[a.card.confidence] - CONFIDENCE_RANK[b.card.confidence];
      return byRank !== 0 ? byRank : a.index - b.index;
    })
    .map((x) => x.card);
}

/** Self-graded transition: one clean pass marks a card known; a miss sends it to learning. */
export function nextConfidence(gotIt: boolean): Confidence {
  return gotIt ? "known" : "learning";
}

/** Assemble the three ordered stages, skipping any with no cards. */
export function buildSession(playbook: Playbook): BuiltStage[] {
  const stages: BuiltStage[] = [
    { id: "pronunciation", title: "Pronunciation", kind: "pronunciation", cards: orderCards(playbook.pronunciations) },
    { id: "glossary", title: "Business & Industry", kind: "recall", cards: orderCards(playbook.glossary) },
    { id: "offerings", title: "Tools & Values", kind: "recall", cards: orderCards(playbook.offerings) },
  ];
  return stages.filter((s) => s.cards.length > 0);
}

/** Append additions, dropping any whose key already exists in base (case-insensitive). Base wins. */
export function mergeCards<T extends PlaybookCard>(
  base: T[],
  additions: T[],
  keyOf: (card: T) => string,
): T[] {
  const seen = new Set(base.map((c) => keyOf(c).trim().toLowerCase()));
  const extra = additions.filter((c) => {
    const key = keyOf(c).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...base, ...extra];
}

export interface PlaybookSections {
  pronunciations: PronunciationCard[];
  glossary: GlossaryCard[];
  offerings: OfferingCard[];
}

/** Layer meeting-specific cards onto a saved playbook for one session (no overwrite). */
export function mergePlaybook(base: Playbook, additions: PlaybookSections): Playbook {
  return {
    ...base,
    pronunciations: mergeCards(base.pronunciations, additions.pronunciations, (c) => c.term),
    glossary: mergeCards(base.glossary, additions.glossary, (c) => c.term),
    offerings: mergeCards(base.offerings, additions.offerings, (c) => c.name),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prep/session.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prep/session.ts src/lib/prep/session.test.ts
git commit -m "feat(prep): session building, ordering and merge logic (TDD)"
```

---

## Task 4: Response normalisation (TDD)

Turns raw JSON from Claude (untrusted shape) into typed card arrays with `confidence: "new"`, generated ids, and string-defaulted fields.

**Files:**
- Create: `src/lib/prep/normalize.ts`
- Test: `src/lib/prep/normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prep/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeDraft } from "./normalize";

describe("normalizeDraft", () => {
  it("returns three arrays even from empty / missing input", () => {
    const out = normalizeDraft({});
    expect(out).toEqual({ pronunciations: [], glossary: [], offerings: [] });
  });

  it("ignores non-array sections and non-object items", () => {
    const out = normalizeDraft({ glossary: "nope", offerings: [1, null, "x"], pronunciations: undefined });
    expect(out.glossary).toEqual([]);
    expect(out.offerings).toEqual([]);
  });

  it("defaults confidence to new, fills missing strings, and assigns a non-empty id", () => {
    const out = normalizeDraft({
      pronunciations: [{ term: "EBITDA", phonetic: "ee-BIT-da" }],
      glossary: [{ term: "AUM", definition: "assets under management", kind: "acronym" }],
      offerings: [{ name: "Reporting bot" }],
    });

    expect(out.pronunciations[0]).toMatchObject({
      term: "EBITDA", phonetic: "ee-BIT-da", tip: "", confidence: "new",
    });
    expect(out.pronunciations[0].id.length).toBeGreaterThan(0);

    expect(out.glossary[0]).toMatchObject({
      term: "AUM", definition: "assets under management", kind: "acronym", industry: "", example: "", confidence: "new",
    });

    expect(out.offerings[0]).toMatchObject({
      name: "Reporting bot", summary: "", valueProp: "", priceAnchor: "", objection: "", response: "", confidence: "new",
    });
  });

  it("coerces an invalid glossary kind to 'term'", () => {
    const out = normalizeDraft({ glossary: [{ term: "x", kind: "banana" }] });
    expect(out.glossary[0].kind).toBe("term");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/prep/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 3: Implement `normalize.ts`**

Create `src/lib/prep/normalize.ts`:

```ts
import type { GlossaryCard, OfferingCard, PronunciationCard } from "@/lib/types";
import type { PlaybookSections } from "./session";
import { uid } from "@/lib/utils";

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function objects(v: unknown): Raw[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Raw => !!x && typeof x === "object");
}

function pronunciation(r: Raw): PronunciationCard {
  return { id: uid("pron"), confidence: "new", term: str(r.term), phonetic: str(r.phonetic), tip: str(r.tip) };
}

function glossary(r: Raw): GlossaryCard {
  return {
    id: uid("gloss"),
    confidence: "new",
    term: str(r.term),
    definition: str(r.definition),
    kind: r.kind === "acronym" ? "acronym" : "term",
    industry: str(r.industry),
    example: str(r.example),
  };
}

function offering(r: Raw): OfferingCard {
  return {
    id: uid("offer"),
    confidence: "new",
    name: str(r.name),
    summary: str(r.summary),
    valueProp: str(r.valueProp),
    priceAnchor: str(r.priceAnchor),
    objection: str(r.objection),
    response: str(r.response),
  };
}

/** Coerce untrusted model output into typed, defaulted card arrays. */
export function normalizeDraft(raw: Raw): PlaybookSections {
  return {
    pronunciations: objects(raw.pronunciations).map(pronunciation),
    glossary: objects(raw.glossary).map(glossary),
    offerings: objects(raw.offerings).map(offering),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/prep/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS (existing advisor/gmail tests + the two new files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/prep/normalize.ts src/lib/prep/normalize.test.ts
git commit -m "feat(prep): normalise AI draft JSON into typed cards (TDD)"
```

---

## Task 5: Generation route `/api/prep`

Mirrors `/api/advisor`: Node runtime, API-key guard, Anthropic SDK. Forces a single `save_playbook` tool call and returns normalised cards.

**Files:**
- Create: `src/app/api/prep/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/prep/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeDraft } from "@/lib/prep/normalize";
import type { PlaybookSections } from "@/lib/prep/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const SECTIONS = ["pronunciations", "glossary", "offerings"] as const;
type Section = (typeof SECTIONS)[number];

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface PrepContext {
  businessName?: string;
  mainMarket?: string;
  services?: string;
}
interface PrepLead {
  company?: string;
  contactName?: string;
  contactRole?: string;
  industry?: string;
  painPoint?: string;
  objection?: string;
}
interface PrepRequest {
  intent?: "draft_section" | "meeting_prep";
  section?: Section;
  context?: PrepContext;
  lead?: PrepLead;
}

const cardSchemas = {
  pronunciations: {
    type: "array",
    description: "Tricky names, places, brands or terms to rehearse saying aloud.",
    items: {
      type: "object",
      properties: {
        term: { type: "string", description: "The word or name as written." },
        phonetic: { type: "string", description: "Plain-English respelling, e.g. 'ee-BIT-da'." },
        tip: { type: "string", description: "A short pronunciation tip." },
      },
      required: ["term", "phonetic"],
    },
  },
  glossary: {
    type: "array",
    description: "Industry language and acronyms the buyer will use.",
    items: {
      type: "object",
      properties: {
        term: { type: "string" },
        definition: { type: "string", description: "Plain, concise definition." },
        kind: { type: "string", enum: ["acronym", "term"] },
        industry: { type: "string", description: "Industry this belongs to, or empty for general." },
        example: { type: "string", description: "A natural sentence using the term." },
      },
      required: ["term", "definition", "kind"],
    },
  },
  offerings: {
    type: "array",
    description: "The founder's own tools/services to be able to pitch fluently.",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        summary: { type: "string", description: "What it does, plainly." },
        valueProp: { type: "string", description: "Why it matters to the buyer." },
        priceAnchor: { type: "string", description: "A rough price anchor, or empty." },
        objection: { type: "string", description: "The objection likely to be raised." },
        response: { type: "string", description: "A crisp rebuttal to that objection." },
      },
      required: ["name", "summary", "valueProp"],
    },
  },
} as const;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: PrepRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const intent = body.intent ?? "draft_section";
  const ctx = body.context ?? {};
  const biz = ctx.businessName || "Pallisade Data";
  const market = ctx.mainMarket || "boutique asset managers and B2B service businesses";
  const services = ctx.services || "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools";

  // Decide which sections to fill, and the grounding instructions.
  let sectionsWanted: readonly Section[];
  let task: string;

  if (intent === "meeting_prep") {
    const lead = body.lead ?? {};
    sectionsWanted = SECTIONS;
    task =
      `Build meeting-prep cards for an upcoming sales meeting.\n` +
      `Company: ${lead.company || "(unknown)"}\n` +
      `Contact: ${lead.contactName || "(unknown)"}${lead.contactRole ? `, ${lead.contactRole}` : ""}\n` +
      `Industry: ${lead.industry || "(unknown)"}\n` +
      `Stated pain point: ${lead.painPoint || "(none recorded)"}\n` +
      `Known objection: ${lead.objection || "(none recorded)"}\n\n` +
      `pronunciations: the contact's name (if non-obvious), the company name, and any tricky industry terms.\n` +
      `glossary: acronyms and jargon specific to ${lead.industry || "their industry"} this buyer will use.\n` +
      `offerings: of the founder's services (${services}), the 1-3 that best answer this buyer's pain — ` +
      `with the value prop framed for them and the objection they are most likely to raise.`;
  } else {
    const section = SECTIONS.includes(body.section as Section) ? (body.section as Section) : "glossary";
    sectionsWanted = [section];
    const per: Record<Section, string> = {
      pronunciations: `tricky names, places, brands or terms ${biz} encounters selling to ${market}.`,
      glossary: `the core industry language and acronyms used by ${market}.`,
      offerings: `the founder's services (${services}) — one card per distinct offering, with value prop, a price anchor if sensible, and the most likely objection plus a rebuttal.`,
    };
    task = `Draft the "${section}" section of the sales playbook: ${per[section]}`;
  }

  // Build a save_playbook tool whose schema only contains the wanted sections.
  const properties: Record<string, unknown> = {};
  for (const s of sectionsWanted) properties[s] = cardSchemas[s];
  const tool = {
    name: "save_playbook",
    description: "Save the drafted sales-prep cards.",
    input_schema: { type: "object" as const, properties, required: [...sectionsWanted] },
  };

  const system =
    `You prepare a B2B sales founder for meetings. Generate concise, accurate, immediately useful prep cards. ` +
    `Be specific and realistic — no filler. Only populate the requested sections. ${task}`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools: [tool] as unknown as Anthropic.Tool[],
      tool_choice: { type: "tool", name: "save_playbook" },
      messages: [{ role: "user", content: "Generate the cards now." }],
    });

    const toolUse = response.content.find(
      (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
    );
    const draft: PlaybookSections = normalizeDraft(
      (toolUse?.input as Record<string, unknown>) ?? {},
    );
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/prep/route.ts
git commit -m "feat(prep): /api/prep generation route with forced save_playbook tool"
```

---

## Task 6: Prep client

Browser-side fetch wrapper, mirroring `advisorClient.ts` error handling.

**Files:**
- Create: `src/lib/prep/prepClient.ts`

- [ ] **Step 1: Implement the client**

Create `src/lib/prep/prepClient.ts`:

```ts
import type { PlaybookSections, StageId } from "./session";

export interface PrepContext {
  businessName: string;
  mainMarket: string;
  services: string;
}

export interface PrepLead {
  company: string;
  contactName: string;
  contactRole: string;
  industry: string;
  painPoint: string;
  objection: string;
}

const EMPTY: PlaybookSections = { pronunciations: [], glossary: [], offerings: [] };

export async function getPrepStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/prep", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

async function post(body: unknown): Promise<PlaybookSections> {
  const res = await fetch("/api/prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error("Drafting needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The prep request failed.");
  }
  return { ...EMPTY, ...((await res.json()) as Partial<PlaybookSections>) };
}

/** `section` maps the UI stage id to the playbook section key. */
const SECTION_KEY: Record<StageId, "pronunciations" | "glossary" | "offerings"> = {
  pronunciation: "pronunciations",
  glossary: "glossary",
  offerings: "offerings",
};

export function draftSection(stage: StageId, context: PrepContext): Promise<PlaybookSections> {
  return post({ intent: "draft_section", section: SECTION_KEY[stage], context });
}

export function meetingPrep(lead: PrepLead, context: PrepContext): Promise<PlaybookSections> {
  return post({ intent: "meeting_prep", lead, context });
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/prep/prepClient.ts
git commit -m "feat(prep): browser client for /api/prep"
```

---

## Task 7: `useSpeak` hook

**Files:**
- Create: `src/lib/voice/useSpeak.ts`

- [ ] **Step 1: Implement the hook**

Create `src/lib/voice/useSpeak.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

export interface Speaker {
  /** False when the browser has no speechSynthesis support. */
  supported: boolean;
  speak: (text: string) => void;
}

/** Speaks short text aloud via the browser's built-in speechSynthesis (no API/cost). */
export function useSpeak(): Speaker {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const synth = window.speechSynthesis;
      synth.cancel(); // stop any in-flight utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.85; // a touch slower so it's easy to mimic
      synth.speak(utterance);
    },
    [],
  );

  return { supported, speak };
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/voice/useSpeak.ts
git commit -m "feat(prep): useSpeak hook wrapping speechSynthesis"
```

---

## Task 8: Session runner component

The stepped trainer: progress bar, pronunciation cards (with "Hear it"), and recall cards (reveal → got it / missed it), with missed-card requeue. It reports grades up via `onGrade`; persistence is the page's job.

**Files:**
- Create: `src/components/prep/SessionRunner.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/prep/SessionRunner.tsx`:

```ts
"use client";

import { useMemo, useState } from "react";
import { Volume2, Check, RotateCcw, ArrowRight, Trophy } from "lucide-react";
import type { BuiltStage, StageId } from "@/lib/prep/session";
import type { GlossaryCard, OfferingCard, PlaybookCard, PronunciationCard } from "@/lib/types";
import { useSpeak } from "@/lib/voice/useSpeak";

interface QueueItem {
  stageIndex: number;
  card: PlaybookCard;
}

export function SessionRunner({
  stages,
  onGrade,
  onRestart,
}: {
  stages: BuiltStage[];
  /** Called when a recall card is graded; the page persists confidence on the saved playbook. */
  onGrade: (stage: StageId, cardId: string, gotIt: boolean) => void;
  onRestart: () => void;
}) {
  const { supported, speak } = useSpeak();

  // Flatten stages into an ordered queue; missed recall cards get re-appended within their stage.
  const initialQueue = useMemo<QueueItem[]>(
    () => stages.flatMap((s, stageIndex) => s.cards.map((card) => ({ stageIndex, card }))),
    [stages],
  );

  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const total = initialQueue.length;
  const done = pos >= queue.length;
  const current = queue[pos];
  const stage = current ? stages[current.stageIndex] : null;

  const advance = () => {
    setRevealed(false);
    setPos((p) => p + 1);
  };

  const grade = (gotIt: boolean) => {
    if (!current || !stage) return;
    onGrade(stage.id, current.card.id, gotIt);
    if (!gotIt) {
      // requeue the missed card at the END OF ITS STAGE (before the next stage starts)
      setQueue((q) => {
        const next = [...q];
        let insertAt = next.length;
        for (let i = pos + 1; i < next.length; i++) {
          if (next[i].stageIndex > current.stageIndex) { insertAt = i; break; }
        }
        next.splice(insertAt, 0, { stageIndex: current.stageIndex, card: current.card });
        return next;
      });
    }
    advance();
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
          <Trophy size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
        </div>
        <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">Session complete</h3>
        <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
          You worked through {total} card{total === 1 ? "" : "s"}. Missed cards are marked to resurface next time.
        </p>
        <button className="btn btn-accent mt-5" onClick={onRestart}>
          <RotateCcw size={15} /> Run again
        </button>
      </div>
    );
  }

  const stageNumber = (current?.stageIndex ?? 0) + 1;
  // Denominator is the LIVE queue length so requeued misses extend the bar honestly.
  const progress = queue.length ? Math.round((pos / queue.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* progress */}
      <div>
        <div className="flex items-center justify-between text-[0.74rem] text-[var(--color-muted)] mb-2">
          <span className="eyebrow">Stage {stageNumber}/{stages.length} · {stage?.title}</span>
          <span className="tnum">{pos + 1} / {queue.length}</span>
        </div>
        <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-2)", border: "1px solid var(--color-line)" }}>
          <div style={{ height: "100%", width: `${progress}%`, borderRadius: 99, background: "var(--color-accent)", transition: "width .25s ease" }} />
        </div>
      </div>

      {stage?.kind === "pronunciation"
        ? <PronunciationView card={current!.card as PronunciationCard} supported={supported} speak={speak} onNext={advance} />
        : <RecallView card={current!.card} stage={stage!.id} revealed={revealed} onReveal={() => setRevealed(true)} onGrade={grade} />}
    </div>
  );
}

function PronunciationView({
  card, supported, speak, onNext,
}: {
  card: PronunciationCard;
  supported: boolean;
  speak: (t: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-6 text-center">
      <div className="text-[1.6rem] font-semibold text-[var(--color-ink)]">{card.term}</div>
      {card.phonetic && <div className="text-[1rem] text-[var(--color-accent)] mt-1">/ {card.phonetic} /</div>}
      {card.tip && <p className="text-[0.84rem] text-[var(--color-muted)] mt-3 max-w-md mx-auto leading-relaxed">{card.tip}</p>}
      <div className="flex items-center justify-center gap-2 mt-5">
        {supported && (
          <button className="btn" onClick={() => speak(card.term)} title="Hear a model pronunciation">
            <Volume2 size={15} /> Hear it
          </button>
        )}
        <button className="btn btn-accent" onClick={onNext}>
          I practiced <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function RecallView({
  card, stage, revealed, onReveal, onGrade,
}: {
  card: PlaybookCard;
  stage: StageId;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (gotIt: boolean) => void;
}) {
  const isGlossary = stage === "glossary";
  const g = card as GlossaryCard;
  const o = card as OfferingCard;
  const prompt = isGlossary ? g.term : `Pitch the value of "${o.name}" — and handle the objection.`;

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-6">
      <p className="eyebrow mb-2">{isGlossary ? "Define this term" : "Sell this"}</p>
      <div className="text-[1.15rem] font-semibold text-[var(--color-ink)]">{prompt}</div>

      {!revealed ? (
        <button className="btn btn-accent mt-5" onClick={onReveal}>Reveal answer</button>
      ) : (
        <>
          <div className="mt-4 space-y-2 text-[0.86rem] leading-relaxed">
            {isGlossary ? (
              <>
                <p className="text-[var(--color-ink)]">{g.definition || "—"}</p>
                {g.example && <p className="text-[var(--color-muted)] italic">e.g. {g.example}</p>}
              </>
            ) : (
              <>
                {o.summary && <p className="text-[var(--color-ink)]">{o.summary}</p>}
                {o.valueProp && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Value:</b> {o.valueProp}</p>}
                {o.priceAnchor && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Price:</b> {o.priceAnchor}</p>}
                {o.objection && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Objection:</b> {o.objection}</p>}
                {o.response && <p className="text-[var(--color-muted)]"><b className="text-[var(--color-ink)]">Response:</b> {o.response}</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[var(--color-line)]">
            <button className="btn" onClick={() => onGrade(false)}>
              <RotateCcw size={15} /> Missed it
            </button>
            <button className="btn btn-accent" onClick={() => onGrade(true)}>
              <Check size={15} /> Got it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/prep/SessionRunner.tsx
git commit -m "feat(prep): SessionRunner stepped trainer component"
```

---

## Task 9: Playbook editor component

Three editable sections with per-section "Draft with AI", plus add/edit/delete via a modal. Receives the playbook sections and callbacks; the page owns persistence.

**Files:**
- Create: `src/components/prep/PlaybookEditor.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/prep/PlaybookEditor.tsx`:

```ts
"use client";

import { useState } from "react";
import { Plus, Sparkles, Pencil, Trash2, Loader2, Check } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, TextArea, Select } from "@/components/ui/Field";
import type { GlossaryCard, OfferingCard, PronunciationCard } from "@/lib/types";
import type { PlaybookSections, StageId } from "@/lib/prep/session";
import { uid } from "@/lib/utils";

type Section = keyof PlaybookSections; // "pronunciations" | "glossary" | "offerings"
type AnyCard = PronunciationCard | GlossaryCard | OfferingCard;

const STAGE_OF: Record<Section, StageId> = {
  pronunciations: "pronunciation",
  glossary: "glossary",
  offerings: "offerings",
};

export function PlaybookEditor({
  sections,
  onChange,
  onDraft,
  drafting,
}: {
  sections: PlaybookSections;
  /** Replace one section's full card list. */
  onChange: (section: Section, cards: AnyCard[]) => void;
  /** Ask the AI to draft this section; resolves to the drafted cards for that section. */
  onDraft: (stage: StageId) => Promise<AnyCard[]>;
  drafting: Section | null;
}) {
  const [editing, setEditing] = useState<{ section: Section; card: AnyCard } | null>(null);

  const blank = (section: Section): AnyCard => {
    if (section === "pronunciations") return { id: uid("pron"), confidence: "new", term: "", phonetic: "", tip: "" };
    if (section === "glossary") return { id: uid("gloss"), confidence: "new", term: "", definition: "", kind: "term", industry: "", example: "" };
    return { id: uid("offer"), confidence: "new", name: "", summary: "", valueProp: "", priceAnchor: "", objection: "", response: "" };
  };

  const upsert = (section: Section, card: AnyCard) => {
    const list = sections[section] as AnyCard[];
    const exists = list.some((c) => c.id === card.id);
    onChange(section, exists ? list.map((c) => (c.id === card.id ? card : c)) : [card, ...list]);
  };

  const remove = (section: Section, id: string) => {
    onChange(section, (sections[section] as AnyCard[]).filter((c) => c.id !== id));
  };

  const draftInto = async (section: Section) => {
    const drafted = await onDraft(STAGE_OF[section]);
    if (drafted.length) onChange(section, [...drafted, ...(sections[section] as AnyCard[])]);
  };

  const titleOf = (section: Section, card: AnyCard) =>
    section === "offerings" ? (card as OfferingCard).name : (card as PronunciationCard | GlossaryCard).term;

  const subtitleOf = (section: Section, card: AnyCard) => {
    if (section === "pronunciations") return (card as PronunciationCard).phonetic;
    if (section === "glossary") return (card as GlossaryCard).definition;
    return (card as OfferingCard).valueProp;
  };

  const sectionMeta: { key: Section; title: string }[] = [
    { key: "pronunciations", title: "Pronunciation" },
    { key: "glossary", title: "Business & Industry" },
    { key: "offerings", title: "Tools & Values" },
  ];

  return (
    <div className="space-y-5">
      {sectionMeta.map(({ key, title }) => {
        const list = sections[key] as AnyCard[];
        return (
          <Panel
            key={key}
            title={title}
            action={
              <div className="flex items-center gap-2">
                <button className="btn btn-sm" onClick={() => void draftInto(key)} disabled={drafting === key}>
                  {drafting === key ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft with AI
                </button>
                <button className="btn btn-sm" onClick={() => setEditing({ section: key, card: blank(key) })}>
                  <Plus size={13} /> Add
                </button>
              </div>
            }
          >
            {list.length === 0 ? (
              <p className="text-[0.82rem] text-[var(--color-dim)] py-2">No cards yet — add one or draft with AI.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {list.map((card) => (
                  <li key={card.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[0.88rem] font-medium text-[var(--color-ink)] truncate">{titleOf(key, card) || "(untitled)"}</div>
                      <div className="text-[0.78rem] text-[var(--color-muted)] truncate">{subtitleOf(key, card)}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button className="icon-btn" title="Edit" onClick={() => setEditing({ section: key, card })}><Pencil size={14} /></button>
                      <button className="icon-btn" title="Delete" onClick={() => remove(key, card.id)}><Trash2 size={14} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}

      {editing && (
        <CardEditModal
          section={editing.section}
          card={editing.card}
          onClose={() => setEditing(null)}
          onSave={(card) => { upsert(editing.section, card); setEditing(null); }}
        />
      )}
    </div>
  );
}

function CardEditModal({
  section, card, onClose, onSave,
}: {
  section: Section;
  card: AnyCard;
  onClose: () => void;
  onSave: (card: AnyCard) => void;
}) {
  const [draft, setDraft] = useState<AnyCard>(card);
  const set = (patch: Partial<AnyCard>) => setDraft((d) => ({ ...d, ...patch } as AnyCard));

  return (
    <Modal open title="Edit card" onClose={onClose}>
      <div className="space-y-3.5">
        {section === "pronunciations" && (() => {
          const c = draft as PronunciationCard;
          return (
            <>
              <Field label="Term"><TextInput value={c.term} onChange={(e) => set({ term: e.target.value })} /></Field>
              <Field label="Phonetic respelling" hint="e.g. ee-BIT-da"><TextInput value={c.phonetic} onChange={(e) => set({ phonetic: e.target.value })} /></Field>
              <Field label="Tip"><TextInput value={c.tip} onChange={(e) => set({ tip: e.target.value })} /></Field>
            </>
          );
        })()}

        {section === "glossary" && (() => {
          const c = draft as GlossaryCard;
          return (
            <>
              <Field label="Term"><TextInput value={c.term} onChange={(e) => set({ term: e.target.value })} /></Field>
              <Field label="Kind"><Select options={["term", "acronym"]} value={c.kind} onChange={(e) => set({ kind: e.target.value as GlossaryCard["kind"] })} /></Field>
              <Field label="Definition"><TextArea value={c.definition} onChange={(e) => set({ definition: e.target.value })} /></Field>
              <Field label="Example sentence"><TextInput value={c.example} onChange={(e) => set({ example: e.target.value })} /></Field>
              <Field label="Industry" hint="leave blank for general"><TextInput value={c.industry} onChange={(e) => set({ industry: e.target.value })} /></Field>
            </>
          );
        })()}

        {section === "offerings" && (() => {
          const c = draft as OfferingCard;
          return (
            <>
              <Field label="Name"><TextInput value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Summary"><TextArea value={c.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
              <Field label="Value prop"><TextArea value={c.valueProp} onChange={(e) => set({ valueProp: e.target.value })} /></Field>
              <Field label="Price anchor"><TextInput value={c.priceAnchor} onChange={(e) => set({ priceAnchor: e.target.value })} /></Field>
              <Field label="Likely objection"><TextInput value={c.objection} onChange={(e) => set({ objection: e.target.value })} /></Field>
              <Field label="Response"><TextArea value={c.response} onChange={(e) => set({ response: e.target.value })} /></Field>
            </>
          );
        })()}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={() => onSave(draft)}><Check size={15} /> Save</button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Check the Modal component's prop names match**

Run: `sed -n '1,40p' src/components/ui/Modal.tsx`
Expected: confirm `Modal` accepts `open`, `title`, `onClose`, and `children`. If the prop names differ (e.g. `isOpen`/`onDismiss`), adjust the `<Modal …>` usage above to match. Also confirm `.btn-sm` and `.icon-btn` classes exist in `src/app/globals.css`; if not, replace `btn-sm` with `btn` and `icon-btn` with `btn` to keep styling valid.

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS (fix any Modal prop mismatch found in Step 2).

- [ ] **Step 4: Commit**

```bash
git add src/components/prep/PlaybookEditor.tsx
git commit -m "feat(prep): PlaybookEditor with per-section AI draft and edit modal"
```

---

## Task 10: The `/prep` page + navigation

Orchestrates: ensures a Playbook exists, holds the mode (General vs Meeting + selected lead) and the surface toggle (Train vs Playbook), builds the session, and persists confidence + edits.

**Files:**
- Create: `src/app/prep/page.tsx`
- Modify: `src/components/layout/nav.ts`

- [ ] **Step 1: Add the nav item**

In `src/components/layout/nav.ts`, add `GraduationCap` to the lucide import block, then add this entry to the `NAV` array immediately **after** the Sales Advisor line:

```ts
  { href: "/prep", label: "Meeting Prep", icon: GraduationCap, group: "Intelligence" },
```

The import line becomes (add `GraduationCap` alongside the others):

```ts
  GraduationCap,
```

- [ ] **Step 2: Implement the page**

Create `src/app/prep/page.tsx`:

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { GraduationCap, BookOpen, Dumbbell } from "lucide-react";
import { useStore, usePlaybook } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { SessionRunner } from "@/components/prep/SessionRunner";
import { PlaybookEditor } from "@/components/prep/PlaybookEditor";
import { buildSession, mergePlaybook, nextConfidence, type PlaybookSections, type StageId } from "@/lib/prep/session";
import { draftSection, getPrepStatus, meetingPrep, type PrepContext } from "@/lib/prep/prepClient";
import type { Confidence, GlossaryCard, OfferingCard, Playbook, PronunciationCard } from "@/lib/types";

type Surface = "train" | "playbook";
type Section = keyof PlaybookSections;
type AnyCard = PronunciationCard | GlossaryCard | OfferingCard;

export default function PrepPage() {
  const store = useStore();
  const playbook = usePlaybook();
  const { leads, settings } = store;

  const context: PrepContext = useMemo(
    () => ({ businessName: settings.businessName, mainMarket: settings.mainMarket, services: settings.services }),
    [settings.businessName, settings.mainMarket, settings.services],
  );

  const [surface, setSurface] = useState<Surface>("train");
  const [leadId, setLeadId] = useState<string>(""); // "" = General mode
  const [merged, setMerged] = useState<PlaybookSections | null>(null); // meeting additions overlay
  const [sessionKey, setSessionKey] = useState(0); // bump to restart the runner
  const [drafting, setDrafting] = useState<Section | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getPrepStatus().then((s) => setConfigured(s.configured)); }, []);

  // Ensure exactly one Playbook record exists.
  useEffect(() => {
    if (store.ready && store.playbooks.length === 0) {
      store.create("playbooks", { pronunciations: [], glossary: [], offerings: [] } as Omit<Playbook, "id" | "createdAt" | "updatedAt">);
    }
  }, [store.ready, store.playbooks.length, store]);

  // The playbook used for the session: saved playbook, plus meeting overlay if in Meeting mode.
  const effective: Playbook | null = useMemo(() => {
    if (!playbook) return null;
    return leadId && merged ? mergePlaybook(playbook, merged) : playbook;
  }, [playbook, leadId, merged]);

  const stages = useMemo(() => (effective ? buildSession(effective) : []), [effective]);

  const updateSection = (section: Section, cards: AnyCard[]) => {
    if (!playbook) return;
    store.update("playbooks", playbook.id, { [section]: cards } as Partial<Playbook>);
  };

  const onDraft = async (stage: StageId): Promise<AnyCard[]> => {
    const sectionKey: Section = stage === "pronunciation" ? "pronunciations" : stage;
    setDrafting(sectionKey);
    setError(null);
    try {
      const draft = await draftSection(stage, context);
      return draft[sectionKey] as AnyCard[];
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setDrafting(null);
    }
  };

  const onGrade = (stage: StageId, cardId: string, gotIt: boolean) => {
    if (!playbook) return;
    const sectionKey: Section = stage === "pronunciation" ? "pronunciations" : stage;
    // Only persist for cards that live in the saved playbook (meeting-overlay cards are session-only).
    const list = playbook[sectionKey] as AnyCard[];
    if (!list.some((c) => c.id === cardId)) return;
    const confidence: Confidence = nextConfidence(gotIt);
    updateSection(sectionKey, list.map((c) => (c.id === cardId ? { ...c, confidence } : c)));
  };

  const selectLead = async (id: string) => {
    setLeadId(id);
    setMerged(null);
    setError(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    setMeetingLoading(true);
    try {
      const add = await meetingPrep(
        {
          company: lead.company, contactName: lead.contactName, contactRole: lead.contactRole,
          industry: lead.industry, painPoint: lead.painPoint, objection: lead.objection,
        },
        context,
      );
      setMerged(add);
      setSessionKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMeetingLoading(false);
    }
  };

  const subtitle =
    "Warm up before a meeting: rehearse tricky pronunciations, drill the buyer's industry language, and sharpen how you pitch your own tools and value. Pick a meeting to tailor it, or train on your general playbook.";

  return (
    <div className="space-y-5">
      <PageHeader title="Meeting Prep" subtitle={subtitle} />

      {configured === false && (
        <Panel>
          <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed p-1">
            AI drafting needs a Claude API key — add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to <code>.env.local</code> and restart.
            You can still build and run your playbook manually without it.
          </p>
        </Panel>
      )}

      {/* mode + surface bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className={surface === "train" ? "btn btn-accent" : "btn"} onClick={() => setSurface("train")}>
            <Dumbbell size={15} /> Train
          </button>
          <button className={surface === "playbook" ? "btn btn-accent" : "btn"} onClick={() => setSurface("playbook")}>
            <BookOpen size={15} /> Playbook
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[0.76rem] text-[var(--color-muted)]">Prep for</span>
          <Select
            options={["General", ...leads.map((l) => l.company)]}
            value={leadId ? (leads.find((l) => l.id === leadId)?.company ?? "General") : "General"}
            onChange={(e) => {
              const company = e.target.value;
              const lead = leads.find((l) => l.company === company);
              void selectLead(lead ? lead.id : "");
            }}
          />
        </div>
      </div>

      {error && <p className="text-[0.78rem] text-[var(--color-accent)]">{error}</p>}

      {surface === "playbook" ? (
        playbook ? (
          <PlaybookEditor
            sections={{ pronunciations: playbook.pronunciations, glossary: playbook.glossary, offerings: playbook.offerings }}
            onChange={updateSection}
            onDraft={onDraft}
            drafting={drafting}
          />
        ) : null
      ) : (
        <Panel>
          {meetingLoading ? (
            <EmptyState icon={GraduationCap} title="Tailoring your prep…" message="Building cards for this meeting from the lead's details." />
          ) : stages.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="Your playbook is empty"
              message="Switch to the Playbook tab to add cards or draft them with AI, then come back to train."
              action={<button className="btn btn-accent" onClick={() => setSurface("playbook")}><BookOpen size={15} /> Open Playbook</button>}
            />
          ) : (
            <SessionRunner
              key={sessionKey}
              stages={stages}
              onGrade={onGrade}
              onRestart={() => setSessionKey((k) => k + 1)}
            />
          )}
        </Panel>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; `/prep` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add src/app/prep/page.tsx src/components/layout/nav.ts
git commit -m "feat(prep): /prep page, mode/surface switching, nav entry"
```

---

## Task 11: Manual verification + final check

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS (all suites, including `session.test.ts` and `normalize.test.ts`).

- [ ] **Step 2: Smoke-test in the browser**

Run: `npm run dev`, open `http://localhost:3000/prep`.

Verify (with `ANTHROPIC_API_KEY` set in `.env.local`):
1. Playbook tab → each section's "Draft with AI" populates only that section.
2. Add / edit / delete a card manually; reload the page — changes persisted (SQLite).
3. Train tab (General) → progress bar advances; Pronunciation "Hear it" speaks; recall cards reveal then Got it/Missed it; a missed card reappears later in the stage; finishing shows the completion screen; "Run again" restarts.
4. Reload → a card you marked "Missed it" now sorts to the front of its stage (confidence persisted as `learning`).
5. "Prep for" → pick a lead with at least an industry/contact; meeting-specific cards merge into the session (more cards than General), without altering the saved Playbook tab contents.
6. Temporarily unset `ANTHROPIC_API_KEY` and restart → the no-key banner shows; manual editing and training still work.

- [ ] **Step 3: Final type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

(No commit needed unless Step 2 surfaced fixes — commit those with a descriptive message.)

---

## Notes for the implementer

- **Singleton playbook:** the `playbooks` collection holds exactly one record. The page creates it on first load. Never assume more than one; always use `usePlaybook()`.
- **Why confidence isn't persisted for meeting cards:** meeting-overlay cards are merged for the session only and have ids not present in the saved playbook, so `onGrade` no-ops for them by design.
- **Pronunciation cards aren't graded:** Stage 1 is coaching-only — "I practiced" just advances. Their `confidence` stays as stored (so a manually-marked one still orders correctly, but the session never changes it).
- **Existing conventions:** UI files are untested by convention (see the advisor page); only the pure modules in `src/lib/prep/` carry tests. Follow `btn` / `panel` / `Field` / `Panel` / `Modal` styling already in the app — do not introduce new design primitives.
```
