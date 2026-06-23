# Content Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a threaded-chat "Content Studio" agent at `/content` that turns a saved positioning profile + chosen content type into content ideas (default) and full scripts on request, grounded in the founder's real Pain Bank / leads / interactions.

**Architecture:** Mirror the existing Sales Advisor pattern — a page (`src/app/content/page.tsx`) talks to a thin client (`src/lib/contentClient.ts`) which calls a Next.js route (`src/app/api/content/route.ts`) that runs Claude with a content-specific system prompt and a **read-only** subset of the Advisor's tools. Two new generic collections (`positioningProfiles`, `contentThreads`) persist through the existing key→table store/DB layer.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@anthropic-ai/sdk` (model `claude-sonnet-4-6`), Tailwind v4 design tokens, lucide-react, Vitest.

## Global Constraints

- Model: `claude-sonnet-4-6`. Route: `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
- Read-only agent: NO write tools, NO email/calendar tools, NO proposed-action UI. Reuse exactly three Advisor read tools: `query_leads`, `query_interactions`, `search_pain_points`.
- No `ANTHROPIC_API_KEY` → route returns `{ error: "no_key" }` with HTTP 503; client surfaces an "add your key" message (match Advisor wording).
- Never invent client names, numbers, or history — ground claims in tool output.
- Follow existing repo conventions: pure logic gets Vitest `*.test.ts` files; IO/UI tasks verify via `npx tsc --noEmit`, `npm test`, and manual run.
- New collections register in three places: `DataShape` (`src/lib/types.ts`), `EMPTY` (`src/lib/store.tsx`), `COLLECTIONS` (`src/lib/db/sqlite.ts`).
- Run tests with `npm test` (alias for `vitest run`).

---

### Task 1: Data model + collection registration

**Files:**
- Modify: `src/lib/types.ts` (add types near `Conversation` ~line 244, extend `DataShape` ~line 314)
- Modify: `src/lib/store.tsx` (`EMPTY` ~line 70-79)
- Modify: `src/lib/db/sqlite.ts` (`COLLECTIONS` ~line 17-27)

**Interfaces:**
- Produces:
  - `type ContentType = "social" | "script" | "longform"`
  - `interface PositioningProfile extends BaseRecord { name: string; body: string }`
  - `interface ContentThread extends BaseRecord { title: string; messages: ChatMessage[]; profileId: string | null; contentType: ContentType }`
  - `DataShape.positioningProfiles: PositioningProfile[]` and `DataShape.contentThreads: ContentThread[]`

This task is config/type wiring (no runtime logic), so it is verified by typecheck + existing tests staying green rather than a new unit test.

- [ ] **Step 1: Add types to `src/lib/types.ts`**

Insert directly after the `Conversation` interface (after line ~247):

```ts
/* ---------- content studio ---------- */

export type ContentType = "social" | "script" | "longform";

export interface PositioningProfile extends BaseRecord {
  name: string;   // e.g. "Pallisade — boutique asset managers"
  body: string;   // the pasted positioning document
}

export interface ContentThread extends BaseRecord {
  title: string;                      // auto-derived from the first user message
  messages: ChatMessage[];
  profileId: string | null;           // selected positioning profile
  contentType: ContentType;           // selected content type
}
```

- [ ] **Step 2: Extend `DataShape` in `src/lib/types.ts`**

In the `DataShape` interface add two fields (after `targets: Target[];`):

```ts
  positioningProfiles: PositioningProfile[];
  contentThreads: ContentThread[];
```

- [ ] **Step 3: Register in `src/lib/store.tsx` `EMPTY`**

Add to the `EMPTY` object (after `targets: [],`):

```ts
  positioningProfiles: [],
  contentThreads: [],
```

- [ ] **Step 4: Register in `src/lib/db/sqlite.ts` `COLLECTIONS`**

Add two entries to the `COLLECTIONS` array (after `"targets",`):

```ts
  "positioningProfiles",
  "contentThreads",
```

- [ ] **Step 5: Verify typecheck + tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: tsc prints nothing (exit 0); Vitest reports all existing tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/store.tsx src/lib/db/sqlite.ts
git commit -m "feat(content): add positioningProfiles + contentThreads collections"
```

---

### Task 2: Content prompt builder (pure logic, TDD)

**Files:**
- Create: `src/lib/content/prompt.ts`
- Test: `src/lib/content/prompt.test.ts`

**Interfaces:**
- Consumes: `ContentType` from `src/lib/types.ts` (Task 1)
- Produces:
  - `const CONTENT_TOOL_NAMES = ["query_leads", "query_interactions", "search_pain_points"] as const`
  - `interface ContentTypeMeta { label: string; rules: string }`
  - `function contentTypeMeta(type: ContentType): ContentTypeMeta`
  - `interface ContentPromptInput { profile: { name: string; body: string }; contentType: ContentType; businessName: string; founderName: string; services: string; today: string }`
  - `function buildContentSystemPrompt(input: ContentPromptInput): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/content/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  contentTypeMeta,
  buildContentSystemPrompt,
  CONTENT_TOOL_NAMES,
} from "./prompt";

describe("contentTypeMeta", () => {
  it("gives a distinct label + rules for each content type", () => {
    const social = contentTypeMeta("social");
    const script = contentTypeMeta("script");
    const longform = contentTypeMeta("longform");
    expect(social.label).toMatch(/social/i);
    expect(script.label).toMatch(/script/i);
    expect(longform.label).toMatch(/long/i);
    // rules are non-empty and not identical across types
    expect(social.rules.length).toBeGreaterThan(20);
    expect(new Set([social.rules, script.rules, longform.rules]).size).toBe(3);
  });

  it("bakes the platform/format cues into the rules", () => {
    expect(contentTypeMeta("social").rules).toMatch(/hook/i);
    expect(contentTypeMeta("script").rules).toMatch(/\[HOOK\]/);
    expect(contentTypeMeta("longform").rules).toMatch(/subhead|outline/i);
  });
});

describe("buildContentSystemPrompt", () => {
  const base = {
    profile: { name: "Boutique AMs", body: "We sell calm to overwhelmed PMs." },
    contentType: "social" as const,
    businessName: "Pallisade Data",
    founderName: "Emil",
    services: "bespoke AI systems",
    today: "2026-06-23",
  };

  it("embeds the positioning body, business, founder and date", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toContain("We sell calm to overwhelmed PMs.");
    expect(p).toContain("Pallisade Data");
    expect(p).toContain("Emil");
    expect(p).toContain("2026-06-23");
  });

  it("injects the selected content type's rules and ideas-first behaviour", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toContain(contentTypeMeta("social").rules);
    expect(p).toMatch(/ideas first|batch of/i);
  });

  it("instructs grounding via the read tools and no inventing", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toMatch(/search_pain_points/);
    expect(p).toMatch(/never invent/i);
  });
});

describe("CONTENT_TOOL_NAMES", () => {
  it("is exactly the three read tools", () => {
    expect([...CONTENT_TOOL_NAMES].sort()).toEqual(
      ["query_interactions", "query_leads", "search_pain_points"].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/content/prompt.test.ts`
Expected: FAIL — cannot resolve `./prompt`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/content/prompt.ts`:

```ts
import type { ContentType } from "@/lib/types";

/** The read-only Advisor tools the Content agent is allowed to use. */
export const CONTENT_TOOL_NAMES = [
  "query_leads",
  "query_interactions",
  "search_pain_points",
] as const;

export interface ContentTypeMeta {
  label: string;
  rules: string;
}

export function contentTypeMeta(type: ContentType): ContentTypeMeta {
  switch (type) {
    case "social":
      return {
        label: "Short social (LinkedIn / X)",
        rules:
          "Platform-aware (LinkedIn or X). Lead with a strong hook on line one. " +
          "Keep it scannable — short lines, white space. One idea per post. " +
          "Offer a thread or carousel structure when the idea is too big for one post. " +
          "End with a light, specific call to engage.",
      };
    case "script":
      return {
        label: "Video / voice script",
        rules:
          "Write for the spoken word — natural cadence, short sentences, easy to say aloud. " +
          "Structure in beats: [HOOK] (first 3 seconds), [BODY] (the substance), [CTA] (the ask). " +
          "Add brief on-screen text cues in (parentheses) where they help. " +
          "State a length target (e.g. ~45s / ~150 words) and keep to it.",
      };
    case "longform":
      return {
        label: "Long-form (article / blog / case study)",
        rules:
          "Start with a tight outline, then the draft. Give it a headline and scannable subheads. " +
          "Build a narrative arc — tension, insight, resolution. Close with one clear takeaway. " +
          "Favour concrete specifics over abstraction.",
      };
  }
}

export interface ContentPromptInput {
  profile: { name: string; body: string };
  contentType: ContentType;
  businessName: string;
  founderName: string;
  services: string;
  today: string; // YYYY-MM-DD
}

export function buildContentSystemPrompt(input: ContentPromptInput): string {
  const { profile, contentType, businessName, founderName, services, today } = input;
  const meta = contentTypeMeta(contentType);

  return (
    `Today's date is ${today}.\n\n` +
    `You are the Content Studio agent for ${businessName}, a solo B2B agency run by ${founderName} ` +
    `that sells ${services}. You are a sharp content strategist and copywriter who turns the ` +
    `founder's positioning into content that lands.\n\n` +
    `POSITIONING PROFILE — "${profile.name}". Treat this as the source of truth for voice, ` +
    `audience, offer and angle. Work from it on every reply:\n"""\n${profile.body}\n"""\n\n` +
    `CONTENT TYPE — ${meta.label}. Format rules:\n${meta.rules}\n\n` +
    `HOW TO RESPOND:\n` +
    `- Default: give a tight batch of 4-6 distinct content ideas/angles/hooks, each with a ` +
    `one-line rationale. Don't dump full drafts unprompted.\n` +
    `- When the founder picks an idea or asks for the script/post: write the full piece in the ` +
    `format above, then add a few lines of delivery guidance (the hook, the structure, the CTA, ` +
    `and any posting/recording notes).\n` +
    `- Ground ideas in the founder's real data. Use the read tools (query_leads, query_interactions, ` +
    `search_pain_points) to pull genuine customer pains and stories — search_pain_points is your ` +
    `richest seam. Never invent client names, numbers, quotes or history; if you lack a real detail, ` +
    `keep it generic rather than fabricating.\n` +
    `- Confident and concise beats verbose. No filler.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/content/prompt.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/prompt.ts src/lib/content/prompt.test.ts
git commit -m "feat(content): content system-prompt builder + tool subset"
```

---

### Task 3: API route

**Files:**
- Create: `src/app/api/content/route.ts`

**Interfaces:**
- Consumes: `buildContentSystemPrompt`, `CONTENT_TOOL_NAMES` (Task 2); `TOOLS`, `resolveTool` from `src/lib/advisor/tools.ts`; `AdvisorSnapshot`, `ContentType` from `src/lib/types.ts`
- Produces: HTTP endpoint `GET /api/content` → `{ configured: boolean }`; `POST /api/content` (body below) → `{ content: string }`
  - POST body: `{ messages: {role,content}[], snapshot: AdvisorSnapshot, profile: {name,body}, contentType: ContentType, context: {businessName,founderName,services} }`

This task is IO wiring of proven pieces (the Advisor route's tool loop with a trimmed toolset). Verify by typecheck/build and a manual `GET` check; no unit test (matches the repo — the Advisor route has none).

- [ ] **Step 1: Write the route**

Create `src/app/api/content/route.ts`:

```ts
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AdvisorSnapshot, ContentType, ProposedAction } from "@/lib/types";
import { TOOLS, resolveTool } from "@/lib/advisor/tools";
import { buildContentSystemPrompt, CONTENT_TOOL_NAMES } from "@/lib/content/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
const MAX_ITERATIONS = 6;

// Read-only subset of the Advisor's tools — selected by name from the shared registry.
const CONTENT_TOOLS = TOOLS.filter((t) =>
  (CONTENT_TOOL_NAMES as readonly string[]).includes(t.name),
);

export async function GET() {
  return NextResponse.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

interface ContentRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  snapshot?: AdvisorSnapshot;
  profile?: { name?: string; body?: string };
  contentType?: ContentType;
  context?: { businessName?: string; founderName?: string; services?: string };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let body: ContentRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const snapshot = body.snapshot;
  if (!snapshot) return NextResponse.json({ error: "missing_snapshot" }, { status: 400 });
  if (!body.profile?.body) {
    return NextResponse.json({ error: "missing_profile" }, { status: 400 });
  }

  const contentType: ContentType = body.contentType ?? "social";
  const today = new Date().toISOString().slice(0, 10);

  const system = buildContentSystemPrompt({
    profile: { name: body.profile.name || "Untitled", body: body.profile.body },
    contentType,
    businessName: body.context?.businessName || "Pallisade Data",
    founderName: body.context?.founderName || "the founder",
    services:
      body.context?.services ||
      "bespoke AI systems, workflow automation, custom software, dashboards and reporting tools",
    today,
  });

  const client = new Anthropic({ apiKey });
  // resolveTool needs a proposals array for write tools; ours are all read tools,
  // so it stays empty and is never returned to the client.
  const proposals: ProposedAction[] = [];
  const messages: Anthropic.MessageParam[] = (body.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 3072,
        system,
        tools: CONTENT_TOOLS as unknown as Anthropic.Tool[],
        messages,
      });

      const textParts = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text);
      if (textParts.length) finalText = textParts.join("\n").trim();

      const toolUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock => blk.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: resolveTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals),
      }));
      messages.push({ role: "user", content: results });
    }

    if (!finalText) finalText = "I couldn't produce a response — try rephrasing.";
    return NextResponse.json({ content: finalText });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 3: Manually verify the GET endpoint**

Run (in one terminal): `npm run dev`
Then: `curl -s localhost:3000/api/content`
Expected: JSON `{"configured":true,"model":"claude-sonnet-4-6"}` (or `"configured":false` if no key set). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/content/route.ts
git commit -m "feat(content): /api/content route (read-only tool loop)"
```

---

### Task 4: Client

**Files:**
- Create: `src/lib/contentClient.ts`

**Interfaces:**
- Consumes: `AdvisorSnapshot`, `ContentType` from `src/lib/types.ts`; `buildSnapshot` from `src/lib/advisorClient.ts`
- Produces:
  - `function getContentStatus(): Promise<{ configured: boolean }>`
  - `function sendContentTurn(params: { messages: {role:"user"|"assistant",content:string}[]; snapshot: AdvisorSnapshot; profile: {name:string,body:string}; contentType: ContentType; context: {businessName:string,founderName:string,services:string} }): Promise<{ content: string }>`
  - re-export `buildSnapshot`

This is a thin fetch wrapper (mirrors `advisorClient.ts`). Verify by typecheck; no unit test (matches `advisorClient.ts`, which has none).

- [ ] **Step 1: Write the client**

Create `src/lib/contentClient.ts`:

```ts
import type { AdvisorSnapshot, ContentType } from "./types";
import { buildSnapshot } from "./advisorClient";

export { buildSnapshot };

export async function getContentStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch("/api/content", { method: "GET" });
    if (!res.ok) return { configured: false };
    return (await res.json()) as { configured: boolean };
  } catch {
    return { configured: false };
  }
}

export async function sendContentTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  snapshot: AdvisorSnapshot;
  profile: { name: string; body: string };
  contentType: ContentType;
  context: { businessName: string; founderName: string; services: string };
}): Promise<{ content: string }> {
  const res = await fetch("/api/content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error(
        "The Content Studio needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.",
      );
    }
    throw new Error(typeof err.error === "string" ? err.error : "The content request failed.");
  }

  return (await res.json()) as { content: string };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/lib/contentClient.ts
git commit -m "feat(content): content client (status + turn)"
```

---

### Task 5: Page, profiles manager + navigation

**Files:**
- Create: `src/app/content/page.tsx`
- Modify: `src/components/layout/nav.ts`

**Interfaces:**
- Consumes: `useStore` (`src/lib/store`), `getContentStatus`/`sendContentTurn`/`buildSnapshot` (Task 4), `contentTypeMeta` (Task 2), `PageHeader`/`Panel`/`MicButton`, `MessageBubble`/`ThreadList` (advisor components), `ContentThread`/`PositioningProfile`/`ContentType`/`ChatMessage` types, `uid`/`nowISO` (`src/lib/utils`)
- Produces: route `/content`; nav entry in the Intelligence group

The page reuses the Advisor's chat scaffolding. Verify by typecheck, production build, and a manual end-to-end run.

- [ ] **Step 1: Add the nav entry in `src/components/layout/nav.ts`**

Add `PenLine` to the lucide import list (alongside the other icons):

```ts
  PenLine,
```

Add this item to the `NAV` array, immediately after the `/advisor` entry:

```ts
  { href: "/content", label: "Content Studio", icon: PenLine, group: "Intelligence" },
```

- [ ] **Step 2: Create the page**

Create `src/app/content/page.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, PenLine, Plus, Trash2, Pencil } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import { contentTypeMeta } from "@/lib/content/prompt";
import { buildSnapshot, getContentStatus, sendContentTurn } from "@/lib/contentClient";
import type {
  ChatMessage,
  ContentThread,
  ContentType,
  PositioningProfile,
} from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

const CONTENT_TYPES: ContentType[] = ["social", "script", "longform"];

export default function ContentPage() {
  const store = useStore();
  const { contentThreads, positioningProfiles, settings } = store;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Profile editor state.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileBody, setProfileBody] = useState("");

  useEffect(() => { getContentStatus().then((s) => setConfigured(s.configured)); }, []);

  const active = useMemo<ContentThread | null>(
    () => contentThreads.find((t) => t.id === activeId) ?? null,
    [contentThreads, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  const setMessages = (thread: ContentThread, messages: ChatMessage[]) =>
    store.update("contentThreads", thread.id, { messages });

  // Effective profile / content type for the composer: from the active thread, else defaults.
  const activeProfileId = active?.profileId ?? positioningProfiles[0]?.id ?? null;
  const activeContentType: ContentType = active?.contentType ?? "social";
  const activeProfile = positioningProfiles.find((p) => p.id === activeProfileId) ?? null;

  const newThread = () => { setActiveId(null); setInput(""); setError(null); };

  // Setting profile/type before a thread exists is held until the first send;
  // for an existing thread, persist immediately.
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ContentType | null>(null);
  const selProfileId = active ? activeProfileId : (pendingProfileId ?? activeProfileId);
  const selType = active ? activeContentType : (pendingType ?? "social");
  const selProfile = positioningProfiles.find((p) => p.id === selProfileId) ?? null;

  const onSelectProfile = (id: string) => {
    if (active) store.update("contentThreads", active.id, { profileId: id });
    else setPendingProfileId(id);
  };
  const onSelectType = (t: ContentType) => {
    if (active) store.update("contentThreads", active.id, { contentType: t });
    else setPendingType(t);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!selProfile) { setError("Add and select a positioning profile first."); return; }
    setError(null);

    let thread = active;
    if (!thread) {
      thread = store.create("contentThreads", {
        title: text.slice(0, 48),
        messages: [],
        profileId: selProfileId,
        contentType: selType,
      } as Omit<ContentThread, "id" | "createdAt" | "updatedAt">) as ContentThread;
      setActiveId(thread.id);
      setPendingProfileId(null);
      setPendingType(null);
    }

    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...thread.messages, userMsg];
    setMessages(thread, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendContentTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        snapshot: buildSnapshot(store),
        profile: { name: selProfile.name, body: selProfile.body },
        contentType: selType,
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
          services: settings.services,
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

  // ---- profiles manager ----
  const startNewProfile = () => { setEditingProfileId("new"); setProfileName(""); setProfileBody(""); };
  const startEditProfile = (p: PositioningProfile) => {
    setEditingProfileId(p.id); setProfileName(p.name); setProfileBody(p.body);
  };
  const saveProfile = () => {
    const name = profileName.trim();
    const bodyText = profileBody.trim();
    if (!name || !bodyText) return;
    if (editingProfileId === "new") {
      const created = store.create("positioningProfiles", { name, body: bodyText } as Omit<
        PositioningProfile, "id" | "createdAt" | "updatedAt"
      >) as PositioningProfile;
      if (!active) setPendingProfileId(created.id);
    } else if (editingProfileId) {
      store.update("positioningProfiles", editingProfileId, { name, body: bodyText });
    }
    setEditingProfileId(null);
  };
  const deleteProfile = (id: string) => store.remove("positioningProfiles", id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content Studio"
        subtitle="Pick a positioning profile and a content type, then get ideas first — and the full script or post on request. Grounded in your real pain points, leads and calls."
      />

      {configured === false && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <PenLine size={18} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              Content Studio needs a Claude API key. Add <code>ANTHROPIC_API_KEY=sk-ant-…</code> to{" "}
              <code>.env.local</code> and restart the app.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        <div className="flex flex-col gap-5">
          <Panel title="Threads">
            <ThreadList
              conversations={contentThreads}
              activeId={activeId}
              onSelect={(id) => { setActiveId(id); setError(null); }}
              onNew={newThread}
            />
          </Panel>

          <Panel title="Positioning profiles">
            <div className="flex flex-col gap-1.5">
              {positioningProfiles.map((p) => (
                <div key={p.id} className="flex items-center gap-1.5 text-[0.8rem]">
                  <span className="truncate flex-1 text-[var(--color-muted)]">{p.name}</span>
                  <button className="btn btn-sm" title="Edit" onClick={() => startEditProfile(p)}>
                    <Pencil size={12} />
                  </button>
                  <button className="btn btn-sm" title="Delete" onClick={() => deleteProfile(p.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {positioningProfiles.length === 0 && (
                <p className="text-[0.75rem] text-[var(--color-dim)]">No profiles yet.</p>
              )}
              <button className="btn btn-sm w-full justify-start mt-1" onClick={startNewProfile}>
                <Plus size={13} /> New profile
              </button>
            </div>

            {editingProfileId && (
              <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-[var(--color-line)]">
                <input
                  className="input"
                  placeholder="Profile name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
                <textarea
                  className="textarea"
                  rows={6}
                  placeholder="Paste your positioning document…"
                  value={profileBody}
                  onChange={(e) => setProfileBody(e.target.value)}
                />
                <div className="flex gap-2">
                  <button className="btn btn-accent btn-sm" onClick={saveProfile}
                    disabled={!profileName.trim() || !profileBody.trim()}>
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditingProfileId(null)}>Cancel</button>
                </div>
              </div>
            )}
          </Panel>
        </div>

        <Panel>
          {/* composer controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-[var(--color-line)]">
            <select
              className="input max-w-[200px]"
              value={selProfileId ?? ""}
              onChange={(e) => onSelectProfile(e.target.value)}
            >
              {positioningProfiles.length === 0 && <option value="">No profiles — add one</option>}
              {positioningProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              className="input max-w-[220px]"
              value={selType}
              onChange={(e) => onSelectType(e.target.value as ContentType)}
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>{contentTypeMeta(t).label}</option>
              ))}
            </select>
          </div>

          <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ minHeight: 360, maxHeight: "55vh" }}>
            {!active || active.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="flex items-center justify-center mb-4" style={{ width: 52, height: 52, borderRadius: 12, border: "1px solid var(--color-line-strong)", background: "var(--color-surface-2)" }}>
                  <PenLine size={22} className="text-[var(--color-accent)]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">What should we make?</h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  Try "give me 5 LinkedIn hooks about manual reconciliation", or "draft a 45-second reel from idea 2".
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
              placeholder="Ask for ideas or a script…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"
              disabled={loading}
            />
            <MicButton
              size={16}
              title="Talk to Content Studio"
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

- [ ] **Step 3: Verify typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; Next build succeeds and lists `/content` and `/api/content` in the route output.

- [ ] **Step 4: Manual end-to-end check**

Run: `npm run dev`, open `http://localhost:3000/content`. Confirm:
1. Sidebar shows "Content Studio" under Intelligence.
2. "New profile" → paste a short positioning doc → Save → it appears in the dropdown.
3. Pick a content type, send "give me 5 hooks about manual reconciliation" → a batch of ideas comes back.
4. Reply "write idea 2 as a post" → a full post + brief guidance.
5. Reload the page → the thread and profile persist.
Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/content/page.tsx src/components/layout/nav.ts
git commit -m "feat(content): Content Studio page, profiles manager + nav"
```

---

## Self-Review

**Spec coverage:**
- Threaded chat like Advisor → Task 5 (page reuses ThreadList/MessageBubble/composer). ✓
- Saved reusable positioning profiles → Task 1 (`positioningProfiles`) + Task 5 (manager + dropdown). ✓
- Content types social/script/longform → Task 1 (`ContentType`) + Task 2 (`contentTypeMeta`) + Task 5 (selector). ✓
- Pain bank + leads/interactions grounding → Task 2 (prompt instructs tools) + Task 3 (`CONTENT_TOOL_NAMES` subset via `resolveTool`). ✓
- Ideas-first, scripts on request → Task 2 (system prompt "HOW TO RESPOND"). ✓
- Read-only, no proposals UI → Task 3 (no write tools; `{content}` only) + Task 5 (no-op MessageBubble handlers). ✓
- No-key handling → Task 3 (503 `no_key`) + Task 4 (client message) + Task 5 (banner). ✓
- Nav entry → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete.

**Type consistency:** `ContentType`, `ContentThread`, `PositioningProfile`, `CONTENT_TOOL_NAMES`, `contentTypeMeta`, `buildContentSystemPrompt`, `getContentStatus`, `sendContentTurn`, `buildSnapshot` are defined in Tasks 1–4 and consumed with matching signatures in Tasks 3–5. `ThreadList`'s `conversations: Conversation[]` prop accepts `ContentThread[]` (structural supertype — it only reads `id`/`title`/`updatedAt`). ✓
