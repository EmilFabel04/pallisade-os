# The Brain — CEO/Strategist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Brain" section — a threaded, pure strategic-sparring-partner chat that reasons like a seasoned founder/investor — following the existing Content Studio agent pattern.

**Architecture:** A new page at `/brain` with threaded chat (reusing `ThreadList` + `MessageBubble`), backed by a new `/api/brain` route that makes a single Anthropic `messages.create()` call (no tools, no data snapshot, no tool loop). Threads persist in a new `brainThreads` collection through the existing SQLite-backed store. A `buildBrainSystemPrompt()` module holds the distilled "50 great founders" persona.

**Tech Stack:** Next.js 15 (App Router, Node runtime), React 19, TypeScript, `@anthropic-ai/sdk` ^0.104.1, `node:sqlite`, Tailwind 4, lucide-react, Vitest.

## Global Constraints

- Model: `process.env.BRAIN_MODEL || "claude-sonnet-4-6"` — never hardcode the model elsewhere.
- API key: read `process.env.ANTHROPIC_API_KEY` server-side only; never expose it to the client.
- Runtime for API routes: `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
- Reuse `ChatMessage` from `src/lib/types.ts`; Brain assistant turns never carry `actions`.
- The Brain has NO tools and NO data snapshot — do not import `TOOLS`, `resolveTool`, or `buildSnapshot` into Brain code.
- `brainThreads` is a `CollectionKey` (a normal collection) but must NOT be added to `AdvisorSnapshot`.
- Follow existing conventions exactly: colocated Vitest tests (`*.test.ts`), `@/` import alias, the store's `create`/`update`/`remove` API, and the CSS-variable styling used by sibling pages.
- Tests run with `npm run test`; the build check is `npm run build`; lint is `npm run lint`.

---

### Task 1: Data model & persistence wiring

Adds the `BrainThread` type and registers the `brainThreads` collection everywhere a collection must be declared: the domain types, the in-memory store default, the seed dataset, and the SQLite table list. Without the SQLite registration the collection silently fails to persist, so all four files change together.

**Files:**
- Modify: `src/lib/types.ts` (add `BrainThread` interface after `ContentThread`; add field to `DataShape`)
- Modify: `src/lib/store.tsx:69-82` (add `brainThreads: []` to `EMPTY`)
- Modify: `src/lib/seed.ts:728-743` (add `brainThreads: []` to the `seedData()` return)
- Modify: `src/lib/db/sqlite.ts:17-29` (add `"brainThreads"` to `COLLECTIONS`)

**Interfaces:**
- Produces: `BrainThread` interface — `{ id: string; createdAt: string; updatedAt: string; title: string; messages: ChatMessage[] }` (via `extends BaseRecord`); and `DataShape.brainThreads: BrainThread[]`. Later tasks rely on `store.create("brainThreads", ...)`, `store.update("brainThreads", id, { messages })`, `store.remove("brainThreads", id)`, and reading `store.brainThreads`.

- [ ] **Step 1: Add the `BrainThread` interface to `src/lib/types.ts`**

Insert immediately after the `ContentThread` interface (after line 263), before the `Settings` interface:

```ts
/* ---------- the brain (CEO / strategist) ---------- */

export interface BrainThread extends BaseRecord {
  title: string;                      // auto-derived from the first user message
  messages: ChatMessage[];
}
```

- [ ] **Step 2: Register `brainThreads` in `DataShape`**

In `src/lib/types.ts`, in the `DataShape` interface, add the field right after `contentThreads: ContentThread[];`:

```ts
  contentThreads: ContentThread[];
  brainThreads: BrainThread[];
  settings: Settings;
```

(Leave `AdvisorSnapshot`'s `Omit` list unchanged — `brainThreads` is excluded from the snapshot automatically because the snapshot only picks data collections the advisor reads; explicitly it is fine that it is NOT listed since `Omit` already drops the listed ones and `brainThreads` is simply never read by advisor code. To be safe and explicit, add `"brainThreads"` to the `AdvisorSnapshot` Omit union so Brain threads can never leak into any agent snapshot.)

Update the `AdvisorSnapshot` type (currently at lines 348-351) to:

```ts
export type AdvisorSnapshot = Omit<
  DataShape,
  "conversations" | "playbooks" | "targets" | "positioningProfiles" | "contentThreads" | "brainThreads"
>;
```

- [ ] **Step 3: Add `brainThreads` to the store's `EMPTY` default**

In `src/lib/store.tsx`, in the `EMPTY` object (lines 69-82), add the line after `contentThreads: [],`:

```ts
    positioningProfiles: [],
    contentThreads: [],
    brainThreads: [],
    settings: DEFAULT_SETTINGS,
```

- [ ] **Step 4: Add `brainThreads` to `seedData()`**

In `src/lib/seed.ts`, in the returned object of `seedData()` (lines 729-742), add the line after `contentThreads: [],`:

```ts
    positioningProfiles: [],
    contentThreads: [],
    brainThreads: [],
    settings: DEFAULT_SETTINGS,
```

- [ ] **Step 5: Register the `brainThreads` SQLite table**

In `src/lib/db/sqlite.ts`, add `"brainThreads"` to the `COLLECTIONS` array (lines 17-29), after `"contentThreads"`:

```ts
  "positioningProfiles",
  "contentThreads",
  "brainThreads",
] as const;
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors. (A missing `brainThreads` in any of `EMPTY`, `seedData()`, or `DataShape` would surface here as a type error.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/store.tsx src/lib/seed.ts src/lib/db/sqlite.ts
git commit -m "feat(brain): add brainThreads collection + BrainThread type"
```

---

### Task 2: Persona system prompt (TDD)

The heart of the feature: a pure function that builds the distilled "seasoned founder/investor" system prompt. This is the only unit with meaningful logic, so it gets full test-first treatment, mirroring `src/lib/content/prompt.test.ts`.

**Files:**
- Create: `src/lib/brain/prompt.ts`
- Test: `src/lib/brain/prompt.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `buildBrainSystemPrompt(input: BrainPromptInput): string` where `BrainPromptInput = { businessName: string; founderName: string; today: string }`. Task 3 (the route) calls this.

- [ ] **Step 1: Write the failing test**

Create `src/lib/brain/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildBrainSystemPrompt } from "./prompt";

describe("buildBrainSystemPrompt", () => {
  const base = {
    businessName: "Pallisade Data",
    founderName: "Emil",
    today: "2026-06-26",
  };

  it("embeds the business, founder and date", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toContain("Pallisade Data");
    expect(p).toContain("Emil");
    expect(p).toContain("2026-06-26");
  });

  it("establishes the seasoned-operator identity drawn from many great minds", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/scaled|IPO|founder|operator/i);
    expect(p).toMatch(/investors?|bankers?|tech (ceos?|leaders?)/i);
  });

  it("instructs one-way vs two-way door reasoning and naming risks", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/one-way door/i);
    expect(p).toMatch(/risk|failure mode/i);
  });

  it("allows asking the single sharpest clarifying question when underspecified", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/clarif|underspecified|need .* before/i);
  });

  it("tells it to cite specific people/frameworks only when genuinely relevant", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/only when .* relevant|not .* name-?drop/i);
  });

  it("sets a direct, high-signal, no-flattery tone", () => {
    const p = buildBrainSystemPrompt(base);
    expect(p).toMatch(/direct|high-signal|no flattery|concise/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/brain/prompt.test.ts`
Expected: FAIL — cannot resolve `./prompt` / `buildBrainSystemPrompt is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/brain/prompt.ts`:

```ts
export interface BrainPromptInput {
  businessName: string;
  founderName: string;
  today: string; // YYYY-MM-DD
}

export function buildBrainSystemPrompt(input: BrainPromptInput): string {
  const { businessName, founderName, today } = input;

  return (
    `Today's date is ${today}.\n\n` +
    `You are "The Brain" — ${founderName}'s most trusted strategic mind for ${businessName}. ` +
    `You think like a founder who has started, scaled, and taken companies public, with the ` +
    `synthesized judgment of fifty of the greatest founders, investors, bankers and tech CEOs ` +
    `who have ever operated. You speak as ONE distilled voice — not a committee — and you bring ` +
    `that whole body of hard-won judgment to every answer.\n\n` +
    `HOW YOU THINK:\n` +
    `- Reason from first principles. Strip a decision to its real, binding constraint before ` +
    `advising on it.\n` +
    `- Separate one-way-door (irreversible, bet-the-company) decisions from two-way-door ` +
    `(cheaply reversible) ones, and calibrate caution accordingly. Move fast on reversible calls; ` +
    `slow down and stress-test the irreversible ones.\n` +
    `- Trace second-order effects. Name the real risk and the most likely failure mode, not just ` +
    `the upside.\n\n` +
    `HOW YOU ANSWER:\n` +
    `- When the decision is genuinely underspecified, ask the SINGLE sharpest clarifying question ` +
    `that would change your recommendation — rather than guessing. "I need X before I can advise" ` +
    `is an acceptable full answer when that is the truth.\n` +
    `- Otherwise, give a clear, opinionated recommendation. Take a position. Never hide behind a ` +
    `wishy-washy menu of options — if you list options, end by saying which one you'd take and why.\n` +
    `- Cite a specific person or framework ONLY when it genuinely sharpens the point ` +
    `(e.g. "treat this as a one-way door", "this is Buffett's circle of competence"). Never ` +
    `name-drop for texture.\n\n` +
    `TONE:\n` +
    `- Direct, high-signal, concise. No flattery, no hedging, no filler. Tell ${founderName} what ` +
    `they need to hear, the way a seasoned operator would over a short, honest conversation.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/brain/prompt.test.ts`
Expected: PASS (all 6 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brain/prompt.ts src/lib/brain/prompt.test.ts
git commit -m "feat(brain): distilled CEO/strategist system prompt"
```

---

### Task 3: API route, client & env

The server endpoint and its browser client. Mirrors `src/app/api/content/route.ts` and `src/lib/contentClient.ts`, but with no tools and a single model call (no iteration loop). Also documents the optional `BRAIN_MODEL` override in `.env.example`.

**Files:**
- Create: `src/app/api/brain/route.ts`
- Create: `src/lib/brainClient.ts`
- Modify: `.env.example` (document `BRAIN_MODEL`)

**Interfaces:**
- Consumes: `buildBrainSystemPrompt` from Task 2.
- Produces:
  - `GET /api/brain` → `{ configured: boolean; model: string }`.
  - `POST /api/brain` body `{ messages: { role: "user" | "assistant"; content: string }[]; context?: { businessName?: string; founderName?: string } }` → `{ content: string }`.
  - `getBrainStatus(): Promise<{ configured: boolean; model: string }>`.
  - `sendBrainTurn(params: { messages: { role: "user" | "assistant"; content: string }[]; context: { businessName: string; founderName: string } }): Promise<{ content: string }>`.

- [ ] **Step 1: Create the API route**

Create `src/app/api/brain/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildBrainSystemPrompt } from "@/lib/brain/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.BRAIN_MODEL || "claude-sonnet-4-6";

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface BrainRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  context?: { businessName?: string; founderName?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: BrainRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!body.messages || body.messages.length === 0) {
    return NextResponse.json({ error: "missing_messages" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = buildBrainSystemPrompt({
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    today,
  });

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages,
    });

    const finalText = response.content
      .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
      .map((blk) => blk.text)
      .join("\n")
      .trim();

    return NextResponse.json({
      content: finalText || "I couldn't produce a response — try rephrasing.",
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Create the browser client**

Create `src/lib/brainClient.ts`:

```ts
export async function getBrainStatus(): Promise<{ configured: boolean; model: string }> {
  try {
    const res = await fetch("/api/brain", { method: "GET" });
    if (!res.ok) return { configured: false, model: "" };
    return (await res.json()) as { configured: boolean; model: string };
  } catch {
    return { configured: false, model: "" };
  }
}

export async function sendBrainTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  context: { businessName: string; founderName: string };
}): Promise<{ content: string }> {
  const res = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error(
        "The Brain needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.",
      );
    }
    throw new Error(typeof err.error === "string" ? err.error : "The request failed.");
  }

  return (await res.json()) as { content: string };
}
```

- [ ] **Step 3: Document `BRAIN_MODEL` in `.env.example`**

In `.env.example`, append after the `ANTHROPIC_API_KEY=` line (after line 4, before the Google section):

```
# Optional: override the model that powers The Brain (CEO/strategist).
# Defaults to claude-sonnet-4-6. Set to a more capable model for deeper reasoning.
# BRAIN_MODEL=claude-sonnet-4-6
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: Build succeeds; the new route compiles with no type errors.

- [ ] **Step 5: Smoke-test the GET endpoint**

Run (in one terminal): `npm run dev`
Then run: `curl -s http://localhost:3000/api/brain`
Expected: JSON like `{"configured":true,"model":"claude-sonnet-4-6"}` (`configured` reflects whether `ANTHROPIC_API_KEY` is set in `.env.local`). Stop the dev server after confirming.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/brain/route.ts src/lib/brainClient.ts .env.example
git commit -m "feat(brain): /api/brain route + client (single-call, no tools)"
```

---

### Task 4: Page & navigation

The user-facing threaded chat page and its sidebar nav entry. Mirrors `src/app/content/page.tsx` but without the profile/content-type controls (the Brain has none).

**Files:**
- Create: `src/app/brain/page.tsx`
- Modify: `src/components/layout/nav.ts` (add import + nav item)

**Interfaces:**
- Consumes: `getBrainStatus`, `sendBrainTurn` from Task 3; `store.brainThreads` and `store.create/update/remove("brainThreads", ...)` from Task 1; `ThreadList`, `MessageBubble`, `PageHeader`, `Panel`, `MicButton`; `uid`, `nowISO` from `@/lib/utils`.
- Produces: a route at `/brain`; a `NAV` entry `{ href: "/brain", label: "Brain", icon: BrainCircuit, group: "Intelligence" }`.

- [ ] **Step 1: Add the nav item**

In `src/components/layout/nav.ts`, add `BrainCircuit` to the lucide import block (after `PenLine,`):

```ts
  PenLine,
  BrainCircuit,
  type LucideIcon,
```

Then add the nav entry to the `NAV` array immediately after the Content Studio line (line 39), so it sits with the other Intelligence tools:

```ts
  { href: "/content", label: "Content Studio", icon: PenLine, group: "Intelligence" },
  { href: "/brain", label: "Brain", icon: BrainCircuit, group: "Intelligence" },
```

- [ ] **Step 2: Create the page**

Create `src/app/brain/page.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, BrainCircuit } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import { getBrainStatus, sendBrainTurn } from "@/lib/brainClient";
import type { BrainThread, ChatMessage } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

export default function BrainPage() {
  const store = useStore();
  const { brainThreads, settings } = store;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getBrainStatus().then((s) => setConfigured(s.configured)); }, []);

  const active = useMemo<BrainThread | null>(
    () => brainThreads.find((t) => t.id === activeId) ?? null,
    [brainThreads, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  const setMessages = (thread: BrainThread, messages: ChatMessage[]) =>
    store.update("brainThreads", thread.id, { messages });

  const newThread = () => { setActiveId(null); setInput(""); setError(null); };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);

    let thread = active;
    if (!thread) {
      thread = store.create("brainThreads", {
        title: text.slice(0, 48),
        messages: [],
      } as Omit<BrainThread, "id" | "createdAt" | "updatedAt">) as BrainThread;
      setActiveId(thread.id);
    }

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...thread.messages, userMsg];
    setMessages(thread, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendBrainTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
        },
      });
      const assistantMsg: ChatMessage = {
        id: uid("msg"), role: "assistant", content: reply.content, createdAt: nowISO(),
      };
      setMessages(thread, [...withUser, assistantMsg]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brain"
        subtitle="Your strategic sparring partner for positioning and the big calls — thinking like a founder who has scaled and taken companies public."
      />

      {configured === false && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <BrainCircuit size={18} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              The Brain needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
              <code>.env.local</code> and restart the app.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        <Panel title="Threads">
          <ThreadList
            conversations={brainThreads}
            activeId={activeId}
            onSelect={(id) => { setActiveId(id); setError(null); }}
            onNew={newThread}
          />
        </Panel>

        <Panel>
          <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ minHeight: 360, maxHeight: "60vh" }}>
            {!active || active.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <BrainCircuit size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">What are we deciding?</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Try "should I niche down to asset managers or stay broad?", or "how should I price the reconciliation product?".
                </p>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onConfirm={() => {}} onDismiss={() => {}} />
              ))
            )}
            {loading && (
              <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-dim)]">
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {error && <p className="text-[0.78rem] text-[var(--color-accent)] mt-3">{error}</p>}

          <div className="flex items-end gap-2 mt-4 pt-4 border-t border-[var(--color-line)]">
            <textarea
              className="textarea flex-1"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Put a decision on the table…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"
              disabled={loading}
            />
            <MicButton
              size={16}
              title="Talk to the Brain"
              onTranscript={(t) => setInput((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${t}` : `${prev}${t}`))}
            />
            <button className="btn btn-accent" onClick={() => void send()} disabled={loading || !input.trim()}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
              Send
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: Build succeeds; `/brain` appears in the route list with no type/lint errors. If lucide-react does not export `BrainCircuit` in the installed version, substitute another valid mind/strategy icon (e.g. `Brain` or `Sparkles`) consistently in BOTH `nav.ts` and `page.tsx`, then rebuild.

- [ ] **Step 4: Commit**

```bash
git add src/app/brain/page.tsx src/components/layout/nav.ts
git commit -m "feat(brain): Brain chat page + nav entry"
```

---

### Task 5: Full verification

A final pass confirming the whole feature builds, lints, tests green, and works end-to-end in the running app.

**Files:** none (verification only)

- [ ] **Step 1: Run the test suite**

Run: `npm run test`
Expected: All tests pass, including the new `src/lib/brain/prompt.test.ts`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds; `/brain` and `/api/brain` both listed.

- [ ] **Step 4: Manual end-to-end smoke (requires a real `ANTHROPIC_API_KEY` in `.env.local`)**

Run: `npm run dev`, open `http://localhost:3000/brain`. Verify:
  1. The "Brain" link shows in the sidebar under Intelligence.
  2. With no API key, the setup warning panel renders; with a key, it does not.
  3. Typing a decision and pressing Enter creates a thread, shows "Thinking…", then renders a direct, opinionated assistant reply.
  4. The thread appears in the left list; reloading the page (data persisted via SQLite) keeps the thread and its messages.
  5. Creating a second thread via "New conversation" and switching between threads works.

Expected: All five behaviours hold. Stop the dev server when done.

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "test(brain): verify Brain feature end-to-end"
```

(If no fixes were needed in this task, skip the commit.)

---

## Self-Review

**Spec coverage:**
- Naming/placement (`/brain`, label "Brain", Intelligence group) → Task 4.
- Pure sparring partner, no tools/data → Global Constraints + Task 3 (no `TOOLS`/snapshot imports; single call).
- Threaded chat, reuse `ThreadList`/`MessageBubble` → Task 4.
- Distilled voice + cite-when-useful persona → Task 2.
- Model configurable, default sonnet → Global Constraints + Task 3 (`BRAIN_MODEL`).
- Non-streaming → Task 3 (single `messages.create`, returns `{content}`).
- `BrainThread` + `brainThreads` collection, excluded from `AdvisorSnapshot` → Task 1.
- Error handling (no key 503, bad/empty request 400, upstream 502; page setup warning) → Task 3 + Task 4.
- Testing (prompt unit test; build/lint/manual for the rest, matching repo convention where only pure lib functions are unit-tested) → Task 2 + Task 5.

**Note on persistence:** The spec did not mention `src/lib/db/sqlite.ts`, but its `COLLECTIONS` array gates which collections persist. Task 1 Step 5 adds `brainThreads` there — without it, threads would not survive reload (spec's implied persistence requirement). Caught during planning.

**Placeholder scan:** No TBD/TODO/"add error handling" placeholders — every code step shows complete code.

**Type consistency:** `BrainThread` shape (Task 1) matches its use in `page.tsx` (Task 4); `buildBrainSystemPrompt(input)` signature (Task 2) matches the route's call (Task 3); `getBrainStatus`/`sendBrainTurn` signatures (Task 3) match their use in `page.tsx` (Task 4). `BrainCircuit` icon used consistently in `nav.ts` and `page.tsx` with a documented fallback.
