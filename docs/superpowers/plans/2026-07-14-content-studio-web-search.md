# Content Studio Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Content Studio agent Anthropic's server-side `web_search_20250305` tool so it can ground content in current outside-the-CRM information, deciding on its own when to search.

**Architecture:** Two files change. The system prompt gains guidance on when to search, how to attribute sources inline, and the boundary that keeps founder/client facts sourced from the CRM tools. The API route appends the server-side search tool to its existing tool array, adds a `pause_turn` branch so Anthropic's server-side search loop can resume, and filters `tool_use` blocks to local tools before resolving them. This mirrors the proven Brain brainstorm loop at `src/app/api/brain/route.ts:69-104`.

**Tech Stack:** Next.js 15 App Router, TypeScript, raw `@anthropic-ai/sdk` (no Vercel AI SDK, no streaming), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-content-studio-web-search-design.md`

## Global Constraints

- Model is `claude-sonnet-4-6`; Content Studio's loop is `MAX_ITERATIONS = 6` with `max_tokens: 3072`. Do not change these.
- `web_search` uses `max_uses: 4` (Brain uses 5; Content Studio's token budget is tighter).
- **Do not modify `CONTENT_TOOL_NAMES`.** It is the allowlist for filtering the *local* `TOOLS` registry. `web_search` is a server-side Anthropic tool and is appended separately. The existing test `CONTENT_TOOL_NAMES > "is exactly the three read tools"` must keep passing unchanged.
- No UI changes, no new response fields, no new dependency. The route keeps returning `{ content: string }`.
- Do not touch `src/app/api/brain/route.ts` or `src/lib/news/curate.ts`.
- Tests: `npm test` (vitest run). Colocated `*.test.ts` convention.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/content/prompt.ts` | Builds the Content Studio system prompt; owns the tool allowlist | Modify — add web-search guidance to `buildContentSystemPrompt` |
| `src/lib/content/prompt.test.ts` | Unit tests for prompt contents + allowlist | Modify — add web-search guidance assertions |
| `src/app/api/content/route.ts` | Content Studio tool loop | Modify — add tool, `pause_turn` branch, local-tool filter |

---

### Task 1: Web-search guidance in the system prompt

**Files:**
- Modify: `src/lib/content/prompt.ts:67-78` (the `HOW TO RESPOND` block in `buildContentSystemPrompt`)
- Test: `src/lib/content/prompt.test.ts:28-57` (add cases to the existing `buildContentSystemPrompt` describe block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by Task 2 in code. Task 2 relies only on the exported `CONTENT_TOOL_NAMES` (unchanged) and the existing `buildContentSystemPrompt(input: ContentPromptInput): string` signature (unchanged).

- [ ] **Step 1: Write the failing tests**

Add these two cases inside the existing `describe("buildContentSystemPrompt", ...)` block in `src/lib/content/prompt.test.ts`, after the `"instructs grounding via the read tools and no inventing"` case. They reuse the `base` fixture already defined at the top of that describe block.

```ts
  it("tells the agent when to reach for web_search and to attribute sources inline", () => {
    const p = buildContentSystemPrompt(base);
    expect(p).toMatch(/web_search/);
    expect(p).toMatch(/trend|current|stat/i);
    // sources named inline in prose, not dumped as bare links
    expect(p).toMatch(/name the source/i);
  });

  it("keeps founder/client facts sourced from the CRM tools, not the web", () => {
    const p = buildContentSystemPrompt(base);
    // the web-search guidance must restate the boundary
    expect(p).toMatch(/outside world/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/content/prompt.test.ts`

Expected: FAIL — the two new cases fail on the first unmatched assertion (`expect(p).toMatch(/web_search/)`), because the current prompt never mentions `web_search`. The four pre-existing cases in this file still PASS.

- [ ] **Step 3: Add the guidance to the prompt**

In `src/lib/content/prompt.ts`, inside `buildContentSystemPrompt`'s returned template, insert a new bullet between the existing "Ground ideas in the founder's real data…" bullet (ends `...keep it generic rather than fabricating.\n`) and the final "Confident and concise beats verbose. No filler." line:

```ts
    `- Use web_search when current or outside information would make the content land harder ` +
    `— a live trend to hook onto, a stat worth citing, what competitors or the market are ` +
    `saying right now. Skip it for pure voice, positioning or structure work; the profile is ` +
    `already the source of truth there. When a claim comes from the web, name the source ` +
    `inline in the prose ("per TechCrunch last week...") — no bare URLs, no link list at the ` +
    `end. Search is for the outside world only: the founder's own customers, pains, numbers ` +
    `and stories still come from the read tools, and search results never license inventing ` +
    `client detail.\n` +
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/content/prompt.test.ts`

Expected: PASS — all 6 cases, including the unchanged `CONTENT_TOOL_NAMES` case asserting exactly the three read tools.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content/prompt.ts src/lib/content/prompt.test.ts
git commit -m "feat(content): tell the Content Studio agent when to web search"
```

---

### Task 2: Wire web_search into the Content Studio tool loop

**Files:**
- Modify: `src/app/api/content/route.ts:70-98` (the tool loop inside the `try` block)

**Interfaces:**
- Consumes: `CONTENT_TOOL_NAMES` (`readonly ["query_leads", "query_interactions", "search_pain_points"]`) and `buildContentSystemPrompt` from `src/lib/content/prompt.ts` — both already imported at `route.ts:5`, both unchanged by Task 1. `CONTENT_TOOLS` (the filtered local `ToolDef[]`) is already defined at `route.ts:14-16`.
- Produces: nothing consumed by later tasks. The route's response shape stays `{ content: string }`.

Reference implementation for this whole task: `src/app/api/brain/route.ts:69-104`.

- [ ] **Step 1: Add a name set for the local tools**

In `src/app/api/content/route.ts`, directly after the existing `CONTENT_TOOLS` definition (line 16), add:

```ts
// Anthropic executes web_search server-side and resolves it inside response.content,
// so only these local tools need a synthetic tool_result.
const LOCAL_TOOL_NAMES = new Set<string>(CONTENT_TOOL_NAMES);
```

- [ ] **Step 2: Build the tools array with the server-side search tool**

Inside `POST`, after the `const client = new Anthropic({ apiKey });` line (line 61) and before the `proposals` declaration, add:

```ts
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 4 },
    ...CONTENT_TOOLS,
  ] as unknown as Anthropic.Tool[];
```

Then in the `client.messages.create({ ... })` call, replace this line:

```ts
        tools: CONTENT_TOOLS as unknown as Anthropic.Tool[],
```

with:

```ts
        tools,
```

- [ ] **Step 3: Filter tool uses to local tools and handle pause_turn**

Replace the block currently at lines 86-97 — from `const toolUses = response.content.filter(` through the closing `messages.push({ role: "user", content: results });` — with:

```ts
      const toolUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock =>
          blk.type === "tool_use" && LOCAL_TOOL_NAMES.has(blk.name),
      );

      // web_search may pause its server-side loop; resume by re-requesting with the
      // partial assistant turn appended and no synthetic tool_result.
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: resolveTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, snapshot, proposals),
      }));
      messages.push({ role: "user", content: results });
```

Two things to get right, both load-bearing:
- The `pause_turn` check must sit **before** the `stop_reason !== "tool_use"` break. Otherwise the loop exits mid-search and returns partial text.
- `toolUses` must be filtered by `LOCAL_TOOL_NAMES`. An unfiltered `web_search` block reaching `resolveTool` yields a bogus result for a tool the local registry doesn't know.

- [ ] **Step 4: Verify types and the existing suite**

Run: `npx tsc --noEmit`

Expected: no errors. (If `tsc` is not wired as a script, this is the direct invocation; the repo has TypeScript 5.7 as a devDependency.)

Run: `npm test`

Expected: PASS — the full suite, unchanged from before this task. This task adds no test; it changes only the route's loop, which has no test harness in this repo (neither does Brain's). Step 5 is the real verification.

- [ ] **Step 5: Verify end-to-end in the running app**

Run: `npm run dev`

In Content Studio (`/content`), with a positioning profile selected, send a message that requires current information — for example: *"What's happening in AI agent tooling this month that I could hook a LinkedIn post onto?"*

Confirm all three:
1. A reply comes back (not a truncated/empty one) — proves the `pause_turn` branch works.
2. The reply references genuinely current, outside information.
3. Sources are named inline in the prose ("per …"), not as a trailing link list.

Then send a message that should **not** trigger search — for example: *"Give me 5 hooks from my positioning profile"* — and confirm it answers from the profile without searching.

If step 1 returns an empty or truncated reply, the `pause_turn` branch is misplaced — check it sits before the `stop_reason !== "tool_use"` break.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/content/route.ts
git commit -m "feat(content): give Content Studio the web_search tool"
```

---

## Self-Review

**Spec coverage:**
- Prompt: when-to-search, inline attribution, CRM boundary → Task 1, Step 3.
- `CONTENT_TOOL_NAMES` unchanged → Global Constraints; guarded by the existing test kept green in Task 1, Step 4.
- Route: add tool with `max_uses: 4` → Task 2, Step 2.
- Route: `pause_turn` branch → Task 2, Step 3.
- Route: filter to local tool uses → Task 2, Steps 1 and 3.
- Error handling unchanged → no task needed; the existing try/catch is untouched.
- Testing: prompt test extended → Task 1; manual route verification → Task 2, Step 5.
- Non-goals (no UI, no `sources` array, no streaming, no Brain/news changes) → Global Constraints.

**Placeholder scan:** None. Every code step shows the actual code; every run step shows the exact command and expected result.

**Type consistency:** `CONTENT_TOOL_NAMES` is `readonly string[]`-compatible and feeds `new Set<string>(...)` in Task 2 — matching its existing use at `route.ts:15` where it is cast to `readonly string[]`. `LOCAL_TOOL_NAMES` is defined in Task 2 Step 1 and used in Task 2 Step 3. `tools` is defined in Task 2 Step 2 and used in the same task's `messages.create` call. `buildContentSystemPrompt` keeps its signature; Task 1 changes only the string it returns.
