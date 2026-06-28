# Brain — Product Brainstorm mode (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second "Product Brainstorm" mode to The Brain — an agentic 0-to-1 product strategist that reads the founder's Google Drive docs + dropped `.md` files, researches with web search, and writes a copy-pasteable Build Scope for Claude Code.

**Architecture:** Reuse the existing Advisor/Content tool-loop in a new `mode === "brainstorm"` branch of `/api/brain`. Tools: Anthropic's native `web_search` (server-executed) plus local `drive_search`/`drive_read_file` that read Google Drive via the app's existing Google OAuth (a `drive.readonly` scope addition). The `/brain` page gains a segmented mode toggle; CEO/Strategist's single-call path is untouched.

**Tech Stack:** Next.js 15 (App Router, Node runtime), TypeScript, `@anthropic-ai/sdk@^0.104.1`, `google-auth-library`, `node:sqlite`, Vitest 3.

## Global Constraints

- **Test convention:** This repo has NO route/page tests. TDD applies to **pure functions only** (prompt builders, query/parse helpers, tool-name sets) via Vitest; routes/pages/clients are verified by `npm run build` + manual smoke. Do not add a test harness for Next routes.
- **Run the full suite with:** `npx vitest run` (NOT `npm test` in watch). Build gate: `npm run build`.
- **Model:** read from `process.env.BRAIN_MODEL || "claude-sonnet-4-6"` (already in the route).
- **`web_search` tool type:** `web_search_20250305` (GA, valid on `client.messages.create` in SDK 0.104.1). A newer `web_search_20260209` also exists; do not use it unless 0305 errors.
- **Strategist mode must remain byte-for-byte unchanged.** The existing `buildBrainSystemPrompt` output and the existing single-call POST path must not change behaviour.
- **Error convention:** routes forward `(err as Error).message` with status `502`; keep it.
- **Secrets:** Google tokens are server-only (`gmail/accounts.ts`); never send `scope`/tokens to the client. The page learns Drive availability only via `/api/drive/status`.
- **IDs/time:** use `uid(...)` and `nowISO()` from `@/lib/utils` (no `Math.random`/bare `Date.now` in stored records).

---

### Task 1: Data model — `mode` + attachments on `BrainThread`

**Files:**
- Modify: `src/lib/types.ts` (the `BrainThread` interface — search for `export interface BrainThread`)
- Create: `src/lib/brain/mode.ts`
- Test: `src/lib/brain/mode.test.ts`

**Interfaces:**
- Produces: `type BrainMode = "strategist" | "brainstorm"`; `interface BrainAttachment { id: string; name: string; content: string; createdAt: string }`; `BrainThread` gains `mode: BrainMode` and `attachments?: BrainAttachment[]`; `threadMode(t: { mode?: BrainMode }): BrainMode`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/brain/mode.test.ts
import { describe, it, expect } from "vitest";
import { threadMode } from "./mode";

describe("threadMode", () => {
  it("returns brainstorm when set", () => {
    expect(threadMode({ mode: "brainstorm" })).toBe("brainstorm");
  });
  it("defaults legacy/missing mode to strategist", () => {
    expect(threadMode({})).toBe("strategist");
    expect(threadMode({ mode: undefined })).toBe("strategist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brain/mode.test.ts`
Expected: FAIL — cannot find module `./mode`.

- [ ] **Step 3: Create the module**

```ts
// src/lib/brain/mode.ts
export type BrainMode = "strategist" | "brainstorm";

/** Legacy brainThreads rows have no `mode`; treat them as strategist. */
export function threadMode(t: { mode?: BrainMode }): BrainMode {
  return t.mode === "brainstorm" ? "brainstorm" : "strategist";
}
```

- [ ] **Step 4: Update the type**

In `src/lib/types.ts`, add `BrainAttachment` just above `BrainThread`, and extend `BrainThread`:

```ts
export interface BrainAttachment {
  id: string;
  name: string;        // file name, e.g. "discovery-call-acme.md"
  content: string;     // raw text
  createdAt: string;
}

export interface BrainThread extends BaseRecord {
  title: string;
  mode: "strategist" | "brainstorm";   // legacy rows read as "strategist" via threadMode()
  messages: ChatMessage[];
  attachments?: BrainAttachment[];      // brainstorm session source docs
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/brain/mode.test.ts && npx tsc --noEmit`
Expected: test PASS. `tsc` may report pre-existing errors elsewhere where `BrainThread` is constructed without `mode` — those are fixed in Tasks 8–9; if `tsc` flags ONLY `src/app/brain/page.tsx` / `seed.ts`, that is expected and resolved later. (If you want a green typecheck now, you may make `mode` optional, but the page task sets it explicitly.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/brain/mode.ts src/lib/brain/mode.test.ts
git commit -m "feat(brain): add mode discriminator + attachments to BrainThread"
```

---

### Task 2: Google Drive read scope + `hasDriveScope`

**Files:**
- Modify: `src/lib/gmail/config.ts`
- Test: `src/lib/gmail/config.test.ts` (create)

**Interfaces:**
- Produces: `DRIVE_SCOPE: string`; `hasDriveScope(scope: string | undefined | null): boolean`; `GOOGLE_SCOPES` includes `drive.readonly`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gmail/config.test.ts
import { describe, it, expect } from "vitest";
import { GOOGLE_SCOPES, DRIVE_SCOPE, hasDriveScope } from "./config";

describe("drive scope", () => {
  it("requests drive.readonly in the consent scopes", () => {
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/drive.readonly");
  });
  it("detects drive scope in a granted scope string", () => {
    expect(hasDriveScope(`openid ${DRIVE_SCOPE} email`)).toBe(true);
    expect(hasDriveScope("https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
    expect(hasDriveScope(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gmail/config.test.ts`
Expected: FAIL — `DRIVE_SCOPE` / `hasDriveScope` undefined; scope missing.

- [ ] **Step 3: Implement**

In `src/lib/gmail/config.ts`, add the scope to the array and the helper below `hasCalendarScope`:

```ts
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.readonly",
];
```

```ts
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Whether a stored token's granted scopes include Drive read access. */
export function hasDriveScope(scope: string | undefined | null): boolean {
  return !!scope && scope.includes(DRIVE_SCOPE);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/gmail/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/config.ts src/lib/gmail/config.test.ts
git commit -m "feat(drive): add drive.readonly scope + hasDriveScope helper"
```

> **Note for the founder (not a code step):** existing Google connections must **re-consent once** to grant Drive. The page's Drive gate (Task 9) links to `/api/gmail/connect`.

---

### Task 3: Drive API helper (`searchFiles` / `readFileContent`)

**Files:**
- Create: `src/lib/drive/driveApi.ts`
- Test: `src/lib/drive/driveApi.test.ts`

**Interfaces:**
- Consumes: `googleFetch(accountId, url)` from `@/lib/gmail/client`.
- Produces: `interface DriveFile { id: string; name: string; mimeType: string }`; `driveQuery(query: string): string`; `driveFetchPlan(mimeType: string): { mode: "export"; exportMime: string } | { mode: "download" }`; `searchFiles(accountId: string, query: string): Promise<DriveFile[]>`; `readFileContent(accountId: string, fileId: string): Promise<string>`.

- [ ] **Step 1: Write the failing test (pure helpers only)**

```ts
// src/lib/drive/driveApi.test.ts
import { describe, it, expect } from "vitest";
import { driveQuery, driveFetchPlan } from "./driveApi";

describe("driveQuery", () => {
  it("restricts to doc/markdown/text mime types and excludes trashed", () => {
    const q = driveQuery("");
    expect(q).toContain("trashed = false");
    expect(q).toContain("application/vnd.google-apps.document");
    expect(q).toContain("text/markdown");
    expect(q).toContain("text/plain");
  });
  it("adds a name/fullText term and escapes single quotes", () => {
    const q = driveQuery("acme's notes");
    expect(q).toContain("name contains 'acme\\'s notes'");
    expect(q).toContain("fullText contains 'acme\\'s notes'");
  });
});

describe("driveFetchPlan", () => {
  it("exports Google Docs as markdown", () => {
    expect(driveFetchPlan("application/vnd.google-apps.document"))
      .toEqual({ mode: "export", exportMime: "text/markdown" });
  });
  it("downloads plain/markdown files directly", () => {
    expect(driveFetchPlan("text/markdown")).toEqual({ mode: "download" });
    expect(driveFetchPlan("text/plain")).toEqual({ mode: "download" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/drive/driveApi.test.ts`
Expected: FAIL — cannot find module `./driveApi`.

- [ ] **Step 3: Implement**

```ts
// src/lib/drive/driveApi.ts
/* ============================================================
   Authenticated Google Drive reads for a connected account.
   Reuses the Gmail OAuth layer's googleFetch (token refresh + 401 handling).
   Server-only.
   ============================================================ */

import { googleFetch } from "@/lib/gmail/client";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

const GOOGLE_DOC = "application/vnd.google-apps.document";
const READABLE_MIMES = [GOOGLE_DOC, "text/markdown", "text/plain"];

/** Build a Drive `q` filter limited to text-like files the Brain can read. */
export function driveQuery(query: string): string {
  const mimes = READABLE_MIMES.map((m) => `mimeType = '${m}'`).join(" or ");
  const safe = query.trim().replace(/'/g, "\\'");
  const term = safe
    ? ` and (name contains '${safe}' or fullText contains '${safe}')`
    : "";
  return `trashed = false and (${mimes})${term}`;
}

/** How to fetch a file's text, based on its mime type. */
export function driveFetchPlan(
  mimeType: string,
): { mode: "export"; exportMime: string } | { mode: "download" } {
  if (mimeType === GOOGLE_DOC) return { mode: "export", exportMime: "text/markdown" };
  return { mode: "download" };
}

export async function searchFiles(accountId: string, query: string): Promise<DriveFile[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", driveQuery(query));
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "modifiedTime desc");
  const res = await googleFetch(accountId, url.toString());
  if (!res.ok) throw new Error(`drive_api_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function readFileContent(accountId: string, fileId: string): Promise<string> {
  const metaUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  metaUrl.searchParams.set("fields", "mimeType,name");
  const metaRes = await googleFetch(accountId, metaUrl.toString());
  if (!metaRes.ok) throw new Error(`drive_api_${metaRes.status}`);
  const meta = (await metaRes.json()) as { mimeType: string };

  const plan = driveFetchPlan(meta.mimeType);
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const url = new URL(plan.mode === "export" ? `${base}/export` : base);
  if (plan.mode === "export") url.searchParams.set("mimeType", plan.exportMime);
  else url.searchParams.set("alt", "media");

  const res = await googleFetch(accountId, url.toString());
  if (!res.ok) throw new Error(`drive_api_${res.status}`);
  return res.text();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/drive/driveApi.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/drive/driveApi.ts src/lib/drive/driveApi.test.ts
git commit -m "feat(drive): searchFiles + readFileContent over googleFetch"
```

---

### Task 4: Drive status route + browser client

**Files:**
- Create: `src/app/api/drive/status/route.ts`
- Modify: `src/lib/brainClient.ts` (add `getDriveStatus`)

**Interfaces:**
- Consumes: `isConfigured`, `hasDriveScope` from `@/lib/gmail/config`; `listAccounts` from `@/lib/gmail/accounts`.
- Produces: `GET /api/drive/status` → `{ connected: boolean; accountId: string | null }`; client `getDriveStatus(): Promise<{ connected: boolean; accountId: string | null }>`.

- [ ] **Step 1: Create the route**

```ts
// src/app/api/drive/status/route.ts
import { NextResponse } from "next/server";
import { isConfigured, hasDriveScope } from "@/lib/gmail/config";
import { listAccounts } from "@/lib/gmail/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  if (!isConfigured()) return NextResponse.json({ connected: false, accountId: null });
  const acct = listAccounts().find((a) => hasDriveScope(a.tokens.scope));
  return NextResponse.json({ connected: !!acct, accountId: acct?.id ?? null });
}
```

- [ ] **Step 2: Add the browser client**

Append to `src/lib/brainClient.ts`:

```ts
export async function getDriveStatus(): Promise<{ connected: boolean; accountId: string | null }> {
  try {
    const res = await fetch("/api/drive/status");
    if (!res.ok) return { connected: false, accountId: null };
    return (await res.json()) as { connected: boolean; accountId: string | null };
  } catch {
    return { connected: false, accountId: null };
  }
}
```

- [ ] **Step 3: Build + manual smoke**

Run: `npm run build`
Expected: build succeeds; `/api/drive/status` appears in the route list.
With dev running (`npm run dev`): `curl localhost:3000/api/drive/status` → `{"connected":false,"accountId":null}` when no Drive-scoped account exists.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/drive/status/route.ts src/lib/brainClient.ts
git commit -m "feat(drive): /api/drive/status + getDriveStatus client"
```

---

### Task 5: Brain tools (`drive_search` / `drive_read_file`) + resolver

**Files:**
- Create: `src/lib/brain/tools.ts`
- Test: `src/lib/brain/tools.test.ts`

**Interfaces:**
- Consumes: `searchFiles`, `readFileContent` from `@/lib/drive/driveApi`; `GmailAuthError` from `@/lib/gmail/client`.
- Produces: `interface ToolDef`; `DRIVE_TOOLS: ToolDef[]`; `DRIVE_TOOL_NAMES: Set<string>`; `resolveBrainTool(name: string, input: Record<string, unknown>, driveAccountId: string | null): Promise<string>`.

- [ ] **Step 1: Write the failing test (pure surface)**

```ts
// src/lib/brain/tools.test.ts
import { describe, it, expect } from "vitest";
import { DRIVE_TOOLS, DRIVE_TOOL_NAMES, resolveBrainTool } from "./tools";

describe("brain tools", () => {
  it("exposes drive_search and drive_read_file", () => {
    expect(DRIVE_TOOL_NAMES.has("drive_search")).toBe(true);
    expect(DRIVE_TOOL_NAMES.has("drive_read_file")).toBe(true);
    expect(DRIVE_TOOLS).toHaveLength(2);
  });
  it("returns an error result (no throw) when Drive is not connected", async () => {
    const out = await resolveBrainTool("drive_search", { query: "x" }, null);
    expect(JSON.parse(out)).toHaveProperty("error");
  });
  it("returns an error result for an unknown tool", async () => {
    const out = await resolveBrainTool("nope", {}, "acct_1");
    expect(JSON.parse(out).error).toMatch(/unknown tool/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brain/tools.test.ts`
Expected: FAIL — cannot find module `./tools`.

- [ ] **Step 3: Implement**

```ts
// src/lib/brain/tools.ts
import { searchFiles, readFileContent } from "@/lib/drive/driveApi";
import { GmailAuthError } from "@/lib/gmail/client";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const DRIVE_TOOLS: ToolDef[] = [
  {
    name: "drive_search",
    description:
      "Search the founder's Google Drive for relevant .md docs, transcripts and notes. " +
      "Returns up to 20 files as {id, name}. Use specific keywords from the conversation.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "keywords; empty lists recent readable files" } },
    },
  },
  {
    name: "drive_read_file",
    description:
      "Read the full text of one Drive file by its id (from drive_search). Google Docs are returned as markdown.",
    input_schema: {
      type: "object",
      properties: { fileId: { type: "string", description: "the file id from drive_search" } },
      required: ["fileId"],
    },
  },
];

export const DRIVE_TOOL_NAMES = new Set(DRIVE_TOOLS.map((t) => t.name));

const MAX_FILE_CHARS = 40000;

/** Resolve a Drive tool call to a JSON string. Never throws — failures become
 *  a JSON `{ error }` the model can read and relay. */
export async function resolveBrainTool(
  name: string,
  input: Record<string, unknown>,
  driveAccountId: string | null,
): Promise<string> {
  if (!driveAccountId) {
    return JSON.stringify({ error: "Google Drive is not connected. Ask the founder to connect Drive." });
  }
  try {
    if (name === "drive_search") {
      const files = await searchFiles(driveAccountId, String(input.query ?? ""));
      return JSON.stringify({ files: files.map((f) => ({ id: f.id, name: f.name })) });
    }
    if (name === "drive_read_file") {
      const text = await readFileContent(driveAccountId, String(input.fileId ?? ""));
      const clipped = text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n[truncated]` : text;
      return JSON.stringify({ content: clipped });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (e) {
    if (e instanceof GmailAuthError) {
      return JSON.stringify({ error: "Google Drive needs reconnecting (token expired)." });
    }
    return JSON.stringify({ error: (e as Error).message });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/brain/tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brain/tools.ts src/lib/brain/tools.test.ts
git commit -m "feat(brain): drive_search/drive_read_file tools + resolver"
```

---

### Task 6: Prompt — brainstorm branch + attachments formatter

**Files:**
- Modify: `src/lib/brain/prompt.ts`
- Modify: `src/lib/brain/prompt.test.ts`

**Interfaces:**
- Consumes: `BrainMode` from `@/lib/brain/mode`.
- Produces: `BrainPromptInput` gains optional `mode?: BrainMode`; `buildBrainSystemPrompt` branches on it (strategist output unchanged); `formatAttachmentsBlock(attachments: { name: string; content: string }[], maxChars?: number): string`.

- [ ] **Step 1: Write the failing tests (append to existing file)**

Add to `src/lib/brain/prompt.test.ts`:

```ts
import { formatAttachmentsBlock } from "./prompt";

describe("buildBrainSystemPrompt — modes", () => {
  const base = { businessName: "Pallisade Data", founderName: "Emil", today: "2026-06-28" };

  it("strategist output is unchanged when mode omitted vs explicit strategist", () => {
    expect(buildBrainSystemPrompt(base)).toBe(buildBrainSystemPrompt({ ...base, mode: "strategist" }));
  });

  it("brainstorm mode steers toward sources, research and a build scope", () => {
    const p = buildBrainSystemPrompt({ ...base, mode: "brainstorm" });
    expect(p).toMatch(/drive_search|drive_read_file/);
    expect(p).toMatch(/web_search|research/i);
    expect(p).toMatch(/build scope/i);
    expect(p).toMatch(/Claude Code/i);
  });
});

describe("formatAttachmentsBlock", () => {
  it("returns empty string with no attachments", () => {
    expect(formatAttachmentsBlock([])).toBe("");
  });
  it("labels each document by name", () => {
    const out = formatAttachmentsBlock([{ name: "call.md", content: "hello" }]);
    expect(out).toContain("call.md");
    expect(out).toContain("hello");
  });
  it("truncates past the char budget with a marker", () => {
    const out = formatAttachmentsBlock([{ name: "big.md", content: "x".repeat(50) }], 10);
    expect(out).toContain("[truncated]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/brain/prompt.test.ts`
Expected: FAIL — `formatAttachmentsBlock` undefined; brainstorm assertions fail.

- [ ] **Step 3: Refactor the prompt builder + add the formatter**

Edit `src/lib/brain/prompt.ts`. Keep the EXISTING prompt text verbatim inside a renamed `strategistPrompt`, add the `mode` field and the branch, plus the brainstorm prompt and the formatter:

```ts
import type { BrainMode } from "./mode";

export interface BrainPromptInput {
  businessName: string;
  founderName: string;
  today: string; // YYYY-MM-DD
  mode?: BrainMode;
}

export function buildBrainSystemPrompt(input: BrainPromptInput): string {
  return input.mode === "brainstorm" ? brainstormPrompt(input) : strategistPrompt(input);
}

function strategistPrompt(input: BrainPromptInput): string {
  const { businessName, founderName, today } = input;
  return (
    /* ⬇️ the EXISTING v1 prompt body, unchanged */
    `Today's date is ${today}.\n\n` +
    `You are "The Brain" — ${founderName}'s most trusted strategic mind for ${businessName}. ` +
    // ... (keep every existing line exactly as-is) ...
    `they need to hear, the way a seasoned operator would over a short, honest conversation.`
  );
}

function brainstormPrompt(input: BrainPromptInput): string {
  const { businessName, founderName, today } = input;
  return (
    `Today's date is ${today}.\n\n` +
    `You are "The Brain" in Product Brainstorm mode — ${founderName}'s 0-to-1 product strategist for ` +
    `${businessName}. Your job: turn a raw product idea into a sharp, buildable scope ${founderName} can hand ` +
    `straight to Claude Code.\n\n` +
    `SOURCES:\n` +
    `- The founder may attach session documents (notes, call transcripts) — they appear inline below as ` +
    `"SESSION DOCUMENTS". Treat them as primary ground truth.\n` +
    `- Use drive_search and drive_read_file to pull additional .md docs and transcripts from the founder's ` +
    `Google Drive when the conversation references material you don't have. Search with specific keywords; ` +
    `read the files that look relevant before opining.\n` +
    `- Use web_search to research the company/market and — critically — HOW THIS PROBLEM HAS ALREADY BEEN ` +
    `SOLVED WITH AI: existing products, common approaches, what's genuinely hard, where the moat is.\n\n` +
    `HOW YOU WORK:\n` +
    `- Ground first, opine second. Read the founder's own material before reaching for the web.\n` +
    `- Separate one-way-door decisions from two-way-door ones. Name the riskiest assumption and what you ` +
    `could NOT verify. Never invent product facts, competitors or numbers.\n` +
    `- Ask the single sharpest clarifying question only when an answer would change the scope; otherwise take ` +
    `a clear position.\n\n` +
    `THE DELIVERABLE — when you have enough to commit, output a "Build Scope" in markdown with these sections:\n` +
    `## Problem  — the real job-to-be-done, in the customer's words\n` +
    `## Who it's for  — the specific user/buyer\n` +
    `## The angle  — the wedge / why this wins vs how it's solved today\n` +
    `## Proposed build  — what to actually build first (the MVP), concretely\n` +
    `## Stack / approach  — suggested architecture, models, key libraries\n` +
    `## Risks & unknowns  — what could kill it; what you couldn't verify\n` +
    `## First steps for Claude Code  — an ordered, buildable starting checklist\n\n` +
    `TONE: direct, high-signal, concise. No flattery. Tell ${founderName} what they need to hear.`
  );
}

/** Render attached session docs as an injectable context block, capped to a
 *  total character budget (truncating later docs with a marker). */
export function formatAttachmentsBlock(
  attachments: { name: string; content: string }[],
  maxChars = 120000,
): string {
  if (!attachments.length) return "";
  let used = 0;
  const parts = attachments.map((a) => {
    const remaining = maxChars - used;
    if (remaining <= 0) return `<<DOCUMENT: ${a.name}>>\n[omitted — attachment budget exceeded]`;
    const body =
      a.content.length > remaining ? `${a.content.slice(0, remaining)}\n[truncated]` : a.content;
    used += body.length;
    return `<<DOCUMENT: ${a.name}>>\n${body}\n<<END ${a.name}>>`;
  });
  return `SESSION DOCUMENTS (provided by the founder):\n\n${parts.join("\n\n")}`;
}
```

**Important:** copy the existing v1 prompt body into `strategistPrompt` exactly — do not paraphrase. The `toBe` test in Step 1 plus the original v1 assertions guard this.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/brain/prompt.test.ts`
Expected: PASS (original 6 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brain/prompt.ts src/lib/brain/prompt.test.ts
git commit -m "feat(brain): brainstorm prompt branch + attachments formatter"
```

---

### Task 7: Route — brainstorm tool-loop branch in `/api/brain`

**Files:**
- Modify: `src/app/api/brain/route.ts`

**Interfaces:**
- Consumes: `buildBrainSystemPrompt`, `formatAttachmentsBlock` from `@/lib/brain/prompt`; `DRIVE_TOOLS`, `DRIVE_TOOL_NAMES`, `resolveBrainTool` from `@/lib/brain/tools`.
- Produces: `POST` accepts `{ messages, mode?, attachments?, context?: { businessName?, founderName?, driveAccountId? } }`; brainstorm path returns `{ content }`.

- [ ] **Step 1: Extend the request type + parse new fields**

Replace the `BrainRequest` interface and add parsing in `POST` (after the existing `messages` guard):

```ts
interface BrainRequest {
  messages?: { role: "user" | "assistant"; content: string }[];
  mode?: "strategist" | "brainstorm";
  attachments?: { name: string; content: string }[];
  context?: { businessName?: string; founderName?: string; driveAccountId?: string };
}
```

- [ ] **Step 2: Branch the POST body**

Keep the existing strategist single-call path for `mode !== "brainstorm"`. Replace the section from `const system = buildBrainSystemPrompt({...})` onward with:

```ts
  const mode = body.mode === "brainstorm" ? "brainstorm" : "strategist";
  const today = new Date().toISOString().slice(0, 10);
  const businessName = body.context?.businessName || "Pallisade Data";
  const founderName = body.context?.founderName || "the founder";

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ---- strategist: single call (unchanged behaviour) ----
  if (mode === "strategist") {
    const system = buildBrainSystemPrompt({ businessName, founderName, today });
    try {
      const response = await client.messages.create({ model: MODEL, max_tokens: 4096, system, messages });
      const finalText = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text).join("\n").trim();
      return NextResponse.json({ content: finalText || "I couldn't produce a response — try rephrasing." });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 });
    }
  }

  // ---- brainstorm: tool loop (web_search + Drive) ----
  const attachmentsBlock = formatAttachmentsBlock(body.attachments ?? []);
  let system = buildBrainSystemPrompt({ businessName, founderName, today, mode: "brainstorm" });
  if (attachmentsBlock) system += `\n\n${attachmentsBlock}`;

  const driveAccountId = body.context?.driveAccountId ?? null;
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 5 },
    ...DRIVE_TOOLS,
  ] as unknown as Anthropic.Tool[];

  try {
    let finalText = "";
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools,
        messages,
      });

      const textParts = response.content
        .filter((blk): blk is Anthropic.TextBlock => blk.type === "text")
        .map((blk) => blk.text);
      if (textParts.length) finalText = textParts.join("\n").trim();

      // Only our local Drive tools need a tool_result; web_search is executed
      // server-side by Anthropic and already resolved in `response.content`.
      const driveUses = response.content.filter(
        (blk): blk is Anthropic.ToolUseBlock =>
          blk.type === "tool_use" && DRIVE_TOOL_NAMES.has(blk.name),
      );

      if (response.stop_reason !== "tool_use" || driveUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        driveUses.map(async (tu) => ({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: await resolveBrainTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, driveAccountId),
        })),
      );
      messages.push({ role: "user", content: results });
    }

    return NextResponse.json({ content: finalText || "I couldn't produce a response — try rephrasing." });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
```

- [ ] **Step 3: Add imports + `MAX_ITERATIONS`**

At the top of the route, extend imports and add the constant near `MODEL`:

```ts
import { buildBrainSystemPrompt, formatAttachmentsBlock } from "@/lib/brain/prompt";
import { DRIVE_TOOLS, DRIVE_TOOL_NAMES, resolveBrainTool } from "@/lib/brain/tools";
```
```ts
const MAX_ITERATIONS = 8;
```

- [ ] **Step 4: Build + manual smoke**

Run: `npm run build`
Expected: build succeeds; `/api/brain` still listed.
With a real `ANTHROPIC_API_KEY` and `npm run dev`:
```bash
curl -s localhost:3000/api/brain -X POST -H 'content-type: application/json' \
  -d '{"mode":"brainstorm","messages":[{"role":"user","content":"Brainstorm an AI tool that drafts SOC2 evidence. Research how this is solved today, then give a build scope."}]}' | head -c 800
```
Expected: a JSON `{ "content": "...## Problem ... ## First steps for Claude Code ..." }` (web_search may make it slow). Strategist still works:
```bash
curl -s localhost:3000/api/brain -X POST -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Should I niche down to asset managers?"}]}' | head -c 300
```

- [ ] **Step 5: Run full suite + commit**

```bash
npx vitest run
git add src/app/api/brain/route.ts
git commit -m "feat(brain): brainstorm tool-loop (web_search + Drive) in /api/brain"
```

---

### Task 8: Brain client — carry mode, attachments, drive account

**Files:**
- Modify: `src/lib/brainClient.ts` (`sendBrainTurn`)

**Interfaces:**
- Produces: `sendBrainTurn` params gain `mode?: "strategist" | "brainstorm"`, `attachments?: { name: string; content: string }[]`, and `context` gains `driveAccountId?: string`.

- [ ] **Step 1: Update `sendBrainTurn`**

```ts
export async function sendBrainTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  mode?: "strategist" | "brainstorm";
  attachments?: { name: string; content: string }[];
  context: { businessName: string; founderName: string; driveAccountId?: string };
}): Promise<{ content: string }> {
  const res = await fetch("/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    if (err.error === "no_key") {
      throw new Error("The Brain needs an ANTHROPIC_API_KEY. Add it to .env.local and restart.");
    }
    throw new Error(typeof err.error === "string" ? err.error : "The request failed.");
  }

  return (await res.json()) as { content: string };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (page is updated next; a `mode`/`driveAccountId` error in `page.tsx` is expected until Task 9).

```bash
git add src/lib/brainClient.ts
git commit -m "feat(brain): sendBrainTurn carries mode + attachments + driveAccountId"
```

---

### Task 9: Page — mode toggle, filtered threads, `.md` drop, Drive gate

**Files:**
- Modify: `src/app/brain/page.tsx`

**Interfaces:**
- Consumes: `threadMode`/`BrainMode` from `@/lib/brain/mode`; `getDriveStatus` from `@/lib/brainClient`; `BrainAttachment` from `@/lib/types`; `store.create/update`.

- [ ] **Step 1: Replace `src/app/brain/page.tsx` with the mode-aware version**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SendHorizontal, BrainCircuit, Paperclip, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ThreadList } from "@/components/advisor/ThreadList";
import { MessageBubble } from "@/components/advisor/MessageBubble";
import { MicButton } from "@/components/ui/MicButton";
import { getBrainStatus, sendBrainTurn, getDriveStatus } from "@/lib/brainClient";
import type { BrainThread, BrainAttachment, ChatMessage } from "@/lib/types";
import { threadMode, type BrainMode } from "@/lib/brain/mode";
import { uid, nowISO } from "@/lib/utils";

export default function BrainPage() {
  const store = useStore();
  const { brainThreads, settings } = store;

  const [mode, setMode] = useState<BrainMode>("strategist");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [drive, setDrive] = useState<{ connected: boolean; accountId: string | null }>({ connected: false, accountId: null });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getBrainStatus().then((s) => setConfigured(s.configured)); }, []);
  useEffect(() => { if (mode === "brainstorm") getDriveStatus().then(setDrive); }, [mode]);

  const threads = useMemo(
    () => brainThreads.filter((t) => threadMode(t) === mode),
    [brainThreads, mode],
  );

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

  const switchMode = (m: BrainMode) => { setMode(m); setActiveId(null); setInput(""); setError(null); };

  const selectThread = (id: string) => {
    const t = brainThreads.find((x) => x.id === id);
    if (t) setMode(threadMode(t));
    setActiveId(id);
    setError(null);
  };

  // Create-on-demand so a thread exists before the first message or attachment.
  const ensureThread = (seedTitle: string): BrainThread => {
    if (active) return active;
    const thread = store.create("brainThreads", {
      title: seedTitle.slice(0, 48) || (mode === "brainstorm" ? "New brainstorm" : "New thread"),
      mode,
      messages: [],
      attachments: [],
    } as Omit<BrainThread, "id" | "createdAt" | "updatedAt">) as BrainThread;
    setActiveId(thread.id);
    return thread;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const thread = ensureThread("New brainstorm");
    const read: BrainAttachment[] = [];
    for (const f of Array.from(files)) {
      if (!/\.(md|txt|markdown)$/i.test(f.name)) continue;
      const content = await f.text();
      read.push({ id: uid("att"), name: f.name, content, createdAt: nowISO() });
    }
    if (read.length) {
      store.update("brainThreads", thread.id, { attachments: [...(thread.attachments ?? []), ...read] });
    }
  };

  const removeAttachment = (attId: string) => {
    if (!active) return;
    store.update("brainThreads", active.id, {
      attachments: (active.attachments ?? []).filter((a) => a.id !== attId),
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);

    const thread = ensureThread(text);
    const userMsg: ChatMessage = { id: uid("msg"), role: "user", content: text, createdAt: nowISO() };
    const withUser = [...thread.messages, userMsg];
    setMessages(thread, withUser);
    setInput("");
    setLoading(true);

    try {
      const reply = await sendBrainTurn({
        messages: withUser.map((m) => ({ role: m.role, content: m.content })),
        mode,
        attachments: mode === "brainstorm"
          ? (thread.attachments ?? []).map((a) => ({ name: a.name, content: a.content }))
          : undefined,
        context: {
          businessName: settings.businessName,
          founderName: settings.founderName,
          driveAccountId: mode === "brainstorm" ? drive.accountId ?? undefined : undefined,
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

  const isBrainstorm = mode === "brainstorm";
  const attachments = active?.attachments ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brain"
        subtitle={isBrainstorm
          ? "Product brainstorm — reads your Drive docs + dropped notes, researches the market, and writes a build scope for Claude Code."
          : "Your strategic sparring partner for positioning and the big calls — thinking like a founder who has scaled and taken companies public."}
      />

      {/* mode toggle */}
      <div className="inline-flex rounded-lg border border-[var(--color-line-strong)] p-0.5 bg-[var(--color-surface-2)]">
        {(["strategist", "brainstorm"] as BrainMode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`px-3 py-1.5 text-[0.8rem] rounded-md transition-colors ${
              mode === m ? "bg-[var(--color-surface)] text-[var(--color-ink)] font-medium" : "text-[var(--color-muted)]"
            }`}
          >
            {m === "strategist" ? "Strategist" : "Brainstorm"}
          </button>
        ))}
      </div>

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

      {isBrainstorm && configured !== false && !drive.connected && (
        <Panel>
          <div className="flex items-start gap-3 p-1">
            <Paperclip size={16} className="text-[var(--color-accent)] mt-0.5" />
            <p className="text-[0.84rem] text-[var(--color-muted)] leading-relaxed">
              Connect Google Drive to let the Brain read your docs and transcripts.{" "}
              <a href="/api/gmail/connect" className="text-[var(--color-accent)] underline">Connect Drive</a>.
              You can still drop <code>.md</code> files below and use web research without it.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 items-start">
        <Panel title="Threads">
          <ThreadList
            conversations={threads}
            activeId={activeId}
            onSelect={selectThread}
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
                <h3 className="text-[0.95rem] font-semibold text-[var(--color-ink)]">
                  {isBrainstorm ? "What are we building?" : "What are we deciding?"}
                </h3>
                <p className="text-[0.83rem] text-[var(--color-muted)] mt-1.5 max-w-sm leading-relaxed">
                  {isBrainstorm
                    ? "Drop your notes/transcripts (.md) or just describe the idea — I'll pull from Drive, research how it's solved today, and scope the build."
                    : "Try \"should I niche down to asset managers or stay broad?\", or \"how should I price the reconciliation product?\"."}
                </p>
              </div>
            ) : (
              active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onConfirm={() => {}} onDismiss={() => {}} copyRaw={isBrainstorm} />
              ))
            )}
            {loading && (
              <div className="flex items-center gap-2 text-[0.8rem] text-[var(--color-dim)]">
                <Loader2 size={14} className="animate-spin" /> {isBrainstorm ? "Researching…" : "Thinking…"}
              </div>
            )}
          </div>

          {error && <p className="text-[0.78rem] text-[var(--color-accent)] mt-3">{error}</p>}

          {isBrainstorm && attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 text-[0.74rem] px-2 py-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  <Paperclip size={11} /> {a.name}
                  <button onClick={() => removeAttachment(a.id)} className="hover:text-[var(--color-accent)]"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 mt-4 pt-4 border-t border-[var(--color-line)]">
            {isBrainstorm && (
              <label className="btn btn-ghost cursor-pointer" title="Attach .md / .txt notes">
                <Paperclip size={15} />
                <input type="file" accept=".md,.markdown,.txt" multiple className="hidden"
                  onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
              </label>
            )}
            <textarea
              className="textarea flex-1"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={isBrainstorm
                ? "Describe the product idea…  (📎 to attach notes · Enter to send · 🎙 to talk)"
                : "Put a decision on the table…  (Enter to send · Shift+Enter for a new line · 🎙 to talk)"}
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

> If `btn-ghost` is not a class in this repo, use the same classes as the Send button minus `btn-accent`, or reuse `MicButton`'s wrapper styling — check `globals.css`/existing buttons before inventing styles.

- [ ] **Step 2: Build + manual smoke**

Run: `npm run build`
Expected: build succeeds.
Manual (`npm run dev`): toggle shows Strategist | Brainstorm; switching filters the thread list; in Brainstorm an `.md` drop shows a removable chip; with no Drive-scoped account the "Connect Drive" notice shows; sending in each mode appends user + assistant turns.

- [ ] **Step 3: Run full suite + commit**

```bash
npx vitest run
git add src/app/brain/page.tsx
git commit -m "feat(brain): mode toggle, filtered threads, .md drop + Drive gate"
```

---

### Task 10: Copy raw markdown for brainstorm scopes

**Files:**
- Modify: `src/components/advisor/MessageBubble.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MessageBubble` accepts optional `copyRaw?: boolean` (default `false`); when true the copy button writes `message.content` (raw markdown) instead of rendered `innerText`. Advisor/Content callers omit it → unchanged.

- [ ] **Step 1: Add the prop + branch the copy**

In `src/components/advisor/MessageBubble.tsx`, add `copyRaw = false` to the destructured props and its type, then change `copyAll`:

```tsx
export function MessageBubble({
  message, onConfirm, onDismiss, copyRaw = false,
}: {
  message: ChatMessage;
  onConfirm: (a: ProposedAction) => void;
  onDismiss: (a: ProposedAction) => void;
  copyRaw?: boolean;
}) {
```
```tsx
  const copyAll = async () => {
    const text = copyRaw ? message.content : (bodyRef.current?.innerText ?? message.content);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };
```

- [ ] **Step 2: Build + manual smoke**

Run: `npm run build`
Expected: succeeds. In a Brainstorm thread, the assistant "Copy" button copies the raw markdown (paste into a plain editor shows `## Problem` etc.). Advisor/Content copy is unchanged (still plain text).

- [ ] **Step 3: Commit**

```bash
git add src/components/advisor/MessageBubble.tsx
git commit -m "feat(brain): copy raw markdown for brainstorm scope messages"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all pass (v1 73 + new: mode 2, config 3, driveApi 4, tools 3, prompt 5 = **90**). Exact count may differ if other suites changed; the point is GREEN.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds; route list includes `/brain`, `/api/brain`, `/api/drive/status`.

- [ ] **Step 3: End-to-end manual smoke (with real key + Google connected)**

1. `/brain` → Brainstorm tab → drop a `.md` → chip appears.
2. Ask it to scope a product → it calls Drive/web, returns a Build Scope with the 7 sections.
3. Copy → paste into a plain editor → markdown headings intact.
4. Strategist tab → ask a decision question → single-call answer, unchanged.

- [ ] **Step 4: Update the SDD progress ledger**

Append a short entry to `.superpowers/sdd/progress.md` noting v2 (Product Brainstorm) shipped, files touched, and any deferred items (business-data snapshot, Drive write-back).

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(brain): record Product Brainstorm (v2) completion"
```

---

## Self-Review

**Spec coverage** (against `2026-06-28-brain-product-brainstorm-design.md`):
- Mode discriminator + back-compat → Task 1 ✓
- Drive scope + `hasDriveScope` → Task 2 ✓
- `driveApi` (export Google Docs / download text) → Task 3 ✓
- Drive status route + client gate → Task 4, used in Task 9 ✓
- `drive_search`/`drive_read_file` tools → Task 5 ✓
- `web_search` native tool in loop → Task 7 ✓
- Prompt branch (strategist unchanged) + attachments injection → Task 6, wired in Task 7 ✓
- Segmented toggle + filtered threads + new-thread-inherits-mode → Task 9 ✓
- `.md`/`.txt` drop attached to thread → Task 9 ✓
- Markdown output + raw-markdown copy → Task 10 ✓
- Business-data snapshot excluded; no Drive write-back; no buildScopes collection; no streaming → not built (correct) ✓

**Placeholder scan:** No "TBD/TODO"; every code step has full code. The one verbatim-copy instruction (Task 6 strategist body) is guarded by a `toBe` equality test. The `btn-ghost` caveat in Task 9 is a concrete check, not a placeholder.

**Type consistency:** `BrainMode`/`threadMode` (Task 1) used in Tasks 6, 9. `DRIVE_TOOLS`/`DRIVE_TOOL_NAMES`/`resolveBrainTool` (Task 5) consumed in Task 7. `formatAttachmentsBlock` (Task 6) consumed in Task 7. `getDriveStatus` (Task 4) consumed in Task 9. `sendBrainTurn` params (Task 8) match the Task 9 call site and the Task 7 request type (`mode`, `attachments`, `context.driveAccountId`). `driveFetchPlan`/`driveQuery` (Task 3) used inside `searchFiles`/`readFileContent` same file. Consistent.
